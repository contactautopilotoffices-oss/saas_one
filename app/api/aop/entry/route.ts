import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAopAccess, isAopAccessError, readOrgId, isMissingRelation } from '@/backend/lib/aop/access';
import { normaliseMonth } from '@/backend/lib/aop/matrix';

/**
 * PATCH /api/aop/entry — correct one cell of the matrix.
 *
 * Body: { org_id?, site_id, line_item_id, period_month, budget?, actual?, remarks? }
 *
 * Omitted fields are left alone; an explicit null clears the value. That distinction
 * matters — "I did not touch the budget" and "the budget is genuinely nothing" are
 * different edits and a PATCH that could not express both would force the UI to send back
 * values it never showed the user.
 *
 * Writes upsert rather than update: the importer skips cells that were entirely blank in
 * the workbook, so the first edit to a blank cell has no row to update. Every write sets
 * source='manual' so a later automated feed (or a re-import) can see the figure was
 * hand-corrected and decide whether it may overwrite it.
 *
 * Authorisation is resolveAopAccess, which already narrows to org super admins, master
 * admins and accounts. Deliberately no separate write role: anyone who can read this
 * P&L at all is senior enough to correct it, and every correction is stamped.
 */

export const dynamic = 'force-dynamic';

interface PatchBody {
    site_id?: string;
    line_item_id?: string;
    period_month?: string;
    budget?: number | string | null;
    actual?: number | string | null;
    remarks?: string | null;
}

/** Accepts "12,34,567" and "₹1234" as well as a number; rejects anything else. */
function parseAmount(raw: unknown): number | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    const cleaned = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,₹\s]/g, ''));
    if (!Number.isFinite(cleaned)) return undefined;
    return Math.round(cleaned * 100) / 100;
}

export async function PATCH(request: NextRequest) {
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveAopAccess(request, readOrgId(request, body));
    if (isAopAccessError(access)) return access;

    const { site_id: siteId, line_item_id: lineItemId } = body;
    const periodMonth = normaliseMonth(body.period_month);
    if (!siteId || !lineItemId || !periodMonth) {
        return NextResponse.json(
            { error: 'site_id, line_item_id and period_month are required' }, { status: 400 });
    }

    const budget = parseAmount(body.budget);
    const actual = parseAmount(body.actual);
    if (budget === undefined && body.budget !== undefined) {
        return NextResponse.json({ error: 'budget is not a number' }, { status: 400 });
    }
    if (actual === undefined && body.actual !== undefined) {
        return NextResponse.json({ error: 'actual is not a number' }, { status: 400 });
    }

    const remarksGiven = Object.prototype.hasOwnProperty.call(body, 'remarks');
    const remarks = remarksGiven
        ? (body.remarks === null ? null : String(body.remarks).trim().slice(0, 2000) || null)
        : undefined;

    if (budget === undefined && actual === undefined && remarks === undefined) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // The dimension rows must belong to the caller's org. Without this a valid session for
    // org A could name org B's site_id and write across the tenant boundary — the service
    // role bypasses RLS, so this check is the only thing standing there.
    const [siteRes, lineRes] = await Promise.all([
        supabaseAdmin.from('aop_sites')
            .select('id').eq('id', siteId).eq('organization_id', access.organizationId).maybeSingle(),
        supabaseAdmin.from('aop_line_items')
            .select('id, code, name, kind, unit')
            .eq('id', lineItemId).eq('organization_id', access.organizationId).maybeSingle(),
    ]);

    if (siteRes.error && isMissingRelation(siteRes.error)) {
        return NextResponse.json({ error: 'The AOP tracker is not set up yet' }, { status: 503 });
    }
    if (!siteRes.data || !lineRes.data) {
        return NextResponse.json({ error: 'Unknown site or line item for this organization' }, { status: 404 });
    }

    const { data: existing } = await supabaseAdmin
        .from('aop_entries')
        .select('id, budget, actual, remarks')
        .eq('site_id', siteId)
        .eq('line_item_id', lineItemId)
        .eq('period_month', periodMonth)
        .maybeSingle();

    const row = {
        organization_id: access.organizationId,
        site_id: siteId,
        line_item_id: lineItemId,
        period_month: periodMonth,
        budget: budget === undefined ? (existing?.budget ?? null) : budget,
        actual: actual === undefined ? (existing?.actual ?? null) : actual,
        remarks: remarks === undefined ? (existing?.remarks ?? null) : remarks,
        source: 'manual',
        source_ref: `manual:${access.user.email || access.user.id}`,
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
        .from('aop_entries')
        .upsert(row, { onConflict: 'site_id,line_item_id,period_month' })
        .select('id, site_id, line_item_id, period_month, budget, actual, saving, remarks, source')
        .single();

    if (error) {
        console.error('[aop entry]', error.message);
        return NextResponse.json({ error: 'Could not save the correction' }, { status: 500 });
    }

    return NextResponse.json({
        entry: {
            ...data,
            period_month: String(data.period_month).slice(0, 10),
            budget: data.budget === null ? null : Number(data.budget),
            actual: data.actual === null ? null : Number(data.actual),
            saving: data.saving === null ? null : Number(data.saving),
        },
        line_item: lineRes.data,
    });
}
