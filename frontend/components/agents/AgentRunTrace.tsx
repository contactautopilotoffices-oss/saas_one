'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle,
    Bell,
    Brain,
    ChevronDown,
    ChevronRight,
    Database,
    Download,
    GitBranch,
    ListChecks,
    Loader2,
    PenLine,
    ShieldCheck,
    ShieldOff,
    Sparkles,
    Wrench,
    X,
} from 'lucide-react';
import {
    AGENT_MODULE_LABELS,
    AGENT_RUNTIME_MIGRATION,
    isAgentModule,
    type AgentStepType,
    type OemAgentRun,
    type OemAgentRunStep,
} from '@/frontend/types/agentRuntime';

/**
 * AGENT RUN TRACE — the step-by-step record of one invocation.
 * =============================================================================
 * This is the drawer behind a row of AgentActivity's table. The table is the
 * index; this is the detail. That separation is deliberate: a runs table that
 * tries to show the trace inline stops being scannable, and a trace squeezed
 * into a cell stops being readable.
 *
 * Three things make this debuggable rather than decorative:
 *
 *   1. PROVENANCE IN THE HEADER. model, temperature, top_p, context window,
 *      prompt version, bundle version — the exact configuration that produced
 *      this behaviour. "The agent gave a weird answer" is unanswerable; "the
 *      agent gave a weird answer at temperature 0.9 on prompt v3" is a fix.
 *
 *   2. PER-STEP COST. Each line carries its own duration and tokens, so the
 *      operator can see that the slow run was one tool call, not the model.
 *      `share_pct` comes from the API, computed against the run's wall clock
 *      so parallel steps do not sum past 100%.
 *
 *   3. LIVE. A run still in flight polls every 3s and the trace grows under
 *      the operator's eyes. An activity feed that only fills in once the work
 *      is over is a report, not a feed.
 *
 * Contract: GET /api/agents/runs/[runId]?orgId= -> { provisioned, run, steps, rollup }.
 * The runtime tables may not exist yet; `provisioned: false` renders a calm
 * "run the migration" panel, never an error boundary.
 */

/* --------------------------------------------------------------------------
 * Props.
 *
 * orgId + agentKey are the shared agent-component contract. runId/onClose are
 * what actually drive the drawer, and both are optional so this file also
 * type-checks when mounted with the bare { orgId, agentKey } pair — with no
 * run selected there is nothing to trace, and it renders nothing.
 * ------------------------------------------------------------------------ */
export interface AgentRunTraceProps {
    orgId: string;
    agentKey: string;
    /** The run to trace. Null/undefined closes the drawer. */
    runId?: string | null;
    onClose?: () => void;
}

/** Steps come back enriched with their share of the run's wall clock. */
interface TraceStep extends OemAgentRunStep {
    share_pct?: number | null;
}

/** The run row, plus the two joins the API adds. */
interface TraceRun extends OemAgentRun {
    agent_name?: string | null;
    department?: string | null;
}

interface TraceRollup {
    steps: number;
    failed_steps: number;
    total_step_ms: number;
    unaccounted_ms: number | null;
    tokens_in: number;
    tokens_out: number;
    slowest_step: { seq: number; label: string; duration_ms: number } | null;
    heaviest_step: { seq: number; label: string; tokens: number } | null;
}

/** Slow enough not to hammer the API, fast enough that the trace feels live. */
const POLL_MS = 3000;

/* --------------------------------------------------------------------------
 * Formatting. Kept local — this component is self-contained by assignment.
 * ------------------------------------------------------------------------ */

function fmtDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '—';
    const n = Number(ms);
    if (n < 1000) return `${Math.round(n)}ms`;
    if (n < 60_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}s`;
    const mins = Math.floor(n / 60_000);
    const secs = Math.round((n % 60_000) / 1000);
    return secs ? `${mins}m ${secs}s` : `${mins}m`;
}

function fmtTokens(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    if (v < 1000) return String(Math.round(v));
    if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
    return `${(v / 1_000_000).toFixed(1)}M`;
}

/** INR is the operating currency; USD is the fallback when a run priced only in USD. */
function fmtCost(inr: number | null | undefined, usd: number | null | undefined): string {
    const r = Number(inr);
    if (Number.isFinite(r) && r > 0) {
        return `₹${r < 1 ? r.toFixed(2) : r.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    }
    const u = Number(usd);
    if (Number.isFinite(u) && u > 0) return `$${u < 0.01 ? u.toFixed(4) : u.toFixed(2)}`;
    return '—';
}

function fmtClock(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString([], {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
}

const moduleLabel = (m: string | null | undefined): string | null =>
    !m ? null : isAgentModule(m) ? AGENT_MODULE_LABELS[m] : m;

/* --------------------------------------------------------------------------
 * Step vocabulary. Nine types, each with an icon and a tint — the trace should
 * be readable by shape before it is read by word.
 * ------------------------------------------------------------------------ */

const STEP_ICON: Record<AgentStepType, React.ComponentType<{ className?: string }>> = {
    plan: ListChecks,
    think: Brain,
    llm: Sparkles,
    tool: Wrench,
    fetch: Download,
    write: PenLine,
    notify: Bell,
    decide: GitBranch,
    error: AlertTriangle,
};

const STEP_TINT: Record<AgentStepType, string> = {
    plan: 'text-primary',
    think: 'text-text-secondary',
    llm: 'text-secondary',
    tool: 'text-primary',
    fetch: 'text-text-secondary',
    write: 'text-secondary',
    notify: 'text-primary',
    decide: 'text-text-secondary',
    error: 'text-red-600',
};

const RUN_STATUS_STYLE: Record<string, { label: string; className: string }> = {
    running: { label: 'Running', className: 'bg-primary/10 text-primary border-primary/20' },
    succeeded: { label: 'Succeeded', className: 'bg-green-600/10 text-green-700 border-green-600/20' },
    failed: { label: 'Failed', className: 'bg-red-600/10 text-red-700 border-red-600/20' },
    timeout: { label: 'Timed out', className: 'bg-amber-600/10 text-amber-700 border-amber-600/20' },
    skipped: { label: 'Skipped', className: 'bg-muted text-text-tertiary border-border' },
};

const hasDetail = (d: unknown): d is Record<string, unknown> =>
    !!d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d as object).length > 0;

/* ==========================================================================
 * Component
 * ======================================================================== */

export default function AgentRunTrace({ orgId, agentKey, runId, onClose }: AgentRunTraceProps) {
    const [run, setRun] = useState<TraceRun | null>(null);
    const [steps, setSteps] = useState<TraceStep[]>([]);
    const [rollup, setRollup] = useState<TraceRollup | null>(null);
    const [loading, setLoading] = useState(false);
    const [live, setLive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [provisioned, setProvisioned] = useState(true);
    /** Explicit user toggles only. Absent means "use the default for this status". */
    const [toggled, setToggled] = useState<Record<string, boolean>>({});
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    /* ----------------------------------------------------------------------
     * Load, then poll while the run is still in flight.
     *
     * The poll replaces the step array rather than appending to it: the API
     * returns every step ordered by seq, and a re-read also picks up a step
     * that has transitioned running -> ok, which a pure append would miss.
     * The interval is cleared the moment status leaves 'running', when runId
     * changes, and on unmount — three ways out, no leaked timer.
     * -------------------------------------------------------------------- */
    useEffect(() => {
        if (!runId || !orgId) return;

        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        const stop = () => {
            if (timer) { clearInterval(timer); timer = null; }
            if (!cancelled) setLive(false);
        };

        const fetchOnce = async (quiet: boolean) => {
            if (!quiet) setLoading(true);
            try {
                const url = `/api/agents/runs/${encodeURIComponent(runId)}?orgId=${encodeURIComponent(orgId)}`;
                const res = await fetch(url, { cache: 'no-store' });
                const json = await res.json().catch(() => ({}));
                if (cancelled) return;

                if (!res.ok) {
                    setError(typeof json?.error === 'string' ? json.error : `Could not load this run (${res.status})`);
                    stop();
                    return;
                }

                setError(null);
                setProvisioned(json?.provisioned !== false);
                setRun((json?.run ?? null) as TraceRun | null);
                setSteps(Array.isArray(json?.steps) ? (json.steps as TraceStep[]) : []);
                setRollup((json?.rollup ?? null) as TraceRollup | null);

                const stillRunning = json?.run?.status === 'running' && json?.provisioned !== false;
                if (stillRunning) setLive(true);
                else stop();
            } catch (e) {
                if (cancelled) return;
                setError((e as Error).message || 'Network error');
                stop();
            } finally {
                if (!cancelled && !quiet) setLoading(false);
            }
        };

        // A new run starts from a clean slate rather than flashing the previous one's trace.
        setRun(null);
        setSteps([]);
        setRollup(null);
        setToggled({});
        setError(null);
        setProvisioned(true);

        void fetchOnce(false);
        timer = setInterval(() => { void fetchOnce(true); }, POLL_MS);

        return () => { cancelled = true; if (timer) clearInterval(timer); };
    }, [runId, orgId]);

    /* Escape closes, and the page behind the drawer stops scrolling under it. */
    useEffect(() => {
        if (!runId) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = previousOverflow;
        };
    }, [runId, onClose]);

    if (!runId || !mounted || typeof document === 'undefined') return null;

    const status = String(run?.status ?? '');
    const statusStyle = RUN_STATUS_STYLE[status] ?? RUN_STATUS_STYLE.skipped;
    const title = run?.agent_name || agentKey;
    const mod = moduleLabel(run?.module);

    /* Provenance chips — only what the run actually recorded. A chip showing
       "temperature —" teaches the operator nothing; its absence is the signal. */
    const provenance: Array<{ label: string; value: string }> = [];
    if (run) {
        if (run.model) provenance.push({ label: 'model', value: run.provider ? `${run.provider}/${run.model}` : run.model });
        if (run.temperature !== null && run.temperature !== undefined) provenance.push({ label: 'temperature', value: String(run.temperature) });
        if (run.top_p !== null && run.top_p !== undefined) provenance.push({ label: 'top_p', value: String(run.top_p) });
        if (run.context_window) provenance.push({ label: 'context', value: fmtTokens(run.context_window) });
        if (run.max_tokens) provenance.push({ label: 'max out', value: fmtTokens(run.max_tokens) });
        if (run.prompt_version !== null && run.prompt_version !== undefined) provenance.push({ label: 'prompt', value: `v${run.prompt_version}` });
        if (run.bundle_version !== null && run.bundle_version !== undefined) provenance.push({ label: 'bundle', value: `v${run.bundle_version}` });
    }

    const tokensIn = run?.tokens_in ?? rollup?.tokens_in ?? null;
    const tokensOut = run?.tokens_out ?? rollup?.tokens_out ?? null;
    const cached = Number(run?.cached_tokens ?? 0);

    return createPortal(
        <div className="fixed inset-0 z-[80]">
            <div
                className="absolute inset-0 bg-foreground/35 backdrop-blur-[2px]"
                onClick={() => onClose?.()}
                aria-hidden
            />

            <aside
                role="dialog"
                aria-modal="true"
                aria-label="Agent run trace"
                className="absolute right-0 top-0 bottom-0 w-full max-w-[560px] bg-card border-l border-border
                           shadow-2xl flex flex-col animate-slide-up"
            >
                {/* ---------------------------------------------------------------
                    HEADER — who ran, what happened, and under which configuration.
                --------------------------------------------------------------- */}
                <header className="px-5 pt-4 pb-3 border-b border-border">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-[15px] font-semibold text-text-primary truncate">{title}</h2>
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border
                                                  text-[11px] font-medium ${statusStyle.className}`}>
                                    {status === 'running' && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                    )}
                                    {statusStyle.label}
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-text-tertiary truncate">
                                {[mod, run?.trigger, fmtClock(run?.started_at)].filter(Boolean).join(' · ')}
                                {run?.duration_ms ? ` · ${fmtDuration(run.duration_ms)}` : ''}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => onClose?.()}
                            aria-label="Close run trace"
                            className="p-2 -mr-1 rounded-xl text-text-secondary hover:bg-muted transition-colors shrink-0"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {provenance.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {provenance.map((p) => (
                                <span
                                    key={p.label}
                                    className="inline-flex items-baseline gap-1 px-2 py-1 rounded-lg bg-muted
                                               text-[11px] leading-none"
                                >
                                    <span className="text-text-tertiary">{p.label}</span>
                                    <span className="font-mono text-text-primary">{p.value}</span>
                                </span>
                            ))}
                        </div>
                    )}

                    {run?.outcome_summary && (
                        <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">{run.outcome_summary}</p>
                    )}
                </header>

                {/* ---------------------------------------------------------------
                    BODY — the trace.
                --------------------------------------------------------------- */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {!provisioned ? (
                        <NotProvisioned />
                    ) : loading && !run ? (
                        <div className="flex items-center gap-2 text-sm text-text-tertiary py-10 justify-center">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading trace…
                        </div>
                    ) : error ? (
                        <div className="rounded-2xl border border-border bg-muted/60 p-4">
                            <p className="text-sm font-medium text-text-primary">Could not load this run</p>
                            <p className="mt-1 text-xs text-text-secondary">{error}</p>
                        </div>
                    ) : (
                        <>
                            {run?.error && (
                                <div className="mb-4 rounded-2xl border border-red-600/20 bg-red-600/5 p-3">
                                    <p className="text-xs font-semibold text-red-700">
                                        {run.error_class || 'Run failed'}
                                    </p>
                                    <p className="mt-1 text-xs text-text-secondary break-words">{run.error}</p>
                                </div>
                            )}

                            {steps.length === 0 ? (
                                <p className="text-sm text-text-tertiary py-8 text-center">
                                    {status === 'running'
                                        ? 'Waiting for the first step…'
                                        : 'This run recorded no steps.'}
                                </p>
                            ) : (
                                <ol className="relative">
                                    {steps.map((step, i) => (
                                        <StepRow
                                            key={step.id ?? `${step.seq}-${i}`}
                                            step={step}
                                            isLast={i === steps.length - 1}
                                            open={toggled[step.id ?? String(step.seq)] ?? step.status === 'failed'}
                                            onToggle={() =>
                                                setToggled((prev) => {
                                                    const key = step.id ?? String(step.seq);
                                                    const current = prev[key] ?? step.status === 'failed';
                                                    return { ...prev, [key]: !current };
                                                })
                                            }
                                        />
                                    ))}
                                </ol>
                            )}

                            {live && (
                                <p className="mt-2 pl-9 flex items-center gap-2 text-[11px] text-text-tertiary">
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                                    Live — refreshing every {POLL_MS / 1000}s
                                </p>
                            )}
                        </>
                    )}
                </div>

                {/* ---------------------------------------------------------------
                    FOOTER — what the run consumed.
                --------------------------------------------------------------- */}
                {provisioned && run && (
                    <footer className="border-t border-border bg-card-tint px-5 py-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <dl className="flex items-center gap-4 text-[11px]">
                                <div>
                                    <dt className="text-text-tertiary">Tokens</dt>
                                    <dd className="font-mono text-[13px] text-text-primary">
                                        {fmtTokens(tokensIn)}<span className="text-text-tertiary"> → </span>{fmtTokens(tokensOut)}
                                    </dd>
                                </div>
                                <div
                                    title="Cache hits: input tokens served from the prompt cache. They were billed at the cached rate, which is a fraction of a fresh read of the same prompt."
                                    className="cursor-help"
                                >
                                    <dt className="text-text-tertiary underline decoration-dotted underline-offset-2">
                                        Cache hits
                                    </dt>
                                    <dd className="font-mono text-[13px] text-text-primary">
                                        {cached > 0 ? fmtTokens(cached) : '—'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-text-tertiary">Cost</dt>
                                    <dd className="font-mono text-[13px] text-text-primary">
                                        {fmtCost(run.cost_inr, run.cost_usd)}
                                    </dd>
                                </div>
                            </dl>

                            {run.grounded === true ? (
                                <span
                                    title="Every claim in this run traced back to a row in an active-bundle table."
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border
                                               border-green-600/20 bg-green-600/10 text-[11px] font-medium text-green-700"
                                >
                                    <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                                    Grounded
                                </span>
                            ) : run.grounded === false ? (
                                <span
                                    title="At least one claim in this run could not be traced back to bundle data."
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border
                                               border-amber-600/20 bg-amber-600/10 text-[11px] font-medium text-amber-700"
                                >
                                    <ShieldOff className="w-3.5 h-3.5 text-amber-600" />
                                    Ungrounded
                                </span>
                            ) : (
                                <span className="text-[11px] text-text-tertiary">Grounding not recorded</span>
                            )}
                        </div>

                        {rollup && rollup.steps > 0 && (
                            <p className="mt-2 text-[11px] text-text-tertiary">
                                {rollup.steps} step{rollup.steps === 1 ? '' : 's'}
                                {rollup.failed_steps > 0 && <span className="text-red-700"> · {rollup.failed_steps} failed</span>}
                                {rollup.slowest_step && (
                                    <> · slowest: {rollup.slowest_step.label} ({fmtDuration(rollup.slowest_step.duration_ms)})</>
                                )}
                                {rollup.unaccounted_ms !== null && rollup.unaccounted_ms > 250 && (
                                    <>
                                        {' · '}
                                        <span title="Time inside the run that no step claimed: queueing, serialisation, or an unlogged wait.">
                                            {fmtDuration(rollup.unaccounted_ms)} unaccounted
                                        </span>
                                    </>
                                )}
                            </p>
                        )}
                    </footer>
                )}
            </aside>
        </div>,
        document.body,
    );
}

/* ==========================================================================
 * One line of the trace.
 * ======================================================================== */

function StepRow({
    step, isLast, open, onToggle,
}: {
    step: TraceStep;
    isLast: boolean;
    open: boolean;
    onToggle: () => void;
}) {
    const type = (step.step_type ?? 'think') as AgentStepType;
    const Icon = STEP_ICON[type] ?? Brain;
    const failed = step.status === 'failed';
    const running = step.status === 'running';
    const skipped = step.status === 'skipped';
    const expandable = hasDetail(step.detail);
    const tokens = (step.tokens_in ?? 0) + (step.tokens_out ?? 0);

    return (
        <li className="relative pl-9 pb-4 last:pb-0">
            {/* The thin rule that makes a list of lines read as one sequence. */}
            {!isLast && <span className="absolute left-[13px] top-8 bottom-0 w-px bg-border" aria-hidden />}

            <span
                className={`absolute left-0 top-0 w-[27px] h-[27px] rounded-full border grid place-items-center
                            ${failed ? 'border-red-600/30 bg-red-600/10'
                                : running ? 'border-primary/30 bg-primary/10 animate-pulse'
                                    : 'border-border bg-card'}`}
                aria-hidden
            >
                <Icon className={`w-[13px] h-[13px] ${failed ? 'text-red-600' : running ? 'text-primary' : STEP_TINT[type]}`} />
            </span>

            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    {expandable ? (
                        <button
                            type="button"
                            onClick={onToggle}
                            aria-expanded={open}
                            className="group flex items-start gap-1 text-left"
                        >
                            {open
                                ? <ChevronDown className="w-3.5 h-3.5 mt-[3px] text-text-tertiary shrink-0" />
                                : <ChevronRight className="w-3.5 h-3.5 mt-[3px] text-text-tertiary shrink-0" />}
                            <span className={`text-[13px] leading-snug group-hover:underline decoration-dotted underline-offset-2
                                              ${failed ? 'text-red-700' : skipped ? 'text-text-tertiary' : 'text-text-primary'}`}>
                                {step.label}
                            </span>
                        </button>
                    ) : (
                        <span className={`block text-[13px] leading-snug pl-[18px]
                                          ${failed ? 'text-red-700' : skipped ? 'text-text-tertiary' : 'text-text-primary'}`}>
                            {step.label}
                        </span>
                    )}

                    <span className="block pl-[18px] mt-0.5 text-[11px] text-text-tertiary">
                        {type}
                        {running && <span className="text-primary"> · running</span>}
                        {skipped && ' · skipped'}
                        {typeof step.share_pct === 'number' && step.share_pct >= 5 && (
                            <> · {step.share_pct}% of run</>
                        )}
                    </span>
                </div>

                <div className="text-right shrink-0 pt-0.5">
                    <span className="block text-[12px] font-mono text-text-secondary">
                        {running ? '…' : fmtDuration(step.duration_ms)}
                    </span>
                    {tokens > 0 && (
                        <span className="block text-[11px] font-mono text-text-tertiary">
                            {fmtTokens(step.tokens_in)}→{fmtTokens(step.tokens_out)}
                        </span>
                    )}
                </div>
            </div>

            {expandable && open && (
                <pre className="mt-2 ml-[18px] rounded-xl bg-muted border border-border p-3 overflow-x-auto
                                font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words">
                    {safeJson(step.detail)}
                </pre>
            )}
        </li>
    );
}

/** A step's detail is operator-supplied jsonb; never let a cycle or a BigInt kill the drawer. */
function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? '—';
    } catch {
        return String(value);
    }
}

function NotProvisioned() {
    return (
        <div className="rounded-2xl border border-border bg-muted/50 p-5 text-center">
            <Database className="w-5 h-5 mx-auto text-text-tertiary" />
            <p className="mt-2 text-sm font-medium text-text-primary">Not provisioned yet</p>
            <p className="mt-1 text-xs text-text-secondary">
                Run migration <span className="font-mono">{AGENT_RUNTIME_MIGRATION}</span> to start
                recording agent run traces.
            </p>
        </div>
    );
}
