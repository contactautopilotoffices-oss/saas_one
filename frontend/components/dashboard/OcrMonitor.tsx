'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw, Play, ChevronDown, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

/**
 * Master Admin → OCR Monitor. A live log of every OCR operation (like a deployment's log stream), a
 * heartbeat that proves the readers work right now, and the numbers that matter: success rate, speed, cost.
 */

interface Step { step: string; ms: number; ok: boolean; model?: string; provider?: string; tokens_in?: number; tokens_out?: number; cost_usd?: number; note?: string }
interface Row { id: string; created_at: string; source: string; reference_id: string | null; filename: string | null; path: string | null; ok: boolean; error: string | null; duration_ms: number | null; pages: number | null; steps: Step[]; tokens_in: number; tokens_out: number; cost_usd: number; fields: Record<string, unknown> | null }
interface Win { total: number; ok: number; failed: number; success_pct: number | null; avg_ms: number | null; p95_ms: number | null; cost_usd: number }
interface Snap {
    provisioned: boolean; note?: string; generated_at: string;
    heartbeat: { status: 'healthy' | 'stale' | 'failing' | 'unknown'; last: Row | null; last_ok_at: string | null; age_minutes: number | null; history: { created_at: string; ok: boolean; duration_ms: number | null }[] };
    last_hour: Win; last_24h: Win; by_source: Record<string, { total: number; failed: number }>; rows: Row[];
}
interface Probe { ok: boolean; ms: number; path: string | null; error: string | null; checks: { name: string; ok: boolean; expected: unknown; got: unknown }[] }

const SOURCE_LABEL: Record<string, string> = { invoice: 'Invoices', document_bank: 'Document Bank', electricity: 'Electricity bills', petty_cash: 'Petty cash', meter: 'Meters', heartbeat: 'Heartbeat', other: 'Other' };
const STATUS: Record<string, { dot: string; text: string; label: string }> = {
    healthy: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', label: 'Healthy' },
    stale: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: 'No recent probe' },
    failing: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', label: 'Failing' },
    unknown: { dot: 'bg-slate-400', text: 'text-text-secondary', label: 'No probe yet' },
};

const secs = (ms: number | null | undefined) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const usd = (n: number | null | undefined) => (n == null ? '—' : n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`);
function ago(iso: string, now: number) {
    const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}

export default function OcrMonitor() {
    const [snap, setSnap] = useState<Snap | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [live, setLive] = useState(true);
    const [source, setSource] = useState<string>('');
    const [failedOnly, setFailedOnly] = useState(false);
    const [open, setOpen] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [probing, setProbing] = useState(false);
    const [probe, setProbe] = useState<Probe | null>(null);
    const seq = useRef(0);

    const load = useCallback(async () => {
        const mine = ++seq.current;
        try {
            const qs = new URLSearchParams({ limit: '100', ...(source ? { source } : {}), ...(failedOnly ? { failed: '1' } : {}) });
            const r = await fetch(`/api/admin/ocr-monitor?${qs}`, { cache: 'no-store' });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            if (mine === seq.current) { setSnap(j as Snap); setError(null); setNow(Date.now()); }
        } catch (e) { if (mine === seq.current) setError((e as Error).message); }
    }, [source, failedOnly]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { if (!live) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [live, load]);
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

    const runProbe = async () => {
        setProbing(true); setProbe(null);
        try {
            const r = await fetch('/api/admin/ocr-monitor/probe', { method: 'POST' });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setProbe(j as Probe); await load();
        } catch (e) { setProbe({ ok: false, ms: 0, path: null, error: (e as Error).message, checks: [] }); }
        finally { setProbing(false); }
    };

    const hb = snap?.heartbeat; const st = STATUS[hb?.status ?? 'unknown'];

    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <p className="text-sm text-text-secondary max-w-2xl">Every time the system reads an invoice, bill or receipt, it shows up here with what it did, how long it took and what it cost. The heartbeat proves the readers work right now.</p>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-text-secondary cursor-pointer"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live</label>
                    <button onClick={load} className="p-2 rounded-lg border border-border text-text-secondary hover:bg-surface-elevated" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
                </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {snap && !snap.provisioned && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-text-primary">{snap.note}</div>}

            {/* Heartbeat */}
            <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <span className={`w-3 h-3 rounded-full ${st.dot} ${hb?.status === 'healthy' ? 'animate-pulse' : ''}`} />
                        <div>
                            <div className={`text-sm font-bold ${st.text}`}>{st.label}</div>
                            <div className="text-xs text-text-tertiary">
                                {hb?.last ? `Last probe ${ago(hb.last.created_at, now)} · ${secs(hb.last.duration_ms)} · ${hb.last.ok ? 'read the sample invoice correctly' : (hb.last.error ?? 'failed')}` : snap?.provisioned ? 'The probe has not run yet. It runs every 15 minutes once deployed.' : 'Available once the log table exists.'}
                            </div>
                        </div>
                    </div>
                    <button onClick={runProbe} disabled={probing || !snap?.provisioned} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm font-bold text-text-secondary hover:bg-surface-elevated disabled:opacity-50">
                        {probing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run probe now
                    </button>
                </div>
                {hb && hb.history.length > 0 && (
                    <div className="flex items-end gap-[3px] h-6" title="Last probes, oldest to newest">
                        {hb.history.map((h, i) => <span key={i} className={`flex-1 max-w-[10px] rounded-sm ${h.ok ? 'bg-emerald-500/70' : 'bg-red-500'}`} style={{ height: h.ok ? '60%' : '100%' }} title={`${new Date(h.created_at).toLocaleString('en-IN')} · ${h.ok ? 'ok' : 'failed'} · ${secs(h.duration_ms)}`} />)}
                    </div>
                )}
                {probe && (
                    <div className={`rounded-xl border px-3 py-2 text-xs ${probe.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                        <div className="font-bold text-text-primary">{probe.ok ? `Passed in ${secs(probe.ms)} (${probe.path ?? 'read'})` : `Failed: ${probe.error}`}</div>
                        {probe.checks.length > 0 && <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4">{probe.checks.map((c) => <li key={c.name} className="flex items-center gap-1.5">{c.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 text-red-600" />}<span className="text-text-secondary">{c.name}: {String(c.got ?? 'not read')}{c.ok ? '' : ` (expected ${String(c.expected)})`}</span></li>)}</ul>}
                    </div>
                )}
            </div>

            {/* Numbers */}
            {snap && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Tile label="Reads, last hour" value={String(snap.last_hour.total)} sub={snap.last_hour.total ? `${snap.last_hour.success_pct}% succeeded` : 'none'} bad={snap.last_hour.failed > 0} />
                    <Tile label="Reads, last 24 hours" value={String(snap.last_24h.total)} sub={snap.last_24h.total ? `${snap.last_24h.failed} failed · ${snap.last_24h.success_pct}% ok` : 'none'} bad={snap.last_24h.failed > 0} />
                    <Tile label="Speed, last 24 hours" value={secs(snap.last_24h.avg_ms)} sub={`slowest 1 in 20: ${secs(snap.last_24h.p95_ms)}`} />
                    <Tile label="Cost, last 24 hours" value={usd(snap.last_24h.cost_usd)} sub="model calls" />
                </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-1.5 flex-wrap">
                <Chip on={!source} onClick={() => setSource('')}>All</Chip>
                {snap && Object.entries(snap.by_source).map(([s, v]) => <Chip key={s} on={source === s} onClick={() => setSource(s)}>{SOURCE_LABEL[s] ?? s} <span className="opacity-70">{v.total}{v.failed ? ` · ${v.failed} failed` : ''}</span></Chip>)}
                <span className="mx-1 w-px h-4 bg-border" />
                <Chip on={failedOnly} onClick={() => setFailedOnly((v) => !v)}>Failures only</Chip>
            </div>

            {/* Live feed */}
            <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 text-xs font-bold text-text-secondary"><Activity className="w-4 h-4" /> Activity {live && <span className="inline-flex items-center gap-1 text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> live</span>}</div>
                {!snap && !error && <div className="px-4 py-10 text-center text-sm text-text-tertiary">Loading…</div>}
                {snap && snap.rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-text-tertiary">Nothing has been read yet{source || failedOnly ? ' with this filter' : ''}.</div>}
                <div className="divide-y divide-border">
                    {snap?.rows.map((r) => (
                        <div key={r.id}>
                            <button onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} className="w-full text-left px-4 py-2.5 hover:bg-surface-elevated/60 flex items-center gap-3 text-xs">
                                {r.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <XCircle className="w-4 h-4 text-red-600 shrink-0" />}
                                <span className="w-16 shrink-0 text-text-tertiary tabular-nums">{ago(r.created_at, now)}</span>
                                <span className="w-28 shrink-0 font-bold text-text-primary truncate">{SOURCE_LABEL[r.source] ?? r.source}</span>
                                <span className="flex-1 min-w-0 truncate text-text-secondary">{r.filename ?? r.reference_id ?? '—'}{!r.ok && r.error ? <span className="text-red-600"> · {r.error}</span> : null}</span>
                                <span className="hidden md:block w-20 shrink-0 text-text-tertiary">{r.path ? r.path.replace('pdf_', 'pdf ') : '—'}</span>
                                <span className="w-16 shrink-0 text-right tabular-nums text-text-secondary">{secs(r.duration_ms)}</span>
                                <span className="hidden sm:block w-16 shrink-0 text-right tabular-nums text-text-tertiary">{usd(r.cost_usd)}</span>
                                <ChevronDown className={`w-4 h-4 text-text-tertiary shrink-0 transition-transform ${open === r.id ? 'rotate-180' : ''}`} />
                            </button>
                            {open === r.id && (
                                <div className="px-4 pb-3 pt-1 bg-surface-elevated/40 text-xs space-y-2">
                                    {!r.ok && r.error && <p className="text-red-700 dark:text-red-400 break-words">{r.error}</p>}
                                    {r.steps.length > 0 ? (
                                        <table className="w-full"><thead><tr className="text-left text-text-tertiary"><th className="py-1 pr-3">Step</th><th className="pr-3">Model</th><th className="pr-3 text-right">Time</th><th className="pr-3 text-right">Tokens in/out</th><th className="pr-3 text-right">Cost</th><th>Note</th></tr></thead>
                                            <tbody className="divide-y divide-border">{r.steps.map((s, i) => <tr key={i} className="align-top"><td className="py-1 pr-3 whitespace-nowrap">{s.ok ? '✓' : '✗'} {s.step.replace(/_/g, ' ')}</td><td className="pr-3 whitespace-nowrap text-text-secondary">{s.model ?? '—'}{s.provider ? ` (${s.provider})` : ''}</td><td className="pr-3 text-right tabular-nums">{secs(s.ms)}</td><td className="pr-3 text-right tabular-nums">{s.tokens_in != null ? `${s.tokens_in}/${s.tokens_out ?? 0}` : '—'}</td><td className="pr-3 text-right tabular-nums">{s.cost_usd != null ? usd(s.cost_usd) : '—'}</td><td className="text-text-secondary break-words">{s.note ?? ''}</td></tr>)}</tbody></table>
                                    ) : <p className="text-text-tertiary">No step detail was recorded for this read.</p>}
                                    {r.fields && <p className="text-text-secondary break-words">Result: {Object.entries(r.fields).filter(([k]) => k !== 'checks').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}`).join(' · ')}</p>}
                                    <p className="text-text-tertiary">{new Date(r.created_at).toLocaleString('en-IN')}{r.reference_id ? ` · ref ${r.reference_id.slice(0, 8)}` : ''}{r.pages ? ` · ${r.pages} page${r.pages > 1 ? 's' : ''}` : ''}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function Tile({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
    return <div className="rounded-2xl border border-border bg-surface px-4 py-3"><div className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary">{label}</div><div className="text-2xl font-black text-text-primary mt-0.5 tabular-nums">{value}</div><div className={`text-xs mt-0.5 ${bad ? 'text-red-600' : 'text-text-tertiary'}`}>{sub}</div></div>;
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
    return <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${on ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary hover:bg-surface-elevated'}`}>{children}</button>;
}
