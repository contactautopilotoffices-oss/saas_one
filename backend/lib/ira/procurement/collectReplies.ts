/**
 * COLLECT REPLIES — the half of the loop that has to exist outside the email.
 * -----------------------------------------------------------------------------
 * An HTML email cannot contain a working text field (Zoho Mail strips <form>,
 * and AMP for Email — which would allow one — is not rendered by Zoho). So the
 * responder replies, and this reads the mailbox and turns those replies into
 * dispositions.
 *
 * Reuses ZohoMailService verbatim, the same client the purchase and electricity
 * mailbox crons already use. Nothing here talks to Zoho directly.
 *
 * ── MATCHING ────────────────────────────────────────────────────────────────
 * By REF, in this order:
 *   1. refs the person typed in their own text ("IRA-3F9A2B10 done") — several
 *      per reply are fine, each segment is applied on its own;
 *   2. the ref in the subject — present when the mail carried exactly one line,
 *      so a plain Reply needs nothing typed.
 * A reply with no ref anywhere is NOT dropped silently: it is returned as
 * `unmatched` with the sender and text, so the responder can ask "which line?"
 * The previous version `continue`d on a missing subject tag and the answer
 * vanished without a trace in the run log.
 *
 * Refs resolve against EVERY finding, open or answered. A reply stays in the
 * lookback window for 24h after it is applied, and a line that no longer
 * resolves reads as `unmatched` — which is how one answered reply turned into
 * ~190 identical "which line is this?" mails in a day. Recognising a closed
 * line is what tells us to say nothing.
 *
 * The ref is derived from the finding, so nothing has to be stored to resolve
 * it — we recompute refs for the org's findings and match.
 *
 * ── WHO IS ALLOWED TO CLOSE A LINE ──────────────────────────────────────────
 * The sender address must resolve to a real user WITH A MEMBERSHIP IN THIS
 * ORG. A known user from another org is not enough — an inbox is a public
 * surface and anyone can send mail to it claiming anything.
 */

import { ZohoMailService, grantOwning, type ZohoMailMessage } from '@/backend/services/zohoMailService';
import { grantForMailbox, noteMailAccountResult } from '@/backend/lib/mail/accounts';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { parseReply, replyTag, tagFromSubject, tagsFromText, segmentsByTag, stripQuotedText, stripSignature, signOffName, poNumbersFromText } from './reply';
import { DISPOSITION_SPECS, signalFor, type Disposition } from './disposition';

/** Feedback coins, mirroring the console's DEFAULT_COINS. */
const COINS: Record<string, number> = { praise: 10, reject: -5, roi_flag: -15, correction: 0 };

/**
 * Where proof attachments are kept. Private bucket, created by
 * supabase/migrations/20260908000001_ira_proof_bucket.sql — same storage shape
 * as the electricity mailbox's 'electricity-bills' (backend/lib/electricity/ingest.ts).
 */
const PROOF_BUCKET = 'ira-proof';
/** What counts as proof: a signed-off PDF or a screenshot. Anything else is logged and skipped. */
const PROOF_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const PROOF_MAX_BYTES = 10 * 1024 * 1024;
const PROOF_MAX_FILES = 5;

/** A proof attachment saved to storage, kept against the line it arrived on. */
export interface ProofRef {
    /** Path inside the PROOF_BUCKET — `${orgId}/${zohoMessageId}/${fileName}`. */
    path: string;
    fileName: string;
    mimeType: string;
    size: number;
}

/** A reply that was applied, and should be acknowledged straight away. */
export interface AppliedReply {
    findingId: string; findingKey: string; findingTitle: string;
    poLabels: string[];
    disposition: Disposition; note: string;
    senderEmail: string; senderName: string | null;
    /**
     * The RFC 822 Message-ID of the mail being answered — what In-Reply-To
     * needs. Falls back to Zoho's internal numeric id when the payload carried
     * no RFC header (the pre-existing behaviour: threading by Re:-subject only).
     */
    subject: string; messageId: string; mailbox: string;
    /** Proof files that arrived with the reply, stored under 'ira-proof'. */
    proofs?: ProofRef[];
}

/** One reply that needs a human-readable answer from the agent. */
export interface ReplyNeedingAnswer {
    findingId: string | null;
    findingKey: string | null;
    findingTitle: string | null;
    /** Why an answer is owed: they asked, they're stuck, or we couldn't place it. */
    because: 'need_info' | 'blocked' | 'unmatched';
    disposition: Disposition | null;
    senderEmail: string;
    senderUserId: string | null;
    senderName: string | null;
    text: string;
    subject: string;
    /** RFC 822 Message-ID of the reply — see AppliedReply.messageId. */
    messageId: string;
    mailbox: string;
    /** Proof files that arrived with the reply, stored under 'ira-proof'. */
    proofs?: ProofRef[];
}

export interface CollectResult {
    scanned: number;
    matched: number;
    applied: number;
    /** Read but deliberately not applied, with the reason. Never silent. */
    ignored: Array<{ from: string; subject: string; reason: string }>;
    /** Replies that earn a response back — the responder decides whether to send. */
    needsAnswer: ReplyNeedingAnswer[];
    /** Every reply that changed a line, for immediate acknowledgement. */
    applied_replies: AppliedReply[];
    errors: string[];
}

interface KnownFinding {
    id: string; finding_key: string; title: string;
    refs?: Array<{ label?: string }> | null;
    /** Null while the line is open. Set once somebody has answered it. */
    disposition: string | null;
}

/** How many of the agent's findings we resolve replies against, newest first. */
const FINDING_LOOKUP_LIMIT = 500;

export interface CollectOptions {
    /**
     * Only ASK "which line is this?" about mail that arrived after this.
     *
     * `since` is deliberately wide (24h) so no answer is ever missed, and
     * re-applying an answer is free — the `.is('disposition', null)` guard makes
     * it a no-op. Asking a QUESTION is not free: it is a new mail every time.
     * So the ask is bounded by the last pass, and an unplaceable reply is asked
     * about once rather than once per poll for a day.
     */
    askSince?: Date;
    /**
     * Addresses that are us. Mail from any of them is our own outbound and is
     * never a reply — including the digests that land in a colleague's mailbox
     * that we also poll. Previously only mail from the mailbox being read was
     * skipped, so Ira read her own digests out of the second mailbox and was one
     * seeded user row away from answering herself.
     */
    selfAddresses?: string[];
}

/** Compare subjects and titles without punctuation, case or spacing getting in the way. */
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The marker our own subjects carry, so a reply to one is recognisable as ours. */
const SCAN_MARKER = 'po scan';
/** A reply, not an original. "Re:", "RE:", "Fwd:", and the stacked variants. */
const IS_REPLY = /^\s*((re|fwd|fw)\s*:\s*)+/i;

/**
 * The proof a reply carried — a signed-off PDF, a screenshot of the credit note —
 * downloaded from the mailbox and kept in storage.
 *
 * Preservation and visibility ONLY. Nothing here reads the contents: the files
 * are stored and named on the finding's event so a person can open them, and
 * that is the whole contract for now.
 *
 * TODO(adjudication): parse the stored files (PDF text, image OCR) and feed
 * what they say into the disposition decision — that is the seam where parsed
 * content would enter. Until then a "done" with a screenshot attached is
 * believed on the same terms as a "done" without one.
 *
 * Never throws into the caller's loop: a reply's WORDS matter more than its
 * attachments, and a storage outage must not lose the answer they came with.
 */
async function collectProofs(
    orgId: string,
    box: string,
    msg: ZohoMailMessage,
    connected: { refreshToken: string; dc: string } | null,
): Promise<ProofRef[]> {
    const attachments = connected
        ? await ZohoMailService.listAttachmentsWithGrant(msg.messageId, { refreshToken: connected.refreshToken, dc: connected.dc }, box || undefined)
        : await ZohoMailService.listAttachments(msg.messageId, (await grantOwning(box)) ?? 'ZOHO_MAIL', box || undefined);

    const proofs: ProofRef[] = [];
    /**
     * ATTEMPTS, NOT SUCCESSES. The cap used to count stored files, so every
     * skip — wrong type, oversize, a failed upload — left it untouched. With the
     * bucket missing, EVERY attachment on every message would be downloaded in
     * full and thrown away, bounded by nothing.
     */
    let tried = 0;
    for (const att of attachments) {
        if (++tried > PROOF_MAX_FILES) {
            console.warn(`[ira replies] ${msg.messageId}: more than ${PROOF_MAX_FILES} attachments — the rest are not kept`);
            break;
        }
        const mime = (att.mimeType || '').toLowerCase().trim();
        if (!PROOF_TYPES.has(mime)) {
            console.warn(`[ira replies] ${msg.messageId}: skipping ${att.attachmentName} (${mime || 'unknown type'}) — not a type we keep`);
            continue;
        }
        if (att.attachmentSize > PROOF_MAX_BYTES) {
            console.warn(`[ira replies] ${msg.messageId}: skipping ${att.attachmentName} — ${att.attachmentSize} bytes is over the ${PROOF_MAX_BYTES} cap`);
            continue;
        }
        const bytes = connected
            ? await ZohoMailService.downloadAttachmentWithGrant(msg.messageId, att.attachmentId, { refreshToken: connected.refreshToken, dc: connected.dc }, box || undefined)
            : await ZohoMailService.downloadAttachment(msg.messageId, att.attachmentId, (await grantOwning(box)) ?? 'ZOHO_MAIL', box || undefined);
        if (bytes.length > PROOF_MAX_BYTES) {
            console.warn(`[ira replies] ${msg.messageId}: skipping ${att.attachmentName} — ${bytes.length} bytes is over the ${PROOF_MAX_BYTES} cap`);
            continue;
        }
        /**
         * THE FILENAME IS WRITTEN BY WHOEVER SENT THE MAIL.
         *
         * It arrives from Content-Disposition and reached the storage key raw.
         * supabase-js interpolates the key into the request URL and fetch then
         * normalises dot segments, so "../../../guest-photos/x.png" resolves out
         * of this bucket entirely — and with the service-role key and upsert:true
         * that is an arbitrary overwrite of any object in the project, including
         * a public bucket. Anyone able to email a shared inbox could do it.
         *
         * Same shape as the console's own proof upload
         * (backend/lib/emailActions/handlers.ts): reduce to a safe alphabet, cap
         * the length, and prefix a timestamp so two files called "attachment"
         * on one message cannot silently overwrite each other.
         */
        const safeName = (att.attachmentName || 'attachment')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/^\.+/, '_')
            .slice(0, 120);
        const path = `${orgId}/${msg.messageId}/${Date.now()}_${safeName}`;
        const { error } = await supabaseAdmin.storage
            .from(PROOF_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
        if (error) {
            console.warn(`[ira replies] ${msg.messageId}: storing ${att.attachmentName} failed — ${error.message}`);
            continue;
        }
        proofs.push({ path, fileName: safeName, mimeType: mime, size: bytes.length });
    }
    return proofs;
}

/** One line per stored proof, so the finding's history shows what arrived with the answer. */
const proofNote = (proofs: ProofRef[]) => proofs.length
    ? `\nProof attached:\n${proofs.map((p) => `- ${p.fileName} (${p.mimeType}) — ${PROOF_BUCKET}/${p.path}`).join('\n')}`
    : '';

/**
 * Read replies since `since` from ONE mailbox and apply them. Never throws — a
 * mailbox outage must not take down the cron that also does other work.
 */
export async function collectIraReplies(
    orgId: string,
    agentKey: string,
    since: Date,
    mailbox?: string,
    opts?: CollectOptions,
): Promise<CollectResult> {
    const out: CollectResult = { scanned: 0, matched: 0, applied: 0, ignored: [], needsAnswer: [], applied_replies: [], errors: [] };
    const box = (mailbox ?? '').toLowerCase();
    const askSince = opts?.askSince ?? since;
    const self = new Set((opts?.selfAddresses ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean));

    /**
     * 1. EVERY finding, not only the open ones, and the ref each answers to.
     *
     * This used to read `.is('disposition', null)`, and that one clause put the
     * mailbox into a loop. A reply is applied ONCE — the line becomes
     * 'in_progress' — and then stays in the 24h lookback window for another day.
     * On every pass after that the line it names is no longer open, so nothing
     * matched, so the reply was re-read as `unmatched` and answered again: 2
     * mails every 15 minutes, ~190 a day, all identical, all to the person who
     * had already been told her answer was recorded.
     *
     * Identification and mutation are different questions. We resolve a reply
     * against every finding, then refuse to CHANGE one that is already
     * dispositioned. Recognising a line we have closed is exactly how we know
     * to say nothing.
     */
    const { data: findings, error: fErr } = await supabaseAdmin
        .from('oem_agent_findings')
        .select('id, finding_key, title, refs, disposition')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .order('last_seen_at', { ascending: false })
        .limit(FINDING_LOOKUP_LIMIT);

    if (fErr) {
        out.errors.push(`findings store unavailable: ${fErr.message}`);
        return out;
    }
    if (!findings?.length) return out;

    // Open lines claim a PO number or a title first: when two findings answer to
    // the same words, the one still needing an answer is the one they meant.
    const ordered = [...findings].sort((a, b) => Number(Boolean(a.disposition)) - Number(Boolean(b.disposition)));

    const byTag = new Map<string, KnownFinding>();
    /** PO number -> the ref that answers for it. What people actually type. */
    const byPoNumber = new Map<string, string>();
    /**
     * Finding title -> its ref.
     *
     * The subject we send carries the finding's own title:
     *   "PO scan · 7 Sept · BLR — TREIS SOLUTION LLP — same invoice on 2 live POs"
     * so "Re: <that>" identifies the line with nothing typed and nothing hidden.
     * This is the match that survives a client stripping our HTML comment, which
     * is exactly what happened the first time somebody actually replied.
     */
    const byTitle = new Map<string, string>();
    for (const f of ordered) {
        const tag = replyTag(orgId, agentKey, String(f.finding_key));
        byTag.set(tag, {
            id: String(f.id), finding_key: String(f.finding_key), title: String(f.title ?? ''),
            refs: (f as { refs?: Array<{ label?: string }> }).refs ?? [],
            disposition: (f as { disposition?: string | null }).disposition ?? null,
        });
        const title = norm(String(f.title ?? ''));
        if (title.length >= 12 && !byTitle.has(title)) byTitle.set(title, tag);
        for (const r of ((f as { refs?: Array<{ label?: string }> }).refs ?? [])) {
            const label = String(r?.label ?? '').trim().toUpperCase();
            // First finding wins: if two open findings name the same order we
            // cannot tell which one they meant, and guessing is worse than asking.
            if (label && !byPoNumber.has(label)) byPoNumber.set(label, tag);
        }
    }

    /**
     * 2. Read the mailbox.
     *
     * A mailbox connected from the console wins over anything in the
     * environment: it was authorised by the person who owns that inbox, it is
     * revocable by them, and it is how every mailbox after the first will be
     * added. Env grants remain for the original purchase@ setup.
     */
    let messages;
    let usedConnected = false;
    try {
        const connected = box ? await grantForMailbox(orgId, box) : null;
        if (connected) {
            usedConnected = true;
            messages = await ZohoMailService.listMessagesWithGrant(
                { since, address: box }, { refreshToken: connected.refreshToken, dc: connected.dc },
            );
        } else {
            const grant = box ? await grantOwning(box) : 'ZOHO_MAIL';
            if (!grant) {
                out.errors.push(`nothing can read ${box} — connect that mailbox from the Agent Console, or its replies stay invisible`);
                return out;
            }
            messages = await ZohoMailService.listMessages({ since, address: box || undefined }, grant);
        }
        if (usedConnected) await noteMailAccountResult(orgId, box, null);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (usedConnected) await noteMailAccountResult(orgId, box, msg);
        out.errors.push(`mailbox ${box || 'default'} read failed: ${msg}`);
        return out;
    }
    out.scanned = messages.length;

    for (const msg of messages) {
        const senderEmail = (msg.fromAddress ?? '').toLowerCase().trim();
        // Our own outbound mail, and anything the agent itself sent, is not a reply.
        if (!senderEmail || senderEmail === box || self.has(senderEmail)) continue;
        const subject = msg.subject ?? '';
        const subjectTag = tagFromSubject(subject);

        /**
         * ADDRESSED TO HER, OR MERELY COPIED IN?
         *
         * If two people discuss a purchase order between themselves and CC Ira,
         * the old code read it exactly like an instruction: an org member, a Re:
         * subject, a PO number, the word "done" somewhere — and the line closed.
         * Nobody had told her anything. Somebody had been polite.
         *
         * So the rule is the one a person uses. On the To line it is addressed
         * to her and it can change the state of a finding. On CC only, she is
         * being kept informed: the words are KEPT AGAINST THE LINE as context,
         * and nothing is closed, nothing is answered.
         */
        const inTo = (msg.toAddress ?? []).some((a) => String(a).toLowerCase().includes(box));
        const inCc = (msg.ccAddress ?? []).some((a) => String(a).toLowerCase().includes(box));
        const ccOnly = !inTo && inCc;

        // 3. Their words — fetched BEFORE matching, because the ref may be in them.
        //
        // The SAME fetch is where the RFC 822 Message-ID comes from when Zoho
        // puts it in the payload. msg.messageId is Zoho's INTERNAL numeric id:
        // handed to In-Reply-To it threads nothing, because no sender's mail
        // client has ever seen it. The real header is what makes an answer file
        // under their question. When no payload carries it, threadId falls back
        // to the internal id — today's subject-only threading, unchanged.
        const connected = box ? await grantForMailbox(orgId, box) : null;
        let raw = msg.summary ?? '';
        let rfcMessageId: string | null = msg.rfcMessageId ?? null;
        try {
            const full = connected
                ? await ZohoMailService.getMessageContentWithGrant(msg.messageId, msg.folderId, { refreshToken: connected.refreshToken, dc: connected.dc }, box)
                : await ZohoMailService.getMessageContent(msg.messageId, msg.folderId, (await grantOwning(box)) ?? 'ZOHO_MAIL', box || undefined);
            if (full?.content) raw = full.content;
            if (full?.rfcMessageId) rfcMessageId = full.rfcMessageId;
        } catch {
            // Fall back to the summary rather than losing the reply entirely.
        }
        const threadId = rfcMessageId ?? msg.messageId;
        /** When this mail reached the mailbox. Bounds every non-idempotent action below. */
        const arrivedAt = Date.parse(msg.sentAt ?? '');

        /**
         * THE PROOF THAT CAME WITH THE REPLY — fetched LATE, and once.
         *
         * This used to run eagerly on every message carrying an attachment,
         * which was wrong twice over:
         *
         *   · IT RAN BEFORE ANYONE WAS CHECKED. The membership gate and the
         *     is-this-even-our-thread gate are both below, so a stranger's
         *     vendor mail — anything with a PDF — was downloaded from Zoho and
         *     written into our storage under the org's own prefix.
         *   · IT RAN ON EVERY PASS. The read window is 24h and the cron is
         *     quarter-hourly, so one attachment was re-listed, re-downloaded
         *     and re-uploaded 96 times a day, per polled mailbox. That is the
         *     exact shape of the incident this file was rewritten to end, with
         *     Zoho's API quota paying for it instead of the recipient.
         *
         * So it is a thunk now: memoised, and invoked only once the sender is a
         * member of this org AND the mail arrived since the previous pass. The
         * files are still evidence and are still kept whether or not the words
         * around them could be placed — but only for people we can name.
         */
        let proofs: ProofRef[] = [];
        let proofsFetched = false;
        const fetchProofs = async (): Promise<ProofRef[]> => {
            if (proofsFetched || !msg.hasAttachment) return proofs;
            proofsFetched = true;
            if (!Number.isFinite(arrivedAt) || arrivedAt < askSince.getTime()) return proofs;
            try {
                proofs = await collectProofs(orgId, box, msg, connected);
            } catch (e) {
                console.warn(`[ira replies] ${msg.messageId}: proof attachments not kept — ${e instanceof Error ? e.message : e}`);
            }
            return proofs;
        };
        const ownText = stripQuotedText(raw);
        /**
         * WHO WROTE THIS, as opposed to who owns the address.
         *
         * purchase@worksquare.in is a shared mailbox registered to one person in
         * `users`. Reading the greeting off that row thanked Priyanka for a mail
         * Vidya wrote and signed. Header name first, then how they signed off,
         * then nothing — a missing name is better than the wrong one.
         */
        const writer = msg.fromName ?? signOffName(ownText);

        /**
         * WHICH LINE IS THIS ABOUT, in order of how much we trust it:
         *   1. a ref they typed themselves;
         *   2. a PURCHASE ORDER NUMBER in their own words — the identifier a
         *      human actually uses, and now the primary match;
         *   3. the hidden ref carried in the quoted original;
         *   4. the subject, for older mail that still had a tag in it.
         */
        const fromPo = poNumbersFromText(ownText)
            .map((n) => byPoNumber.get(n)).filter((t): t is string => Boolean(t));
        const quotedTags = tagsFromText(raw);
        // The finding title, carried in the subject of the mail they replied to.
        const normSubject = norm(subject);
        const fromTitle: string[] = [];
        for (const [title, tag] of byTitle) if (normSubject.includes(title)) fromTitle.push(tag);

        const tags = tagsFromText(ownText).length ? tagsFromText(ownText)
            : fromPo.length ? Array.from(new Set(fromPo))
            : quotedTags.length ? quotedTags
            : fromTitle.length ? Array.from(new Set(fromTitle))
            : subjectTag ? [subjectTag] : [];

        // Not addressed to any line — and not about this agent at all if there is
        // no ref anywhere in the whole message including the quoted digest.
        if (!tags.length) {
            /**
             * Is this one of ours at all?
             *
             * The old test was "does the word ira appear, or is there a ref
             * anywhere". Cleaning the subject line removed BOTH from a normal
             * reply, so the first real reply this system ever received was
             * dropped without a line in the run log — the exact failure this
             * function was written to prevent, reintroduced by me.
             *
             * A reply to a subject carrying our own scan marker is ours, full
             * stop. If we cannot place the line we ASK; we do not go quiet.
             */
            /**
             * The marker alone is NOT enough. The CEO writes his own scan under
             * the subject "PO Scan 11:30 — 06 Sep — ..." and the first version
             * of this test matched it, so Ira mailed him back asking which line
             * he meant. Answering a human's own report as though it were a
             * reply to us is worse than missing a reply.
             *
             * So: it must be a REPLY (Re:/Fwd:) as well as ours.
             */
            /**
             * A COLLEAGUE WRITING IN COLD, not replying to anything.
             *
             * "How much did we spend with Mahir this quarter?" sent fresh to Ira
             * is the most natural way to ask her something, and it was dropped
             * here without a trace — the entire question-answering path could
             * only ever be reached by replying to a scan. Anyone this org can
             * identify should be able to write to her.
             *
             * THREE CONDITIONS, and the third is the one that matters:
             *   · she is on the To line, not merely copied in. Being CC'd on a
             *     thread between two other people is not being asked;
             *   · the subject is not itself a scan report. The CEO writes his
             *     own under "PO Scan 11:30 — 06 Sep", and answering a person's
             *     report as though it were a question to us is the specific
             *     mistake this whole gate was added to prevent — so a
             *     scan-shaped subject is only ours when it is a Re:;
             *   · the sender resolves to an ACTIVE MEMBER of this org. That is
             *     verified a few lines below, before anything is sent, and it
             *     is what stops a public inbox turning us into a mailer.
             */
            const writingToHer = inTo && !ccOnly && !normSubject.includes(SCAN_MARKER);
            const inAThreadOfOurs = quotedTags.length > 0
                || (IS_REPLY.test(subject) && (/\bira\b/i.test(subject) || normSubject.includes(SCAN_MARKER)));
            /** Reached us on its own, not by replying to anything we sent. */
            const coldMail = !inAThreadOfOurs && writingToHer;

            const isOurThread = inAThreadOfOurs || writingToHer;
            if (!isOurThread) continue; // genuinely unrelated mail in a shared inbox

            /**
             * ASKED ALREADY, ON AN EARLIER PASS.
             *
             * The read window is a day wide, and re-reading is free for
             * everything else here — a disposition re-applied is a no-op. A
             * QUESTION is not: it is a new mail every pass. Bound it to what has
             * arrived since the last run.
             */
            if (Number.isFinite(arrivedAt) && arrivedAt < askSince.getTime()) {
                out.ignored.push({ from: senderEmail, subject, reason: 'could not place the line — asked on an earlier pass, not asking again' });
                continue;
            }

            // Only answer a person we can actually place in this org. An inbox is
            // a public surface; replying to an unknown sender is a way to be used
            // as a mailer.
            const { data: u } = await supabaseAdmin
                .from('users').select('id').ilike('email', senderEmail).maybeSingle();
            let isMember = false;
            if (u) {
                const { count } = await supabaseAdmin
                    .from('organization_memberships').select('*', { count: 'exact', head: true })
                    .eq('organization_id', orgId).eq('user_id', u.id);
                isMember = (count ?? 0) > 0;
            }
            /**
             * A SHARED INBOX IS MOSTLY NOT ABOUT US.
             *
             * purchase@ receives vendor mail all day. Now that a cold mail from
             * a colleague is accepted, the same door lets every quotation and
             * delivery note reach this point too — and logging each one as
             * "could not place the line" would bury the handful of entries an
             * operator actually needs to see. So a stranger writing to the
             * inbox is passed over in silence; only mail from someone this org
             * can identify is worth a line in the run log.
             */
            if (!isMember) {
                if (!coldMail) {
                    out.ignored.push({ from: senderEmail, subject, reason: 'replied on our thread, but the sender is not a member of this org' });
                }
                continue;
            }
            out.ignored.push({
                from: senderEmail, subject,
                reason: coldMail
                    ? 'wrote in directly — answering from the record'
                    : 'could not tell which line this answers — asked the sender',
            });
            await fetchProofs();
            out.needsAnswer.push({
                findingId: null, findingKey: null, findingTitle: null,
                because: 'unmatched', disposition: null,
                senderEmail, senderUserId: null, senderName: null,
                text: ownText, subject, messageId: threadId, mailbox: box,
                ...(proofs.length ? { proofs } : {}),
            });
            continue;
        }

        // 4. The sender must be someone we know, IN THIS ORG.
        const { data: user } = await supabaseAdmin
            .from('users').select('id, full_name').ilike('email', senderEmail).maybeSingle();
        let member = false;
        if (user) {
            const { count } = await supabaseAdmin
                .from('organization_memberships')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', orgId).eq('user_id', user.id);
            member = (count ?? 0) > 0;
        }
        if (user && member) await fetchProofs();
        if (!user || !member) {
            out.ignored.push({ from: senderEmail, subject, reason: user ? 'sender is not a member of this org — not applied' : 'sender is not a known user — not applied' });
            continue;
        }

        // 5. One segment per ref. "IRA-A done. IRA-B not an issue — refunded."
        for (const seg of segmentsByTag(ownText, tags)) {
            const finding = byTag.get(seg.tag);
            if (!finding) {
                out.ignored.push({ from: senderEmail, subject, reason: `ref ${seg.tag} matches no line of this agent's` });
                continue;
            }
            out.matched++;

            /**
             * Already answered. This is the same mail, still inside the lookback
             * window, on a line somebody has since dispositioned — and it is the
             * common case, because a reply lives in that window for 24h after it
             * lands. The person was acknowledged when it was applied. Say
             * nothing, change nothing, and record why.
             */
            if (finding.disposition) {
                out.ignored.push({ from: senderEmail, subject, reason: `${seg.tag} was already answered ("${finding.disposition}") — nothing to change` });
                continue;
            }

            // Their words, without the sign-off, job title, phone number and
            // confidentiality footer. What gets recorded is what gets quoted back.
            const parsed = parseReply(stripSignature(seg.text));
            const spec = DISPOSITION_SPECS[parsed.disposition];

            // Copied in, not asked. Keep what was said; change nothing.
            if (ccOnly) {
                await supabaseAdmin.from('oem_agent_finding_events').insert({
                    finding_id: finding.id,
                    organization_id: orgId,
                    disposition: null,
                    note: `[overheard on a thread Ira was copied into, from ${senderEmail}]\n${seg.text.slice(0, 2000)}${proofNote(proofs)}`,
                    source: 'email',
                    created_by: user.id,
                });
                out.ignored.push({ from: senderEmail, subject, reason: `copied in only — noted against ${seg.tag}, not applied` });
                continue;
            }

            // A disposition that needs an explanation, sent without one, is left open.
            // Applying it would record a closure nobody justified.
            if (spec.requiresNote && !parsed.note.trim()) {
                out.ignored.push({ from: senderEmail, subject, reason: `"${spec.label}" on ${seg.tag} needs a reason; reply had none` });
                continue;
            }

            const { error: upErr } = await supabaseAdmin
                .from('oem_agent_findings')
                .update({
                    disposition: parsed.disposition,
                    disposition_note: parsed.note || null,
                    dispositioned_by: user.id,
                    dispositioned_at: new Date().toISOString(),
                })
                .eq('id', finding.id)
                .is('disposition', null); // first reply wins; a second does not overwrite

            if (upErr) { out.errors.push(`${finding.finding_key}: ${upErr.message}`); continue; }

            await supabaseAdmin.from('oem_agent_finding_events').insert({
                finding_id: finding.id,
                organization_id: orgId,
                disposition: parsed.disposition,
                note: ((parsed.note || '') + proofNote(proofs)).trim() || null,
                source: 'email',
                created_by: user.id,
            });

            // The training signal, derived — nobody was asked to rate anything.
            const signal = signalFor(parsed.disposition);
            if (signal) {
                await supabaseAdmin.from('oem_agent_feedback').insert({
                    organization_id: orgId,
                    agent_key: agentKey,
                    signal,
                    coins: COINS[signal] ?? 0,
                    roi_flag: false,
                    reason: `${spec.label} — ${finding.title}`.slice(0, 300),
                    guidance: parsed.note ? `[${finding.finding_key}] ${parsed.note}` : null,
                    applied_to_prompt_version: null,
                    created_by: user.id,
                });
            }
            out.applied++;
            out.applied_replies.push({
                findingId: finding.id, findingKey: finding.finding_key, findingTitle: finding.title,
                poLabels: (finding.refs ?? []).map((r) => String(r?.label ?? '')).filter(Boolean),
                disposition: parsed.disposition, note: parsed.note,
                senderEmail, senderName: writer,
                subject, messageId: threadId, mailbox: box,
                ...(proofs.length ? { proofs } : {}),
            });

            // They asked something, or they're stuck. That earns an answer back.
            if (parsed.disposition === 'need_info' || parsed.disposition === 'blocked') {
                out.needsAnswer.push({
                    findingId: finding.id, findingKey: finding.finding_key, findingTitle: finding.title,
                    because: parsed.disposition, disposition: parsed.disposition,
                    senderEmail, senderUserId: user.id, senderName: writer,
                    text: seg.text, subject, messageId: threadId, mailbox: box,
                    ...(proofs.length ? { proofs } : {}),
                });
            }
        }
    }

    return out;
}
