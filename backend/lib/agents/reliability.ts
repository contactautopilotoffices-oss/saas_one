/**
 * AGENT RELIABILITY — the maths, in one place, runnable on both sides.
 * =============================================================================
 * SINGLE SOURCE OF TRUTH — WIRED. Two definitions of one score is how a
 * dashboard starts lying. Every call site below used to carry a line-for-line
 * copy of this maths; the copies are gone and this module is the only place any
 * of it is defined. NOTHING OUTSIDE THIS FILE MAY REDEFINE ANY OF IT.
 *
 * The swap was behaviour-preserving by construction: each export is a drop-in
 * for the copy it replaced, changing no response field, no field name and no
 * rendered value. The one deliberate exception is noted below.
 *
 * CALL SITES (all now import from here):
 *
 *   app/api/agents/profile/route.ts
 *     the efficiency anchors, efficiencyScore(), the AXIS_DESCRIPTION map, the
 *     radar assembly, the reliability_basis literals, cost-per-success and the
 *     30-day window are all imported. reliability_score is now
 *     `viewScore ?? computeReliability(stats)` — the ONE behaviour change: when
 *     the view returns no score this module computes one, and reliabilityBasis()
 *     says 'client' so the response never hides which side produced the number.
 *
 *   app/api/agents/heartbeat/route.ts
 *     beatsUptimePct() for the per-agent and window figures; uptimeSeries() for
 *     the strip. Its inline buildBuckets() is deleted. AgentUptime.tsx's Bucket
 *     interface parses the result unchanged (the key ORDER differs, the key set
 *     and every value do not).
 *
 *   frontend/components/agents/AgentRosterCard.tsx
 *     reliabilityBand() for the meter. It used to cut at 85/65/45 against this
 *     module's 93/80/60, so one score could read green on the card and "watch"
 *     everywhere else. The component now maps band -> Tailwind classes and owns
 *     no thresholds.
 *
 * -----------------------------------------------------------------------------
 * oem_agent_profile.reliability_score is computed in SQL over a 30-day window.
 * That is the source of truth. computeReliability() is a FAITHFUL PORT of the SQL
 * expression in supabase/migrations/20260830000001_agent_runtime.sql (section 9),
 * including its NULL semantics — same inputs in, same number out.
 *
 * If you retune the weights, change them in BOTH places. They are stated once
 * here as RELIABILITY_WEIGHTS and once there as three literals in the CASE
 * expression. There is no way to share them across the boundary; there IS a way
 * to notice, which is this paragraph.
 *
 * Pure, dependency-free, no database, no `server-only` — safe to import into a
 * client component.
 */

import {
    AGENT_RELIABILITY_AXES,
    type AgentHeartbeatState,
    type AgentReliabilityAxis,
} from '@/frontend/types/agentRuntime';

/* ---------------------------------------------------------------------------
 * The weights.
 * ------------------------------------------------------------------------- */

/**
 * The three components of reliability, and why each is weighted as it is.
 * They MUST sum to 1.
 *
 *   success  0.50  Did the work finish? The heaviest term, because an agent
 *                  that reliably fails is worse than one that is occasionally
 *                  offline — a failed run has usually already half-acted.
 *   uptime   0.30  Was it even alive? Weighted below success on purpose: an
 *                  agent that is down is visibly down. The operator knows.
 *                  Silent wrongness is the more expensive failure.
 *   roi      0.20  Was the work worth doing? Enters as (100 - roi_flag_rate),
 *                  so an agent that runs flawlessly on work the business does
 *                  not value cannot score above 80. This is the term that
 *                  stops "busy" from reading as "reliable".
 */
export const RELIABILITY_WEIGHTS = {
    success: 0.50,
    uptime: 0.30,
    roi: 0.20,
} as const;

/** The rollup window, in days. Matches the view's WHERE clause. */
export const RELIABILITY_WINDOW_DAYS = 30;

/**
 * The formula, written out once, for the tooltip that has to justify the number.
 * Module-local on purpose: it reaches callers only through reliabilityBasis(),
 * so the string and the weights it describes can never be quoted apart.
 */
const RELIABILITY_FORMULA =
    '0.50 × success_rate + 0.30 × uptime_pct + 0.20 × (100 − roi_flag_rate)';

/**
 * The audit block that ships beside the score. `computedBy` says which side
 * produced it — the view normally, this module only when the view had none.
 */
export function reliabilityBasis(computedBy: 'view' | 'client' = 'view') {
    return {
        formula: RELIABILITY_FORMULA,
        weights: {
            success_rate: RELIABILITY_WEIGHTS.success,
            uptime_pct: RELIABILITY_WEIGHTS.uptime,
            roi_alignment: RELIABILITY_WEIGHTS.roi,
        },
        window_days: RELIABILITY_WINDOW_DAYS,
        computed_by: computedBy === 'view'
            ? 'oem_agent_profile view'
            : 'backend/lib/agents/reliability.ts (the view returned no score)',
    };
}

/* ---------------------------------------------------------------------------
 * Inputs
 * ------------------------------------------------------------------------- */

/**
 * Everything the score and the pentagon can be built from. Every field is
 * optional: pass the derived rates straight off oem_agent_profile, or pass raw
 * counters and let them be derived, or mix the two (a rate always wins over the
 * counters it would have been derived from).
 */
export interface ReliabilityStats {
    // ---- derived rates, 0..100, exactly as the view returns them
    success_rate?: number | null;
    uptime_pct?: number | null;
    roi_flag_rate?: number | null;

    // ---- raw counters, used only when the matching rate is absent
    runs_total?: number | null;
    runs_succeeded?: number | null;
    beats_total?: number | null;
    beats_up?: number | null;
    roi_flags_30d?: number | null;

    // ---- extra axes (pentagon only — these do NOT enter reliability_score)
    /** Runs where grounded = true. */
    runs_grounded?: number | null;
    /** Runs where grounded is not null, i.e. runs that reported grounding at all. */
    runs_with_grounding?: number | null;

    // ---- efficiency inputs. Rupees as recorded; dollars only as a fallback.
    cost_inr_total?: number | null;
    cost_usd_total?: number | null;
}

/** Match the view: round to 1dp, then clamp into 0..100. Order matters. */
function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n));
}

function clamp100(n: number): number {
    return clamp(round1(n), 0, 100);
}

function pct(part: number | null | undefined, whole: number | null | undefined): number | null {
    if (whole == null || whole <= 0) return null;
    return round1(((part ?? 0) * 100) / whole);
}

/**
 * Resolve the three score inputs, preferring supplied rates over raw counters.
 * Internal on purpose: callers get the resolved numbers back through
 * computeReliability() and reliabilityAxes(), which is the only way they can
 * disagree with each other by construction — they cannot.
 */
function deriveRates(stats: ReliabilityStats): {
    success_rate: number | null;
    uptime_pct: number | null;
    roi_flag_rate: number | null;
} {
    const success_rate = stats.success_rate ?? pct(stats.runs_succeeded, stats.runs_total);
    const uptime_pct = stats.uptime_pct ?? pct(stats.beats_up, stats.beats_total);

    let roi_flag_rate = stats.roi_flag_rate ?? null;
    if (roi_flag_rate == null) {
        const raw = pct(stats.roi_flags_30d, stats.runs_total);
        // The view caps this at 100: several flags can land on one run.
        roi_flag_rate = raw == null ? null : Math.min(100, raw);
    }

    return { success_rate, uptime_pct, roi_flag_rate };
}

/* ---------------------------------------------------------------------------
 * The score
 * ------------------------------------------------------------------------- */

/**
 * The weighted blend, identical to oem_agent_profile.reliability_score.
 *
 *     0.50 * COALESCE(success_rate, uptime_pct)
 *   + 0.30 * COALESCE(uptime_pct,  success_rate)
 *   + 0.20 * (100 - COALESCE(roi_flag_rate, 0))
 *
 * Two NULL behaviours are load-bearing and are reproduced deliberately:
 *
 *  - When ONE of success/uptime has no data it is substituted with the other,
 *    not treated as zero. An agent with a perfect run record but no heartbeat
 *    probe configured is not 30 points unreliable; it is unmeasured on that
 *    axis. Substitution keeps the score on the same 0..100 scale either way.
 *
 *  - When BOTH are missing the result is null, never 0. "Not measured yet" and
 *    "unreliable" must never render as the same number — a brand-new agent
 *    showing 20/100 would be a lie the operator acts on.
 */
export function computeReliability(stats: ReliabilityStats): number | null {
    const { success_rate, uptime_pct, roi_flag_rate } = deriveRates(stats);

    if (success_rate == null && uptime_pct == null) return null;

    const success = success_rate ?? uptime_pct ?? 0;
    const uptime = uptime_pct ?? success_rate ?? 0;
    const roi = roi_flag_rate ?? 0;

    const raw =
        RELIABILITY_WEIGHTS.success * success
        + RELIABILITY_WEIGHTS.uptime * uptime
        + RELIABILITY_WEIGHTS.roi * (100 - roi);

    return clamp100(raw);
}

/** Bands for colouring a score. Deliberately coarse — a score is not a ranking. */
export type ReliabilityBand = 'unmeasured' | 'critical' | 'watch' | 'healthy' | 'excellent';

export function reliabilityBand(score: number | null | undefined): ReliabilityBand {
    if (score == null || !Number.isFinite(score)) return 'unmeasured';
    if (score < 60) return 'critical';
    if (score < 80) return 'watch';
    if (score < 93) return 'healthy';
    return 'excellent';
}

/* ---------------------------------------------------------------------------
 * EFFICIENCY BAND. Cost per successful run, log-scaled.
 *
 * Log rather than linear because agent cost spans orders of magnitude: the
 * distance between ₹2 and ₹8 per run is the same kind of jump as ₹20 to ₹80,
 * and a linear scale would flatten the entire cheap end into one indistinct band
 * near 100. The two anchors are business judgements, not physics, so they are
 * named constants and they are RETURNED to the client by efficiencyBasis() — a
 * score nobody can audit is a decoration.
 * ------------------------------------------------------------------------- */

export const EFFICIENCY_EXCELLENT_INR = 5;    // ≤ ₹5 per successful run  -> 100
export const EFFICIENCY_POOR_INR = 100;       // ≥ ₹100 per successful run -> 0

/** Used only when a run recorded cost_usd but not cost_inr. Returned in the basis. */
export const USD_INR_RATE = 88;

/** Cost per successful run -> 0..100, log-scaled between the two anchors. */
export function efficiencyScore(costPerSuccess: number): number {
    if (!Number.isFinite(costPerSuccess)) return 0;
    if (costPerSuccess <= EFFICIENCY_EXCELLENT_INR) return 100;
    if (costPerSuccess >= EFFICIENCY_POOR_INR) return 0;
    const span = Math.log(EFFICIENCY_POOR_INR) - Math.log(EFFICIENCY_EXCELLENT_INR);
    return clamp100((100 * (Math.log(EFFICIENCY_POOR_INR) - Math.log(costPerSuccess))) / span);
}

/** Rupees as recorded; dollars converted only when no rupee figure exists at all. */
function effectiveInr(stats: ReliabilityStats): number {
    const inr = stats.cost_inr_total ?? 0;
    return inr > 0 ? inr : (stats.cost_usd_total ?? 0) * USD_INR_RATE;
}

/**
 * ₹ per successful run, to 4dp. Null when nothing has succeeded yet — dividing
 * a real spend by zero successes and printing ∞ (or 0) is worse than a blank.
 */
export function costPerSuccessInr(stats: ReliabilityStats): number | null {
    const successes = stats.runs_succeeded ?? 0;
    if (successes <= 0) return null;
    return Math.round((effectiveInr(stats) / successes) * 10000) / 10000;
}

/** The audit block for the Efficiency axis, shipped beside the radar. */
export function efficiencyBasis(stats: ReliabilityStats) {
    const inr = stats.cost_inr_total ?? 0;
    const usd = stats.cost_usd_total ?? 0;
    return {
        excellent_inr_per_success: EFFICIENCY_EXCELLENT_INR,
        poor_inr_per_success: EFFICIENCY_POOR_INR,
        scale: 'logarithmic' as const,
        usd_inr_rate_used_when_inr_absent: USD_INR_RATE,
        cost_source: inr > 0 ? 'cost_inr' : usd > 0 ? 'cost_usd × rate' : 'none',
    };
}

/* ---------------------------------------------------------------------------
 * The pentagon (reference C) — five named axes.
 *
 * IMPORTANT: this is a DECOMPOSITION FOR THE EYE, not the score. Three of the
 * five axes are the scored terms; grounding and efficiency are diagnostic and
 * carry zero weight. Averaging the five points does NOT give reliability_score,
 * and nothing in the UI should imply that it does.
 * ------------------------------------------------------------------------- */

export interface ReliabilityAxisValue {
    key: AgentReliabilityAxis;
    label: string;
    /** Plain-English meaning; AgentRadar surfaces it in the vertex <title>. */
    description: string;
    /**
     * Always a number so a chart can draw it without branching. It is
     * `measured` that says whether to believe it — an unmeasured axis is 0 here
     * and must be drawn dimmed, never as a collapsed vertex.
     */
    value: number;
    /** false = NO DATA. Not zero. A new agent has not earned a bad score. */
    measured: boolean;
}

const AXIS_DESCRIPTION: Record<AgentReliabilityAxis, string> = {
    success_rate: 'Share of runs in the last 30 days that finished successfully.',
    uptime_pct: 'Share of heartbeats in the last 30 days that reported the agent up.',
    roi_alignment: 'Inverse of the ROI-flag rate — how much of the work was judged worth doing.',
    grounding: 'Share of runs whose every claim traced back to a row in an active-bundle table.',
    efficiency: 'Cost per successful run, log-scaled against the efficiency band.',
};

/**
 * The five radar points, in draw order (AGENT_RELIABILITY_AXES).
 *
 *   Completion     success_rate                — scored, 0.50
 *   Availability   uptime_pct                  — scored, 0.30
 *   ROI alignment  100 - roi_flag_rate         — scored, 0.20
 *   Grounding      grounded runs / runs that reported grounding — diagnostic
 *   Efficiency     cost per successful run, log-scaled          — diagnostic
 */
export function reliabilityAxes(stats: ReliabilityStats): ReliabilityAxisValue[] {
    const { success_rate, uptime_pct, roi_flag_rate } = deriveRates(stats);

    const costPerSuccess = costPerSuccessInr(stats);

    const raw: Record<AgentReliabilityAxis, number | null> = {
        success_rate,
        uptime_pct,
        roi_alignment: roi_flag_rate == null ? null : 100 - roi_flag_rate,
        grounding: pct(stats.runs_grounded, stats.runs_with_grounding),
        efficiency: costPerSuccess == null ? null : efficiencyScore(costPerSuccess),
    };

    return AGENT_RELIABILITY_AXES.map((axis) => {
        const v = raw[axis.key];
        return {
            key: axis.key,
            label: axis.label,
            description: AXIS_DESCRIPTION[axis.key],
            value: v == null ? 0 : clamp100(v),
            measured: v != null,
        };
    });
}

/** How much of the pentagon is real. Shipped so the UI never implies five of five. */
export function radarCoverage(axes: ReadonlyArray<ReliabilityAxisValue>) {
    return {
        measured: axes.filter((a) => a.measured).length,
        of: axes.length,
        unmeasured: axes.filter((a) => !a.measured).map((a) => a.key),
    };
}

/* ---------------------------------------------------------------------------
 * Uptime series — status-page buckets.
 * ------------------------------------------------------------------------- */

/** The minimum a beat must carry to be bucketed. Structural, so partial rows fit. */
export interface UptimeBeat {
    beat_at: string;
    state: AgentHeartbeatState;
}

export type UptimeBucketState = AgentHeartbeatState | 'unknown';

/**
 * One cell of the strip. The field names AND the field set are exactly what the
 * route returns today and exactly what AgentUptime.tsx's `Bucket` interface
 * parses. Nothing was added: a field the strip cannot render is not a feature,
 * it is payload the next reader has to explain.
 */
export interface UptimeBucket {
    /** ISO start of the cell. */
    from: string;
    /** ISO end, exclusive. */
    to: string;
    beats: number;
    up: number;
    degraded: number;
    down: number;
    /** Null for an empty cell — no probe ran, which is not the same as 0% up. */
    uptime_pct: number | null;
    /** Worst state observed in the cell; 'unknown' when nothing was observed. */
    state: UptimeBucketState;
}

function toMs(v: number | string | Date | null | undefined): number | null {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const ms = v instanceof Date ? v.getTime() : Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Divide [from, to) into `count` equal cells and drop each beat into one.
 *
 * Positional (beats, from, to, count) because that is the shape the heartbeat
 * route's call already had, so the swap needed no call-site rewrite.
 *
 * WORST-STATE-WINS. A cell containing a single 'down' beat is a down cell, even
 * if 29 other beats in it were fine. A status page that averages an outage away
 * is a status page nobody trusts — and this is precisely the surface the
 * operator asked for: when they went down.
 *
 * Empty cells keep uptime_pct null and state 'unknown': silence is not uptime.
 */
export function uptimeSeries(
    beats: ReadonlyArray<UptimeBeat>,
    from: number | string | Date,
    to: number | string | Date,
    count: number,
): UptimeBucket[] {
    const startMs = toMs(from);
    const endMs = toMs(to);
    const n = Math.max(1, Math.trunc(count) || 1);
    if (startMs == null || endMs == null) return [];

    const span = Math.max(1, endMs - startMs);
    const width = span / n;

    const cells: UptimeBucket[] = Array.from({ length: n }, (_, i) => ({
        from: new Date(startMs + i * width).toISOString(),
        to: new Date(startMs + (i + 1) * width).toISOString(),
        beats: 0,
        up: 0,
        degraded: 0,
        down: 0,
        uptime_pct: null,
        state: 'unknown',
    }));

    for (const b of beats) {
        const t = toMs(b.beat_at);
        if (t == null) continue;
        const idx = Math.min(n - 1, Math.max(0, Math.floor((t - startMs) / width)));
        const cell = cells[idx];
        cell.beats += 1;
        // Explicit three-way, no catch-all: a state this module does not know is
        // counted as observed but never as up. Silently rounding an unrecognised
        // state up to 'up' is how a strip stays green through an outage.
        if (b.state === 'up') cell.up += 1;
        else if (b.state === 'degraded') cell.degraded += 1;
        else if (b.state === 'down') cell.down += 1;
    }

    for (const cell of cells) {
        if (!cell.beats) continue;
        cell.state = cell.down ? 'down' : cell.degraded ? 'degraded' : 'up';
        cell.uptime_pct = Math.round((cell.up / cell.beats) * 1000) / 10;
    }

    return cells;
}

/**
 * Share of beats that reported 'up', to `dp` decimals. Null when there were no
 * beats at all — an agent nobody probed is unmeasured, not 0% available.
 *
 * STRICT: only 'up' counts as up. 'degraded' is not uptime, it is a warning that
 * was acted on or ignored.
 */
export function beatsUptimePct(
    beats: ReadonlyArray<{ state: AgentHeartbeatState }>,
    dp = 2,
): number | null {
    if (!beats.length) return null;
    const up = beats.reduce((n, b) => n + (b.state === 'up' ? 1 : 0), 0);
    return Number(((up / beats.length) * 100).toFixed(dp));
}
