import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAssetAccess, isAssetAccessError, readOrgId, scopedPropertyIds } from '@/backend/lib/assets/access';
import { ASSET_SELECT, enrichAssets } from '@/backend/lib/assets/enrich';

/**
 * GET /api/assets/reports — org (or property-scoped) rollup for the reporting
 * tab: performance grade distribution, warranty/AMC expiry watchlist, PPM
 * overdue count, and R&M spend by property for the current month and YTD.
 */
export async function GET(request: NextRequest) {
    const access = await resolveAssetAccess(request, readOrgId(request));
    if (isAssetAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const propertyId = sp.get('property_id');
    const propIds = scopedPropertyIds(access, propertyId);
    if (propIds !== null && propIds.length === 0) return NextResponse.json({ error: 'Forbidden: no access to this property' }, { status: 403 });

    let query = supabaseAdmin.from('assets').select(ASSET_SELECT).eq('organization_id', access.organizationId).is('deleted_at', null);
    if (propIds !== null) query = query.in('property_id', propIds);
    const { data: assetsRaw, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const assets = await enrichAssets((assetsRaw || []) as any);

    const byGrade = { P1: 0, P2: 0, P3: 0 } as Record<'P1' | 'P2' | 'P3', number>;
    const byCategory = new Map<string, { name: string; color: string | null; count: number }>();
    const byProperty = new Map<string, { name: string; count: number; grades: Record<string, number> }>();
    const expiringWarranty: any[] = [];
    const expiringAmc: any[] = [];
    const amcPendingList: any[] = [];

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in60 = new Date(today); in60.setDate(in60.getDate() + 60);

    for (const a of assets) {
        byGrade[a.health.grade]++;

        const catKey = a.category?.id || 'uncategorized';
        if (!byCategory.has(catKey)) byCategory.set(catKey, { name: a.category?.name || 'Uncategorized', color: a.category?.color || null, count: 0 });
        byCategory.get(catKey)!.count++;

        const propKey = a.property_id;
        if (!byProperty.has(propKey)) byProperty.set(propKey, { name: a.property?.name || propKey, count: 0, grades: { P1: 0, P2: 0, P3: 0 } });
        const p = byProperty.get(propKey)!;
        p.count++;
        p.grades[a.health.grade]++;

        const wEnd = a.warranty_end ? new Date(a.warranty_end) : null;
        if (wEnd && wEnd >= today && wEnd <= in60) {
            expiringWarranty.push({ id: a.id, asset_code: a.asset_code, name: a.name, property: a.property?.name, warranty_end: a.warranty_end });
        }
        if (a.amc?.contract_end_date) {
            const aEnd = new Date(a.amc.contract_end_date);
            if (aEnd >= today && aEnd <= in60 && !['expired', 'renewed'].includes(a.amc.status)) {
                expiringAmc.push({ id: a.id, asset_code: a.asset_code, name: a.name, property: a.property?.name, contract_end_date: a.amc.contract_end_date, system_name: a.amc.system_name });
            }
        }
        if (a.health.amc_pending) {
            amcPendingList.push({ id: a.id, asset_code: a.asset_code, name: a.name, property: a.property?.name, grade: a.health.grade });
        }
    }

    // R&M spend — this month and YTD, by property.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();

    let costQuery = supabaseAdmin
        .from('asset_events')
        .select('property_id, amount, occurred_at, asset:assets!inner(property:properties(name))')
        .eq('organization_id', access.organizationId)
        .eq('event_type', 'cost')
        .eq('cost_head', 'rnm')
        .gte('occurred_at', yearStart);
    if (propIds !== null) costQuery = costQuery.in('property_id', propIds);
    const { data: costRows } = await costQuery;

    const spendByProperty = new Map<string, { name: string; mtd: number; ytd: number }>();
    for (const row of (costRows || []) as any[]) {
        const name = row.asset?.property?.name || row.property_id;
        if (!spendByProperty.has(row.property_id)) spendByProperty.set(row.property_id, { name, mtd: 0, ytd: 0 });
        const s = spendByProperty.get(row.property_id)!;
        s.ytd += Number(row.amount || 0);
        if (row.occurred_at >= monthStart) s.mtd += Number(row.amount || 0);
    }

    return NextResponse.json({
        total_assets: assets.length,
        by_grade: byGrade,
        by_category: [...byCategory.values()].sort((a, b) => b.count - a.count),
        by_property: [...byProperty.entries()].map(([id, v]) => ({ property_id: id, ...v })).sort((a, b) => b.count - a.count),
        expiring_warranty: expiringWarranty.sort((a, b) => a.warranty_end.localeCompare(b.warranty_end)),
        expiring_amc: expiringAmc.sort((a, b) => a.contract_end_date.localeCompare(b.contract_end_date)),
        amc_pending: amcPendingList,
        rnm_spend: [...spendByProperty.entries()].map(([id, v]) => ({ property_id: id, ...v })).sort((a, b) => b.ytd - a.ytd),
        overdue_ppm_total: assets.reduce((sum, a) => sum + a.overdue_ppm, 0),
        open_ticket_total: assets.reduce((sum, a) => sum + a.open_tickets, 0),
    });
}
