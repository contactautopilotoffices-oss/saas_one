import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveElectricityAccess, isElectricityAccessError, readOrgId, isMissingRelation } from '@/backend/lib/electricity/access';
import {
    loadAlertRows, loadBillingAccounts, loadAopActualByMonth,
    computeDeadlines, computeDiscountPerformance, computeSeasonality,
    computeReconciliation, billedTotalsByMonth,
} from '@/backend/lib/electricity/tracker';

/**
 * GET /api/electricity/tracker
 *
 * The Excel replacement's data source: one payload backing all four sub-views (deadlines,
 * register, discount performance, reconciliation) plus the seasonality trend. One request
 * rather than four so the figures are guaranteed to agree with each other on screen — the
 * register total and the reconciliation's billed total, for instance, come from the same
 * fetch of electricity_bill_alerts, not two independent queries that could race.
 *
 * Query params (all optional, org-scoped):
 *   org_id      — required when the caller belongs to more than one organization
 *   month       — YYYY-MM, filters the REGISTER only (other sections stay whole-history)
 *   account_id  — filters the REGISTER only
 *   status      — 'pending' | 'paid' | 'disputed', filters the REGISTER only
 *   urgency     — filters the REGISTER only
 *
 * Deadlines, discount performance, reconciliation and seasonality are deliberately NOT
 * filtered by these params — they answer "what does the whole book look like", and a
 * month filter that quietly narrowed them too would make the headline figures lie.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const access = await resolveElectricityAccess(request, readOrgId(request));
    if (isElectricityAccessError(access)) return access;

    let alerts, accounts;
    try {
        [alerts, accounts] = await Promise.all([
            loadAlertRows(access.organizationId),
            loadBillingAccounts(access.organizationId),
        ]);
    } catch (e) {
        console.error('[electricity tracker]', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not load the electricity tracker' }, { status: 500 });
    }

    if (!alerts.provisioned) {
        return NextResponse.json({
            provisioned: false,
            reason: 'The electricity bill tables are not set up yet. Apply ' +
                'supabase/migrations/20260802000002_electricity_bills.sql, then run ' +
                'node scripts/import_electricity_bills.js --commit to load the workbook.',
        });
    }

    const rows = alerts.data;
    const billingAccounts = accounts.provisioned ? accounts.data : [];

    // ---- Register: filterable, everything else below is not -------------------------
    const sp = new URL(request.url).searchParams;
    const monthFilter = sp.get('month');   // 'YYYY-MM'
    const accountFilter = sp.get('account_id');
    const statusFilter = sp.get('status');
    const urgencyFilter = sp.get('urgency');

    const registerRows = rows.filter(r =>
        (!monthFilter || r.billing_month.startsWith(monthFilter)) &&
        (!accountFilter || r.account_id === accountFilter) &&
        (!statusFilter || r.payment_status === statusFilter) &&
        (!urgencyFilter || r.urgency === urgencyFilter),
    );

    // Phase 1 pipeline fields (document_id for the register's PDF paperclip,
    // workflow_status for the reconciliation closed loop) live on electricity_bills, not
    // on the alerts view. Merge them in here; when the ingestion migration is not applied
    // the columns are missing and the register simply renders without them.
    let pipelineByBill = new Map<string, { document_id: string | null; workflow_status: string | null }>();
    {
        const { data: pipelineRows, error: pipelineErr } = await supabaseAdmin
            .from('electricity_bills')
            .select('id, document_id, workflow_status')
            .eq('organization_id', access.organizationId)
            .range(0, 4999);
        if (!pipelineErr && pipelineRows) {
            pipelineByBill = new Map(
                (pipelineRows as { id: string; document_id: string | null; workflow_status: string | null }[])
                    .map(r => [r.id, { document_id: r.document_id, workflow_status: r.workflow_status }]),
            );
        } else if (pipelineErr && !isMissingRelation(pipelineErr)) {
            console.error('[electricity tracker] pipeline merge:', pipelineErr.message);
        }
    }
    const registerWithPipeline = registerRows.map(r => ({ ...r, ...pipelineByBill.get(r.id) }));

    // ---- Reconciliation ----------------------------------------------------------------
    let aopActual;
    try {
        aopActual = await loadAopActualByMonth(access.organizationId);
    } catch (e) {
        console.error('[electricity tracker reconciliation]', e instanceof Error ? e.message : e);
        aopActual = { provisioned: false, lineItemFound: false, byMonth: new Map<string, number>() };
    }
    const billedByMonth = billedTotalsByMonth(rows);
    const reconciliation = computeReconciliation(billedByMonth, aopActual);

    return NextResponse.json({
        provisioned: true,
        months: [...new Set(rows.map(r => r.billing_month))].sort().reverse(),
        accounts: billingAccounts.map(a => ({
            id: a.id, site_label: a.site_label, provider: a.provider,
            consumer_ref: a.consumer_ref, property_id: a.property_id,
            early_payment_discount_pct: a.early_payment_discount_pct,
        })),

        register: {
            rows: registerWithPipeline,
            total: registerWithPipeline.length,
        },

        deadlines: computeDeadlines(rows),

        discount_performance: computeDiscountPerformance(rows),

        reconciliation: {
            rows: reconciliation,
            aop_provisioned: aopActual.provisioned,
            aop_line_item_found: aopActual.lineItemFound,
        },

        seasonality: computeSeasonality(rows),
    });
}

// ---------------------------------------------------------------------------------------
// PATCH — inline payment-status edit from the Register view.
//
// Body: { org_id?, bill_id, payment_status?, payment_date?, paid_amount?, notes? }
// Omitted fields are left alone; an explicit null clears the value — same contract as
// PATCH /api/aop/entry, for the same reason: "not touched" and "genuinely blank" are
// different edits.
// ---------------------------------------------------------------------------------------

interface PatchBody {
    bill_id?: string;
    payment_status?: 'pending' | 'paid' | 'disputed';
    payment_date?: string | null;
    paid_amount?: number | string | null;
    notes?: string | null;
}

const VALID_STATUSES = ['pending', 'paid', 'disputed'];

function parseAmount(raw: unknown): number | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    const cleaned = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,₹\s]/g, ''));
    return Number.isFinite(cleaned) ? Math.round(cleaned * 100) / 100 : undefined;
}

export async function PATCH(request: NextRequest) {
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveElectricityAccess(request, readOrgId(request, body));
    if (isElectricityAccessError(access)) return access;

    if (!body.bill_id) {
        return NextResponse.json({ error: 'bill_id is required' }, { status: 400 });
    }
    if (body.payment_status !== undefined && !VALID_STATUSES.includes(body.payment_status)) {
        return NextResponse.json({ error: `payment_status must be one of ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }

    const paidAmount = parseAmount(body.paid_amount);
    if (paidAmount === undefined && body.paid_amount !== undefined) {
        return NextResponse.json({ error: 'paid_amount is not a number' }, { status: 400 });
    }

    // The bill must belong to the caller's org — the service role bypasses RLS, so this
    // check is the only thing standing between a valid session for org A and a bill_id
    // borrowed from org B.
    const { data: existing, error: findErr } = await supabaseAdmin
        .from('electricity_bills')
        .select('id, payment_status, payment_date, paid_amount, notes')
        .eq('id', body.bill_id)
        .eq('organization_id', access.organizationId)
        .maybeSingle();

    if (findErr) {
        if (isMissingRelation(findErr)) {
            return NextResponse.json({ error: 'The electricity tracker is not set up yet' }, { status: 503 });
        }
        console.error('[electricity tracker patch]', findErr.message);
        return NextResponse.json({ error: 'Could not load the bill' }, { status: 500 });
    }
    if (!existing) {
        return NextResponse.json({ error: 'Unknown bill for this organization' }, { status: 404 });
    }

    const notesGiven = Object.prototype.hasOwnProperty.call(body, 'notes');

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.payment_status !== undefined) update.payment_status = body.payment_status;
    if (Object.prototype.hasOwnProperty.call(body, 'payment_date')) update.payment_date = body.payment_date || null;
    if (paidAmount !== undefined) update.paid_amount = paidAmount;
    if (notesGiven) update.notes = body.notes === null ? null : String(body.notes).trim().slice(0, 2000) || null;

    if (Object.keys(update).length === 1) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from('electricity_bills')
        .update(update)
        .eq('id', body.bill_id)
        .select('id, payment_status, payment_date, paid_amount, notes')
        .single();

    if (error) {
        console.error('[electricity tracker patch]', error.message);
        return NextResponse.json({ error: 'Could not save the change' }, { status: 500 });
    }

    return NextResponse.json({ bill: data });
}
