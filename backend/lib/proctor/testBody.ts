import { type ProctorQuestion, type ProctorSection } from '@/backend/lib/proctor/access';

/**
 * Reads and checks a test as the builder sends it, for both creating and
 * editing. Returns the columns to write, or the first problem found.
 *
 * Body: { title, instructions?, duration_minutes, max_attempts?, look_away_strikes?,
 *         ai_monitoring?, shuffle?, sections?: [{ key, title, description }],
 *         questions: [{ section?, text, options[], answer_index }] }
 */
export function parseTestBody(body: Record<string, unknown>) {
    const title = String(body.title || '').trim();
    if (!title) return { error: 'Title is required' };

    const duration = Number(body.duration_minutes) || 15;
    if (duration < 1 || duration > 180) return { error: 'Duration must be 1–180 minutes' };

    const maxAttempts = body.max_attempts === undefined ? 2 : Number(body.max_attempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) return { error: 'Chances must be 1–5' };

    const strikes = body.look_away_strikes === undefined ? 3 : Number(body.look_away_strikes);
    if (!Number.isInteger(strikes) || strikes < 1 || strikes > 20) return { error: 'Camera warnings must be 1–20' };

    const sections: ProctorSection[] = (Array.isArray(body.sections) ? body.sections : [])
        .filter((s: { key?: unknown }) => typeof s?.key === 'string' && s.key.trim())
        .map((s: { key: string; title?: unknown; description?: unknown }) => ({
            key: s.key.trim(),
            title: String(s.title || '').trim(),
            description: String(s.description || '').trim(),
        }));

    const sectionKeys = new Set<string>([...sections.map((s) => s.key), 'general']);
    const raw = Array.isArray(body.questions) ? body.questions : [];
    const questions: ProctorQuestion[] = [];
    for (const [i, q] of raw.entries()) {
        const text = String(q?.text || '').trim();
        const options = (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => String(o || '').trim()).filter(Boolean);
        const section = sectionKeys.has(String(q?.section)) ? String(q.section) : 'general';
        if (!text) return { error: `Question ${i + 1} has no text` };
        if (options.length < 2) return { error: `Question ${i + 1} needs at least two options` };
        const valid = (n: unknown) => Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) < options.length;
        if (q?.multi === true) {
            // "Select all that apply": one or more correct options, scored all or nothing.
            const answers: number[] = [...new Set<number>((Array.isArray(q.answer_indexes) ? q.answer_indexes as unknown[] : []).filter(valid).map(Number))].sort((a, b) => a - b);
            if (!answers.length) return { error: `Question ${i + 1} needs at least one correct option ticked` };
            questions.push({ id: `q${i + 1}`, section, text, options, answer_index: answers[0], multi: true, answer_indexes: answers });
            continue;
        }
        const answer = Number(q?.answer_index);
        if (!valid(answer)) return { error: `Question ${i + 1} needs a correct option marked` };
        questions.push({ id: `q${i + 1}`, section, text, options, answer_index: answer });
    }
    if (questions.length === 0) return { error: 'Add at least one question' };

    return {
        fields: {
            title,
            instructions: String(body.instructions || '').trim() || null,
            duration_minutes: duration,
            max_attempts: maxAttempts,
            look_away_strikes: strikes,
            sections,
            ai_monitoring: body.ai_monitoring !== false,
            shuffle: body.shuffle !== false,
            questions,
        },
    };
}
