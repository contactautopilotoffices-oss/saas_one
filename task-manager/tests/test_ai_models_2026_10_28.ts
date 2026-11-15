/**
 * Owner 2026-10-28 — Control Center "AI models": which model each Task Manager job uses (100% OFFLINE: fake database,
 * fake env, fake transports; nothing real is read, written or sent).
 * Run: npx tsx task-manager/tests/test_ai_models_2026_10_28.ts
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key-offline-test';

import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (n: string, ok: boolean, x?: unknown) => { if (ok) console.log(`  ✓ ${n}`); else { failures++; console.error(`  ✗ ${n}`, x ?? ''); } };
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

async function run() {
    const net: string[] = [];
    (globalThis as any).fetch = async (url: any) => { net.push(String(url)); throw new Error('network must not be used in this test'); };

    const C = await import('../ai/aiCatalog');
    const S = await import('../ai/AiModelSettings');
    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    (TaskDatabaseService as any).logAudit = async () => {};

    console.log('\n1. What a model can and cannot do');
    const all = () => true;
    check('a text-only model cannot read photos', C.modelStatus('import_image', 'deepseek-v4-flash-0731', all).status === 'cannot');
    check('a chat model cannot do speech to text', C.modelStatus('voice_transcribe', 'anthropic:claude-haiku-5-5', all).status === 'cannot');
    check('a speech model cannot write replies', C.modelStatus('wa_reply', 'whisper-large-v3', all).status === 'cannot');
    check('task import cannot call Groq / Gemini yet (its code only calls Claude and Engy)', C.modelStatus('import_text', 'groq:openai/gpt-oss-120b', all).status === 'cannot' && C.modelStatus('import_text', 'gemini-2.5-flash', all).status === 'cannot');
    check('unknown model → cannot', C.modelStatus('wa_reply', 'made-up-model', all).status === 'cannot');
    check('right kind but key missing → no_key', C.modelStatus('wa_reply', 'anthropic:claude-sonnet-5-5', p => p !== 'anthropic').status === 'no_key');
    check('ready', C.modelStatus('wa_reply', 'groq:openai/gpt-oss-120b', all).status === 'ready');

    console.log('\n2. The chain a job runs with: never stops');
    const defaults = C.jobInfo('wa_understand')!.defaults;
    check('no setting → exactly today\'s models', JSON.stringify(C.effectiveChain('wa_understand', null, all)) === JSON.stringify(defaults));
    const chain = C.effectiveChain('wa_reply', ['groq:openai/gpt-oss-120b', 'anthropic:claude-haiku-5-5'], all);
    check('picked main + backup first, then today\'s models, no repeats', chain[0] === 'groq:openai/gpt-oss-120b' && chain[1] === 'anthropic:claude-haiku-5-5' && chain.filter(m => m === 'anthropic:claude-haiku-5-5').length === 1 && chain.includes('glm-5.3-flash'), chain);
    const skip = C.effectiveChain('wa_reply', ['made-up', 'whisper-large-v3', 'gemini-2.5-flash'], p => p !== 'gemini');
    check('unknown, wrong-kind and keyless picks are skipped, today\'s models remain', JSON.stringify(skip) === JSON.stringify(C.jobInfo('wa_reply')!.defaults), skip);

    console.log('\n3. Keys: by name only');
    const env = { CLAUDE_API_KEY: 'x', GROQ_API_KEY_3: 'y', GEMINI_API_KEY: 'z', COUNCIL_PROVIDER: 'custom', COUNCIL_API_KEY: 'k', COUNCIL_BASE_URL: 'https://example.invalid/v1' };
    check('Claude / bot Groq (any of the 5) / Gemini / Engy ready', S.keyReady('anthropic', 'wa_reply', env) && S.keyReady('groq', 'wa_reply', env) && S.keyReady('gemini', 'wa_reply', env) && S.keyReady('engy', 'wa_reply', env));
    check('superuser chat reads the shared Groq keys too (owner 2026-11-15)', S.keyReady('groq', 'superuser_chat', env) && !S.keyReady('groq', 'superuser_chat', { GROQ_TASK_CHAT_API_KEY: 'x' }));
    check('Engy plain ids only count when the council provider is Engy', !S.keyReady('engy', 'wa_reply', { OPENAI_API_KEY: 'o', COUNCIL_API_KEY: 'k', COUNCIL_BASE_URL: 'https://example.invalid/v1' }));
    const ks = JSON.stringify(S.keyStatus(env));
    check('key status never carries a value', !ks.includes('"x"') && !ks.includes('"y"') && !ks.includes('"z"') && !ks.includes('"k"') && !ks.includes('example.invalid'));
    check('defaults follow the two env vars that already changed models', S.defaultsFor('superuser_chat', { GROQ_TASK_CHAT_MODEL: 'openai/gpt-oss-20b' })[0] === 'groq:openai/gpt-oss-20b' && S.defaultsFor('learning_loop', { BOT_AUTOTUNE_DRAFT_MODELS: 'gemini-x' })[1] === 'gemini-x');

    console.log('\n4. Reading the setting: problems fall back to today\'s models');
    let table: any = { error: { code: '42P01', message: 'missing' } };
    const saved: any[] = [];
    (supabaseAdmin as any).from = (t: string) => {
        if (t !== 'task_manager_ai_models') throw new Error(`unexpected table ${t}`);
        return {
            select: async () => table,
            upsert: async (row: any) => { saved.push(row); return { error: null }; },
            delete: () => ({ eq: async (_c: string, job: string) => { saved.push({ deleted: job }); return { error: null }; } }),
        };
    };
    check('table not created yet → today\'s models', JSON.stringify(await S.chainFor('wa_understand', env)) === JSON.stringify(defaults));
    table = { error: { code: 'XX000', message: 'boom' } };
    await S.savedChains(true);
    check('unreadable → today\'s models', JSON.stringify(await S.chainFor('wa_understand', env)) === JSON.stringify(defaults));
    table = { data: [{ job: 'wa_reply', models: ['groq:openai/gpt-oss-120b'] }], error: null };
    await S.savedChains(true);
    check('a saved setting is used (main first, today\'s models after)', (await S.chainFor('wa_reply', env))[0] === 'groq:openai/gpt-oss-120b');
    check('other jobs are untouched', JSON.stringify(await S.chainFor('wa_understand', env)) === JSON.stringify(defaults));

    console.log('\n5. Saving');
    let err: any = null;
    try { await S.saveChain('import_image', ['deepseek-v4-flash-0731']); } catch (e) { err = e; }
    check('refuses a model that cannot do the job', err instanceof Error && /cannot read images/.test(err.message), err);
    err = null;
    try { await S.saveChain('wa_reply', ['a', 'b', 'c', 'd', 'e'] as any); } catch (e) { err = e; }
    check('at most a main and 3 backups', err instanceof Error);
    saved.length = 0;
    await S.saveChain('wa_reply', ['groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-120b', 'anthropic:claude-haiku-5-5'], 'admin@x');
    check('saves the list once each, main first', JSON.stringify(saved[0]?.models) === JSON.stringify(['groq:openai/gpt-oss-120b', 'anthropic:claude-haiku-5-5']));
    await S.saveChain('wa_reply', null);
    check('reset = delete the row (back to today\'s models)', saved.some(r => r.deleted === 'wa_reply'));

    console.log('\n6. Each job uses it, and keeps today\'s behaviour by default');
    const { createEngyImportLlm } = await import('../TaskImportParser');
    const calls: string[] = [];
    const transport = { vision: async (m: string) => { calls.push(`v:${m}`); return 'row'; }, chat: async (m: string) => { calls.push(`c:${m}`); return '{"tasks":[]}'; } };
    await createEngyImportLlm(['m1'], transport, ['m1'], async step => (step === 'image' ? ['img1'] : ['txt1'])).imageToText(Buffer.from('x'), 'image/png');
    await createEngyImportLlm(['m1'], transport, ['m1'], async step => (step === 'image' ? ['img1'] : ['txt1'])).structureText('a');
    await createEngyImportLlm(['m1'], transport, ['m1'], async () => { throw new Error('db down'); }).structureText('a');
    check('task import: photo and text steps use their own chains; a failed lookup keeps today\'s chain', calls[0] === 'v:img1' && calls[1] === 'c:txt1' && calls[2] === 'c:m1', calls);

    const { SuperuserAIInterpreter } = await import('../SuperuserAIInterpreter');
    const seen: string[] = [];
    const fakeFetch = (async (_u: any, init: any) => { const m = JSON.parse(init.body).model; seen.push(m); if (m === 'bad') return { ok: false } as any; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"kind":"org_overview","subject":null,"title":null}' } }] }) } as any; }) as any;
    const r = await SuperuserAIInterpreter.interpret('how is the company doing', { departments: [] }, { env: { GROQ_API_KEY: 'k' }, fetch: fakeFetch, models: ['groq:bad', 'groq:good'] });
    check('superuser chat: an erroring model hands over to the backup', seen.join(',') === 'bad,good' && r?.kind === 'org_overview', { seen, r });
    seen.length = 0;
    await SuperuserAIInterpreter.interpret('how is the company doing', { departments: [] }, { env: { GROQ_API_KEY: 'k', GROQ_TASK_CHAT_MODEL: 'llama-x' }, fetch: fakeFetch });
    check('superuser chat: no setting → today\'s single model', seen.join(',') === 'llama-x', seen);
    check('superuser chat: no key and only Groq models → unclear (null), as before', await SuperuserAIInterpreter.interpret('how is the company doing', { departments: [] }, { env: {}, fetch: fakeFetch }) === null);

    const attempts = C.learningAttempts(['gemini-2.5-flash', 'glm-5.3-flash'], 'shared', null);
    check('learning loop: Gemini picks skipped without a Gemini key, others use the shared transport', attempts.length === 1 && attempts[0][1] === 'glm-5.3-flash' && attempts[0][0] === 'shared');

    // Source checks: each job asks the setting (and the bot's three steps are separate)
    const live = read('task-manager/brain/live.ts');
    check('WhatsApp bot: understand / reply / tidy each read their own setting', /chainFor\('wa_understand'\), chainFor\('wa_reply'\), chainFor\('wa_tidy'\)/.test(live) && /brain: \{ llm, promptSections, interpretModels, replyModels, rewriteModels \}/.test(live));
    const voice = read('task-manager/voice/VoiceIntake.ts');
    check('voice notes: speech to text and clean-up read their settings', /chainFor\('voice_transcribe'\)/.test(voice) && /chainFor\('voice_cleanup'\)/.test(voice));
    check('duplicate check reads its setting', /chainFor\('duplicate_check'\)/.test(read('task-manager/WorkspaceService.ts')));
    check('Gemini picks go to Google, not Engy', /startsWith\(GEMINI_PREFIX\)/.test(read('task-manager/brain/llm.ts')));
    const route = read('app/api/task-manager/ai-models/route.ts');
    check('the API is Tech-only (Control Centre guard) on both GET and POST', (route.match(/requireControlCentre\(/g) || []).length === 2);
    const sql = read('supabase/migrations/20261028140001_task_manager_ai_models.sql').split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    check('migration: one new table, RLS on, nothing destructive', /CREATE TABLE IF NOT EXISTS public\.task_manager_ai_models/.test(sql) && /ENABLE ROW LEVEL SECURITY/.test(sql) && !/^\s*(DROP|DELETE|UPDATE|TRUNCATE)\b/im.test(sql) && !/ALTER TABLE public\.(?!task_manager_ai_models)/i.test(sql));
    // 2026-11-02: the Candidate Search jobs are allowed by the follow-up migration that widens the job list
    // 2026-11-15: the newest migration restates the whole list (every earlier job plus the rest of the application's)
    const sqlJobs = read('supabase/migrations/20261115000001_ai_models_all_jobs.sql');
    check('every job in the catalog is allowed by the newest job list (which replaces the earlier ones)', C.AI_JOBS.every(j => sqlJobs.includes(`'${j.key}'`)));
    const earlier = [...read('supabase/migrations/20261114000001_unified_brain_ai_model_job.sql').matchAll(/'([a-z_]+)'/g)].map(m => m[1]).filter(j => /^(wa_|voice_|import_|superuser_|learning_|duplicate_|candidate_|brain_)/.test(j));
    check('and every job that could be saved before can still be saved', earlier.length >= 16 && earlier.every(j => sqlJobs.includes(`'${j}'`)), earlier.filter(j => !sqlJobs.includes(`'${j}'`)));

    // ── Owner 2026-11-15: every AI model configurable (Tech console: Brain → AI models) ──
    console.log('\n7. The rest of the application: each job only gets models its own code can call');
    const NEW_JOBS = ['assistant_interpret', 'hr_plan', 'hr_answer', 'wiki_answer', 'document_ocr', 'invoice_text', 'ocr_vision', 'bill_ocr', 'meter_ocr', 'electricity_explain', 'sop_photo', 'sop_layout', 'ticket_classify', 'admin_chatbot', 'coaching_feedback', 'mailbox_digest', 'satej_fast', 'satej_smart', 'council_default'] as const;
    check('all 19 are in the catalog', NEW_JOBS.every(j => !!C.jobInfo(j)), NEW_JOBS.filter(j => !C.jobInfo(j)));
    check('a Groq text job (admin chatbot) cannot be given a Claude model, an OpenAI model or a picture-reading model',
        ['anthropic:claude-haiku-5-5', 'openai:gpt-5.6-luna', 'groq:qwen/qwen3.8-27b', 'glm-5.3-flash'].every(m => C.modelStatus('admin_chatbot', m, all).status === 'cannot') && C.modelStatus('admin_chatbot', 'groq:openai/gpt-oss-20b', all).status === 'ready');
    // Owner 2026-11-15: ticket sorting runs on the shared transport, so it can use Claude, Engy, Groq and Gemini text models.
    check('ticket sorting can use Claude, Engy, Groq and Gemini text models, but not OpenAI or a picture-only model',
        ['anthropic:claude-haiku-5-5', 'glm-5.3-flash', 'kimi-k3.1-pro', 'groq:openai/gpt-oss-120b', 'gemini-3.1-flash-lite'].every(m => C.modelStatus('ticket_classify', m, all).status === 'ready')
        && ['openai:gpt-5.6-luna', 'groq:qwen/qwen3.8-27b', 'whisper-large-v3'].every(m => C.modelStatus('ticket_classify', m, all).status === 'cannot'));
    check('ticket sorting: Claude Haiku 5.5 first, GLM 5.3 Flash as backup, and backups can be saved', JSON.stringify(C.jobInfo('ticket_classify')!.defaults) === JSON.stringify(['anthropic:claude-haiku-5-5', 'glm-5.3-flash']) && !C.jobInfo('ticket_classify')!.single);
    check('a meter photo job (Groq, pictures) only gets Groq picture models', C.modelStatus('meter_ocr', 'groq:qwen/qwen3.6-27b', all).status === 'ready' && ['groq:llama-3.3-70b-versatile', 'qwen3.8-27b', 'anthropic:claude-sonnet-5-5'].every(m => C.modelStatus('meter_ocr', m, all).status === 'cannot'));
    check('an OpenAI job only gets OpenAI models', C.modelStatus('electricity_explain', 'openai:gpt-5.6-sol', all).status === 'ready' && ['glm-5.3', 'groq:llama-3.3-70b-versatile', 'anthropic:claude-opus-5-5'].every(m => C.modelStatus('electricity_explain', m, all).status === 'cannot'));
    check('scanned documents (Engy, pictures) get only Engy models that read pictures', C.modelStatus('ocr_vision', 'glm-5.3-flash', all).status === 'ready' && ['deepseek-v4-flash-0731', 'groq:qwen/qwen3.8-27b'].every(m => C.modelStatus('ocr_vision', m, all).status === 'cannot'));
    check('the HR assistant gets Groq and Engy text models, nothing else', C.modelStatus('hr_answer', 'groq:openai/gpt-oss-120b', all).status === 'ready' && C.modelStatus('hr_answer', 'glm-5.3', all).status === 'ready' && C.modelStatus('hr_answer', 'anthropic:claude-haiku-5-5', all).status === 'cannot');
    check('the jobs that existed before did NOT gain the new models', ['openai:gpt-5.6-luna', 'groq:qwen/qwen3.8-27b'].every(m => C.modelStatus('wa_reply', m, all).status === 'cannot' && C.modelStatus('import_image', m, all).status === 'cannot' && C.modelStatus('brain_turn', m, all).status === 'cannot'));
    check('there is no job for the HR safety check, the search indexes or call transcription', !['hr_guard', 'hr_safety', 'hr_embeddings', 'coaching_transcribe'].some(j => C.isAiJob(j)));
    check('a raw provider id has no prefix', C.rawModelId('groq:qwen/qwen3.8-27b') === 'qwen/qwen3.8-27b' && C.rawModelId('openai:gpt-5.6-luna') === 'gpt-5.6-luna' && C.rawModelId('glm-5.3') === 'glm-5.3');

    console.log('\n8. Keys and defaults of those jobs');
    // Owner 2026-11-15: one shared set of keys per provider, nothing dedicated to any job.
    check('every Groq job reads the shared Groq keys, any one of the three', ['ticket_classify', 'sop_layout', 'assistant_interpret', 'wa_reply', 'superuser_chat', 'voice_transcribe'].every(j => S.keyReady('groq', j as never, { GROQ_API_KEY_2: 'x' }) && !S.keyReady('groq', j as never, {})));
    check('the old per-job key names count for nothing', ['WHATSAPP_BOT_GROQ_API_KEY', 'GROQ_TASK_CHAT_API_KEY', 'GROQ_LAYOUT_API_KEY', 'GROQ_VOICE_API_KEY'].every(n => !S.keyReady('groq', 'wa_reply', { [n]: 'x' }) && !S.keyReady('groq_speech', 'voice_transcribe', { [n]: 'x' })) && !S.keyReady('gemini', 'learning_loop', { GEMINI_AUTOTUNE_API_KEY: 'x' }));
    check('Gemini: any of the three, or the older GOOGLE_AI_API_KEY', ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GOOGLE_AI_API_KEY'].every(n => S.keyReady('gemini', 'learning_loop', { [n]: 'x' })));
    check('the key list on the screen: one Groq row with three keys, one Gemini row with four names, no per-job rows', (() => { const k = S.keyStatus({}); const g = k.filter(r => r.provider === 'groq'); return g.length === 1 && g[0].keys.map(x => x.name).join() === 'GROQ_API_KEY,GROQ_API_KEY_2,GROQ_API_KEY_3' && k.find(r => r.provider === 'gemini')!.keys.length === 4 && !k.some(r => r.provider === 'groq_speech'); })());
    check('no job names keys of its own any more', C.AI_JOBS.every(j => !('keys' in j)));
    check('the new models are offered: Kimi K3.1 Pro (Engy) and four Gemini models', ['kimi-k3.1-pro', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-4-hydrogen', 'gemini-2.5-flash-lite'].every(id => !!C.modelInfo(id)));
    check('OpenAI jobs need the OpenAI key', S.keyReady('openai', 'mailbox_digest', { OPENAI_API_KEY: 'o' }) && !S.keyReady('openai', 'mailbox_digest', {}));
    check('nothing saved and no env var → the model each job has today', NEW_JOBS.filter(j => j !== 'satej_smart' && j !== 'council_default').every(j => JSON.stringify(S.defaultsFor(j, {})) === JSON.stringify(C.jobInfo(j)!.defaults)));
    check('an env var that already changed a model still does, written as a catalog id',
        S.defaultsFor('wiki_answer', { WIKI_MODEL: 'glm-5.3' })[0] === 'glm-5.3' && S.defaultsFor('electricity_explain', { ELECTRICITY_EXPLAIN_MODEL: 'gpt-x' })[0] === 'openai:gpt-x'
        && S.defaultsFor('assistant_interpret', { GROQ_TASK_CHAT_MODEL: 'llama-x' })[0] === 'groq:llama-x' && S.defaultsFor('satej_fast', { SATEJ_MODEL_FAST: 'kimi-k3' })[0] === 'kimi-k3');
    check('the shared model follows COUNCIL_MODEL; Satej\'s careful steps follow their own variable, else the shared model',
        S.defaultsFor('council_default', { COUNCIL_MODEL: 'glm-5.3' })[0] === 'glm-5.3' && S.defaultsFor('satej_smart', { COUNCIL_MODEL: 'glm-5.3' })[0] === 'glm-5.3' && S.defaultsFor('satej_smart', { COUNCIL_MODEL: 'glm-5.3', SATEJ_MODEL_SMART: 'kimi-k3' })[0] === 'kimi-k3');

    console.log('\n9. Reading a choice at a call site: today\'s model unless a usable choice is saved');
    const M = await import('../ai/modelFor');
    const savedEnv = { ...process.env };
    process.env.GROQ_API_KEY = 'k'; process.env.OPENAI_API_KEY = 'o';
    process.env.COUNCIL_PROVIDER = 'custom'; process.env.COUNCIL_API_KEY = 'k'; process.env.COUNCIL_BASE_URL = 'https://example.invalid/v1';
    table = { error: { code: '42P01', message: 'missing' } };
    await S.savedChains(true);
    check('settings table missing → today\'s model', await M.modelFor('ticket_classify', 'llama-3.3-70b-versatile') === 'llama-3.3-70b-versatile');
    table = { data: [], error: null };
    await S.savedChains(true);
    check('nothing saved → today\'s model, whatever it is (an env override included)', await M.modelFor('ticket_classify', 'some-env-model') === 'some-env-model' && (await M.chosenModels('ticket_classify')).length === 0);
    table = { data: [{ job: 'ticket_classify', models: ['groq:openai/gpt-oss-20b'] }, { job: 'meter_ocr', models: ['anthropic:claude-opus-5-5'] }, { job: 'electricity_explain', models: ['openai:gpt-5.6-sol'] }, { job: 'hr_answer', models: ['glm-5.3', 'groq:openai/gpt-oss-120b', 'made-up'] }], error: null };
    await S.savedChains(true);
    check('a saved choice is returned as the provider\'s own id', await M.modelFor('ticket_classify', 'llama-3.3-70b-versatile') === 'openai/gpt-oss-20b' && await M.modelFor('electricity_explain', 'gpt-5.6-luna') === 'gpt-5.6-sol');
    check('a saved choice the job cannot call is ignored', await M.modelFor('meter_ocr', 'qwen/qwen3.8-27b') === 'qwen/qwen3.8-27b');
    delete process.env.GROQ_API_KEY;
    check('a saved choice whose key is missing is ignored', await M.modelFor('ticket_classify', 'llama-3.3-70b-versatile') === 'llama-3.3-70b-versatile');
    process.env.GROQ_API_KEY = 'k';

    const tried: string[] = [];
    const out1 = await M.runWithModel('ticket_classify', 'llama-3.3-70b-versatile', async m => { tried.push(m); if (m !== 'llama-3.3-70b-versatile') throw new Error('model retired'); return `answered by ${m}`; });
    check('a chosen model that fails costs one attempt, then today\'s model answers', out1 === 'answered by llama-3.3-70b-versatile' && tried.join(' → ') === 'openai/gpt-oss-20b → llama-3.3-70b-versatile', tried);
    tried.length = 0;
    const during = await M.runWithModel('ticket_classify', 'llama-3.3-70b-versatile', async m => { tried.push(m); return m; });
    check('after a failure the choice is rested: the next request goes straight to today\'s model, one call', during === 'llama-3.3-70b-versatile' && tried.length === 1 && (await M.chosenModels('ticket_classify')).length === 0, tried);
    check('resting one job does not touch another', await M.modelFor('electricity_explain', 'gpt-5.6-luna') === 'gpt-5.6-sol');
    M._resetModelRests();
    tried.length = 0;
    const out2 = await M.runWithModel('ticket_classify', 'llama-3.3-70b-versatile', async m => { tried.push(m); return m; });
    check('a chosen model that works is called once', out2 === 'openai/gpt-oss-20b' && tried.length === 1);
    tried.length = 0;
    let threw = '';
    try { await M.runWithModel('coaching_feedback', 'llama-3.3-70b-versatile', async m => { tried.push(m); throw new Error('groq is down'); }); } catch (e) { threw = (e as Error).message; }
    check('nothing chosen → exactly one call, and its own error if it fails (as before)', tried.length === 1 && threw === 'groq is down', tried);
    M.markFailed('electricity_explain');
    check('a call site that retries by hand can rest the choice too', await M.modelFor('electricity_explain', 'gpt-5.6-luna') === 'gpt-5.6-luna');
    M._resetModelRests();
    const db = supabaseAdmin as unknown as { from: unknown };
    const realFrom = db.from;
    db.from = () => { throw new Error('database client broke'); };
    await S.savedChains(true);
    check('the settings read throwing → today\'s model, nothing thrown to the caller', await M.modelFor('ticket_classify', 'llama-3.3-70b-versatile') === 'llama-3.3-70b-versatile');
    db.from = () => ({ select: () => new Promise(() => { /* never answers */ }) });
    const waited = Date.now();
    const slow = S.savedChains(true).catch(() => null); void slow;
    M._resetModelRests();
    check('a database that does not answer holds a request for two seconds at most, then today\'s model is used', await M.modelFor('ticket_classify', 'llama-3.3-70b-versatile') === 'llama-3.3-70b-versatile' && Date.now() - waited < 4000, Date.now() - waited);
    db.from = realFrom;
    M._resetModelRests();
    await S.savedChains(true);

    const H = await import('../../backend/lib/hr-assistant/modelChoice');
    const today = [{ provider: 'groq' as const, model: 'openai/gpt-oss-20b', reasoningEffort: 'low' as const }, { provider: 'engy' as const, model: 'qwen3.8-27b' }, { provider: 'engy' as const, model: 'glm-5.3-flash' }];
    check('HR assistant: nothing chosen → today\'s list, untouched', H.withChosen([], today) === today);
    const hr = await H.hrChain('hr_answer', today);
    check('HR assistant: the chosen models first, then ALL of today\'s list (an unknown choice is dropped)',
        JSON.stringify(hr.map(x => `${x.provider}:${x.model}`)) === JSON.stringify(['engy:glm-5.3', 'groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b', 'engy:qwen3.8-27b', 'engy:glm-5.3-flash']), hr);
    check('HR assistant: a gpt-oss model on Groq keeps its short thinking setting', H.toStep('groq:openai/gpt-oss-120b').reasoningEffort === 'low' && H.toStep('groq:llama-3.3-70b-versatile').reasoningEffort === undefined);
    check('HR assistant: a chosen model already in today\'s list is not tried twice', H.withChosen(['qwen3.8-27b'], today).filter(x => x.model === 'qwen3.8-27b').length === 1);
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;

    console.log('\n10. Saving a one-model job, and what every screen row says');
    table = { data: [], error: null };
    let oneModel = '';
    try { await S.saveChain('admin_chatbot', ['groq:openai/gpt-oss-20b', 'groq:llama-3.3-70b-versatile'], 'tech@test'); } catch (e) { oneModel = (e as Error).message; }
    check('a one-model job refuses a list of two', /uses one model/.test(oneModel), oneModel);
    let wrongKind = '';
    try { await S.saveChain('meter_ocr', ['groq:llama-3.3-70b-versatile'], 'tech@test'); } catch (e) { wrongKind = (e as Error).message; }
    check('a model that cannot do the job is refused when saving', /cannot read images/.test(wrongKind), wrongKind);
    const before = saved.length;
    await S.saveChain('admin_chatbot', ['groq:openai/gpt-oss-20b'], 'tech@test');
    check('one model saves', saved.length === before + 1 && saved.at(-1).job === 'admin_chatbot' && JSON.stringify(saved.at(-1).models) === JSON.stringify(['groq:openai/gpt-oss-20b']));
    const overview = await S.aiModelsOverview({ GROQ_API_KEY: 'k' });
    check('the screen is told which jobs take one model', overview.jobs.find(j => j.key === 'admin_chatbot')!.single === true && overview.jobs.find(j => j.key === 'ticket_classify')!.single === false && overview.jobs.find(j => j.key === 'hr_answer')!.single === false && overview.jobs.find(j => j.key === 'wa_reply')!.single === false);
    const I = await import('../ai/aiInventory');
    check('every row of the inventory can either be changed (a job) or says why not', I.AI_INVENTORY.every(r => !!r.job || !!r.why), I.AI_INVENTORY.filter(r => !r.job && !r.why).map(r => r.feature));
    check('every job named in the inventory exists', I.AI_INVENTORY.every(r => !r.job || !!C.jobInfo(r.job)));
    check('no screen text still sends people to the Control Center for models', !/chosen: 'Control Cent/.test(read('task-manager/ai/aiInventory.ts')));

    console.log('\n11. Each call site reads its choice and keeps today\'s model as the fallback');
    const SITES: Array<[string, RegExp]> = [
        ['backend/lib/ticketing/aiClassifier.ts', /chainFor\('ticket_classify'\)/],
        ['backend/lib/coaching/groqCoach.ts', /modelFor\('coaching_feedback', GROQ_MODEL\)[\s\S]*markFailed\('coaching_feedback'\);\s+return scoreWith\(GROQ_MODEL, input\)/],
        ['app/api/master-admin-chatbot/route.ts', /runWithModel\('admin_chatbot', MODEL,/],
        ['backend/lib/documentBank/ocr.ts', /modelFor\('document_ocr', MODEL\)[\s\S]*callGroqWith\(MODEL, content\)/],
        ['backend/lib/electricity/billOcr.ts', /modelFor\('bill_ocr', MODEL\)[\s\S]*callGroqWith\(MODEL, content\)/],
        ['app/api/ocr/meter/route.ts', /runWithModel\('meter_ocr', MODEL, readMeter\)/],
        ['backend/lib/wiki/ask.ts', /runWithModel\('wiki_answer', WIKI_MODEL,/],
        ['backend/lib/invoices/extract.ts', /runWithModel\('invoice_text', INVOICE_TEXT_MODEL,/],
        ['backend/lib/ocr/vision.ts', /modelFor\('ocr_vision', DEFAULT_VISION_MODEL\)[\s\S]*model: DEFAULT_VISION_MODEL \}\)/],
        ['backend/lib/satej/clients/llm.ts', /runWithModel\(opts\.model === 'fast' \? 'satej_fast' : 'satej_smart', today,/],
        ['backend/lib/satej/chat.ts', /runWithModel\('satej_smart', satejConfig\.modelSmart,/],
        ['backend/lib/satej/voiceScript.ts', /runWithModel\('satej_smart', satejConfig\.modelSmart,/],
        ['backend/lib/council/llm.ts', /runWithModel\('council_default', COUNCIL_MODEL,/],
        ['app/api/electricity/tracker/explain/route.ts', /modelFor\('electricity_explain', LLM_MODEL\)[\s\S]*callModelWith\(LLM_MODEL, aggregates, isBill\)/],
        ['backend/services/mailboxDigest.ts', /modelFor\('mailbox_digest', LLM_MODEL\)/],
        ['app/api/properties/[propertyId]/sop/analyze-layout/route.ts', /runWithModel\('sop_layout', 'qwen\/qwen3\.6-27b',/],
        ['app/api/properties/[propertyId]/sop/completions/[completionId]/score-photo/route.ts', /modelFor\('sop_photo', 'qwen3\.8-27b'\)/],
        ['app/api/properties/[propertyId]/sop/test-vision/route.ts', /modelFor\('sop_photo', 'qwen3\.8-27b'\)/],
        ['backend/lib/hr-assistant/ask.ts', /hrChain\("hr_answer", ANSWER_MODELS\)/],
        ['backend/lib/hr-assistant/planner.ts', /hrChain\("hr_plan", PLANNER_MODELS\)/],
        ['backend/lib/whatsapp/assistant/runtime.ts', /modelFor\('assistant_interpret', ''\)/],
    ];
    for (const [file, re] of SITES) check(file, re.test(read(file)));
    const stillConstant = SITES.map(([file]) => file).filter(file => /\bmodel: (GROQ_MODEL|LLM_MODEL|WIKI_MODEL|INVOICE_TEXT_MODEL|MODEL),/.test(read(file)) || /model: 'qwen(?:\/qwen)?3\.[68]-27b',/.test(read(file)));
    check('no call site still sends its constant in the request (each sends the model it was handed)', stillConstant.length === 0, stillConstant);
    check('the purchase digest retries once on today\'s model before giving up to the rules', /markFailed\('mailbox_digest'\);\s+return classifyOn\(LLM_MODEL, f\)/.test(read('backend/services/mailboxDigest.ts')));
    check('the stored labels name the model that really answered', /modelUsed = `\$\{engyModel\} \(engy\.ai\)`/.test(read('app/api/properties/[propertyId]/sop/completions/[completionId]/score-photo/route.ts')) && /model: called\.model \?\? MODEL/.test(read('backend/lib/documentBank/ocr.ts')) && /model: result\.model,/.test(read('app/api/electricity/tracker/explain/route.ts')));
    check('a council call that names its own model is left alone', /if \(named\) return councilChatWith\(named, messages, purpose, opts\);/.test(read('backend/lib/council/llm.ts')));
    check('the HR safety check still uses its own fixed list', /chatWithFallback\("safety check", GUARD_MODELS,/.test(read('backend/lib/hr-assistant/guardrails.ts')) && !/hrChain|modelFor/.test(read('backend/lib/hr-assistant/guardrails.ts')));
    check('the interpreter takes a model only when its caller names one', /options\.model \|\| env\.GROQ_TASK_CHAT_MODEL \|\| 'llama-3\.3-70b-versatile'/.test(read('backend/lib/whatsapp/interpreter/interpret.mjs')));
    check('the screen is gone from the Control Centre page', !/AiModelsPanel/.test(read('frontend/components/task-manager/TaskManagerTestingDashboard.tsx')));
    const widen = read('supabase/migrations/20261115000001_ai_models_all_jobs.sql').split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    check('migration: only the job list is widened, nothing else is touched', /DROP CONSTRAINT IF EXISTS task_manager_ai_models_job_check/.test(widen) && !/\b(DELETE|UPDATE|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i.test(widen) && !/ALTER TABLE public\.(?!task_manager_ai_models)/i.test(widen));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 AI MODELS TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
