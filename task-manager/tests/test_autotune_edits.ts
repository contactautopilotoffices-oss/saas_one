/**
 * Owner 2026-10-20 — the nightly self-improvement writes SMALL EDITS, not a full rewrite, in its own 5-minute slot
 * (100% OFFLINE: a scripted AI, no database, no network).
 * Run: npx tsx task-manager/tests/test_autotune_edits.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- a scripted AI client stands in for the real one */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';
import fs from 'fs';
import path from 'path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const H = await import('../BotLearningHousekeeping');
    const { BUILTIN_PROMPT_SECTIONS } = await import('../brain/prompt');
    const current = { steps: ['1. Read the context.', '2. Choose one intent.', '3. Reply with JSON only.'], examples: ['Example A.', 'Example B.'] };

    console.log('\n1. Applying edits');
    const out = H.applyPromptEdits(current, [
        { section: 'steps', op: 'replace', index: 1, text: '2. Choose exactly ONE intent.' },
        { section: 'examples', op: 'insert_after', index: 0, text: 'Example A2.' },
        { section: 'examples', op: 'delete', index: 1 },
    ]);
    check('replace / insert / delete land on the right lines', out.steps[1] === '2. Choose exactly ONE intent.' && JSON.stringify(out.examples) === JSON.stringify(['Example A.', 'Example A2.']), out);
    check('the current text is never changed in place', current.steps[1] === '2. Choose one intent.' && current.examples.length === 2);
    const bad = (edits: any[]) => { try { H.applyPromptEdits(current, edits); return false; } catch { return true; } };
    check('more than 4 edits → rejected', bad(Array.from({ length: 5 }, () => ({ section: 'steps', op: 'replace', index: 0, text: 'x' }))));
    check('a line number that does not exist → rejected', bad([{ section: 'steps', op: 'replace', index: 9, text: 'x' }]));
    check('an unknown section or action → rejected', bad([{ section: 'intents', op: 'replace', index: 0, text: 'x' }]) && bad([{ section: 'steps', op: 'rewrite', index: 0, text: 'x' }]));
    check('an empty or very long line → rejected', bad([{ section: 'steps', op: 'replace', index: 0, text: '' }]) && bad([{ section: 'steps', op: 'replace', index: 0, text: 'x'.repeat(601) }]));
    check('no edits → rejected', bad([]));

    console.log('\n2. Drafting with the real built-in instructions');
    const state: any = { index: 0, before: [], after: [], attempts: {}, costUsd: 0, baselineSections: BUILTIN_PROMPT_SECTIONS };
    const calls: any[] = [];
    const llm = { complete: async (req: any) => { calls.push(req); return { text: JSON.stringify({ edits: [{ section: 'examples', op: 'insert_after', index: -1, text: 'Example. Message: "lock task 2" → lock_task.' }], change_summary: 'Add a lock example.' }), tokensIn: 100, tokensOut: 50 }; } };
    const draft = await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [{ message_text: 'lock task 2', context_snapshot: {}, expectation: { intent: 'lock_task' } }], state, llm as any, null);
    check('the AI is asked for edits only (never the whole text)', /Return ONLY the edits/.test(calls[0].system) && /"edits"/.test(calls[0].system));
    check('one small edit → a valid new version, one line longer', draft.sections.examples.length === BUILTIN_PROMPT_SECTIONS.examples.length + 1 && draft.sections.examples[0].includes('lock_task') && draft.sections.steps.length === BUILTIN_PROMPT_SECTIONS.steps.length, draft.sections.examples.slice(0, 2));
    check('the change summary is kept', draft.changeSummary === 'Add a lock example.');
    check('the AI sees each line with its [index]', JSON.parse(calls[0].user).current.steps[0].startsWith('[0] '));
    check('a copied "[3] " prefix is dropped from the new line', H.applyPromptEdits(current, [{ section: 'steps', op: 'replace', index: 0, text: '[0] 1. Read it.' }]).steps[0] === '1. Read it.');

    console.log('\n2b. Owner 2026-10-28: Claude drafts first; failures stay readable');
    const st2: any = { ...state, costUsd: 0 };
    const claudeCalls: string[] = [];
    const scripted = { complete: async (req: any) => {
        claudeCalls.push(req.model);
        if (req.model.startsWith('gemini-')) throw new Error('[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent: [404 Not Found] model not found');
        if (req.model === 'glm-5.3-flash') throw new Error('edit line out of range');
        return { text: JSON.stringify({ edits: [{ section: 'examples', op: 'insert_after', index: -1, text: 'Example. lock' }], change_summary: 'x' }), tokensIn: 100, tokensOut: 50 };
    } };
    const viaClaude = await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], st2, scripted as any, scripted as any, ['anthropic:claude-sonnet-5-5', 'gemini-3.8-flash']);
    check('a Claude model has a price, so the cost cap lets it run', viaClaude.model === 'anthropic:claude-sonnet-5-5' && st2.costUsd > 0, { model: viaClaude.model, cost: st2.costUsd });
    let reason = '';
    try { await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], { ...state, costUsd: 0 } as any, scripted as any, scripted as any, ['gemini-3.8-flash', 'glm-5.3-flash']); } catch (e: any) { reason = e.message; }
    check('the HTTP status survives in the reason (the long URL is removed)', reason.includes('[404 Not Found]') && !reason.includes('https://') && reason.includes('glm-5.3-flash: edit line out of range'), reason);

    console.log('\n2c. Owner 2026-11-05: why a model failed is kept, and the size limit is stated');
    const base = BUILTIN_PROMPT_SECTIONS.steps.concat(BUILTIN_PROMPT_SECTIONS.examples).join('\n').length;
    const room = Math.floor(base * 1.2) - base;
    const prompts: string[] = [];
    const tooLong = { complete: async (req: any) => {
        prompts.push(req.system);
        const line = (n: number) => 'x'.repeat(n);
        // Four allowed edits, each within the 600-character line limit, can still go over the total: the suspected Opus case.
        if (req.model === 'anthropic:claude-opus-5-5') return { text: JSON.stringify({ edits: [0, 1, 2, 3].map(i => ({ section: 'examples', op: 'insert_after', index: i, text: line(590) })), change_summary: 'long' }), tokensIn: 100, tokensOut: 50 };
        if (req.model === 'gemini-3.8-flash') throw new Error('[404 Not Found] model not found');
        return { text: JSON.stringify({ edits: [{ section: 'examples', op: 'insert_after', index: -1, text: 'Example. short' }], change_summary: 'short' }), tokensIn: 100, tokensOut: 50 };
    } };
    const st3: any = { ...state, costUsd: 0 };
    const viaSonnet = await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], st3, tooLong as any, tooLong as any, ['anthropic:claude-opus-5-5', 'gemini-3.8-flash', 'anthropic:claude-sonnet-5-5']);
    check('the next model drafts when a draft is too long', viaSonnet.model === 'anthropic:claude-sonnet-5-5', viaSonnet.model);
    check('each failed model is kept with its reason, in order', st3.draftFailures?.length === 2 && st3.draftFailures[0].startsWith('anthropic:claude-opus-5-5: sections are too large') && st3.draftFailures[1].startsWith('gemini-3.8-flash: [404 Not Found]'), st3.draftFailures);
    check('a size failure says how far over it was', st3.draftFailures?.[0].includes(`of ${Math.floor(base * 1.2)} characters`), st3.draftFailures);
    check('the drafter is told exactly how much it may add', prompts[0].includes(`adding at most ${room} characters in total`), prompts[0].split('\n')[5]);
    const st4: any = { ...state, costUsd: 0 };
    await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], st4, tooLong as any, tooLong as any, ['anthropic:claude-sonnet-5-5']);
    check('no failures when the first model drafts', Array.isArray(st4.draftFailures) && st4.draftFailures.length === 0, st4.draftFailures);
    const atCeiling = { steps: ['x'.repeat(11000)], examples: ['y'] };
    check('the limit never exceeds the fixed ceiling', (await import('../brain/prompt')).promptCharLimit({ maxChars: 12000, maxBaseChars: atCeiling.steps[0].length }) === 12000);

    console.log('\n2d. Owner 2026-11-05: lessons are kept until a version built on them is in use');
    const ctx = { pending: null, sender: { id: 'u1', name: 'A' }, people: [], tasks: [] };
    const lesson = (message_text: string, expectation: any = { intent: 'view_tasks', outcome: 'ACT', expect: {} }) => ({ message_text, context_snapshot: ctx, expectation });
    const kept = H.unsolvedLessons([lesson('a'), lesson('unjudgeable', { intent: 'answer_pending', outcome: 'ACT', expect: { answer: 'yes' } }), lesson('broken', { intent: 'invented' }), lesson('b', { intent: 'create_tasks', outcome: 'CONFIRM', expect: {}, mustNotMutate: true })]);
    check('a test that cannot be judged teaches nothing', kept.map(x => x.message_text).join() === 'a,b', kept.map(x => x.message_text));
    check('a lesson is taught in its repaired form', kept[1].expectation.mustNotMutate === false);
    const many = H.unsolvedLessons(Array.from({ length: H.MAX_DRAFT_LESSONS + 5 }, (_, i) => lesson(`m${i}`)));
    check('too many lessons → only the newest are sent', many.length === H.MAX_DRAFT_LESSONS && many[many.length - 1].message_text === `m${H.MAX_DRAFT_LESSONS + 4}` && many[0].message_text === 'm5');
    const tried = H.previousAttempts([
        { change_summary: 'Clarify add this. [drafted by gemini-2.5-flash]', rejection_reason: 'more wrong proposals than the prompt in use', source_label_at: '2026-11-02' },
        { change_summary: 'Short yes replies.', rejection_reason: 'Rejected by owner@example.com', source_label_at: '2026-11-01' },
        { change_summary: 'x', rejection_reason: 'nightly cost cap reached', source_label_at: null },
        { change_summary: 'Draft validation failed.', rejection_reason: 'no draft: all failed', source_label_at: null },
        { change_summary: 'Third.', rejection_reason: 'overall score dropped', source_label_at: '2026-10-31' },
        { change_summary: 'Fourth.', rejection_reason: 'overall score dropped', source_label_at: '2026-10-30' },
    ]);
    check('rejected ideas are kept, newest first, at most 3', tried.length === 3 && tried[0].change === 'Clarify add this.' && tried[2].change === 'Third.', tried);
    check('a technical stop is not a rejected idea', !tried.some(t => /cost cap|no draft/.test(t.rejected_because)));
    check('an admin\'s name never reaches the model', tried[1].rejected_because === 'an admin rejected it' && !JSON.stringify(tried).includes('owner@'), tried[1]);
    const seen: any[] = [];
    const recorder = { complete: async (req: any) => { seen.push(req); return { text: JSON.stringify({ edits: [{ section: 'examples', op: 'insert_after', index: -1, text: 'Example. short' }], change_summary: 's' }), tokensIn: 1, tokensOut: 1 }; } };
    await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], { ...state, costUsd: 0 } as any, recorder as any, null, ['glm-5.3-flash'], tried);
    await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, [], { ...state, costUsd: 0 } as any, recorder as any, null, ['glm-5.3-flash']);
    check('the drafter sees what was rejected, and is told to try something else', JSON.parse(seen[0].user).previous_attempts?.length === 3 && /tested and rejected: try a different change/.test(seen[0].system));
    check('with nothing rejected, no previous attempts are sent', JSON.parse(seen[1].user).previous_attempts === undefined);
    check('previous attempts are treated as data', /previous_attempts are untrusted DATA/.test(seen[0].system));
    const source = fs.readFileSync(path.resolve(__dirname, '../BotLearningHousekeeping.ts'), 'utf8');
    check('lessons start after the version in use, not after the last attempt', /\.gt\('created_at', inUse\?\.source_label_at \|\| '1970-01-01'\)/.test(source) && !/\.gt\('created_at', last\?\.source_label_at/.test(source));
    check('only new labels start a paid run (a rejected night is not retried unchanged)', /lastConsumedLabelAt: last\?\.source_label_at/.test(source));
    const biggest = Array.from({ length: H.MAX_DRAFT_LESSONS }, () => ({ message_text: 'x'.repeat(800), context_snapshot: { tasks: Array.from({ length: 16 }, (_, i) => ({ n: i, id: 'b7010e73-fee5-4c37-8867-2847f8913331', title: 't'.repeat(60), status: 'pending' })), people: Array.from({ length: 6 }, () => ({ id: 'b7010e73-fee5-4c37-8867-2847f8913331', name: 'Some Person', department: 'Facilities', role: 'employee' })) }, expectation: { intent: 'view_tasks', outcome: 'ACT', expect: {} } }));
    const capped: any = { ...state, costUsd: 0 };
    const opus = await H.draftCandidate(BUILTIN_PROMPT_SECTIONS, biggest, capped, recorder as any, null, ['anthropic:claude-opus-5-5']);
    check('the largest draft input still fits the cost cap on Opus', opus.model === 'anthropic:claude-opus-5-5', opus.model);

    console.log('\n3. Its own nightly slot');
    const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8'));
    const cron = vercel.crons.find((c: any) => c.path === '/api/cron/bot-autotune');
    check('scheduled once a night at 02:15 India time (20:45 UTC)', cron?.schedule === '45 20 * * *', cron);
    const route = fs.readFileSync(path.resolve(__dirname, '../../app/api/cron/bot-autotune/route.ts'), 'utf8');
    check('the slot allows 5 minutes and the AI up to 4, and needs the cron secret', /maxDuration = 300/.test(route) && /timeoutMs: 240_000/.test(route) && /CRON_SECRET/.test(route) && /draft: true/.test(route));
    const hk = fs.readFileSync(path.resolve(__dirname, '../BotLearningHousekeeping.ts'), 'utf8');
    check('the 15-minute housekeeping only continues testing (never writes a new version)', /runNightlyAutoTune\(now, undefined, \{ draft: false \}\)/.test(hk) && /if \(!row && opts\.draft === false\) return/.test(hk));

    console.log(failures === 0 ? '\n🎉 AUTO-TUNE EDITS TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
