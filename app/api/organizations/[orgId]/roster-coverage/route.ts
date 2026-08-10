import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCommandCenterAccess, isCommandCenterAccessError,
    isMissingRelation, ROW_CEILING,
} from '@/backend/lib/commandCenter/access';

/**
 * GET /api/organizations/[orgId]/roster-coverage
 *
 * Org-level workforce coverage for the Command Center "Workforce Coverage" card.
 * Guarded by the Command Center access rule (session/bearer + org or property admin
 * membership), same as /api/command-center/portfolio.
 *
 * Sources — all honest, all already in the schema:
 *   scheduled   staff_rosters rows for today whose shift is a working shift
 *               (shift_configurations.is_working_day; a missing/NULL shift counts as
 *               working, because legacy roster rows predate shift configuration)
 *   present     distinct users with a shift_logs check-in today
 *   late        present, but checked in after their shift's start_time
 *   absent      scheduled and not present (floored at 0 — a check-in with no roster
 *               row never makes absence negative)
 *   tomorrow    working-shift slots already rostered for tomorrow; "short" is measured
 *               against today's scheduled headcount, the only honest baseline we have
 */

export const dynamic = 'force-dynamic';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
) {
    const { orgId } = await params;
    const access = await resolveCommandCenterAccess(request, orgId);
    if (isCommandCenterAccessError(access)) return access;

    const propertyIds = access.propertyIds;
    const propertyName = new Map(access.properties.map(p => [p.id, p.name]));

    const today = iso(new Date());
    const tomorrow = iso(new Date(Date.now() + 86_400_000));

    const [rosterRes, shiftRes, logsRes] = await Promise.all([
        supabaseAdmin
            .from('staff_rosters')
            .select('user_id, property_id, roster_date, shift_id')
            .in('property_id', propertyIds)
            .gte('roster_date', today)
            .lte('roster_date', tomorrow)
            .range(0, ROW_CEILING - 1),
        supabaseAdmin
            .from('shift_configurations')
            .select('id, property_id, start_time, is_working_day')
            .in('property_id', propertyIds)
            .range(0, ROW_CEILING - 1),
        supabaseAdmin
            .from('shift_logs')
            .select('user_id, property_id, check_in_at')
            .in('property_id', propertyIds)
            .gte('check_in_at', `${today}T00:00:00Z`)
            .lt('check_in_at', `${tomorrow}T00:00:00Z`)
            .range(0, ROW_CEILING - 1),
    ]);

    for (const [label, res] of [['rosters', rosterRes], ['shifts', shiftRes], ['logs', logsRes]] as const) {
        if (res.error && !isMissingRelation(res.error)) {
            console.error(`[org roster-coverage] ${label}`, res.error.message);
            return NextResponse.json({ error: 'Could not load roster data' }, { status: 500 });
        }
    }
    if (rosterRes.error || logsRes.error) {
        return NextResponse.json({ provisioned: false, reason: 'Roster or shift-log tables not migrated.' });
    }

    const shifts = new Map(
        ((shiftRes.data || []) as Array<{ id: string; start_time: string | null; is_working_day: boolean | null }>)
            .map(s => [s.id, s]),
    );

    interface RosterRow { user_id: string; property_id: string; roster_date: string; shift_id: string | null }
    const roster = (rosterRes.data || []) as RosterRow[];

    const isWorking = (r: RosterRow) => {
        if (!r.shift_id) return true; // legacy row with no configured shift
        const s = shifts.get(r.shift_id);
        return s ? s.is_working_day !== false : true;
    };

    const todayRows = roster.filter(r => r.roster_date === today && isWorking(r));
    const tomorrowRows = roster.filter(r => r.roster_date === tomorrow && isWorking(r));

    const scheduledByUserToday = new Map<string, RosterRow>();
    const scheduledByProp = new Map<string, number>();
    for (const r of todayRows) {
        scheduledByUserToday.set(r.user_id, r);
        scheduledByProp.set(r.property_id, (scheduledByProp.get(r.property_id) || 0) + 1);
    }

    interface LogRow { user_id: string; property_id: string; check_in_at: string }
    const present = new Map<string, LogRow>();
    for (const l of (logsRes.data || []) as LogRow[]) {
        if (!present.has(l.user_id)) present.set(l.user_id, l);
    }

    // Late = checked in after the shift start_time of that user's roster row today.
    // Compared on wall-clock HH:MM:SS; shift start_time is a local `time` column and
    // check_in_at is timestamptz, so this compares UTC clock time to local shift time.
    // It can be off by the org's UTC offset — flagged here rather than hidden.
    let late = 0;
    for (const [userId, log] of present) {
        const r = scheduledByUserToday.get(userId);
        const start = r?.shift_id ? shifts.get(r.shift_id)?.start_time : null;
        if (start && log.check_in_at.slice(11, 19) > start) late += 1;
    }

    const scheduled = todayRows.length;
    const presentCount = present.size;
    const absent = Math.max(0, scheduled - presentCount);
    const coveragePct = scheduled > 0 ? Math.round((presentCount / scheduled) * 1000) / 10 : null;
    const shortTomorrow = Math.max(0, scheduled - tomorrowRows.length);

    // Site with the worst absence, so the footer names a real place.
    const presentByProp = new Map<string, number>();
    for (const l of present.values()) {
        presentByProp.set(l.property_id, (presentByProp.get(l.property_id) || 0) + 1);
    }
    let worst: { name: string; absent: number } | null = null;
    for (const [pid, sched] of scheduledByProp) {
        const a = Math.max(0, sched - (presentByProp.get(pid) || 0));
        if (a > 0 && (!worst || a > worst.absent)) {
            worst = { name: propertyName.get(pid) || 'Unknown', absent: a };
        }
    }

    if (scheduled === 0 && tomorrowRows.length === 0) {
        return NextResponse.json({ provisioned: false, reason: 'Nobody is rostered today or tomorrow.' });
    }

    return NextResponse.json({
        provisioned: true,
        as_of: today,
        scheduled,
        present: presentCount,
        late,
        absent,
        coverage_pct: coveragePct,
        scheduled_tomorrow: tomorrowRows.length,
        short_tomorrow: shortTomorrow,
        worst_property: worst,
    });
}
