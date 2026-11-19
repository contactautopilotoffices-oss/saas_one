/**
 * Ticket sorting: how well does the AI learn from the Tech team's judgements? (owner 2026-11-19: "with corrections, it
 * must improve the classification accuracy and confidence"). Phase 0 of that plan: measure today before changing it.
 *
 * Pure helpers, no database and no model: scripts/tickets/learning_baseline.ts reads the data and prints the numbers,
 * and the later phases (finding similar past tickets, measured confidence) reuse wordsOf / similarity.
 *
 *   similarity       how alike two tickets' words are, 0 to 1 (shared words / all words). Works for English, Hindi and
 *                    Hinglish because it only compares words; it is the fallback when the similar-text service is down.
 *   calibration      "when the AI said 90%, how often was it right?", per band of confidence.
 *   repeatMistakes   tickets judged wrong although an earlier, similar ticket had already been corrected to the same
 *                    category: the memory existed and the AI still made the mistake. Also says whether that earlier
 *                    correction was among the newest MAX_CORRECTIONS the AI was shown at the time.
 *   contradictions   near-identical tickets corrected to different categories: the examples disagree, a person settles it.
 */

/** Words that say nothing about the problem. Kept short on purpose: most words in a ticket matter. */
const STOP = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'in', 'on', 'at', 'of', 'to', 'for', 'and', 'or', 'it', 'this',
    'that', 'please', 'pls', 'plz', 'kindly', 'sir', 'madam', 'hi', 'hello', 'team', 'not', 'no', 'with', 'from', 'my',
    'our', 'we', 'i', 'me', 'us', 'has', 'have', 'there', 'some', 'very', 'also',
    'hai', 'he', 'hain', 'ho', 'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'bhi', 'nahi', 'raha', 'rahi', 'rahe', 'kar',
    'karo', 'karna', 'diya', 'gaya', 'gayi', 'ek', 'yeh', 'ye', 'woh', 'wo', 'aur', 'ya', 'koi', 'kuch', 'abhi',
]);
/** What the masking leaves in the text ("[phone]", "@[person]"): not words of the problem. */
const MASKED = /@?\[(?:phone|email|id|person)\]/gi;

/** The words of a ticket that can tell one problem from another: lower case, letters and digits, no filler words. */
export function wordsOf(text: string): Set<string> {
    const out = new Set<string>();
    for (const raw of String(text ?? '').replace(MASKED, ' ').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        const w = raw.trim();
        if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
        out.add(w);
    }
    return out;
}

/** Shared words / all words of the two tickets (0 = nothing in common, 1 = the same words). */
export function similarity(a: string | Set<string>, b: string | Set<string>): number {
    const x = typeof a === 'string' ? wordsOf(a) : a;
    const y = typeof b === 'string' ? wordsOf(b) : b;
    if (!x.size || !y.size) return 0;
    let shared = 0;
    for (const w of x) if (y.has(w)) shared++;
    return shared / (x.size + y.size - shared);
}

/** From here two tickets count as "similar" in these numbers. */
export const SIMILAR = 0.5;
/** From here two tickets count as "near-identical" (contradiction check). */
export const NEAR_SAME = 0.8;

// ── confidence honesty ──────────────────────────────────────────────────────────────────────────────────────────────

/** The bands the confidence is reported in. 85 is where a sorting stops going to Review. */
export const BANDS: ReadonlyArray<readonly [number, number]> = [[0, 59], [60, 69], [70, 79], [80, 84], [85, 89], [90, 94], [95, 100]];

export interface BandRow { band: string; tickets: number; saidAvg: number; actuallyRight: number | null; gap: number | null }

export interface Calibration {
    bands: BandRow[];
    tickets: number;
    right: number;
    /** right / tickets, in percent. */
    accuracy: number | null;
    /** Average distance between what was said and what happened, weighted by tickets (lower is more honest). */
    averageGap: number | null;
    /** Wrong although rated High (85+): these skip Review, so nobody sees the mistake. */
    wrongButHigh: number;
    /** Rated below High: these go to the Review queue. */
    toReview: number;
}

const round = (n: number) => Math.round(n);

/** Groups sortings by the confidence that was given and says how often each group was really right. */
export function calibration(items: ReadonlyArray<{ confidence: number; right: boolean }>, high = 85): Calibration {
    const bands: BandRow[] = BANDS.map(([lo, hi]) => {
        const inBand = items.filter(i => i.confidence >= lo && i.confidence <= hi);
        const ok = inBand.filter(i => i.right).length;
        const said = inBand.length ? inBand.reduce((s, i) => s + i.confidence, 0) / inBand.length : 0;
        const actual = inBand.length ? (100 * ok) / inBand.length : null;
        return { band: `${lo}-${hi}%`, tickets: inBand.length, saidAvg: round(said), actuallyRight: actual === null ? null : round(actual), gap: actual === null ? null : round(said - actual) };
    });
    const right = items.filter(i => i.right).length;
    const counted = bands.filter(b => b.tickets);
    const total = counted.reduce((s, b) => s + b.tickets, 0);
    return {
        bands,
        tickets: items.length,
        right,
        accuracy: items.length ? round((100 * right) / items.length) : null,
        averageGap: total ? round(counted.reduce((s, b) => s + Math.abs(b.gap ?? 0) * b.tickets, 0) / total) : null,
        wrongButHigh: items.filter(i => !i.right && i.confidence >= high).length,
        toReview: items.filter(i => i.confidence < high).length,
    };
}

// ── memory that did not help ────────────────────────────────────────────────────────────────────────────────────────

/** One judgement, as stored in ticket_sort_reviews (only the fields these numbers need). */
export interface Judgement { org: string; at: string; text: string; verdict: 'right' | 'wrong'; chosen: string | null; right: string | null }

export interface RepeatMistake {
    text: string;
    /** What the AI chose this time, and what was right (the same as the earlier correction). */
    chosen: string | null;
    right: string;
    /** The earlier similar correction. */
    earlierText: string;
    similarity: number;
    /** Was the earlier correction among the newest `shown` corrections of the organisation when this ticket came in? */
    wasShown: boolean;
}

/**
 * Wrong judgements where an earlier correction of the same organisation, to the same right category, was for a similar
 * ticket. `shown` is how many of the newest corrections the AI is shown (MAX_CORRECTIONS).
 */
export function repeatMistakes(all: readonly Judgement[], shown: number, min = SIMILAR): RepeatMistake[] {
    const wrong = all.filter(j => j.verdict === 'wrong' && j.right).sort((a, b) => a.at.localeCompare(b.at));
    const out: RepeatMistake[] = [];
    wrong.forEach((j, i) => {
        const before = wrong.slice(0, i).filter(e => e.org === j.org && e.at < j.at);
        const words = wordsOf(j.text);
        let best: { e: Judgement; s: number } | null = null;
        for (const e of before) {
            if (e.right !== j.right) continue;
            const s = similarity(words, wordsOf(e.text));
            if (s >= min && (!best || s > best.s)) best = { e, s };
        }
        if (!best) return;
        const newest = before.slice(-shown);
        out.push({ text: j.text, chosen: j.chosen, right: j.right!, earlierText: best.e.text, similarity: Math.round(best.s * 100) / 100, wasShown: newest.includes(best.e) });
    });
    return out;
}

export interface Contradiction { a: string; aCode: string; b: string; bCode: string; similarity: number }

/** Near-identical tickets of one organisation whose corrections point to different categories. */
export function contradictions(all: readonly Judgement[], min = NEAR_SAME): Contradiction[] {
    // A "right" judgement is a confirmed answer too: the category it kept.
    const answers = all
        .map(j => ({ org: j.org, text: j.text, code: j.verdict === 'wrong' ? j.right : j.chosen, words: wordsOf(j.text) }))
        .filter((x): x is { org: string; text: string; code: string; words: Set<string> } => !!x.code && x.words.size > 0);
    const out: Contradiction[] = [];
    for (let i = 0; i < answers.length; i++) {
        for (let k = i + 1; k < answers.length; k++) {
            const a = answers[i], b = answers[k];
            if (a.org !== b.org || a.code === b.code) continue;
            const s = similarity(a.words, b.words);
            if (s >= min) out.push({ a: a.text, aCode: a.code, b: b.text, bCode: b.code, similarity: Math.round(s * 100) / 100 });
        }
    }
    return out;
}
