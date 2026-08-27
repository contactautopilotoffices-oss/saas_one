/**
 * The petty-cash lifecycle state machine, in one place.
 *
 * Extracted from app/api/petty-cash/[id]/route.ts so that the one-click email
 * actions (app/api/email-actions/[token]/route.ts) enforce exactly the same
 * guards — status preconditions AND permission checks — rather than a second,
 * drifting copy. A pure function: it decides, the caller writes.
 */

export type PettyCashAction =
    | 'approve' | 'reject' | 'send_back' | 'resubmit'
    | 'pay' | 'settle' | 'close' | 'cancel';

export type PettyCashNotifyKind =
    | 'submitted' | 'approved' | 'rejected' | 'sent_back' | 'paid' | 'settlement_submitted' | 'closed';

/** The permissions slice of PettyCashAccess that the state machine needs. */
export interface TransitionActor {
    id: string;
    isAdmin: boolean;
    canApprove: boolean;
    canDisburse: boolean;
    propertyIds: string[];
}

/** Narrow a resolved PettyCashAccess down to what the state machine needs. */
export const actorFromAccess = (a: {
    user: { id: string };
    isAdmin: boolean;
    canApprove: boolean;
    canDisburse: boolean;
    propertyIds: string[];
}): TransitionActor => ({
    id: a.user.id,
    isAdmin: a.isAdmin,
    canApprove: a.canApprove,
    canDisburse: a.canDisburse,
    propertyIds: a.propertyIds,
});

export interface TransitionInput {
    req: Record<string, any>;
    actor: TransitionActor;
    action: string;
    body: Record<string, any>;
    now?: string;
}

export type TransitionPlan =
    | { ok: true; patch: Record<string, unknown>; notifyKind: PettyCashNotifyKind | null }
    | { ok: false; error: string; status: number };

const badState = (status: string): TransitionPlan =>
    ({ ok: false, error: `Action not allowed from status "${status}"`, status: 409 });
const forbidden = (): TransitionPlan => ({ ok: false, error: 'Forbidden', status: 403 });

export function planPettyCashTransition({ req, actor, action, body, now }: TransitionInput): TransitionPlan {
    const stamp = now || new Date().toISOString();
    const isOwner = req.requester_id === actor.id;
    const isApproverOfProperty = actor.canApprove && (actor.isAdmin || actor.propertyIds.includes(req.property_id));
    const remark = (body.remark ?? body.remarks ?? '').toString().trim() || null;

    const base: Record<string, unknown> = { updated_at: stamp };

    switch (action) {
        case 'approve':
            if (req.status !== 'submitted') return badState(req.status);
            if (!isApproverOfProperty) return forbidden();
            return {
                ok: true,
                patch: {
                    ...base, status: 'approved', approver_id: actor.id, approved_at: stamp,
                    approved_amount: body.approved_amount != null ? Number(body.approved_amount) : req.amount_requested,
                    approval_remarks: remark,
                },
                notifyKind: 'approved',
            };

        case 'reject':
            if (req.status !== 'submitted') return badState(req.status);
            if (!isApproverOfProperty) return forbidden();
            if (!remark) return { ok: false, error: 'A reason is required to reject', status: 400 };
            return {
                ok: true,
                patch: { ...base, status: 'rejected', approver_id: actor.id, approved_at: stamp, approval_remarks: remark },
                notifyKind: 'rejected',
            };

        case 'send_back':
            if (req.status !== 'submitted') return badState(req.status);
            if (!isApproverOfProperty) return forbidden();
            return { ok: true, patch: { ...base, status: 'sent_back', approval_remarks: remark }, notifyKind: 'sent_back' };

        case 'resubmit': {
            if (req.status !== 'sent_back') return badState(req.status);
            if (!isOwner) return forbidden();
            const patch: Record<string, unknown> = { ...base, status: 'submitted' };
            // Allow correcting the editable fields on resubmit.
            for (const f of ['department', 'category', 'purpose', 'payment_mode', 'vendor_name'] as const) {
                if (body[f] !== undefined) patch[f] = body[f];
            }
            if (body.amount_requested != null && Number(body.amount_requested) > 0) {
                patch.amount_requested = Number(body.amount_requested);
            }
            return { ok: true, patch, notifyKind: 'submitted' };
        }

        case 'pay':
            if (req.status !== 'approved') return badState(req.status);
            if (!actor.canDisburse) return forbidden();
            return {
                ok: true,
                patch: {
                    ...base, status: 'paid', paid_by: actor.id, paid_at: body.paid_at || stamp,
                    paid_amount: body.paid_amount != null ? Number(body.paid_amount) : (req.approved_amount ?? req.amount_requested),
                    paid_mode: body.paid_mode ?? req.payment_mode ?? null, payment_ref: body.payment_ref ?? null,
                },
                notifyKind: 'paid',
            };

        case 'settle':
            if (req.status !== 'paid' && req.status !== 'settlement_submitted') return badState(req.status);
            if (!isOwner) return forbidden();
            return {
                ok: true,
                patch: {
                    ...base, status: 'settlement_submitted', settled_at: stamp,
                    actual_spent: body.actual_spent != null ? Number(body.actual_spent) : null,
                    amount_returned: body.amount_returned != null ? Number(body.amount_returned) : null,
                    extra_claimed: body.extra_claimed != null ? Number(body.extra_claimed) : null,
                    settlement_remarks: remark,
                },
                notifyKind: 'settlement_submitted',
            };

        case 'close':
            if (req.status !== 'settlement_submitted') return badState(req.status);
            if (!actor.canDisburse) return forbidden();
            return {
                ok: true,
                patch: { ...base, status: 'closed', closed_by: actor.id, closed_at: stamp, close_remarks: remark },
                notifyKind: 'closed',
            };

        case 'cancel':
            if (['closed', 'cancelled'].includes(req.status)) return badState(req.status);
            if (!isOwner && !actor.isAdmin) return forbidden();
            return { ok: true, patch: { ...base, status: 'cancelled', remarks: remark ?? req.remarks }, notifyKind: null };

        default:
            return { ok: false, error: `Unknown action: ${action}`, status: 400 };
    }
}
