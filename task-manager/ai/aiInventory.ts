import type { AiJob } from './aiCatalog';

/**
 * Owner 2026-10-28 — every place in the project that calls an AI model, for the read-only "AI models in use" list in the
 * Control Center. Read from the code on 2026-10-28 (file:line below); keep it in step when a model changes.
 * Only the rows with `job` can be changed from the Control Center; everything else is display-only.
 * `modelEnv` = the environment variable that can change the model (the screen shows only whether it is set, never a value).
 * "Council route" = backend/lib/council/llm.ts: provider from COUNCIL_PROVIDER (else the first key found: OpenAI, Groq,
 * custom/Engy) and model from COUNCIL_MODEL (else that provider's default) — known only at runtime.
 */

export type InventoryKind = 'chat' | 'vision' | 'speech-to-text' | 'embeddings' | 'voice' | 'moderation';

export interface InventoryRow {
    area: string;
    feature: string;
    where: string;
    models: string;
    chosen: string;
    keys: string[];
    kind: InventoryKind;
    modelEnv?: string;
    job?: AiJob;
}

const COUNCIL_KEYS = ['OPENAI_API_KEY', 'GROQ_API_KEY', 'COUNCIL_API_KEY'];

export const AI_INVENTORY: readonly InventoryRow[] = [
    // ── Task Manager (editable here) ──
    { area: 'Task Manager', feature: 'WhatsApp bot: understanding the message', where: 'task-manager/brain/llm.ts', models: 'Claude Haiku 5.5 → glm-5.3-flash → qwen3.8-27b', chosen: 'Control Center', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', job: 'wa_understand' },
    { area: 'Task Manager', feature: 'WhatsApp bot: writing the reply', where: 'task-manager/brain/llm.ts', models: 'Claude Haiku 5.5 → glm-5.3-flash → qwen3.8-27b', chosen: 'Control Center', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', job: 'wa_reply' },
    { area: 'Task Manager', feature: 'WhatsApp bot: tidying the message', where: 'task-manager/brain/rewrite.ts', models: 'Claude Haiku 5.5 → glm-5.3-flash → qwen3.8-27b', chosen: 'Control Center', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', job: 'wa_tidy' },
    { area: 'Task Manager', feature: 'Voice notes: speech to text', where: 'task-manager/voice/VoiceTranscriber.ts', models: 'whisper-large-v3 → whisper-large-v3-turbo (Groq)', chosen: 'Control Center', keys: ['GROQ_VOICE_API_KEY'], kind: 'speech-to-text', job: 'voice_transcribe' },
    { area: 'Task Manager', feature: 'Voice notes: cleaning up the text', where: 'task-manager/voice/VoiceCleanup.ts', models: 'qwen3.8-27b → glm-5.3-flash', chosen: 'Control Center', keys: ['COUNCIL_API_KEY'], kind: 'chat', job: 'voice_cleanup' },
    { area: 'Task Manager', feature: 'Task import: reading photos and screenshots', where: 'task-manager/TaskImportParser.ts', models: 'Claude Sonnet 5.5 → qwen3.8-27b → glm-5.3-flash', chosen: 'Control Center', keys: ['CLAUDE_API_KEY', 'ENGY_API_KEY', 'COUNCIL_API_KEY'], kind: 'vision', job: 'import_image' },
    { area: 'Task Manager', feature: 'Task import: reading text and Excel', where: 'task-manager/TaskImportParser.ts', models: 'Claude Sonnet 5.5 → qwen3.8-27b → glm-5.3-flash', chosen: 'Control Center', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', job: 'import_text' },
    { area: 'Task Manager', feature: 'Duplicate task check', where: 'task-manager/aiDuplicate.ts', models: 'qwen3.8-27b → glm-5.3-flash', chosen: 'Control Center', keys: ['COUNCIL_API_KEY'], kind: 'chat', job: 'duplicate_check' },
    { area: 'Task Manager', feature: 'Superuser chat', where: 'task-manager/SuperuserAIInterpreter.ts', models: 'llama-3.3-70b-versatile (Groq)', chosen: 'Control Center (default from GROQ_TASK_CHAT_MODEL)', keys: ['GROQ_TASK_CHAT_API_KEY'], kind: 'chat', modelEnv: 'GROQ_TASK_CHAT_MODEL', job: 'superuser_chat' },
    { area: 'Task Manager', feature: 'Learning loop: review summaries and nightly drafts', where: 'task-manager/BotReviewSummary.ts, BotLearningHousekeeping.ts', models: 'gemini-3.8-flash → gemini-2.5-flash → glm-5.3-flash', chosen: 'Control Center (default from BOT_AUTOTUNE_DRAFT_MODELS)', keys: ['GEMINI_AUTOTUNE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', modelEnv: 'BOT_AUTOTUNE_DRAFT_MODELS', job: 'learning_loop' },
    { area: 'Task Manager', feature: 'WhatsApp bot shadow run (comparison only)', where: 'task-manager/brain/shadow.ts', models: "Today's WhatsApp chain", chosen: 'Fixed in code', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat' },

    // ── Everything else (display only) ──
    { area: 'WhatsApp assistant', feature: 'Assistant interpreter', where: 'backend/lib/whatsapp/interpreter/interpret.mjs:28', models: 'llama-3.3-70b-versatile (Groq)', chosen: 'Env var (default shown)', keys: ['GROQ_TASK_CHAT_API_KEY'], kind: 'chat', modelEnv: 'GROQ_TASK_CHAT_MODEL' },
    { area: 'HR', feature: 'HR assistant: safety check', where: 'backend/lib/hr-assistant/config.ts:20', models: 'gpt-oss-safeguard-20b → gpt-oss-20b (Groq) → qwen3.8-27b', chosen: 'Fixed in code', keys: ['GROQ_API_KEY', 'COUNCIL_API_KEY', 'ENGY_API_KEY'], kind: 'moderation' },
    { area: 'HR', feature: 'HR assistant: routing and answering', where: 'backend/lib/hr-assistant/config.ts:25', models: 'gpt-oss-20b (Groq) → qwen3.8-27b → glm-5.3-flash', chosen: 'Fixed in code', keys: ['GROQ_API_KEY', 'COUNCIL_API_KEY', 'ENGY_API_KEY'], kind: 'chat' },
    { area: 'HR', feature: 'HR policy search', where: 'backend/lib/hr-assistant/config.ts:30', models: 'gemini-embedding-001', chosen: 'Fixed in code', keys: ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'], kind: 'embeddings' },
    { area: 'Agents', feature: 'Master Council personas', where: 'backend/lib/council/runner.ts:301', models: 'glm-5.3 / glm-5.3-flash per persona, else Council route', chosen: 'Per agent (Agents screen)', keys: COUNCIL_KEYS, kind: 'chat' },
    { area: 'Agents', feature: 'Master Council summary, call summary, inbox reply', where: 'backend/lib/council/runner.ts:409', models: 'Council route', chosen: 'Env var', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'COUNCIL_MODEL' },
    { area: 'Agents', feature: 'Master Council voice call', where: 'app/api/council/call/route.ts:26', models: 'gpt-realtime-2.1 + gpt-4o-transcribe (OpenAI)', chosen: 'Env var (default shown)', keys: ['OPENAI_API_KEY'], kind: 'voice', modelEnv: 'COUNCIL_REALTIME_MODEL' },
    { area: 'Agents', feature: 'Agent plan, compose, prompt optimiser', where: 'backend/lib/agents/compose.ts:193', models: 'Council route', chosen: 'Env var', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'COUNCIL_MODEL' },
    { area: 'Procurement', feature: 'Ira: vetting findings', where: 'backend/lib/ira/procurement/vet.ts:157', models: "Reviewer's own model, else Council route", chosen: 'Per agent', keys: COUNCIL_KEYS, kind: 'chat' },
    { area: 'Procurement', feature: 'Ira: drafting vendor emails', where: 'backend/lib/ira/procurement/respond.ts:527', models: 'Council route', chosen: 'Env var', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'COUNCIL_MODEL' },
    { area: 'Procurement', feature: 'PI / invoice processing', where: 'backend/services/aiProcessor.ts:27', models: 'gemini-2.5-flash', chosen: 'Fixed in code', keys: ['GOOGLE_AI_API_KEY'], kind: 'vision' },
    { area: 'Procurement', feature: 'Purchase mailbox digest', where: 'backend/services/mailboxDigest.ts:61', models: 'gpt-5.6-terra (OpenAI)', chosen: 'Env var (default shown)', keys: ['OPENAI_API_KEY'], kind: 'chat', modelEnv: 'MAILBOX_DIGEST_MODEL' },
    { area: 'Procurement', feature: 'Satej (Meera): smart steps', where: 'backend/lib/satej/config.ts:60', models: 'SATEJ_MODEL_SMART, else COUNCIL_MODEL', chosen: 'Env var', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'SATEJ_MODEL_SMART' },
    { area: 'Procurement', feature: 'Satej (Meera): fast steps', where: 'backend/lib/satej/config.ts:69', models: 'deepseek-v4-flash-0731', chosen: 'Env var (default shown)', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'SATEJ_MODEL_FAST' },
    { area: 'Procurement', feature: 'Ira voice agent (Bolna)', where: 'backend/services/bolnaService.ts:60', models: 'gpt-5.4-mini; voice eleven_turbo_v2_5; STT nova-3 (run by Bolna)', chosen: 'Env var (default shown)', keys: ['BOLNA_API_KEY'], kind: 'voice', modelEnv: 'BOLNA_LLM_MODEL' },
    { area: 'Finance', feature: 'Invoice reading from PDF text', where: 'backend/lib/invoices/extract.ts:21', models: 'deepseek-v4-flash-0731', chosen: 'Env var (default shown)', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'INVOICE_EXTRACT_MODEL' },
    { area: 'Finance', feature: 'Invoice / petty-cash / scanned document reading', where: 'backend/lib/ocr/vision.ts:28', models: 'qwen3.8-27b (Engy)', chosen: 'Env var (default shown)', keys: ['ENGY_API_KEY', 'COUNCIL_API_KEY'], kind: 'vision', modelEnv: 'OCR_VISION_MODEL' },
    { area: 'Documents', feature: 'Document Bank: text and image uploads', where: 'backend/lib/documentBank/ocr.ts:26', models: 'qwen/qwen3.8-27b (Groq)', chosen: 'Fixed in code', keys: ['GROQ_API_KEY'], kind: 'vision' },
    { area: 'Documents', feature: 'Wiki answers', where: 'backend/lib/wiki/ask.ts:26', models: 'deepseek-v4-flash-0731', chosen: 'Env var (default shown)', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'WIKI_MODEL' },
    { area: 'Facilities', feature: 'Electricity bill reading', where: 'backend/lib/electricity/billOcr.ts:27', models: 'qwen/qwen3.8-27b (Groq)', chosen: 'Fixed in code', keys: ['GROQ_API_KEY'], kind: 'vision' },
    { area: 'Facilities', feature: 'Meter photo reading', where: 'app/api/ocr/meter/route.ts:10', models: 'qwen/qwen3.8-27b (Groq)', chosen: 'Fixed in code', keys: ['GROQ_API_KEY'], kind: 'vision' },
    { area: 'Facilities', feature: 'Electricity tracker "Explain"', where: 'app/api/electricity/tracker/explain/route.ts:34', models: 'gpt-5.6-luna (OpenAI)', chosen: 'Env var (default shown)', keys: ['OPENAI_API_KEY'], kind: 'chat', modelEnv: 'ELECTRICITY_EXPLAIN_MODEL' },
    { area: 'Facilities', feature: 'SOP photo scoring and vision test', where: 'app/api/properties/[propertyId]/sop/completions/[completionId]/score-photo/route.ts:537', models: 'qwen3.8-27b (Engy) → qwen/qwen3.6-27b (Groq)', chosen: 'Partly env var', keys: ['COUNCIL_API_KEY', 'GROQ_API_KEY', 'GROQ_LAYOUT_API_KEY'], kind: 'vision', modelEnv: 'GROQ_VISION_MODEL' },
    { area: 'Facilities', feature: 'SOP CAD layout analysis', where: 'app/api/properties/[propertyId]/sop/analyze-layout/route.ts:48', models: 'qwen/qwen3.6-27b (Groq)', chosen: 'Fixed in code', keys: ['GROQ_API_KEY', 'GROQ_LAYOUT_API_KEY'], kind: 'vision' },
    { area: 'Tickets', feature: 'Ticket auto-classification', where: 'backend/lib/llm/groq.ts:49', models: 'llama-3.3-70b-versatile (Groq)', chosen: 'Fixed in code', keys: ['GROQ_API_KEY'], kind: 'chat' },
    { area: 'Admin', feature: 'Master admin chatbot', where: 'app/api/master-admin-chatbot/route.ts:8', models: 'llama-3.3-70b-versatile (Groq)', chosen: 'Fixed in code', keys: ['GROQ_API_KEY'], kind: 'chat' },
    { area: 'CRM', feature: 'Call coaching: transcribing the call', where: 'backend/lib/coaching/whisper.ts:60', models: 'whisper-1 (OpenAI)', chosen: 'Fixed in code', keys: ['OPENAI_API_KEY'], kind: 'speech-to-text' },
    { area: 'CRM', feature: 'Call coaching: feedback', where: 'backend/lib/coaching/groqCoach.ts:14', models: 'llama-3.3-70b-versatile (Groq)', chosen: 'Fixed in code', keys: ['GROQ_API_KEY'], kind: 'chat' },
    { area: 'Separate services', feature: 'Meeting agent (Python, LiveKit)', where: 'agents/meeting-agent/agent.py:60', models: 'sarvam-105b-conversations; voice bulbul:v3; STT saaras:v3', chosen: 'Env var (default shown)', keys: ['MEETING_AGENT_LLM_API_KEY', 'SARVAM_API_KEY'], kind: 'voice', modelEnv: 'MEETING_AGENT_LLM_MODEL' },
    { area: 'Separate services', feature: 'AI bug-fix orchestrator (Node)', where: 'ai-orchestrator/src/ai.js:53', models: 'claude-3-5-sonnet-20240620', chosen: 'Fixed in code', keys: ['ANTHROPIC_API_KEY'], kind: 'chat' },
];

/** The rows with whether each named key / model variable is set. Never a value. */
export function inventoryWithStatus(env: Record<string, string | undefined> = process.env) {
    const set = (n: string) => !!String(env[n] ?? '').trim();
    return AI_INVENTORY.map(r => ({
        ...r,
        keyStatus: r.keys.map(name => ({ name, set: set(name) })),
        ...(r.modelEnv ? { modelEnvSet: set(r.modelEnv) } : {}),
    }));
}
