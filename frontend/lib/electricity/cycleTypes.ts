/**
 * Client-side contract for the cycle clock and the savings target.
 *
 * Hand-written mirror of what app/api/electricity/cycle/route.ts serialises — same
 * convention as trackerTypes.ts. Never import backend/lib from a client component.
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
    open: number;
    critical: number;
    tight: number;
    discount_lost: number;
    overdue: number;
    winnable_now: number;
    forfeited_open: number;
    median_cycle_days: number | null;
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
    why: string;
}

export interface SavingsTargetRecord {
    id: string;
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
    target: SavingsTargetRecord;
    captured: number;
    missed: number;
    unverifiable: number;
    available: number;
    attainment_pct: number;
    pace_expected: number;
    pace_delta: number;
    on_pace: boolean;
    projected: number;
    projected_shortfall: number;
    period_elapsed_pct: number;
    days_remaining: number;
    required_run_rate_monthly: number;
    by_month: Array<{ month: string; captured: number; missed: number; cumulative: number }>;
}

export interface CyclePayload {
    provisioned: boolean;
    reason?: string;
    rows: CycleRow[];
    summary: CycleSummary;
    stalled: StalledBill[];
    stage_dwell: Array<{ stage: string; bills: number; avg_days: number }>;
    target: TargetProgress | null;
    target_provisioned: boolean;
}

/** Colour + copy per clock state. One definition so every surface agrees. */
export const CLOCK_META: Record<ClockStatus, { label: string; colour: string; tint: string }> = {
    critical:      { label: 'Critical',      colour: 'var(--error)',   tint: 'rgba(239,68,68,0.12)' },
    overdue:       { label: 'Overdue',       colour: 'var(--error)',   tint: 'rgba(239,68,68,0.12)' },
    discount_lost: { label: 'Discount lost', colour: '#b45309',        tint: 'rgba(180,83,9,0.12)' },
    tight:         { label: 'Tight',         colour: 'var(--warning)', tint: 'rgba(245,158,11,0.12)' },
    on_track:      { label: 'On track',      colour: 'var(--success)', tint: 'rgba(16,185,129,0.12)' },
    settled:       { label: 'Settled',       colour: 'var(--text-tertiary)', tint: 'rgba(148,163,184,0.12)' },
};

/** Bill lifecycle stages in pipeline order, for the dwell chart. */
export const STAGE_LABELS: Record<string, string> = {
    ingested: 'Ingested',
    needs_manual_entry: 'Needs manual entry',
    parsed: 'Parsed',
    validating: 'Validating',
    validated: 'Validated',
    chasing: 'Chasing readings',
    disputed: 'In dispute',
    verified: 'Verified',
    scenario_selected: 'Scenario selected',
    sent_to_accounts: 'With accounts',
    paid: 'Paid',
    aop_linked: 'AOP linked',
};
