import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveElectricityAccess, isElectricityAccessError, readOrgId, isMissingRelation } from '@/backend/lib/electricity/access';
import { buildMonthForm, createDraftRun, listRuns } from '@/backend/lib/electricity/paymentRuns';

/**
 * GET /api/electricity/payment-runs
 *
 * Lists payment runs for the org (?month=YYYY-MM-01 to filter), and — when ?month=
 * is given — the month's scenario form: every 'verified' bill with its three amounts
 * and any selection already made. Audience: all ELECTRICITY_ROLES; the *actions* on
 * a run are gated more tightly in [id]/route.ts.
 *
 * POST /api/electricity/payment-runs  { period_month }
 *
 * Creates a draft run for a month. Restricted to org/master super admins — the
 * accepter side of the checker/accepter split.
 */

export const dynamic = 'force-dynamic';

function firstOfMonth(raw: string | null): string | null {
    if (!raw) return null;
    const month = raw.slice(0, 7);
    return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null;
}

export async function GET(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    // ?run_id= — the Accounts payment queue's per-bill view of one run: every selection
    // joined with its bill (scenario, pay-by date, money status). Available to all
    // ELECTRICITY_ROLES; actions stay gated in [id]/route.ts.
    const runId = request.nextUrl.searchParams.get('run_id');
    if (runId) {
        const { data: run, error: runErr } = await supabaseAdmin
            .from('electricity_payment_runs')
            .select('*')
            .eq('id', runId)
            .eq('organization_id', access.organizationId)
            .maybeSingle();
        if (runErr) {
            if (isMissingRelation(runErr)) return NextResponse.json({ provisioned: false, bills: [] });
            console.error('[electricity payment-runs queue]', runErr.message);
            return NextResponse.json({ error: 'Could not load the payment run' }, { status: 500 });
        }
        if (!run) return NextResponse.json({ error: 'Payment run not found' }, { status: 404 });

        const { data: selections, error: selErr } = await supabaseAdmin
            .from('electricity_payment_selections')
            .select(`
                *,
                bill:electricity_bills (
                    id, billing_month, total_amount, payment_status, payment_date, paid_amount,
                    account:electricity_billing_accounts ( site_label, provider, consumer_ref )
                )
            `)
            .eq('run_id', runId)
            .order('pay_by_date', { ascending: true, nullsFirst: false });
        if (selErr) {
            if (isMissingRelation(selErr)) return NextResponse.json({ provisioned: false, bills: [] });
            console.error('[electricity payment-runs queue selections]', selErr.message);
            return NextResponse.json({ error: 'Could not load the run\'s bills' }, { status: 500 });
        }
        return NextResponse.json({ provisioned: true, run, bills: selections || [] });
    }

    const periodMonth = firstOfMonth(request.nextUrl.searchParams.get('month'));

    const runs = await listRuns({ organizationId: access.organizationId, periodMonth });
    if (!runs.ok) {
        if (runs.provisioned === false) {
            return NextResponse.json({ provisioned: false, runs: [], form: [] });
        }
        console.error('[electricity payment-runs]', runs.error);
        return NextResponse.json({ error: 'Could not load payment runs' }, { status: 500 });
    }

    // The form only makes sense alongside a month; without one, the run list alone.
    if (!periodMonth) {
        return NextResponse.json({ provisioned: true, runs: runs.data, form: null });
    }

    const draft = runs.data.find(r => r.status === 'draft' && r.period_month === periodMonth) ?? null;
    const form = await buildMonthForm({
        organizationId: access.organizationId,
        periodMonth,
        runId: draft?.id ?? null,
    });
    if (!form.ok) {
        if (form.provisioned === false) {
            return NextResponse.json({ provisioned: false, runs: [], form: [] });
        }
        console.error('[electricity payment-runs form]', form.error);
        return NextResponse.json({ error: 'Could not build the payment form' }, { status: 500 });
    }

    return NextResponse.json({ provisioned: true, runs: runs.data, draft_run: draft, form: form.data });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as { period_month?: string; organization_id?: string } | null;
    const access = await resolveElectricityAccess(request, readOrgId(request, body));
    if (isElectricityAccessError(access)) return access;

    if (!access.isSuperAdmin) {
        return NextResponse.json(
            { error: 'Forbidden: only org super admins can open a payment run' }, { status: 403 });
    }

    const periodMonth = firstOfMonth(body?.period_month ?? null);
    if (!periodMonth) {
        return NextResponse.json({ error: 'period_month (YYYY-MM or YYYY-MM-01) is required' }, { status: 400 });
    }

    const created = await createDraftRun({ organizationId: access.organizationId, periodMonth });
    if (!created.ok) {
        if (created.provisioned === false) {
            return NextResponse.json({ provisioned: false, error: 'Payment runs migration not applied yet' }, { status: 503 });
        }
        console.error('[electricity payment-runs create]', created.error);
        return NextResponse.json({ error: 'Could not create the payment run' }, { status: 500 });
    }

    return NextResponse.json({ provisioned: true, run: created.data }, { status: 201 });
}
