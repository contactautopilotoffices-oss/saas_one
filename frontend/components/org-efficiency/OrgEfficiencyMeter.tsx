'use client';

/**
 * ORG EFFICIENCY METER — org super admin console module.
 *
 * Four tabs:
 *   Meter         — 5-level progress (agent -> employee -> department -> tech -> org)
 *   Goal Tracker  — weekly / monthly / quarterly goals, filters, pace vs plan
 *   Task Calendar — day-by-day tasks feeding each goal, with proof status
 *   Agents        — registry, data bundles, generated prompts, council log
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
    Gauge, Target, CalendarDays, Bot, RefreshCw, AlertTriangle,
    CheckCircle2, XCircle, Link2Off, TrendingUp, TrendingDown,
} from 'lucide-react';

type Level = 'agent' | 'employee' | 'department' | 'tech' | 'org';
type Cadence = 'weekly' | 'monthly' | 'quarterly';

const LEVEL_LABELS: Record<Level, string> = {
    agent: 'Agent Level',
    employee: 'Employee Level',
    department: 'Department Level',
    tech: 'Tech Level',
    org: 'Organization Level',
};
const LEVEL_COLORS: Record<Level, string> = {
    agent: 'bg-red-500',
    employee: 'bg-amber-500',
    department: 'bg-green-500',
    tech: 'bg-cyan-500',
    org: 'bg-blue-600',
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

const TABS = [
    { key: 'meter', label: 'Meter', icon: Gauge },
    { key: 'goals', label: 'Goal Tracker', icon: Target },
    { key: 'calendar', label: 'Task Calendar', icon: CalendarDays },
    { key: 'agents', label: 'Agents & Council', icon: Bot },
] as const;

export default function OrgEfficiencyMeter() {
    const params = useParams();
    const orgId = params.orgId as string;

    const [tab, setTab] = useState<(typeof TABS)[number]['key']>('meter');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
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
                fetch(`/api/org-efficiency/meter?${qp}`),
                fetch(`/api/org-efficiency/goals?${qp}`),
                fetch(`/api/org-efficiency/tasks?orgId=${orgId}&from=${fmt(weekStart)}&to=${fmt(weekEnd)}`),
                fetch(`/api/org-efficiency/agents?orgId=${orgId}`),
            ]);

            if (meterRes.ok) setMeter(await meterRes.json());
            if (goalsRes.ok) setGoals((await goalsRes.json()).goals ?? []);
            if (tasksRes.ok) setTasks((await tasksRes.json()).tasks ?? []);
            if (agentsRes.ok) {
                const a = await agentsRes.json();
                setAgents(a.agents ?? []);
                setBundles(a.bundles ?? []);
                setCouncil(a.council_log ?? []);
            }
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [orgId, cadence, department]);

    useEffect(() => { load(); }, [load]);

    const regeneratePrompt = async (agentKey: string) => {
        await fetch('/api/org-efficiency/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'regenerate_prompt', organization_id: orgId, agent_key: agentKey }),
        });
        load();
    };

    const filteredGoals = React.useMemo(() => {
        if (!paceFilter || !meter) return goals;
        const ids = new Set(
            (paceFilter === 'completing' ? meter.completing
                : paceFilter === 'behind' ? meter.behind
                : meter.not_in_chain
            ).map((g) => g.goal_id)
        );
        return goals.filter((g) => ids.has(g.goal_id));
    }, [goals, paceFilter, meter]);

    const departments = React.useMemo(
        () => Array.from(new Set(goals.map((g) => g.department).filter(Boolean))) as string[],
        [goals]
    );

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Gauge className="w-7 h-7 text-blue-600" /> Org Efficiency Meter
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Agent → Employee → Department → Tech → Organization. Every level moves.
                    </p>
                </div>
                <button
                    onClick={load}
                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm">
                    <AlertTriangle className="w-4 h-4" /> {error}
                </div>
            )}

            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                            tab === t.key
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                        }`}
                    >
                        <t.icon className="w-4 h-4" /> {t.label}
                    </button>
                ))}
            </div>

            {tab === 'meter' && <MeterTab meter={meter} loading={loading} onDrill={(f) => { setPaceFilter(f); setTab('goals'); }} />}

            {tab === 'goals' && (
                <GoalsTab
                    goals={filteredGoals}
                    cadence={cadence} setCadence={setCadence}
                    department={department} setDepartment={setDepartment}
                    departments={departments}
                    paceFilter={paceFilter} setPaceFilter={setPaceFilter}
                />
            )}

            {tab === 'calendar' && <CalendarTab tasks={tasks} />}

            {tab === 'agents' && (
                <AgentsTab agents={agents} bundles={bundles} council={council} onRegenerate={regeneratePrompt} />
            )}
        </div>
    );
}

/* ------------------------------- METER TAB ------------------------------- */

function MeterTab({
    meter, loading, onDrill,
}: {
    meter: MeterData | null;
    loading: boolean;
    onDrill: (f: 'completing' | 'behind' | 'not_in_chain') => void;
}) {
    if (loading && !meter) return <div className="py-16 text-center text-gray-400">Loading meter…</div>;
    if (!meter || meter.counts.total_goals === 0) {
        return (
            <div className="py-16 text-center space-y-2">
                <Gauge className="w-12 h-12 mx-auto text-gray-300" />
                <p className="text-gray-500">No active goals yet. Create the first goal in the Goal Tracker tab — the meter starts moving with the first measurement.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap gap-4 items-center">
                <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-700 min-w-[180px]">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Overall Progress</div>
                    <div className="text-4xl font-bold text-blue-600">
                        {meter.overall_progress != null ? `${meter.overall_progress}%` : '—'}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{meter.counts.total_goals} active goals</div>
                </div>

                <button onClick={() => onDrill('completing')} className="p-4 rounded-xl border border-green-200 dark:border-green-900 hover:bg-green-50 dark:hover:bg-green-950 text-left">
                    <div className="flex items-center gap-2 text-green-600"><CheckCircle2 className="w-4 h-4" /><span className="text-2xl font-bold">{meter.counts.completing}</span></div>
                    <div className="text-xs text-gray-500">On expected pace</div>
                </button>
                <button onClick={() => onDrill('behind')} className="p-4 rounded-xl border border-amber-200 dark:border-amber-900 hover:bg-amber-50 dark:hover:bg-amber-950 text-left">
                    <div className="flex items-center gap-2 text-amber-600"><TrendingDown className="w-4 h-4" /><span className="text-2xl font-bold">{meter.counts.behind}</span></div>
                    <div className="text-xs text-gray-500">Behind expected pace</div>
                </button>
                <button onClick={() => onDrill('not_in_chain')} className="p-4 rounded-xl border border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950 text-left">
                    <div className="flex items-center gap-2 text-red-600"><Link2Off className="w-4 h-4" /><span className="text-2xl font-bold">{meter.counts.not_in_chain}</span></div>
                    <div className="text-xs text-gray-500">Data not in the chain</div>
                </button>
            </div>

            <div className="space-y-3">
                {meter.levels.map((l) => (
                    <div key={l.level} className="flex items-center gap-4">
                        <div className="w-44 shrink-0 text-sm font-medium">{LEVEL_LABELS[l.level]}</div>
                        <div className="flex-1 h-6 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${LEVEL_COLORS[l.level]}`}
                                style={{ width: `${l.progress_pct ?? 0}%` }}
                            />
                        </div>
                        <div className="w-24 shrink-0 text-right text-sm tabular-nums">
                            {l.progress_pct != null ? `${l.progress_pct}%` : 'no data'}
                            <span className="text-gray-400"> · {l.measured_count}/{l.goal_count}</span>
                        </div>
                    </div>
                ))}
            </div>
            <p className="text-xs text-gray-400">
                Each bar is the average progress of measured goals at that level (baseline → target). Goals without a fresh measurement are counted in &quot;Data not in the chain&quot;, never averaged in as zero.
            </p>
        </div>
    );
}

/* ------------------------------- GOALS TAB ------------------------------- */

function GoalsTab({
    goals, cadence, setCadence, department, setDepartment, departments, paceFilter, setPaceFilter,
}: {
    goals: GoalRow[];
    cadence: Cadence | ''; setCadence: (c: Cadence | '') => void;
    department: string; setDepartment: (d: string) => void;
    departments: string[];
    paceFilter: '' | 'completing' | 'behind' | 'not_in_chain';
    setPaceFilter: (f: '' | 'completing' | 'behind' | 'not_in_chain') => void;
}) {
    const selectCls = 'px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900';
    return (
        <div className="space-y-4">
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
                <select value={paceFilter} onChange={(e) => setPaceFilter(e.target.value as typeof paceFilter)} className={selectCls}>
                    <option value="">All goals</option>
                    <option value="completing">On expected pace</option>
                    <option value="behind">Behind expected pace</option>
                    <option value="not_in_chain">Data not in chain</option>
                </select>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
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
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {goals.length === 0 && (
                            <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">No goals match these filters.</td></tr>
                        )}
                        {goals.map((g) => {
                            const onPace = g.expected_rate != null && g.actual_rate != null && g.actual_rate >= g.expected_rate;
                            return (
                                <tr key={g.goal_id}>
                                    <td className="px-3 py-2 font-medium max-w-[260px]">
                                        {g.title}
                                        <div className="text-xs font-normal text-gray-400">{g.metric_key}{g.department ? ` · ${g.department}` : ''}{g.agent_key ? ` · ${g.agent_key}` : ''}</div>
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

function CalendarTab({ tasks }: { tasks: TaskRow[] }) {
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
        return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">claim only</span>;
    };

    const statusIcon = (s: string) =>
        s === 'done' ? <CheckCircle2 className="w-4 h-4 text-green-600" />
        : s === 'missed' ? <XCircle className="w-4 h-4 text-red-600" />
        : s === 'blocked' ? <AlertTriangle className="w-4 h-4 text-amber-600" />
        : <div className="w-4 h-4 rounded-full border-2 border-gray-300" />;

    if (tasks.length === 0) {
        return (
            <div className="py-16 text-center space-y-2">
                <CalendarDays className="w-12 h-12 mx-auto text-gray-300" />
                <p className="text-gray-500">No tasks scheduled in this two-week window. Tasks are created against a goal — manually now, by agents once they are live.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {byDay.map(([day, list]) => (
                <div key={day} className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 text-sm font-semibold">
                        {new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {list.map((t) => (
                            <div key={t.id} className="px-4 py-2.5 flex items-center gap-3">
                                {statusIcon(t.status)}
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{t.title}</div>
                                    <div className="text-xs text-gray-400 truncate">
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
    agents, bundles, council, onRegenerate,
}: {
    agents: AgentRow[];
    bundles: BundleRow[];
    council: CouncilRow[];
    onRegenerate: (agentKey: string) => void;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);

    return (
        <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Registered agents</h3>
                {agents.length === 0 && (
                    <p className="text-sm text-gray-400">
                        No agents registered. Register Ira, Pratiksha and future agents via the API — each gets a data bundle and a generated system prompt bound to its goals.
                    </p>
                )}
                {agents.map((a) => {
                    const bundle = bundles.find((b) => b.agent_key === a.agent_key);
                    return (
                        <div key={a.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <div className="font-semibold flex items-center gap-2">
                                        <Bot className="w-4 h-4 text-blue-600" /> {a.display_name}
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                                            a.status === 'live' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                                            : a.status === 'shadow' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                        }`}>{a.status}</span>
                                    </div>
                                    <div className="text-xs text-gray-400">{a.department ?? 'no department'} · prompt v{a.system_prompt_version}</div>
                                </div>
                                <button
                                    onClick={() => onRegenerate(a.agent_key)}
                                    className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1"
                                >
                                    <RefreshCw className="w-3 h-3" /> Regenerate prompt
                                </button>
                            </div>

                            <div className="text-xs text-gray-500">
                                <span className="font-medium">Data bundle{bundle ? ` v${bundle.version}` : ''}: </span>
                                {bundle?.bundle.tables.length
                                    ? bundle.bundle.tables.map((t) => t.name).join(', ')
                                    : 'none — agent may not read any data'}
                            </div>

                            {a.system_prompt && (
                                <button
                                    onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                                    className="text-xs text-blue-600 hover:underline"
                                >
                                    {expanded === a.id ? 'Hide' : 'Show'} generated system prompt
                                </button>
                            )}
                            {expanded === a.id && a.system_prompt && (
                                <pre className="text-xs p-3 rounded-lg bg-gray-50 dark:bg-gray-900 overflow-x-auto whitespace-pre-wrap max-h-72 overflow-y-auto">
                                    {a.system_prompt}
                                </pre>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Council log</h3>
                {council.length === 0 && <p className="text-sm text-gray-400">No council activity yet. Prompt changes, bundle changes and escalations land here.</p>}
                <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                    {council.map((c) => (
                        <div key={c.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm">
                            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
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
