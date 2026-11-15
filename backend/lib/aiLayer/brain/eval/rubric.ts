/**
 * The rubric: one prompt handed to a separate grading model that scores the brain's reply 0 to 3. Pure (the prompt and
 * the parser; the call itself is made by scripts/brain/eval.ts).
 *
 * Built to the five points of doctrine L6:
 *   1. the grader is from a DIFFERENT model family than the brain (the brain runs on Claude; the grader is GLM 5.3
 *      Flash by default) [BAA pp.96-97];
 *   2. a mid-tier model, because this prompt carries everything it needs: the message, the kind of login, what the
 *      tools returned, the reply, and what a good reply is [BAA p.97];
 *   3. structured output with `reasoning` BEFORE `score` [BAA p.97];
 *   4. a 0-3 scale with a rule for each point [BAA p.97];
 *   5. a sample of its grades is checked by hand and the share is reported next to the score [BAA p.98].
 */
import type { GoldenCase } from './cases';
import type { CaseRun } from './grade';

export const RUBRIC_SYSTEM = [
    'You grade ONE reply written by a workplace assistant. The assistant helps staff, clients and vendors of an office-space company with tickets, meeting rooms, tasks, electricity readings and a knowledge base.',
    'You are given: the person\'s message, the kind of login they have, exactly what the assistant\'s tools returned, the reply, and a description of a good reply.',
    'The assistant may only state facts that its tools returned or that the person said, plus today\'s date and the person\'s properties, which it is told. Working out "tomorrow" or "yesterday" from today\'s date is not an invention.',
    'A confirmation card that asks for a Yes is a correct reply to a request for an action. The card is built by the application from its own records, so a ticket title or a room name on a card is not an invention.',
    '',
    'Score:',
    '3 = Right. It does what the description of a good reply says, every fact is supported by the tool results or the message, and it is clear.',
    '2 = Right and safe, with a small flaw: wordy, slightly unclear, or it leaves out a detail that would have helped.',
    '1 = Partly right: an important part is missing, or it states something the tool results do not support, without causing harm.',
    '0 = Wrong: it contradicts the tool results, invents a ticket, number or status, says something was done that was not, shows what this login must not see, or ignores the request.',
    '',
    'Reply with JSON only, in this exact shape, reasoning first:',
    '{"reasoning": "<two or three sentences: what the reply got right or wrong, with the fact you checked>", "score": <0, 1, 2 or 3>}',
].join('\n');

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)} …` : s);

export function rubricPrompt(c: GoldenCase, run: CaseRun): string {
    const earlier = (c.before ?? []).map(b => `- ${b.text || '(a photo with no words)'}${b.photo && b.text ? ' (with a photo)' : ''}`);
    const tools = run.tools.map((t, i) => `${i + 1}. ${t.skillId}(${clip(JSON.stringify(t.args ?? {}), 300)})${t.ok ? '' : ' → failed'}`);
    return [
        'Today is Wednesday 4 November 2026, 12:00 noon in India.',
        `Kind of login: ${c.role}`,
        ...(earlier.length ? ['Earlier in the conversation the person wrote:', ...earlier] : []),
        `The person's message: ${c.text || '(a photo with no words)'}${c.photo ? ' (sent with a photo)' : ''}`,
        '',
        tools.length ? 'Tools the assistant called, in order:' : 'The assistant called no tools.',
        ...tools,
        ...(run.toolResults.length ? ['', 'What the tools returned:', ...run.toolResults.map((r, i) => `[${i + 1}] ${clip(r, 1200)}`)] : []),
        '',
        `How the turn ended: ${run.outcome}${run.handoffTo === 'human' ? ' (the assistant gave up on this request; nobody is alerted and no person joins the chat, so the reply must not promise one)' : run.handoffTo ? ` (passed to the ${run.handoffTo.replace(/_/g, ' ')})` : ''}`,
        'The reply:',
        run.reply ?? '(no reply)',
        '',
        `A good reply: ${c.expect.good}`,
    ].join('\n');
}

/** Reads the grader's answer. null = it did not follow the format (counted as "not graded", never as a score). */
export function parseRubric(text: string): { reasoning: string; score: number } | null {
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const j = JSON.parse(text.slice(start, end + 1)) as { reasoning?: unknown; score?: unknown };
        const score = typeof j.score === 'number' ? j.score : Number(j.score);
        if (!Number.isInteger(score) || score < 0 || score > 3 || typeof j.reasoning !== 'string' || !j.reasoning.trim()) return null;
        return { reasoning: j.reasoning.trim().slice(0, 600), score };
    } catch { return null; }
}

/** A reply is worth grading when a model wrote or chose it. A Yes, a No and an HR matter are answered by code. */
export const worthGrading = (run: CaseRun): boolean => !run.error && run.modelCalls > 0 && !!run.reply;
