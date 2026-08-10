import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';

/**
 * Electricity 3-scenario payment runs (Phase 6 of docs/ELECTRICITY_AUTOMATION_PLAN.md).
 *
 * The form is built from bills at workflow_status='verified' for the month — the three
 * scenario amounts already live on electricity_bills, this module only records the
 * org_super_admin's pick per bill:
 *
 *   early → early_payment_amount, pay by early_payment_date
 *   due   → total_amount,         pay by due_date
 *   late  → after_due_date_amount, no pay-by date (the penalty already applies)
 *
 * On submit the run goes to 'submitted', each selected bill moves to
 * workflow_status='sent_to_accounts' with payment_run_id stamped, and every
 * accounts-role member of the org gets a notifications row + a pending_actions row
 * (domain 'electricity_payment'). Accounts then marks bills paid; aopSync.ts owns
 * what happens after that.
 *
 * Everything runs through supabaseAdmin (the tables are service-role-write by RLS)
 * and treats a missing relation as "migration not applied yet" so callers can
 * degrade instead of 500ing, matching the rest of the electricity module.
 */

export type PaymentRunStatus = 'draft' | 'submitted' | 'in_payment' | 'completed';
export type PaymentScenario = 'early' | 'due' | 'late';

export interface PaymentRunRow {
    id: string;
    organization_id: string;
    period_month: string;
    status: PaymentRunStatus;
    submitted_by: string | null;
    submitted_at: string | null;
    completed_at: string | null;
    created_at: string;
}

export interface PaymentSelectionRow {
    id: string;
    run_id: string;
    bill_id: string;
    scenario: PaymentScenario;
    scenario_amount: number;
    pay_by_date: string | null;
    note: string | null;
    selected_by: string | null;
    selected_at: string;
}

/** One row of the scenario form: a verified bill plus its pick, if made. */
export interface PaymentFormRow {
    bill_id: string;
    account_id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    billing_month: string;
    early_payment_date: string | null;
    due_date: string | null;
    early_payment_amount: number | null;
    total_amount: number | null;
    after_due_date_amount: number | null;
    selection: PaymentSelectionRow | null;
}

export type PaymentRunResult<T> = { ok: true; data: T } | { ok: false; provisioned?: boolean; error: string };

const DEEP_LINK_BASE = '/dashboard/accounts?tab=electricity-payments';

// ---------------------------------------------------------------------------
// Form build — verified bills for the month, joined with any existing selection.
// ---------------------------------------------------------------------------
export async function buildMonthForm(input: {
    organizationId: string;
    periodMonth: string;
    runId?: string | null;
}): Promise<PaymentRunResult<PaymentFormRow[]>> {
    const { data, error } = await supabaseAdmin
        .from('electricity_bills')
        .select(`
            id, account_id, billing_month,
            early_payment_date, due_date,
            early_payment_amount, total_amount, after_due_date_amount,
            account:electricity_billing_accounts ( site_label, provider, consumer_ref )
        `)
        .eq('organization_id', input.organizationId)
        .eq('billing_month', input.periodMonth)
        .eq('workflow_status', 'verified')
        .order('due_date', { ascending: true, nullsFirst: false })
        .range(0, 4999);

    if (error) {
        if (isMissingRelation(error)) return { ok: false, provisioned: false, error: error.message };
        return { ok: false, error: error.message };
    }

    let selections: PaymentSelectionRow[] = [];
    if (input.runId) {
        const { data: sel, error: selErr } = await supabaseAdmin
            .from('electricity_payment_selections')
            .select('*')
            .eq('run_id', input.runId);
        if (selErr && !isMissingRelation(selErr)) return { ok: false, error: selErr.message };
        selections = (sel || []) as PaymentSelectionRow[];
    }
    const byBill = new Map(selections.map(s => [s.bill_id, s]));

    const rows: PaymentFormRow[] = (data || []).map((b: any) => ({
        bill_id: b.id,
        account_id: b.account_id,
        site_label: b.account?.site_label ?? '',
        provider: b.account?.provider ?? '',
        consumer_ref: b.account?.consumer_ref ?? null,
        billing_month: b.billing_month,
        early_payment_date: b.early_payment_date,
        due_date: b.due_date,
        early_payment_amount: b.early_payment_amount,
        total_amount: b.total_amount,
        after_due_date_amount: b.after_due_date_amount,
        selection: byBill.get(b.id) ?? null,
    }));

    return { ok: true, data: rows };
}

export async function listRuns(input: {
    organizationId: string;
    periodMonth?: string | null;
}): Promise<PaymentRunResult<PaymentRunRow[]>> {
    let query = supabaseAdmin
        .from('electricity_payment_runs')
        .select('*')
        .eq('organization_id', input.organizationId)
        .order('period_month', { ascending: false })
        .range(0, 499);
    if (input.periodMonth) query = query.eq('period_month', input.periodMonth);

    const { data, error } = await query;
    if (error) {
        if (isMissingRelation(error)) return { ok: false, provisioned: false, error: error.message };
        return { ok: false, error: error.message };
    }
    return { ok: true, data: (data || []) as PaymentRunRow[] };
}

export async function createDraftRun(input: {
    organizationId: string;
    periodMonth: string;
}): Promise<PaymentRunResult<PaymentRunRow>> {
    const { data, error } = await supabaseAdmin
        .from('electricity_payment_runs')
        .insert({ organization_id: input.organizationId, period_month: input.periodMonth, status: 'draft' })
        .select('*')
        .single();

    if (error) {
        if (isMissingRelation(error)) return { ok: false, provisioned: false, error: error.message };
        return { ok: false, error: error.message };
    }
    return { ok: true, data: data as PaymentRunRow };
}

// ---------------------------------------------------------------------------
// Scenario selection — draft runs only. Amount and pay-by date are derived from
// the bill here, never taken from the client.
// ---------------------------------------------------------------------------
export async function saveSelection(input: {
    runId: string;
    organizationId: string;
    billId: string;
    scenario: PaymentScenario;
    selectedBy: string;
    note?: string | null;
}): Promise<PaymentRunResult<PaymentSelectionRow>> {
    const { data: run, error: runErr } = await supabaseAdmin
        .from('electricity_payment_runs')
        .select('id, status')
        .eq('id', input.runId)
        .eq('organization_id', input.organizationId)
        .maybeSingle();
    if (runErr) {
        if (isMissingRelation(runErr)) return { ok: false, provisioned: false, error: runErr.message };
        return { ok: false, error: runErr.message };
    }
    if (!run) return { ok: false, error: 'Payment run not found' };
    if (run.status !== 'draft') return { ok: false, error: `Run is ${run.status}; selections are locked` };

    const { data: bill, error: billErr } = await supabaseAdmin
        .from('electricity_bills')
        .select('id, early_payment_date, due_date, early_payment_amount, total_amount, after_due_date_amount')
        .eq('id', input.billId)
        .eq('organization_id', input.organizationId)
        .maybeSingle();
    if (billErr) return { ok: false, error: billErr.message };
    if (!bill) return { ok: false, error: 'Bill not found' };

    const amount =
        input.scenario === 'early' ? bill.early_payment_amount
            : input.scenario === 'due' ? bill.total_amount
                : bill.after_due_date_amount;
    if (amount == null) {
        return { ok: false, error: `Bill has no ${input.scenario === 'due' ? 'total' : input.scenario} amount on file` };
    }
    const payByDate =
        input.scenario === 'early' ? bill.early_payment_date
            : input.scenario === 'due' ? bill.due_date
                : null;

    const { data, error } = await supabaseAdmin
        .from('electricity_payment_selections')
        .upsert({
            run_id: input.runId,
            bill_id: input.billId,
            scenario: input.scenario,
            scenario_amount: amount,
            pay_by_date: payByDate,
            note: input.note ?? null,
            selected_by: input.selectedBy,
            selected_at: new Date().toISOString(),
        }, { onConflict: 'bill_id' })
        .select('*')
        .single();

    if (error) {
        if (isMissingRelation(error)) return { ok: false, provisioned: false, error: error.message };
        return { ok: false, error: error.message };
    }

    // Best-effort: the selection row is the record of truth; the workflow stamp must
    // not fail the pick if the column is not applied yet.
    const { error: wfErr } = await supabaseAdmin
        .from('electricity_bills')
        .update({ workflow_status: 'scenario_selected', updated_at: new Date().toISOString() })
        .eq('id', input.billId)
        .in('workflow_status', ['verified', 'scenario_selected']);
    if (wfErr && !isMissingRelation(wfErr)) console.error('[electricity paymentRuns] workflow stamp:', wfErr.message);

    return { ok: true, data: data as PaymentSelectionRow };
}

// ---------------------------------------------------------------------------
// Submit — hand the run to Accounts.
// ---------------------------------------------------------------------------
export async function submitRun(input: {
    runId: string;
    organizationId: string;
    submittedBy: string;
}): Promise<PaymentRunResult<PaymentRunRow>> {
    const now = new Date().toISOString();

    const { data: run, error: runErr } = await supabaseAdmin
        .from('electricity_payment_runs')
        .select('*')
        .eq('id', input.runId)
        .eq('organization_id', input.organizationId)
        .maybeSingle();
    if (runErr) {
        if (isMissingRelation(runErr)) return { ok: false, provisioned: false, error: runErr.message };
        return { ok: false, error: runErr.message };
    }
    if (!run) return { ok: false, error: 'Payment run not found' };
    if (run.status !== 'draft') return { ok: false, error: `Run is ${run.status}; only drafts can be submitted` };

    const { data: selections, error: selErr } = await supabaseAdmin
        .from('electricity_payment_selections')
        .select('bill_id, scenario, scenario_amount')
        .eq('run_id', input.runId);
    if (selErr) {
        if (isMissingRelation(selErr)) return { ok: false, provisioned: false, error: selErr.message };
        return { ok: false, error: selErr.message };
    }
    if (!selections || selections.length === 0) {
        return { ok: false, error: 'No scenario selections in this run' };
    }

    // Bills first: a half-failed submit still leaves the bills visibly handed over
    // rather than silently selectable again.
    const billIds = selections.map(s => s.bill_id);
    const { error: billErr } = await supabaseAdmin
        .from('electricity_bills')
        .update({ workflow_status: 'sent_to_accounts', payment_run_id: input.runId, updated_at: now })
        .in('id', billIds)
        .eq('organization_id', input.organizationId);
    if (billErr) {
        if (isMissingRelation(billErr)) return { ok: false, provisioned: false, error: billErr.message };
        return { ok: false, error: billErr.message };
    }

    const { data: updated, error: updErr } = await supabaseAdmin
        .from('electricity_payment_runs')
        .update({ status: 'submitted', submitted_by: input.submittedBy, submitted_at: now, updated_at: now })
        .eq('id', input.runId)
        .select('*')
        .single();
    if (updErr) return { ok: false, error: updErr.message };

    await notifyAccounts({
        organizationId: input.organizationId,
        runId: input.runId,
        periodMonth: (run as PaymentRunRow).period_month,
        billCount: billIds.length,
        totalAmount: selections.reduce((s, r) => s + (Number(r.scenario_amount) || 0), 0),
    });

    return { ok: true, data: updated as PaymentRunRow };
}

/**
 * Run-status bookkeeping for Accounts. 'in_payment' when the first bill of a
 * submitted run is marked paid; 'completed' once every bill in the run is paid.
 * Returns the new status (or the current one when nothing changed).
 */
export async function refreshRunStatus(runId: string): Promise<PaymentRunStatus | null> {
    const { data: run } = await supabaseAdmin
        .from('electricity_payment_runs')
        .select('status, organization_id')
        .eq('id', runId)
        .maybeSingle();
    if (!run || run.status === 'completed' || run.status === 'draft') return (run?.status as PaymentRunStatus) ?? null;

    const { data: bills } = await supabaseAdmin
        .from('electricity_bills')
        .select('payment_status')
        .eq('payment_run_id', runId);

    const all = bills || [];
    const allPaid = all.length > 0 && all.every(b => b.payment_status === 'paid');
    const next: PaymentRunStatus = allPaid ? 'completed' : 'in_payment';
    if (next === run.status) return next;

    const { error } = await supabaseAdmin
        .from('electricity_payment_runs')
        .update({
            status: next,
            completed_at: allPaid ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', runId);
    if (error) console.error('[electricity paymentRuns] run status refresh:', error.message);
    return next;
}

// ---------------------------------------------------------------------------
// Fan-out to every accounts-role member. Best-effort: the run's submitted state is
// the record of truth, a missing notification must not fail the submit.
// ---------------------------------------------------------------------------
async function notifyAccounts(input: {
    organizationId: string;
    runId: string;
    periodMonth: string;
    billCount: number;
    totalAmount: number;
}): Promise<void> {
    const [orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('organization_memberships')
            .select('user_id').eq('organization_id', input.organizationId)
            .eq('role', 'accounts').eq('is_active', true),
        supabaseAdmin.from('property_memberships')
            .select('user_id').eq('organization_id', input.organizationId)
            .eq('role', 'accounts').eq('is_active', true),
    ]);

    const recipientIds = [...new Set([
        ...(orgRes.data || []).map(m => m.user_id),
        ...(propRes.data || []).map(m => m.user_id),
    ])];
    if (recipientIds.length === 0) return;

    const month = input.periodMonth.slice(0, 7);
    const total = `₹${Math.round(input.totalAmount).toLocaleString('en-IN')}`;
    const title = `Electricity payment run for ${month}`;
    const message = `${input.billCount} bill${input.billCount === 1 ? '' : 's'} (${total}) submitted for payment.`;
    const deepLink = `${DEEP_LINK_BASE}&run=${input.runId}`;

    const { error: notifErr } = await supabaseAdmin.from('notifications').insert(
        recipientIds.map(userId => ({
            user_id: userId,
            organization_id: input.organizationId,
            notification_type: 'ELECTRICITY_PAYMENT_RUN_SUBMITTED',
            title,
            message,
            deep_link: deepLink,
        })),
    );
    if (notifErr) console.error('[electricity paymentRuns] notifications insert:', notifErr.message);

    const { error: paErr } = await supabaseAdmin.from('pending_actions').insert(
        recipientIds.map(userId => ({
            organization_id: input.organizationId,
            recipient_id: userId,
            domain: 'electricity_payment',
            entity_type: 'electricity_payment_run',
            entity_id: input.runId,
            title,
            description: message,
            actions: ['view', 'mark_paid'],
            deep_link: deepLink,
        })),
    );
    if (paErr && !isMissingRelation(paErr)) console.error('[electricity paymentRuns] pending_actions insert:', paErr.message);
}
