import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';

/**
 * Shared loader + maths for the electricity bill tracker.
 *
 * Lives outside the route handlers because /api/electricity/tracker and
 * /api/electricity/tracker/explain must reason about the SAME figures — an AI explanation
 * that used a different discount total than the screen it is explaining would be worse
 * than no explanation at all.
 *
 * Every PostgREST read here uses an explicit .range() — the default page size truncates
 * at 1000 rows silently, and a single org's electricity_bill_alerts view can exceed that
 * as history accumulates (15 accounts x 12 months x several years).
 */

const RANGE_END = 9999;

// Mirrors electricity_bill_alerts.urgency (see the migration) and
// app/api/electricity/bills/route.ts's URGENCY_ORDER, most severe first.
export type Urgency = 'overdue' | 'due_soon' | 'discount_expiring' | 'discount_missed' | 'ok' | 'settled';

export interface AlertRow {
    id: string;
    account_id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    property_id: string | null;
    billing_month: string;
    bill_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    early_payment_date: string | null;
    early_payment_amount: number | null;
    after_due_date_amount: number | null;
    payment_status: string;
    payment_date: string | null;
    days_to_early_payment: number | null;
    days_to_due: number | null;
    discount_at_risk: number | null;
    penalty_exposure: number | null;
    urgency: Urgency;
}

export interface BillingAccount {
    id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    property_id: string | null;
    early_payment_discount_pct: number | null;
}

export const n = (v: unknown): number => Number(v ?? 0) || 0;

export type LoadResult<T> = { provisioned: true; data: T } | { provisioned: false };

export async function loadAlertRows(organizationId: string): Promise<LoadResult<AlertRow[]>> {
    const { data, error } = await supabaseAdmin
        .from('electricity_bill_alerts')
        .select('*')
        .eq('organization_id', organizationId)
        .order('billing_month', { ascending: false })
        .range(0, RANGE_END);

    if (error) {
        if (isMissingRelation(error)) return { provisioned: false };
        throw new Error(error.message);
    }
    return { provisioned: true, data: (data || []) as AlertRow[] };
}

export async function loadBillingAccounts(organizationId: string): Promise<LoadResult<BillingAccount[]>> {
    const { data, error } = await supabaseAdmin
        .from('electricity_billing_accounts')
        .select('id, site_label, provider, consumer_ref, property_id, early_payment_discount_pct')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('site_label')
        .range(0, RANGE_END);

    if (error) {
        if (isMissingRelation(error)) return { provisioned: false };
        throw new Error(error.message);
    }
    return { provisioned: true, data: (data || []) as BillingAccount[] };
}

// ---------------------------------------------------------------------------
// Deadlines — what to pay now, grouped by which cut-off bites first.
// ---------------------------------------------------------------------------

export interface DeadlineBucket {
    id: string;
    account_id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    billing_month: string;
    cutoff_date: string | null;
    amount_due: number | null;
    money_at_risk: number;
    urgency: Urgency;
}

export interface Deadlines {
    overdue: DeadlineBucket[];
    due_soon: DeadlineBucket[];
    discount_expiring: DeadlineBucket[];
    /** Discount already gone, or nothing time-critical yet — still open, still money owed. */
    upcoming: DeadlineBucket[];
    money_at_risk: { discount_at_risk: number; penalty_exposure: number };
    open_value: number;
}

export function computeDeadlines(rows: AlertRow[]): Deadlines {
    const open = rows.filter(r => r.payment_status === 'pending');

    const toBucket = (r: AlertRow): DeadlineBucket => ({
        id: r.id,
        account_id: r.account_id,
        site_label: r.site_label,
        provider: r.provider,
        consumer_ref: r.consumer_ref,
        billing_month: r.billing_month,
        cutoff_date: r.urgency === 'discount_expiring' ? r.early_payment_date : r.due_date,
        amount_due: r.urgency === 'discount_expiring' ? r.early_payment_amount : r.total_amount,
        money_at_risk: n(r.discount_at_risk) + n(r.penalty_exposure),
        urgency: r.urgency,
    });

    const bucketFor = (u: Urgency) =>
        open.filter(r => r.urgency === u)
            .map(toBucket)
            .sort((a, b) => b.money_at_risk - a.money_at_risk);

    const overdue = bucketFor('overdue');
    const dueSoon = bucketFor('due_soon');
    const discountExpiring = bucketFor('discount_expiring');
    const upcoming = [...bucketFor('discount_missed'), ...bucketFor('ok')]
        .sort((a, b) => (a.cutoff_date || '9999').localeCompare(b.cutoff_date || '9999'));

    return {
        overdue,
        due_soon: dueSoon,
        discount_expiring: discountExpiring,
        upcoming,
        money_at_risk: {
            discount_at_risk: Math.round(open.reduce((s, r) => s + n(r.discount_at_risk), 0)),
            penalty_exposure: Math.round(open.reduce((s, r) => s + n(r.penalty_exposure), 0)),
        },
        open_value: Math.round(open.reduce((s, r) => s + n(r.total_amount), 0)),
    };
}

// ---------------------------------------------------------------------------
// Discount performance — available / captured / missed / unverifiable.
//
// Three real buckets plus the one that matters most: a bill marked paid with no payment
// date recorded cannot be scored either way. Calling it "missed" invents a loss that may
// never have happened; calling it "captured" invents a saving. It gets its own bucket, and
// that bucket is itself the argument for logging payment dates at all — see
// scripts/import_electricity_bills.js, which found this on 7 of 102 rows in the source
// workbook.
// ---------------------------------------------------------------------------

export interface DiscountFigures {
    available: number;
    captured: number;
    missed: number;
    unverifiable: number;
}

export interface DiscountPerformance {
    totals: DiscountFigures;
    by_month: Array<{ month: string } & DiscountFigures>;
    /** Worst first — sorted by missed + unverifiable, so the offenders lead the list. */
    by_account: Array<{
        account_id: string; site_label: string; provider: string; consumer_ref: string | null;
    } & DiscountFigures>;
}

function emptyFigures(): DiscountFigures {
    return { available: 0, captured: 0, missed: 0, unverifiable: 0 };
}

function addBillToFigures(figures: DiscountFigures, r: AlertRow) {
    const gap = n(r.total_amount) - n(r.early_payment_amount);
    if (!r.total_amount || !r.early_payment_amount || gap <= 0) return;
    figures.available += gap;
    if (r.payment_status !== 'paid') return; // still open — neither captured nor missed yet
    if (!r.payment_date || !r.early_payment_date) figures.unverifiable += gap;
    else if (r.payment_date <= r.early_payment_date) figures.captured += gap;
    else figures.missed += gap;
}

export function computeDiscountPerformance(rows: AlertRow[]): DiscountPerformance {
    const totals = emptyFigures();
    const byMonth = new Map<string, DiscountFigures>();
    const byAccount = new Map<string, DiscountFigures & { site_label: string; provider: string; consumer_ref: string | null }>();

    for (const r of rows) {
        addBillToFigures(totals, r);

        if (!byMonth.has(r.billing_month)) byMonth.set(r.billing_month, emptyFigures());
        addBillToFigures(byMonth.get(r.billing_month)!, r);

        if (!byAccount.has(r.account_id)) {
            byAccount.set(r.account_id, {
                ...emptyFigures(), site_label: r.site_label, provider: r.provider, consumer_ref: r.consumer_ref,
            });
        }
        addBillToFigures(byAccount.get(r.account_id)!, r);
    }

    const round = (f: DiscountFigures): DiscountFigures => ({
        available: Math.round(f.available), captured: Math.round(f.captured),
        missed: Math.round(f.missed), unverifiable: Math.round(f.unverifiable),
    });

    return {
        totals: round(totals),
        by_month: [...byMonth.entries()]
            .map(([month, f]) => ({ month, ...round(f) }))
            .sort((a, b) => b.month.localeCompare(a.month)),
        by_account: [...byAccount.entries()]
            .map(([account_id, f]) => ({ account_id, site_label: f.site_label, provider: f.provider, consumer_ref: f.consumer_ref, ...round(f) }))
            .sort((a, b) => (b.missed + b.unverifiable) - (a.missed + a.unverifiable)),
    };
}

// ---------------------------------------------------------------------------
// Seasonality — monthly totals per account, for the trend chart.
// ---------------------------------------------------------------------------

export interface Seasonality {
    months: string[];
    totals_by_month: Array<{ month: string; total: number }>;
    by_account: Array<{
        account_id: string; site_label: string; provider: string; consumer_ref: string | null;
        /** Aligned to `months`; null where that account has no bill that month. */
        values: Array<number | null>;
    }>;
}

export function computeSeasonality(rows: AlertRow[]): Seasonality {
    const months = [...new Set(rows.map(r => r.billing_month))].sort();
    const totalsByMonth = new Map<string, number>();
    const byAccount = new Map<string, { site_label: string; provider: string; consumer_ref: string | null; amounts: Map<string, number> }>();

    for (const r of rows) {
        if (r.total_amount === null) continue;
        totalsByMonth.set(r.billing_month, (totalsByMonth.get(r.billing_month) || 0) + n(r.total_amount));

        if (!byAccount.has(r.account_id)) {
            byAccount.set(r.account_id, {
                site_label: r.site_label, provider: r.provider, consumer_ref: r.consumer_ref, amounts: new Map(),
            });
        }
        byAccount.get(r.account_id)!.amounts.set(r.billing_month, n(r.total_amount));
    }

    return {
        months,
        totals_by_month: months.map(month => ({ month, total: Math.round(totalsByMonth.get(month) || 0) })),
        by_account: [...byAccount.entries()].map(([account_id, a]) => ({
            account_id, site_label: a.site_label, provider: a.provider, consumer_ref: a.consumer_ref,
            values: months.map(m => (a.amounts.has(m) ? Math.round(a.amounts.get(m)!) : null)),
        })),
    };
}

// ---------------------------------------------------------------------------
// Reconciliation — billed total vs the AOP-booked actual, per month.
//
// THE MODULE'S SINGLE MOST VALUABLE FEATURE. Two spreadsheets (the electricity bill
// tracker and the AOP Budget-vs-Actual sheet) record the same spend independently, and
// nobody has ever been able to eyeball them side by side. April reconciles to within 0.5%;
// May is 15.7% apart. Nothing about April makes May look inevitable, so the May gap is the
// finding — either the AOP actual is overstated or bills are missing from this tracker.
// ---------------------------------------------------------------------------

export interface AopActualByMonth {
    provisioned: boolean;      // aop_line_items/aop_entries relations exist at all
    lineItemFound: boolean;    // this org has an 'electricity' line item to sum
    byMonth: Map<string, number>;
}

export async function loadAopActualByMonth(organizationId: string): Promise<AopActualByMonth> {
    const lineItemRes = await supabaseAdmin
        .from('aop_line_items')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('code', 'electricity')
        .maybeSingle();

    if (lineItemRes.error) {
        if (isMissingRelation(lineItemRes.error)) {
            return { provisioned: false, lineItemFound: false, byMonth: new Map() };
        }
        throw new Error(lineItemRes.error.message);
    }
    if (!lineItemRes.data) {
        return { provisioned: true, lineItemFound: false, byMonth: new Map() };
    }

    const { data, error } = await supabaseAdmin
        .from('aop_entries')
        .select('period_month, actual')
        .eq('organization_id', organizationId)
        .eq('line_item_id', lineItemRes.data.id)
        .range(0, RANGE_END);

    if (error) {
        if (isMissingRelation(error)) return { provisioned: false, lineItemFound: true, byMonth: new Map() };
        throw new Error(error.message);
    }

    const byMonth = new Map<string, number>();
    for (const row of data || []) {
        const month = String(row.period_month).slice(0, 10);
        byMonth.set(month, (byMonth.get(month) || 0) + n(row.actual));
    }
    return { provisioned: true, lineItemFound: true, byMonth };
}

export interface ReconciliationRow {
    month: string;
    billed_total: number | null;
    aop_actual: number | null;
    /** aop_actual - billed_total. Positive: AOP records more than the bills on file — check
     *  for a bill missing from this tracker. Negative: bills exceed AOP — check for a
     *  duplicate bill here or an unbooked AOP entry. */
    delta: number | null;
    /** delta as a % of the billed total (the tracker's own figure, since that is the side
     *  this module can verify bill-by-bill). Null whenever either side is absent. */
    delta_pct: number | null;
    flagged: boolean;
}

const FLAG_THRESHOLD_PCT = 5;

export function computeReconciliation(
    billedByMonth: Map<string, number>,
    aop: AopActualByMonth,
): ReconciliationRow[] {
    const months = [...new Set([...billedByMonth.keys(), ...aop.byMonth.keys()])].sort().reverse();

    return months.map(month => {
        // Never invent a zero for a side with no data — a missing bill total and a genuine
        // zero-rupee month must not look the same on screen.
        const billedTotal = billedByMonth.has(month) ? Math.round(billedByMonth.get(month)!) : null;
        const aopActual = aop.lineItemFound && aop.byMonth.has(month) ? Math.round(aop.byMonth.get(month)!) : null;

        const delta = billedTotal !== null && aopActual !== null ? aopActual - billedTotal : null;
        const deltaPct = delta !== null && billedTotal ? Math.round((delta / billedTotal) * 1000) / 10 : null;

        return {
            month,
            billed_total: billedTotal,
            aop_actual: aopActual,
            delta,
            delta_pct: deltaPct,
            flagged: deltaPct !== null && Math.abs(deltaPct) > FLAG_THRESHOLD_PCT,
        };
    });
}

export function billedTotalsByMonth(rows: AlertRow[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const r of rows) {
        if (r.total_amount === null) continue;
        out.set(r.billing_month, (out.get(r.billing_month) || 0) + n(r.total_amount));
    }
    return out;
}
