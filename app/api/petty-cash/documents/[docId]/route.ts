import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';

/**
 * PATCH /api/petty-cash/documents/[docId] — finance review of one settlement bill.
 *
 * PRD §6.2 ("Finance can mark document accepted/rejected with reason"). This is what
 * gives petty_cash_settlement_status.bills_total its meaning: a rejected bill stops
 * counting as accounted for, so the accounted % drops and the gap becomes the
 * custodian's to explain — which is the whole point of reviewing bills at all.
 *
 * Restricted to canDisburse (the `accounts` role + org/master admin), matching who is
 * allowed to close a settlement in backend/lib/pettyCash/transitions.ts.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
    const { docId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolvePettyCashAccess(request, readOrgId(request, body));
    if (isPettyCashAccessError(access)) return access;
    if (!access.canDisburse) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const status = body.review_status;
    if (!['pending', 'accepted', 'rejected'].includes(status)) {
        return NextResponse.json({ error: 'review_status must be pending, accepted or rejected' }, { status: 400 });
    }
    const remarks = (body.review_remarks ?? '').toString().trim() || null;
    // A rejection the custodian cannot act on is not a review.
    if (status === 'rejected' && !remarks) {
        return NextResponse.json({ error: 'A reason is required when rejecting a bill' }, { status: 400 });
    }

    const { data: doc } = await supabaseAdmin
        .from('petty_cash_documents').select('id, request_id, organization_id')
        .eq('id', docId).eq('organization_id', access.organizationId).maybeSingle();
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: updated, error } = await supabaseAdmin
        .from('petty_cash_documents')
        .update({
            review_status: status,
            review_remarks: remarks,
            reviewed_by: status === 'pending' ? null : access.user.id,
            reviewed_at: status === 'pending' ? null : new Date().toISOString(),
        })
        .eq('id', docId)
        .select('*')
        .single();

    if (error) {
        console.error('Petty cash bill review error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin.from('petty_cash_activity').insert({
        request_id: doc.request_id,
        organization_id: access.organizationId,
        actor_id: access.user.id,
        action: `bill_${status}`,
        remark: remarks,
    });

    const { data: reconciliation } = await supabaseAdmin
        .from('petty_cash_settlement_status').select('*').eq('request_id', doc.request_id).maybeSingle();

    return NextResponse.json({ document: updated, reconciliation: reconciliation || null });
}
