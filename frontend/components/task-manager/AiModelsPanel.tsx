"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, KeyRound, Loader2, RefreshCw, RotateCcw, Zap } from 'lucide-react';

/**
 * Owner 2026-10-28 — Control Center → "AI models": which model each Task Manager AI job uses (a main model and backups),
 * whether each provider's API key is set (names only, never a value), and a read-only list of every AI model used across
 * the project. "Default" keeps today's models. A model that cannot do a job cannot be picked; a model whose key is missing
 * is skipped at run time. Today's models always follow as the last resort, so a setting can never stop a job.
 */

type Status = 'ready' | 'no_key' | 'cannot';
interface ModelRow { id: string; label: string; provider: string; note?: string; status: Record<string, { status: Status; reason: string }> }
interface JobRow { key: string; label: string; hint: string; group: string; needs: string; defaults: string[]; saved: string[] | null; effective: string[] }
interface KeyRow { provider: string; label: string; ready: boolean; note?: string; keys: Array<{ name: string; set: boolean }> }
interface InvRow { area: string; feature: string; where: string; models: string; chosen: string; kind: string; job?: string; modelEnv?: string; modelEnvSet?: boolean; keyStatus: Array<{ name: string; set: boolean }> }
interface Data { tableMissing: boolean; jobs: JobRow[]; models: ModelRow[]; keys: KeyRow[]; maxChain: number; inventory: InvRow[] }

const MARK: Record<Status, string> = { ready: '✅', no_key: '🔑 key missing', cannot: "🚫 can't do this" };

export default function AiModelsPanel({ orgId }: { orgId?: string }) {
    const url = `/api/task-manager/ai-models?orgId=${encodeURIComponent(orgId || '')}`;
    const [data, setData] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string[]>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [tests, setTests] = useState<Record<string, { ok: boolean | null; message: string; ms?: number }>>({});
    const [showInventory, setShowInventory] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch(url);
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || 'Could not load the AI model settings');
            setData(json as Data);
            setDrafts({});
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load the AI model settings');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId]);

    const labelOf = useMemo(() => new Map((data?.models ?? []).map(m => [m.id, m.label])), [data]);
    const name = (id: string) => labelOf.get(id) ?? id;

    const post = async (body: Record<string, unknown>) => {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw new Error(json.error || 'That did not work');
        return json;
    };
    const save = async (job: JobRow, models: string[] | null) => {
        setBusy(`save-${job.key}`); setError(null); setNotice(null);
        try {
            const r = await post({ action: 'save', job: job.key, models });
            setNotice([r.message, ...(r.warnings || [])].join(' '));
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save');
        } finally {
            setBusy(null);
        }
    };
    const test = async (job: string, model: string) => {
        const k = `${job}|${model}`;
        setBusy(`test-${k}`);
        try {
            const r = await post({ action: 'test', job, model });
            setTests(t => ({ ...t, [k]: r.result }));
        } catch (err) {
            setTests(t => ({ ...t, [k]: { ok: false, message: err instanceof Error ? err.message : 'Test failed' } }));
        } finally {
            setBusy(null);
        }
    };

    const groups = useMemo(() => {
        const out = new Map<string, JobRow[]>();
        for (const j of data?.jobs ?? []) out.set(j.group, [...(out.get(j.group) ?? []), j]);
        return [...out.entries()];
    }, [data]);
    const areas = useMemo(() => {
        const out = new Map<string, InvRow[]>();
        for (const r of data?.inventory ?? []) out.set(r.area, [...(out.get(r.area) ?? []), r]);
        return [...out.entries()];
    }, [data]);

    return (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <Bot className="w-5 h-5 text-indigo-600" />
                    <div>
                        <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">AI models</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Which model each Task Manager job uses: a main model and backups. &ldquo;Default&rdquo; keeps today&apos;s models, and today&apos;s models always follow as the last resort.</p>
                    </div>
                </div>
                <button type="button" disabled={loading} onClick={() => void load()} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs cursor-pointer disabled:opacity-50 self-start">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            {data?.tableMissing && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
                    <p className="font-black flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Choosing models needs one SQL file</p>
                    <p>Run <code className="font-mono bg-white/70 px-1 rounded">supabase/migrations/20261028140001_task_manager_ai_models.sql</code> once in the Supabase SQL Editor. Until then every job uses today&apos;s models and the dropdowns are disabled.</p>
                </div>
            )}
            {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">⚠️ {error}</div>}
            {notice && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}</div>}
            {loading && !data && <p className="text-xs text-slate-500">Loading…</p>}

            {data && (<>
                {/* API keys: set or missing, by name only */}
                <section className="rounded-2xl border border-slate-200 p-4" aria-label="API keys">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400"><KeyRound className="h-3.5 w-3.5" /> API keys (set on the server; values are never shown)</p>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {data.keys.map(k => (
                            <div key={k.label} className="rounded-xl bg-slate-50 px-3 py-2">
                                <p className="flex items-center justify-between gap-2 text-xs font-bold text-slate-900">
                                    {k.label}
                                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${k.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{k.ready ? 'Ready' : 'Missing'}</span>
                                </p>
                                <p className="mt-1 flex flex-wrap gap-1">
                                    {k.keys.map(x => <code key={x.name} className={`rounded px-1 text-[10px] ${x.set ? 'bg-emerald-50 text-emerald-800' : 'bg-white text-slate-400'}`}>{x.name}{x.set ? ' ✓' : ''}</code>)}
                                </p>
                                {k.note && <p className="mt-1 text-[10px] leading-snug text-slate-500">{k.note}</p>}
                            </div>
                        ))}
                    </div>
                </section>

                {/* One row per job */}
                {groups.map(([group, jobs]) => (
                    <section key={group} aria-label={group}>
                        <p className="pb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">{group}</p>
                        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
                            {jobs.map(job => {
                                const draft = drafts[job.key] ?? job.saved ?? [];
                                const changed = JSON.stringify(draft) !== JSON.stringify(job.saved ?? []);
                                const slots = Math.min(data.maxChain, Math.max(1, draft.length + 1));
                                const setSlot = (i: number, id: string) => {
                                    const next = [...draft];
                                    if (id) next[i] = id; else next.splice(i);
                                    setDrafts(d => ({ ...d, [job.key]: next.filter(Boolean) }));
                                };
                                return (
                                    <div key={job.key} className="space-y-2 px-4 py-3">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-slate-900">{job.label} {job.saved && <span className="rounded bg-indigo-100 px-1 py-px text-[9px] font-black uppercase tracking-wider text-indigo-700">Custom</span>}</p>
                                                <p className="text-[11px] text-slate-500">{job.hint}</p>
                                            </div>
                                            <p className="text-[11px] text-slate-500">Today: {job.defaults.map(name).join(' → ')}</p>
                                        </div>
                                        <div className="flex flex-wrap items-end gap-2">
                                            {Array.from({ length: slots }).map((_, i) => {
                                                const value = draft[i] ?? '';
                                                const tested = value ? tests[`${job.key}|${value}`] : undefined;
                                                return (
                                                    <div key={i} className="min-w-[220px] flex-1">
                                                        <label className="block">
                                                            <span className="mb-0.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">{i === 0 ? 'Main model' : `Backup ${i}`}</span>
                                                            <select
                                                                value={value} disabled={data.tableMissing || !!busy}
                                                                onChange={e => setSlot(i, e.target.value)}
                                                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 disabled:opacity-50"
                                                            >
                                                                <option value="">{i === 0 ? "Default (today's models)" : 'None'}</option>
                                                                {data.models.map(m => {
                                                                    const st = m.status[job.key];
                                                                    const taken = draft.includes(m.id) && draft[i] !== m.id;
                                                                    return <option key={m.id} value={m.id} disabled={st.status === 'cannot' || taken}>{m.label} · {MARK[st.status]}{m.note ? ` · ${m.note}` : ''}</option>;
                                                                })}
                                                            </select>
                                                        </label>
                                                        {value && (
                                                            <p className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                                                                <span className="text-slate-500">{data.models.find(m => m.id === value)?.status[job.key]?.reason}</span>
                                                                <button type="button" disabled={!!busy} onClick={() => void test(job.key, value)} className="flex items-center gap-0.5 font-bold text-indigo-700 underline disabled:opacity-50">
                                                                    {busy === `test-${job.key}|${value}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Test
                                                                </button>
                                                                {tested && <span className={tested.ok ? 'text-emerald-700' : tested.ok === null ? 'text-slate-500' : 'text-rose-700'}>{tested.ok ? `✅ ${tested.ms} ms` : tested.ok === null ? tested.message : `⚠️ ${tested.message}`}</span>}
                                                            </p>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="flex-1 text-[11px] text-slate-500">Runs now: <span className="font-semibold text-slate-700">{job.effective.map(name).join(' → ')}</span></p>
                                            {job.saved && (
                                                <button type="button" disabled={data.tableMissing || !!busy} onClick={() => void save(job, null)} className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                                    <RotateCcw className="h-3 w-3" /> Reset to default
                                                </button>
                                            )}
                                            <button type="button" disabled={data.tableMissing || !changed || !!busy} onClick={() => void save(job, draft.length ? draft : null)} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-black text-white hover:bg-indigo-700 disabled:opacity-40">
                                                {busy === `save-${job.key}` && <Loader2 className="h-3 w-3 animate-spin" />} Save
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ))}

                {/* Every AI model in the project, read-only */}
                <section className="rounded-2xl border border-slate-200">
                    <button type="button" onClick={() => setShowInventory(v => !v)} aria-expanded={showInventory} className="flex w-full items-center gap-2 px-4 py-3 text-left">
                        {showInventory ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                        <span className="text-xs font-black text-slate-900">AI models used across the whole project</span>
                        <span className="text-[11px] text-slate-500">{data.inventory.length} features · read-only (only Task Manager rows can be changed above)</span>
                    </button>
                    {showInventory && (
                        <div className="overflow-x-auto border-t border-slate-100">
                            <table className="w-full min-w-[900px] text-left text-[11px]">
                                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                                    <tr><th className="px-3 py-2">Feature</th><th className="px-3 py-2">Models (in order)</th><th className="px-3 py-2">How chosen</th><th className="px-3 py-2">Keys</th><th className="px-3 py-2">Where</th></tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {areas.map(([area, rows]) => (
                                        <React.Fragment key={area}>
                                            <tr className="bg-slate-50/60"><td colSpan={5} className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{area}</td></tr>
                                            {rows.map(r => (
                                                <tr key={`${r.area}-${r.feature}`}>
                                                    <td className="px-3 py-2 font-bold text-slate-900">{r.feature} <span className="font-normal text-slate-400">({r.kind})</span></td>
                                                    <td className="px-3 py-2 text-slate-700">{r.models}</td>
                                                    <td className="px-3 py-2 text-slate-700">
                                                        {r.chosen}
                                                        {r.modelEnv && <span className="block"><code className="rounded bg-slate-100 px-1">{r.modelEnv}</code> {r.modelEnvSet ? 'is set (overrides the default)' : 'not set'}</span>}
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <span className="flex flex-wrap gap-1">{r.keyStatus.map(k => <code key={k.name} className={`rounded px-1 ${k.set ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-400'}`}>{k.name}{k.set ? ' ✓' : ''}</code>)}</span>
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{r.where}</td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </>)}
        </div>
    );
}
