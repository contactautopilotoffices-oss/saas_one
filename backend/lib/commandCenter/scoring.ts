import type { ScoreComponent } from './types';

/**
 * Operations health scoring.
 *
 * There is no health score anywhere in this database. It is invented here, so the only
 * defensible way to ship it is to make the arithmetic completely legible: every route
 * returns the component breakdown alongside the number, and the card shows what moved it.
 * A single opaque "82" nobody can interrogate would be worse than no score at all.
 *
 * FOUR DECISIONS, EACH FORCED BY WHAT THE REAL DATA LOOKS LIKE
 *
 * 1. PENALTY MODEL, not a weighted average of positives. A building starts at 100 and
 *    loses points for things that are actually wrong. Matches how the team talks about it
 *    ("what's broken at Rabale?").
 *
 * 2. RATES, NOT COUNTS, wherever a denominator exists. Measured on this estate, ETPL has
 *    335 overdue PPM tasks and RUPA 152 — as raw counts both saturate any sane cap and
 *    become indistinguishable, and the ranking degenerates into "which site has the most
 *    PPM rows". As rates they are 92% and 79% overdue, which is a real difference. Ticket
 *    backlog stays absolute because it is genuine workload, not a proportion.
 *
 * 3. A SIGNAL IS ONLY "AVAILABLE" WHEN THAT PROPERTY HAS A DENOMINATOR. This is the
 *    subtle one. 8 of 11 properties currently have zero PPM schedules AND zero tickets —
 *    they are simply not tracked in this system. If "no rows" were read as "nothing wrong",
 *    those 8 would score 100 and rank ABOVE the three buildings actually being managed.
 *    The dashboard would reward blindness. So absence of a denominator means the signal is
 *    unavailable, not perfect.
 *
 * 4. NO DENOMINATORS AT ALL => score is null, not 100. A building we know nothing about is
 *    reported as untracked. Callers must render that as its own state.
 *
 * Weights encode a judgement about what matters. They belong to the operator, and they are
 * deliberately all in one table so they are easy to argue with and change.
 */

export const MAX_PENALTY = {
    /** Breaching an SLA is the most visible failure to a tenant. */
    sla_overdue: 30,
    /** Volume of unresolved work. */
    ticket_backlog: 25,
    /** Missed preventive maintenance is how equipment failures get manufactured. */
    ppm_overdue: 20,
    /** Impossible meter readings mean the site is not really being monitored. */
    electricity_anomalies: 15,
    /** Overspend matters, but it is a slower signal than a broken lift. */
    budget_variance: 10,
} as const;

export type ComponentKey = keyof typeof MAX_PENALTY;

const LABEL: Record<ComponentKey, string> = {
    sla_overdue: 'Tickets past SLA',
    ticket_backlog: 'Open ticket backlog',
    ppm_overdue: 'PPM overdue',
    electricity_anomalies: 'Bad meter readings',
    budget_variance: 'Over budget',
};

/**
 * The value at which a component maxes out. Sized against this estate:
 * 11 active properties, ~4,870 tickets, 749 PPM schedules of which 529 (71%) are overdue.
 * Because portfolio-wide PPM overdue is already 71%, a 60% threshold is the point past
 * which a site is meaningfully worse than the (poor) house average.
 */
const WORST = {
    sla_overdue: 40,            // % of active tickets past SLA
    ticket_backlog: 100,        // absolute open tickets
    ppm_overdue: 60,            // % of that site's PPM tasks overdue
    electricity_anomalies: 5,   // absolute impossible readings
    budget_variance: 25,        // % over budget
} as const;

/** Linear ramp to the cap: `value` at or above `worst` costs the full penalty. */
function ramp(value: number, worst: number, max: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(max, (value / worst) * max);
}

export interface RawSignals {
    /** Active tickets at this property. Null when tickets are unreadable. */
    activeTickets: number | null;
    /** Of those, how many are past SLA. */
    slaBreached: number | null;
    /** Total PPM tasks for this property — the denominator. */
    ppmTotal: number | null;
    /** Of those, how many are overdue. */
    ppmOverdue: number | null;
    /** Readings flagged impossible. Null when the anomalies view is absent. */
    electricityAnomalies: number | null;
    /** Whether this property has any electricity readings at all (the denominator). */
    hasElectricityData: boolean;
    /** Overspend as a % of budget. Negative = under budget. Null when no AOP data. */
    budgetOverspendPct: number | null;
}

export function buildComponents(s: RawSignals): ScoreComponent[] {
    const mk = (key: ComponentKey, value: number | null, penalty: number): ScoreComponent => ({
        key,
        label: LABEL[key],
        value: value === null ? null : Math.round(value * 10) / 10,
        penalty: Math.round(penalty * 10) / 10,
        max_penalty: MAX_PENALTY[key],
        available: value !== null,
    });

    // SLA breach RATE. Needs at least one active ticket to be a meaningful proportion —
    // "0 of 0 breached" is not a clean bill of health, it is no information.
    const hasTickets = s.activeTickets !== null && s.activeTickets > 0;
    const breachRate = hasTickets && s.slaBreached !== null
        ? (s.slaBreached / (s.activeTickets as number)) * 100
        : null;

    // Backlog stays absolute, but only counts for a property that is on the ticketing
    // system at all. A site with no tickets is untracked, not spotless.
    const backlog = hasTickets ? s.activeTickets : null;

    // PPM overdue RATE, gated on the site actually having a PPM plan.
    const ppmRate = s.ppmTotal !== null && s.ppmTotal > 0 && s.ppmOverdue !== null
        ? (s.ppmOverdue / s.ppmTotal) * 100
        : null;

    // Anomalies only mean something where meters are reporting.
    const anomalies = s.hasElectricityData ? s.electricityAnomalies : null;

    return [
        mk('sla_overdue', breachRate,
            breachRate === null ? 0 : ramp(breachRate, WORST.sla_overdue, MAX_PENALTY.sla_overdue)),
        mk('ticket_backlog', backlog,
            backlog === null ? 0 : ramp(backlog, WORST.ticket_backlog, MAX_PENALTY.ticket_backlog)),
        mk('ppm_overdue', ppmRate,
            ppmRate === null ? 0 : ramp(ppmRate, WORST.ppm_overdue, MAX_PENALTY.ppm_overdue)),
        mk('electricity_anomalies', anomalies,
            anomalies === null ? 0 : ramp(anomalies, WORST.electricity_anomalies, MAX_PENALTY.electricity_anomalies)),
        // Only overspend costs points; coming in under budget does not earn them back. A
        // site can be under budget precisely because it is skipping maintenance.
        mk('budget_variance', s.budgetOverspendPct,
            s.budgetOverspendPct === null || s.budgetOverspendPct <= 0 ? 0
                : ramp(s.budgetOverspendPct, WORST.budget_variance, MAX_PENALTY.budget_variance)),
    ];
}

export interface ScoreResult {
    /** Null when no signal has a denominator for this property — i.e. it is untracked. */
    score: number | null;
    availableCount: number;
    totalCount: number;
}

/** Fold components into 0-100, rescaled over only the signals that actually apply. */
export function scoreFrom(components: ScoreComponent[]): ScoreResult {
    const available = components.filter(c => c.available);
    if (available.length === 0) {
        return { score: null, availableCount: 0, totalCount: components.length };
    }

    const penalty = available.reduce((a, c) => a + c.penalty, 0);
    const maxPenalty = available.reduce((a, c) => a + c.max_penalty, 0);
    const scaled = maxPenalty > 0 ? (penalty / maxPenalty) * 100 : 0;

    return {
        score: Math.max(0, Math.min(100, Math.round(100 - scaled))),
        availableCount: available.length,
        totalCount: components.length,
    };
}

export const SCORING_NOTE =
    'Each site starts at 100 and loses points for tickets past SLA (max 30), open ticket ' +
    'backlog (25), overdue PPM (20), impossible meter readings (15) and overspend against ' +
    'the operating plan (10). SLA and PPM are measured as RATES, so a large site is not ' +
    'penalised for its size. A signal only counts where the site has data for it — a ' +
    'building with no tickets and no PPM plan is reported as untracked rather than scored ' +
    '100, so missing data never looks like good news.';

/** >=95 healthy, 85-94 watch, <85 needs attention. */
export function scoreTone(score: number | null): 'ok' | 'warn' | 'bad' | 'unknown' {
    if (score === null) return 'unknown';
    if (score >= 95) return 'ok';
    if (score >= 85) return 'warn';
    return 'bad';
}
