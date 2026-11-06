import type { ReplyFacts } from './domain';
import { BrainLlm, HEDGE_REPLY_MS, extractJson, withModelFallback } from './llm';
import { replySystemPrompt, replyUserPrompt } from './prompt';
import { isBlockValue } from './text';

/**
 * The language brain — step 5: REPLY.
 *
 * The AI writes only the words AROUND placeholders. Task titles, names, counts and lists are inserted by code from
 * verified facts, so they can never be wrong. A checker rejects an answer that writes numbers or names by hand, uses
 * gendered pronouns, claims something already happened when it has not, or asks the wrong kind of question. If
 * every model fails the checks, a plain deterministic text is sent instead — the person always gets an answer.
 */

const PLACEHOLDER = /\[\[([a-z_]+)\]\]/g;
const PRONOUNS = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
const CLAIMS_DONE = /\b(i['’]?ve|i have|has been|have been|is now|are now|already (?:done|saved|added|moved|marked))\b|\b(done|saved|added|moved|created|assigned)!/i;
// "Nothing has been updated yet" is exactly what should be said, so a sentence that negates or says "yet" is not a false claim.
const NEGATION = /\b(nothing|not|no|never|yet|until|won't|will)\b|n['’]t\b/i;
const claimsDone = (text: string) => text.split(/(?<=[.!?])\s+|\n/).some(s => CLAIMS_DONE.test(s) && !NEGATION.test(s));
const YES_NO_QUESTION = /\b(should i|shall i|do you want me to|would you like me to|want me to|(?:could|can) you (?:please )?confirm|confirm (?:if|whether|that)|is that (?:right|correct|ok|okay)|did you mean to)\b/i;
const ALWAYS_OK_WORDS = new Set([
    'whatsapp', 'task', 'tasks', 'manager', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
]);

/** Every word the AI was legitimately given: people, task titles, departments, the person's own message. */
export function knownWordsFrom(strings: Array<string | undefined | null>): Set<string> {
    const out = new Set<string>();
    for (const s of strings) for (const w of String(s ?? '').toLowerCase().split(/[^a-z0-9']+/)) if (w.length > 1) out.add(w);
    return out;
}

export function checkReply(text: unknown, facts: ReplyFacts, known: ReadonlySet<string> = new Set()): string[] {
    if (typeof text !== 'string' || !text.trim()) return ['empty reply'];
    const problems: string[] = [];
    // Owner 2026-10-22 (learned from Otto): only checks that stop WRONG FACTS or a broken conversation remain. The style
    // checks (length, emoji count, markdown, "exactly one question", list placement) were dropped: they made the bot send
    // stiff backup texts. Lists are still laid out on their own lines by renderReply. A sanity cap stops a runaway answer.
    if (text.length > 1500) problems.push('far too long');

    const used = [...text.matchAll(PLACEHOLDER)].map(m => m[1]);
    for (const u of used) if (!(u in facts.values)) problems.push(`unknown placeholder [[${u}]]`);
    for (const need of facts.required) if (!used.includes(need)) problems.push(`missing required [[${need}]]`);

    const bare = text.replace(PLACEHOLDER, ' ');
    // A number is fine when it is one the AI was given (a value, the message or the chat); an invented one is rejected.
    // At the moment of change (a preview, not free) every number must come through a placeholder.
    const givenNumbers = new Set([...Object.values(facts.values), ...known].join(' ').match(/\d+/g) ?? []);
    const handNumbers = bare.match(/\d+/g) ?? [];
    if (facts.free ? handNumbers.some(n => !givenNumbers.has(n)) : handNumbers.length > 0) problems.push('wrote a number by hand');
    if (PRONOUNS.test(bare)) problems.push('used a gendered pronoun');
    if (facts.claimsNothingDone && claimsDone(bare)) problems.push('claims something already happened');
    // The bot is waiting for an answer, so the reply must actually ask (how many question marks is style, not checked).
    if (facts.asksQuestion && !bare.includes('?')) problems.push('must ask a question');
    // Part B: a "should I…?" with nothing waiting for the yes is exactly what left Harsh's "Yes add this task" unanswered.
    if (facts.noYesNoQuestion && YES_NO_QUESTION.test(bare)) problems.push('asks a yes/no question nothing is waiting for');

    // A capitalised word must be one the AI was given (a name, a task title, a department, the person's own words).
    // An invented one is rejected. The facts that matter (counts, lists) must come through a placeholder.
    const allowed = new Set(facts.names.flatMap(n => n.toLowerCase().split(/\s+/)));
    for (const m of bare.matchAll(/[A-Za-z][A-Za-z'’-]*/g)) {
        const word = m[0];
        if (!/^[A-Z][a-z]{2,}$/.test(word)) continue;
        // Emoji, bold stars, quotes or brackets before a word do not make it mid-sentence ("👍 Sure", "*Got it*").
        const before = bare.slice(0, m.index).replace(/[\s*_~"'“‘(\p{Extended_Pictographic}\uFE0F\u200D]+$/u, '');
        if (before === '' || /[.!?:\n]$/.test(before)) continue; // sentence start
        if (allowed.has(word.toLowerCase()) || ALWAYS_OK_WORDS.has(word.toLowerCase()) || known.has(word.toLowerCase())) continue;
        problems.push(`wrote a name or word by hand: ${word}`);
    }
    return problems;
}

/**
 * Fill the placeholders. A block (a list, a bullet, a hint — isBlockValue) always gets its own lines, even when the AI wrote
 * it inline: a blank line before it after a sentence or an intro ("…today: 1. …"), a line break before it after another
 * block, and a line break after it when a new sentence or another placeholder follows ("…optimization Reply done 1…").
 * Short values (names, dates, counts) stay inside the sentence.
 */
export function renderReply(text: string, values: Record<string, string>): string {
    let out = '', last = 0;
    for (const m of text.matchAll(PLACEHOLDER)) {
        const at = m.index ?? 0, value = values[m[1]] ?? '';
        out += text.slice(last, at);
        last = at + m[0].length;
        if (!isBlockValue(value)) { out += value; continue; }
        const head = out.replace(/[ \t]+$/, '');
        out = !head || head.endsWith('\n') ? head : /[:.!?]$/.test(head) || /\p{Extended_Pictographic}$/u.test(head) ? `${head}\n\n` : `${head}\n`;
        out += value;
        const tail = text.slice(last).match(/^[ \t]*/)?.[0] ?? '';
        const after = text.slice(last + tail.length);
        if (/^(?:\[\[|\p{Lu})/u.test(after)) { out += '\n'; last += tail.length; }
    }
    out += text.slice(last);
    // WhatsApp bold is *one* star: a markdown **bold** would show the stars.
    return out.replace(/\*\*([^*\n]+)\*\*/g, '*$1*').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface ComposedReply { text: string; source: 'ai' | 'fallback'; model: string | null; problems: string[]; tokensIn: number; tokensOut: number; ms: number }

export async function composeReply(p: {
    llm: BrainLlm; models: readonly string[]; facts: ReplyFacts; userMessage: string; known?: ReadonlySet<string>;
    /** Part B5: the latest chat lines, so the wording follows the conversation. Never a source of what happened. */
    conversation?: string[];
    /** Group 2: start the backup model after this long (0 = strictly one after another). */
    hedgeMs?: number;
}): Promise<ComposedReply> {
    const started = Date.now();
    const problems: string[] = [];
    let tokensIn = 0, tokensOut = 0;
    try {
        const { value, trace } = await withModelFallback(p.models, async model => {
            const res = await p.llm.complete({ model, system: replySystemPrompt(p.facts.free === true), user: replyUserPrompt(p.facts, p.userMessage, p.conversation), json: true, maxTokens: 800 });
            tokensIn += res.tokensIn; tokensOut += res.tokensOut;
            const text = (extractJson(res.text) as { text?: unknown })?.text;
            const found = checkReply(text, p.facts, p.known);
            if (found.length) { problems.push(...found.map(f => `${model}: ${f}`)); throw new Error(found.join('; ')); }
            return text as string;
        }, 'reply', { hedgeMs: p.hedgeMs ?? HEDGE_REPLY_MS });
        return { text: renderReply(value, p.facts.values), source: 'ai', model: trace.model, problems, tokensIn, tokensOut, ms: Date.now() - started };
    } catch (err) {
        // Keep WHY every model failed (an error is as important to see as a failed check).
        problems.push(`fallback used: ${err instanceof Error ? err.message : String(err)}`);
        return { text: p.facts.fallback, source: 'fallback', model: null, problems, tokensIn, tokensOut, ms: Date.now() - started };
    }
}
