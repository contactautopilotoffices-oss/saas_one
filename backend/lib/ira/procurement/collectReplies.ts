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
 * The ref is derived from the finding, so nothing has to be stored to resolve
 * it — we recompute refs for the org's open findings and match.
 *
 * ── WHO IS ALLOWED TO CLOSE A LINE ──────────────────────────────────────────
 * The sender address must resolve to a real user WITH A MEMBERSHIP IN THIS
 * ORG. A known user from another org is not enough — an inbox is a public
 * surface and anyone can send mail to it claiming anything.
 */

import { ZohoMailService } from '@/backend/services/zohoMailService';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { parseReply, replyTag, tagFromSubject, tagsFromText, segmentsByTag, stripQuotedText, poNumbersFromText } from './reply';
import { DISPOSITION_SPECS, signalFor, type Disposition } from './disposition';

/** Feedback coins, mirroring the console's DEFAULT_COINS. */
const COINS: Record<string, number> = { praise: 10, reject: -5, roi_flag: -15, correction: 0 };

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
    messageId: string;
    mailbox: string;
}

export interface CollectResult {
    scanned: number;
    matched: number;
    applied: number;
    /** Read but deliberately not applied, with the reason. Never silent. */
    ignored: Array<{ from: string; subject: string; reason: string }>;
    /** Replies that earn a response back — the responder decides whether to send. */
    needsAnswer: ReplyNeedingAnswer[];
    errors: string[];
}

interface OpenFinding { id: string; finding_key: string; title: string; refs?: Array<{ label?: string }> | null }

/** Compare subjects and titles without punctuation, case or spacing getting in the way. */
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The marker our own subjects carry, so a reply to one is recognisable as ours. */
const SCAN_MARKER = 'po scan';

/**
 * Read replies since `since` from ONE mailbox and apply them. Never throws — a
 * mailbox outage must not take down the cron that also does other work.
 */
export async function collectIraReplies(
    orgId: string,
    agentKey: string,
    since: Date,
    mailbox?: string,
): Promise<CollectResult> {
    const out: CollectResult = { scanned: 0, matched: 0, applied: 0, ignored: [], needsAnswer: [], errors: [] };
    const box = (mailbox ?? '').toLowerCase();

    // 1. Open findings, and the ref each one answers to.
    const { data: findings, error: fErr } = await supabaseAdmin
        .from('oem_agent_findings')
        .select('id, finding_key, title, refs')
        .eq('organization_id', orgId)
        .eq('agent_key', agentKey)
        .is('disposition', null);

    if (fErr) {
        out.errors.push(`findings store unavailable: ${fErr.message}`);
        return out;
    }
    if (!findings?.length) return out;

    const byTag = new Map<string, OpenFinding>();
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
    for (const f of findings) {
        const tag = replyTag(orgId, agentKey, String(f.finding_key));
        byTag.set(tag, {
            id: String(f.id), finding_key: String(f.finding_key), title: String(f.title ?? ''),
            refs: (f as { refs?: Array<{ label?: string }> }).refs ?? [],
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

    // 2. Read the mailbox.
    let messages;
    try {
        messages = await ZohoMailService.listMessages({ since, address: box || undefined });
    } catch (e) {
        out.errors.push(`mailbox ${box || 'default'} read failed: ${e instanceof Error ? e.message : e}`);
        return out;
    }
    out.scanned = messages.length;

    for (const msg of messages) {
        const senderEmail = (msg.fromAddress ?? '').toLowerCase().trim();
        // Our own outbound mail, and anything the agent itself sent, is not a reply.
        if (!senderEmail || senderEmail === box) continue;
        const subject = msg.subject ?? '';
        const subjectTag = tagFromSubject(subject);

        // 3. Their words — fetched BEFORE matching, because the ref may be in them.
        let raw = msg.summary ?? '';
        try {
            const full = await ZohoMailService.getMessageContent(msg.messageId, msg.folderId, 'ZOHO_MAIL', box || undefined);
            if (full?.content) raw = full.content;
        } catch {
            // Fall back to the summary rather than losing the reply entirely.
        }
        const ownText = stripQuotedText(raw);

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
            const isOurThread = quotedTags.length > 0
                || /\bira\b/i.test(subject)
                || normSubject.includes(SCAN_MARKER);
            if (!isOurThread) continue; // genuinely unrelated mail in a shared inbox
            out.ignored.push({ from: senderEmail, subject, reason: 'could not tell which line this answers — asked the sender' });
            out.needsAnswer.push({
                findingId: null, findingKey: null, findingTitle: null,
                because: 'unmatched', disposition: null,
                senderEmail, senderUserId: null, senderName: null,
                text: ownText, subject, messageId: msg.messageId, mailbox: box,
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
        if (!user || !member) {
            out.ignored.push({ from: senderEmail, subject, reason: user ? 'sender is not a member of this org — not applied' : 'sender is not a known user — not applied' });
            continue;
        }

        // 5. One segment per ref. "IRA-A done. IRA-B not an issue — refunded."
        for (const seg of segmentsByTag(ownText, tags)) {
            const finding = byTag.get(seg.tag);
            if (!finding) {
                out.ignored.push({ from: senderEmail, subject, reason: `ref ${seg.tag} matches no open line (already closed, or not this agent's)` });
                continue;
            }
            out.matched++;

            const parsed = parseReply(seg.text);
            const spec = DISPOSITION_SPECS[parsed.disposition];

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
                note: parsed.note || null,
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

            // They asked something, or they're stuck. That earns an answer back.
            if (parsed.disposition === 'need_info' || parsed.disposition === 'blocked') {
                out.needsAnswer.push({
                    findingId: finding.id, findingKey: finding.finding_key, findingTitle: finding.title,
                    because: parsed.disposition, disposition: parsed.disposition,
                    senderEmail, senderUserId: user.id, senderName: user.full_name ?? null,
                    text: seg.text, subject, messageId: msg.messageId, mailbox: box,
                });
            }
        }
    }

    return out;
}
