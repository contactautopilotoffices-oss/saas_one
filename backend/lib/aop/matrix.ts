import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';

/**
 * Shared loader + roll-up maths for the AOP Budget-vs-Actual matrix.
 *
 * Lives outside the route handlers because /api/aop/matrix and /api/aop/export must
 * produce the SAME numbers. An export that disagrees with the screen is worse than no
 * export at all — the finance team would have two sources of truth and trust neither.
 *
 * SIGN CONVENTION (repeated here because getting it wrong silently inverts the whole
 * module): `saving` = budget - actual. POSITIVE means under budget, which is good. The
 * source workbook's "Var (Act-Bud)" header is mislabelled; it computes budget - actual.
 * See supabase/migrations/20260802000001_aop_tracker.sql.
 *
 * KIND DISCIPLINE: never sum across kinds. 'cost' is the ops roll-up. 'rent' is a flat
 * ~Rs 3cr/month and folding it in doubles apparent ops spend. 'total' rows are the
 * workbook's own arithmetic and double-count. 'metric' rows are seats and square feet,
 * not rupees.
 */

export type AopKind = 'cost' | 'rent' | 'revenue' | 'metric' | 'total';

export interface AopSite {
    id: string;
    code: string;
    name: string;
    city: string | null;
    property_id: string | null;
    sort_order: number;
}

export interface AopLineItem {
    id: string;
    code: string;
    name: string;
    kind: AopKind;
    unit: string;
    feed_source: string | null;
    sort_order: number;
}

export interface AopCell {
    id: string;
    site_id: string;
    line_item_id: string;
    budget: number | null;
    actual: number | null;
    saving: number | null;
    remarks: string | null;
    source: string;
}

/** Budget/actual/saving triple. `saving` is recomputed, never trusted from the row. */
export interface AopTotals {
    budget: number;
    actual: number;
    saving: number;
}

export interface AopSiteTotals {
    cost: AopTotals;
    rent: AopTotals;
    revenue: AopTotals;
    /** Ops + rent, matching the workbook's "TOTAL SPEND (Ops + Rent)" row. */
    total_spend: AopTotals;
    seat_count: number | null;
    sqft_area: number | null;
    /** Ops actual per seat — the workbook's per-seat economics, recomputed. */
    cost_per_seat: number | null;
    cost_per_sqft: number | null;
    categories_over_budget: number;
}

export interface AopGrand extends AopSiteTotals {
    sites_total: number;
    sites_over_budget: number;
}

const KEY = (siteId: string, lineItemId: string) => `${siteId}:${lineItemId}`;

const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
};

const zero = (): AopTotals => ({ budget: 0, actual: 0, saving: 0 });

const add = (t: AopTotals, cell: AopCell): void => {
    t.budget += n(cell.budget);
    t.actual += n(cell.actual);
    // Recomputed rather than summing the stored generated column, so a null budget with a
    // real actual still lands as an overspend instead of vanishing.
    t.saving += n(cell.budget) - n(cell.actual);
};

/** A month string in any of 'YYYY-MM' / 'YYYY-MM-DD' form, normalised to the 1st. */
export function normaliseMonth(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const m = /^(\d{4})-(\d{2})/.exec(raw.trim());
    return m ? `${m[1]}-${m[2]}-01` : null;
}

export const monthLabel = (month: string): string =>
    new Date(`${month.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
        month: 'short', year: 'numeric', timeZone: 'UTC',
    });

export interface AopDimensions {
    sites: AopSite[];
    lineItems: AopLineItem[];
    months: string[];
}

/** Sentinel for "the tables are not there yet" — the migration has not been applied. */
export const UNPROVISIONED = Symbol('aop-unprovisioned');
export type Unprovisioned = typeof UNPROVISIONED;

/**
 * Sites, line items and the distinct months that hold data.
 *
 * Every read carries an explicit .range(). PostgREST silently truncates at 1000 rows and
 * this dataset is 16 sites x 43 lines x N months — a truncated matrix would render as a
 * grid full of blanks with no error anywhere, which is the worst possible failure for a
 * financial report.
 */
export async function loadDimensions(orgId: string): Promise<AopDimensions | Unprovisioned> {
    const [siteRes, lineRes, monthRes] = await Promise.all([
        supabaseAdmin
            .from('aop_sites')
            .select('id, code, name, city, property_id, sort_order')
            .eq('organization_id', orgId)
            .eq('is_active', true)
            .order('sort_order')
            .range(0, 999),
        supabaseAdmin
            .from('aop_line_items')
            .select('id, code, name, kind, unit, feed_source, sort_order')
            .eq('organization_id', orgId)
            .order('sort_order')
            .range(0, 999),
        supabaseAdmin
            .from('aop_entries')
            .select('period_month')
            .eq('organization_id', orgId)
            .order('period_month', { ascending: false })
            .range(0, 99999),
    ]);

    const firstError = siteRes.error || lineRes.error || monthRes.error;
    if (firstError) {
        if (isMissingRelation(firstError)) return UNPROVISIONED;
        throw new Error(firstError.message);
    }

    const months = [...new Set((monthRes.data || []).map(r => String(r.period_month).slice(0, 10)))]
        .sort()
        .reverse();

    return {
        sites: (siteRes.data || []) as AopSite[],
        lineItems: (lineRes.data || []) as AopLineItem[],
        months,
    };
}

export async function loadCells(
    orgId: string,
    months: string[],
): Promise<Map<string, AopCell[]> | Unprovisioned> {
    if (!months.length) return new Map();

    const { data, error } = await supabaseAdmin
        .from('aop_entries')
        .select('id, site_id, line_item_id, period_month, budget, actual, saving, remarks, source')
        .eq('organization_id', orgId)
        .in('period_month', months)
        // 16 x 43 x 3 = 2064 today, and grows a further 688 every month. The default cap
        // of 1000 was already breached before this module existed.
        .range(0, 99999);

    if (error) {
        if (isMissingRelation(error)) return UNPROVISIONED;
        throw new Error(error.message);
    }

    const byMonth = new Map<string, AopCell[]>();
    for (const row of data || []) {
        const month = String((row as { period_month: string }).period_month).slice(0, 10);
        const list = byMonth.get(month);
        const cell: AopCell = {
            id: String(row.id),
            site_id: String(row.site_id),
            line_item_id: String(row.line_item_id),
            budget: row.budget === null ? null : Number(row.budget),
            actual: row.actual === null ? null : Number(row.actual),
            saving: row.saving === null ? null : Number(row.saving),
            remarks: row.remarks ?? null,
            source: String(row.source),
        };
        if (list) list.push(cell);
        else byMonth.set(month, [cell]);
    }
    return byMonth;
}

/**
 * Kind-aware roll-up for one site.
 *
 * The `total` kind is deliberately absent from every accumulator: those rows are the
 * workbook's own sums and adding them would double-count. They are still returned as
 * cells so the UI can show the source figure beside our recomputation.
 */
export function rollUpSite(
    cells: AopCell[],
    lineKind: Map<string, AopLineItem>,
): AopSiteTotals {
    const cost = zero();
    const rent = zero();
    const revenue = zero();
    let seatCount: number | null = null;
    let sqftArea: number | null = null;
    let categoriesOverBudget = 0;

    for (const cell of cells) {
        const li = lineKind.get(cell.line_item_id);
        if (!li) continue;

        switch (li.kind) {
            case 'cost':
                add(cost, cell);
                if (n(cell.budget) - n(cell.actual) < 0) categoriesOverBudget++;
                break;
            case 'rent':
                add(rent, cell);
                break;
            case 'revenue':
                add(revenue, cell);
                break;
            case 'metric':
                // Seats and area are descriptors, not money. The workbook puts the same
                // figure in both the budget and actual column; prefer actual, fall back.
                if (li.code === 'seat-count') seatCount = cell.actual ?? cell.budget ?? seatCount;
                if (li.code === 'sqft-area') sqftArea = cell.actual ?? cell.budget ?? sqftArea;
                break;
            case 'total':
                break;
        }
    }

    const totalSpend: AopTotals = {
        budget: cost.budget + rent.budget,
        actual: cost.actual + rent.actual,
        saving: cost.saving + rent.saving,
    };

    return {
        cost,
        rent,
        revenue,
        total_spend: totalSpend,
        seat_count: seatCount,
        sqft_area: sqftArea,
        cost_per_seat: seatCount && seatCount > 0 ? Math.round(cost.actual / seatCount) : null,
        cost_per_sqft: sqftArea && sqftArea > 0 ? Math.round((cost.actual / sqftArea) * 100) / 100 : null,
        categories_over_budget: categoriesOverBudget,
    };
}

/** Pan-India roll-up. Sums the per-site roll-ups so the kind rules apply exactly once. */
export function rollUpGrand(perSite: Map<string, AopSiteTotals>): AopGrand {
    const grand: AopGrand = {
        cost: zero(),
        rent: zero(),
        revenue: zero(),
        total_spend: zero(),
        seat_count: 0,
        sqft_area: 0,
        cost_per_seat: null,
        cost_per_sqft: null,
        categories_over_budget: 0,
        sites_total: perSite.size,
        sites_over_budget: 0,
    };

    for (const t of perSite.values()) {
        for (const bucket of ['cost', 'rent', 'revenue', 'total_spend'] as const) {
            grand[bucket].budget += t[bucket].budget;
            grand[bucket].actual += t[bucket].actual;
            grand[bucket].saving += t[bucket].saving;
        }
        grand.seat_count = (grand.seat_count ?? 0) + (t.seat_count ?? 0);
        grand.sqft_area = (grand.sqft_area ?? 0) + (t.sqft_area ?? 0);
        grand.categories_over_budget += t.categories_over_budget;
        if (t.cost.saving < 0) grand.sites_over_budget++;
    }

    grand.cost_per_seat = grand.seat_count && grand.seat_count > 0
        ? Math.round(grand.cost.actual / grand.seat_count) : null;
    grand.cost_per_sqft = grand.sqft_area && grand.sqft_area > 0
        ? Math.round((grand.cost.actual / grand.sqft_area) * 100) / 100 : null;

    return grand;
}

/** Row-wise totals across sites. Only ever compared within one line item, so kind-safe. */
export function rollUpLines(cells: AopCell[]): Map<string, AopTotals> {
    const byLine = new Map<string, AopTotals>();
    for (const cell of cells) {
        let t = byLine.get(cell.line_item_id);
        if (!t) {
            t = zero();
            byLine.set(cell.line_item_id, t);
        }
        add(t, cell);
    }
    return byLine;
}

/** Cells keyed for O(1) grid lookup: `${site_id}:${line_item_id}`. */
export function indexCells(cells: AopCell[]): Record<string, AopCell> {
    const out: Record<string, AopCell> = {};
    for (const cell of cells) out[KEY(cell.site_id, cell.line_item_id)] = cell;
    return out;
}

export { KEY as cellKey };
