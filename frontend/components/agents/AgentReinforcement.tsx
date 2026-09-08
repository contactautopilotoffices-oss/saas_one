'use client';

/**
 * AGENT REINFORCEMENT — how an agentic employee is trained by the people who
 * work with it.
 * =============================================================================
 * Two signals, and they are not the same signal:
 *
 *   COINS amplify. "You did that well" is worth something, and the ledger of
 *   those judgements IS the story of the agent's training — which is why the
 *   ledger is rendered as a narrative list, newest first, rather than hidden
 *   behind a total.
 *
 *   ROI FLAGS subtract differently. "That was not worth doing" is a distinct
 *   verdict from "you did it wrong": a perfectly executed task that was never in
 *   the company's interest is a SCOPING failure, and the fix is the goal, not
 *   the procedure. The API keeps it in its own column, its own counter and its
 *   own 20% term of the reliability score, so this screen keeps it in its own
 *   visual language too — amber, never red, and never blended into "failed".
 *
 * THE LOOP, MADE VISIBLE. A correction is not a verdict, it is instruction, and
 * it is worth zero coins. It lands with applied_to_prompt_version = NULL, which
 * makes the pending list a QUEUE rather than a log:
 *
 *      correction typed  →  pending  →  folded  →  new version  →  shadow
 *
 * The bottom panel is that queue. Folding composes the next system prompt from
 * the corrections that have waited, shows it as a REAL DIFF against the running
 * prompt, lets the operator edit it, and only then commits. Nothing is absorbed
 * silently: the same POST that saves the version stamps the corrections it
 * consumed, so a fold either happens completely or not at all.
 *
 * WHERE THE FOLD HAPPENS: ON THE SERVER. This component used to compile the next
 * prompt itself, by appending a markdown block to the current one — which meant
 * the reinforcement loop, the whole point of the feature, was string
 * concatenation in a browser. It now POSTs to the compose route and renders what
 * comes back. The real compiler is foldGuidance() in backend/lib/agents/compose.ts:
 * it edits rather than rewrites, refuses to weaken a containment rule, refuses a
 * rewrite that drops below 45% of the current prompt's length, and returns a
 * changelog naming every correction it absorbed. None of that can live here.
 *
 * WHAT DOES stay here is REVIEW. The operator reads a real diff, can edit the
 * result by hand, and commits deliberately. And when the compiler does not
 * answer, this panel SAYS SO and folds nothing — a local append dressed up as a
 * compiled prompt would be the same lie in a smaller font.
 *
 * Degrades calmly on { provisioned: false } — the reinforcement tables arrive
 * with migration 20260830000001_agent_runtime.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, ArrowRight, Check, ChevronDown, Coins, FileDiff, Flag,
    Loader2, Lock, MessageSquareQuote, Minus, Pencil, Plus, RefreshCw,
    Sparkles, ThumbsDown, ThumbsUp,
} from 'lucide-react';
import {
    AGENT_RUNTIME_MIGRATION,
    type AgentFeedbackSignal,
    type OemAgentFeedback,
} from '@/frontend/types/agentRuntime';

/* ========================================================================== */
/* Shapes                                                                      */
/* ========================================================================== */

interface LedgerEntry {
    id: string;
    agent_key: string;
    delta: number;
    balance_after: number;
    reason: string | null;
    feedback_id: string | null;
    run_id: string | null;
    created_at: string;
}

interface FeedbackResponse {
    provisioned: boolean;
    history?: OemAgentFeedback[];
    pending_guidance?: OemAgentFeedback[];
    pending_count?: number;
    ledger?: LedgerEntry[];
    error?: string;
}

interface RunSummary {
    id: string;
    agent_key: string;
    module: string | null;
    trigger: string;
    status: string;
    started_at: string;
    outcome_summary: string | null;
}

interface RegistryAgent {
    agent_key: string;
    display_name: string;
    status: string;
    system_prompt: string | null;
    system_prompt_version: number | null;
    coins_balance?: number | null;
    [k: string]: unknown;
}

export interface AgentReinforcementProps {
    orgId: string | null | undefined;
    agentKey: string;
    /** Pre-bind the composer to one run, e.g. from a run-detail drawer. */
    runId?: string | null;
    className?: string;
}

/* ========================================================================== */
/* The four signals                                                            */
/* ========================================================================== */

interface SignalSpec {
    key: AgentFeedbackSignal;
    label: string;
    verb: string;
    /** 'positive' pays, 'negative' costs, 'zero' teaches. */
    sign: 1 | -1 | 0;
    defaultMagnitude: number;
    Icon: React.ElementType;
    /** Tailwind classes for the selected state. */
    activeClass: string;
    idleClass: string;
    blurb: string;
    requiresGuidance: boolean;
    requiresReason: boolean;
}

const SIGNALS: SignalSpec[] = [
    {
        key: 'praise',
        label: 'Praise',
        verb: 'Praise this run',
        sign: 1,
        defaultMagnitude: 10,
        Icon: ThumbsUp,
        activeClass: 'border-emerald-500 bg-emerald-500/8 text-emerald-700',
        idleClass: 'border-border text-text-secondary hover:border-emerald-500/40 hover:text-emerald-700',
        blurb: 'The work was good and worth doing. Pays coins.',
        requiresGuidance: false,
        requiresReason: false,
    },
    {
        key: 'correction',
        label: 'Correct',
        verb: 'Tell it how to do this differently',
        sign: 0,
        defaultMagnitude: 0,
        Icon: Pencil,
        activeClass: 'border-primary bg-primary/8 text-primary',
        idleClass: 'border-border text-text-secondary hover:border-primary/40 hover:text-primary',
        blurb: 'Not a verdict — an instruction. Costs nothing, and joins the queue below.',
        requiresGuidance: true,
        requiresReason: false,
    },
    {
        key: 'reject',
        label: 'Reject',
        verb: 'Reject this run',
        sign: -1,
        defaultMagnitude: 5,
        Icon: ThumbsDown,
        activeClass: 'border-red-500 bg-red-500/8 text-red-700',
        idleClass: 'border-border text-text-secondary hover:border-red-500/40 hover:text-red-600',
        blurb: 'The job was done wrong. Costs coins.',
        requiresGuidance: false,
        requiresReason: false,
    },
    {
        key: 'roi_flag',
        label: 'Not in our ROI',
        verb: 'Flag this as work not worth doing',
        sign: -1,
        defaultMagnitude: 15,
        Icon: Flag,
        activeClass: 'border-amber-500 bg-amber-500/10 text-amber-700',
        idleClass: 'border-border text-text-secondary hover:border-amber-500/50 hover:text-amber-700',
        blurb: 'It may have been done perfectly — it should not have been done at all. Fix the goal, not the procedure.',
        requiresGuidance: false,
        requiresReason: true,
    },
];

const SIGNAL_BY_KEY = new Map(SIGNALS.map((s) => [s.key, s]));

/* ========================================================================== */
/* Diff                                                                        */
/* ========================================================================== */

type DiffKind = 'same' | 'add' | 'del';
interface DiffLine {
    kind: DiffKind;
    text: string;
}

/** Longest-common-subsequence line diff. Only ever called on a bounded window. */
function lcsDiff(a: string[], b: string[]): DiffLine[] {
    const n = a.length;
    const m = b.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ kind: 'same', text: a[i] });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ kind: 'del', text: a[i] });
            i++;
        } else {
            out.push({ kind: 'add', text: b[j] });
            j++;
        }
    }
    while (i < n) out.push({ kind: 'del', text: a[i++] });
    while (j < m) out.push({ kind: 'add', text: b[j++] });
    return out;
}

/**
 * Prompts run to thousands of lines, and LCS is O(n·m), so the common prefix and
 * suffix are trimmed first — which is exact and free for the append-shaped edit
 * a fold actually produces. Only the differing middle pays for the real diff,
 * and if that middle is still large it degrades to a block replacement rather
 * than locking the tab up.
 */
const DIFF_WINDOW = 400;

function diffLines(before: string, after: string): DiffLine[] {
    const a = before.split('\n');
    const b = after.split('\n');

    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;

    let suf = 0;
    while (
        suf < a.length - pre &&
        suf < b.length - pre &&
        a[a.length - 1 - suf] === b[b.length - 1 - suf]
    ) {
        suf++;
    }

    const aMid = a.slice(pre, a.length - suf);
    const bMid = b.slice(pre, b.length - suf);

    const out: DiffLine[] = [];
    for (let i = 0; i < pre; i++) out.push({ kind: 'same', text: a[i] });

    if (aMid.length <= DIFF_WINDOW && bMid.length <= DIFF_WINDOW) {
        out.push(...lcsDiff(aMid, bMid));
    } else {
        for (const l of aMid) out.push({ kind: 'del', text: l });
        for (const l of bMid) out.push({ kind: 'add', text: l });
    }

    for (let i = a.length - suf; i < a.length; i++) out.push({ kind: 'same', text: a[i] });
    return out;
}

/** Collapse long stretches of unchanged text so the change is what you see. */
const CONTEXT = 3;

function PromptDiff({ before, after }: { before: string; after: string }) {
    const rows = useMemo(() => {
        const lines = diffLines(before, after);
        const keep = new Array<boolean>(lines.length).fill(false);
        lines.forEach((l, i) => {
            if (l.kind === 'same') return;
            for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) {
                keep[k] = true;
            }
        });

        const out: Array<DiffLine | { kind: 'gap'; text: string }> = [];
        let hidden = 0;
        lines.forEach((l, i) => {
            if (keep[i]) {
                if (hidden > 0) {
                    out.push({ kind: 'gap', text: `${hidden} unchanged line${hidden === 1 ? '' : 's'}` });
                    hidden = 0;
                }
                out.push(l);
            } else {
                hidden++;
            }
        });
        if (hidden > 0) out.push({ kind: 'gap', text: `${hidden} unchanged line${hidden === 1 ? '' : 's'}` });
        return out;
    }, [before, after]);

    const added = rows.filter((r) => r.kind === 'add').length;
    const removed = rows.filter((r) => r.kind === 'del').length;

    return (
        <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center gap-3 border-b border-border bg-muted px-3 py-1.5 text-[11px] font-semibold">
                <span className="text-emerald-700">+{added} added</span>
                <span className="text-red-600">−{removed} removed</span>
                <span className="ml-auto text-text-tertiary">unchanged text is collapsed</span>
            </div>
            <div className="max-h-80 overflow-auto bg-card">
                <pre className="min-w-full font-mono text-[11px] leading-relaxed">
                    {rows.map((r, i) =>
                        r.kind === 'gap' ? (
                            <div key={i} className="bg-muted/60 px-3 py-1 text-center text-text-tertiary">
                                ⋯ {r.text} ⋯
                            </div>
                        ) : (
                            <div
                                key={i}
                                className={
                                    r.kind === 'add'
                                        ? 'whitespace-pre-wrap break-words bg-emerald-500/8 px-3 text-emerald-800'
                                        : r.kind === 'del'
                                            ? 'whitespace-pre-wrap break-words bg-red-500/8 px-3 text-red-700 line-through decoration-red-400/50'
                                            : 'whitespace-pre-wrap break-words px-3 text-text-secondary'
                                }
                            >
                                <span className="mr-2 select-none text-text-tertiary">
                                    {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}
                                </span>
                                {r.text || ' '}
                            </div>
                        ),
                    )}
                </pre>
            </div>
        </div>
    );
}

/* ========================================================================== */
/* Helpers                                                                     */
/* ========================================================================== */

function timeAgo(iso: string | null | undefined): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}

function runLabel(r: RunSummary): string {
    const when = new Date(r.started_at).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
    const outcome = r.outcome_summary ? ` — ${r.outcome_summary.slice(0, 60)}` : '';
    return `${when} · ${r.status}${outcome}`;
}

const INPUT_CLASS =
    'w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-text-tertiary focus:border-primary/50 focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted';

/* ========================================================================== */
/* Component                                                                   */
/* ========================================================================== */

export default function AgentReinforcement({
    orgId,
    agentKey,
    runId = null,
    className = '',
}: AgentReinforcementProps) {
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
    const [runs, setRuns] = useState<RunSummary[]>([]);
    const [agent, setAgent] = useState<RegistryAgent | null>(null);
    const [registryProvisioned, setRegistryProvisioned] = useState(true);

    const load = useCallback(async () => {
        if (!orgId) return;
        const qp = `orgId=${encodeURIComponent(orgId)}`;
        try {
            const [fRes, rRes, gRes] = await Promise.all([
                fetch(`/api/agents/feedback?${qp}&agentKey=${encodeURIComponent(agentKey)}&limit=50`),
                fetch(`/api/agents/runs?${qp}&agentKey=${encodeURIComponent(agentKey)}&limit=20`),
                fetch(`/api/agents/registry?${qp}`),
            ]);
            const [fJson, rJson, gJson] = await Promise.all([
                fRes.json().catch(() => null),
                rRes.json().catch(() => null),
                gRes.json().catch(() => null),
            ]);

            if (fJson) setFeedback(fJson as FeedbackResponse);
            if (rJson?.provisioned !== false && Array.isArray(rJson?.runs)) {
                setRuns(rJson.runs as RunSummary[]);
            }
            if (gJson) {
                setRegistryProvisioned(gJson.provisioned !== false);
                const found = (gJson.agents ?? []).find(
                    (a: RegistryAgent) => a.agent_key === agentKey,
                );
                setAgent(found ?? null);
            }
        } catch {
            /* leave the last good payload on screen */
        } finally {
            setLoading(false);
        }
    }, [orgId, agentKey]);

    useEffect(() => {
        void load();
    }, [load]);

    const provisioned = feedback?.provisioned !== false && registryProvisioned;
    const ledger = feedback?.ledger ?? [];
    const pending = useMemo(
        () => (feedback?.pending_guidance ?? []).filter((p) => !!p.guidance),
        [feedback],
    );

    // The ledger is authoritative for the balance; oem_agents.coins_balance is a
    // cache of it and is only used before the first ledger entry exists.
    const balance = ledger.length > 0 ? ledger[0].balance_after : Number(agent?.coins_balance ?? 0);
    const currentVersion = agent?.system_prompt_version ?? 0;

    if (!orgId) {
        return (
            <div className={className}>
                <UnprovisionedCard what="Agent reinforcement" />
            </div>
        );
    }

    if (loading) {
        return (
            <div className={`flex items-center gap-2 rounded-3xl border border-border bg-card px-5 py-8 text-sm text-text-secondary ${className}`}>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading the training record…
            </div>
        );
    }

    if (!provisioned) {
        return (
            <div className={className}>
                <UnprovisionedCard what="Agent reinforcement" />
            </div>
        );
    }

    return (
        <div className={`space-y-5 ${className}`}>
            <CoinsPanel
                balance={balance}
                ledger={ledger}
                agentName={agent?.display_name ?? agentKey}
            />

            <Composer
                orgId={orgId}
                agentKey={agentKey}
                runs={runs}
                initialRunId={runId}
                onDone={load}
            />

            <PendingGuidance
                orgId={orgId}
                agentKey={agentKey}
                agent={agent}
                pending={pending}
                currentVersion={currentVersion}
                onDone={load}
            />
        </div>
    );
}

function UnprovisionedCard({ what }: { what: string }) {
    return (
        <div className="flex items-start gap-3 rounded-3xl border border-dashed border-border bg-card-tint px-5 py-5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
            <div>
                <p className="text-sm font-semibold text-foreground">Not provisioned yet</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                    {what} starts recording once migration{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-text-secondary">
                        {AGENT_RUNTIME_MIGRATION}
                    </code>{' '}
                    has been applied.
                </p>
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* Coins + ledger                                                             */
/* -------------------------------------------------------------------------- */

function CoinsPanel({
    balance,
    ledger,
    agentName,
}: {
    balance: number;
    ledger: LedgerEntry[];
    agentName: string;
}) {
    return (
        <section className="overflow-hidden rounded-3xl border border-border bg-card">
            <div className="grid gap-0 md:grid-cols-[minmax(0,220px)_1fr]">
                {/* The number */}
                <div className="flex flex-col justify-center gap-1 border-b border-border bg-secondary/6 px-5 py-5 md:border-b-0 md:border-r">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary-dark">
                        <Coins className="h-3.5 w-3.5" /> Autopilot coins
                    </span>
                    <span className="text-4xl font-bold leading-none text-secondary tabular-nums">
                        {balance.toLocaleString()}
                    </span>
                    <span className="text-xs text-text-secondary">
                        earned by {agentName} across every judgement below
                    </span>
                </div>

                {/* The story */}
                <div>
                    <div className="border-b border-border px-4 py-2">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                            Training record — newest first
                        </span>
                    </div>
                    {ledger.length === 0 ? (
                        <p className="px-4 py-5 text-sm text-text-secondary">
                            Nothing yet. The first praise or rejection you record starts this
                            agent&apos;s ledger.
                        </p>
                    ) : (
                        <ul className="max-h-56 divide-y divide-border overflow-auto">
                            {ledger.map((e) => (
                                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                                    <span
                                        className={`inline-flex w-14 shrink-0 items-center justify-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-bold tabular-nums ${
                                            e.delta >= 0
                                                ? 'bg-secondary/12 text-secondary'
                                                : 'bg-red-500/8 text-red-600'
                                        }`}
                                    >
                                        {e.delta >= 0 ? (
                                            <Plus className="h-3 w-3" />
                                        ) : (
                                            <Minus className="h-3 w-3" />
                                        )}
                                        {Math.abs(e.delta)}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                        {e.reason || 'No reason recorded'}
                                    </span>
                                    <span className="shrink-0 text-[11px] text-text-tertiary">
                                        {timeAgo(e.created_at)}
                                    </span>
                                    <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-text-tertiary">
                                        → {e.balance_after}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </section>
    );
}

/* -------------------------------------------------------------------------- */
/* Composer                                                                   */
/* -------------------------------------------------------------------------- */

function Composer({
    orgId,
    agentKey,
    runs,
    initialRunId,
    onDone,
}: {
    orgId: string;
    agentKey: string;
    runs: RunSummary[];
    initialRunId: string | null;
    onDone: () => void | Promise<void>;
}) {
    const [signal, setSignal] = useState<AgentFeedbackSignal>('praise');
    const [selectedRun, setSelectedRun] = useState<string>(initialRunId ?? '');
    const [reason, setReason] = useState('');
    const [guidance, setGuidance] = useState('');
    const [magnitude, setMagnitude] = useState<string>('10');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);

    useEffect(() => {
        setSelectedRun(initialRunId ?? '');
    }, [initialRunId]);

    const spec = SIGNAL_BY_KEY.get(signal)!;

    const pick = (key: AgentFeedbackSignal) => {
        const s = SIGNAL_BY_KEY.get(key)!;
        setSignal(key);
        setMagnitude(String(s.defaultMagnitude));
        setError(null);
        setResult(null);
    };

    const signedCoins = spec.sign === 0 ? 0 : spec.sign * Math.abs(Number(magnitude) || 0);

    const submit = async () => {
        setError(null);
        setResult(null);

        if (spec.requiresGuidance && !guidance.trim()) {
            setError('Write the correction. Without it there is nothing for the next version to absorb.');
            return;
        }
        if (spec.requiresReason && !reason.trim()) {
            setError('Say why this work was not worth doing — that reason is what re-scopes the goal.');
            return;
        }
        if (spec.sign !== 0 && (!Number.isInteger(Number(magnitude)) || Math.abs(Number(magnitude)) > 500)) {
            setError('Coins must be a whole number, at most 500 in one go.');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`/api/agents/feedback?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentKey,
                    runId: selectedRun || null,
                    signal,
                    coins: signedCoins,
                    reason: reason.trim() || null,
                    guidance: guidance.trim() || null,
                }),
            });
            const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

            if (!res.ok || !json) {
                setError((json?.error as string) || `Could not record that (HTTP ${res.status}).`);
                return;
            }
            if (json.provisioned === false) {
                setError(`Reinforcement needs migration ${AGENT_RUNTIME_MIGRATION}.`);
                return;
            }

            const bits: string[] = [];
            const delta = Number(json.coins_delta ?? 0);
            if (delta !== 0) {
                bits.push(`${delta > 0 ? '+' : ''}${delta} coins`);
                if (json.coins_balance != null) bits.push(`balance ${json.coins_balance}`);
            }
            if (json.pending) bits.push(String(json.pending));
            if (json.coin_error) bits.push(String(json.coin_error));
            setResult(bits.join(' · ') || 'Recorded.');

            setReason('');
            setGuidance('');
            await onDone();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <section className="overflow-hidden rounded-3xl border border-border bg-card">
            <header className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <MessageSquareQuote className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                    <h3 className="text-sm font-bold text-foreground">Give this agent a signal</h3>
                    <p className="mt-0.5 text-xs text-text-secondary">
                        Bind it to the run you are judging, so the record says which piece of work
                        earned it.
                    </p>
                </div>
            </header>

            <div className="space-y-4 p-5">
                {/* ---- Which run */}
                <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                        About which run
                    </span>
                    <div className="relative">
                        <select
                            className={`${INPUT_CLASS} appearance-none pr-9`}
                            value={selectedRun}
                            onChange={(e) => setSelectedRun(e.target.value)}
                        >
                            <option value="">Not about a specific run</option>
                            {runs.map((r) => (
                                <option key={r.id} value={r.id}>
                                    {runLabel(r)}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                    </div>
                    {runs.length === 0 && (
                        <span className="mt-1 block text-[11px] text-text-tertiary">
                            No runs recorded yet — feedback will be filed against the agent itself.
                        </span>
                    )}
                </label>

                {/* ---- Which signal */}
                <div>
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                        What are you telling it
                    </span>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        {SIGNALS.map((s) => {
                            const active = s.key === signal;
                            const { Icon } = s;
                            return (
                                <button
                                    key={s.key}
                                    type="button"
                                    onClick={() => pick(s.key)}
                                    className={`rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                                        active ? s.activeClass : s.idleClass
                                    }`}
                                >
                                    <span className="flex items-center gap-1.5 text-sm font-bold">
                                        <Icon className="h-3.5 w-3.5" />
                                        {s.label}
                                    </span>
                                    <span className="mt-0.5 block text-[11px] font-normal leading-snug opacity-80">
                                        {s.blurb}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ---- The correction box, only where it belongs */}
                {spec.requiresGuidance && (
                    <label className="block">
                        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-primary">
                            How it should do this instead — required
                        </span>
                        <textarea
                            className={`${INPUT_CLASS} min-h-[90px] resize-y`}
                            value={guidance}
                            onChange={(e) => setGuidance(e.target.value)}
                            placeholder="e.g. Call the vendor before raising a second PO — never raise two POs for the same requisition on the same day."
                        />
                        <span className="mt-1 block text-[11px] text-text-tertiary">
                            Written in plain language. It waits in the queue below until you fold it
                            into the next prompt version.
                        </span>
                    </label>
                )}

                {/* ---- Reason + coins */}
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <label className="block">
                        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                            {spec.requiresReason ? 'Why was it not worth doing — required' : 'Reason'}
                        </span>
                        <input
                            className={INPUT_CLASS}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={
                                signal === 'praise'
                                    ? 'chased 4 vendors before 10am'
                                    : signal === 'roi_flag'
                                        ? 'called a site that had already confirmed'
                                        : 'what went wrong'
                            }
                        />
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
                            Coins
                        </span>
                        <div className="flex items-center gap-2">
                            <span
                                className={`w-7 shrink-0 text-center text-lg font-bold ${
                                    spec.sign > 0 ? 'text-secondary' : spec.sign < 0 ? 'text-red-600' : 'text-text-tertiary'
                                }`}
                            >
                                {spec.sign > 0 ? '+' : spec.sign < 0 ? '−' : '0'}
                            </span>
                            <input
                                className={`${INPUT_CLASS} w-24 tabular-nums`}
                                type="number"
                                min={0}
                                max={500}
                                value={spec.sign === 0 ? 0 : magnitude}
                                disabled={spec.sign === 0}
                                onChange={(e) => setMagnitude(e.target.value)}
                            />
                        </div>
                        <span className="mt-1 block text-[11px] text-text-tertiary">
                            {spec.sign === 0 ? 'A correction is instruction, not a verdict.' : 'Default for this signal.'}
                        </span>
                    </label>
                </div>

                {error && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/6 px-3 py-2 text-xs leading-relaxed text-red-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}
                {result && (
                    <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-700">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{result}</span>
                    </div>
                )}

                <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {spec.verb}
                </button>
            </div>
        </section>
    );
}

/* -------------------------------------------------------------------------- */
/* Pending guidance — the queue, and the fold                                 */
/* -------------------------------------------------------------------------- */

/**
 * What POST /api/agents/compose { mode:'fold' } returns.
 *
 * The fold mode is live in app/api/agents/compose/route.ts: it reads the running
 * prompt and the pending corrections, runs foldGuidance() server-side and
 * returns a proposal. It never saves — commit happens through the registry's
 * save_prompt with these applied_feedback_ids. When the call fails, beginFold()
 * below folds nothing and opens the running prompt for hand-editing instead.
 */
interface FoldResponse {
    provisioned?: boolean;
    next_prompt?: string | null;
    changelog?: string[] | null;
    applied_feedback_ids?: string[] | null;
    /** true = the deterministic append-fold produced this, no model was called. */
    mocked?: boolean;
    error?: string;
}

function PendingGuidance({
    orgId,
    agentKey,
    agent,
    pending,
    currentVersion,
    onDone,
}: {
    orgId: string;
    agentKey: string;
    agent: RegistryAgent | null;
    pending: OemAgentFeedback[];
    currentVersion: number;
    onDone: () => void | Promise<void>;
}) {
    const nextVersion = currentVersion + 1;
    const currentPrompt = agent?.system_prompt ?? '';

    const [open, setOpen] = useState(false);
    /** Collapsed by default: 2,000+ characters would bury the queue under it. */
    const [showPrompt, setShowPrompt] = useState(false);
    const [proposed, setProposed] = useState('');
    const [view, setView] = useState<'diff' | 'edit'>('diff');
    const [toShadow, setToShadow] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [folding, setFolding] = useState(false);
    const [changelog, setChangelog] = useState<string[]>([]);
    /**
     * The corrections the compiler actually folded in, as the server reported
     * them. These travel to save_prompt as `absorbed_feedback_ids`: the registry
     * ignores the old `absorb_feedback: true` flag, so without the explicit ids
     * the prompt saves and every correction stays pending for ever.
     */
    const [appliedIds, setAppliedIds] = useState<string[]>([]);
    /** How the text in `proposed` was produced. Never left to the reader to guess. */
    const [provenance, setProvenance] = useState<string | null>(null);

    /**
     * Ask the server to compile the next prompt version.
     *
     * The compiler is foldGuidance() in backend/lib/agents/compose.ts, reached
     * through the compose route. This function does not know how a correction
     * becomes a rule and must not learn: that logic is versioned, tested and
     * auditable on the server, and it is the same logic a nightly job would run.
     *
     * When the call fails, NOTHING IS FOLDED. The panel opens on the running
     * prompt, verbatim and labelled as such, so the operator can still hand-write
     * v(next) — and the corrections stay queued, because a fold that did not
     * happen must not stamp them as absorbed.
     */
    /**
     * OPEN THE PROMPT FOR HAND-EDITING, with no corrections queued.
     *
     * The panel used to render the whole prompt UI only inside the
     * `pending.length > 0` branch, so with an empty queue there was NO WAY to
     * see or change the running prompt — the operator could read "running on
     * version 1" and nothing else. Folding corrections is one way to write the
     * next version; typing it is the other, and it must not depend on someone
     * having complained first.
     *
     * appliedIds stays empty here on purpose: a hand-written version absorbs no
     * specific correction, so nothing gets stamped as absorbed.
     */
    const beginEdit = () => {
        setError(null);
        setDone(null);
        setChangelog([]);
        setAppliedIds([]);
        setProvenance(`v${currentVersion} exactly as the agent runs it today. Edit it to write v${nextVersion}.`);
        setProposed(currentPrompt);
        setView('edit');
        setToShadow(agent?.status === 'live');
        setOpen(true);
    };

    const beginFold = async () => {
        setError(null);
        setDone(null);
        setChangelog([]);
        setAppliedIds([]);
        setProvenance(null);
        // A live agent should prove a new prompt in shadow before it acts on it.
        setToShadow(agent?.status === 'live');
        setFolding(true);

        const failed = (why: string) => {
            setProposed(currentPrompt);
            setView('edit');
            setProvenance(null);
            // Hand-writing v(next) still resolves these corrections, so they are
            // still the ones to stamp when the operator commits.
            setAppliedIds(pending.map((p) => p.id));
            setError(
                `The prompt compiler did not run — ${why}. Nothing was folded. The text below is `
                + `v${currentVersion} exactly as the agent runs it today; edit it by hand to write `
                + `v${nextVersion}, or cancel and the ${pending.length} correction`
                + `${pending.length === 1 ? '' : 's'} stay in the queue.`,
            );
            setOpen(true);
        };

        try {
            // mode:'fold' is handled by app/api/agents/compose/route.ts, which
            // reads the running prompt plus the pending corrections and returns
            // foldGuidance()'s proposal. It never saves — commit() does that.
            const res = await fetch(`/api/agents/compose?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'fold',
                    agent_key: agentKey,
                    feedback_ids: pending.map((p) => p.id),
                }),
            });
            const json = (await res.json().catch(() => null)) as FoldResponse | null;

            if (json?.provisioned === false) {
                failed(`the agent runtime tables need migration ${AGENT_RUNTIME_MIGRATION}`);
                return;
            }
            const next = typeof json?.next_prompt === 'string' ? json.next_prompt : '';
            if (!res.ok || !next.trim()) {
                failed(
                    json?.error
                    || (res.status === 400
                        ? 'the compose route does not accept mode:"fold" yet'
                        : `the compose route answered HTTP ${res.status}`),
                );
                return;
            }

            setProposed(next);
            setChangelog((json?.changelog ?? []).filter((c) => c.trim()));
            // Fall back to what we sent only if the server named nothing: a
            // correction absorbed but never stamped reappears as pending for ever.
            setAppliedIds(
                json?.applied_feedback_ids?.length
                    ? json.applied_feedback_ids
                    : pending.map((p) => p.id),
            );
            setProvenance(
                json?.mocked
                    ? 'Compiled without a model — the corrections were appended as a standing-rules '
                      + 'block rather than woven into the prose. Read the diff carefully.'
                    : 'Compiled by the prompt compiler: it edits rather than rewrites, and it will '
                      + 'not drop a containment rule even if a correction asks it to.',
            );
            setView('diff');
            setOpen(true);
        } catch (e) {
            failed((e as Error).message);
        } finally {
            setFolding(false);
        }
    };

    const commit = async () => {
        setError(null);
        setDone(null);
        if (!agent?.display_name) {
            setError('This agent is not in the registry, so a prompt version cannot be saved.');
            return;
        }
        if (!proposed.trim()) {
            setError('The proposed prompt is empty.');
            return;
        }

        setCommitting(true);
        try {
            const res = await fetch(`/api/agents/registry?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_prompt',
                    agent_key: agentKey,
                    system_prompt: proposed,
                    note: `Folded ${pending.length} operator correction${pending.length === 1 ? '' : 's'}`,
                    absorbed_feedback_ids: appliedIds,
                }),
            });
            const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

            if (!res.ok || !json) {
                setError((json?.error as string) || `Could not save the version (HTTP ${res.status}).`);
                return;
            }
            if (json.provisioned === false) {
                setError(`Prompt versions need migration ${AGENT_RUNTIME_MIGRATION}.`);
                return;
            }
            if (json.unchanged) {
                setError('That is identical to the running prompt, so no new version was created.');
                return;
            }

            const version = json.version ?? nextVersion;
            const absorbed = Number(json.feedback_absorbed ?? 0);
            let tail = '';

            // Move a LIVE agent into shadow so the new version proves itself
            // before it can act. This is a second call, and it is reported
            // honestly whether or not it lands.
            if (toShadow && agent.status === 'live') {
                const sRes = await fetch(`/api/agents/registry?orgId=${encodeURIComponent(orgId)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'set_status',
                        agent_key: agentKey,
                        status: 'shadow',
                        reason: `Proving system prompt v${version}`,
                    }),
                });
                const sJson = (await sRes.json().catch(() => null)) as Record<string, unknown> | null;
                tail = sRes.ok && sJson && !sJson.error
                    ? ` It is now in shadow: it will reason on v${version} and log what it would do, but will not act until you set it live again.`
                    : ` It could NOT be moved to shadow (${(sJson?.error as string) || 'status change refused'}), so v${version} is live from its next run.`;
            } else {
                tail = ` v${version} is what it runs from its next run onward.`;
            }

            setDone(
                `Saved v${version}. ${absorbed} correction${absorbed === 1 ? '' : 's'} stamped as absorbed.${tail}`,
            );
            setOpen(false);
            await onDone();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setCommitting(false);
        }
    };

    return (
        <section className="overflow-hidden rounded-3xl border border-border bg-card">
            <header className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-foreground">System prompt &amp; guidance</h3>
                    <p className="mt-0.5 text-xs text-text-secondary">
                        What this agent is instructed to do, and the corrections not yet folded into it.
                    </p>
                </div>
                {pending.length > 0 && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                        {pending.length} waiting
                    </span>
                )}
            </header>

            {/* The loop, drawn once so the panel explains itself. */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card-tint px-5 py-2 text-[11px] font-medium text-text-tertiary">
                {['correction', 'pending', 'folded', 'new version', 'shadow'].map((step, i) => (
                    <React.Fragment key={step}>
                        {i > 0 && <ArrowRight className="h-3 w-3" />}
                        <span className={i === 1 && pending.length > 0 ? 'font-bold text-primary' : ''}>
                            {step}
                        </span>
                    </React.Fragment>
                ))}
            </div>

            <div className="p-5">
                {done && (
                    <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-xs leading-relaxed text-emerald-700">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{done}</span>
                    </div>
                )}

                {/* THE RUNNING PROMPT. Always on screen — an operator must be able
                    to read what the agent is actually instructed to do without first
                    having to file a complaint against it. */}
                {!open && (
                    <div className="mb-4 overflow-hidden rounded-2xl border border-border">
                        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card-tint px-3.5 py-2">
                            <span className="text-xs font-bold text-foreground">
                                Running system prompt · v{currentVersion}
                            </span>
                            <span className="text-[11px] text-text-tertiary">
                                {currentPrompt.trim().length
                                    ? `${currentPrompt.trim().length.toLocaleString()} characters`
                                    : 'Empty — this agent has no prompt yet'}
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowPrompt((v) => !v)}
                                className="ml-auto rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:text-foreground"
                            >
                                {showPrompt ? 'Hide' : 'Show'}
                            </button>
                        </div>
                        {showPrompt && (
                            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words bg-card px-3.5 py-3 font-mono text-[11px] leading-relaxed text-text-secondary">
{currentPrompt.trim() || 'No prompt has been written for this agent yet.'}
                            </pre>
                        )}
                    </div>
                )}

                {pending.length === 0 && !open ? (
                    <p className="text-sm text-text-secondary">
                        No corrections waiting. You can still{' '}
                        <button
                            type="button"
                            onClick={beginEdit}
                            className="font-semibold text-primary underline underline-offset-2"
                        >
                            write v{nextVersion} by hand
                        </button>{' '}
                        to give this agent extra instructions.
                    </p>
                ) : (
                    <>
                        {pending.length > 0 && (
                        <ul className="space-y-2">
                            {pending.map((p, i) => (
                                <li
                                    key={p.id}
                                    className="rounded-xl border border-border bg-card-tint px-3.5 py-2.5"
                                >
                                    <div className="flex items-start gap-2.5">
                                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[11px] font-bold text-primary">
                                            {i + 1}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm leading-relaxed text-foreground">{p.guidance}</p>
                                            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-tertiary">
                                                <span>{timeAgo(p.created_at)}</span>
                                                {p.reason && <span>· {p.reason}</span>}
                                                {p.run_id && <span>· run {p.run_id.slice(0, 8)}</span>}
                                                {p.roi_flag && (
                                                    <span className="rounded-full bg-amber-500/12 px-1.5 py-0.5 font-semibold text-amber-700">
                                                        ROI-flagged
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                        )}

                        {!open ? (
                            <div className="mt-4 flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={beginFold}
                                    disabled={folding}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                                >
                                    {folding ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <FileDiff className="h-3.5 w-3.5" />
                                    )}
                                    {folding ? 'Compiling…' : (
                                        <>
                                            Fold {pending.length} correction{pending.length === 1 ? '' : 's'} into
                                            version {nextVersion}
                                        </>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={beginEdit}
                                    disabled={folding}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-text-secondary transition-colors hover:text-foreground disabled:opacity-50"
                                >
                                    <FileDiff className="h-3.5 w-3.5" /> Write v{nextVersion} by hand
                                </button>
                                <span className="text-[11px] text-text-tertiary">
                                    The prompt compiler runs on the server; you see the diff before anything
                                    is committed. Version {currentVersion} keeps running until you promote.
                                </span>
                            </div>
                        ) : (
                            <div className="mt-4 space-y-3 rounded-2xl border border-primary/25 bg-primary/4 p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-bold text-foreground">
                                        Proposed system prompt · v{currentVersion} → v{nextVersion}
                                    </span>
                                    <div className="ml-auto flex overflow-hidden rounded-lg border border-border">
                                        {(['diff', 'edit'] as const).map((v) => (
                                            <button
                                                key={v}
                                                type="button"
                                                onClick={() => setView(v)}
                                                className={`px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors ${
                                                    view === v
                                                        ? 'bg-primary text-white'
                                                        : 'bg-card text-text-secondary hover:text-foreground'
                                                }`}
                                            >
                                                {v}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {provenance && (
                                    <p className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
                                        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                                        <span>{provenance}</span>
                                    </p>
                                )}

                                {changelog.length > 0 && (
                                    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                                        <p className="text-[11px] font-bold text-foreground">
                                            What the compiler changed
                                        </p>
                                        <ul className="mt-1.5 space-y-1">
                                            {changelog.map((line, i) => (
                                                <li
                                                    key={i}
                                                    className="flex items-start gap-1.5 text-[11px] leading-relaxed text-text-secondary"
                                                >
                                                    <Plus className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                                                    <span>{line}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {view === 'diff' ? (
                                    <PromptDiff before={currentPrompt} after={proposed} />
                                ) : (
                                    <textarea
                                        className={`${INPUT_CLASS} min-h-[280px] resize-y font-mono text-[11px] leading-relaxed`}
                                        value={proposed}
                                        onChange={(e) => setProposed(e.target.value)}
                                        spellCheck={false}
                                    />
                                )}

                                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
                                    <input
                                        type="checkbox"
                                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                                        checked={toShadow}
                                        disabled={agent?.status !== 'live'}
                                        onChange={(e) => setToShadow(e.target.checked)}
                                    />
                                    <span className="text-xs leading-relaxed text-text-secondary">
                                        <strong className="text-foreground">
                                            Move to shadow while v{nextVersion} proves itself
                                        </strong>
                                        <br />
                                        {agent?.status === 'live'
                                            ? 'It keeps reasoning and logging what it would do, but stops acting until you set it live again. Recommended: a new prompt has never been observed on real work.'
                                            : `This agent is currently '${agent?.status ?? 'unknown'}', not live, so there is nothing to hold back.`}
                                    </span>
                                </label>

                                {error && (
                                    <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/6 px-3 py-2 text-xs leading-relaxed text-red-700">
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={commit}
                                        disabled={committing}
                                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                                    >
                                        {committing ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Check className="h-3.5 w-3.5" />
                                        )}
                                        Commit v{nextVersion}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setOpen(false)}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-text-secondary transition-colors hover:text-foreground"
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" /> Cancel
                                    </button>
                                    <span className="text-[11px] text-text-tertiary">
                                        v{currentVersion} stays untouched in the council log and stays
                                        recoverable.
                                    </span>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}
