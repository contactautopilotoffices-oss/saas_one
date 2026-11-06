import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCommandCenterAccess, isCommandCenterAccessError, readOrgId, isMissingRelation, ROW_CEILING,
} from '@/backend/lib/commandCenter/access';
import { getISTDateBounds } from '@/backend/utils/timezone';

/**
 * GET /api/command-center/kpis
 *
 * Figures for the Command Center "At a glance" KPI tiles that no existing feed provides (docs/COMMAND_CENTER_KPI_PLAN.md).
 * Tiles whose figures already exist (Agents, Visitors, Attendance) read those feeds instead, so they match the cards
 * that already show them. Read-only.
 *
 * Every section stands alone: a missing table returns `{ provisioned: false }` and an error returns `{ error }` for that
 * section only, so one broken area never blanks the other tiles. Counts use exact count queries, never row lists, so
 * the 1000-row PostgREST limit cannot cap a number.
 */

export const dynamic = 'force-dynamic';

/**
 * Tickets whose work was completed. Timed by `resolved_at` = when the work was finished (the tenant's later approval
 * keeps that time), the same field tickets-summary's resolved trend uses. Cancelled / duplicate / rejected are left out:
 * no work was completed, and they carry no resolved_at. Hence the tile says "Completed today" and "Avg time to
 * complete", not "closed". Checked 2026-10-16: every resolved/closed ticket of the last 30 days has resolved_at set.
 */
const COMPLETED_STATUSES = ['resolved', 'closed', 'satisfied', 'completed'];
/** Average time to complete is measured over the last 7 IST days (owner decision 5, 2026-10-16). */
const CLOSING_TIME_WINDOW = 'week' as const;
const PAGE = 1000;

type Section<T> = ({ provisioned: true } & T) | { provisioned: false } | { error: string };

/** Runs one section; anything it throws becomes that section's error, so the other tiles still load. */
async function guarded<T>(name: string, run: () => Promise<Section<T>>): Promise<Section<T>> {
    try {
        return await run();
    } catch (e) {
        console.error(`[cc/kpis] ${name}`, e instanceof Error ? e.message : e);
        return { error: `Could not load ${name}` };
    }
}

/** A completed ticket that took longer than this is counted as "slow" on the tile. */
const SLOW_HOURS = 7 * 24;

function median(values: number[]): number | null {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Tickets among `ids` that were force-closed (ticket_activity_log action 'force_closed'). Chunked to keep URLs short. */
async function forceClosedIds(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabaseAdmin
            .from('ticket_activity_log')
            .select('ticket_id')
            .eq('action', 'force_closed')
            .in('ticket_id', ids.slice(i, i + 200))
            .range(0, 999);
        // No activity log on this deployment: nothing is known to be force-closed, so nothing is excluded.
        if (error) {
            if (!isMissingRelation(error)) console.error('[cc/kpis] force_closed lookup', error.message);
            return out;
        }
        for (const r of (data || []) as Array<{ ticket_id: string }>) out.add(r.ticket_id);
    }
    return out;
}

async function requestsSection(orgId: string, propertyIds: string[]): Promise<Section<{
    raised_today: number; closed_today: number;
    /** Typical (median) hours from raised to work completed, last 7 IST days, force-closed tickets left out. */
    median_complete_hours: number | null;
    /** Completed tickets in the window that took more than 7 days, and how many of those were force-closed. */
    slow_count: number; slow_force_closed: number;
    force_closed_excluded: number;
    avg_closing_hours: number | null; closed_in_window: number; window_days: number; truncated: boolean;
}>> {
    const todayStart = getISTDateBounds('today').start;
    const windowStart = getISTDateBounds(CLOSING_TIME_WINDOW).start;
    const base = () => supabaseAdmin
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .in('property_id', propertyIds);

    const [raisedRes, closedRes] = await Promise.all([
        base().gte('created_at', todayStart),
        base().in('status', COMPLETED_STATUSES).gte('resolved_at', todayStart),
    ]);
    const firstError = raisedRes.error || closedRes.error;
    if (firstError) {
        if (isMissingRelation(firstError)) return { provisioned: false };
        console.error('[cc/kpis] requests', firstError.message);
        return { error: 'Could not load requests' };
    }

    // Average time to complete: raised → work completed, for tickets completed in the window. Keyset paging on id.
    let totalHours = 0;
    let n = 0;
    let fetched = 0;
    const durations: Array<{ id: string; hours: number }> = [];
    let truncated = false;
    let lastId: string | null = null;
    for (;;) {
        let q = supabaseAdmin
            .from('tickets')
            .select('id, created_at, resolved_at')
            .eq('organization_id', orgId)
            .in('property_id', propertyIds)
            .in('status', COMPLETED_STATUSES)
            .gte('resolved_at', windowStart)
            .order('id')
            .limit(PAGE);
        if (lastId) q = q.gt('id', lastId);
        const { data, error } = await q;
        if (error) {
            if (isMissingRelation(error)) return { provisioned: false };
            console.error('[cc/kpis] requests closing time', error.message);
            return { error: 'Could not load requests' };
        }
        const rows = (data || []) as Array<{ id: string; created_at: string | null; resolved_at: string | null }>;
        fetched += rows.length;
        for (const r of rows) {
            if (!r.created_at || !r.resolved_at) continue;
            const hours = (new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000;
            if (Number.isFinite(hours) && hours >= 0) { totalHours += hours; n += 1; durations.push({ id: r.id, hours }); }
        }
        if (rows.length < PAGE) break;
        if (fetched >= ROW_CEILING) { truncated = true; break; }
        lastId = rows[rows.length - 1].id;
    }

    // An average is dragged up by a few old tickets closed in a clean-up (2026-10-16: 8 of 36 took 7–36 days, 5 of them
    // force-closed, average 4.7 days vs typical 23 h). So the tile shows the median of tickets actually worked to
    // completion, and counts the slow ones separately.
    const forced = await forceClosedIds(durations.map(d => d.id));
    const worked = durations.filter(d => !forced.has(d.id)).map(d => d.hours);
    const slow = durations.filter(d => d.hours > SLOW_HOURS);
    const med = median(worked);

    return {
        provisioned: true,
        raised_today: raisedRes.count ?? 0,
        closed_today: closedRes.count ?? 0,
        median_complete_hours: med === null ? null : Math.round(med * 10) / 10,
        slow_count: slow.length,
        slow_force_closed: slow.filter(d => forced.has(d.id)).length,
        force_closed_excluded: durations.length - worked.length,
        avg_closing_hours: n > 0 ? Math.round((totalHours / n) * 10) / 10 : null,
        closed_in_window: n,
        window_days: 7,
        truncated,
    };
}

export async function GET(request: NextRequest) {
    const access = await resolveCommandCenterAccess(request, readOrgId(request));
    if (isCommandCenterAccessError(access)) return access;

    const [requests] = await Promise.all([
        guarded('requests', () => requestsSection(access.organizationId, access.propertyIds)),
    ]);

    return NextResponse.json({
        provisioned: true,
        as_of: new Date().toISOString(),
        requests,
    });
}
