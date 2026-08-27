import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';
import { refreshRunStatus } from '@/backend/lib/electricity/paymentRuns';

/**
 * Electricity → AOP actuals sync (Phase 6 of docs/ELECTRICITY_AUTOMATION_PLAN.md).
 *
 * When Accounts marks a bill paid, the paid amount is folded into the AOP fact table:
 *   site      = electricity_billing_accounts.aop_site_id (nullable soft link)
 *   line item = the org's aop_line_items row with feed_source='electricity'
 *   cell      = (site, line item, period_month = the bill's billing_month)
 *   actual   += paid_amount, source='electricity', source_ref = the bill id
 *
 * Write semantics (risk §9.13 — double counting against xlsx-imported actuals):
 *   - source_ref guards idempotency: a bill that already has an aop_entries row
 *     pointing at it is a no-op, so re-marking paid never double-adds.
 *   - A cell is only written when its source is 'electricity' or its actual is empty.
 *     Anything else (an xlsx import, a manual figure) is left untouched and recorded
 *     as an aop_import_warnings row instead — surfaced, never swallowed, mirroring
 *     the importer's philosophy.
 *   - Bills whose account has no aop_site_id cannot be placed on the MIS at all;
 *     that is a warning too, and the bill's workflow_status is left at 'paid'.
 */

export type AopSyncResult =
    | { ok: true; linked: true; entryId: string }
    | { ok: true; linked: false; warning: string }
    | { ok: false; provisioned?: boolean; error: string };

async function recordWarning(input: {
    organizationId: string;
    severity: 'info' | 'warning' | 'error';
    siteLabel: string | null;
    message: string;
}): Promise<void> {
    const { error } = await supabaseAdmin.from('aop_import_warnings').insert({
        organization_id: input.organizationId,
        severity: input.severity,
        sheet_name: 'electricity_feed',
        site_label: input.siteLabel,
        message: input.message,
    });
    if (error && !isMissingRelation(error)) console.error('[electricity aopSync] warning insert:', error.message);
}

export async function syncBillToAop(billId: string): Promise<AopSyncResult> {
    const { data: bill, error: billErr } = await supabaseAdmin
        .from('electricity_bills')
        .select(`
            id, organization_id, billing_month, paid_amount, payment_status,
            account:electricity_billing_accounts ( site_label, provider, consumer_ref, aop_site_id )
        `)
        .eq('id', billId)
        .maybeSingle();

    if (billErr) {
        if (isMissingRelation(billErr)) return { ok: false, provisioned: false, error: billErr.message };
        return { ok: false, error: billErr.message };
    }
    if (!bill) return { ok: false, error: 'Bill not found' };

    const account = (bill as any).account as
        { site_label: string | null; provider: string | null; consumer_ref: string | null; aop_site_id: string | null } | null;
    const label = [account?.site_label, account?.consumer_ref].filter(Boolean).join(' / ') || null;

    if (bill.payment_status !== 'paid' || bill.paid_amount == null) {
        return { ok: false, error: 'Bill is not marked paid with a paid_amount' };
    }

    // Idempotency: this bill has already been folded into the AOP.
    const { data: existingRef } = await supabaseAdmin
        .from('aop_entries')
        .select('id')
        .eq('source', 'electricity')
        .eq('source_ref', bill.id)
        .maybeSingle();
    if (existingRef) return { ok: true, linked: true, entryId: existingRef.id };

    if (!account?.aop_site_id) {
        const warning = `Bill ${bill.id} (${label ?? 'unknown site'}) paid ₹${bill.paid_amount} but its billing account has no AOP site link; actual not recorded.`;
        await recordWarning({ organizationId: bill.organization_id, severity: 'warning', siteLabel: label, message: warning });
        return { ok: true, linked: false, warning };
    }

    const { data: lineItem, error: liErr } = await supabaseAdmin
        .from('aop_line_items')
        .select('id')
        .eq('organization_id', bill.organization_id)
        .eq('feed_source', 'electricity')
        .limit(1)
        .maybeSingle();
    if (liErr) {
        if (isMissingRelation(liErr)) return { ok: false, provisioned: false, error: liErr.message };
        return { ok: false, error: liErr.message };
    }
    if (!lineItem) {
        const warning = `No aop_line_items row with feed_source='electricity' for this org; bill ${bill.id} actual not recorded.`;
        await recordWarning({ organizationId: bill.organization_id, severity: 'error', siteLabel: label, message: warning });
        return { ok: true, linked: false, warning };
    }

    const { data: cell, error: cellErr } = await supabaseAdmin
        .from('aop_entries')
        .select('id, actual, source')
        .eq('site_id', account.aop_site_id)
        .eq('line_item_id', lineItem.id)
        .eq('period_month', bill.billing_month)
        .maybeSingle();
    if (cellErr) {
        if (isMissingRelation(cellErr)) return { ok: false, provisioned: false, error: cellErr.message };
        return { ok: false, error: cellErr.message };
    }

    // Never overwrite a cell that came from somewhere else with a figure in it —
    // that is exactly the double-count risk; flag it for a human instead.
    if (cell && cell.source !== 'electricity' && cell.actual != null) {
        const warning =
            `AOP cell (${label ?? 'unknown site'}, ${String(bill.billing_month).slice(0, 7)}) already holds ₹${cell.actual} ` +
            `from source '${cell.source}'; electricity payment of ₹${bill.paid_amount} (bill ${bill.id}) NOT added. Reconcile manually.`;
        await recordWarning({ organizationId: bill.organization_id, severity: 'warning', siteLabel: label, message: warning });
        return { ok: true, linked: false, warning };
    }

    let entryId: string;
    if (cell) {
        entryId = cell.id;
        const { error: updErr } = await supabaseAdmin
            .from('aop_entries')
            .update({
                actual: (Number(cell.actual) || 0) + Number(bill.paid_amount),
                source: 'electricity',
                source_ref: bill.id,
                updated_at: new Date().toISOString(),
            })
            .eq('id', cell.id);
        if (updErr) return { ok: false, error: updErr.message };
    } else {
        const { data: inserted, error: insErr } = await supabaseAdmin
            .from('aop_entries')
            .insert({
                organization_id: bill.organization_id,
                site_id: account.aop_site_id,
                line_item_id: lineItem.id,
                period_month: bill.billing_month,
                actual: bill.paid_amount,
                source: 'electricity',
                source_ref: bill.id,
                remarks: `Electricity bill ${label ?? bill.id}`,
            })
            .select('id')
            .single();
        if (insErr) {
            if (isMissingRelation(insErr)) return { ok: false, provisioned: false, error: insErr.message };
            return { ok: false, error: insErr.message };
        }
        entryId = inserted.id;
    }

    const { error: wfErr } = await supabaseAdmin
        .from('electricity_bills')
        .update({ workflow_status: 'aop_linked', updated_at: new Date().toISOString() })
        .eq('id', bill.id);
    if (wfErr && !isMissingRelation(wfErr)) console.error('[electricity aopSync] aop_linked stamp:', wfErr.message);

    return { ok: true, linked: true, entryId };
}

/**
 * Accounts-side "mark paid". Sets the money-side fields (the register's own PATCH
 * semantics), then folds the payment into the AOP and refreshes the run's status.
 * The bill is marked paid even if the AOP sync cannot place it — a warning row is
 * the record of that, not a failed payment.
 */
export async function markBillPaid(input: {
    billId: string;
    organizationId: string;
    paymentDate: string;
    paidAmount: number;
}): Promise<{ ok: true; aop: AopSyncResult } | { ok: false; provisioned?: boolean; error: string }> {
    const now = new Date().toISOString();

    const { data: bill, error } = await supabaseAdmin
        .from('electricity_bills')
        .update({
            payment_status: 'paid',
            payment_date: input.paymentDate,
            paid_amount: input.paidAmount,
            workflow_status: 'paid',
            updated_at: now,
        })
        .eq('id', input.billId)
        .eq('organization_id', input.organizationId)
        .select('id, payment_run_id')
        .maybeSingle();

    if (error) {
        if (isMissingRelation(error)) return { ok: false, provisioned: false, error: error.message };
        return { ok: false, error: error.message };
    }
    if (!bill) return { ok: false, error: 'Bill not found' };

    const aop = await syncBillToAop(bill.id);

    if (bill.payment_run_id) await refreshRunStatus(bill.payment_run_id);

    return { ok: true, aop };
}
