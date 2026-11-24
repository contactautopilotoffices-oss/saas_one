/**
 * The person's own properties (2026-11-18). The owner's chat: "Show those 22 properties" failed twice, because the
 * context names only the first 15 properties and the model had no way to read the rest, so any list it wrote could
 * not pass the grounding check. This skill reads the same access list the context is built from (ActorContext, loaded
 * fresh for every turn): no database query, nothing the person cannot already see.
 */
import { z } from 'zod';
import type { ReadSkill } from '../types';
import { nullableStr, schema } from './common';

const args = z.object({ search: z.string().trim().max(80).nullish() }).strip();

const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const propertiesMineSkill: ReadSkill<z.infer<typeof args>> = {
    id: 'properties.mine', module: 'tickets', kind: 'read', risk: 0, defaultMode: 'live',
    description: 'Every property this person can access, with its other names, and how many there are. Use for "which properties do I have access to", "show all my properties", "is Rabale one of mine", and before telling the person a property name that is not listed in the context. Give a word in search to find one property; null lists them all. Do NOT use for tickets, rooms or anything inside a property.',
    input: schema({ search: nullableStr('Part of a property name as the person said it, or null for all. Example: "Rabale".') }),
    args,
    examples: ['which properties access i have', 'meri kaun kaun si properties hain', 'is SS Plaza in my list'],
    ability: { en: 'see my properties', hi: 'मेरी प्रॉपर्टी देखना', hinglish: 'meri properties dekhna' },
    allowed: actor => actor.propertyIds.length > 0,
    async run(ctx, a) {
        const all = ctx.actor.propertyIds.map(id => ({ id, name: ctx.actor.propertyNames[id] ?? '', aka: ctx.aliases[id] ?? [] })).filter(p => p.name);
        const want = a.search ? norm(a.search) : '';
        const rows = want ? all.filter(p => [p.name, ...p.aka].some(n => norm(n).includes(want))) : all;
        const line = (p: typeof all[number]) => `• ${p.name}${p.aka.length ? ` (also called ${p.aka.join(', ')})` : ''}`;
        if (!rows.length) {
            return {
                text: `None of this person's ${all.length} properties matches "${a.search}". Their properties: ${all.map(p => p.name).join(' | ')}.`,
                display: ctx.lang === 'en' ? `None of your properties matches "${a.search}".` : `Aapki kisi property ka naam "${a.search}" se match nahi hua.`,
            };
        }
        const head = want
            ? (ctx.lang === 'en' ? `Matching properties (${rows.length} of ${all.length}):` : `Match hone wali properties (${all.length} mein se ${rows.length}):`)
            : (ctx.lang === 'en' ? `You have access to ${all.length} properties:` : `Aapke paas ${all.length} properties ka access hai:`);
        const list = `${head}\n${rows.map(line).join('\n')}`;
        return { text: list, display: list };
    },
};

export const PROPERTY_SKILLS = [propertiesMineSkill] as const;
