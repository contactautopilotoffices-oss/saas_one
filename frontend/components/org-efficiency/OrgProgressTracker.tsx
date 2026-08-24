'use client';

/**
 * ORGANIZATION PROGRESS TRACKER
 *
 * Org super admin module. Five nested dials — agent, employee, department,
 * tech, org — showing how each level adds up to the organization needle.
 *
 * Three things it does that a static chart cannot:
 *   1. Contribution weights are editable, so you can see what each level is
 *      actually worth to the org number.
 *   2. Simulate mode lets you drag any ring and watch the org needle move —
 *      turn one gear, see the train.
 *   3. Every ring drills into the goals underneath it.
 *
 * Falls back to sample data when no goals exist yet, clearly badged, so the
 * instrument is reviewable before the migrations are run.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
    Gauge, RefreshCw, AlertTriangle, SlidersHorizontal, RotateCcw,
    Eye, EyeOff, Table2, MoveHorizontal, TrendingUp, TrendingDown,
    Bot, User, Users, Cpu, Building2, CheckCircle2, Link2Off, Info,
} from 'lucide-react';
import ConcentricDial, { LEVEL_COLORS, type DialLevel } from './ConcentricDial';

type LevelKey = 'agent' | 'employee' | 'department' | 'tech' | 'org';

/** Innermost -> outermost. Order is load-bearing: the dial nests by index. */
const LEVEL_ORDER: LevelKey[] = ['agent', 'employee', 'department', 'tech', 'org'];

const LEVEL_META: Record<LevelKey, { n: number; label: string; sublabel: string; icon: React.ElementType; drives: string }> = {
    agent:      { n: 1, label: 'Agent Level',        sublabel: 'AI agents & automation execution', icon: Bot,       drives: 'Agents execute tasks with accuracy, speed & reliability' },
    employee:   { n: 2, label: 'Employee Level',     sublabel: 'Individual performance & execution', icon: User,     drives: 'Employees execute better, collaborate & stay accountable' },
    department: { n: 3, label: 'Department Level',   sublabel: 'Team delivery & performance',        icon: Users,    drives: 'Teams deliver on time & achieve department goals' },
    tech:       { n: 4, label: 'Tech Level',         sublabel: 'Systems, automation & enablement',   icon: Cpu,      drives: 'Technology enables scale, automation & efficiency' },
    org:        { n: 5, label: 'Organization Level', sublabel: 'Business impact & growth',           icon: Building2, drives: 'Business grows, impact increases, organization thrives' },
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
    target_value: number;
    current_value: number | null;
    progress_pct: number | null;
    expected_rate: number | null;
    actual_rate: number | null;
    data_in_chain: boolean | null;
}

interface LevelStat { level: LevelKey; goal_count: number; measured_count: number; progress_pct: number | null }

const SAMPLE_GOALS: GoalRow[] = [
    { goal_id: 's1', level: 'agent',      title: 'IRA — verified nudges that moved a case', department: 'procurement', agent_key: 'ira',       owner_uid: null, cadence: 'weekly',    metric_key: 'agent.intervention_effectiveness', unit: '%',     target_value: 60, current_value: 27,  progress_pct: 45, expected_rate: 6,   actual_rate: 7,    data_in_chain: true },
    { goal_id: 's2', level: 'agent',      title: 'Pratiksha — evidence extraction precision', department: 'operations', agent_key: 'pratiksha', owner_uid: null, cadence: 'weekly',    metric_key: 'agent.extraction_precision',      unit: '%',     target_value: 90, current_value: 71,  progress_pct: 44, expected_rate: 4,   actual_rate: 2,    data_in_chain: false },
    { goal_id: 's3', level: 'employee',   title: 'Priyanka — approve to PO within 6h',      department: 'procurement', agent_key: null,        owner_uid: 'u1',  cadence: 'weekly',    metric_key: 'procurement.approve_to_order_p90',unit: 'hours', target_value: 6,  current_value: 9.4, progress_pct: 58, expected_rate: 1.5, actual_rate: 1.8,  data_in_chain: true },
    { goal_id: 's4', level: 'employee',   title: 'Rahul — ticket first response under 30m', department: 'operations',  agent_key: null,        owner_uid: 'u2',  cadence: 'weekly',    metric_key: 'tickets.first_response_p90',      unit: 'mins',  target_value: 30, current_value: 41,  progress_pct: 57, expected_rate: 5,   actual_rate: 3,    data_in_chain: true },
    { goal_id: 's5', level: 'department', title: 'Procurement — 48h delivery TAT (P90)',    department: 'procurement', agent_key: null,        owner_uid: null,  cadence: 'monthly',   metric_key: 'procurement.delivery_tat_p90',    unit: 'hours', target_value: 48, current_value: 61,  progress_pct: 64, expected_rate: 4,   actual_rate: 4,    data_in_chain: true },
    { goal_id: 's6', level: 'department', title: 'Operations — SOP completion on time',     department: 'operations',  agent_key: null,        owner_uid: null,  cadence: 'monthly',   metric_key: 'sop.on_time_rate',                unit: '%',     target_value: 95, current_value: 84,  progress_pct: 60, expected_rate: 3,   actual_rate: 1,    data_in_chain: true },
    { goal_id: 's7', level: 'tech',       title: 'Evidence coverage across tracked goals',  department: 'technology',  agent_key: null,        owner_uid: null,  cadence: 'quarterly', metric_key: 'platform.evidence_coverage',      unit: '%',     target_value: 95, current_value: 72,  progress_pct: 68, expected_rate: 8,   actual_rate: 9,    data_in_chain: true },
    { goal_id: 's8', level: 'org',        title: 'Site work stoppages from material delay', department: null,          agent_key: null,        owner_uid: null,  cadence: 'quarterly', metric_key: 'org.material_stoppages',          unit: 'count', target_value: 2,  current_value: 5,   progress_pct: 72, expected_rate: 1,   actual_rate: 1,    data_in_chain: true },
];

const LS_KEY = 'oem.progress.weights.v1';

export default function OrgProgressTracker() {
    const params = useParams();
    const orgId = params?.orgId as string | undefined;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sampleMode, setSampleMode] = useState(false);

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

    const load = useCallback(async () => {
        if (!orgId) { setSampleMode(true); setGoals(SAMPLE_GOALS); setLoading(false); return; }
        setLoading(true);
        setError(null);
        try {
            const qp = new URLSearchParams({ orgId });
            if (cadence) qp.set('cadence', cadence);
            if (department) qp.set('department', department);

            const [meterRes, goalsRes] = await Promise.all([
                fetch(`/api/org-efficiency/meter?${qp}`),
                fetch(`/api/org-efficiency/goals?${qp}`),
            ]);

            const meter = meterRes.ok ? await meterRes.json() : null;
            const goalData = goalsRes.ok ? await goalsRes.json() : null;
            const rows: GoalRow[] = goalData?.goals ?? [];

            if (!rows.length) {
                setSampleMode(true);
                setGoals(SAMPLE_GOALS);
                setLevelStats([]);
            } else {
                setSampleMode(false);
                setGoals(rows);
                setLevelStats(meter?.levels ?? []);
            }
        } catch (e) {
            setError((e as Error).message);
            setSampleMode(true);
            setGoals(SAMPLE_GOALS);
        } finally {
            setLoading(false);
        }
    }, [orgId, cadence, department]);

    useEffect(() => { load(); }, [load]);

    const filteredGoals = useMemo(() => {
        return goals.filter((g) => {
            if (levelFilter && g.level !== levelFilter) return false;
            if (sampleMode && department && g.department !== department) return false;
            if (sampleMode && cadence && g.cadence !== cadence) return false;
            if (actorFilter && g.agent_key !== actorFilter && g.owner_uid !== actorFilter) return false;
            return true;
        });
    }, [goals, levelFilter, actorFilter, sampleMode, department, cadence]);

    /** Per-level progress: mean of measured goals. Unmeasured never counts as zero. */
    const levelValues = useMemo(() => {
        const out = {} as Record<LevelKey, { value: number | null; total: number; measured: number; missing: number }>;
        for (const key of LEVEL_ORDER) {
            const stat = levelStats.find((s) => s.level === key);
            const rows = filteredGoals.filter((g) => g.level === key);
            const measured = rows.filter((g) => g.progress_pct != null);
            const fromStat = !sampleMode && !levelFilter && !actorFilter && stat ? stat.progress_pct : null;
            const computed = measured.length
                ? measured.reduce((s, g) => s + (g.progress_pct ?? 0), 0) / measured.length
                : null;
            out[key] = {
                value: overrides[key] ?? fromStat ?? computed ?? (sampleMode && !rows.length ? null : null),
                total: stat && !sampleMode ? stat.goal_count : rows.length,
                measured: measured.length,
                missing: rows.filter((g) => !g.data_in_chain).length,
            };
        }
        return out;
    }, [filteredGoals, levelStats, overrides, sampleMode, levelFilter, actorFilter]);

    const dialLevels: DialLevel[] = useMemo(
        () =>
            LEVEL_ORDER.map((key) => ({
                key,
                label: LEVEL_META[key].label,
                sublabel: LEVEL_META[key].sublabel,
                value: levelValues[key].value ?? 0,
                weight: weights[key],
                visible: !hidden[key] && levelValues[key].value != null,
            })),
        [levelValues, weights, hidden]
    );

    /** Weighted contribution of every visible, measured level. */
    const { overall, contributions } = useMemo(() => {
        const active = LEVEL_ORDER.filter((k) => !hidden[k] && levelValues[k].value != null);
        const totalW = active.reduce((s, k) => s + (weights[k] || 0), 0);
        if (!active.length || totalW === 0) return { overall: null as number | null, contributions: {} as Record<string, number> };
        const contrib: Record<string, number> = {};
        let sum = 0;
        for (const k of active) {
            const share = (weights[k] || 0) / totalW;
            const c = (levelValues[k].value ?? 0) * share;
            contrib[k] = c;
            sum += c;
        }
        return { overall: sum, contributions: contrib };
    }, [levelValues, weights, hidden]);

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

    const setOverride = (key: string, value: number) =>
        setOverrides((o) => ({ ...o, [key as LevelKey]: Math.max(0, Math.min(100, Math.round(value))) }));

    const selectCls =
        'px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

    return (
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5">
            {/* header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-gray-50">
                        <Gauge className="w-7 h-7 text-blue-600" /> Organization Progress Meter
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Every level moves. Together we grow.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {sampleMode && (
                        <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                            <Info className="w-3.5 h-3.5" /> Sample data — no goals recorded yet
                        </span>
                    )}
                    <button
                        onClick={() => setShowWeights((v) => !v)}
                        className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
                            showWeights
                                ? 'border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950'
                                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200'
                        }`}
                    >
                        <SlidersHorizontal className="w-4 h-4" /> Weights
                    </button>
                    <button
                        onClick={() => setSimulate((v) => !v)}
                        className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
                            simulate
                                ? 'border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950'
                                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200'
                        }`}
                    >
                        <MoveHorizontal className="w-4 h-4" /> Simulate
                    </button>
                    <button
                        onClick={load}
                        className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm">
                    <AlertTriangle className="w-4 h-4" /> {error}
                </div>
            )}

            {/* filters — one row above the chart */}
            <div className="flex flex-wrap gap-2 items-center">
                <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as LevelKey | '')} className={selectCls}>
                    <option value="">All levels</option>
                    {LEVEL_ORDER.map((k) => <option key={k} value={k}>{LEVEL_META[k].label}</option>)}
                </select>
                <select value={department} onChange={(e) => setDepartment(e.target.value)} className={selectCls}>
                    <option value="">All departments</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={selectCls}>
                    <option value="">All cadences</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                </select>
                <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} className={selectCls}>
                    <option value="">All agents</option>
                    {actors.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <button
                    onClick={() => setShowTable((v) => !v)}
                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                >
                    <Table2 className="w-4 h-4" /> {showTable ? 'Hide' : 'Table'} view
                </button>
                {dirty && (
                    <button
                        onClick={() => setOverrides({})}
                        className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300"
                    >
                        <RotateCcw className="w-4 h-4" /> Reset simulation
                    </button>
                )}
            </div>

            {/* instrument */}
            <div className="rounded-2xl overflow-hidden border border-gray-800 bg-[#0e1014]">
                <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        LIVE · {new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {dirty && <span className="ml-2 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">simulated</span>}
                    </div>
                    <div className="text-right">
                        <div className="text-[11px] uppercase tracking-widest text-gray-400">Overall progress</div>
                        <div className="text-5xl font-bold tabular-nums text-white leading-tight">
                            {overall != null ? `${Math.round(overall)}%` : '—'}
                        </div>
                        <div className="text-xs text-gray-400">
                            weighted across {LEVEL_ORDER.filter((k) => !hidden[k] && levelValues[k].value != null).length} levels
                        </div>
                    </div>
                </div>

                <div className="px-2 pb-2">
                    <ConcentricDial
                        levels={dialLevels}
                        overall={overall}
                        simulate={simulate}
                        focused={focused}
                        onFocus={setFocused}
                        onValueChange={setOverride}
                    />
                </div>

                {simulate && (
                    <div className="px-5 pb-4 text-xs text-gray-400 flex items-center gap-2">
                        <MoveHorizontal className="w-3.5 h-3.5" />
                        Drag any ring to see how that level moves the organization needle. Nothing is saved.
                    </div>
                )}

                {/* legend — identity is never colour alone */}
                <div className="border-t border-gray-800 px-5 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {LEVEL_ORDER.map((key) => {
                        const meta = LEVEL_META[key];
                        const v = levelValues[key];
                        const Icon = meta.icon;
                        const off = hidden[key];
                        return (
                            <button
                                key={key}
                                onClick={() => setHidden((h) => ({ ...h, [key]: !h[key] }))}
                                onMouseEnter={() => setFocused(key)}
                                onMouseLeave={() => setFocused(null)}
                                className={`text-left rounded-xl border p-3 transition-all ${
                                    off ? 'border-gray-800 opacity-40' : 'border-gray-700 hover:border-gray-500'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: LEVEL_COLORS[key] }} />
                                    <Icon className="w-4 h-4 text-gray-300 shrink-0" />
                                    <span className="text-xs font-semibold text-gray-100 truncate">{meta.n}. {meta.label}</span>
                                    {off ? <EyeOff className="w-3.5 h-3.5 ml-auto text-gray-500" /> : <Eye className="w-3.5 h-3.5 ml-auto text-gray-600" />}
                                </div>
                                <div className="mt-2 flex items-baseline gap-2">
                                    <span className="text-2xl font-bold tabular-nums text-white">
                                        {v.value != null ? `${Math.round(v.value)}%` : '—'}
                                    </span>
                                    {contributions[key] != null && !off && (
                                        <span className="text-[11px] text-gray-400">
                                            +{contributions[key].toFixed(1)} to org
                                        </span>
                                    )}
                                </div>
                                <div className="text-[11px] text-gray-500 mt-1">
                                    {v.measured}/{v.total} measured
                                    {v.missing > 0 && <span className="text-red-400"> · {v.missing} missing</span>}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* weights editor */}
            {showWeights && (
                <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            Contribution weights — what each level is worth to the org number
                        </h2>
                        <div className="flex gap-2">
                            {Object.keys(WEIGHT_PRESETS).map((p) => (
                                <button
                                    key={p}
                                    onClick={() => persistWeights(WEIGHT_PRESETS[p])}
                                    className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 capitalize text-gray-700 dark:text-gray-200"
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
                                <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: LEVEL_COLORS[key] }} />
                                <span className="w-40 shrink-0 text-sm text-gray-700 dark:text-gray-200">{LEVEL_META[key].label}</span>
                                <input
                                    type="range" min={0} max={50} value={weights[key]}
                                    onChange={(e) => persistWeights({ ...weights, [key]: Number(e.target.value) })}
                                    className="flex-1 accent-blue-600"
                                    aria-label={`${LEVEL_META[key].label} weight`}
                                />
                                <span className="w-28 text-right text-sm tabular-nums text-gray-600 dark:text-gray-300">
                                    {weights[key]} · {share.toFixed(0)}% share
                                </span>
                            </div>
                        );
                    })}
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Weights are normalised across visible levels and stored in this browser only. They change how the org
                        needle is composed — they never change a goal&apos;s own measured value.
                    </p>
                </div>
            )}

            {/* how it moves */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">How it moves</h2>
                <div className="flex flex-wrap items-stretch gap-2">
                    {LEVEL_ORDER.map((key, i) => {
                        const meta = LEVEL_META[key];
                        const Icon = meta.icon;
                        return (
                            <React.Fragment key={key}>
                                <div className="flex-1 min-w-[170px] rounded-xl border border-gray-100 dark:border-gray-800 p-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Icon className="w-4 h-4 shrink-0" style={{ color: LEVEL_COLORS[key] }} />
                                        <span className="text-xs font-semibold" style={{ color: LEVEL_COLORS[key] }}>{meta.label}</span>
                                    </div>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{meta.drives}</p>
                                </div>
                                {i < LEVEL_ORDER.length - 1 && (
                                    <div className="self-center text-gray-300 dark:text-gray-600 px-1">→</div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                    Progress flows from the inside out. When one level improves it drives momentum across the others.
                </p>
            </div>

            {/* drill-through table */}
            {showTable && (
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-sm">
                        <caption className="sr-only">Goals underlying each level of the organization progress meter</caption>
                        <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                                <th scope="col" className="px-3 py-2">Goal</th>
                                <th scope="col" className="px-3 py-2">Level</th>
                                <th scope="col" className="px-3 py-2">Cadence</th>
                                <th scope="col" className="px-3 py-2 text-right">Current</th>
                                <th scope="col" className="px-3 py-2 text-right">Target</th>
                                <th scope="col" className="px-3 py-2 text-right">Progress</th>
                                <th scope="col" className="px-3 py-2 text-right">Expected / actual</th>
                                <th scope="col" className="px-3 py-2">Data</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {filteredGoals.length === 0 && (
                                <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No goals match these filters.</td></tr>
                            )}
                            {filteredGoals.map((g) => {
                                const onPace = g.expected_rate != null && g.actual_rate != null && g.actual_rate >= g.expected_rate;
                                return (
                                    <tr key={g.goal_id} className="text-gray-800 dark:text-gray-200">
                                        <td className="px-3 py-2 font-medium max-w-[280px]">
                                            {g.title}
                                            <div className="text-xs font-normal text-gray-400">
                                                {g.metric_key}{g.department ? ` · ${g.department}` : ''}{g.agent_key ? ` · ${g.agent_key}` : ''}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className="inline-flex items-center gap-1.5 text-xs">
                                                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: LEVEL_COLORS[g.level] }} />
                                                {LEVEL_META[g.level]?.label ?? g.level}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 capitalize">{g.cadence}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{g.current_value ?? '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{g.target_value}{g.unit ? ` ${g.unit}` : ''}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{g.progress_pct != null ? `${g.progress_pct}%` : '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            {g.expected_rate ?? '—'} / {g.actual_rate ?? '—'}
                                            {g.expected_rate != null && g.actual_rate != null && (
                                                onPace
                                                    ? <TrendingUp className="inline w-4 h-4 ml-1 text-green-600" aria-label="on pace" />
                                                    : <TrendingDown className="inline w-4 h-4 ml-1 text-amber-600" aria-label="behind pace" />
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {g.data_in_chain
                                                ? <span className="text-green-600 text-xs inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> in chain</span>
                                                : <span className="text-red-600 text-xs inline-flex items-center gap-1"><Link2Off className="w-3.5 h-3.5" /> missing</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {totalMissing > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm">
                    <Link2Off className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                        <strong>{totalMissing} goal{totalMissing === 1 ? '' : 's'} not in the chain.</strong> No fresh measurement
                        within one cadence period. These are excluded from the dial rather than counted as zero — a silent zero
                        would hide exactly the problem you want to see.
                    </span>
                </div>
            )}
        </div>
    );
}
