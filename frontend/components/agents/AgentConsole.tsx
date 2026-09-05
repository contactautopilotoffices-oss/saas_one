'use client';

/**
 * AGENT CONSOLE
 * -----------------------------------------------------------------------------
 * The screen an org admin runs the agentic workforce from.
 *
 *   left    the roster — every agent, its heartbeat, its status, its coins,
 *           its reliability, and when it last actually did something.
 *   right   one agent in depth: Configure (the tri-view over its data bundle),
 *           Activity, Uptime, Profile, Reinforcement, Credentials.
 *
 * Above the detail pane sits DESCRIBE IT. An operator types a sentence, presses
 * Build, and /api/agents/compose returns a PROPOSAL grounded in the tables this
 * organization really has. It is rendered as an accept/discard diff against the
 * agent's current configuration and NOTHING is written until Accept is pressed
 * — an LLM's opinion about what an agent may read is a proposal, not a change.
 *
 * Four rules this file keeps:
 *   1. Nothing here 500s or looks broken on an unprovisioned database. The
 *      registry route answers 200 with provisioned:false; this renders a calm
 *      panel naming the migration.
 *   0. AND A READ THAT FAILED IS NEVER RENDERED AS AN ANSWER. /api/agents/
 *      registry distinguishes three states — table absent, read failed, read
 *      worked and found nothing — and ships that distinction in five envelopes
 *      (`registry_error`, `runs_error`, `profile_error`, `bundles_error`,
 *      `council_error`) plus nullable per-agent fields. Every one of them is
 *      consumed here: named in an amber note with a retry, and turned into "—"
 *      wherever a number would otherwise be invented. Before this, `agents ??
 *      []` printed "No agents yet" over a failed registry read and `counts ??
 *      {live: 0 …}` printed a census nobody took.
 *   2. Motion means state. The roster pulse only runs on an agent that is live
 *      AND heartbeating up; relative times tick on one shared clock.
 *   3. draft → live is not offered. An agent is promoted through shadow, where
 *      it reasons and logs but does not act. The API refuses the shortcut; the
 *      UI does not even draw the button.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Activity,
    AlertTriangle,
    BadgeCheck,
    Bot,
    ChevronDown,
    CircleDot,
    Coins,
    Gauge,
    KeyRound,
    Loader2,
    PauseCircle,
    PlayCircle,
    Plus,
    RefreshCw,
    Search,
    Sparkles,
    ThumbsUp,
    Timer,
    Wand2,
    X, Workflow, Send,PanelLeftClose,PanelLeftOpen,} from 'lucide-react';
import AgentPlanCanvas, { type AgentPlan } from '@/frontend/components/agents/AgentPlanCanvas';
import AgentDelivery from '@/frontend/components/agents/AgentDelivery';
import Hint from '@/frontend/components/agents/Hint';
import AgentPreflight from '@/frontend/components/agents/AgentPreflight';
import AgentFirstRun from '@/frontend/components/agents/AgentFirstRun';

/** What POST /api/agents/optimize returns. */
interface OptimizeResult {
    optimized: string;
    changes: string[];
    grounded_in: string[];
    module: string | null;
    rejected: string[];
    open_questions: string[];
    mocked: boolean;
    original?: string;
}
import {
    AGENT_RUNTIME_MIGRATION,
    type AgentLifecycleStatus,
    type AgentModelConfig,
    type AgentRuntimeConfig,
} from '@/frontend/types/agentRuntime';

import AgentRosterCard, {
    HEALTH_META,
    HEALTH_UNREADABLE,
    STATUS_META,
    coinsOf,
    healthOf,
    healthReadable,
    lastActiveAt,
    profileReadable,
    relativeTime,
    reliabilityOf,
    runsReadable,
    type BundleTableEntry,
    type ConsoleAgent,
} from './AgentRosterCard';
import AgentTriView, { NotProvisioned } from './AgentTriView';

// Built in parallel by the rest of the console. Imported, never stubbed.
import AgentActivity from './AgentActivity';
import AgentUptime from './AgentUptime';
import AgentProfile from './AgentProfile';
import AgentReinforcement from './AgentReinforcement';
import AgentCredentials from './AgentCredentials';

/* ==========================================================================
 * Shapes
 * ========================================================================== */

/**
 * The shared failure envelope /api/agents/registry sends beside the nulls a
 * failed read produced. Its PRESENCE is the signal: a null next to a set
 * envelope is UNKNOWN, and the same null next to a null envelope is a real
 * "none". Nothing else on this screen can tell the two apart.
 */
interface QueryFailure {
    scope: string;
    code: string | null;
    message: string;
    reason: string;
}

interface RegistryPayload {
    /** False = part of this payload is UNKNOWN. One of the envelopes says which. */
    ok?: boolean;
    /** NULL = never determined (a thrown request). Not the same as false. */
    provisioned?: boolean | null;
    runtime_provisioned?: boolean | null;
    migration?: string;
    missing?: string[];
    /** NULL = the registry read failed. `[]` would mean "this org has no agents". */
    agents?: ConsoleAgent[] | null;
    /** NULL = unknown. Zeros here would be a workforce census nobody took. */
    counts?: Record<string, number> | null;
    note?: string;
    error?: string;

    // One envelope per read the route makes. All five are consumed below.
    registry_error?: QueryFailure | null;
    runs_error?: QueryFailure | null;
    profile_error?: QueryFailure | null;
    bundles_error?: QueryFailure | null;
    council_error?: QueryFailure | null;
}

interface ComposedBundleTable {
    name: string;
    access: 'read' | 'write';
    why: string;
}

interface ComposeProposal {
    display_name: string;
    agent_key: string;
    department: string | null;
    role_description: string;
    system_prompt: string;
    suggested_bundle: { tables: ComposedBundleTable[] };
    runtime: AgentRuntimeConfig;
    model_config: AgentModelConfig;
    open_questions: string[];
    rejected_tables: string[];
    mocked: boolean;
}

interface ComposeResponse {
    provisioned?: boolean;
    migration?: string;
    proposal: ComposeProposal | null;
    grounded_in?: { table_count: number; populated_only: boolean; departments: string[] };
    stripped?: { denied: string[]; not_in_org: string[] };
    existing_agent?: { agent_key: string; display_name: string; status: string } | null;
    note?: string;
    error?: string;
}

type DetailTab = 'configure' | 'delivery' | 'activity' | 'uptime' | 'profile' | 'reinforcement' | 'credentials';

const TABS: Array<{ key: DetailTab; label: string; Icon: React.ElementType }> = [
    { key: 'configure', label: 'Configure', Icon: Wand2 },
    { key: 'delivery', label: 'Delivery', Icon: Send },
    { key: 'activity', label: 'Activity', Icon: Activity },
    { key: 'uptime', label: 'Uptime', Icon: Timer },
    { key: 'profile', label: 'Profile', Icon: Gauge },
    { key: 'reinforcement', label: 'Reinforcement', Icon: ThumbsUp },
    { key: 'credentials', label: 'Credentials', Icon: KeyRound },
];

/**
 * Mirrors app/api/agents/registry/route.ts. Kept in sync deliberately: the API
 * is the authority, this map only decides which buttons are worth drawing.
 * draft → live and retired → live are absent on purpose.
 */
const TRANSITIONS: Record<AgentLifecycleStatus, AgentLifecycleStatus[]> = {
    draft: ['shadow', 'retired'],
    shadow: ['live', 'paused', 'draft', 'retired'],
    live: ['paused', 'shadow', 'retired'],
    paused: ['live', 'shadow', 'retired'],
    retired: ['draft', 'shadow'],
};

const TRANSITION_LABEL: Record<AgentLifecycleStatus, string> = {
    draft: 'Back to draft',
    shadow: 'Move to shadow',
    live: 'Go live',
    paused: 'Pause',
    retired: 'Retire',
};

const STATUS_FILTERS: Array<AgentLifecycleStatus | 'all'> = ['all', 'live', 'shadow', 'draft', 'paused', 'retired'];

/* ==========================================================================
 * Console
 * ========================================================================== */

export interface AgentConsoleProps {
    orgId: string;
}

export default function AgentConsole({ orgId }: AgentConsoleProps) {
    const [payload, setPayload] = useState<RegistryPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [tab, setTab] = useState<DetailTab>('configure');
    const [rosterOpen, setRosterOpen] = useState(true);
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<AgentLifecycleStatus | 'all'>('all');

    /** One clock for the whole roster, so every "4m ago" ages together. */
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 20_000);
        return () => clearInterval(t);
    }, []);

    /* ---------------------------------------------------------------- load */

    const load = useCallback(
        async (silent = false) => {
            if (!orgId) return;
            if (silent) setRefreshing(true);
            else setLoading(true);
            try {
                const res = await fetch(`/api/agents/registry?orgId=${encodeURIComponent(orgId)}`, { cache: 'no-store' });
                const json = (await res.json()) as RegistryPayload;
                setPayload(json);
                setLoadError(json.error ?? null);
            } catch (e) {
                setLoadError((e as Error).message);
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [orgId],
    );

    useEffect(() => {
        void load();
    }, [load]);

    // A console that never updates itself reads as dead. Poll quietly, and only
    // while the tab is actually being looked at.
    useEffect(() => {
        const t = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') void load(true);
        }, 45_000);
        return () => clearInterval(t);
    }, [load]);

    /**
     * `agents: null` means the registry read FAILED — the table is there and the
     * query did not work. `[]` would mean this organisation has no agents, which
     * is a completely different sentence and the one the roster used to print.
     * The list below stays an array so the filters have something to iterate;
     * `registryUnreadable` is what every message on the screen branches on.
     */
    const registryUnreadable = payload ? payload.agents === null || !!payload.registry_error : false;
    const agents = useMemo(() => payload?.agents ?? [], [payload]);

    // Keep a selection alive across refreshes; pick the most interesting agent first.
    useEffect(() => {
        if (!agents.length) return;
        if (selectedKey && agents.some((a) => a.agent_key === selectedKey)) return;
        const best =
            agents.find((a) => a.status === 'live') ??
            agents.find((a) => a.status === 'shadow') ??
            agents[0];
        setSelectedKey(best.agent_key);
    }, [agents, selectedKey]);

    const selected = useMemo(
        () => agents.find((a) => a.agent_key === selectedKey) ?? null,
        [agents, selectedKey],
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return agents
            .filter((a) => (statusFilter === 'all' ? true : a.status === statusFilter))
            .filter(
                (a) =>
                    !q ||
                    a.display_name.toLowerCase().includes(q) ||
                    a.agent_key.includes(q) ||
                    (a.department ?? '').toLowerCase().includes(q),
            )
            .sort((a, b) => {
                const rank: Record<string, number> = { live: 0, shadow: 1, paused: 2, draft: 3, retired: 4 };
                const d = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
                if (d !== 0) return d;
                const la = lastActiveAt(a) ?? '';
                const lb = lastActiveAt(b) ?? '';
                if (la !== lb) return la > lb ? -1 : 1;
                return a.display_name.localeCompare(b.display_name);
            });
    }, [agents, query, statusFilter]);

    // null, not a bag of zeros: "0 live agents" is a census, and a failed read
    // did not take one.
    const counts = payload?.counts ?? null;
    const runtimeProvisioned = payload?.runtime_provisioned !== false;
    const migration = payload?.migration ?? AGENT_RUNTIME_MIGRATION;

    /**
     * The five envelopes, in the order an operator cares about them. The first
     * costs the whole screen; the rest cost part of it, and each names the part.
     * Nothing here was reaching a pixel before this wave — the route was careful
     * and the console threw the care away at the render boundary.
     */
    const readFailures: Array<{ key: string; title: string; failure: QueryFailure }> = [];
    if (payload?.registry_error) {
        readFailures.push({
            key: 'registry',
            title: 'The agent registry couldn’t be read',
            failure: payload.registry_error,
        });
    }
    if (payload?.profile_error) {
        readFailures.push({
            key: 'profile',
            title: 'Reliability, uptime and coins couldn’t be read',
            failure: payload.profile_error,
        });
    }
    if (payload?.runs_error) {
        readFailures.push({
            key: 'runs',
            title: 'The 30-day run log couldn’t be read',
            failure: payload.runs_error,
        });
    }
    if (payload?.bundles_error) {
        readFailures.push({
            key: 'bundles',
            title: 'Active data bundles couldn’t be read',
            failure: payload.bundles_error,
        });
    }
    if (payload?.council_error) {
        readFailures.push({
            key: 'council',
            title: 'Review history couldn’t be read',
            failure: payload.council_error,
        });
    }

    /* -------------------------------------------------------- compose flow */

    const [composeOpen, setComposeOpen] = useState(false);
    const [creatingNew, setCreatingNew] = useState(false);

    /* ------------------------------------------------------ status changes */

    const [statusBusy, setStatusBusy] = useState(false);
    const [statusError, setStatusError] = useState<string | null>(null);

    const changeStatus = async (next: AgentLifecycleStatus) => {
        if (!selected || statusBusy) return;
        setStatusBusy(true);
        setStatusError(null);
        try {
            const res = await fetch(`/api/agents/registry?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orgId, action: 'set_status', agent_key: selected.agent_key, status: next }),
            });
            const json = (await res.json()) as { error?: string };
            if (json.error) setStatusError(json.error);
            else await load(true);
        } catch (e) {
            setStatusError((e as Error).message);
        } finally {
            setStatusBusy(false);
        }
    };

    /* -------------------------------------------------------------- render */

    if (loading && !payload) {
        return (
            <div className="flex h-[420px] items-center justify-center rounded-[24px] border border-border bg-card">
                <span className="inline-flex items-center gap-2 text-[13px] text-text-tertiary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reading the agent registry…
                </span>
            </div>
        );
    }

    if (payload?.provisioned === false) {
        return (
            <div className="rounded-[24px] border border-border bg-card p-2">
                <NotProvisioned migration={migration} onRetry={() => void load()} />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* ================= header ================= */}
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                            <Bot className="h-4 w-4 text-primary" />
                        </span>
                        Agentic workforce
                    </h2>
                    <p className="mt-1 text-[12.5px] text-text-secondary">
                        Every agent, what it is allowed to touch, and whether it is actually alive right now.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* null value renders "—". A workforce census nobody could take
                        must not be reported as a census of zero. */}
                    <CountChip label="live" value={counts?.live ?? null} tone="emerald" />
                    <CountChip label="shadow" value={counts?.shadow ?? null} tone="primary" />
                    <CountChip label="paused" value={counts?.paused ?? null} tone="amber" />
                    <CountChip
                        label="total"
                        value={counts?.total ?? (registryUnreadable ? null : agents.length)}
                        tone="muted"
                    />
                    <button
                        type="button"
                        onClick={() => void load(true)}
                        aria-label="Refresh the registry"
                        className="rounded-lg border border-border bg-card p-2 text-text-tertiary transition-colors hover:text-foreground"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setCreatingNew(true);
                            setComposeOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12.5px] font-semibold text-text-inverse transition-colors hover:bg-primary-dark"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        New agent
                    </button>
                </div>
            </header>

            {/* runtime telemetry missing: the registry still works, say so plainly */}
            {!runtimeProvisioned && (
                <div className="rounded-[14px] border border-secondary/30 bg-secondary/5 px-4 py-2.5 text-[12px] leading-relaxed text-text-secondary">
                    Runtime telemetry is not provisioned yet — run migration{' '}
                    <span className="font-mono text-text-primary">{migration}</span>. The registry, bundles and
                    versioning below are fully live; heartbeat, activity, coins and reliability stay empty until then.
                </div>
            )}
            {/* Every read that failed, named, with what it cost and a retry.
                Amber-600 throughout: a query that did not come back says nothing
                about the agents, and colouring it red would say it did. */}
            {readFailures.map((f) => (
                <ReadFailure
                    key={f.key}
                    title={f.title}
                    reason={f.failure.reason}
                    detail={f.failure.message}
                    code={f.failure.code}
                    onRetry={() => void load(true)}
                />
            ))}

            {/* A transport-level failure (or an `error` string with no envelope
                beside it) still has to be said out loud. */}
            {loadError && readFailures.length === 0 && (
                <ReadFailure
                    title="The registry request didn’t complete"
                    reason="Nothing below was refreshed by this attempt, so anything on screen is as old as the last successful read."
                    detail={loadError}
                    onRetry={() => void load(true)}
                />
            )}

            {/* ================= body ================= */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                {/* ---------- roster ---------- */}
                <aside className={`w-full shrink-0 transition-all duration-200 ${rosterOpen ? 'lg:w-[380px]' : 'lg:w-[64px]'}`}>
                    <div className="rounded-[20px] border border-border bg-card p-3.5">
                        {/* Collapse gives the canvas room without losing the switcher. */}
                        <div className="mb-3 flex items-center justify-between gap-2">
                            {rosterOpen && (
                                <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                                    Agents
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => setRosterOpen((v) => !v)}
                                title={rosterOpen ? 'Collapse the list' : 'Expand the list'}
                                aria-label={rosterOpen ? 'Collapse the agent list' : 'Expand the agent list'}
                                className="ml-auto rounded-lg border border-border bg-card p-1.5 text-text-tertiary hover:text-foreground"
                            >
                                {rosterOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                            </button>
                        </div>

                        {!rosterOpen && (
                            <div className="flex flex-col items-center gap-2">
                                {filtered.slice(0, 8).map((a) => (
                                    <button
                                        key={a.agent_key}
                                        type="button"
                                        onClick={() => setSelectedKey(a.agent_key)}
                                        title={a.display_name}
                                        className={`flex h-9 w-9 items-center justify-center rounded-full border text-[13px] font-semibold ${
                                            a.agent_key === selectedKey
                                                ? 'border-primary/40 bg-primary/10 text-primary'
                                                : 'border-border bg-card-tint text-text-secondary hover:text-foreground'
                                        }`}
                                    >
                                        {a.display_name.slice(0, 1).toUpperCase()}
                                    </button>
                                ))}
                            </div>
                        )}

                        {rosterOpen && (<>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Find an agent"
                                aria-label="Find an agent"
                                className="w-full rounded-lg border border-border bg-card-tint py-2.5 pl-9 pr-3 text-[14px] text-foreground placeholder:text-text-tertiary focus:border-primary/40 focus:outline-none"
                            />
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {STATUS_FILTERS.map((s) => {
                                const on = statusFilter === s;
                                const n = s === 'all' ? agents.length : agents.filter((a) => a.status === s).length;
                                return (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => setStatusFilter(s)}
                                        className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium capitalize transition-colors ${
                                            on ? 'bg-primary/10 text-primary' : 'text-text-tertiary hover:text-text-secondary'
                                        }`}
                                    >
                                        {s} <span className="tabular-nums opacity-70">{n}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="mt-2.5 flex max-h-[62vh] flex-col gap-2 overflow-y-auto pr-0.5">
                            {filtered.length === 0 ? (
                                <div className="px-2 py-8 text-center">
                                    {/* "No agents yet" is a statement about the org.
                                        An empty list produced by a failed read has
                                        not earned it. */}
                                    <p className="text-[14px] font-semibold text-foreground">
                                        {registryUnreadable
                                            ? 'The roster couldn’t be read'
                                            : agents.length === 0
                                              ? 'No agents yet'
                                              : 'Nothing matches that filter'}
                                    </p>
                                    <p className="mt-1.5 text-[13px] leading-relaxed text-text-tertiary">
                                        {registryUnreadable
                                            ? 'This is not an empty workforce — the query that lists agents failed, so how many there are is unknown. See the note above.'
                                            : agents.length === 0
                                              ? 'Describe one in a sentence and the composer will draft it from this org’s real tables.'
                                              : 'Clear the search or pick another status.'}
                                    </p>
                                </div>
                            ) : (
                                filtered.map((a) => (
                                    <AgentRosterCard
                                        key={a.agent_key}
                                        agent={a}
                                        now={now}
                                        selected={a.agent_key === selectedKey && !creatingNew}
                                        onSelect={(k) => {
                                            setSelectedKey(k);
                                            setCreatingNew(false);
                                            setStatusError(null);
                                        }}
                                    />
                                ))
                            )}
                        </div>
                        </>)}
                    </div>
                </aside>

                {/* ---------- detail ---------- */}
                <section className="min-w-0 flex-1">
                    <div className="rounded-[24px] border border-border bg-card p-4 sm:p-5">
                        {creatingNew ? (
                            <NewAgentHeader onCancel={() => setCreatingNew(false)} />
                        ) : selected ? (
                            <DetailHeader
                                agent={selected}
                                now={now}
                                busy={statusBusy}
                                error={statusError}
                                onChangeStatus={changeStatus}
                            />
                        ) : registryUnreadable ? (
                            <p className="text-[13px] leading-relaxed text-text-tertiary">
                                No agent can be opened while the registry read is failing — the
                                workforce is unknown, not empty.
                            </p>
                        ) : agents.length === 0 ? (
                            <EmptyWorkforce />
                        ) : (
                            <p className="text-[13px] text-text-tertiary">Select an agent from the roster.</p>
                        )}

                        {/* ---- DESCRIBE IT ---- */}
                        <ComposeBox
                            orgId={orgId}
                            // Auto-opening because the list came back empty is right;
                            // auto-opening because the list could not be READ would
                            // invite the operator to build a duplicate of an agent
                            // that may already exist.
                            open={composeOpen || creatingNew || (agents.length === 0 && !registryUnreadable)}
                            onOpenChange={(v) => {
                                setComposeOpen(v);
                                if (!v) setCreatingNew(false);
                            }}
                            agent={creatingNew ? null : selected}
                            onApplied={async (key) => {
                                setCreatingNew(false);
                                setComposeOpen(false);
                                await load(true);
                                setSelectedKey(key);
                                setTab('configure');
                            }}
                        />

                        {/* ---- sub-tabs ---- */}
                        {!creatingNew && selected && (
                            <>
                                <nav
                                    role="tablist"
                                    aria-label="Agent detail"
                                    className="mt-5 flex gap-1 overflow-x-auto border-b border-border"
                                >
                                    {TABS.map(({ key, label, Icon }) => {
                                        const on = tab === key;
                                        return (
                                            <button
                                                key={key}
                                                role="tab"
                                                aria-selected={on}
                                                type="button"
                                                onClick={() => setTab(key)}
                                                className={`relative inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium transition-colors ${
                                                    on ? 'text-foreground' : 'text-text-tertiary hover:text-text-secondary'
                                                }`}
                                            >
                                                <Icon className="h-3.5 w-3.5" />
                                                {label}
                                                {on && (
                                                    <motion.span
                                                        layoutId="agent-tab-underline"
                                                        className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary"
                                                        transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                                                    />
                                                )}
                                            </button>
                                        );
                                    })}
                                </nav>

                                <div className="pt-4">
                                    {tab === 'configure' && (
                                        <div className="flex flex-col gap-4">
                                            <AgentPreflight orgId={orgId} agentKey={selected.agent_key} />
                                            <AgentFirstRun orgId={orgId} agentKey={selected.agent_key} />
                                            <RuntimeEnvelope agent={selected} />
                                            <AgentTriView
                                                key={selected.agent_key}
                                                orgId={orgId}
                                                agentKey={selected.agent_key}
                                                agent={selected}
                                                onSaved={() => void load(true)}
                                            />
                                        </div>
                                    )}
                                    {tab === 'delivery' && (
                                        <AgentDelivery
                                            key={selected.agent_key}
                                            orgId={orgId}
                                            agentKey={selected.agent_key}
                                            runtime={(selected.runtime ?? {}) as never}
                                            onSaved={() => void load(true)}
                                        />
                                    )}
                                    {tab === 'activity' && <AgentActivity orgId={orgId} agentKey={selected.agent_key} />}
                                    {tab === 'uptime' && <AgentUptime orgId={orgId} agentKey={selected.agent_key} />}
                                    {tab === 'profile' && <AgentProfile orgId={orgId} agentKey={selected.agent_key} />}
                                    {tab === 'reinforcement' && (
                                        <AgentReinforcement orgId={orgId} agentKey={selected.agent_key} />
                                    )}
                                    {tab === 'credentials' && (
                                        <AgentCredentials orgId={orgId} agentKey={selected.agent_key} />
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}

/* ==========================================================================
 * Header pieces
 * ========================================================================== */

/**
 * A READ THAT FAILED, said out loud, above the panel whose data is missing.
 *
 * AMBER-600, NEVER RED. Red says "this agent is broken". What happened is that a
 * query did not come back, which says nothing about the agents at all — and a
 * console that dresses the two the same teaches its operator to distrust the
 * workforce every time the database hiccups.
 *
 * Inline and persistent, not a toast: a toast is gone in four seconds while the
 * blanks and dashes it was explaining stay on screen for the rest of the shift.
 */
function ReadFailure({
    title,
    reason,
    detail,
    code,
    onRetry,
}: {
    title: string;
    reason: string;
    detail?: string | null;
    code?: string | null;
    onRetry?: () => void;
}) {
    return (
        <div
            role="status"
            className="flex items-start gap-2.5 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-2.5"
        >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
            <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-amber-700">{title}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-secondary">{reason}</p>
                {detail && (
                    <p className="mt-1 break-words font-mono text-[10.5px] leading-relaxed text-text-tertiary">
                        {code ? `${code}: ` : ''}
                        {detail}
                    </p>
                )}
                {onRetry && (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-card px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100"
                    >
                        <RefreshCw className="h-3 w-3" /> Try that read again
                    </button>
                )}
            </div>
        </div>
    );
}

/** `value: null` = the count is UNKNOWN and renders "—", never 0. */
function CountChip({ label, value, tone }: { label: string; value: number | null; tone: 'emerald' | 'primary' | 'amber' | 'muted' }) {
    const cls =
        tone === 'emerald'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : tone === 'primary'
              ? 'border-primary/25 bg-primary/10 text-primary'
              : tone === 'amber'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-border bg-muted text-text-secondary';
    return (
        <span
            title={value === null ? `The ${label} count could not be read.` : undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium ${cls}`}
        >
            <span className="tabular-nums font-semibold">{value === null ? '—' : value}</span>
            {label}
        </span>
    );
}

/** No agents at all: the composer is the whole screen, not a footnote. */
function EmptyWorkforce() {
    return (
        <div className="py-2">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-secondary" />
                No agentic employees yet
            </h3>
            <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-text-secondary">
                Hire the first one the way you would brief a person: say what the job is. The composer reads the tables
                this organization actually has, drafts an identity, a system prompt, a runtime envelope and a data
                bundle, and hands them back as a diff for you to accept. Every agent starts in draft and has to prove
                itself in shadow before it can act.
            </p>
        </div>
    );
}

function NewAgentHeader({ onCancel }: { onCancel: () => void }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div>
                <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                    <Sparkles className="h-4 w-4 text-secondary" />
                    New agentic employee
                </h3>
                <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-text-secondary">
                    Describe the job in plain English. The composer drafts identity, prompt, runtime and a data bundle
                    from the tables this organization actually has — then you accept or discard it.
                </p>
            </div>
            <button type="button" onClick={onCancel} className="rounded-md p-1 text-text-tertiary hover:text-foreground">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}

function DetailHeader({
    agent,
    now,
    busy,
    error,
    onChangeStatus,
}: {
    agent: ConsoleAgent;
    now: number;
    busy: boolean;
    error: string | null;
    onChangeStatus: (s: AgentLifecycleStatus) => void;
}) {
    const health = healthOf(agent);
    // Same rule as the roster card: a health state assembled out of a failed read
    // is not "Never probed", it is "Couldn't read", and it never gets a colour.
    const healthKnown = healthReadable(agent);
    const healthMeta = healthKnown ? HEALTH_META[health] : HEALTH_UNREADABLE;
    const statsKnown = profileReadable(agent);
    const statusMeta = STATUS_META[agent.status] ?? STATUS_META.draft;
    const rel = reliabilityOf(agent);
    const coins = coinsOf(agent);
    const active = lastActiveAt(agent);
    const allowed = TRANSITIONS[agent.status] ?? [];

    return (
        <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[16px] font-semibold tracking-tight text-foreground">{agent.display_name}</h3>
                        <span
                            title={statusMeta.hint}
                            className={`rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide ${statusMeta.className}`}
                        >
                            {statusMeta.label}
                        </span>
                        <span
                            title={healthKnown ? undefined : HEALTH_UNREADABLE.hint}
                            className={`inline-flex items-center gap-1 text-[11.5px] ${healthMeta.text}`}
                        >
                            <CircleDot className="h-3 w-3" />
                            {healthMeta.label}
                        </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-text-tertiary">
                        <span className="font-mono">{agent.agent_key}</span>
                        <span aria-hidden>·</span>
                        <span className="capitalize">{agent.department ?? 'unassigned'}</span>
                        <span aria-hidden>·</span>
                        <span>prompt v{agent.system_prompt_version ?? 0}</span>
                        <span aria-hidden>·</span>
                        <span
                            title={
                                active || runsReadable(agent)
                                    ? undefined
                                    : 'Last activity unknown — the run log could not be read.'
                            }
                        >
                            {active
                                ? `last active ${relativeTime(active, now)}`
                                : runsReadable(agent)
                                  ? 'never active'
                                  : 'last active unknown'}
                        </span>
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span
                        title={
                            coins !== null
                                ? undefined
                                : statsKnown
                                  ? 'No coins awarded yet.'
                                  : 'Coins unknown — the telemetry read failed.'
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card-tint px-2.5 py-1.5 text-[11.5px] text-text-secondary"
                    >
                        <Coins className="h-3.5 w-3.5 text-secondary" />
                        <span className="font-semibold tabular-nums text-foreground">
                            {coins !== null ? coins.toLocaleString() : '—'}
                        </span>
                        coins
                    </span>
                    <span
                        title={
                            rel !== null
                                ? `Reliability ${Math.round(rel)} of 100.`
                                : statsKnown
                                  ? 'Not measured yet — this agent has no reliability score.'
                                  : 'Reliability unknown — the telemetry read failed. Not a score of zero, and not "no data yet".'
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card-tint px-2.5 py-1.5 text-[11.5px] text-text-secondary"
                    >
                        <BadgeCheck
                            className={`h-3.5 w-3.5 ${rel !== null ? 'text-primary' : 'text-text-tertiary'}`}
                        />
                        <span className="font-semibold tabular-nums text-foreground">
                            {rel !== null ? Math.round(rel) : '—'}
                        </span>
                        reliability
                    </span>
                </div>
            </div>

            {/* lifecycle controls — only legal moves are drawn */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {allowed.map((s) => (
                    <button
                        key={s}
                        type="button"
                        disabled={busy}
                        onClick={() => onChangeStatus(s)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-50 ${
                            s === 'live'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-border bg-card text-text-secondary hover:text-foreground'
                        }`}
                    >
                        {s === 'live' ? <PlayCircle className="h-3.5 w-3.5" /> : s === 'paused' ? <PauseCircle className="h-3.5 w-3.5" /> : null}
                        {TRANSITION_LABEL[s]}
                    </button>
                ))}
                {agent.status === 'draft' && (
                    <span className="text-[11px] text-text-tertiary">
                        A <Hint text="A draft is written down but does nothing. It has never run and mails nobody.">draft</Hint> cannot go straight to <Hint text="Live means it runs on its schedule and really sends. Only promote after you have watched shadow runs.">live</Hint> — it proves itself in <Hint text="Shadow runs the whole job for real and writes a full trace, but takes no action on the business and mails nobody. It is the rehearsal.">shadow</Hint> first.
                    </span>
                )}
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />}
            </div>

            {error && (
                <p className="mt-2 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] leading-relaxed text-rose-700">
                    {error}
                </p>
            )}
        </div>
    );
}

/** The safety envelope, read-only. Changed by describing it, or in the JSON view. */
/**
 * What each envelope setting means, in a sentence, attached to the word itself.
 * These are the densest terms on the screen and the ones most likely to be set
 * wrong by someone guessing.
 */
const CHIP_HINTS: Record<string, string> = {
    schedule: 'When it runs, as cron. "0 11 * * *" is 11:00 every day. Blank means it only runs when you trigger it.',
    timezone: 'The clock the schedule is read in. Leave default for IST.',
    autonomy: 'suggest = it proposes and waits for a person. act = it writes on its own. Start on suggest.',
    heartbeat: 'How often it checks in so you can tell alive from stuck. Off means silence looks the same as healthy.',
    'quiet hours': 'A window where it will not message anyone, so a 2am run does not wake the site team.',
    'max runs/day': 'A hard stop. Protects you from a loop that would otherwise run all night.',
    'cost cap/day': 'Rupees per day of model spend. It stops at this rather than asking forgiveness.',
    timeout: 'How long one run may take before it is abandoned. Set it above the realistic worst case or you get phantom failures.',
    model: 'Which language model does the reasoning. Cheaper is fine where a mistake is caught downstream.',
    temperature: 'Higher is more varied, lower more repeatable. For anything you audit, keep it low.',
    top_p: 'Another randomness dial. Change one of temperature or top_p, not both.',
    context: 'How much it can read at once. Too small and it silently forgets the earlier part of a long document.',
};

function RuntimeEnvelope({ agent }: { agent: ConsoleAgent }) {
    const r = agent.runtime ?? {};
    const m = agent.model_config ?? {};
    const chips: Array<[string, string]> = [
        ['schedule', r.schedule_cron ?? 'none'],
        ['timezone', r.timezone ?? 'default'],
        ['autonomy', r.autonomy ?? 'suggest'],
        ['heartbeat', r.heartbeat_interval_sec ? `${r.heartbeat_interval_sec}s` : 'off'],
        ['quiet hours', r.quiet_hours?.from ? `${r.quiet_hours.from}–${r.quiet_hours.to}` : 'none'],
        ['max runs/day', r.max_runs_per_day != null ? String(r.max_runs_per_day) : '—'],
        ['cost cap/day', r.max_cost_inr_per_day != null ? `₹${r.max_cost_inr_per_day}` : '—'],
        ['timeout', r.timeout_sec ? `${r.timeout_sec}s` : '—'],
        ['model', m.model ?? 'default'],
        ['temperature', m.temperature != null ? String(m.temperature) : '—'],
        ['top_p', m.top_p != null ? String(m.top_p) : '—'],
        ['context', m.context_window ? `${m.context_window.toLocaleString()} tok` : '—'],
    ];

    return (
        <div className="rounded-[18px] border border-border bg-card-tint px-4 py-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Runtime envelope</p>
                <p className="text-[11px] text-text-tertiary">Change it by describing it above, or read it exactly in the JSON view.</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {chips.map(([k, v]) => (
                    <span key={k} className="rounded-md border border-border bg-card px-2.5 py-1 text-[12.5px] text-text-secondary">
                        {CHIP_HINTS[k] ? <Hint text={CHIP_HINTS[k]}>{k}</Hint> : k}
                        <span className="ml-1 font-mono text-text-primary">{v}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

/* ==========================================================================
 * DESCRIBE IT — compose, then accept or discard as a diff
 * ========================================================================== */

interface ApplyStep {
    label: string;
    ok: boolean;
    message: string;
}

function ComposeBox({
    orgId,
    open,
    onOpenChange,
    agent,
    onApplied,
}: {
    orgId: string;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    agent: ConsoleAgent | null;
    onApplied: (agentKey: string) => void | Promise<void>;
}) {
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ComposeResponse | null>(null);

    const [plan, setPlan] = useState<AgentPlan | null>(null);
    const [planning, setPlanning] = useState(false);

    const [optimizing, setOptimizing] = useState(false);
    const [optimized, setOptimized] = useState<OptimizeResult | null>(null);
    /** The text before the rewrite, so Undo is one click and never lossy. */
    const [preOptimize, setPreOptimize] = useState<string | null>(null);

    const [applyIdentity, setApplyIdentity] = useState(true);
    const [applyPrompt, setApplyPrompt] = useState(true);
    const [applyBundle, setApplyBundle] = useState(true);
    const [applying, setApplying] = useState(false);
    const [steps, setSteps] = useState<ApplyStep[]>([]);

    const areaRef = useRef<HTMLTextAreaElement | null>(null);

    // Switching agents invalidates a proposal built against the previous one.
    useEffect(() => {
        setResult(null);
        setSteps([]);
        setError(null);
        setPlan(null);
        setOptimized(null);
        setPreOptimize(null);
    }, [agent?.agent_key]);

    /**
     * Rewrite the operator's sentence into a structured brief, grounded in this
     * FMS's real modules and tables. Replaces the textarea, keeping the original
     * for Undo — a rewrite you cannot reverse is a rewrite you cannot trust.
     */
    const optimize = async () => {
        const raw = description.trim();
        if (optimizing || raw.length < 12) return;
        setOptimizing(true);
        setError(null);
        try {
            const res = await fetch(`/api/agents/optimize?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: raw }),
            });
            const json = (await res.json()) as OptimizeResult & { error?: string };
            if (json.error || !json.optimized) {
                setError(json.error ?? 'The optimizer returned nothing usable.');
                return;
            }
            setPreOptimize(raw);
            setDescription(json.optimized);
            setOptimized(json);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setOptimizing(false);
        }
    };

    const undoOptimize = () => {
        if (preOptimize === null) return;
        setDescription(preOptimize);
        setPreOptimize(null);
        setOptimized(null);
    };

    /**
     * Plan is deliberately SEPARATE from Build. Build answers "who is this
     * agent"; plan answers "what would it do". Plan needs no model and no
     * provisioned schema, so it works in exactly the state the console is in.
     */
    const planWorkflow = async () => {
        if (planning || description.trim().length < 12) return;
        setPlanning(true);
        setError(null);
        try {
            const res = await fetch(`/api/agents/plan?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: description.trim() }),
            });
            const json = (await res.json()) as { plan?: AgentPlan; error?: string };
            if (json.error) setError(json.error);
            setPlan(json.plan ?? null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setPlanning(false);
        }
    };

    const build = async () => {
        if (busy || description.trim().length < 12) return;
        setBusy(true);
        setError(null);
        setSteps([]);
        try {
            const res = await fetch(`/api/agents/compose?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orgId,
                    description: description.trim(),
                    ...(agent ? { agentKey: agent.agent_key } : {}),
                }),
            });
            const json = (await res.json()) as ComposeResponse;
            if (json.error) setError(json.error);
            setResult(json);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const proposal = result?.proposal ?? null;

    const accept = async () => {
        if (!proposal || applying) return;
        setApplying(true);
        const log: ApplyStep[] = [];
        const post = async (path: string, body: Record<string, unknown>) => {
            const res = await fetch(`${path}?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orgId, ...body }),
            });
            return (await res.json()) as Record<string, unknown>;
        };
        const errorOf = (r: Record<string, unknown>): string | null =>
            typeof r.error === 'string' ? r.error : null;

        try {
            if (applyIdentity) {
                const r = await post('/api/agents/registry', {
                    action: 'upsert',
                    agent_key: proposal.agent_key,
                    display_name: proposal.display_name,
                    department: proposal.department ?? undefined,
                    role_description: proposal.role_description,
                    runtime: proposal.runtime,
                    model_config: proposal.model_config,
                });
                const err = errorOf(r);
                log.push({
                    label: 'Identity + runtime',
                    ok: !err,
                    message: err ?? (r.created === true ? 'Created in draft.' : 'Updated.'),
                });
            }

            if (applyPrompt && (!log.length || log[log.length - 1].ok)) {
                const r = await post('/api/agents/registry', {
                    action: 'save_prompt',
                    agent_key: proposal.agent_key,
                    system_prompt: proposal.system_prompt,
                    note: 'Accepted from DESCRIBE IT.',
                });
                const err = errorOf(r);
                log.push({
                    label: 'System prompt',
                    ok: !err,
                    message:
                        err ??
                        (r.unchanged === true
                            ? 'Identical to the current version — no new version.'
                            : `Saved as v${String(r.version)}.`),
                });
            }

            if (applyBundle) {
                const r = await post('/api/agents/bundles', {
                    agentKey: proposal.agent_key,
                    tables: proposal.suggested_bundle.tables.map((t) => ({
                        name: t.name,
                        access: t.access,
                        purpose: t.why,
                    })),
                    notes: `Composed from: ${description.trim().slice(0, 300)}`,
                });
                const err = errorOf(r);
                log.push({
                    label: 'Data bundle',
                    ok: !err,
                    message: err ?? `Version ${String(r.version)} is now active.`,
                });
            }

            setSteps(log);
            if (log.every((s) => s.ok)) {
                setResult(null);
                setDescription('');
                await onApplied(proposal.agent_key);
            }
        } catch (e) {
            setSteps([...log, { label: 'Apply', ok: false, message: (e as Error).message }]);
        } finally {
            setApplying(false);
        }
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => {
                    onOpenChange(true);
                    setTimeout(() => areaRef.current?.focus(), 60);
                }}
                className="mt-4 flex w-full items-center gap-2 rounded-[16px] border border-dashed border-border bg-card-tint px-4 py-3 text-left transition-colors hover:border-primary/35"
            >
                <Wand2 className="h-4 w-4 shrink-0 text-secondary" />
                <span className="text-[12.5px] text-text-secondary">
                    <strong className="font-semibold text-foreground">Describe it.</strong> Say what this agent should do
                    and the composer drafts the change against this org’s real tables.
                </span>
                <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-text-tertiary" />
            </button>
        );
    }

    return (
        <div className="mt-4 rounded-[18px] border border-border bg-card-tint p-4">
            <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                    <Wand2 className="h-3.5 w-3.5 text-secondary" />
                    Describe it
                </p>
                <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="text-[11.5px] text-text-tertiary hover:text-foreground"
                >
                    Collapse
                </button>
            </div>

            <div className="relative">
            {optimizing && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[12px] border border-primary/30 bg-card/80 backdrop-blur-[2px]">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-[12px] font-medium text-text-secondary">
                        Rewriting against your modules and tables…
                    </span>
                </div>
            )}
            <textarea
                ref={areaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Every morning, look at electricity bills that have been waiting for approval for more than three days and tell the property admin which ones are stuck."
                className="mt-2 w-full resize-y rounded-[12px] border border-border bg-card px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground placeholder:text-text-tertiary focus:border-primary/40 focus:outline-none"
            />
            </div>

            {optimized && (
                <div className="mt-2 rounded-[12px] border border-primary/25 bg-primary/5 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                            Rewritten{optimized.mocked ? ' (mock — no model ran)' : ''}
                        </span>
                        <button
                            type="button"
                            onClick={undoOptimize}
                            className="text-[11.5px] text-text-tertiary underline-offset-2 hover:text-foreground hover:underline"
                        >
                            Undo
                        </button>
                    </div>
                    {optimized.changes.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-[11.5px] leading-relaxed text-text-secondary">
                            {optimized.changes.map((c, i) => <li key={i}>· {c}</li>)}
                        </ul>
                    )}
                    {optimized.grounded_in.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                            <span className="text-[10.5px] text-text-tertiary">bound to</span>
                            {optimized.grounded_in.map((t) => (
                                <span key={t} className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px]">{t}</span>
                            ))}
                            {optimized.module && (
                                <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                                    {optimized.module}
                                </span>
                            )}
                        </div>
                    )}
                    {optimized.open_questions.length > 0 && (
                        <div className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                            <ul className="space-y-0.5 text-[11px] leading-relaxed text-amber-800">
                                {optimized.open_questions.map((q, i) => <li key={i}>{q}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => void build()}
                    disabled={busy || description.trim().length < 12}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-text-inverse transition-colors hover:bg-primary-dark disabled:opacity-40"
                >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Build
                </button>
                <button
                    type="button"
                    onClick={() => void optimize()}
                    disabled={optimizing || description.trim().length < 12}
                    title="Rewrite into a structured brief using this FMS's real modules and tables"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:border-primary/40 disabled:opacity-40"
                >
                    {optimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    {optimizing ? 'Optimizing…' : 'Optimize prompt'}
                </button>
                <button
                    type="button"
                    onClick={() => void planWorkflow()}
                    disabled={planning || description.trim().length < 12}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:border-primary/40 disabled:opacity-40"
                >
                    {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Workflow className="h-3.5 w-3.5" />}
                    Plan workflow
                </button>
                <span className="text-[11px] text-text-tertiary">
                    Nothing is saved until you accept. {agent ? `Proposed against ${agent.agent_key}.` : 'A new agent starts in draft.'}
                </span>
            </div>

            {error && (
                <p className="mt-2 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</p>
            )}
            {result && result.provisioned === false && (
                <p className="mt-2 rounded-[12px] border border-border bg-card px-3 py-2 text-[11.5px] text-text-secondary">
                    {result.note ?? `Not provisioned yet — run migration ${result.migration ?? AGENT_RUNTIME_MIGRATION}.`}
                </p>
            )}

            {plan && (
                <div className="mt-4">
                    <AgentPlanCanvas plan={plan} />
                </div>
            )}

            <AnimatePresence initial={false}>
                {proposal && (
                    <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="mt-3"
                    >
                        <ProposalDiff
                            proposal={proposal}
                            response={result}
                            agent={agent}
                            applyIdentity={applyIdentity}
                            applyPrompt={applyPrompt}
                            applyBundle={applyBundle}
                            setApplyIdentity={setApplyIdentity}
                            setApplyPrompt={setApplyPrompt}
                            setApplyBundle={setApplyBundle}
                            applying={applying}
                            onAccept={() => void accept()}
                            onDiscard={() => {
                                setResult(null);
                                setSteps([]);
                            }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {steps.length > 0 && (
                <ul className="mt-3 space-y-1">
                    {steps.map((s) => (
                        <li
                            key={s.label}
                            className={`rounded-[10px] border px-3 py-1.5 text-[11.5px] ${
                                s.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
                            }`}
                        >
                            <strong className="font-semibold">{s.label}:</strong> {s.message}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/* ==========================================================================
 * The diff
 * ========================================================================== */

function ProposalDiff({
    proposal,
    response,
    agent,
    applyIdentity,
    applyPrompt,
    applyBundle,
    setApplyIdentity,
    setApplyPrompt,
    setApplyBundle,
    applying,
    onAccept,
    onDiscard,
}: {
    proposal: ComposeProposal;
    response: ComposeResponse | null;
    agent: ConsoleAgent | null;
    applyIdentity: boolean;
    applyPrompt: boolean;
    applyBundle: boolean;
    setApplyIdentity: (v: boolean) => void;
    setApplyPrompt: (v: boolean) => void;
    setApplyBundle: (v: boolean) => void;
    applying: boolean;
    onAccept: () => void;
    onDiscard: () => void;
}) {
    const [showPrompt, setShowPrompt] = useState(false);

    const currentTables: BundleTableEntry[] = agent?.active_bundle?.bundle?.tables ?? [];
    const currentByName = new Map(currentTables.map((t) => [t.name, t]));
    const nextByName = new Map(proposal.suggested_bundle.tables.map((t) => [t.name, t]));

    const added = proposal.suggested_bundle.tables.filter((t) => !currentByName.has(t.name));
    const removed = currentTables.filter((t) => !nextByName.has(t.name));
    const changed = proposal.suggested_bundle.tables.filter((t) => {
        const cur = currentByName.get(t.name);
        return cur && cur.access !== t.access;
    });

    const identityRows: Array<{ field: string; from: string; to: string }> = [
        { field: 'display_name', from: agent?.display_name ?? '—', to: proposal.display_name },
        { field: 'agent_key', from: agent?.agent_key ?? '—', to: proposal.agent_key },
        { field: 'department', from: agent?.department ?? '—', to: proposal.department ?? '—' },
        { field: 'role', from: agent?.role_description ?? '—', to: proposal.role_description },
    ].filter((r) => r.from !== r.to);

    const runtimeRows = diffRecords(
        (agent?.runtime ?? {}) as unknown as Record<string, unknown>,
        proposal.runtime as unknown as Record<string, unknown>,
    );
    const modelRows = diffRecords(
        (agent?.model_config ?? {}) as unknown as Record<string, unknown>,
        proposal.model_config as unknown as Record<string, unknown>,
    );

    return (
        <div className="rounded-[16px] border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <p className="text-[12.5px] font-semibold text-foreground">
                    Proposal
                    <span className="ml-2 font-normal text-text-tertiary">
                        {agent ? `diff against ${agent.agent_key}` : 'new agent'}
                    </span>
                </p>
                <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
                    {proposal.mocked && (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                            deterministic stub — no model key
                        </span>
                    )}
                    {response?.grounded_in && (
                        <span>grounded in {response.grounded_in.table_count} real tables</span>
                    )}
                </div>
            </div>

            <div className="space-y-3 px-4 py-3">
                {/* identity + runtime */}
                <DiffSection
                    title="Identity, runtime & model"
                    checked={applyIdentity}
                    onCheck={setApplyIdentity}
                    empty={identityRows.length + runtimeRows.length + modelRows.length === 0}
                >
                    {[...identityRows, ...runtimeRows, ...modelRows].map((r) => (
                        <div key={r.field} className="flex flex-wrap items-baseline gap-2 py-0.5 text-[11.5px]">
                            <span className="w-[130px] shrink-0 font-mono text-text-tertiary">{r.field}</span>
                            <span className="text-rose-600 line-through decoration-rose-300">{truncateText(r.from, 70)}</span>
                            <span className="text-text-tertiary">→</span>
                            <span className="font-medium text-emerald-700">{truncateText(r.to, 90)}</span>
                        </div>
                    ))}
                </DiffSection>

                {/* prompt */}
                <DiffSection
                    title={`System prompt — v${(agent?.system_prompt_version ?? 0) + 1}`}
                    checked={applyPrompt}
                    onCheck={setApplyPrompt}
                    empty={(agent?.system_prompt ?? '') === proposal.system_prompt}
                >
                    <p className="text-[11.5px] text-text-secondary">
                        {proposal.system_prompt.length.toLocaleString()} characters. The outgoing prompt is archived in the
                        council log before it is replaced, so v{agent?.system_prompt_version ?? 0} stays recoverable.
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowPrompt((v) => !v)}
                        className="mt-1 text-[11.5px] font-medium text-primary hover:underline"
                    >
                        {showPrompt ? 'Hide prompt' : 'Read the prompt'}
                    </button>
                    {showPrompt && (
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-[10px] bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed text-text-primary">
                            {proposal.system_prompt}
                        </pre>
                    )}
                </DiffSection>

                {/* bundle */}
                <DiffSection
                    title="Data bundle"
                    checked={applyBundle}
                    onCheck={setApplyBundle}
                    empty={added.length + removed.length + changed.length === 0}
                >
                    {added.map((t) => (
                        <BundleDiffRow key={`a-${t.name}`} sign="+" name={t.name} access={t.access} why={t.why} tone="add" />
                    ))}
                    {changed.map((t) => (
                        <BundleDiffRow
                            key={`c-${t.name}`}
                            sign="~"
                            name={t.name}
                            access={t.access}
                            why={`access ${currentByName.get(t.name)?.access} → ${t.access}. ${t.why}`}
                            tone="change"
                        />
                    ))}
                    {removed.map((t) => (
                        <BundleDiffRow
                            key={`r-${t.name}`}
                            sign="−"
                            name={t.name}
                            access={t.access}
                            why="Dropped from the bundle. The agent will no longer see this table."
                            tone="remove"
                        />
                    ))}
                    <p className="mt-1.5 text-[11px] text-text-tertiary">
                        Accepting creates the next bundle version. Existing versions and in-flight runs are untouched.
                    </p>
                </DiffSection>

                {/* what the model wanted but could not have */}
                {(proposal.rejected_tables.length > 0 ||
                    (response?.stripped?.denied.length ?? 0) > 0 ||
                    (response?.stripped?.not_in_org.length ?? 0) > 0) && (
                    <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800">
                        <strong className="font-semibold">Dropped before it reached you.</strong>{' '}
                        {[...proposal.rejected_tables, ...(response?.stripped?.not_in_org ?? [])].length > 0 && (
                            <>
                                Not in this organization:{' '}
                                <span className="font-mono">
                                    {Array.from(
                                        new Set([...proposal.rejected_tables, ...(response?.stripped?.not_in_org ?? [])]),
                                    ).join(', ')}
                                </span>
                                .{' '}
                            </>
                        )}
                        {(response?.stripped?.denied.length ?? 0) > 0 && (
                            <>
                                Refused by policy (credential / secret stores):{' '}
                                <span className="font-mono">{response?.stripped?.denied.join(', ')}</span>.
                            </>
                        )}
                    </div>
                )}

                {/* what the model still needs from a human */}
                {proposal.open_questions.length > 0 && (
                    <div className="rounded-[12px] border border-border bg-card-tint px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                            Open questions
                        </p>
                        <ul className="mt-1 space-y-1">
                            {proposal.open_questions.map((q) => (
                                <li key={q} className="flex gap-2 text-[11.5px] leading-relaxed text-text-secondary">
                                    <span className="text-secondary">?</span>
                                    {q}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2.5">
                <button
                    type="button"
                    onClick={onDiscard}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:text-foreground"
                >
                    Discard
                </button>
                <button
                    type="button"
                    onClick={onAccept}
                    disabled={applying || (!applyIdentity && !applyPrompt && !applyBundle)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-text-inverse transition-colors hover:bg-primary-dark disabled:opacity-40"
                >
                    {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
                    Accept selected
                </button>
            </div>
        </div>
    );
}

function DiffSection({
    title,
    checked,
    onCheck,
    empty,
    children,
}: {
    title: string;
    checked: boolean;
    onCheck: (v: boolean) => void;
    empty: boolean;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-[12px] border border-border px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={checked && !empty}
                    disabled={empty}
                    onChange={(e) => onCheck(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                />
                <span className="text-[12px] font-semibold text-foreground">{title}</span>
                {empty && <span className="text-[11px] text-text-tertiary">no change</span>}
            </label>
            {!empty && <div className="mt-1.5 pl-[22px]">{children}</div>}
        </section>
    );
}

function BundleDiffRow({
    sign,
    name,
    access,
    why,
    tone,
}: {
    sign: string;
    name: string;
    access: 'read' | 'write';
    why: string;
    tone: 'add' | 'remove' | 'change';
}) {
    const cls =
        tone === 'add' ? 'text-emerald-700' : tone === 'remove' ? 'text-rose-700' : 'text-amber-700';
    return (
        <div className="flex items-baseline gap-2 py-0.5 text-[11.5px]">
            <span className={`w-3 shrink-0 font-mono font-bold ${cls}`}>{sign}</span>
            <span className="shrink-0 font-mono font-medium text-foreground">{name}</span>
            <span
                className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold uppercase ${
                    access === 'write' ? 'bg-secondary/10 text-secondary' : 'bg-primary/10 text-primary'
                }`}
            >
                {access}
            </span>
            <span className="text-text-secondary">{why}</span>
        </div>
    );
}

/* ==========================================================================
 * Utilities
 * ========================================================================== */

function truncateText(v: string, max: number): string {
    const s = String(v ?? '');
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Field-by-field diff of two flat config records, ignoring unchanged keys. */
function diffRecords(
    current: Record<string, unknown>,
    next: Record<string, unknown>,
): Array<{ field: string; from: string; to: string }> {
    const render = (v: unknown): string => {
        if (v === undefined || v === null) return '—';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
    };
    const out: Array<{ field: string; from: string; to: string }> = [];
    for (const key of Object.keys(next)) {
        const from = render(current[key]);
        const to = render(next[key]);
        if (from !== to) out.push({ field: key, from, to });
    }
    return out;
}
