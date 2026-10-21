/** All HR assistant settings live here, in one place. */
import { BOT_NAME, COMPANY_NAME } from "./identity";
import type { ModelStep } from "./llm";

export const LLM_MODEL = "openai/gpt-oss-20b";
export const GUARD_MODEL = "openai/gpt-oss-safeguard-20b";
export const JUDGE_MODEL = "openai/gpt-oss-20b";
// Routes each message (small talk / off-topic / HR question); it only picks a label. The small
// llama-3.1-8b-instant is no longer offered on our Groq key, so the same gpt-oss-20b as answers.
export const PLANNER_MODEL = "openai/gpt-oss-20b";

// Each step tries these in order; the first that answers wins (llm.ts). Groq first; on a rate limit, timeout or
// error the backup takes over. Groq's free tier gives the safeguard model only 2,000 tokens/min (about one or two
// questions), so the safety check falls back to gpt-oss-20b with the SAME rules (8,000/min), then to Engy.
// qwen3.8-27b is the first Engy choice: glm-5.3-flash was timing out often when last measured (2026-10-12).
const ENGY_BACKUPS: ModelStep[] = [
  { provider: "engy", model: "qwen3.8-27b" },
  { provider: "engy", model: "glm-5.3-flash" },
];
export const GUARD_MODELS: readonly ModelStep[] = [
  { provider: "groq", model: GUARD_MODEL },
  { provider: "groq", model: LLM_MODEL, reasoningEffort: "low" },
  ENGY_BACKUPS[0],
];
export const PLANNER_MODELS: readonly ModelStep[] = [{ provider: "groq", model: PLANNER_MODEL, reasoningEffort: "low" }, ...ENGY_BACKUPS];
export const ANSWER_MODELS: readonly ModelStep[] = [{ provider: "groq", model: LLM_MODEL, reasoningEffort: "low" }, ...ENGY_BACKUPS];

// 768 keeps us under pgvector's 2000-dim HNSW limit. Changing it requires
// a new migration (vector(N)) and a full re-ingest.
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 60;
// Chunks handed to the model per question. 5 (not 3): with ~21 policies many chunks sound alike.
export const TOP_K_RESULTS = 5;

export const MAX_QUESTION_LENGTH = 1000;

// Uploaded policy documents. 4 MB stays under Vercel's 4.5 MB request body limit.
export const DOCUMENTS_BUCKET = "hr-policies";
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".pdf", ".docx"] as const;

// A document still 'processing' after this long is assumed interrupted and marked failed.
export const STALE_PROCESSING_MINUTES = 5;

// Users with one of these active organization_memberships roles (or master admins)
// can manage documents.
export const HR_ADMIN_ROLES = ["hr", "hr_head", "hr_manager", "hr_ops", "org_super_admin"];

// Outside parties: they don't get the assistant unless they also hold a staff role.
// Any role starting with "tenant" is treated as external too.
export const EXTERNAL_ROLES = [
  "super_tenant",
  "client",
  "resident",
  "vendor",
  "maintenance_vendor",
  "guest",
  "visitor",
];

// Requests per user per minute.
export const ASK_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 };
export const UPLOAD_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

export const REFUSAL_MESSAGE = "Sorry, I can't help with that request.";
export const NO_CONTEXT_MESSAGE =
  "I couldn't find anything about that in the HR policy. Please contact HR directly.";

export const SYSTEM_PROMPT = `You are ${BOT_NAME}, the friendly HR assistant for ${COMPANY_NAME}. Answer the employee's question using ONLY the company HR policy text in <company_hr_policy>. If the answer isn't there, say the HR policy doesn't cover it and suggest contacting HR, instead of guessing. Never approve requests or promise outcomes on the company's behalf - only explain what the policy says. Keep answers short and clear. Speak naturally as the company's HR assistant (e.g. "As per our Leave Policy..."); never mention "excerpts", "provided text" or "context". Good: "Our Leave Policy doesn't list a separate sick leave entitlement, so please check with HR." Bad: "The policy text provided doesn't specify...". <recent_conversation>, when present, is only for understanding what the question refers to; every fact must still come from <company_hr_policy>.`;
