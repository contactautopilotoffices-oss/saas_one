import { z } from 'zod';

const text = z.string().max(2000).nullable();
export const turnSchema = z.object({
    intent: z.enum(['details', 'unrelated', 'unclear']),
    fields: z.object({ property: text, room: text, date: text, start: text, end: text, issue: text,
        purpose: z.string().max(500).nullable().default(null) }).strict(),
}).strict();

export const normalizeText = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
export function grounded(value, source) {
    const fragment = normalizeText(value);
    return !!fragment && ` ${normalizeText(source)} `.includes(` ${fragment} `);
}

export function validateTurn(value, workflow, source) {
    const parsed = turnSchema.safeParse(value);
    if (!parsed.success) return { ok: false, reason: 'invalid_output' };
    const { fields, intent } = parsed.data;
    const permitted = workflow === 'booking' ? ['property', 'room', 'date', 'start', 'end', 'purpose'] : ['property', 'issue'];
    for (const [field, value] of Object.entries(fields)) {
        if (value !== null && (!permitted.includes(field) || !grounded(value, source))) return { ok: false, reason: 'ungrounded_output' };
    }
    if (intent !== 'details' && Object.values(fields).some(value => value !== null)) return { ok: false, reason: 'invalid_output' };
    return { ok: true, intent, fields };
}
