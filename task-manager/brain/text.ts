/** The language brain — small pure text helpers (no I/O). */

export const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[n];
}

/** 0..1 — 1 means identical (after normalising). Used for typo-tolerant name matching. */
export function similarity(a: string, b: string): number {
    const x = norm(a), y = norm(b);
    if (!x && !y) return 1;
    return 1 - levenshtein(x, y) / Math.max(x.length, y.length, 1);
}

const STOP = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'about', 'into', 'onto', 'have', 'has', 'had', 'will', 'would', 'should',
    'need', 'needs', 'task', 'tasks', 'work', 'please', 'pls', 'also', 'then', 'what', 'when', 'where', 'which', 'there', 'their',
    'them', 'they', 'want', 'wants', 'make', 'sure', 'get', 'got', 'give', 'assign', 'its', 'are', 'was', 'were', 'been', 'being',
    'one', 'two', 'new', 'all', 'any', 'can', 'could', 'may', 'might', 'must', 'shall', 'out', 'off', 'per', 'via', 'our', 'your', 'his', 'her',
]);

/** Meaningful words (3+ letters, not filler), lower-cased. */
export function contentWords(s: string): string[] {
    return norm(s).split(' ').filter(w => w.length > 2 && !STOP.has(w));
}

/**
 * Is this wording really drawn from the message? A word counts when it (or a near-spelling of it) appears in the
 * message. At least `min` of the wording's meaningful words must. Stops the AI inventing task titles or notes.
 */
export function isGrounded(wording: string, message: string, min = 0.6): boolean {
    const mine = contentWords(wording);
    if (mine.length === 0) return true;
    const theirs = contentWords(message);
    const hit = mine.filter(w => theirs.some(t => t === w || (w.length > 3 && t.length > 3 && similarity(w, t) >= 0.8) || t.includes(w) || w.includes(t))).length;
    return hit / mine.length >= (mine.length === 1 ? 1 : min);
}

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function addDays(iso: string, days: number): string {
    return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayOf = (iso: string): string => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Thu, 8 Oct" — built by hand (Intl abbreviates months differently across runtimes). */
export function dayLabel(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export const clip = (s: unknown, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Carry-forward tasks and today's tasks under their own headings (owner 2026-10-14). Lines keep their real numbers, so
 * "done 3" still means the same task. With nothing carried over the list is exactly as before (no headings).
 */
export const CARRY_HEADING = '🔄 *Carry forward tasks*';
export const TODAY_HEADING = "📋 *Today's tasks*";
export function headedList(items: Array<{ carried: boolean; line: string }>): string {
    const carried = items.filter(i => i.carried).map(i => i.line), today = items.filter(i => !i.carried).map(i => i.line);
    if (!carried.length) return today.join('\n');
    return [CARRY_HEADING, ...carried, ...(today.length ? ['', TODAY_HEADING, ...today] : [])].join('\n');
}

/** The same grouping on ONE line, for approved templates (no line breaks allowed): "Carry forward: 1. A | 2. B — Today: 3. C".
 *  Cut at `max` characters with "…and N more". */
export function headedOneLine(input: Array<{ carried: boolean; line: string }>, max = 700): string {
    const items = [...input.filter(i => i.carried), ...input.filter(i => !i.carried)];   // carried first, like headedList
    const grouped = items.some(i => i.carried);
    let out = '';
    for (let i = 0; i < items.length; i++) {
        const label = !grouped ? '' : i === 0 ? (items[0].carried ? 'Carry forward: ' : 'Today: ') : (!items[i].carried && items[i - 1].carried ? 'Today: ' : '');
        const sep = i === 0 ? '' : label ? ' — ' : ' | ';
        const next = `${out}${sep}${label}${items[i].line}`;
        if (next.length > max) return `${out} | …and ${items.length - i} more`;
        out = next;
    }
    return out;
}

/**
 * Three sections (owner 2026-10-16): 🔄 Carry forward (older tasks still open) → ⏳ Pending today → ✅ Completed (today's and
 * carried-forward tasks finished today). Used by the "tasks" reply and the midday check-in so they always look the same.
 * Lines keep their real numbers ("done 3" still means the same task); each section keeps the list order; an empty section
 * is left out. An in-progress task (🔄) still counts as pending.
 */
export const SECTION_CARRY = '🔄 *Carry forward*';
export const SECTION_PENDING = '⏳ *Pending today*';
export const SECTION_DONE = '✅ *Completed*';
export type SectionItem = { carried: boolean; done: boolean; line: string };
function splitSections(items: SectionItem[]) {
    return {
        carry: items.filter(i => i.carried && !i.done).map(i => i.line),
        pending: items.filter(i => !i.carried && !i.done).map(i => i.line),
        done: items.filter(i => i.done).map(i => i.line),
    };
}
export function sectionedList(items: SectionItem[]): string {
    const s = splitSections(items);
    const blocks: string[] = [];
    if (s.carry.length) blocks.push([`${SECTION_CARRY} (${s.carry.length})`, ...s.carry].join('\n'));
    if (s.pending.length) blocks.push([`${SECTION_PENDING} (${s.pending.length})`, ...s.pending].join('\n'));
    if (s.done.length) blocks.push([`${SECTION_DONE} (${s.done.length})`, ...s.done].join('\n'));
    return blocks.join('\n\n');
}

/** The same three sections on ONE line, for approved templates (no line breaks allowed):
 *  "Carry forward: 1. A ⏳ | 2. B 🔄 — Pending today: 4. C ⏳ — Completed: 3. D ✅". Cut at `max` with "…and N more". */
export function sectionedOneLine(items: SectionItem[], max = 700): string {
    const s = splitSections(items);
    const ordered = [
        ...s.carry.map((line, i) => ({ label: i === 0 ? 'Carry forward: ' : '', line })),
        ...s.pending.map((line, i) => ({ label: i === 0 ? 'Pending today: ' : '', line })),
        ...s.done.map((line, i) => ({ label: i === 0 ? 'Completed: ' : '', line })),
    ];
    let out = '';
    for (let i = 0; i < ordered.length; i++) {
        const sep = i === 0 ? '' : ordered[i].label ? ' — ' : ' | ';
        const next = `${out}${sep}${ordered[i].label}${ordered[i].line}`;
        if (next.length > max) return `${out} | …and ${ordered.length - i} more`;
        out = next;
    }
    return out;
}

/**
 * A placeholder value that must sit on its own line(s) in a reply (owner 2026-10-14: every reply structured): a list, a
 * bullet, a numbered line, a status line, or a "Reply …" hint. Short values (a name, a date, a count) stay inside the sentence.
 */
export function isBlockValue(value: string): boolean {
    const v = String(value ?? '').trim();
    return v.includes('\n') || /^(?:[•\-]\s|\d+\.\s|✅|⚠️|🔄|📋|Reply\b|\*Reply)/u.test(v);
}
