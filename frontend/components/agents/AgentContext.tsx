'use client';

/**
 * CONTEXT — the two things an operator can put into an agent's prompt.
 *
 *   RESPONSE EXAMPLES  a handful of ideal input -> output pairs. The agent is
 *                      shown them as real turns before the live one, so it
 *                      copies a shape it has seen rather than a shape described
 *                      to it in prose.
 *   ORG FACTS          what is true here on every run — site codes, owners, the
 *                      vendor shortlist, approval thresholds — pinned once
 *                      instead of re-derived or re-explained on each call.
 *
 * THE ONE THING THIS SCREEN EXISTS TO MAKE VISIBLE: both are paid for on EVERY
 * call, forever. An example is not an upload, it is a standing order. So the
 * token count and the ₹ per run sit next to the editor and move as you type, and
 * the projection multiplies by this agent's own measured run count — because
 * "₹0.02 a run" and "₹18 a month, every month" are the same fact and only the
 * second one is a decision.
 *
 * ESTIMATES ARE LABELLED AS ESTIMATES. The server derives tokens as chars/4 plus
 * a per-message allowance; that is a rule of thumb, not a tokenizer, and it is
 * printed as one. The real figure is the tokens_in already recorded per run.
 *
 * SELF-CONTAINED by design: props are (orgId, agentKey), everything else comes
 * from /api/agents/context. It mounts anywhere an agent is selected without the
 * host screen having to know anything about examples or caps.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Coins, Loader2, Plus, Quote, Trash2 } from 'lucide-react';
import type { AgentBakedContext, AgentResponseExample } from '@/frontend/types/agentRuntime';

interface Caps {
    max_examples: number;
    max_example_chars: number;
    max_example_chars_total: number;
    max_baked_chars: number;
    why: string;
}

interface Estimate {
    method: string;
    examples_count: number;
    estimated_input_tokens: number;
    model: string;
    input_rate_usd_per_mtok: number;
    rate_is_fallback: boolean;
    estimated_inr_per_call: number;
    runs_per_month: number;
    estimated_inr_per_month: number;
}

interface Payload {
    provisioned: boolean;
    migration?: string;
    context: { response_examples: AgentResponseExample[]; baked_context: AgentBakedContext | null };
    caps?: Caps;
    estimate?: Estimate;
    runs_basis?: { source: 'measured_30d' | 'default'; runs_per_month: number; note?: string };
    preview?: { system_addition: string; unchanged?: boolean };
    error?: string;
}

const newId = () => `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export default function AgentContext({
    orgId, agentKey, onSaved,
}: {
    orgId: string; agentKey: string; onSaved?: () => void;
}) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<Payload | null>(null);
    const [examples, setExamples] = useState<AgentResponseExample[]>([]);
    const [facts, setFacts] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await fetch(
                `/api/agents/context?orgId=${encodeURIComponent(orgId)}&agentKey=${encodeURIComponent(agentKey)}`,
            );
            const json = (await res.json()) as Payload;
            if (json.error) { setError(json.error); return; }
            setData(json);
            setExamples(json.context?.response_examples ?? []);
            setFacts(json.context?.baked_context?.facts ?? '');
        } catch (e) { setError((e as Error).message); }
        finally { setLoading(false); }
    }, [orgId, agentKey]);

    useEffect(() => { void load(); }, [load]);

    const caps = data?.caps;
    const est = data?.estimate;

    /**
     * The local meter, so the price moves while typing instead of only after a
     * save. Same arithmetic as the server (chars/4) on purpose — a client figure
     * derived differently from the server's would leave two numbers on screen
     * disagreeing about the same block. The server's estimate is authoritative
     * and replaces this the moment a save returns.
     */
    const live = useMemo(() => {
        const exChars = examples.reduce((n, e) => n + e.input.trim().length + e.output.trim().length, 0);
        const chars = exChars + facts.trim().length;
        const tokens = Math.ceil(chars / 4) + examples.length * 8;
        const rate = est?.input_rate_usd_per_mtok ?? 0;
        const inrPerCall = (tokens * rate / 1e6) * 88;
        const runs = data?.runs_basis?.runs_per_month ?? est?.runs_per_month ?? 0;
        return {
            exChars, chars, tokens,
            inrPerCall,
            inrPerMonth: inrPerCall * runs,
            runs,
            overTotal: exChars > (caps?.max_example_chars_total ?? Infinity),
            overBaked: facts.trim().length > (caps?.max_baked_chars ?? Infinity),
        };
    }, [examples, facts, est, caps, data]);

    /** Nothing configured must stay a real, reachable state — it is the default. */
    const isEmpty = live.exChars === 0 && facts.trim().length === 0;

    const atExampleCap = caps ? examples.length >= caps.max_examples : false;
    const blocked = live.overTotal || live.overBaked;

    const addExample = () =>
        setExamples((xs) => (atExampleCap ? xs : [...xs, { id: newId(), input: '', output: '' }]));

    const patch = (id: string, k: 'input' | 'output' | 'note', v: string) =>
        setExamples((xs) => xs.map((x) => (x.id === id ? { ...x, [k]: v } : x)));

    const save = async () => {
        setSaving(true); setError(null); setSaved(false);
        try {
            const res = await fetch(`/api/agents/context?orgId=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agent_key: agentKey,
                    // Half-written pairs teach nothing and cost the same as a whole
                    // one, so they are dropped here rather than stored and skipped.
                    response_examples: examples
                        .map((e) => ({ ...e, input: e.input.trim(), output: e.output.trim() }))
                        .filter((e) => e.input && e.output),
                    baked_context: facts.trim() ? { facts: facts.trim(), reviewed_at: new Date().toISOString().slice(0, 10) } : null,
                }),
            });
            const json = (await res.json()) as Payload;
            if (json.error) { setError(json.error); return; }
            setData((d) => ({ ...(d as Payload), ...json }));
            setExamples(json.context?.response_examples ?? []);
            setFacts(json.context?.baked_context?.facts ?? '');
            setSaved(true);
            onSaved?.();
        } catch (e) { setError((e as Error).message); }
        finally { setSaving(false); }
    };

    const field = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] focus:border-primary/40 focus:outline-none';
    const label = 'block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5';
    const card = 'rounded-[14px] border border-border bg-card p-4';

    if (loading) {
        return (
            <div className={`${card} flex items-center gap-2 text-[12.5px] text-text-tertiary`}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading prompt context…
            </div>
        );
    }

    if (data && !data.provisioned) {
        return (
            <div className={`${card} text-[12.5px] text-text-tertiary`}>
                Not provisioned yet — run migration <code className="font-mono">{data.migration}</code>.
                Examples and pinned facts live in <code className="font-mono">oem_agents.runtime</code>.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* ---- the meter. First, because it is the decision. ---------------- */}
            <section className={card}>
                <h4 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    <Coins className="h-3.5 w-3.5" /> What this costs, every call
                </h4>
                {isEmpty ? (
                    <p className="text-[12.5px] text-text-tertiary">
                        Nothing pinned. This agent&apos;s prompt is exactly what it has always been —
                        adding nothing here changes nothing, by design.
                    </p>
                ) : (
                    <>
                        <div className="grid gap-3 sm:grid-cols-4">
                            <Metric label="Est. tokens" value={live.tokens.toLocaleString('en-IN')} sub="added to every call" />
                            <Metric label="Est. ₹ / run" value={`₹${live.inrPerCall.toFixed(4)}`} sub={est?.model ?? ''} />
                            <Metric label="Runs / month" value={live.runs.toLocaleString('en-IN')}
                                sub={data?.runs_basis?.source === 'measured_30d' ? 'measured, last 30d' : 'assumed — no run history'} />
                            <Metric label="Est. ₹ / month" value={`₹${live.inrPerMonth.toFixed(2)}`} sub="standing, until removed" />
                        </div>
                        <p className="mt-3 text-[10.5px] leading-relaxed text-text-tertiary">
                            <strong>These are estimates.</strong> Tokens are derived as characters ÷ 4 plus a small
                            per-message allowance — a rule of thumb, not the model&apos;s tokenizer, and typically
                            10–20% off on dense or non-English text. Priced at the <em>input</em> rate
                            {est ? ` ($${est.input_rate_usd_per_mtok}/M tokens for ${est.model})` : ''}, because an
                            example&apos;s answer is prompt, not generation. The exact figure is the tokens_in already
                            recorded against each run.
                            {est?.rate_is_fallback && ' This model has no billed rate on file, so a deliberately pessimistic one is used.'}
                        </p>
                    </>
                )}
            </section>

            {/* ---- examples ---------------------------------------------------- */}
            <section className={card}>
                <div className="mb-3 flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                        <Quote className="h-3.5 w-3.5" /> Response examples
                    </h4>
                    <button
                        type="button"
                        onClick={addExample}
                        disabled={atExampleCap}
                        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11.5px] font-medium disabled:opacity-40"
                    >
                        <Plus className="h-3 w-3" /> Add
                    </button>
                </div>
                <p className="mb-3 text-[11px] leading-relaxed text-text-tertiary">
                    Show the agent what a good answer looks like. It copies format, length and tone — not facts:
                    nothing in an example may be quoted as evidence. Cap of {caps?.max_examples ?? '—'};{' '}
                    {live.exChars.toLocaleString('en-IN')} / {caps?.max_example_chars_total.toLocaleString('en-IN') ?? '—'} characters used.
                    {' '}{caps?.why}
                </p>

                {examples.length === 0 && (
                    <p className="text-[12px] text-text-tertiary">None. The agent is told its format in prose only.</p>
                )}

                <div className="flex flex-col gap-3">
                    {examples.map((ex, i) => (
                        <div key={ex.id} className="rounded-[12px] border border-border/70 p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                                    Example {i + 1}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setExamples((xs) => xs.filter((x) => x.id !== ex.id))}
                                    className="text-text-tertiary hover:text-red-500"
                                    aria-label={`Remove example ${i + 1}`}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                    <label className={label}>They send</label>
                                    <textarea
                                        rows={4} className={field} value={ex.input}
                                        maxLength={caps?.max_example_chars}
                                        placeholder="Which PO is this against?"
                                        onChange={(e) => patch(ex.id, 'input', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className={label}>A good answer</label>
                                    <textarea
                                        rows={4} className={field} value={ex.output}
                                        maxLength={caps?.max_example_chars}
                                        placeholder={'PO-25/26-0173, raised 04 Jun against Mahir Enterprises…'}
                                        onChange={(e) => patch(ex.id, 'output', e.target.value)}
                                    />
                                </div>
                            </div>
                            <input
                                className={`${field} mt-2`} value={ex.note ?? ''}
                                placeholder="Why this example is here (never sent to the model)"
                                onChange={(e) => patch(ex.id, 'note', e.target.value)}
                            />
                        </div>
                    ))}
                </div>
            </section>

            {/* ---- baked context ----------------------------------------------- */}
            <section className={card}>
                <h4 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Org facts, pinned
                </h4>
                <p className="mb-2 text-[11px] leading-relaxed text-text-tertiary">
                    What is true here on every run: site codes, who owns what, the vendor shortlist, approval
                    thresholds. Written once instead of re-explained per call. This block is <strong>data</strong> —
                    it adds facts and can never relax a rule in the agent&apos;s own instructions, and lines that
                    would read as a new instruction section are stripped before sending.
                </p>
                <textarea
                    rows={8}
                    className={`${field} font-mono text-[12px]`}
                    value={facts}
                    maxLength={caps?.max_baked_chars}
                    placeholder={'SITES: SSP = SS Plaza, Gurugram · WSQ-BLR = Work Square Bengaluru\nAPPROVALS: > ₹50,000 needs Saniel; > ₹2,00,000 needs the CEO\nVENDORS (shortlisted): Mahir Enterprises, R.L.C Interiors'}
                    onChange={(e) => setFacts(e.target.value)}
                />
                <p className="mt-1 text-[10.5px] text-text-tertiary">
                    {facts.trim().length.toLocaleString('en-IN')} / {caps?.max_baked_chars.toLocaleString('en-IN') ?? '—'} characters.
                </p>
            </section>

            {/* ---- exactly what will be sent ------------------------------------ */}
            {data?.preview?.system_addition ? (
                <section className={card}>
                    <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                        Appended to the prompt, as saved
                    </h4>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
                        {data.preview.system_addition.trim()}
                    </pre>
                </section>
            ) : null}

            {/* ---- save --------------------------------------------------------- */}
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={save}
                    disabled={saving || blocked}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"
                >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Save context
                </button>
                {saved && !saving && <span className="text-[12px] text-emerald-600">Saved. Live within a few minutes.</span>}
                {blocked && (
                    <span className="flex items-center gap-1 text-[12px] text-amber-600">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Over the cap — shorten before saving.
                    </span>
                )}
                {error && (
                    <span className="flex items-center gap-1 text-[12px] text-red-500">
                        <AlertTriangle className="h-3.5 w-3.5" /> {error}
                    </span>
                )}
            </div>
        </div>
    );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
    return (
        <div className="rounded-[12px] border border-border/70 px-3 py-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</div>
            <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{value}</div>
            <div className="text-[10.5px] text-text-tertiary">{sub}</div>
        </div>
    );
}
