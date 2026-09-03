'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    OctagonAlert,
    RefreshCw,
    SignalZero,
} from 'lucide-react';
import { useWidgetData } from '@/frontend/lib/dashboard/useWidgetData';
import { AGENT_RUNTIME_MIGRATION } from '@/frontend/types/agentRuntime';

/**
 * AGENT UPTIME — the status strip, and the answer the strip cannot give.
 * =============================================================================
 * The user's requirement, verbatim: "when they go down, I know that when they
 * went down and what was the reason."
 *
 * A wall of green dots does not answer that. It answers "is this agent broadly
 * healthy", which is a different and much easier question. So this component is
 * two things stacked, and the second one is the point:
 *
 *   THE STRIP     ~90 buckets, worst state wins per bucket, hover for detail.
 *                 Shape of the window at a glance.
 *   THE INCIDENTS Contiguous outages collapsed into rows: how long, which
 *                 window, and the cause written as a SENTENCE. Reason codes are
 *                 machine slugs by design (they group cleanly); an operator
 *                 should never have to know that 'bolna_401' means the voice
 *                 provider rejected the credentials. The raw slug is kept in a
 *                 title attribute for whoever is debugging.
 *
 * SILENCE IS THE FAILURE MODE THAT MATTERS. A crashed process cannot POST
 * state:'down' — it just stops beating, and a strip of green that simply ends
 * reads as healthy. The API already emits those gaps as `kind: 'silence'`
 * incidents; this component colours them differently (we do not KNOW it was
 * down) and, more importantly, escalates the header: if the last beat is older
 * than twice the agent's own configured heartbeat_interval_sec, the "last beat"
 * line turns amber and says so. A heartbeat monitor that cannot tell you it has
 * stopped receiving heartbeats is worse than no monitor, because it looks fine.
 *
 * Not provisioned -> a calm panel naming the migration, never an error.
 */

interface Bucket {
    from: string;
    to: string;
    beats: number;
    up: number;
    degraded: number;
    down: number;
    state: 'up' | 'degraded' | 'down' | 'unknown';
    uptime_pct: number | null;
}

interface Incident {
    agent_key: string;
    agent_name: string;
    kind: 'reported' | 'silence';
    from: string;
    to: string | null;
    state: 'up' | 'degraded' | 'down' | 'unknown';
    reason: string | null;
    reasons: string[];
    beats: number;
    duration_min: number;
    ongoing: boolean;
}

interface ReasonTally {
    reason: string;
    incidents: number;
    minutes: number;
    ongoing: number;
}

interface AgentUptimeRow {
    agent_key: string;
    agent_name: string;
    department: string | null;
    beats: number;
    uptime_pct: number | null;
    current_state: 'up' | 'degraded' | 'down' | 'unknown';
    current_reason: string | null;
    current_since: string | null;
    last_beat_at: string | null;
    heartbeat_interval_sec: number;
    incidents: number;
    open_incident: boolean;
}

interface HeartbeatPayload {
    provisioned: boolean;
    migration?: string;
    reason?: string;
    window?: { hours: number; from: string; to: string; bucket_minutes?: number };
    uptime_pct: number | null;
    beats_total: number;
    beats_up?: number;
    beats_degraded?: number;
    beats_down?: number;
    beats_truncated?: boolean;
    buckets: Bucket[];
    incidents: Incident[];
    reasons: ReasonTally[];
    agents: AgentUptimeRow[];
    current: AgentUptimeRow | null;
    error?: string;
}

export interface AgentUptimeProps {
    orgId: string | null | undefined;
    agentKey: string | null | undefined;
    /** Initial window. The operator can switch it. */
    hours?: number;
    /** Bars in the strip. */
    buckets?: number;
    className?: string;
}

/* --------------------------------------------------------------------------
 * Status colours. Semantic only — 500/600 weights, which read on white.
 * ------------------------------------------------------------------------ */
const C_UP = '#16a34a'; // green-600
const C_DEGRADED = '#f59e0b'; // amber-500
const C_DOWN = '#dc2626'; // red-600
const C_SILENT = 'var(--text-tertiary)'; // "we do not know", not "it was fine"

const BAR_COLOR: Record<Bucket['state'], string> = {
    up: C_UP,
    degraded: C_DEGRADED,
    down: C_DOWN,
    unknown: 'var(--border)',
};

/* --------------------------------------------------------------------------
 * Reason slugs -> plain English.
 *
 * The API groups outages by slug on purpose; this is the only place that turns
 * them into something an operator reads. Unknown slugs are humanised rather
 * than dropped, so a reason coined by a new agent still shows up sensibly.
 * ------------------------------------------------------------------------ */
const REASON_TEXT: Record<string, string> = {
    ok: 'Healthy',
    no_heartbeat: 'Stopped reporting — no heartbeat arrived',
    llm_key_missing: 'No LLM key configured',
    llm_timeout: 'The model did not answer in time',
    bolna_401: 'Bolna rejected the credentials',
    bolna_error: 'The voice provider returned an error',
    rate_limited: 'Provider rate limit',
    quiet_hours: 'Held back by quiet hours',
    timeout: 'The run timed out',
    no_schedule: 'No schedule set, so it never ran',
    auth_failed: 'Credentials were rejected',
    bundle_violation: 'Tried to read a table outside its data bundle',
    bad_json: 'The model returned output we could not parse',
    not_provisioned: 'A table it needs does not exist yet',
    budget_exceeded: 'Daily cost cap reached',
    max_runs_reached: 'Daily run cap reached',
    paused: 'Paused by an operator',
    unknown: 'Cause not recorded',
};

function reasonText(slug: string | null | undefined): string {
    if (!slug) return 'Cause not recorded';
    const known = REASON_TEXT[slug];
    if (known) return known;
    const words = slug.replace(/[_-]+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Cause not recorded';
}

/* --------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------ */
function fmtMinutes(min: number): string {
    const m = Math.max(0, Math.round(min));
    if (m < 1) return 'under a minute';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
    const d = Math.floor(h / 24);
    const hRem = h % 24;
    return hRem ? `${d}d ${hRem}h` : `${d}d`;
}

function clock(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function dayStamp(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** "14:02" for today, "29 Aug 14:02" otherwise — never a bare time on old rows. */
function stamp(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? clock(iso) : `${dayStamp(iso)} ${clock(iso)}`;
}

function secondsSince(iso: string | null | undefined, now: number): number | null {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.round((now - t) / 1000));
}

function ago(seconds: number): string {
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

const pct = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `${Number(v).toFixed(Number(v) >= 99.95 ? 0 : 2)}%`;

const WINDOWS = [
    { hours: 24, label: '24h' },
    { hours: 168, label: '7d' },
    { hours: 720, label: '30d' },
];

/** Re-render on a timer so "last beat 40s ago" keeps counting without refetching. */
function useNow(intervalMs = 15_000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

export default function AgentUptime({
    orgId,
    agentKey,
    hours: initialHours = 24,
    buckets = 90,
    className = '',
}: AgentUptimeProps) {
    const [hours, setHours] = useState(initialHours);
    const [hover, setHover] = useState<number | null>(null);
    const now = useNow();

    const url =
        orgId && agentKey
            ? `/api/agents/heartbeat?orgId=${encodeURIComponent(orgId)}&agentKey=${encodeURIComponent(
                  agentKey,
              )}&hours=${hours}&buckets=${buckets}`
            : null;

    const { data, loading, error, refresh } = useWidgetData<HeartbeatPayload>(url, 30_000);

    const current = data?.current ?? data?.agents?.[0] ?? null;
    const intervalSec = current?.heartbeat_interval_sec ?? 300;
    const lastBeatAt = current?.last_beat_at ?? null;
    const lastBeatSec = secondsSince(lastBeatAt, now);

    /**
     * The staleness verdict. Two missed intervals is the threshold — one missed
     * beat is a hiccup, two is a pattern, and waiting for three (which is where
     * the API opens a silence incident) means the header is the last thing on
     * screen to admit something is wrong.
     */
    const staleness: 'fresh' | 'stale' | 'never' =
        lastBeatSec === null ? 'never' : lastBeatSec > intervalSec * 2 ? 'stale' : 'fresh';

    const incidents = useMemo(() => (data?.incidents ?? []).slice(0, 40), [data]);
    const openIncidents = incidents.filter((i) => i.ongoing);

    const shell = `rounded-[var(--card-radius)] border border-border bg-card ${className}`;

    /* ---- gates -------------------------------------------------------- */
    if (!orgId || !agentKey) {
        return (
            <div className={`${shell} p-5 text-sm text-text-tertiary`}>
                Select an agent to see its uptime.
            </div>
        );
    }

    if (loading && !data) {
        return (
            <div className={`${shell} p-5`}>
                <div className="mb-4 h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="mb-4 flex gap-[2px]">
                    {Array.from({ length: 60 }).map((_, i) => (
                        <div key={i} className="h-8 flex-1 animate-pulse rounded-sm bg-muted" />
                    ))}
                </div>
                <div className="h-3 w-56 animate-pulse rounded bg-muted" />
            </div>
        );
    }

    if (error === 'forbidden') {
        return (
            <div className={`${shell} p-5 text-sm text-text-tertiary`}>
                You do not have permission to see this agent&apos;s uptime.
            </div>
        );
    }

    if (error || data?.error) {
        return (
            <div className={`${shell} p-5`}>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Could not load uptime — {data?.error ?? error}
                </div>
                <button
                    onClick={refresh}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-muted"
                >
                    <RefreshCw className="h-3 w-3" /> Try again
                </button>
            </div>
        );
    }

    if (data && data.provisioned === false) {
        return (
            <div className={`${shell} p-5`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Activity className="h-4 w-4 text-primary" />
                    Heartbeat monitoring is not provisioned yet
                </div>
                <p className="mt-2 max-w-xl text-xs leading-relaxed text-text-secondary">
                    Uptime, incidents and outage causes appear here once migration{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-text-primary">
                        {data.migration ?? AGENT_RUNTIME_MIGRATION}
                    </code>{' '}
                    is applied. Nothing is broken — the tables simply do not exist yet.
                </p>
            </div>
        );
    }

    const bars = data?.buckets ?? [];
    const hovered = hover !== null ? bars[hover] ?? null : null;

    return (
        <div className={shell}>
            {/* ---------------- header ---------------- */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold tracking-tight text-foreground">
                            {pct(data?.uptime_pct)}
                        </span>
                        <span className="text-xs text-text-secondary">
                            uptime over {WINDOWS.find((w) => w.hours === hours)?.label ?? `${hours}h`}
                        </span>
                    </div>

                    {/* The line that makes this monitor honest. */}
                    <div
                        className={`mt-1 flex items-center gap-1.5 text-xs ${
                            staleness === 'fresh'
                                ? 'text-text-tertiary'
                                : staleness === 'stale'
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                        }`}
                        title={
                            lastBeatAt
                                ? `Last heartbeat ${new Date(lastBeatAt).toLocaleString()} · expected every ${intervalSec}s`
                                : 'No heartbeat has ever been recorded for this agent.'
                        }
                    >
                        {staleness === 'fresh' ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                            <SignalZero className="h-3.5 w-3.5" />
                        )}
                        {staleness === 'never' ? (
                            <span>
                                No heartbeat ever received — this agent has never reported in
                            </span>
                        ) : staleness === 'stale' ? (
                            <span>
                                Last beat {ago(lastBeatSec as number)} — overdue, expected every{' '}
                                {fmtMinutes(intervalSec / 60)}
                            </span>
                        ) : (
                            <span>
                                Last beat {ago(lastBeatSec as number)} · expected every{' '}
                                {fmtMinutes(intervalSec / 60)}
                            </span>
                        )}
                    </div>

                    <div className="mt-1 text-[11px] text-text-tertiary">
                        {(data?.beats_total ?? 0).toLocaleString('en-IN')} beats ·{' '}
                        {data?.beats_up ?? 0} up · {data?.beats_degraded ?? 0} degraded ·{' '}
                        {data?.beats_down ?? 0} down
                        {data?.beats_truncated ? ' · window truncated' : ''}
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {WINDOWS.map((w) => (
                        <button
                            key={w.hours}
                            onClick={() => setHours(w.hours)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                                hours === w.hours
                                    ? 'bg-primary text-white'
                                    : 'border border-border text-text-secondary hover:bg-muted'
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                    <button
                        onClick={refresh}
                        title="Refresh"
                        aria-label="Refresh uptime"
                        className="ml-1 rounded-lg border border-border p-1.5 text-text-secondary transition-colors hover:bg-muted"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {/* ---------------- open-incident banner ---------------- */}
            {openIncidents.length > 0 && (
                <div className="flex items-start gap-2 border-b border-border bg-red-50 px-5 py-2.5">
                    <OctagonAlert className="mt-0.5 h-4 w-4 flex-none text-red-600" />
                    <div className="text-xs text-red-700">
                        <span className="font-semibold">
                            {openIncidents.length === 1
                                ? 'An incident is open right now'
                                : `${openIncidents.length} incidents are open right now`}
                        </span>{' '}
                        — {reasonText(openIncidents[0].reason)}, running for{' '}
                        {fmtMinutes(openIncidents[0].duration_min)}.
                    </div>
                </div>
            )}

            {/* ---------------- the strip ---------------- */}
            <div className="px-5 pb-2 pt-4">
                <div className="relative">
                    <div
                        className="flex items-end gap-[2px]"
                        onMouseLeave={() => setHover(null)}
                    >
                        {bars.length === 0 && (
                            <div className="w-full rounded-lg border border-dashed border-border py-6 text-center text-xs text-text-tertiary">
                                No heartbeats recorded in this window.
                            </div>
                        )}
                        {bars.map((b, i) => (
                            <div
                                key={b.from}
                                onMouseEnter={() => setHover(i)}
                                className="h-9 flex-1 cursor-default rounded-[2px] transition-opacity"
                                style={{
                                    minWidth: 2,
                                    background: BAR_COLOR[b.state] ?? 'var(--border)',
                                    opacity: hover === null || hover === i ? 1 : 0.45,
                                }}
                                title={`${stamp(b.from)} → ${stamp(b.to)} · ${
                                    b.beats
                                        ? `${b.state} · ${b.beats} beats · ${pct(b.uptime_pct)} up`
                                        : 'no data'
                                }`}
                            />
                        ))}
                    </div>

                    {hovered && (
                        <div
                            className="pointer-events-none absolute -top-1 z-10 w-56 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
                            // clamp keeps the 224px card inside the strip at both
                            // ends — an edge bucket is exactly the one an operator
                            // reaches for, and a tooltip half off-screen is useless.
                            style={{
                                left: `clamp(112px, ${
                                    (((hover as number) + 0.5) / Math.max(1, bars.length)) * 100
                                }%, calc(100% - 112px))`,
                            }}
                        >
                            <div className="text-[11px] font-semibold text-foreground">
                                {stamp(hovered.from)} → {stamp(hovered.to)}
                            </div>
                            {hovered.beats ? (
                                <>
                                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-secondary">
                                        <span
                                            className="inline-block h-2 w-2 rounded-full"
                                            style={{ background: BAR_COLOR[hovered.state] }}
                                        />
                                        {hovered.state} · {pct(hovered.uptime_pct)} up
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-text-tertiary">
                                        {hovered.beats} beats · {hovered.up} up ·{' '}
                                        {hovered.degraded} degraded · {hovered.down} down
                                    </div>
                                </>
                            ) : (
                                <div className="mt-1 text-[11px] text-text-tertiary">
                                    No beats in this bucket — the agent said nothing either way.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-tertiary">
                    <span>{data?.window ? stamp(data.window.from) : ''}</span>
                    <span className="flex items-center gap-3">
                        <Legend color={C_UP} label="up" />
                        <Legend color={C_DEGRADED} label="degraded" />
                        <Legend color={C_DOWN} label="down" />
                        <Legend color="var(--border)" label="no data" />
                    </span>
                    <span>now</span>
                </div>
            </div>

            {/* ---------------- causes ---------------- */}
            {(data?.reasons?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-border px-5 py-3">
                    <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                        Cost by cause
                    </span>
                    {(data?.reasons ?? []).slice(0, 6).map((r) => (
                        <span
                            key={r.reason}
                            title={`raw reason code: ${r.reason}`}
                            className="rounded-full border border-border bg-card-tint px-2 py-0.5 text-[11px] text-text-secondary"
                        >
                            {reasonText(r.reason)} ·{' '}
                            <span className="font-semibold text-foreground">
                                {fmtMinutes(r.minutes)}
                            </span>
                            {r.incidents > 1 ? ` · ${r.incidents}×` : ''}
                        </span>
                    ))}
                </div>
            )}

            {/* ---------------- the incident list ---------------- */}
            <div className="border-t border-border px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                        Incidents
                    </h4>
                    <span className="text-[11px] text-text-tertiary">
                        {incidents.length ? `${incidents.length} in this window` : ''}
                    </span>
                </div>

                {incidents.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-card-tint px-3 py-3 text-xs text-text-secondary">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        No outages and no silent gaps in this window.
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {incidents.map((inc) => (
                            <IncidentRow key={`${inc.from}-${inc.kind}-${inc.reason}`} incident={inc} />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function Legend({ color, label }: { color: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1">
            <span
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: color }}
            />
            {label}
        </span>
    );
}

function IncidentRow({ incident }: { incident: Incident }) {
    const silent = incident.kind === 'silence';
    const down = incident.state === 'down';

    const tint = silent
        ? { border: 'var(--border)', dot: C_SILENT }
        : down
          ? { border: 'color-mix(in srgb, var(--error) 32%, transparent)', dot: C_DOWN }
          : { border: 'color-mix(in srgb, var(--warning) 40%, transparent)', dot: C_DEGRADED };

    const headline = silent
        ? `Silent for ${fmtMinutes(incident.duration_min)}`
        : `${down ? 'Down' : 'Degraded'} for ${fmtMinutes(incident.duration_min)}`;

    const Icon = silent ? SignalZero : down ? OctagonAlert : AlertTriangle;

    return (
        <li
            className="flex items-start gap-3 rounded-xl border bg-card-tint px-3 py-2.5"
            style={{ borderColor: tint.border }}
        >
            <Icon className="mt-0.5 h-4 w-4 flex-none" style={{ color: tint.dot }} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-foreground">{headline}</span>
                    <span className="text-xs text-text-secondary">
                        {stamp(incident.from)} → {incident.to ? stamp(incident.to) : 'now'}
                    </span>
                    {incident.ongoing && (
                        <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">
                            ongoing
                        </span>
                    )}
                </div>
                <div
                    className="mt-0.5 text-xs text-text-secondary"
                    title={`raw reason code: ${incident.reason ?? 'none'}`}
                >
                    {reasonText(incident.reason)}
                    {silent && (
                        <span className="text-text-tertiary">
                            {' '}
                            — nothing was reported, so we do not know whether it was working.
                        </span>
                    )}
                </div>
                {incident.reasons.length > 1 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                        {incident.reasons.slice(1, 4).map((r) => (
                            <span
                                key={r}
                                title={`raw reason code: ${r}`}
                                className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-text-tertiary"
                            >
                                also: {reasonText(r)}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            {incident.beats > 0 && (
                <span className="flex-none text-[11px] text-text-tertiary">
                    {incident.beats} beats
                </span>
            )}
        </li>
    );
}
