/**
 * Invoice Control — what the signed-in person may do, plus the tiles.
 * The UI reads capabilities from here; it never works out permissions itself, and every
 * action route re-checks them server-side regardless.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { isDocOverdue } from '@/backend/lib/invoices/docState';
import { dbError } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;

    const [inv, ft, links] = await Promise.all([
        supabaseAdmin.from('invoices').select('match_status, review_status, extraction_status').eq('organization_id', a.orgId).limit(5000),
        supabaseAdmin.from('invoice_fast_track_requests').select('status, requested_amount, approved_amount, documentation_state, doc_due_at, po_payment_id').eq('organization_id', a.orgId).limit(5000),
        supabaseAdmin.from('invoice_intake_links').select('id', { count: 'exact', head: true }).eq('organization_id', a.orgId).eq('status', 'active').gt('expires_at', new Date().toISOString()),
    ]);
    if (inv.error) return dbError(inv.error);
    if (ft.error) return dbError(ft.error);

    const open = (s: string) => !['accepted', 'rejected', 'resubmission_required'].includes(s);
    const invoices = inv.data ?? [];
    const requests = ft.data ?? [];
    const sum = (rows: typeof requests, pick: (r: (typeof requests)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
    const live = requests.filter((r) => !['rejected', 'cancelled'].includes(r.status));
    const pending = requests.filter((r) => r.status === 'pending_approval');
    const toAlign = requests.filter((r) => r.status === 'approved');
    // Same rule as the Outstanding documents list (fast-track route, view=invoice_pending), so the badge equals the list.
    const alignedDocsPending = requests.filter((r) => ['approved', 'alignment_in_progress', 'aligned'].includes(r.status) && !['closed', 'waived_by_policy'].includes(r.documentation_state));
    const overdue = live.filter((r) => isDocOverdue(r.documentation_state, r.doc_due_at));

    return NextResponse.json({
        org_id: a.orgId,
        caps: {
            can_generate_link: a.canGenerateLink, can_raise_fast_track: a.canRaiseFastTrack, can_resolve_soft: a.canResolveSoft,
            can_resolve_blocking: a.canResolveBlocking, can_accept: a.canAccept, can_decide: a.canDecide,
            can_decide_above_limit: a.canDecideAboveLimit, can_align: a.canAlign, can_configure: a.canConfigure,
        },
        policy: { approval_limit: a.settings.approval_limit, doc_deadline_days: a.settings.doc_deadline_days, max_file_mb: a.settings.max_file_mb, link_expiry_hours: a.settings.link_expiry_hours, evidence_required: a.settings.evidence_required },
        invoices: {
            total: invoices.length,
            needs_review: invoices.filter((i) => open(i.review_status) && ['needs_review', 'duplicate_suspected'].includes(i.match_status)).length,
            mismatched: invoices.filter((i) => open(i.review_status) && i.match_status === 'mismatched').length,
            matched_awaiting_accounts: invoices.filter((i) => open(i.review_status) && i.match_status === 'matched').length,
            processing: invoices.filter((i) => ['pending', 'processing'].includes(i.extraction_status)).length,
            accepted: invoices.filter((i) => i.review_status === 'accepted').length,
        },
        fast_track: {
            pending_approval: { count: pending.length, value: sum(pending, (r) => Number(r.requested_amount)) },
            approved_to_align: { count: toAlign.length, value: sum(toAlign, (r) => Number(r.approved_amount ?? r.requested_amount)) },
            aligned_invoice_pending: { count: alignedDocsPending.length, value: sum(alignedDocsPending, (r) => Number(r.approved_amount ?? r.requested_amount)) },
            overdue_documents: overdue.length,
        },
        active_links: links.count ?? 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
