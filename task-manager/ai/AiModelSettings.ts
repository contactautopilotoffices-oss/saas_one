import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveProvider } from '@/backend/lib/council/llm';
import { TaskDatabaseService } from '../TaskDatabaseService';
import { AI_JOBS, AiJob, MAX_CHAIN, Provider, effectiveChain, jobInfo, modelStatus } from './aiCatalog';

/**
 * Owner 2026-10-28 — which model each Task Manager AI job uses (Control Center → "AI models").
 *
 * Saved per job in task_manager_ai_models (20261028140001). Until that file is applied, or whenever it cannot be read,
 * every job runs with today's chain — exactly as before this setting existed. `chainFor` never throws: a saved model that
 * is unknown, cannot do the job or has no key is skipped, and today's chain always follows as the last resort.
 * API keys are only checked for PRESENCE, by name. Their values are never returned, logged or stored here.
 */

type Env = Record<string, string | undefined>;
const has = (env: Env, name: string) => !!String(env[name] ?? '').trim();

const BOT_GROQ_KEYS = ['WHATSAPP_BOT_GROQ_API_KEY', ...[2, 3, 4, 5].map(n => `WHATSAPP_BOT_GROQ_API_KEY_${n}`)];
const GEMINI_KEYS = ['GEMINI_AUTOTUNE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'];

/** The key names a provider is read from, for this job (the superuser chat has its own Groq key). */
export function keyNames(provider: Provider, job?: AiJob): string[] {
    if (provider === 'anthropic') return ['CLAUDE_API_KEY'];
    if (provider === 'engy') return ['COUNCIL_API_KEY', 'COUNCIL_BASE_URL'];
    if (provider === 'groq') return job === 'superuser_chat' ? ['GROQ_TASK_CHAT_API_KEY'] : BOT_GROQ_KEYS;
    if (provider === 'gemini') return GEMINI_KEYS;
    return ['GROQ_VOICE_API_KEY'];
}

/** Can this provider be called for this job right now (its key is set)? */
export function keyReady(provider: Provider, job: AiJob, env: Env = process.env): boolean {
    if (provider === 'engy') {
        // The plain model ids go to the council provider; they only work when it is the Engy-style "custom" provider.
        const r = resolveProvider(env as NodeJS.ProcessEnv);
        return r.provider === 'custom' && !!r.apiKey;
    }
    if (provider === 'gemini') return GEMINI_KEYS.some(n => has(env, n));
    return keyNames(provider, job).some(n => has(env, n));
}

const PROVIDER_LABEL: Record<Provider, string> = {
    anthropic: 'Anthropic (Claude)', engy: 'Engy (GLM, Qwen, DeepSeek, Kimi)', groq: 'Groq (WhatsApp bot)', gemini: 'Google Gemini', groq_speech: 'Groq speech-to-text',
};

/** Per provider: which key names exist and whether each is set. Never a value. */
export function keyStatus(env: Env = process.env) {
    const rows = (['anthropic', 'engy', 'groq', 'gemini', 'groq_speech'] as Provider[]).map(p => ({
        provider: p, label: PROVIDER_LABEL[p], ready: keyReady(p, p === 'groq_speech' ? 'voice_transcribe' : 'wa_understand', env),
        keys: keyNames(p).map(name => ({ name, set: has(env, name) })),
        ...(p === 'engy' ? { note: 'Works only when the council provider resolves to Engy (COUNCIL_PROVIDER=custom, or no OpenAI / Groq council key set).' } : {}),
    }));
    rows.push({ provider: 'groq', label: 'Groq (superuser chat)', ready: has(env, 'GROQ_TASK_CHAT_API_KEY'), keys: [{ name: 'GROQ_TASK_CHAT_API_KEY', set: has(env, 'GROQ_TASK_CHAT_API_KEY') }] });
    return rows;
}

/** Today's chain for a job, including the two that an environment variable could already change. */
export function defaultsFor(job: AiJob, env: Env = process.env): string[] {
    if (job === 'superuser_chat') return [`groq:${String(env.GROQ_TASK_CHAT_MODEL || '').trim() || 'llama-3.3-70b-versatile'}`];
    if (job === 'learning_loop') {
        const drafts = String(env.BOT_AUTOTUNE_DRAFT_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
        return [...(drafts.length ? drafts : ['gemini-3.8-flash', 'gemini-2.5-flash']), 'glm-5.3-flash'];
    }
    return [...(jobInfo(job)?.defaults ?? [])];
}

// ── saved settings, read at most once a minute per server instance ──────────────────────────────────────────────────
const MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204']);
let cache: { at: number; byJob: Map<AiJob, string[]>; tableMissing: boolean } | null = null;
const CACHE_MS = 60_000;

export async function savedChains(fresh = false): Promise<{ byJob: Map<AiJob, string[]>; tableMissing: boolean }> {
    if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache;
    const byJob = new Map<AiJob, string[]>();
    let tableMissing = false;
    try {
        const { data, error } = await supabaseAdmin.from('task_manager_ai_models').select('job, models');
        if (error) {
            tableMissing = MISSING.has(String(error.code ?? ''));
            if (!tableMissing) console.error('[AiModelSettings] could not read the model settings; using today\'s models:', error.message);
        } else {
            for (const r of data || []) {
                const job = r.job as AiJob;
                if (jobInfo(job) && Array.isArray(r.models)) byJob.set(job, (r.models as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, MAX_CHAIN));
            }
        }
    } catch (err) {
        console.error('[AiModelSettings] could not read the model settings; using today\'s models:', err instanceof Error ? err.message : err);
    }
    cache = { at: Date.now(), byJob, tableMissing };
    return cache;
}

/** The models a job runs with right now, in order. Never throws; never empty while the job has a default. */
export async function chainFor(job: AiJob, env: Env = process.env): Promise<string[]> {
    const defaults = defaultsFor(job, env);
    try {
        const { byJob } = await savedChains();
        return effectiveChain(job, byJob.get(job), (p, j) => keyReady(p, j, env), defaults);
    } catch {
        return defaults;
    }
}

/** Saves a job's main + backups (`null` = back to today's models). Refuses a model that cannot do the job. */
export async function saveChain(job: AiJob, models: string[] | null, actor?: string): Promise<{ warnings: string[] }> {
    const j = jobInfo(job);
    if (!j) throw new Error('Unknown job');
    const warnings: string[] = [];
    if (models !== null) {
        const list = [...new Set(models.map(m => String(m).trim()).filter(Boolean))];
        if (list.length === 0) throw new Error('Choose at least a main model, or reset to the default.');
        if (list.length > MAX_CHAIN) throw new Error(`At most ${MAX_CHAIN} models (a main and ${MAX_CHAIN - 1} backups).`);
        for (const id of list) {
            const s = modelStatus(job, id, (p, jj) => keyReady(p, jj));
            if (s.status === 'cannot') throw new Error(`${s.reason}. Choose another model for "${j.label}".`);
            if (s.status === 'no_key') warnings.push(`${id}: API key missing, so it is skipped until the key is added.`);
        }
        models = list;
    }
    const { error } = models === null
        ? await supabaseAdmin.from('task_manager_ai_models').delete().eq('job', job)
        : await supabaseAdmin.from('task_manager_ai_models').upsert({ job, models, updated_by: actor || null, updated_at: new Date().toISOString() }, { onConflict: 'job' });
    if (error) throw new Error('Could not save the model setting. Run supabase/migrations/20261028140001_task_manager_ai_models.sql in the Supabase SQL Editor first.');
    cache = null;
    await TaskDatabaseService.logAudit({ event_type: 'task_ai_models_updated', details: { job, models, actor: actor || null } });
    return { warnings };
}

/**
 * Owner 2026-10-28: "Test" in the Control Center — one tiny request (a few tokens) to see that the model answers with our
 * key. Never throws; the error text names the problem, never a key. Speech models are checked by key only (a real test
 * would need a voice note); an image-reading job is tested with a short text request to the same model and provider.
 */
export async function testModel(job: AiJob, model: string, env: Env = process.env): Promise<{ ok: boolean | null; message: string; ms?: number }> {
    const s = modelStatus(job, model, (p, j) => keyReady(p, j, env));
    if (s.status !== 'ready') return { ok: false, message: s.reason };
    if (jobInfo(job)?.needs === 'speech') return { ok: null, message: 'Key is set. Speech models are not test-called (a test needs a voice note).' };
    const started = Date.now();
    try {
        if (job === 'superuser_chat' && model.startsWith('groq:')) {
            // This job's own Groq key, exactly as the interpreter calls it
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST', signal: AbortSignal.timeout(15_000),
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(env.GROQ_TASK_CHAT_API_KEY ?? '').trim()}` },
                body: JSON.stringify({ model: model.slice('groq:'.length), temperature: 0, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }),
            });
            if (!res.ok) return { ok: false, message: `Groq answered HTTP ${res.status}`, ms: Date.now() - started };
        } else {
            const { engyBrainLlm } = await import('../brain/llm');
            const r = await engyBrainLlm({ timeoutMs: 15_000 }).complete({ model, system: 'Reply with the word OK and nothing else.', user: 'OK?', maxTokens: 20 });
            if (!r.text.trim()) return { ok: false, message: 'The model returned nothing', ms: Date.now() - started };
        }
        return { ok: true, message: 'Answered', ms: Date.now() - started };
    } catch (err) {
        return { ok: false, message: (err instanceof Error ? err.message : 'It did not answer').slice(0, 200), ms: Date.now() - started };
    }
}

/** Everything the Control Center shows (no key values). */
export async function aiModelsOverview(env: Env = process.env) {
    const { byJob, tableMissing } = await savedChains(true);
    const ready = (p: Provider, j: AiJob) => keyReady(p, j, env);
    return {
        tableMissing,
        keys: keyStatus(env),
        jobs: AI_JOBS.map(j => {
            const defaults = defaultsFor(j.key, env);
            const saved = byJob.get(j.key) ?? null;
            return {
                key: j.key, label: j.label, hint: j.hint, group: j.group, needs: j.needs,
                defaults, saved, effective: effectiveChain(j.key, saved, ready, defaults),
            };
        }),
    };
}
