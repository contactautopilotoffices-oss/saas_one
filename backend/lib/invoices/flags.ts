/**
 * Cross-dashboard flag for an invoice that does not agree with its PO.
 *
 * Invoice Control already shows a mismatch in its own queues, but only to someone who
 * opens that tab. This puts the same fact in front of everyone who can see the PO, on
 * whatever dashboard they already use, by writing a `pending_actions` row — the
 * org-wide inbox NotificationBell reads everywhere (see 20260804000003).
 *
 * It is a flag, not a gate. Nothing here stops a payment.
 *
 * Raised when a validation run lands on mismatched / needs_review / duplicate_suspected.
 * Closed when a later run (or a person resolving the rules) brings the same invoice back
 * to matched, so a corrected invoice does not leave a stale warning behind.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import type { MatchStatus } from './types';

// Everyone the Payment Tracker lets near a PO — the user's choice when this was built.
// Purchase sees it too, although Invoice Control's review queue would also catch it.
const FLAGGED_ROLES = [
    'org_super_admin', 'org_admin', 'master_admin', 'director', 'ops_super_admin',
    'accounts', 'procurement', 'purchase_manager', 'purchase_executive',
];

const FLAGGED_STATUSES: MatchStatus[] = ['mismatched', 'needs_review', 'duplicate_suspected'];

const HEADLINE: Record<string, string> = {
    mismatched: 'Invoice does not match the PO',
    needs_review: 'Invoice needs a person to look at it',
    duplicate_suspected: 'Possible duplicate invoice',
};

/** Recipients: every active member of this org holding one of the roles above. */
async function recipients(orgId: string): Promise<string[]> {
    const [orgMembers, propMembers] = await Promise.all([
        supabaseAdmin.from('organization_memberships')
            .select('user_id, role').eq('organization_id', orgId).eq('is_active', true),
        supabaseAdmin.from('property_memberships')
            .select('user_id, role, organization_id').eq('organization_id', orgId).eq('is_active', true),
    ]);
    const ids = new Set<string>();
    for (const m of [...(orgMembers.data ?? []), ...(propMembers.data ?? [])]) {
        if (m.role && FLAGGED_ROLES.includes(m.role) && m.user_id) ids.add(m.user_id);
    }
    return [...ids];
}

/** Close any open flag for this invoice, whatever raised it. */
async function clearFlag(invoiceId: string) {
    await supabaseAdmin.from('pending_actions')
        .update({ status: 'done', resolved_at: new Date().toISOString(), resolved_action: 'matched' })
        .eq('entity_type', 'invoice').eq('entity_id', invoiceId).eq('status', 'open');
}

export async function syncInvoiceMatchFlag(input: {
    orgId: string;
    invoiceId: string;
    matchStatus: MatchStatus;
    poNumber: string | null;
    vendorName: string | null;
    failedRules: string[];
}): Promise<void> {
    if (!FLAGGED_STATUSES.includes(input.matchStatus)) {
        await clearFlag(input.invoiceId);
        return;
    }

    // One open flag per invoice per person: a re-run that is still bad must not stack.
    const { data: existing } = await supabaseAdmin.from('pending_actions')
        .select('recipient_id').eq('entity_type', 'invoice').eq('entity_id', input.invoiceId).eq('status', 'open');
    const already = new Set((existing ?? []).map((r) => r.recipient_id));

    const people = (await recipients(input.orgId)).filter((id) => !already.has(id));
    if (!people.length) return;

    const po = input.poNumber ? `PO ${input.poNumber}` : 'a purchase order';
    const vendor = input.vendorName ? ` from ${input.vendorName}` : '';
    const rules = input.failedRules.length
        ? ` Checks that did not pass: ${input.failedRules.slice(0, 4).join(', ')}.`
        : '';

    await supabaseAdmin.from('pending_actions').insert(people.map((recipient_id) => ({
        organization_id: input.orgId,
        recipient_id,
        domain: 'invoice_control',
        entity_type: 'invoice',
        entity_id: input.invoiceId,
        title: `${HEADLINE[input.matchStatus] ?? 'Invoice needs attention'} — ${po}`,
        description: `An invoice${vendor} was checked against ${po} and did not agree with it.${rules} Payment can still be aligned; the reason is recorded.`,
        actions: ['view'],
        deep_link: `/${input.orgId}/accounts?tab=invoices&invoice=${input.invoiceId}`,
    })));
}
