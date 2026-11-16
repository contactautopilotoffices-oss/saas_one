/**
 * Memory skills (doctrine L7). The same people, buildings and rooms come up again and again, so remembering pays off.
 *
 * - A fact is only ever written through memory_remember, with a key from a CLOSED list; an unknown key is refused
 *   before anything is written [BAA p.101].
 * - A fact is saved only after the person says Yes to a card that shows exactly what will be remembered.
 * - Nothing about other people, HR matters, health, money or credentials is remembered.
 * - Past actions ("episodes") are one line each, written by code when an action runs, and read back only through
 *   memory_recall, so they cost nothing when unused [BAA p.103].
 */
import { z } from 'zod';
import { matchProperty } from '../../catalog';
import { isHrMatter } from '../../interpret';
import { grounded } from '../../pipeline';
import type { Lang } from '../../types';
import { bt, MEMORY_LABELS } from '../text';
import type { ReadSkill, SkillContext, WriteSkill } from '../types';
import { clip, nullableOneOf, oneOf, schema, str } from './common';

export const MEMORY_KEYS = ['default_property', 'usual_location', 'preferred_room', 'preferred_language', 'preferred_name'] as const;
export type MemoryKey = typeof MEMORY_KEYS[number];
const LANGS: Record<string, Lang> = { english: 'en', en: 'en', hindi: 'hi', hi: 'hi', hinglish: 'hinglish' };

const keyLabel = (key: string, lang: Lang) => MEMORY_LABELS[key]?.[lang] ?? key;

const noArgs = z.object({}).strip();

export const memoryShowSkill: ReadSkill<z.infer<typeof noArgs>> = {
    id: 'memory.show', module: 'memory', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'Everything remembered about the person (their saved preferences). Use for "what do you know about me", "what have you remembered". Do NOT use to look up past actions (use memory_recall).',
    input: schema({}),
    args: noArgs,
    examples: ['what do you know about me', 'what have you remembered', 'mere baare mein kya yaad hai'],
    ability: { en: 'show what I remember about you', hi: 'आपके बारे में जो याद है वह दिखाना', hinglish: 'aapke baare mein jo yaad hai woh dikhana' },
    allowed: () => true,
    async run(ctx) {
        if (!ctx.memory.length) return { text: 'Nothing is remembered about this person.', display: bt('memory_none', ctx.lang) };
        const lines = ctx.memory.map(m => `• ${keyLabel(m.key, ctx.lang)}: ${m.label}`);
        return { text: `Remembered:\n${ctx.memory.map(m => `${m.key} = ${m.label}`).join('\n')}`, display: `${bt('memory_head', ctx.lang)}\n${lines.join('\n')}` };
    },
};

const recallArgs = z.object({ query: z.string().trim().min(2).max(200) }).strip();

export const memoryRecallSkill: ReadSkill<z.infer<typeof recallArgs>> = {
    id: 'memory.recall', module: 'memory', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'Search what the person DID through this assistant before (tickets raised, rooms booked, files attached), one line per action with its date. Use ONLY when the person refers to the past ("the ticket I raised last week", "same as last time", "what did I book on Monday"). Do NOT use for current status (read the live record with tickets_list, ticket_status or rooms_my_bookings).',
    input: schema({ query: str('A few keywords for what to look for. Example: "AC ticket".') }),
    args: recallArgs,
    examples: ['what did I raise last week', 'same room as last time', 'pichhli baar kaunsa ticket banaya tha'],
    ability: { en: 'recall what you did earlier', hi: 'पहले क्या किया था वह याद करना', hinglish: 'pehle kya kiya tha woh yaad karna' },
    allowed: () => true,
    async run(ctx, a) {
        const rows = await ctx.data.recallEpisodes(ctx.actor.orgId, ctx.actor.userId, a.query, 6);
        if (!rows.length) return { text: 'Nothing matching was found in this person\'s past actions.' };
        const lines = rows.map(r => `${r.at.slice(0, 10)}: ${clip(r.summary, 160)}`);
        return { text: `Past actions:\n${lines.join('\n')}`, display: lines.map(l => `• ${l}`).join('\n') };
    },
};

const rememberArgs = z.object({ key: z.string().trim().max(40), value: z.string().trim().min(1).max(120) }).strip();
const rememberPayload = z.object({ key: z.enum(MEMORY_KEYS), value: z.string().min(1).max(120), label: z.string().min(1).max(120) }).strict();
type RememberPayload = z.infer<typeof rememberPayload>;

/** Turns what the model passed into a value that may be stored, or says why not. */
function checkFact(ctx: SkillContext, key: MemoryKey, raw: string): { ok: true; value: string; label: string } | { ok: false; problem: string } {
    const value = raw.replace(/\s+/g, ' ').trim();
    if (/\d{6,}/.test(value) || /@/.test(value)) return { ok: false, problem: 'Phone numbers, emails and ids are never remembered. Tell the person so.' };
    if (isHrMatter(value)) return { ok: false, problem: 'HR matters are never remembered. Tell the person so.' };
    if (key === 'default_property') {
        const id = matchProperty(value, ctx.actor.propertyNames, ctx.aliases);
        return id ? { ok: true, value: id, label: ctx.actor.propertyNames[id] } : { ok: false, problem: `"${clip(value, 40)}" is not one of this person's properties: ${Object.values(ctx.actor.propertyNames).slice(0, 12).join(' | ')}.` };
    }
    if (key === 'preferred_language') {
        const lang = LANGS[value.toLowerCase()];
        return lang ? { ok: true, value: lang, label: lang === 'en' ? 'English' : lang === 'hi' ? 'Hindi' : 'Hinglish' } : { ok: false, problem: 'preferred_language must be English, Hindi or Hinglish.' };
    }
    const limit = key === 'preferred_name' ? 40 : 80;
    // The person's own words, not the model's guess about them.
    const own = grounded(value, ctx.userWords);
    if (!own) return { ok: false, problem: 'Only remember what the person said in their own words. Ask them, or leave it.' };
    return { ok: true, value: own.slice(0, limit), label: own.slice(0, limit) };
}

export const memoryRememberSkill: WriteSkill<z.infer<typeof rememberArgs>, RememberPayload> = {
    id: 'memory.remember', module: 'memory', kind: 'write', risk: 1, defaultMode: 'live',
    description: 'Propose remembering ONE lasting preference of the person, so they need not repeat it. Shows a card; saved only if they say Yes. Use when they state a lasting fact about themselves ("I sit on the 3rd floor", "always use the board room for me", "reply in Hindi") or ask you to remember something. Do NOT use for one-off details of the current request, for anything about another person, or for HR, health, money, phone numbers or passwords.',
    input: schema({
        key: oneOf(MEMORY_KEYS, 'Which preference. Only these keys exist. Example: "usual_location".'),
        value: str('The value in the person\'s own words. Example: "3rd floor, cabin 304".'),
    }),
    args: rememberArgs,
    payload: rememberPayload,
    examples: ['remember that I sit on the 3rd floor', 'always reply in Hindi', 'my usual office is Andheri'],
    ability: { en: 'remember your preferences', hi: 'आपकी पसंद याद रखना', hinglish: 'aapki preferences yaad rakhna' },
    allowed: () => true,
    async prepare(ctx, a) {
        // Scope-key rejection: a key outside the closed list is refused before anything is written.
        if (!(MEMORY_KEYS as readonly string[]).includes(a.key)) return { ok: false, problem: `"${clip(a.key, 30)}" is not something that can be remembered. Only: ${MEMORY_KEYS.join(', ')}.` };
        const key = a.key as MemoryKey;
        const fact = checkFact(ctx, key, a.value);
        if (!fact.ok) return fact;
        return { ok: true, payload: { key, value: fact.value, label: fact.label }, card: `${bt('remember_card', ctx.lang, { label: keyLabel(key, ctx.lang), value: fact.label })}\n${bt('confirm_tail', ctx.lang)}`, auditFields: { key } };
    },
    async execute(ctx, p) {
        if (p.key === 'default_property' && !ctx.actor.propertyIds.includes(p.value)) return { ok: false, reply: bt('access_changed', ctx.lang) };
        await ctx.data.saveMemory({ orgId: ctx.actor.orgId, userId: ctx.actor.userId, key: p.key, value: p.value, label: p.label, source: `${ctx.channel} ${ctx.now.toISOString().slice(0, 10)}` });
        return { ok: true, reply: bt('remember_done', ctx.lang) };
    },
};

const forgetArgs = z.object({ key: z.string().trim().max(40).nullish() }).strip();
const forgetPayload = z.object({ key: z.enum(MEMORY_KEYS).nullable() }).strict();

export const memoryForgetSkill: WriteSkill<z.infer<typeof forgetArgs>, z.infer<typeof forgetPayload>> = {
    id: 'memory.forget', module: 'memory', kind: 'write', risk: 1, defaultMode: 'live',
    description: 'Propose forgetting one remembered preference, or all of them. Shows a card; removed only if the person says Yes. Use for "forget that", "forget my floor", "forget everything about me". Do NOT use to delete tickets, bookings or tasks (not possible in chat).',
    input: schema({ key: nullableOneOf(MEMORY_KEYS, 'The preference to forget, or null to forget everything. Example: "usual_location".') }),
    args: forgetArgs,
    payload: forgetPayload,
    examples: ['forget my floor', 'forget everything about me', 'woh bhool jao'],
    ability: { en: 'forget what I remember', hi: 'याद रखी बातें भूलना', hinglish: 'yaad rakhi baatein bhoolna' },
    allowed: () => true,
    async prepare(ctx, a) {
        const key = a.key && (MEMORY_KEYS as readonly string[]).includes(a.key) ? a.key as MemoryKey : null;
        if (a.key && !key) return { ok: false, problem: `"${clip(a.key, 30)}" is not a remembered preference. Keys: ${MEMORY_KEYS.join(', ')}; or pass null to forget everything.` };
        if (!ctx.memory.length || (key && !ctx.memory.some(m => m.key === key))) return { ok: false, problem: 'Nothing like that is remembered about this person. Tell them so.' };
        return { ok: true, payload: { key }, card: `${bt('forget_card', ctx.lang, { what: key ? keyLabel(key, ctx.lang) : bt('everything', ctx.lang) })}\n${bt('confirm_tail', ctx.lang)}`, auditFields: { key: key ?? 'all' } };
    },
    async execute(ctx, p) {
        const count = await ctx.data.forgetMemory(ctx.actor.orgId, ctx.actor.userId, p.key);
        return { ok: true, reply: bt('forget_done', ctx.lang, { count }) };
    },
};

export const MEMORY_SKILLS = [memoryShowSkill, memoryRecallSkill, memoryRememberSkill, memoryForgetSkill] as const;
