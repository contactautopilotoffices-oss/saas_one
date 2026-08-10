import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppQueueService } from '@/backend/services/WhatsAppQueueService';
import { isMissingRelation } from '@/backend/lib/aop/access';

/**
 * Electricity dispute lifecycle (Phase 3 of docs/ELECTRICITY_AUTOMATION_PLAN.md).
 *
 *   open     — checker (ops_super_admin) flags a bill: payment_status + workflow_status
 *              become 'disputed', the site's property admin is resolved from
 *              property_memberships and gets a pending_actions row + notifications row +
 *              WhatsApp heads-up.
 *   respond  — the property admin answers free-form (attachments are storage metadata
 *              only); status moves open -> 'responded'. Insert is done by the respond
 *              route (it owns the multipart upload); this module only flips the status.
 *   resolve  — checker closes: 'accepted' returns the bill to workflow_status
 *              'validated' (it re-enters the normal sign-off flow); 'rejected' leaves it
 *              'disputed'. Either way the assignee's pending_actions row is closed.
 *
 * Everything here runs through supabaseAdmin (the tables are service-role-write by RLS)
 * and treats a missing relation as "migration not applied yet" so callers can degrade
 * instead of 500ing, matching the rest of the electricity module.
 */

export type DisputeStatus = 'open' | 'responded' | 'accepted' | 'rejected' | 'withdrawn';
export type DisputeResolution = 'accepted' | 'rejected';

export interface DisputeRow {
    id: string;
    organization_id: string;
    bill_id: string;
    validation_id: string | null;
    raised_by: string;
    raised_at: string;
    reason: string;
    status: DisputeStatus;
    assigned_property_admin: string | null;
    resolved_by: string | null;
    resolved_at: string | null;
    resolution_note: string | null;
    created_at: string;
}

export type DisputeResult<T> = { ok: true; data: T } | { ok: false; provisioned?: boolean; error: string };

const DEEP_LINK_BASE = '/dashboard/procurement/electricity?tab=disputes';

// The WhatsApp service maps event types to modules by prefix; until the dedicated
// 'electricity' module lands (Phase 4 owns WhatsAppQueueService), the procurement module
// is the right home — this tracker lives in the procurement workspace.
const WA_EVENT_DISPUTE_OPENED = 'PROCUREMENT_ELECTRICITY_DISPUTE_OPENED';

async function resolvePropertyAdmin(billId: string): Promise<{ userId: string; propertyId: string | null } | null> {
    const { data: bill } = await supabaseAdmin
        .from('electricity_bills')
        .select('account_id')
        .eq('id', billId)
        .maybeSingle();
    if (!bill?.account_id) return null;

    const { data: account } = await supabaseAdmin
        .from('electricity_billing_accounts')
        .select('property_id')
        .eq('id', bill.account_id)
        .maybeSingle();
    if (!account?.property_id) return null;

    const { data: membership } = await supabaseAdmin
        .from('property_memberships')
        .select('user_id')
        .eq('property_id', account.property_id)
        .eq('role', 'property_admin')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

    return membership?.user_id ? { userId: membership.user_id, propertyId: account.property_id } : null;
}

export async function openDispute(input: {
    organizationId: string;
    billId: string;
    validationId?: string | null;
    raisedBy: string;
    reason: string;
}): Promise<DisputeResult<DisputeRow>> {
    // The bill is the money side — flag it before anything else so a half-failed open
    // still leaves the bill visibly disputed rather than silently payable.
    const { error: billErr } = await supabaseAdmin
        .from('electricity_bills')
        .update({ payment_status: 'disputed', workflow_status: 'disputed', updated_at: new Date().toISOString() })
        .eq('id', input.billId)
        .eq('organization_id', input.organizationId);
    if (billErr) {
        if (isMissingRelation(billErr)) return { ok: false, provisioned: false, error: billErr.message };
        return { ok: false, error: billErr.message };
    }

    const assignee = await resolvePropertyAdmin(input.billId);

    const { data: dispute, error } = await supabaseAdmin
        .from('electricity_disputes')
        .insert({
            organization_id: input.organizationId,
            bill_id: input.billId,
            validation_id: input.validationId ?? null,
            raised_by: input.raisedBy,
            reason: input.reason,
            status: 'open',
            assigned_property_admin: assignee?.userId ?? null,
        })
        .select('*')
        .single();

    if (error) {
        if (isMissingRelation(error)) return { ok: false, provisioned: false, error: error.message };
        return { ok: false, error: error.message };
    }

    const row = dispute as DisputeRow;

    // Fan-out to the assignee is best-effort: the dispute itself is the record of truth,
    // a missing notification must not fail the open.
    if (assignee) {
        const deepLink = `${DEEP_LINK_BASE}&dispute=${row.id}`;
        const { error: paErr } = await supabaseAdmin.from('pending_actions').insert({
            organization_id: input.organizationId,
            recipient_id: assignee.userId,
            domain: 'electricity_dispute',
            entity_type: 'electricity_dispute',
            entity_id: row.id,
            title: 'Electricity bill disputed',
            description: input.reason,
            actions: ['respond', 'view'],
            deep_link: deepLink,
        });
        if (paErr && !isMissingRelation(paErr)) console.error('[electricity disputes] pending_actions insert:', paErr.message);

        const { error: notifErr } = await supabaseAdmin.from('notifications').insert({
            user_id: assignee.userId,
            organization_id: input.organizationId,
            property_id: assignee.propertyId,
            notification_type: 'ELECTRICITY_DISPUTE_OPENED',
            title: 'Electricity bill disputed',
            message: input.reason,
            deep_link: deepLink,
        });
        if (notifErr) console.error('[electricity disputes] notifications insert:', notifErr.message);

        try {
            await WhatsAppQueueService.enqueue({
                userIds: [assignee.userId],
                message: `An electricity bill for your property has been disputed by ops. Reason: ${input.reason}. Please respond in the app.`,
                eventType: WA_EVENT_DISPUTE_OPENED,
            });
        } catch (e) {
            console.error('[electricity disputes] whatsapp enqueue:', e instanceof Error ? e.message : e);
        }
    }

    return { ok: true, data: row };
}

/**
 * Flip the dispute to 'responded' after the respond route has inserted the response row.
 * Only 'open' disputes can move — responding to a resolved dispute is a no-op error.
 */
export async function markDisputeResponded(disputeId: string): Promise<DisputeResult<null>> {
    const { error } = await supabaseAdmin
        .from('electricity_disputes')
        .update({ status: 'responded', updated_at: new Date().toISOString() })
        .eq('id', disputeId)
        .eq('status', 'open');
    if (error) {
        if (isMissingRelation(error)) return { ok: false, provisioned: false, error: error.message };
        return { ok: false, error: error.message };
    }
    return { ok: true, data: null };
}

export async function resolveDispute(input: {
    disputeId: string;
    organizationId: string;
    resolvedBy: string;
    resolution: DisputeResolution;
    note?: string | null;
}): Promise<DisputeResult<DisputeRow>> {
    const now = new Date().toISOString();

    const { data: dispute, error } = await supabaseAdmin
        .from('electricity_disputes')
        .update({
            status: input.resolution,
            resolved_by: input.resolvedBy,
            resolved_at: now,
            resolution_note: input.note ?? null,
            updated_at: now,
        })
        .eq('id', input.disputeId)
        .eq('organization_id', input.organizationId)
        .in('status', ['open', 'responded'])
        .select('*')
        .maybeSingle();

    if (error) {
        if (isMissingRelation(error)) return { ok: false, provisioned: false, error: error.message };
        return { ok: false, error: error.message };
    }
    if (!dispute) return { ok: false, error: 'Dispute not found or already resolved' };

    const row = dispute as DisputeRow;

    // Accepted: the bill re-enters the normal flow at 'validated'. Rejected: it stays
    // 'disputed' (and payment_status stays 'disputed') until a new dispute/resolution.
    if (input.resolution === 'accepted') {
        const { error: billErr } = await supabaseAdmin
            .from('electricity_bills')
            .update({ workflow_status: 'validated', updated_at: now })
            .eq('id', row.bill_id);
        if (billErr) console.error('[electricity disputes] bill workflow reset:', billErr.message);
    }

    // Close the assignee's inbox item whichever way it was resolved.
    const { error: paErr } = await supabaseAdmin
        .from('pending_actions')
        .update({ status: 'done', resolved_at: now, resolved_action: input.resolution })
        .eq('entity_type', 'electricity_dispute')
        .eq('entity_id', row.id)
        .eq('status', 'open');
    if (paErr && !isMissingRelation(paErr)) console.error('[electricity disputes] pending_actions close:', paErr.message);

    return { ok: true, data: row };
}
