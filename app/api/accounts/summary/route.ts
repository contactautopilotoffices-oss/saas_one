import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

/**
 * GET /api/accounts/summary — Finance overview for the Accounts landing page.
 *
 * Period model mirrors the ticket dashboards ('today' | 'month' | 'all', see
 * frontend/components/dashboard/OrgAdminDashboard.tsx:193) plus 'custom' with from/to.
 *
 * Buckets keep the Payment Tracker language from 20260723000003_payment_tracker.sql:
 *   To Align  = PO amount not yet reserved by a payment, windowed on po_date
 *   Aligned   = po_payments.status='aligned',   windowed on aligned_at
 *   Completed = po_payments.status='completed', windowed on payment_date
 *
 * PostgREST caps a response at 1000 rows and this org already holds 5k+ POs, so every
 * read pages explicitly through .range() until a short page comes back. No RPC is used:
 * this route owns no migration, and silently truncating would understate every total.
 */

const PAGE = 1000;
// Guard against an unbounded loop if a page ever comes back full forever.
const MAX_ROWS = 100000;
const QUEUE_SIZE = 8;
const TOP_N = 6;

type Period = 'today' | 'month' | 'all' | 'custom';

interface Win {
    period: Period;
    fromDate: string | null;   // 'YYYY-MM-DD' — for DATE columns (po_date, payment_date)
    toDate: string | null;
    fromIso: string | null;    // UTC instants — for TIMESTAMPTZ columns (aligned_at, …)
    toIso: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Round-trips through Date so 2026-02-31 / 2026-13-01 are rejected, not silently rolled over.
function isValidDay(s: string): boolean {
    if (!DATE_RE.test(s)) return false;
    const t = Date.parse(`${s}T00:00:00.000Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// The books are kept in IST; the Next server runs UTC, so day boundaries must be
// resolved in Asia/Kolkata or "today" silently shifts by 5.5 hours.
function istToday(): { y: number; m: number; d: number } {
    const s = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const [y, m, d] = s.split('-').map(Number);
    return { y, m, d };
}

const ymd = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const istStart = (day: string) => new Date(`${day}T00:00:00.000+05:30`).toISOString();
const istEnd = (day: string) => new Date(`${day}T23:59:59.999+05:30`).toISOString();

function resolveWindow(period: Period, from: string | null, to: string | null): Win | { error: string } {
    if (period === 'all') return { period, fromDate: null, toDate: null, fromIso: null, toIso: null };

    const t = istToday();
    let start: string;
    let end: string;

    if (period === 'custom') {
        // An unusable range is a caller bug: 400 it rather than quietly widening the
        // window, which would report org-wide numbers under a "custom" label.
        if (!from && !to) return { error: 'custom period requires from and/or to (YYYY-MM-DD)' };
        if (from && !isValidDay(from)) return { error: `Invalid from date "${from}" — expected YYYY-MM-DD` };
        if (to && !isValidDay(to)) return { error: `Invalid to date "${to}" — expected YYYY-MM-DD` };
        start = from || '1970-01-01';
        end = to || ymd(t.y, t.m, t.d);
        if (start > end) return { error: 'from must be on or before to' };
    } else if (period === 'today') {
        start = ymd(t.y, t.m, t.d);
        end = start;
    } else {
        start = ymd(t.y, t.m, 1);
        end = ymd(t.y, t.m, t.d);
    }

    return { period, fromDate: start, toDate: end, fromIso: istStart(start), toIso: istEnd(end) };
}

// Page through PostgREST until a short page arrives. `build` must return a fresh
// query each call — Supabase query builders are single-use once awaited.
async function fetchAll<T>(build: () => any): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const { data, error } = await build().range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = (data || []) as T[];
        out.push(...rows);
        if (rows.length < PAGE) break;
    }
    return out;
}

const num = (v: any) => Number(v || 0);
const dayOf = (v: any) => (typeof v === 'string' ? v.slice(0, 10) : null);

const ageDays = (v: any) => {
    if (!v) return null;
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

interface PoRow {
    id: string;
    po_number: string;
    vendor_name: string | null;
    po_amount: number | string;
    department: string | null;
    project_name: string | null;
    po_date: string | null;
    status: string | null;
}

interface PayRow {
    id: string;
    po_id: string;
    po_number: string | null;
    vendor_name: string | null;
    tranche_no: number;
    requested_amount: number | string;
    paid_amount: number | string | null;
    gst_hold: number | string | null;
    status: string;
    aligned_at: string | null;
    aligned_by: string | null;
    completed_at: string | null;
    payment_date: string | null;
    payment_term: string | null;
    created_at: string;
}

export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const raw = (sp.get('period') || 'month') as Period;
    const period: Period = ['today', 'month', 'all', 'custom'].includes(raw) ? raw : 'month';
    const win = resolveWindow(period, sp.get('from'), sp.get('to'));
    if ('error' in win) return NextResponse.json({ error: win.error }, { status: 400 });

    let pos: PoRow[];
    let payments: PayRow[];
    try {
        // Both sets are read org-wide, not window-filtered: pending amounts must net off
        // every tranche ever raised against a PO, and the action queue is the whole
        // backlog (an overdue PO from March is exactly what the queue exists to surface).
        [pos, payments] = await Promise.all([
            fetchAll<PoRow>(() =>
                supabaseAdmin
                    .from('zoho_purchase_orders')
                    .select('id, po_number, vendor_name, po_amount, department, project_name, po_date, status')
                    .eq('organization_id', access.organizationId)
                    .order('id', { ascending: true })),
            fetchAll<PayRow>(() =>
                supabaseAdmin
                    .from('po_payments')
                    .select('id, po_id, po_number, vendor_name, tranche_no, requested_amount, paid_amount, gst_hold, status, aligned_at, aligned_by, completed_at, payment_date, payment_term, created_at')
                    .eq('organization_id', access.organizationId)
                    .neq('status', 'cancelled')
                    .order('id', { ascending: true })),
        ]);
    } catch (e: any) {
        // Log the driver's message, return a fixed one: PostgREST errors quote column
        // names and cast failures ("invalid input syntax for type uuid: …"), which is
        // schema disclosure on a client-visible path. The 400s from resolveWindow are
        // author-written and still pass through verbatim.
        console.error('Accounts summary error:', e);
        return NextResponse.json({ error: 'Failed to build the finance summary' }, { status: 500 });
    }

    // Critical flags live on po_workflow_state (20260801000001_po_alignment_state.sql).
    // Read defensively — the overview must still render if that migration hasn't run.
    const critical = new Set<string>();
    try {
        const flagged = await fetchAll<{ po_id: string }>(() =>
            supabaseAdmin
                .from('po_workflow_state')
                .select('po_id')
                .eq('organization_id', access.organizationId)
                .eq('is_critical', true)
                .order('po_id', { ascending: true }));
        for (const r of flagged) critical.add(r.po_id);
    } catch {
        // no-op: criticality is a sort hint here, never a required input
    }

    // Reserved-per-PO. Anything not completed (aligned / to_align) still holds budget,
    // matching annotate() in app/api/accounts/pos/route.ts.
    const reserved = new Map<string, number>();
    for (const p of payments) {
        reserved.set(p.po_id, (reserved.get(p.po_id) || 0) + num(p.requested_amount));
    }

    const inDateWin = (v: any) => {
        if (!win.fromDate) return true;
        const d = dayOf(v);
        if (!d) return false; // undated rows only survive the 'all' window
        return d >= win.fromDate && d <= (win.toDate as string);
    };
    const inTsWin = (v: any) => {
        if (!win.fromIso) return true;
        if (!v) return false;
        return v >= win.fromIso && v <= (win.toIso as string);
    };

    // --- To Align (PO-derived) -------------------------------------------------
    // A cancelled or draft Zoho PO can never be paid, so it must not enter the queue or
    // inflate the backlog. zohoBooksSync.ts:38 stores Zoho's status verbatim and
    // zohoService.ts:95 pulls every status. NULL status stays payable — manual and CSV
    // rows routinely have none. Mirrors is_payable in the po_alignment_queue view so this
    // overview and the tracker directly below it agree.
    const UNPAYABLE = ['cancelled', 'draft'];
    const payablePos = pos.filter((po) => !UNPAYABLE.includes(String(po.status || '').toLowerCase()));

    const pending = payablePos.map((po) => ({
        po,
        pending_amount: Math.max(0, num(po.po_amount) - (reserved.get(po.id) || 0)),
    }));
    const openPos = pending.filter((x) => x.pending_amount > 0.5);

    const windowPos = payablePos.filter((po) => inDateWin(po.po_date));
    const windowOpen = openPos.filter((x) => inDateWin(x.po.po_date));

    // --- Aligned / Completed (payment-derived) ---------------------------------
    // All three cards are FLOW metrics: what entered this state during the window.
    // Aligned was previously a stock (status === 'aligned') filtered by a flow date
    // (aligned_at), which made it read 0 whenever the backlog had been aligned in an
    // earlier window — while "Payments awaiting UTR" one panel below, deliberately
    // unwindowed, showed the full backlog. Two numbers for the same thing, disagreeing.
    // The unwindowed stock still exists, as queue.complete.total_* .
    const alignedAll = payments.filter((p) => p.status === 'aligned');
    const alignedWin = payments.filter((p) => p.aligned_at && inTsWin(p.aligned_at));
    // completed_at is a real TIMESTAMPTZ; payment_date is a DATE that
    // backend/lib/accounts/transitions.ts stamps in IST, so both compare cleanly against
    // the IST-resolved window.
    const completedWin = payments.filter(
        (p) => p.status === 'completed' && (p.payment_date ? inDateWin(p.payment_date) : inTsWin(p.completed_at)),
    );
    const paidValue = (p: PayRow) => (p.paid_amount != null ? num(p.paid_amount) : num(p.requested_amount));

    const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

    // --- Top vendors / departments by PO value in the window --------------------
    const group = (key: (po: PoRow) => string) => {
        const m = new Map<string, { name: string; po_count: number; po_value: number; pending_value: number }>();
        for (const x of pending) {
            if (!inDateWin(x.po.po_date)) continue;
            const name = key(x.po);
            const g = m.get(name) || { name, po_count: 0, po_value: 0, pending_value: 0 };
            g.po_count += 1;
            g.po_value += num(x.po.po_amount);
            g.pending_value += x.pending_amount;
            m.set(name, g);
        }
        return [...m.values()].sort((a, b) => b.po_value - a.po_value).slice(0, TOP_N);
    };

    // --- Pending action queue, scoped to what the caller may actually action -----
    // canAlign -> POs still needing a tranche; canComplete -> aligned tranches needing a UTR.
    // Critical POs outrank value: they were flagged precisely to jump the queue.
    const alignSorted = access.canAlign
        ? [...openPos].sort((a, b) => {
              const c = Number(critical.has(b.po.id)) - Number(critical.has(a.po.id));
              return c !== 0 ? c : b.pending_amount - a.pending_amount;
          })
        : [];

    const completeSorted = access.canComplete
        ? [...alignedAll].sort((a, b) => (a.aligned_at || a.created_at).localeCompare(b.aligned_at || b.created_at))
        : [];
    const completeItems = completeSorted.slice(0, QUEUE_SIZE);

    // Resolve aligner names only for the rows we actually return.
    const alignerIds = [...new Set(completeItems.map((p) => p.aligned_by).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (alignerIds.length) {
        const { data } = await supabaseAdmin.from('users').select('id, full_name').in('id', alignerIds);
        for (const u of data || []) names.set(u.id, u.full_name || '');
    }

    return NextResponse.json({
        organization_id: access.organizationId,
        period,
        window: { from: win.fromDate, to: win.toDate },
        can: { align: access.canAlign, complete: access.canComplete },
        totals: { po_count: windowPos.length, po_value: sum(windowPos, (p) => num(p.po_amount)) },
        buckets: {
            to_align: { count: windowOpen.length, value: sum(windowOpen, (x) => x.pending_amount) },
            aligned: { count: alignedWin.length, value: sum(alignedWin, (p) => num(p.requested_amount)) },
            completed: { count: completedWin.length, value: sum(completedWin, paidValue) },
        },
        queue: {
            align: {
                total_count: alignSorted.length,
                total_value: sum(alignSorted, (x) => x.pending_amount),
                critical_count: alignSorted.filter((x) => critical.has(x.po.id)).length,
                items: alignSorted.slice(0, QUEUE_SIZE).map((x) => ({
                    id: x.po.id,
                    po_number: x.po.po_number,
                    vendor_name: x.po.vendor_name,
                    department: x.po.department,
                    project_name: x.po.project_name,
                    po_amount: num(x.po.po_amount),
                    pending_amount: x.pending_amount,
                    po_date: x.po.po_date,
                    age_days: ageDays(x.po.po_date),
                    is_critical: critical.has(x.po.id),
                })),
            },
            complete: {
                total_count: completeSorted.length,
                total_value: sum(completeSorted, (p) => num(p.requested_amount)),
                items: completeItems.map((p) => ({
                    id: p.id,
                    po_id: p.po_id,
                    po_number: p.po_number,
                    vendor_name: p.vendor_name,
                    tranche_no: p.tranche_no,
                    requested_amount: num(p.requested_amount),
                    gst_hold: num(p.gst_hold),
                    payment_term: p.payment_term,
                    aligned_at: p.aligned_at,
                    aligned_by_name: (p.aligned_by && names.get(p.aligned_by)) || null,
                    age_days: ageDays(p.aligned_at || p.created_at),
                    is_critical: critical.has(p.po_id),
                })),
            },
        },
        top_vendors: group((po) => po.vendor_name || 'Unnamed vendor'),
        top_departments: group((po) => po.department || 'Unspecified'),
        scanned: { pos: pos.length, payments: payments.length },
        generated_at: new Date().toISOString(),
    });
}
