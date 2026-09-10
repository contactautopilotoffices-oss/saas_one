/**
 * AGENT RUNTIME TYPES
 * -----------------------------------------------------------------------------
 * Mirrors supabase/migrations/20260830000001_agent_runtime.sql exactly.
 *
 * The existing OEM tables (oem_agents, oem_agent_bundles, oem_council_log,
 * oem_goals, oem_tasks, oem_measurements) carry identity, data binding and
 * governance. These types cover what the runtime migration adds:
 *
 *   execution      OemAgentRun          — one row per invocation
 *   trace          OemAgentRunStep      — the live step feed
 *   uptime         OemAgentHeartbeat    — when it went down and why
 *   reinforcement  OemAgentFeedback     — praise / reject / correction / ROI flag
 *   reward         OemAgentCoinLedgerEntry
 *   secrets        OemAgentCredentialMasked — NEVER the raw secret
 *   rollup         OemAgentProfile      — the 30-day view
 *
 * The tables do not exist until the migration is applied. Every API that reads
 * them must degrade to { provisioned: false, ...emptyShape } with HTTP 200 —
 * see NOT_PROVISIONED_CODES / isNotProvisionedError below.
 */

/* ---------------------------------------------------------------------------
 * Enumerations — these mirror the SQL CHECK constraints one-for-one.
 * ------------------------------------------------------------------------- */

/** oem_agent_runs.trigger */
export type AgentRunTrigger = 'cron' | 'manual' | 'webhook' | 'shadow' | 'replay';

/** oem_agent_runs.status */
export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'timeout';

/** oem_agent_run_steps.step_type — the shape of one line in the activity feed. */
export type AgentStepType =
    | 'plan'
    | 'think'
    | 'llm'
    | 'tool'
    | 'fetch'
    | 'write'
    | 'notify'
    | 'decide'
    | 'error';

/** oem_agent_run_steps.status */
export type AgentStepStatus = 'running' | 'ok' | 'failed' | 'skipped';

/** oem_agent_heartbeats.state */
export type AgentHeartbeatState = 'up' | 'degraded' | 'down';

/** oem_agents.health_state — heartbeat states plus "never probed". */
export type AgentHealthState = AgentHeartbeatState | 'unknown';

/** oem_agent_feedback.signal */
export type AgentFeedbackSignal = 'praise' | 'reject' | 'correction' | 'roi_flag';

/** oem_agent_credentials.purpose */
export type AgentCredentialPurpose = 'llm' | 'voice' | 'whatsapp' | 'telephony';

/** oem_agents.status — already in the registry, restated for convenience. */
export type AgentLifecycleStatus = 'draft' | 'shadow' | 'live' | 'paused' | 'retired';

/** runtime.autonomy — suggest = proposes and waits; act = writes on its own. */
export type AgentAutonomy = 'suggest' | 'act';

export const AGENT_RUN_TRIGGERS: readonly AgentRunTrigger[] = [
    'cron', 'manual', 'webhook', 'shadow', 'replay',
] as const;

export const AGENT_RUN_STATUSES: readonly AgentRunStatus[] = [
    'running', 'succeeded', 'failed', 'skipped', 'timeout',
] as const;

export const AGENT_STEP_TYPES: readonly AgentStepType[] = [
    'plan', 'think', 'llm', 'tool', 'fetch', 'write', 'notify', 'decide', 'error',
] as const;

export const AGENT_CREDENTIAL_PURPOSES: readonly AgentCredentialPurpose[] = [
    'llm', 'voice', 'whatsapp', 'telephony',
] as const;

/* ---------------------------------------------------------------------------
 * Modules — oem_agent_runs.module.
 *
 * THIS IS THE ONE CANONICAL MODULE VOCABULARY. Nothing else may declare its
 * own. It powers per-module agent pulse: a module surface mounts <AgentPulse
 * module="..."> and the pulse endpoint filters oem_agent_runs.module by that
 * exact string, so a slug that is written nowhere renders an empty strip
 * forever — silently, because the column is free text with no CHECK.
 *
 * Three lists used to disagree (this file, app/api/agents/_shared.ts, and the
 * literals typed into OrgAdminDashboard); only 8 of ~22 slugs were in all
 * three, and 'diesel' was in none of them while being mounted on the dashboard.
 * The list below is the union, and it is now the only definition:
 *
 *   - app/api/agents/_shared.ts re-exports it and DERIVES its catalog domains
 *     and ModuleDescriptor metadata from it (a missing entry is a type error).
 *   - OrgAdminDashboard keys its <AgentPulse> mounts off AGENT_PULSE_BY_TAB,
 *     which is `satisfies Record<string, ModuleKey>` — a typo will not compile.
 *
 * Adding a module = adding a slug here, its label, and its description in
 * _shared.ts. Nothing else.
 * ------------------------------------------------------------------------- */

export const AGENT_MODULES = [
    // --- operations
    'tickets',
    'sop',
    'ppm',
    'assets',
    'housekeeping',
    'roster',
    'frontdesk',
    // --- utilities
    'electricity',
    'diesel',
    'utilities',
    // --- money
    'procurement',
    'vendors',
    'accounts',
    'payments',
    // --- records
    'audit',
    'documents',
    'reports',
    // --- growth & comms
    'crm',
    'comms',
    // --- platform
    'core',
    'council',
    'agentops',
] as const;

export type ModuleKey = (typeof AGENT_MODULES)[number];

/** Historical alias. `ModuleKey` is the name to use in new code. */
export type AgentModule = ModuleKey;

/**
 * Human labels for the module slugs. Exhaustive by type: adding a slug to
 * AGENT_MODULES without a label here is a compile error, which is the point.
 */
export const AGENT_MODULE_LABELS: Record<ModuleKey, string> = {
    tickets: 'Tickets & Escalation',
    sop: 'SOP & Checklists',
    ppm: 'Planned Maintenance',
    assets: 'Assets & AMC',
    housekeeping: 'Housekeeping',
    roster: 'Roster & People',
    frontdesk: 'Front of House',
    electricity: 'Electricity',
    diesel: 'Diesel & DG',
    utilities: 'Water & Meters',
    procurement: 'Procurement',
    vendors: 'Vendors',
    accounts: 'Accounts',
    payments: 'Payments',
    audit: 'Digital Audit',
    documents: 'Document Bank',
    reports: 'Reports',
    crm: 'CRM',
    comms: 'Communications',
    core: 'Portfolio',
    council: 'Agent Council',
    agentops: 'Agent Operations',
};

/** Narrowing guard — module comes back from the DB as a free-text column. */
export function isAgentModule(value: string | null | undefined): value is ModuleKey {
    return !!value && (AGENT_MODULES as readonly string[]).includes(value);
}

/**
 * Aliases seen in the wild. Agents currently write `config.module ?? department`
 * into oem_agent_runs.module, and `department` is a human-readable string an
 * LLM wrote ('Procurement', 'Front Desk', 'Facilities'), not a slug. Keys here
 * are already lowercased and space-separated; normalizeModule() does that first.
 *
 * Deliberately absent: 'operations', 'facilities', 'fms', 'admin'. Those name a
 * whole company, not a module — guessing one would put an agent on a module
 * surface it was never bound to. They normalize to null and the pulse endpoint
 * shows them as Unassigned, which is the truthful answer.
 */
const MODULE_ALIASES: Record<string, ModuleKey> = {
    // tickets
    ticket: 'tickets',
    complaint: 'tickets',
    complaints: 'tickets',
    helpdesk: 'tickets',
    'help desk': 'tickets',
    escalation: 'tickets',
    escalations: 'tickets',
    requests: 'tickets',
    // sop
    checklist: 'sop',
    checklists: 'sop',
    'standard operating procedure': 'sop',
    'shift checklist': 'sop',
    // ppm
    maintenance: 'ppm',
    'planned maintenance': 'ppm',
    'preventive maintenance': 'ppm',
    'preventative maintenance': 'ppm',
    'planned preventive maintenance': 'ppm',
    // assets
    asset: 'assets',
    'asset management': 'assets',
    amc: 'assets',
    // housekeeping
    'house keeping': 'housekeeping',
    hk: 'housekeeping',
    cleaning: 'housekeeping',
    janitorial: 'housekeeping',
    // roster
    rosters: 'roster',
    staffing: 'roster',
    manpower: 'roster',
    workforce: 'roster',
    attendance: 'roster',
    deployment: 'roster',
    hr: 'roster',
    'human resources': 'roster',
    people: 'roster',
    // frontdesk
    'front desk': 'frontdesk',
    'front office': 'frontdesk',
    'front of house': 'frontdesk',
    reception: 'frontdesk',
    receptionist: 'frontdesk',
    visitors: 'frontdesk',
    'guest experience': 'frontdesk',
    // electricity
    power: 'electricity',
    energy: 'electricity',
    electrical: 'electricity',
    discom: 'electricity',
    'electricity bills': 'electricity',
    // diesel
    dg: 'diesel',
    generator: 'diesel',
    generators: 'diesel',
    fuel: 'diesel',
    'dg set': 'diesel',
    // utilities
    water: 'utilities',
    meters: 'utilities',
    metering: 'utilities',
    'sub meters': 'utilities',
    // procurement
    purchase: 'procurement',
    purchasing: 'procurement',
    'purchase orders': 'procurement',
    supply: 'procurement',
    'supply chain': 'procurement',
    stores: 'procurement',
    stock: 'procurement',
    inventory: 'procurement',
    indent: 'procurement',
    indents: 'procurement',
    requisitions: 'procurement',
    // vendors
    vendor: 'vendors',
    'vendor management': 'vendors',
    supplier: 'vendors',
    suppliers: 'vendors',
    // accounts
    account: 'accounts',
    finance: 'accounts',
    accounting: 'accounts',
    billing: 'accounts',
    invoicing: 'accounts',
    // payments
    payment: 'payments',
    payouts: 'payments',
    treasury: 'payments',
    // audit
    audits: 'audit',
    'digital audit': 'audit',
    compliance: 'audit',
    // documents
    document: 'documents',
    'document bank': 'documents',
    docs: 'documents',
    documentation: 'documents',
    // reports
    report: 'reports',
    reporting: 'reports',
    mis: 'reports',
    analytics: 'reports',
    // crm
    sales: 'crm',
    leads: 'crm',
    marketing: 'crm',
    // comms
    comm: 'comms',
    communication: 'comms',
    communications: 'comms',
    messaging: 'comms',
    whatsapp: 'comms',
    notifications: 'comms',
    calls: 'comms',
    voice: 'comms',
    // core
    portfolio: 'core',
    property: 'core',
    properties: 'core',
    // council / agentops
    'agent council': 'council',
    'agent operations': 'agentops',
    'agent ops': 'agentops',
};

/**
 * Best-effort free text -> canonical slug. Returns null when the input names no
 * module we know: callers must treat null as "unassigned" and MUST NOT invent a
 * module, because a wrong slug puts an agent's activity on someone else's card.
 */
export function normalizeModule(input: string | null | undefined): ModuleKey | null {
    if (typeof input !== 'string') return null;

    const lower = input.trim().toLowerCase();
    if (!lower) return null;
    if (isAgentModule(lower)) return lower;

    // 'Front-Desk', 'front_desk', 'agent ops' -> 'frontdesk' / 'agentops'.
    const squashed = lower.replace(/[\s._\-/&]+/g, '');
    if (isAgentModule(squashed)) return squashed;

    // 'Front  Desk' / 'front-desk' -> 'front desk' for the alias table.
    const spaced = lower.replace(/[\s._\-/]+/g, ' ').trim();
    return MODULE_ALIASES[spaced] ?? MODULE_ALIASES[squashed] ?? null;
}

/* ---------------------------------------------------------------------------
 * 1. oem_agent_runs — one row per agent execution.
 * ------------------------------------------------------------------------- */

export interface OemAgentRun {
    id: string;
    organization_id: string;
    agent_key: string;
    /** Idempotency key, UNIQUE with (organization_id, agent_key). */
    run_key: string | null;
    trigger: AgentRunTrigger;
    /** Free-text in SQL; expected to be an AgentModule slug. */
    module: string | null;
    status: AgentRunStatus;

    started_at: string;
    ended_at: string | null;
    duration_ms: number | null;

    // --- LLM engineering surface, captured as actually used for this run.
    provider: string | null;
    model: string | null;
    temperature: number | null;
    top_p: number | null;
    max_tokens: number | null;
    context_window: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    /** Prompt-cache / KV-cache hits: the subset of tokens_in billed as cached. */
    cached_tokens: number | null;
    cost_usd: number | null;
    cost_inr: number | null;

    // --- Provenance: which configuration produced this run.
    prompt_version: number | null;
    bundle_version: number | null;

    // --- Outcome
    outcome_summary: string | null;
    entity_ref: string | null;
    error: string | null;
    error_class: string | null;
    /** True when every claim traced back to a row in an active-bundle table. */
    grounded: boolean | null;
    /** 0..1 self-reported confidence. */
    confidence: number | null;

    created_at: string;
}

/** A run plus its trace, as the run-detail drawer consumes it. */
export interface OemAgentRunWithSteps extends OemAgentRun {
    steps: OemAgentRunStep[];
}

/* ---------------------------------------------------------------------------
 * 2. oem_agent_run_steps — the live step trace.
 * ------------------------------------------------------------------------- */

export interface OemAgentRunStep {
    id: string;
    run_id: string;
    organization_id: string;
    seq: number;
    step_type: AgentStepType;
    /** e.g. 'Fetching open requisitions'. */
    label: string;
    detail: Record<string, unknown> | null;
    tokens_in: number | null;
    tokens_out: number | null;
    duration_ms: number | null;
    status: AgentStepStatus;
    started_at: string;
    ended_at: string | null;
}

/* ---------------------------------------------------------------------------
 * 3. oem_agent_heartbeats — uptime.
 * ------------------------------------------------------------------------- */

/** Machine slugs, not prose, so outages group by cause. Extendable. */
export type AgentHeartbeatReason =
    | 'ok'
    | 'llm_key_missing'
    | 'bolna_401'
    | 'rate_limited'
    | 'quiet_hours'
    | 'timeout'
    | 'no_schedule'
    | (string & {});

export interface OemAgentHeartbeat {
    id: string;
    organization_id: string;
    agent_key: string;
    beat_at: string;
    state: AgentHeartbeatState;
    reason: AgentHeartbeatReason | null;
    latency_ms: number | null;
    detail: Record<string, unknown> | null;
    created_at: string;
}

/* ---------------------------------------------------------------------------
 * 4. oem_agent_feedback — reinforcement.
 * ------------------------------------------------------------------------- */

export interface OemAgentFeedback {
    id: string;
    organization_id: string;
    agent_key: string;
    run_id: string | null;
    signal: AgentFeedbackSignal;
    /** Positive reward, or negative on reject. */
    coins: number;
    /** "the job done is not in the ROI of the company". */
    roi_flag: boolean;
    reason: string | null;
    /** Free-text correction, folded into the next prompt version. */
    guidance: string | null;
    /** NULL while still pending — a regeneration stamps it. */
    applied_to_prompt_version: number | null;
    created_by: string | null;
    created_at: string;
}

/* ---------------------------------------------------------------------------
 * 5. oem_agent_coin_ledger — Autopilot coins, append-only.
 * ------------------------------------------------------------------------- */

export interface OemAgentCoinLedgerEntry {
    id: string;
    organization_id: string;
    agent_key: string;
    delta: number;
    balance_after: number;
    reason: string | null;
    feedback_id: string | null;
    run_id: string | null;
    created_by: string | null;
    created_at: string;
}

/* ---------------------------------------------------------------------------
 * 6. oem_agent_credentials — SECRETS.
 *
 * There is deliberately NO type here that carries secret_enc or a decrypted
 * value. Any API that returns credentials to a browser returns this masked
 * shape and nothing else.
 * ------------------------------------------------------------------------- */

export interface OemAgentCredentialMasked {
    id: string;
    organization_id: string;
    agent_key: string;
    purpose: AgentCredentialPurpose;
    provider: string | null;
    /** Name of a server env var, e.g. 'BOLNA_API_KEY'. Not the secret itself. */
    secret_ref: string | null;
    /** Last four characters, for display only. */
    last4: string | null;
    /** Non-secret settings: from_number, voice_id, agent_id, base_url. */
    meta: Record<string, unknown> | null;
    /** True when a secret is stored (either as a ref or encrypted). Derived. */
    configured: boolean;
    updated_by: string | null;
    updated_at: string;
    created_at: string;
}

/** Write shape for the sandbox credential form. The plaintext never round-trips back. */
export interface OemAgentCredentialInput {
    organization_id: string;
    agent_key: string;
    purpose: AgentCredentialPurpose;
    provider?: string;
    /** Preferred: the NAME of an env var the server should read. */
    secret_ref?: string;
    /** Only when the operator pastes a key. Server encrypts; never returned. */
    secret_plain?: string;
    meta?: Record<string, unknown>;
}

/* ---------------------------------------------------------------------------
 * 7. oem_agents — the columns this migration adds, and the config blobs.
 * ------------------------------------------------------------------------- */

export interface AgentQuietHours {
    /** 'HH:MM' local to runtime.timezone. */
    from: string;
    to: string;
}

/** oem_agents.runtime — the operator-editable schedule and safety envelope. */
/** Where an agent sends from and reads replies at. Per-agent, not per-deployment. */
export interface AgentInboxConfig {
    /** From address on outbound mail. */
    from?: string;
    /** Reply-To. MUST be a mailbox the poller can read, or replies land nowhere. */
    reply_to?: string;
    /** The mailbox the reply poller actually reads. Kept for older configs; see poll_addresses. */
    poll_address?: string;
    /**
     * EVERY mailbox the poller reads. One Zoho grant can cover several shared
     * inboxes (purchase@, support@, sites@); list them all and a reply to any
     * of them lands. reply_to must be one of these or answers are lost.
     */
    poll_addresses?: string[];
    /** How far back each poll looks. Overlap is cheap; a gap loses an answer. */
    lookback_hours?: number;
}

/**
 * Who receives which slice of a scan.
 *
 * `roles` is the base split — the same finding says different things to a CEO
 * and to procurement. `sites` narrows it further: a Bengaluru finding goes to
 * whoever owns Bengaluru, not to every procurement address in the company.
 * A site with no entry falls back to the role address.
 */
export interface AgentRecipientConfig {
    roles?: {
        ceo?: string[];
        procurement?: string[];
        technical?: string[];
    };
    /** property name or code -> addresses that own it. */
    sites?: Record<string, string[]>;
}

/** Whether the agent answers a reply, and to what. */
export interface AgentRespondConfig {
    enabled?: boolean;
    /** Dispositions that earn a reply back. Typically the ones that ask something. */
    on?: Array<'need_info' | 'blocked'>;
}

/**
 * ONE WORKED input -> output PAIR, injected into the prompt as real turns.
 *
 * Few-shot examples are the highest-quality-per-token lever available and this
 * repo had none. They live in `runtime` rather than their own table because they
 * are configuration a person edits and the whole blob is read at once — the same
 * argument as `inbox` and `recipients` above; the full reasoning, and the caps
 * that make a jsonb column safe here, are in backend/lib/agents/context.ts.
 *
 * COST WARNING, and it is the reason for MAX_EXAMPLES: an example is re-sent as
 * input tokens on EVERY call this agent makes, forever. Four examples is not a
 * one-off upload, it is a standing monthly bill. The console shows ₹/run before
 * a save.
 */
export interface AgentResponseExample {
    /** Stable id so the editor can reorder or delete without index bugs. */
    id: string;
    /** What arrives — a mail body, a question, a row. */
    input: string;
    /** What a good answer to it looks like. This is the shape being taught. */
    output: string;
    /** Why this example exists. Operator-facing; never sent to the model. */
    note?: string;
}

/**
 * Facts that are true for this org on every run — site codes, owners, the vendor
 * shortlist, approval thresholds — pinned once instead of re-derived per run.
 * Prepended to the prompt as fenced DATA: it can add facts, never relax a rule.
 */
export interface AgentBakedContext {
    facts: string;
    /** When the operator last checked it. Operator-facing; never sent. */
    reviewed_at?: string;
}

export interface AgentRuntimeConfig {
    inbox?: AgentInboxConfig;
    recipients?: AgentRecipientConfig;
    respond?: AgentRespondConfig;
    schedule_cron?: string;
    timezone?: string;
    quiet_hours?: AgentQuietHours;
    heartbeat_interval_sec?: number;
    max_runs_per_day?: number;
    max_cost_inr_per_day?: number;
    timeout_sec?: number;
    autonomy?: AgentAutonomy;
    /**
     * Which council persona this agent reports to — a council_agents.key such
     * as 'procurement' (Nair). When set, that persona vets the agent's findings
     * after every run and the verdict is written to the council log and
     * stamped on the digest. Null means nobody reviews the work.
     */
    reports_to?: string | null;
    /**
     * Few-shot pairs injected ahead of the live turn. Absent or empty means the
     * prompt is assembled exactly as it was before this key existed — the
     * additive-only invariant proved in backend/lib/agents/context.ts.
     */
    response_examples?: AgentResponseExample[];
    /** Pinned org facts prepended to the prompt. Null/absent = nothing added. */
    baked_context?: AgentBakedContext | null;
}

/** oem_agents.model_config — the operator-editable inference settings. */
export interface AgentModelConfig {
    provider?: string;
    model?: string;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    context_window?: number;
}

/** The full oem_agents row, original columns plus the runtime additions. */
export interface OemAgentRow {
    id: string;
    organization_id: string;
    agent_key: string;
    display_name: string;
    department: string | null;
    role_description: string | null;
    status: AgentLifecycleStatus;
    system_prompt: string | null;
    system_prompt_version: number;
    prompt_generated_at: string | null;
    config: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;

    // --- added by 20260830000001_agent_runtime.sql
    health_state: AgentHealthState;
    last_heartbeat_at: string | null;
    /** Cached copy of oem_agent_profile.reliability_score. */
    reliability_score: number | null;
    /** Cache of the coin ledger's running total. The ledger is authoritative. */
    coins_balance: number;
    runtime: AgentRuntimeConfig | null;
    model_config: AgentModelConfig | null;
}

/* ---------------------------------------------------------------------------
 * 8. oem_agent_profile — the 30-day rollup view.
 *
 * reliability_score = 0.50 * success_rate
 *                   + 0.30 * uptime_pct
 *                   + 0.20 * (100 - roi_flag_rate)
 * NULL when the agent has neither runs nor heartbeats: "not measured yet" is
 * not the same as "unreliable".
 * ------------------------------------------------------------------------- */

export interface OemAgentProfile {
    organization_id: string;
    agent_key: string;
    display_name: string;
    department: string | null;
    status: AgentLifecycleStatus;
    health_state: AgentHealthState;
    last_heartbeat_at: string | null;
    coins_balance: number;
    prompt_version: number;

    // --- throughput (30d)
    runs_total: number;
    runs_succeeded: number;
    runs_failed: number;
    runs_in_flight: number;
    last_run_at: string | null;

    // --- LLM consumption (30d)
    tokens_in_total: number;
    tokens_out_total: number;
    cached_tokens_total: number;
    cost_usd_total: number;
    cost_inr_total: number;

    // --- latency (30d)
    p50_duration_ms: number | null;
    p95_duration_ms: number | null;

    // --- uptime (30d)
    beats_total: number;
    beats_up: number;
    beats_down: number;
    beats_degraded: number;
    avg_latency_ms: number | null;

    // --- reinforcement (30d, except pending_guidance which is all-time state)
    roi_flags_30d: number;
    praise_30d: number;
    rejects_30d: number;
    corrections_30d: number;
    /** Guidance rows still waiting to be folded into a prompt version. */
    pending_guidance: number;

    // --- derived rates, all 0..100, NULL when the input has no data
    success_rate: number | null;
    uptime_pct: number | null;
    roi_flag_rate: number | null;
    reliability_score: number | null;
}

/**
 * The five axes of the agent reliability pentagon, in draw order.
 * Mirrors the five OEM levels visually: one radar, five named dimensions.
 */
export const AGENT_RELIABILITY_AXES = [
    { key: 'success_rate', label: 'Completion' },
    { key: 'uptime_pct', label: 'Availability' },
    { key: 'roi_alignment', label: 'ROI alignment' },
    { key: 'grounding', label: 'Grounding' },
    { key: 'efficiency', label: 'Efficiency' },
] as const;

export type AgentReliabilityAxis = (typeof AGENT_RELIABILITY_AXES)[number]['key'];

/* ---------------------------------------------------------------------------
 * 9. Not-provisioned handling.
 *
 * The runtime tables do not exist until the migration is applied. Reads must
 * return HTTP 200 with { provisioned: false, ...emptyShape } rather than 500,
 * so the console renders a calm "not provisioned yet" panel instead of an error.
 * ------------------------------------------------------------------------- */

/** Postgres / PostgREST codes meaning "the relation or column is not there yet". */
export const NOT_PROVISIONED_CODES = [
    '42P01', // undefined_table
    '42703', // undefined_column
    'PGRST204', // column not found in schema cache
    'PGRST205', // table not found in schema cache
] as const;

export type NotProvisionedCode = (typeof NOT_PROVISIONED_CODES)[number];

/** The migration an unprovisioned surface should name to the operator. */
export const AGENT_RUNTIME_MIGRATION = '20260830000001_agent_runtime';

/** True when a Supabase error means the schema is simply not applied yet. */
export function isNotProvisionedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && (NOT_PROVISIONED_CODES as readonly string[]).includes(code)) {
        return true;
    }
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string'
        && /does not exist|schema cache/i.test(message);
}

/** Envelope every agent-runtime API returns, provisioned or not. */
export type AgentRuntimeEnvelope<T> = T & {
    provisioned: boolean;
    /** Set when provisioned is false: which migration to run. */
    migration?: string;
};
