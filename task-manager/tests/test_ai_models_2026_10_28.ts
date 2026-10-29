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
    const env = { CLAUDE_API_KEY: 'x', WHATSAPP_BOT_GROQ_API_KEY_3: 'y', GROQ_TASK_CHAT_API_KEY: '', GEMINI_API_KEY: 'z', COUNCIL_PROVIDER: 'custom', COUNCIL_API_KEY: 'k', COUNCIL_BASE_URL: 'https://example.invalid/v1' };
    check('Claude / bot Groq (any of the 5) / Gemini / Engy ready', S.keyReady('anthropic', 'wa_reply', env) && S.keyReady('groq', 'wa_reply', env) && S.keyReady('gemini', 'wa_reply', env) && S.keyReady('engy', 'wa_reply', env));
    check('superuser chat uses its OWN Groq key (empty → not ready)', !S.keyReady('groq', 'superuser_chat', env));
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
    const r = await SuperuserAIInterpreter.interpret('how is the company doing', { departments: [] }, { env: { GROQ_TASK_CHAT_API_KEY: 'k' }, fetch: fakeFetch, models: ['groq:bad', 'groq:good'] });
    check('superuser chat: an erroring model hands over to the backup', seen.join(',') === 'bad,good' && r?.kind === 'org_overview', { seen, r });
    seen.length = 0;
    await SuperuserAIInterpreter.interpret('how is the company doing', { departments: [] }, { env: { GROQ_TASK_CHAT_API_KEY: 'k', GROQ_TASK_CHAT_MODEL: 'llama-x' }, fetch: fakeFetch });
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
    check('every job in the catalog is allowed by the migration', C.AI_JOBS.every(j => sql.includes(`'${j.key}'`)));

    check('no network used', net.length === 0, net);
    console.log(failures === 0 ? '\n🎉 AI MODELS TESTS PASSED\n' : `\n❌ ${failures} FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
