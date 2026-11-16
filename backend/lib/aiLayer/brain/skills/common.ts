/**
 * Helpers shared by the skills. Pure.
 */
import { matchProperty, suggestProperties } from '../../catalog';
import { istDate } from '../../dates';
import type { AttachmentRef, JsonSchema, SkillContext } from '../types';

/** Other people's words (ticket titles, task titles) are data: one line, cut short, links removed, quoted. */
export function quote(s: string | null | undefined, n = 70): string {
    const one = String(s ?? '').replace(/\s+/g, ' ').replace(/https?:\/\/\S+/gi, '[link]').replace(/"/g, "'").trim();
    return `"${one.length > n ? `${one.slice(0, n - 1)}…` : one}"`;
}

export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A strict tool schema: every property required, no extras. Optional values are written as nullable. */
export function schema(properties: Record<string, JsonSchema>): JsonSchema {
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
export const str = (description: string): JsonSchema => ({ type: 'string', description });
export const nullableStr = (description: string): JsonSchema => ({ type: ['string', 'null'], description });
export const oneOf = (values: readonly string[], description: string): JsonSchema => ({ type: 'string', enum: [...values], description });
/** Written as anyOf: strict mode refuses an enum whose values do not all match one declared type. */
export const nullableOneOf = (values: readonly string[], description: string): JsonSchema => ({ anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }], description });
export const bool = (description: string): JsonSchema => ({ type: 'boolean', description });

export type PropertyPick = { ok: true; propertyId: string } | { ok: false; problem: string };

/**
 * The one building a request is about. A name the person gave must match one of THEIR buildings; with no name, the
 * person's only building, else their remembered usual property, else the model is told to ask (with the choices).
 */
export function pickProperty(ctx: SkillContext, name: string | null | undefined): PropertyPick {
    const { actor, aliases } = ctx;
    const names = actor.propertyNames;
    const choices = () => actor.propertyIds.slice(0, 12).map(id => names[id]).join(' | ');
    if (name && name.trim()) {
        const id = matchProperty(name, names, aliases);
        if (id) return { ok: true, propertyId: id };
        const near = suggestProperties(name, names, aliases).map(pid => names[pid]);
        return { ok: false, problem: near.length
            ? `No single property of this person matches "${clip(name, 40)}". Call ask_user with the question "Which property?" and these options: ${near.join(' | ')}`
            : `"${clip(name, 40)}" is not a property this person has access to. Their properties: ${choices()}. Say so, and call ask_user if they need to choose.` };
    }
    if (actor.propertyIds.length === 1) return { ok: true, propertyId: actor.propertyIds[0] };
    const remembered = ctx.memory.find(m => m.key === 'default_property')?.value;
    if (remembered && actor.propertyIds.includes(remembered)) return { ok: true, propertyId: remembered };
    return { ok: false, problem: `MISSING property. Call ask_user with the question "Which property?" and these options: ${choices()}` };
}

/** Several buildings for a read: the named one, or all of the person's. */
export function scopeProperties(ctx: SkillContext, name: string | null | undefined): { ok: true; propertyIds: string[] } | { ok: false; problem: string } {
    if (!name || !name.trim()) return { ok: true, propertyIds: ctx.actor.propertyIds };
    const one = pickProperty(ctx, name);
    return one.ok ? { ok: true, propertyIds: [one.propertyId] } : one;
}

/** The open attachment a write refers to: the handle given, or the only open one when none was named. */
export function pickAttachment(ctx: SkillContext, handle: string | null | undefined, kinds: Array<AttachmentRef['kind']>): { ok: true; attachment: AttachmentRef } | { ok: false; problem: string } {
    const open = ctx.attachments.filter(a => kinds.includes(a.kind));
    if (handle && handle.trim()) {
        const hit = open.find(a => a.handle.toLowerCase() === handle.trim().toLowerCase());
        return hit ? { ok: true, attachment: hit } : { ok: false, problem: `${handle} is not an open ${kinds.join('/')} from this person. Open files: ${open.map(a => a.handle).join(', ') || 'none'}. If there is none, ask them to send it.` };
    }
    if (open.length === 1) return { ok: true, attachment: open[0] };
    return { ok: false, problem: open.length ? `Several files are open (${open.map(a => a.handle).join(', ')}). Pass the handle of the one to use.` : 'The person has not sent a file. Ask them to send it.' };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A booking window the model proposed: a real date from today to 60 days ahead (India time), start before end. */
export function checkWindow(now: Date, date: string, start: string, end: string): string | null {
    if (!DAY.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return 'date must be YYYY-MM-DD';
    if (!TIME.test(start) || !TIME.test(end)) return 'start_time and end_time must be HH:MM in 24-hour time';
    if (end <= start) return 'end_time must be after start_time';
    const today = istDate(now);
    if (date < today) return `that date is in the past (today is ${today})`;
    const limit = istDate(new Date(now.getTime() + 60 * 86_400_000));
    if (date > limit) return 'bookings can be made up to 60 days ahead';
    if (date === today) {
        const nowHm = new Date(now.getTime() + 330 * 60_000).toISOString().slice(11, 16);
        if (start <= nowHm) return `that start time has already passed (it is ${nowHm} now)`;
    }
    return null;
}

/** "2026-11-14" → "Sat 14 Nov". */
export function dayLabel(date: string): string {
    const d = new Date(`${date}T00:00:00Z`);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}
