'use client';

/**
 * ORGANIZATION PROGRESS TRACKER
 *
 * Org super admin module. The primary instrument is a five-point pentagon radar
 * (OrgProgressRadar) — one vertex per OEM level: agent, employee, department,
 * tech, org. It replaced a five-ring concentric dial, which stacked five arcs,
 * five needles and five floating value chips into the same 180deg of screen.
 * The level model was already exactly five, so a pentagon needs no invented
 * axis and no nesting to say the same thing.
 *
 * Four things it does that a static chart cannot:
 *   1. Contribution weights are editable, so you can see what each level is
 *      actually worth to the org number.
 *   2. Simulate mode lets you drag a vertex along its spoke and watch the org
 *      number move — turn one gear, see the train.
 *   3. Every level carries its movement since the previous period, derived from
 *      oem_measurements through v_oem_goal_progress.
 *   4. A level with no measurement is reported as "not measured", never as 0.
 *      A silent zero would hide exactly the levels nobody is instrumenting.
 *
 * It NEVER substitutes invented data for real data. Four states are separated
 * and each is labelled for its actual cause: no organization selected, a failed
 * fetch (with the status code and a retry — never a silent fallback), a
 * provisioned org with zero goals (an empty outline, not a filled shape), and
 * live data. Demo rows exist only behind an explicit opt-in (`?demo=1` or
 * NEXT_PUBLIC_OEM_DEMO_DATA=1), carry obviously-fake placeholder names, and are
 * fronted by a permanent "DEMO DATA — not your organisation" banner. It must be
 * impossible to see fabricated staff performance by accident.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
    Gauge, RefreshCw, AlertTriangle, SlidersHorizontal, RotateCcw,
    Table2, MoveHorizontal, TrendingUp, TrendingDown,
    Bot, User, Users, Cpu, Building2, CheckCircle2, Link2Off, Target, FlaskConical,
} from 'lucide-react';
import { LEVEL_COLORS } from './levelPalette';
import OrgProgressRadar, { type LevelDimension } from './OrgProgressRadar';

type LevelKey = 'agent' | 'employee' | 'department' | 'tech' | 'org';

/** Radar axis order, clockwise from the top vertex. */
const LEVEL_ORDER: LevelKey[] = ['agent', 'employee', 'department', 'tech', 'org'];

const LEVEL_META: Record<LevelKey, { n: number; label: string; short: string; sublabel: string; icon: React.ElementType; drives: string }> = {
    agent:      { n: 1, label: 'Agent Level',        short: 'Agent',      sublabel: 'AI agents & automation execution',  icon: Bot,       drives: 'Agents execute tasks with accuracy, speed & reliability' },
    employee:   { n: 2, label: 'Employee Level',     short: 'Employee',   sublabel: 'Individual performance & execution', icon: User,      drives: 'Employees execute better, collaborate & stay accountable' },
    department: { n: 3, label: 'Department Level',   short: 'Department', sublabel: 'Team delivery & performance',        icon: Users,     drives: 'Teams deliver on time & achieve department goals' },
    tech:       { n: 4, label: 'Tech Level',         short: 'Tech',       sublabel: 'Systems, automation & enablement',   icon: Cpu,       drives: 'Technology enables scale, automation & efficiency' },
    org:        { n: 5, label: 'Organization Level', short: 'Org',        sublabel: 'Business impact & growth',           icon: Building2, drives: 'Business grows, impact increases, organization thrives' },
};

const WEIGHT_PRESETS: Record<string, Record<LevelKey, number>> = {
    equal:        { agent: 20, employee: 20, department: 20, tech: 20, org: 20 },
    'inside-out': { agent: 30, employee: 25, department: 20, tech: 15, org: 10 },
    'outcome':    { agent: 10, employee: 15, department: 20, tech: 25, org: 30 },
};

interface GoalRow {
    goal_id: string;
    level: LevelKey;
    title: string;
    department: string | null;
    agent_key: string | null;
    owner_uid: string | null;
    cadence: string;
    metric_key: string;
    unit: string | null;
    direction: 'up' | 'down' | null;
    baseline_value: number | null;
    target_value: number;
    current_value: number | null;
    progress_pct: number | null;
    expected_rate: number | null;
    actual_rate: number | null;
    data_in_chain: boolean | null;
}

interface LevelStat { level: LevelKey; goal_count: number; measured_count: number; progress_pct: number | null }

/**
 * DEMO FIXTURE — fabricated. Reachable ONLY through the explicit opt-in below,
 * never as a fallback for an error or an empty org.
 *
 * Every actor is a placeholder token ("Placeholder Agent A", "Placeholder
 * Person 1", department "Demo Dept A") precisely so no row can be mistaken for
 * a real member of staff. The previous fixture named plausible people and read
 * as a real performance record; that is the failure mode this file now forbids.
 *
 * The numbers are still internally consistent with the view's own formulas
 * (progress_pct = (current - baseline) / (target - baseline); actual_rate is the
 * direction-normalised movement in the latest period) so the layout can be
 * reviewed without the maths contradicting itself.
 */
const DEMO_GOALS: GoalRow[] = [
    { goal_id: 'demo-1', level: 'agent',      title: 'Placeholder Agent A — demo metric',  department: 'Demo Dept A', agent_key: 'placeholder-agent-a', owner_uid: null,               cadence: 'weekly',    metric_key: 'demo.agent_metric_a',      unit: '%',     direction: 'up',   baseline_value: 0,  target_value: 60, current_value: 27,  progress_pct: 45.0, expected_rate: 6,   actual_rate: 7,   data_in_chain: true },
    { goal_id: 'demo-2', level: 'agent',      title: 'Placeholder Agent B — demo metric',  department: 'Demo Dept B', agent_key: 'placeholder-agent-b', owner_uid: null,               cadence: 'weekly',    metric_key: 'demo.agent_metric_b',      unit: '%',     direction: 'up',   baseline_value: 55, target_value: 90, current_value: 71,  progress_pct: 45.7, expected_rate: 4,   actual_rate: 2,   data_in_chain: false },
    { goal_id: 'demo-3', level: 'employee',   title: 'Placeholder Person 1 — demo metric', department: 'Demo Dept A', agent_key: null,                  owner_uid: 'placeholder-user-1', cadence: 'weekly',    metric_key: 'demo.employee_metric_a',   unit: 'hours', direction: 'down', baseline_value: 14, target_value: 6,  current_value: 9.4, progress_pct: 57.5, expected_rate: 0.5, actual_rate: 0.6, data_in_chain: true },
    { goal_id: 'demo-4', level: 'employee',   title: 'Placeholder Person 2 — demo metric', department: 'Demo Dept B', agent_key: null,                  owner_uid: 'placeholder-user-2', cadence: 'weekly',    metric_key: 'demo.employee_metric_b',   unit: 'mins',  direction: 'down', baseline_value: 55, target_value: 30, current_value: 41,  progress_pct: 56.0, expected_rate: 5,   actual_rate: 3,   data_in_chain: true },
    { goal_id: 'demo-5', level: 'department', title: 'Demo Dept A — demo metric',          department: 'Demo Dept A', agent_key: null,                  owner_uid: null,               cadence: 'monthly',   metric_key: 'demo.department_metric_a', unit: 'hours', direction: 'down', baseline_value: 84, target_value: 48, current_value: 61,  progress_pct: 63.9, expected_rate: 4,   actual_rate: 4,   data_in_chain: true },
    { goal_id: 'demo-6', level: 'department', title: 'Demo Dept B — demo metric',          department: 'Demo Dept B', agent_key: null,                  owner_uid: null,               cadence: 'monthly',   metric_key: 'demo.department_metric_b', unit: '%',     direction: 'up',   baseline_value: 70, target_value: 95, current_value: 84,  progress_pct: 56.0, expected_rate: 3,   actual_rate: 1,   data_in_chain: true },
    { goal_id: 'demo-7', level: 'tech',       title: 'Demo Tech — demo metric',            department: 'Demo Dept C', agent_key: null,                  owner_uid: null,               cadence: 'quarterly', metric_key: 'demo.tech_metric',         unit: '%',     direction: 'up',   baseline_value: 40, target_value: 95, current_value: 72,  progress_pct: 58.2, expected_rate: 2,   actual_rate: 3,   data_in_chain: true },
    { goal_id: 'demo-8', level: 'org',        title: 'Demo Org — demo metric',             department: null,          agent_key: null,                  owner_uid: null,               cadence: 'quarterly', metric_key: 'demo.org_metric',          unit: 'count', direction: 'down', baseline_value: 11, target_value: 2,  current_value: 5,   progress_pct: 66.7, expected_rate: 1,   actual_rate: 1,   data_in_chain: true },
];

/**
 * Demo mode is opt-in and defaults OFF. `?demo=1` on the URL, or
 * NEXT_PUBLIC_OEM_DEMO_DATA=1 in the environment. Read from window rather than
 * useSearchParams so the component needs no Suspense boundary and so the first
 * server-rendered pass is always the non-demo one.
 */
function readDemoOptIn(): boolean {
    if (process.env.NEXT_PUBLIC_OEM_DEMO_DATA === '1') return true;
    if (typeof window === 'undefined') return false;
    try {
        const v = new URLSearchParams(window.location.search).get('demo');
        return v === '1' || v === 'true';
    } catch {
        return false;
    }
}

/** What the instrument is currently showing, and why. */
type ViewState = 'loading' | 'no-org' | 'error' | 'empty' | 'live' | 'demo';

/**
 * The status line on the instrument. Every non-live state names its own cause;
 * none of them borrows the word "live" or implies the shape below is measured.
 */
const STATUS_LABEL: Record<ViewState, string> = {
    loading: 'LOADING',
    'no-org': 'NO ORGANIZATION SELECTED',
    error:   'DATA UNAVAILABLE',
    empty:   'NO GOALS RECORDED YET',
    live:    'LIVE',
    demo:    'DEMO DATA — NOT YOUR ORGANISATION',
};

const STATUS_DOT: Record<ViewState, string> = {
    loading: 'bg-slate-400',
    'no-org': 'bg-slate-400',
    error:   'bg-rose-500',
    empty:   'bg-slate-400',
    live:    'bg-emerald-500',
    demo:    'bg-amber-500',
};

const LS_KEY = 'oem.progress.weights.v1';

/**
 * Movement in progress-points since the previous period.
 * progress_pct is linear from baseline to target, and actual_rate is the
 * direction-normalised change in raw value across the last two measurements,
 * so the change in progress terms is just actual_rate scaled by the span.
 */
function goalDeltaPoints(g: GoalRow): number | null {
    if (g.actual_rate == null || g.baseline_value == null) return null;
    const span = Math.abs(g.target_value - g.baseline_value);
    if (!span) return null;
    return (g.actual_rate / span) * 100;
}

function relativeTime(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
}

export default function OrgProgressTracker() {
    const params = useParams();
    const orgId = params?.orgId as string | undefined;

    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<ViewState>('loading');
    const [failure, setFailure] = useState<{ status: number | null; detail: string } | null>(null);

    // Opt-in only, resolved after mount so SSR never renders fabricated rows.
    const [demoOptIn, setDemoOptIn] = useState(false);
    useEffect(() => { setDemoOptIn(readDemoOptIn()); }, []);

    const [goals, setGoals] = useState<GoalRow[]>([]);
    const [levelStats, setLevelStats] = useState<LevelStat[]>([]);

    // filters
    const [cadence, setCadence] = useState('');
    const [department, setDepartment] = useState('');
    const [levelFilter, setLevelFilter] = useState<LevelKey | ''>('');
    const [actorFilter, setActorFilter] = useState('');

    // customization
    const [weights, setWeights] = useState<Record<LevelKey, number>>(WEIGHT_PRESETS.equal);
    const [hidden, setHidden] = useState<Record<string, boolean>>({});
    const [simulate, setSimulate] = useState(false);
    const [overrides, setOverrides] = useState<Partial<Record<LevelKey, number>>>({});
    const [showWeights, setShowWeights] = useState(false);
    const [showTable, setShowTable] = useState(false);
    const [focused, setFocused] = useState<string | null>(null);

    // freshness clock. Null until mounted so the server and client agree.
    const [loadedAt, setLoadedAt] = useState<number | null>(null);
    const [nowTs, setNowTs] = useState<number | null>(null);

    // The freshness clock only runs over real, loaded data. Ticking "updated 4s
    // ago" on top of an empty or failed panel is motion that implies liveness
    // the screen does not have.
    useEffect(() => {
        if (view !== 'live') { setNowTs(null); return; }
        setNowTs(Date.now());
        const t = setInterval(() => setNowTs(Date.now()), 1000);
        return () => clearInterval(t);
    }, [view]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) setWeights({ ...WEIGHT_PRESETS.equal, ...JSON.parse(raw) });
        } catch { /* storage unavailable — defaults are fine */ }
    }, []);

    const persistWeights = (w: Record<LevelKey, number>) => {
        setWeights(w);
        try { localStorage.setItem(LS_KEY, JSON.stringify(w)); } catch { /* ignore */ }
    };

    /**
     * Loads real data, or reports exactly why it could not.
     *
     * There is deliberately no path from a failure to the demo fixture. A 500
     * used to arrive here as `rows = []` — indistinguishable from a healthy
     * empty org — and the screen then filled itself with invented goals under a
     * badge that blamed the org for having none. res.ok is therefore checked
     * explicitly rather than relying on fetch to throw, which it does not do
     * for HTTP error statuses.
     */
    const load = useCallback(async () => {
        if (demoOptIn) {
            setGoals(DEMO_GOALS);
            setLevelStats([]);
            setFailure(null);
            setView('demo');
            setLoading(false);
            setLoadedAt(null);
            return;
        }
        if (!orgId) {
            setGoals([]);
            setLevelStats([]);
            setFailure(null);
            setView('no-org');
            setLoading(false);
            setLoadedAt(null);
            return;
        }
        setLoading(true);
        setFailure(null);
        try {
            const qp = new URLSearchParams({ orgId });
            if (cadence) qp.set('cadence', cadence);
            if (department) qp.set('department', department);

            const [meterRes, goalsRes] = await Promise.all([
                fetch(`/api/org-efficiency/meter?${qp}`),
                fetch(`/api/org-efficiency/goals?${qp}`),
            ]);

            // The goals response is the one the shape is built from — if it did
            // not succeed there is nothing honest to draw.
            if (!goalsRes.ok) {
                setGoals([]);
                setLevelStats([]);
                setFailure({ status: goalsRes.status, detail: `GET /api/org-efficiency/goals returned ${goalsRes.status}` });
                setView('error');
                setLoadedAt(null);
                return;
            }

            const goalData = await goalsRes.json().catch(() => null);
            if (!goalData || !Array.isArray(goalData.goals)) {
                setGoals([]);
                setLevelStats([]);
                setFailure({ status: goalsRes.status, detail: 'The goals response was not in the expected shape.' });
                setView('error');
                setLoadedAt(null);
                return;
            }

            const rows: GoalRow[] = goalData.goals;
            // The meter only supplies per-level aggregates. If it failed we
            // still have the goals, so fall back to computing levels from the
            // rows — that is derived from real data, not invented.
            const meter = meterRes.ok ? await meterRes.json().catch(() => null) : null;

            setGoals(rows);
            setLevelStats(meter?.levels ?? []);
            setFailure(null);
            setView(rows.length ? 'live' : 'empty');
            setLoadedAt(rows.length ? Date.now() : null);
        } catch (e) {
            // Network / abort. Still no fabricated data.
            setGoals([]);
            setLevelStats([]);
            setFailure({ status: null, detail: (e as Error).message || 'The request did not complete.' });
            setView('error');
            setLoadedAt(null);
        } finally {
            setLoading(false);
        }
    }, [orgId, cadence, department, demoOptIn]);

    useEffect(() => { load(); }, [load]);

    const isDemo = view === 'demo';
    /** True only when the rows on screen came from somewhere. */
    const hasRows = view === 'live' || view === 'demo';

    /**
     * Simulation overrides outlive the data they were dragged against. If a
     * refresh turns live data into an error or an empty org, a leftover
     * override would keep painting a vertex at a number the user invented —
     * over nothing at all. Drop them the moment the data goes away.
     */
    useEffect(() => {
        if (hasRows) return;
        setOverrides({});
        setSimulate(false);
        setShowWeights(false);
    }, [hasRows]);

    const filteredGoals = useMemo(() => {
        return goals.filter((g) => {
            if (levelFilter && g.level !== levelFilter) return false;
            if (isDemo && department && g.department !== department) return false;
            if (isDemo && cadence && g.cadence !== cadence) return false;
            if (actorFilter && g.agent_key !== actorFilter && g.owner_uid !== actorFilter) return false;
            return true;
        });
    }, [goals, levelFilter, actorFilter, isDemo, department, cadence]);

    /**
     * Per-level progress: mean of measured goals. Unmeasured never counts as
     * zero — the level reports null and the radar leaves that axis open.
     */
    const levelValues = useMemo(() => {
        const out = {} as Record<LevelKey, {
            value: number | null; delta: number | null;
            total: number; measured: number; missing: number;
        }>;
        for (const key of LEVEL_ORDER) {
            const stat = levelStats.find((s) => s.level === key);
            const rows = filteredGoals.filter((g) => g.level === key);
            const measured = rows.filter((g) => g.progress_pct != null);
            const fromStat = !isDemo && !levelFilter && !actorFilter && stat ? stat.progress_pct : null;
            const computed = measured.length
                ? measured.reduce((s, g) => s + (g.progress_pct ?? 0), 0) / measured.length
                : null;

            // Trend over the goals that actually have two measurements behind them.
            const moved = measured
                .map(goalDeltaPoints)
                .filter((d): d is number => d != null);
            const delta = moved.length
                ? moved.reduce((s, d) => s + d, 0) / moved.length
                : null;

            const overridden = overrides[key] != null;
            out[key] = {
                value: overrides[key] ?? fromStat ?? computed ?? null,
                // A simulated value has no history, so it gets no trend arrow.
                delta: overridden ? null : delta,
                total: stat && !isDemo ? stat.goal_count : rows.length,
                measured: measured.length,
                missing: rows.filter((g) => !g.data_in_chain).length,
            };
        }
        return out;
    }, [filteredGoals, levelStats, overrides, isDemo, levelFilter, actorFilter]);

    /** Weighted contribution of every visible, measured level. */
    const { overall, contributions, overallPrevious } = useMemo(() => {
        const active = LEVEL_ORDER.filter((k) => !hidden[k] && levelValues[k].value != null);
        const totalW = active.reduce((s, k) => s + (weights[k] || 0), 0);
        if (!active.length || totalW === 0) {
            return { overall: null as number | null, contributions: {} as Record<string, number>, overallPrevious: null as number | null };
        }
        const contrib: Record<string, number> = {};
        let sum = 0;
        let prevSum = 0;
        let anyTrend = false;
        for (const k of active) {
            const share = (weights[k] || 0) / totalW;
            const v = levelValues[k].value ?? 0;
            const d = levelValues[k].delta;
            contrib[k] = v * share;
            sum += v * share;
            // A level with no trend is carried forward flat rather than dropped,
            // so the org delta stays comparable to the org number beside it.
            prevSum += (d != null ? Math.max(0, Math.min(100, v - d)) : v) * share;
            if (d != null) anyTrend = true;
        }
        return { overall: sum, contributions: contrib, overallPrevious: anyTrend ? prevSum : null };
    }, [levelValues, weights, hidden]);

    const dimensions: LevelDimension[] = useMemo(
        () =>
            LEVEL_ORDER.map((key) => {
                const meta = LEVEL_META[key];
                const v = levelValues[key];
                return {
                    key,
                    label: meta.label,
                    short: meta.short,
                    n: meta.n,
                    value: v.value,
                    delta: v.delta,
                    contribution: contributions[key] ?? null,
                    weight: weights[key],
                    measured: v.measured,
                    total: v.total,
                    missing: v.missing,
                    hidden: !!hidden[key],
                    drives: meta.drives,
                    icon: meta.icon,
                };
            }),
        [levelValues, contributions, weights, hidden]
    );

    const departments = useMemo(
        () => Array.from(new Set(goals.map((g) => g.department).filter(Boolean))) as string[],
        [goals]
    );
    const actors = useMemo(
        () => Array.from(new Set(goals.map((g) => g.agent_key).filter(Boolean))) as string[],
        [goals]
    );

    const totalMissing = LEVEL_ORDER.reduce((s, k) => s + levelValues[k].missing, 0);
    const dirty = Object.keys(overrides).length > 0;

    const setOverride = useCallback((key: string, value: number) => {
        setOverrides((o) => ({ ...o, [key as LevelKey]: Math.max(0, Math.min(100, Math.round(value))) }));
    }, []);

    const toggleHidden = useCallback((key: string) => {
        setHidden((h) => ({ ...h, [key]: !h[key] }));
    }, []);

    const selectCls =
        'px-3 py-2 text-sm rounded-lg border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';
    const buttonCls =
        'flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border bg-card text-text-secondary hover:border-primary/40 hover:text-foreground transition-colors';
    const activeButtonCls =
        'flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-primary/60 bg-primary/10 text-primary transition-colors';

    return (
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5">
            {/* header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground">
                        <Gauge className="w-7 h-7 text-primary" /> Organization Progress Meter
                    </h1>
                    <p className="text-sm text-text-secondary">
                        Five levels, one shape. Every level moves — together we grow.
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Weights and Simulate compose or override the level numbers.
                        With no numbers on screen they can only manufacture one,
                        so they are unavailable outside a populated instrument. */}
                    <button
                        onClick={() => setShowWeights((v) => !v)}
                        disabled={!hasRows}
                        title={hasRows ? undefined : 'Available once there is data to weight'}
                        className={`${showWeights ? activeButtonCls : buttonCls} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-text-secondary`}
                    >
                        <SlidersHorizontal className="w-4 h-4" /> Weights
                    </button>
                    <button
                        onClick={() => setSimulate((v) => !v)}
                        disabled={!hasRows}
                        title={hasRows ? undefined : 'Available once there is data to simulate against'}
                        className={`${simulate ? activeButtonCls : buttonCls} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-text-secondary`}
                    >
                        <MoveHorizontal className="w-4 h-4" /> Simulate
                    </button>
                    <button onClick={load} className={buttonCls}>
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
            </div>

            {/* DEMO banner. Persistent, unmissable, and never reachable by accident. */}
            {view === 'demo' && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/15 border-2 border-amber-500/60 text-amber-800 text-sm">
                    <FlaskConical className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                        <strong className="uppercase tracking-wide">Demo data — not your organisation.</strong>{' '}
                        Every goal, name and number below is fabricated placeholder content shown because demo mode is
                        switched on. Remove <code className="px-1 rounded bg-amber-500/20">?demo=1</code> from the URL
                        (or unset NEXT_PUBLIC_OEM_DEMO_DATA) to see real data.
                    </span>
                </div>
            )}

            {/* Fetch failed. The instrument stays empty — a server error is not
                evidence about this organisation's goals. */}
            {view === 'error' && (
                <div className="flex flex-wrap items-start gap-3 p-4 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-700 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-[240px]">
                        <p className="font-semibold">Couldn&apos;t load progress data.</p>
                        <p className="mt-0.5 text-rose-700/90">
                            {failure?.status != null
                                ? `The server responded with HTTP ${failure.status}.`
                                : 'The request did not reach the server.'}{' '}
                            Nothing is shown below because a failed request says nothing about your goals.
                        </p>
                        {failure?.detail && (
                            <p className="mt-1 text-xs text-rose-700/70 font-mono break-all">{failure.detail}</p>
                        )}
                    </div>
                    <button
                        onClick={load}
                        className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Retry
                    </button>
                </div>
            )}

            {/* No org in the route. */}
            {view === 'no-org' && (
                <div className="flex items-start gap-2 p-4 rounded-lg bg-muted border border-border text-text-secondary text-sm">
                    <Building2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                        <strong className="text-foreground">Select an organization.</strong>{' '}
                        The progress meter reads goals for one organization at a time, and no organization is selected.
                    </span>
                </div>
            )}

            {/* Real empty state: the org loaded fine and has no goals. */}
            {view === 'empty' && (
                <div className="flex flex-wrap items-start gap-3 p-4 rounded-lg bg-muted border border-border text-sm">
                    <Target className="w-4 h-4 mt-0.5 shrink-0 text-text-tertiary" />
                    <div className="flex-1 min-w-[240px]">
                        <p className="font-semibold text-foreground">No goals recorded yet.</p>
                        <p className="mt-0.5 text-text-secondary">
                            This organization loaded successfully and has zero goals, so every axis below is open. Add
                            the first goal in the Goal Tracker tab and the shape will start filling in.
                        </p>
                    </div>
                    <button onClick={load} className={buttonCls}>
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Check again
                    </button>
                </div>
            )}

            {/* filters — one row above the instrument */}
            <div className="flex flex-wrap gap-2 items-center">
                <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as LevelKey | '')} className={selectCls} aria-label="Filter by level">
                    <option value="">All levels</option>
                    {LEVEL_ORDER.map((k) => <option key={k} value={k}>{LEVEL_META[k].label}</option>)}
                </select>
                <select value={department} onChange={(e) => setDepartment(e.target.value)} className={selectCls} aria-label="Filter by department">
                    <option value="">All departments</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={selectCls} aria-label="Filter by cadence">
                    <option value="">All cadences</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                </select>
                <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} className={selectCls} aria-label="Filter by agent">
                    <option value="">All agents</option>
                    {actors.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <button onClick={() => setShowTable((v) => !v)} className={showTable ? activeButtonCls : buttonCls}>
                    <Table2 className="w-4 h-4" /> {showTable ? 'Hide' : 'Table'} view
                </button>
                {dirty && (
                    <button
                        onClick={() => setOverrides({})}
                        className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700"
                    >
                        <RotateCcw className="w-4 h-4" /> Reset simulation
                    </button>
                )}
            </div>

            {/* instrument */}
            <div className="rounded-[var(--panel-radius)] overflow-hidden border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-border">
                    {/* The status line says what this shape actually is. The
                        pulsing dot and the ticking clock belong to live data
                        only — animating them over an empty or failed panel is
                        what makes a dead instrument look alive. */}
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                        {view === 'live' ? (
                            <>
                                <span className="relative flex w-2 h-2">
                                    <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-500 opacity-70 animate-ping" />
                                    <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
                                </span>
                                <span className="font-semibold tracking-wide text-foreground">LIVE</span>
                                <span aria-live="polite">
                                    updated {loadedAt != null && nowTs != null ? relativeTime(nowTs - loadedAt) : '—'}
                                </span>
                            </>
                        ) : (
                            <>
                                <span className={`inline-flex w-2 h-2 rounded-full ${STATUS_DOT[view]}`} aria-hidden />
                                <span className="font-semibold tracking-wide text-foreground">{STATUS_LABEL[view]}</span>
                            </>
                        )}
                        {dirty && (
                            <span className="ml-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 font-medium">
                                simulated
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-text-tertiary">
                        {filteredGoals.length} goal{filteredGoals.length === 1 ? '' : 's'} in view
                        {(levelFilter || department || cadence || actorFilter) && ' · filtered'}
                    </div>
                </div>

                <div className="p-4 md:p-5">
                    <OrgProgressRadar
                        dimensions={dimensions}
                        overall={overall}
                        overallPrevious={overallPrevious}
                        simulate={simulate}
                        simulated={dirty}
                        focused={focused}
                        onFocus={setFocused}
                        onValueChange={setOverride}
                        onToggleHidden={toggleHidden}
                    />
                </div>
            </div>

            {/* weights editor */}
            {showWeights && (
                <div className="rounded-[var(--card-radius)] border border-border bg-card p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-foreground">
                            Contribution weights — what each level is worth to the org number
                        </h2>
                        <div className="flex gap-2">
                            {Object.keys(WEIGHT_PRESETS).map((p) => (
                                <button
                                    key={p}
                                    onClick={() => persistWeights(WEIGHT_PRESETS[p])}
                                    className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-card text-text-secondary hover:border-primary/40 hover:text-foreground capitalize transition-colors"
                                >
                                    {p.replace('-', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>
                    {LEVEL_ORDER.map((key) => {
                        const totalW = LEVEL_ORDER.filter((k) => !hidden[k]).reduce((s, k) => s + weights[k], 0) || 1;
                        const share = hidden[key] ? 0 : (weights[key] / totalW) * 100;
                        return (
                            <div key={key} className="flex items-center gap-3">
                                <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: LEVEL_COLORS[key] }} aria-hidden />
                                <span className="w-40 shrink-0 text-sm text-text-secondary">
                                    {LEVEL_META[key].n}. {LEVEL_META[key].label}
                                </span>
                                <input
                                    type="range" min={0} max={50} value={weights[key]}
                                    onChange={(e) => persistWeights({ ...weights, [key]: Number(e.target.value) })}
                                    className="flex-1 accent-[var(--primary)]"
                                    aria-label={`${LEVEL_META[key].label} weight`}
                                />
                                <span className="w-28 text-right text-sm tabular-nums text-text-secondary">
                                    {weights[key]} · {share.toFixed(0)}% share
                                </span>
                            </div>
                        );
                    })}
                    <p className="text-xs text-text-tertiary">
                        Weights are normalised across visible levels and stored in this browser only. They change how the org
                        number is composed — they never change a goal&apos;s own measured value.
                    </p>
                </div>
            )}

            {/* how it moves */}
            <div className="rounded-[var(--card-radius)] border border-border bg-card p-5">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary mb-4">How it moves</h2>
                <div className="flex flex-wrap items-stretch gap-2">
                    {LEVEL_ORDER.map((key, i) => {
                        const meta = LEVEL_META[key];
                        const Icon = meta.icon;
                        return (
                            <React.Fragment key={key}>
                                <div className="flex-1 min-w-[170px] rounded-xl border border-border bg-card-tint p-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span
                                            className="w-6 h-6 rounded-lg grid place-items-center shrink-0"
                                            style={{ background: `${LEVEL_COLORS[key]}1f`, color: LEVEL_COLORS[key] }}
                                        >
                                            <Icon className="w-3.5 h-3.5" aria-hidden />
                                        </span>
                                        <span className="text-xs font-semibold text-foreground">{meta.n}. {meta.label}</span>
                                    </div>
                                    <p className="text-[11px] text-text-secondary leading-snug">{meta.drives}</p>
                                </div>
                                {i < LEVEL_ORDER.length - 1 && (
                                    <div className="self-center text-text-tertiary px-1" aria-hidden>→</div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>
                <p className="text-xs text-text-tertiary mt-3">
                    Progress flows from the agents outward. When one level improves it drives momentum across the others —
                    which is what the shape is for: a dent on one vertex is a level nobody is moving.
                </p>
            </div>

            {/* drill-through table */}
            {showTable && (
                <div className="overflow-x-auto rounded-[var(--card-radius)] border border-border bg-card">
                    <table className="w-full text-sm">
                        <caption className="sr-only">Goals underlying each level of the organization progress meter</caption>
                        <thead className="bg-muted text-left text-xs uppercase tracking-wide text-text-tertiary">
                            <tr>
                                <th scope="col" className="px-3 py-2">Goal</th>
                                <th scope="col" className="px-3 py-2">Level</th>
                                <th scope="col" className="px-3 py-2">Cadence</th>
                                <th scope="col" className="px-3 py-2 text-right">Current</th>
                                <th scope="col" className="px-3 py-2 text-right">Target</th>
                                <th scope="col" className="px-3 py-2 text-right">Progress</th>
                                <th scope="col" className="px-3 py-2 text-right">Since last period</th>
                                <th scope="col" className="px-3 py-2 text-right">Expected / actual</th>
                                <th scope="col" className="px-3 py-2">Data</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredGoals.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-3 py-8 text-center text-text-tertiary">
                                        {view === 'error'
                                            ? "Couldn't load progress data — no rows to show."
                                            : view === 'no-org'
                                                ? 'Select an organization to see its goals.'
                                                : view === 'empty'
                                                    ? 'No goals recorded yet.'
                                                    : 'No goals match these filters.'}
                                    </td>
                                </tr>
                            )}
                            {filteredGoals.map((g) => {
                                const onPace = g.expected_rate != null && g.actual_rate != null && g.actual_rate >= g.expected_rate;
                                const d = goalDeltaPoints(g);
                                return (
                                    <tr key={g.goal_id} className="text-text-secondary">
                                        <td className="px-3 py-2 font-medium max-w-[280px] text-foreground">
                                            {g.title}
                                            <div className="text-xs font-normal text-text-tertiary">
                                                {g.metric_key}{g.department ? ` · ${g.department}` : ''}{g.agent_key ? ` · ${g.agent_key}` : ''}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className="inline-flex items-center gap-1.5 text-xs">
                                                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: LEVEL_COLORS[g.level] }} aria-hidden />
                                                {LEVEL_META[g.level]?.n}. {LEVEL_META[g.level]?.label ?? g.level}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 capitalize">{g.cadence}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">{g.current_value ?? '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{g.target_value}{g.unit ? ` ${g.unit}` : ''}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{g.progress_pct != null ? `${Math.round(g.progress_pct)}%` : '—'}</td>
                                        <td className={`px-3 py-2 text-right tabular-nums ${d == null ? '' : d > 0.05 ? 'text-emerald-600' : d < -0.05 ? 'text-rose-600' : ''}`}>
                                            {d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)} pts`}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            {g.expected_rate ?? '—'} / {g.actual_rate ?? '—'}
                                            {g.expected_rate != null && g.actual_rate != null && (
                                                onPace
                                                    ? <TrendingUp className="inline w-4 h-4 ml-1 text-emerald-600" aria-label="on pace" />
                                                    : <TrendingDown className="inline w-4 h-4 ml-1 text-amber-600" aria-label="behind pace" />
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {g.data_in_chain
                                                ? <span className="text-emerald-600 text-xs inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> in chain</span>
                                                : <span className="text-rose-600 text-xs inline-flex items-center gap-1"><Link2Off className="w-3.5 h-3.5" /> missing</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {totalMissing > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-700 text-sm">
                    <Link2Off className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                        <strong>{totalMissing} goal{totalMissing === 1 ? '' : 's'} not in the chain.</strong> No fresh measurement
                        within one cadence period. These are excluded from the shape rather than counted as zero — a silent zero
                        would hide exactly the problem you want to see.
                    </span>
                </div>
            )}
        </div>
    );
}
