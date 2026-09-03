'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Coins,
    Cpu,
    Flag,
    Gauge,
    Info,
    Loader2,
    RefreshCw,
    Save,
    ShieldCheck,
    Timer,
} from 'lucide-react';
import {
    useWidgetData,
    invalidateWidgetData,
    inr,
    compactNumber,
} from '@/frontend/lib/dashboard/useWidgetData';
import { AGENT_RUNTIME_MIGRATION } from '@/frontend/types/agentRuntime';
import AgentRadar, { type RadarDimension } from './AgentRadar';

/**
 * AGENT PROFILE — an employee record for something that is not a person.
 * =============================================================================
 * "I need to know the token in, token out, the uptime, reliability score etc to
 * be configured in their profile."
 *
 * Two columns, and the split is the argument:
 *
 *   LEFT   WHAT IT DID.   The five-axis reliability pentagon plus the outcome
 *          tiles. Completion, Availability, ROI alignment, Grounding,
 *          Efficiency — the same five-level rhyme as the OEM model.
 *   RIGHT  WHAT IT IS.    The real LLM engineering surface: provider, model,
 *          temperature, top_p, max tokens, context window, tokens in and out,
 *          prompt-cache hits, cost in rupees, p50 and p95 latency.
 *
 * WHY THE RIGHT COLUMN IS NOT A SUMMARY. The brief asked to be seeded with the
 * real concepts rather than a friendly abstraction of them, so every number
 * carries a one-line plain-English gloss beside it. An operator who can see
 * that temperature is 0.9 on a compliance agent can fix it; an operator shown a
 * green tick cannot. The glosses are the teaching surface — they are what makes
 * "configured by anybody, not a specialist" true rather than aspirational.
 *
 * TWO THINGS ARE DELIBERATELY NOT BLENDED TOGETHER:
 *   - ROI flags get their own warning tile. "Not worth doing" is a different
 *     failure from "did it wrong", and folding it into the failure count would
 *     destroy the only signal that tells an operator to retire an agent rather
 *     than debug it.
 *   - An unmeasured radar axis is drawn as unmeasured, never as zero. See
 *     AgentRadar's header.
 *   - An axis whose read FAILED is drawn as unreadable, never as unmeasured.
 *     The route ships `unreadable: true` per axis and keeps those keys OUT of
 *     `radar_coverage.unmeasured` so the UI cannot claim "no data yet" about
 *     something it could not look at; this file threads the flag into
 *     RadarDimension and the caption counts the two blanks separately.
 *
 * THE PARTIAL-FAILURE ENVELOPES ARE RENDERED, NOT SWALLOWED. `runs_error` and
 * `config_error` arrive on an HTTP 200 whose primary read worked. Each one gets
 * an inline amber note in the panel whose data went missing, naming what failed
 * and offering a retry — amber because a failed read is not a failed agent, and
 * inline because a toast disappears while the blanks it explained stay on screen.
 * A failed `config_error` additionally HOLDS the Save button: the form spreads
 * the config it was seeded from, so saving over an unreadable one would clear
 * provider, model and context_window in the database.
 *
 * Temperature, top_p and max_tokens are editable inline and write through
 * POST /api/agents/registry action 'upsert'. They take effect on the NEXT run —
 * an in-flight run keeps the settings it started with, and the note says so.
 *
 * Not provisioned -> a calm panel naming the migration, never an error.
 */

/* ========================================================================== */
/* Payload shapes — mirror app/api/agents/profile/route.ts                     */
/* ========================================================================== */

interface RadarAxis {
    key: string;
    label: string;
    description: string;
    value: number;
    measured: boolean;
    /**
     * Set by the route when the read feeding this axis FAILED. It arrives with
     * `measured: false` beside it so an old renderer still refuses to plot the
     * axis — but the two must not be merged here, because "nothing recorded"
     * and "we could not look" are different sentences and only one is true.
     */
    unreadable?: boolean;
}

/**
 * The shared failure envelope every /api/agents route sends beside the nulls a
 * failed read produced. Its PRESENCE is the whole signal: a null next to a set
 * envelope is UNKNOWN; the same null next to a null envelope is a real "none".
 */
interface QueryFailure {
    scope: string;
    code: string | null;
    message: string;
    reason: string;
}

interface ModelConfig {
    provider?: string;
    model?: string;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    context_window?: number;
}

interface ProfileAgent {
    agent_key: string;
    display_name: string;
    department: string | null;
    status: string;
    health_state: string;
    last_heartbeat_at: string | null;
    last_run_at: string | null;

    reliability_score: number | null;
    reliability_basis: { formula: string; window_days: number };

    runs_total: number;
    runs_succeeded: number;
    runs_failed: number;
    runs_in_flight: number;
    success_rate: number | null;

    uptime_pct: number | null;
    beats_total: number;

    llm: {
        tokens_in: number;
        tokens_out: number;
        tokens_total: number;
        cached_tokens: number;
        cache_hit_rate_pct: number | null;
        tokens_per_run: number | null;
        cost_usd: number;
        cost_inr: number;
        cost_per_success_inr: number | null;
        p50_duration_ms: number | null;
        p95_duration_ms: number | null;
        avg_confidence: number | null;
    };

    reinforcement: {
        coins_balance: number;
        praise_30d: number;
        rejects_30d: number;
        corrections_30d: number;
        roi_flags_30d: number;
        roi_flag_rate: number | null;
        pending_guidance: number;
    };

    prompt_version: number;
    /** NULL when the registry read failed. `{}` would claim "no overrides set". */
    model_config: ModelConfig | null;
    /** False = model_config / runtime / role_description are UNKNOWN, not empty. */
    config_readable?: boolean;
    /** False = at least one radar axis is blank because a read failed. */
    runs_readable?: boolean;

    radar: RadarAxis[];
    radar_coverage: {
        measured: number;
        of: number;
        /** Blank because nothing has been recorded yet — a real answer. */
        unmeasured: string[];
        /** Blank because the read that feeds them failed — no answer at all. */
        unreadable?: string[];
    };
    efficiency_basis: { excellent_inr_per_success: number; poor_inr_per_success: number };
}

interface ProfilePayload {
    /** False = part of this payload is UNKNOWN. See runs_error / config_error. */
    ok?: boolean;
    provisioned: boolean;
    migration?: string;
    reason?: string;
    window_days?: number;
    /** Set when the run-log read failed: grounding + confidence are UNKNOWN. */
    runs_error?: QueryFailure | null;
    /** Set when the registry read failed: the inference settings are UNKNOWN. */
    config_error?: QueryFailure | null;
    agent: ProfileAgent | null;
    agents: ProfileAgent[];
    error?: string;
}

export interface AgentProfileProps {
    orgId: string | null | undefined;
    agentKey: string | null | undefined;
    className?: string;
}

/* ========================================================================== */
/* Formatting                                                                 */
/* ========================================================================== */

const pct = (v: number | null | undefined, dp = 1) =>
    v === null || v === undefined ? '—' : `${Number(v).toFixed(dp)}%`;

const score = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : String(Math.round(Number(v)));

function ms(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (n < 1000) return `${Math.round(n)}ms`;
    if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
    return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;
}

function when(iso: string | null | undefined): string {
    if (!iso) return 'never';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 'never';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

const STATUS_TONE: Record<string, string> = {
    live: 'bg-green-50 text-green-700 border-green-200',
    shadow: 'bg-amber-50 text-amber-700 border-amber-200',
    draft: 'bg-muted text-text-secondary border-border',
    paused: 'bg-amber-50 text-amber-700 border-amber-200',
    retired: 'bg-muted text-text-tertiary border-border',
};

const HEALTH_TONE: Record<string, string> = {
    up: 'bg-green-50 text-green-700 border-green-200',
    degraded: 'bg-amber-50 text-amber-700 border-amber-200',
    down: 'bg-red-50 text-red-700 border-red-200',
    unknown: 'bg-muted text-text-tertiary border-border',
};

/* ========================================================================== */
/* Inline-edit form state                                                     */
/* ========================================================================== */

interface Form {
    temperature: string;
    top_p: string;
    max_tokens: string;
}

const asText = (v: number | undefined) => (v === undefined || v === null ? '' : String(v));

/** Mirrors ModelConfigSchema in app/api/agents/registry/route.ts, so the server never 400s. */
function validate(form: Form): Partial<Record<keyof Form, string>> {
    const errs: Partial<Record<keyof Form, string>> = {};
    const check = (raw: string, min: number, max: number, int = false) => {
        if (raw.trim() === '') return null;
        const n = Number(raw);
        if (!Number.isFinite(n)) return 'must be a number';
        if (int && !Number.isInteger(n)) return 'must be a whole number';
        if (n < min || n > max) return `must be between ${min} and ${max}`;
        return null;
    };
    const t = check(form.temperature, 0, 2);
    if (t) errs.temperature = t;
    const p = check(form.top_p, 0, 1);
    if (p) errs.top_p = p;
    const m = check(form.max_tokens, 1, 1_000_000, true);
    if (m) errs.max_tokens = m;
    return errs;
}

/** '' -> undefined, which JSON.stringify drops: the override is cleared, not zeroed. */
const numOrUndef = (raw: string): number | undefined =>
    raw.trim() === '' ? undefined : Number(raw);

/* ========================================================================== */
/* Component                                                                  */
/* ========================================================================== */

export default function AgentProfile({ orgId, agentKey, className = '' }: AgentProfileProps) {
    const url =
        orgId && agentKey
            ? `/api/agents/profile?orgId=${encodeURIComponent(orgId)}&agentKey=${encodeURIComponent(agentKey)}`
            : null;

    const { data, loading, error, refresh } = useWidgetData<ProfilePayload>(url, 60_000);
    const agent = data?.agent ?? data?.agents?.[0] ?? null;

    /* ---- the two partial-failure envelopes, consumed rather than dropped ----
     *
     * /api/agents/profile answers HTTP 200 with these set when a SECONDARY read
     * failed: the profile view came back, so most of this screen is real, but
     * the fields those reads fed are UNKNOWN. Until this wave nothing on the
     * page read them, so a failed run-log read rendered as "no data yet" and a
     * failed registry read rendered as "not set" — both of them confident
     * answers built out of a query that never worked.
     */
    const runsError = data?.runs_error ?? null;
    const configError = data?.config_error ?? null;

    /**
     * The inference settings are only editable when they were actually READ.
     * `model_config` is null on a failed registry read; the old `?? {}` turned
     * that into an empty object, and Save spreads `...mc` — so pressing Save
     * against an unreadable config would have silently CLEARED provider, model
     * and context_window in the database. Blank the form and disable Save
     * instead of writing over settings nobody could see.
     */
    const configReadable = agent ? agent.config_readable !== false && !configError : true;
    const mc = useMemo<ModelConfig>(() => agent?.model_config ?? {}, [agent]);

    const [form, setForm] = useState<Form>({ temperature: '', top_p: '', max_tokens: '' });
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveNote, setSaveNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

    // Seed the form ONCE per agent, guarded by a ref rather than by the fetched
    // object's identity. useWidgetData hands back a fresh object on every
    // background refetch, so seeding on `agent` alone would (a) wipe an edit in
    // progress mid-keystroke and (b) briefly revert the fields to their old
    // values in the gap between a successful save and the refetch landing.
    // Both make a console feel untrustworthy, and the second is the worse one:
    // it looks like the save failed.
    //
    // The seed key carries config READABILITY as well as the agent key: a form
    // seeded from an unreadable config is blank, and it has to re-seed once the
    // real values arrive, or a later Save would write those blanks back.
    const seededFor = useRef<string | null>(null);
    useEffect(() => {
        if (!agent) return;
        const seedKey = `${agent.agent_key}:${configReadable ? 'cfg' : 'unreadable'}`;
        if (seededFor.current === seedKey) return;
        seededFor.current = seedKey;
        setForm({
            temperature: asText(mc.temperature),
            top_p: asText(mc.top_p),
            max_tokens: asText(mc.max_tokens),
        });
        setDirty(false);
    }, [agent, configReadable, mc.temperature, mc.top_p, mc.max_tokens]);

    const errs = validate(form);
    const hasErrs = Object.keys(errs).length > 0;

    const setField = (k: keyof Form, v: string) => {
        setForm((f) => ({ ...f, [k]: v }));
        setDirty(true);
        setSaveNote(null);
    };

    async function save() {
        if (!orgId || !agentKey || !agent || hasErrs || !configReadable) return;
        setSaving(true);
        setSaveNote(null);
        try {
            const res = await fetch(`/api/agents/registry?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    action: 'upsert',
                    agent_key: agentKey,
                    // display_name is required by the upsert schema; resend the
                    // stored one so an inference edit never renames the agent.
                    display_name: agent.display_name,
                    model_config: {
                        ...mc,
                        temperature: numOrUndef(form.temperature),
                        top_p: numOrUndef(form.top_p),
                        max_tokens: numOrUndef(form.max_tokens),
                    },
                }),
            });
            const json = (await res.json().catch(() => ({}))) as {
                error?: string;
                note?: string;
                runtime_provisioned?: boolean;
            };
            if (!res.ok || json.error) {
                setSaveNote({ tone: 'bad', text: json.error ?? `Save failed (HTTP ${res.status})` });
                return;
            }
            if (json.runtime_provisioned === false) {
                setSaveNote({
                    tone: 'bad',
                    text: json.note ?? `Inference settings need migration ${AGENT_RUNTIME_MIGRATION}.`,
                });
                return;
            }
            setDirty(false);
            setSaveNote({ tone: 'ok', text: 'Saved. Takes effect on the next run.' });
            invalidateWidgetData('/api/agents/');
            refresh();
        } catch (e) {
            setSaveNote({ tone: 'bad', text: e instanceof Error ? e.message : 'Network error' });
        } finally {
            setSaving(false);
        }
    }

    const shell = `rounded-[var(--panel-radius)] border border-border bg-card ${className}`;

    /* ---- gates -------------------------------------------------------- */
    if (!orgId || !agentKey) {
        return (
            <div className={`${shell} p-6 text-sm text-text-tertiary`}>
                Select an agent to open its profile.
            </div>
        );
    }

    if (loading && !data) {
        return (
            <div className={`${shell} grid gap-6 p-6 lg:grid-cols-2`}>
                <div className="space-y-4">
                    <div className="mx-auto h-52 w-52 animate-pulse rounded-full bg-muted" />
                    <div className="grid grid-cols-2 gap-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
                        ))}
                    </div>
                </div>
                <div className="space-y-3">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
                    ))}
                </div>
            </div>
        );
    }

    if (error === 'forbidden') {
        return (
            <div className={`${shell} p-6 text-sm text-text-tertiary`}>
                You do not have permission to see this agent&apos;s profile.
            </div>
        );
    }

    if (error || data?.error) {
        return (
            <div className={`${shell} p-6`}>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Could not load the profile — {data?.error ?? error}
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
            <div className={`${shell} p-6`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Cpu className="h-4 w-4 text-primary" />
                    The agent profile is not provisioned yet
                </div>
                <p className="mt-2 max-w-xl text-xs leading-relaxed text-text-secondary">
                    Tokens, cost, latency, uptime and the reliability pentagon appear here once
                    migration{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-text-primary">
                        {data.migration ?? AGENT_RUNTIME_MIGRATION}
                    </code>{' '}
                    is applied. Nothing is broken — the runtime tables simply do not exist yet.
                </p>
            </div>
        );
    }

    if (!agent) {
        return (
            <div className={`${shell} p-6 text-sm text-text-tertiary`}>
                No profile recorded for <span className="font-mono">{agentKey}</span> yet. It will
                appear after its first run or heartbeat.
            </div>
        );
    }

    const axes = agent.radar ?? [];

    const dims: RadarDimension[] = axes.map((a) => ({
        key: a.key,
        label: a.label,
        value: a.value,
        measured: a.measured,
        // Threaded, not dropped. Without this the radar sees only `measured:
        // false` and prints "not measured" on an axis whose value is UNKNOWN.
        unreadable: a.unreadable === true,
        description: a.description,
    }));

    const coverage = agent.radar_coverage;
    const roiFlags = agent.reinforcement.roi_flags_30d;

    /* ---- the pentagon caption ------------------------------------------------
     *
     * `radar_coverage` reports THREE numbers, not two: how many axes are
     * measured, which are blank because nothing has been recorded, and which
     * are blank because a read failed. The route deliberately keeps the third
     * list out of `unmeasured` so the UI cannot claim "no data yet" about an
     * axis it could not read — and the caption has to honour that split, or the
     * count itself becomes the lie: "4 of 5 axes measured" with no further
     * clause reads as "the fifth is empty".
     *
     * Keys are translated back to labels, because "grounding" is a column name
     * and "Grounding" is what the chart beside it says.
     */
    const axisLabel = (key: string) =>
        axes.find((a) => a.key === key)?.label ?? key.replace(/_/g, ' ');
    const unmeasuredKeys = coverage?.unmeasured ?? [];
    const unreadableKeys = coverage?.unreadable ?? [];
    const captionParts: string[] = [];
    if (coverage) {
        captionParts.push(`${coverage.measured} of ${coverage.of} axes measured`);
        if (unreadableKeys.length) {
            captionParts.push(
                `${unreadableKeys.length} couldn’t be read (${unreadableKeys.map(axisLabel).join(', ')})`,
            );
        }
    }
    const captionCount = captionParts.join(' · ');
    const tailParts = coverage
        ? [
              unmeasuredKeys.length
                  ? `no data yet for ${unmeasuredKeys.map(axisLabel).join(', ')}; an unmeasured axis is left out of the shape rather than drawn as zero.`
                  : '',
              unreadableKeys.length
                  ? 'an axis we couldn’t read is left off the shape entirely and marked in amber. That is not a score of zero and not “no data yet” — its value is unknown.'
                  : '',
          ].filter(Boolean)
        : [];
    // The first clause continues the count after an em dash, so it stays lower
    // case; any clause after it begins a new sentence.
    const captionTail = tailParts
        .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
        .join(' ');

    return (
        <div className={shell}>
            {/* ---------------- header ---------------- */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-4">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">
                            {agent.display_name}
                        </h3>
                        <Pill className={STATUS_TONE[agent.status] ?? STATUS_TONE.draft}>
                            {agent.status}
                        </Pill>
                        <Pill className={HEALTH_TONE[agent.health_state] ?? HEALTH_TONE.unknown}>
                            {agent.health_state}
                        </Pill>
                        <span className="font-mono text-[11px] text-text-tertiary">
                            {agent.agent_key}
                        </span>
                    </div>
                    <div className="mt-1 text-xs text-text-tertiary">
                        {agent.department ? `${agent.department} · ` : ''}
                        prompt v{agent.prompt_version} · last run {when(agent.last_run_at)} · last
                        beat {when(agent.last_heartbeat_at)}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-text-tertiary">
                        Last {data?.window_days ?? 30} days
                    </div>
                    <div className="text-xs text-text-secondary">
                        {agent.runs_total.toLocaleString('en-IN')} runs ·{' '}
                        {agent.runs_in_flight} in flight
                    </div>
                </div>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-2">
                {/* ================= LEFT — what it did ================= */}
                <section>
                    <SectionTitle icon={Gauge} title="Outcomes" caption="Five axes, 0–100." />

                    <div className="flex justify-center">
                        <AgentRadar
                            dimensions={dims}
                            size={360}
                            animateKey={`${agent.agent_key}`}
                        />
                    </div>

                    <p className="mt-1 text-center text-[11px] leading-relaxed text-text-tertiary">
                        Rings at 25 / 50 / 75 / 100.{' '}
                        {captionCount}
                        {captionCount && (captionTail ? ' — ' : '.')}
                        {captionTail}
                    </p>

                    {/* The run-log envelope, named where its data is missing.
                        Amber, not red: the agent did not fail, the read did. */}
                    {runsError && (
                        <ReadFailure
                            title="Grounding and confidence couldn’t be read"
                            reason={
                                runsError.reason ??
                                'The agent run log could not be read, so the Grounding axis and the self-reported confidence figure are unknown.'
                            }
                            detail={runsError.message}
                            code={runsError.code}
                            onRetry={refresh}
                        />
                    )}

                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Tile
                            icon={ShieldCheck}
                            label="Reliability"
                            value={score(agent.reliability_score)}
                            hint="0–100 composite"
                            title={agent.reliability_basis?.formula}
                        />
                        <Tile
                            icon={Gauge}
                            label="Uptime"
                            value={pct(agent.uptime_pct, 2)}
                            hint={`${agent.beats_total.toLocaleString('en-IN')} beats`}
                        />
                        <Tile
                            icon={CheckCircle2}
                            label="Success rate"
                            value={pct(agent.success_rate)}
                            hint={`${agent.runs_succeeded} ok · ${agent.runs_failed} failed`}
                        />
                        <Tile
                            icon={Coins}
                            label="Autopilot coins"
                            value={compactNumber(agent.reinforcement.coins_balance)}
                            hint={`${agent.reinforcement.praise_30d} praised · ${agent.reinforcement.rejects_30d} rejected`}
                        />
                        <Tile
                            icon={Timer}
                            label="Typical run"
                            value={ms(agent.llm.p50_duration_ms)}
                            hint={`p95 ${ms(agent.llm.p95_duration_ms)}`}
                        />
                        <Tile
                            icon={Info}
                            label="Corrections"
                            value={String(agent.reinforcement.corrections_30d)}
                            hint={`${agent.reinforcement.pending_guidance} awaiting a prompt version`}
                        />
                    </div>

                    {/* ROI flags stand alone. See the header note. */}
                    <div
                        className={`mt-3 flex items-start gap-3 rounded-xl border px-3 py-3 ${
                            roiFlags > 0
                                ? 'border-amber-200 bg-amber-50'
                                : 'border-border bg-card-tint'
                        }`}
                    >
                        <Flag
                            className={`mt-0.5 h-4 w-4 flex-none ${
                                roiFlags > 0 ? 'text-amber-600' : 'text-text-tertiary'
                            }`}
                        />
                        <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground">
                                {roiFlags} ROI flag{roiFlags === 1 ? '' : 's'}
                                {agent.reinforcement.roi_flag_rate !== null && (
                                    <span className="ml-1.5 text-xs font-normal text-text-secondary">
                                        ({pct(agent.reinforcement.roi_flag_rate)} of runs)
                                    </span>
                                )}
                            </div>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
                                Work an operator judged not worth doing. This is a different
                                failure from a run that went wrong — an agent can succeed
                                perfectly at a task the business did not want.
                            </p>
                        </div>
                    </div>

                    {agent.reliability_basis?.formula && (
                        <p className="mt-3 text-[11px] leading-relaxed text-text-tertiary">
                            Reliability = {agent.reliability_basis.formula}, over{' '}
                            {agent.reliability_basis.window_days} days.
                        </p>
                    )}
                </section>

                {/* ================= RIGHT — what it is ================= */}
                <section>
                    <SectionTitle
                        icon={Cpu}
                        title="The model underneath"
                        caption="What it is set to, and what that costs."
                    />

                    {/* The registry envelope, named above the settings it blanks. */}
                    {!configReadable && (
                        <ReadFailure
                            className="mb-3"
                            title="The inference settings couldn’t be read"
                            reason={
                                configError?.reason ??
                                'The agent registry row could not be read, so the provider, model, temperature, top_p and context window are unknown — not unset. Editing is held until the current values can be seen.'
                            }
                            detail={configError?.message}
                            code={configError?.code}
                            onRetry={refresh}
                        />
                    )}

                    {/* ---- inference settings ---- */}
                    <div className="rounded-[var(--card-radius)] border border-border bg-card-tint p-4">
                        <Row
                            label="Provider"
                            value={configReadable ? mc.provider || 'not set' : 'couldn’t read'}
                            gloss="Which vendor's API answers this agent."
                        />
                        <Row
                            label="Model"
                            value={configReadable ? mc.model || 'not set' : 'couldn’t read'}
                            gloss="The specific weights. Different models trade cost against reasoning depth."
                        />

                        <div className="my-3 border-t border-border" />

                        <EditRow
                            label="Temperature"
                            gloss="Higher = more varied wording. Near 0 the agent says almost the same thing every time; above 1 it starts reaching for unlikely words."
                            value={form.temperature}
                            onChange={(v) => setField('temperature', v)}
                            error={errs.temperature}
                            placeholder="0.2"
                            step="0.1"
                            min={0}
                            max={2}
                        />
                        <EditRow
                            label="Top-p"
                            gloss="Restricts word choice to the most likely set. 0.9 keeps the top 90% of probability and throws away the improbable tail."
                            value={form.top_p}
                            onChange={(v) => setField('top_p', v)}
                            error={errs.top_p}
                            placeholder="0.9"
                            step="0.05"
                            min={0}
                            max={1}
                        />
                        <EditRow
                            label="Max tokens"
                            gloss="Hard ceiling on one reply. Hit it and the answer stops mid-sentence — raise it if outputs look truncated."
                            value={form.max_tokens}
                            onChange={(v) => setField('max_tokens', v)}
                            error={errs.max_tokens}
                            placeholder="2048"
                            step="128"
                            min={1}
                        />
                        <Row
                            label="Context window"
                            value={
                                !configReadable
                                    ? 'couldn’t read'
                                    : mc.context_window
                                      ? `${compactNumber(mc.context_window)} tokens`
                                      : 'model default'
                            }
                            gloss="How much it can see at once — system prompt, bundle rows and reply together. Overflow it and the earliest material is silently dropped."
                        />

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                                onClick={save}
                                disabled={!dirty || hasErrs || saving || !configReadable}
                                title={
                                    configReadable
                                        ? undefined
                                        : 'Held: the current settings could not be read, and saving would overwrite them with a blank.'
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {saving ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Save className="h-3.5 w-3.5" />
                                )}
                                Save inference settings
                            </button>
                            <span className="text-[11px] text-text-tertiary">
                                {configReadable
                                    ? 'Takes effect on the next run — a run already in flight keeps the settings it started with.'
                                    : 'Saving is held until the current settings can be read — writing now would overwrite values nobody can see.'}
                            </span>
                        </div>

                        {saveNote && (
                            <div
                                className={`mt-2 text-[11px] ${
                                    saveNote.tone === 'ok' ? 'text-green-600' : 'text-red-600'
                                }`}
                            >
                                {saveNote.text}
                            </div>
                        )}
                        <p className="mt-2 text-[11px] text-text-tertiary">
                            Leave a field blank to clear the override and fall back to the
                            provider default.
                        </p>
                    </div>

                    {/* ---- consumption ---- */}
                    <h5 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                        Consumption · last {data?.window_days ?? 30} days
                    </h5>
                    <div className="rounded-[var(--card-radius)] border border-border bg-card-tint p-4">
                        <Row
                            label="Tokens in"
                            value={compactNumber(agent.llm.tokens_in)}
                            gloss="Everything the model read: prompt, bundle rows, prior turns. A token is roughly three quarters of a word."
                        />
                        <Row
                            label="Tokens out"
                            value={compactNumber(agent.llm.tokens_out)}
                            gloss="Everything it wrote. Output tokens usually cost several times more than input tokens."
                        />
                        <Row
                            label="Cache hits"
                            value={
                                agent.llm.cache_hit_rate_pct === null
                                    ? '—'
                                    : `${compactNumber(agent.llm.cached_tokens)} · ${pct(agent.llm.cache_hit_rate_pct)}`
                            }
                            gloss="Served from the prompt cache — cheaper and faster, because an identical prefix did not have to be re-read. The biggest cost lever you have."
                        />
                        <Row
                            label="Tokens per run"
                            value={
                                agent.llm.tokens_per_run === null
                                    ? '—'
                                    : compactNumber(agent.llm.tokens_per_run)
                            }
                            gloss="Rising numbers here usually mean the data bundle grew, not that the work did."
                        />
                        <Row
                            label="Cost"
                            value={inr(agent.llm.cost_inr, { compact: true })}
                            gloss={
                                agent.llm.cost_per_success_inr === null
                                    ? 'Total inference spend for this agent.'
                                    : `Total inference spend. ${inr(agent.llm.cost_per_success_inr)} per successful run — the Efficiency axis scores that between ₹${agent.efficiency_basis?.excellent_inr_per_success} and ₹${agent.efficiency_basis?.poor_inr_per_success}.`
                            }
                        />
                    </div>

                    {/* ---- latency ---- */}
                    <h5 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                        Latency
                    </h5>
                    <div className="rounded-[var(--card-radius)] border border-border bg-card-tint p-4">
                        <Row
                            label="p50"
                            value={ms(agent.llm.p50_duration_ms)}
                            gloss={`Half of runs finish under ${ms(agent.llm.p50_duration_ms)}. This is the typical experience.`}
                        />
                        <Row
                            label="p95"
                            value={ms(agent.llm.p95_duration_ms)}
                            gloss={`The slowest 5% take over ${ms(agent.llm.p95_duration_ms)}. Averages hide this; timeouts live here.`}
                        />
                        <Row
                            label="Self-reported confidence"
                            value={
                                agent.llm.avg_confidence !== null
                                    ? agent.llm.avg_confidence.toFixed(2)
                                    : runsError
                                      ? 'couldn’t read'
                                      : '—'
                            }
                            gloss={
                                runsError && agent.llm.avg_confidence === null
                                    ? 'Unknown — this figure is averaged from the run log, and that read failed. It is not "no confidence recorded".'
                                    : '0–1, as the agent scored its own answers. A hint, not a measurement — a confident model can still be wrong.'
                            }
                        />
                    </div>
                </section>
            </div>
        </div>
    );
}

/* ========================================================================== */
/* Small parts                                                                */
/* ========================================================================== */

/**
 * A READ THAT FAILED, said out loud, in the panel whose data is missing.
 *
 * Amber-600, never red. A red banner says "this agent is broken"; what actually
 * happened is that a query did not come back, which says nothing about the agent
 * at all. Conflating the two is the same class of lie as printing "no data" over
 * an unreadable axis — it is just a more alarming one.
 *
 * Inline, not a toast: a toast is gone in four seconds and the confident-looking
 * numbers it was warning about stay on screen for the rest of the session.
 */
function ReadFailure({
    title,
    reason,
    detail,
    code,
    onRetry,
    className = '',
}: {
    title: string;
    reason: string;
    detail?: string | null;
    code?: string | null;
    onRetry?: () => void;
    className?: string;
}) {
    return (
        <div
            role="status"
            className={`flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 ${className}`}
        >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
            <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-amber-700">{title}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">{reason}</p>
                {detail && (
                    <p className="mt-1 break-words font-mono text-[10px] leading-relaxed text-text-tertiary">
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

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
        >
            {children}
        </span>
    );
}

function SectionTitle({
    icon: Icon,
    title,
    caption,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    caption?: string;
}) {
    return (
        <div className="mb-3 flex items-baseline gap-2">
            <Icon className="h-4 w-4 translate-y-0.5 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            {caption && <span className="text-[11px] text-text-tertiary">{caption}</span>}
        </div>
    );
}

function Tile({
    icon: Icon,
    label,
    value,
    hint,
    title,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    hint?: string;
    title?: string;
}) {
    return (
        <div
            className="rounded-xl border border-border bg-card-tint px-3 py-2.5"
            title={title}
        >
            <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                <Icon className="h-3 w-3" />
                {label}
            </div>
            <div className="mt-1 text-lg font-bold leading-none tracking-tight text-foreground">
                {value}
            </div>
            {hint && <div className="mt-1 text-[10px] text-text-tertiary">{hint}</div>}
        </div>
    );
}

/** A read-only fact plus the sentence that teaches what it means. */
function Row({ label, value, gloss }: { label: string; value: string; gloss: string }) {
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
            <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-foreground">{label}</div>
                <p className="text-[11px] leading-relaxed text-text-tertiary">{gloss}</p>
            </div>
            <div className="flex-none font-mono text-sm text-text-primary">{value}</div>
        </div>
    );
}

function EditRow({
    label,
    gloss,
    value,
    onChange,
    error,
    placeholder,
    step,
    min,
    max,
}: {
    label: string;
    gloss: string;
    value: string;
    onChange: (v: string) => void;
    error?: string;
    placeholder?: string;
    step?: string;
    min?: number;
    max?: number;
}) {
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1.5">
            <div className="min-w-0 flex-1">
                <label className="text-xs font-semibold text-foreground">{label}</label>
                <p className="text-[11px] leading-relaxed text-text-tertiary">{gloss}</p>
                {error && <p className="text-[11px] text-red-600">{error}</p>}
            </div>
            <input
                type="number"
                inputMode="decimal"
                value={value}
                step={step}
                min={min}
                max={max}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                aria-label={label}
                className={`w-24 flex-none rounded-lg border bg-card px-2 py-1 text-right font-mono text-sm text-text-primary outline-none transition-colors focus:border-primary ${
                    error ? 'border-red-400' : 'border-border'
                }`}
            />
        </div>
    );
}
