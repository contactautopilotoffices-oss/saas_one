/**
 * Owner 2026-10-28 — the Task Manager's AI jobs, the models each can use, and today's default chain for each.
 * Pure data and pure decisions (no database, no network, no key values): shared by the server, the Control Center
 * screen and the tests. A model id carries its provider the way the transports already read it:
 *   'anthropic:…'  Claude (CLAUDE_API_KEY)          'groq:…'   Groq (the shared GROQ_API_KEY → _2 → _3)
 *   'gemini-…'     Google Gemini                     plain id   the council provider (Engy: COUNCIL_PROVIDER=custom)
 *   'whisper-…'    Groq speech-to-text (the same Groq keys)    'sarvam:…' Sarvam speech-to-text (SARVAM_API_KEY)
 */

export type AiJob =
    | 'wa_understand' | 'wa_reply' | 'wa_tidy'
    | 'voice_transcribe' | 'voice_cleanup'
    | 'import_image' | 'import_text'
    | 'superuser_chat' | 'learning_loop' | 'duplicate_check'
    // Owner 2026-11-02: Candidate Search (Tech console tab) picks its models here too
    | 'candidate_parse' | 'candidate_rank'
    // Owner 2026-11-03: the AI fix for flagged sheet rows (HR approves every change)
    | 'candidate_fix'
    // Owner 2026-11-06: "AI suggested keywords" under the Candidate Search bar
    | 'candidate_suggest'
    // Owner 2026-11-11: reading details (education, skills, employers) out of uploaded resumes
    | 'candidate_extract'
    // Owner 2026-11-14: the Unified Brain's one model step (docs/WHATSAPP_UNIFIED_BRAIN_PLAN.md)
    | 'brain_turn'
    // Owner 2026-11-15: "every AI model configurable" (Brain → AI models). The rest of the application's model calls.
    // Each of these can only be pointed at models its own code can call, and each keeps today's model as its fallback.
    | 'assistant_interpret'
    | 'hr_plan' | 'hr_answer'
    | 'wiki_answer' | 'document_ocr'
    | 'invoice_text' | 'ocr_vision'
    | 'bill_ocr' | 'meter_ocr' | 'electricity_explain' | 'sop_photo' | 'sop_layout'
    | 'ticket_classify' | 'admin_chatbot' | 'coaching_feedback'
    | 'mailbox_digest' | 'satej_fast' | 'satej_smart'
    | 'council_default'
    // Owner 2026-11-16: the Recruitment Calls tab (a recorded screening call: speech to text, then the reading)
    | 'call_transcribe' | 'call_analyse';

export type Capability = 'chat' | 'vision' | 'speech';
export type Provider = 'anthropic' | 'engy' | 'groq' | 'gemini' | 'groq_speech' | 'openai' | 'sarvam';

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
    { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (Engy)', provider: 'engy', can: ['chat', 'vision'] },
    { id: 'deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash (Engy)', provider: 'engy', can: ['chat'] },
    { id: 'glm-5.2', label: 'GLM 5.2 (Engy)', provider: 'engy', can: ['chat'] },
    { id: 'glm-5.3', label: 'GLM 5.3 (Engy)', provider: 'engy', can: ['chat'] },
    { id: 'kimi-k3', label: 'Kimi K3 (Engy)', provider: 'engy', can: ['chat'] },
    // 2026-11-15 (owner): on the Engy key. Text only until it has read a picture here.
    { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro (Engy)', provider: 'engy', can: ['chat'] },
    { id: 'groq:openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)', provider: 'groq', can: ['chat'], note: 'very fast' },
    { id: 'groq:openai/gpt-oss-20b', label: 'GPT-OSS 20B (Groq)', provider: 'groq', can: ['chat'], note: 'very fast' },
    { id: 'groq:llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', provider: 'groq', can: ['chat'], note: 'very fast' },
    // 2026-11-15: the two Groq models this repo already reads pictures with (document, bill, meter and SOP reading).
    // Vision only, so they are never offered to a job that writes text.
    { id: 'groq:qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Groq)', provider: 'groq', can: ['vision'] },
    { id: 'groq:qwen/qwen3.6-27b', label: 'Qwen 3.6 27B (Groq)', provider: 'groq', can: ['vision'] },
    // 2026-11-15: the OpenAI chat models this repo already calls (backend/lib/council/llm.ts names all three).
    { id: 'openai:gpt-5.6-luna', label: 'GPT 5.6 Luna (OpenAI)', provider: 'openai', can: ['chat'] },
    { id: 'openai:gpt-5.6-terra', label: 'GPT 5.6 Terra (OpenAI)', provider: 'openai', can: ['chat'] },
    { id: 'openai:gpt-5.6-sol', label: 'GPT 5.6 Sol (OpenAI)', provider: 'openai', can: ['chat'] },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'gemini', can: ['chat'] },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', can: ['chat'] },
    // 2026-11-15 (owner): the other Gemini models on the key. Text only until each has read a picture here.
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', provider: 'gemini', can: ['chat'] },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', provider: 'gemini', can: ['chat'] },
    { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', provider: 'gemini', can: ['chat'] },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'gemini', can: ['chat'] },
    // 2026-11-15 (owner: "sarvam goes first"): built for Indian languages. Voice notes up to 30 s; longer ones go to Whisper.
    { id: 'sarvam:saaras:v4', label: 'Sarvam Saaras v4', provider: 'sarvam', can: ['speech'], note: 'Indian languages; notes up to 30 s' },
    { id: 'whisper-large-v3', label: 'Whisper Large v3 (Groq)', provider: 'groq_speech', can: ['speech'], note: 'better on Hindi / Hinglish' },
    { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (Groq)', provider: 'groq_speech', can: ['speech'], note: 'faster' },
];

export interface JobInfo {
    key: AiJob;
    label: string;
    /** What it does, in plain words. */
    hint: string;
    group: 'WhatsApp bot' | 'Voice notes' | 'Task import' | 'Other' | 'Candidate Search' | 'Unified brain'
        | 'WhatsApp assistant' | 'HR' | 'Documents' | 'Finance' | 'Facilities' | 'Tickets' | 'CRM' | 'Procurement' | 'Agents' | 'Admin';
    needs: Capability;
    /** Providers this job's code can actually call (a model of another provider "cannot do this job"). */
    providers: readonly Provider[];
    /** Today's chain, exactly as the code had it before this setting existed. Always the last resort. */
    defaults: readonly string[];
    /**
     * The job's code calls ONE model (it has no list of backups). The setting is then a single model; if a call with it
     * fails, that one request is repeated with today's model (task-manager/ai/modelFor.ts).
     */
    single?: boolean;
    /** An environment variable that could already change this job's model. It still does, when nothing is saved here. */
    defaultEnv?: string;
    /** How a raw id from `defaultEnv` is written as a catalog id ('groq:' / 'openai:'); plain ids need none. */
    defaultPrefix?: 'groq:' | 'openai:';
}

const BRAIN_DEFAULT = ['anthropic:claude-haiku-5-5', 'glm-5.3-flash', 'qwen3.8-27b'] as const;
const IMPORT_DEFAULT = ['anthropic:claude-sonnet-5-5', 'qwen3.8-27b', 'glm-5.3-flash'] as const;
const CHAT_PROVIDERS: readonly Provider[] = ['anthropic', 'engy', 'groq', 'gemini'];
/** Owner 2026-11-02: Candidate Search runs on Claude Opus 5.5 unless the Control Center picks otherwise. */
const CANDIDATE_DEFAULT = ['anthropic:claude-opus-5-5'] as const;
/** AI fix: HR approves every suggested change, so a wrong one costs little; a fast tier first (doctrine L10). */
const CANDIDATE_FIX_DEFAULT = ['anthropic:claude-haiku-5-5', 'anthropic:claude-sonnet-5-5'] as const;
/** Keyword suggestions: HR picks what to use and code drops terms not on any record, and they show while typing: fast tier. */
const CANDIDATE_SUGGEST_DEFAULT = ['anthropic:claude-haiku-5-5'] as const;
// Owner 2026-11-11: fills only empty fields and HR reviews everything, so the fast tier first (doctrine L10)
const CANDIDATE_EXTRACT_DEFAULT = ['anthropic:claude-haiku-5-5', 'anthropic:claude-sonnet-5-5'] as const;
/**
 * Owner 2026-11-14: the Unified Brain starts on Claude Opus 5.5 and steps down on a failure; the tier is meant to be
 * re-chosen here from the eval (doctrine L2, L10). It needs tool calling, so only providers with a tool adapter.
 */
const BRAIN_TURN_DEFAULT = ['anthropic:claude-opus-5-5', 'anthropic:claude-sonnet-5-5', 'anthropic:claude-haiku-5-5', 'glm-5.3-flash'] as const;
/**
 * Owner 2026-11-16: a call's reading sits next to a decision about a person, so a wrong "not interested" costs a lot
 * (doctrine L10): the larger tier first, Sonnet as the backup. The transcription chain is the voice notes' (large-v3
 * first: better on Hindi / Hinglish).
 */
const CALL_ANALYSE_DEFAULT = ['anthropic:claude-opus-5-5', 'anthropic:claude-sonnet-5-5'] as const;
const CALL_TRANSCRIBE_DEFAULT = ['whisper-large-v3', 'whisper-large-v3-turbo'] as const;


export const AI_JOBS: readonly JobInfo[] = [
    { key: 'wa_understand', label: 'Understanding the message', hint: 'Reads what the person wants (the step that decides actions)', group: 'WhatsApp bot', needs: 'chat', providers: CHAT_PROVIDERS, defaults: BRAIN_DEFAULT },
    { key: 'wa_reply', label: 'Writing the reply', hint: 'Turns the settled facts into a short WhatsApp message', group: 'WhatsApp bot', needs: 'chat', providers: CHAT_PROVIDERS, defaults: BRAIN_DEFAULT },
    { key: 'wa_tidy', label: 'Tidying the message', hint: 'Rewrites a follow-up ("make it tomorrow") using the earlier chat', group: 'WhatsApp bot', needs: 'chat', providers: CHAT_PROVIDERS, defaults: BRAIN_DEFAULT },
    { key: 'voice_transcribe', label: 'Speech to text', hint: 'Turns a WhatsApp voice note into text', group: 'Voice notes', needs: 'speech', providers: ['sarvam', 'groq_speech'], defaults: ['sarvam:saaras:v4', 'whisper-large-v3', 'whisper-large-v3-turbo'] },
    { key: 'voice_cleanup', label: 'Cleaning up the text', hint: 'Fixes the transcript before the bot reads it', group: 'Voice notes', needs: 'chat', providers: CHAT_PROVIDERS, defaults: ['qwen3.8-27b', 'glm-5.3-flash'] },
    { key: 'import_image', label: 'Reading photos and screenshots', hint: 'Reads a task list from an image', group: 'Task import', needs: 'vision', providers: ['anthropic', 'engy'], defaults: IMPORT_DEFAULT },
    { key: 'import_text', label: 'Reading text and Excel', hint: 'Turns a pasted list or a sheet into tasks', group: 'Task import', needs: 'chat', providers: ['anthropic', 'engy'], defaults: IMPORT_DEFAULT },
    { key: 'duplicate_check', label: 'Duplicate task check', hint: 'Asks whether a new task means the same work as an open one', group: 'Other', needs: 'chat', providers: CHAT_PROVIDERS, defaults: ['qwen3.8-27b', 'glm-5.3-flash'] },
    // 2026-11-02: 'superuser_chat' retired (Smart chat answers superusers); kept in the AiJob type so old settings still read.
    { key: 'learning_loop', label: 'Learning loop', hint: 'Review summaries and nightly draft instructions (admin only)', group: 'Other', needs: 'chat', providers: CHAT_PROVIDERS, defaults: ['anthropic:claude-sonnet-5-5', 'gemini-3.8-flash', 'gemini-2.5-flash', 'glm-5.3-flash'] },
    { key: 'candidate_parse', label: 'Reading the search', hint: 'Turns an HR request or job description into filters (experience, notice, salary, location)', group: 'Candidate Search', needs: 'chat', providers: CHAT_PROVIDERS, defaults: CANDIDATE_DEFAULT },
    { key: 'candidate_rank', label: 'Ranking candidates', hint: 'Scores the shortlisted records against the request and explains each pick', group: 'Candidate Search', needs: 'chat', providers: CHAT_PROVIDERS, defaults: CANDIDATE_DEFAULT },
    { key: 'candidate_fix', label: 'Fixing flagged rows', hint: 'Suggests corrected values for sheet rows with problems; HR approves each change', group: 'Candidate Search', needs: 'chat', providers: CHAT_PROVIDERS, defaults: CANDIDATE_FIX_DEFAULT },
    { key: 'candidate_suggest', label: 'Suggesting keywords', hint: 'Offers related search terms under the keyword box as soon as it answers; the number of candidates who have each term is filled in beside it afterwards', group: 'Candidate Search', needs: 'chat', providers: CHAT_PROVIDERS, defaults: CANDIDATE_SUGGEST_DEFAULT },
    { key: 'brain_turn', label: 'The brain turn', hint: 'Reads the message, looks things up with its skills, and answers or proposes an action (tickets, rooms, readings, wiki, memory). The first model that answers is used; the rest are backups', group: 'Unified brain', needs: 'chat', providers: ['anthropic', 'engy', 'groq'], defaults: BRAIN_TURN_DEFAULT },
    { key: 'candidate_extract', label: 'Reading resumes', hint: 'Reads education, industry, skills and employers out of each uploaded resume into the candidate\'s empty fields; one call per resume. A scanned PDF is typed out first by the Claude model in this list', group: 'Candidate Search', needs: 'chat', providers: CHAT_PROVIDERS, defaults: CANDIDATE_EXTRACT_DEFAULT },
    { key: 'call_transcribe', label: 'Calls: speech to text', hint: 'Turns an uploaded screening-call recording into a transcript with time stamps. The first model that answers is used; the rest are backups', group: 'Candidate Search', needs: 'speech', providers: ['groq_speech'], defaults: CALL_TRANSCRIBE_DEFAULT },
    { key: 'call_analyse', label: 'Calls: reading the call', hint: 'Reads a screening call\'s transcript for sentiment, interest, the concerns raised and the facts heard (pay, notice, location), each with a quote. Advisory only: a person applies each fact. The first model that answers is used; the rest are backups', group: 'Candidate Search', needs: 'chat', providers: CHAT_PROVIDERS, defaults: CALL_ANALYSE_DEFAULT },

    // ── Owner 2026-11-15: the rest of the application (Brain → AI models) ──
    // `providers` is the provider each job's own code calls; `defaults` is the model it had on 2026-11-15.
    { key: 'assistant_interpret', label: 'Reading the message', hint: 'The older WhatsApp assistant (meeting rooms and tickets): works out what the person wants', group: 'WhatsApp assistant', needs: 'chat', providers: ['groq'], defaults: ['groq:llama-3.3-70b-versatile'], single: true, defaultEnv: 'GROQ_TASK_CHAT_MODEL', defaultPrefix: 'groq:' },
    { key: 'hr_plan', label: 'Working out the question', hint: 'HR assistant: decides what to look up in the HR policies. The first model that answers is used; the rest are backups', group: 'HR', needs: 'chat', providers: ['groq', 'engy'], defaults: ['groq:openai/gpt-oss-20b', 'qwen3.8-27b', 'glm-5.3-flash'] },
    { key: 'hr_answer', label: 'Writing the answer', hint: 'HR assistant: writes the answer from the HR policies it found. The first model that answers is used; the rest are backups', group: 'HR', needs: 'chat', providers: ['groq', 'engy'], defaults: ['groq:openai/gpt-oss-20b', 'qwen3.8-27b', 'glm-5.3-flash'] },
    { key: 'wiki_answer', label: 'Wiki answers', hint: 'Answers a question from the organisation wiki (also what the brain\'s knowledge skill uses)', group: 'Documents', needs: 'chat', providers: ['engy'], defaults: ['deepseek-v4-flash-0731'], single: true, defaultEnv: 'WIKI_MODEL' },
    { key: 'document_ocr', label: 'Reading uploaded documents', hint: 'Document Bank: reads the details out of an uploaded document or picture', group: 'Documents', needs: 'vision', providers: ['groq'], defaults: ['groq:qwen/qwen3.8-27b'], single: true },
    { key: 'invoice_text', label: 'Reading invoices from text', hint: 'Reads supplier, amounts and line items out of an invoice PDF that has text in it', group: 'Finance', needs: 'chat', providers: ['engy'], defaults: ['deepseek-v4-flash-0731'], single: true, defaultEnv: 'INVOICE_EXTRACT_MODEL' },
    { key: 'ocr_vision', label: 'Reading scanned documents', hint: 'Reads invoices, petty-cash bills and scanned PDFs that are pictures', group: 'Finance', needs: 'vision', providers: ['engy'], defaults: ['qwen3.8-27b'], single: true, defaultEnv: 'OCR_VISION_MODEL' },
    { key: 'bill_ocr', label: 'Reading electricity bills', hint: 'Reads units, amounts and dates out of an electricity bill PDF', group: 'Facilities', needs: 'vision', providers: ['groq'], defaults: ['groq:qwen/qwen3.8-27b'], single: true },
    { key: 'meter_ocr', label: 'Reading meter photos', hint: 'Reads the number off a photo of an electricity meter', group: 'Facilities', needs: 'vision', providers: ['groq'], defaults: ['groq:qwen/qwen3.8-27b'], single: true },
    { key: 'electricity_explain', label: 'Electricity "Explain"', hint: 'Writes the plain-words explanation of a month\'s electricity figures', group: 'Facilities', needs: 'chat', providers: ['openai'], defaults: ['openai:gpt-5.6-luna'], single: true, defaultEnv: 'ELECTRICITY_EXPLAIN_MODEL', defaultPrefix: 'openai:' },
    { key: 'sop_photo', label: 'Scoring SOP photos', hint: 'Compares a checklist photo with its reference photo. If this model fails, the second model already in the code takes over', group: 'Facilities', needs: 'vision', providers: ['engy'], defaults: ['deepseek-v4.1-flash', 'glm-5.3-flash'], single: true },
    { key: 'sop_layout', label: 'Reading SOP floor plans', hint: 'Finds the areas on an uploaded floor plan', group: 'Facilities', needs: 'vision', providers: ['groq'], defaults: ['groq:qwen/qwen3.6-27b'], single: true },
    // Owner 2026-11-15: "everything to go to the llm model ... configurable from the brain". Every ticket (app, WhatsApp,
    // re-sort, Snags upload) is sorted by this chain (backend/lib/ticketing/aiClassifier.ts); main first, then backups.
    { key: 'ticket_classify', label: 'Sorting new tickets', hint: 'Sorts every new ticket: picks the category from your category list, the team, the priority (it can only raise a category\'s usual priority) and a safety risk. The first model that answers is used; the rest are backups. If all fail, the old keyword rules decide', group: 'Tickets', needs: 'chat', providers: CHAT_PROVIDERS, defaults: ['anthropic:claude-haiku-5-5', 'glm-5.3-flash'] },
    { key: 'admin_chatbot', label: 'Master admin chatbot', hint: 'Turns a master admin\'s question into a read-only database query and words the result', group: 'Admin', needs: 'chat', providers: ['groq'], defaults: ['groq:llama-3.3-70b-versatile'], single: true },
    { key: 'coaching_feedback', label: 'Call coaching feedback', hint: 'Scores a recorded sales call and writes the coaching notes', group: 'CRM', needs: 'chat', providers: ['groq'], defaults: ['groq:llama-3.3-70b-versatile'], single: true },
    { key: 'mailbox_digest', label: 'Purchase mailbox digest', hint: 'Sorts purchase mailbox threads for the daily digest (only when the digest\'s AI step is switched on)', group: 'Procurement', needs: 'chat', providers: ['openai'], defaults: ['openai:gpt-5.6-terra'], single: true, defaultEnv: 'MAILBOX_DIGEST_MODEL', defaultPrefix: 'openai:' },
    { key: 'satej_fast', label: 'Satej: quick steps', hint: 'Procurement assistant: the short, frequent steps (reading replies, small decisions)', group: 'Procurement', needs: 'chat', providers: ['engy'], defaults: ['deepseek-v4-flash-0731'], single: true, defaultEnv: 'SATEJ_MODEL_FAST' },
    // `defaults` is empty on purpose: with nothing saved these two use the shared model (COUNCIL_MODEL), which is only known at run time.
    { key: 'satej_smart', label: 'Satej: careful steps', hint: 'Procurement assistant: comparing quotes, planning and the chat. Uses the shared model below unless one is chosen here', group: 'Procurement', needs: 'chat', providers: ['engy'], defaults: [], single: true, defaultEnv: 'SATEJ_MODEL_SMART' },
    { key: 'council_default', label: 'Shared model', hint: 'Used by everything that does not name its own model: Master Council summaries, agent planning and prompt writing, Ira\'s vendor emails, call summaries', group: 'Agents', needs: 'chat', providers: ['engy'], defaults: [], single: true, defaultEnv: 'COUNCIL_MODEL' },
];

/** A catalog id as the provider's own API expects it: 'groq:llama-3.3-70b-versatile' → 'llama-3.3-70b-versatile'. */
export const rawModelId = (id: string): string => id.replace(/^(?:groq|openai|anthropic):/, '');

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
