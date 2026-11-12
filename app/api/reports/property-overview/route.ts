import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { guardOrg, guardProperty } from '@/backend/lib/auth/callerAccess';
import { isMissingRelation } from '@/backend/lib/commandCenter/access';

/**
 * GET /api/reports/property-overview?propertyId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
 * GET /api/reports/property-overview?orgId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * One report across every service and module: tickets, guest requests,
 * SOP checklists, PPM, electricity, diesel, water, stock, assets, AMC,
 * visitors, meeting rooms, petty cash, procurement, monthly requisitions, roster,
 * tasks, statutory audit and the team.
 *
 * With `propertyId` the report covers one property. With `orgId` it covers every
 * active property of the organisation: every section is cumulative, and the
 * response also carries a per-property `comparative` so properties can be ranked
 * module by module.
 *
 * Reads only. Every section stands alone: a missing table or column marks that
 * section `available: false` instead of failing the whole report. Rows are fetched
 * once for the whole scope and bucketed by property in memory, never one query per
 * property. Days are IST calendar days.
 */

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string } | null;

const IST_OFFSET = '+05:30';
const IST_OFFSET_MS = 330 * 60 * 1000;
const MAX_DAYS = 366;
const ROW_CAP_PROPERTY = 5000;
const ROW_CAP_ORG = 20000;

const TICKET_CLOSED = ['resolved', 'closed', 'satisfied', 'completed'];
const TICKET_DEAD = ['cancelled', 'rejected', 'duplicate'];

function isDay(v: string | null): v is string {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const t = Date.parse(`${v}T00:00:00Z`);
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}
function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
function todayIst(): string {
    return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function istDay(v: unknown): string | null {
    if (typeof v !== 'string' || !v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const t = Date.parse(v);
    if (isNaN(t)) return null;
    return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}
/** IST weekday (0 = Sunday) and hour of a timestamp, for the "when do requests come in" heatmap. */
function istSlot(v: unknown): { weekday: number; hour: number } | null {
    if (typeof v !== 'string' || !v) return null;
    const t = Date.parse(v);
    if (isNaN(t)) return null;
    const d = new Date(t + IST_OFFSET_MS);
    return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
}
function num(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
    return typeof v === 'string' ? v : '';
}
function round1(n: number): number {
    return Math.round(n * 10) / 10;
}
function pct(part: number, whole: number): number | null {
    return whole > 0 ? round1((part / whole) * 100) : null;
}
function countBy(rows: Row[], pick: (r: Row) => string): { name: string; count: number }[] {
    const m = new Map<string, number>();
    for (const r of rows) {
        const k = pick(r) || 'Other';
        m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
/** One zeroed bucket per calendar day in the range, in order, so every trend has the same x axis. */
function dayBuckets<T extends object>(from: string, to: string, make: () => T): Map<string, { date: string } & T> {
    const m = new Map<string, { date: string } & T>();
    for (let d = from; d <= to; d = addDays(d, 1)) m.set(d, { date: d, ...make() });
    return m;
}
/** A joined one-to-one relation comes back as an object or a one-element array. */
function rel(v: unknown): Row | null {
    if (Array.isArray(v)) return (v[0] as Row) || null;
    return v && typeof v === 'object' ? (v as Row) : null;
}
/** Rows bucketed by property id, one bucket for every property in scope (empty when it has none). */
function byProperty(rows: Row[], ids: string[], key = 'property_id'): Map<string, Row[]> {
    const m = new Map<string, Row[]>(ids.map(id => [id, []]));
    for (const r of rows) {
        const k = str(r[key]);
        const b = m.get(k);
        if (b) b.push(r);
    }
    return m;
}

type Section<T> = ({ available: true; truncated?: boolean } & T) | { available: false; reason: string };

/**
 * Short-lived server cache. The same scope and range asked for again within CACHE_TTL_MS
 * (a refresh, a preset switched back, a second person opening the same report) is served
 * from memory instead of re-running every query. Authorisation still runs on every request.
 * `?fresh=1` bypasses it, which the Refresh button uses.
 */
const CACHE_TTL_MS = 120_000;
const CACHE_MAX = 200;
const CACHE = new Map<string, { at: number; body: unknown; timings: Record<string, number> }>();
function cacheGet(key: string) {
    const hit = CACHE.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) { CACHE.delete(key); return null; }
    return hit;
}
function cacheSet(key: string, body: unknown, timings: Record<string, number>) {
    if (CACHE.size >= CACHE_MAX) { const oldest = CACHE.keys().next().value; if (oldest !== undefined) CACHE.delete(oldest); }
    CACHE.set(key, { at: Date.now(), body, timings });
}
/** Server-Timing header so the slow sections show up in the browser's network panel. */
function serverTiming(timings: Record<string, number>, total: number, cached: boolean): string {
    const parts = Object.entries(timings).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k};dur=${v}`);
    return [`total;dur=${total}`, `cache;desc=${cached ? 'hit' : 'miss'}`, ...parts].join(', ');
}
/** Per-property figures a section contributes to the comparative view. */
type PerProperty = Record<string, Record<string, number | null>>;

/** Runs one section; a missing table becomes `available: false`, any other error is logged and reported the same way. */
async function section<T>(name: string, run: () => Promise<T>): Promise<Section<T>> {
    try {
        const data = await run();
        return { available: true, ...data };
    } catch (e) {
        const err = e as DbError & { message?: string };
        if (isMissingRelation(err) || err?.code === '42703' || err?.code === 'PGRST204' || /does not exist/i.test(err?.message || '')) {
            return { available: false, reason: 'Not set up for this property' };
        }
        console.error(`[property-overview] ${name}`, err?.message || e);
        return { available: false, reason: 'Could not load' };
    }
}

/** Throws on a query error so `section` can classify it. */
async function rows(q: PromiseLike<{ data: unknown[] | null; error: DbError }>): Promise<Row[]> {
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as Row[];
}

async function count(q: PromiseLike<{ count: number | null; error: DbError }>): Promise<number> {
    const { count: c, error } = await q;
    if (error) throw error;
    return c ?? 0;
}

/** Comparative metric definitions: which per-property figure to show, and whether more is better. */
const COMPARATIVE_METRICS: { key: string; label: string; module: string; unit: 'pct' | 'count' | 'inr' | 'hours' | 'units' | 'days'; higherIsBetter: boolean }[] = [
    { key: 'tickets_total', label: 'Requests raised', module: 'Requests', unit: 'count', higherIsBetter: false },
    { key: 'tickets_closure', label: 'Closure rate', module: 'Requests', unit: 'pct', higherIsBetter: true },
    { key: 'tickets_sla', label: 'SLA met', module: 'Requests', unit: 'pct', higherIsBetter: true },
    { key: 'tickets_hours', label: 'Avg time to close', module: 'Requests', unit: 'hours', higherIsBetter: false },
    { key: 'tickets_open_now', label: 'Open now', module: 'Requests', unit: 'count', higherIsBetter: false },
    { key: 'guest_resolved', label: 'Guest requests resolved', module: 'Guest requests', unit: 'pct', higherIsBetter: true },
    { key: 'sop_completion', label: 'Checklist completion', module: 'SOP checklists', unit: 'pct', higherIsBetter: true },
    { key: 'sop_missed', label: 'Checklists missed', module: 'SOP checklists', unit: 'count', higherIsBetter: false },
    { key: 'ppm_compliance', label: 'PPM compliance', module: 'PPM', unit: 'pct', higherIsBetter: true },
    { key: 'ppm_overdue', label: 'PPM overdue now', module: 'PPM', unit: 'count', higherIsBetter: false },
    { key: 'elec_logging', label: 'Electricity days logged', module: 'Electricity', unit: 'pct', higherIsBetter: true },
    { key: 'elec_units', label: 'Electricity units', module: 'Electricity', unit: 'units', higherIsBetter: false },
    { key: 'diesel_logging', label: 'Diesel days logged', module: 'Diesel', unit: 'pct', higherIsBetter: true },
    { key: 'diesel_litres', label: 'Diesel litres', module: 'Diesel', unit: 'units', higherIsBetter: false },
    { key: 'water_logging', label: 'Water days logged', module: 'Water', unit: 'pct', higherIsBetter: true },
    { key: 'stock_low', label: 'Items below threshold', module: 'Stock', unit: 'count', higherIsBetter: false },
    { key: 'stock_activity', label: 'Stock days with activity', module: 'Stock', unit: 'pct', higherIsBetter: true },
    { key: 'assets_repair', label: 'Assets under repair', module: 'Assets', unit: 'count', higherIsBetter: false },
    { key: 'amc_expiring', label: 'AMC expiring or expired', module: 'AMC', unit: 'count', higherIsBetter: false },
    { key: 'visitors_total', label: 'Visitors', module: 'Visitors', unit: 'count', higherIsBetter: true },
    { key: 'visitors_inside', label: 'Visitors not checked out', module: 'Visitors', unit: 'count', higherIsBetter: false },
    { key: 'rooms_hours', label: 'Room hours booked', module: 'Meeting rooms', unit: 'hours', higherIsBetter: true },
    { key: 'petty_paid', label: 'Petty cash paid', module: 'Petty cash', unit: 'inr', higherIsBetter: false },
    { key: 'petty_pending', label: 'Petty cash awaiting approval', module: 'Petty cash', unit: 'count', higherIsBetter: false },
    { key: 'proc_pending', label: 'Material requests pending', module: 'Procurement', unit: 'count', higherIsBetter: false },
    { key: 'req_submitted', label: 'Requisitions submitted', module: 'Requisitions', unit: 'pct', higherIsBetter: true },
    { key: 'roster_coverage', label: 'Roster coverage', module: 'Roster', unit: 'pct', higherIsBetter: true },
    { key: 'tasks_completion', label: 'Task completion', module: 'Tasks', unit: 'pct', higherIsBetter: true },
    { key: 'audit_compliance', label: 'Audit compliance', module: 'Audit', unit: 'pct', higherIsBetter: true },
    { key: 'team_members', label: 'Team members', module: 'Team', unit: 'count', higherIsBetter: true },
];

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get('propertyId');
    const orgIdParam = searchParams.get('orgId');
    if (!propertyId && !orgIdParam) return NextResponse.json({ error: 'propertyId or orgId is required' }, { status: 400 });

    const today = todayIst();
    const toParam = searchParams.get('to');
    const fromParam = searchParams.get('from');
    const to = isDay(toParam) ? toParam : today;
    const from = isDay(fromParam) ? fromParam : `${to.slice(0, 7)}-01`;
    if (from > to) return NextResponse.json({ error: 'from must not be after to' }, { status: 400 });
    const dayCount = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (dayCount > MAX_DAYS) return NextResponse.json({ error: `Range must be at most ${MAX_DAYS} days` }, { status: 400 });

    // ── Scope: one property, or every active property of the organisation ───────
    type Prop = { id: string; name: string; code: string | null; address: string | null; city: string | null; is_active: boolean | null };
    let properties: Prop[] = [];
    let orgId: string;
    let scopeName: string;
    if (propertyId) {
        const denied = await guardProperty(request, propertyId);
        if (denied) return denied;
        const { data, error } = await supabaseAdmin
            .from('properties').select('id, name, code, address, city, organization_id, is_active').eq('id', propertyId).maybeSingle();
        if (error || !data) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
        properties = [data as Prop];
        orgId = String(data.organization_id);
        scopeName = String(data.name);
    } else {
        orgId = orgIdParam as string;
        const denied = await guardOrg(request, orgId);
        if (denied) return denied;
        const [{ data: org }, { data, error }] = await Promise.all([
            supabaseAdmin.from('organizations').select('name').eq('id', orgId).maybeSingle(),
            supabaseAdmin.from('properties').select('id, name, code, address, city, is_active').eq('organization_id', orgId).order('name'),
        ]);
        if (error) return NextResponse.json({ error: 'Could not load properties' }, { status: 500 });
        properties = ((data || []) as Prop[]).filter(p => p.is_active !== false);
        if (!properties.length) return NextResponse.json({ error: 'No active properties in this organisation' }, { status: 404 });
        scopeName = String(org?.name || 'All properties');
    }
    const ids = properties.map(p => p.id);
    const single = ids.length === 1;
    const t0 = Date.now();
    const cacheKey = `${single ? `p:${ids[0]}` : `o:${orgId}`}|${from}|${to}`;
    const fresh = searchParams.get('fresh') === '1';
    if (!fresh) {
        const hit = cacheGet(cacheKey);
        if (hit) {
            return NextResponse.json(hit.body, { headers: { 'Cache-Control': 'private, max-age=60', 'Server-Timing': serverTiming(hit.timings, Date.now() - t0, true) } });
        }
    }
    const timings: Record<string, number> = {};
    const timed = <T,>(name: string, run: () => Promise<T>): Promise<Section<T>> => {
        const start = Date.now();
        return section(name, run).then(r => { timings[name] = Date.now() - start; return r; });
    };
    const ROW_CAP = single ? ROW_CAP_PROPERTY : ROW_CAP_ORG;
    const nameOf = new Map(properties.map(p => [p.id, p.name]));

    // Timestamp columns: IST midnight of `from` up to (not including) IST midnight after `to`.
    const fromTs = `${from}T00:00:00${IST_OFFSET}`;
    const toTsExclusive = `${addDays(to, 1)}T00:00:00${IST_OFFSET}`;
    const nowIso = new Date().toISOString();

    // Team: who belongs to each property. Needed by tasks (which carry no property_id) and the team
    // card. Fetched once, in parallel with everything else; the two sections that need it await it.
    const teamPromise = (async () => {
        const teamRows = await rows(
            supabaseAdmin.from('property_memberships').select('user_id, role, is_active, property_id').in('property_id', ids).range(0, ROW_CAP - 1),
        ).catch(() => [] as Row[]);
        const activeTeam = teamRows.filter(r => r.is_active !== false);
        const memberIds = Array.from(new Set(activeTeam.map(r => str(r.user_id)).filter(Boolean)));
        // A person can belong to several properties; their tasks count for each.
        const propertiesOfUser = new Map<string, string[]>();
        for (const r of activeTeam) {
            const u = str(r.user_id);
            if (!u) continue;
            propertiesOfUser.set(u, [...(propertiesOfUser.get(u) || []), str(r.property_id)]);
        }
        const byMember = (list: Row[], userKey: string): Map<string, Row[]> => {
            const m = new Map<string, Row[]>(ids.map(id => [id, []]));
            for (const r of list) for (const pid of propertiesOfUser.get(str(r[userKey])) || []) m.get(pid)?.push(r);
            return m;
        };
        return { activeTeam, memberIds, byMember };
    })();

    const comparative: PerProperty = Object.fromEntries(ids.map(id => [id, {}]));
    const setCmp = (pid: string, key: string, value: number | null) => { if (comparative[pid]) comparative[pid][key] = value; };
    /** A rate plus the two numbers behind it, so the UI can always show "75% (48 of 64)". */
    const setRate = (pid: string, key: string, num: number, den: number) => { setCmp(pid, key, pct(num, den)); setCmp(pid, `${key}_num`, num); setCmp(pid, `${key}_den`, den); };

    const [
        tickets, guestRequests, sop, ppm, electricity, diesel, water, stock, assets, amc,
        visitors, meetingRooms, pettyCash, procurement, requisitions, roster, tasks, audit, team,
    ] = await Promise.all([
        // ── Tickets (requests) ───────────────────────────────────────────────
        timed('tickets', async () => {
            const [list, openRows] = await Promise.all([
                rows(supabaseAdmin.from('tickets')
                    .select('id, property_id, status, priority, category, created_at, resolved_at, internal, floor_number, sla_breached, sla_deadline, issue_category:category_id(name)')
                    .in('property_id', ids)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive)
                    .order('created_at', { ascending: true })
                    .range(0, ROW_CAP - 1)),
                single
                    ? count(supabaseAdmin.from('tickets').select('id', { count: 'exact', head: true })
                        .in('property_id', ids)
                        .not('status', 'in', `(${[...TICKET_CLOSED, ...TICKET_DEAD].join(',')})`)).then(c => Array.from({ length: c }, () => ({ property_id: ids[0] }) as Row))
                    : rows(supabaseAdmin.from('tickets').select('id, property_id')
                        .in('property_id', ids)
                        .not('status', 'in', `(${[...TICKET_CLOSED, ...TICKET_DEAD].join(',')})`)
                        .range(0, ROW_CAP - 1)),
            ]);
            const isClosed = (t: Row) => TICKET_CLOSED.includes(str(t.status));
            const calc = (ts: Row[]) => {
                const closed = ts.filter(isClosed);
                const hours = closed
                    .map(t => (Date.parse(str(t.resolved_at)) - Date.parse(str(t.created_at))) / 3_600_000)
                    .filter(h => Number.isFinite(h) && h >= 0);
                const breached = ts.filter(t => t.sla_breached === true || (str(t.sla_deadline) && str(t.sla_deadline) < nowIso && !isClosed(t))).length;
                return {
                    total: ts.length, closed: closed.length, breached, hours,
                    closure_rate: pct(closed.length, ts.length),
                    avg_hours: hours.length ? round1(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
                };
            };
            const all = calc(list);
            const openByProp = byProperty(openRows, ids);
            for (const [pid, ts] of byProperty(list, ids)) {
                const c = calc(ts);
                setCmp(pid, 'tickets_total', c.total);
                setRate(pid, 'tickets_closure', c.closed, c.total);
                setRate(pid, 'tickets_sla', c.total - c.breached, c.total);
                setCmp(pid, 'use_tickets', c.total);
                setCmp(pid, 'tickets_hours', c.avg_hours);
                setCmp(pid, 'tickets_open_now', openByProp.get(pid)?.length || 0);
            }

            const daily = dayBuckets(from, to, () => ({ raised: 0, closed: 0 }));
            const heatmap: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
            for (const t of list) {
                const r = istDay(t.created_at);
                if (r && daily.has(r)) daily.get(r)!.raised++;
                const c = istDay(t.resolved_at);
                if (c && daily.has(c) && isClosed(t)) daily.get(c)!.closed++;
                const slot = istSlot(t.created_at);
                if (slot) heatmap[slot.weekday][slot.hour]++;
            }
            const buckets = [
                { name: 'Under 4 h', max: 4 }, { name: '4 to 24 h', max: 24 }, { name: '1 to 3 d', max: 72 },
                { name: '3 to 7 d', max: 168 }, { name: 'Over 7 d', max: Infinity },
            ];
            const resolution_buckets = buckets.map(b => ({ name: b.name, count: 0 }));
            for (const h of all.hours) {
                const i = buckets.findIndex(b => h < b.max);
                resolution_buckets[i === -1 ? buckets.length - 1 : i].count++;
            }
            return {
                truncated: list.length >= ROW_CAP || openRows.length >= ROW_CAP,
                total: all.total,
                open: list.filter(t => !isClosed(t) && str(t.status) !== 'pending_validation').length,
                closed: all.closed,
                pending_validation: list.filter(t => str(t.status) === 'pending_validation').length,
                internal: list.filter(t => t.internal === true).length,
                open_now: openRows.length,
                sla_breached: all.breached,
                closure_rate: all.closure_rate,
                avg_resolution_hours: all.avg_hours,
                by_category: countBy(list, t => str(rel(t.issue_category)?.name) || str(t.category)).slice(0, 8),
                by_priority: countBy(list, t => str(t.priority) || 'unset'),
                by_status: countBy(list, t => str(t.status)),
                by_floor: single
                    ? countBy(list, t => (t.floor_number === null || t.floor_number === undefined) ? 'Unspecified' : `Floor ${t.floor_number}`).slice(0, 10)
                    : countBy(list, t => nameOf.get(str(t.property_id)) || 'Unknown').slice(0, 12),
                daily: Array.from(daily.values()),
                heatmap,
                resolution_buckets,
            };
        }),

        // ── Guest requests (QR walk-in requests) ─────────────────────────────
        timed('guest_requests', async () => {
            const list = await rows(
                supabaseAdmin.from('guest_requests').select('id, property_id, status, ai_category, created_at')
                    .in('property_id', ids)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive).range(0, ROW_CAP - 1),
            );
            const s = (l: Row[], v: string) => l.filter(r => str(r.status).toUpperCase() === v).length;
            for (const [pid, l] of byProperty(list, ids)) { setRate(pid, 'guest_resolved', s(l, 'RESOLVED'), l.length); setCmp(pid, 'use_guest', l.length); }
            return {
                total: list.length, pending: s(list, 'PENDING'), in_progress: s(list, 'IN_PROGRESS'), resolved: s(list, 'RESOLVED'),
                by_category: countBy(list, r => str(r.ai_category) || 'Uncategorised').slice(0, 6),
            };
        }),

        // ── SOP checklists ───────────────────────────────────────────────────
        timed('sop', async () => {
            const [list, templates] = await Promise.all([
                rows(supabaseAdmin.from('sop_completions').select('id, property_id, status, is_late, due_at, template_id')
                    .in('property_id', ids)
                    .gte('due_at', fromTs).lt('due_at', toTsExclusive).range(0, ROW_CAP - 1)),
                count(supabaseAdmin.from('sop_templates').select('id', { count: 'exact', head: true }).in('property_id', ids)).catch(() => 0),
            ]);
            const done = (l: Row[]) => l.filter(r => str(r.status) === 'completed');
            const missed = (l: Row[]) => l.filter(r => str(r.status) === 'missed').length;
            for (const [pid, l] of byProperty(list, ids)) {
                setRate(pid, 'sop_completion', done(l).length, l.length);
                setCmp(pid, 'sop_missed', l.length ? missed(l) : null);
                setCmp(pid, 'use_sop', l.length);
            }
            const completed = done(list);
            const sopDaily = dayBuckets(from, to, () => ({ on_time: 0, late: 0, missed: 0, pending: 0 }));
            for (const r of list) {
                const d = istDay(r.due_at);
                const b = d ? sopDaily.get(d) : undefined;
                if (!b) continue;
                const st = str(r.status);
                if (st === 'completed') { if (r.is_late === true) b.late++; else b.on_time++; }
                else if (st === 'missed') b.missed++;
                else b.pending++;
            }
            return {
                truncated: list.length >= ROW_CAP,
                scheduled: list.length,
                completed: completed.length,
                late: completed.filter(r => r.is_late === true).length,
                missed: missed(list),
                pending: list.filter(r => !['completed', 'missed'].includes(str(r.status))).length,
                completion_rate: pct(completed.length, list.length),
                templates,
                daily: Array.from(sopDaily.values()),
            };
        }),

        // ── PPM ──────────────────────────────────────────────────────────────
        timed('ppm', async () => {
            const [list, overdueRows] = await Promise.all([
                rows(supabaseAdmin.from('ppm_schedules').select('id, property_id, status, planned_date, done_date, system_name')
                    .in('property_id', ids)
                    .gte('planned_date', from).lte('planned_date', to).range(0, ROW_CAP - 1)),
                rows(supabaseAdmin.from('ppm_schedules').select('id, property_id')
                    .in('property_id', ids).is('done_date', null).lt('planned_date', today)
                    .not('status', 'in', '(done,completed,skipped,cancelled)').range(0, ROW_CAP - 1)),
            ]);
            const isDone = (r: Row) => ['done', 'completed'].includes(str(r.status));
            const overdueByProp = byProperty(overdueRows, ids);
            for (const [pid, l] of byProperty(list, ids)) {
                setRate(pid, 'ppm_compliance', l.filter(isDone).length, l.length);
                setCmp(pid, 'ppm_overdue', overdueByProp.get(pid)?.length || 0);
                setCmp(pid, 'use_ppm', l.length);
            }
            const st = (v: string) => list.filter(r => str(r.status) === v).length;
            const done = list.filter(isDone).length;
            const bySystem = new Map<string, { name: string; total: number; done: number }>();
            for (const r of list) {
                const k = str(r.system_name) || 'Unknown';
                const e = bySystem.get(k) || { name: k, total: 0, done: 0 };
                e.total++;
                if (isDone(r)) e.done++;
                bySystem.set(k, e);
            }
            return {
                total: list.length, done, pending: st('pending'), postponed: st('postponed'), skipped: st('skipped'),
                compliance: pct(done, list.length), overdue_now: overdueRows.length,
                by_system: Array.from(bySystem.values()).sort((a, b) => b.total - a.total).slice(0, 8),
            };
        }),

        // ── Electricity (main meters only, so sub-meters are not double counted) ─
        timed('electricity', async () => {
            const [list, meters] = await Promise.all([
                rows(supabaseAdmin.from('electricity_readings')
                    .select('id, property_id, reading_date, computed_units, final_units, computed_cost, meter:electricity_meters(id, name, meter_type)')
                    .in('property_id', ids)
                    .gte('reading_date', from).lte('reading_date', to).range(0, ROW_CAP - 1)),
                count(supabaseAdmin.from('electricity_meters').select('id', { count: 'exact', head: true }).in('property_id', ids)).catch(() => 0),
            ]);
            const units = (r: Row) => Math.max(0, num(r.final_units) || num(r.computed_units));
            const isMain = (r: Row) => str(rel(r.meter)?.meter_type) === 'main';
            const main = list.filter(isMain);
            for (const [pid, l] of byProperty(list, ids)) {
                const days = new Set(l.map(r => str(r.reading_date))).size;
                if (l.length) setRate(pid, 'elec_logging', days, dayCount); else setCmp(pid, 'elec_logging', null);
                setCmp(pid, 'use_elec', l.length);
                setCmp(pid, 'elec_units', l.length ? round1(l.filter(isMain).reduce((s, r) => s + units(r), 0)) : null);
            }
            const byMeter = new Map<string, { name: string; units: number; cost: number }>();
            for (const r of main) {
                const m = rel(r.meter);
                const k = str(m?.id) || 'unknown';
                const label = single ? (str(m?.name) || 'Unknown') : `${nameOf.get(str(r.property_id)) || ''} · ${str(m?.name) || 'Unknown'}`;
                const e = byMeter.get(k) || { name: label, units: 0, cost: 0 };
                e.units += units(r);
                e.cost += Math.max(0, num(r.computed_cost));
                byMeter.set(k, e);
            }
            const elecDaily = dayBuckets(from, to, () => ({ units: 0, cost: 0 }));
            for (const r of main) {
                const b = elecDaily.get(str(r.reading_date));
                if (!b) continue;
                b.units += units(r);
                b.cost += Math.max(0, num(r.computed_cost));
            }
            // In org scope "days logged" means days on which every reporting property logged.
            const daysLogged = single
                ? new Set(list.map(r => str(r.reading_date))).size
                : Math.min(...Array.from(byProperty(list, ids).values()).filter(l => l.length).map(l => new Set(l.map(r => str(r.reading_date))).size), dayCount);
            return {
                truncated: list.length >= ROW_CAP,
                readings: list.length, days_logged: Number.isFinite(daysLogged) ? daysLogged : 0, days_in_range: dayCount, meters,
                units: round1(main.reduce((s, r) => s + units(r), 0)),
                cost: Math.round(main.reduce((s, r) => s + Math.max(0, num(r.computed_cost)), 0)),
                unit_label: 'kVAh',
                daily: Array.from(elecDaily.values()).map(d => ({ ...d, units: round1(d.units), cost: Math.round(d.cost) })),
                by_meter: Array.from(byMeter.values()).map(m => ({ ...m, units: round1(m.units), cost: Math.round(m.cost) })).sort((a, b) => b.units - a.units).slice(0, 12),
            };
        }),

        // ── Diesel ───────────────────────────────────────────────────────────
        timed('diesel', async () => {
            const list = await rows(
                supabaseAdmin.from('diesel_readings')
                    .select('id, property_id, reading_date, computed_consumed_litres, computed_cost, generator:generators(id, name)')
                    .in('property_id', ids)
                    .gte('reading_date', from).lte('reading_date', to).range(0, ROW_CAP - 1),
            );
            const litres = (r: Row) => Math.max(0, num(r.computed_consumed_litres));
            for (const [pid, l] of byProperty(list, ids)) {
                if (l.length) setRate(pid, 'diesel_logging', new Set(l.map(r => str(r.reading_date))).size, dayCount); else setCmp(pid, 'diesel_logging', null);
                setCmp(pid, 'use_diesel', l.length);
                setCmp(pid, 'diesel_litres', l.length ? round1(l.reduce((s, r) => s + litres(r), 0)) : null);
            }
            const byGen = new Map<string, { name: string; litres: number; cost: number }>();
            for (const r of list) {
                const g = rel(r.generator);
                const k = str(g?.id) || 'unknown';
                const label = single ? (str(g?.name) || 'Unknown') : `${nameOf.get(str(r.property_id)) || ''} · ${str(g?.name) || 'Unknown'}`;
                const e = byGen.get(k) || { name: label, litres: 0, cost: 0 };
                e.litres += litres(r);
                e.cost += Math.max(0, num(r.computed_cost));
                byGen.set(k, e);
            }
            const dieselDaily = dayBuckets(from, to, () => ({ litres: 0, cost: 0 }));
            for (const r of list) {
                const b = dieselDaily.get(str(r.reading_date));
                if (!b) continue;
                b.litres += litres(r);
                b.cost += Math.max(0, num(r.computed_cost));
            }
            const daysLogged = single
                ? new Set(list.map(r => str(r.reading_date))).size
                : Math.min(...Array.from(byProperty(list, ids).values()).filter(l => l.length).map(l => new Set(l.map(r => str(r.reading_date))).size), dayCount);
            return {
                truncated: list.length >= ROW_CAP,
                readings: list.length, days_logged: Number.isFinite(daysLogged) ? daysLogged : 0, days_in_range: dayCount,
                daily: Array.from(dieselDaily.values()).map(d => ({ ...d, litres: round1(d.litres), cost: Math.round(d.cost) })),
                litres: round1(list.reduce((s, r) => s + litres(r), 0)),
                cost: Math.round(list.reduce((s, r) => s + Math.max(0, num(r.computed_cost)), 0)),
                by_generator: Array.from(byGen.values()).map(g => ({ ...g, litres: round1(g.litres), cost: Math.round(g.cost) })).sort((a, b) => b.litres - a.litres).slice(0, 12),
            };
        }),

        // ── Water ────────────────────────────────────────────────────────────
        timed('water', async () => {
            const sources = await rows(
                supabaseAdmin.from('water_sources').select('id, name, property_id').in('property_id', ids).range(0, 999),
            );
            const sourceIds = sources.map(s => str(s.id)).filter(Boolean);
            const list = sourceIds.length ? await rows(
                supabaseAdmin.from('water_readings').select('id, reading_date, quantity, computed_cost, source_id')
                    .in('source_id', sourceIds)
                    .gte('reading_date', from).lte('reading_date', to).range(0, ROW_CAP - 1),
            ) : [];
            const sourceProp = new Map(sources.map(s => [str(s.id), str(s.property_id)]));
            const names = new Map(sources.map(s => [str(s.id), str(s.name) || 'Source']));
            const withProp: Row[] = list.map(r => ({ ...r, property_id: sourceProp.get(str(r.source_id)) || '' }));
            const sourcesByProp = byProperty(sources, ids);
            for (const [pid, l] of byProperty(withProp, ids)) {
                if (sourcesByProp.get(pid)?.length) setRate(pid, 'water_logging', new Set(l.map(r => str(r.reading_date))).size, dayCount); else setCmp(pid, 'water_logging', null);
                setCmp(pid, 'use_water', l.length);
            }
            const bySource = new Map<string, { name: string; quantity: number; cost: number }>();
            for (const r of withProp) {
                const k = str(r.source_id);
                const label = single ? (names.get(k) || 'Source') : `${nameOf.get(str(r.property_id)) || ''} · ${names.get(k) || 'Source'}`;
                const e = bySource.get(k) || { name: label, quantity: 0, cost: 0 };
                e.quantity += Math.max(0, num(r.quantity));
                e.cost += Math.max(0, num(r.computed_cost));
                bySource.set(k, e);
            }
            const waterDaily = dayBuckets(from, to, () => ({ quantity: 0, cost: 0 }));
            for (const r of list) {
                const b = waterDaily.get(str(r.reading_date));
                if (!b) continue;
                b.quantity += Math.max(0, num(r.quantity));
                b.cost += Math.max(0, num(r.computed_cost));
            }
            const daysLogged = single
                ? new Set(list.map(r => str(r.reading_date))).size
                : Math.min(...Array.from(byProperty(withProp, ids).values()).filter(l => l.length).map(l => new Set(l.map(r => str(r.reading_date))).size), dayCount);
            return {
                truncated: list.length >= ROW_CAP,
                sources: sources.length, readings: list.length,
                daily: Array.from(waterDaily.values()).map(d => ({ ...d, quantity: round1(d.quantity), cost: Math.round(d.cost) })),
                days_logged: Number.isFinite(daysLogged) ? daysLogged : 0, days_in_range: dayCount,
                quantity: round1(list.reduce((s, r) => s + Math.max(0, num(r.quantity)), 0)),
                cost: Math.round(list.reduce((s, r) => s + Math.max(0, num(r.computed_cost)), 0)),
                by_source: Array.from(bySource.values()).map(s => ({ ...s, quantity: round1(s.quantity), cost: Math.round(s.cost) })).sort((a, b) => b.quantity - a.quantity).slice(0, 12),
            };
        }),

        // ── Stock ────────────────────────────────────────────────────────────
        timed('stock', async () => {
            const [items, moves] = await Promise.all([
                rows(supabaseAdmin.from('stock_items').select('id, property_id, name, quantity, min_threshold').in('property_id', ids).range(0, ROW_CAP - 1)),
                rows(supabaseAdmin.from('stock_movements').select('id, property_id, action, quantity_change, created_at')
                    .in('property_id', ids)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive).range(0, ROW_CAP - 1)),
            ]);
            const isLow = (i: Row) => num(i.quantity) < (num(i.min_threshold) || 10);
            const itemsByProp = byProperty(items, ids);
            for (const [pid, l] of byProperty(moves, ids)) {
                const its = itemsByProp.get(pid) || [];
                setCmp(pid, 'stock_low', its.length ? its.filter(isLow).length : null);
                if (its.length) setRate(pid, 'stock_activity', new Set(l.map(m => istDay(m.created_at))).size, dayCount); else setCmp(pid, 'stock_activity', null);
                setCmp(pid, 'use_stock', l.length);
            }
            const low = items.filter(isLow);
            const stockDaily = dayBuckets(from, to, () => ({ added: 0, removed: 0 }));
            for (const m of moves) {
                const b = stockDaily.get(istDay(m.created_at) || '');
                if (!b) continue;
                if (str(m.action) === 'add') b.added += num(m.quantity_change);
                else if (str(m.action) === 'remove') b.removed += Math.abs(num(m.quantity_change));
            }
            return {
                truncated: items.length >= ROW_CAP || moves.length >= ROW_CAP,
                daily: Array.from(stockDaily.values()),
                items: items.length,
                low_stock: low.length,
                low_stock_items: low.slice(0, 8).map(i => ({ name: single ? str(i.name) : `${nameOf.get(str(i.property_id)) || ''} · ${str(i.name)}`, quantity: num(i.quantity), min: num(i.min_threshold) || 10 })),
                movements: moves.length,
                added: moves.filter(m => str(m.action) === 'add').reduce((s, m) => s + num(m.quantity_change), 0),
                removed: Math.abs(moves.filter(m => str(m.action) === 'remove').reduce((s, m) => s + num(m.quantity_change), 0)),
                days_with_movement: new Set(moves.map(m => istDay(m.created_at))).size,
            };
        }),

        // ── Assets ───────────────────────────────────────────────────────────
        timed('assets', async () => {
            const [list, events] = await Promise.all([
                rows(supabaseAdmin.from('assets').select('id, property_id, status, warranty_end, amc_required, purchase_cost, category:asset_categories(name)')
                    .in('property_id', ids).is('deleted_at', null).range(0, ROW_CAP - 1)),
                count(supabaseAdmin.from('asset_events').select('id', { count: 'exact', head: true })
                    .in('property_id', ids).gte('occurred_at', fromTs).lt('occurred_at', toTsExclusive)).catch(() => 0),
            ]);
            for (const [pid, l] of byProperty(list, ids)) { setCmp(pid, 'assets_repair', l.length ? l.filter(a => str(a.status) === 'under_repair').length : null); setCmp(pid, 'use_assets', l.length); }
            const in90 = addDays(today, 90);
            return {
                truncated: list.length >= ROW_CAP,
                total: list.length,
                active: list.filter(a => str(a.status) === 'active').length,
                under_repair: list.filter(a => str(a.status) === 'under_repair').length,
                inactive: list.filter(a => ['inactive', 'decommissioned', 'disposed'].includes(str(a.status))).length,
                warranty_expiring_90d: list.filter(a => str(a.warranty_end) >= today && str(a.warranty_end) <= in90).length,
                amc_required: list.filter(a => a.amc_required === true).length,
                purchase_value: Math.round(list.reduce((s, a) => s + num(a.purchase_cost), 0)),
                events_in_range: events,
                by_category: countBy(list, a => str(rel(a.category)?.name) || 'Uncategorised').slice(0, 8),
            };
        }),

        // ── AMC contracts ────────────────────────────────────────────────────
        timed('amc', async () => {
            const list = await rows(
                supabaseAdmin.from('amc_contracts').select('id, property_id, system_name, vendor_name, contract_end_date, contract_value, status')
                    .in('property_id', ids).range(0, ROW_CAP - 1),
            );
            const in60 = addDays(today, 60);
            const isExpired = (c: Row) => str(c.contract_end_date) < today || str(c.status) === 'expired';
            const isExpiring = (c: Row) => str(c.contract_end_date) >= today && str(c.contract_end_date) <= in60;
            for (const [pid, l] of byProperty(list, ids)) setCmp(pid, 'amc_expiring', l.length ? l.filter(c => isExpired(c) || isExpiring(c)).length : null);
            const expiring = list.filter(isExpiring);
            return {
                total: list.length,
                active: list.filter(c => !isExpired(c)).length,
                expired: list.filter(isExpired).length,
                expiring_60d: expiring.length,
                total_value: Math.round(list.reduce((s, c) => s + num(c.contract_value), 0)),
                expiring_list: expiring.slice(0, 6).map(c => ({ system: single ? str(c.system_name) : `${nameOf.get(str(c.property_id)) || ''} · ${str(c.system_name)}`, vendor: str(c.vendor_name), ends: str(c.contract_end_date) })),
            };
        }),

        // ── Visitors ─────────────────────────────────────────────────────────
        timed('visitors', async () => {
            const base = () => supabaseAdmin.from('visitor_logs').select('id', { count: 'exact', head: true })
                .in('property_id', ids).gte('checkin_time', fromTs).lt('checkin_time', toTsExclusive);
            const [total, inside, out, logs] = await Promise.all([
                count(base()), count(base().is('checkout_time', null)), count(base().not('checkout_time', 'is', null)),
                rows(supabaseAdmin.from('visitor_logs').select('id, property_id, checkin_time, checkout_time')
                    .in('property_id', ids).gte('checkin_time', fromTs).lt('checkin_time', toTsExclusive)
                    .order('checkin_time', { ascending: true }).range(0, ROW_CAP - 1)),
            ]);
            for (const [pid, l] of byProperty(logs, ids)) {
                setCmp(pid, 'visitors_total', l.length);
                setCmp(pid, 'use_visitors', l.length);
                setCmp(pid, 'visitors_inside', l.filter(v => !v.checkout_time).length);
            }
            const visitorDaily = dayBuckets(from, to, () => ({ visitors: 0 }));
            const byWeekday = Array<number>(7).fill(0);
            for (const l of logs) {
                const b = visitorDaily.get(istDay(l.checkin_time) || '');
                if (b) b.visitors++;
                const slot = istSlot(l.checkin_time);
                if (slot) byWeekday[slot.weekday]++;
            }
            return {
                truncated: logs.length >= ROW_CAP,
                total, checked_in: inside, checked_out: out, per_day: dayCount > 0 ? round1(total / dayCount) : 0,
                daily: Array.from(visitorDaily.values()), by_weekday: byWeekday,
            };
        }),

        // ── Meeting rooms ────────────────────────────────────────────────────
        timed('meeting_rooms', async () => {
            const [list, roomsCount] = await Promise.all([
                rows(supabaseAdmin.from('meeting_room_bookings').select('id, property_id, status, booking_date, start_time, end_time, meeting_room_id, meeting_room:meeting_rooms(name)')
                    .in('property_id', ids)
                    .gte('booking_date', from).lte('booking_date', to).range(0, ROW_CAP - 1)),
                count(supabaseAdmin.from('meeting_rooms').select('id', { count: 'exact', head: true }).in('property_id', ids)).catch(() => 0),
            ]);
            const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
            const hoursOf = (b: Row) => { const d = mins(str(b.end_time)) - mins(str(b.start_time)); return d > 0 ? d / 60 : 0; };
            const confirmed = list.filter(b => str(b.status) === 'confirmed');
            for (const [pid, l] of byProperty(confirmed, ids)) setCmp(pid, 'rooms_hours', round1(l.reduce((s, b) => s + hoursOf(b), 0)));
            for (const [pid, l] of byProperty(list, ids)) setCmp(pid, 'use_rooms', l.length);
            const roomDaily = dayBuckets(from, to, () => ({ bookings: 0, hours: 0 }));
            const byRoom = new Map<string, { name: string; bookings: number; hours: number }>();
            for (const b of confirmed) {
                const h = hoursOf(b);
                const day = roomDaily.get(str(b.booking_date));
                if (day) { day.bookings++; day.hours += h; }
                const k = str(b.meeting_room_id) || 'unknown';
                const label = single ? (str(rel(b.meeting_room)?.name) || 'Room') : `${nameOf.get(str(b.property_id)) || ''} · ${str(rel(b.meeting_room)?.name) || 'Room'}`;
                const e = byRoom.get(k) || { name: label, bookings: 0, hours: 0 };
                e.bookings++; e.hours += h;
                byRoom.set(k, e);
            }
            return {
                truncated: list.length >= ROW_CAP,
                daily: Array.from(roomDaily.values()).map(d => ({ ...d, hours: round1(d.hours) })),
                by_room: Array.from(byRoom.values()).map(r => ({ ...r, hours: round1(r.hours) })).sort((a, b) => b.hours - a.hours).slice(0, 12),
                rooms: roomsCount, bookings: list.length, confirmed: confirmed.length,
                cancelled: list.filter(b => str(b.status) === 'cancelled').length,
                hours_booked: round1(confirmed.reduce((s, b) => s + hoursOf(b), 0)),
                by_status: countBy(list, b => str(b.status)),
            };
        }),

        // ── Petty cash ───────────────────────────────────────────────────────
        timed('petty_cash', async () => {
            const list = await rows(
                supabaseAdmin.from('petty_cash_requests').select('id, property_id, status, request_type, amount_requested, approved_amount, paid_amount, created_at')
                    .in('property_id', ids)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive).range(0, ROW_CAP - 1),
            );
            const sum = (l: Row[], k: string) => Math.round(l.reduce((s, r) => s + num(r[k]), 0));
            const pending = (l: Row[]) => l.filter(r => ['submitted', 'sent_back'].includes(str(r.status))).length;
            for (const [pid, l] of byProperty(list, ids)) {
                setCmp(pid, 'petty_paid', l.length ? sum(l, 'paid_amount') : null);
                setCmp(pid, 'petty_pending', l.length ? pending(l) : null);
                setCmp(pid, 'use_petty', l.length);
            }
            return {
                requests: list.length,
                requested_amount: sum(list, 'amount_requested'),
                approved_amount: sum(list, 'approved_amount'),
                paid_amount: sum(list, 'paid_amount'),
                pending_approval: pending(list),
                rejected: list.filter(r => str(r.status) === 'rejected').length,
                closed: list.filter(r => str(r.status) === 'closed').length,
                by_status: countBy(list, r => str(r.status).replace(/_/g, ' ')),
            };
        }),

        // ── Procurement (material requests) ──────────────────────────────────
        timed('procurement', async () => {
            const list = await rows(
                supabaseAdmin.from('material_requests').select('id, property_id, status, total_amount, created_at')
                    .in('property_id', ids)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive).range(0, ROW_CAP - 1),
            );
            const pending = (l: Row[]) => l.filter(r => ['pending', 'vendor_arranged'].includes(str(r.status))).length;
            for (const [pid, l] of byProperty(list, ids)) { setCmp(pid, 'proc_pending', l.length ? pending(l) : null); setCmp(pid, 'use_proc', l.length); }
            return {
                requests: list.length,
                pending: pending(list),
                approved: list.filter(r => ['approved', 'ordered'].includes(str(r.status))).length,
                delivered: list.filter(r => ['delivered', 'completed'].includes(str(r.status))).length,
                rejected: list.filter(r => ['rejected', 'cancelled'].includes(str(r.status))).length,
                total_amount: Math.round(list.reduce((s, r) => s + num(r.total_amount), 0)),
                by_status: countBy(list, r => str(r.status).replace(/_/g, ' ')),
            };
        }),

        // ── Monthly requisitions ─────────────────────────────────────────────
        timed('requisitions', async () => {
            const months: string[] = [];
            for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
                months.push(m);
                const [y, mm] = m.split('-').map(Number);
                m = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7);
            }
            const years = Array.from(new Set(months.map(m => Number(m.slice(0, 4)))));
            const list = await rows(
                supabaseAdmin.from('property_monthly_requisitions').select('id, property_id, requisition_month, requisition_year, status')
                    .in('property_id', ids).in('requisition_year', years).range(0, ROW_CAP - 1),
            );
            const monthOf = (r: Row) => `${r.requisition_year}-${String(r.requisition_month).padStart(2, '0')}`;
            const inRange = list.filter(r => months.includes(monthOf(r)));
            for (const [pid, l] of byProperty(inRange, ids)) { setRate(pid, 'req_submitted', Math.min(l.length, months.length), months.length); setCmp(pid, 'use_req', l.length); }
            const missing: string[] = [];
            for (const [pid, l] of byProperty(inRange, ids)) {
                const have = new Set(l.map(monthOf));
                for (const m of months) if (!have.has(m)) missing.push(single ? m : `${nameOf.get(pid) || ''} ${m}`);
            }
            return {
                months_in_range: months.length,
                expected: months.length * ids.length,
                submitted: inRange.length,
                acknowledged: inRange.filter(r => str(r.status) === 'acknowledged').length,
                missing_months: missing.slice(0, 24),
            };
        }),

        // ── Roster ───────────────────────────────────────────────────────────
        timed('roster', async () => {
            const list = await rows(
                supabaseAdmin.from('staff_rosters').select('id, property_id, user_id, roster_date, is_reliever')
                    .in('property_id', ids)
                    .gte('roster_date', from).lte('roster_date', to).range(0, ROW_CAP - 1),
            );
            for (const [pid, l] of byProperty(list, ids)) { setRate(pid, 'roster_coverage', new Set(l.map(r => str(r.roster_date))).size, dayCount); setCmp(pid, 'use_roster', l.length); }
            const daysCovered = single
                ? new Set(list.map(r => str(r.roster_date))).size
                : Math.min(...Array.from(byProperty(list, ids).values()).map(l => new Set(l.map(r => str(r.roster_date))).size));
            return {
                truncated: list.length >= ROW_CAP,
                shifts: list.length,
                staff_rostered: new Set(list.map(r => str(r.user_id))).size,
                reliever_shifts: list.filter(r => r.is_reliever === true).length,
                days_covered: Number.isFinite(daysCovered) ? daysCovered : 0,
                days_in_range: dayCount,
            };
        }),

        // ── Task manager (tasks assigned to the team) ────────────────────────
        timed('tasks', async () => {
            const { memberIds, byMember } = await teamPromise;
            if (!memberIds.length) return { total: 0, completed: 0, in_progress: 0, pending: 0, completion_rate: null as number | null };
            const list = await rows(
                supabaseAdmin.from('task_assignments').select('id, status, assigned_date, employee_id')
                    .in('employee_id', memberIds)
                    .gte('assigned_date', from).lte('assigned_date', to).range(0, ROW_CAP - 1),
            );
            const done = (l: Row[]) => l.filter(r => str(r.status) === 'completed').length;
            for (const [pid, l] of byMember(list, 'employee_id')) { setRate(pid, 'tasks_completion', done(l), l.length); setCmp(pid, 'use_tasks', l.length); }
            return {
                truncated: list.length >= ROW_CAP,
                total: list.length, completed: done(list),
                in_progress: list.filter(r => str(r.status) === 'in_progress').length,
                pending: list.filter(r => str(r.status) === 'pending').length,
                completion_rate: pct(done(list), list.length),
            };
        }),

        // ── Statutory / internal audit (current state, not range bound) ──────
        timed('audit', async () => {
            const list = await rows(
                supabaseAdmin.from('property_audit_submissions').select('id, property_id, status').in('property_id', ids).range(0, ROW_CAP - 1),
            );
            const s = (l: Row[], v: string) => l.filter(r => str(r.status) === v).length;
            const compliance = (l: Row[]) => pct(s(l, 'compliant'), l.length - s(l, 'not_applicable'));
            for (const [pid, l] of byProperty(list, ids)) { setRate(pid, 'audit_compliance', s(l, 'compliant'), l.length - s(l, 'not_applicable')); setCmp(pid, 'use_audit', l.length); }
            return {
                items: list.length, compliant: s(list, 'compliant'), pending_review: s(list, 'pending_review'), missing: s(list, 'missing'),
                not_applicable: s(list, 'not_applicable'), compliance: compliance(list),
            };
        }),

        // ── Team ─────────────────────────────────────────────────────────────
        timed('team', async () => {
            const { activeTeam, memberIds } = await teamPromise;
            for (const [pid, l] of byProperty(activeTeam, ids)) setCmp(pid, 'team_members', l.length);
            return {
                members: memberIds.length,
                by_role: countBy(activeTeam, r => str(r.role).replace(/_/g, ' ') || 'member'),
            };
        }),
    ]);

    const first = properties[0];
    const body = {
        scope: single ? 'property' : 'organization',
        property: single
            ? { id: first.id, name: first.name, code: first.code, address: first.address, city: first.city, is_active: first.is_active }
            : { id: orgId, name: scopeName, code: null, address: null, city: null, is_active: true },
        properties: properties.map(p => ({ id: p.id, name: p.name, city: p.city })),
        range: { from, to, days: dayCount },
        generated_at: new Date().toISOString(),
        sections: {
            tickets, guest_requests: guestRequests, sop, ppm, electricity, diesel, water, stock, assets, amc,
            visitors, meeting_rooms: meetingRooms, petty_cash: pettyCash, procurement, requisitions, roster, tasks, audit, team,
        },
        comparative: single ? null : { metrics: COMPARATIVE_METRICS, values: comparative },
    };
    cacheSet(cacheKey, body, timings);
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, max-age=60', 'Server-Timing': serverTiming(timings, Date.now() - t0, false) } });
}
