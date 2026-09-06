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
 *   unmatched   — the reply carried no ref. Ask which line, list the open refs
 *                 addressed to them in the last digest so they can copy one.
 *
 * WHAT IT NEVER DOES
 *   - invent a number: every figure in the reply is copied from the finding
 *     row or its refs, never produced by the model. The model is handed the
 *     facts and asked to phrase them. [BAA p.94]
 *   - close, reopen or change a line. It reads and it writes prose. The
 *     disposition loop is human-only.
 *   - reply twice to the same person on the same line in 24h. A model that
 *     answers its own answers is how a mailbox fills with an agent talking to
 *     itself; the guard is an event row with source 'agent'.
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
import { replyTag } from './reply';
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

/**
 * Answer one reply. Decides whether to answer at all, builds the fact sheet,
 * has the model phrase it, verifies the figures, sends in-thread, records it.
 */
export async function respondToReply(
    orgId: string,
    agentKey: string,
    r: ReplyNeedingAnswer,
    cfg: { enabled: boolean; on: Array<'need_info' | 'blocked'>; replyTo: string | null; openRefsForSender?: string[] },
): Promise<RespondOutcome> {
    if (!cfg.enabled) return { sent: false, why: 'respond is off for this agent' };
    if (r.because !== 'unmatched' && !cfg.on.includes(r.because)) {
        return { sent: false, why: `respond is not enabled for "${r.because}"` };
    }

    // ---- unmatched: ask which line, without a model ------------------------
    if (r.because === 'unmatched' || !r.findingId) {
        const refs = cfg.openRefsForSender ?? [];
        const body = [
            `Thanks — I couldn't tell which line this is about.`,
            refs.length
                ? `Open lines addressed to you right now:\n${refs.map((x) => `  ${x}`).join('\n')}\n\nReply with the ref at the start (e.g. "${refs[0]} done, credit note raised") and I'll file it against that line.`
                : `Reply with the ref shown on the line (it looks like IRA-XXXXXXXX) at the start of your message and I'll file it against that line.`,
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
    const { data: f } = await supabaseAdmin
        .from('oem_agent_findings')
        .select('id, finding_key, title, priority, vendor, property, amount, problem, refs, stats, first_seen_at, times_seen')
        .eq('id', r.findingId).maybeSingle();
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
        draft = await councilChat([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], 'email');
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
