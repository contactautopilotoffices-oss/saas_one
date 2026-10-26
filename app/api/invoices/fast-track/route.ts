/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
/**
 * Fast-track payment exceptions.
 *
 * GET  ?org_id=&view=pending|to_align|invoice_pending|mine|all&page=
 * POST {org_id, po_id, requested_amount, urgency_reason, evidence:[{upload_id, filename, purpose}]}
 *      Header Idempotency-Key: the same key never creates a second request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { requireInvoiceAccess, isInvoiceAccessError } from '@/backend/lib/invoices/access';
import { createFastTrack, effectiveStatus } from '@/backend/lib/invoices/fasttrack';
import { isDocOverdue } from '@/backend/lib/invoices/docState';
import { dbError, pageParams, send } from '@/backend/lib/invoices/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const a = await requireInvoiceAccess(request);
    if (isInvoiceAccessError(a)) return a;
    const sp = new URL(request.url).searchParams;
    const { page, size, from, to } = pageParams(sp);
    const view = sp.get('view') || 'all';

    let q = supabaseAdmin.from('invoice_fast_track_requests').select(
        '*, po:zoho_purchase_orders(po_number, vendor_name, po_amount, project_name), requester:users!invoice_fast_track_requests_requested_by_fkey(id, full_name), payment:po_payments(status, utr_no, payment_date, paid_amount)',
        { count: 'exact' },
    ).eq('organization_id', a.orgId);

    if (view === 'pending') q = q.eq('status', 'pending_approval');
    else if (view === 'to_align') q = q.eq('status', 'approved');
    else if (view === 'invoice_pending') q = q.not('status', 'in', '(rejected,cancelled)').not('documentation_state', 'in', '(closed,waived_by_policy)').in('status', ['approved', 'alignment_in_progress', 'aligned']);
    else if (view === 'mine') q = q.eq('requested_by', a.userId);

    const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, to);
    if (error) return dbError(error);

    return NextResponse.json({
        items: (data ?? []).map((r) => {
            const pay = Array.isArray(r.payment) ? r.payment[0] : r.payment;
            const { evidence, ...rest } = r;
            return {
                ...rest,
                requested_amount: Number(r.requested_amount),
                approved_amount: r.approved_amount == null ? null : Number(r.approved_amount),
                effective_status: effectiveStatus(r.status, pay),
                doc_overdue: isDocOverdue(r.documentation_state, r.doc_due_at),
                evidence_count: Array.isArray(evidence) ? evidence.length : 0,
                // The asker can never be the decider, whatever their role.
                is_mine: r.requested_by === a.userId,
            };
        }),
        pagination: { page, page_size: size, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / size) },
    }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as Record<string, any> | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const a = await requireInvoiceAccess(request, body);
    if (isInvoiceAccessError(a)) return a;
    return send(await createFastTrack(a, body, request.headers.get('idempotency-key')?.slice(0, 120) || null));
}
