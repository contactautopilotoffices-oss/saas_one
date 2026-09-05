'use client';

/**
 * AGENT PLAN CANVAS — the workflow an agent would run, before it runs.
 *
 * Renders what /api/agents/plan returns: the questions that must be answered
 * first, the ordered steps as a dependency graph, the tools each step needs
 * (connected or missing), and the humans in the loop.
 *
 * WHY A COLUMN GRAPH AND NOT A FREE CANVAS. A plan is a DAG with a topological
 * order, so the honest layout is by depth: everything in column N depends only
 * on columns < N. Free-dragging nodes would let a user arrange a picture that
 * contradicts the dependencies. Edges are drawn from real `needs` entries, so
 * the picture cannot disagree with the plan.
 */

import { useMemo, useState } from 'react';
import AgentFlowCanvas from '@/frontend/components/agents/AgentFlowCanvas';
import {
    AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, Database, Globe,
    GitBranch, PenLine, Send, ShieldCheck, Sparkles, Users, Wrench, XCircle,
} from 'lucide-react';

/* ---- shapes (mirror backend/lib/agents/plan.ts) ------------------------- */

export type PlanStepKind =
    | 'resolve' | 'search' | 'fetch' | 'decide' | 'draft' | 'approve' | 'write' | 'notify';

export interface PlanSlot {
    key: string; question: string; why: string;
    from: 'operator' | 'table' | 'policy' | 'catalog';
    lookup?: string | null; options?: string[] | null; required: boolean;
    allowAll?: boolean; fanOut?: boolean; multi?: boolean;
}

/** Must match ALL_SCOPE_OPTION in backend/lib/agents/plan.ts. */
const ALL_SCOPE_OPTION = 'All properties';
export interface PlanStep {
    id: string; title: string; kind: PlanStepKind; needs: string[];
    tool: string | null; tables: string[]; actor: string; produces: string;
    blockedBy: string[];
}
export interface ToolBinding {
    slug: string; label: string; purpose: string;
    status: 'connected' | 'missing'; requires: string[];
}
export interface AgentPlan {
    intent: string; module: string | null; source: 'rules' | 'model';
    slots: PlanSlot[]; steps: PlanStep[]; tools: ToolBinding[];
    roles: { name: string; does: string }[]; notes: string[];
}

/* ---- per-kind presentation ---------------------------------------------- */

const KIND: Record<PlanStepKind, { label: string; icon: typeof Database; ring: string; chip: string }> = {
    resolve: { label: 'Resolve',  icon: CircleHelp,  ring: 'border-amber-300',   chip: 'bg-amber-50 text-amber-700 border-amber-200' },
    search:  { label: 'Search',   icon: Globe,       ring: 'border-sky-300',     chip: 'bg-sky-50 text-sky-700 border-sky-200' },
    fetch:   { label: 'Read',     icon: Database,    ring: 'border-slate-300',   chip: 'bg-slate-50 text-slate-700 border-slate-200' },
    decide:  { label: 'Decide',   icon: GitBranch,   ring: 'border-violet-300',  chip: 'bg-violet-50 text-violet-700 border-violet-200' },
    draft:   { label: 'Draft',    icon: PenLine,     ring: 'border-indigo-300',  chip: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    approve: { label: 'Approval', icon: ShieldCheck, ring: 'border-rose-300',    chip: 'bg-rose-50 text-rose-700 border-rose-200' },
    write:   { label: 'Write',    icon: Wrench,      ring: 'border-emerald-300', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    notify:  { label: 'Notify',   icon: Send,        ring: 'border-teal-300',    chip: 'bg-teal-50 text-teal-700 border-teal-200' },
};

/** Topological depth. Cycles are impossible from the composer, but a bad edge
 *  must not hang the renderer — unresolved nodes fall to the last column. */
function columnsOf(steps: PlanStep[]): PlanStep[][] {
    const depth = new Map<string, number>();
    const byId = new Map(steps.map((s) => [s.id, s]));
    let changed = true;
    let guard = 0;
    steps.forEach((s) => depth.set(s.id, 0));
    while (changed && guard++ < 50) {
        changed = false;
        for (const s of steps) {
            const d = Math.max(0, ...s.needs.map((n) => (byId.has(n) ? (depth.get(n) ?? 0) + 1 : 0)));
            if (d !== depth.get(s.id)) { depth.set(s.id, d); changed = true; }
        }
    }
    const max = Math.max(0, ...[...depth.values()]);
    const cols: PlanStep[][] = Array.from({ length: max + 1 }, () => []);
    for (const s of steps) cols[depth.get(s.id) ?? 0].push(s);
    return cols.filter((c) => c.length);
}

/* ------------------------------------------------------------------------- */

export default function AgentPlanCanvas({ plan }: { plan: AgentPlan }) {
    const cols = useMemo(() => columnsOf(plan.steps), [plan.steps]);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [selected, setSelected] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);

    const required = plan.slots.filter((s) => s.required);
    // A multi slot with every box cleared is NOT answered — an empty required
    // multi-select is the same false-completion as an empty text box.
    const answered = required.filter((s) => {
        const v = (answers[s.key] ?? '').trim();
        return s.multi ? v.split('|').filter(Boolean).length > 0 : v.length > 0;
    }).length;
    const ready = answered === required.length;

    const toolBySlug = useMemo(
        () => new Map(plan.tools.map((t) => [t.slug, t])),
        [plan.tools],
    );

    return (
        <div className="flex flex-col gap-4">

            {/* ---- header ------------------------------------------------- */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <span className="text-[13px] font-semibold">Proposed workflow</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        plan.source === 'rules'
                            ? 'border-slate-200 bg-slate-50 text-slate-600'
                            : 'border-violet-200 bg-violet-50 text-violet-700'}`}>
                        {plan.source === 'rules' ? 'rule-based · no model ran' : 'model-enriched'}
                    </span>
                </div>
                <div className="flex items-center gap-2 text-[12px]">
                    <span className={ready ? 'text-emerald-600' : 'text-amber-600'}>
                        {answered}/{required.length} questions answered
                    </span>
                    <button
                        type="button"
                        disabled={!ready}
                        className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${
                            ready
                                ? 'bg-foreground text-background'
                                : 'cursor-not-allowed bg-muted text-text-tertiary'}`}
                    >
                        {ready ? 'Accept plan' : 'Answer to continue'}
                    </button>
                </div>
            </div>

            {/* ---- notes -------------------------------------------------- */}
            {plan.notes.length > 0 && (
                <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <ul className="space-y-1 text-[12px] leading-relaxed text-amber-800">
                            {plan.notes.map((n, i) => <li key={i}>{n}</li>)}
                        </ul>
                    </div>
                </div>
            )}

            {/* ---- 1. the questions --------------------------------------- */}
            <section className="rounded-[16px] border border-border bg-card p-4">
                <h4 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Before it can act
                </h4>
                <p className="mb-3 text-[12px] text-text-secondary">
                    Facts the request did not carry. These are not preferences — the agent cannot
                    infer them safely, so it must ask.
                </p>
                <div className="grid gap-2.5 md:grid-cols-2">
                    {plan.slots.map((s) => (
                        <div key={s.key} className="rounded-[12px] border border-border bg-card-tint p-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[12.5px] font-medium">{s.question}</span>
                                {s.required
                                    ? <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600">required</span>
                                    : <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-text-tertiary">optional</span>}
                            </div>
                            <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">{s.why}</p>
                            {s.options?.length && s.multi ? (
                                /* CHECKBOXES, NOT A DROPDOWN.
                                   A single-select forces a false choice: "which anomaly types"
                                   has one honest answer — all of them — and a <select> cannot
                                   say it. Select all is first because it is usually right. */
                                <div className="mt-2 rounded-lg border border-border bg-card p-2">
                                    {(() => {
                                        const chosen = (answers[s.key] ?? '').split('|').filter(Boolean);
                                        const all = s.options ?? [];
                                        const allOn = chosen.length === all.length && all.length > 0;
                                        const set = (next: string[]) =>
                                            setAnswers((a) => ({ ...a, [s.key]: next.join('|') }));
                                        return (
                                            <>
                                                <label className="flex cursor-pointer items-center gap-2 border-b border-border px-1.5 pb-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={allOn}
                                                        ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && !allOn; }}
                                                        onChange={() => set(allOn ? [] : [...all])}
                                                    />
                                                    <span className="text-[12.5px] font-semibold">
                                                        All {all.length}
                                                    </span>
                                                </label>
                                                <div className="max-h-44 overflow-y-auto pt-1.5">
                                                    {all.map((o) => (
                                                        <label key={o} className="flex cursor-pointer items-center gap-2 px-1.5 py-1">
                                                            <input
                                                                type="checkbox"
                                                                checked={chosen.includes(o)}
                                                                onChange={() =>
                                                                    set(chosen.includes(o)
                                                                        ? chosen.filter((x) => x !== o)
                                                                        : [...chosen, o])}
                                                            />
                                                            <span className="text-[12.5px]">{o}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                                <div className="border-t border-border px-1.5 pt-1.5 text-[11px] text-text-tertiary">
                                                    {chosen.length === 0
                                                        ? 'Pick at least one — this is required.'
                                                        : `${chosen.length} of ${all.length} selected`}
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            ) : s.options?.length ? (
                                <>
                                    {/* A long list (catalogue) gets type-ahead; a short one
                                        (sites) gets a plain select, which is faster to use. */}
                                    {s.options.length > 25 ? (
                                        <>
                                            <input
                                                list={`opts-${s.key}`}
                                                value={answers[s.key] ?? ''}
                                                onChange={(e) => setAnswers((a) => ({ ...a, [s.key]: e.target.value }))}
                                                placeholder={`Search ${s.options.length} options…`}
                                                className="mt-2 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12px]"
                                            />
                                            <datalist id={`opts-${s.key}`}>
                                                {s.options.map((o) => <option key={o} value={o} />)}
                                            </datalist>
                                        </>
                                    ) : (
                                        <select
                                            value={answers[s.key] ?? ''}
                                            onChange={(e) => setAnswers((a) => ({ ...a, [s.key]: e.target.value }))}
                                            className="mt-2 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12px]"
                                        >
                                            <option value="">Choose…</option>
                                            {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    )}
                                </>
                            ) : (
                                <input
                                    value={answers[s.key] ?? ''}
                                    onChange={(e) => setAnswers((a) => ({ ...a, [s.key]: e.target.value }))}
                                    placeholder={s.from === 'table' ? `no rows in ${s.lookup} — type one` : 'Type an answer'}
                                    className="mt-2 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12px]"
                                />
                            )}
                            {s.fanOut && (answers[s.key] ?? '').startsWith(ALL_SCOPE_OPTION) && (
                                <div className="mt-1.5 rounded-[8px] border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-800">
                                    Fans out: the workflow runs <strong>once per site</strong>, raising a separate
                                    requisition for each. Budget, approver and delivery address cannot be shared
                                    across sites.
                                </div>
                            )}
                            <div className="mt-1.5 text-[10.5px] text-text-tertiary">
                                source: {s.from}{s.lookup ? ` · ${s.lookup}` : ''}
                                {s.options?.length
                                    ? ` · ${s.options.length - (s.allowAll ? 1 : 0)} sites${s.allowAll ? ' + all' : ''}`
                                    : ''}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ---- 2. the graph — editable ---------------------------------- */}
            <section className="rounded-[16px] border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                        The workflow · {plan.steps.length} steps
                    </h4>
                    <button type="button" onClick={() => setEditing((v) => !v)}
                        className="rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium hover:border-primary/40">
                        {editing ? 'Read-only view' : 'Edit the flow'}
                    </button>
                </div>
                {editing && (
                    <AgentFlowCanvas steps={plan.steps} tools={plan.tools} />
                )}
                {!editing && (
                <div className="overflow-x-auto pb-2">
                    <div className="flex items-stretch gap-3" style={{ minWidth: 'min-content' }}>
                        {cols.map((col, ci) => (
                            <div key={ci} className="flex items-center gap-3">
                                <div className="flex w-[230px] shrink-0 flex-col gap-2.5">
                                    {col.map((s) => {
                                        const k = KIND[s.kind];
                                        const Icon = k.icon;
                                        const tool = s.tool ? toolBySlug.get(s.tool) : null;
                                        const open = selected === s.id;
                                        return (
                                            <button
                                                key={s.id}
                                                type="button"
                                                onClick={() => setSelected(open ? null : s.id)}
                                                className={`rounded-[14px] border-2 bg-card p-3 text-left transition hover:shadow-sm ${k.ring} ${open ? 'shadow-md' : ''}`}
                                            >
                                                <div className="flex items-center gap-1.5">
                                                    <Icon className="h-3.5 w-3.5 text-text-secondary" />
                                                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${k.chip}`}>
                                                        {k.label}
                                                    </span>
                                                    {s.blockedBy.length > 0 && (
                                                        <span className="ml-auto rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[10px] text-amber-700">
                                                            blocked
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-1.5 text-[12.5px] font-medium leading-snug">{s.title}</div>
                                                <div className="mt-1 text-[11px] text-text-tertiary">{s.actor}</div>

                                                {tool && (
                                                    <div className="mt-2 flex items-center gap-1">
                                                        {tool.status === 'connected'
                                                            ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                                            : <XCircle className="h-3 w-3 text-rose-500" />}
                                                        <span className={`text-[10.5px] ${tool.status === 'connected' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                            {tool.label}
                                                        </span>
                                                    </div>
                                                )}

                                                {open && (
                                                    <div className="mt-2 border-t border-border pt-2">
                                                        <p className="text-[11px] leading-relaxed text-text-secondary">{s.produces}</p>
                                                        {s.tables.length > 0 && (
                                                            <div className="mt-1.5 flex flex-wrap gap-1">
                                                                {s.tables.map((t) => (
                                                                    <span key={t} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{t}</span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {s.blockedBy.length > 0 && (
                                                            <div className="mt-1.5 text-[10.5px] text-amber-700">
                                                                waits on: {s.blockedBy.join(', ')}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                                {ci < cols.length - 1 && (
                                    <ArrowRight className="h-4 w-4 shrink-0 text-text-tertiary" />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
                )}
            </section>

            {/* ---- 3. tools + roles --------------------------------------- */}
            <div className="grid gap-3 md:grid-cols-2">
                <section className="rounded-[16px] border border-border bg-card p-4">
                    <h4 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                        <Wrench className="h-3.5 w-3.5" /> Tools · {plan.tools.filter(t => t.status === 'connected').length}/{plan.tools.length} connected
                    </h4>
                    <div className="space-y-2">
                        {plan.tools.map((t) => (
                            <div key={t.slug} className="flex items-start gap-2 rounded-[10px] border border-border bg-card-tint px-2.5 py-2">
                                {t.status === 'connected'
                                    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                    : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
                                <div className="min-w-0">
                                    <div className="text-[12px] font-medium">{t.label}</div>
                                    <div className="text-[11px] text-text-secondary">{t.purpose}</div>
                                    {t.status === 'missing' && (
                                        <div className="mt-0.5 font-mono text-[10px] text-rose-600">
                                            set {t.requires.join(', ')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-[16px] border border-border bg-card p-4">
                    <h4 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                        <Users className="h-3.5 w-3.5" /> People in the loop
                    </h4>
                    <div className="space-y-2">
                        {plan.roles.map((r) => (
                            <div key={r.name} className="rounded-[10px] border border-border bg-card-tint px-2.5 py-2">
                                <div className="text-[12px] font-medium">{r.name}</div>
                                <div className="text-[11px] text-text-secondary">{r.does}</div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
