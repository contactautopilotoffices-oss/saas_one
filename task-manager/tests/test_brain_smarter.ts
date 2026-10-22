/**
 * Owner 2026-10-21, steps 3-6 of "make the WhatsApp bot smarter" (learned from Otto). 100% OFFLINE: a scripted fake AI;
 * no network, no database, no WhatsApp.
 *   3. two-step reading (kind first, then only that kind's details)
 *   4. natural replies when nothing changes; strict rules kept for previews and changes
 *   5. the understand step's models can be switched (e.g. Groq gpt-oss-120b) with the usual ones kept as backups
 *   6. the real chats that went wrong are in the test set and the nightly tuning
 * Run: npx tsx task-manager/tests/test_brain_smarter.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fakes on purpose (same as the other brain tests) */
export {};
let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };
    const I = await import('../brain/interpret');
    const { runBrain, changesNothing } = await import('../brain/index');
    const { checkReply } = await import('../brain/respond');
    const { replySystemPrompt } = await import('../brain/prompt');
    const LLM = await import('../brain/llm');
    const { world } = await import('../brain/eval/worlds');
    const { REAL_CASES } = await import('../brain/eval/cases_real');
    const { scoreCase } = await import('../brain/eval/score');
    const { tasksDomain } = await import('../brain/tasksDomain');
    const { facilityDomain } = await import('../brain/facilityDomain');
    const domains = [tasksDomain, facilityDomain];

    // A scripted AI. `kind` answers step 1; `details` answers the understand step; replies say "Okay" + required placeholders.
    const fake = (o: { kind?: any; details?: any; reply?: (u: any, sys: string) => string }) => {
        const seen = { kindCalls: 0, detailSystems: [] as string[], replySystems: [] as string[] };
        const llm = { complete: async (req: any) => {
            if (req.system.startsWith(I.KIND_SYSTEM_HEADER)) { seen.kindCalls++; if (o.kind instanceof Error) throw o.kind; return { text: JSON.stringify(o.kind), tokensIn: 1, tokensOut: 1 }; }
            if (/Reply with JSON only: \{"text"/.test(req.system)) {
                seen.replySystems.push(req.system); const u = JSON.parse(req.user);
                const need = (u.placeholders || []).filter((p: any) => p.required).map((p: any) => p.name).join('\n');
                return { text: JSON.stringify({ text: o.reply ? o.reply(u, req.system) : `Okay:\n${need}` }), tokensIn: 1, tokensOut: 1 };
            }
            if (/"request": string/.test(req.system)) return { text: '{"request": ""}', tokensIn: 1, tokensOut: 1 }; // rewrite: nothing
            seen.detailSystems.push(req.system);
            return { text: JSON.stringify(o.details), tokensIn: 1, tokensOut: 1 };
        } };
        return { llm, seen };
    };
    const ADD_LOHIT = { intent: 'create_tasks', confidence: 0.95, language: 'en', slots: { assignee: 'Lohit Kumar', tasks: [{ title: 'Review the RFID rollout', details: null }], date: null }, ambiguities: [], clarify_question: null, summary: 'Add a task for Lohit' };

    console.log('\n3. Two-step reading');
    {
        const f = fake({ kind: { kind: 'create_tasks', also: [], confidence: 0.9 }, details: ADD_LOHIT });
        const r = await runBrain('give lohit a task to review the rfid rollout', world('default'), { llm: f.llm, twoStep: true });
        check('step 1 picks the kind, step 2 reads the details', f.seen.kindCalls === 1 && r.interpretation?.intent === 'create_tasks' && r.decision?.outcome === 'CONFIRM' && r.trace.kind === 'create_tasks', r);
        const sys = f.seen.detailSystems[0] || '';
        check('step 2 is shown ONLY that kind\'s rules and details', /- "create_tasks"/.test(sys) && !/- "complete_tasks"/.test(sys) && !/- "hand_over_task"/.test(sys) && !/- "find_tasks"/.test(sys));
    }
    {
        const f = fake({ kind: { kind: 'smalltalk', also: [], confidence: 0.95 }, details: ADD_LOHIT });
        const r = await runBrain('thanks a lot', world('default'), { llm: f.llm, twoStep: true });
        check('a kind with no details (chat) skips step 2', r.interpretation?.intent === 'smalltalk' && f.seen.detailSystems.length === 0, r.interpretation);
    }
    {
        const f = fake({ kind: { kind: 'make_coffee' }, details: ADD_LOHIT });
        const r = await runBrain('give lohit a task to review the rfid rollout', world('default'), { llm: f.llm, twoStep: true });
        const sys = f.seen.detailSystems[0] || '';
        check('step 1 answers nonsense -> the normal one-step reading runs (sees every kind)', r.interpretation?.intent === 'create_tasks' && /- "complete_tasks"/.test(sys) && r.trace.kind === null);
    }
    {
        const f = fake({ kind: { kind: 'create_tasks', also: [], confidence: 0.9 }, details: { ...ADD_LOHIT, intent: 'delete_tasks' } });
        const r = await runBrain('give lohit a task to review the rfid rollout', world('default'), { llm: f.llm, twoStep: true });
        check('step 2 answers a different kind than step 1 -> rejected, the one-step reading decides', r.trace.kind === null && f.seen.detailSystems.length >= 2 && /- "complete_tasks"/.test(f.seen.detailSystems[f.seen.detailSystems.length - 1]), { kind: r.trace.kind, calls: f.seen.detailSystems.length });
    }
    {
        const f = fake({ kind: { kind: 'create_tasks' }, details: ADD_LOHIT });
        await runBrain('give lohit a task to review the rfid rollout', world('default'), { llm: f.llm });
        check('off by default (no env switch): one reading, no kind call', f.seen.kindCalls === 0);
    }
    {
        const f = fake({ kind: { kind: 'complete_tasks', also: [], confidence: 0.9 }, details: { intent: 'answer_pending', confidence: 0.95, language: 'en', slots: { answer: 'yes', pick: null, instruction: null }, ambiguities: [], clarify_question: null, summary: 'yes' } });
        const r = await runBrain('yes go ahead with that', world('default', { kind: 'confirm', summary: 'Add 1 task for Lohit Kumar' } as any), { llm: f.llm, twoStep: true });
        check('while a question waits, step 2 may still answer it', r.interpretation?.intent === 'answer_pending', r.interpretation);
    }

    console.log('\n4. Natural replies when nothing changes');
    const viewDecision: any = { outcome: 'ACT', action: { type: 'view_tasks', scope: 'self' } };
    check('showing tasks / chat / finding changes nothing', changesNothing(viewDecision) && changesNothing({ outcome: 'ACT', action: { type: 'chat' } } as any) && changesNothing({ outcome: 'ACT', action: { type: 'find_tasks' } } as any));
    check('a preview, a question, a status note and a change are NOT free', !changesNothing({ outcome: 'CONFIRM', action: { type: 'create_tasks' } } as any) && !changesNothing({ outcome: 'CLARIFY', reason: 'x', options: [], detail: null } as any) && !changesNothing({ outcome: 'ACT', action: { type: 'progress_update' } } as any));
    const facts: any = { kind: 'k', describe: 'd', values: { tasks: '1. Carpet Installation PO\n2. Kone Lift AMC Renewal' }, required: ['tasks'], asksQuestion: false, claimsNothingDone: false, names: ['Priyanka Shah'], fallback: 'f', noYesNoQuestion: true };
    const known = new Set(['priyanka', 'carpet', 'kone', 'lift', 'amc', 'renewal', 'installation']);
    const natural = 'You have 2 open today, Kone is the one in progress:\n[[tasks]]\nGood luck 💪🙂';
    check('strict rules reject a natural answer (number by hand, two emoji)', checkReply(natural, facts, known).length > 0);
    check('free mode accepts it (the number is one it was given)', checkReply(natural, { ...facts, free: true }, known).length === 0, checkReply(natural, { ...facts, free: true }, known));
    check('free mode still rejects an invented number', checkReply('You have 7 open today:\n[[tasks]]', { ...facts, free: true }, known).some(p => /number/.test(p)));
    check('free mode still rejects a gendered pronoun and a false "done"', checkReply('She has finished it. I\'ve added it!\n[[tasks]]', { ...facts, free: true, claimsNothingDone: true }, known).length >= 2);
    check('free mode still rejects a yes/no question nothing waits for', checkReply('Here you go:\n[[tasks]]\nShould I mark one done?', { ...facts, free: true }, known).some(p => /yes\/no/.test(p)));
    {
        const f = fake({ details: { intent: 'view_tasks', confidence: 0.95, language: 'en', slots: { scope: 'self', person: null, department: null }, ambiguities: [], clarify_question: null, summary: 'Show my tasks' } });
        await runBrain('what\'s left for me today?', world('default'), { llm: f.llm });
        check('a task list is written with the free prompt', f.seen.replySystems[0] === replySystemPrompt(true));
        const g = fake({ details: ADD_LOHIT });
        await runBrain('give lohit a task to review the rfid rollout', world('default'), { llm: g.llm });
        check('a preview is written with the strict prompt', g.seen.replySystems[0] === replySystemPrompt(false));
        // Owner 2026-10-22: strict ONLY for a preview waiting for a yes; a question on the way to a request is natural too.
        const q = fake({ details: { intent: 'create_tasks', confidence: 0.95, language: 'en', slots: { assignee: 'Zebulon', tasks: [{ title: 'Call the vendor', details: null }], date: null }, ambiguities: ['no Zebulon'], clarify_question: 'Who is Zebulon?', summary: 'Give Zebulon a task' } });
        const rq = await runBrain('give zebulon a task to call the vendor', world('default'), { llm: q.llm });
        check('a question on the way to a request (CLARIFY) is written with the natural prompt', rq.decision?.outcome === 'CLARIFY' && q.seen.replySystems[0] === replySystemPrompt(true), rq.decision?.outcome);
        const h = fake({ details: { intent: 'view_tasks', confidence: 0.95, language: 'en', slots: { scope: 'self', person: null, department: null }, ambiguities: [], clarify_question: null, summary: 'Show' } });
        await runBrain('show my tasks', world('default'), { llm: h.llm, freeReplies: false });
        check('freeReplies: false keeps the strict prompt everywhere', h.seen.replySystems[0] === replySystemPrompt(false));
    }

    console.log('\n5. Switching the understand model');
    const HAIKU_THEN_BACKUPS = JSON.stringify(['anthropic:claude-haiku-5-5', 'glm-5.3-flash', 'qwen3.8-27b']);
    check('the setting lives in code: Claude Haiku first, then GLM, then Qwen (owner 2026-10-22)', LLM.CHATBOT_MODEL === 'anthropic:claude-haiku-5-5' && JSON.stringify(LLM.BRAIN_INTERPRET_MODELS) === HAIKU_THEN_BACKUPS);
    check('empty setting -> only the usual models', JSON.stringify(LLM.interpretModelsWith('')) === JSON.stringify(['glm-5.3-flash', 'qwen3.8-27b']));
    check('two-step reading is a code setting, off for now', LLM.TWO_STEP_READING === false);
    check('replies and the rewrite also use Haiku first, then GLM, then Qwen', JSON.stringify(LLM.BRAIN_REPLY_MODELS) === HAIKU_THEN_BACKUPS && JSON.stringify(LLM.BRAIN_REWRITE_MODELS) === HAIKU_THEN_BACKUPS);
    check('voice-note clean-up is not the chatbot: it keeps its cheap models', JSON.stringify((await import('../voice/VoiceCleanup')).VOICE_CLEANUP_MODELS) === JSON.stringify(['qwen3.8-27b', 'glm-5.3-flash']));
    check('the bot uses its OWN keys, in order, never the shared GROQ_API_KEY',
        JSON.stringify(LLM.botGroqKeys({ GROQ_API_KEY: 'shared', WHATSAPP_BOT_GROQ_API_KEY: 'a', WHATSAPP_BOT_GROQ_API_KEY_3: 'c', WHATSAPP_BOT_GROQ_API_KEY_2: 'b' })) === JSON.stringify(['a', 'b', 'c'])
        && LLM.botGroqKeys({ GROQ_API_KEY: 'shared' }).length === 0);
    const saveEnv = () => Object.fromEntries(['GROQ_API_KEY', ...LLM.BOT_GROQ_KEY_NAMES].map(n => [n, process.env[n]]));
    const restoreEnv = (e: Record<string, string | undefined>) => { for (const [n, v] of Object.entries(e)) { if (v === undefined) delete process.env[n]; else process.env[n] = v; } };
    const before = saveEnv();
    for (const n of ['GROQ_API_KEY', ...LLM.BOT_GROQ_KEY_NAMES]) delete process.env[n];
    {
        process.env.GROQ_API_KEY = 'shared-key-must-not-be-used';
        let err = ''; try { await LLM.groqComplete({ model: 'groq:openai/gpt-oss-120b', system: 's', user: 'u' }); } catch (e) { err = String((e as Error).message); }
        check('no bot key -> a clear error at once (the backup model takes over), nothing sent, shared key ignored', /no WhatsApp bot Groq key/.test(err) && net.length === 0, err);
        delete process.env.GROQ_API_KEY;
    }
    {
        process.env.WHATSAPP_BOT_GROQ_API_KEY = 'acct-1'; process.env.WHATSAPP_BOT_GROQ_API_KEY_2 = 'acct-2'; process.env.WHATSAPP_BOT_GROQ_API_KEY_3 = 'acct-3';
        const sent: any[] = [];
        (globalThis as any).fetch = async (u: any, init: any) => {
            const key = String(init.headers.Authorization).slice(7); sent.push({ u: String(u), key, body: JSON.parse(init.body) });
            if (key === 'acct-1') return { ok: false, status: 429, json: async () => ({}) };   // first account rate-limited
            return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }) };
        };
        const r = await LLM.engyBrainLlm().complete({ model: 'groq:openai/gpt-oss-120b', system: 's', user: 'u', json: true });
        check('"groq:" models go to Groq with low thinking', sent[0]?.u.includes('api.groq.com') && sent[0]?.body.model === 'openai/gpt-oss-120b' && sent[0]?.body.reasoning_effort === 'low' && r.text === '{"a":1}', sent[0]);
        check('account 1 rate-limited -> account 2 answers, account 3 not needed', sent.map(x => x.key).join() === 'acct-1,acct-2', sent.map(x => x.key));
        sent.length = 0;
        (globalThis as any).fetch = async (_u: any, init: any) => { sent.push(String(init.headers.Authorization).slice(7)); return { ok: false, status: 401, json: async () => ({}) }; };
        let err = ''; try { await LLM.groqComplete({ model: 'groq:openai/gpt-oss-120b', system: 's', user: 'u' }); } catch (e) { err = String((e as Error).message); }
        check('every account fails -> all tried once, then a clear error (no key in the message)', sent.join() === 'acct-1,acct-2,acct-3' && /every WhatsApp bot Groq key failed/.test(err) && !/acct-/.test(err), { sent, err });
        (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };
    }
    restoreEnv(before);
    {
        const saved = Object.fromEntries(['ANTHROPIC_API_KEY', ...LLM.BOT_ANTHROPIC_KEY_NAMES].map(n => [n, process.env[n]]));
        for (const n of Object.keys(saved)) delete process.env[n];
        check('Claude: ONE key named CLAUDE_API_KEY, never a shared ANTHROPIC_API_KEY or the old name',
            JSON.stringify(LLM.botAnthropicKeys({ ANTHROPIC_API_KEY: 'shared', WHATSAPP_BOT_ANTHROPIC_API_KEY: 'old', CLAUDE_API_KEY: 'a' })) === JSON.stringify(['a'])
            && LLM.botAnthropicKeys({ ANTHROPIC_API_KEY: 'shared', WHATSAPP_BOT_ANTHROPIC_API_KEY: 'old' }).length === 0);
        process.env.ANTHROPIC_API_KEY = 'shared-key-must-not-be-used';
        let err = ''; try { await LLM.anthropicComplete({ model: 'anthropic:claude-haiku-5-5', system: 's', user: 'u' }); } catch (e) { err = String((e as Error).message); }
        check('Claude: no CLAUDE_API_KEY -> a clear error at once (backup model answers), nothing sent', /CLAUDE_API_KEY is not set/.test(err) && net.length === 0, err);
        delete process.env.ANTHROPIC_API_KEY;
        process.env.CLAUDE_API_KEY = 'c-1';
        const sent: any[] = [];
        (globalThis as any).fetch = async (u: any, init: any) => {
            const key = init.headers['x-api-key']; sent.push({ u: String(u), key, h: init.headers, body: JSON.parse(init.body) });
            return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"a":1}' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } }) };
        };
        const r = await LLM.engyBrainLlm().complete({ model: 'anthropic:claude-haiku-5-5', system: 'rules', user: 'msg', json: true });
        check('"anthropic:" models go to Claude (Messages API, system kept separate, no temperature: Claude 5.x rejects it)', sent[0]?.u === 'https://api.anthropic.com/v1/messages' && sent[0]?.key === 'c-1' && sent[0]?.body.model === 'claude-haiku-5-5' && sent[0]?.body.system === 'rules' && sent[0]?.body.messages[0].content === 'msg' && !('temperature' in sent[0]?.body) && sent[0]?.body.max_tokens === 1200 + LLM.CLAUDE_THINKING_ROOM && sent[0]?.h['anthropic-version'] && r.text === '{"a":1}' && r.tokensIn === 5, sent[0]);
        sent.length = 0;
        (globalThis as any).fetch = async (u: any, init: any) => { sent.push(init.headers['x-api-key']); return { ok: false, status: 529, json: async () => ({}) }; };
        err = ''; try { await LLM.anthropicComplete({ model: 'anthropic:claude-haiku-5-5', system: 's', user: 'u' }); } catch (e) { err = String((e as Error).message); }
        check('Claude overloaded -> a clear error so GLM / Qwen answer (no key in the message)', sent.join() === 'c-1' && /Claude failed/.test(err) && !/c-1/.test(err), err);
        (globalThis as any).fetch = async (u: any) => { net.push(String(u)); throw new Error('network must not be used'); };
        for (const [n, v] of Object.entries(saved)) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
        delete process.env.CLAUDE_API_KEY;
    }
    {
        const { tasksDomain: TD } = await import('../brain/tasksDomain');
        const spec = TD.intents.find(i => i.name === 'create_tasks')!.slots;
        check('add-task rule: no person named -> the sender\'s own list, no question (Sher)', /"add task follow up regarding checklist"/.test(spec) && /"assignee":"me" \(it goes on their own list\)/.test(spec));
        check('add-task rule: a word not in the people list stays in the title (Sanil)', /Sailee rest FNF/.test(spec) && /never a person and never an ambiguity/.test(spec));
    }

    console.log('\n6. The real chats that went wrong');
    check('Sher\'s and Sanil\'s messages are in the set', REAL_CASES.some(c => c.message === 'add task follow up regarding Checklist') && REAL_CASES.some(c => c.message === 'Task.\n\nAdd Sailee rest FNF'));
    check('every real case has a unique id in group "real"', new Set(REAL_CASES.map(c => c.id)).size === REAL_CASES.length && REAL_CASES.every(c => c.group === 'real' && c.id.startsWith('real-')));
    {
        const sanil = REAL_CASES.find(c => c.id === 'real-sanil-01')!;
        const mistake = fake({ details: { intent: 'create_tasks', confidence: 0.9, language: 'en', slots: { assignee: 'Sailee', tasks: [{ title: 'Rest FNF', details: null }], date: null }, ambiguities: [], clarify_question: null, summary: 'x' } });
        const bad = scoreCase(sanil, await runBrain(sanil.message, world('default'), { llm: mistake.llm }));
        const right = fake({ details: { intent: 'create_tasks', confidence: 0.9, language: 'en', slots: { assignee: null, tasks: [{ title: 'Sailee rest FNF', details: null }], date: null }, ambiguities: [], clarify_question: null, summary: 'x' } });
        const good = scoreCase(sanil, await runBrain(sanil.message, world('default'), { llm: right.llm }));
        check('Sanil\'s old mistake (Sailee read as a person) FAILS the case', !bad.pass, bad);
        check('the right reading (own task "Sailee rest FNF") passes', good.pass, good);
    }
    {
        const fs = await import('node:fs'); const path = await import('node:path');
        const src = fs.readFileSync(path.resolve(__dirname, '../BotLearningHousekeeping.ts'), 'utf8');
        check('the nightly tuning includes the real cases, with their chat lines', /REAL_CASES/.test(src) && /conversation: x\.c\.conversation/.test(src));
    }
    check('no network used', net.length === 0, net);

    if (failures) { console.error(`\n❌ ${failures} SMARTER-BOT TEST(S) FAILED`); process.exit(1); }
    console.log('\n🎉 SMARTER-BOT TESTS PASSED (steps 3-6)');
}
run().catch(e => { console.error(e); process.exit(1); });
