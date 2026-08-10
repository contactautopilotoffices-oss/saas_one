/**
 * The PO payment lifecycle state machine, in one place.
 *
 * Same pattern as backend/lib/pettyCash/transitions.ts: a pure function that decides,
 * while the caller writes. Shared by the API routes and the one-click email actions so
 * both enforce identical guards — a second copy would drift, and drift in a payment
 * approval path means money moving on stale rules.
 *
 * Statuses come from the CHECK constraint on po_payments:
 *   to_align -> aligned -> completed | cancelled
 *
 * 'request' creates a tranche in to_align ("yet to be aligned") and 'align' then promotes
 * it. 'align' with no existing row still creates one straight in `aligned`, which is what
 * the tracker has always done — procurement raising and aligning in a single step.
 *
 * Nothing here ever writes to zoho_purchase_orders: that table is fully overwritten by
 * the Zoho Books sync every two hours, so all workflow state lives on po_payments.
 */

export type PaymentAction = 'request' | 'align' | 'complete' | 'update' | 'cancel';

/** Which intimation the caller should fire once the write lands. */
export type PaymentNotifyKind = 'requested' | 'aligned' | 'completed' | 'cancelled';

/** The permissions slice of AccountsAccess the state machine needs. */
export interface PaymentActor {
    id: string;
    isAdmin: boolean;
    canAlign: boolean;
    canComplete: boolean;
}

export interface PaymentTransitionInput {
    /** The po_payments row being transitioned; null for 'request'/'align', which create one. */
    pay: Record<string, any> | null;
    actor: PaymentActor;
    action: string;
    body: Record<string, any>;
    now?: string;
    /**
     * The parent PO's value. Required only to validate percent_of_po against
     * requested_amount — the caller has already fetched the PO to fill the identity
     * columns, so this costs nothing extra.
     */
    poAmount?: number | string | null;
}

export type PaymentPlan =
    | {
        ok: true;
        patch: Record<string, unknown>;
        /** Which intimation the caller fires once the write lands; null = stay quiet. */
        notifyKind: PaymentNotifyKind | null;
    }
    | { ok: false; error: string; status: number };

/** Narrow a resolved AccountsAccess down to what the state machine needs. */
export const paymentActorFromAccess = (a: {
    user: { id: string };
    isAdmin: boolean;
    canAlign: boolean;
    canComplete: boolean;
}): PaymentActor => ({
    id: a.user.id,
    isAdmin: a.isAdmin,
    canAlign: a.canAlign,
    canComplete: a.canComplete,
});

const forbidden = (): PaymentPlan => ({ ok: false, error: 'Forbidden', status: 403 });

/**
 * The books are kept in IST but the server runs UTC, so a calendar DATE derived from
 * `toISOString().slice(0,10)` is the UTC day, not the Indian one. Anything recorded
 * between 00:00 and 05:30 IST would be stamped with the PREVIOUS day — silently dropping
 * it out of "today" and, on the 1st, out of the whole month in the finance overview.
 */
export function istDay(iso: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
}

/**
 * Rupee tolerance between percent_of_po × po_amount and the requested amount.
 *
 * A percentage slider that silently disagrees with the amount it produced is worse than
 * no slider: the tranche then claims "this is the agreed 30%" while paying something else.
 * NUMERIC(14,2) rounding on a large PO is worth at most a few paise, so 1 rupee is slack
 * for human rounding, not for a different number.
 */
const PERCENT_TOLERANCE_INR = 1;

/**
 * ...but the column is NUMERIC(5,2), so a percentage can only be stored to two decimals.
 * A user who types an amount and lets the UI derive the share (33333 on a 100000 PO -> 33.33%)
 * is already half a hundredth of a percent away from their own number BEFORE the server sees
 * it. Demanding agreement finer than the column can represent would reject correct input, so
 * the floor of 1 rupee widens to whatever half a stored quantum is worth on this PO
 * (0.005% of its value). A slider that says 30% against a 25% amount is still off by a
 * thousand times this and is still refused.
 */
const PERCENT_QUANTUM_FRACTION = 0.00005;

type PercentResult = { ok: true; percent: number | null } | { ok: false; error: string; status: number };

function resolvePercentOfPo(body: Record<string, any>, amount: number, poAmount: number | string | null | undefined): PercentResult {
    const raw = body.percent_of_po;
    if (raw === undefined || raw === null || raw === '') return { ok: true, percent: null };

    const percent = Number(raw);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        return { ok: false, error: 'percent_of_po must be greater than 0 and at most 100', status: 400 };
    }

    const po = Number(poAmount ?? 0);
    // Refusing is the honest move: storing an unvalidated percentage would put a number on
    // the record that nothing in the system stands behind.
    if (!Number.isFinite(po) || po <= 0) {
        return { ok: false, error: 'Cannot record percent_of_po: this PO has no amount to take a percentage of', status: 400 };
    }

    const expected = (percent / 100) * po;
    const tolerance = Math.max(PERCENT_TOLERANCE_INR, po * PERCENT_QUANTUM_FRACTION + 0.005);
    if (Math.abs(expected - amount) > tolerance) {
        return {
            ok: false,
            status: 400,
            error: `percent_of_po ${percent}% of ${po.toFixed(2)} is ${expected.toFixed(2)}, but requested_amount is ${amount.toFixed(2)}`,
        };
    }
    return { ok: true, percent };
}

export function planPaymentTransition({ pay, actor, action, body, now, poAmount }: PaymentTransitionInput): PaymentPlan {
    const stamp = now || new Date().toISOString();
    // Everything except 'request'/'align' transitions a tranche that must already exist.
    if (action !== 'align' && action !== 'request' && !pay) return { ok: false, error: 'Not found', status: 404 };
    const row: Record<string, any> = pay || {};
    const base: Record<string, unknown> = { updated_at: stamp };

    switch (action) {
        case 'request':
        case 'align': {
            if (!actor.canAlign) return forbidden();

            // Promotion: a tranche raised as "yet to be aligned" now gets aligned. The row
            // already exists, so this is an UPDATE and must not re-stamp created_by.
            if (pay) {
                if (action === 'request') return { ok: false, error: 'This tranche already exists', status: 409 };
                if (row.status !== 'to_align') {
                    return { ok: false, error: 'This payment has already been aligned', status: 409 };
                }
                const patch: Record<string, unknown> = {
                    ...base, status: 'aligned', aligned_by: actor.id, aligned_at: stamp,
                };
                if (body.payment_term !== undefined) patch.payment_term = body.payment_term;
                if (body.remarks !== undefined) patch.remarks = body.remarks;
                if (body.gst_hold != null) patch.gst_hold = Number(body.gst_hold);
                if (body.tds != null) patch.tds = Number(body.tds);
                if (body.requested_amount != null && Number(body.requested_amount) > 0) {
                    const amount = Number(body.requested_amount);
                    const pct = resolvePercentOfPo(body, amount, poAmount);
                    if (!pct.ok) return pct;
                    patch.requested_amount = amount;
                    if (pct.percent !== null) patch.percent_of_po = pct.percent;
                }
                return { ok: true, patch, notifyKind: 'aligned' };
            }

            if (!body.po_id) return { ok: false, error: 'po_id is required', status: 400 };
            const amount = Number(body.requested_amount);
            if (!amount || amount <= 0) return { ok: false, error: 'requested_amount must be greater than 0', status: 400 };

            // percent_of_po must agree with the amount it supposedly produced, or neither
            // number can be trusted later.
            const pct = resolvePercentOfPo(body, amount, poAmount);
            if (!pct.ok) return pct;

            const requestedOnly = action === 'request';
            // Identity columns (organization_id, po_id, po_number, vendor_name, tranche_no)
            // are the caller's: they come from a PO lookup, not from the lifecycle.
            return {
                ok: true,
                patch: {
                    requested_amount: amount,
                    // Only written when a percentage was actually supplied. Sending an
                    // explicit null would make every alignment depend on
                    // 20260805000001 having been applied — an unapplied migration would
                    // then break the existing tracker rather than just the new field.
                    ...(pct.percent !== null ? { percent_of_po: pct.percent } : {}),
                    gst_hold: body.gst_hold != null ? Number(body.gst_hold) : 0,
                    tds: body.tds != null ? Number(body.tds) : 0,
                    payment_term: body.payment_term ?? null,
                    status: requestedOnly ? 'to_align' : 'aligned',
                    // A tranche that is only requested has not been aligned by anyone yet;
                    // stamping aligned_by here would credit the alignment to the requester.
                    aligned_by: requestedOnly ? null : actor.id,
                    aligned_at: requestedOnly ? null : stamp,
                    remarks: body.remarks ?? null,
                    created_by: actor.id,
                },
                notifyKind: requestedOnly ? 'requested' : 'aligned',
            };
        }

        case 'complete': {
            if (!actor.canComplete) return forbidden();
            if (row.status !== 'aligned') {
                return { ok: false, error: `Cannot complete from "${row.status}"`, status: 409 };
            }
            // A UTR is the whole point of completion — it is the proof of disbursement.
            // This is why "complete" can never be a one-click email action.
            const utr = String(body.utr_no ?? '').trim();
            if (!utr) return { ok: false, error: 'UTR number is required', status: 400 };
            return {
                ok: true,
                patch: {
                    ...base, status: 'completed', completed_by: actor.id, completed_at: stamp,
                    utr_no: utr,
                    paid_amount: body.paid_amount != null ? Number(body.paid_amount) : row.requested_amount,
                    payment_date: body.payment_date || istDay(stamp),
                    payment_proof_url: body.payment_proof_url ?? null,
                    remarks: body.remarks ?? row.remarks,
                },
                notifyKind: 'completed',
            };
        }

        case 'update': {
            if (!actor.canAlign) return forbidden();
            if (row.status !== 'aligned' && row.status !== 'to_align') {
                return { ok: false, error: 'Only pending payments can be edited', status: 409 };
            }
            const patch: Record<string, unknown> = { ...base };
            for (const f of ['payment_term', 'remarks'] as const) {
                if (body[f] !== undefined) patch[f] = body[f];
            }
            if (body.requested_amount != null && Number(body.requested_amount) > 0) {
                const amount = Number(body.requested_amount);
                // Editing the amount without restating the percentage would leave the stored
                // percent_of_po describing a number that no longer exists. Either the caller
                // sends a percentage that agrees, or the edit is refused — the tranche is
                // never left holding two figures that contradict each other.
                if (body.percent_of_po !== undefined) {
                    const pct = resolvePercentOfPo(body, amount, poAmount);
                    if (!pct.ok) return pct;
                    patch.percent_of_po = pct.percent;
                } else if (row.percent_of_po != null) {
                    const pct = resolvePercentOfPo({ percent_of_po: row.percent_of_po }, amount, poAmount);
                    if (!pct.ok) {
                        return {
                            ok: false, status: 400,
                            error: `${pct.error}. Send percent_of_po alongside requested_amount, or clear it.`,
                        };
                    }
                }
                patch.requested_amount = amount;
            } else if (body.percent_of_po !== undefined) {
                // Percentage alone, amount unchanged: still has to agree with what is stored.
                const pct = resolvePercentOfPo(body, Number(row.requested_amount || 0), poAmount);
                if (!pct.ok) return pct;
                patch.percent_of_po = pct.percent;
            }
            if (body.gst_hold != null) patch.gst_hold = Number(body.gst_hold);
            if (body.tds != null) patch.tds = Number(body.tds);
            return { ok: true, patch, notifyKind: null };
        }

        case 'cancel':
            if (!actor.canAlign && !actor.isAdmin) return forbidden();
            if (row.status === 'completed') {
                return { ok: false, error: 'Completed payments cannot be cancelled', status: 409 };
            }
            if (row.status === 'cancelled') {
                return { ok: false, error: 'This payment was already cancelled', status: 409 };
            }
            return {
                ok: true,
                patch: { ...base, status: 'cancelled', remarks: body.remarks ?? row.remarks },
                notifyKind: 'cancelled',
            };

        default:
            return { ok: false, error: `Unknown action: ${action}`, status: 400 };
    }
}
