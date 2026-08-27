import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { legacyPaymentStatus } from '@/backend/lib/accounts/trackerTypes';
import type {
    PoTrackerRow, TrackerResponse, PaymentState, PoReadiness,
} from '@/backend/lib/accounts/trackerTypes';

/**
 * GET /api/accounts/tracker — the shared Payment Tracker sheet.
 *
 * One row per PO out of po_tracker_rows (20260805000002): PO fields, payment rollup,
 * vendor compliance, document readiness and workflow flags already joined in SQL.
 *
 * PAGINATION IS EXPLICIT AND NON-NEGOTIABLE. PostgREST caps a response at 1000 rows and
 * this org holds 5,265 POs; a query without .range() comes back silently truncated, and a
 * tracker that quietly drops four fifths of the ledger is worse than one that errors.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Postgres "undefined_table" — the view's migration has not been applied.
const UNDEFINED_TABLE = '42P01';

const PAYMENT_STATES: PaymentState[] = [
    'not_requested', 'to_align', 'aligned', 'partially_paid', 'paid', 'cancelled',
];
const READINESS_STATES: PoReadiness[] = [
    'blocked_no_vendor_profile', 'blocked_docs_missing', 'ready',
];

/**
 * The sheet's status dropdown speaks the four-state vocabulary; the view speaks six. Each
 * UI value maps to the set of view states it covers, so "Completed" cannot quietly exclude
 * a PO that is fully paid across three tranches.
 */
const STATUS_FILTER: Record<string, PaymentState[]> = {
    to_align: ['not_requested', 'to_align'],
    aligned: ['aligned', 'partially_paid'],
    completed: ['paid'],
    cancelled: ['cancelled'],
    // Exact view states, for callers that want the finer distinction.
    not_requested: ['not_requested'],
    partially_paid: ['partially_paid'],
    paid: ['paid'],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * PostgREST hands NUMERIC back as a JSON number, but the driver has historically stringified
 * large ones. Coercing here is what makes the declared PoTrackerRow interface true rather
 * than aspirational — the UI must never have to guess whether po_amount is a string.
 *
 * The flat aliases are added here too; see the alias block in trackerTypes.ts for why.
 */
function normalise(row: Record<string, any>): PoTrackerRow {
    const counts = {
        tranche_count: num(row.tranche_count),
        aligned_count: num(row.aligned_count),
        completed_count: num(row.completed_count),
        cancelled_count: num(row.cancelled_count),
    };
    const missing: string[] | null = row.missing_required_docs ?? null;
    const outstanding = num(row.outstanding_amount);

    return {
        ...row,
        ...counts,
        to_align_count: num(row.to_align_count),
        po_amount: num(row.po_amount),
        requested_total: num(row.requested_total),
        paid_total: num(row.paid_total),
        unaligned_amount: num(row.unaligned_amount),
        outstanding_amount: outstanding,
        // null means "no tranche recorded a percentage", which is not 0%.
        percent_committed: numOrNull(row.percent_committed),
        latest_requested_amount: numOrNull(row.latest_requested_amount),
        latest_percent_of_po: numOrNull(row.latest_percent_of_po),
        required_docs_total: num(row.required_docs_total),
        required_docs_verified: num(row.required_docs_verified),
        expired_docs_count: num(row.expired_docs_count),
        rejected_docs_count: num(row.rejected_docs_count),
        po_document_count: num(row.po_document_count),

        // flat aliases
        status: legacyPaymentStatus(counts),
        outstanding,
        utr_no: row.latest_utr ?? null,
        compliance_status: row.vendor_compliance_status ?? null,
        // null, not 0: "no profile to check" is not "nothing missing".
        documents_missing: missing ? missing.length : null,
        updated_at: [row.po_updated_at, row.latest_payment_updated_at, row.last_activity_at]
            .filter(Boolean).sort().pop() || row.po_updated_at,
    } as PoTrackerRow;
}

export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(sp.get('page_size') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));

    const rawStatus = sp.get('status');
    // An unknown filter value is a caller bug. Ignoring it would return the UNFILTERED
    // ledger under a filtered label — the user would read "aligned" and see everything.
    if (rawStatus && !STATUS_FILTER[rawStatus]) {
        return NextResponse.json(
            { error: `Unknown status "${rawStatus}". Expected one of: ${Object.keys(STATUS_FILTER).join(', ')}` },
            { status: 400 },
        );
    }
    const rawReadiness = sp.get('readiness');
    if (rawReadiness && !READINESS_STATES.includes(rawReadiness as PoReadiness)) {
        return NextResponse.json(
            { error: `Unknown readiness "${rawReadiness}". Expected one of: ${READINESS_STATES.join(', ')}` },
            { status: 400 },
        );
    }

    const readiness = (rawReadiness as PoReadiness | null) ?? null;
    const vendor = sp.get('vendor');
    const search = (sp.get('search') || '').trim();
    const department = sp.get('department');
    const site = sp.get('site');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const criticalOnly = sp.get('critical_only') === 'true';
    const awaitingUtr = sp.get('awaiting_utr') === 'true';

    for (const [label, v] of [['date_from', dateFrom], ['date_to', dateTo]] as const) {
        if (v && !DATE_RE.test(v)) {
            return NextResponse.json({ error: `${label} must be YYYY-MM-DD` }, { status: 400 });
        }
    }

    let q = supabaseAdmin
        .from('po_tracker_rows')
        .select('*', { count: 'exact' })
        .eq('organization_id', access.organizationId);

    if (rawStatus) {
        const states = STATUS_FILTER[rawStatus];
        q = states.length === 1 ? q.eq('payment_state', states[0]) : q.in('payment_state', states);
    }
    if (readiness) q = q.eq('readiness', readiness);
    if (vendor) q = q.eq('vendor_name', vendor);
    if (department) q = q.eq('department', department);
    if (site) q = q.eq('project_name', site);
    if (criticalOnly) q = q.eq('is_critical', true);
    if (awaitingUtr) q = q.eq('awaiting_utr', true);
    // Windowed on po_date, matching the "To Align" bucket in /api/accounts/summary. A PO
    // with no date drops out of any explicit window rather than being assumed recent.
    if (dateFrom) q = q.gte('po_date', dateFrom);
    if (dateTo) q = q.lte('po_date', dateTo);
    if (search) {
        // utr is included because "which PO was this UTR for" is a real question the
        // accounts team asks with a reference number in hand.
        const s = search.replace(/[,()]/g, ' ');
        q = q.or(`po_number.ilike.%${s}%,vendor_name.ilike.%${s}%,latest_utr.ilike.%${s}%`);
    }

    q = q.order('is_critical', { ascending: false })
        .order('po_date', { ascending: false, nullsFirst: false })
        .order('po_created_at', { ascending: false });

    const from = (page - 1) * pageSize;
    const { data, error, count } = await q.range(from, from + pageSize - 1);

    const filters = {
        status: rawStatus, vendor, readiness, search: search || null,
        critical_only: criticalOnly, date_from: dateFrom, date_to: dateTo,
    };

    if (error) {
        // The view does not exist yet: a deployment state, not a failure. Answered as such
        // so the UI can show "not set up" instead of a red error the user cannot act on.
        if (error.code === UNDEFINED_TABLE) {
            const setup: TrackerResponse = {
                organization_id: access.organizationId,
                provisioned: false,
                rows: [],
                pagination: { page, page_size: pageSize, total: 0, total_pages: 0 },
                can: { align: access.canAlign, complete: access.canComplete, admin: access.isAdmin },
                filters,
                generated_at: new Date().toISOString(),
            };
            return NextResponse.json(setup);
        }
        console.error('Payment tracker list error:', error);
        return NextResponse.json({ error: 'Failed to read the payment tracker' }, { status: 500 });
    }

    const total = count || 0;
    const body: TrackerResponse = {
        organization_id: access.organizationId,
        provisioned: true,
        rows: (data || []).map(normalise),
        pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
        can: { align: access.canAlign, complete: access.canComplete, admin: access.isAdmin },
        filters,
        generated_at: new Date().toISOString(),
    };
    return NextResponse.json(body);
}
