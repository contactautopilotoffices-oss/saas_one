/**
 * RESPOND — Ira answers back, with the finding's own facts, in the same thread.
 * -----------------------------------------------------------------------------
 * `runtime.respond.enabled` existed as a checkbox and a type and nothing else:
 * no code read it. Someone replying "which PO is this?" got silence, and the
 * console copy claimed otherwise. This is the missing half.
 *
 * WHAT IT ANSWERS
 *   need_info   — they asked for detail. Send the evidence: refs, amounts,
 *                 the problem statement, what has already been said on it.
 *   blocked     — they are stuck. Acknowledge, restate what unblocks it, and
 *                 say the line stays open and will not be re-raised meanwhile.
 *   unmatched   — the reply carried no ref AND names no line we still hold, so
 *                 ask which line and list what is open for them to copy. The
 *                 CALLER bounds this to mail that arrived since the last pass:
 *                 the ask is the one thing here that is not idempotent, and
 *                 unbounded it re-asks every quarter hour for a day.
 *   question    — a special case of unmatched: the body reads as a question
 *                 about the book itself ("how much did we spend with X this
 *                 quarter?", "status of PO-26/27-0323?"). Detection is
 *                 deterministic and conservative; instead of the which-line
 *                 template it gets a real answer built from a bounded fact
 *                 sheet of matching purchase orders and the lines already
 *                 raised. Same rule as everything else: no figure the sheet
 *                 does not contain.
 *
 * WHOSE RULES THE MODEL WRITES UNDER
 *   The hardcoded SYSTEM below always applies. On top of it, only the
 *   == OPERATOR CORRECTIONS (standing rules) == block that the operator's
 *   reinforcement loop folded into oem_agents.system_prompt is appended —
 *   additive only. The rest of that column is a whole composed persona with
 *   its own style rules; it belongs to the console agent and never crosses
 *   into this voice.
 *
 * WHAT IT NEVER DOES
 *   - invent a number: every figure in the reply is copied from the finding
 *     row or its refs, never produced by the model. The model is handed the
 *     facts and asked to phrase them. [BAA p.94]
 *   - close, reopen or change a line. It reads and it writes prose. The
 *     disposition loop is human-only.
 *   - reply twice to the same person on the same line in 24h. A model that
 *     answers its own answers is how a mailbox fills with an agent talking to
 *     itself; the guard is an event row with source 'agent'. NOTE that the
 *     unmatched branch returns before that guard — it has no line to hang an
 *     event on — so its repeat-protection lives in the caller's askSince. The
 *     question branch hangs its answer on a matched line when the question
 *     names one and inherits the guard from it; otherwise it mirrors unmatched.
 *   - start a new thread. In-Reply-To carries the person's Message-ID so the
 *     answer files under their question.
 *
 * ── AGENT SPEC BLOCK (doctrine §3) ───────────────────────────────────────────
 *   Task boundary   phrase a factual answer to one reply about one finding   [BAA p.104]
 *   Tools           none — inputs are pre-fetched rows; the model calls nothing [BAA p.94]
 *   Failure mode    returns { sent:false, why } as data; never throws         [BAA p.94]
 *   Memory          reads oem_agent_finding_events (the line's own history);
 *                   writes one event per answer so the next reply sees it    [BAA p.103]
 *   Evaluation      the answer is judged on the PATH: facts cited must exist
 *                   in the context handed in; a verify pass strips any figure
 *                   not present in the input before send                      [BAA p.95]
 *   Model           council 'email' purpose — mid-tier, temperature 0.5      [BAA p.112]
 *   Known deviation the quality rubric (L6) is not yet instrumented; answers
 *                   are logged for hand audit via the finding_events row     [BAA p.96]
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { councilChat, councilRunCost } from '@/backend/lib/council/llm';
import { sendDigest } from '@/backend/lib/ira/dailyDigest';
import { agentMessages, bakedContext } from '@/backend/lib/agents/context';
import { poNumbersFromText, replyTag, stripSignature } from './reply';
import { DISPOSITION_SPECS, type Disposition } from './disposition';
import { entityUrl, type EntityRef } from './types';
import type { ReplyNeedingAnswer } from './collectReplies';

export interface RespondOutcome {
    sent: boolean;
    why: string;
    to?: string;
    costUsd?: number;
}

/** One answer per person per line per day. */
const ANSWER_COOLDOWN_H = 24;

/** A "which line?" mail is a prompt, not an inventory. Eight is already a lot. */
const MAX_REFS_LISTED = 8;

/**
 * ACKNOWLEDGE EVERY ANSWER, IMMEDIATELY.
 *
 * Someone writes "cancelled the second one" and hears nothing back. They cannot
 * tell whether it was read, understood, or filed against the right order — so
 * next time they do not bother. Nine runs and 78 asks produced zero replies,
 * and silence is part of why.
 *
 * This is a template, not a model call: instant, free, and it states exactly
 * what was recorded so a misfiling is caught by the person who would know.
 * The substantive answers (need_info, blocked) still go through the model.
 */
export function acknowledgement(
    name: string | null, poLabels: string[], disposition: Disposition, note: string, ref: string,
    /** Their subject, so the reply lands in their thread instead of opening one. */
    inSubject?: string,
): { subject: string; body: string } {
    const spec = DISPOSITION_SPECS[disposition];
    const where = poLabels.length ? poLabels.join(' and ') : ref;
    const consequence = spec.closes
        ? 'It won\'t come back in tomorrow\'s scan.'
        : disposition === 'in_progress'
            ? 'I\'ll leave it open and won\'t chase you on it meanwhile.'
            : 'Leaving it open — tell me when it moves.';
    /**
     * A person replies IN the thread. The old subject — "Got it — PO-25/26-173,
     * PO-25/26-031" — opened a new conversation in every mail client, so an
     * answer to a question arrived detached from the question.
     */
    const subject = inSubject
        ? `Re: ${inSubject.replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, '')}`
        : `Re: ${where}`;
    // First name only. "Thanks Vidya Pawar" is how a form letter opens.
    const first = name?.trim().split(/\s+/)[0] ?? null;
    return {
        subject,
        body: `${first ? `Thanks ${first} —` : 'Thanks —'} noted against ${where} as "${spec.label.toLowerCase()}". ${consequence}\n\nIf that's the wrong order, just say so and I'll move it.\n\n— Ira`,
    };
}

interface FindingRow {
    id: string; finding_key: string; title: string; priority: string;
    vendor: string | null; property: string | null; amount: number | null;
    problem: string; refs: EntityRef[] | null; stats: Array<{ label: string; value: string }> | null;
    first_seen_at: string | null; times_seen: number | null;
}

interface EventRow { disposition: string | null; note: string | null; source: string; created_at: string; created_by: string | null }

function inr(n: number): string {
    return '₹' + Math.round(n).toLocaleString('en-IN');
}

/** The history of one line — what was said, by whom, when. Nothing read this table before. */
export async function loadFindingHistory(findingId: string, limit = 12): Promise<EventRow[]> {
    const { data } = await supabaseAdmin
        .from('oem_agent_finding_events')
        .select('disposition, note, source, created_at, created_by')
        .eq('finding_id', findingId)
        .order('created_at', { ascending: false })
        .limit(limit);
    return (data ?? []) as EventRow[];
}

/**
 * Every figure the model is allowed to use, as plain text. The model phrases;
 * it does not compute. If a number in its draft is not in this block, it is
 * removed before sending.
 */
function factSheet(orgId: string, f: FindingRow, history: EventRow[]): { text: string; numbers: Set<string> } {
    const numbers = new Set<string>();
    const note = (s: string) => { for (const m of s.matchAll(/\d[\d,]*\.?\d*/g)) numbers.add(m[0].replace(/,/g, '')); return s; };

    const lines: string[] = [];
    lines.push(note(`FINDING: ${f.title}`));
    lines.push(`PRIORITY: ${f.priority}`);
    if (f.vendor) lines.push(`VENDOR: ${f.vendor}`);
    if (f.property) lines.push(`SITE: ${f.property}`);
    if (f.amount !== null) lines.push(note(`AMOUNT AT STAKE: ${inr(f.amount)}`));
    lines.push(note(`PROBLEM: ${f.problem}`));
    for (const r of f.refs ?? []) {
        const url = entityUrl(r, orgId);
        lines.push(note(`RECORD: ${r.kind.toUpperCase()} ${r.label}${url ? ` — ${url}` : ' (no link available)'}`));
    }
    for (const s of f.stats ?? []) lines.push(note(`${s.label.toUpperCase()}: ${s.value}`));
    if (f.first_seen_at) lines.push(note(`FIRST RAISED: ${new Date(f.first_seen_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}, seen ${f.times_seen ?? 1} time(s)`));
    if (history.length) {
        lines.push('WHAT HAS BEEN SAID ON THIS LINE (newest first):');
        for (const e of history) {
            const when = new Date(e.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
            lines.push(note(`  - ${when} · ${e.source} · ${e.disposition ?? 'note'}${e.note ? `: ${e.note}` : ''}`));
        }
    }
    return { text: lines.join('\n'), numbers };
}

const SYSTEM = `You are Ira, the procurement scanner at Autopilot. You are answering ONE email reply about ONE finding you raised.

Rules, absolute:
- Use only the facts in the FACT SHEET. Do not add, estimate, round or infer any number, date, PO number or name that is not there verbatim.
- If the fact sheet does not contain what they asked for, say so in one sentence and name the record they can open.
- Plain, short, no pleasantries beyond one line. 4 to 8 lines. No bullet spam.
- Never say the line is closed, reopened or changed. You do not decide that; people do.
- End with exactly what you need from them to close the line, in one sentence, and the ref they should quote.
- Write in plain text. No markdown, no HTML.`;

/**
 * The question branch answers about the book generally, not about one line —
 * same rules, a different first sentence.
 */
const QA_SYSTEM = SYSTEM.replace(
    'You are answering ONE email reply about ONE finding you raised.',
    'You are answering ONE email question about the purchase orders and findings you track.',
);

/**
 * THE OPERATOR-RULES OVERLAY.
 *
 * oem_agents.system_prompt holds a WHOLE COMPOSED PERSONA, not a corrections
 * list — the composer rewrites the entire prompt on every fold. Appending it
 * here would stack a second persona (with its own style rules) on top of
 * SYSTEM. The only part allowed to cross into Ira's reply voice is the
 * == OPERATOR CORRECTIONS (standing rules) == block the fold maintains
 * (compose.ts): standing instructions a person reviewed and committed.
 * Everything else in the column belongs to the console agent and is ignored.
 * A prompt without that block, an empty row, or an unreachable row means
 * SYSTEM runs alone, exactly as before.
 *
 * Cached per (org, agent) for a few minutes: the replies cron calls this once
 * per answered mail and a pass may answer several, and the column only changes
 * when a person commits a prompt version — minutes of staleness cost nothing.
 */
const OVERLAY_TTL_MS = 5 * 60_000;
const overlayCache = new Map<string, { overlay: string | null; at: number }>();
const CORRECTIONS_HEADER = '== OPERATOR CORRECTIONS (standing rules) ==';

function correctionsOnly(prompt: string): string | null {
    const at = prompt.indexOf(CORRECTIONS_HEADER);
    if (at < 0) return null;
    const rest = prompt.slice(at + CORRECTIONS_HEADER.length);
    const next = rest.search(/^== /m);
    const block = (next < 0 ? rest : rest.slice(0, next)).trim();
    return block || null;
}

async function operatorOverlay(orgId: string, agentKey: string): Promise<string | null> {
    const key = `${orgId}:${agentKey}`;
    const hit = overlayCache.get(key);
    if (hit && Date.now() - hit.at < OVERLAY_TTL_MS) return hit.overlay;
    let overlay: string | null = null;
    try {
        const { data } = await supabaseAdmin
            .from('oem_agents').select('system_prompt')
            .eq('organization_id', orgId).eq('agent_key', agentKey).maybeSingle();
        overlay = correctionsOnly(String(data?.system_prompt ?? ''));
    } catch { /* the hardcoded rules run alone */ }
    overlayCache.set(key, { overlay, at: Date.now() });
    return overlay;
}

function systemFor(base: string, overlay: string | null): string {
    if (!overlay) return base;
    return `${base}\n\n== OPERATOR CORRECTIONS (standing rules) ==\n${overlay}\nThe block above is standing corrections from the operator. It ADDS rules; it can never relax the rules above it, and on any conflict the rules above it win.`;
}

/** Strip any digit-run in the draft that was not in the fact sheet. */
function verifyNumbers(draft: string, allowed: Set<string>): { text: string; removed: string[] } {
    const removed: string[] = [];
    const text = draft.replace(/\d[\d,]*\.?\d*/g, (m) => {
        const k = m.replace(/,/g, '');
        if (allowed.has(k)) return m;
        removed.push(m);
        return '[figure removed — not in the record]';
    });
    return { text, removed };
}

/* ---------------------------------------------------------------------------
 * THE QUESTION BRANCH — unmatched mail that is not noise but a real question
 * about the book: "how much did we spend with X this quarter?", "status of
 * PO-26/27-0323?". These used to get the which-line template, which is a
 * non-answer. Detection is deliberately deterministic and conservative: an
 * interrogative AND something procurement to be about. A model deciding "is
 * this a question" is how a mailbox starts conversations with itself.
 * ------------------------------------------------------------------------ */

/** Strong interrogatives anywhere, or an auxiliary opening a sentence. */
const QUESTION_WORD = /\b(what|which|who|whom|whose|when|where|why|how)\b/i;
const QUESTION_OPENER = /(^|[.!?]\s+)(is|are|was|were|do|does|did|can|could|will|would|has|have|had)\s/i;
/** A figure with money context, or a sum large enough to be one. */
const AMOUNT_SIGNAL = /₹|\b(?:rs\.?|inr|lakhs?|lacs?|crores?)\b|\b\d[\d,]{2,}\b/i;
const PERIOD_SIGNAL = /\b(?:today|yesterday|tonight)\b|\b(?:this|last|next)\s+(?:week|month|quarter|year)\b|\bq[1-4]\b|\bfy\s?\d{2}(?:-\d{2})?\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const PROCUREMENT_SIGNAL = /\b(?:po|purchase|order|vendor|supplier|invoice|bill|billed|payment|paid|spend|spent|amount|quote|quotation|approval|approved|pending|status|delivery|delivered|credit note|debit note|refund)\b/i;
/** "One Solution", "TREIS SOLUTION LLP" — how a vendor name looks in prose. */
const VENDOR_SIGNAL = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b|\b[A-Z]{4,}\b/;

function looksLikeQuestion(text: string): boolean {
    const t = text.trim();
    if (t.length < 8) return false;
    if (!(t.includes('?') || QUESTION_WORD.test(t) || QUESTION_OPENER.test(t))) return false;
    return poNumbersFromText(t).length > 0
        || AMOUNT_SIGNAL.test(t)
        || PERIOD_SIGNAL.test(t)
        || PROCUREMENT_SIGNAL.test(t)
        || VENDOR_SIGNAL.test(t);
}

/** Words that are neither furniture nor procurement vocabulary — candidate vendor names. */
const SEARCH_STOP = new Set([
    'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'much', 'many',
    'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'has', 'have', 'had',
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'there', 'their', 'they',
    'you', 'your', 'yours', 'our', 'ours', 'out', 'any', 'all', 'not', 'but', 'per', 'via',
    'please', 'tell', 'show', 'give', 'know', 'share', 'kindly', 'regards', 'thanks', 'thank', 'dear', 'hello',
    'po', 'ira', 'purchase', 'order', 'orders', 'vendor', 'vendors', 'supplier', 'suppliers',
    'invoice', 'invoices', 'bill', 'bills', 'billed', 'payment', 'payments', 'paid', 'spend', 'spent',
    'amount', 'total', 'value', 'worth', 'quote', 'quotation', 'quotations', 'approval', 'approved',
    'pending', 'status', 'delivery', 'delivered', 'credit', 'debit', 'note', 'notes', 'refund',
    'quarter', 'month', 'months', 'week', 'weeks', 'year', 'years', 'today', 'yesterday', 'last', 'this', 'next',
    'date', 'dates', 'number', 'details', 'detail', 'info', 'information', 'list', 'summary',
]);

/** Up to four candidate vendor-search terms from the question. */
function vendorSearchTerms(text: string): string[] {
    const out: string[] = [];
    for (const w of text.replace(/[^a-zA-Z]+/g, ' ').split(/\s+/)) {
        const t = w.toLowerCase();
        if (t.length < 4 || SEARCH_STOP.has(t) || out.includes(t)) continue;
        out.push(t);
        if (out.length >= 4) break;
    }
    return out;
}

/** A question answer cites at most this much of the book. */
const MAX_QA_POS = 10;
const MAX_QA_FINDINGS = 10;
/** How many recent lines we scan for relevance to the question. */
const FINDING_POOL = 50;

const kolkataDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Everything the model may cite in a question answer: the purchase orders that
 * match a number or a vendor word in the question, and the lines already raised
 * whose own text shares a word with it. Bounded, org-scoped, and every figure
 * is collected into `numbers` so verifyNumbers can police the draft.
 */
async function questionFactSheet(
    orgId: string, agentKey: string, question: string,
): Promise<{ text: string; numbers: Set<string>; findingIds: string[]; searched: string[] }> {
    const numbers = new Set<string>();
    const note = (s: string) => { for (const m of s.matchAll(/\d[\d,]*\.?\d*/g)) numbers.add(m[0].replace(/,/g, '')); return s; };

    const poNumbers = poNumbersFromText(question);
    /**
     * SEARCH WHAT THEY ASKED, NOT HOW THEY SIGNED OFF.
     *
     * `question` is the raw body: this path never had the signature removed
     * (the collector strips it only where a reply matched a line). A
     * procurement question is made almost entirely of stop-listed words, so the
     * term scan ran straight past it into the footer — "how much is pending on
     * PO-25/26-0031? Thanks, Vidya Pawar, Work Square" searched for vendors
     * named vidya, pawar, work and square. Those matches then crowded the real
     * order out of the result, and the answer told her the PO does not exist.
     * They also went out verbatim: "I looked for vendor "pawar"".
     */
    const terms = vendorSearchTerms(stripSignature(question));
    const searched = [...poNumbers, ...terms.map((t) => `vendor "${t}"`)];

    const lines: string[] = [];

    // ---- purchase orders matching a number or a vendor word -----------------
    if (poNumbers.length || terms.length) {
        const { data } = await supabaseAdmin
            .from('zoho_purchase_orders')
            .select('id, po_number, vendor_name, po_amount, status, po_date, property_id')
            .eq('organization_id', orgId)
            .or([
                ...poNumbers.map((n) => `po_number.ilike.${n}`),
                ...terms.map((t) => `vendor_name.ilike.%${t}%`),
            ].join(','))
            .order('po_date', { ascending: false })
            .limit(MAX_QA_POS);
        const pos = (data ?? []) as Array<{
            id: string; po_number: string | null; vendor_name: string | null;
            po_amount: number | string | null; status: string | null;
            po_date: string | null; property_id: string | null;
        }>;

        const propName = new Map<string, string>();
        const propIds = [...new Set(pos.map((p) => p.property_id).filter(Boolean))] as string[];
        if (propIds.length) {
            const { data: props } = await supabaseAdmin
                .from('properties').select('id, name').in('id', propIds.slice(0, 50));
            for (const p of props ?? []) propName.set(String(p.id), String(p.name ?? ''));
        }

        if (pos.length) {
            lines.push('PURCHASE ORDERS MATCHING THE QUESTION (newest first):');
            for (const p of pos) {
                const url = entityUrl({ kind: 'po', label: p.po_number ?? p.id, id: p.id }, orgId);
                lines.push(note(
                    `  - ${p.po_number ?? p.id} · ${p.vendor_name ?? 'vendor not recorded'} · ${inr(Number(p.po_amount ?? 0))}`
                    + ` · status ${p.status ?? 'unknown'} · dated ${p.po_date ? kolkataDate(p.po_date) : 'undated'}`
                    + (p.property_id && propName.get(p.property_id) ? ` · ${propName.get(p.property_id)}` : '')
                    + (url ? ` — ${url}` : ''),
                ));
            }
        }
        /**
         * "THIS ORDER DOES NOT EXIST" IS A CLAIM, AND IT NEEDS ITS OWN QUERY.
         *
         * It used to be inferred from the list above — which is an OR across the
         * PO number AND up to four vendor words, capped at ten rows and ordered
         * by a nullable date (Postgres sorts NULLS FIRST on a bare DESC, so
         * undated orders take the head). Ten vendor matches, or ten undated
         * rows, and the real order fell off the end — and Ira mailed a person to
         * say a purchase order she was holding does not exist.
         *
         * Absence is now established by asking about exactly those numbers and
         * nothing else. If that query fails we say NOTHING: an unproven absence
         * must never be reported as a fact.
         */
        if (poNumbers.length) {
            const { data: exact, error: exactErr } = await supabaseAdmin
                .from('zoho_purchase_orders')
                .select('po_number')
                .eq('organization_id', orgId)
                .or(poNumbers.map((n) => `po_number.ilike.${n}`).join(','));
            if (!exactErr) {
                const held = new Set((exact ?? []).map((p) => String(p.po_number ?? '').toUpperCase()));
                const missing = poNumbers.filter((n) => !held.has(n));
                if (missing.length) {
                    lines.push(note(`NOT IN THE RECORDS: no purchase order numbered ${missing.join(', ')}.`));
                }
            }
        }
    }

    // ---- lines already raised, filtered to ones the question touches --------
    const { data: findings } = await supabaseAdmin
        .from('oem_agent_findings')
        .select('id, title, priority, vendor, property, amount, problem, disposition, disposition_note, dispositioned_at')
        .eq('organization_id', orgId).eq('agent_key', agentKey)
        .order('last_seen_at', { ascending: false })
        .limit(FINDING_POOL);

    const qWords = new Set(
        question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
            .filter((w) => w.length >= 4 && !SEARCH_STOP.has(w)),
    );
    const relevant = ((findings ?? []) as Array<{
        id: string; title: string; priority: string; vendor: string | null;
        property: string | null; amount: number | null; problem: string;
        disposition: string | null; disposition_note: string | null; dispositioned_at: string | null;
    }>).filter((f) => {
        const hay = `${f.title} ${f.vendor ?? ''} ${f.property ?? ''} ${f.problem}`.toLowerCase();
        return poNumbers.some((n) => hay.includes(n.toLowerCase())) || [...qWords].some((w) => hay.includes(w));
    }).slice(0, MAX_QA_FINDINGS);

    const findingIds = relevant.map((f) => String(f.id));
    if (relevant.length) {
        lines.push('LINES ALREADY RAISED THAT MATCH THE QUESTION (newest first):');
        for (const f of relevant) {
            const state = f.disposition
                ? `answered "${f.disposition}"${f.dispositioned_at ? ` on ${kolkataDate(f.dispositioned_at)}` : ''}${f.disposition_note ? ` — "${f.disposition_note}"` : ''}`
                : 'open';
            lines.push(note(
                `  - [${state}] ${f.title} · ${f.priority}${f.vendor ? ` · ${f.vendor}` : ''}`
                + `${f.amount !== null ? ` · ${inr(f.amount)}` : ''} — ${f.problem}`,
            ));
        }
    }

    return { text: lines.join('\n'), numbers, findingIds, searched };
}

/**
 * Answer a general question from the book. Same discipline as the finding
 * branches: a fact sheet built from SQL, the model only phrases, and any
 * figure it adds is stripped before send. When nothing matches, the answer is
 * a template stating exactly what was searched and not found — a model call
 * to say "I have nothing" is spend on a sentence we already know.
 */
async function answerQuestion(
    orgId: string,
    agentKey: string,
    r: ReplyNeedingAnswer,
    cfg: { replyTo: string | null },
): Promise<RespondOutcome> {
    const question = r.text.trim();
    const sheet = await questionFactSheet(orgId, agentKey, question);

    // One answer per line per day, when the question names a line we hold. When
    // it names none there is no row to hang an event on, and the repeat bound
    // is the caller's askSince — exactly what the unmatched branch lives with.
    if (sheet.findingIds.length) {
        const sinceIso = new Date(Date.now() - ANSWER_COOLDOWN_H * 3600_000).toISOString();
        const { count: recent } = await supabaseAdmin
            .from('oem_agent_finding_events')
            .select('*', { count: 'exact', head: true })
            .eq('finding_id', sheet.findingIds[0]).eq('source', 'agent').gte('created_at', sinceIso);
        if ((recent ?? 0) > 0) return { sent: false, why: `already answered this line in the last ${ANSWER_COOLDOWN_H}h` };
    }

    const subject = `Re: ${r.subject}`.replace(/^(Re:\s*)+/i, 'Re: ');

    // Nothing matched. Say exactly what was looked for — never "please check".
    if (!sheet.text) {
        const body = [
            `I don't have anything on that in what I scan. I looked for ${sheet.searched.length ? sheet.searched.join(' and ') : 'matching purchase orders and open lines'} in this organization's purchase orders and the lines I've raised, and nothing matched.`,
            `If it's about a specific order, its PO number (e.g. PO-26/27-0323) gets me straight to the record.`,
            `— Ira`,
        ].join('\n\n');
        try {
            await sendDigest(r.senderEmail, subject, toHtml(body), { replyTo: cfg.replyTo, inReplyTo: r.messageId });
            return { sent: true, why: 'answered question: no matching evidence', to: r.senderEmail };
        } catch (e) {
            return { sent: false, why: `send failed: ${e instanceof Error ? e.message : e}` };
        }
    }

    const system = systemFor(QA_SYSTEM, await operatorOverlay(orgId, agentKey));
    const user = [
        `THEY ASKED (${r.senderName ?? r.senderEmail}, a general question, not about a specific line):`,
        question || '(no text)',
        '',
        'FACT SHEET (everything you may cite — matching purchase orders and lines):',
        sheet.text,
        '',
        'Answer their question from the fact sheet alone. If the sheet does not settle it, say exactly which piece of evidence is missing and name the record (a PO number) that would. Never quote a figure, date or name that is not above.',
    ].join('\n');

    let draft: string;
    try {
        // agentMessages ADDS the operator's pinned org facts and worked examples
        // when there are any, and returns the identical two-message array this
        // line built by hand when there are none. See context.ts §4.
        draft = await councilChat(agentMessages(system, user, await bakedContext(orgId, agentKey)), 'email');
    } catch (e) {
        return { sent: false, why: `model call failed: ${e instanceof Error ? e.message : e}` };
    }
    const verified = verifyNumbers(draft.trim(), sheet.numbers);
    const body = `${verified.text}\n\n— Ira`;

    try {
        await sendDigest(r.senderEmail, subject, toHtml(body), { replyTo: cfg.replyTo, inReplyTo: r.messageId });
    } catch (e) {
        return { sent: false, why: `send failed: ${e instanceof Error ? e.message : e}` };
    }
    // Record against the line the question named, when it named one — the same
    // audit row the finding branches leave, and what enforces the cooldown.
    if (sheet.findingIds.length) {
        await supabaseAdmin.from('oem_agent_finding_events').insert({
            finding_id: sheet.findingIds[0],
            organization_id: orgId,
            disposition: null,
            note: `[answered question from ${r.senderEmail}]${verified.removed.length ? ` [removed ${verified.removed.length} unverified figure(s)]` : ''}\n${body}`.slice(0, 4000),
            source: 'agent',
            created_by: null,
        });
    }
    return { sent: true, why: 'answered question', to: r.senderEmail, costUsd: councilRunCost().costUsd };
}

/**
 * Answer one reply. Decides whether to answer at all, builds the fact sheet,
 * has the model phrase it, verifies the figures, sends in-thread, records it.
 */
export async function respondToReply(
    orgId: string,
    agentKey: string,
    r: ReplyNeedingAnswer,
    cfg: { enabled: boolean; on: Array<'need_info' | 'blocked'>; replyTo: string | null; openRefs?: string[] },
): Promise<RespondOutcome> {
    if (!cfg.enabled) return { sent: false, why: 'respond is off for this agent' };
    if (r.because !== 'unmatched' && !cfg.on.includes(r.because)) {
        return { sent: false, why: `respond is not enabled for "${r.because}"` };
    }

    // ---- unmatched: ask which line, without a model ------------------------
    if (r.because === 'unmatched' || !r.findingId) {
        // A general QUESTION gets an answer from the book, not the which-line
        // template. Detection is deterministic; anything else falls through.
        if (r.text.trim() && looksLikeQuestion(r.text)) {
            return answerQuestion(orgId, agentKey, r, cfg);
        }
        const refs = (cfg.openRefs ?? []).slice(0, MAX_REFS_LISTED);
        const body = [
            `Thanks — I couldn't tell which line this is about.`,
            refs.length
                // "Open lines addressed to you" was not true: the list handed in
                // is every line still open, for everyone. Nothing stores which
                // finding went to which person, so the copy now says what the
                // list actually is.
                ? `Still open, across all sites:\n${refs.map((x) => `  ${x}`).join('\n')}\n\nReply with the ref at the start (e.g. "${refs[0].split(' ')[0]} done, credit note raised") and I'll file it against that line. A PO number works too.`
                : `Reply with the ref shown on the line (it looks like IRA-XXXXXXXX) at the start of your message and I'll file it against that line. A PO number works too.`,
            `— Ira`,
        ].join('\n\n');
        try {
            await sendDigest(r.senderEmail, `Re: ${r.subject}`.replace(/^(Re:\s*)+/i, 'Re: '), toHtml(body), { replyTo: cfg.replyTo, inReplyTo: r.messageId });
            return { sent: true, why: 'asked which line', to: r.senderEmail };
        } catch (e) {
            return { sent: false, why: `send failed: ${e instanceof Error ? e.message : e}` };
        }
    }

    // ---- cooldown: one answer per person per line per day -------------------
    const sinceIso = new Date(Date.now() - ANSWER_COOLDOWN_H * 3600_000).toISOString();
    const { count: recent } = await supabaseAdmin
        .from('oem_agent_finding_events')
        .select('*', { count: 'exact', head: true })
        .eq('finding_id', r.findingId).eq('source', 'agent').gte('created_at', sinceIso);
    if ((recent ?? 0) > 0) return { sent: false, why: `already answered this line in the last ${ANSWER_COOLDOWN_H}h` };

    // ---- the facts -----------------------------------------------------------
    let { data: f } = await supabaseAdmin
        .from('oem_agent_findings')
        .select('id, finding_key, title, priority, vendor, property, amount, problem, refs, stats, first_seen_at, times_seen')
        .eq('id', r.findingId).maybeSingle();
    if (!f) {
        // Pre-migration deployments have no refs/stats columns; the select errors
        // and returns nothing, which silently meant Ira answered nobody at all.
        ({ data: f } = await supabaseAdmin
            .from('oem_agent_findings')
            .select('id, finding_key, title, priority, vendor, property, amount, problem, first_seen_at, times_seen')
            .eq('id', r.findingId).maybeSingle());
    }
    if (!f) return { sent: false, why: 'finding row not found' };
    const finding = f as unknown as FindingRow;
    const history = await loadFindingHistory(finding.id);
    const sheet = factSheet(orgId, finding, history);
    const ref = replyTag(orgId, agentKey, finding.finding_key);

    // ---- phrase it -----------------------------------------------------------
    const user = [
        `THEY WROTE (${r.senderName ?? r.senderEmail}, marked "${r.because}"):`,
        r.text.trim() || '(no text)',
        '',
        'FACT SHEET:',
        sheet.text,
        '',
        `REF TO QUOTE: ${ref}`,
        '',
        r.because === 'need_info'
            ? 'Answer their question from the fact sheet. Point them at the exact record.'
            : 'They are blocked. Acknowledge what is blocking them in their own words, say the line stays open and will not be re-raised while it is marked blocked, and say what would let them close it.',
    ].join('\n');

    let draft: string;
    try {
        const system = systemFor(SYSTEM, await operatorOverlay(orgId, agentKey));
        // Same additive contract as the question branch above: no examples and no
        // pinned facts means the exact bytes that went out before.
        draft = await councilChat(agentMessages(system, user, await bakedContext(orgId, agentKey)), 'email');
    } catch (e) {
        return { sent: false, why: `model call failed: ${e instanceof Error ? e.message : e}` };
    }
    const verified = verifyNumbers(draft.trim(), sheet.numbers);
    const body = `${verified.text}\n\n— Ira · ref ${ref}`;

    // ---- send in-thread, record, done ----------------------------------------
    try {
        await sendDigest(r.senderEmail, `Re: ${r.subject}`.replace(/^(Re:\s*)+/i, 'Re: '), toHtml(body), { replyTo: cfg.replyTo, inReplyTo: r.messageId });
    } catch (e) {
        return { sent: false, why: `send failed: ${e instanceof Error ? e.message : e}` };
    }
    await supabaseAdmin.from('oem_agent_finding_events').insert({
        finding_id: finding.id,
        organization_id: orgId,
        disposition: null,
        note: `[answered ${r.because} from ${r.senderEmail}]${verified.removed.length ? ` [removed ${verified.removed.length} unverified figure(s)]` : ''}\n${body}`.slice(0, 4000),
        source: 'agent',
        created_by: null,
    });
    return { sent: true, why: `answered ${r.because}`, to: r.senderEmail, costUsd: councilRunCost().costUsd };
}

function toHtml(text: string): string {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#16181C;white-space:pre-wrap">${esc}</div>`;
}
