'use client';

/**
 * AGENT ROSTER CARD
 * -----------------------------------------------------------------------------
 * One agentic employee, as it appears in the workforce list.
 *
 * The card answers four questions without a click:
 *   is it alive        — health dot (up / degraded / down / unknown)
 *   is it allowed out  — status pill (draft / shadow / live / paused / retired)
 *   is it any good     — reliability meter + coins balance
 *   is it working now  — relative "last active", ticking on a real clock
 *
 * MOTION RULE: the pulse ring renders ONLY for an agent that is both `live` and
 * heartbeating `up`, AND whose heartbeat was actually read. A paused, drafted,
 * down or unreadable agent is deliberately still — decoration that implies
 * liveness on a dead agent is worse than no motion at all, because it is a lie
 * the operator will act on.
 *
 * READ RULE: an agent whose stats could not be READ never shows a confident
 * number or a coloured dot. /api/agents/registry nulls every field a failed
 * secondary read fed and says so in `runs_error` / `profile_error`; this card
 * turns those nulls into "—" and a neutral dot with the reason on hover. The
 * distinction it is protecting is small and load-bearing:
 *
 *     "no data"   nothing has been recorded. A real answer about the agent.
 *     "—"         we could not look. No answer at all, about anything.
 *
 * Printing the first when the second is true is the quietest way a console
 * lies, because it looks like a finished thought.
 *
 * This file also owns the shared console types and the relative-time helper, so
 * AgentConsole and AgentTriView agree on one shape.
 */

import React, { memo } from 'react';
import AgentAvatar from './AgentAvatar';
import { motion, useReducedMotion } from 'framer-motion';
import { Coins, Activity, AlertTriangle } from 'lucide-react';
import type {
    AgentHealthState,
    AgentLifecycleStatus,
    AgentModelConfig,
    AgentRuntimeConfig,
    OemAgentProfile,
} from '@/frontend/types/agentRuntime';
import { reliabilityBand, type ReliabilityBand } from '@/backend/lib/agents/reliability';

/* ==========================================================================
 * Shared shapes — what /api/agents/registry returns, as the console reads it.
 *
 * Everything the runtime migration adds is OPTIONAL here on purpose: before
 * 20260830000001 is applied those columns simply are not in the payload, and
 * the console has to render anyway.
 * ========================================================================== */

export interface BundleTableEntry {
    name: string;
    access: 'read' | 'write';
    /** Set by the composer. */
    why?: string;
    /** Set by the catalogue when a human added the table. */
    purpose?: string;
    columns?: string[];
}

export interface ActiveBundle {
    id?: string;
    agent_key?: string;
    version: number;
    is_active?: boolean;
    bundle: { tables?: BundleTableEntry[]; notes?: string } | null;
    notes?: string | null;
    created_at?: string;
}

export interface CouncilLogEntry {
    id: string;
    agent_key: string | null;
    review_type: string;
    summary: string;
    decision: string | null;
    decided_by: string | null;
    created_at: string;
}

export interface ConsoleAgent {
    id: string;
    agent_key: string;
    display_name: string;
    department: string | null;
    role_description: string | null;
    status: AgentLifecycleStatus;
    system_prompt: string | null;
    system_prompt_version: number | null;
    prompt_generated_at: string | null;
    config: Record<string, unknown> | null;
    created_at?: string | null;
    updated_at?: string | null;

    // --- arrives with 20260830000001_agent_runtime
    health_state?: AgentHealthState | null;
    last_heartbeat_at?: string | null;
    reliability_score?: number | null;
    coins_balance?: number | null;
    runtime?: AgentRuntimeConfig | null;
    model_config?: AgentModelConfig | null;

    // --- joined by the registry route
    //
    // EVERY ONE OF THESE IS NULLABLE ON PURPOSE. /api/agents/registry answers 200
    // with `runs_error` / `profile_error` / `bundles_error` / `council_error` when
    // a secondary read fails on a table that IS there, and nulls whatever that
    // read fed. So null here means "we could not read it", never "there is none",
    // and the two flags below are how a card tells them apart:
    //
    //   runs_readable === false     the 30-day run log failed. runs_30d,
    //                               failures_30d, last_run_at, modules_touched
    //                               are UNKNOWN — 0 and "never" are lies.
    //   has_runtime_signal === null the profile view failed. Reliability, uptime
    //                               and coins are UNKNOWN — "no data" is a lie.
    profile?: Partial<OemAgentProfile> | null;
    active_bundle?: ActiveBundle | null;
    bundle_version?: number | null;
    bundle_table_count?: number | null;
    council_log?: CouncilLogEntry[] | null;
    runs_readable?: boolean;
    runs_30d?: number | null;
    failures_30d?: number | null;
    last_run_at?: string | null;
    modules_touched?: string[] | null;
    has_runtime_signal?: boolean | null;
}

/* ==========================================================================
 * Helpers shared across the console
 * ========================================================================== */

/**
 * Relative time against a caller-supplied `now`. The caller owns the clock so
 * every card in the roster re-renders on the same tick instead of each holding
 * its own timer — one interval for the whole list.
 */
export function relativeTime(iso: string | null | undefined, now: number): string {
    if (!iso) return 'never';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return 'never';
    const secs = Math.round((now - then) / 1000);
    if (secs < 0) return 'scheduled';
    if (secs < 45) return 'just now';
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    if (secs < 86_400) return `${Math.round(secs / 3600)}h ago`;
    if (secs < 7 * 86_400) return `${Math.round(secs / 86_400)}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The most recent evidence that this agent did anything at all. */
export function lastActiveAt(agent: ConsoleAgent): string | null {
    const candidates = [
        agent.last_run_at,
        agent.profile?.last_run_at ?? null,
        agent.last_heartbeat_at,
        agent.profile?.last_heartbeat_at ?? null,
    ].filter((v): v is string => !!v);
    if (!candidates.length) return null;
    return candidates.reduce((a, b) => (a > b ? a : b));
}

export function healthOf(agent: ConsoleAgent): AgentHealthState {
    return (agent.health_state ?? agent.profile?.health_state ?? 'unknown') as AgentHealthState;
}

/* --------------------------------------------------------------------------
 * WHICH READS WORKED.
 *
 * The registry route distinguishes "the table is not there", "the read failed"
 * and "the read worked and found nothing", and it ships that distinction per
 * agent. These two predicates are the only place the console asks the question,
 * so a card, a detail header and a roster row can never disagree about it.
 * ------------------------------------------------------------------------ */

/** False = the 30-day run log could not be read. Counts and "last active" are UNKNOWN. */
export function runsReadable(agent: ConsoleAgent): boolean {
    return agent.runs_readable !== false;
}

/**
 * False = the profile view could not be read, so reliability, uptime and coins
 * are UNKNOWN. `has_runtime_signal` is null for exactly that reason — the route
 * refuses to answer false, which would assert the agent is unmonitored on the
 * strength of a query that never worked.
 */
export function profileReadable(agent: ConsoleAgent): boolean {
    return agent.has_runtime_signal !== null;
}

/**
 * Can we say anything at all about whether this agent is alive?
 *
 * `healthOf` falls back to 'unknown', which HEALTH_META renders as "Never
 * probed" — a claim. It is only allowed to be that claim when the reads behind
 * it actually returned. When the registry row carries no health_state AND the
 * profile view could not be read, the honest answer is "couldn't read".
 */
export function healthReadable(agent: ConsoleAgent): boolean {
    return agent.health_state != null || profileReadable(agent);
}

export function reliabilityOf(agent: ConsoleAgent): number | null {
    const raw = agent.reliability_score ?? agent.profile?.reliability_score ?? null;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** 30-day runs: a number, or null when the run log could not be read. */
export function runsOf(agent: ConsoleAgent): number | null {
    if (typeof agent.runs_30d === 'number') return agent.runs_30d;
    const fromProfile = agent.profile?.runs_total;
    if (typeof fromProfile === 'number') return fromProfile;
    return runsReadable(agent) ? 0 : null;
}

/** 30-day failures: a number, or null when the run log could not be read. */
export function failuresOf(agent: ConsoleAgent): number | null {
    if (typeof agent.failures_30d === 'number') return agent.failures_30d;
    const fromProfile = agent.profile?.runs_failed;
    if (typeof fromProfile === 'number') return fromProfile;
    return runsReadable(agent) ? 0 : null;
}

/**
 * The neutral dot an unreadable agent gets instead of a green one, and the
 * sentence explaining why. Deliberately NOT amber-as-degraded: this is the
 * absence of a reading, not a reading of trouble.
 */
export const HEALTH_UNREADABLE = {
    label: 'Couldn’t read',
    dot: 'bg-slate-300',
    ring: 'bg-slate-300',
    text: 'text-text-tertiary',
    hint: 'Heartbeat unknown — the telemetry read failed. This is not "never probed"; nothing was learned either way.',
} as const;

export function coinsOf(agent: ConsoleAgent): number | null {
    const raw = agent.coins_balance ?? agent.profile?.coins_balance ?? null;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export const HEALTH_META: Record<AgentHealthState, { label: string; dot: string; ring: string; text: string }> = {
    up: { label: 'Up', dot: 'bg-emerald-500', ring: 'bg-emerald-500', text: 'text-emerald-600' },
    degraded: { label: 'Degraded', dot: 'bg-amber-500', ring: 'bg-amber-500', text: 'text-amber-600' },
    down: { label: 'Down', dot: 'bg-rose-500', ring: 'bg-rose-500', text: 'text-rose-600' },
    unknown: { label: 'Never probed', dot: 'bg-slate-300', ring: 'bg-slate-300', text: 'text-text-tertiary' },
};

export const STATUS_META: Record<AgentLifecycleStatus, { label: string; className: string; hint: string }> = {
    live: {
        label: 'Live',
        className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        hint: 'Acting on the business.',
    },
    shadow: {
        label: 'Shadow',
        className: 'bg-primary/10 text-primary border-primary/25',
        hint: 'Reasons and logs, takes no action. The proving ground before live.',
    },
    draft: {
        label: 'Draft',
        className: 'bg-muted text-text-secondary border-border',
        hint: 'Not scheduled. Must pass through shadow before it can go live.',
    },
    paused: {
        label: 'Paused',
        className: 'bg-amber-50 text-amber-700 border-amber-200',
        hint: 'Held by an operator. Resume to live or shadow.',
    },
    retired: {
        label: 'Retired',
        className: 'bg-muted text-text-tertiary border-border',
        hint: 'Out of service. History is kept.',
    },
};

/**
 * Colour the reliability meter by band, on white-safe weights.
 *
 * The THRESHOLDS are not here. This function used to cut at 85/65/45 while
 * backend/lib/agents/reliability.ts cut at 93/80/60, so the same score could read
 * green on this card and "watch" everywhere else. Only the class mapping is a
 * component concern; where a band begins is a product decision and lives in the
 * one module that owns the maths.
 */
const BAND_TONE: Record<ReliabilityBand, { bar: string; text: string }> = {
    excellent: { bar: 'bg-emerald-500', text: 'text-emerald-600' },
    healthy: { bar: 'bg-primary', text: 'text-primary' },
    watch: { bar: 'bg-amber-500', text: 'text-amber-600' },
    critical: { bar: 'bg-rose-500', text: 'text-rose-600' },
    // Never rendered today (the call site guards on a non-null score), but a
    // band must map to something that does not imply a bad score.
    unmeasured: { bar: 'bg-border', text: 'text-text-tertiary' },
};

function reliabilityTone(score: number): { bar: string; text: string } {
    return BAND_TONE[reliabilityBand(score)];
}

/* ==========================================================================
 * Component
 * ========================================================================== */

export interface AgentRosterCardProps {
    agent: ConsoleAgent;
    selected: boolean;
    /** Shared clock from the console, so every card ages on the same tick. */
    now: number;
    onSelect: (agentKey: string) => void;
}

function AgentRosterCardImpl({ agent, selected, now, onSelect }: AgentRosterCardProps) {
    const reduceMotion = useReducedMotion();
    const health = healthOf(agent);
    const healthKnown = healthReadable(agent);
    const healthMeta = healthKnown ? HEALTH_META[health] : HEALTH_UNREADABLE;
    const statsKnown = profileReadable(agent);
    const runsKnown = runsReadable(agent);
    const statusMeta = STATUS_META[agent.status] ?? STATUS_META.draft;
    const reliability = reliabilityOf(agent);
    const coins = coinsOf(agent);
    const active = lastActiveAt(agent);
    const runs = runsOf(agent);
    const failures = failuresOf(agent);
    const inFlight = agent.profile?.runs_in_flight ?? 0;

    // The single condition under which anything on this card is allowed to move.
    // An unreadable heartbeat is deliberately still: a pulse ring is a claim of
    // liveness, and a failed read has not earned one.
    const beating = agent.status === 'live' && healthKnown && health === 'up' && !reduceMotion;
    const tone = reliability !== null ? reliabilityTone(reliability) : null;

    // "no data" is a real answer and must not be given for a read that failed.
    const reliabilityHint =
        reliability !== null
            ? `Reliability ${Math.round(reliability)} of 100.`
            : statsKnown
              ? 'No reliability score yet — this agent has not been measured.'
              : 'Reliability unknown — the telemetry read failed. This is not a score of zero and not "no data yet".';

    const moduleLabel =
        (typeof agent.config?.module === 'string' ? (agent.config.module as string) : null) ??
        agent.department ??
        'unassigned';

    return (
        <button
            type="button"
            onClick={() => onSelect(agent.agent_key)}
            aria-pressed={selected}
            aria-label={`${agent.display_name} — ${statusMeta.label}, ${healthMeta.label}`}
            className={[
                'group relative w-full overflow-hidden rounded-[14px] border px-3.5 py-3 text-left transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                selected
                    ? 'border-primary/40 bg-card-tint shadow-sm'
                    : 'border-border bg-card hover:border-primary/25 hover:bg-card-tint',
            ].join(' ')}
        >
            {/* Selection rail — slides between cards rather than blinking on. */}
            {selected && (
                <motion.span
                    layoutId="agent-roster-rail"
                    className="absolute left-0 top-0 h-full w-[3px] bg-primary"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
            )}

            {/* Row 1 — identity + status */}
            <div className="flex items-start gap-2.5">
                {/* A face, so eight specialists are eight recognisable rows and not
                    eight identical ones. The heartbeat rides on it as a badge. */}
                <span className="relative shrink-0">
                    <AgentAvatar
                        name={agent.display_name}
                        seed={agent.agent_key}
                        color={typeof agent.config?.color === 'string' ? (agent.config.color as string) : null}
                        src={typeof agent.config?.avatar_url === 'string' ? (agent.config.avatar_url as string) : null}
                        size={34}
                        ring={selected}
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-card">
                        <span
                            className={`h-2 w-2 rounded-full ${healthMeta.dot}`}
                            title={healthKnown ? `Heartbeat: ${healthMeta.label}` : HEALTH_UNREADABLE.hint}
                        />
                    </span>
                </span>
                <span className="relative mt-[5px] hidden h-2.5 w-2.5 shrink-0 items-center justify-center">
                    {beating && (
                        <motion.span
                            aria-hidden
                            className={`absolute h-2.5 w-2.5 rounded-full ${healthMeta.ring}`}
                            animate={{ scale: [1, 2.4], opacity: [0.4, 0] }}
                            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
                        />
                    )}
                    <span
                        className={`relative h-2.5 w-2.5 rounded-full ${healthMeta.dot}`}
                        title={
                            healthKnown
                                ? `Heartbeat: ${healthMeta.label}`
                                : HEALTH_UNREADABLE.hint
                        }
                    />
                </span>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-semibold leading-tight text-foreground">
                            {agent.display_name}
                        </span>
                        {failures !== null && failures > 0 && (
                            <AlertTriangle
                                className="h-3.5 w-3.5 shrink-0 text-amber-500"
                                aria-label={`${failures} failed runs in 30 days`}
                            />
                        )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-text-tertiary">
                        <span className="truncate capitalize">{moduleLabel}</span>
                        <span aria-hidden>·</span>
                        <span className="shrink-0 font-mono">
                            p{agent.system_prompt_version ?? 0}
                        </span>
                        {agent.bundle_version != null && (
                            <>
                                <span aria-hidden>·</span>
                                <span className="shrink-0 font-mono">b{agent.bundle_version}</span>
                            </>
                        )}
                    </div>
                </div>

                <span
                    title={statusMeta.hint}
                    className={`shrink-0 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold uppercase tracking-wide ${statusMeta.className}`}
                >
                    {statusMeta.label}
                </span>
            </div>

            {/* Row 2 — reliability meter.
                Three outcomes, not two: a score, an honest "not measured yet",
                and "—" for a score that could not be read. The last one must not
                borrow the wording of the second. */}
            <div className="mt-2.5 flex items-center gap-2" title={reliabilityHint}>
                <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-muted">
                    {reliability !== null && tone ? (
                        <motion.div
                            className={`h-full rounded-full ${tone.bar}`}
                            initial={false}
                            animate={{ width: `${Math.max(0, Math.min(100, reliability))}%` }}
                            transition={{ type: 'spring', stiffness: 160, damping: 26 }}
                        />
                    ) : (
                        <div
                            className="h-full w-full"
                            style={{
                                backgroundImage:
                                    'repeating-linear-gradient(90deg, var(--border) 0 6px, transparent 6px 12px)',
                            }}
                        />
                    )}
                </div>
                {reliability !== null && tone ? (
                    <span className={`w-[56px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums ${tone.text}`}>
                        {Math.round(reliability)}
                        <span className="ml-0.5 font-normal text-text-tertiary">rel</span>
                    </span>
                ) : (
                    <span className="w-[56px] shrink-0 text-right text-[11.5px] text-text-tertiary">
                        {statsKnown ? 'no data' : '—'}
                    </span>
                )}
            </div>

            {/* Row 3 — coins, throughput, last active */}
            <div className="mt-2.5 flex items-center justify-between gap-2 text-[12.5px] text-text-secondary">
                <span className="flex items-center gap-3">
                    <span
                        className="flex items-center gap-1"
                        title={
                            coins !== null
                                ? 'Autopilot coins'
                                : statsKnown
                                  ? 'Autopilot coins — none awarded yet.'
                                  : 'Autopilot coins unknown — the telemetry read failed.'
                        }
                    >
                        <Coins className="h-3 w-3 text-secondary" />
                        <span className="font-medium tabular-nums">
                            {coins !== null ? coins.toLocaleString() : '—'}
                        </span>
                    </span>
                    <span
                        className="flex items-center gap-1"
                        title={
                            runs !== null
                                ? 'Runs in the last 30 days'
                                : 'Runs unknown — the run log could not be read. Zero would be a claim that this agent did nothing for a month.'
                        }
                    >
                        <Activity className="h-3 w-3 text-text-tertiary" />
                        <span className="tabular-nums">{runs !== null ? runs : '—'}</span>
                        {inFlight > 0 && (
                            <span className="ml-0.5 rounded-full bg-primary/10 px-1.5 text-[9px] font-semibold text-primary">
                                {inFlight} running
                            </span>
                        )}
                    </span>
                </span>
                <span
                    className="shrink-0 text-text-tertiary"
                    title={
                        active || runsKnown
                            ? undefined
                            : 'Last activity unknown — the run log could not be read. "Never" is not something a failed query is entitled to say.'
                    }
                >
                    {active
                        ? `last active ${relativeTime(active, now)}`
                        : runsKnown
                          ? 'never active'
                          : 'last active unknown'}
                </span>
            </div>
        </button>
    );
}

const AgentRosterCard = memo(AgentRosterCardImpl);
AgentRosterCard.displayName = 'AgentRosterCard';
export default AgentRosterCard;
