import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

/**
 * GET /api/admin/usage-dashboard?propertyId=<uuid?>&period=<today|7d|30d|all>
 *
 * Master-admin only. Aggregates cross-module usage for the platform (or a single
 * property when propertyId is provided) into one payload for the Usage Dashboard.
 *
 * Design guarantees:
 *  - Every domain block is wrapped in its own try/catch and degrades to zeros on
 *    failure, so a missing/renamed table can never 500 the whole response.
 *  - Counts use SQL-side `count: 'exact', head: true` where possible; per-property
 *    breakdowns fetch one windowed slice per domain and aggregate in JS (no N×M
 *    query explosion).
 *  - "Module usage %" is an ACTIVITY proxy (a module is "active" if its primary
 *    table has >=1 row in the window) because feature_usage_logs is not emitted to.
 */

export const dynamic = 'force-dynamic';

type Period = 'today' | '7d' | '30d' | 'all';

const ONLINE_WINDOW_MIN = 15;

function windowStart(period: Period): Date | null {
    const now = new Date();
    if (period === 'today') {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    if (period === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (period === '30d') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return null; // 'all'
}

// Each module's primary table + date column. propCol = column to scope by property
// (null = platform/org-scoped table that we count globally).
const MODULE_PROBES: { key: string; label: string; table: string; dateCol: string; propCol: string | null }[] = [
    { key: 'tickets', label: 'Tickets', table: 'tickets', dateCol: 'created_at', propCol: 'property_id' },
    { key: 'checklists', label: 'Checklists', table: 'sop_completions', dateCol: 'due_at', propCol: 'property_id' },
    { key: 'electricity', label: 'Electricity', table: 'electricity_readings', dateCol: 'reading_date', propCol: 'property_id' },
    { key: 'diesel', label: 'Diesel / DG', table: 'diesel_readings', dateCol: 'reading_date', propCol: 'property_id' },
    { key: 'water', label: 'Water', table: 'water_readings', dateCol: 'reading_date', propCol: null },
    { key: 'procurement', label: 'Procurement', table: 'material_requests', dateCol: 'created_at', propCol: 'property_id' },
    { key: 'stock', label: 'Stock', table: 'stock_movements', dateCol: 'created_at', propCol: 'property_id' },
    { key: 'visitors', label: 'Visitors', table: 'visitor_logs', dateCol: 'created_at', propCol: 'property_id' },
    { key: 'rooms', label: 'Meeting Rooms', table: 'meeting_room_bookings', dateCol: 'created_at', propCol: 'property_id' },
    { key: 'crm', label: 'CRM / Leads', table: 'crm_leads', dateCol: 'created_at', propCol: null },
    { key: 'roster', label: 'Roster', table: 'staff_rosters', dateCol: 'roster_date', propCol: 'property_id' },
];

export async function GET(request: NextRequest) {
    const supabase = await createClient();

    const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !currentUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Master-admin gate (same pattern as every /api/admin/* route)
    const { data: masterCheck } = await supabase
        .from('users')
        .select('is_master_admin')
        .eq('id', currentUser.id)
        .single();

    if (masterCheck?.is_master_admin !== true) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get('propertyId') || null;
    const period = (searchParams.get('period') as Period) || '30d';
    const start = windowStart(period);
    const startIso = start ? start.toISOString() : '1970-01-01';
    // For DATE columns we compare against a YYYY-MM-DD string.
    const startDate = start ? start.toISOString().split('T')[0] : '1970-01-01';
    const nowIso = new Date().toISOString();

    const admin = createAdminClient();

    // Cursor-paginate past the PostgREST `db-max-rows` cap (1000 on this instance).
    // A plain `.limit(100000)` is still clamped to the server cap, silently truncating
    // counts (e.g. a property with 1079 tickets would report 1000). Page with `.range()`
    // until a short page is returned. `makeQuery` must apply a stable `.order()`.
    async function fetchAllRows(makeQuery: () => any, pageSize = 1000, maxPages = 1000): Promise<any[]> {
        const all: any[] = [];
        for (let page = 0; page < maxPages; page++) {
            const from = page * pageSize;
            const { data, error } = await makeQuery().range(from, from + pageSize - 1);
            if (error || !data || data.length === 0) break;
            all.push(...data);
            if (data.length < pageSize) break;
        }
        return all;
    }

    // Close stale sessions first so uptime numbers are accurate (non-blocking).
    try { await admin.rpc('close_stale_sessions'); } catch { /* non-blocking */ }

    // ── Properties (dropdown source + scope) ────────────────────────────────
    let properties: { id: string; name: string; code: string | null; organization_id: string | null }[] = [];
    try {
        let q = admin
            .from('properties')
            .select('id, name, code, organization_id')
            .order('name', { ascending: true });
        // deleted_at exists in production; filter defensively.
        const { data, error } = await q.is('deleted_at', null);
        if (error) {
            const fb = await admin.from('properties').select('id, name, code, organization_id').order('name', { ascending: true });
            properties = fb.data || [];
        } else {
            properties = data || [];
        }
    } catch { properties = []; }

    if (propertyId) properties = properties.filter((p) => p.id === propertyId);
    const propMap = new Map(properties.map((p) => [p.id, p]));
    const scopeLabel = propertyId
        ? (propMap.get(propertyId)?.name || 'Property')
        : 'All Properties';

    // ── Memberships → users-per-property + member set for scoping ───────────
    const usersByProperty = new Map<string, Set<string>>();
    const scopedUserIds = new Set<string>();
    try {
        const memberships = await fetchAllRows(() => {
            let mq = admin
                .from('property_memberships')
                .select('property_id, user_id')
                .eq('is_active', true)
                .order('user_id', { ascending: true });
            if (propertyId) mq = mq.eq('property_id', propertyId);
            return mq;
        });
        (memberships || []).forEach((m: any) => {
            if (!usersByProperty.has(m.property_id)) usersByProperty.set(m.property_id, new Set());
            usersByProperty.get(m.property_id)!.add(m.user_id);
            if (propertyId) scopedUserIds.add(m.user_id);
        });
    } catch { /* degrade */ }

    // ── Users + sessions (uptime / engagement) ──────────────────────────────
    let userMetrics: any[] = [];
    const globalSessions = {
        active_users_7d: 0,
        avg_session_duration_minutes: 0,
        total_sessions_logged: 0,
        total_user_base: 0,
        online_now: 0,
    };
    const sessionsTrend: { date: string; sessions: number }[] = [];
    // Session-derived "online now" user ids — single source of truth used by BOTH the
    // global KPI and the per-property breakdown (avoids divergence when a session's
    // user_id has no matching `users` row).
    const onlineUserIds = new Set<string>();
    try {
        // Users in scope (paginated — platform user base can exceed the 1000 cap)
        const scopedIds = Array.from(scopedUserIds);
        const users = (propertyId && scopedUserIds.size === 0) ? [] : await fetchAllRows(() => {
            let uq = admin.from('users').select('id, full_name, email').order('id', { ascending: true });
            if (propertyId) uq = uq.in('id', scopedIds);
            return uq;
        });

        // Sessions (paginated; optionally scoped to those users)
        const sessions = (propertyId && scopedUserIds.size === 0) ? [] : await fetchAllRows(() => {
            let sq = admin
                .from('user_sessions')
                .select('user_id, session_start, last_activity, session_end, duration_seconds')
                .order('session_start', { ascending: true });
            if (propertyId) sq = sq.in('user_id', scopedIds);
            return sq;
        });

        const now = Date.now();
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const onlineCutoff = now - ONLINE_WINDOW_MIN * 60 * 1000;

        const byUser = new Map<string, any[]>();
        sessions.forEach((s: any) => {
            if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
            byUser.get(s.user_id)!.push(s);
        });

        // 14-day sessions trend
        const trendDays: string[] = [];
        for (let i = 13; i >= 0; i--) {
            trendDays.push(new Date(now - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
        }
        const trendCounts = new Map<string, number>(trendDays.map((d) => [d, 0]));

        let totalDuration = 0, completedCount = 0, totalSessions = 0;
        const active7d = new Set<string>();
        const onlineUsers = new Set<string>();

        sessions.forEach((s: any) => {
            totalSessions += 1;
            if (s.duration_seconds != null) { totalDuration += s.duration_seconds; completedCount += 1; }
            const startMs = s.session_start ? new Date(s.session_start).getTime() : 0;
            if (startMs >= weekAgo) active7d.add(s.user_id);
            const day = s.session_start ? new Date(s.session_start).toISOString().split('T')[0] : null;
            if (day && trendCounts.has(day)) trendCounts.set(day, (trendCounts.get(day) || 0) + 1);
            const lastAct = s.last_activity ? new Date(s.last_activity).getTime() : 0;
            if (!s.session_end && lastAct >= onlineCutoff) onlineUsers.add(s.user_id);
        });

        userMetrics = users.map((u: any) => {
            const us = byUser.get(u.id) || [];
            const thisWeek = us.filter((s: any) => s.session_start && new Date(s.session_start).getTime() >= weekAgo).length;
            const completed = us.filter((s: any) => s.duration_seconds != null);
            const avg = completed.length > 0
                ? Math.round(completed.reduce((a: number, s: any) => a + s.duration_seconds, 0) / completed.length / 60)
                : 0;
            const lastActive = us.length > 0
                ? us.reduce((l: any, c: any) => (new Date(c.last_activity) > new Date(l.last_activity) ? c : l)).last_activity
                : null;
            const isOnline = onlineUsers.has(u.id);
            return {
                user_id: u.id,
                full_name: u.full_name,
                email: u.email,
                sessions_this_week: thisWeek,
                avg_duration_minutes: avg,
                total_sessions: us.length,
                last_active: lastActive,
                online: isOnline,
            };
        }).sort((a: any, b: any) => b.sessions_this_week - a.sessions_this_week);

        globalSessions.active_users_7d = active7d.size;
        globalSessions.avg_session_duration_minutes = completedCount > 0 ? Math.round(totalDuration / completedCount / 60) : 0;
        globalSessions.total_sessions_logged = totalSessions;
        globalSessions.total_user_base = users.length;
        onlineUsers.forEach((id) => onlineUserIds.add(id));
        globalSessions.online_now = onlineUserIds.size;

        trendDays.forEach((d) => sessionsTrend.push({ date: d, sessions: trendCounts.get(d) || 0 }));
    } catch { /* degrade */ }

    // ── Tickets (counts + per-property) ─────────────────────────────────────
    const resolvedStatuses = ['closed', 'satisfied', 'resolved', 'completed', 'cancelled', 'duplicate', 'rejected'];
    const openStatuses = ['open', 'blocked', 'waitlist'];
    const inProgressStatuses = ['assigned', 'in_progress', 'paused', 'work_started'];
    const tickets = { total: 0, open: 0, in_progress: 0, resolved: 0, pending_validation: 0 };
    const ticketsByProperty = new Map<string, { total: number; open: number; resolved: number }>();
    let slaBreached = 0;
    try {
        const trows = await fetchAllRows(() => {
            let tq = admin
                .from('tickets')
                .select('id, property_id, status, sla_breached, sla_deadline')
                .gte('created_at', startIso)
                .order('id', { ascending: true });
            if (propertyId) tq = tq.eq('property_id', propertyId);
            return tq;
        });
        (trows || []).forEach((t: any) => {
            tickets.total += 1;
            const st = t.status;
            if (openStatuses.includes(st)) tickets.open += 1;
            else if (inProgressStatuses.includes(st)) tickets.in_progress += 1;
            else if (st === 'pending_validation') tickets.pending_validation += 1;
            else if (resolvedStatuses.includes(st)) tickets.resolved += 1;

            const breached = (t.sla_breached === true ||
                (t.sla_deadline && new Date(t.sla_deadline).toISOString() < nowIso))
                && !['resolved', 'closed'].includes(st);
            if (breached) slaBreached += 1;

            if (t.property_id) {
                if (!ticketsByProperty.has(t.property_id)) ticketsByProperty.set(t.property_id, { total: 0, open: 0, resolved: 0 });
                const pb = ticketsByProperty.get(t.property_id)!;
                pb.total += 1;
                if (openStatuses.includes(st) || inProgressStatuses.includes(st)) pb.open += 1;
                if (resolvedStatuses.includes(st)) pb.resolved += 1;
            }
        });
    } catch { /* degrade */ }

    // ── SOP / Checklists (filled vs not filled) ─────────────────────────────
    const sop = { completed: 0, missed: 0, pending: 0, in_progress: 0, completed_late: 0, compliance_pct: 0 };
    const sopByProperty = new Map<string, { completed: number; missed: number; pending: number }>();
    try {
        const crows = await fetchAllRows(() => {
            let cq = admin
                .from('sop_completions')
                .select('id, property_id, status, is_late')
                .gte('due_at', startIso)
                .order('id', { ascending: true });
            if (propertyId) cq = cq.eq('property_id', propertyId);
            return cq;
        });
        (crows || []).forEach((c: any) => {
            const st = c.status;
            if (st === 'completed') { sop.completed += 1; if (c.is_late) sop.completed_late += 1; }
            else if (st === 'missed') sop.missed += 1;
            else if (st === 'in_progress') sop.in_progress += 1;
            else sop.pending += 1; // pending / partial / null
            if (c.property_id) {
                if (!sopByProperty.has(c.property_id)) sopByProperty.set(c.property_id, { completed: 0, missed: 0, pending: 0 });
                const pb = sopByProperty.get(c.property_id)!;
                if (st === 'completed') pb.completed += 1;
                else if (st === 'missed') pb.missed += 1;
                else pb.pending += 1;
            }
        });
        const denom = sop.completed + sop.missed;
        sop.compliance_pct = denom > 0 ? Math.round((sop.completed / denom) * 100) : 0;
    } catch { /* degrade */ }

    // ── Violations: escalations (overdue) ───────────────────────────────────
    let escalations = 0;
    try {
        let eq = admin.from('ticket_escalation_logs').select('id', { count: 'exact', head: true }).gte('created_at', startIso);
        const { count } = await eq;
        escalations = count || 0;
    } catch { /* degrade */ }

    // ── Loggers coverage (electricity / diesel / water) ─────────────────────
    // Cap-immune: readings have a UNIQUE(device, reading_date) constraint, so an exact
    // row count == distinct device-days. No row fetch (and no 1000-cap) needed.
    async function loggerStat(table: string, deviceTable: string, deviceJoinCol: string) {
        const out = { count: 0, last: null as string | null, coverage_pct: 0 };
        try {
            let activeDevices = 0;
            let deviceIds: string[] | null = null;
            if (propertyId) {
                const devs = await fetchAllRows(() =>
                    admin.from(deviceTable).select('id').eq('property_id', propertyId).order('id', { ascending: true }));
                deviceIds = (devs || []).map((d: any) => d.id);
                activeDevices = deviceIds.length;
                if (activeDevices === 0) return out;
            } else {
                const { count: dc } = await admin.from(deviceTable).select('id', { count: 'exact', head: true });
                activeDevices = dc || 0;
            }

            const scopeIn = (q: any) => (propertyId && deviceIds ? q.in(deviceJoinCol, deviceIds) : q);

            // Exact reading count in window (== distinct device-days).
            const { count } = await scopeIn(
                admin.from(table).select('id', { count: 'exact', head: true }).gte('reading_date', startDate));
            out.count = count || 0;

            // Most-recent reading date (single row, cap-irrelevant).
            const { data: lastRows } = await scopeIn(
                admin.from(table).select('reading_date').gte('reading_date', startDate)
                    .order('reading_date', { ascending: false }).limit(1));
            out.last = lastRows?.[0]?.reading_date || null;

            // Days in window: explicit for fixed periods; for 'all', span first→last reading.
            let days: number;
            if (start) {
                days = Math.max(1, Math.ceil((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)));
            } else {
                const { data: firstRows } = await scopeIn(
                    admin.from(table).select('reading_date').order('reading_date', { ascending: true }).limit(1));
                const first = firstRows?.[0]?.reading_date;
                days = (first && out.last)
                    ? Math.max(1, Math.round((new Date(out.last).getTime() - new Date(first).getTime()) / (24 * 60 * 60 * 1000)) + 1)
                    : Math.max(1, out.count > 0 ? 1 : 1);
            }
            const expected = activeDevices * days;
            out.coverage_pct = expected > 0 ? Math.min(100, Math.round((out.count / expected) * 100)) : 0;
        } catch { /* degrade */ }
        return out;
    }

    const [electricity, diesel, water] = await Promise.all([
        loggerStat('electricity_readings', 'electricity_meters', 'meter_id'),
        loggerStat('diesel_readings', 'generators', 'generator_id'),
        loggerStat('water_readings', 'water_sources', 'source_id'),
    ]);

    // ── Module usage % (activity proxy) ─────────────────────────────────────
    const moduleResults = await Promise.all(MODULE_PROBES.map(async (m) => {
        try {
            const dateColIsDate = m.dateCol === 'reading_date' || m.dateCol === 'roster_date';
            let q = admin.from(m.table).select('id', { count: 'exact', head: true })
                .gte(m.dateCol, dateColIsDate ? startDate : startIso);
            if (propertyId && m.propCol) q = q.eq(m.propCol, propertyId);
            const { count, error } = await q;
            if (error) return { key: m.key, label: m.label, active: false, count: 0 };
            return { key: m.key, label: m.label, active: (count || 0) > 0, count: count || 0 };
        } catch {
            return { key: m.key, label: m.label, active: false, count: 0 };
        }
    }));
    const activeModules = moduleResults.filter((m) => m.active).length;
    const totalModules = moduleResults.length;
    const moduleUsagePct = totalModules > 0 ? Math.round((activeModules / totalModules) * 100) : 0;

    // ── Per-property breakdown ──────────────────────────────────────────────
    const perProperty = properties.map((p) => {
        const members = usersByProperty.get(p.id) || new Set<string>();
        let onlineNow = 0;
        members.forEach((uid) => { if (onlineUserIds.has(uid)) onlineNow += 1; });
        const tk = ticketsByProperty.get(p.id) || { total: 0, open: 0, resolved: 0 };
        const sp = sopByProperty.get(p.id) || { completed: 0, missed: 0, pending: 0 };
        const sopDenom = sp.completed + sp.missed;
        const compliance = sopDenom > 0 ? Math.round((sp.completed / sopDenom) * 100) : 0;
        // Transparent usage/health score for the leaderboard: rewards activity volume
        // (users, tickets, checklists filled, live presence) and operational health
        // (compliance), penalises misses lightly.
        const activityScore = Math.round(
            members.size * 2 + tk.total + sp.completed + onlineNow * 3 + compliance - sp.missed
        );
        return {
            property_id: p.id,
            name: p.name,
            code: p.code,
            user_count: members.size,
            online_now: onlineNow,
            tickets_total: tk.total,
            tickets_open: tk.open,
            tickets_resolved: tk.resolved,
            sop_completed: sp.completed,
            sop_missed: sp.missed,
            sop_compliance_pct: compliance,
            activity_score: activityScore,
        };
    }).sort((a, b) => b.user_count - a.user_count);

    // ── Leaderboards ────────────────────────────────────────────────────────
    const leaderboards = {
        properties_by_activity: [...perProperty]
            .sort((a, b) => b.activity_score - a.activity_score)
            .slice(0, 10)
            .map((p) => ({ property_id: p.property_id, name: p.name, code: p.code, score: p.activity_score, user_count: p.user_count, tickets_total: p.tickets_total, sop_compliance_pct: p.sop_compliance_pct })),
        properties_by_compliance: [...perProperty]
            .filter((p) => p.sop_completed + p.sop_missed > 0)
            .sort((a, b) => b.sop_compliance_pct - a.sop_compliance_pct || b.sop_completed - a.sop_completed)
            .slice(0, 10)
            .map((p) => ({ property_id: p.property_id, name: p.name, code: p.code, sop_compliance_pct: p.sop_compliance_pct, sop_completed: p.sop_completed, sop_missed: p.sop_missed })),
        top_users: [...userMetrics]
            .sort((a, b) => b.total_sessions - a.total_sessions || b.sessions_this_week - a.sessions_this_week)
            .slice(0, 10)
            .map((u) => ({ user_id: u.user_id, full_name: u.full_name, email: u.email, total_sessions: u.total_sessions, sessions_this_week: u.sessions_this_week, avg_duration_minutes: u.avg_duration_minutes, online: u.online })),
    };

    const totalUsers = propertyId
        ? (usersByProperty.get(propertyId)?.size || 0)
        : globalSessions.total_user_base;

    return NextResponse.json({
        generated_at: nowIso,
        period,
        property_id: propertyId,
        scope_label: scopeLabel,
        properties: properties.map((p) => ({ id: p.id, name: p.name, code: p.code })),
        global: {
            total_properties: properties.length,
            total_users: totalUsers,
            active_users_7d: globalSessions.active_users_7d,
            online_now: globalSessions.online_now,
            avg_session_duration_minutes: globalSessions.avg_session_duration_minutes,
            total_sessions_logged: globalSessions.total_sessions_logged,
            module_usage_pct: moduleUsagePct,
            active_modules: activeModules,
            total_modules: totalModules,
        },
        modules: moduleResults,
        perProperty,
        leaderboards,
        users: userMetrics,
        tickets,
        violations: {
            sla_breached: slaBreached,
            missed_checklists: sop.missed,
            escalations,
        },
        sop,
        loggers: { electricity, diesel, water },
        sessionsTrend,
    });
}
