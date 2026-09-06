'use client';

/**
 * COUNCIL — the eight specialists, who reports to whom, and what they said.
 * -----------------------------------------------------------------------------
 * Two things live here that live nowhere else in the console:
 *
 *   1. REPORTING LINE. This runtime agent reports to one council persona. Set
 *      it, and that persona vets every run before the mail goes out; the
 *      verdict lands on the digest header and in the council log below.
 *
 *   2. THE PERSONA — the one prompt in this system a model actually executes.
 *      Editing it changes the next convene, the next inbox reply and the next
 *      vetting. It is versioned and council-logged like a prompt change,
 *      because it is one.
 *
 * Everything is org-scoped through /api/agents/council; nothing here touches
 * the master-admin council routes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Crown, Loader2, Save, ShieldCheck, Users } from 'lucide-react';

interface Verdict {
    id: string; agent_key: string; summary: string; decision: string; created_at: string;
    details: { verdict?: string; reasoning?: string; concerns?: Array<{ finding_key: string | null; concern: string; suggestion: string }>; findings_reviewed?: number; cost_usd?: number; window?: string };
}
interface Persona {
    key: string; name: string; title: string; email: string; lens: string; persona: string; color: string;
    sort: number; is_active: boolean; persona_version: number | null; updated_at: string | null; persona_chars: number;
    reports: Array<{ agent_key: string; display_name: string; status: string }>;
    verdicts: Verdict[];
}
interface Payload {
    provisioned: boolean;
    error?: string;
    agents: Persona[];
    runtime_agents: Array<{ agent_key: string; display_name: string; reports_to: string | null }>;
    /** A 401 on first paint is transient — offer a retry rather than a dead end. */
    retryable?: boolean;
}

const VERDICT_TONE: Record<string, string> = {
    sound: 'bg-emerald-500/12 text-emerald-700',
    sound_with_concerns: 'bg-amber-500/12 text-amber-700',
    needs_human: 'bg-red-500/12 text-red-700',
};

export default function AgentCouncil({ orgId, agentKey, agentName, reportsTo, onReportsToChange }: {
    orgId: string; agentKey: string; agentName: string;
    reportsTo: string | null;
    /** Persist { reports_to } on the runtime. Delivery's save path is reused. */
    onReportsToChange: (key: string | null) => Promise<void> | void;
}) {
    const [data, setData] = useState<Payload | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);
    const [pickSaving, setPickSaving] = useState(false);

    /**
     * Normalise before it reaches state.
     *
     * The route can answer with three different shapes: the full payload, a
     * `{ error, provisioned:false }` body when the council tables are missing,
     * and a bare `{ error }` on 401/403 — and a 401 is NORMAL on first paint,
     * because the tab can render before the session cookie is attached. Storing
     * any of those raw meant `data.agents` was undefined while the hooks below
     * still ran (hooks run before the early returns), which is exactly the
     * crash. Nothing enters state without an `agents` array.
     */
    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/agents/council?orgId=${encodeURIComponent(orgId)}`, { cache: 'no-store' });
            const raw = (await res.json().catch(() => null)) as Partial<Payload> | null;
            if (!res.ok || !raw || !Array.isArray(raw.agents)) {
                setData({
                    provisioned: false,
                    error: raw?.error ?? (res.status === 401 ? 'Not signed in yet.' : `Council unavailable (HTTP ${res.status}).`),
                    agents: [],
                    runtime_agents: [],
                    retryable: res.status === 401,
                });
                return;
            }
            setData({ provisioned: true, agents: raw.agents, runtime_agents: raw.runtime_agents ?? [] });
        } catch (e) {
            setData({ provisioned: false, error: (e as Error).message, agents: [], runtime_agents: [], retryable: true });
        }
    }, [orgId]);
    useEffect(() => { void load(); }, [load]);

    const mine = useMemo(() => (data?.agents ?? []).find((a) => a.key === reportsTo) ?? null, [data, reportsTo]);

    const savePersona = async (p: Persona) => {
        const text = draft[p.key] ?? p.persona;
        setSaving(p.key); setMsg(null);
        try {
            const res = await fetch(`/api/agents/council?orgId=${encodeURIComponent(orgId)}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: p.key, persona: text, note: 'Edited in Agent Console' }),
            });
            const j = await res.json();
            if (!res.ok || j.error) { setMsg({ key: p.key, text: j.error ?? `HTTP ${res.status}`, ok: false }); return; }
            setMsg({ key: p.key, text: j.unchanged ? 'No change.' : `Saved as v${j.version}. Next convene, reply and vetting use it.`, ok: true });
            setDraft((d) => { const n = { ...d }; delete n[p.key]; return n; });
            await load();
        } finally { setSaving(null); }
    };

    const pick = async (key: string | null) => {
        setPickSaving(true);
        try { await onReportsToChange(key); await load(); } finally { setPickSaving(false); }
    };

    if (!data) return <div className="flex items-center gap-2 p-6 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" /> Loading the council…</div>;
    if (!data.provisioned) return (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/8 p-4 text-sm text-amber-800">
            <AlertTriangle className="mr-1.5 inline h-4 w-4" />
            {data.retryable ? 'Could not load the council.' : 'Council tables are not provisioned for this org.'}{' '}
            {data.error}
            {data.retryable && (
                <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline underline-offset-2">
                    Retry
                </button>
            )}
        </div>
    );

    return (
        <div className="flex flex-col gap-4">
            {/* ---- reporting line ---------------------------------------------- */}
            <section className="rounded-2xl border border-border bg-card p-4">
                <h4 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    <Crown className="h-3.5 w-3.5" /> Reporting line
                </h4>
                <p className="mb-3 text-[12px] leading-relaxed text-text-secondary">
                    <b className="text-foreground">{agentName}</b> reports to{' '}
                    {mine ? <b className="text-foreground">{mine.name}, {mine.title}</b> : <span className="italic">nobody</span>}.
                    {' '}When set, that specialist reads every run&rsquo;s findings <i>before</i> the mail goes out, and the digest
                    header carries the verdict &mdash; <span className="font-mono text-[11px]">Vetted by Nair · sound, 2 concerns</span>.
                    The verdict never blocks the send or edits a number; it flags.
                </p>
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={pickSaving} onClick={() => pick(null)}
                        className={`rounded-xl border px-3 py-1.5 text-[12px] font-semibold ${!reportsTo ? 'border-primary bg-primary/8 text-primary' : 'border-border bg-card text-text-secondary hover:text-foreground'}`}>
                        Nobody
                    </button>
                    {data.agents.filter((a) => a.is_active).map((a) => (
                        <button key={a.key} type="button" disabled={pickSaving} onClick={() => pick(a.key)}
                            title={a.lens}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[12px] font-semibold ${reportsTo === a.key ? 'border-primary bg-primary/8 text-primary' : 'border-border bg-card text-text-secondary hover:text-foreground'}`}>
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
                            {a.name} <span className="font-normal text-text-tertiary">· {a.title.replace(/\s*\(.*\)$/, '')}</span>
                        </button>
                    ))}
                    {pickSaving && <Loader2 className="h-4 w-4 animate-spin self-center text-text-tertiary" />}
                </div>
            </section>

            {/* ---- latest verdicts on THIS agent ------------------------------ */}
            {mine && mine.verdicts.filter((v) => v.agent_key === agentKey).length > 0 && (
                <section className="rounded-2xl border border-border bg-card p-4">
                    <h4 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                        <ShieldCheck className="h-3.5 w-3.5" /> What {mine.name} said about {agentName}&rsquo;s recent runs
                    </h4>
                    <ul className="space-y-2">
                        {mine.verdicts.filter((v) => v.agent_key === agentKey).map((v) => (
                            <li key={v.id} className="rounded-xl border border-border bg-card-tint p-3">
                                <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                                    <span className={`rounded-full px-2 py-0.5 font-bold ${VERDICT_TONE[v.details.verdict ?? ''] ?? 'bg-card text-text-secondary'}`}>{(v.details.verdict ?? v.decision).replace(/_/g, ' ')}</span>
                                    <span className="text-text-tertiary">{new Date(v.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                    {v.details.window && <span className="text-text-tertiary">· {v.details.window}</span>}
                                    {typeof v.details.cost_usd === 'number' && <span className="text-text-tertiary">· ${v.details.cost_usd.toFixed(3)}</span>}
                                </div>
                                {v.details.reasoning && <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground">{v.details.reasoning}</p>}
                                {v.details.concerns?.length ? (
                                    <ul className="mt-2 space-y-1">
                                        {v.details.concerns.map((c, i) => (
                                            <li key={i} className="text-[12px] leading-relaxed text-text-secondary">
                                                <span className="font-mono text-[10.5px] text-text-tertiary">{c.finding_key ?? 'run'}</span> — {c.concern}
                                                <span className="text-text-tertiary"> → {c.suggestion}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* ---- the eight, with their live prompts ------------------------- */}
            <section className="rounded-2xl border border-border bg-card p-4">
                <h4 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    <Users className="h-3.5 w-3.5" /> The council
                </h4>
                <p className="mb-3 text-[12px] leading-relaxed text-text-secondary">
                    Each persona below is a <b className="text-foreground">live system prompt</b> &mdash; the one kind in this
                    system a model actually runs. Change it and the next convene, inbox reply and vetting behave differently.
                    Saves are versioned and land in the council log.
                </p>
                <ul className="divide-y divide-border">
                    {data.agents.map((a) => {
                        const isOpen = open === a.key;
                        const text = draft[a.key] ?? a.persona;
                        const dirty = draft[a.key] !== undefined && draft[a.key] !== a.persona;
                        return (
                            <li key={a.key} className="py-3">
                                <button type="button" onClick={() => setOpen(isOpen ? null : a.key)} className="flex w-full items-center gap-3 text-left">
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: a.color }}>{a.name[0]}</span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[13px] font-semibold text-foreground">{a.name} <span className="font-normal text-text-secondary">· {a.title}</span></span>
                                        <span className="block truncate text-[11.5px] text-text-tertiary">{a.lens}</span>
                                    </span>
                                    <span className="hidden shrink-0 items-center gap-2 text-[11px] text-text-tertiary md:flex">
                                        {a.reports.length > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{a.reports.map((r) => r.display_name).join(', ')} reports here</span>}
                                        <span>v{a.persona_version ?? 1} · {a.persona_chars.toLocaleString()} chars</span>
                                        {a.verdicts.length > 0 && <span>{a.verdicts.length} verdict{a.verdicts.length === 1 ? '' : 's'}</span>}
                                    </span>
                                    {isOpen ? <ChevronUp className="h-4 w-4 shrink-0 text-text-tertiary" /> : <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary" />}
                                </button>
                                {isOpen && (
                                    <div className="mt-3 space-y-2">
                                        <textarea value={text} spellCheck={false} rows={14}
                                            onChange={(e) => setDraft((d) => ({ ...d, [a.key]: e.target.value }))}
                                            className="w-full rounded-xl border border-border bg-card px-3 py-2 font-mono text-[11px] leading-relaxed focus:border-primary/40 focus:outline-none" />
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button type="button" disabled={!dirty || saving === a.key} onClick={() => savePersona(a)}
                                                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50">
                                                {saving === a.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                                Save as v{(a.persona_version ?? 1) + 1}
                                            </button>
                                            {dirty && <button type="button" onClick={() => setDraft((d) => { const n = { ...d }; delete n[a.key]; return n; })} className="text-xs text-text-secondary underline">Discard</button>}
                                            {msg?.key === a.key && (
                                                <span className={`inline-flex items-center gap-1 text-[11.5px] ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                                                    {msg.ok ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} {msg.text}
                                                </span>
                                            )}
                                            <span className="ml-auto text-[11px] text-text-tertiary">{a.email}</span>
                                        </div>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>
        </div>
    );
}
