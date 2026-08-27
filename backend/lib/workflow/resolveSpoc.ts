import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Resolve "who is the SPOC for <domain>/<stage> at level N" from workflow_spoc_rules
 * (supabase/migrations/20260801000002_workflow_spoc_matrix.sql).
 *
 * Same shape as the FMS ticket escalation chain (escalation_hierarchies ->
 * escalation_levels): ordered 1-based levels, one actor per rung, a per-rung SLA.
 * The difference is that a rung may name a ROLE instead of a person, so this module
 * expands roles into concrete user ids via organization_memberships /
 * property_memberships before handing the caller a notify list.
 *
 * The decision half (selectRulesForLadder) is pure; only the two lookups touch the DB.
 */

export const SPOC_DOMAINS = ['procurement', 'petty_cash', 'payment', 'ticket'] as const;
export type SpocDomain = (typeof SPOC_DOMAINS)[number];

export const isSpocDomain = (x: unknown): x is SpocDomain =>
    typeof x === 'string' && (SPOC_DOMAINS as readonly string[]).includes(x);

export interface SpocRule {
    id: string;
    organization_id: string;
    property_id: string | null;
    domain: SpocDomain;
    stage: string;
    level: number;
    spoc_user_id: string | null;
    spoc_role: string | null;
    sla_hours: number | null;
    is_active: boolean;
}

export interface ResolvedSpocLevel {
    ruleId: string;
    level: number;
    stage: string;
    slaHours: number | null;
    /** the role the rule named, if it was a role rule */
    role: string | null;
    /** whether the winning rule was the property override or the org-wide default */
    scope: 'property' | 'organization';
    /** concrete users for this rung, in notify order */
    userIds: string[];
}

export interface SpocResolution {
    /** every user to notify, level ascending, deduped — the caller's notify list */
    userIds: string[];
    levels: ResolvedSpocLevel[];
}

export interface ResolveSpocInput {
    organizationId: string;
    propertyId?: string | null;
    domain: SpocDomain;
    stage: string;
    /** one rung only; omit for the whole ladder, level ascending */
    level?: number | null;
}

const EMPTY: SpocResolution = { userIds: [], levels: [] };

const RULE_COLUMNS =
    'id, organization_id, property_id, domain, stage, level, spoc_user_id, spoc_role, sla_hours, is_active';

// PostgREST truncates a response at 1000 rows, so every list read below pages explicitly
// rather than trusting one round trip.
const PAGE = 1000;

// A property id reaches an .or() filter string, which PostgREST does not parameterise.
// Only ever interpolate something proven to be a uuid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function fetchAllRows<T>(run: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await run(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = data || [];
        out.push(...rows);
        if (rows.length < PAGE) return out;
    }
}

export interface ListSpocRulesInput {
    organizationId: string;
    domain?: SpocDomain | null;
    stage?: string | null;
    /**
     * null/undefined -> org-wide rules only.
     * A uuid -> that property's rules PLUS the org-wide layer it inherits, unless
     * exactScope is set, which returns only rows stored at that exact scope.
     */
    propertyId?: string | null;
    exactScope?: boolean;
    includeInactive?: boolean;
    /** extra PostgREST embed appended to the column list, e.g. the spoc user join */
    embed?: string;
}

/** Paginated rule read shared by resolveSpoc and app/api/workflows/spoc/route.ts. */
export async function listSpocRules<T = SpocRule>(input: ListSpocRulesInput): Promise<T[]> {
    const { organizationId, domain, stage, propertyId, exactScope, includeInactive, embed } = input;
    if (propertyId && !UUID_RE.test(propertyId)) throw new Error('propertyId must be a uuid');
    const columns = embed ? `${RULE_COLUMNS}, ${embed}` : RULE_COLUMNS;

    return fetchAllRows<T>((from, to) => {
        let q = supabaseAdmin
            .from('workflow_spoc_rules')
            .select(columns)
            .eq('organization_id', organizationId);

        if (exactScope || !propertyId) {
            q = propertyId ? q.eq('property_id', propertyId) : q.is('property_id', null);
        } else {
            // Property rows and the org-wide layer together; selectRulesForLadder decides
            // which one wins each rung.
            q = q.or(`property_id.eq.${propertyId},property_id.is.null`);
        }
        if (domain) q = q.eq('domain', domain);
        if (stage) q = q.eq('stage', stage);
        if (!includeInactive) q = q.eq('is_active', true);

        // Ordering must be total, otherwise .range() paging can repeat or skip rows.
        return q
            .order('stage', { ascending: true })
            .order('level', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<PageResult<T>>;
    });
}

/**
 * Pick the winning rule per level.
 *
 * A property-scoped rule shadows the org-wide rule at the same level — the same
 * specificity escalation_hierarchies relies on when a property owns its own chain
 * (backend/db/migrations/20260311_escalation_hierarchy.sql: property_id NULL = org-wide).
 * Rules for other properties are ignored.
 */
export function selectRulesForLadder(
    rules: SpocRule[],
    propertyId?: string | null,
    level?: number | null,
): SpocRule[] {
    const winners = new Map<number, SpocRule>();
    for (const rule of rules) {
        if (!rule.is_active) continue;
        if (rule.property_id && rule.property_id !== propertyId) continue;
        if (level != null && rule.level !== level) continue;
        const current = winners.get(rule.level);
        // Property beats org-wide; otherwise first one in wins (query orders by level).
        if (!current || (rule.property_id && !current.property_id)) winners.set(rule.level, rule);
    }
    return [...winners.values()].sort((a, b) => a.level - b.level);
}

type MembershipRow = { user_id: string; role: string };

/**
 * role -> active user ids.
 *
 * Both membership tables are read, because roles are split across them: org-wide roles
 * (accounts, procurement, org_super_admin) live on organization_memberships while site
 * roles (property_admin, mst, security) only ever exist on property_memberships. Reading
 * just one table would silently resolve half the role vocabulary to nobody.
 *
 * Property members come first for a property-scoped resolution because they are the
 * closer match; with no propertyId the whole org's property members qualify.
 */
async function expandRoles(
    organizationId: string,
    propertyId: string | null | undefined,
    roles: string[],
): Promise<Map<string, string[]>> {
    const byRole = new Map<string, string[]>();
    if (roles.length === 0) return byRole;
    const wanted = new Set(roles);

    // Roles are matched in JS, NOT pushed into `.in('role', …)`. Both membership tables
    // type `role` as the app_role ENUM (backend/db/schema/evolution.sql:14,49,52), and
    // spoc_role is free text with no CHECK — so a value the enum does not know
    // ('purchase_manager', 'purchase_executive', 'manager_executive' are all absent)
    // makes Postgres raise 22P02 and takes the whole resolution down. Same reason
    // backend/lib/pettyCash/notify.ts:31-47 filters in JS.
    //
    // Ordering must be TOTAL for .range() paging: property_memberships holds one row per
    // (user, property), so user_id alone lets Postgres break ties differently between
    // round trips and a user on a page boundary can land in neither page.
    const [propRows, orgRows] = await Promise.all([
        fetchAllRows<MembershipRow>((from, to) => {
            let q = supabaseAdmin
                .from('property_memberships')
                .select('user_id, role')
                .eq('organization_id', organizationId)
                .eq('is_active', true);
            if (propertyId) q = q.eq('property_id', propertyId);
            return q
                .order('user_id', { ascending: true })
                .order('property_id', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to) as unknown as PromiseLike<PageResult<MembershipRow>>;
        }),
        fetchAllRows<MembershipRow>((from, to) =>
            supabaseAdmin
                .from('organization_memberships')
                .select('user_id, role')
                .eq('organization_id', organizationId)
                .eq('is_active', true)
                .order('user_id', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to) as unknown as PromiseLike<PageResult<MembershipRow>>,
        ),
    ]);

    for (const row of [...propRows, ...orgRows]) {
        if (!row.user_id || !row.role || !wanted.has(row.role)) continue;
        const list = byRole.get(row.role) || [];
        if (!list.includes(row.user_id)) list.push(row.user_id);
        byRole.set(row.role, list);
    }
    return byRole;
}

/** Active org members among `userIds` — a named SPOC who has left must stop resolving. */
async function activeMemberIds(organizationId: string, userIds: string[]): Promise<Set<string>> {
    const alive = new Set<string>();
    if (userIds.length === 0) return alive;

    const [orgRes, propRes, userRes] = await Promise.all([
        supabaseAdmin.from('organization_memberships').select('user_id')
            .eq('organization_id', organizationId).eq('is_active', true).in('user_id', userIds),
        supabaseAdmin.from('property_memberships').select('user_id')
            .eq('organization_id', organizationId).eq('is_active', true).in('user_id', userIds),
        supabaseAdmin.from('users').select('id, deleted_at').in('id', userIds),
    ]);

    const notDeleted = new Set(
        ((userRes.data || []) as { id: string; deleted_at: string | null }[])
            .filter(u => !u.deleted_at).map(u => u.id),
    );
    for (const r of [...(orgRes.data || []), ...(propRes.data || [])] as { user_id: string }[]) {
        if (notDeleted.has(r.user_id)) alive.add(r.user_id);
    }
    return alive;
}

/**
 * Resolve the SPOC ladder for one stage.
 *
 * FALLBACK: when nothing matches — no matrix configured for the org, the domain, the
 * stage, or the requested level; or a role rule that expands to zero active members —
 * this returns an EMPTY resolution rather than guessing. Guessing here would silently
 * notify the wrong people. The caller decides what "nobody configured" means for it:
 * fall back to the ticket escalation hierarchy, to the org admins, or to no-op.
 */
export async function resolveSpoc(input: ResolveSpocInput): Promise<SpocResolution> {
    const { organizationId, propertyId = null, domain, stage, level = null } = input;
    if (!organizationId || !stage || !isSpocDomain(domain)) return EMPTY;
    if (level != null && !Number.isInteger(level)) return EMPTY;

    let rules: SpocRule[];
    try {
        rules = await listSpocRules({ organizationId, propertyId, domain, stage });
    } catch (err: any) {
        console.error('[resolveSpoc] rule lookup failed:', err?.message || err);
        return EMPTY;
    }

    const ladder = selectRulesForLadder(rules, propertyId, level);
    if (ladder.length === 0) return EMPTY;

    const roles = [...new Set(ladder.map(r => r.spoc_role).filter(Boolean) as string[])];
    const named = [...new Set(ladder.map(r => r.spoc_user_id).filter(Boolean) as string[])];

    // Inside the try as well: the docblock promises this never throws, and these lookups
    // run on notify paths inside state transitions, where a rejection aborts the
    // transition instead of degrading to "no SPOC configured".
    let byRole: Map<string, string[]>;
    let alive: Set<string>;
    try {
        [byRole, alive] = await Promise.all([
            expandRoles(organizationId, propertyId, roles),
            activeMemberIds(organizationId, named),
        ]);
    } catch (err: any) {
        console.error('[resolveSpoc] actor expansion failed:', err?.message || err);
        return EMPTY;
    }

    const levels: ResolvedSpocLevel[] = ladder.map(rule => {
        // A named person is the SPOC — but only while they are still an active member.
        // Once they leave, the rung falls through to its role so it stays staffed rather
        // than paging a deactivated account forever.
        const personLives = !!rule.spoc_user_id && alive.has(rule.spoc_user_id);
        return {
            ruleId: rule.id,
            level: rule.level,
            stage: rule.stage,
            slaHours: rule.sla_hours ?? null,
            role: rule.spoc_role ?? null,
            scope: rule.property_id ? 'property' : 'organization',
            userIds: personLives
                ? [rule.spoc_user_id as string]
                : (rule.spoc_role ? byRole.get(rule.spoc_role) || [] : []),
        };
    });

    const userIds: string[] = [];
    for (const lvl of levels) {
        for (const id of lvl.userIds) if (!userIds.includes(id)) userIds.push(id);
    }
    return { userIds, levels };
}

/** Thin wrapper for callers that only want the notify list. */
export async function resolveSpocUserIds(input: ResolveSpocInput): Promise<string[]> {
    return (await resolveSpoc(input)).userIds;
}
