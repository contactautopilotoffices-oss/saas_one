/**
 * CLOSE BY REPLYING. No page, no form, no click-through.
 * -----------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN AN IN-EMAIL TEXT BOX
 *
 * A working <textarea> inside an email body requires AMP for Email, which is
 * rendered by Gmail, Yahoo and Mail.ru — and NOT by Zoho Mail. Both worksquare.in
 * and autopilotoffices.com resolve to mx.zoho.com, so every recipient here is on
 * a client that strips <form> outright. An in-body text box is not a design
 * choice we declined; for this team it cannot work.
 *
 * Reply is strictly better anyway. Vidya presses Reply, types a sentence, sends.
 * One action, in the app she already has open, with attachments for free — and
 * it needs no allowlisting, no AMP part, and no new UI.
 *
 * ── MATCHING A REPLY TO A LINE ──────────────────────────────────────────────
 * A SUBJECT TAG, not plus-addressing. Every client prefixes "Re:" and preserves
 * the rest of the subject; not every client, relay or forward preserves a
 * plus-address in Reply-To. The tag is derived deterministically from the finding,
 * so nothing has to be stored to map a reply back, and tomorrow's digest produces
 * the same tag for the same problem.
 */

import { findingEntityId } from './guard';
import { DISPOSITION_SPECS, type Disposition } from './disposition';

/** e.g. "IRA-3F9A2B10". Deterministic; recomputable from the finding alone. */
export function replyTag(orgId: string, agentKey: string, findingKey: string): string {
    return `IRA-${findingEntityId(orgId, agentKey, findingKey).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** Pull the tag out of a subject line, however many Re:/Fwd: are stacked on it. */
export function tagFromSubject(subject: string): string | null {
    const m = subject.match(/\[?\b(IRA-[0-9A-F]{8})\b\]?/i);
    return m ? m[1].toUpperCase() : null;
}

const TAG_RE = /\b(IRA-[0-9A-F]{8})\b/gi;

/**
 * Every ref the person typed, in the order they typed them, deduplicated.
 *
 * WHY THE BODY AND NOT ONLY THE SUBJECT. One digest carries N findings, so one
 * subject line cannot carry N tags; the subject is tagged only when the mail
 * has exactly one line. For everything else the ref is printed on each line
 * and the person quotes it. Pass the STRIPPED body (quoted original removed) —
 * otherwise every ref in the quoted digest matches and we cannot tell which
 * line was actually answered.
 */
export function tagsFromText(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(TAG_RE)) {
        const t = m[1].toUpperCase();
        if (!out.includes(t)) out.push(t);
    }
    return out;
}

/**
 * Split one reply into per-ref segments.
 *
 *     IRA-A1B2C3D4 done, credit note raised.
 *     IRA-E5F6A7B8 not an issue — vendor already refunded.
 *
 * becomes two segments, each parsed on its own. Text before the first ref is
 * attached to the first ref: people write "Hi, IRA-… done" and the greeting
 * must not eat the verdict. A reply with a single ref is one segment: the
 * whole text.
 */
export function segmentsByTag(text: string, tags: ReadonlyArray<string>): Array<{ tag: string; text: string }> {
    if (tags.length <= 1) return tags.map((tag) => ({ tag, text }));
    const positions = tags
        .map((tag) => ({ tag, at: text.toUpperCase().indexOf(tag) }))
        .filter((x) => x.at >= 0)
        .sort((a, b) => a.at - b.at);
    return positions.map((cur, i) => {
        const start = i === 0 ? 0 : cur.at;
        const end = i + 1 < positions.length ? positions[i + 1].at : text.length;
        return { tag: cur.tag, text: text.slice(start, end).trim() };
    });
}

/**
 * Strip the quoted original from a reply, keeping only what the person typed.
 *
 * Deliberately conservative: it cuts at the FIRST recognised quote marker and
 * keeps everything above it. Over-trimming would lose the answer, which is the
 * one thing that must survive.
 */
export function stripQuotedText(body: string): string {
    const text = body
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&(mdash|ndash);/gi, '\u2014')
        .replace(/&(lsquo|rsquo|#39|apos);/gi, "'")
        .replace(/&(ldquo|rdquo|quot);/gi, '"')
        .replace(/&hellip;/gi, '...')
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\r/g, '');

    const markers = [
        /^On .+ wrote:$/im,                    // Gmail / Apple
        /^-{2,}\s*Original Message\s*-{2,}/im, // Outlook
        /^_{5,}$/m,                            // Outlook divider
        /^From:\s.+$/im,                       // forwarded header
        /^>{1,}\s/m,                           // plain-text quoting
        /^Sent by Ira\b/im,                    // our own footer, if bottom-quoted
        /^FMS Procurement\b/im,
    ];

    let cut = text.length;
    for (const re of markers) {
        const m = text.match(re);
        if (m?.index !== undefined && m.index < cut) cut = m.index;
    }

    return text.slice(0, cut).split('\n')
        .map((l) => l.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Read a disposition out of prose, deterministically.
 *
 * Rules first, model never — per docs/IRA_ARCHITECTURE_DECISION.md the AI
 * adjudicates only what rules cannot decide, and this is decidable. Ambiguity is
 * NOT resolved by guessing: an unrecognised reply becomes 'in_progress', which
 * keeps the line open and loses nothing. Silently marking something 'done'
 * because a keyword matched loosely is the one unrecoverable error here.
 */
/**
 * ORDER IS THE ALGORITHM. Terminal, explicit verdicts are tested before weaker
 * status words, because a real reply mixes both:
 *
 *   "Credit note CN/2026/118 received and blocked from the Sep run. Done."
 *
 * "blocked" there describes what was done TO the payment, not the state of the
 * work. Testing 'blocked' first mislabels it — which my own fixtures caught. So
 * 'done' and 'not_an_issue' win, and 'blocked' additionally has to look like a
 * status rather than a verb applied to something else.
 */
const PATTERNS: Array<{ d: Disposition; re: RegExp }> = [
    { d: 'not_an_issue', re: /\b(not an issue|no issue|not an? (duplicate|problem)|false (positive|alarm)|ignore this|nothing wrong|already correct|as expected|by design)\b/i },
    { d: 'done',         re: /\b(done|closed|completed|settled|resolved|recovered|rectified|sorted|credit note (raised|received|obtained|taken)|debit note raised)\b/i },
    { d: 'need_info',    re: /\b(need more|which po|unclear|don'?t understand|what does this mean|more detail|need context|can you clarify)\b/i },
    // Status-like only: sentence-initial, or "is/am/we are blocked" — never
    // "blocked from the payment run", which is an action someone took.
    { d: 'blocked',      re: /(^|[.\n]\s*)(blocked\b|stuck\b|held up\b)|\b(?:is|am|are|still)\s+(blocked|stuck|held up)\b|\bwaiting on\b|\bcannot proceed\b|\bcan'?t proceed\b/i },
    { d: 'in_progress',  re: /\b(working on|in progress|looking into|checking|verifying|will do|picked up|on it|taking this up)\b/i },
];

export interface ParsedReply {
    disposition: Disposition;
    note: string;
    /** True when no rule matched and we defaulted. Surfaced, never hidden. */
    inferred: boolean;
}

export function parseReply(rawBody: string): ParsedReply {
    const note = stripQuotedText(rawBody);
    for (const { d, re } of PATTERNS) {
        if (re.test(note)) return { disposition: d, note, inferred: false };
    }
    // Someone replied with context but no verdict. Keep the words, keep the line
    // open, stop escalating. Never invent a closure.
    return { disposition: 'in_progress', note, inferred: true };
}

/** Does this disposition need words the reply did not supply? */
export function replyIsSufficient(p: ParsedReply): boolean {
    return !(DISPOSITION_SPECS[p.disposition].requiresNote && !p.note.trim());
}

/** The subject line a digest sends, so the reply can be matched on the way back. */
export function taggedSubject(base: string, tag: string): string {
    return `[${tag}] ${base}`;
}
