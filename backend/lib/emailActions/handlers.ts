import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccessForUser, isPettyCashAccessError } from '@/backend/lib/pettyCash/access';
import { planPettyCashTransition, actorFromAccess } from '@/backend/lib/pettyCash/transitions';
import { notifyPettyCash } from '@/backend/lib/pettyCash/notify';
import { resolveAccountsAccessForUser, isAccountsAccessError } from '@/backend/lib/accounts/access';
import { planPaymentTransition, paymentActorFromAccess } from '@/backend/lib/accounts/transitions';
import { logPoActivity } from '@/backend/lib/accounts/activity';
import type { PoActivityAction } from '@/backend/lib/accounts/trackerTypes';
import type { EmailActionToken } from './tokens';

/**
 * Per-entity handlers for one-click email actions.
 *
 * Each handler re-derives permissions from LIVE memberships at click time (never from
 * anything baked into the token) and then defers to that domain's shared state machine,
 * so an emailed click can never do something the API would refuse.
 *
 * Adding an entity type means adding a case here — the route stays thin.
 */

export type HandlerOutcome =
    | { ok: true; title: string; message: string }
    | { ok: false; status: number; title: string; message: string };

const denied = (): HandlerOutcome => ({
    ok: false, status: 403,
    title: 'You no longer have access',
    message: 'Your permissions for this organisation have changed since this email was sent.',
});

export function isSupportedEntity(entityType: string): boolean {
    return entityType === 'petty_cash_request' || entityType === 'po_payment';
}

export async function handleEmailAction(t: EmailActionToken, remark: string): Promise<HandlerOutcome> {
    if (t.entity_type === 'petty_cash_request') return handlePettyCash(t, remark);
    if (t.entity_type === 'po_payment') return handlePoPayment(t, remark);
    return { ok: false, status: 400, title: 'Unsupported action', message: 'This link refers to something this server cannot action.' };
}

async function handlePettyCash(t: EmailActionToken, remark: string): Promise<HandlerOutcome> {
    const access = await resolvePettyCashAccessForUser({ id: t.user_id }, t.organization_id);
    if (isPettyCashAccessError(access)) return denied();

    const { data: req } = await supabaseAdmin
        .from('petty_cash_requests')
        .select('*, requester:users!petty_cash_requests_requester_id_fkey(full_name)')
        .eq('id', t.entity_id)
        .eq('organization_id', t.organization_id)
        .maybeSingle();
    if (!req) return notFound();

    const now = new Date().toISOString();
    const body = { ...(t.payload || {}), remark };
    const plan = planPettyCashTransition({ req, actor: actorFromAccess(access), action: t.action, body, now });
    if (!plan.ok) return planFailed(plan.error, plan.status);

    const { data: updated, error } = await supabaseAdmin
        .from('petty_cash_requests').update(plan.patch).eq('id', t.entity_id)
        .select('*, requester:users!petty_cash_requests_requester_id_fkey(full_name)').single();
    if (error) return saveFailed(error.message);

    await supabaseAdmin.from('petty_cash_activity').insert({
        request_id: t.entity_id, organization_id: t.organization_id, actor_id: t.user_id,
        action: t.action, from_status: req.status, to_status: (plan.patch as any).status,
        remark: `${remark} (via email)`,
    });

    if (plan.notifyKind) {
        notifyPettyCash(plan.notifyKind, { ...updated, requester_name: (updated.requester as any)?.full_name }, remark)
            .catch(() => {});
    }

    const verb = pastTense(t.action);
    return {
        ok: true,
        title: `Request ${verb}`,
        message: `${req.request_no} from ${(req.requester as any)?.full_name || 'the requester'} has been ${verb}. Everyone involved has been notified.`,
    };
}

async function handlePoPayment(t: EmailActionToken, remark: string): Promise<HandlerOutcome> {
    const access = await resolveAccountsAccessForUser({ id: t.user_id }, t.organization_id);
    if (isAccountsAccessError(access)) return denied();

    const { data: pay } = await supabaseAdmin
        .from('po_payments').select('*')
        .eq('id', t.entity_id)
        .eq('organization_id', t.organization_id)
        .maybeSingle();
    if (!pay) return notFound();

    // 'complete' requires a UTR, which a single click cannot supply — the emailed buttons
    // never offer it, and this rejects any token that somehow asks for it.
    if (t.action === 'complete') {
        return {
            ok: false, status: 400,
            title: 'Open the app to complete this',
            message: 'Completing a payment requires the UTR number, so it cannot be done from an email link.',
        };
    }

    const now = new Date().toISOString();
    const body = { ...(t.payload || {}), remarks: remark };
    const plan = planPaymentTransition({ pay, actor: paymentActorFromAccess(access), action: t.action, body, now });
    if (!plan.ok) return planFailed(plan.error, plan.status);

    const { error } = await supabaseAdmin
        .from('po_payments').update(plan.patch).eq('id', t.entity_id)
        .eq('organization_id', t.organization_id);
    if (error) return saveFailed(error.message);

    // actor_channel 'email' is the whole point of recording this separately: the timeline
    // must show that the decision arrived through a mailed link, not from someone sitting
    // in the app. Never allowed to fail the action — see activity.ts.
    const activityAction: PoActivityAction =
        t.action === 'align' ? 'aligned' : t.action === 'cancel' ? 'cancelled' : 'email_action';
    await logPoActivity({
        organizationId: t.organization_id,
        poId: pay.po_id,
        paymentId: pay.id,
        action: activityAction,
        fromStatus: pay.status,
        toStatus: (plan.patch as Record<string, unknown>).status as string | undefined ?? null,
        actorId: t.user_id,
        actorChannel: 'email',
        note: remark,
        detail: { via: 'email_action', requested_action: t.action, tranche_no: pay.tranche_no },
    });

    const verb = pastTense(t.action);
    return {
        ok: true,
        title: `Payment ${verb}`,
        message: `Tranche ${pay.tranche_no} on ${pay.po_number || 'the PO'} (${pay.vendor_name || 'vendor'}) has been ${verb}.`,
    };
}

const notFound = (): HandlerOutcome =>
    ({ ok: false, status: 404, title: 'Not found', message: 'It may have been deleted since the email was sent.' });

const saveFailed = (detail: string): HandlerOutcome => {
    console.error('[emailActions] save failed:', detail);
    return { ok: false, status: 500, title: 'Could not save', message: 'Something went wrong applying the action. Please open the app and try there.' };
};

const planFailed = (error: string, status: number): HandlerOutcome =>
    ({ ok: false, status, title: status === 409 ? 'Already actioned' : 'Action not allowed', message: error });

function pastTense(action: string): string {
    if (action === 'approve') return 'approved';
    if (action === 'reject') return 'rejected';
    if (action === 'cancel') return 'cancelled';
    return `${action}ed`;
}
