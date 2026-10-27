/**
 * Owner 2026-10-26: "Duplicate task alert". Before a task is given, the person's OPEN tasks are checked for one that
 * says the same thing in other words. Deliberately strict (only near-identical wording counts), so the warning stays rare
 * and believable. Pure functions: no database, used by the web tab and the WhatsApp bot alike.
 */

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'with', 'on', 'in', 'at', 'by', 'from', 'about', 'is', 'are', 'be',
    'please', 'pls', 'plz', 'kindly', 'task', 'today', 'tomorrow', 'asap', 'it', 'this', 'that', 'my', 'our', 'your',
]);

/** The meaningful words of a title: lower case, no punctuation, no filler words, a trailing plural "s" dropped. */
export function titleWords(title: string): string[] {
    const words = String(title || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .filter(w => w && !STOP_WORDS.has(w))
        .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
    return Array.from(new Set(words));
}

/**
 * True when two titles describe the same work: the same meaningful words, or at least two of them where nearly all of the
 * shorter title's words appear in the longer one.
 */
export function isSimilarTitle(a: string, b: string): boolean {
    const wa = titleWords(a), wb = titleWords(b);
    if (!wa.length || !wb.length) return false;
    const setB = new Set(wb);
    const shared = wa.filter(w => setB.has(w)).length;
    const union = new Set([...wa, ...wb]).size;
    if (shared === wa.length && shared === wb.length) return true;
    const shorter = Math.min(wa.length, wb.length);
    if (shorter >= 2 && shared / shorter >= 0.8) return true;
    return shared >= 3 && shared / union >= 0.6;
}

/** The open tasks among `open` that look like `title`. */
export function similarOpenTasks<T extends { title: string }>(title: string, open: T[]): T[] {
    return open.filter(t => isSimilarTitle(title, t.title));
}
