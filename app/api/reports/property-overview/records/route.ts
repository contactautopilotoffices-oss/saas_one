import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { guardOrg, guardProperty } from '@/backend/lib/auth/callerAccess';
import { isMissingRelation } from '@/backend/lib/commandCenter/access';

/**
 * GET /api/reports/property-overview/records
 *   ?propertyId=<uuid> | orgId=<uuid>
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD
 *   &module=tickets|sop|ppm|procurement|requisitions|petty_cash
 *   &filter=<bucket>   (see FILTERS below; default "all")
 *
 * The record-level rows behind a number on the Property report: "which 48 tickets
 * were closed", "which checklists were missed", "which months have no requisition".
 * Uses exactly the same period rules and status buckets as
 * /api/reports/property-overview so a list always adds up to the figure it opened from.
 *
 * Reads only. Same access guards as the report itself.
 */

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;
type Cell = string | number | null;

const IST_OFFSET = '+05:30';
const IST_OFFSET_MS = 330 * 60 * 1000;
const MAX_DAYS = 366;
const LIMIT = 2000;

const TICKET_CLOSED = ['resolved', 'closed', 'satisfied', 'completed'];
const TICKET_DEAD = ['cancelled', 'rejected', 'duplicate'];

/** Status buckets each module can be filtered by. Keys match what the UI sends. */
const FILTERS: Record<string, string[]> = {
    tickets: ['all', 'closed', 'open', 'pending_validation', 'sla_breached', 'internal', 'open_now'],
    sop: ['all', 'completed', 'on_time', 'late', 'missed', 'pending'],
    ppm: ['all', 'done', 'pending', 'postponed', 'skipped', 'overdue_now'],
    procurement: ['all', 'pending', 'approved', 'delivered', 'rejected'],
    requisitions: ['all', 'submitted', 'acknowledged', 'uploaded', 'missing'],
    petty_cash: ['all', 'pending_approval', 'paid', 'rejected'],
};

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
function todayIst(): string { return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10); }
function str(v: unknown): string { return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v); }
function num(v: unknown): number { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : 0; }
function rel(v: unknown): Row | null { if (Array.isArray(v)) return (v[0] as Row) || null; return v && typeof v === 'object' ? (v as Row) : null; }
/** "18 Nov 2026, 14:05" in IST, or "" */
function istStamp(v: unknown): string {
    const s = str(v);
    if (!s) return '';
    const t = Date.parse(s);
    if (isNaN(t)) return s;
    return new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
function hoursBetween(a: unknown, b: unknown): number | null {
    const x = Date.parse(str(a)); const y = Date.parse(str(b));
    if (isNaN(x) || isNaN(y) || y < x) return null;
    return Math.round(((y - x) / 3_600_000) * 10) / 10;
}
function pretty(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

async function q(query: PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>): Promise<Row[]> {
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as Row[];
}

/** Rows of `table` by id, in batches. Missing table or rows map to nothing. */
async function byIds(table: string, cols: string, idsIn: unknown[]): Promise<Map<string, Row>> {
    const ids = Array.from(new Set(idsIn.map(str).filter(Boolean)));
    const m = new Map<string, Row>();
    for (let i = 0; i < ids.length; i += 300) {
        const { data } = await supabaseAdmin.from(table).select(cols).in('id', ids.slice(i, i + 300));
        for (const r of (data || []) as unknown as Row[]) m.set(str(r.id), r);
    }
    return m;
}

/** Full names for a set of user ids, in one query. Missing users map to "". */
async function userNames(idsIn: unknown[]): Promise<Map<string, string>> {
    const ids = Array.from(new Set(idsIn.map(str).filter(Boolean)));
    const m = new Map<string, string>();
    if (!ids.length) return m;
    for (let i = 0; i < ids.length; i += 300) {
        const { data } = await supabaseAdmin.from('users').select('id, full_name, email').in('id', ids.slice(i, i + 300));
        for (const u of (data || []) as Row[]) m.set(str(u.id), str(u.full_name) || str(u.email));
    }
    return m;
}

export async function GET(request: NextRequest) {
    const sp = new URL(request.url).searchParams;
    const propertyId = sp.get('propertyId');
    const orgIdParam = sp.get('orgId');
    const mod = sp.get('module') || '';
    const filter = sp.get('filter') || 'all';
    if (!propertyId && !orgIdParam) return NextResponse.json({ error: 'propertyId or orgId is required' }, { status: 400 });
    if (!FILTERS[mod]) return NextResponse.json({ error: 'Unknown module' }, { status: 400 });
    if (!FILTERS[mod].includes(filter)) return NextResponse.json({ error: 'Unknown filter for this module' }, { status: 400 });

    const today = todayIst();
    const to = isDay(sp.get('to')) ? (sp.get('to') as string) : today;
    const from = isDay(sp.get('from')) ? (sp.get('from') as string) : `${to.slice(0, 7)}-01`;
    if (from > to) return NextResponse.json({ error: 'from must not be after to' }, { status: 400 });
    const dayCount = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (dayCount > MAX_DAYS) return NextResponse.json({ error: `Range must be at most ${MAX_DAYS} days` }, { status: 400 });

    // Scope, with the same guards as the report.
    let properties: { id: string; name: string }[] = [];
    if (propertyId) {
        const denied = await guardProperty(request, propertyId);
        if (denied) return denied;
        const { data } = await supabaseAdmin.from('properties').select('id, name').eq('id', propertyId).maybeSingle();
        if (!data) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
        properties = [{ id: String(data.id), name: String(data.name) }];
    } else {
        const orgId = orgIdParam as string;
        const denied = await guardOrg(request, orgId);
        if (denied) return denied;
        const { data } = await supabaseAdmin.from('properties').select('id, name, is_active').eq('organization_id', orgId).order('name');
        properties = ((data || []) as Row[]).filter(p => p.is_active !== false).map(p => ({ id: str(p.id), name: str(p.name) }));
        if (!properties.length) return NextResponse.json({ error: 'No active properties in this organisation' }, { status: 404 });
    }
    // Optional narrowing to one property inside an organisation report.
    const only = sp.get('onlyProperty');
    if (only && properties.some(p => p.id === only)) properties = properties.filter(p => p.id === only);
    const ids = properties.map(p => p.id);
    const nameOf = new Map(properties.map(p => [p.id, p.name]));
    const multi = !propertyId;

    const fromTs = `${from}T00:00:00${IST_OFFSET}`;
    const toTsExclusive = `${addDays(to, 1)}T00:00:00${IST_OFFSET}`;
    const nowIso = new Date().toISOString();

    let columns: string[] = [];
    let out: Cell[][] = [];
    let links: (string | null)[] = [];
    let total = 0;

    try {
        if (mod === 'tickets') {
            const base = 'id, ticket_number, title, status, priority, created_at, resolved_at, internal, floor_number, sla_breached, sla_deadline, property_id, assigned_to, raised_by, category, issue_category:category_id(name)';
            let list: Row[];
            if (filter === 'open_now') {
                list = await q(supabaseAdmin.from('tickets').select(base).in('property_id', ids)
                    .not('status', 'in', `(${[...TICKET_CLOSED, ...TICKET_DEAD].join(',')})`)
                    .order('created_at', { ascending: true }).range(0, LIMIT - 1));
            } else {
                list = await q(supabaseAdmin.from('tickets').select(base).in('property_id', ids)
                    .gte('created_at', fromTs).lt('created_at', toTsExclusive)
                    .order('created_at', { ascending: false }).range(0, LIMIT * 3 - 1));
                const closed = (t: Row) => TICKET_CLOSED.includes(str(t.status));
                const pick: Record<string, (t: Row) => boolean> = {
                    all: () => true,
                    closed,
                    open: t => !closed(t) && str(t.status) !== 'pending_validation',
                    pending_validation: t => str(t.status) === 'pending_validation',
                    sla_breached: t => t.sla_breached === true || (!!str(t.sla_deadline) && str(t.sla_deadline) < nowIso && !closed(t)),
                    internal: t => t.internal === true,
                };
                list = list.filter(pick[filter]);
            }
            total = list.length;
            list = list.slice(0, LIMIT);
            const names = await userNames([...list.map(t => t.assigned_to), ...list.map(t => t.raised_by)]);
            columns = ['Ticket', 'Title', ...(multi ? ['Property'] : []), 'Category', 'Priority', 'Status', 'Raised', 'Closed', 'Hours to close', 'SLA', 'Assigned to', 'Raised by'];
            out = list.map(t => [
                str(t.ticket_number) || str(t.id).slice(0, 8),
                str(t.title),
                ...(multi ? [nameOf.get(str(t.property_id)) || ''] : []),
                str(rel(t.issue_category)?.name) || pretty(str(t.category)) || '',
                pretty(str(t.priority)),
                pretty(str(t.status)),
                istStamp(t.created_at),
                TICKET_CLOSED.includes(str(t.status)) ? istStamp(t.resolved_at) : '',
                TICKET_CLOSED.includes(str(t.status)) ? hoursBetween(t.created_at, t.resolved_at) : null,
                t.sla_breached === true || (!!str(t.sla_deadline) && str(t.sla_deadline) < nowIso && !TICKET_CLOSED.includes(str(t.status))) ? 'Breached' : 'Within',
                names.get(str(t.assigned_to)) || '',
                names.get(str(t.raised_by)) || '',
            ]);
            links = list.map(t => `/tickets/${str(t.id)}`);
        } else if (mod === 'sop') {
            let list = await q(supabaseAdmin.from('sop_completions').select('*')
                .in('property_id', ids).gte('due_at', fromTs).lt('due_at', toTsExclusive)
                .order('due_at', { ascending: false }).range(0, LIMIT * 3 - 1));
            const st = (r: Row) => str(r.status);
            const pick: Record<string, (r: Row) => boolean> = {
                all: () => true,
                completed: r => st(r) === 'completed',
                on_time: r => st(r) === 'completed' && r.is_late !== true,
                late: r => st(r) === 'completed' && r.is_late === true,
                missed: r => st(r) === 'missed',
                pending: r => !['completed', 'missed'].includes(st(r)),
            };
            list = list.filter(pick[filter]);
            total = list.length;
            list = list.slice(0, LIMIT);
            const [names, templates] = await Promise.all([
                userNames(list.map(r => r.completed_by)),
                byIds('sop_templates', 'id, title, category, frequency', list.map(r => r.template_id)),
            ]);
            columns = ['Checklist', ...(multi ? ['Property'] : []), 'Category', 'Frequency', 'Due', 'Completed at', 'Outcome', 'Done by'];
            out = list.map(r => {
                const tpl = templates.get(str(r.template_id)) || null;
                const outcome = st(r) === 'completed' ? (r.is_late === true ? 'Completed late' : 'On time') : st(r) === 'missed' ? 'Missed' : pretty(st(r) || 'pending');
                return [
                    str(tpl?.title) || 'Checklist',
                    ...(multi ? [nameOf.get(str(r.property_id)) || ''] : []),
                    pretty(str(tpl?.category)),
                    pretty(str(tpl?.frequency)),
                    istStamp(r.due_at),
                    st(r) === 'completed' ? istStamp(r.completed_at) : '',
                    outcome,
                    st(r) === 'completed' ? names.get(str(r.completed_by)) || '' : '',
                ];
            });
        } else if (mod === 'ppm') {
            let list: Row[];
            if (filter === 'overdue_now') {
                list = await q(supabaseAdmin.from('ppm_schedules').select('*').in('property_id', ids)
                    .is('done_date', null).lt('planned_date', today)
                    .not('status', 'in', '(done,completed,skipped,cancelled)')
                    .order('planned_date', { ascending: true }).range(0, LIMIT - 1));
            } else {
                list = await q(supabaseAdmin.from('ppm_schedules').select('*').in('property_id', ids)
                    .gte('planned_date', from).lte('planned_date', to)
                    .order('planned_date', { ascending: false }).range(0, LIMIT * 3 - 1));
                const isDone = (r: Row) => ['done', 'completed'].includes(str(r.status));
                const pick: Record<string, (r: Row) => boolean> = {
                    all: () => true, done: isDone,
                    pending: r => str(r.status) === 'pending', postponed: r => str(r.status) === 'postponed', skipped: r => str(r.status) === 'skipped',
                };
                list = list.filter(pick[filter]);
            }
            total = list.length;
            list = list.slice(0, LIMIT);
            columns = ['System', 'Detail', ...(multi ? ['Property'] : []), 'Frequency', 'Vendor', 'Planned', 'Done', 'Days late', 'Status', 'Remark'];
            out = list.map(r => {
                const planned = str(r.planned_date);
                const done = str(r.done_date);
                const late = planned && done && done > planned ? Math.round((Date.parse(done) - Date.parse(planned)) / 86_400_000)
                    : planned && !done && planned < today && !['skipped', 'cancelled'].includes(str(r.status)) ? Math.round((Date.parse(today) - Date.parse(planned)) / 86_400_000) : null;
                return [
                    str(r.system_name), str(r.detail_name) || str(r.scope_of_work),
                    ...(multi ? [nameOf.get(str(r.property_id)) || ''] : []),
                    pretty(str(r.frequency)), str(r.vendor_name), planned, done, late, pretty(str(r.status)), str(r.remark),
                ];
            });
        } else if (mod === 'procurement') {
            let list = await q(supabaseAdmin.from('material_requests').select('*')
                .in('property_id', ids).gte('created_at', fromTs).lt('created_at', toTsExclusive)
                .order('created_at', { ascending: false }).range(0, LIMIT * 3 - 1));
            const s = (r: Row) => str(r.status);
            const pick: Record<string, (r: Row) => boolean> = {
                all: () => true,
                pending: r => ['pending', 'vendor_arranged'].includes(s(r)),
                approved: r => ['approved', 'ordered'].includes(s(r)),
                delivered: r => ['delivered', 'completed'].includes(s(r)),
                rejected: r => ['rejected', 'cancelled'].includes(s(r)),
            };
            list = list.filter(pick[filter]);
            total = list.length;
            list = list.slice(0, LIMIT);
            const [names, tickets] = await Promise.all([
                userNames(list.map(r => r.requested_by)),
                byIds('tickets', 'id, ticket_number, title', list.map(r => r.ticket_id)),
            ]);
            columns = ['Request', ...(multi ? ['Property'] : []), 'Items', 'For ticket', 'Priority', 'Status', 'Amount (INR)', 'Raised', 'Requested by'];
            out = list.map(r => {
                const items = Array.isArray(r.items) ? (r.items as Row[]) : [];
                const t = tickets.get(str(r.ticket_id)) || null;
                return [
                    str(r.request_number) || str(r.id).slice(0, 8),
                    ...(multi ? [nameOf.get(str(r.property_id)) || ''] : []),
                    items.map(i => `${str(i.name)}${i.quantity ? ` x${num(i.quantity)}` : ''}`).filter(Boolean).slice(0, 4).join(', ') + (items.length > 4 ? ` +${items.length - 4} more` : ''),
                    t ? `${str(t.ticket_number)} ${str(t.title)}`.trim() : '',
                    pretty(str(r.priority)), pretty(s(r)),
                    Math.round(num(r.total_amount ?? r.total_estimated_cost)),
                    istStamp(r.created_at),
                    names.get(str(r.requested_by)) || '',
                ];
            });
            links = list.map(r => (r.ticket_id ? `/tickets/${str(r.ticket_id)}` : null));
        } else if (mod === 'requisitions') {
            const months: string[] = [];
            for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
                months.push(m);
                const [y, mm] = m.split('-').map(Number);
                m = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7);
            }
            const years = Array.from(new Set(months.map(m => Number(m.slice(0, 4)))));
            const list = await q(supabaseAdmin.from('property_monthly_requisitions').select('*')
                .in('property_id', ids).in('requisition_year', years).range(0, LIMIT - 1));
            const monthOf = (r: Row) => `${r.requisition_year}-${String(r.requisition_month).padStart(2, '0')}`;
            const byKey = new Map(list.filter(r => months.includes(monthOf(r))).map(r => [`${str(r.property_id)}|${monthOf(r)}`, r]));
            const names = await userNames([...list.map(r => r.uploaded_by), ...list.map(r => r.acknowledged_by)]);
            const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
            columns = [...(multi ? ['Property'] : []), 'Month', 'Status', 'File', 'Uploaded', 'Uploaded by', 'Acknowledged', 'Acknowledged by'];
            const all: { cells: Cell[]; state: string; link: string | null }[] = [];
            for (const p of properties) {
                for (const m of months) {
                    const r = byKey.get(`${p.id}|${m}`);
                    const state = !r ? 'missing' : str(r.status) === 'acknowledged' ? 'acknowledged' : 'uploaded';
                    all.push({
                        state,
                        link: r && str(r.file_url).startsWith('http') ? str(r.file_url) : null,
                        cells: [
                            ...(multi ? [p.name] : []),
                            monthLabel(m),
                            state === 'missing' ? 'Not submitted' : pretty(state),
                            r ? str(r.file_name) : '',
                            r ? istStamp(r.created_at) : '',
                            r ? names.get(str(r.uploaded_by)) || '' : '',
                            r ? istStamp(r.acknowledged_at) : '',
                            r ? names.get(str(r.acknowledged_by)) || '' : '',
                        ],
                    });
                }
            }
            const keep = all.filter(x => filter === 'all' || (filter === 'submitted' ? x.state !== 'missing' : x.state === filter));
            total = keep.length;
            out = keep.map(x => x.cells);
            links = keep.map(x => x.link);
        } else if (mod === 'petty_cash') {
            let list = await q(supabaseAdmin.from('petty_cash_requests').select('*')
                .in('property_id', ids).gte('created_at', fromTs).lt('created_at', toTsExclusive)
                .order('created_at', { ascending: false }).range(0, LIMIT * 3 - 1));
            const s = (r: Row) => str(r.status);
            const pick: Record<string, (r: Row) => boolean> = {
                all: () => true,
                pending_approval: r => ['submitted', 'sent_back'].includes(s(r)),
                paid: r => num(r.paid_amount) > 0,
                rejected: r => s(r) === 'rejected',
            };
            list = list.filter(pick[filter]);
            total = list.length;
            list = list.slice(0, LIMIT);
            const names = await userNames(list.map(r => r.requester_id));
            columns = ['Request', ...(multi ? ['Property'] : []), 'Type', 'Purpose', 'Status', 'Requested (INR)', 'Approved (INR)', 'Paid (INR)', 'Raised', 'Raised by'];
            out = list.map(r => [
                str(r.request_no) || str(r.id).slice(0, 8),
                ...(multi ? [nameOf.get(str(r.property_id)) || ''] : []),
                pretty(str(r.request_type)),
                str(r.purpose),
                pretty(s(r)),
                Math.round(num(r.amount_requested)), Math.round(num(r.approved_amount)), Math.round(num(r.paid_amount)),
                istStamp(r.created_at),
                names.get(str(r.requester_id)) || '',
            ]);
        }
    } catch (e) {
        const err = e as { code?: string; message?: string };
        if (isMissingRelation(err) || err?.code === '42703' || /does not exist/i.test(err?.message || '')) {
            return NextResponse.json({ error: 'This module is not set up for this property' }, { status: 404 });
        }
        console.error('[property-overview/records]', mod, err?.message || e);
        return NextResponse.json({ error: 'Could not load the records' }, { status: 500 });
    }

    return NextResponse.json({
        module: mod, filter, range: { from, to }, columns, rows: out, links,
        total, shown: out.length, truncated: total > out.length,
    }, { headers: { 'Cache-Control': 'private, max-age=30' } });
}
