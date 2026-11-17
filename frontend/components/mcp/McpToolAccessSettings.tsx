'use client';

/**
 * Settings > Claude tools: choose, person by person, which FMS MCP tools a connected assistant
 * (Claude) may use. Organisation admins only; the API enforces it (app/api/mcp/tool-access).
 *
 * This only narrows. A person never gets more through Claude than their FMS role already allows,
 * because every tool runs as them through the app's own routes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bot, Lock, Search, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

type Kind = 'core' | 'read' | 'create' | 'update' | 'confirm';
interface ToolEntry { name: string; title: string; group: string; kind: Kind }
interface Person { id: string; name: string; email: string; mode: 'all' | 'selected'; tools: string[]; updatedAt: string | null }

const ALWAYS_ON = new Set(['whoami']);
const CONFIRM = 'confirm_action';
const card = 'bg-white rounded-2xl border border-slate-200 p-4 md:p-6';

const KIND_BADGE: Record<Kind, { label: string; cls: string }> = {
    core: { label: 'core', cls: 'bg-slate-100 text-slate-700' },
    read: { label: 'read', cls: 'bg-emerald-100 text-emerald-800' },
    create: { label: 'creates', cls: 'bg-amber-100 text-amber-800' },
    update: { label: 'changes', cls: 'bg-orange-100 text-orange-800' },
    confirm: { label: 'confirm', cls: 'bg-rose-100 text-rose-800' },
};

export default function McpToolAccessSettings({ organizationId }: { organizationId: string }) {
    const [catalog, setCatalog] = useState<ToolEntry[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [tableMissing, setTableMissing] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [mode, setMode] = useState<'all' | 'selected'>('all');
    const [tools, setTools] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setLoadError('');
        fetch(`/api/mcp/tool-access?organizationId=${encodeURIComponent(organizationId)}`, { signal: controller.signal, cache: 'no-store' })
            .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load'); return d; })
            .then(d => { setCatalog(d.catalog); setPeople(d.users); setTableMissing(d.tableMissing); })
            .catch(err => { if (err.name !== 'AbortError') setLoadError(err.message); })
            .finally(() => setLoading(false));
        return () => controller.abort();
    }, [organizationId]);

    const groups = useMemo(() => {
        const out = new Map<string, ToolEntry[]>();
        for (const t of catalog) out.set(t.group, [...(out.get(t.group) || []), t]);
        return [...out.entries()];
    }, [catalog]);

    const selected = people.find(p => p.id === selectedId) || null;
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return q ? people.filter(p => `${p.name} ${p.email}`.toLowerCase().includes(q)) : people;
    }, [people, search]);

    // Derived, so the screen always shows what the server will actually allow.
    const effective = useMemo(() => {
        const out = new Set<string>(ALWAYS_ON);
        for (const name of tools) if (catalog.some(t => t.name === name)) out.add(name);
        const hasAction = catalog.some(t => out.has(t.name) && (t.kind === 'create' || t.kind === 'update'));
        if (hasAction) out.add(CONFIRM);
        return out;
    }, [tools, catalog]);

    function pick(p: Person) {
        setSelectedId(p.id); setStatus(null);
        setMode(p.mode); setTools(new Set(p.mode === 'selected' ? p.tools : []));
    }

    function toggle(name: string) {
        setTools(prev => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
    }

    function setGroup(names: string[], on: boolean) {
        setTools(prev => { const next = new Set(prev); for (const n of names) if (on) next.add(n); else next.delete(n); return next; });
    }

    const dirty = !!selected && (selected.mode !== mode || (mode === 'selected' && (
        selected.tools.length !== effective.size || selected.tools.some(t => !effective.has(t))
    )));

    async function save() {
        if (!selected) return;
        setBusy(true); setStatus(null);
        try {
            const r = await fetch('/api/mcp/tool-access', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, userId: selected.id, mode, tools: mode === 'selected' ? [...effective] : [] }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error([d.error, ...(d.details || [])].filter(Boolean).join(' · '));
            setPeople(prev => prev.map(p => p.id === selected.id ? { ...p, mode: d.mode, tools: d.tools, updatedAt: d.updatedAt } : p));
            setTools(new Set(d.mode === 'selected' ? d.tools : []));
            setStatus({ ok: true, text: 'Saved. Claude sees the new tool list on its next request (reconnecting the FMS connector in Claude refreshes it at once).' });
        } catch (err) {
            setStatus({ ok: false, text: err instanceof Error ? err.message : 'Could not save' });
        } finally { setBusy(false); }
    }

    if (loading) return <div className={card}><p className="text-sm text-slate-500">Loading Claude tool access…</p></div>;
    if (loadError) return <div className={card}><p className="text-sm text-rose-600">{loadError}</p></div>;

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><Bot className="w-5 h-5 text-primary" /> Claude tools (MCP)</h2>
                <p className="text-sm text-slate-500 mt-1">
                    When someone connects Claude to the FMS, pick which tools Claude may use for them. Everyone starts with every tool.
                    Limiting tools never grants anything: each tool still runs as that person, with their normal FMS access.
                </p>
            </div>

            {tableMissing && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    The tool access table is not set up yet, so everyone keeps every tool. Your team needs to run the migration <code>20261110000001_mcp_tool_access.sql</code>.
                </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                {/* People */}
                <section className={`${card} lg:max-h-[42rem] flex flex-col`}>
                    <label className="relative block">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people" className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm" />
                    </label>
                    <ul className="mt-3 divide-y divide-slate-100 overflow-y-auto">
                        {filtered.length === 0 && <li className="py-3 text-sm text-slate-500">No one matches.</li>}
                        {filtered.map(p => (
                            <li key={p.id}>
                                <button type="button" onClick={() => pick(p)} className={`w-full text-left px-2 py-2.5 rounded-lg transition-colors ${p.id === selectedId ? 'bg-primary/10' : 'hover:bg-slate-50'}`}>
                                    <span className="block text-sm font-semibold text-slate-900 truncate">{p.name || p.email}</span>
                                    <span className="block text-xs text-slate-500 truncate">{p.email}</span>
                                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${p.mode === 'selected' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                        {p.mode === 'selected' ? `${p.tools.length} tools` : 'All tools'}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Tools for the selected person */}
                <section className={card}>
                    {!selected ? (
                        <p className="text-sm text-slate-500">Pick a person on the left to see and change the tools Claude may use for them.</p>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-black text-slate-900">{selected.name || selected.email}</p>
                                    <p className="text-xs text-slate-500">{selected.email}{selected.updatedAt ? ` · last changed ${new Date(selected.updatedAt).toLocaleString()}` : ''}</p>
                                </div>
                                <button type="button" onClick={save} disabled={busy || !dirty || tableMissing}
                                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                                </button>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2">
                                <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${mode === 'all' ? 'border-primary bg-primary/5' : 'border-slate-200'}`}>
                                    <input type="radio" name="mcp-mode" className="mt-1" checked={mode === 'all'} onChange={() => setMode('all')} />
                                    <span><span className="block text-sm font-bold text-slate-900">All tools</span><span className="block text-xs text-slate-500">Every tool, including ones added later.</span></span>
                                </label>
                                <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${mode === 'selected' ? 'border-primary bg-primary/5' : 'border-slate-200'}`}>
                                    <input type="radio" name="mcp-mode" className="mt-1" checked={mode === 'selected'} onChange={() => setMode('selected')} />
                                    <span><span className="block text-sm font-bold text-slate-900">Only the tools ticked below</span><span className="block text-xs text-slate-500">Claude sees and can call only these. {effective.size} selected.</span></span>
                                </label>
                            </div>

                            {mode === 'selected' && (
                                <div className="space-y-4">
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        <button type="button" onClick={() => setGroup(catalog.filter(t => t.kind === 'read').map(t => t.name), true)} className="rounded-full border border-slate-200 px-3 py-1 font-semibold hover:bg-slate-50">Tick all read tools</button>
                                        <button type="button" onClick={() => setGroup(catalog.map(t => t.name), true)} className="rounded-full border border-slate-200 px-3 py-1 font-semibold hover:bg-slate-50">Tick everything</button>
                                        <button type="button" onClick={() => setTools(new Set())} className="rounded-full border border-slate-200 px-3 py-1 font-semibold hover:bg-slate-50">Untick everything</button>
                                    </div>
                                    {groups.map(([group, entries]) => {
                                        const names = entries.filter(t => !ALWAYS_ON.has(t.name) && t.kind !== 'confirm').map(t => t.name);
                                        const allOn = names.length > 0 && names.every(n => tools.has(n));
                                        return (
                                            <div key={group} className="rounded-xl border border-slate-200">
                                                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50 rounded-t-xl">
                                                    <p className="text-xs font-black uppercase tracking-wide text-slate-600">{group}</p>
                                                    {names.length > 0 && (
                                                        <button type="button" onClick={() => setGroup(names, !allOn)} className="text-[11px] font-bold text-primary hover:underline">{allOn ? 'Untick group' : 'Tick group'}</button>
                                                    )}
                                                </div>
                                                <div className="grid gap-1 p-2 sm:grid-cols-2">
                                                    {entries.map(t => {
                                                        const locked = ALWAYS_ON.has(t.name) || t.kind === 'confirm';
                                                        const on = effective.has(t.name);
                                                        const badge = KIND_BADGE[t.kind];
                                                        return (
                                                            <label key={t.name} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${locked ? 'text-slate-500' : 'cursor-pointer hover:bg-slate-50'}`}
                                                                title={t.kind === 'confirm' ? 'Switched on automatically when any create or change tool is ticked. Without it those tools only preview.' : ALWAYS_ON.has(t.name) ? 'Always on: it only describes the connected person.' : t.name}>
                                                                <input type="checkbox" className="mt-0.5" checked={on} disabled={locked} onChange={() => toggle(t.name)} />
                                                                <span className="min-w-0">
                                                                    <span className="flex items-center gap-1.5">
                                                                        <span className="font-semibold text-slate-900 truncate">{t.title}</span>
                                                                        {locked && <Lock className="w-3 h-3 shrink-0 text-slate-400" />}
                                                                    </span>
                                                                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                                                        <code>{t.name}</code>
                                                                        <span className={`rounded-full px-1.5 py-px font-bold ${badge.cls}`}>{badge.label}</span>
                                                                    </span>
                                                                </span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {status && (
                                <p className={`flex items-start gap-2 text-sm ${status.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
                                    {status.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                                    <span>{status.text}</span>
                                </p>
                            )}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
