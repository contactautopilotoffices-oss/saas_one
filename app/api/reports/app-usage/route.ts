import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCommandCenterAccess,
    isCommandCenterAccessError,
    isMissingRelation,
    readOrgId,
} from '@/backend/lib/commandCenter/access';
import { MODULES, ORG_MODULES, type Source } from '@/backend/lib/reports/appUsageModules';

/**
 * GET /api/reports/app-usage?orgId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Org-level App Usage Report: how well each property has adopted each module, and
 * who does the work. Org super admins (and master admins) only.
 *
 * No new tracking: every module already stores who acted, where and when, so this
 * reads those rows for the date range and aggregates them in JS.
 *
 * Modules are scored against their own rhythm, so a monthly module is never compared
 * with a daily one on raw counts:
 *   scheduled  completed / scheduled            (SOP checklists, PPM)
 *   daily      days with an entry / days        (tickets, meters, visitors, stock)
 *   weekly     weeks with an entry / weeks      (rooms, petty cash, procurement, roster, assets)
 *   monthly    months submitted / months        (monthly requisitions)
 * HR, CRM and Task manager carry no property, so they are reported org-wide as counts.
 *
 * Days are IST calendar days. Each module degrades on its own: a missing table or
 * column marks that module unavailable instead of failing the whole report.
 */

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string } | null;
type Page = PromiseLike<{ data: unknown[] | null; error: DbError }>;

const IST_OFFSET_MS = 330 * 60 * 1000;
const MAX_DAYS = 366;
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
const PAGE_WAVE = 6;
const VIEW_ROLES = ['org_super_admin', 'master_admin'];

// ── Date helpers (IST calendar days, YYYY-MM-DD strings) ─────────────────────

function todayIst(): string {
    return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** A real calendar day: rejects values like 2026-02-31 that Date would roll over. */
function isDay(v: string | null): v is string {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const t = Date.parse(`${v}T00:00:00Z`);
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** IST calendar day of a timestamp, or the value itself for a DATE column. */
function istDay(v: unknown): string | null {
    if (typeof v !== 'string' || !v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const t = Date.parse(v);
    if (isNaN(t)) return null;
    return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v ? v : null;
}

// ── Paged reads past the PostgREST row cap ──────────────────────────────────

/**
 * Reads every page past the PostgREST row cap. The first page is read alone (most
 * tables fit in it); after that, pages are fetched PAGE_WAVE at a time instead of one
 * after another, which is what made big tables like sop_completions slow.
 */
async function fetchAll(makePage: (from: number, to: number) => Page): Promise<{ rows: Row[]; error: DbError; truncated: boolean }> {
    const rows: Row[] = [];
    const first = await makePage(0, PAGE_SIZE - 1);
    if (first.error) return { rows, error: first.error, truncated: false };
    rows.push(...((first.data || []) as Row[]));
    if (!first.data || first.data.length < PAGE_SIZE) return { rows, error: null, truncated: false };

    for (let page = 1; page < MAX_PAGES; page += PAGE_WAVE) {
        const wave = await Promise.all(
            Array.from({ length: Math.min(PAGE_WAVE, MAX_PAGES - page) }, (_, i) => {
                const from = (page + i) * PAGE_SIZE;
                return makePage(from, from + PAGE_SIZE - 1);
            }),
        );
        for (const { data, error } of wave) {
            if (error) return { rows, error, truncated: false };
            rows.push(...((data || []) as Row[]));
            if (!data || data.length < PAGE_SIZE) return { rows, error: null, truncated: false };
        }
    }
    return { rows, error: null, truncated: true };
}

function isMissingColumn(error: DbError): boolean {
    return error?.code === '42703' || error?.code === 'PGRST204' || /column .* does not exist/i.test(error?.message || '');
}

interface UsageEvent {
    module: string;
    propertyId: string | null;
    userId: string | null;
    day: string | null;
    /** Exact time of the entry when known (timestamp or date), for "last entry". */
    at: string | null;
}

/** Roles that can be picked as a SPOC: the property's own team, not tenants or vendors. */
function isTeamRole(role: string | null | undefined): boolean {
    const r = String(role || '').toLowerCase();
    return !!r && !r.includes('tenant') && !r.includes('vendor');
}

export async function GET(request: NextRequest) {
    const access = await resolveCommandCenterAccess(request, readOrgId(request));
    if (isCommandCenterAccessError(access)) return access;

    // isSuperAdmin = master admin, or org_super_admin of the resolved org.
    if (!access.isSuperAdmin && !access.roles.some(r => VIEW_ROLES.includes(r))) {
        return NextResponse.json({ error: 'Forbidden: the App Usage Report is for org super admins' }, { status: 403 });
    }

    // ── Range ────────────────────────────────────────────────────────────────
    const sp = request.nextUrl.searchParams;
    const today = todayIst();
    const askedTo = isDay(sp.get('to')) ? (sp.get('to') as string) : today;
    const to = askedTo > today ? today : askedTo;
    const from = isDay(sp.get('from')) ? (sp.get('from') as string) : addDays(to, -29);
    if (from > to) return NextResponse.json({ error: '"from" must be on or before "to"' }, { status: 400 });

    const days: string[] = [];
    for (let d = from; d <= to && days.length <= MAX_DAYS; d = addDays(d, 1)) days.push(d);
    if (days.length > MAX_DAYS) {
        return NextResponse.json({ error: `Pick a range of ${MAX_DAYS} days or less` }, { status: 400 });
    }
    const dayIndex = new Map(days.map((d, i) => [d, i]));
    const weekCount = Math.ceil(days.length / 7);
    // Weeks are counted back from `to`, so the most recent week is always complete.
    const weekOf = (day: string) => Math.floor((days.length - 1 - (dayIndex.get(day) as number)) / 7);
    const months = Array.from(new Set(days.map(d => d.slice(0, 7))));

    const fromTs = `${from}T00:00:00+05:30`;
    const toTsExclusive = `${addDays(to, 1)}T00:00:00+05:30`;
    // Checklists due later today are not missed yet, so scheduled work stops at now.
    const dueBefore = to === today ? new Date().toISOString() : toTsExclusive;

    // CAPEX-only properties (projects, fit-outs) have no day-to-day operations, so
    // they are left out. Until the operation_type column exists every property counts.
    const capexIds = new Set<string>();
    if (access.propertyIds.length) {
        const { data: kinds, error: kindError } = await supabaseAdmin
            .from('properties')
            .select('id, operation_type')
            .eq('organization_id', access.organizationId)
            .in('id', access.propertyIds);
        if (kindError) {
            if (kindError.code !== '42703') console.error('[app-usage] operation_type:', kindError.message);
        } else {
            for (const k of kinds || []) if (k.operation_type === 'capex') capexIds.add(String(k.id));
        }
    }
    const reportProperties = access.properties.filter(p => !capexIds.has(p.id));
    const propertyIds = reportProperties.map(p => p.id);
    const propertySet = new Set(propertyIds);
    const events: UsageEvent[] = [];
    const unavailable: string[] = [];
    const truncated: string[] = [];
    const scheduled = new Map<string, { scheduled: number; done: number }>(); // `${prop}|${module}`
    const reqMonths = new Map<string, Set<string>>(); // prop -> months submitted

    // ── Simple sources ──────────────────────────────────────────────────────
    let waterSourceProperty = new Map<string, string>();
    const simpleTask = (async () => {
        if (MODULES.some(m => m.source?.scope === 'water')) {
            const { rows, error } = await fetchAll((a, b) =>
                supabaseAdmin.from('water_sources').select('id, property_id').in('property_id', propertyIds).order('id').range(a, b));
            if (error) {
                if (!isMissingRelation(error)) console.error('[app-usage] water_sources:', error.message);
                unavailable.push('water');
            } else {
                waterSourceProperty = new Map(rows.map(r => [String(r.id), String(r.property_id)]));
            }
        }

        await Promise.all(MODULES.filter(m => m.source).map(async (m) => {
            const s = m.source as Source;
            const scopeCol = s.scope === 'water' ? 'source_id' : 'property_id';
            const scopeIds = s.scope === 'water' ? Array.from(waterSourceProperty.keys()) : propertyIds;
            if (!scopeIds.length || unavailable.includes(m.key)) return;

            const read = (withUser: boolean) => fetchAll((a, b) => {
                let q = supabaseAdmin
                    .from(s.table)
                    .select(Array.from(new Set([scopeCol, s.dateCol, s.atCol || s.dateCol, withUser ? s.userCol : null].filter(Boolean))).join(', '))
                    .in(scopeCol, scopeIds);
                q = s.dateType === 'date'
                    ? q.gte(s.dateCol, from).lte(s.dateCol, to)
                    : q.gte(s.dateCol, fromTs).lt(s.dateCol, toTsExclusive);
                return q.order('id').range(a, b);
            });

            let { rows, error, truncated: cut } = await read(true);
            if (error && isMissingColumn(error)) ({ rows, error, truncated: cut } = await read(false)); // e.g. visitor_logs.created_by not migrated
            if (cut) truncated.push(m.key);
            if (error) {
                if (!isMissingRelation(error)) console.error(`[app-usage] ${s.table}:`, error.message);
                unavailable.push(m.key);
                return;
            }
            for (const r of rows) {
                const propertyId = s.scope === 'water' ? waterSourceProperty.get(String(r.source_id)) ?? null : str(r.property_id);
                if (!propertyId || !propertySet.has(propertyId)) continue;
                events.push({ module: m.key, propertyId, userId: str(r[s.userCol]), day: istDay(r[s.dateCol]), at: str(r[s.atCol || s.dateCol]) });
            }
        }));
    })();

    // ── SOP checklists: completed vs scheduled ──────────────────────────────
    const sopTask = (async () => {
        // Scheduled = a cheap count per property; only completed rows are downloaded,
        // because only they carry who did the work. Pending rows were most of the volume.
        const counts = await Promise.all(propertyIds.map(pid =>
            supabaseAdmin.from('sop_completions')
                .select('id', { count: 'exact', head: true })
                .eq('property_id', pid)
                .gte('due_at', fromTs).lt('due_at', dueBefore)
                .then(r => ({ pid, count: r.count ?? 0, error: r.error }))));
        const countError = counts.find(c => c.error)?.error;
        const fetched = countError ? { rows: [] as Row[], error: countError, truncated: false } : await fetchAll((a, b) =>
            supabaseAdmin.from('sop_completions')
                .select('id, property_id, status, completed_by, completed_at, due_at')
                .in('property_id', propertyIds)
                .gte('due_at', fromTs).lt('due_at', dueBefore)
                .or('status.eq.completed,completed_at.not.is.null')
                .order('id').range(a, b));
        const { rows, error } = fetched;
        if (fetched.truncated) truncated.push('checklists');
        if (error) {
            if (!isMissingRelation(error)) console.error('[app-usage] sop_completions:', error.message);
            unavailable.push('checklists');
            return;
        }
        for (const c of counts) {
            if (c.count > 0) scheduled.set(`${c.pid}|checklists`, { scheduled: c.count, done: 0 });
        }
        for (const r of rows) {
            const propertyId = str(r.property_id);
            if (!propertyId) continue;
            const agg = scheduled.get(`${propertyId}|checklists`);
            if (!agg) continue;
            agg.done = Math.min(agg.scheduled, agg.done + 1);
            events.push({ module: 'checklists', propertyId, userId: str(r.completed_by), day: istDay(r.completed_at) ?? istDay(r.due_at), at: str(r.completed_at) ?? str(r.due_at) });
        }
    })();

    // ── PPM: done vs planned ────────────────────────────────────────────────
    const ppmTask = (async () => {
        const { rows, error } = await fetchAll((a, b) =>
            supabaseAdmin.from('ppm_schedules')
                .select('id, property_id, planned_date, done_date, status, attachments')
                .in('property_id', propertyIds)
                .gte('planned_date', from).lte('planned_date', to)
                .order('id').range(a, b));
        if (error) {
            if (!isMissingRelation(error)) console.error('[app-usage] ppm_schedules:', error.message);
            unavailable.push('ppm');
        } else {
            for (const r of rows) {
                const propertyId = str(r.property_id);
                if (!propertyId) continue;
                const k = `${propertyId}|ppm`;
                const agg = scheduled.get(k) || { scheduled: 0, done: 0 };
                agg.scheduled++;
                const status = String(r.status || '').toLowerCase();
                const notDone = ['postponed', 'skipped', 'cancelled', 'pending'].includes(status);
                if (status === 'completed' || status === 'done' || (r.done_date && !notDone)) {
                    agg.done++;
                    // PPM keeps the completing user inside the attachments JSON, not as a column.
                    const att = r.attachments && typeof r.attachments === 'object' && !Array.isArray(r.attachments)
                        ? (r.attachments as Record<string, unknown>) : {};
                    events.push({ module: 'ppm', propertyId, userId: str(att.completed_by), day: istDay(r.done_date) ?? istDay(att.completed_at), at: str(att.completed_at) ?? str(r.done_date) });
                }
                scheduled.set(k, agg);
            }
        }
    })();

    // ── Monthly requisitions: months submitted ──────────────────────────────
    const reqTask = (async () => {
        const years = Array.from(new Set(months.map(m => Number(m.slice(0, 4)))));
        const { rows, error } = await fetchAll((a, b) =>
            supabaseAdmin.from('property_monthly_requisitions')
                .select('id, property_id, uploaded_by, requisition_month, requisition_year, created_at')
                .in('property_id', propertyIds)
                .in('requisition_year', years)
                .order('id').range(a, b));
        if (error) {
            if (!isMissingRelation(error)) console.error('[app-usage] property_monthly_requisitions:', error.message);
            unavailable.push('requisitions');
        } else {
            for (const r of rows) {
                const propertyId = str(r.property_id);
                const month = `${r.requisition_year}-${String(r.requisition_month).padStart(2, '0')}`;
                if (!propertyId || !months.includes(month)) continue;
                if (!reqMonths.has(propertyId)) reqMonths.set(propertyId, new Set());
                (reqMonths.get(propertyId) as Set<string>).add(month);
                events.push({ module: 'requisitions', propertyId, userId: str(r.uploaded_by), day: istDay(r.created_at), at: str(r.created_at) });
            }
        }
    })();

    // ── Org-wide modules (no property column) ───────────────────────────────
    const orgWide: { key: string; label: string; actions: number; users: number | null; available: boolean }[] = [];
    const orgTask = Promise.all(ORG_MODULES.map(async (m) => {
        const { rows, error } = await fetchAll((a, b) =>
            supabaseAdmin.from(m.table)
                .select(m.userCol ? `id, ${m.userCol}, created_at` : 'id, created_at')
                .eq('organization_id', access.organizationId)
                .gte('created_at', fromTs).lt('created_at', toTsExclusive)
                .order('id').range(a, b));
        if (error) {
            if (!isMissingRelation(error)) console.error(`[app-usage] ${m.table}:`, error.message);
            orgWide.push({ key: m.key, label: m.label, actions: 0, users: null, available: false });
            return;
        }
        const users = new Set<string>();
        for (const r of rows) {
            const userId = m.userCol ? str(r[m.userCol]) : null;
            if (userId) users.add(userId);
            events.push({ module: m.key, propertyId: null, userId, day: istDay(r.created_at), at: str(r.created_at) });
        }
        orgWide.push({ key: m.key, label: m.label, actions: rows.length, users: m.userCol ? users.size : null, available: true });
    }));

    // ── SPOCs (one per property + module) and each property's team ──────────
    let spocsAvailable = true;
    const spocByCell = new Map<string, string>(); // `${prop}|${module}` -> user id
    const spocTask = (async () => {
        const { rows, error } = await fetchAll((a, b) =>
            supabaseAdmin.from('module_spocs')
                .select('id, property_id, module_key, user_id')
                .eq('organization_id', access.organizationId)
                .in('property_id', propertyIds)
                .order('id').range(a, b));
        if (error) {
            spocsAvailable = false;
            if (!isMissingRelation(error)) console.error('[app-usage] module_spocs:', error.message);
        } else {
            rows.forEach(r => spocByCell.set(`${r.property_id}|${r.module_key}`, String(r.user_id)));
        }
    })();
    const teamByProperty = new Map<string, { userId: string; role: string }[]>();
    const teamTask = (async () => {
        const { rows, error } = await fetchAll((a, b) =>
            supabaseAdmin.from('property_memberships')
                .select('user_id, property_id, role')
                .in('property_id', propertyIds)
                .eq('is_active', true)
                // (user_id, property_id) is the primary key, so paging on both is stable.
                .order('user_id').order('property_id').range(a, b));
        if (error) console.error('[app-usage] property team:', error.message);
        for (const r of rows) {
            const pid = str(r.property_id), uid = str(r.user_id), role = str(r.role);
            if (!pid || !uid || !isTeamRole(role)) continue;
            if (!teamByProperty.has(pid)) teamByProperty.set(pid, []);
            (teamByProperty.get(pid) as { userId: string; role: string }[]).push({ userId: uid, role: role as string });
        }
    })();

    // Every read above runs at the same time; wait for all of them here.
    await Promise.all([simpleTask, sopTask, ppmTask, reqTask, orgTask, spocTask, teamTask]);
    orgWide.sort((a, b) => ORG_MODULES.findIndex(m => m.key === a.key) - ORG_MODULES.findIndex(m => m.key === b.key));

    // ── Aggregate ───────────────────────────────────────────────────────────
    const inRange = (day: string | null): day is string => !!day && dayIndex.has(day);

    const cellActions = new Map<string, number>();
    const cellUnits = new Map<string, Set<number | string>>();
    const userRows = new Map<string, { userId: string; propertyId: string | null; byModule: Record<string, number>; days: Set<string> }>();
    const dailyUsers = days.map(() => new Set<string>());
    const dailyActions = days.map(() => 0);
    const lastEntries = new Map<string, { userId: string | null; at: string; t: number }>();

    for (const e of events) {
        if (e.propertyId && inRange(e.day)) {
            const k = `${e.propertyId}|${e.module}`;
            cellActions.set(k, (cellActions.get(k) || 0) + 1);
            const t = e.at ? Date.parse(e.at) : NaN;
            if (!isNaN(t) && (!lastEntries.has(k) || t > (lastEntries.get(k) as { t: number }).t)) {
                lastEntries.set(k, { userId: e.userId, at: e.at as string, t });
            }
            const mod = MODULES.find(m => m.key === e.module);
            if (mod && (mod.cadence === 'daily' || mod.cadence === 'weekly')) {
                if (!cellUnits.has(k)) cellUnits.set(k, new Set());
                (cellUnits.get(k) as Set<number | string>).add(mod.cadence === 'daily' ? e.day : weekOf(e.day));
            }
        }
        if (inRange(e.day)) {
            dailyActions[dayIndex.get(e.day) as number]++;
            if (e.userId) dailyUsers[dayIndex.get(e.day) as number].add(e.userId);
        }
        if (!e.userId) continue;
        const uk = `${e.userId}|${e.propertyId ?? 'org'}`;
        if (!userRows.has(uk)) userRows.set(uk, { userId: e.userId, propertyId: e.propertyId, byModule: {}, days: new Set() });
        const u = userRows.get(uk)!;
        u.byModule[e.module] = (u.byModule[e.module] || 0) + 1;
        if (inRange(e.day)) u.days.add(e.day);
    }

    // pct = done / expected * 100, with both numbers returned so the screen can show its working.
    const cells: Record<string, Record<string, {
        actions: number; pct: number | null; done: number | null; expected: number | null; detail: string;
        spoc?: { userId: string; name: string; active: boolean } | null;
        lastEntry?: { userId: string | null; name: string | null; at: string } | null;
    }>> = {};
    for (const pid of propertyIds) {
        cells[pid] = {};
        for (const m of MODULES) {
            const k = `${pid}|${m.key}`;
            const actions = cellActions.get(k) || 0;
            let pct: number | null = null;
            let done: number | null = null;
            let expected: number | null = null;
            let detail = '';
            if (unavailable.includes(m.key)) {
                detail = 'Data not available';
            } else if (m.cadence === 'scheduled') {
                const agg = scheduled.get(k);
                if (agg && agg.scheduled > 0) {
                    done = agg.done; expected = agg.scheduled;
                    pct = Math.round((agg.done / agg.scheduled) * 100);
                    detail = `${agg.done} of ${agg.scheduled} completed`;
                } else {
                    detail = 'Nothing scheduled in this period';
                }
            } else if (m.cadence === 'daily') {
                const used = cellUnits.get(k)?.size || 0;
                done = used; expected = days.length;
                pct = Math.round((used / days.length) * 100);
                detail = `Used on ${used} of ${days.length} days`;
            } else if (m.cadence === 'weekly' && days.length < 7) {
                // A weekly module cannot be judged on less than a week.
                detail = 'Weekly module: pick a range of 7 days or more to score it';
            } else if (m.cadence === 'weekly') {
                const used = cellUnits.get(k)?.size || 0;
                done = used; expected = weekCount;
                pct = Math.round((used / weekCount) * 100);
                detail = `Used in ${used} of ${weekCount} weeks`;
            } else {
                done = reqMonths.get(pid)?.size || 0; expected = months.length;
                pct = Math.round((done / months.length) * 100);
                detail = `Submitted for ${done} of ${months.length} month${months.length === 1 ? '' : 's'}`;
            }
            cells[pid][m.key] = { actions, pct, done, expected, detail };
        }
    }


    // ── People: names and roles ─────────────────────────────────────────────
    const userIds = Array.from(new Set([
        ...Array.from(userRows.values()).map(u => u.userId),
        ...Array.from(spocByCell.values()),
        ...Array.from(lastEntries.values()).map(l => l.userId).filter((x): x is string => !!x),
        ...Array.from(teamByProperty.values()).flat().map(m => m.userId),
    ]));
    const names = new Map<string, { name: string; email: string | null }>();
    const propRoles = new Map<string, string>();
    const orgRoles = new Map<string, string>();
    const chunks: string[][] = [];
    for (let i = 0; i < userIds.length; i += 200) chunks.push(userIds.slice(i, i + 200));
    await Promise.all(chunks.map(async (chunk) => {
        const [usersRes, propRes, orgRes] = await Promise.all([
            supabaseAdmin.from('users').select('id, full_name, email').in('id', chunk),
            supabaseAdmin.from('property_memberships').select('user_id, property_id, role').in('user_id', chunk).in('property_id', propertyIds).eq('is_active', true),
            supabaseAdmin.from('organization_memberships').select('user_id, role').in('user_id', chunk).eq('organization_id', access.organizationId),
        ]);
        if (usersRes.error) console.error('[app-usage] users lookup:', usersRes.error.message);
        (usersRes.data || []).forEach(u => names.set(u.id, { name: u.full_name || u.email || 'Unknown user', email: u.email ?? null }));
        (propRes.data || []).forEach(m => { if (m.role) propRoles.set(`${m.user_id}|${m.property_id}`, m.role); });
        (orgRes.data || []).forEach(m => { if (m.role) orgRoles.set(m.user_id, m.role); });
    }));

    const nameOf = (id: string | null) => (id ? names.get(id)?.name || 'Unknown user' : null);
    for (const pid of propertyIds) {
        const team = new Set((teamByProperty.get(pid) || []).map(m => m.userId));
        for (const m of MODULES) {
            const k = `${pid}|${m.key}`;
            const spocId = spocByCell.get(k) || null;
            const last = lastEntries.get(k);
            cells[pid][m.key].spoc = spocId ? { userId: spocId, name: nameOf(spocId) as string, active: team.has(spocId) } : null;
            cells[pid][m.key].lastEntry = last ? { userId: last.userId, name: nameOf(last.userId), at: last.at } : null;
        }
    }
    const members: Record<string, { userId: string; name: string; role: string }[]> = {};
    for (const pid of propertyIds) {
        members[pid] = (teamByProperty.get(pid) || [])
            .map(m => ({ userId: m.userId, name: nameOf(m.userId) as string, role: m.role }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    const users = Array.from(userRows.values()).map(u => {
        const sortedDays = Array.from(u.days).sort();
        return {
            userId: u.userId,
            name: names.get(u.userId)?.name || 'Unknown user',
            email: names.get(u.userId)?.email || null,
            role: (u.propertyId && propRoles.get(`${u.userId}|${u.propertyId}`)) || orgRoles.get(u.userId) || null,
            propertyId: u.propertyId,
            byModule: u.byModule,
            total: Object.values(u.byModule).reduce((a, b) => a + b, 0),
            activeDays: u.days.size,
            lastActive: sortedDays.length ? sortedDays[sortedDays.length - 1] : null,
        };
    }).sort((a, b) => b.total - a.total);

    return NextResponse.json({
        organizationId: access.organizationId,
        range: { from, to, days: days.length, weeks: weekCount, months: months.length },
        properties: reportProperties.map(p => ({ id: p.id, name: p.name })),
        capexHidden: access.properties.filter(p => capexIds.has(p.id)).map(p => p.name),
        modules: MODULES.map(m => ({ key: m.key, label: m.label, cadence: m.cadence })),
        cells,
        orgWide,
        users,
        daily: days.map((d, i) => ({ date: d, activeUsers: dailyUsers[i].size, actions: dailyActions[i] })),
        members,
        spocsAvailable,
        unavailable,
        truncated,
        generatedAt: new Date().toISOString(),
    });
}
