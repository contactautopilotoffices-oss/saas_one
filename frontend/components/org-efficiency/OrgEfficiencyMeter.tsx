'use client';

/**
 * ORG EFFICIENCY METER — org super admin console module.
 *
 * Four tabs:
 *   Meter         — 5-level progress (agent -> employee -> department -> tech -> org)
 *   Goal Tracker  — weekly / monthly / quarterly goals, filters, pace vs plan
 *   Task Calendar — day-by-day tasks feeding each goal, with proof status
 *   Agents        — registry, data bundles, generated prompts, council log
 *
 * A FAILED FETCH IS NOT AN EMPTY ORGANISATION.
 * Every panel here used to be loaded as `if (res.ok) setRows(...)` — a non-ok
 * response left the rows at [] and the tab then announced "No goals match these
 * filters", "No tasks scheduled in this two-week window" or "No agents
 * registered". Those sentences are claims about the organisation, and a 500 is
 * not evidence for any of them. fetch also does not throw on an HTTP error
 * status, so the surrounding try/catch never saw them.
 *
 * Each of the four sources therefore reports its own state, and every tab renders
 * exactly one of the states its sibling OrgProgressTracker uses — no organisation
 * selected / still loading / couldn't load (with the status code and a retry) /
 * loaded and genuinely empty / real rows. Nothing is invented and nothing is
 * hidden: the panel says which of those five things is true.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import OrgProgressTracker from './OrgProgressTracker';
import {
    Gauge, Target, CalendarDays, Bot, RefreshCw, AlertTriangle,
    CheckCircle2, XCircle, Link2Off, TrendingUp, TrendingDown, Building2,
} from 'lucide-react';

type Level = 'agent' | 'employee' | 'department' | 'tech' | 'org';
type Cadence = 'weekly' | 'monthly' | 'quarterly';

/**
 * LEVEL BADGE FILLS — the same five level hues as ./levelPalette.ts, one step
 * darker, because this is the only surface that puts WHITE TEXT on the fill.
 *
 * levelPalette.LEVEL_COLORS is the source of truth for the five HUE FAMILIES
 * (agent magenta, employee yellow, department aqua-green, tech orange, org blue)
 * and is imported by OrgProgressRadar and OrgProgressCard, which use them as
 * graphic fills judged at the 3:1 non-text bar. Those exact hexes are NOT reused
 * here: a text badge needs 4.5:1 against its label, and all five sit between
 * 3.08:1 and 3.94:1 on white. So the families are matched and the step is not:
 *
 *   agent  pink-700    #be185d  6.0:1     tech  orange-700  #c2410c  5.2:1
 *   empl.  amber-700   #b45309  5.0:1     org   blue-700    #1d4ed8  6.7:1
 *   dept.  emerald-700 #047857  5.5:1     (all vs white, all >= AA 4.5:1)
 *
 * This replaces a palette that disagreed on hue as well as step — `tech` was
 * cyan here and orange on the radar, so one level read as two different colours
 * across two screens. Change a hue family here only alongside ./levelPalette.ts.
 */
const LEVEL_COLORS: Record<Level, string> = {
    agent: 'bg-pink-700',
    employee: 'bg-amber-700',
    department: 'bg-emerald-700',
    tech: 'bg-orange-700',
    org: 'bg-blue-700',
};

interface GoalRow {
    goal_id: string;
    level: Level;
    title: string;
    owner_uid: string | null;
    department: string | null;
    agent_key: string | null;
    cadence: Cadence;
    metric_key: string;
    unit: string | null;
    baseline_value: number | null;
    target_value: number;
    expected_rate: number | null;
    current_value: number | null;
    progress_pct: number | null;
    actual_rate: number | null;
    last_measured_on: string | null;
    data_in_chain: boolean | null;
    status: string;
}

interface MeterData {
    overall_progress: number | null;
    levels: Array<{ level: Level; goal_count: number; measured_count: number; progress_pct: number | null }>;
    counts: { total_goals: number; completing: number; behind: number; not_in_chain: number };
    completing: GoalRow[];
    behind: GoalRow[];
    not_in_chain: GoalRow[];
}

interface TaskRow {
    id: string;
    title: string;
    scheduled_on: string;
    status: string;
    proof_type: 'system' | 'artifact' | 'claim';
    proof_ref: string | null;
    blocked_reason: string | null;
    source: string;
    goal?: { id: string; title: string; level: Level } | null;
}

interface AgentRow {
    id: string;
    agent_key: string;
    display_name: string;
    department: string | null;
    status: string;
    system_prompt: string | null;
    system_prompt_version: number;
    prompt_generated_at: string | null;
}

interface BundleRow {
    agent_key: string;
    version: number;
    bundle: { tables: Array<{ name: string; access: string; purpose?: string }> };
}

interface CouncilRow {
    id: string;
    agent_key: string | null;
    review_type: string;
    summary: string;
    decision: string;
    decided_by: string;
    created_at: string;
}

/* --------------------------- LOAD STATE, HONESTLY ------------------------- */

/** The four independent reads behind these tabs. Each succeeds or fails alone. */
type SourceKey = 'meter' | 'goals' | 'tasks' | 'agents';

/** What a panel is showing, and why. Same vocabulary as OrgProgressTracker. */
type ViewState = 'loading' | 'no-org' | 'error' | 'empty' | 'live';

interface Failure {
    /** HTTP status, or null when the request never reached the server. */
    status: number | null;
    detail: string;
}

const NO_FAILURES: Record<SourceKey, Failure | null> =
    { meter: null, goals: null, tasks: null, agents: null };

type Fetched =
    | { ok: true; status: number; json: Record<string, unknown> }
    | { ok: false; failure: Failure };

/**
 * One fetch, one verdict. res.ok is checked EXPLICITLY because fetch resolves —
 * it does not throw — for 4xx and 5xx, which is how every one of these failures
 * used to arrive as an empty array.
 */
async function fetchJson(url: string, label: string): Promise<Fetched> {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            return { ok: false, failure: { status: res.status, detail: `${label} returned ${res.status}` } };
        }
        const json = await res.json().catch(() => null);
        if (!json || typeof json !== 'object') {
            return { ok: false, failure: { status: res.status, detail: `${label} did not return a readable JSON object.` } };
        }
        return { ok: true, status: res.status, json: json as Record<string, unknown> };
    } catch (e) {
        return { ok: false, failure: { status: null, detail: (e as Error).message || `${label} did not complete.` } };
    }
}

/** A missing or malformed array is a failure, not an empty list. */
function rowsOf<T>(res: Fetched, field: string, label: string): { rows: T[]; failure: Failure | null } {
    if (!res.ok) return { rows: [], failure: res.failure };
    const v = res.json[field];
    if (!Array.isArray(v)) {
        return { rows: [], failure: { status: res.status, detail: `${label} did not include a "${field}" array.` } };
    }
    return { rows: v as T[], failure: null };
}

/** The failed-fetch panel: what broke, the status code, and a way to try again. */
function LoadFailure({ what, failure, loading, onRetry }: {
    what: string; failure: Failure | null; loading: boolean; onRetry: () => void;
}) {
    return (
        <div className="flex flex-wrap items-start gap-3 p-4 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-700 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-[240px]">
                <p className="font-semibold">Couldn&apos;t load {what}.</p>
                <p className="mt-0.5 text-rose-700/90">
                    {failure?.status != null
                        ? `The server responded with HTTP ${failure.status}.`
                        : 'The request did not reach the server.'}{' '}
                    Nothing is shown below because a failed request says nothing about your {what}.
                </p>
                {failure?.detail && (
                    <p className="mt-1 text-xs text-rose-700/70 font-mono break-all">{failure.detail}</p>
                )}
            </div>
            <button
                onClick={onRetry}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 transition-colors"
            >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Retry
            </button>
        </div>
    );
}

function NoOrgNotice({ what }: { what: string }) {
    return (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-muted border border-border text-text-secondary text-sm">
            <Building2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
                <strong className="text-foreground">Select an organization.</strong>{' '}
                {what} are read for one organization at a time, and no organization is selected.
            </span>
        </div>
    );
}

function LoadingNotice({ what }: { what: string }) {
    return (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-muted border border-border text-text-secondary text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" aria-hidden /> Loading {what}…
        </div>
    );
}

const TABS = [
    { key: 'meter', label: 'Meter', icon: Gauge },
    { key: 'goals', label: 'Goal Tracker', icon: Target },
    { key: 'calendar', label: 'Task Calendar', icon: CalendarDays },
    { key: 'agents', label: 'Agents & Council', icon: Bot },
] as const;

export default function OrgEfficiencyMeter() {
    const params = useParams();
    const orgId = (params?.orgId as string | undefined) || undefined;

    const [tab, setTab] = useState<(typeof TABS)[number]['key']>('meter');
    const [loading, setLoading] = useState(true);
    /** Why each source has no rows. null means "it answered" — not "it is empty". */
    const [failures, setFailures] = useState<Record<SourceKey, Failure | null>>(NO_FAILURES);
    /** A rejected prompt regeneration. Separate from the read failures above. */
    const [regenFailure, setRegenFailure] = useState<Failure | null>(null);

    const [meter, setMeter] = useState<MeterData | null>(null);
    const [goals, setGoals] = useState<GoalRow[]>([]);
    const [tasks, setTasks] = useState<TaskRow[]>([]);
    const [agents, setAgents] = useState<AgentRow[]>([]);
    const [bundles, setBundles] = useState<BundleRow[]>([]);
    const [council, setCouncil] = useState<CouncilRow[]>([]);

    // Filters
    const [cadence, setCadence] = useState<Cadence | ''>('');
    const [department, setDepartment] = useState('');
    const [paceFilter, setPaceFilter] = useState<'' | 'completing' | 'behind' | 'not_in_chain'>('');

    /**
     * Loads all four panels, or records exactly why each one could not be loaded.
     * A source that fails is emptied AND flagged — stale rows under a fresh error
     * banner would be just as misleading as a silent zero.
     */
    const load = useCallback(async () => {
        if (!orgId) {
            setMeter(null); setGoals([]); setTasks([]); setAgents([]); setBundles([]); setCouncil([]);
            setFailures(NO_FAILURES);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const qp = new URLSearchParams({ orgId });
            if (cadence) qp.set('cadence', cadence);
            if (department) qp.set('department', department);

            const weekStart = new Date();
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 13);
            const fmt = (d: Date) => d.toISOString().slice(0, 10);

            const [meterRes, goalsRes, tasksRes, agentsRes] = await Promise.all([
                fetchJson(`/api/org-efficiency/meter?${qp}`, 'GET /api/org-efficiency/meter'),
                fetchJson(`/api/org-efficiency/goals?${qp}`, 'GET /api/org-efficiency/goals'),
                fetchJson(
                    `/api/org-efficiency/tasks?orgId=${encodeURIComponent(orgId)}&from=${fmt(weekStart)}&to=${fmt(weekEnd)}`,
                    'GET /api/org-efficiency/tasks',
                ),
                fetchJson(`/api/org-efficiency/agents?orgId=${encodeURIComponent(orgId)}`, 'GET /api/org-efficiency/agents'),
            ]);

            const goalRows = rowsOf<GoalRow>(goalsRes, 'goals', 'GET /api/org-efficiency/goals');
            const taskRows = rowsOf<TaskRow>(tasksRes, 'tasks', 'GET /api/org-efficiency/tasks');
            const agentRows = rowsOf<AgentRow>(agentsRes, 'agents', 'GET /api/org-efficiency/agents');

            setMeter(meterRes.ok ? (meterRes.json as unknown as MeterData) : null);
            setGoals(goalRows.rows);
            setTasks(taskRows.rows);
            setAgents(agentRows.rows);
            setBundles(agentsRes.ok && Array.isArray(agentsRes.json.bundles) ? (agentsRes.json.bundles as BundleRow[]) : []);
            setCouncil(agentsRes.ok && Array.isArray(agentsRes.json.council_log) ? (agentsRes.json.council_log as CouncilRow[]) : []);
            setFailures({
                meter: meterRes.ok ? null : meterRes.failure,
                goals: goalRows.failure,
                tasks: taskRows.failure,
                agents: agentRows.failure,
            });
        } finally {
            setLoading(false);
        }
    }, [orgId, cadence, department]);

    useEffect(() => { load(); }, [load]);

    /**
     * A failed regeneration must not look like a successful one. Reloading after a
     * rejected POST would show the OLD prompt version with no explanation, which
     * reads as "nothing changed because nothing needed to".
     */
    const regeneratePrompt = async (agentKey: string) => {
        if (!orgId) return;
        setRegenFailure(null);
        try {
            const res = await fetch('/api/org-efficiency/agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'regenerate_prompt', organization_id: orgId, agent_key: agentKey }),
            });
            if (!res.ok) {
                // Do NOT reload: the prompt version on screen is still the real
                // one, and refreshing it would present a rejected write as a
                // no-op that simply changed nothing.
                setRegenFailure({
                    status: res.status,
                    detail: `POST /api/org-efficiency/agents (regenerate_prompt, ${agentKey}) returned ${res.status}`,
                });
                return;
            }
            await load();
        } catch (e) {
            setRegenFailure({ status: null, detail: (e as Error).message || 'The request did not complete.' });
        }
    };

    const paceAvailable = !!meter
        && Array.isArray(meter.completing)
        && Array.isArray(meter.behind)
        && Array.isArray(meter.not_in_chain);

    /**
     * The pace buckets are the meter's own classification. Without the meter there
     * is nothing to slice, so the filter is dropped rather than left on to match
     * zero goals — an empty table would read as "no goals are on pace".
     */
    useEffect(() => {
        if (!paceAvailable && paceFilter) setPaceFilter('');
    }, [paceAvailable, paceFilter]);

    /** What each panel is entitled to claim right now. */
    const stateFor = useCallback((key: SourceKey, count: number): ViewState => {
        if (!orgId) return 'no-org';
        if (failures[key]) return 'error';
        if (loading && count === 0) return 'loading';
        return count > 0 ? 'live' : 'empty';
    }, [orgId, failures, loading]);

    const filteredGoals = React.useMemo(() => {
        if (!paceFilter || !paceAvailable || !meter) return goals;
        const ids = new Set(
            (paceFilter === 'completing' ? meter.completing
                : paceFilter === 'behind' ? meter.behind
                : meter.not_in_chain
            ).map((g) => g.goal_id)
        );
        return goals.filter((g) => ids.has(g.goal_id));
    }, [goals, paceFilter, paceAvailable, meter]);

    const departments = React.useMemo(
        () => Array.from(new Set(goals.map((g) => g.department).filter(Boolean))) as string[],
        [goals]
    );

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Gauge className="w-7 h-7 text-primary" /> Org Efficiency Meter
                    </h1>
                    <p className="text-sm text-text-secondary dark:text-text-tertiary">
                        Agent → Employee → Department → Tech → Organization. Every level moves.
                    </p>
                </div>
                <button
                    onClick={load}
                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            <div className="flex gap-1 border-b border-border overflow-x-auto">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                            tab === t.key
                                ? 'border-primary text-primary'
                                : 'border-transparent text-text-secondary hover:text-foreground'
                        }`}
                    >
                        <t.icon className="w-4 h-4" /> {t.label}
                    </button>
                ))}
            </div>

            {tab === 'meter' && <OrgProgressTracker />}

            {tab === 'goals' && (
                <GoalsTab
                    goals={filteredGoals}
                    // The unfiltered count decides the state: a filter that matches
                    // nothing is not an organisation with no goals.
                    state={stateFor('goals', goals.length)}
                    failure={failures.goals}
                    loading={loading}
                    onRetry={load}
                    paceAvailable={paceAvailable}
                    cadence={cadence} setCadence={setCadence}
                    department={department} setDepartment={setDepartment}
                    departments={departments}
                    paceFilter={paceFilter} setPaceFilter={setPaceFilter}
                />
            )}

            {tab === 'calendar' && (
                <CalendarTab
                    tasks={tasks}
                    state={stateFor('tasks', tasks.length)}
                    failure={failures.tasks}
                    loading={loading}
                    onRetry={load}
                />
            )}

            {tab === 'agents' && (
                <AgentsTab
                    agents={agents} bundles={bundles} council={council}
                    onRegenerate={regeneratePrompt}
                    state={stateFor('agents', agents.length)}
                    failure={failures.agents}
                    regenFailure={regenFailure}
                    loading={loading}
                    onRetry={load}
                />
            )}
        </div>
    );
}

/* ------------------------------- GOALS TAB ------------------------------- */

function GoalsTab({
    goals, state, failure, loading, onRetry, paceAvailable,
    cadence, setCadence, department, setDepartment, departments, paceFilter, setPaceFilter,
}: {
    goals: GoalRow[];
    state: ViewState;
    failure: Failure | null;
    loading: boolean;
    onRetry: () => void;
    paceAvailable: boolean;
    cadence: Cadence | ''; setCadence: (c: Cadence | '') => void;
    department: string; setDepartment: (d: string) => void;
    departments: string[];
    paceFilter: '' | 'completing' | 'behind' | 'not_in_chain';
    setPaceFilter: (f: '' | 'completing' | 'behind' | 'not_in_chain') => void;
}) {
    const selectCls = 'px-3 py-2 text-sm rounded-lg border border-border bg-card';
    return (
        <div className="space-y-4">
            {state === 'error' && (
                <LoadFailure what="goals" failure={failure} loading={loading} onRetry={onRetry} />
            )}
            {state === 'no-org' && <NoOrgNotice what="Goals" />}
            {state === 'empty' && (
                <div className="flex flex-wrap items-start gap-3 p-4 rounded-lg bg-muted border border-border text-sm">
                    <Target className="w-4 h-4 mt-0.5 shrink-0 text-text-tertiary" />
                    <div className="flex-1 min-w-[240px]">
                        <p className="font-semibold text-foreground">No goals recorded yet.</p>
                        <p className="mt-0.5 text-text-secondary">
                            This organization loaded successfully and has zero goals. Add the first one and it will
                            appear here.
                        </p>
                    </div>
                </div>
            )}
            <div className="flex flex-wrap gap-2">
                <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence | '')} className={selectCls}>
                    <option value="">All cadences</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                </select>
                <select value={department} onChange={(e) => setDepartment(e.target.value)} className={selectCls}>
                    <option value="">All departments</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                {/* Pace buckets come from the meter. With no meter the filter can
                    only produce a misleadingly empty table, so it is unavailable
                    and says why. */}
                <select
                    value={paceFilter}
                    onChange={(e) => setPaceFilter(e.target.value as typeof paceFilter)}
                    disabled={!paceAvailable}
                    title={paceAvailable ? undefined : 'Pace filters need the meter, which did not load'}
                    className={`${selectCls} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                    <option value="">All goals</option>
                    <option value="completing">On expected pace</option>
                    <option value="behind">Behind expected pace</option>
                    <option value="not_in_chain">Data not in chain</option>
                </select>
                {!paceAvailable && state === 'live' && (
                    <span className="self-center text-xs text-text-tertiary">
                        Pace filters unavailable — the meter did not load.
                    </span>
                )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted text-left text-xs uppercase tracking-wide text-text-secondary">
                        <tr>
                            <th className="px-3 py-2">Goal</th>
                            <th className="px-3 py-2">Level</th>
                            <th className="px-3 py-2">Cadence</th>
                            <th className="px-3 py-2 text-right">Baseline</th>
                            <th className="px-3 py-2 text-right">Current</th>
                            <th className="px-3 py-2 text-right">Target</th>
                            <th className="px-3 py-2 text-right">Progress</th>
                            <th className="px-3 py-2 text-right">Expected / Actual rate</th>
                            <th className="px-3 py-2">Data</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {goals.length === 0 && (
                            <tr>
                                <td colSpan={9} className="px-3 py-8 text-center text-text-tertiary">
                                    {state === 'error'
                                        ? "Couldn't load goals — no rows to show."
                                        : state === 'no-org'
                                            ? 'Select an organization to see its goals.'
                                            : state === 'loading'
                                                ? 'Loading goals…'
                                                : state === 'empty'
                                                    ? 'No goals recorded yet.'
                                                    : 'No goals match these filters.'}
                                </td>
                            </tr>
                        )}
                        {goals.map((g) => {
                            const onPace = g.expected_rate != null && g.actual_rate != null && g.actual_rate >= g.expected_rate;
                            return (
                                <tr key={g.goal_id}>
                                    <td className="px-3 py-2 font-medium max-w-[260px]">
                                        {g.title}
                                        <div className="text-xs font-normal text-text-tertiary">{g.metric_key}{g.department ? ` · ${g.department}` : ''}{g.agent_key ? ` · ${g.agent_key}` : ''}</div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs text-white ${LEVEL_COLORS[g.level]}`}>{g.level}</span>
                                    </td>
                                    <td className="px-3 py-2 capitalize">{g.cadence}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{g.baseline_value ?? '—'}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{g.current_value ?? '—'}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{g.target_value}{g.unit ? ` ${g.unit}` : ''}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{g.progress_pct != null ? `${g.progress_pct}%` : '—'}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        {g.expected_rate ?? '—'} / {g.actual_rate ?? '—'}
                                        {g.expected_rate != null && g.actual_rate != null && (
                                            onPace
                                                ? <TrendingUp className="inline w-4 h-4 ml-1 text-green-600" />
                                                : <TrendingDown className="inline w-4 h-4 ml-1 text-amber-600" />
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        {g.data_in_chain
                                            ? <span className="text-green-600 text-xs flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> in chain</span>
                                            : <span className="text-red-600 text-xs flex items-center gap-1"><Link2Off className="w-3.5 h-3.5" /> missing</span>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ----------------------------- CALENDAR TAB ------------------------------ */

function CalendarTab({ tasks, state, failure, loading, onRetry }: {
    tasks: TaskRow[];
    state: ViewState;
    failure: Failure | null;
    loading: boolean;
    onRetry: () => void;
}) {
    const byDay = React.useMemo(() => {
        const m = new Map<string, TaskRow[]>();
        for (const t of tasks) {
            const list = m.get(t.scheduled_on) ?? [];
            list.push(t);
            m.set(t.scheduled_on, list);
        }
        return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [tasks]);

    const proofBadge = (t: TaskRow) => {
        if (t.proof_type === 'system') return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">system proof</span>;
        if (t.proof_type === 'artifact') return <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">artifact</span>;
        return <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-text-secondary">claim only</span>;
    };

    const statusIcon = (s: string) =>
        s === 'done' ? <CheckCircle2 className="w-4 h-4 text-green-600" />
        : s === 'missed' ? <XCircle className="w-4 h-4 text-red-600" />
        : s === 'blocked' ? <AlertTriangle className="w-4 h-4 text-amber-600" />
        : <div className="w-4 h-4 rounded-full border-2 border-border" />;

    // Order matters: the "no tasks scheduled" sentence is a claim about the
    // calendar, and only a request that actually answered earns the right to it.
    if (state === 'error') {
        return <LoadFailure what="the task calendar" failure={failure} loading={loading} onRetry={onRetry} />;
    }
    if (state === 'no-org') return <NoOrgNotice what="Tasks" />;
    if (state === 'loading') return <LoadingNotice what="tasks" />;

    if (tasks.length === 0) {
        return (
            <div className="py-16 text-center space-y-2">
                <CalendarDays className="w-12 h-12 mx-auto text-text-tertiary" />
                <p className="text-text-secondary">No tasks scheduled in this two-week window. Tasks are created against a goal — manually now, by agents once they are live.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {byDay.map(([day, list]) => (
                <div key={day} className="rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-2 bg-muted text-sm font-semibold">
                        {new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                    </div>
                    <div className="divide-y divide-border">
                        {list.map((t) => (
                            <div key={t.id} className="px-4 py-2.5 flex items-center gap-3">
                                {statusIcon(t.status)}
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{t.title}</div>
                                    <div className="text-xs text-text-tertiary truncate">
                                        {t.goal?.title ?? 'unlinked'}{t.source === 'agent' ? ' · created by agent' : ''}
                                        {t.blocked_reason ? ` · blocked: ${t.blocked_reason}` : ''}
                                    </div>
                                </div>
                                {proofBadge(t)}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ------------------------------ AGENTS TAB ------------------------------- */

function AgentsTab({
    agents, bundles, council, onRegenerate, state, failure, regenFailure, loading, onRetry,
}: {
    agents: AgentRow[];
    bundles: BundleRow[];
    council: CouncilRow[];
    onRegenerate: (agentKey: string) => void;
    state: ViewState;
    failure: Failure | null;
    regenFailure: Failure | null;
    loading: boolean;
    onRetry: () => void;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);

    // The registry and the council log come from the SAME request, so one verdict
    // covers both columns. "No agents registered" and "no council activity yet"
    // are statements about the organisation; a failed read cannot make them.
    if (state === 'error') {
        return <LoadFailure what="the agent registry" failure={failure} loading={loading} onRetry={onRetry} />;
    }
    if (state === 'no-org') return <NoOrgNotice what="Agents" />;
    if (state === 'loading') return <LoadingNotice what="agents" />;

    return (
        <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Registered agents</h3>
                {regenFailure && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-700 text-sm">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>
                            <strong>The prompt was not regenerated.</strong>{' '}
                            {regenFailure.status != null
                                ? `The server responded with HTTP ${regenFailure.status}.`
                                : 'The request did not reach the server.'}{' '}
                            The version shown below is still the old one.
                            <span className="block mt-1 text-xs text-rose-700/70 font-mono break-all">{regenFailure.detail}</span>
                        </span>
                    </div>
                )}
                {agents.length === 0 && (
                    <p className="text-sm text-text-tertiary">
                        No agents registered. Register Ira, Pratiksha and future agents via the API — each gets a data bundle and a generated system prompt bound to its goals.
                    </p>
                )}
                {agents.map((a) => {
                    const bundle = bundles.find((b) => b.agent_key === a.agent_key);
                    return (
                        <div key={a.id} className="rounded-xl border border-border p-4 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <div className="font-semibold flex items-center gap-2">
                                        <Bot className="w-4 h-4 text-primary" /> {a.display_name}
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                                            a.status === 'live' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                            : a.status === 'shadow' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                                            : 'bg-muted text-text-secondary'
                                        }`}>{a.status}</span>
                                    </div>
                                    <div className="text-xs text-text-tertiary">{a.department ?? 'no department'} · prompt v{a.system_prompt_version}</div>
                                </div>
                                <button
                                    onClick={() => onRegenerate(a.agent_key)}
                                    className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted flex items-center gap-1"
                                >
                                    <RefreshCw className="w-3 h-3" /> Regenerate prompt
                                </button>
                            </div>

                            <div className="text-xs text-text-secondary">
                                <span className="font-medium">Data bundle{bundle ? ` v${bundle.version}` : ''}: </span>
                                {bundle?.bundle.tables.length
                                    ? bundle.bundle.tables.map((t) => t.name).join(', ')
                                    : 'none — agent may not read any data'}
                            </div>

                            {a.system_prompt && (
                                <button
                                    onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                                    className="text-xs text-primary hover:underline"
                                >
                                    {expanded === a.id ? 'Hide' : 'Show'} generated system prompt
                                </button>
                            )}
                            {expanded === a.id && a.system_prompt && (
                                <pre className="text-xs p-3 rounded-lg bg-muted overflow-x-auto whitespace-pre-wrap max-h-72 overflow-y-auto">
                                    {a.system_prompt}
                                </pre>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Council log</h3>
                {council.length === 0 && <p className="text-sm text-text-tertiary">No council activity yet. Prompt changes, bundle changes and escalations land here.</p>}
                <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                    {council.map((c) => (
                        <div key={c.id} className="rounded-lg border border-border p-3 text-sm">
                            <div className="flex items-center gap-2 text-xs text-text-tertiary mb-1">
                                <span className="uppercase tracking-wide">{c.review_type.replace('_', ' ')}</span>
                                {c.agent_key && <span>· {c.agent_key}</span>}
                                <span>· {c.decided_by}</span>
                                <span className="ml-auto">{new Date(c.created_at).toLocaleString()}</span>
                            </div>
                            <div>{c.summary}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
