import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isMissingRelation } from '@/backend/lib/aop/access';
import { loadAlertRows, computeDiscountPerformance, n, type AlertRow } from './tracker';

/**
 * The savings target the electricity council member runs with.
 *
 * From the 03-Aug walkthrough: "it is also important that the electricity council memember
 * be provided a target that he has to ensure this much amount lets say 15 lacs to be saved
 * annually from electricity bills alone and he has to run with it".
 *
 * WHAT COUNTS AS A SAVING — and why it is deliberately narrow
 * Only early-payment discount PROVABLY captured: bill paid, payment date on file, and that
 * date on or before the rebate date. The same arithmetic the Discount Performance view
 * already uses (computeDiscountPerformance), so the target can never quietly diverge from
 * what the tracker reports.
 *
 * Bills paid with no payment date recorded are 'unverifiable' and are counted toward
 * NEITHER captured nor missed. That is the honest treatment — the source workbook had 7
 * such rows out of 102 — but it does mean a target can be under-reported by sloppy
 * record-keeping, so unverifiable is surfaced next to the number rather than hidden. A
 * person chasing 15 lakhs deserves to know that some of it may already be won and simply
 * not evidenced.
 *
 * PACE is linear across the period. Electricity billing is monthly and roughly even, so a
 * straight line is a defensible expectation curve; it is stated here rather than buried so
 * nobody reads "behind pace" as more precise than it is.
 */

export interface SavingsTarget {
    id: string;
    organization_id: string;
    period_start: string;
    period_end: string;
    label: string | null;
    target_amount: number;
    owner_user_id: string | null;
    owner_label: string | null;
    owner_name?: string | null;
    notes: string | null;
    is_active: boolean;
}

export interface TargetProgress {
    target: SavingsTarget;
    /** Provably captured discount inside the period. */
    captured: number;
    /** Discount that was available and provably lost. */
    missed: number;
    /** Paid, but no payment date to prove it either way. */
    unverifiable: number;
    /** Total discount the bills in this period made available at all. */
    available: number;
    attainment_pct: number;
    /** Where a straight line says we should be today. */
    pace_expected: number;
    pace_delta: number;
    on_pace: boolean;
    /** Captured extrapolated to period end at the current run rate. */
    projected: number;
    projected_shortfall: number;
    period_elapsed_pct: number;
    days_remaining: number;
    /** What still has to be captured per remaining month to land the target. */
    required_run_rate_monthly: number;
    by_month: Array<{ month: string; captured: number; missed: number; cumulative: number }>;
}

export interface TargetsPayload {
    provisioned: boolean;
    reason?: string;
    progress: TargetProgress | null;
    all_targets: SavingsTarget[];
}

const RANGE_END = 999;

/** Indian FY containing `on`: 01-Apr to 31-Mar. */
export function currentFinancialYear(on = new Date()): { start: string; end: string; label: string } {
    const y = on.getUTCFullYear();
    const startYear = on.getUTCMonth() >= 3 ? y : y - 1; // month 3 = April
    return {
        start: `${startYear}-04-01`,
        end: `${startYear + 1}-03-31`,
        label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    };
}

export async function loadTargets(organizationId: string): Promise<TargetsPayload> {
    const { data, error } = await supabaseAdmin
        .from('electricity_savings_targets')
        .select('*')
        .eq('organization_id', organizationId)
        .order('period_start', { ascending: false })
        .range(0, RANGE_END);

    if (error) {
        if (isMissingRelation(error)) {
            return {
                provisioned: false,
                reason: 'Apply supabase/migrations/20260804000006_electricity_cycle_targets_audit.sql to set a savings target.',
                progress: null, all_targets: [],
            };
        }
        throw new Error(error.message);
    }

    const targets = (data || []) as SavingsTarget[];
    const withNames = await resolveOwners(targets);

    // The live one is the active target whose period contains today; failing that, the
    // most recent active target. Never silently pick an expired period's number.
    const today = new Date().toISOString().slice(0, 10);
    const active = withNames.filter(t => t.is_active);
    const current = active.find(t => t.period_start <= today && t.period_end >= today) || active[0] || null;

    if (!current) return { provisioned: true, progress: null, all_targets: withNames };

    const alerts = await loadAlertRows(organizationId);
    if (!alerts.provisioned) return { provisioned: true, progress: null, all_targets: withNames };

    return {
        provisioned: true,
        progress: computeProgress(current, alerts.data),
        all_targets: withNames,
    };
}

async function resolveOwners(targets: SavingsTarget[]): Promise<SavingsTarget[]> {
    const ids = [...new Set(targets.map(t => t.owner_user_id).filter(Boolean))] as string[];
    if (ids.length === 0) return targets;

    const { data } = await supabaseAdmin.from('users').select('id, full_name, email').in('id', ids);
    const byId = new Map((data || []).map(u => [u.id, u.full_name || u.email || null]));
    return targets.map(t => ({ ...t, owner_name: t.owner_user_id ? byId.get(t.owner_user_id) ?? null : null }));
}

export function computeProgress(target: SavingsTarget, allRows: AlertRow[]): TargetProgress {
    // Bills belong to the period by BILLING MONTH, not payment date: a March bill paid in
    // April is March's saving. Anything else would let a target be gamed by timing.
    const rows = allRows.filter(r => r.billing_month >= target.period_start && r.billing_month <= target.period_end);
    const perf = computeDiscountPerformance(rows);

    const captured = perf.totals.captured;
    const targetAmount = n(target.target_amount);

    const startMs = Date.parse(target.period_start);
    const endMs = Date.parse(target.period_end);
    const nowMs = Date.now();
    const totalMs = Math.max(1, endMs - startMs);
    const elapsedMs = Math.min(Math.max(0, nowMs - startMs), totalMs);
    const elapsedFrac = elapsedMs / totalMs;

    const paceExpected = Math.round(targetAmount * elapsedFrac);
    // Guard the divide: on day one of a period, elapsedFrac is ~0 and a naive projection
    // would read as infinity. Below ~2% elapsed there is no run rate worth extrapolating.
    const projected = elapsedFrac > 0.02 ? Math.round(captured / elapsedFrac) : 0;

    const daysRemaining = Math.max(0, Math.ceil((endMs - nowMs) / 86_400_000));
    const monthsRemaining = Math.max(0.1, daysRemaining / 30.44);
    const shortfallToDate = Math.max(0, targetAmount - captured);

    return {
        target,
        captured,
        missed: perf.totals.missed,
        unverifiable: perf.totals.unverifiable,
        available: perf.totals.available,
        attainment_pct: targetAmount > 0 ? Math.round((captured / targetAmount) * 1000) / 10 : 0,
        pace_expected: paceExpected,
        pace_delta: captured - paceExpected,
        on_pace: captured >= paceExpected,
        projected,
        projected_shortfall: Math.max(0, targetAmount - projected),
        period_elapsed_pct: Math.round(elapsedFrac * 1000) / 10,
        days_remaining: daysRemaining,
        required_run_rate_monthly: Math.round(shortfallToDate / monthsRemaining),
        by_month: monthlySeries(perf.by_month),
    };
}

function monthlySeries(byMonth: Array<{ month: string; captured: number; missed: number }>) {
    const ascending = [...byMonth].sort((a, b) => a.month.localeCompare(b.month));
    let running = 0;
    return ascending.map(m => {
        running += m.captured;
        return { month: m.month, captured: m.captured, missed: m.missed, cumulative: running };
    });
}

export interface UpsertTargetInput {
    organizationId: string;
    periodStart: string;
    periodEnd: string;
    label?: string | null;
    targetAmount: number;
    ownerUserId?: string | null;
    ownerLabel?: string | null;
    notes?: string | null;
    actorId: string;
}

export async function upsertTarget(input: UpsertTargetInput): Promise<SavingsTarget> {
    const { data, error } = await supabaseAdmin
        .from('electricity_savings_targets')
        .upsert({
            organization_id: input.organizationId,
            period_start: input.periodStart,
            period_end: input.periodEnd,
            label: input.label ?? null,
            target_amount: input.targetAmount,
            owner_user_id: input.ownerUserId ?? null,
            owner_label: input.ownerLabel ?? null,
            notes: input.notes ?? null,
            is_active: true,
            created_by: input.actorId,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,period_start,period_end' })
        .select('*')
        .single();

    if (error) throw new Error(error.message);
    return data as SavingsTarget;
}
