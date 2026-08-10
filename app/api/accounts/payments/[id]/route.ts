import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { notifyPaymentCompleted, notifyPaymentCancelled, notifyPaymentAligned } from '@/backend/lib/accounts/notify';
import { planPaymentTransition, paymentActorFromAccess } from '@/backend/lib/accounts/transitions';
import { logPoActivity } from '@/backend/lib/accounts/activity';
import type { PoActivityAction } from '@/backend/lib/accounts/trackerTypes';

const SELECT = `
    *,
    po:zoho_purchase_orders(id, po_number, vendor_name, po_amount, department, project_name, category),
    aligner:users!po_payments_aligned_by_fkey(id, full_name),
    completer:users!po_payments_completed_by_fkey(id, full_name),
    creator:users!po_payments_created_by_fkey(id, full_name)
`;

// Which timeline entry each transition leaves behind. 'update' has no dedicated action in
// the po_activity_log CHECK list, so an edit is recorded as a comment — an honest label
// beats stretching 'aligned' to mean "someone changed the amount".
const ACTIVITY_FOR: Record<string, PoActivityAction> = {
    align: 'aligned',
    complete: 'completed',
    cancel: 'cancelled',
    update: 'comment',
};

// PATCH /api/accounts/payments/[id] — align (promote a requested tranche) | complete (UTR)
//                                     | update (edit tranche) | cancel
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body?.action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;

    const { data: pay } = await supabaseAdmin
        .from('po_payments').select('*').eq('id', id).eq('organization_id', access.organizationId).maybeSingle();
    if (!pay) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // The PO's value is what percent_of_po is a percentage OF; without it an edited amount
    // could silently contradict the stored percentage.
    const { data: po } = await supabaseAdmin
        .from('zoho_purchase_orders').select('id, po_amount')
        .eq('id', pay.po_id).eq('organization_id', access.organizationId).maybeSingle();

    const now = new Date().toISOString();
    const fromStatus: string = pay.status;

    // Shared with the one-click email actions — see backend/lib/accounts/transitions.ts.
    const plan = planPaymentTransition({
        pay, actor: paymentActorFromAccess(access), action: body.action, body, now,
        poAmount: po?.po_amount ?? null,
    });
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });

    const { data: updated, error } = await supabaseAdmin
        .from('po_payments').update(plan.patch).eq('id', id).select(SELECT).single();
    if (error) {
        console.error('Payment PATCH error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Timeline. Completion writes TWO entries on purpose: the status change and the UTR
    // itself, because "when did the UTR land" is the question this log gets asked most.
    const activityAction = ACTIVITY_FOR[body.action] ?? 'comment';
    await logPoActivity({
        organizationId: access.organizationId,
        poId: updated.po_id,
        paymentId: updated.id,
        action: activityAction,
        fromStatus,
        toStatus: updated.status,
        actorId: access.user.id,
        note: body.action === 'update' ? 'Tranche edited' : null,
        detail: {
            tranche_no: updated.tranche_no,
            requested_amount: Number(updated.requested_amount),
            percent_of_po: updated.percent_of_po ?? null,
            ...(body.action === 'complete' ? { paid_amount: Number(updated.paid_amount ?? updated.requested_amount) } : {}),
            ...(body.action === 'cancel' && updated.remarks ? { reason: updated.remarks } : {}),
        },
    });
    if (body.action === 'complete' && updated.utr_no) {
        await logPoActivity({
            organizationId: access.organizationId,
            poId: updated.po_id,
            paymentId: updated.id,
            action: 'utr_recorded',
            actorId: access.user.id,
            note: `UTR ${updated.utr_no}`,
            detail: {
                utr_no: updated.utr_no,
                payment_date: updated.payment_date,
                paid_amount: Number(updated.paid_amount ?? updated.requested_amount),
            },
        });
    }

    // The state machine decides who hears about it, so the API and the emailed one-click
    // path announce the same transitions. aligned_by / created_by are passed so both the
    // procurement user waiting on this tranche and whoever raised it are mailed.
    if (plan.notifyKind === 'completed') {
        notifyPaymentCompleted({
            organization_id: access.organizationId,
            po_number: updated.po_number, vendor_name: updated.vendor_name,
            paid_amount: updated.paid_amount, requested_amount: updated.requested_amount,
            utr_no: updated.utr_no, payment_date: updated.payment_date, payment_term: updated.payment_term,
            aligned_by: updated.aligned_by, created_by: updated.created_by,
        }).catch(() => {});
    } else if (plan.notifyKind === 'cancelled') {
        notifyPaymentCancelled({
            organization_id: access.organizationId,
            po_number: updated.po_number, vendor_name: updated.vendor_name,
            requested_amount: updated.requested_amount, tranche_no: updated.tranche_no,
            aligned_by: updated.aligned_by, reason: updated.remarks,
        }).catch(() => {});
    } else if (plan.notifyKind === 'aligned') {
        // Reached only by promoting a to_align tranche; finance is told it is now theirs.
        notifyPaymentAligned({
            id: updated.id,
            organization_id: access.organizationId,
            po_number: updated.po_number, vendor_name: updated.vendor_name,
            tranche_no: updated.tranche_no, requested_amount: updated.requested_amount,
            payment_term: updated.payment_term,
            aligned_by_name: (updated.aligner as any)?.full_name ?? null,
        }).catch(() => {});
    }

    return NextResponse.json({ payment: updated });
}
