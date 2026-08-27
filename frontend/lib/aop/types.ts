/**
 * Client-side contract for the AOP Budget-vs-Actual workspace.
 *
 * Mirrors what backend/lib/aop/matrix.ts serialises. Kept as a hand-written mirror rather
 * than importing the server types so a client bundle never pulls in supabase-admin.
 *
 * SIGN CONVENTION: `saving` = budget - actual. Positive is under budget and good. Every
 * helper below encodes that once so no component re-derives it and gets it backwards.
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

export interface AopTotals {
    budget: number;
    actual: number;
    saving: number;
}

export interface AopSiteTotals {
    cost: AopTotals;
    rent: AopTotals;
    revenue: AopTotals;
    total_spend: AopTotals;
    seat_count: number | null;
    sqft_area: number | null;
    cost_per_seat: number | null;
    cost_per_sqft: number | null;
    categories_over_budget: number;
    utilisation_pct: number | null;
}

export interface AopGrand extends AopSiteTotals {
    sites_total: number;
    sites_over_budget: number;
}

export interface AopWarning {
    id: string;
    severity: 'info' | 'warning' | 'error';
    sheet_name: string | null;
    site_label: string | null;
    message: string;
    imported_at: string;
    is_acknowledged?: boolean;
}

interface MatrixBase {
    provisioned: boolean;
    month: string | null;
    months: string[];
    sites: AopSite[];
    line_items: AopLineItem[];
    can_edit: boolean;
    warnings?: AopWarning[];
}

export interface AopSummaryMatrix extends MatrixBase {
    view: 'summary';
    cells: Record<string, AopCell>;
    site_totals: Record<string, AopSiteTotals>;
    line_totals: Record<string, AopTotals>;
    grand: AopGrand;
}

export interface AopSiteMatrix extends MatrixBase {
    view: 'site';
    site: AopSite;
    cells_by_month: Record<string, Record<string, AopCell>>;
    totals_by_month: Record<string, AopSiteTotals>;
    line_totals_by_month: Record<string, Record<string, AopTotals>>;
}

export interface AopTrendPoint {
    month: string;
    budget: number;
    actual: number;
    saving: number;
    utilisation_pct: number | null;
    remarks: string | null;
}

export interface AopTrend {
    provisioned: boolean;
    scope: { label: string } | null;
    points: AopTrendPoint[];
}

export const cellKey = (siteId: string, lineItemId: string) => `${siteId}:${lineItemId}`;

// ---------------------------------------------------------------------------
// Row grouping
//
// 43 rows in one undifferentiated list is unreadable and, worse, invites a reader to add
// them up. Grouping by kind makes the arithmetic rules visible in the layout itself.
// ---------------------------------------------------------------------------
export interface AopGroup {
    kind: AopKind;
    label: string;
    /** Shown under the group heading — states what may and may not be summed. */
    note: string;
    /** Collapsed on first paint. Only the ops costs matter to most readers. */
    defaultOpen: boolean;
}

export const AOP_GROUPS: AopGroup[] = [
    { kind: 'cost', label: 'Operating cost', note: 'The ops roll-up. Rent and revenue are held out.', defaultOpen: true },
    { kind: 'rent', label: 'Rent', note: 'Flat landlord charge, excluded from ops cost by design.', defaultOpen: false },
    { kind: 'revenue', label: 'Revenue', note: 'Money coming back in — never netted off a cost line.', defaultOpen: false },
    { kind: 'metric', label: 'Metrics', note: 'Seats and area. Denominators, not rupees.', defaultOpen: false },
    { kind: 'total', label: 'Source roll-ups', note: "The workbook's own totals, kept for reconciliation. Not summed anywhere.", defaultOpen: false },
];

// ---------------------------------------------------------------------------
// Formatting — Indian conventions throughout. This is an Indian business:
// 12,34,567 not 1,234,567.
// ---------------------------------------------------------------------------

export function inr(value: number | null | undefined, compact = false): string {
    const v = Number(value ?? 0) || 0;
    if (compact) {
        const abs = Math.abs(v);
        const sign = v < 0 ? '-' : '';
        if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(abs >= 1e8 ? 0 : 2)}cr`;
        if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
        if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}k`;
    }
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

/** Bare number, Indian grouping. For seats and square feet, which are not money. */
export function count(value: number | null | undefined, compact = false): string {
    const v = Number(value ?? 0) || 0;
    if (compact) {
        const abs = Math.abs(v);
        if (abs >= 1e7) return `${(v / 1e7).toFixed(1)}cr`;
        if (abs >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
        if (abs >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
    }
    return Math.round(v).toLocaleString('en-IN');
}

/** Formats a cell in the unit its line item declares. Seats must never gain a ₹. */
export function formatByUnit(
    value: number | null | undefined,
    unit: string,
    compact = false,
): string {
    if (value === null || value === undefined) return '—';
    if (unit === 'count' || unit === 'sqft') return count(value, compact);
    if (unit === 'INR_per_seat' || unit === 'INR_per_sqft') {
        return `₹${Math.round(Number(value)).toLocaleString('en-IN')}`;
    }
    return inr(value, compact);
}

export const monthLabel = (month: string | null | undefined): string =>
    month
        ? new Date(`${month.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
            month: 'short', year: 'numeric', timeZone: 'UTC',
        })
        : '—';

export const monthLabelLong = (month: string | null | undefined): string =>
    month
        ? new Date(`${month.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
            month: 'long', year: 'numeric', timeZone: 'UTC',
        })
        : '—';

// ---------------------------------------------------------------------------
// Variance treatment
//
// Three tones, not a gradient. A per-cell colour ramp across 16 x 43 cells reads as
// noise and defeats the one job of the grid: showing where to look. A cell only earns
// colour when it deviates by more than MATERIAL_PCT of its own budget.
// ---------------------------------------------------------------------------

export type VarianceTone = 'over' | 'under' | 'flat';

/** 2% of plan. Ops budgets breathe; alarming at 0.5% makes every cell shout. */
export const MATERIAL_PCT = 2;

export function varianceTone(
    budget: number | null | undefined,
    actual: number | null | undefined,
): VarianceTone {
    const b = Number(budget ?? 0);
    const a = Number(actual ?? 0);
    if (!b && !a) return 'flat';
    const saving = b - a;
    // Spend against no plan at all is an overspend by definition — there was no budget
    // for it. Falling back to 'flat' here would hide unbudgeted lines entirely.
    if (b <= 0) return a > 0 ? 'over' : 'flat';
    const pct = (Math.abs(saving) / b) * 100;
    if (pct < MATERIAL_PCT) return 'flat';
    return saving < 0 ? 'over' : 'under';
}

/**
 * Tone with the kind's sign semantics applied.
 *
 * Revenue INVERTS: `saving` is budget - actual, so a positive figure on a revenue line
 * means we collected LESS than planned, which is bad. Reusing the cost tone here would
 * paint a shortfall green. Metrics and the workbook's own roll-up rows carry no
 * over/under meaning at all — a seat count that differs from plan is a data-entry note.
 */
export function varianceToneForKind(
    kind: AopKind,
    budget: number | null | undefined,
    actual: number | null | undefined,
): VarianceTone {
    if (kind === 'metric' || kind === 'total') return 'flat';
    const tone = varianceTone(budget, actual);
    if (kind !== 'revenue' || tone === 'flat') return tone;
    return tone === 'over' ? 'under' : 'over';
}

/** Colour for a tone. Reads from the CSS custom properties, so dark mode follows. */
export const TONE_COLOR: Record<VarianceTone, string> = {
    over: 'var(--error)',
    under: 'var(--success)',
    flat: 'var(--text-secondary)',
};

/** Very low alpha. The tint should register peripherally, never compete with the digits. */
export const TONE_TINT: Record<VarianceTone, string> = {
    over: 'rgba(239, 68, 68, 0.09)',
    under: 'rgba(16, 185, 129, 0.07)',
    flat: 'transparent',
};

/** The spreadsheet's own vocabulary, minus the emoji. */
export const toneLabel = (tone: VarianceTone): string =>
    tone === 'over' ? 'Over budget' : tone === 'under' ? 'Under budget' : 'On plan';

export function utilisation(budget: number, actual: number): number | null {
    return budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null;
}
