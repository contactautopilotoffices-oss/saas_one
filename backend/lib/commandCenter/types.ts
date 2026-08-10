/**
 * Response shapes for every /api/command-center/* route.
 *
 * The UI imports these directly — they are the contract. Two conventions run through all
 * of them and both exist to keep the dashboard honest:
 *
 *  1. `provisioned: false` means the backing table is missing or the org has no rows yet.
 *     The route still returns 200; the card renders a setup state. Every payload is a
 *     discriminated union on this field, so a card physically cannot read a metric off an
 *     unprovisioned response.
 *
 *  2. A metric that CANNOT be computed from real data is `null`, never a plausible
 *     substitute, and the sibling `*_note` string says why. The figures in the reference
 *     image are illustrative; nothing here is allowed to reproduce them from thin air.
 */

/** Every route returns either this, or its own provisioned payload. */
export interface Unprovisioned {
    provisioned: false;
    /** Human-readable explanation the card can show under its setup state. */
    reason: string;
}

export type CommandCenterResponse<T> = Unprovisioned | T;

/** A single point in a chart series. `value` is null where the day has no reading. */
export interface SeriesPoint {
    date: string;          // YYYY-MM-DD
    value: number | null;
}

// ---------------------------------------------------------------- workforce

export interface WorkforceShortfall {
    property_id: string;
    property_name: string;
    /** Head-count rostered for the target date. */
    planned: number;
    /** Typical head-count for that property on that weekday (median of recent weeks). */
    baseline: number;
    /** baseline - planned, only reported when positive. */
    shortfall: number;
}

export interface WorkforceResponse {
    provisioned: true;
    date: string;                          // the "today" this was computed for (Asia/Kolkata)
    /** Head-count rostered across the scoped properties today. */
    planned: number;
    /** Rostered people who actually checked in today. */
    staffed: number;
    /**
     * staffed / planned as a percentage. Null when no check-in has been recorded anywhere
     * in the scope for 30 days — with no attendance signal, "0% coverage" would be a lie
     * about the workforce rather than a fact about the data.
     */
    coverage_pct: number | null;
    /** Checked in more than LATE_GRACE_MINUTES after the rostered shift start. */
    late: number | null;
    /** Rostered, shift already started, no check-in. */
    absent: number | null;
    /** Property with the largest rostered shortfall tomorrow, or null if none is short. */
    largest_shortfall_tomorrow: WorkforceShortfall | null;
    data_quality: {
        /** Check-ins recorded across the scope in the trailing 30 days. */
        checkins_last_30d: number;
        /** Rostered rows in the trailing 30 days, for context on the ratio above. */
        rostered_last_30d: number;
        /** Set when attendance adoption is too thin to trust the coverage figure. */
        note: string | null;
    };
}

// ---------------------------------------------------------------- water

export interface WaterSourceUsage {
    source_id: string;
    name: string;
    source_type: string | null;
    property_id: string | null;
    /** Deliveries logged (tankers, jars). Always available. */
    units: number;
    /** units x capacity_litres. Null when the source has no capacity on file. */
    litres: number | null;
    cost: number;
}

export interface WaterResponse {
    provisioned: true;
    /** Latest date with a reading. Water is logged per DAY, not per hour. */
    as_of: string;
    today: {
        units: number;
        /** Null when any contributing source is missing capacity_litres. */
        litres: number | null;
        cost: number;
    };
    /** Change in litres (or units, when litres are unavailable) vs the same day last week. */
    delta_pct: number | null;
    /** Which basis delta_pct and the series are expressed in. */
    basis: 'litres' | 'units';
    /** Daily series for the bar chart. Hourly is impossible — see `granularity_note`. */
    series: SeriesPoint[];
    granularity: 'daily';
    granularity_note: string;
    billing: {
        /** Cost over the 7 days ending `as_of`. */
        expected_bill: number;
        /** Cost over the preceding 7 days. */
        last_week_bill: number;
        /** last_week_bill - expected_bill. Positive = saving. */
        saving: number;
    };
    highest_use_source: (WaterSourceUsage & { share_pct: number | null }) | null;
    /**
     * Always null on this schema. See the comment in the route: leak detection needs a
     * continuous flow signal, and water_readings stores discrete delivery counts per day.
     */
    leak_probability: null;
    leak_probability_note: string;
    data_quality: {
        sources_missing_capacity: string[];
        note: string | null;
    };
}

// ---------------------------------------------------------------- ppm

export interface PpmCriticalAsset {
    property_id: string | null;
    property_name: string | null;
    system_name: string | null;
    detail_name: string | null;
    planned_date: string;
    days_overdue: number;
    /** Most recent done_date for the same system at the same property. */
    last_serviced_on: string | null;
    days_since_last_service: number | null;
}

export interface PpmResponse {
    provisioned: true;
    period: { from: string; to: string; label: string };
    /** Tasks planned inside the period. */
    planned: number;
    completed: number;
    /** completed / planned. Null when nothing is planned in the period. */
    completion_pct: number | null;
    due_today: number;
    overdue: number;
    next_7_days: number;
    /**
     * Null on this schema: no compliance target is stored anywhere (ppm_schedules and
     * ppm_audit_reports have no target column). The 95% in the reference image is
     * illustrative and is deliberately not reproduced here.
     */
    target_pct: null;
    target_pct_note: string;
    most_critical_asset: PpmCriticalAsset | null;
}

// ---------------------------------------------------------------- dg

export interface DgGeneratorState {
    generator_id: string;
    name: string | null;
    property_id: string | null;
    property_name: string | null;
    state: 'running' | 'standby' | 'fault' | 'unknown';
    last_reading_date: string | null;
    run_hours_last_reading: number | null;
}

export interface DgResponse {
    provisioned: true;
    as_of: string | null;
    counts: { running: number; standby: number; fault: number; unknown: number; total: number };
    /** 'Normal' | 'Attention' | 'Unknown'. Null when no reading exists at all. */
    status: 'Normal' | 'Attention' | 'Unknown' | null;
    recent: {
        window_days: number;
        run_hours: number;
        litres_consumed: number;
        cost: number;
        /** Readings that fed the window. */
        readings: number;
    };
    generators: DgGeneratorState[];
    /** How running/standby/fault were derived — generators.status is a lifecycle flag. */
    state_derivation_note: string;
}

// ---------------------------------------------------------------- portfolio / health

/** One deduction in the health score. `available: false` means the signal had no data. */
export interface ScoreComponent {
    key: 'sla_overdue' | 'ticket_backlog' | 'ppm_overdue' | 'electricity_anomalies' | 'budget_variance';
    label: string;
    /** The raw measurement (breached tickets, overdue tasks, overspend %). */
    value: number | null;
    /** Points subtracted from 100. Always >= 0. */
    penalty: number;
    /** Maximum this component can ever subtract. */
    max_penalty: number;
    available: boolean;
}

export interface PropertyHealth {
    property_id: string;
    name: string;
    city: string | null;
    /**
     * 0-100, or NULL when the site has no measurable signal at all.
     * Null means "we are not tracking this building", which is a different and more
     * actionable statement than a score of 100. Never coalesce it to a number.
     */
    score: number | null;
    /** How many of the five signals had data. 0 => untracked. */
    signals_available: number;
    signals_total: number;
    components: ScoreComponent[];
    /** 7 points ending today; see the route comment for what is and is not time-travelled. */
    series: SeriesPoint[];
}

export interface PortfolioResponse {
    provisioned: true;
    as_of: string;
    properties: PropertyHealth[];
    /** The formula, verbatim, so the UI can explain the number without guessing. */
    scoring_note: string;
}

export interface HealthResponse {
    provisioned: true;
    as_of: string;
    /** Mean of the per-property scores, over TRACKED properties only. Null if none are. */
    score: number | null;
    /** Properties with no measurable signal, excluded from the mean. */
    untracked_properties: number;
    /** score(today) - score(yesterday), in points. Null when yesterday is uncomputable. */
    delta_vs_yesterday: number | null;
    series: SeriesPoint[];
    stats: {
        buildings_need_attention: number;
        critical_issues: number;
        /**
         * Sum of positive budget variance (actual - budget) for the latest AOP month, in
         * rupees. Null when no AOP data exists — there is no other rupee signal to fall
         * back on, and an invented number here would be the most damaging kind.
         */
        financial_exposure_inr: number | null;
        financial_exposure_note: string | null;
        positive_updates: number;
    };
    scoring_note: string;
}

// ---------------------------------------------------------------- brief

export interface BriefResponse {
    provisioned: true;
    /** Three short paragraphs of plain-English narrative. */
    paragraphs: string[];
    generated_at: string;
    model: string;
    /** Estimated USD spent generating this brief. */
    cost_usd: number;
    /** Which aggregate feeds were available to the model. */
    inputs: string[];
}
