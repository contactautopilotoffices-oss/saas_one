import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCommandCenterAccess, isCommandCenterAccessError, readOrgId, isMissingRelation, unprovisioned, ROW_CEILING,
} from '@/backend/lib/commandCenter/access';

/**
 * GET /api/command-center/ticket-alerts
 *
 * Per-building ticket counts for the Command Center Alerts card (frontend/components/dashboard/command-center/
 * alertRules.ts turns them into alerts; the thresholds live there, not here). Read-only.
 *
 * tickets-summary has no per-building SLA, deadline or waiting-for-tenant figures, so this route supplies them.
 * "Past SLA" counts only tickets the team is still working on: a finished ticket waiting for the tenant to confirm
 * is reported separately as `waiting_tenant`, not as an SLA breach (docs/COMMAND_CENTER_DATA_AUDIT.md, decision 1).
 */

export const dynamic = 'force-dynamic';

/** Ticket statuses the team is still working on (tickets-summary's open + waitlist + in-progress buckets). */
const WORKING = ['open', 'blocked', 'waitlist', 'assigned', 'in_progress', 'paused', 'work_started'];
const HIGH_PRIORITY = ['urgent', 'high', 'critical'];
/** A finished ticket counts as "waiting for the tenant" once it has waited longer than this. */
const WAITING_TENANT_DAYS = 7;
/** PostgREST returns at most 1000 rows per request, so reads are paged. */
const PAGE = 1000;

interface TicketRow {
    id: string;
    property_id: string | null;
    status: string;
    priority: string | null;
    sla_deadline: string | null;
    sla_breached: boolean | null;
    resolved_at: string | null;
    created_at: string | null;
}

export interface TicketAlertBuilding {
    property_id: string;
    name: string;
    /** Tickets the team is still working on. */
    open: number;
    past_sla: number;
    no_deadline: number;
    high_priority: number;
    /** Finished tickets not confirmed by the tenant for more than WAITING_TENANT_DAYS. */
    waiting_tenant: number;
    waiting_oldest_days: number;
    /** Earliest deadline among tickets past SLA (null when none of them has a deadline, e.g. only the flag is set). */
    oldest_past_sla_at: string | null;
    /** When the oldest open high-priority ticket / open ticket without a deadline was raised. */
    oldest_high_priority_at: string | null;
    oldest_no_deadline_at: string | null;
}

/** Earlier of two ISO timestamps (null-safe). */
const earliest = (a: string | null, b: string | null) =>
    !a ? b : !b ? a : new Date(a).getTime() <= new Date(b).getTime() ? a : b;

export async function GET(request: NextRequest) {
    const access = await resolveCommandCenterAccess(request, readOrgId(request));
    if (isCommandCenterAccessError(access)) return access;

    // Keyset paging on id (not offsets), so a ticket changing status mid-read cannot shift a later one out of view.
    const rows: TicketRow[] = [];
    let lastId: string | null = null;
    let truncated = false;
    for (;;) {
        let q = supabaseAdmin
            .from('tickets')
            .select('id, property_id, status, priority, sla_deadline, sla_breached, resolved_at, created_at')
            .eq('organization_id', access.organizationId)
            .in('property_id', access.propertyIds)
            .in('status', [...WORKING, 'pending_validation'])
            .order('id')
            .limit(PAGE);
        if (lastId) q = q.gt('id', lastId);
        const { data, error } = await q;
        if (error) {
            if (isMissingRelation(error)) return unprovisioned('No tickets table.');
            console.error('[cc/ticket-alerts]', error.message);
            return NextResponse.json({ error: 'Could not load tickets' }, { status: 500 });
        }
        const page = (data || []) as TicketRow[];
        rows.push(...page);
        if (page.length < PAGE) break;
        if (rows.length >= ROW_CEILING) { truncated = true; break; }
        lastId = page[page.length - 1].id;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const waitingCutoff = nowMs - WAITING_TENANT_DAYS * 86_400_000;

    const byProp = new Map<string, TicketAlertBuilding>(access.properties.map(p => [p.id, {
        property_id: p.id, name: p.name, open: 0, past_sla: 0, no_deadline: 0, high_priority: 0,
        waiting_tenant: 0, waiting_oldest_days: 0,
        oldest_past_sla_at: null, oldest_high_priority_at: null, oldest_no_deadline_at: null,
    }]));

    for (const t of rows) {
        const b = t.property_id ? byProp.get(t.property_id) : undefined;
        if (!b) continue;
        if (t.status === 'pending_validation') {
            const finishedMs = t.resolved_at ? new Date(t.resolved_at).getTime() : NaN;
            if (Number.isFinite(finishedMs) && finishedMs < waitingCutoff) {
                b.waiting_tenant += 1;
                b.waiting_oldest_days = Math.max(b.waiting_oldest_days, Math.floor((nowMs - finishedMs) / 86_400_000));
            }
            continue;
        }
        b.open += 1;
        if (!t.sla_deadline) {
            b.no_deadline += 1;
            b.oldest_no_deadline_at = earliest(b.oldest_no_deadline_at, t.created_at);
        }
        if (t.sla_breached === true || (t.sla_deadline !== null && new Date(t.sla_deadline).getTime() < nowMs)) {
            b.past_sla += 1;
            b.oldest_past_sla_at = earliest(b.oldest_past_sla_at, t.sla_deadline);
        }
        if (t.priority && HIGH_PRIORITY.includes(t.priority)) {
            b.high_priority += 1;
            b.oldest_high_priority_at = earliest(b.oldest_high_priority_at, t.created_at);
        }
    }

    return NextResponse.json({
        provisioned: true,
        as_of: nowIso,
        waiting_tenant_days: WAITING_TENANT_DAYS,
        truncated,
        /** Every building the caller may see, so the card can name one picked in the header's property selector. */
        properties: access.properties.map(p => ({ id: p.id, name: p.name })),
        buildings: [...byProp.values()].filter(b => b.open > 0 || b.waiting_tenant > 0),
    });
}
