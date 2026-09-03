/**
 * AGENT COMPOSER — "DESCRIBE IT → Build".
 * -----------------------------------------------------------------------------
 * This is the file that makes agent configuration a UI act instead of a deploy.
 * An operator types one sentence:
 *
 *     "Every morning, look at the open electricity bills that have not been
 *      approved for 3 days and tell the property admin which ones are stuck."
 *
 * and gets back a complete, SAFE agent: identity, department, a written system
 * prompt, and — the part that actually matters — a data bundle drawn strictly
 * from the tables this organization really has.
 *
 * Two entry points:
 *
 *   composeAgent()  first draft — description in, configuration out.
 *   foldGuidance()  the reinforcement loop closing — the free-text corrections
 *                   operators left on real runs become the NEXT prompt version.
 *
 * ── DESIGN RULES ────────────────────────────────────────────────────────────
 *
 * PURE. Neither function touches the database. composeAgent is given the table
 * list; foldGuidance is given the current prompt and the pending feedback rows.
 * They return a proposal, and the caller persists it. This is what lets both run
 * against an unprovisioned database, and it is why foldGuidance CANNOT mutate a
 * prompt version in place even by accident — it has no writer.
 *
 * CLOSED-SET GROUNDING. The model may only name tables from the list it was
 * given, and we do not trust it to obey: every proposed table is re-checked
 * against the allow-list after parsing, and anything invented is dropped and
 * reported. A hallucinated table name would silently become a containment hole.
 *
 * STRICT JSON. councilChat() returns free text, so the envelope is extracted,
 * parsed and validated with zod. One repair round-trip is allowed — a malformed
 * envelope is a FORMAT failure, unlike the "no retries" rule in council/llm.ts
 * which exists to stop re-rolling until the ANSWER is favourable.
 *
 * MOCK. With COUNCIL_MOCK_LLM=1 both functions return deterministic, sensible
 * output built from the real inputs, so the console demos with no API key.
 *
 * ── WIRING STATUS ───────────────────────────────────────────────────────────
 *
 * BOTH functions are wired through app/api/agents/compose/route.ts.
 *
 *   composeAgent()  POST { description, agentKey? }        — AgentConsole.tsx
 *   foldGuidance()  POST { mode:'fold', agent_key,
 *                          feedback_ids? }                 — AgentReinforcement.tsx
 *
 * The fold handler reads oem_agents (system_prompt, system_prompt_version) and
 * the agent's oem_agent_feedback rows WHERE applied_to_prompt_version IS NULL
 * (narrowed to feedback_ids when supplied), calls this function, and returns
 *   200 { provisioned, mode:'fold', agent_key, current_version, next_version,
 *         next_prompt, changelog, applied_feedback_ids, mocked, saved:false }
 *   200 { provisioned:false, ... } on 42P01/42703/PGRST204/PGRST205.
 *
 * The prompt evolution that once shipped was a markdown append running in the
 * browser. That is gone: how a correction becomes a standing rule is decided
 * here, on the server, where it is versioned and auditable.
 *
 * NEITHER MODE SAVES. The operator reviews the diff and commits through the
 * registry's `save_prompt`, passing `absorbed_feedback_ids` — the ids this
 * function reported as applied. Note that the registry IGNORES the older
 * `absorb_feedback: true` flag, so a caller that sends only the flag saves the
 * prompt and leaves every correction pending for ever.
 */

import { z } from 'zod';
import { councilChat, isMockLlm, type CouncilChatMessage } from '@/backend/lib/council/llm';
import type { AgentModelConfig, AgentRuntimeConfig } from '@/frontend/types/agentRuntime';

/* ---------------------------------------------------------------------------
 * Public shapes
 * ------------------------------------------------------------------------- */

/** A table the org actually has. A bare name is fine; the extras sharpen the draft. */
export type ComposeTableHint =
    | string
    | { name: string; columns?: string[]; note?: string };

export interface ComposeAgentInput {
    orgId: string;
    /** The operator's sentence. The whole point of the feature. */
    description: string;
    /** Optional: an agent_key the operator already chose. Slugified, then honoured. */
    agentKey?: string;
    /**
     * The org's REAL table list — reference A's "build from real config". The
     * composer may not name anything outside it.
     */
    availableTables: ReadonlyArray<ComposeTableHint>;
    /** Optional department shortlist, so the draft lands in an existing team. */
    departments?: ReadonlyArray<string>;
}

export interface ComposedBundleTable {
    name: string;
    access: 'read' | 'write';
    /** Why this table is in the bundle — shown next to the checkbox in the UI. */
    why: string;
}

export interface ComposedAgent {
    display_name: string;
    agent_key: string;
    department: string | null;
    role_description: string;
    system_prompt: string;
    suggested_bundle: { tables: ComposedBundleTable[] };
    runtime: AgentRuntimeConfig;
    model_config: AgentModelConfig;
    /** Ambiguities the operator must resolve. Empty when the description was clear. */
    open_questions: string[];

    // ---- Provenance of the draft itself (extra, safe to ignore).
    /** Table names the model proposed that this org does not have. Always dropped. */
    rejected_tables: string[];
    /** true when produced by the deterministic stub rather than a live model. */
    mocked: boolean;
}

/* ---------------------------------------------------------------------------
 * Guards — applied AFTER parsing, because the model is not trusted with any of
 * them. Each one is a containment property, not a style preference.
 * ------------------------------------------------------------------------- */

/**
 * A bundle wider than this is not a scoped agent, it is a database login.
 * Extras are dropped into open_questions so the operator sees what was cut.
 */
export const COMPOSE_MAX_BUNDLE_TABLES = 12;

/** Rendering cap so a 400-table org does not blow the context window. */
const MAX_TABLES_IN_PROMPT = 220;
const MAX_COLUMNS_PER_TABLE = 24;

/** agent_key is a slug: lower snake, because it is a URL segment and a JSON key. */
export function slugifyAgentKey(raw: string): string {
    const slug = raw
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return slug || 'agent';
}

function tableName(hint: ComposeTableHint): string {
    return typeof hint === 'string' ? hint : hint.name;
}

/** Drop null/undefined so an AgentRuntimeConfig has absent keys, not null ones. */
function compact<T extends Record<string, unknown>>(obj: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== null && v !== undefined) out[k] = v;
    }
    return out as T;
}

/* ---------------------------------------------------------------------------
 * JSON envelope handling
 * ------------------------------------------------------------------------- */

/**
 * Pull the JSON object out of a model response. Handles ```json fences and
 * leading/trailing prose by taking the outermost balanced {...}.
 */
export function extractJsonObject(raw: string): unknown {
    let text = raw.trim();

    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error(`Model returned no JSON object (got: ${raw.slice(0, 180)}…)`);
    }
    return JSON.parse(text.slice(start, end + 1));
}

/**
 * One LLM call plus, at most, one repair round-trip.
 *
 * The repair is NOT retry-until-happy. The first response is fed back verbatim
 * with the parser's complaint and an instruction to re-emit the SAME content as
 * valid JSON — the content is accepted as given, only the envelope is fixed.
 */
async function askForJson(
    messages: CouncilChatMessage[],
    label: string,
): Promise<unknown> {
    const first = await councilChat(messages, 'synthesis');
    try {
        return extractJsonObject(first);
    } catch (error) {
        const complaint = (error as Error).message;
        console.warn(`[agent compose] ${label}: unparseable envelope, requesting one repair — ${complaint}`);
        const repaired = await councilChat(
            [
                ...messages,
                { role: 'assistant', content: first.slice(0, 12000) },
                {
                    role: 'user',
                    content:
                        `That response could not be parsed as JSON (${complaint}). `
                        + 'Re-emit exactly the same content as a single valid JSON object. '
                        + 'Do not change any values, do not add commentary, do not use markdown fences.',
                },
            ],
            'synthesis',
        );
        return extractJsonObject(repaired);
    }
}

/* ---------------------------------------------------------------------------
 * 1. composeAgent
 * ------------------------------------------------------------------------- */

const BundleTableSchema = z.object({
    name: z.string().min(1),
    access: z.enum(['read', 'write']).catch('read'),
    why: z.string().nullish(),
});

const RuntimeSchema = z.object({
    schedule_cron: z.string().nullish(),
    timezone: z.string().nullish(),
    quiet_hours: z.object({ from: z.string(), to: z.string() }).nullish(),
    heartbeat_interval_sec: z.number().int().positive().nullish(),
    max_runs_per_day: z.number().int().positive().nullish(),
    max_cost_inr_per_day: z.number().nonnegative().nullish(),
    timeout_sec: z.number().int().positive().nullish(),
    autonomy: z.enum(['suggest', 'act']).nullish(),
});

const ModelConfigSchema = z.object({
    provider: z.string().nullish(),
    model: z.string().nullish(),
    temperature: z.number().min(0).max(2).nullish(),
    top_p: z.number().min(0).max(1).nullish(),
    max_tokens: z.number().int().positive().nullish(),
    context_window: z.number().int().positive().nullish(),
});

const ComposeSchema = z.object({
    display_name: z.string().min(1),
    agent_key: z.string().nullish(),
    department: z.string().nullish(),
    role_description: z.string().nullish(),
    system_prompt: z.string().min(40),
    suggested_bundle: z.object({ tables: z.array(BundleTableSchema).nullish() }).nullish(),
    runtime: RuntimeSchema.nullish(),
    model_config: ModelConfigSchema.nullish(),
    open_questions: z.array(z.string()).nullish(),
});

const COMPOSE_SYSTEM = `You are the AGENT COMPOSER for an Indian facility-management operations platform (tickets, procurement, electricity, SOP checklists, rosters, vendors, audits).

An operator who is NOT a developer describes, in one or two sentences, an agent they want. You turn that into a complete, safe configuration. You emit JSON and nothing else.

HARD CONSTRAINTS — these are containment properties, not preferences.

1. TABLES ARE A CLOSED SET. You may only name tables that appear in AVAILABLE TABLES, spelled exactly as listed. A table you invent becomes a hole in the agent's containment boundary and will be dropped. If the work genuinely needs data that is not in the list, do not substitute something similar — raise it in open_questions.

2. READ IS THE DEFAULT. Use access "write" only when the description explicitly asks the agent to CREATE, UPDATE, SEND, ASSIGN or CLOSE something. "watch", "report", "summarise", "flag", "remind", "alert me" are all READ. When in doubt, read.

3. SMALLEST SUFFICIENT BUNDLE. Every extra table widens what a bad prompt can reach. Include a table only if you can state, in "why", the specific question the agent answers with it. Aim for 2-6 tables.

4. AMBIGUITY GOES TO open_questions, NOT INTO A GUESS. If the description does not say when it should run, who it reports to, what threshold counts as "stuck", or which property/site it covers — ask. An empty array means the description really was unambiguous. Two or three sharp questions are better than five vague ones.

5. THE SYSTEM PROMPT IS THE AGENT'S CONSTITUTION. Write it in the second person, addressed to the agent. It must contain, in this order: who it is and which department it serves; what it does each run, as numbered steps; the exact tables it may touch and for what; the rule that every number it reports must come from a query on those tables and never be estimated; what "done" looks like and what proof is required; and when to stop and escalate to a human instead of guessing. 200-450 words. No markdown headings, plain paragraphs and numbered lines.

6. RUNTIME defaults for an Indian FM operation: timezone "Asia/Kolkata", a schedule_cron that matches the described cadence, heartbeat_interval_sec 300, timeout_sec 120, autonomy "suggest" unless the operator clearly asked the agent to act on its own.

OUTPUT — one JSON object, no prose, no markdown fences:
{
  "display_name": "Electricity Approval Chaser",
  "agent_key": "electricity_approval_chaser",
  "department": "Facilities",
  "role_description": "One sentence an org admin reads in a list.",
  "system_prompt": "You are ...",
  "suggested_bundle": { "tables": [ { "name": "exact_table_name", "access": "read", "why": "the specific question this answers" } ] },
  "runtime": { "schedule_cron": "0 9 * * *", "timezone": "Asia/Kolkata", "heartbeat_interval_sec": 300, "max_runs_per_day": 24, "timeout_sec": 120, "autonomy": "suggest" },
  "model_config": { "temperature": 0.2, "max_tokens": 2000 },
  "open_questions": ["..."]
}`;

function renderTableList(tables: ReadonlyArray<ComposeTableHint>): string {
    const shown = tables.slice(0, MAX_TABLES_IN_PROMPT);
    const lines = shown.map((t) => {
        if (typeof t === 'string') return `- ${t}`;
        const cols = t.columns?.length
            ? ` (columns: ${t.columns.slice(0, MAX_COLUMNS_PER_TABLE).join(', ')}${t.columns.length > MAX_COLUMNS_PER_TABLE ? ', …' : ''})`
            : '';
        const note = t.note ? ` — ${t.note}` : '';
        return `- ${t.name}${cols}${note}`;
    });
    if (tables.length > shown.length) {
        lines.push(`- …and ${tables.length - shown.length} more not shown; ask in open_questions if you need one.`);
    }
    return lines.join('\n');
}

/**
 * Turn one sentence into an agent configuration.
 *
 * Throws only if the model is unreachable or its output cannot be made into
 * valid JSON after one repair. Everything else — invented tables, oversized
 * bundles, an over-eager autonomy setting — is corrected here and reported
 * through open_questions / rejected_tables rather than raised as an error,
 * because the operator is sitting in front of a form waiting for a draft.
 */
export async function composeAgent(input: ComposeAgentInput): Promise<ComposedAgent> {
    const { description, availableTables } = input;
    if (!description || description.trim().length < 8) {
        throw new Error('Describe the agent in a sentence — at least a few words to work from.');
    }

    const allowed = new Map<string, string>();
    for (const t of availableTables) {
        const name = tableName(t);
        if (name) allowed.set(name.toLowerCase(), name);
    }

    const raw = isMockLlm()
        ? mockCompose(input, allowed)
        : ComposeSchema.parse(
            await askForJson(
                [
                    { role: 'system', content: COMPOSE_SYSTEM },
                    {
                        role: 'user',
                        content: [
                            'AVAILABLE TABLES (the closed set — nothing outside this list):',
                            renderTableList(availableTables),
                            '',
                            input.departments?.length
                                ? `EXISTING DEPARTMENTS (prefer one of these): ${input.departments.join(', ')}\n`
                                : '',
                            input.agentKey ? `The operator already chose agent_key "${slugifyAgentKey(input.agentKey)}". Use it verbatim.\n` : '',
                            'DESCRIBE IT (the operator wrote this):',
                            description.trim(),
                        ].filter(Boolean).join('\n'),
                    },
                ],
                'composeAgent',
            ),
        );

    return normaliseComposed(raw, input, allowed, isMockLlm());
}

type RawComposed = z.infer<typeof ComposeSchema>;

/**
 * Everything the model is not trusted with. Runs identically over live and
 * mock output, so the guards are exercised in demo mode too.
 */
function normaliseComposed(
    raw: RawComposed,
    input: ComposeAgentInput,
    allowed: Map<string, string>,
    mocked: boolean,
): ComposedAgent {
    const openQuestions: string[] = [...(raw.open_questions ?? [])].filter((q) => q.trim());
    const rejected: string[] = [];

    // ---- Guard 1: closed-set grounding. Canonicalise, drop the invented, dedupe.
    const seen = new Set<string>();
    let tables: ComposedBundleTable[] = [];
    for (const t of raw.suggested_bundle?.tables ?? []) {
        const canonical = allowed.get(t.name.trim().toLowerCase());
        if (!canonical) {
            rejected.push(t.name);
            continue;
        }
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        tables.push({
            name: canonical,
            access: t.access === 'write' ? 'write' : 'read',
            why: (t.why ?? '').trim(),
        });
    }
    if (rejected.length) {
        openQuestions.push(
            `This organization has no table named ${rejected.map((r) => `"${r}"`).join(', ')}. `
            + 'It was left out of the bundle — pick the real table it meant, or narrow the description.',
        );
    }

    // ---- Guard 2: bundle size. A bundle this wide is a database login.
    if (tables.length > COMPOSE_MAX_BUNDLE_TABLES) {
        const dropped = tables.slice(COMPOSE_MAX_BUNDLE_TABLES).map((t) => t.name);
        tables = tables.slice(0, COMPOSE_MAX_BUNDLE_TABLES);
        openQuestions.push(
            `The draft asked for more than ${COMPOSE_MAX_BUNDLE_TABLES} tables; ${dropped.join(', ')} `
            + 'were left out. Confirm which of these the agent genuinely needs.',
        );
    }

    // ---- Guard 3: write access is always confirmed by a human, never assumed.
    const writeTables = tables.filter((t) => t.access === 'write').map((t) => t.name);
    if (writeTables.length) {
        openQuestions.push(
            `Confirm WRITE access to ${writeTables.join(', ')} — the agent will create or modify rows there. `
            + 'Switch any of them to read-only if it should only propose.',
        );
    }

    // ---- Guard 4: a writing agent starts in suggest mode, whatever it asked for.
    const runtime: AgentRuntimeConfig = compact({
        schedule_cron: raw.runtime?.schedule_cron ?? '0 9 * * *',
        timezone: raw.runtime?.timezone ?? 'Asia/Kolkata',
        quiet_hours: raw.runtime?.quiet_hours ?? undefined,
        heartbeat_interval_sec: raw.runtime?.heartbeat_interval_sec ?? 300,
        max_runs_per_day: raw.runtime?.max_runs_per_day ?? 24,
        max_cost_inr_per_day: raw.runtime?.max_cost_inr_per_day ?? undefined,
        timeout_sec: raw.runtime?.timeout_sec ?? 120,
        autonomy: raw.runtime?.autonomy ?? 'suggest',
    });
    if (writeTables.length && runtime.autonomy === 'act') {
        runtime.autonomy = 'suggest';
        openQuestions.push(
            'This agent can write, so it starts in "suggest" mode: it proposes and waits for a human. '
            + 'Switch it to "act" once you have watched a few runs.',
        );
    }

    const modelConfig: AgentModelConfig = compact({
        provider: raw.model_config?.provider ?? undefined,
        model: raw.model_config?.model ?? undefined,
        temperature: raw.model_config?.temperature ?? 0.2,
        top_p: raw.model_config?.top_p ?? undefined,
        max_tokens: raw.model_config?.max_tokens ?? 2000,
        context_window: raw.model_config?.context_window ?? undefined,
    });

    const agentKey = slugifyAgentKey(
        input.agentKey || raw.agent_key || raw.display_name,
    );

    return {
        display_name: raw.display_name.trim(),
        agent_key: agentKey,
        department: raw.department?.trim() || null,
        role_description: (raw.role_description ?? '').trim() || input.description.trim().slice(0, 240),
        system_prompt: raw.system_prompt.trim(),
        suggested_bundle: { tables },
        runtime,
        model_config: modelConfig,
        open_questions: openQuestions,
        rejected_tables: rejected,
        mocked,
    };
}

/* ---------------------------------------------------------------------------
 * Deterministic stub — COUNCIL_MOCK_LLM=1.
 *
 * Not a placeholder: it reads the real description and the real table list, so
 * the console demos end to end (draft -> review -> save -> version) with no API
 * key and no spend. Same guards run over it afterwards.
 * ------------------------------------------------------------------------- */

const STOPWORDS = new Set([
    'every', 'each', 'that', 'this', 'them', 'they', 'with', 'from', 'have', 'has',
    'and', 'the', 'for', 'are', 'not', 'but', 'all', 'any', 'who', 'when', 'what',
    'which', 'should', 'would', 'agent', 'please', 'want', 'need', 'make', 'into',
    'about', 'their', 'there', 'been', 'were', 'will', 'then', 'than', 'over',
]);

const DEPARTMENT_HINTS: Array<[RegExp, string, string]> = [
    [/electric|power|kwh|meter|bill/i, 'Facilities', 'electricity'],
    [/ticket|complaint|breakdown|issue/i, 'Operations', 'tickets'],
    [/po\b|purchase|requisition|procure|vendor quote/i, 'Procurement', 'procurement'],
    [/vendor|supplier/i, 'Procurement', 'vendors'],
    [/roster|shift|attendance|manpower/i, 'Operations', 'roster'],
    [/sop|checklist|audit|inspection/i, 'Quality', 'audit'],
    [/invoice|payment|ledger|petty/i, 'Accounts', 'accounts'],
    [/lead|client|crm|enquiry/i, 'Sales', 'crm'],
    [/document|contract|agreement/i, 'Compliance', 'documents'],
];

function descriptionTokens(description: string): string[] {
    return Array.from(new Set(
        description
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
    ));
}

function mockCompose(input: ComposeAgentInput, allowed: Map<string, string>): RawComposed {
    const desc = input.description.trim();
    const tokens = descriptionTokens(desc);
    const hit = DEPARTMENT_HINTS.find(([re]) => re.test(desc));
    const department = hit?.[1] ?? 'Operations';
    const moduleHint = hit?.[2] ?? '';

    // Score every real table by token overlap with the description; deterministic.
    const scored = Array.from(allowed.values())
        .map((name) => {
            const parts = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
            let score = 0;
            for (const tok of tokens) {
                if (parts.some((p) => p === tok || p.startsWith(tok) || tok.startsWith(p))) score += 2;
                else if (name.toLowerCase().includes(tok)) score += 1;
            }
            if (moduleHint && name.toLowerCase().includes(moduleHint)) score += 3;
            return { name, score };
        })
        .filter((t) => t.score > 0)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, 5);

    const wantsAction = /\b(create|raise|draft|send|assign|close|update|approve|escalate)\b/i.test(desc);

    const displayName = (moduleHint ? `${moduleHint[0].toUpperCase()}${moduleHint.slice(1)} ` : '')
        + 'Watcher';
    const agentKey = slugifyAgentKey(input.agentKey || `${moduleHint || 'ops'}_watcher`);
    const tableLines = scored.length
        ? scored.map((t) => `- ${t.name}`).join('\n')
        : '- (no table matched the description — bind one before going live)';

    return ComposeSchema.parse({
        display_name: displayName,
        agent_key: agentKey,
        department,
        role_description: desc.slice(0, 240),
        system_prompt: [
            `You are ${displayName}, an operations agent serving the ${department} department.`,
            '',
            `Your standing instruction from the operator is: "${desc}"`,
            '',
            'Each run you:',
            '1. Read only the tables listed below, scoped to your organization.',
            '2. Identify the rows that match the condition in your instruction.',
            '3. Report them as a short list, with the identifier of every row you name.',
            wantsAction
                ? '4. Prepare the action described above as a DRAFT and wait for a human to approve it.'
                : '4. Take no action; reporting is the whole job.',
            '',
            'The only tables you may touch:',
            tableLines,
            '',
            'Rules. Every number you report must come from a query on those tables — never estimate one. '
            + 'A run is done when the report names every affected row and cites its id. '
            + 'If the data you need is missing, or a row is ambiguous, stop and escalate to a human '
            + 'with the reason instead of guessing.',
            '',
            '(Draft generated in mock mode — COUNCIL_MOCK_LLM=1. Regenerate with a live key before going live.)',
        ].join('\n'),
        suggested_bundle: {
            tables: scored.map((t, i) => ({
                name: t.name,
                access: wantsAction && i === 0 ? 'write' : 'read',
                why: `Matched the description on "${tokens.find((tok) => t.name.toLowerCase().includes(tok)) ?? (moduleHint || 'the operator wording')}".`,
            })),
        },
        runtime: {
            schedule_cron: '0 9 * * *',
            timezone: 'Asia/Kolkata',
            heartbeat_interval_sec: 300,
            max_runs_per_day: 24,
            timeout_sec: 120,
            autonomy: 'suggest',
        },
        model_config: { temperature: 0.2, max_tokens: 2000 },
        open_questions: [
            'Mock draft (COUNCIL_MOCK_LLM=1): no model was called. Set OPENAI_API_KEY and rebuild for a real composition.',
            scored.length
                ? 'Confirm the tables below are the right ones before saving.'
                : 'No table in this organization matched the description — bind the bundle by hand.',
            'When should this run, and who receives the output?',
        ],
    });
}

/* ---------------------------------------------------------------------------
 * 2. foldGuidance — the reinforcement loop closing.
 * ------------------------------------------------------------------------- */

/** One pending row from oem_agent_feedback (applied_to_prompt_version IS NULL). */
export interface PendingGuidance {
    id?: string;
    /** The free text the operator typed on a run. */
    guidance: string;
    signal?: 'praise' | 'reject' | 'correction' | 'roi_flag';
    /** Short slug the operator picked alongside the text. */
    reason?: string | null;
    created_at?: string;
}

export interface FoldGuidanceResult {
    /** The NEXT prompt version's text. The caller writes it as a new version. */
    next_prompt: string;
    /** One line per correction absorbed, for oem_council_log.details. */
    changelog: string[];
    /** Feedback ids to stamp with the new prompt version once it is persisted. */
    applied_feedback_ids: string[];
    /** true when the deterministic append-fold produced this, not a live model. */
    mocked: boolean;
}

/**
 * A model that "rewrites" a 400-word constitution into 90 words has deleted
 * guardrails, not tightened them. Below this retention ratio we refuse its
 * output and fall back to the deterministic append-fold.
 */
const MIN_RETENTION_RATIO = 0.45;

const FOLD_SCHEMA = z.object({
    next_prompt: z.string().min(40),
    changelog: z.array(z.string()).nullish(),
});

const FOLD_SYSTEM = `You are the PROMPT COMPILER for an agent workforce.

An operator has been watching an agent work and has left free-text corrections on specific runs. Your job is to fold those corrections into the NEXT version of the agent's system prompt.

RULES.

1. YOU ARE EDITING, NOT REWRITING. The current prompt is the accumulated result of every earlier correction. Preserve every section, constraint and guardrail it contains unless a correction directly contradicts it. Keep its structure, its voice and roughly its length. Deleting a rule nobody asked you to delete is the failure mode here.

2. A CORRECTION BECOMES A STANDING RULE, NOT AN ANECDOTE. "Don't call vendors after 7pm" becomes a constraint line in the rules section. Never write "on 12 August you called a vendor late" — the agent has no memory of that run.

3. NEVER WEAKEN A CONTAINMENT RULE. The list of tables the agent may touch, the requirement that every number comes from a query, the proof requirement, and the escalation path may be TIGHTENED by a correction but never removed or loosened, even if a correction seems to ask for it. If one does, keep the rule and say so in the changelog.

4. WHEN TWO CORRECTIONS CONFLICT, the newer one wins. Note the supersession in the changelog.

5. AN ROI FLAG means the work itself was not worth doing. Fold it in as a scoping constraint — what the agent should stop spending runs on — not as a quality note.

6. CHANGELOG: one short past-tense line per correction, naming what changed in the prompt. If a correction was deliberately not applied, say that and why.

OUTPUT — one JSON object, no prose, no markdown fences:
{ "next_prompt": "the complete new prompt text", "changelog": ["Added a rule that ...", "Tightened ..."] }`;

/**
 * Fold pending operator corrections into the next prompt version.
 *
 * PURE — it writes nothing. The caller persists next_prompt as a NEW version
 * (bumping system_prompt_version), logs the changelog to oem_council_log, and
 * only then stamps applied_to_prompt_version on applied_feedback_ids. The
 * current version is never mutated: an agent's prompt history is the audit
 * trail of how it learned, and rewriting a past version destroys it.
 *
 * Returns the current prompt unchanged, with an empty changelog, when there is
 * nothing pending — so a nightly "absorb feedback" job can call it blind.
 */
export async function foldGuidance(
    orgId: string,
    agentKey: string,
    currentPrompt: string,
    pendingGuidance: ReadonlyArray<PendingGuidance | string>,
): Promise<FoldGuidanceResult> {
    const items: PendingGuidance[] = pendingGuidance
        .map((g) => (typeof g === 'string' ? { guidance: g } : g))
        .filter((g) => (g.guidance ?? '').trim().length > 0);

    const appliedIds = items.map((g) => g.id).filter((id): id is string => !!id);

    if (!items.length) {
        return { next_prompt: currentPrompt, changelog: [], applied_feedback_ids: [], mocked: false };
    }

    const rendered = items
        .map((g, i) => {
            const tag = g.signal ? `[${g.signal}${g.reason ? `/${g.reason}` : ''}]` : '[correction]';
            const when = g.created_at ? ` (${g.created_at.slice(0, 10)})` : '';
            return `${i + 1}. ${tag}${when} ${g.guidance.trim()}`;
        })
        .join('\n');

    if (isMockLlm()) return mockFold(currentPrompt, items, appliedIds);

    let parsed: z.infer<typeof FOLD_SCHEMA>;
    try {
        parsed = FOLD_SCHEMA.parse(
            await askForJson(
                [
                    { role: 'system', content: FOLD_SYSTEM },
                    {
                        role: 'user',
                        content: [
                            `AGENT: ${agentKey} (organization ${orgId})`,
                            '',
                            'CURRENT SYSTEM PROMPT:',
                            '---',
                            currentPrompt,
                            '---',
                            '',
                            `PENDING OPERATOR CORRECTIONS (${items.length}, oldest first):`,
                            rendered,
                        ].join('\n'),
                    },
                ],
                'foldGuidance',
            ),
        );
    } catch (error) {
        // A failed fold must not lose the corrections: fall back to the
        // deterministic append so the guidance still reaches the next version.
        console.warn(
            `[agent compose] foldGuidance fell back to the deterministic append for ${agentKey}: `
            + `${(error as Error).message}`,
        );
        return mockFold(currentPrompt, items, appliedIds);
    }

    const next = parsed.next_prompt.trim();
    if (currentPrompt.length > 0 && next.length < currentPrompt.length * MIN_RETENTION_RATIO) {
        console.warn(
            `[agent compose] foldGuidance rejected a ${next.length}-char rewrite of a `
            + `${currentPrompt.length}-char prompt for ${agentKey} — below the ${MIN_RETENTION_RATIO} `
            + 'retention floor, treating it as a truncation.',
        );
        return mockFold(currentPrompt, items, appliedIds);
    }

    return {
        next_prompt: next,
        changelog: (parsed.changelog ?? []).map((c) => c.trim()).filter(Boolean),
        applied_feedback_ids: appliedIds,
        mocked: false,
    };
}

/**
 * The deterministic fold. Used in mock mode AND as the failure path for a live
 * fold, because losing an operator's correction is worse than an inelegant
 * prompt. It appends the corrections as an explicit standing-rules block —
 * additive, so no existing rule can be dropped by this path.
 */
function mockFold(
    currentPrompt: string,
    items: PendingGuidance[],
    appliedIds: string[],
): FoldGuidanceResult {
    const HEADER = '== OPERATOR CORRECTIONS (standing rules) ==';
    const lines = items.map((g) => {
        const scope = g.signal === 'roi_flag'
            ? 'Do not spend runs on this: '
            : g.signal === 'reject'
                ? 'Never do this again: '
                : '';
        return `- ${scope}${g.guidance.trim().replace(/\s+/g, ' ')}`;
    });

    // Merge into an existing corrections block rather than stacking a second one.
    const idx = currentPrompt.indexOf(HEADER);
    const base = idx === -1 ? currentPrompt.trimEnd() : currentPrompt.slice(0, idx).trimEnd();
    const existing = idx === -1
        ? []
        : currentPrompt
            .slice(idx + HEADER.length)
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.startsWith('- '));

    const merged = Array.from(new Set([...existing, ...lines]));

    return {
        next_prompt: [base, '', HEADER, ...merged].join('\n'),
        changelog: items.map(
            (g) => `Absorbed ${g.signal ?? 'correction'}: ${g.guidance.trim().slice(0, 120)}`,
        ),
        applied_feedback_ids: appliedIds,
        mocked: true,
    };
}
