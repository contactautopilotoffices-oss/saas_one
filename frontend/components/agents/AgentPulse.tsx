'use client';

/**
 * AGENT PULSE — agent providence, in every module.
 * =============================================================================
 * "Hey, there is movement on the agentic employees bit."
 *
 * A slim strip that any module screen can mount to prove its agentic employees
 * are alive: who is working here, whether they are healthy, what they did today,
 * and how long ago they last moved.
 *
 * THREE RULES GOVERN THIS COMPONENT, AND THEY ARE ALL ABOUT RESTRAINT.
 *
 *  1. IT RENDERS NOTHING WHEN THE RUNTIME IS NOT PROVISIONED. Not a skeleton,
 *     not a placeholder, not an error. `provisioned: false` returns null. An
 *     unapplied migration must not put a broken strip on top of twelve module
 *     pages — that is the single fastest way to make a live product look dead.
 *
 *  2. IT IS QUIET WHEN THERE IS NOTHING TO SAY. Agents registered here but idle
 *     today collapse to ONE muted line. No empty card, no zero-state artwork.
 *     A module with no agents at all renders null: silence is the correct
 *     report when there is genuinely no agentic surface here.
 *
 *  3. IT IS CHEAP, BECAUSE MANY INSTANCES MOUNT AT ONCE. A dashboard can hold
 *     six of these. So the fetch lives in a MODULE-LEVEL STORE keyed by
 *     (orgId, module), with in-flight de-duplication, a 45s freshness window and
 *     ONE shared 60s interval per key no matter how many components subscribe.
 *     Six strips on one module = one request, one timer. Polling pauses while
 *     the tab is hidden and catches up on the way back.
 *
 * ON THE COINS DELTA. /api/agents/pulse reports a BALANCE, not a movement, so
 * the delta shown here is computed honestly across polls: the first fetch sets
 * a baseline and shows nothing, and a later fetch that finds the balance moved
 * shows the difference for ten minutes. It is "what changed while you were
 * watching", which is the only delta this endpoint can truthfully support.
 */

import React, { useCallback, useEffect, useMemo, useReducer } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bot, ChevronRight, Coins } from 'lucide-react';
import {
    AGENT_MODULE_LABELS,
    isAgentModule,
    type AgentHealthState,
    type ModuleKey,
} from '@/frontend/types/agentRuntime';

/* ========================================================================== */
/* Shape — mirrors the PulseAgent projection in app/api/agents/pulse/route.ts  */
/* ========================================================================== */

interface PulseAgent {
    agent_key: string;
    display_name: string;
    department: string | null;
    status: string;
    module: string;
    health_state: AgentHealthState;
    last_heartbeat_at: string | null;
    heartbeat_age_sec: number | null;
    /** True when the agent stopped reporting rather than reported a problem. */
    heartbeat_stale: boolean;
    last_run_at: string | null;
    last_outcome: string | null;
    last_status: string | null;
    runs_today: number;
    runs_window: number;
    failures_today: number;
    coins_balance: number;
}

interface PulseResponse {
    provisioned: boolean;
    agents?: PulseAgent[];
    runs_today?: number;
    last_activity_at?: string | null;
}

export interface AgentPulseProps {
    orgId: string | null | undefined;
    /**
     * Module slug, e.g. 'procurement'. Matches oem_agent_runs.module.
     *
     * `ModuleKey`, not `string`, and that is the whole guarantee: a strip mounted
     * with a slug nothing ever writes renders empty forever and reports no error,
     * because oem_agent_runs.module is free text with no CHECK. Typed as `string`
     * this component would only be protected where a caller happened to route
     * through a checked map (OrgAdminDashboard's AGENT_PULSE_BY_TAB); typed as
     * ModuleKey, ANY literal mount that is not in the canonical AGENT_MODULES
     * (frontend/types/agentRuntime.ts) is a compile error at the mount site.
     */
    module: ModuleKey;
    /** One line tall. The default for a module header. */
    compact?: boolean;
    className?: string;
    /**
     * Intercept the deep link instead of navigating — for a console that already
     * has the agent panel mounted and only needs to switch to it.
     */
    onOpenConsole?: (agentKey: string) => void;
    /** Tab the deep link targets. Kept a prop so this file owns no routing truth. */
    consoleTab?: string;
}

/* ========================================================================== */
/* The shared store. One fetch and one timer per (orgId, module).              */
/* ========================================================================== */

/** Poll cadence. Agent movement is interesting at this resolution, not faster. */
const POLL_MS = 60_000;
/** A payload younger than this is reused rather than refetched on mount. */
const FRESH_MS = 45_000;
/** How long an observed coin movement stays on screen. */
const DELTA_TTL_MS = 10 * 60_000;

interface Entry {
    data: PulseResponse | null;
    loaded: boolean;
    inflight: Promise<void> | null;
    fetchedAt: number;
    /** Last balance seen per agent — the baseline the delta is measured from. */
    prevCoins: Map<string, number>;
    deltas: Map<string, { delta: number; at: number }>;
    subs: Set<() => void>;
    timer: ReturnType<typeof setInterval> | null;
}

const store = new Map<string, Entry>();

function entryFor(key: string): Entry {
    let e = store.get(key);
    if (!e) {
        e = {
            data: null,
            loaded: false,
            inflight: null,
            fetchedAt: 0,
            prevCoins: new Map(),
            deltas: new Map(),
            subs: new Set(),
            timer: null,
        };
        store.set(key, e);
    }
    return e;
}

function refresh(key: string, orgId: string, module: string, force: boolean): Promise<void> {
    const e = entryFor(key);
    // De-duplication: six strips mounting in the same tick share one request.
    if (e.inflight) return e.inflight;
    if (!force && e.loaded && Date.now() - e.fetchedAt < FRESH_MS) return Promise.resolve();

    const run = async () => {
        try {
            const url =
                `/api/agents/pulse?orgId=${encodeURIComponent(orgId)}&module=${encodeURIComponent(module)}`;
            const res = await fetch(url);
            const json = (await res.json().catch(() => null)) as PulseResponse | null;

            if (res.ok && json) {
                if (json.provisioned && Array.isArray(json.agents)) {
                    const now = Date.now();
                    for (const a of json.agents) {
                        const balance = Number(a.coins_balance ?? 0);
                        const prev = e.prevCoins.get(a.agent_key);
                        if (prev !== undefined && balance !== prev) {
                            // Accumulate within the TTL so two small awards read as one
                            // movement rather than the second erasing the first.
                            const carried = e.deltas.get(a.agent_key);
                            const base = carried && now - carried.at < DELTA_TTL_MS ? carried.delta : 0;
                            e.deltas.set(a.agent_key, { delta: base + (balance - prev), at: now });
                        }
                        e.prevCoins.set(a.agent_key, balance);
                    }
                    for (const [k, d] of e.deltas) {
                        if (now - d.at > DELTA_TTL_MS) e.deltas.delete(k);
                    }
                }
                e.data = json;
            }
            // A failed poll keeps the last good payload on screen rather than
            // blanking a strip that was correct a minute ago.
        } catch {
            /* network hiccup — keep the previous payload */
        } finally {
            e.loaded = true;
            e.fetchedAt = Date.now();
            e.inflight = null;
            e.subs.forEach((fn) => fn());
        }
    };

    const p = run();
    e.inflight = p;
    return p;
}

function usePulse(orgId: string | null | undefined, module: string) {
    const key = orgId ? `${orgId}::${module}` : '';
    const [, bump] = useReducer((n: number) => n + 1, 0);

    useEffect(() => {
        if (!key || !orgId) return;
        const e = entryFor(key);
        e.subs.add(bump);

        void refresh(key, orgId, module, false);

        // ONE interval per key, however many components subscribe to it.
        if (!e.timer) {
            e.timer = setInterval(() => {
                if (typeof document !== 'undefined' && document.hidden) return;
                void refresh(key, orgId, module, true);
            }, POLL_MS);
        }

        const onVisible = () => {
            if (typeof document !== 'undefined' && !document.hidden) {
                // Not forced: the freshness window decides, so N strips returning
                // to a visible tab still cost at most one request.
                void refresh(key, orgId, module, false);
            }
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            const cur = store.get(key);
            if (!cur) return;
            cur.subs.delete(bump);
            if (cur.subs.size === 0 && cur.timer) {
                clearInterval(cur.timer);
                cur.timer = null;
            }
        };
    }, [key, orgId, module]);

    const e = key ? store.get(key) : undefined;
    return {
        loaded: e?.loaded ?? false,
        data: e?.data ?? null,
        deltas: e?.deltas ?? null,
    };
}

/* ========================================================================== */
/* Presentation helpers                                                        */
/* ========================================================================== */

function timeAgo(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return null;
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 45) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Health colour. `heartbeat_stale` is deliberately NOT folded into
 * health_state: an agent that stopped reporting looks healthy in the stored
 * column, and that is the failure mode worth drawing differently — a hollow
 * ring rather than a filled dot.
 */
const HEALTH_FILL: Record<AgentHealthState, string> = {
    up: 'bg-emerald-500',
    degraded: 'bg-amber-500',
    down: 'bg-red-500',
    unknown: 'bg-slate-300',
};

const HEALTH_WORD: Record<AgentHealthState, string> = {
    up: 'healthy',
    degraded: 'degraded',
    down: 'down',
    unknown: 'not probed yet',
};

function healthTitle(a: PulseAgent): string {
    const beat = timeAgo(a.last_heartbeat_at);
    if (a.heartbeat_stale) {
        return `${a.display_name} — stopped reporting${beat ? ` (last heartbeat ${beat})` : ''}`;
    }
    return `${a.display_name} — ${HEALTH_WORD[a.health_state] ?? 'unknown'}${beat ? ` · heartbeat ${beat}` : ''}`;
}

function HealthDot({ agent }: { agent: PulseAgent }) {
    if (agent.heartbeat_stale) {
        // Hollow amber ring: nobody said it was broken, it just went silent.
        return (
            <span
                className="inline-block h-2 w-2 rounded-full border-[1.5px] border-amber-500 bg-transparent"
                title={healthTitle(agent)}
            />
        );
    }
    return (
        <span
            className={`inline-block h-2 w-2 rounded-full ${HEALTH_FILL[agent.health_state] ?? HEALTH_FILL.unknown}`}
            title={healthTitle(agent)}
        />
    );
}

function Avatar({ agent }: { agent: PulseAgent }) {
    return (
        <span
            className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[10px] font-bold text-primary ring-1 ring-primary/15"
            title={healthTitle(agent)}
        >
            {initials(agent.display_name)}
            <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-card p-[1.5px]">
                <HealthDot agent={agent} />
            </span>
        </span>
    );
}

function moduleLabel(module: string): string {
    return isAgentModule(module) ? AGENT_MODULE_LABELS[module] : module.replace(/_/g, ' ');
}

/** The one sentence the strip exists to say. */
function headline(agents: PulseAgent[], runsToday: number, lastActivity: string | null): string {
    const active = agents.filter((a) => a.runs_today > 0);
    const ago = timeAgo(lastActivity);

    if (active.length === 1) {
        const a = active[0];
        const bits = [
            `${a.display_name} ran ${a.runs_today} time${a.runs_today === 1 ? '' : 's'} today`,
            ago ? `last ${ago}` : null,
            a.last_outcome || null,
        ].filter(Boolean);
        return bits.join(' · ');
    }

    const busiest = [...active].sort((x, y) => y.runs_today - x.runs_today)[0];
    const bits = [
        `${active.length} agents · ${runsToday} run${runsToday === 1 ? '' : 's'} today`,
        ago ? `last ${ago}` : null,
        busiest?.last_outcome || null,
    ].filter(Boolean);
    return bits.join(' · ');
}

/* ========================================================================== */
/* Component                                                                   */
/* ========================================================================== */

export default function AgentPulse({
    orgId,
    module,
    compact = true,
    className = '',
    onOpenConsole,
    consoleTab = 'agents',
}: AgentPulseProps) {
    const router = useRouter();
    const pathname = usePathname();
    const { loaded, data, deltas } = usePulse(orgId, module);

    const agents = useMemo(() => (data?.agents ?? []) as PulseAgent[], [data]);

    const openConsole = useCallback(
        (agentKey: string) => {
            if (onOpenConsole) {
                onOpenConsole(agentKey);
                return;
            }
            const base = pathname || '';
            router.push(`${base}?tab=${encodeURIComponent(consoleTab)}&agent=${encodeURIComponent(agentKey)}`);
        },
        [onOpenConsole, pathname, router, consoleTab],
    );

    // ---- Rule 1 and the silence cases. All of these render literally nothing.
    if (!orgId) return null;
    if (!loaded) return null;                 // no flash of a skeleton on every module
    if (!data || data.provisioned === false) return null;
    if (agents.length === 0) return null;     // no agent claims this module

    const runsToday = Number(data.runs_today ?? 0);
    const lastActivity = data.last_activity_at ?? null;

    // ---- Rule 2: registered but idle. One muted line, never a card.
    if (runsToday === 0) {
        const label = moduleLabel(module);
        return (
            <button
                type="button"
                onClick={() => openConsole(agents[0].agent_key)}
                className={`group flex w-full items-center gap-2 py-1 text-left text-xs text-text-tertiary transition-colors hover:text-text-secondary ${className}`}
                title={`${agents.length} agent${agents.length === 1 ? '' : 's'} assigned to ${label}`}
            >
                <Bot className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate">No agent activity in this module today</span>
                <ChevronRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
            </button>
        );
    }

    // ---- There is movement. Say so.
    const shown = [...agents].sort((a, b) => b.runs_today - a.runs_today).slice(0, 3);
    const primary = shown[0];
    const coinDelta = deltas
        ? agents.reduce((sum, a) => sum + (deltas.get(a.agent_key)?.delta ?? 0), 0)
        : 0;
    const failures = agents.reduce((n, a) => n + a.failures_today, 0);
    const attention = failures > 0 || agents.some((a) => a.health_state === 'down' || a.heartbeat_stale);

    const coinChip = coinDelta !== 0 ? (
        <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary/10 px-2 py-0.5 text-[11px] font-semibold text-secondary"
            title="Autopilot coins earned or deducted since this screen opened"
        >
            <Coins className="h-3 w-3" />
            {coinDelta > 0 ? '+' : ''}{coinDelta}
        </span>
    ) : null;

    if (compact) {
        return (
            <button
                type="button"
                onClick={() => openConsole(primary.agent_key)}
                className={`group flex w-full items-center gap-2.5 rounded-xl border border-border bg-card-tint px-3 py-1.5 text-left transition-colors hover:border-primary/30 hover:bg-card ${className}`}
                title={`Open the agent console for ${primary.display_name}`}
            >
                <span className="flex shrink-0 -space-x-1.5">
                    {shown.map((a) => (
                        <Avatar key={a.agent_key} agent={a} />
                    ))}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                    {headline(agents, runsToday, lastActivity)}
                </span>
                {attention && (
                    <span
                        className="shrink-0 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-600"
                        title={failures > 0 ? `${failures} failed run${failures === 1 ? '' : 's'} today` : 'An agent here is down or has gone quiet'}
                    >
                        {failures > 0 ? `${failures} failed` : 'needs a look'}
                    </span>
                )}
                {coinChip}
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
            </button>
        );
    }

    // ---- Expanded: same strip, then one line per agent.
    return (
        <div className={`rounded-2xl border border-border bg-card ${className}`}>
            <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
                <Bot className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                    Agentic employees · {moduleLabel(module)}
                </span>
                <span className="ml-auto text-xs text-text-secondary">
                    {runsToday} run{runsToday === 1 ? '' : 's'} today
                </span>
                {coinChip}
            </div>

            <ul className="divide-y divide-border">
                {agents.map((a) => {
                    const delta = deltas?.get(a.agent_key)?.delta ?? 0;
                    const ago = timeAgo(a.last_run_at);
                    return (
                        <li key={a.agent_key}>
                            <button
                                type="button"
                                onClick={() => openConsole(a.agent_key)}
                                className="group flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-muted/60"
                            >
                                <Avatar agent={a} />
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-baseline gap-2">
                                        <span className="truncate text-sm font-semibold text-foreground">
                                            {a.display_name}
                                        </span>
                                        <span className="shrink-0 text-[11px] text-text-tertiary">
                                            {a.runs_today > 0
                                                ? `${a.runs_today} run${a.runs_today === 1 ? '' : 's'} today`
                                                : 'idle today'}
                                            {ago ? ` · last ${ago}` : ''}
                                        </span>
                                    </span>
                                    {a.last_outcome && (
                                        <span className="mt-0.5 block truncate text-xs text-text-secondary">
                                            {a.last_outcome}
                                        </span>
                                    )}
                                </span>
                                {a.failures_today > 0 && (
                                    <span className="shrink-0 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
                                        {a.failures_today} failed
                                    </span>
                                )}
                                {delta !== 0 && (
                                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-secondary">
                                        <Coins className="h-3 w-3" />
                                        {delta > 0 ? '+' : ''}{delta}
                                    </span>
                                )}
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
