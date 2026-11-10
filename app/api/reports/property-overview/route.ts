import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { guardProperty } from '@/backend/lib/auth/callerAccess';
import { isMissingRelation } from '@/backend/lib/commandCenter/access';

/**
 * GET /api/reports/property-overview?propertyId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * One report for one property across every service and module it runs: tickets,
 * guest requests, HR grievances, SOP checklists, PPM, electricity, diesel, water,
 * stock, assets, AMC, visitors, meeting rooms, petty cash, procurement, monthly
 * requisitions, roster, tasks, statutory audit and the property team.
 *
 * Reads only. Every section stands alone: a missing table or column marks that
 * section `available: false` instead of failing the whole report, so a property
 * that does not run a module still gets the rest. Days are IST calendar days.
 */

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
type DbError = { code?: string; message?: string } | null;

const IST_OFFSET = '+05:30';
const IST_OFFSET_MS = 330 * 60 * 1000;
const MAX_DAYS = 366;
const ROW_CAP = 5000;

const TICKET_CLOSED = ['resolved', 'closed', 'satisfied', 'completed'];
const HR_CLOSED = ['resolved', 'closed', 'cancelled'];

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
/** IST weekday (0 = Sunday) and hour of a timestamp, for the "when do requests come in" heatmap. */
function istSlot(v: unknown): { weekday: number; hour: number } | null {
    if (typeof v !== 'string' || !v) return null;
    const t = Date.parse(v);
    if (isNaN(t)) return null;
    const d = new Date(t + IST_OFFSET_MS);
    return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
}
/** A joined one-to-one relation comes back as an object or a one-element array. */
function rel(v: unknown): Row | null {
    if (Array.isArray(v)) return (v[0] as Row) || null;
    return v && typeof v === 'object' ? (v as Row) : null;
}

type Section<T> = ({ available: true; truncated?: boolean } & T) | { available: false; reason: string };

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

/** Throws on a query error so `section` can classify it. Caps at ROW_CAP rows. */
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

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get('propertyId');
    if (!propertyId) return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });

    const denied = await guardProperty(request, propertyId);
    if (denied) return denied;

    const today = todayIst();
    const toParam = searchParams.get('to');
    const fromParam = searchParams.get('from');
    const to = isDay(toParam) ? toParam : today;
    const from = isDay(fromParam) ? fromParam : `${to.slice(0, 7)}-01`;
    if (from > to) return NextResponse.json({ error: 'from must not be after to' }, { status: 400 });
    const dayCount = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (dayCount > MAX_DAYS) return NextResponse.json({ error: `Range must be at most ${MAX_DAYS} days` }, { status: 400 });

    // Timestamp columns: IST midnight of `from` up to (not including) IST midnight after `to`.
    const fromTs = `${from}T00:00:00${IST_OFFSET}`;
    const toTsExclusive = `${addDays(to, 1)}T00:00:00${IST_OFFSET}`;
    const nowIso = new Date().toISOString();

    const { data: property, error: propErr } = await supabaseAdmin
        .from('properties')
        .select('id, name, code, address, city, organization_id, is_active')
        .eq('id', propertyId)
        .maybeSingle();
    if (propErr || !property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    const orgId = String(property.organization_id);

    // Property team: who belongs to this property. Reused by HR and tasks, which carry no property_id.
    const teamRows = await rows(
        supabaseAdmin.from('property_memberships').select('user_id, role, is_active').eq('property_id', propertyId).range(0, ROW_CAP - 1),
    ).catch(() => [] as Row[]);
    const activeTeam = teamRows.filter(r => r.is_active !== false);
    const memberIds = Array.from(new Set(activeTeam.map(r => str(r.user_id)).filter(Boolean)));

    const [
        tickets, guestRequests, hr, sop, ppm, electricity, diesel, water, stock, assets, amc,
        visitors, meetingRooms, pettyCash, procurement, requisitions, roster, tasks, audit, team,
    ] = await Promise.all([
        // ── Tickets (requests) ───────────────────────────────────────────────
        section('tickets', async () => {
            const list = await rows(
                supabaseAdmin.from('tickets')
                    .select('id, status, priority, category, created_at, resolved_at, internal, floor_number, sla_breached, sla_deadline, issue_category:category_id(name)')
                    .eq('property_id', propertyId)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive)
                    .order('created_at', { ascending: true })
                    .range(0, ROW_CAP - 1),
            );
            const openNow = await count(
                supabaseAdmin.from('tickets').select('id', { count: 'exact', head: true })
                    .eq('property_id', propertyId)
                    .not('status', 'in', `(${[...TICKET_CLOSED, 'cancelled', 'rejected', 'duplicate'].join(',')})`),
            );
            const closed = list.filter(t => TICKET_CLOSED.includes(str(t.status)));
            const pending = list.filter(t => str(t.status) === 'pending_validation');
            const open = list.filter(t => !TICKET_CLOSED.includes(str(t.status)) && str(t.status) !== 'pending_validation');
            const hours = closed
                .map(t => (Date.parse(str(t.resolved_at)) - Date.parse(str(t.created_at))) / 3_600_000)
                .filter(h => Number.isFinite(h) && h >= 0);
            const breached = list.filter(t => t.sla_breached === true || (str(t.sla_deadline) && str(t.sla_deadline) < nowIso && !TICKET_CLOSED.includes(str(t.status)))).length;

            const daily = dayBuckets(from, to, () => ({ raised: 0, closed: 0 }));
            // 7 weekdays x 24 hours, IST, counting when tickets were raised.
            const heatmap: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
            for (const t of list) {
                const r = istDay(t.created_at);
                if (r && daily.has(r)) daily.get(r)!.raised++;
                const c = istDay(t.resolved_at);
                if (c && daily.has(c) && TICKET_CLOSED.includes(str(t.status))) daily.get(c)!.closed++;
                const slot = istSlot(t.created_at);
                if (slot) heatmap[slot.weekday][slot.hour]++;
            }
            // Time to close, bucketed, for the resolution-speed distribution.
            const buckets = [
                { name: 'Under 4 h', max: 4 }, { name: '4 to 24 h', max: 24 }, { name: '1 to 3 d', max: 72 },
                { name: '3 to 7 d', max: 168 }, { name: 'Over 7 d', max: Infinity },
            ];
            const resolution_buckets = buckets.map(b => ({ name: b.name, count: 0 }));
            for (const h of hours) {
                const i = buckets.findIndex(b => h < b.max);
                resolution_buckets[i === -1 ? buckets.length - 1 : i].count++;
            }
            return {
                truncated: list.length >= ROW_CAP,
                total: list.length,
                open: open.length,
                closed: closed.length,
                pending_validation: pending.length,
                internal: list.filter(t => t.internal === true).length,
                open_now: openNow,
                sla_breached: breached,
                closure_rate: pct(closed.length, list.length),
                avg_resolution_hours: hours.length ? round1(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
                by_category: countBy(list, t => str(rel(t.issue_category)?.name) || str(t.category)).slice(0, 8),
                by_priority: countBy(list, t => str(t.priority) || 'unset'),
                by_status: countBy(list, t => str(t.status)),
                by_floor: countBy(list, t => (t.floor_number === null || t.floor_number === undefined) ? 'Unspecified' : `Floor ${t.floor_number}`).slice(0, 10),
                daily: Array.from(daily.values()),
                heatmap,
                resolution_buckets,
            };
        }),

        // ── Guest requests (QR walk-in requests) ─────────────────────────────
        section('guest_requests', async () => {
            const list = await rows(
                supabaseAdmin.from('guest_requests').select('id, status, ai_category, created_at')
                    .eq('property_id', propertyId)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive).range(0, ROW_CAP - 1),
            );
            const s = (v: string) => list.filter(r => str(r.status).toUpperCase() === v).length;
            return {
                total: list.length, pending: s('PENDING'), in_progress: s('IN_PROGRESS'), resolved: s('RESOLVED'),
                by_category: countBy(list, r => str(r.ai_category) || 'Uncategorised').slice(0, 6),
            };
        }),

        // ── HR grievances raised by this property's people ───────────────────
        section('hr_tickets', async () => {
            if (!memberIds.length) return { total: 0, open: 0, resolved: 0, escalated: 0, by_type: [] as { name: string; count: number }[], by_priority: [] as { name: string; count: number }[] };
            const list = await rows(
                supabaseAdmin.from('hr_tickets').select('id, status, ticket_type, priority, created_at')
                    .eq('organization_id', orgId)
                    .in('raised_by_user_id', memberIds)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive).range(0, ROW_CAP - 1),
            );
            return {
                total: list.length,
                open: list.filter(r => !HR_CLOSED.includes(str(r.status))).length,
                resolved: list.filter(r => HR_CLOSED.includes(str(r.status))).length,
                escalated: list.filter(r => str(r.status) === 'escalated').length,
                by_type: countBy(list, r => str(r.ticket_type).replace(/_/g, ' ')),
                by_priority: countBy(list, r => str(r.priority)),
            };
        }),

        // ── SOP checklists ───────────────────────────────────────────────────
        section('sop', async () => {
            const list = await rows(
                supabaseAdmin.from('sop_completions').select('id, status, is_late, due_at, template_id')
                    .eq('property_id', propertyId)
                    .gte('due_at', fromTs).lt('due_at', toTsExclusive).range(0, ROW_CAP - 1),
            );
            const completed = list.filter(r => str(r.status) === 'completed');
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
            const templates = await count(
                supabaseAdmin.from('sop_templates').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
            ).catch(() => 0);
            return {
                truncated: list.length >= ROW_CAP,
                scheduled: list.length,
                completed: completed.length,
                late: completed.filter(r => r.is_late === true).length,
                missed: list.filter(r => str(r.status) === 'missed').length,
                pending: list.filter(r => !['completed', 'missed'].includes(str(r.status))).length,
                completion_rate: pct(completed.length, list.length),
                templates,
                daily: Array.from(sopDaily.values()),
            };
        }),

        // ── PPM ──────────────────────────────────────────────────────────────
        section('ppm', async () => {
            const list = await rows(
                supabaseAdmin.from('ppm_schedules').select('id, status, planned_date, done_date, system_name')
                    .eq('property_id', propertyId)
                    .gte('planned_date', from).lte('planned_date', to).range(0, ROW_CAP - 1),
            );
            const overdueNow = await count(
                supabaseAdmin.from('ppm_schedules').select('id', { count: 'exact', head: true })
                    .eq('property_id', propertyId).is('done_date', null).lt('planned_date', today)
                    .not('status', 'in', '(done,completed,skipped,cancelled)'),
            );
            const st = (v: string) => list.filter(r => str(r.status) === v).length;
            const done = list.filter(r => ['done', 'completed'].includes(str(r.status))).length;
            const bySystem = new Map<string, { name: string; total: number; done: number }>();
            for (const r of list) {
                const k = str(r.system_name) || 'Unknown';
                const e = bySystem.get(k) || { name: k, total: 0, done: 0 };
                e.total++;
                if (['done', 'completed'].includes(str(r.status))) e.done++;
                bySystem.set(k, e);
            }
            return {
                total: list.length, done, pending: st('pending'), postponed: st('postponed'), skipped: st('skipped'),
                compliance: pct(done, list.length), overdue_now: overdueNow,
                by_system: Array.from(bySystem.values()).sort((a, b) => b.total - a.total).slice(0, 8),
            };
        }),

        // ── Electricity (main meters only, so sub-meters are not double counted) ─
        section('electricity', async () => {
            const list = await rows(
                supabaseAdmin.from('electricity_readings')
                    .select('id, reading_date, computed_units, final_units, computed_cost, meter:electricity_meters(id, name, meter_type)')
                    .eq('property_id', propertyId)
                    .gte('reading_date', from).lte('reading_date', to).range(0, ROW_CAP - 1),
            );
            const main = list.filter(r => str(rel(r.meter)?.meter_type) === 'main');
            const units = (r: Row) => Math.max(0, num(r.final_units) || num(r.computed_units));
            const byMeter = new Map<string, { name: string; units: number; cost: number }>();
            for (const r of main) {
                const m = rel(r.meter);
                const k = str(m?.id) || 'unknown';
                const e = byMeter.get(k) || { name: str(m?.name) || 'Unknown', units: 0, cost: 0 };
                e.units += units(r);
                e.cost += Math.max(0, num(r.computed_cost));
                byMeter.set(k, e);
            }
            const daysLogged = new Set(list.map(r => str(r.reading_date))).size;
            const elecDaily = dayBuckets(from, to, () => ({ units: 0, cost: 0 }));
            for (const r of main) {
                const b = elecDaily.get(str(r.reading_date));
                if (!b) continue;
                b.units += units(r);
                b.cost += Math.max(0, num(r.computed_cost));
            }
            const meters = await count(
                supabaseAdmin.from('electricity_meters').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
            ).catch(() => byMeter.size);
            return {
                readings: list.length, days_logged: daysLogged, days_in_range: dayCount, meters,
                units: round1(main.reduce((s, r) => s + units(r), 0)),
                cost: Math.round(main.reduce((s, r) => s + Math.max(0, num(r.computed_cost)), 0)),
                unit_label: 'kVAh',
                daily: Array.from(elecDaily.values()).map(d => ({ ...d, units: round1(d.units), cost: Math.round(d.cost) })),
                by_meter: Array.from(byMeter.values()).map(m => ({ ...m, units: round1(m.units), cost: Math.round(m.cost) })).sort((a, b) => b.units - a.units),
            };
        }),

        // ── Diesel ───────────────────────────────────────────────────────────
        section('diesel', async () => {
            const list = await rows(
                supabaseAdmin.from('diesel_readings')
                    .select('id, reading_date, computed_consumed_litres, computed_cost, generator:generators(id, name)')
                    .eq('property_id', propertyId)
                    .gte('reading_date', from).lte('reading_date', to).range(0, ROW_CAP - 1),
            );
            const byGen = new Map<string, { name: string; litres: number; cost: number }>();
            for (const r of list) {
                const g = rel(r.generator);
                const k = str(g?.id) || 'unknown';
                const e = byGen.get(k) || { name: str(g?.name) || 'Unknown', litres: 0, cost: 0 };
                e.litres += Math.max(0, num(r.computed_consumed_litres));
                e.cost += Math.max(0, num(r.computed_cost));
                byGen.set(k, e);
            }
            const dieselDaily = dayBuckets(from, to, () => ({ litres: 0, cost: 0 }));
            for (const r of list) {
                const b = dieselDaily.get(str(r.reading_date));
                if (!b) continue;
                b.litres += Math.max(0, num(r.computed_consumed_litres));
                b.cost += Math.max(0, num(r.computed_cost));
            }
            return {
                readings: list.length, days_logged: new Set(list.map(r => str(r.reading_date))).size, days_in_range: dayCount,
                daily: Array.from(dieselDaily.values()).map(d => ({ ...d, litres: round1(d.litres), cost: Math.round(d.cost) })),
                litres: round1(list.reduce((s, r) => s + Math.max(0, num(r.computed_consumed_litres)), 0)),
                cost: Math.round(list.reduce((s, r) => s + Math.max(0, num(r.computed_cost)), 0)),
                by_generator: Array.from(byGen.values()).map(g => ({ ...g, litres: round1(g.litres), cost: Math.round(g.cost) })).sort((a, b) => b.litres - a.litres),
            };
        }),

        // ── Water ────────────────────────────────────────────────────────────
        section('water', async () => {
            const sources = await rows(
                supabaseAdmin.from('water_sources').select('id, name').eq('property_id', propertyId).range(0, 499),
            );
            const sourceIds = sources.map(s => str(s.id)).filter(Boolean);
            const list = sourceIds.length ? await rows(
                supabaseAdmin.from('water_readings').select('id, reading_date, quantity, computed_cost, source_id')
                    .in('source_id', sourceIds)
                    .gte('reading_date', from).lte('reading_date', to).range(0, ROW_CAP - 1),
            ) : [];
            const names = new Map(sources.map(s => [str(s.id), str(s.name) || 'Source']));
            const bySource = new Map<string, { name: string; quantity: number; cost: number }>();
            for (const r of list) {
                const k = str(r.source_id);
                const e = bySource.get(k) || { name: names.get(k) || 'Source', quantity: 0, cost: 0 };
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
            return {
                sources: sources.length, readings: list.length,
                daily: Array.from(waterDaily.values()).map(d => ({ ...d, quantity: round1(d.quantity), cost: Math.round(d.cost) })),
                days_logged: new Set(list.map(r => str(r.reading_date))).size, days_in_range: dayCount,
                quantity: round1(list.reduce((s, r) => s + Math.max(0, num(r.quantity)), 0)),
                cost: Math.round(list.reduce((s, r) => s + Math.max(0, num(r.computed_cost)), 0)),
                by_source: Array.from(bySource.values()).map(s => ({ ...s, quantity: round1(s.quantity), cost: Math.round(s.cost) })).sort((a, b) => b.quantity - a.quantity),
            };
        }),

        // ── Stock ────────────────────────────────────────────────────────────
        section('stock', async () => {
            const items = await rows(
                supabaseAdmin.from('stock_items').select('id, name, quantity, min_threshold').eq('property_id', propertyId).range(0, ROW_CAP - 1),
            );
            const moves = await rows(
                supabaseAdmin.from('stock_movements').select('id, action, quantity_change, created_at')
                    .eq('property_id', propertyId)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive).range(0, ROW_CAP - 1),
            );
            const low = items.filter(i => num(i.quantity) < (num(i.min_threshold) || 10));
            const stockDaily = dayBuckets(from, to, () => ({ added: 0, removed: 0 }));
            for (const m of moves) {
                const b = stockDaily.get(istDay(m.created_at) || '');
                if (!b) continue;
                if (str(m.action) === 'add') b.added += num(m.quantity_change);
                else if (str(m.action) === 'remove') b.removed += Math.abs(num(m.quantity_change));
            }
            return {
                daily: Array.from(stockDaily.values()),
                items: items.length,
                low_stock: low.length,
                low_stock_items: low.slice(0, 8).map(i => ({ name: str(i.name), quantity: num(i.quantity), min: num(i.min_threshold) || 10 })),
                movements: moves.length,
                added: moves.filter(m => str(m.action) === 'add').reduce((s, m) => s + num(m.quantity_change), 0),
                removed: Math.abs(moves.filter(m => str(m.action) === 'remove').reduce((s, m) => s + num(m.quantity_change), 0)),
                days_with_movement: new Set(moves.map(m => istDay(m.created_at))).size,
            };
        }),

        // ── Assets ───────────────────────────────────────────────────────────
        section('assets', async () => {
            const list = await rows(
                supabaseAdmin.from('assets').select('id, status, warranty_end, amc_required, purchase_cost, category:asset_categories(name)')
                    .eq('property_id', propertyId).is('deleted_at', null).range(0, ROW_CAP - 1),
            );
            const events = await count(
                supabaseAdmin.from('asset_events').select('id', { count: 'exact', head: true })
                    .eq('property_id', propertyId).gte('occurred_at', fromTs).lt('occurred_at', toTsExclusive),
            ).catch(() => 0);
            const in90 = addDays(today, 90);
            return {
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
        section('amc', async () => {
            const list = await rows(
                supabaseAdmin.from('amc_contracts').select('id, system_name, vendor_name, contract_end_date, contract_value, status')
                    .eq('property_id', propertyId).range(0, ROW_CAP - 1),
            );
            const in60 = addDays(today, 60);
            const expiring = list.filter(c => str(c.contract_end_date) >= today && str(c.contract_end_date) <= in60);
            return {
                total: list.length,
                active: list.filter(c => str(c.contract_end_date) >= today && str(c.status) !== 'expired').length,
                expired: list.filter(c => str(c.contract_end_date) < today || str(c.status) === 'expired').length,
                expiring_60d: expiring.length,
                total_value: Math.round(list.reduce((s, c) => s + num(c.contract_value), 0)),
                expiring_list: expiring.slice(0, 6).map(c => ({ system: str(c.system_name), vendor: str(c.vendor_name), ends: str(c.contract_end_date) })),
            };
        }),

        // ── Visitors ─────────────────────────────────────────────────────────
        section('visitors', async () => {
            const base = () => supabaseAdmin.from('visitor_logs').select('id', { count: 'exact', head: true })
                .eq('property_id', propertyId).gte('checkin_time', fromTs).lt('checkin_time', toTsExclusive);
            const [total, inside, out, logs] = await Promise.all([
                count(base()), count(base().is('checkout_time', null)), count(base().not('checkout_time', 'is', null)),
                rows(supabaseAdmin.from('visitor_logs').select('id, checkin_time')
                    .eq('property_id', propertyId).gte('checkin_time', fromTs).lt('checkin_time', toTsExclusive)
                    .order('checkin_time', { ascending: true }).range(0, ROW_CAP - 1)),
            ]);
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
        section('meeting_rooms', async () => {
            const list = await rows(
                supabaseAdmin.from('meeting_room_bookings').select('id, status, booking_date, start_time, end_time, meeting_room_id, meeting_room:meeting_rooms(name)')
                    .eq('property_id', propertyId)
                    .gte('booking_date', from).lte('booking_date', to).range(0, ROW_CAP - 1),
            );
            const roomsCount = await count(
                supabaseAdmin.from('meeting_rooms').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
            ).catch(() => new Set(list.map(b => str(b.meeting_room_id))).size);
            const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
            const confirmed = list.filter(b => str(b.status) === 'confirmed');
            const hours = confirmed.reduce((s, b) => {
                const d = mins(str(b.end_time)) - mins(str(b.start_time));
                return s + (d > 0 ? d / 60 : 0);
            }, 0);
            const roomDaily = dayBuckets(from, to, () => ({ bookings: 0, hours: 0 }));
            const byRoom = new Map<string, { name: string; bookings: number; hours: number }>();
            for (const b of confirmed) {
                const d = mins(str(b.end_time)) - mins(str(b.start_time));
                const h = d > 0 ? d / 60 : 0;
                const day = roomDaily.get(str(b.booking_date));
                if (day) { day.bookings++; day.hours += h; }
                const k = str(b.meeting_room_id) || 'unknown';
                const e = byRoom.get(k) || { name: str(rel(b.meeting_room)?.name) || 'Room', bookings: 0, hours: 0 };
                e.bookings++; e.hours += h;
                byRoom.set(k, e);
            }
            return {
                daily: Array.from(roomDaily.values()).map(d => ({ ...d, hours: round1(d.hours) })),
                by_room: Array.from(byRoom.values()).map(r => ({ ...r, hours: round1(r.hours) })).sort((a, b) => b.hours - a.hours),
                rooms: roomsCount, bookings: list.length, confirmed: confirmed.length,
                cancelled: list.filter(b => str(b.status) === 'cancelled').length,
                hours_booked: round1(hours),
                by_status: countBy(list, b => str(b.status)),
            };
        }),

        // ── Petty cash ───────────────────────────────────────────────────────
        section('petty_cash', async () => {
            const list = await rows(
                supabaseAdmin.from('petty_cash_requests').select('id, status, request_type, amount_requested, approved_amount, paid_amount, created_at')
                    .eq('property_id', propertyId)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive).range(0, ROW_CAP - 1),
            );
            const sum = (k: string, filter?: (r: Row) => boolean) => Math.round(list.filter(r => !filter || filter(r)).reduce((s, r) => s + num(r[k]), 0));
            return {
                requests: list.length,
                requested_amount: sum('amount_requested'),
                approved_amount: sum('approved_amount'),
                paid_amount: sum('paid_amount'),
                pending_approval: list.filter(r => ['submitted', 'sent_back'].includes(str(r.status))).length,
                rejected: list.filter(r => str(r.status) === 'rejected').length,
                closed: list.filter(r => str(r.status) === 'closed').length,
                by_status: countBy(list, r => str(r.status).replace(/_/g, ' ')),
            };
        }),

        // ── Procurement (material requests) ──────────────────────────────────
        section('procurement', async () => {
            const list = await rows(
                supabaseAdmin.from('material_requests').select('id, status, total_amount, created_at')
                    .eq('property_id', propertyId)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive).range(0, ROW_CAP - 1),
            );
            return {
                requests: list.length,
                pending: list.filter(r => ['pending', 'vendor_arranged'].includes(str(r.status))).length,
                approved: list.filter(r => ['approved', 'ordered'].includes(str(r.status))).length,
                delivered: list.filter(r => ['delivered', 'completed'].includes(str(r.status))).length,
                rejected: list.filter(r => ['rejected', 'cancelled'].includes(str(r.status))).length,
                total_amount: Math.round(list.reduce((s, r) => s + num(r.total_amount), 0)),
                by_status: countBy(list, r => str(r.status).replace(/_/g, ' ')),
            };
        }),

        // ── Monthly requisitions ─────────────────────────────────────────────
        section('requisitions', async () => {
            const months: string[] = [];
            for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
                months.push(m);
                const [y, mm] = m.split('-').map(Number);
                const n = new Date(Date.UTC(y, mm, 1));
                m = n.toISOString().slice(0, 7);
            }
            const years = Array.from(new Set(months.map(m => Number(m.slice(0, 4)))));
            const list = await rows(
                supabaseAdmin.from('property_monthly_requisitions').select('id, requisition_month, requisition_year, status')
                    .eq('property_id', propertyId).in('requisition_year', years).range(0, 499),
            );
            const inRange = list.filter(r => months.includes(`${r.requisition_year}-${String(r.requisition_month).padStart(2, '0')}`));
            return {
                months_in_range: months.length,
                submitted: inRange.length,
                acknowledged: inRange.filter(r => str(r.status) === 'acknowledged').length,
                missing_months: months.filter(m => !inRange.some(r => `${r.requisition_year}-${String(r.requisition_month).padStart(2, '0')}` === m)),
            };
        }),

        // ── Roster ───────────────────────────────────────────────────────────
        section('roster', async () => {
            const list = await rows(
                supabaseAdmin.from('staff_rosters').select('id, user_id, roster_date, is_reliever')
                    .eq('property_id', propertyId)
                    .gte('roster_date', from).lte('roster_date', to).range(0, ROW_CAP - 1),
            );
            return {
                shifts: list.length,
                staff_rostered: new Set(list.map(r => str(r.user_id))).size,
                reliever_shifts: list.filter(r => r.is_reliever === true).length,
                days_covered: new Set(list.map(r => str(r.roster_date))).size,
                days_in_range: dayCount,
            };
        }),

        // ── Task manager (tasks assigned to this property's people) ──────────
        section('tasks', async () => {
            if (!memberIds.length) return { total: 0, completed: 0, in_progress: 0, pending: 0, completion_rate: null as number | null };
            const list = await rows(
                supabaseAdmin.from('task_assignments').select('id, status, assigned_date')
                    .in('employee_id', memberIds)
                    .gte('assigned_date', from).lte('assigned_date', to).range(0, ROW_CAP - 1),
            );
            const completed = list.filter(r => str(r.status) === 'completed').length;
            return {
                total: list.length, completed,
                in_progress: list.filter(r => str(r.status) === 'in_progress').length,
                pending: list.filter(r => str(r.status) === 'pending').length,
                completion_rate: pct(completed, list.length),
            };
        }),

        // ── Statutory / internal audit (current state, not range bound) ──────
        section('audit', async () => {
            const list = await rows(
                supabaseAdmin.from('property_audit_submissions').select('id, status').eq('property_id', propertyId).range(0, ROW_CAP - 1),
            );
            const s = (v: string) => list.filter(r => str(r.status) === v).length;
            const applicable = list.length - s('not_applicable');
            return {
                items: list.length, compliant: s('compliant'), pending_review: s('pending_review'), missing: s('missing'),
                not_applicable: s('not_applicable'), compliance: pct(s('compliant'), applicable),
            };
        }),

        // ── Team ─────────────────────────────────────────────────────────────
        section('team', async () => ({
            members: activeTeam.length,
            by_role: countBy(activeTeam, r => str(r.role).replace(/_/g, ' ') || 'member'),
        })),
    ]);

    return NextResponse.json({
        property: { id: property.id, name: property.name, code: property.code, address: property.address, city: property.city, is_active: property.is_active },
        range: { from, to, days: dayCount },
        generated_at: new Date().toISOString(),
        sections: {
            tickets, guest_requests: guestRequests, hr_tickets: hr, sop, ppm, electricity, diesel, water, stock, assets, amc,
            visitors, meeting_rooms: meetingRooms, petty_cash: pettyCash, procurement, requisitions, roster, tasks, audit, team,
        },
    });
}
