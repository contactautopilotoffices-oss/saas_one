import { resolveSections, type ProctorQuestion } from '@/backend/lib/proctor/access';

/**
 * The order an attempt shows its questions and options in.
 *
 * Sections always appear in the author's order. With shuffle on, questions are
 * shuffled within each section and every question's options are shuffled too.
 * The order is stored on the attempt, so a resumed attempt looks the same and
 * the page's answers (indexes into the options as shown) map back to the
 * original option index the answer key uses. Answers are always stored against
 * the original index.
 */

export type QuestionOrder = Array<{ id: string; options: number[] }>;

function shuffled<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

export function buildOrder(questions: ProctorQuestion[], storedSections: unknown, shuffle: boolean): QuestionOrder {
    const order: QuestionOrder = [];
    for (const section of resolveSections(storedSections, questions)) {
        const inSection = questions.filter((q) => (q.section || 'general') === section.key);
        for (const q of shuffle ? shuffled(inSection) : inSection) {
            const idx = q.options.map((_, i) => i);
            order.push({ id: q.id, options: shuffle ? shuffled(idx) : idx });
        }
    }
    return order;
}

/** An attempt from before shuffling existed: the questions as authored. */
function orderOrDefault(questions: ProctorQuestion[], order: unknown): QuestionOrder {
    if (Array.isArray(order) && order.length) return order as QuestionOrder;
    return questions.map((q) => ({ id: q.id, options: q.options.map((_, i) => i) }));
}

/** What the taker sees: questions in this attempt's order, options as shown, no answer key. */
export function presentQuestions(questions: ProctorQuestion[], order: unknown) {
    const byId = new Map(questions.map((q) => [q.id, q]));
    return orderOrDefault(questions, order)
        .map(({ id, options }) => {
            const q = byId.get(id);
            if (!q) return null;
            return { id: q.id, section: q.section || 'general', text: q.text, options: options.map((i) => q.options[i]) };
        })
        .filter(Boolean) as Array<{ id: string; section: string; text: string; options: string[] }>;
}

/** The page's answers (shown index) → stored answers (original index). Invalid picks are dropped. */
export function toOriginalAnswers(questions: ProctorQuestion[], order: unknown, given: Record<string, unknown>) {
    const map = new Map(orderOrDefault(questions, order).map((o) => [o.id, o.options]));
    const out: Record<string, number> = {};
    for (const q of questions) {
        const shown = Number(given[q.id]);
        const options = map.get(q.id);
        if (!options || !Number.isInteger(shown) || shown < 0 || shown >= options.length) continue;
        const original = options[shown];
        if (Number.isInteger(original) && original >= 0 && original < q.options.length) out[q.id] = original;
    }
    return out;
}

/** Stored answers (original index) → the page's answers (shown index), for a resumed attempt. */
export function toShownAnswers(questions: ProctorQuestion[], order: unknown, stored: Record<string, unknown>) {
    const map = new Map(orderOrDefault(questions, order).map((o) => [o.id, o.options]));
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(stored || {})) {
        const shown = map.get(id)?.indexOf(Number(value)) ?? -1;
        if (shown >= 0) out[id] = shown;
    }
    return out;
}
