import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAopAccess, isAopAccessError, readOrgId, isMissingRelation } from '@/backend/lib/aop/access';

/**
 * GET /api/aop/summary
 *
 * "Are we on budget this month, and where are we bleeding?"
 *
 * Backs the AOP Budget-vs-Actual widget — the MIS spend hub. Returns the latest month's
 * pan-India position, the month before it for comparison, the sites that are over budget,
 * and the cost categories driving the overspend.
 *
 * Query params:
 *   org_id  — required when the caller belongs to more than one organization
 *   month   — YYYY-MM to pin a period; defaults to the latest month with data
 *
 * SIGN CONVENTION: `saving` is budget - actual. Positive = under budget = good. This
 * matches the spreadsheet the finance team already reads, whose "Var (Act-Bud)" header is
 * mislabelled — it actually computes budget minus actual. See 20260802000001_aop_tracker.sql.
 */

export const dynamic = 'force-dynamic';

interface SiteRow {
    site_id: string;
    site_name: string;
    property_id: string | null;
    period_month: string;
    budget_total: number | null;
    actual_total: number | null;
    saving_total: number | null;
    categories_over_budget: number | null;
    rent_budget: number | null;
    rent_actual: number | null;
    revenue_actual: number | null;
    seat_count: number | null;
    sqft_area: number | null;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function GET(request: NextRequest) {
    const access = await resolveAopAccess(request, readOrgId(request));
    if (isAopAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const pinnedMonth = sp.get('month');

    const { data, error } = await supabaseAdmin
        .from('aop_site_month_summary')
        .select('*')
        .eq('organization_id', access.organizationId)
        .order('period_month', { ascending: false })
        .range(0, 4999);

    if (error) {
        if (isMissingRelation(error)) {
            return NextResponse.json({ provisioned: false, months: [], current: null });
        }
        console.error('[aop summary]', error.message);
        return NextResponse.json({ error: 'Could not load the spend summary' }, { status: 500 });
    }

    const rows = (data || []) as SiteRow[];
    if (!rows.length) {
        return NextResponse.json({ provisioned: true, months: [], current: null, previous: null });
    }

    const months = [...new Set(rows.map(r => r.period_month))].sort().reverse();
    const currentMonth = pinnedMonth
        ? months.find(m => m.startsWith(pinnedMonth)) || months[0]
        : months[0];
    const previousMonth = months[months.indexOf(currentMonth) + 1] || null;

    const rollUp = (month: string | null) => {
        if (!month) return null;
        const scoped = rows.filter(r => r.period_month === month);
        if (!scoped.length) return null;

        const budget = scoped.reduce((s, r) => s + n(r.budget_total), 0);
        const actual = scoped.reduce((s, r) => s + n(r.actual_total), 0);
        const seats = scoped.reduce((s, r) => s + n(r.seat_count), 0);

        return {
            month,
            budget,
            actual,
            saving: budget - actual,
            // Guarded: a month with no budget would otherwise divide by zero and render NaN%.
            utilisation_pct: budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null,
            rent_actual: scoped.reduce((s, r) => s + n(r.rent_actual), 0),
            revenue_actual: scoped.reduce((s, r) => s + n(r.revenue_actual), 0),
            seat_count: seats,
            cost_per_seat: seats > 0 ? Math.round(actual / seats) : null,
            sites_total: scoped.length,
            sites_over_budget: scoped.filter(r => n(r.saving_total) < 0).length,
        };
    };

    const current = rollUp(currentMonth);
    const previous = rollUp(previousMonth);

    // Worst offenders this month, by absolute overspend.
    const overspending = rows
        .filter(r => r.period_month === currentMonth && n(r.saving_total) < 0)
        .map(r => ({
            site_id: r.site_id,
            site_name: r.site_name,
            property_id: r.property_id,
            budget: n(r.budget_total),
            actual: n(r.actual_total),
            overspend: -n(r.saving_total),
            overspend_pct: n(r.budget_total) > 0
                ? Math.round((-n(r.saving_total) / n(r.budget_total)) * 1000) / 10
                : null,
            categories_over_budget: n(r.categories_over_budget),
        }))
        .sort((a, b) => b.overspend - a.overspend);

    // Every site, ranked, for the expanded size class.
    const sites = rows
        .filter(r => r.period_month === currentMonth)
        .map(r => ({
            site_id: r.site_id,
            site_name: r.site_name,
            property_id: r.property_id,
            budget: n(r.budget_total),
            actual: n(r.actual_total),
            saving: n(r.saving_total),
            utilisation_pct: n(r.budget_total) > 0
                ? Math.round((n(r.actual_total) / n(r.budget_total)) * 1000) / 10
                : null,
            seat_count: r.seat_count ? n(r.seat_count) : null,
        }))
        .sort((a, b) => a.saving - b.saving);

    // Which cost categories drive the overspend — needs the entry grain, not the view.
    const { data: lineData } = await supabaseAdmin
        .from('aop_entries')
        .select('budget, actual, saving, aop_line_items!inner(code, name, kind)')
        .eq('organization_id', access.organizationId)
        .eq('period_month', currentMonth)
        .range(0, 9999);

    const byCategory = new Map<string, { code: string; name: string; budget: number; actual: number; saving: number }>();
    for (const row of (lineData || []) as any[]) {
        const li = Array.isArray(row.aop_line_items) ? row.aop_line_items[0] : row.aop_line_items;
        if (!li || li.kind !== 'cost') continue;   // never mix rent, metrics or roll-ups in
        const entry = byCategory.get(li.code) || { code: li.code, name: li.name, budget: 0, actual: 0, saving: 0 };
        entry.budget += n(row.budget);
        entry.actual += n(row.actual);
        entry.saving += n(row.saving);
        byCategory.set(li.code, entry);
    }
    const categories = [...byCategory.values()].sort((a, b) => a.saving - b.saving);

    // Unacknowledged import problems ride along so the widget can flag a stale/suspect MIS
    // rather than presenting numbers it has reason to doubt.
    const { data: warnings } = await supabaseAdmin
        .from('aop_import_warnings')
        .select('id, severity, message, sheet_name, site_label, imported_at')
        .eq('organization_id', access.organizationId)
        .eq('is_acknowledged', false)
        .order('imported_at', { ascending: false })
        .limit(20);

    return NextResponse.json({
        provisioned: true,
        months,
        current,
        previous,
        trend: current && previous
            ? {
                actual_delta: current.actual - previous.actual,
                actual_delta_pct: previous.actual > 0
                    ? Math.round(((current.actual - previous.actual) / previous.actual) * 1000) / 10
                    : null,
                sites_over_budget_delta: current.sites_over_budget - previous.sites_over_budget,
            }
            : null,
        overspending: overspending.slice(0, 10),
        sites,
        categories: categories.slice(0, 12),
        warnings: warnings || [],
    });
}
