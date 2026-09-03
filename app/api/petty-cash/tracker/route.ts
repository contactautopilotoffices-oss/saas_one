import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';

/**
 * GET /api/petty-cash/tracker — "what has gone out to this site, to whom, and did it
 * come back accounted for."
 *
 * PRD §9: the Pending Settlement and Employee-Wise Advance reports. The dashboard could
 * previously answer none of this — a property_id existed on every request but nothing
 * aggregated it, and there was no custodian to aggregate BY.
 *
 * ?property_id= scopes to one site; otherwise every property the caller may see.
 * Non-admin, non-finance callers are narrowed to their own property memberships, the
 * same scoping the 'all' tab in ../route.ts applies.
 */
export async function GET(request: NextRequest) {
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const propertyId = sp.get('property_id');
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || '50')));

    let q = supabaseAdmin
        .from('petty_cash_settlement_status')
        .select('*')
        .eq('organization_id', access.organizationId);

    if (propertyId) q = q.eq('property_id', propertyId);
    else if (!access.isAdmin && !access.canDisburse) {
        // Same fallback as the 'all' tab: own requests plus own properties.
        const scope = [`requester_id.eq.${access.user.id}`];
        if (access.propertyIds.length) scope.push(`property_id.in.(${access.propertyIds.join(',')})`);
        q = q.or(scope.join(','));
    }

    const { data, error } = await q.order('paid_at', { ascending: false, nullsFirst: false }).limit(limit);
    if (error) {
        // The view ships in 20260903000001_petty_cash_ledger.sql; report a missing
        // relation as "not provisioned" so the tab can prompt for the migration rather
        // than showing a 500 the user cannot act on.
        if (error.code === '42P01' || error.code === 'PGRST205') {
            return NextResponse.json({ provisioned: false, rows: [], by_property: [], by_custodian: [], totals: null });
        }
        console.error('Petty cash tracker error:', error);
        return NextResponse.json({ error: 'Could not load the petty cash tracker' }, { status: 500 });
    }

    const rows = data || [];
    const num = (v: any) => Number(v || 0);

    // Property names, resolved only for the rows actually returned.
    const propIds = [...new Set(rows.map((r) => r.property_id).filter(Boolean))] as string[];
    const propName = new Map<string, string>();
    if (propIds.length) {
        const { data: props } = await supabaseAdmin.from('properties').select('id, name, code').in('id', propIds);
        for (const p of props || []) propName.set(p.id, p.name || p.code || 'Unnamed site');
    }

    const bucket = () => ({ disbursed: 0, accounted: 0, unaccounted: 0, open_count: 0, requests: 0 });

    const byProperty = new Map<string, ReturnType<typeof bucket> & { property_id: string; property_name: string }>();
    for (const r of rows) {
        const id = r.property_id || 'unassigned';
        const g = byProperty.get(id) || { ...bucket(), property_id: id, property_name: propName.get(id) || 'Unassigned site' };
        g.requests += 1;
        g.disbursed += num(r.disbursed);
        g.accounted += num(r.accounted);
        g.unaccounted += num(r.unaccounted);
        if (r.is_open_advance) g.open_count += 1;
        byProperty.set(id, g);
    }

    // Who is actually holding cash. Falls back to the requester when no custodian was
    // named, so pre-migration rows still group somewhere sensible rather than vanishing.
    const byCustodian = new Map<string, ReturnType<typeof bucket> & { name: string; phone: string | null }>();
    for (const r of rows) {
        const name = (r.recipient_name || '').trim() || 'Requester (no custodian named)';
        const g = byCustodian.get(name) || { ...bucket(), name, phone: r.recipient_phone || null };
        g.requests += 1;
        g.disbursed += num(r.disbursed);
        g.accounted += num(r.accounted);
        g.unaccounted += num(r.unaccounted);
        if (r.is_open_advance) g.open_count += 1;
        if (!g.phone && r.recipient_phone) g.phone = r.recipient_phone;
        byCustodian.set(name, g);
    }

    const totals = rows.reduce(
        (acc, r) => ({
            requests: acc.requests + 1,
            disbursed: acc.disbursed + num(r.disbursed),
            accounted: acc.accounted + num(r.accounted),
            unaccounted: acc.unaccounted + num(r.unaccounted),
            open_count: acc.open_count + (r.is_open_advance ? 1 : 0),
            overdue_count: acc.overdue_count + (r.is_open_advance && num(r.days_outstanding) > 7 ? 1 : 0),
        }),
        { requests: 0, disbursed: 0, accounted: 0, unaccounted: 0, open_count: 0, overdue_count: 0 },
    );

    return NextResponse.json({
        provisioned: true,
        rows: rows.map((r) => ({ ...r, property_name: propName.get(r.property_id) || null })),
        by_property: [...byProperty.values()].sort((a, b) => b.unaccounted - a.unaccounted || b.disbursed - a.disbursed),
        by_custodian: [...byCustodian.values()].sort((a, b) => b.unaccounted - a.unaccounted || b.disbursed - a.disbursed),
        totals: {
            ...totals,
            accounted_pct: totals.disbursed > 0 ? Math.round((totals.accounted / totals.disbursed) * 1000) / 10 : null,
        },
    });
}
