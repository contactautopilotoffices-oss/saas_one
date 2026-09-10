import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    AGENT_MODULE_DESCRIPTORS,
    BASE_MIGRATION,
    RUNTIME_MIGRATION,
    isMissingSchema,
    isUuid,
    orgIdFrom,
    type ModuleKey,
} from '../_shared';

/**
 * /api/agents/registry — the agent workforce, as the org admin sees and edits it.
 *
 * GET  ?orgId=   registry ⋈ oem_agent_profile ⋈ active bundle, plus the module
 *                surface so every module can show "there is movement here".
 * POST ?orgId=   action = 'upsert' | 'set_status' | 'save_prompt'
 *
 * THREE PRODUCT RULES ARE ENFORCED HERE, NOT IN THE UI:
 *
 *  1. Nothing 500s on a missing table. Migration 20260830000001 has not been
 *     applied yet; every handler answers 200 with provisioned:false so the
 *     console renders "not provisioned" rather than a broken panel.
 *
 *     BUT A MISSING TABLE AND A FAILED QUERY ARE DIFFERENT ANSWERS, and this
 *     endpoint makes strong claims about an agent's productivity — "12 runs in
 *     30 days", "last run never", "no runs in 30 days" — so it must not make
 *     any of them on the strength of a read that did not work. Three states:
 *
 *       (i)   table absent (42P01 / 42703 / PGRST204 / PGRST205)
 *             -> ok:true, provisioned:false (or the key in `missing`). A known
 *                state: the table is not there, so nothing has been recorded.
 *       (ii)  a GENUINE query error — the table IS there and the read still
 *             failed (permission, timeout, bad filter, connection)
 *             -> ok:false, a scoped *_error, and NULL for every field derived
 *                from that read. Nothing is known, so nothing is asserted.
 *       (iii) the query worked and matched nothing -> real zeros. An answer.
 *
 *     `runs_30d`, `failures_30d`, `last_run_at` and `modules_touched` are
 *     therefore NULLABLE, and null means "we could not read it", never "none".
 *     Renderers must print — for a null, never 0 and never "never".
 *
 *     There are FOUR secondary reads and therefore four envelopes —
 *     `runs_error`, `profile_error`, `bundles_error`, `council_error` — each set
 *     only in case (ii). Any of them makes `ok` false. The rule is the same for
 *     all four: a null next to a set envelope is UNKNOWN; the same null next to
 *     a null envelope is a real "none".
 *
 *     This route still never 500s (a dead console reads as a broken product);
 *     the failure is carried in the body, which is what the console reads.
 *
 *  2. draft → live is REFUSED. A new agent must pass through 'shadow', where it
 *     reasons and logs but does not act. Shadow is how a version is proven safe
 *     before it can touch the business; skipping it is the one shortcut that
 *     cannot be allowed to be a UI checkbox.
 *
 *  3. Saving a prompt is NON-DESTRUCTIVE. It increments system_prompt_version
 *     and writes the OUTGOING prompt into oem_council_log.details, so every
 *     prior version stays recoverable and every change stays attributable.
 *     Existing versions are untouched; the new version simply becomes current.
 *     The increment is a compare-and-swap, so two concurrent saves can never
 *     both write v(n+1) — see savePrompt().
 *
 * AUTHORIZATION: GET is open to any member of the org. POST is not. Every POST
 * action mutates the agent workforce — its identity, its runtime budget and
 * schedule, its live/shadow status, its system prompt — so POST requires an
 * organization admin role, resolved exactly the way the sibling
 * app/api/agents/credentials/route.ts resolves it. See REGISTRY_WRITE_ROLES.
 */

export const dynamic = 'force-dynamic';

/* ==========================================================================
 * AUTHORIZATION
 *
 * Copied from the sibling app/api/agents/credentials/route.ts (same role set,
 * same membership sources, same 403 shapes) rather than invented here, so the
 * whole /api/agents surface answers one question one way. The duplication
 * between this file and bundles/route.ts is deliberate for now — the natural
 * home is ../_shared.ts, which is out of scope for this change.
 *
 * supabaseAdmin is used ONLY to resolve the caller's memberships. Every read
 * and write of registry data below stays on the RLS-scoped user client, so this
 * does not widen the data path — it only answers "who is asking".
 * ========================================================================== */

/** Roles that may CHANGE the registry. Reading it needs only membership. */
const REGISTRY_WRITE_ROLES = ['org_super_admin', 'master_admin', 'org_admin'];

/** Returns a 403 response to send, or null when the caller may write. */
async function requireOrgAdmin(orgId: string, userId: string): Promise<NextResponse | null> {
    const [profileRes, orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', userId).maybeSingle(),
        supabaseAdmin
            .from('organization_memberships')
            .select('organization_id, role')
            .eq('user_id', userId)
            .eq('is_active', true),
        supabaseAdmin
            .from('property_memberships')
            .select('organization_id, role')
            .eq('user_id', userId)
            .eq('is_active', true),
    ]);

    const isMasterAdmin = !!profileRes.data?.is_master_admin;
    const memberships = [...(orgRes.data ?? []), ...(propRes.data ?? [])] as {
        organization_id: string | null;
        role: string | null;
    }[];
    const inOrg = memberships.filter((m) => m.organization_id === orgId);

    if (!isMasterAdmin && inOrg.length === 0) {
        // Same message for "wrong org" and "no such org": do not confirm that an
        // organization id exists to someone who is not in it.
        return NextResponse.json({ error: 'Forbidden: no access to this organization' }, { status: 403 });
    }

    const roles = [...new Set(inOrg.map((m) => m.role).filter(Boolean))] as string[];
    if (!isMasterAdmin && !roles.some((r) => REGISTRY_WRITE_ROLES.includes(r))) {
        return NextResponse.json(
            {
                error:
                    'Forbidden: changing an agent requires an organization admin role. ' +
                    'Status, system prompt and runtime configuration decide what an autonomous agent is allowed to do, ' +
                    'so they are not member-level edits.',
            },
            { status: 403 }
        );
    }

    return null;
}

/* ========================================================================== */
/* Shapes                                                                     */
/* ========================================================================== */

const AGENT_STATUSES = ['draft', 'shadow', 'live', 'paused', 'retired'] as const;
type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * Legal status moves. Everything a human plausibly wants is here; the two
 * omissions are deliberate: draft→live and retired→live. An agent may only
 * become live from a state in which it has already been observed (shadow or
 * paused). Shadow is the proving ground.
 */
const TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
    draft: ['shadow', 'retired'],
    shadow: ['live', 'paused', 'draft', 'retired'],
    live: ['paused', 'shadow', 'retired'],
    paused: ['live', 'shadow', 'retired'],
    retired: ['draft', 'shadow'],
};

/**
 * AN ADDRESS, WITH OR WITHOUT THE NAME IN FRONT OF IT.
 *
 * `z.string().email()` accepts `vidya@worksquare.in` and rejects
 * `Vidya <purchase@worksquare.in>` — which is a perfectly ordinary RFC 5322
 * mailbox, is what the console itself wrote into recipients.sites, and is what
 * nodemailer sends to without complaint.
 *
 * The consequence was not a cosmetic warning. Saving the delivery form
 * re-validates the WHOLE runtime object, so three site rows nobody was editing
 * made every other change unsaveable — including switching off the reply
 * responder while it was mailing a shared inbox every fifteen minutes. A
 * validator that blocks an unrelated emergency edit is a worse bug than the
 * looseness it was guarding against.
 *
 * So: accept both forms, and validate the part that actually has to be an
 * address.
 */
const ADDRESS_WITH_NAME = /^\s*(?:"?([^"<>]*)"?\s*)?<\s*([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)\s*>\s*$/;

const EmailAddress = z
    .string()
    .trim()
    .max(160)
    .refine(
        (v) => {
            const m = ADDRESS_WITH_NAME.exec(v);
            const addr = m ? m[2] : v;
            return z.string().email().safeParse(addr).success;
        },
        { message: 'Invalid email address — use name@example.com or Name <name@example.com>' },
    );

const EmailList = z.array(EmailAddress).max(25);

const RuntimeSchema = z.looseObject({
    // --- delivery. Per-agent, editable from the console, never from env. -----
    inbox: z
        .looseObject({
            from: z.string().trim().email().max(160).nullish(),
            reply_to: z.string().trim().email().max(160).nullish(),
            poll_address: z.string().trim().email().max(160).nullish(),
        poll_addresses: EmailList.nullish(),
            lookback_hours: z.number().int().min(1).max(168).nullish(),
        })
        .nullish(),
    recipients: z
        .looseObject({
            roles: z
                .looseObject({ ceo: EmailList.nullish(), procurement: EmailList.nullish(), technical: EmailList.nullish() })
                .nullish(),
            // property name/code -> who owns it. Falls back to the role list.
            sites: z.record(z.string().trim().max(120), EmailList).nullish(),
        })
        .nullish(),
    respond: z
        .looseObject({
            enabled: z.boolean().nullish(),
            on: z.array(z.enum(['need_info', 'blocked'])).max(2).nullish(),
        })
        .nullish(),
    schedule_cron: z.string().trim().max(120).nullish(),
    timezone: z.string().trim().max(64).nullish(),
    quiet_hours: z
        .looseObject({
            from: z.string().trim().max(8).nullish(),
            to: z.string().trim().max(8).nullish(),
        })
        .nullish(),
    heartbeat_interval_sec: z.number().int().min(30).max(86_400).nullish(),
    max_runs_per_day: z.number().int().min(0).max(10_000).nullish(),
    max_cost_inr_per_day: z.number().min(0).max(10_000_000).nullish(),
    timeout_sec: z.number().int().min(5).max(3_600).nullish(),
    autonomy: z.enum(['suggest', 'act']).nullish(),
    reports_to: z.string().trim().toLowerCase().regex(/^[a-z_]{2,40}$/).nullish(),
});

const ModelConfigSchema = z.looseObject({
    provider: z.string().trim().max(40).nullish(),
    model: z.string().trim().max(120).nullish(),
    temperature: z.number().min(0).max(2).nullish(),
    top_p: z.number().min(0).max(1).nullish(),
    max_tokens: z.number().int().min(1).max(1_000_000).nullish(),
    context_window: z.number().int().min(1).max(10_000_000).nullish(),
});

const AGENT_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/;

const UpsertSchema = z.object({
    agent_key: z
        .string()
        .trim()
        .toLowerCase()
        .regex(AGENT_KEY_RE, 'agent_key must be lowercase letters, digits, _ or - (2-63 chars)'),
    /**
     * Required only when CREATING. An existing agent keeps the name it has, so a
     * partial update — the Delivery tab saving nothing but `runtime` — must not
     * be forced to re-send identity it is not editing. Enforced below, where it
     * is known whether the row exists.
     */
    display_name: z.string().trim().min(2).max(120).optional(),
    department: z.string().trim().max(80).nullish(),
    role_description: z.string().trim().max(4_000).nullish(),
    runtime: RuntimeSchema.nullish(),
    model_config: ModelConfigSchema.nullish(),
    config: z.record(z.string(), z.unknown()).nullish(),
});

const SetStatusSchema = z.object({
    agent_key: z.string().trim().toLowerCase().regex(AGENT_KEY_RE),
    status: z.enum(AGENT_STATUSES),
    reason: z.string().trim().max(500).nullish(),
});

const SavePromptSchema = z.object({
    agent_key: z.string().trim().toLowerCase().regex(AGENT_KEY_RE),
    system_prompt: z.string().min(1).max(200_000),
    note: z.string().trim().max(500).nullish(),
    /**
     * The operator corrections this prompt text actually folded in — and ONLY
     * those. Each id is stamped with the version that absorbed it, which is what
     * moves it out of the console's "waiting to be absorbed" list.
     *
     * Omit it, or send [], and nothing is stamped. See the comment in
     * savePrompt() for why "absorb everything pending" is not an option.
     */
    absorbed_feedback_ids: z.array(z.uuid()).max(500).optional(),
    /**
     * DEPRECATED and ignored. It used to mean "stamp every pending correction",
     * which silently absorbed guidance the new prompt had never seen. Still
     * accepted so an older client gets its prompt saved instead of a 400; the
     * response carries `feedback_absorb_ignored` so the mismatch is visible.
     */
    absorb_feedback: z.boolean().optional(),
});

/** Strip keys the caller did not send, so an update never nulls a field by omission. */
function defined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function zodMessage(err: z.ZodError): string {
    return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

/* ========================================================================== */
/* GET                                                                        */
/* ========================================================================== */

interface AgentRow {
    id: string;
    agent_key: string;
    display_name: string;
    department: string | null;
    status: string;
    [k: string]: unknown;
}

/**
 * The shared failure envelope used across /api/agents (pulse, runs, summary,
 * registry, profile). `scope` names which read died, `reason` is the sentence a
 * console can show verbatim, and its presence is what tells a renderer that the
 * nulls beside it mean "unknown" rather than "none".
 */
interface QueryFailure {
    scope: string;
    code: string | null;
    message: string;
    reason: string;
}

function queryFailure(
    scope: string,
    error: { code?: string | null; message?: string | null } | null | undefined,
    reason: string,
): QueryFailure {
    return {
        scope,
        code: error?.code ?? null,
        message: error?.message ?? 'The query failed without a message.',
        reason,
    };
}

/** Sentence shown wherever a run-derived figure had to be withheld. */
const RUNS_UNREADABLE_REASON =
    'The agent run log could not be read, so 30-day runs, failures, last-run time and '
    + 'modules touched are UNKNOWN for every agent. This is not the same as "no runs in 30 '
    + 'days" — render each null as — , never as 0 or "never".';

export async function GET(request: NextRequest) {
    // The unprovisioned payload: real zeros against a table that is known not to
    // exist. `ok: true` because that is a truthful answer, not a failure.
    const empty = {
        ok: true,
        provisioned: false,
        runtime_provisioned: false,
        migration: RUNTIME_MIGRATION,
        missing: [] as string[],
        agents: [] as unknown[],
        modules: AGENT_MODULE_DESCRIPTORS.map((m) => ({
            ...m,
            agent_count: 0,
            agent_keys: [] as string[],
            runs_30d: 0 as number | null,
            failures_30d: 0 as number | null,
            last_run_at: null as string | null,
        })),
        counts: { total: 0, live: 0, shadow: 0, draft: 0, paused: 0, retired: 0 },
        // One envelope per read. A renderer decides "unknown vs none" by asking
        // whether the envelope beside a null is set, so every path carries all
        // four keys — an absent key would be read as "that read was fine".
        runs_error: null as QueryFailure | null,
        profile_error: null as QueryFailure | null,
        bundles_error: null as QueryFailure | null,
        council_error: null as QueryFailure | null,
    };

    try {
        const orgId = new URL(request.url).searchParams.get('orgId');
        if (!isUuid(orgId)) {
            // No org was named, so nothing was looked up. `provisioned:false` here would
            // be a claim about a database this request never touched.
            return NextResponse.json(
                {
                    ...empty,
                    ok: false,
                    provisioned: null,
                    runtime_provisioned: null,
                    error: 'orgId (uuid) required',
                    // `empty`'s zeros describe a database that was read and found
                    // bare. This request read nothing, so it reports nothing: a
                    // workforce of 0 agents across 0 runs is not a truthful answer
                    // to a question that was never asked.
                    agents: null,
                    counts: null,
                    modules: null,
                },
                { status: 400 },
            );
        }

        const supabase = await createClient();

        // Same guard every sibling GET under /api/agents uses. RLS already keeps
        // rows out of an anonymous caller's reach, but without this the endpoint
        // still answers 200 and discloses the org's provisioning state and module
        // surface to anyone who guesses an orgId.
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const missing: string[] = [];

        // The registry itself. If this is absent, nothing else is worth asking.
        const agentsRes = await supabase
            .from('oem_agents')
            .select('*')
            .eq('organization_id', orgId)
            .order('display_name');

        if (agentsRes.error) {
            if (isMissingSchema(agentsRes.error)) {
                return NextResponse.json({
                    ...empty,
                    migration: BASE_MIGRATION,
                    missing: ['oem_agents'],
                    note: `Agent registry not provisioned yet — run migration ${BASE_MIGRATION}.`,
                });
            }
            // A GENUINE failure of the primary read. This used to fall through to
            // `empty`, which announces provisioned:false — the console then told the
            // org admin to run a migration that is already applied, and reported a
            // workforce of zero agents. The table IS there; what is missing is the
            // answer. Nothing is asserted: agents null, counts null, modules null.
            return NextResponse.json(
                {
                    ...empty,
                    ok: false,
                    provisioned: true,
                    // The runtime half was never reached, so its state is unknown too.
                    // `false` here would print "run the migration" on a live database.
                    runtime_provisioned: null,
                    // `error` stays a plain string: the console renders it directly.
                    error: agentsRes.error.message,
                    registry_error: queryFailure(
                        'registry',
                        agentsRes.error,
                        'The agent registry could not be read, so nothing is known about this '
                        + 'organisation’s agents — not even how many there are.',
                    ),
                    agents: null,
                    counts: null,
                    modules: null,
                },
                { status: 200 },
            );
        }

        const agents = (agentsRes.data ?? []) as AgentRow[];

        // Everything below is best-effort. A missing runtime table degrades the
        // payload; it never fails the request.
        const [profileRes, bundleRes, councilRes, runsRes] = await Promise.all([
            supabase.from('oem_agent_profile').select('*').eq('organization_id', orgId),
            supabase
                .from('oem_agent_bundles')
                .select('agent_key, version, is_active, bundle, created_at')
                .eq('organization_id', orgId)
                .eq('is_active', true),
            supabase
                .from('oem_council_log')
                .select('id, agent_key, review_type, summary, decision, decided_by, created_at')
                .eq('organization_id', orgId)
                .order('created_at', { ascending: false })
                .limit(120),
            supabase
                .from('oem_agent_runs')
                .select('agent_key, module, status, started_at')
                .eq('organization_id', orgId)
                .gte('started_at', new Date(Date.now() - 30 * 864e5).toISOString())
                .order('started_at', { ascending: false })
                .limit(2_000),
        ]);

        if (profileRes.error && isMissingSchema(profileRes.error)) missing.push('oem_agent_profile');
        if (bundleRes.error && isMissingSchema(bundleRes.error)) missing.push('oem_agent_bundles');
        if (councilRes.error && isMissingSchema(councilRes.error)) missing.push('oem_council_log');
        if (runsRes.error && isMissingSchema(runsRes.error)) missing.push('oem_agent_runs');

        // The four best-effort reads, each asked the same question: is this table
        // ABSENT (a known state, listed in `missing`) or did the read FAIL on a table
        // that is there (unknown, and nothing derived from it may be reported)?
        const unreadable = (res: { error: unknown }) =>
            !!res.error && !isMissingSchema(res.error);

        const runsUnreadable = unreadable(runsRes);
        const profileUnreadable = unreadable(profileRes);
        const bundleUnreadable = unreadable(bundleRes);
        const councilUnreadable = unreadable(councilRes);

        const runsError = runsUnreadable
            ? queryFailure('runs', runsRes.error, RUNS_UNREADABLE_REASON)
            : null;
        const profileError = profileUnreadable
            ? queryFailure(
                'profile',
                profileRes.error,
                'The agent profile view could not be read, so reliability, uptime and 30-day '
                + 'totals are UNKNOWN. `profile` is null for that reason, not because the agent '
                + 'has no telemetry.',
            )
            : null;
        const bundleError = bundleUnreadable
            ? queryFailure(
                'bundles',
                bundleRes.error,
                'The active-bundle read failed, so which data each agent is grounded on is '
                + 'UNKNOWN. A null bundle here does not mean the agent has none.',
            )
            : null;
        const councilError = councilUnreadable
            ? queryFailure(
                'council_log',
                councilRes.error,
                'The council log could not be read, so review history is UNKNOWN — not empty.',
            )
            : null;

        const profileByKey = new Map<string, Record<string, unknown>>();
        for (const p of (profileRes.data ?? []) as Array<{ agent_key: string }>) {
            profileByKey.set(p.agent_key, p as unknown as Record<string, unknown>);
        }

        const bundleByKey = new Map<string, Record<string, unknown>>();
        for (const b of (bundleRes.data ?? []) as Array<{ agent_key: string }>) {
            bundleByKey.set(b.agent_key, b as unknown as Record<string, unknown>);
        }

        const councilByKey = new Map<string, Array<Record<string, unknown>>>();
        for (const c of (councilRes.data ?? []) as Array<{ agent_key: string | null }>) {
            const key = c.agent_key ?? '__org__';
            const list = councilByKey.get(key) ?? [];
            if (list.length < 8) list.push(c as unknown as Record<string, unknown>);
            councilByKey.set(key, list);
        }

        type RunRow = { agent_key: string; module: string | null; status: string; started_at: string };
        // Empty ONLY so the rollups below have something to iterate. When
        // `runsUnreadable` is true nothing derived from them is reported.
        const runs = runsUnreadable ? [] : ((runsRes.data ?? []) as RunRow[]);

        // --- per-agent run rollup (30d), used for the live pulse on each card
        const runStatsByKey = new Map<string, { runs_30d: number; failures_30d: number; last_run_at: string | null; modules: Set<string> }>();
        for (const r of runs) {
            const s = runStatsByKey.get(r.agent_key) ?? { runs_30d: 0, failures_30d: 0, last_run_at: null, modules: new Set<string>() };
            s.runs_30d += 1;
            if (r.status === 'failed' || r.status === 'timeout') s.failures_30d += 1;
            if (!s.last_run_at || r.started_at > s.last_run_at) s.last_run_at = r.started_at;
            if (r.module) s.modules.add(r.module);
            runStatsByKey.set(r.agent_key, s);
        }

        const shaped = agents.map((a) => {
            const stats = runStatsByKey.get(a.agent_key);
            const activeBundle = bundleByKey.get(a.agent_key) ?? null;
            const bundleTables =
                activeBundle && typeof activeBundle.bundle === 'object' && activeBundle.bundle
                    ? ((activeBundle.bundle as { tables?: unknown[] }).tables ?? [])
                    : [];
            return {
                ...a,
                profile: profileByKey.get(a.agent_key) ?? null,
                active_bundle: activeBundle,
                bundle_version: (activeBundle?.version as number | undefined) ?? null,
                // 0 tables would read as "grounded on nothing", which is a finding, not
                // a blank. Null when the bundle read failed.
                bundle_table_count: bundleUnreadable
                    ? null
                    : Array.isArray(bundleTables) ? bundleTables.length : 0,
                council_log: councilUnreadable ? null : councilByKey.get(a.agent_key) ?? [],
                // null = the run log could not be read. 0 would be a claim that this
                // agent did nothing for a month, which is not a claim a failed query
                // is allowed to make. `runs_readable` says which reading applies.
                runs_readable: !runsUnreadable,
                runs_30d: runsUnreadable ? null : stats?.runs_30d ?? 0,
                failures_30d: runsUnreadable ? null : stats?.failures_30d ?? 0,
                last_run_at: runsUnreadable ? null : stats?.last_run_at ?? null,
                modules_touched: runsUnreadable ? null : stats ? Array.from(stats.modules).sort() : [],
                /**
                 * True only when the runtime migration is live AND a probe has run.
                 * Null when the profile view could not be read: `false` there would
                 * assert the agent is unmonitored on the strength of a failed query.
                 */
                has_runtime_signal: profileUnreadable ? null : !!profileByKey.get(a.agent_key),
            };
        });

        // --- module surface: which modules the workforce is actually moving in
        const byModule = new Map<string, { runs: number; failures: number; last: string | null; keys: Set<string> }>();
        for (const r of runs) {
            if (!r.module) continue;
            const m = byModule.get(r.module) ?? { runs: 0, failures: 0, last: null, keys: new Set<string>() };
            m.runs += 1;
            if (r.status === 'failed' || r.status === 'timeout') m.failures += 1;
            if (!m.last || r.started_at > m.last) m.last = r.started_at;
            m.keys.add(r.agent_key);
            byModule.set(r.module, m);
        }
        // An agent declares its module via config.module (falling back to department).
        for (const a of agents) {
            const cfg = (a.config ?? {}) as Record<string, unknown>;
            const declared = typeof cfg.module === 'string' ? cfg.module : a.department;
            if (!declared) continue;
            const m = byModule.get(declared) ?? { runs: 0, failures: 0, last: null, keys: new Set<string>() };
            m.keys.add(a.agent_key);
            byModule.set(declared, m);
        }

        const knownKeys = new Set<string>(AGENT_MODULE_DESCRIPTORS.map((m) => m.key as string));
        const modules = [
            ...AGENT_MODULE_DESCRIPTORS.map((m) => {
                const s = byModule.get(m.key);
                return {
                    ...m,
                    // With the run log unreadable this counts DECLARED agents only —
                    // config.module / department — because the observed half is gone.
                    agent_count: s?.keys.size ?? 0,
                    agent_keys: s ? Array.from(s.keys).sort() : [],
                    runs_readable: !runsUnreadable,
                    runs_30d: runsUnreadable ? null : s?.runs ?? 0,
                    failures_30d: runsUnreadable ? null : s?.failures ?? 0,
                    last_run_at: runsUnreadable ? null : s?.last ?? null,
                };
            }),
            // Modules invented at runtime that the catalog does not know about
            // are surfaced rather than swallowed.
            ...Array.from(byModule.entries())
                .filter(([k]) => !knownKeys.has(k))
                .map(([k, s]) => ({
                    key: k as ModuleKey,
                    label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
                    description: 'Module discovered from agent run history.',
                    agent_count: s.keys.size,
                    agent_keys: Array.from(s.keys).sort(),
                    runs_readable: !runsUnreadable,
                    runs_30d: runsUnreadable ? null : s.runs,
                    failures_30d: runsUnreadable ? null : s.failures,
                    last_run_at: runsUnreadable ? null : s.last,
                })),
        ];

        const counts = {
            total: agents.length,
            live: agents.filter((a) => a.status === 'live').length,
            shadow: agents.filter((a) => a.status === 'shadow').length,
            draft: agents.filter((a) => a.status === 'draft').length,
            paused: agents.filter((a) => a.status === 'paused').length,
            retired: agents.filter((a) => a.status === 'retired').length,
        };

        return NextResponse.json({
            // false = part of this payload is UNKNOWN. The agents and their
            // configuration are real; every field marked runs_readable:false is not.
            //
            // ALL FOUR secondary reads count here, not just the run log. A failed
            // bundle read already nulls bundle_table_count, a failed profile read
            // already nulls has_runtime_signal and a failed council read already
            // nulls council_log — but with ok:true and no envelope beside them
            // those nulls read as "no bundle", "no telemetry", "never reviewed",
            // which is the same lie in a quieter register.
            ok: !runsUnreadable && !profileUnreadable && !bundleUnreadable && !councilUnreadable,
            provisioned: true,
            runtime_provisioned: !missing.includes('oem_agent_profile'),
            migration: RUNTIME_MIGRATION,
            missing,
            runs_error: runsError,
            profile_error: profileError,
            bundles_error: bundleError,
            council_error: councilError,
            agents: shaped,
            modules,
            counts,
            // null, not []: an empty list here is the claim "this organisation has
            // never been reviewed", and a failed read may not make it.
            org_council_log: councilUnreadable ? null : councilByKey.get('__org__') ?? [],
        });
    } catch (e) {
        // Never a 500. A dead console reads as a broken product — but a thrown
        // request knows nothing, so it must not answer with `empty`'s zeros either.
        return NextResponse.json({
            ...empty,
            ok: false,
            // Unknown, not "not provisioned": a thrown request never got far enough to
            // learn whether the schema is there, so it must not tell the admin to
            // migrate a database that is already migrated.
            provisioned: null,
            runtime_provisioned: null,
            error: (e as Error).message,
            registry_error: queryFailure(
                'request',
                { message: (e as Error).message },
                'The registry request failed, so the agent workforce is UNKNOWN.',
            ),
            agents: null,
            counts: null,
            modules: null,
        });
    }
}

/* ========================================================================== */
/* POST                                                                       */
/* ========================================================================== */

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const orgId = orgIdFrom(request, body);
        if (!isUuid(orgId)) return NextResponse.json({ error: 'orgId (uuid) required' }, { status: 400 });

        // Every action below this line mutates the workforce. Gate once, here,
        // so a new action cannot be added later without inheriting the check.
        const forbidden = await requireOrgAdmin(orgId, user.id);
        if (forbidden) return forbidden;

        const action = typeof body.action === 'string' ? body.action : '';

        if (action === 'upsert') return upsertAgent(supabase, orgId, user.id, body);
        if (action === 'set_status') return setStatus(supabase, orgId, user.id, body);
        if (action === 'save_prompt') return savePrompt(supabase, orgId, user.id, body);

        return NextResponse.json(
            { error: `Unknown action '${action}'. Expected 'upsert', 'set_status' or 'save_prompt'.` },
            { status: 400 }
        );
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
}

type Db = Awaited<ReturnType<typeof createClient>>;

const NOT_PROVISIONED = (missing: string) =>
    NextResponse.json({
        provisioned: false,
        migration: RUNTIME_MIGRATION,
        missing: [missing],
        agent: null,
        note: `'${missing}' does not exist yet — run migration ${RUNTIME_MIGRATION}.`,
    });

/** Council log writes are advisory: an unprovisioned log must not fail the action. */
async function logCouncil(
    supabase: Db,
    row: {
        organization_id: string;
        agent_key: string;
        review_type: 'prompt_change' | 'goal_binding' | 'bundle_change' | 'performance_review' | 'escalation' | 'note';
        summary: string;
        decision?: 'approved' | 'rejected' | 'needs_human';
        details?: Record<string, unknown>;
        created_by: string;
    }
): Promise<boolean> {
    try {
        const { error } = await supabase.from('oem_council_log').insert({ decided_by: 'human', ...row });
        return !error;
    } catch {
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/* upsert                                                                     */
/**
 * A SAVE MUST NEVER BE ABLE TO EMPTY A DELIVERY CONFIG.
 *
 * `runtime` is written as a whole object, so a form that posts a half-loaded
 * draft replaces the lot. On 10 Sept that is exactly what happened: Ira's
 * recipients, mailboxes and site rules all went to null. The 11:00 scan then
 * ran perfectly — six findings, ten checks, nothing skipped — built its mail
 * and had nobody to send it to. `sent 0, skipped 2`, and no other sign.
 *
 * Losing every recipient is never a thing somebody meant to do in one click.
 * Clearing one list is: emptying the technical role is a normal edit. So the
 * rule is narrow — if the stored value HAD recipients or an inbox and the
 * incoming one has neither, that is a wipe, and it is refused with the reason.
 * Everything short of that is allowed through untouched.
 */
function wipesDeliveryConfig(
    prev: Record<string, unknown> | null | undefined,
    next: Record<string, unknown> | null | undefined,
): string | null {
    if (!prev || !next) return null;
    const had = (o: Record<string, unknown>, k: string) => {
        const v = o[k] as Record<string, unknown> | null | undefined;
        return Boolean(v && typeof v === 'object' && Object.keys(v).length > 0);
    };
    const hadAny = had(prev, 'recipients') || had(prev, 'inbox');
    const hasAny = had(next, 'recipients') || had(next, 'inbox');
    if (!hadAny || hasAny) return null;
    return 'This save would clear every recipient and mailbox at once, which would leave the agent '
        + 'building its mail and having nobody to send it to. If that is genuinely what you want, clear '
        + 'the fields one section at a time.';
}


/* -------------------------------------------------------------------------- */

async function upsertAgent(supabase: Db, orgId: string, userId: string, body: Record<string, unknown>) {
    const parsed = UpsertSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const input = parsed.data;

    const existingRes = await supabase
        .from('oem_agents')
        .select('id, status, display_name, department, role_description, runtime')
        .eq('organization_id', orgId)
        .eq('agent_key', input.agent_key)
        .maybeSingle();

    if (existingRes.error && isMissingSchema(existingRes.error)) return NOT_PROVISIONED('oem_agents');
    const existing = existingRes.data as {
        id: string; status: string; display_name: string;
        runtime?: Record<string, unknown> | null;
    } | null;

    // Creating still needs a name; updating does not. Checked here rather than in
    // the schema because only here is it known which of the two this is.
    if (!existing && !input.display_name) {
        return NextResponse.json(
            { error: 'display_name is required when creating an agent.', field: 'display_name' },
            { status: 400 },
        );
    }

    const wipe = wipesDeliveryConfig(existing?.runtime, input.runtime as Record<string, unknown> | null | undefined);
    if (wipe) return NextResponse.json({ error: wipe, field: 'runtime' }, { status: 409 });

    // Only fields the caller actually sent are written. Status is NOT settable
    // here — it moves through set_status so every transition is logged and the
    // shadow rule cannot be side-stepped by a create call.
    const patch = defined({
        display_name: input.display_name,
        department: input.department ?? undefined,
        role_description: input.role_description ?? undefined,
        runtime: input.runtime ?? undefined,
        model_config: input.model_config ?? undefined,
        config: input.config ?? undefined,
    });

    const write = async (payload: Record<string, unknown>) =>
        existing
            ? supabase
                  .from('oem_agents')
                  .update(payload)
                  .eq('organization_id', orgId)
                  .eq('agent_key', input.agent_key)
                  .select()
                  .single()
            : supabase
                  .from('oem_agents')
                  .insert({
                      organization_id: orgId,
                      agent_key: input.agent_key,
                      status: 'draft',
                      ...payload,
                  })
                  .select()
                  .single();

    let res = await write(patch);
    let runtimeProvisioned = true;

    // runtime / model_config arrive with 20260830000001. Before it is applied,
    // save everything else rather than refusing the whole edit.
    if (res.error && isMissingSchema(res.error) && ('runtime' in patch || 'model_config' in patch)) {
        runtimeProvisioned = false;
        const { runtime: _r, model_config: _m, ...rest } = patch;
        void _r;
        void _m;
        res = await write(rest);
    }

    if (res.error) {
        if (isMissingSchema(res.error)) return NOT_PROVISIONED('oem_agents');
        return NextResponse.json({ error: res.error.message }, { status: 400 });
    }

    await logCouncil(supabase, {
        organization_id: orgId,
        agent_key: input.agent_key,
        review_type: 'note',
        summary: existing
            ? `Configuration updated for '${input.display_name}' (${Object.keys(patch).join(', ') || 'no fields'}).`
            : `Agent '${input.display_name}' created in draft.`,
        decision: 'approved',
        details: { fields: Object.keys(patch), created: !existing, runtime_provisioned: runtimeProvisioned },
        created_by: userId,
    });

    return NextResponse.json(
        {
            provisioned: true,
            runtime_provisioned: runtimeProvisioned,
            created: !existing,
            agent: res.data,
            ...(runtimeProvisioned
                ? {}
                : {
                      note: `runtime / model_config were not saved — those columns arrive with migration ${RUNTIME_MIGRATION}.`,
                  }),
        },
        { status: existing ? 200 : 201 }
    );
}

/* -------------------------------------------------------------------------- */
/* set_status                                                                 */
/* -------------------------------------------------------------------------- */

async function setStatus(supabase: Db, orgId: string, userId: string, body: Record<string, unknown>) {
    const parsed = SetStatusSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const { agent_key, status: next, reason } = parsed.data;

    const currentRes = await supabase
        .from('oem_agents')
        .select('id, status, display_name')
        .eq('organization_id', orgId)
        .eq('agent_key', agent_key)
        .maybeSingle();

    if (currentRes.error && isMissingSchema(currentRes.error)) return NOT_PROVISIONED('oem_agents');
    if (currentRes.error) return NextResponse.json({ error: currentRes.error.message }, { status: 400 });
    if (!currentRes.data) return NextResponse.json({ error: `Agent '${agent_key}' not found.` }, { status: 404 });

    const current = currentRes.data as { status: AgentStatus; display_name: string };
    const from = current.status;

    if (from === next) {
        return NextResponse.json({ provisioned: true, unchanged: true, agent_key, status: next });
    }

    if (!TRANSITIONS[from]?.includes(next)) {
        // The one refusal that carries product meaning gets its own sentence.
        const message =
            (from === 'draft' || from === 'retired') && next === 'live'
                ? `Cannot promote '${agent_key}' straight from ${from} to live. Move it to 'shadow' first: in shadow the agent runs its full reasoning and writes its trace, but takes no action on the business. Shadow is how a version is proven safe before it is allowed to act. Once you have watched a few shadow runs, promote shadow → live.`
                : `Illegal status transition ${from} → ${next}. From '${from}' the allowed moves are: ${TRANSITIONS[from].join(', ')}.`;
        return NextResponse.json(
            { error: message, from, to: next, allowed: TRANSITIONS[from] },
            { status: 400 }
        );
    }

    const { data, error } = await supabase
        .from('oem_agents')
        .update({ status: next })
        .eq('organization_id', orgId)
        .eq('agent_key', agent_key)
        .select()
        .single();

    if (error) {
        if (isMissingSchema(error)) return NOT_PROVISIONED('oem_agents');
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Every status change is auditable. This is the row the console replays.
    const logged = await logCouncil(supabase, {
        organization_id: orgId,
        agent_key,
        review_type: 'note',
        summary: `Status ${from} → ${next} for '${current.display_name}'${reason ? ` — ${reason}` : ''}.`,
        decision: 'approved',
        details: { from, to: next, reason: reason ?? null },
        created_by: userId,
    });

    return NextResponse.json({ provisioned: true, agent: data, from, to: next, logged });
}

/* -------------------------------------------------------------------------- */
/* save_prompt                                                                */
/* -------------------------------------------------------------------------- */

async function savePrompt(supabase: Db, orgId: string, userId: string, body: Record<string, unknown>) {
    const parsed = SavePromptSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: zodMessage(parsed.error) }, { status: 400 });
    const { agent_key, system_prompt, note, absorbed_feedback_ids, absorb_feedback } = parsed.data;

    /* ======================================================================
     * VERSION NUMBERS ARE THE SPINE. The console promises "saving creates the
     * next version", and the council log is the version store, so two saves
     * that both land on v4 do not merely race — they corrupt the audit trail
     * with two different prompts claiming the same version.
     *
     * MECHANISM: optimistic concurrency control. The UPDATE carries the version
     * it expects to replace:
     *
     *   UPDATE oem_agents SET system_prompt_version = n+1, ...
     *    WHERE organization_id = $1 AND agent_key = $2
     *      AND system_prompt_version = n            <- the compare
     *
     * That is one statement, so PostgREST runs it in one transaction and
     * Postgres serializes it on the row. UNIQUE (organization_id, agent_key) on
     * oem_agents means it addresses exactly one row. Of two concurrent savers
     * that both read n, exactly one updates a row; the loser matches nothing,
     * gets zero rows back, re-reads and claims n+2.
     *
     * Why not a lock: PostgREST gives each statement its own transaction, so
     * SELECT ... FOR UPDATE or pg_advisory_xact_lock taken in one call is
     * already released by the next call — a lock spanning read-then-write is
     * not expressible from here without a SQL function. The row's own version
     * column is the lock token instead. NOTHING IS HELD ACROSS STATEMENTS in
     * this route or in bundles/route.ts, so a prompt save and a bundle save
     * running together cannot deadlock: there is no lock to order.
     *
     * INTERLEAVING, A and B both saving on an agent at v3:
     *   A: read v3            B: read v3
     *   A: update ... where version = 3  -> 1 row, agent now v4
     *   B: update ... where version = 3  -> 0 rows (A moved it), B retries
     *   B: read v4
     *   B: update ... where version = 4  -> 1 row, agent now v5
     * Two saves, two versions, two council entries: v3->v4 and v4->v5. Before
     * this change both wrote v4 and one prompt vanished with no trace.
     * ====================================================================== */
    const MAX_CAS_ATTEMPTS = 5;
    let prevVersion = 0;
    let nextVersion = 0;
    let previousPrompt: string | null = null;
    let displayName = agent_key;
    let updatedRow: Record<string, unknown> | null = null;
    let casContentions = 0;

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS && !updatedRow; attempt++) {
        const currentRes = await supabase
            .from('oem_agents')
            .select('id, display_name, system_prompt, system_prompt_version')
            .eq('organization_id', orgId)
            .eq('agent_key', agent_key)
            .maybeSingle();

        if (currentRes.error && isMissingSchema(currentRes.error)) return NOT_PROVISIONED('oem_agents');
        if (currentRes.error) return NextResponse.json({ error: currentRes.error.message }, { status: 400 });
        if (!currentRes.data) return NextResponse.json({ error: `Agent '${agent_key}' not found.` }, { status: 404 });

        const current = currentRes.data as {
            display_name: string;
            system_prompt: string | null;
            system_prompt_version: number | null;
        };

        prevVersion = current.system_prompt_version ?? 0;
        nextVersion = prevVersion + 1;
        previousPrompt = current.system_prompt ?? null;
        displayName = current.display_name;

        // Re-checked on every attempt: if the save we lost to wrote this exact
        // text, there is nothing left for this request to do.
        if ((current.system_prompt ?? '') === system_prompt) {
            return NextResponse.json({
                provisioned: true,
                unchanged: true,
                agent_key,
                version: prevVersion,
                note: 'Prompt text is identical to the current version — no new version created.',
            });
        }

        const write = supabase
            .from('oem_agents')
            .update({
                system_prompt,
                system_prompt_version: nextVersion,
                prompt_generated_at: new Date().toISOString(),
            })
            .eq('organization_id', orgId)
            .eq('agent_key', agent_key);

        // The compare half of the compare-and-swap. NULL never equals NULL in
        // SQL, so a null version needs `is`, not `eq`. (The column is NOT NULL
        // DEFAULT 0 in the schema; this only guards a legacy row.)
        const casRes = await (current.system_prompt_version === null
            ? write.is('system_prompt_version', null)
            : write.eq('system_prompt_version', prevVersion)
        )
            .select()
            .maybeSingle();

        if (casRes.error) {
            if (isMissingSchema(casRes.error)) return NOT_PROVISIONED('oem_agents');
            return NextResponse.json({ error: casRes.error.message }, { status: 400 });
        }

        // Zero rows matched: a concurrent save moved the version out from under
        // us. Nothing was written, so re-read and claim the next number.
        if (!casRes.data) {
            casContentions += 1;
            continue;
        }

        updatedRow = casRes.data as Record<string, unknown>;
    }

    if (!updatedRow) {
        return NextResponse.json(
            {
                error:
                    `Could not claim the next prompt version for '${agent_key}' after ${MAX_CAS_ATTEMPTS} attempts — ` +
                    `another save keeps landing first. Nothing was changed and no version was consumed. ` +
                    `Reload the current prompt and save again.`,
                contended: true,
            },
            { status: 409 }
        );
    }

    // The archive is written AFTER the swap, not before. oem_agents holds only
    // the current text, so this council entry is the version store — but the
    // outgoing text is already in hand from the attempt that won, so writing it
    // second loses nothing, and writing it first would have stamped the log with
    // a v(n)->v(n+1) transition for every attempt that then lost the CAS.
    // A log entry claiming a version that never existed is worse than a late one.
    const snapshotted = await logCouncil(supabase, {
        organization_id: orgId,
        agent_key,
        review_type: 'prompt_change',
        summary: `System prompt v${prevVersion} → v${nextVersion} for '${displayName}'${note ? ` — ${note}` : ''}.`,
        decision: 'approved',
        details: {
            from_version: prevVersion,
            to_version: nextVersion,
            note: note ?? null,
            previous_prompt: previousPrompt,
            new_prompt_chars: system_prompt.length,
            absorbed_feedback_ids: absorbed_feedback_ids ?? [],
        },
        created_by: userId,
    });

    /* ----------------------------------------------------------------------
     * REINFORCEMENT LOOP. Stamp ONLY the corrections the client says this
     * prompt text actually folded in.
     *
     * This used to stamp every pending correction for the agent whenever a
     * prompt was saved. That is the quiet failure mode of the whole loop: an
     * operator writes guidance, someone edits an unrelated paragraph and saves,
     * and the guidance leaves the "waiting to be absorbed" list having never
     * reached the prompt. It reads as absorbed forever after and nobody ever
     * learns it was dropped. Leaving a correction pending is visible and
     * fixable; silently marking unread guidance as absorbed is neither.
     *
     * So: no ids, no stamps. `.in('id', ids)` is additionally scoped by
     * organization_id and agent_key, so a caller cannot stamp another org's or
     * another agent's feedback by guessing ids, and `.is(..., null)` keeps an
     * already-absorbed row from being re-dated to a later version.
     * -------------------------------------------------------------------- */
    const requestedIds = absorbed_feedback_ids ?? [];
    let absorbed = 0;
    let absorbedIds: string[] = [];
    if (requestedIds.length > 0) {
        try {
            const { data: stamped } = await supabase
                .from('oem_agent_feedback')
                .update({ applied_to_prompt_version: nextVersion })
                .eq('organization_id', orgId)
                .eq('agent_key', agent_key)
                .in('id', requestedIds)
                .is('applied_to_prompt_version', null)
                .select('id');
            absorbedIds = ((stamped ?? []) as Array<{ id: string }>).map((r) => r.id);
            absorbed = absorbedIds.length;
        } catch {
            absorbed = 0;
            absorbedIds = [];
        }
    }

    return NextResponse.json({
        provisioned: true,
        agent: updatedRow,
        version: nextVersion,
        previous_version: prevVersion,
        previous_prompt_archived: snapshotted,
        feedback_absorbed: absorbed,
        absorbed_feedback_ids: absorbedIds,
        ...(casContentions > 0 ? { cas_contentions: casContentions } : {}),
        // An older client sending absorb_feedback:true gets its prompt saved,
        // but is told plainly that nothing was marked absorbed, so the console
        // does not quietly under-report what is still waiting.
        ...(absorb_feedback === true && requestedIds.length === 0
            ? {
                  feedback_absorb_ignored: true,
                  note:
                      'absorb_feedback is no longer honoured. Send absorbed_feedback_ids with the ids this prompt ' +
                      'actually folded in; the remaining corrections stay pending on purpose.',
              }
            : {}),
    });
}
