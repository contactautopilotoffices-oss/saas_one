import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';
import { n } from './tracker';

/**
 * The cycle clock — the pipeline as a race against a date.
 *
 * From the 03-Aug walkthrough: "this entire cycle from when the electricity bill is
 * recieved to when the bill is paid the early due timeline is the one to track so
 * everything here is a run against time and it has to be visible here as well".
 *
 * THE DEADLINE THAT MATTERS IS THE EARLY-PAYMENT DATE, NOT THE DUE DATE.
 * The due date is when the bill becomes late; the early date is when the money stops being
 * winnable. A bill delivered comfortably before its due date can still have lost every
 * rupee of discount, and the register never showed that — it showed dates, not the clock
 * running against them. Everything here measures against the early date first and reports
 * the due date as the secondary, penalty-side deadline.
 *
 * WHAT A STALLED STAGE COSTS
 * days_in_stage is the number this module exists for. A bill sitting eight days in
 * 'validating' with six days to its early date has already lost the race, and that is
 * knowable now rather than in the month-end reconciliation. stalled[] surfaces exactly
 * those.
 */

export type ClockStatus = 'settled' | 'overdue' | 'discount_lost' | 'critical' | 'tight' | 'on_track';

export interface CycleRow {
    id: string;
    account_id: string;
    site_label: string;
    provider: string;
    consumer_ref: string | null;
    billing_month: string;
    workflow_status: string;
    payment_status: string;
    received_at: string | null;
    early_payment_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    early_payment_amount: number | null;
    after_due_date_amount: number | null;
    payment_date: string | null;
    cycle_completed_at: string | null;
    stage_entered_at: string | null;
    days_in_stage: number | null;
    cycle_days: number | null;
    days_to_early: number | null;
    days_to_due: number | null;
    discount_still_winnable: number | null;
    clock_status: ClockStatus;
}

export interface CycleSummary {
    /** Bills still moving (not paid / aop_linked). */
    open: number;
    critical: number;
    tight: number;
    discount_lost: number;
    overdue: number;
    /** Money still winnable across every open bill, today. */
    winnable_now: number;
    /** Money already forfeited on bills whose early date has passed unpaid. */
    forfeited_open: number;
    /** Median received -> paid, in days, over bills that completed with a known start. */
    median_cycle_days: number | null;
    /** Bills whose cycle time we cannot measure because they never came through the inbox. */
    unmeasurable: number;
}

export interface StalledBill {
    id: string;
    site_label: string;
    billing_month: string;
    workflow_status: string;
    days_in_stage: number;
    days_to_early: number | null;
    discount_still_winnable: number;
    /** Plain-language reason this row is on the list — FP-03, legible to a non-developer. */
    why: string;
}

export interface CyclePayload {
    provisioned: boolean;
    reason?: string;
    rows: CycleRow[];
    summary: CycleSummary;
    stalled: StalledBill[];
    /** Average days each workflow stage holds a bill, worst first. */
    stage_dwell: Array<{ stage: string; bills: number; avg_days: number }>;
}

const RANGE_END = 9999;
const OPEN_STATES = new Set(['settled']);

function emptySummary(): CycleSummary {
    return {
        open: 0, critical: 0, tight: 0, discount_lost: 0, overdue: 0,
        winnable_now: 0, forfeited_open: 0, median_cycle_days: null, unmeasurable: 0,
    };
}

export async function loadCycle(organizationId: string): Promise<CyclePayload> {
    const { data, error } = await supabaseAdmin
        .from('electricity_bill_cycle')
        .select('*')
        .eq('organization_id', organizationId)
        .order('early_payment_date', { ascending: true, nullsFirst: false })
        .range(0, RANGE_END);

    if (error) {
        if (isMissingRelation(error)) {
            return {
                provisioned: false,
                reason: 'Apply supabase/migrations/20260804000006_electricity_cycle_targets_audit.sql to enable the cycle clock.',
                rows: [], summary: emptySummary(), stalled: [], stage_dwell: [],
            };
        }
        throw new Error(error.message);
    }

    const rows = (data || []) as CycleRow[];
    return {
        provisioned: true,
        rows,
        summary: summarise(rows),
        stalled: findStalled(rows),
        stage_dwell: stageDwell(rows),
    };
}

export function summarise(rows: CycleRow[]): CycleSummary {
    const s = emptySummary();
    const completedCycles: number[] = [];

    for (const r of rows) {
        const isOpen = !OPEN_STATES.has(r.clock_status);
        if (isOpen) {
            s.open++;
            s.winnable_now += n(r.discount_still_winnable);
            if (r.clock_status === 'critical') s.critical++;
            if (r.clock_status === 'tight') s.tight++;
            if (r.clock_status === 'discount_lost') {
                s.discount_lost++;
                // The discount is gone but the bill is still open: the gap between the two
                // amounts is money this org will now definitely pay and need not have.
                s.forfeited_open += Math.max(0, n(r.total_amount) - n(r.early_payment_amount));
            }
            if (r.clock_status === 'overdue') s.overdue++;
        }

        if (r.cycle_days !== null && r.cycle_completed_at) completedCycles.push(r.cycle_days);
        else if (r.received_at === null && r.payment_status === 'paid') s.unmeasurable++;
    }

    s.winnable_now = Math.round(s.winnable_now);
    s.forfeited_open = Math.round(s.forfeited_open);
    s.median_cycle_days = median(completedCycles);
    return s;
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Bills where the pipeline is losing the race. Two ways to qualify, and each gets a
 * sentence rather than a code, because the person reading this is not a developer.
 */
export function findStalled(rows: CycleRow[]): StalledBill[] {
    const out: StalledBill[] = [];

    for (const r of rows) {
        if (r.clock_status === 'settled') continue;
        const daysInStage = r.days_in_stage ?? 0;
        const winnable = Math.round(n(r.discount_still_winnable));
        const toEarly = r.days_to_early;

        let why: string | null = null;

        if (r.clock_status === 'critical') {
            why = toEarly !== null && toEarly >= 0
                ? `${toEarly} day${toEarly === 1 ? '' : 's'} to the early-payment date and still at "${r.workflow_status}" — ₹${winnable.toLocaleString('en-IN')} is about to be lost.`
                : `Early-payment date is today and the bill is still at "${r.workflow_status}".`;
        } else if (toEarly !== null && toEarly >= 0 && daysInStage > toEarly) {
            // Been stuck longer than the time it has left: on current pace it misses.
            why = `Stuck ${daysInStage} days at "${r.workflow_status}" with only ${toEarly} day${toEarly === 1 ? '' : 's'} left — at this pace the discount is missed.`;
        } else if (daysInStage >= 7 && r.clock_status !== 'discount_lost') {
            why = `No movement for ${daysInStage} days at "${r.workflow_status}".`;
        }

        if (why) {
            out.push({
                id: r.id,
                site_label: r.site_label,
                billing_month: r.billing_month,
                workflow_status: r.workflow_status,
                days_in_stage: daysInStage,
                days_to_early: toEarly,
                discount_still_winnable: winnable,
                why,
            });
        }
    }

    // Most money at risk first; ties broken by who is closest to the cliff.
    return out.sort((a, b) =>
        b.discount_still_winnable - a.discount_still_winnable ||
        (a.days_to_early ?? 99) - (b.days_to_early ?? 99));
}

/** Where bills spend their time — the queue to fix if the median cycle is too slow. */
export function stageDwell(rows: CycleRow[]): Array<{ stage: string; bills: number; avg_days: number }> {
    const acc = new Map<string, { bills: number; total: number }>();

    for (const r of rows) {
        if (r.clock_status === 'settled') continue;
        const cur = acc.get(r.workflow_status) || { bills: 0, total: 0 };
        cur.bills++;
        cur.total += r.days_in_stage ?? 0;
        acc.set(r.workflow_status, cur);
    }

    return [...acc.entries()]
        .map(([stage, v]) => ({ stage, bills: v.bills, avg_days: Math.round((v.total / v.bills) * 10) / 10 }))
        .sort((a, b) => b.avg_days - a.avg_days);
}
