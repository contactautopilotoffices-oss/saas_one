/**
 * How the FAQ is written into Meera's script. Pure text, no database: used by
 * faq.ts (the console's Publish button) and scripts/satej-sync-bolna.ts.
 */

import { FAQ_HEADING } from './prompts/voiceAgent';

export interface FaqLike {
    question: string;
    answer: string;
    status: string;
}

/** The "# Common questions" section as it goes into Meera's script. */
export function faqSection(entries: FaqLike[]): string {
    const approved = entries.filter((e) => e.status === 'approved');
    if (!approved.length) return `${FAQ_HEADING}\n(None yet.)`;
    return [
        FAQ_HEADING,
        'When a vendor asks one of these, answer in your own words, briefly, then carry on with the call.',
        ...approved.map((e) => `- "${e.question}" → ${e.answer}`),
    ].join('\n');
}

/** Replace (or add, before "# Rules") the FAQ section of a script. Everything else is left exactly as it was. */
export function withFaq(prompt: string, entries: FaqLike[]): string {
    const section = faqSection(entries);
    const start = prompt.indexOf(`\n${FAQ_HEADING}\n`);
    if (start >= 0) {
        const next = prompt.indexOf('\n# ', start + FAQ_HEADING.length + 2);
        return `${prompt.slice(0, start + 1)}${section}\n${next >= 0 ? prompt.slice(next) : ''}`.trimEnd();
    }
    const rules = prompt.indexOf('\n# Rules');
    return rules >= 0 ? `${prompt.slice(0, rules)}\n\n${section}\n${prompt.slice(rules)}` : `${prompt}\n\n${section}`;
}

/** The script with its FAQ section emptied — to compare two scripts apart from their FAQ. */
export function withoutFaq(prompt: string): string {
    return withFaq(prompt, []);
}
