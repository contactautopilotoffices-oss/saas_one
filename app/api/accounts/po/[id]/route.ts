import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { signPoDocuments } from '@/backend/lib/accounts/documents';
import { REQUIRED_VENDOR_DOCS, legacyPaymentStatus } from '@/backend/lib/accounts/trackerTypes';
import type {
    PoDetailResponse, PoDetailPo, PaymentTranche, PoDocument, VendorDocument,
    VendorProfile, PoActivityEntry, VendorDocType,
} from '@/backend/lib/accounts/trackerTypes';

/**
 * GET /api/accounts/po/[id] — everything the PO detail page renders, in one round trip.
 *
 * PO + tranches + PO documents + vendor profile + vendor documents + the full activity
 * timeline. One request, because six sequential fetches from the browser is how a detail
 * page ends up half-rendered with three spinners.
 *
 * DEGRADED MODE: if the compliance migrations have not been applied, the PO header and its
 * tranches still come back (read straight from the base tables) with `provisioned: false`
 * and empty compliance sections. Half a page of REAL data beats a whole page of nothing,
 * and the flag says plainly which half is missing.
 */

const UNDEFINED_TABLE = '42P01';
const ACTIVITY_PAGE = 1000;
const ACTIVITY_MAX = 5000;

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const nameOf = (u: unknown): string | null =>
    (u && typeof u === 'object' ? ((u as { full_name?: string | null }).full_name ?? null) : null);

const PAYMENT_SELECT = `*,
    aligner:users!po_payments_aligned_by_fkey(id, full_name),
    completer:users!po_payments_completed_by_fkey(id, full_name),
    creator:users!po_payments_created_by_fkey(id, full_name)`;

function mapPayments(rows: Record<string, any>[]): PaymentTranche[] {
    return rows.map((p) => ({
        ...p,
        requested_amount: num(p.requested_amount),
        percent_of_po: numOrNull(p.percent_of_po),
        gst_hold: num(p.gst_hold),
        tds: num(p.tds),
        paid_amount: numOrNull(p.paid_amount),
        aligned_by_name: nameOf(p.aligner),
        completed_by_name: nameOf(p.completer),
        created_by_name: nameOf(p.creator),
    })) as PaymentTranche[];
}

/** The view's row, plus the aliases the detail workspace reads. */
function toDetailPo(row: Record<string, any>): PoDetailPo {
    const counts = {
        tranche_count: num(row.tranche_count),
        aligned_count: num(row.aligned_count),
        completed_count: num(row.completed_count),
        cancelled_count: num(row.cancelled_count),
    };
    return {
        ...row,
        ...counts,
        to_align_count: num(row.to_align_count),
        po_amount: num(row.po_amount),
        requested_total: num(row.requested_total),
        paid_total: num(row.paid_total),
        unaligned_amount: num(row.unaligned_amount),
        outstanding_amount: num(row.outstanding_amount),
        percent_committed: numOrNull(row.percent_committed),
        latest_requested_amount: numOrNull(row.latest_requested_amount),
        latest_percent_of_po: numOrNull(row.latest_percent_of_po),
        id: row.po_id,
        status: row.po_status ?? null,
        payment_status: legacyPaymentStatus(counts),
        pending_amount: num(row.unaligned_amount),
        // Money committed but not yet disbursed — requested minus paid.
        aligned_total: Math.max(0, num(row.requested_total) - num(row.paid_total)),
        completed_total: num(row.paid_total),
        utr_no: row.latest_utr ?? null,
        compliance_status: row.vendor_compliance_status ?? null,
        outstanding: num(row.outstanding_amount),
        documents_missing: row.missing_required_docs ? row.missing_required_docs.length : null,
        updated_at: row.po_updated_at,
    } as PoDetailPo;
}

/**
 * The same header assembled from the base tables when po_tracker_rows does not exist yet.
 * Every compliance field is null/0 — none of them are knowable without the migration, and
 * a fabricated 'ready' on an unprovisioned org is exactly the kind of plausible default
 * that gets a payment released.
 */
function degradedPo(po: Record<string, any>, payments: PaymentTranche[]): PoDetailPo {
    const live = payments.filter((p) => p.status !== 'cancelled');
    const counts = {
        tranche_count: live.length,
        aligned_count: live.filter((p) => p.status === 'aligned').length,
        completed_count: live.filter((p) => p.status === 'completed').length,
        cancelled_count: payments.length - live.length,
    };
    const requestedTotal = live.reduce((a, p) => a + num(p.requested_amount), 0);
    const paidTotal = live
        .filter((p) => p.status === 'completed')
        .reduce((a, p) => a + num(p.paid_amount ?? p.requested_amount), 0);
    const amount = num(po.po_amount);
    const lastCompleted = live
        .filter((p) => p.status === 'completed' && p.utr_no)
        .sort((a, b) => String(a.completed_at || '').localeCompare(String(b.completed_at || '')))
        .pop();

    return {
        po_id: po.id,
        id: po.id,
        organization_id: po.organization_id,
        po_number: po.po_number,
        vendor_name: po.vendor_name ?? null,
        vendor_id: po.vendor_id ?? null,
        zoho_po_id: po.zoho_po_id ?? null,
        po_amount: amount,
        currency: po.currency ?? 'INR',
        po_date: po.po_date ?? null,
        delivery_date: po.delivery_date ?? null,
        department: po.department ?? null,
        project_name: po.project_name ?? null,
        property_id: po.property_id ?? null,
        category: po.category ?? null,
        source: po.source ?? 'manual',
        po_status: po.status ?? null,
        status: po.status ?? null,
        po_approval_state: null,
        is_payable: !['cancelled', 'draft'].includes(String(po.status || '').toLowerCase()),
        po_created_at: po.created_at,
        po_updated_at: po.updated_at,
        ...counts,
        to_align_count: live.filter((p) => p.status === 'to_align').length,
        requested_total: requestedTotal,
        paid_total: paidTotal,
        unaligned_amount: Math.max(0, amount - requestedTotal),
        outstanding_amount: Math.max(0, amount - paidTotal),
        percent_committed: null,
        latest_payment_status: live.length ? live[live.length - 1].status : null,
        latest_tranche_no: live.length ? live[live.length - 1].tranche_no : null,
        latest_requested_amount: live.length ? num(live[live.length - 1].requested_amount) : null,
        latest_percent_of_po: null,
        latest_payment_updated_at: live.length ? live[live.length - 1].updated_at : null,
        latest_utr: lastCompleted?.utr_no ?? null,
        latest_payment_date: lastCompleted?.payment_date ?? null,
        latest_completed_at: lastCompleted?.completed_at ?? null,
        awaiting_utr: counts.aligned_count > 0,
        // Same precedence as the view's payment_state CASE — computed, never assumed.
        payment_state:
            counts.tranche_count === 0 ? (counts.cancelled_count > 0 ? 'cancelled' : 'not_requested')
                : live.some((p) => p.status === 'to_align') ? 'to_align'
                    : counts.aligned_count > 0 ? 'aligned'
                        : amount - paidTotal > 0.5 ? 'partially_paid'
                            : 'paid',
        vendor_profile_id: null,
        vendor_compliance_status: null,
        gstin: null, pan: null, udyam_number: null, msme_category: null,
        vendor_verified_at: null, vendor_has_bank_details: false,
        required_docs_total: REQUIRED_VENDOR_DOCS.length,
        required_docs_verified: 0,
        missing_required_docs: null,
        expired_docs_count: 0, rejected_docs_count: 0,
        po_document_count: 0, has_tax_invoice: false, tax_invoice_verified: false,
        readiness: 'blocked_no_vendor_profile',
        is_critical: false, critical_reason: null, critical_raised_at: null, assigned_spoc: null,
        last_activity_at: null,
        payment_status: legacyPaymentStatus(counts),
        pending_amount: Math.max(0, amount - requestedTotal),
        aligned_total: Math.max(0, requestedTotal - paidTotal),
        completed_total: paidTotal,
        outstanding: Math.max(0, amount - paidTotal),
        utr_no: lastCompleted?.utr_no ?? null,
        compliance_status: null,
        documents_missing: null,
        updated_at: po.updated_at,
    } as PoDetailPo;
}

const emptyResponse = (orgId: string, access: { canAlign: boolean; canComplete: boolean; isAdmin: boolean }): PoDetailResponse => ({
    organization_id: orgId,
    provisioned: false,
    po: null,
    payments: [],
    documents: [],
    vendor: null,
    vendor_documents: [],
    missing_required_docs: null,
    activity: [],
    can: { align: access.canAlign, complete: access.canComplete, admin: access.isAdmin },
    generated_at: new Date().toISOString(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    // The tracker view is the source of truth for the header: the detail page and the sheet
    // must never show different totals for the same PO.
    const { data: poRow, error: poErr } = await supabaseAdmin
        .from('po_tracker_rows').select('*')
        .eq('po_id', id).eq('organization_id', access.organizationId).maybeSingle();

    if (poErr && poErr.code !== UNDEFINED_TABLE) {
        console.error('PO detail error:', poErr);
        return NextResponse.json({ error: 'Failed to read the purchase order' }, { status: 500 });
    }

    // ---------------------------------------------------- degraded (pre-migration) mode
    if (poErr) {
        const { data: po } = await supabaseAdmin
            .from('zoho_purchase_orders').select('*')
            .eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
        if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const { data: pays } = await supabaseAdmin
            .from('po_payments').select(PAYMENT_SELECT)
            .eq('po_id', id).eq('organization_id', access.organizationId)
            .order('tranche_no', { ascending: true }).range(0, 499);
        const payments = mapPayments((pays || []) as Record<string, any>[]);
        return NextResponse.json({
            ...emptyResponse(access.organizationId, access),
            po: degradedPo(po, payments),
            payments,
        } satisfies PoDetailResponse);
    }

    if (!poRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const po = toDetailPo(poRow);

    const [paymentsRes, docsRes, vendorDocsRes, profileRes] = await Promise.all([
        supabaseAdmin
            .from('po_payments').select(PAYMENT_SELECT)
            .eq('po_id', id).eq('organization_id', access.organizationId)
            .order('tranche_no', { ascending: true })
            .range(0, 499),
        supabaseAdmin
            .from('po_documents')
            .select('*, uploader:users!po_documents_uploaded_by_fkey(id, full_name)')
            .eq('po_id', id).eq('organization_id', access.organizationId)
            .order('created_at', { ascending: false })
            .range(0, 499),
        po.vendor_profile_id
            ? supabaseAdmin.from('vendor_documents').select('*')
                .eq('vendor_profile_id', po.vendor_profile_id)
                .eq('organization_id', access.organizationId)
                .order('doc_type', { ascending: true })
                .range(0, 199)
            : Promise.resolve({ data: [], error: null } as any),
        po.vendor_profile_id
            ? supabaseAdmin.from('vendor_profiles').select('*')
                .eq('id', po.vendor_profile_id)
                .eq('organization_id', access.organizationId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null } as any),
    ]);

    const payments = mapPayments((paymentsRes.data || []) as Record<string, any>[]);

    const rawDocs = (docsRes.data || []) as Record<string, any>[];
    const signed = await signPoDocuments(rawDocs.map((d) => d.file_url));
    const documents: PoDocument[] = rawDocs.map((d, i) => ({
        ...d,
        invoice_amount: numOrNull(d.invoice_amount),
        gst_amount: numOrNull(d.gst_amount),
        uploaded_by_name: nameOf(d.uploader),
        signed_url: signed[i],
    })) as PoDocument[];

    const today = new Date().toISOString().slice(0, 10);
    const vendorDocuments: VendorDocument[] = ((vendorDocsRes.data || []) as Record<string, any>[]).map((d) => ({
        ...d,
        // Surfaced as its own flag: "verified in 2023, expired in 2024" is a different
        // problem from "never sent", and the checklist must not call the first one done.
        is_expired: d.status === 'verified' && !!d.expires_on && d.expires_on < today,
    })) as VendorDocument[];

    const currentlyVerified = new Set(
        vendorDocuments.filter((d) => d.status === 'verified' && !d.is_expired).map((d) => d.doc_type),
    );
    const missingRequired: VendorDocType[] | null = po.vendor_profile_id
        ? REQUIRED_VENDOR_DOCS.filter((t) => !currentlyVerified.has(t))
        : null;

    // The timeline, oldest first — it reads as a story. Paged explicitly; a long-running PO
    // can outgrow PostgREST's 1000-row cap and a truncated audit trail is a false one.
    const activity: PoActivityEntry[] = [];
    for (let from = 0; from < ACTIVITY_MAX; from += ACTIVITY_PAGE) {
        const { data, error } = await supabaseAdmin
            .from('po_activity_log').select('*')
            .eq('po_id', id).eq('organization_id', access.organizationId)
            .order('created_at', { ascending: true })
            .range(from, from + ACTIVITY_PAGE - 1);
        if (error) {
            console.error('PO activity read failed:', error.message);
            break;
        }
        activity.push(...((data || []) as PoActivityEntry[]));
        if ((data || []).length < ACTIVITY_PAGE) break;
    }

    const body: PoDetailResponse = {
        organization_id: access.organizationId,
        provisioned: true,
        po,
        payments,
        documents,
        vendor: (profileRes.data as VendorProfile | null) ?? null,
        vendor_documents: vendorDocuments,
        missing_required_docs: missingRequired,
        activity,
        can: { align: access.canAlign, complete: access.canComplete, admin: access.isAdmin },
        generated_at: new Date().toISOString(),
    };
    return NextResponse.json(body);
}
