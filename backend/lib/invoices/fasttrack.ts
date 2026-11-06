/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untrusted JSON, checked field by field below */
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { planPaymentTransition } from '@/backend/lib/accounts/transitions';
import { logPoActivity } from '@/backend/lib/accounts/activity';
import type { InvoiceAccess } from './access';
import { logInvoiceEvent } from './audit';
import { syncDocumentationState } from './docState';
import { checkPoForInvoicing } from './submission';
import { detectContentType, downloadObject, evidenceObjectPath, isUploadId } from './storage';

/**
 * Fast-track payment exceptions: "the vendor needs paying now, the invoice is not here".
 *
 * Four things this file refuses to let blur together:
 *   1. asking (Purchase)  2. approving (an authorised approver who is not the asker)
 *   3. aligning (Accounts, through the existing payment tracker)  4. the invoice itself.
 * Approval never marks an invoice verified and never flips invoice_pending; alignment is
 * not payment; payment is whatever the tracker row says (completed + UTR), read on demand.
 */

/** ₹ in Indian grouping, rounded to paise, for messages a person reads. */
const rupees = (n: number) => `₹${(Math.round(Number(n) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export interface Reply { status: number; body: Record<string, unknown> }
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
const money = (v: unknown): number | null => {
    const n = Number(v);
    return v != null && v !== '' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** The state shown to people: tracker completion turns 'aligned' into 'payment_recorded'. */
export function effectiveStatus(status: string, payment?: { status?: string | null; utr_no?: string | null } | null): string {
    return status === 'aligned' && payment?.status === 'completed' && payment.utr_no ? 'payment_recorded' : status;
}

// --- 1. ask ----------------------------------------------------------------------

export async function createFastTrack(a: InvoiceAccess, body: Record<string, any>, idempotencyKey: string | null): Promise<Reply> {
    if (!a.canRaiseFastTrack) return reply(403, { error: 'Only Purchase can raise a fast-track request.' });

    if (idempotencyKey) {
        const { data: existing } = await supabaseAdmin.from('invoice_fast_track_requests').select('*')
            .eq('organization_id', a.orgId).eq('idempotency_key', idempotencyKey).maybeSingle();
        if (existing) return reply(200, { request: existing, replay: true });
    }

    const poId = String(body.po_id ?? '');
    const po = await checkPoForInvoicing(a.orgId, poId);
    if (!po.ok) return reply(po.status, { error: po.message });

    const amount = money(body.requested_amount);
    if (amount == null || amount <= 0) return reply(400, { error: 'requested_amount must be greater than 0.' });
    const reason = String(body.urgency_reason ?? '').trim();
    if (reason.length < 10) return reply(400, { error: 'Say why this cannot wait (at least 10 characters).' });

    // What is already being asked for on this PO counts against it.
    const { data: others } = await supabaseAdmin.from('invoice_fast_track_requests').select('requested_amount, approved_amount, status')
        .eq('organization_id', a.orgId).eq('po_id', poId).not('status', 'in', '(rejected,cancelled)');
    const committed = (others ?? []).reduce((s, r) => s + Number(r.approved_amount ?? r.requested_amount ?? 0), 0);
    if (po.po.po_amount != null && amount + committed > po.po.po_amount + a.settings.amount_tolerance) {
        return reply(422, { error: `This would take urgent-payment requests on this PO to ${rupees(committed + amount)}, more than the PO value of ${rupees(po.po.po_amount)}.` });
    }

    const evidence: { storage_path: string; filename: string; purpose: string }[] = [];
    for (const item of (Array.isArray(body.evidence) ? body.evidence : []).slice(0, 5)) {
        if (!isUploadId(item?.upload_id)) return reply(400, { error: 'An evidence file reference is invalid.' });
        const path = evidenceObjectPath(a.orgId, item.upload_id);
        const bytes = await downloadObject(path);
        if (!bytes || !detectContentType(bytes)) return reply(422, { error: 'An evidence file did not upload correctly. Please attach it again.' });
        evidence.push({ storage_path: path, filename: String(item.filename ?? 'evidence').slice(0, 120), purpose: String(item.purpose ?? 'supporting').slice(0, 60) });
    }
    if (a.settings.evidence_required && !evidence.length) return reply(422, { error: 'Attach at least one piece of evidence (delivery proof, site message, etc.).' });

    const dueAt = new Date(Date.now() + a.settings.doc_deadline_days * 86_400_000).toISOString();
    const { data: created, error } = await supabaseAdmin.from('invoice_fast_track_requests').insert({
        organization_id: a.orgId, po_id: poId, requested_by: a.userId, requested_amount: amount,
        urgency_reason: reason, evidence, doc_due_at: dueAt, idempotency_key: idempotencyKey,
        policy_version: a.settings.policy_version,
    }).select('*').single();
    if (error) {
        if (error.code === '23505' && idempotencyKey) {
            const { data: again } = await supabaseAdmin.from('invoice_fast_track_requests').select('*').eq('organization_id', a.orgId).eq('idempotency_key', idempotencyKey).maybeSingle();
            if (again) return reply(200, { request: again, replay: true });
        }
        return reply(500, { error: error.message });
    }

    await logInvoiceEvent({ organizationId: a.orgId, requestId: created.id, poId, actorUserId: a.userId, actorRole: a.roles[0], eventType: 'fast_track_requested',
        details: { requested_amount: amount, reason, evidence_count: evidence.length, policy_version: a.settings.policy_version } });
    await syncDocumentationState(a.orgId, poId);
    return reply(201, { request: created, approval_required: true, invoice_pending: true });
}

// --- 2. approve ------------------------------------------------------------------

export async function decideFastTrack(a: InvoiceAccess, id: string, body: Record<string, any>): Promise<Reply> {
    if (!a.canDecide) return reply(403, { error: 'You are not an approver for fast-track exceptions.' });
    const decision = String(body.decision ?? '');
    if (!['approved', 'rejected', 'needs_information'].includes(decision)) return reply(400, { error: 'decision must be approved, rejected or needs_information.' });
    const reason = String(body.reason ?? '').trim();
    if (reason.length < 3) return reply(400, { error: 'A reason is required.' });

    const { data: req } = await supabaseAdmin.from('invoice_fast_track_requests').select('id, requested_by, requested_amount, status')
        .eq('id', id).eq('organization_id', a.orgId).maybeSingle();
    if (!req) return reply(404, { error: 'Request not found.' });
    if (req.requested_by === a.userId) return reply(403, { error: 'You cannot decide your own request.' });

    let amount: number | null = null;
    if (decision === 'approved') {
        amount = money(body.approved_amount ?? req.requested_amount);
        if (amount == null || amount <= 0 || amount > Number(req.requested_amount)) return reply(422, { error: 'The approved amount must be above 0 and not more than was requested.' });
        if (amount > a.settings.approval_limit && !a.canDecideAboveLimit) {
            return reply(403, { error: `Your approval limit is ${a.settings.approval_limit}. This needs a ${a.settings.escalation_roles.join(' or ')}.`, escalate: true });
        }
    }

    const { data, error } = await supabaseAdmin.rpc('invoice_fast_track_decide', {
        p_org: a.orgId, p_request: id, p_approver: a.userId, p_decision: decision, p_amount: amount, p_reason: reason, p_policy_version: a.settings.policy_version,
    });
    if (error) { console.error('[invoices] decide failed:', error.message); return reply(500, { error: 'Could not record the decision.' }); }
    const r = data as { outcome: string; status?: string };
    switch (r.outcome) {
        case 'ok': return reply(200, { status: r.status, invoice_pending: true });
        case 'not_found': return reply(404, { error: 'Request not found.' });
        case 'invalid_state': return reply(409, { error: `This request is already ${String(r.status).replace(/_/g, ' ')}.` });
        case 'self_approval': return reply(403, { error: 'You cannot decide your own request.' });
        case 'invalid_amount': return reply(422, { error: 'The approved amount must be above 0 and not more than was requested.' });
        default: return reply(422, { error: 'The decision was not accepted.' });
    }
}

// --- 3. align --------------------------------------------------------------------

export async function alignFastTrack(a: InvoiceAccess, id: string, body: Record<string, any>): Promise<Reply> {
    if (!a.canAlign) return reply(403, { error: 'Only Accounts can align a payment.' });

    // Claim first: two clicks, or two people, must not raise two tranches.
    const { data: claimed } = await supabaseAdmin.from('invoice_fast_track_requests')
        .update({ status: 'alignment_in_progress', updated_at: new Date().toISOString() })
        .eq('id', id).eq('organization_id', a.orgId).eq('status', 'approved').select('*').maybeSingle();
    if (!claimed) return reply(409, { error: 'Only an approved request that has not been aligned can be aligned.' });

    const revert = async () => { await supabaseAdmin.from('invoice_fast_track_requests').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', id); };

    const { data: po } = await supabaseAdmin.from('zoho_purchase_orders').select('id, po_number, vendor_name, po_amount').eq('id', claimed.po_id).eq('organization_id', a.orgId).maybeSingle();
    if (!po) { await revert(); return reply(404, { error: 'PO not found.' }); }
    const amount = Number(claimed.approved_amount);

    // The existing tracker warns on over-commitment; do the same here.
    const { data: prior } = await supabaseAdmin.from('po_payments').select('requested_amount').eq('organization_id', a.orgId).eq('po_number', po.po_number).neq('status', 'cancelled');
    const committed = (prior ?? []).reduce((s, p) => s + Number(p.requested_amount || 0), 0);
    if (body.acknowledge_over_commit !== true && Number(po.po_amount) > 0 && committed + amount > Number(po.po_amount) + 0.5) {
        await revert();
        return reply(409, { error: 'payment_exceeds_po', message: `${rupees(committed)} is already lined up against this PO (value ${rupees(Number(po.po_amount))}). Aligning ${rupees(amount)} more would exceed it.`, committed, po_amount: Number(po.po_amount) });
    }

    // The tracker's own state machine decides what an aligned tranche looks like.
    const plan = planPaymentTransition({
        pay: null,
        actor: { id: a.userId, isAdmin: a.canConfigure, canAlign: true, canComplete: false },
        action: 'align',
        body: { po_id: po.id, requested_amount: amount, payment_term: 'Fast-track exception', remarks: `Fast-track exception: ${claimed.urgency_reason}`.slice(0, 500) },
        poAmount: po.po_amount,
    });
    if (!plan.ok) { await revert(); return reply(plan.status, { error: plan.error }); }

    const { data: last } = await supabaseAdmin.from('po_payments').select('tranche_no').eq('po_id', po.id).neq('status', 'cancelled').order('tranche_no', { ascending: false }).limit(1).maybeSingle();
    const { data: pay, error } = await supabaseAdmin.from('po_payments').insert({
        organization_id: a.orgId, po_id: po.id, po_number: po.po_number, vendor_name: po.vendor_name, tranche_no: (last?.tranche_no ?? 0) + 1, ...plan.patch,
    }).select('id, tranche_no, status').single();
    if (error || !pay) { await revert(); return reply(500, { error: error?.message ?? 'Could not create the payment tranche.' }); }

    await supabaseAdmin.from('invoice_fast_track_requests').update({ status: 'aligned', po_payment_id: pay.id, updated_at: new Date().toISOString() }).eq('id', id);
    await logPoActivity({ organizationId: a.orgId, poId: po.id, paymentId: pay.id, action: 'aligned', toStatus: 'aligned', actorId: a.userId,
        note: `Aligned tranche #${pay.tranche_no} under fast-track exception (invoice pending)`, detail: { fast_track_request_id: id, requested_amount: amount } });
    await logInvoiceEvent({ organizationId: a.orgId, requestId: id, poId: po.id, actorUserId: a.userId, actorRole: a.roles[0], eventType: 'fast_track_aligned',
        details: { po_payment_id: pay.id, tranche_no: pay.tranche_no, amount, invoice_pending: true } });
    return reply(200, { status: 'aligned', po_payment_id: pay.id, tranche_no: pay.tranche_no, invoice_pending: true });
}

// --- the requester's own moves ---------------------------------------------------

export async function requesterAction(a: InvoiceAccess, id: string, body: Record<string, any>): Promise<Reply> {
    const action = String(body.action ?? '');
    const { data: req } = await supabaseAdmin.from('invoice_fast_track_requests').select('*').eq('id', id).eq('organization_id', a.orgId).maybeSingle();
    if (!req) return reply(404, { error: 'Request not found.' });

    if (action === 'resubmit') {
        if (req.requested_by !== a.userId) return reply(403, { error: 'Only the person who asked can answer the approver.' });
        if (req.status !== 'needs_information') return reply(409, { error: 'The approver has not asked for more information.' });
        const note = String(body.urgency_reason ?? '').trim();
        const { error } = await supabaseAdmin.from('invoice_fast_track_requests')
            .update({ status: 'pending_approval', ...(note.length >= 10 ? { urgency_reason: note } : {}), updated_at: new Date().toISOString() })
            .eq('id', id).eq('status', 'needs_information');
        if (error) return reply(500, { error: error.message });
        await logInvoiceEvent({ organizationId: a.orgId, requestId: id, poId: req.po_id, actorUserId: a.userId, eventType: 'fast_track_resubmitted', details: { note: note || null } });
        return reply(200, { status: 'pending_approval' });
    }

    if (action === 'cancel') {
        if (req.requested_by !== a.userId && !a.canDecideAboveLimit) return reply(403, { error: 'Only the requester or a super admin can cancel.' });
        const { data: done } = await supabaseAdmin.from('invoice_fast_track_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', id).in('status', ['pending_approval', 'needs_information', 'approved']).select('id').maybeSingle();
        if (!done) return reply(409, { error: 'This request can no longer be cancelled.' });
        await logInvoiceEvent({ organizationId: a.orgId, requestId: id, poId: req.po_id, actorUserId: a.userId, eventType: 'fast_track_cancelled', details: { reason: String(body.reason ?? '').slice(0, 300) } });
        return reply(200, { status: 'cancelled' });
    }
    return reply(400, { error: 'action must be resubmit or cancel.' });
}

// --- 4. the documentation exception ----------------------------------------------

export async function documentationAction(a: InvoiceAccess, id: string, body: Record<string, any>): Promise<Reply> {
    const mode = String(body.mode ?? '');
    const reason = String(body.reason ?? '').trim();
    const { data: req } = await supabaseAdmin.from('invoice_fast_track_requests').select('*').eq('id', id).eq('organization_id', a.orgId).maybeSingle();
    if (!req) return reply(404, { error: 'Request not found.' });
    if (['closed', 'waived_by_policy'].includes(req.documentation_state)) return reply(409, { error: 'The documentation is already closed.' });
    if (['rejected', 'cancelled'].includes(req.status)) return reply(409, { error: 'This request is not active.' });

    if (mode === 'close') {
        if (!a.canAccept) return reply(403, { error: 'Only Accounts can close the documentation.' });
        if (req.documentation_state !== 'reconciled') return reply(409, { error: 'Close needs an accepted invoice. Reconcile the invoice first, or use a policy waiver.' });
        await supabaseAdmin.from('invoice_fast_track_requests').update({ documentation_state: 'closed', invoice_pending: false, doc_closed_by: a.userId, doc_closed_at: new Date().toISOString(), doc_close_reason: reason || 'Invoice accepted', updated_at: new Date().toISOString() }).eq('id', id);
        await logInvoiceEvent({ organizationId: a.orgId, requestId: id, poId: req.po_id, actorUserId: a.userId, eventType: 'documentation_closed', details: { reason } });
        return reply(200, { documentation_state: 'closed' });
    }
    if (mode === 'waive') {
        if (!a.canDecideAboveLimit) return reply(403, { error: 'Only a super admin can waive documentation by policy.' });
        if (reason.length < 10) return reply(400, { error: 'A waiver needs a written reason (at least 10 characters).' });
        // invoice_pending is left true: the invoice is still missing, the requirement is waived.
        await supabaseAdmin.from('invoice_fast_track_requests').update({ documentation_state: 'waived_by_policy', doc_closed_by: a.userId, doc_closed_at: new Date().toISOString(), doc_close_reason: reason, updated_at: new Date().toISOString() }).eq('id', id);
        await logInvoiceEvent({ organizationId: a.orgId, requestId: id, poId: req.po_id, actorUserId: a.userId, eventType: 'documentation_waived', details: { reason, policy_version: a.settings.policy_version } });
        return reply(200, { documentation_state: 'waived_by_policy' });
    }
    return reply(400, { error: 'mode must be close or waive.' });
}
