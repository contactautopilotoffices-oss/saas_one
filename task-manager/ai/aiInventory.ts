import type { AiJob } from './aiCatalog';

/**
 * Owner 2026-10-28 — every place in the project that calls an AI model, for the read-only "AI models in use" list in the
 * Control Center. Read from the code on 2026-10-28 (file:line below); keep it in step when a model changes.
 * Only the rows with `job` can be changed on the screen; everything else is display-only and says `why`.
 * Owner 2026-11-15: the screen moved from the Control Center to the Tech console (Brain → AI models), and most of the
 * rows that were display-only became changeable there (each through task-manager/ai/modelFor.ts at its call site).
 * RULE (owner 2026-11-15): every new model call in the software is added here AND made changeable on that screen, in the
 * same change, by the checklist in docs/AI_MODELS.md. A model that truly cannot be changed gets a row with `why`.
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
    /** Owner 2026-11-15: for a row that cannot be changed on the screen, the reason in plain words. */
    why?: string;
}

const COUNCIL_KEYS = ['OPENAI_API_KEY', 'GROQ_API_KEY', 'COUNCIL_API_KEY'];

export const AI_INVENTORY: readonly InventoryRow[] = [
    // ── Task Manager (editable here) ──
    { area: 'Task Manager', feature: 'WhatsApp bot: understanding the message', where: 'task-manager/brain/llm.ts', models: 'Claude Haiku 5.5 → glm-5.3-flash → qwen3.8-27b', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', job: 'wa_understand' },
    { area: 'Task Manager', feature: 'WhatsApp bot: writing the reply', where: 'task-manager/brain/llm.ts', models: 'Claude Haiku 5.5 → glm-5.3-flash → qwen3.8-27b', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', job: 'wa_reply' },
    { area: 'Task Manager', feature: 'WhatsApp bot: tidying the message', where: 'task-manager/brain/rewrite.ts', models: 'Claude Haiku 5.5 → glm-5.3-flash → qwen3.8-27b', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', job: 'wa_tidy' },
    { area: 'Task Manager', feature: 'Voice notes: speech to text', where: 'task-manager/voice/VoiceTranscriber.ts', models: 'whisper-large-v3 → whisper-large-v3-turbo (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_VOICE_API_KEY'], kind: 'speech-to-text', job: 'voice_transcribe' },
    { area: 'Task Manager', feature: 'Voice notes: cleaning up the text', where: 'task-manager/voice/VoiceCleanup.ts', models: 'qwen3.8-27b → glm-5.3-flash', chosen: 'Brain → AI models', keys: ['COUNCIL_API_KEY'], kind: 'chat', job: 'voice_cleanup' },
    { area: 'Task Manager', feature: 'Task import: reading photos and screenshots', where: 'task-manager/TaskImportParser.ts', models: 'Claude Sonnet 5.5 → qwen3.8-27b → glm-5.3-flash', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY', 'ENGY_API_KEY', 'COUNCIL_API_KEY'], kind: 'vision', job: 'import_image' },
    { area: 'Task Manager', feature: 'Task import: reading text and Excel', where: 'task-manager/TaskImportParser.ts', models: 'Claude Sonnet 5.5 → qwen3.8-27b → glm-5.3-flash', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', job: 'import_text' },
    { area: 'Task Manager', feature: 'Duplicate task check', where: 'task-manager/aiDuplicate.ts', models: 'qwen3.8-27b → glm-5.3-flash', chosen: 'Brain → AI models', keys: ['COUNCIL_API_KEY'], kind: 'chat', job: 'duplicate_check' },
    { area: 'Task Manager', feature: 'Learning loop: review summaries and nightly drafts', where: 'task-manager/BotReviewSummary.ts, BotLearningHousekeeping.ts', models: 'claude-sonnet-5-5 → gemini-3.8-flash → gemini-2.5-flash → glm-5.3-flash', chosen: 'Brain → AI models (default from BOT_AUTOTUNE_DRAFT_MODELS)', keys: ['CLAUDE_API_KEY', 'GEMINI_AUTOTUNE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', modelEnv: 'BOT_AUTOTUNE_DRAFT_MODELS', job: 'learning_loop' },
    { area: 'Task Manager', feature: 'WhatsApp bot shadow run (comparison only)', where: 'task-manager/brain/shadow.ts', models: "Today's WhatsApp chain", chosen: 'Fixed in code', keys: ['CLAUDE_API_KEY', 'COUNCIL_API_KEY'], kind: 'chat', why: 'A comparison run only. It deliberately keeps the models written in the code, so its results can be compared over time.' },

    // ── Everything else (display only) ──
    { area: 'WhatsApp assistant', feature: 'Assistant interpreter', where: 'backend/lib/whatsapp/interpreter/interpret.mjs:28', models: 'llama-3.3-70b-versatile (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_TASK_CHAT_API_KEY'], kind: 'chat', modelEnv: 'GROQ_TASK_CHAT_MODEL', job: 'assistant_interpret' },
    { area: 'HR', feature: 'HR assistant: safety check', where: 'backend/lib/hr-assistant/config.ts:20', models: 'gpt-oss-safeguard-20b → gpt-oss-20b (Groq) → qwen3.8-27b', chosen: 'Fixed in code', keys: ['GROQ_API_KEY', 'COUNCIL_API_KEY', 'ENGY_API_KEY'], kind: 'moderation', why: 'A safety filter that runs on a model made for that purpose. A different model could let an unsafe question through.' },
    { area: 'HR', feature: 'HR assistant: routing and answering', where: 'backend/lib/hr-assistant/config.ts:25', models: 'gpt-oss-20b (Groq) → qwen3.8-27b → glm-5.3-flash', chosen: 'Brain → AI models', keys: ['GROQ_API_KEY', 'COUNCIL_API_KEY', 'ENGY_API_KEY'], kind: 'chat', job: 'hr_answer' },
    { area: 'HR', feature: 'HR policy search', where: 'backend/lib/hr-assistant/config.ts:30', models: 'gemini-embedding-001', chosen: 'Fixed in code', keys: ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'], kind: 'embeddings', why: 'The stored HR policy index was built with this model. Changing it means rebuilding the whole index.' },
    { area: 'HR', feature: 'Candidate Search: reading the search, and a job description into a position', where: 'backend/lib/candidates/query-spec.ts, position-reader.ts', models: 'Claude Opus 5.5', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY'], kind: 'chat', job: 'candidate_parse' },
    { area: 'HR', feature: 'Candidate Search: ranking candidates', where: 'backend/lib/candidates/rerank.ts', models: 'Claude Opus 5.5', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY'], kind: 'chat', job: 'candidate_rank' },
    { area: 'HR', feature: 'Candidate Search: fixing flagged rows', where: 'backend/lib/candidates/ai-fix.ts', models: 'Claude Haiku 5.5, Sonnet 5.5', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY'], kind: 'chat', job: 'candidate_fix' },
    { area: 'HR', feature: 'Candidate Search: suggesting keywords', where: 'backend/lib/candidates/keyword-suggest.ts', models: 'Claude Haiku 5.5', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY'], kind: 'chat', job: 'candidate_suggest' },
    { area: 'HR', feature: 'Candidate Search: reading resumes', where: 'backend/lib/candidates/resume-extract.ts', models: 'Claude Haiku 5.5, Sonnet 5.5', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY'], kind: 'chat', job: 'candidate_extract' },
    { area: 'HR', feature: 'Candidate Search: typing out scanned resumes', where: 'backend/lib/candidates/resume-scan.ts', models: 'Claude Haiku 5.5, Sonnet 5.5 (Claude only: the PDF pages are read as pictures)', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY'], kind: 'vision', job: 'candidate_extract' },
    { area: 'HR', feature: 'Recruitment calls: transcribing the recording', where: 'backend/lib/callInsights/transcribe.ts', models: 'whisper-large-v3 → whisper-large-v3-turbo (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_VOICE_API_KEY'], kind: 'speech-to-text', job: 'call_transcribe' },
    { area: 'HR', feature: 'Recruitment calls: reading the call (sentiment, interest, facts heard)', where: 'backend/lib/callInsights/analyse.ts', models: 'Claude Opus 5.5 → Sonnet 5.5', chosen: 'Brain → AI models', keys: ['CLAUDE_API_KEY'], kind: 'chat', job: 'call_analyse' },
    { area: 'HR', feature: 'Candidate Search: meaning search', where: 'backend/lib/candidates/embeddings.ts', models: 'Switched off since 2026-11-12 (no screen uses it); on with CANDIDATE_MEANING_INDEX=on. gemini-embedding-001 (768) by default; jina-embeddings-v3 with EMBEDDING_PROVIDER=jina', chosen: 'Env CANDIDATE_MEANING_INDEX, EMBEDDING_PROVIDER', keys: ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'JINA_API_KEY'], kind: 'embeddings', why: 'A stored search index is tied to the model that built it, and this one is switched off.' },
    { area: 'Agents', feature: 'Master Council personas', where: 'backend/lib/council/runner.ts:301', models: 'glm-5.3 / glm-5.3-flash per persona, else Council route', chosen: 'Per agent (Agents screen)', keys: COUNCIL_KEYS, kind: 'chat', why: "Each agent's model is chosen on the Agents screen. An agent with none uses the shared model, which can be changed above." },
    { area: 'Agents', feature: 'Master Council summary, call summary, inbox reply', where: 'backend/lib/council/runner.ts:409', models: 'Council route', chosen: 'Brain → AI models', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'COUNCIL_MODEL', job: 'council_default' },
    { area: 'Agents', feature: 'Master Council voice call', where: 'app/api/council/call/route.ts:26', models: 'gpt-realtime-2.1 + gpt-4o-transcribe (OpenAI)', chosen: 'Env var (default shown)', keys: ['OPENAI_API_KEY'], kind: 'voice', modelEnv: 'COUNCIL_REALTIME_MODEL', why: "Runs on OpenAI's live voice service, where only its own voice models work." },
    { area: 'Agents', feature: 'Agent plan, compose, prompt optimiser', where: 'backend/lib/agents/compose.ts:193', models: 'Council route', chosen: 'Brain → AI models', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'COUNCIL_MODEL', job: 'council_default' },
    { area: 'Procurement', feature: 'Ira: vetting findings', where: 'backend/lib/ira/procurement/vet.ts:157', models: "Reviewer's own model, else Council route", chosen: 'Per agent', keys: COUNCIL_KEYS, kind: 'chat', why: "Each reviewer's model is chosen on its agent. A reviewer with none uses the shared model, which can be changed above." },
    { area: 'Procurement', feature: 'Ira: drafting vendor emails', where: 'backend/lib/ira/procurement/respond.ts:527', models: 'Council route', chosen: 'Brain → AI models', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'COUNCIL_MODEL', job: 'council_default' },
    { area: 'Procurement', feature: 'PI / invoice processing', where: 'backend/services/aiProcessor.ts:27', models: 'gemini-2.5-flash', chosen: 'Fixed in code', keys: ['GOOGLE_AI_API_KEY'], kind: 'vision', why: 'Only this model has been proven to read these documents through this route.' },
    { area: 'Procurement', feature: 'Purchase mailbox digest', where: 'backend/services/mailboxDigest.ts:61', models: 'gpt-5.6-terra (OpenAI)', chosen: 'Brain → AI models', keys: ['OPENAI_API_KEY'], kind: 'chat', modelEnv: 'MAILBOX_DIGEST_MODEL', job: 'mailbox_digest' },
    { area: 'Procurement', feature: 'Satej (Meera): smart steps', where: 'backend/lib/satej/config.ts:60', models: 'SATEJ_MODEL_SMART, else COUNCIL_MODEL', chosen: 'Brain → AI models', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'SATEJ_MODEL_SMART', job: 'satej_smart' },
    { area: 'Procurement', feature: 'Satej (Meera): fast steps', where: 'backend/lib/satej/config.ts:69', models: 'deepseek-v4-flash-0731', chosen: 'Brain → AI models', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'SATEJ_MODEL_FAST', job: 'satej_fast' },
    { area: 'Procurement', feature: 'Ira voice agent (Bolna)', where: 'backend/services/bolnaService.ts:60', models: 'gpt-5.4-mini; voice eleven_turbo_v2_5; STT nova-3 (run by Bolna)', chosen: 'Env var (default shown)', keys: ['BOLNA_API_KEY'], kind: 'voice', modelEnv: 'BOLNA_LLM_MODEL', why: 'Runs inside the Bolna calling service, which keeps its own model settings.' },
    { area: 'Finance', feature: 'Invoice reading from PDF text', where: 'backend/lib/invoices/extract.ts:21', models: 'deepseek-v4-flash-0731', chosen: 'Brain → AI models', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'INVOICE_EXTRACT_MODEL', job: 'invoice_text' },
    { area: 'Finance', feature: 'Invoice / petty-cash / scanned document reading', where: 'backend/lib/ocr/vision.ts:28', models: 'qwen3.8-27b (Engy)', chosen: 'Brain → AI models', keys: ['ENGY_API_KEY', 'COUNCIL_API_KEY'], kind: 'vision', modelEnv: 'OCR_VISION_MODEL', job: 'ocr_vision' },
    { area: 'Documents', feature: 'Document Bank: text and image uploads', where: 'backend/lib/documentBank/ocr.ts:26', models: 'qwen/qwen3.8-27b (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_API_KEY'], kind: 'vision', job: 'document_ocr' },
    { area: 'Documents', feature: 'Wiki answers', where: 'backend/lib/wiki/ask.ts:26', models: 'deepseek-v4-flash-0731', chosen: 'Brain → AI models', keys: COUNCIL_KEYS, kind: 'chat', modelEnv: 'WIKI_MODEL', job: 'wiki_answer' },
    { area: 'Facilities', feature: 'Electricity bill reading', where: 'backend/lib/electricity/billOcr.ts:27', models: 'qwen/qwen3.8-27b (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_API_KEY'], kind: 'vision', job: 'bill_ocr' },
    { area: 'Facilities', feature: 'Meter photo reading', where: 'app/api/ocr/meter/route.ts:10', models: 'qwen/qwen3.8-27b (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_API_KEY'], kind: 'vision', job: 'meter_ocr' },
    { area: 'Facilities', feature: 'Electricity tracker "Explain"', where: 'app/api/electricity/tracker/explain/route.ts:34', models: 'gpt-5.6-luna (OpenAI)', chosen: 'Brain → AI models', keys: ['OPENAI_API_KEY'], kind: 'chat', modelEnv: 'ELECTRICITY_EXPLAIN_MODEL', job: 'electricity_explain' },
    { area: 'Facilities', feature: 'SOP photo scoring and vision test', where: 'app/api/properties/[propertyId]/sop/completions/[completionId]/score-photo/route.ts:537', models: 'qwen3.8-27b (Engy) → qwen/qwen3.6-27b (Groq)', chosen: 'Brain → AI models', keys: ['COUNCIL_API_KEY', 'GROQ_API_KEY', 'GROQ_LAYOUT_API_KEY'], kind: 'vision', modelEnv: 'GROQ_VISION_MODEL', job: 'sop_photo' },
    { area: 'Facilities', feature: 'SOP CAD layout analysis', where: 'app/api/properties/[propertyId]/sop/analyze-layout/route.ts:48', models: 'qwen/qwen3.6-27b (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_API_KEY', 'GROQ_LAYOUT_API_KEY'], kind: 'vision', job: 'sop_layout' },
    { area: 'Tickets', feature: 'Ticket auto-classification', where: 'backend/lib/llm/groq.ts:49', models: 'llama-3.3-70b-versatile (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_API_KEY'], kind: 'chat', job: 'ticket_classify' },
    { area: 'Admin', feature: 'Master admin chatbot', where: 'app/api/master-admin-chatbot/route.ts:8', models: 'llama-3.3-70b-versatile (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_API_KEY'], kind: 'chat', job: 'admin_chatbot' },
    { area: 'CRM', feature: 'Call coaching: transcribing the call', where: 'backend/lib/coaching/whisper.ts:60', models: 'whisper-1 (OpenAI)', chosen: 'Fixed in code', keys: ['OPENAI_API_KEY'], kind: 'speech-to-text', why: 'The coaching needs a time stamp on every sentence of the call, which only this model returns.' },
    { area: 'CRM', feature: 'Call coaching: feedback', where: 'backend/lib/coaching/groqCoach.ts:14', models: 'llama-3.3-70b-versatile (Groq)', chosen: 'Brain → AI models', keys: ['GROQ_API_KEY'], kind: 'chat', job: 'coaching_feedback' },
    { area: 'Separate services', feature: 'Meeting agent (Python, LiveKit)', where: 'agents/meeting-agent/agent.py:60', models: 'sarvam-105b-conversations; voice bulbul:v3; STT saaras:v3', chosen: 'Env var (default shown)', keys: ['MEETING_AGENT_LLM_API_KEY', 'SARVAM_API_KEY'], kind: 'voice', modelEnv: 'MEETING_AGENT_LLM_MODEL', why: 'A separate program outside this application. It does not read these settings.' },
    { area: 'Separate services', feature: 'AI bug-fix orchestrator (Node)', where: 'ai-orchestrator/src/ai.js:53', models: 'claude-3-5-sonnet-20240620', chosen: 'Fixed in code', keys: ['ANTHROPIC_API_KEY'], kind: 'chat', why: 'A separate program outside this application. It does not read these settings.' },
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
