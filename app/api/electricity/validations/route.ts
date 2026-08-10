import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveElectricityAccess, isElectricityAccessError, isChecker,
    readOrgId, isMissingRelation,
} from '@/backend/lib/electricity/access';
import { validateBill } from '@/backend/lib/electricity/validate';

/**
 * /api/electricity/validations — the checker's review queue (Phase 2).
 *
 * GET    bills awaiting review, each joined with its LATEST validation run (one row
 *        per run, latest wins). This is the workbench: billed vs logged units, variance
 *        badge inputs, missing-date chips.
 * POST   { billId } — re-run the validation engine for a bill (method 'manual').
 * PATCH  { billId, note? } — checker sign-off: stamps the latest validation with
 *        checked_by / checked_at / checker_note and moves the bill to 'verified'.
 *        Restricted to CHECKER_ROLES (ops_super_admin + org super admins) — the
 *        checker/accepter split is enforced here, not just in the UI.
 */

export const dynamic = 'force-dynamic';

// Bills in these workflow states are the checker's queue.
const REVIEW_STATES = ['validated', 'chasing'];

interface BillRow {
    id: string;
    account_id: string;
    billing_month: string;
    bill_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    billed_units: number | null;
    billed_units_unit: string | null;
    workflow_status: string;
    electricity_billing_accounts: { provider: string; site_label: string; consumer_ref: string | null } | null;
    electricity_bill_validations: ValidationRow[];
}

interface ValidationRow {
    id: string;
    run_at: string;
    method: string;
    billed_units: number | null;
    logged_units: number | null;
    variance_pct: number | null;
    tolerance_pct: number;
    missing_dates: string[] | null;
    readings_counted: number | null;
    readings_excluded: number | null;
    result: string;
    checked_by: string | null;
    checked_at: string | null;
    checker_note: string | null;
}

export async function GET(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    const { data, error } = await supabaseAdmin
        .from('electricity_bills')
        .select(`
            id, account_id, billing_month, bill_date, due_date, total_amount,
            billed_units, billed_units_unit, workflow_status,
            electricity_billing_accounts ( provider, site_label, consumer_ref ),
            electricity_bill_validations (
                id, run_at, method, billed_units, logged_units, variance_pct, tolerance_pct,
                missing_dates, readings_counted, readings_excluded, result,
                checked_by, checked_at, checker_note
            )
        `)
        .eq('organization_id', access.organizationId)
        .in('workflow_status', REVIEW_STATES)
        .order('billing_month', { ascending: false })
        .order('run_at', { referencedTable: 'electricity_bill_validations', ascending: false })
        .range(0, 499);

    if (error) {
        if (isMissingRelation(error)) {
            return NextResponse.json({ provisioned: false, queue: [], can_check: false });
        }
        console.error('[electricity validations]', error.message);
        return NextResponse.json({ error: 'Could not load the validation queue' }, { status: 500 });
    }

    // Latest run wins — the embedded rows arrive newest-first.
    const queue = ((data || []) as unknown as BillRow[]).map(b => ({
        ...b,
        electricity_bill_validations: undefined,
        latest_validation: b.electricity_bill_validations?.[0] ?? null,
    }));

    return NextResponse.json({ provisioned: true, queue, can_check: isChecker(access) });
}

export async function POST(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    let body: { billId?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body.billId) {
        return NextResponse.json({ error: 'billId is required' }, { status: 400 });
    }

    // Confirm the bill belongs to the caller's org before running anything on it.
    const { data: bill, error: billError } = await supabaseAdmin
        .from('electricity_bills').select('id').eq('id', body.billId)
        .eq('organization_id', access.organizationId).maybeSingle();
    if (billError) {
        if (isMissingRelation(billError)) {
            return NextResponse.json({ error: 'Electricity validation is not provisioned yet' }, { status: 503 });
        }
        return NextResponse.json({ error: 'Could not load bill' }, { status: 500 });
    }
    if (!bill) {
        return NextResponse.json({ error: 'Bill not found in this organization' }, { status: 404 });
    }

    const result = await validateBill(body.billId, 'manual');
    if (!result.ok) {
        console.error('[electricity validations] re-run failed:', result.error);
        return NextResponse.json({ error: 'Validation re-run failed' }, { status: 500 });
    }
    return NextResponse.json(result);
}

export async function PATCH(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    // Checker sign-off is the one authority ops_super_admin has that procurement /
    // accounts do not — and org_super_admin's accepter powers stay out of reach of
    // everyone below it. Enforced here, not just in the UI.
    if (!isChecker(access)) {
        return NextResponse.json(
            { error: 'Forbidden: validation sign-off requires a checker role (ops_super_admin or org super admin)' },
            { status: 403 });
    }

    let body: { billId?: string; note?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body.billId) {
        return NextResponse.json({ error: 'billId is required' }, { status: 400 });
    }

    const { data: bill, error: billError } = await supabaseAdmin
        .from('electricity_bills').select('id, workflow_status').eq('id', body.billId)
        .eq('organization_id', access.organizationId).maybeSingle();
    if (billError) {
        if (isMissingRelation(billError)) {
            return NextResponse.json({ error: 'Electricity validation is not provisioned yet' }, { status: 503 });
        }
        return NextResponse.json({ error: 'Could not load bill' }, { status: 500 });
    }
    if (!bill) {
        return NextResponse.json({ error: 'Bill not found in this organization' }, { status: 404 });
    }

    const { data: latest, error: latestError } = await supabaseAdmin
        .from('electricity_bill_validations')
        .select('id')
        .eq('bill_id', body.billId)
        .order('run_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (latestError) {
        if (isMissingRelation(latestError)) {
            return NextResponse.json({ error: 'Electricity validation is not provisioned yet' }, { status: 503 });
        }
        return NextResponse.json({ error: 'Could not load validation run' }, { status: 500 });
    }
    if (!latest) {
        return NextResponse.json({ error: 'No validation run exists for this bill yet' }, { status: 409 });
    }

    const { error: signError } = await supabaseAdmin
        .from('electricity_bill_validations')
        .update({
            checked_by: access.user.id,
            checked_at: new Date().toISOString(),
            checker_note: body.note ?? null,
        })
        .eq('id', latest.id);
    if (signError) {
        console.error('[electricity validations] sign-off failed:', signError.message);
        return NextResponse.json({ error: 'Could not record sign-off' }, { status: 500 });
    }

    const { error: statusError } = await supabaseAdmin
        .from('electricity_bills')
        .update({ workflow_status: 'verified', updated_at: new Date().toISOString() })
        .eq('id', body.billId);
    if (statusError) {
        console.error('[electricity validations] status update failed:', statusError.message);
        return NextResponse.json({ error: 'Signed off, but could not move the bill to verified' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, billId: body.billId, workflowStatus: 'verified' });
}
