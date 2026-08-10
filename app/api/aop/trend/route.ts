import { NextRequest, NextResponse } from 'next/server';
import { resolveAopAccess, isAopAccessError, readOrgId } from '@/backend/lib/aop/access';
import {
    loadDimensions, loadCells, rollUpSite, UNPROVISIONED,
    type AopCell, type AopLineItem,
} from '@/backend/lib/aop/matrix';

/**
 * GET /api/aop/trend
 *
 * Budget vs actual over time for whichever slice the caller drilled into. One endpoint
 * covers all four because the shape is identical and the client should not have to know
 * which of them it is asking for:
 *
 *   site_id + line_item_code   one cell's history          (clicked a grid cell)
 *   site_id                    that site's ops roll-up     (clicked a column header)
 *   line_item_code             that category, pan-India    (clicked a row header)
 *   neither                    pan-India ops               (the headline)
 *
 * Roll-ups are cost-only. A trend that quietly folded in rent would step by ~Rs 3cr and
 * make every real movement invisible.
 */

export const dynamic = 'force-dynamic';

interface Point {
    month: string;
    budget: number;
    actual: number;
    saving: number;
    utilisation_pct: number | null;
    remarks: string | null;
}

export async function GET(request: NextRequest) {
    const access = await resolveAopAccess(request, readOrgId(request));
    if (isAopAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const siteId = sp.get('site_id');
    const lineCode = sp.get('line_item_code');

    let dims;
    try {
        dims = await loadDimensions(access.organizationId);
    } catch (e) {
        console.error('[aop trend] dimensions', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not load the trend' }, { status: 500 });
    }
    if (dims === UNPROVISIONED) {
        return NextResponse.json({ provisioned: false, points: [], scope: null });
    }

    const { sites, lineItems, months } = dims;
    if (!months.length) return NextResponse.json({ provisioned: true, points: [], scope: null });

    const lineItem = lineCode ? lineItems.find(li => li.code === lineCode) : null;
    if (lineCode && !lineItem) {
        return NextResponse.json({ error: 'Unknown line_item_code' }, { status: 404 });
    }
    const site = siteId ? sites.find(s => s.id === siteId) : null;
    if (siteId && !site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    let byMonth;
    try {
        byMonth = await loadCells(access.organizationId, months);
    } catch (e) {
        console.error('[aop trend] cells', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not load the trend' }, { status: 500 });
    }
    if (byMonth === UNPROVISIONED) {
        return NextResponse.json({ provisioned: false, points: [], scope: null });
    }

    const lineById = new Map<string, AopLineItem>(lineItems.map(li => [li.id, li]));

    // Chronological, because a chart read right-to-left is a chart nobody reads.
    const ordered = [...months].sort();
    const points: Point[] = ordered.map(month => {
        let scoped: AopCell[] = byMonth.get(month) || [];
        if (site) scoped = scoped.filter(c => c.site_id === site.id);

        if (lineItem) {
            const matching = scoped.filter(c => c.line_item_id === lineItem.id);
            const budget = matching.reduce((s, c) => s + Number(c.budget ?? 0), 0);
            const actual = matching.reduce((s, c) => s + Number(c.actual ?? 0), 0);
            return {
                month,
                budget,
                actual,
                saving: budget - actual,
                utilisation_pct: budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null,
                // Only a single cell has one authoritative remark; a pan-India row does not.
                remarks: matching.length === 1 ? matching[0].remarks : null,
            };
        }

        // No line item pinned: roll up the cost lines only.
        const totals = rollUpSite(scoped, lineById).cost;
        return {
            month,
            budget: totals.budget,
            actual: totals.actual,
            saving: totals.saving,
            utilisation_pct: totals.budget > 0
                ? Math.round((totals.actual / totals.budget) * 1000) / 10 : null,
            remarks: null,
        };
    });

    return NextResponse.json({
        provisioned: true,
        scope: {
            site: site ? { id: site.id, name: site.name } : null,
            line_item: lineItem
                ? { code: lineItem.code, name: lineItem.name, kind: lineItem.kind, unit: lineItem.unit }
                : null,
            label: [site?.name, lineItem?.name].filter(Boolean).join(' · ') || 'Pan-India ops cost',
        },
        points,
    });
}
