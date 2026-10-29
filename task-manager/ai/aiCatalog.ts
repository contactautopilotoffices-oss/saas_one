/**
 * Owner 2026-10-28 — the Task Manager's AI jobs, the models each can use, and today's default chain for each.
 * Pure data and pure decisions (no database, no network, no key values): shared by the server, the Control Center
 * screen and the tests. A model id carries its provider the way the transports already read it:
 *   'anthropic:…'  Claude (CLAUDE_API_KEY)          'groq:…'   Groq (the job's own Groq key)
 *   'gemini-…'     Google Gemini                     plain id   the council provider (Engy: COUNCIL_PROVIDER=custom)
 *   'whisper-…'    Groq speech-to-text (GROQ_VOICE_API_KEY)
 */

export type AiJob =
    | 'wa_understand' | 'wa_reply' | 'wa_tidy'
    | 'voice_transcribe' | 'voice_cleanup'
    | 'import_image' | 'import_text'
    | 'superuser_chat' | 'learning_loop' | 'duplicate_check';

export type Capability = 'chat' | 'vision' | 'speech';
export type Provider = 'anthropic' | 'engy' | 'groq' | 'gemini' | 'groq_speech';

export interface ModelInfo { id: string; label: string; provider: Provider; can: readonly Capability[]; note?: string }

/**
 * Every model offered in the dropdowns. Only ids this repo already uses or the provider documents for our key
 * (Engy: COUNCIL_MODEL_CHOICES; Claude: the 5.x family). "vision" only where reading images is proven here.
 */
export const AI_MODELS: readonly ModelInfo[] = [
    { id: 'anthropic:claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic', can: ['chat', 'vision'], note: 'fast' },
    { id: 'anthropic:claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic', can: ['chat', 'vision'] },
    { id: 'anthropic:claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic', can: ['chat', 'vision'], note: 'strongest, slowest, dearest' },
    { id: 'anthropic:claude-fable-5-1', label: 'Claude Fable 5.1', provider: 'anthropic', can: ['chat', 'vision'] },
    { id: 'glm-5.3-flash', label: 'GLM 5.3 Flash (Engy)', provider: 'engy', can: ['chat', 'vision'] },
    { id: 'qwen3.8-27b', label: 'Qwen 3.8 27B (Engy)', provider: 'engy', can: ['chat', 'vision'] },
    { id: 'qwen3.6-35b-a3b', label: 'Qwen 3.6 35B A3B (Engy)', provider: 'engy', can: ['chat'] },
    { id: 'deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash (Engy)', provider: 'engy', can: ['chat'] },
    { id: 'glm-5.2', label: 'GLM 5.2 (Engy)', provider: 'engy', can: ['chat'] },
    { id: 'glm-5.3', label: 'GLM 5.3 (Engy)', provider: 'engy', can: ['chat'] },
    { id: 'kimi-k3', label: 'Kimi K3 (Engy)', provider: 'engy', can: ['chat'] },
    { id: 'groq:openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)', provider: 'groq', can: ['chat'], note: 'very fast' },
    { id: 'groq:openai/gpt-oss-20b', label: 'GPT-OSS 20B (Groq)', provider: 'groq', can: ['chat'], note: 'very fast' },
    { id: 'groq:llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', provider: 'groq', can: ['chat'], note: 'very fast' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'gemini', can: ['chat'] },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', can: ['chat'] },
    { id: 'whisper-large-v3', label: 'Whisper Large v3 (Groq)', provider: 'groq_speech', can: ['speech'], note: 'better on Hindi / Hinglish' },
    { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (Groq)', provider: 'groq_speech', can: ['speech'], note: 'faster' },
];

export interface JobInfo {
    key: AiJob;
    label: string;
    /** What it does, in plain words. */
    hint: string;
    group: 'WhatsApp bot' | 'Voice notes' | 'Task import' | 'Other';
    needs: Capability;
    /** Providers this job's code can actually call (a model of another provider "cannot do this job"). */
    providers: readonly Provider[];
    /** Today's chain, exactly as the code had it before this setting existed. Always the last resort. */
    defaults: readonly string[];
}

const BRAIN_DEFAULT = ['anthropic:claude-haiku-5-5', 'glm-5.3-flash', 'qwen3.8-27b'] as const;
const IMPORT_DEFAULT = ['anthropic:claude-sonnet-5-5', 'qwen3.8-27b', 'glm-5.3-flash'] as const;
const CHAT_PROVIDERS: readonly Provider[] = ['anthropic', 'engy', 'groq', 'gemini'];

export const AI_JOBS: readonly JobInfo[] = [
    { key: 'wa_understand', label: 'Understanding the message', hint: 'Reads what the person wants (the step that decides actions)', group: 'WhatsApp bot', needs: 'chat', providers: CHAT_PROVIDERS, defaults: BRAIN_DEFAULT },
    { key: 'wa_reply', label: 'Writing the reply', hint: 'Turns the settled facts into a short WhatsApp message', group: 'WhatsApp bot', needs: 'chat', providers: CHAT_PROVIDERS, defaults: BRAIN_DEFAULT },
    { key: 'wa_tidy', label: 'Tidying the message', hint: 'Rewrites a follow-up ("make it tomorrow") using the earlier chat', group: 'WhatsApp bot', needs: 'chat', providers: CHAT_PROVIDERS, defaults: BRAIN_DEFAULT },
    { key: 'voice_transcribe', label: 'Speech to text', hint: 'Turns a WhatsApp voice note into text', group: 'Voice notes', needs: 'speech', providers: ['groq_speech'], defaults: ['whisper-large-v3', 'whisper-large-v3-turbo'] },
    { key: 'voice_cleanup', label: 'Cleaning up the text', hint: 'Fixes the transcript before the bot reads it', group: 'Voice notes', needs: 'chat', providers: CHAT_PROVIDERS, defaults: ['qwen3.8-27b', 'glm-5.3-flash'] },
    { key: 'import_image', label: 'Reading photos and screenshots', hint: 'Reads a task list from an image', group: 'Task import', needs: 'vision', providers: ['anthropic', 'engy'], defaults: IMPORT_DEFAULT },
    { key: 'import_text', label: 'Reading text and Excel', hint: 'Turns a pasted list or a sheet into tasks', group: 'Task import', needs: 'chat', providers: ['anthropic', 'engy'], defaults: IMPORT_DEFAULT },
    { key: 'duplicate_check', label: 'Duplicate task check', hint: 'Asks whether a new task means the same work as an open one', group: 'Other', needs: 'chat', providers: CHAT_PROVIDERS, defaults: ['qwen3.8-27b', 'glm-5.3-flash'] },
    { key: 'superuser_chat', label: 'Superuser chat', hint: 'Understands a superuser\'s WhatsApp question about teams', group: 'Other', needs: 'chat', providers: CHAT_PROVIDERS, defaults: ['groq:llama-3.3-70b-versatile'] },
    { key: 'learning_loop', label: 'Learning loop', hint: 'Review summaries and nightly draft instructions (admin only)', group: 'Other', needs: 'chat', providers: CHAT_PROVIDERS, defaults: ['anthropic:claude-sonnet-5-5', 'gemini-3.8-flash', 'gemini-2.5-flash', 'glm-5.3-flash'] },
];

export const jobInfo = (job: AiJob): JobInfo | undefined => AI_JOBS.find(j => j.key === job);
export const modelInfo = (id: string): ModelInfo | undefined => AI_MODELS.find(m => m.id === id);
export const isAiJob = (s: unknown): s is AiJob => typeof s === 'string' && AI_JOBS.some(j => j.key === s);

/** Main + backups, at most this many. */
export const MAX_CHAIN = 4;

export type ModelStatus = 'ready' | 'no_key' | 'cannot';

/** Why a model can or cannot be used for a job, given which providers have their key. Never throws. */
export function modelStatus(job: AiJob, id: string, keyReady: (provider: Provider, job: AiJob) => boolean): { status: ModelStatus; reason: string } {
    const j = jobInfo(job);
    const m = modelInfo(id);
    if (!j) return { status: 'cannot', reason: 'Unknown job' };
    if (!m) return { status: 'cannot', reason: 'Unknown model' };
    if (!m.can.includes(j.needs)) {
        const what = j.needs === 'vision' ? 'read images' : j.needs === 'speech' ? 'turn speech into text' : 'write text';
        return { status: 'cannot', reason: `${m.label} cannot ${what}` };
    }
    if (!j.providers.includes(m.provider)) return { status: 'cannot', reason: `This job cannot call ${m.label} yet` };
    if (!keyReady(m.provider, job)) return { status: 'no_key', reason: 'API key missing' };
    return { status: 'ready', reason: 'Ready' };
}

/**
 * The chain a job runs with: the saved main + backups that are usable right now, then today's defaults (never
 * repeated) as the last resort. A bad, unknown or keyless saved model is skipped, so a setting can never stop a job.
 */
export function effectiveChain(job: AiJob, saved: readonly string[] | null | undefined, keyReady: (provider: Provider, job: AiJob) => boolean, defaults?: readonly string[]): string[] {
    const base = [...(defaults ?? jobInfo(job)?.defaults ?? [])];
    const chosen = (saved ?? []).filter(id => modelStatus(job, id, keyReady).status === 'ready');
    const out: string[] = [];
    for (const id of [...chosen, ...base]) if (!out.includes(id)) out.push(id);
    return out;
}

/**
 * Owner 2026-10-28: the learning loop's (client, model) attempts for a chain. Gemini models use the loop's own Gemini client
 * (skipped when no Gemini key); every other model uses the shared transport.
 */
export function learningAttempts<T>(chain: readonly string[], shared: T, gemini: T | null): Array<[T, string]> {
    const out: Array<[T, string]> = [];
    for (const model of chain) {
        if (model.startsWith('gemini-')) { if (gemini) out.push([gemini, model]); }
        else out.push([shared, model]);
    }
    return out;
}
