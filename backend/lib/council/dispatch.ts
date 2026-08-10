/**
 * Council dispatch — findings become owned work.
 *
 * The council's weak point was that it stopped at a list. This routes every finding to a
 * named person and gives it a clock, which is the difference between a report and an
 * outcome.
 *
 * Routing order, most specific first:
 *   1. workflow_spoc_rules via resolveSpoc() — the configurable matrix the org edits in
 *      the SPOC UI. This is the intended long-term source of truth and, notably, its
 *      resolver has existed with zero callers; this is its first production consumer.
 *   2. Role fallback — the first active member holding one of the lens's fallback roles.
 *      Used because workflow_spoc_rules is currently EMPTY for the org, so a
 *      rules-only implementation would assign nothing to nobody on day one.
 *   3. Unassigned, recorded as such with a reason. An unrouted P0 is information a human
 *      needs, so it is a stored state rather than a dropped row (FP-04).
 *
 * Dispatch is idempotent: council_assignments.finding_id is UNIQUE and existing findings
 * are skipped, so re-running after a partial failure cannot double-assign.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveSpoc, type SpocDomain } from '@/backend/lib/workflow/resolveSpoc';

export interface AgentRouting {
    /** SPOC domain consulted in workflow_spoc_rules. */
    domain: SpocDomain;
    /** Stage key within that domain. */
    stage: string;
    /**
     * Roles to fall back to, in preference order, when no SPOC rule matches.
     * Chosen against the roles that actually exist in this org's memberships —
     * inventing a role here would route work to nobody.
     */
    fallbackRoles: string[];
}

/**
 * organization_memberships.role is the `app_role` ENUM, not free text. Postgres rejects
 * the WHOLE `.in()` query with 22P02 if any single value is not a member — so one typo
 * silently routed every procurement finding to nobody until this list was pinned to the
 * real enum. Anything not in here is filtered out before the query rather than trusted.
 *
 *   select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid
 *    where t.typname='app_role';
 */
const APP_ROLES = new Set([
    'master_admin', 'org_super_admin', 'property_admin', 'staff', 'tenant', 'food_vendor',
    'mst', 'security', 'vendor', 'soft_service_staff', 'soft_service_supervisor',
    'soft_service_manager', 'super_tenant', 'maintenance_vendor', 'procurement',
    'bd_rep', 'bd_admin', 'org_admin', 'accounts',
]);

/**
 * Which lens's findings go to which desk. The mapping is deliberately explicit rather
 * than derived: "who owns an energy finding" is an organisational decision, not
 * something to infer from a string.
 */
export const AGENT_ROUTING: Record<string, AgentRouting> = {
    ops:         { domain: 'ticket',      stage: 'triage',      fallbackRoles: ['property_admin', 'org_super_admin'] },
    tenant:      { domain: 'ticket',      stage: 'triage',      fallbackRoles: ['property_admin', 'org_super_admin'] },
    energy:      { domain: 'ticket',      stage: 'maintenance', fallbackRoles: ['property_admin', 'org_super_admin'] },
    procurement: { domain: 'procurement', stage: 'align',       fallbackRoles: ['procurement', 'accounts', 'org_admin', 'org_super_admin'] },
    compliance:  { domain: 'ticket',      stage: 'audit',       fallbackRoles: ['org_super_admin', 'org_admin', 'property_admin'] },
    qa:          { domain: 'ticket',      stage: 'audit',       fallbackRoles: ['org_super_admin', 'org_admin'] },
    cto:         { domain: 'ticket',      stage: 'audit',       fallbackRoles: ['org_super_admin', 'org_admin'] },
    product:     { domain: 'ticket',      stage: 'audit',       fallbackRoles: ['org_super_admin', 'org_admin'] },
};

/** Severity sets the clock; the lens sets the desk. */
export const SLA_HOURS: Record<string, number> = { P0: 24, P1: 72, P2: 336 };

const DEFAULT_ROUTING: AgentRouting = {
    domain: 'ticket', stage: 'triage', fallbackRoles: ['org_super_admin'],
};

export interface DispatchResult {
    considered: number;
    assigned: number;
    unassigned: number;
    skipped: number;          // already dispatched
    bySource: Record<string, number>;
    errors: string[];
}

interface FindingRow {
    id: string;
    agent_key: string;
    severity: string;
    title: string;
    status: string;
}

/**
 * First active member holding any of `roles`, preference-ordered. One query for all
 * roles, then ranked in memory — role membership is small and this avoids N round trips.
 */
async function firstMemberWithRole(
    orgId: string,
    roles: string[],
): Promise<{ userId: string; role: string } | null> {
    // Drop anything that is not an app_role member: Postgres fails the entire query on a
    // single bad enum value, so an unknown role here would cost us the valid ones too.
    const valid = roles.filter(r => APP_ROLES.has(r));
    if (valid.length !== roles.length) {
        console.warn('[council dispatch] ignoring unknown role(s):',
            roles.filter(r => !APP_ROLES.has(r)).join(', '));
    }
    if (!valid.length) return null;

    const { data, error } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id, role')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .in('role', valid);
    if (error) throw new Error(`membership lookup: ${error.message}`);

    const rows = (data || []) as { user_id: string; role: string }[];
    for (const role of valid) {
        const hit = rows.find(r => r.role === role);
        if (hit) return { userId: hit.user_id, role };
    }
    return null;
}

interface Routed {
    assigneeUserId: string | null;
    assignedRole: string | null;
    routedBy: 'spoc_rule' | 'role_fallback' | 'unassigned';
    routingNote: string | null;
    domain: SpocDomain;
}

/** Resolve one finding to a desk. Never throws — a routing failure becomes 'unassigned'. */
export async function routeFinding(orgId: string, agentKey: string): Promise<Routed> {
    const routing = AGENT_ROUTING[agentKey] || DEFAULT_ROUTING;

    // 1. The configurable matrix.
    try {
        const spoc = await resolveSpoc({
            organizationId: orgId,
            domain: routing.domain,
            stage: routing.stage,
        });
        if (spoc.userIds.length) {
            const level = spoc.levels[0];
            return {
                assigneeUserId: spoc.userIds[0],
                assignedRole: level?.role ?? null,
                routedBy: 'spoc_rule',
                routingNote: `workflow_spoc_rules ${routing.domain}/${routing.stage} level ${level?.level ?? 1}`,
                domain: routing.domain,
            };
        }
    } catch (error) {
        // resolveSpoc documents that it never throws, but a caller that trusts a docblock
        // over a try/catch is one refactor away from losing the whole dispatch run.
        console.warn('[council dispatch] spoc lookup failed, falling back to role:',
            error instanceof Error ? error.message : error);
    }

    // 2. Role fallback.
    try {
        const member = await firstMemberWithRole(orgId, routing.fallbackRoles);
        if (member) {
            return {
                assigneeUserId: member.userId,
                assignedRole: member.role,
                routedBy: 'role_fallback',
                routingNote: `no SPOC rule for ${routing.domain}/${routing.stage}; routed to first active ${member.role}`,
                domain: routing.domain,
            };
        }
    } catch (error) {
        return {
            assigneeUserId: null, assignedRole: null, routedBy: 'unassigned',
            routingNote: `routing failed: ${error instanceof Error ? error.message : String(error)}`,
            domain: routing.domain,
        };
    }

    // 3. Nobody to route to — a fact, not a silent drop.
    return {
        assigneeUserId: null, assignedRole: null, routedBy: 'unassigned',
        routingNote: `no SPOC rule and no active member with roles: ${routing.fallbackRoles.join(', ')}`,
        domain: routing.domain,
    };
}

/**
 * Route every not-yet-dispatched finding in a session. Safe to re-run.
 *
 * Only 'open' findings are dispatched — one already dismissed by a human should not be
 * resurrected onto somebody's queue by a retry.
 */
export async function dispatchSessionFindings(orgId: string, sessionId: string): Promise<DispatchResult> {
    const result: DispatchResult = {
        considered: 0, assigned: 0, unassigned: 0, skipped: 0, bySource: {}, errors: [],
    };

    const { data: findingsData, error: findingsError } = await supabaseAdmin
        .from('council_findings')
        .select('id, agent_key, severity, title, status')
        .eq('org_id', orgId)
        .eq('session_id', sessionId)
        .eq('status', 'open');
    if (findingsError) throw new Error(`findings read: ${findingsError.message}`);

    const findings = (findingsData || []) as FindingRow[];
    result.considered = findings.length;
    if (!findings.length) return result;

    // Idempotency: one round trip for everything already dispatched.
    const { data: existingData, error: existingError } = await supabaseAdmin
        .from('council_assignments')
        .select('finding_id')
        .in('finding_id', findings.map(f => f.id));
    if (existingError) throw new Error(`existing assignments read: ${existingError.message}`);
    const already = new Set((existingData || []).map(r => (r as { finding_id: string }).finding_id));

    const rows: Record<string, unknown>[] = [];
    for (const finding of findings) {
        if (already.has(finding.id)) { result.skipped++; continue; }

        const routed = await routeFinding(orgId, finding.agent_key);
        const slaHours = SLA_HOURS[finding.severity] ?? SLA_HOURS.P2;

        rows.push({
            org_id: orgId,
            session_id: sessionId,
            finding_id: finding.id,
            agent_key: finding.agent_key,
            severity: finding.severity,
            domain: routed.domain,
            assignee_user_id: routed.assigneeUserId,
            assigned_role: routed.assignedRole,
            routed_by: routed.routedBy,
            routing_note: routed.routingNote,
            sla_hours: slaHours,
            due_at: new Date(Date.now() + slaHours * 3600_000).toISOString(),
            status: 'open',
            // In-app notification is deliberately not written here: public.notifications
            // requires a NOT NULL property_id and council findings are org-scoped, so
            // emitting one would mean inventing a property. The assignment row IS the
            // queue; the reason is recorded so this reads as a decision, not an omission.
            notify_skipped: 'notifications.property_id is NOT NULL; council findings are org-scoped',
        });

        result.bySource[routed.routedBy] = (result.bySource[routed.routedBy] || 0) + 1;
        if (routed.assigneeUserId) result.assigned++; else result.unassigned++;
    }

    if (rows.length) {
        // ignoreDuplicates guards the race where two convenings dispatch the same finding.
        const { error: insertError } = await supabaseAdmin
            .from('council_assignments')
            .upsert(rows, { onConflict: 'finding_id', ignoreDuplicates: true });
        if (insertError) {
            result.errors.push(`assignment insert: ${insertError.message}`);
            throw new Error(`assignment insert: ${insertError.message}`);
        }
    }

    return result;
}

/**
 * The distribution view: who is carrying what, right now. Powers the "distribute works"
 * question — not just that findings are owned, but whether one desk is drowning.
 */
export interface WorkloadRow {
    assignee_user_id: string | null;
    assignee_name: string;
    open: number;
    overdue: number;
    p0: number;
}

export async function currentWorkload(orgId: string): Promise<WorkloadRow[]> {
    const { data, error } = await supabaseAdmin
        .from('council_assignments')
        .select('assignee_user_id, severity, due_at, status')
        .eq('org_id', orgId)
        .in('status', ['open', 'acked']);
    if (error) throw new Error(`workload read: ${error.message}`);

    const rows = (data || []) as {
        assignee_user_id: string | null; severity: string; due_at: string | null; status: string;
    }[];

    const byUser = new Map<string, WorkloadRow>();
    const nowIso = new Date().toISOString();
    for (const r of rows) {
        const key = r.assignee_user_id || 'unassigned';
        const entry = byUser.get(key) || {
            assignee_user_id: r.assignee_user_id,
            assignee_name: r.assignee_user_id ? key : 'Unassigned',
            open: 0, overdue: 0, p0: 0,
        };
        entry.open++;
        if (r.due_at && r.due_at < nowIso) entry.overdue++;
        if (r.severity === 'P0') entry.p0++;
        byUser.set(key, entry);
    }

    // Resolve names in one round trip rather than per row.
    const ids = [...byUser.keys()].filter(k => k !== 'unassigned');
    if (ids.length) {
        const { data: users } = await supabaseAdmin
            .from('users').select('id, full_name, email').in('id', ids);
        for (const u of (users || []) as { id: string; full_name: string | null; email: string | null }[]) {
            const entry = byUser.get(u.id);
            if (entry) entry.assignee_name = u.full_name || u.email || u.id;
        }
    }

    return [...byUser.values()].sort((a, b) => b.p0 - a.p0 || b.overdue - a.overdue || b.open - a.open);
}
