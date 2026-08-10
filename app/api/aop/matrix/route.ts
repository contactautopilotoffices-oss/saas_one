import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAopAccess, isAopAccessError, readOrgId } from '@/backend/lib/aop/access';
import {
    loadDimensions, loadCells, rollUpSite, rollUpGrand, rollUpLines, indexCells,
    normaliseMonth, UNPROVISIONED,
    type AopCell, type AopLineItem, type AopSiteTotals, type AopTotals,
} from '@/backend/lib/aop/matrix';

/**
 * GET /api/aop/matrix
 *
 * The grid payload behind the AOP workspace — the whole "Site wise" sheet, as data.
 *
 *   ?org_id=      required when the caller belongs to more than one organisation
 *   ?month=       YYYY-MM; defaults to the latest month holding data
 *   ?view=summary sites x line items for that one month          (default)
 *   ?view=site    one site, all line items, every month, for the drill-down
 *   ?site_id=     required by view=site
 *
 * Both views return the same dimension arrays so the client can render either without a
 * second round trip, and both keep the roll-ups kind-separated — ops cost, rent, revenue
 * and metrics never merge. See backend/lib/aop/matrix.ts for why that matters.
 */

export const dynamic = 'force-dynamic';

const EDIT_ROLES = ['org_super_admin', 'master_admin', 'accounts'];

function serialiseTotals(t: AopSiteTotals) {
    return {
        ...t,
        utilisation_pct: t.cost.budget > 0
            ? Math.round((t.cost.actual / t.cost.budget) * 1000) / 10
            : null,
    };
}

export async function GET(request: NextRequest) {
    const access = await resolveAopAccess(request, readOrgId(request));
    if (isAopAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const view = sp.get('view') === 'site' ? 'site' : 'summary';
    const requestedMonth = normaliseMonth(sp.get('month'));
    const siteId = sp.get('site_id');

    if (view === 'site' && !siteId) {
        return NextResponse.json({ error: 'site_id is required for view=site' }, { status: 400 });
    }

    let dims;
    try {
        dims = await loadDimensions(access.organizationId);
    } catch (e) {
        console.error('[aop matrix] dimensions', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not load the spend matrix' }, { status: 500 });
    }

    const canEdit = access.isSuperAdmin || access.roles.some(r => EDIT_ROLES.includes(r));

    if (dims === UNPROVISIONED) {
        return NextResponse.json({
            provisioned: false, view, month: null, months: [],
            sites: [], line_items: [], cells: {}, can_edit: canEdit,
        });
    }

    const { sites, lineItems, months } = dims;
    if (!months.length) {
        return NextResponse.json({
            provisioned: true, view, month: null, months: [],
            sites, line_items: lineItems, cells: {}, can_edit: canEdit,
        });
    }

    // A month the caller pinned that holds no data would render an empty grid with no
    // explanation; fall back to the latest real month and say so via `month`.
    const month = requestedMonth && months.includes(requestedMonth) ? requestedMonth : months[0];
    const wanted = view === 'site' ? months : [month];

    let byMonth;
    try {
        byMonth = await loadCells(access.organizationId, wanted);
    } catch (e) {
        console.error('[aop matrix] cells', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not load the spend matrix' }, { status: 500 });
    }
    if (byMonth === UNPROVISIONED) {
        return NextResponse.json({
            provisioned: false, view, month: null, months: [],
            sites: [], line_items: [], cells: {}, can_edit: canEdit,
        });
    }

    const lineById = new Map<string, AopLineItem>(lineItems.map(li => [li.id, li]));

    // Unacknowledged warnings ride along so the workspace can head the grid with a caveat
    // rather than presenting figures it has reason to doubt.
    const { data: warnings } = await supabaseAdmin
        .from('aop_import_warnings')
        .select('id, severity, message, sheet_name, site_label, imported_at')
        .eq('organization_id', access.organizationId)
        .eq('is_acknowledged', false)
        .order('imported_at', { ascending: false })
        .limit(50);

    const base = {
        provisioned: true as const,
        month,
        months,
        sites,
        line_items: lineItems,
        can_edit: canEdit,
        warnings: warnings || [],
    };

    if (view === 'summary') {
        const cells = byMonth.get(month) || [];

        const bySite = new Map<string, AopCell[]>();
        for (const cell of cells) {
            const list = bySite.get(cell.site_id);
            if (list) list.push(cell);
            else bySite.set(cell.site_id, [cell]);
        }

        const siteTotals = new Map<string, AopSiteTotals>();
        for (const site of sites) {
            siteTotals.set(site.id, rollUpSite(bySite.get(site.id) || [], lineById));
        }

        // Row totals are only meaningful inside one line item, so summing every site's
        // cell for that row stays kind-safe by construction.
        const lineTotals = rollUpLines(cells);

        return NextResponse.json({
            ...base,
            view: 'summary',
            cells: indexCells(cells),
            site_totals: Object.fromEntries(
                [...siteTotals].map(([id, t]) => [id, serialiseTotals(t)]),
            ),
            line_totals: Object.fromEntries(lineTotals),
            grand: rollUpGrand(siteTotals),
        });
    }

    // view=site — the same grid transposed onto time: line items x months for one site.
    const site = sites.find(s => s.id === siteId);
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    const cellsByMonth: Record<string, Record<string, AopCell>> = {};
    const totalsByMonth: Record<string, ReturnType<typeof serialiseTotals>> = {};
    const lineTotalsByMonth: Record<string, Record<string, AopTotals>> = {};

    for (const m of months) {
        const scoped = (byMonth.get(m) || []).filter(c => c.site_id === site.id);
        cellsByMonth[m] = Object.fromEntries(scoped.map(c => [c.line_item_id, c]));
        totalsByMonth[m] = serialiseTotals(rollUpSite(scoped, lineById));
        lineTotalsByMonth[m] = Object.fromEntries(rollUpLines(scoped));
    }

    return NextResponse.json({
        ...base,
        view: 'site',
        site,
        cells_by_month: cellsByMonth,
        totals_by_month: totalsByMonth,
        line_totals_by_month: lineTotalsByMonth,
    });
}
