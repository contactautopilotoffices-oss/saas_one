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
