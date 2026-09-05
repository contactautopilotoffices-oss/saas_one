/**
 * AGENT PLAN COMPOSER — "describe it → see the workflow".
 * -----------------------------------------------------------------------------
 * composeAgent() answers "who is this agent and what may it read".
 * This file answers a DIFFERENT question: "what would it actually DO, step by
 * step, with which tools, and what does it need to know before it can start."
 *
 * The two are not interchangeable. A system prompt is not a workflow, and no
 * amount of prompt tuning turns one into the other — which is why "Describe it"
 * felt like it was answering a question nobody asked.
 *
 * ── WHY THIS IS RULE-BASED FIRST, MODEL SECOND ──────────────────────────────
 *
 * Take the operator's real example: "procure a pedestal fan."
 *
 * What is missing there is not creativity. It is CONTEXT — which site, by when,
 * how many, and down which procurement route. Those are business facts with a
 * finite answer set that this repo already models in tables
 * (procurement_requisitions, procurement_quotations, material_request_
 * comparatives, petty_cash_requests, procurement_budgets). Asking a language
 * model to invent them would be strictly worse than reading them off the schema.
 *
 * So: SLOTS AND ROUTES COME FROM RULES. A model, when a key is configured, only
 * ever ENRICHES — it may add steps and phrase them better; it may not invent a
 * route, a table, or a tool. `plan.source` says which produced it, and the
 * distinction survives into the UI. Nothing here pretends a model ran when it
 * did not; that is the same posture as the COUNCIL_MOCK_LLM guards.
 *
 * ── THE ONE INVARIANT ───────────────────────────────────────────────────────
 * Every tool named in a plan is resolved against what is ACTUALLY configured on
 * this deployment (env-backed) and stamped connected | missing. A plan that
 * silently assumes a tool exists is how an agent goes live and does nothing.
 */

import type { ModuleKey } from '@/frontend/types/agentRuntime';

/* ---------------------------------------------------------------------------
 * Shapes
 * ------------------------------------------------------------------------- */

/** What a step does. Drives its icon and lane in the canvas. */
export type PlanStepKind =
    | 'resolve'   // pin down missing context
    | 'search'    // reach outside the org (web, vendor sites)
    | 'fetch'     // read our own tables
    | 'decide'    // branch on a rule
    | 'draft'     // produce a document/message, unsent
    | 'approve'   // a human gate — the agent stops here
    | 'write'     // mutate a business record
    | 'notify';   // tell someone

export const PLAN_STEP_KINDS: readonly PlanStepKind[] = [
    'resolve', 'search', 'fetch', 'decide', 'draft', 'approve', 'write', 'notify',
] as const;

/**
 * A fact the request did not carry. The agent may not act until every
 * `required` slot is filled — this is the "which property? by when? what route?"
 * problem, made explicit instead of guessed.
 */
export interface PlanSlot {
    key: string;
    question: string;
    /** Why acting without it is unsafe. Shown as the justification, not filler. */
    why: string;
    /** Where the answer legitimately comes from. */
    from: 'operator' | 'table' | 'policy' | 'catalog';
    /** Table or policy that can answer it, when `from` is not 'operator'. */
    lookup?: string | null;
    options?: string[] | null;
    required: boolean;
    /**
     * Whether "All properties" is a legitimate answer. When true the hydrator
     * prepends it to the option list.
     *
     * This is NOT cosmetic. Choosing All means the workflow FANS OUT — it runs
     * once per site, because a per-site budget, approver and delivery address
     * cannot be collapsed into one. `fanOut` says so, and the canvas warns.
     */
    allowAll?: boolean;
    /** Set when picking All multiplies the run rather than widening one run. */
    fanOut?: boolean;
}

/** The literal option text. One constant so hydrator and UI cannot disagree. */
export const ALL_SCOPE_OPTION = 'All properties';

/** One node on the canvas. */
export interface PlanStep {
    id: string;
    title: string;
    kind: PlanStepKind;
    /** Upstream step ids. The canvas draws an edge per entry. */
    needs: string[];
    /** Tool slug this step calls, or null for pure reasoning. */
    tool: string | null;
    /** Tables it reads or writes. Must exist in the org catalog. */
    tables: string[];
    /** Who performs it: the agent, or a named human role for an approval gate. */
    actor: string;
    /** What downstream steps get from it. */
    produces: string;
    /** Present when a slot must be filled before this step may run. */
    blockedBy: string[];
}

/** A capability the plan needs, resolved against this deployment. */
export interface ToolBinding {
    slug: string;
    label: string;
    purpose: string;
    status: 'connected' | 'missing';
    /** Env vars that decide `status`. Named so the fix is obvious. */
    requires: string[];
}

export interface PlanRole {
    name: string;
    does: string;
}

export interface AgentPlan {
    intent: string;
    module: ModuleKey | null;
    /** 'rules' — deterministic, no model ran. 'model' — a model enriched it. */
    source: 'rules' | 'model';
    slots: PlanSlot[];
    steps: PlanStep[];
    tools: ToolBinding[];
    roles: PlanRole[];
    /** Honest caveats. Rendered, never swallowed. */
    notes: string[];
}

/* ---------------------------------------------------------------------------
 * Tool registry — status is derived from env, never asserted.
 * ------------------------------------------------------------------------- */

interface ToolSpec {
    slug: string;
    label: string;
    purpose: string;
    requires: string[];
}

const TOOL_SPECS: Record<string, ToolSpec> = {
    web_search: {
        slug: 'web_search',
        label: 'Web search',
        purpose: 'Find products, market rates and suppliers outside the org.',
        requires: ['EXA'],
    },
    db_read: {
        slug: 'db_read',
        label: 'Org database (read)',
        purpose: 'Read the tables in this agent’s bundle.',
        requires: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    },
    db_write: {
        slug: 'db_write',
        label: 'Org database (write)',
        purpose: 'Create or update a business record.',
        requires: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    },
    zoho_books: {
        slug: 'zoho_books',
        label: 'Zoho Books',
        purpose: 'Raise and read purchase orders.',
        requires: ['ZOHO_BOOKS_CLIENT_ID', 'ZOHO_BOOKS_CLIENT_SECRET', 'ZOHO_BOOKS_REFRESH_TOKEN'],
    },
    email: {
        slug: 'email',
        label: 'Email (SMTP)',
        purpose: 'Send RFQs, approvals and digests.',
        requires: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'],
    },
    whatsapp: {
        slug: 'whatsapp',
        label: 'WhatsApp',
        purpose: 'Reach site staff and vendors on WhatsApp.',
        requires: ['WASENDER_API_KEY'],
    },
    push: {
        slug: 'push',
        label: 'Push notification',
        purpose: 'Notify an approver in-app.',
        requires: ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'],
    },
    llm: {
        slug: 'llm',
        label: 'Language model',
        purpose: 'Summarise, compare, adjudicate and draft prose.',
        // Any of these satisfies it — the repo routes through
        // backend/lib/council/llm.ts, which supports openai | groq | custom.
        // Hardcoding OPENAI_API_KEY reported the model as missing on a
        // deployment that had a perfectly good engy.ai key configured.
        requires: ['COUNCIL_API_KEY|OPENAI_API_KEY|GROQ_API_KEY'],
    },
};

/** True only when every named env var is present and non-empty. */
/**
 * A requirement may be a single var, or alternatives separated by '|' where any
 * one satisfies it. The LLM is the case that matters: three providers are
 * supported and demanding one specific key mislabels a working deployment.
 */
function toolStatus(spec: ToolSpec, env: NodeJS.ProcessEnv): 'connected' | 'missing' {
    const has = (k: string) => typeof env[k] === 'string' && String(env[k]).trim().length > 0;
    return spec.requires.every((req) => req.split('|').some(has)) ? 'connected' : 'missing';
}

export function bindTools(slugs: string[], env: NodeJS.ProcessEnv = process.env): ToolBinding[] {
    const seen = new Set<string>();
    const out: ToolBinding[] = [];
    for (const slug of slugs) {
        if (seen.has(slug)) continue;
        seen.add(slug);
        const spec = TOOL_SPECS[slug];
        if (!spec) continue;
        out.push({
            slug: spec.slug,
            label: spec.label,
            purpose: spec.purpose,
            status: toolStatus(spec, env),
            requires: spec.requires,
        });
    }
    return out;
}

/* ---------------------------------------------------------------------------
 * Intent detection. Deliberately small and readable — a keyword table, not a
 * classifier, so a wrong match is obvious and fixable by anyone.
 * ------------------------------------------------------------------------- */

export type PlanIntent = 'procure_item' | 'chase_approval' | 'report' | 'unknown';

const INTENT_PATTERNS: Array<{ intent: PlanIntent; re: RegExp }> = [
    { intent: 'procure_item', re: /\b(procure|purchase|buy|source|sourcing|indent|requisition|rfq|quotation|vendor identification|shortlist)\b/i },
    { intent: 'chase_approval', re: /\b(chase|follow[- ]?up|pending approval|stuck|overdue|escalat)\b/i },
    { intent: 'report', re: /\b(report|digest|summary|summarise|summarize|dashboard)\b/i },
];

export function detectIntent(description: string): PlanIntent {
    for (const { intent, re } of INTENT_PATTERNS) {
        if (re.test(description)) return intent;
    }
    return 'unknown';
}

/* ---------------------------------------------------------------------------
 * The procurement plan. This is the one the operator asked for by name.
 * ------------------------------------------------------------------------- */

/**
 * Routes are not invented: each maps to a table this repo actually has, so a
 * route the org cannot execute can never be offered.
 */
const PROCUREMENT_ROUTES = [
    'Direct PO (known vendor, catalogue rate)',
    'Quotation comparative (3 quotes, compared)',
    'Monthly requisition (rolled into the site’s monthly indent)',
    'Petty cash (site buys locally, reimbursed)',
] as const;

function procurementSlots(): PlanSlot[] {
    return [
        {
            key: 'site',
            question: 'Which property is this for?',
            why: 'Budget, approver and delivery address are all per-site. A requisition with no site cannot be costed or approved. Choosing all sites raises one requisition per site, not one shared requisition.',
            from: 'table',
            lookup: 'properties',
            options: null,
            required: true,
            allowAll: true,
            fanOut: true,
        },
        {
            key: 'item_spec',
            question: 'What exactly, and how many? (size / rating / quantity)',
            why: 'A "pedestal fan" is not a spec. Without size and quantity, quotes are not comparable and the catalogue cannot be matched.',
            from: 'catalog',
            lookup: 'procurement_catalog',
            options: null,
            required: true,
        },
        {
            key: 'need_by',
            question: 'Needed by when?',
            why: 'Decides whether there is time for a 3-quote comparative or whether this must go direct.',
            from: 'operator',
            lookup: null,
            options: null,
            required: true,
        },
        {
            key: 'route',
            question: 'Which procurement route?',
            why: 'Each route has a different approval chain and a different record. Guessing it puts the spend in the wrong place.',
            from: 'policy',
            lookup: 'procurement_budgets',
            options: [...PROCUREMENT_ROUTES],
            required: true,
        },
        {
            key: 'threshold',
            question: 'Above what value must this go to a 3-quote comparative?',
            why: 'This repo has no threshold recorded. Until an operator states it, the agent cannot choose a route on value and must ask.',
            from: 'policy',
            lookup: null,
            options: null,
            required: false,
        },
    ];
}

function procurementSteps(): PlanStep[] {
    return [
        {
            id: 's1',
            title: 'Resolve site, spec, date and route',
            kind: 'resolve',
            needs: [],
            tool: null,
            tables: ['properties', 'procurement_catalog'],
            actor: 'agent',
            produces: 'A complete request: site + spec + quantity + need-by + route',
            blockedBy: ['site', 'item_spec', 'need_by', 'route'],
        },
        {
            id: 's2',
            title: 'Check stock on hand at that site',
            kind: 'fetch',
            needs: ['s1'],
            tool: 'db_read',
            tables: ['stock_items', 'stock_movements'],
            actor: 'agent',
            produces: 'On-hand quantity — buying what we already hold is the cheapest failure to avoid',
            blockedBy: [],
        },
        {
            id: 's3',
            title: 'Look up the catalogue rate and budget envelope',
            kind: 'fetch',
            needs: ['s1'],
            tool: 'db_read',
            tables: ['procurement_catalog', 'procurement_budgets', 'property_monthly_requisition_budgets'],
            actor: 'agent',
            produces: 'Expected rate and the remaining budget for this site and month',
            blockedBy: [],
        },
        {
            id: 's4',
            title: 'Shortlist known vendors who supply this category',
            kind: 'fetch',
            needs: ['s1'],
            tool: 'db_read',
            tables: ['vendors', 'vendor_profiles'],
            actor: 'agent',
            produces: 'Vendors we already trade with, with KYC and GST status',
            blockedBy: [],
        },
        {
            id: 's5',
            title: 'Search the market for specs and indicative prices',
            kind: 'search',
            needs: ['s1'],
            tool: 'web_search',
            tables: [],
            actor: 'agent',
            produces: 'Outside price signal — the sanity check on the catalogue rate',
            blockedBy: [],
        },
        {
            id: 's6',
            title: 'Decide the route on value, urgency and budget',
            kind: 'decide',
            needs: ['s2', 's3', 's4', 's5'],
            tool: null,
            tables: [],
            actor: 'agent',
            produces: 'Direct PO | comparative | monthly requisition | petty cash',
            blockedBy: ['threshold'],
        },
        {
            id: 's7',
            title: 'Draft the requisition and the RFQ to shortlisted vendors',
            kind: 'draft',
            needs: ['s6'],
            tool: 'llm',
            tables: ['procurement_requisitions'],
            actor: 'agent',
            produces: 'An unsent requisition and RFQ, ready for a human to read',
            blockedBy: [],
        },
        {
            id: 's8',
            title: 'Procurement approval',
            kind: 'approve',
            needs: ['s7'],
            tool: null,
            tables: ['po_workflow_state'],
            actor: 'Procurement approver',
            produces: 'Go / no-go. The agent stops here and does not proceed on its own.',
            blockedBy: [],
        },
        {
            id: 's9',
            title: 'Send the RFQ to vendors',
            kind: 'notify',
            needs: ['s8'],
            tool: 'email',
            tables: [],
            actor: 'agent',
            produces: 'RFQ sent, responses tracked against the requisition',
            blockedBy: [],
        },
        {
            id: 's10',
            title: 'Record quotes and build the comparative',
            kind: 'write',
            needs: ['s9'],
            tool: 'db_write',
            tables: ['procurement_quotations', 'material_request_comparatives'],
            actor: 'agent',
            produces: 'A comparative a human can approve against',
            blockedBy: [],
        },
        {
            id: 's11',
            title: 'Raise the PO in Zoho Books',
            kind: 'write',
            needs: ['s10'],
            tool: 'zoho_books',
            tables: ['zoho_purchase_orders'],
            actor: 'agent',
            produces: 'PO raised against the approved quote',
            blockedBy: [],
        },
    ];
}

const PROCUREMENT_ROLES: PlanRole[] = [
    { name: 'Site / requestor', does: 'Raises the need and confirms spec and quantity.' },
    { name: 'Procurement approver', does: 'Approves the route and the spend before anything is sent.' },
    { name: 'Finance', does: 'Sees the PO and the payment once raised.' },
    { name: 'Agent (Ira)', does: 'Everything between: lookups, market search, drafting, recording.' },
];

/* ---------------------------------------------------------------------------
 * Fallback plan — used when the intent is not one we model. Deliberately thin:
 * a wrong-but-confident plan is worse than an honest skeleton.
 * ------------------------------------------------------------------------- */

function genericPlan(description: string): Pick<AgentPlan, 'slots' | 'steps' | 'roles'> {
    return {
        slots: [
            {
                key: 'scope',
                question: 'Which property (or all) does this cover?',
                why: 'Nearly every table in this system is scoped by property.',
                from: 'table',
                lookup: 'properties',
                options: null,
                required: true,
                allowAll: true,
                fanOut: false,
            },
            {
                key: 'cadence',
                question: 'When should this run — on a schedule, or on an event?',
                why: 'Decides whether the executor is a cron or a webhook.',
                from: 'operator',
                lookup: null,
                options: ['Daily', 'Weekly', 'On a record changing', 'Manual only'],
                required: true,
            },
            {
                key: 'outcome',
                question: 'What should exist at the end that does not exist now?',
                why: 'An agent with no defined artefact cannot be evaluated, only watched.',
                from: 'operator',
                lookup: null,
                options: null,
                required: true,
            },
        ],
        steps: [
            {
                id: 's1', title: 'Resolve scope and cadence', kind: 'resolve', needs: [], tool: null,
                tables: ['properties'], actor: 'agent', produces: 'A runnable scope',
                blockedBy: ['scope', 'cadence', 'outcome'],
            },
            {
                id: 's2', title: 'Read the relevant records', kind: 'fetch', needs: ['s1'], tool: 'db_read',
                tables: [], actor: 'agent', produces: 'The rows this task reasons over', blockedBy: [],
            },
            {
                id: 's3', title: 'Decide what needs action', kind: 'decide', needs: ['s2'], tool: null,
                tables: [], actor: 'agent', produces: 'A shortlist', blockedBy: [],
            },
            {
                id: 's4', title: 'Draft the output', kind: 'draft', needs: ['s3'], tool: 'llm',
                tables: [], actor: 'agent', produces: 'An unsent artefact', blockedBy: [],
            },
            {
                id: 's5', title: 'Human approval', kind: 'approve', needs: ['s4'], tool: null,
                tables: [], actor: 'Operator', produces: 'Go / no-go', blockedBy: [],
            },
            {
                id: 's6', title: 'Deliver', kind: 'notify', needs: ['s5'], tool: 'email',
                tables: [], actor: 'agent', produces: 'Sent, and recorded on the run trace', blockedBy: [],
            },
        ],
        roles: [
            { name: 'Operator', does: 'Approves before anything leaves the system.' },
            { name: 'Agent', does: `Executes the described task: ${description.slice(0, 120)}` },
        ],
    };
}

/* ---------------------------------------------------------------------------
 * Entry point
 * ------------------------------------------------------------------------- */

export interface ComposePlanInput {
    description: string;
    /** The org's real tables. Steps naming anything outside this are flagged. */
    availableTables?: ReadonlyArray<string>;
    env?: NodeJS.ProcessEnv;
}

/**
 * Build the workflow plan. Pure, synchronous, no database, no model — so it
 * works with no API key and an unprovisioned database, which is exactly the
 * state the console is in today.
 */
export function composePlan(input: ComposePlanInput): AgentPlan {
    const env = input.env ?? process.env;
    const description = (input.description ?? '').trim();
    const intent = detectIntent(description);

    const body =
        intent === 'procure_item'
            ? { slots: procurementSlots(), steps: procurementSteps(), roles: PROCUREMENT_ROLES }
            : genericPlan(description);

    const tools = bindTools(
        body.steps.map((s) => s.tool).filter((t): t is string => Boolean(t)),
        env,
    );

    const notes: string[] = [];

    if (intent === 'unknown') {
        notes.push(
            'No known intent matched this description, so the plan below is a generic skeleton. ' +
            'It is a starting shape, not a considered workflow.',
        );
    }

    const missing = tools.filter((t) => t.status === 'missing');
    if (missing.length) {
        notes.push(
            `${missing.length} tool${missing.length > 1 ? 's are' : ' is'} not configured on this deployment: ` +
            missing.map((t) => `${t.label} (needs ${t.requires.join(', ')})`).join('; ') +
            '. Steps using them cannot run until the keys are set.',
        );
    }

    // Table grounding — same closed-set posture as composeAgent().
    if (input.availableTables?.length) {
        const have = new Set(input.availableTables.map((t) => t.toLowerCase()));
        const unknown = new Set<string>();
        for (const s of body.steps) {
            for (const t of s.tables) if (!have.has(t.toLowerCase())) unknown.add(t);
        }
        if (unknown.size) {
            notes.push(
                `Referenced but not present in this org: ${[...unknown].join(', ')}. ` +
                'Those steps will need a different source.',
            );
        }
    }

    const blocking = body.slots.filter((s) => s.required).length;
    if (blocking) {
        notes.push(
            `${blocking} question${blocking > 1 ? 's' : ''} must be answered before this agent can act. ` +
            'They are questions of fact, not preference — the agent cannot infer them safely.',
        );
    }

    return {
        intent: description || '(no description given)',
        module: intent === 'procure_item' ? 'procurement' : null,
        source: 'rules',
        slots: body.slots,
        steps: body.steps,
        tools,
        roles: body.roles,
        notes,
    };
}
