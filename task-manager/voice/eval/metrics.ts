/** Voice Note Intake — Phase 5: pure scoring helpers (no I/O). */

export const hasDevanagari = (s: string): boolean => /[ऀ-ॿ]/.test(s);

/** Lower case, "45,000" → "45000", "5PM" → "5 pm", punctuation dropped, spaces collapsed. Devanagari letters are kept. */
export function normalizeForCompare(s: string): string {
    return String(s ?? '').toLowerCase()
        .replace(/(\d),(?=\d{2,3}\b)/g, '$1')
        .replace(/(\d)([a-zऀ-ॿ])/g, '$1 $2').replace(/([a-zऀ-ॿ])(\d)/g, '$1 $2')
        .replace(/[^a-z0-9ऀ-ॿ\s]+/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

/** The truth without the fillers the tidy-up is meant to drop. */
export function stripFillers(truth: string, fillers: readonly string[]): string {
    let t = normalizeForCompare(truth);
    for (const f of fillers) t = t.replace(new RegExp(`(^| )${f}(?= |$)`, 'g'), ' ');
    return t.replace(/\s+/g, ' ').trim();
}

function editDistance<T>(a: readonly T[], b: readonly T[]): number {
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

/** Word error rate against an already-normalised reference (0 = perfect; can exceed 1). */
export function wer(reference: string, hypothesis: string): number {
    const r = normalizeForCompare(reference).split(' ').filter(Boolean);
    const h = normalizeForCompare(hypothesis).split(' ').filter(Boolean);
    return r.length ? editDistance(r, h) / r.length : (h.length ? 1 : 0);
}

/**
 * Character error rate with spaces removed, so Hinglish spelling splits ("kar do" vs "kardo") are not counted as
 * whole-word errors the way WER counts them.
 */
export function cerNoSpaces(reference: string, hypothesis: string): number {
    const r = [...normalizeForCompare(reference).replace(/ /g, '')];
    const h = [...normalizeForCompare(hypothesis).replace(/ /g, '')];
    return r.length ? editDistance(r, h) / r.length : (h.length ? 1 : 0);
}

/** One key detail is kept when ANY of its "a|b" spellings appears as whole words (a plural s / es is allowed). */
export function keepsDetail(text: string, detail: string): boolean {
    const t = ` ${normalizeForCompare(text)} `;
    return detail.split('|').some(alt => {
        const a = normalizeForCompare(alt).replace(/[.*+?^${}()[\]\\]/g, '\\$&');
        return new RegExp(` ${a}(s|es)? `).test(t);
    });
}

export function keyRecall(text: string, mustKeep: readonly string[]): { kept: number; total: number; missing: string[] } {
    const missing = mustKeep.filter(d => !keepsDetail(text, d));
    return { kept: mustKeep.length - missing.length, total: mustKeep.length, missing };
}

export const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
export const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
