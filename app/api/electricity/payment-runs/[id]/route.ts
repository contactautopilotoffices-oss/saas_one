import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveElectricityAccess, isElectricityAccessError, readOrgId, isMissingRelation } from '@/backend/lib/electricity/access';
import { saveSelection, submitRun, type PaymentScenario } from '@/backend/lib/electricity/paymentRuns';
import { markBillPaid } from '@/backend/lib/electricity/aopSync';

/**
 * PATCH /api/electricity/payment-runs/[id]
 *
 * One route, four actions on a run, discriminated by body.action:
 *
 *   select     { bill_id, scenario: 'early'|'due'|'late', note? }
 *              Record the org_super_admin's scenario pick for one bill. Draft runs
 *              only; org/master super admins only (the accepter side of the
 *              checker/accepter split).
 *
 *   submit     Hand the run to Accounts: bills move to workflow_status
 *              'sent_to_accounts' with payment_run_id stamped, run goes 'submitted',
 *              accounts-role members get notifications + pending_actions rows.
 *              Super admins only.
 *
 *   mark_paid  { bill_id, payment_date, paid_amount }
 *              Accounts-side completion of one bill: money-side fields set, the
 *              paid amount folded into aop_entries (source='electricity'), the run's
 *              status refreshed. Accounts role allowed.
 *
 *   complete   Explicitly close a run whose bills are all paid. Accounts role
 *              allowed; normally redundant (mark_paid refreshes the status) but
 *              kept for runs edited out of band.
 */

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const SCENARIOS: PaymentScenario[] = ['early', 'due', 'late'];

function fail(result: { provisioned?: boolean; error: string }, fallback: string) {
    if (result.provisioned === false) {
        return NextResponse.json({ provisioned: false, error: 'Payment runs migration not applied yet' }, { status: 503 });
    }
    return NextResponse.json({ error: result.error || fallback }, { status: 400 });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
    const { id: runId } = await context.params;
    const body = await request.json().catch(() => null) as {
        action?: string;
        organization_id?: string;
        bill_id?: string;
        scenario?: string;
        note?: string;
        payment_date?: string;
        paid_amount?: number;
    } | null;

    const access = await resolveElectricityAccess(request, readOrgId(request, body));
    if (isElectricityAccessError(access)) return access;

    if (!body?.action) {
        return NextResponse.json({ error: 'action is required (select | submit | mark_paid | complete)' }, { status: 400 });
    }

    const isAccounts = access.isSuperAdmin || access.roles.includes('accounts');

    switch (body.action) {
        case 'select': {
            if (!access.isSuperAdmin) {
                return NextResponse.json(
                    { error: 'Forbidden: only org super admins select payment scenarios' }, { status: 403 });
            }
            if (!body.bill_id || !body.scenario || !SCENARIOS.includes(body.scenario as PaymentScenario)) {
                return NextResponse.json({ error: 'bill_id and scenario (early|due|late) are required' }, { status: 400 });
            }
            const result = await saveSelection({
                runId,
                organizationId: access.organizationId,
                billId: body.bill_id,
                scenario: body.scenario as PaymentScenario,
                selectedBy: access.user.id,
                note: body.note ?? null,
            });
            if (!result.ok) return fail(result, 'Could not save the selection');
            return NextResponse.json({ provisioned: true, selection: result.data });
        }

        case 'submit': {
            if (!access.isSuperAdmin) {
                return NextResponse.json(
                    { error: 'Forbidden: only org super admins submit payment runs' }, { status: 403 });
            }
            const result = await submitRun({
                runId,
                organizationId: access.organizationId,
                submittedBy: access.user.id,
            });
            if (!result.ok) return fail(result, 'Could not submit the run');
            return NextResponse.json({ provisioned: true, run: result.data });
        }

        case 'mark_paid': {
            if (!isAccounts) {
                return NextResponse.json(
                    { error: 'Forbidden: only accounts (or super admins) mark bills paid' }, { status: 403 });
            }
            if (!body.bill_id || !body.payment_date || body.paid_amount == null) {
                return NextResponse.json({ error: 'bill_id, payment_date and paid_amount are required' }, { status: 400 });
            }
            // The bill must belong to THIS run — otherwise anyone with accounts access
            // could drive bills from other runs through this endpoint.
            const { data: bill, error: billErr } = await supabaseAdmin
                .from('electricity_bills')
                .select('id')
                .eq('id', body.bill_id)
                .eq('payment_run_id', runId)
                .eq('organization_id', access.organizationId)
                .maybeSingle();
            if (billErr) {
                if (isMissingRelation(billErr)) {
                    return NextResponse.json({ provisioned: false, error: 'Migration not applied yet' }, { status: 503 });
                }
                console.error('[electricity payment-runs mark_paid]', billErr.message);
                return NextResponse.json({ error: 'Could not load the bill' }, { status: 500 });
            }
            if (!bill) return NextResponse.json({ error: 'Bill not found in this payment run' }, { status: 404 });

            const result = await markBillPaid({
                billId: body.bill_id,
                organizationId: access.organizationId,
                paymentDate: body.payment_date,
                paidAmount: Number(body.paid_amount),
            });
            if (!result.ok) return fail(result, 'Could not mark the bill paid');
            const aop = result.aop;
            if (!aop.ok) {
                console.error('[electricity payment-runs aopSync]', aop.error);
                return NextResponse.json({ error: 'Bill marked paid but the AOP sync failed' }, { status: 500 });
            }
            return NextResponse.json({
                provisioned: true,
                paid: true,
                aop_linked: aop.linked,
                ...(aop.linked ? { entry_id: aop.entryId } : { warning: aop.warning }),
            });
        }

        case 'complete': {
            if (!isAccounts) {
                return NextResponse.json(
                    { error: 'Forbidden: only accounts (or super admins) complete payment runs' }, { status: 403 });
            }
            const { data: run, error: runErr } = await supabaseAdmin
                .from('electricity_payment_runs')
                .select('id, status')
                .eq('id', runId)
                .eq('organization_id', access.organizationId)
                .maybeSingle();
            if (runErr) {
                if (isMissingRelation(runErr)) {
                    return NextResponse.json({ provisioned: false, error: 'Migration not applied yet' }, { status: 503 });
                }
                console.error('[electricity payment-runs complete]', runErr.message);
                return NextResponse.json({ error: 'Could not load the run' }, { status: 500 });
            }
            if (!run) return NextResponse.json({ error: 'Payment run not found' }, { status: 404 });
            if (!['submitted', 'in_payment'].includes(run.status)) {
                return NextResponse.json({ error: `Run is ${run.status}; nothing to complete` }, { status: 400 });
            }

            const { count, error: countErr } = await supabaseAdmin
                .from('electricity_bills')
                .select('id', { count: 'exact', head: true })
                .eq('payment_run_id', runId)
                .neq('payment_status', 'paid');
            if (countErr) {
                console.error('[electricity payment-runs complete]', countErr.message);
                return NextResponse.json({ error: 'Could not check the run\'s bills' }, { status: 500 });
            }
            if ((count ?? 0) > 0) {
                return NextResponse.json({ error: `${count} bill${count === 1 ? '' : 's'} still unpaid in this run` }, { status: 400 });
            }

            const { data: completed, error: updErr } = await supabaseAdmin
                .from('electricity_payment_runs')
                .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq('id', runId)
                .select('*')
                .single();
            if (updErr) {
                console.error('[electricity payment-runs complete]', updErr.message);
                return NextResponse.json({ error: 'Could not complete the run' }, { status: 500 });
            }
            return NextResponse.json({ provisioned: true, run: completed });
        }

        default:
            return NextResponse.json({ error: `Unknown action '${body.action}'` }, { status: 400 });
    }
}
