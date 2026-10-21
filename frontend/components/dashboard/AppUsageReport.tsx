'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Info, Loader2, RefreshCw, UserCheck, X } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

/**
 * App Usage Report (Org Super Admin → Reports → App usage).
 *
 * Every module is scored against its own rhythm (see /api/reports/app-usage), so the
 * grid compares adoption fairly across modules and properties; raw action counts are
 * one toggle away.
 */

type Cadence = 'scheduled' | 'daily' | 'weekly' | 'monthly';

interface Spoc { userId: string; name: string; active: boolean }
interface LastEntry { userId: string | null; name: string | null; at: string }
interface Cell {
    actions: number; pct: number | null; done?: number | null; expected?: number | null; detail: string;
    spoc?: Spoc | null; lastEntry?: LastEntry | null;
}
interface UsageUser {
    userId: string; name: string; email: string | null; role: string | null; propertyId: string | null;
    byModule: Record<string, number>; total: number; activeDays: number; lastActive: string | null;
}
interface Report {
    range: { from: string; to: string; days: number; weeks: number; months: number };
    properties: { id: string; name: string }[];
    modules: { key: string; label: string; cadence: Cadence }[];
    cells: Record<string, Record<string, Cell>>;
    orgWide: { key: string; label: string; actions: number; users: number | null; available: boolean }[];
    users: UsageUser[];
    daily: { date: string; activeUsers: number; actions: number }[];
    members?: Record<string, { userId: string; name: string; role: string }[]>;
    spocsAvailable?: boolean;
    unavailable: string[];
    truncated: string[];
    /** Names of CAPEX-only properties left out of the report. */
    capexHidden?: string[];
    generatedAt: string;
}

type Preset = 'today' | '7' | '30' | 'mtd' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7', label: 'Last 7 days' },
    { id: '30', label: 'Last 30 days' },
    { id: 'mtd', label: 'This month' },
    { id: 'custom', label: 'Custom' },
];

const CADENCE_LABEL: Record<Cadence, string> = { scheduled: 'Scheduled', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
// How each rhythm turns into a %. Shown in the hover card so every number can be checked.
const CADENCE_RULE: Record<Cadence, string> = {
    scheduled: 'Completed ÷ scheduled × 100',
    daily: 'Days with at least one entry ÷ days in range × 100',
    weekly: 'Weeks with at least one entry ÷ weeks in range × 100',
    monthly: 'Months submitted ÷ months in range × 100',
};
const CADENCE_UNIT: Record<Cadence, string> = { scheduled: 'done', daily: 'days', weekly: 'wks', monthly: 'mo' };

/** "24 / 30 days": the two numbers a cell's % comes from. */
function fraction(c: Cell | undefined, cadence: Cadence): string {
    if (!c || c.done === null || c.done === undefined || c.expected === null || c.expected === undefined) return '';
    return `${n(c.done)} / ${n(c.expected)} ${CADENCE_UNIT[cadence]}`;
}

const ORG_WIDE = 'org';

function istToday(): string {
    return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
function shiftDay(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
function rangeFor(preset: Preset, custom: { from: string; to: string }): { from: string; to: string } {
    const to = istToday();
    if (preset === 'today') return { from: to, to };
    if (preset === '7') return { from: shiftDay(to, -6), to };
    if (preset === 'mtd') return { from: `${to.slice(0, 8)}01`, to };
    if (preset === 'custom') return custom;
    return { from: shiftDay(to, -29), to };
}
function fmtDay(day: string | null, withYear = false): string {
    if (!day) return '-';
    return new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}
function fmtRole(role: string | null): string {
    if (!role) return '';
    return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
const n = (v: number) => v.toLocaleString('en-IN');

/** Same six steps for adoption % and for counts scaled within a module. */
function shade(pct: number): string {
    if (pct >= 90) return 'bg-blue-700 text-white';
    if (pct >= 75) return 'bg-blue-500 text-white';
    if (pct >= 60) return 'bg-blue-300 text-slate-900';
    if (pct >= 40) return 'bg-blue-200 text-slate-900';
    if (pct >= 20) return 'bg-blue-100 text-slate-900';
    return 'bg-blue-50 text-slate-900';
}
/** Empty cells stay quiet: a neutral tile, never red. Red/amber is kept for real low adoption. */
const EMPTY_CELL = 'bg-slate-50 text-slate-400';

// Shared chrome so every section matches the sibling Import reports view (same Reports tab).
const CARD = 'rounded-2xl border border-border bg-white shadow-sm';
const SECTION = `${CARD} px-5 py-4`;
const TILE = 'rounded-2xl border border-border bg-white px-4 py-3 shadow-sm';
const TILE_LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-slate-500';
const TILE_VALUE = 'font-display text-xl font-semibold tracking-tight tabular-nums text-slate-900';
const TH = 'text-[10px] font-semibold uppercase tracking-wider text-slate-500';
const SELECT = 'h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700';
const SEGMENT = 'inline-flex shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-[3px]';
const segBtn = (on: boolean) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition ${on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`;

function SectionHead({ title, hint, icon, right }: { title: string; hint?: React.ReactNode; icon?: React.ReactNode; right?: React.ReactNode }) {
    return (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-sm text-slate-900">{icon}{title}</h3>
                {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
            </div>
            {right}
        </div>
    );
}

/** "16 Oct, 1:19 pm" in IST, or just the date for date-only entries (meter readings without a time). */
function fmtWhen(at: string | null | undefined): string {
    if (!at) return '-';
    if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return fmtDay(at);
    const t = new Date(at);
    if (isNaN(t.getTime())) return '-';
    return t.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** On track = 50% or more; matches the Needs attention threshold. */
const ON_TRACK_PCT = 50;

function isUsed(c: Cell | undefined): boolean {
    return !!c && (c.actions > 0 || (c.pct ?? 0) > 0);
}

export default function AppUsageReport({ orgId }: { orgId: string }) {
    const [preset, setPreset] = useState<Preset>('30');
    const [custom, setCustom] = useState(() => ({ from: shiftDay(istToday(), -29), to: istToday() }));
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [view, setView] = useState<'pct' | 'count'>('pct');
    const [focusProp, setFocusProp] = useState('');
    const [highlight, setHighlight] = useState<string | null>(null);
    const [userProp, setUserProp] = useState('all');
    const [userModule, setUserModule] = useState('all');
    const [exporting, setExporting] = useState(false);
    const focusRef = useRef<HTMLDivElement>(null);
    // Reports already loaded in this visit, by date range, so switching back is instant.
    const cacheRef = useRef(new Map<string, Report>());
    const [hover, setHover] = useState<{ x: number; y: number; pid: string; mod: string } | null>(null);
    const [spocEdit, setSpocEdit] = useState<{ pid: string; mod: string } | null>(null);
    const [spocChoice, setSpocChoice] = useState('');
    const [spocSaving, setSpocSaving] = useState(false);
    const [spocError, setSpocError] = useState('');
    const showHover = (e: React.MouseEvent | React.FocusEvent, pid: string, mod: string) => {
        if ('clientX' in e) setHover({ x: e.clientX, y: e.clientY, pid, mod });
        else { const r = (e.target as HTMLElement).getBoundingClientRect(); setHover({ x: r.right, y: r.bottom, pid, mod }); }
    };

    const range = rangeFor(preset, custom);

    const load = useCallback(async (force = false) => {
        if (!orgId || !range.from || !range.to) return;
        const key = `${range.from}|${range.to}`;
        const pickFocus = (r: Report) => setFocusProp(prev => (prev && r.properties.some(p => p.id === prev) ? prev : r.properties[0]?.id || ''));
        const cached = cacheRef.current.get(key);
        if (cached && !force) {
            setError('');
            setData(cached);
            pickFocus(cached);
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/reports/app-usage?orgId=${orgId}&from=${range.from}&to=${range.to}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Could not load the report');
            cacheRef.current.set(key, json);
            setData(json);
            pickFocus(json);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the report');
        } finally {
            setLoading(false);
        }
    }, [orgId, range.from, range.to]);

    useEffect(() => { load(); }, [load]);

    const derived = useMemo(() => {
        if (!data) return null;
        const usedPcts: number[] = [];
        let notUsed = 0;
        let actions = 0;
        const readable = data.modules.filter(m => !data.unavailable.includes(m.key));
        data.properties.forEach(p => readable.forEach(m => {
            const c = data.cells[p.id]?.[m.key];
            actions += c?.actions || 0;
            if (isUsed(c) && c?.pct !== null && c?.pct !== undefined) usedPcts.push(c.pct);
            else if (!isUsed(c)) notUsed++;
        }));
        data.orgWide.forEach(o => { actions += o.actions; });
        const avgAdoption = usedPcts.length ? Math.round(usedPcts.reduce((a, b) => a + b, 0) / usedPcts.length) : 0;

        const moduleAvg = data.modules.map(m => {
            const vals = data.properties.map(p => data.cells[p.id]?.[m.key]).filter(c => isUsed(c) && c?.pct !== null).map(c => c!.pct as number);
            return { m, avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, props: vals.length };
        }).filter(x => x.avg !== null).sort((a, b) => (a.avg as number) - (b.avg as number));

        const activeUsers = new Set(data.users.filter(u => u.activeDays > 0).map(u => u.userId)).size;
        const colMax: Record<string, number> = {};
        data.modules.forEach(m => { colMax[m.key] = Math.max(1, ...data.properties.map(p => data.cells[p.id]?.[m.key]?.actions || 0)); });

        const alerts: { level: 'crit' | 'warn'; label: string; text: string; spoc: string | null; pct: number }[] = [];
        data.properties.forEach(p => data.modules.forEach(m => {
            const c = data.cells[p.id]?.[m.key];
            if (isUsed(c) && c?.pct !== null && (c?.pct as number) < 50) {
                alerts.push({
                    level: (c?.pct as number) < 35 ? 'crit' : 'warn',
                    label: `${p.name} · ${m.label}`,
                    text: `${c?.pct}%. ${c?.detail}.${c?.lastEntry ? ` Last entry ${fmtWhen(c.lastEntry.at)}.` : ''}`,
                    spoc: c?.spoc?.name || null,
                    pct: c?.pct as number,
                });
            }
        }));
        alerts.sort((a, b) => a.pct - b.pct);

        // SPOC scorecard: one row per SPOC, plus the boxes nobody owns yet.
        const lastActiveOf = (uid: string) => data.users.filter(u => u.userId === uid && u.lastActive).map(u => u.lastActive as string).sort().pop() || null;
        const bySpoc = new Map<string, { userId: string; name: string; boxes: { pid: string; mod: string; property: string; module: string; pct: number | null; used: boolean; active: boolean }[] }>();
        const unassigned: { pid: string; mod: string; property: string; module: string }[] = [];
        data.properties.forEach(p => data.modules.forEach(m => {
            if (data.unavailable.includes(m.key)) return;
            const c = data.cells[p.id]?.[m.key];
            if (!c?.spoc) { unassigned.push({ pid: p.id, mod: m.key, property: p.name, module: m.label }); return; }
            if (!bySpoc.has(c.spoc.userId)) bySpoc.set(c.spoc.userId, { userId: c.spoc.userId, name: c.spoc.name, boxes: [] });
            bySpoc.get(c.spoc.userId)!.boxes.push({ pid: p.id, mod: m.key, property: p.name, module: m.label, pct: c.pct, used: isUsed(c), active: c.spoc.active });
        }));
        const scorecard = Array.from(bySpoc.values()).map(r => {
            const onTrack = r.boxes.filter(b => b.used && b.pct !== null && b.pct >= ON_TRACK_PCT).length;
            const behind = r.boxes.filter(b => b.used && b.pct !== null && b.pct < ON_TRACK_PCT).length;
            const notUsed = r.boxes.filter(b => !b.used).length;
            return { ...r, onTrack, behind, notUsed, lastActive: lastActiveOf(r.userId), leftTeam: r.boxes.some(b => !b.active) };
        }).sort((a, b) => (b.behind + b.notUsed) - (a.behind + a.notUsed) || a.name.localeCompare(b.name));
        const totalBoxes = data.properties.length * data.modules.filter(m => !data.unavailable.includes(m.key)).length;

        return { avgAdoption, notUsed, actions, weakest: moduleAvg[0] || null, activeUsers, colMax, alerts, scorecard, unassigned, totalBoxes };
    }, [data]);

    const propName = useCallback((id: string | null) => {
        if (!id) return 'Org-wide';
        return data?.properties.find(p => p.id === id)?.name || 'Property';
    }, [data]);

    const moduleLabel = useCallback((key: string) => {
        return data?.modules.find(m => m.key === key)?.label || data?.orgWide.find(o => o.key === key)?.label || key;
    }, [data]);

    const topUsers = useCallback((pid: string, mod: string, count: number) => {
        if (!data) return [];
        return data.users
            .filter(u => u.propertyId === pid && (u.byModule[mod] || 0) > 0)
            .sort((a, b) => b.byModule[mod] - a.byModule[mod])
            .slice(0, count);
    }, [data]);

    const openSpoc = (pid: string, mod: string) => {
        setHover(null);
        setSpocError('');
        setSpocChoice(data?.cells[pid]?.[mod]?.spoc?.userId || '');
        setSpocEdit({ pid, mod });
    };

    const saveSpoc = async () => {
        if (!spocEdit || !data) return;
        setSpocSaving(true);
        setSpocError('');
        try {
            const res = await fetch('/api/reports/app-usage/spoc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orgId, propertyId: spocEdit.pid, moduleKey: spocEdit.mod, userId: spocChoice || null }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Could not save the SPOC');
            const { pid, mod } = spocEdit;
            const withSpoc = (r: Report): Report => (r.cells[pid]?.[mod]
                ? { ...r, cells: { ...r.cells, [pid]: { ...r.cells[pid], [mod]: { ...r.cells[pid][mod], spoc: json.spoc } } } }
                : r);
            // Keep every cached date range in step, not just the one on screen.
            cacheRef.current.forEach((r, k) => cacheRef.current.set(k, withSpoc(r)));
            setData(prev => prev && withSpoc(prev));
            setSpocEdit(null);
        } catch (e) {
            setSpocError(e instanceof Error ? e.message : 'Could not save the SPOC');
        } finally {
            setSpocSaving(false);
        }
    };

    useEffect(() => {
        if (!spocEdit) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSpocEdit(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [spocEdit]);

    const pickCell = (pid: string, mod: string) => {
        setFocusProp(pid);
        setHighlight(mod);
        requestAnimationFrame(() => focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    const handleExport = useCallback(async () => {
        if (!data) return;
        setExporting(true);
        try {
            const XLSX = await import('xlsx');
            const wb = XLSX.utils.book_new();
            const add = (name: string, rows: Record<string, string | number>[]) =>
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name.slice(0, 31));
            const grid = (pick: (c: Cell | undefined) => string | number) => data.properties.map(p => {
                const row: Record<string, string | number> = { Property: p.name };
                data.modules.forEach(m => { row[`${m.label} (${CADENCE_LABEL[m.cadence]})`] = pick(data.cells[p.id]?.[m.key]); });
                return row;
            });
            add('Adoption %', grid(c => (isUsed(c) && c?.pct !== null ? (c?.pct as number) : 'Not used')));
            add('Adoption working', data.properties.map(p => {
                const row: Record<string, string | number> = { Property: p.name };
                data.modules.forEach(m => { const c = data.cells[p.id]?.[m.key]; row[`${m.label} (${CADENCE_RULE[m.cadence]})`] = isUsed(c) && c?.pct !== null ? `${c?.pct}% = ${fraction(c, m.cadence)}` : 'Not used'; });
                return row;
            }));
            add('Actions', grid(c => c?.actions || 0));
            add('Users', data.users.map(u => {
                const row: Record<string, string | number> = {
                    Name: u.name, Email: u.email || '', Role: fmtRole(u.role), Property: propName(u.propertyId),
                    'Total actions': u.total, 'Active days': u.activeDays, 'Last active': u.lastActive || '',
                };
                [...data.modules, ...data.orgWide.filter(o => o.users !== null)].forEach(m => { row[m.label] = u.byModule[m.key] || 0; });
                return row;
            }));
            add('Daily', data.daily.map(d => ({ Date: d.date, 'Active users': d.activeUsers, Actions: d.actions })));
            add('SPOCs', data.properties.flatMap(p => data.modules.map(m => {
                const c = data.cells[p.id]?.[m.key];
                return {
                    Property: p.name, Module: m.label, SPOC: c?.spoc?.name || 'Not assigned',
                    'Adoption %': isUsed(c) && c?.pct !== null && c?.pct !== undefined ? c.pct : 'Not used',
                    'Last entry by': c?.lastEntry?.name || '', 'Last entry at': c?.lastEntry ? fmtWhen(c.lastEntry.at) : '',
                };
            })));
            add('Org-wide', data.orgWide.map(o => ({ Module: o.label, Actions: o.actions, Users: o.users ?? 'Not tracked' })));
            XLSX.writeFile(wb, `App_Usage_${data.range.from}_to_${data.range.to}.xlsx`);
        } catch (e) {
            console.error('[AppUsageReport] export error:', e);
        } finally {
            setExporting(false);
        }
    }, [data, propName]);

    // Render
    const header = (
        <div className="space-y-3">
            <div>
                <h2 className="text-lg text-slate-900">App usage</h2>
                <p className="text-xs text-slate-500">
                    How each property uses each module, and who does the work
                    {data && <> · {fmtDay(data.range.from, true)} to {fmtDay(data.range.to, true)} ({data.range.days} days)</>}
                </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                <div className={`${SEGMENT} max-w-full flex-wrap`} role="group" aria-label="Date range">
                    {PRESETS.map(p => (
                        <button key={p.id} type="button" onClick={() => setPreset(p.id)} aria-pressed={preset === p.id} className={segBtn(preset === p.id)}>
                            {p.label}
                        </button>
                    ))}
                </div>
                {preset === 'custom' && (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                        <input id="usage-from" type="date" value={custom.from} max={custom.to} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-slate-800" aria-label="From date" />
                        <span>to</span>
                        <input id="usage-to" type="date" value={custom.to} min={custom.from} max={istToday()} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-slate-800" aria-label="To date" />
                    </div>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-x-2 gap-y-2">
                    <button type="button" onClick={() => load(true)} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                    <button type="button" onClick={handleExport} disabled={!data || exporting} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-text-inverse shadow-sm hover:bg-primary/90 disabled:opacity-50">
                        {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export to Excel
                    </button>
                </div>
            </div>
        </div>
    );

    if (loading && !data) {
        return <div className="space-y-6">{header}<div className={`${CARD} flex justify-center py-24`}><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></div>;
    }
    if (error && !data) {
        return (
            <div className="space-y-6">
                {header}
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>
            </div>
        );
    }
    if (!data || !derived) return null;

    const focusRows = data.modules
        .map(m => ({ m, c: data.cells[focusProp]?.[m.key] }))
        .sort((a, b) => (isUsed(b.c) ? (b.c?.pct ?? -1) : -2) - (isUsed(a.c) ? (a.c?.pct ?? -1) : -2));

    const userList = data.users
        .filter(u => userProp === 'all' || (userProp === ORG_WIDE ? u.propertyId === null : u.propertyId === userProp))
        .map(u => ({ u, score: userModule === 'all' ? u.total : (u.byModule[userModule] || 0) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);
    const userMax = userList[0]?.score || 1;
    const chipModules = [...data.modules, ...data.orgWide.filter(o => o.available && o.users !== null)];

    return (
        <div className="space-y-6">
            {header}
            {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">{error}</div>}

            {/* KPIs */}
            <div className={`grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-4 ${loading ? 'opacity-60' : ''}`}>
                {[
                    { label: 'Average adoption', value: `${derived.avgAdoption}%`, sub: `${n(derived.notUsed)} pairs not used`, title: `Across modules in use. ${derived.notUsed} property-module pairs not used.` },
                    { label: 'Active users', value: n(derived.activeUsers), sub: `In ${data.range.days} days`, title: `People with at least one action in ${data.range.days} days` },
                    { label: 'Actions logged', value: n(derived.actions), sub: `${data.properties.length} properties · ${data.modules.length + data.orgWide.length} modules`, title: undefined },
                    { label: 'Weakest module', value: derived.weakest?.m.label || '-', sub: derived.weakest ? `${derived.weakest.avg}% avg · ${derived.weakest.props} properties` : 'Not enough data', title: derived.weakest ? `${derived.weakest.avg}% average where used (${derived.weakest.props} properties)` : undefined },
                ].map(k => (
                    <div key={k.label} className={TILE} title={k.title}>
                        <p className={TILE_LABEL}>{k.label}</p>
                        <p className={`mt-1 truncate ${TILE_VALUE}`}>{k.value}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">{k.sub}</p>
                    </div>
                ))}
            </div>

            {/* Adoption grid */}
            <section className={`${SECTION} ${loading ? 'opacity-60' : ''}`}>
                <SectionHead
                    title="Module adoption by property"
                    hint={view === 'pct'
                        ? 'Each module is scored against its own rhythm, so every cell is on the same 0 to 100% scale. Hover for the working; click to look inside that property.'
                        : 'Raw action counts. Daily modules always show bigger numbers than monthly ones, so compare down a column, not across a row.'}
                    right={
                        <div className={SEGMENT} role="group" aria-label="Grid shows">
                            {(['pct', 'count'] as const).map(v => (
                                <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={segBtn(view === v)}>
                                    {v === 'pct' ? 'Adoption %' : 'Action count'}
                                </button>
                            ))}
                        </div>
                    }
                />
                <div className="-mx-5 overflow-x-auto px-5">
                    <table className="w-full min-w-[1040px] border-separate" style={{ borderSpacing: '3px 2px' }}>
                        <thead>
                            <tr>
                                <th className={`sticky left-0 z-10 border-r border-slate-100 bg-white pb-1.5 pr-3 text-left align-bottom ${TH}`}>Property</th>
                                {data.modules.map(m => (
                                    <th key={m.key} className="min-w-[68px] px-0.5 pb-1.5 align-bottom text-[11px] font-semibold leading-tight text-slate-600">
                                        {m.label}
                                        <span className="mt-0.5 block text-[9px] font-medium uppercase tracking-wider text-slate-400">{CADENCE_LABEL[m.cadence]}</span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.properties.map(p => (
                                <tr key={p.id}>
                                    <th scope="row" title={p.name} className="sticky left-0 z-10 max-w-[180px] truncate border-r border-slate-100 bg-white pr-3 text-left align-top text-xs font-semibold leading-6 text-slate-700">{p.name}</th>
                                    {data.modules.map(m => {
                                        const c = data.cells[p.id]?.[m.key];
                                        const selected = focusProp === p.id && highlight === m.key;
                                        const unavailable = data.unavailable.includes(m.key);
                                        const hoverProps = {
                                            onMouseEnter: (e: React.MouseEvent) => showHover(e, p.id, m.key),
                                            onMouseMove: (e: React.MouseEvent) => showHover(e, p.id, m.key),
                                            onMouseLeave: () => setHover(null),
                                            onFocus: (e: React.FocusEvent) => showHover(e, p.id, m.key),
                                            onBlur: () => setHover(null),
                                        };
                                        const cellBase = `block h-6 w-full rounded-sm px-1 text-center outline-none transition hover:ring-1 hover:ring-slate-300 focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'ring-2 ring-slate-900 hover:ring-2 hover:ring-slate-900' : ''}`;
                                        if (unavailable || !isUsed(c)) {
                                            const emptyLabel = unavailable ? 'No data' : c?.pct === null && m.cadence === 'scheduled' ? 'None due' : 'Not used';
                                            return (
                                                <td key={m.key} className="p-0 align-top" {...hoverProps}>
                                                    <button type="button" onClick={() => pickCell(p.id, m.key)} aria-label={`${p.name} ${m.label}: ${emptyLabel}`}
                                                        className={`${cellBase} ${EMPTY_CELL} ${emptyLabel === 'Not used' ? 'text-xs font-medium' : 'text-[10px] font-medium'}`}>
                                                        {emptyLabel === 'Not used' ? '-' : emptyLabel}
                                                    </button>
                                                </td>
                                            );
                                        }
                                        const scale = view === 'pct' ? (c?.pct ?? 0) : ((c?.actions || 0) / derived.colMax[m.key]) * 100;
                                        return (
                                            <td key={m.key} className="p-0 align-top" {...hoverProps}>
                                                <button type="button" onClick={() => pickCell(p.id, m.key)}
                                                    className={`${cellBase} text-xs font-semibold tabular-nums ${shade(scale)}`}>
                                                    {view === 'pct' ? (c?.pct === null ? '-' : `${c?.pct}%`) : n(c?.actions || 0)}
                                                </button>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                        {view === 'pct' ? '0%' : 'Fewer'}
                        {['bg-blue-50', 'bg-blue-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-500', 'bg-blue-700'].map(c => <i key={c} className={`inline-block h-2.5 w-4 rounded ${c}`} />)}
                        {view === 'pct' ? '100%' : 'More, within each module'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <i className={`inline-flex h-3.5 w-5 items-center justify-center rounded text-[10px] not-italic leading-none ring-1 ring-slate-200 ${EMPTY_CELL}`}>-</i> Not used in this period
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <i className={`inline-flex h-3.5 items-center rounded px-1 text-[9px] not-italic leading-none ring-1 ring-slate-200 ${EMPTY_CELL}`}>None due</i> Nothing was scheduled
                    </span>
                    <span className="inline-flex items-center gap-x-1 gap-y-1"><Info className="h-3 w-3" /> Hover a cell for its working, SPOC and last entry. Click a cell to open it below and set its SPOC.</span>
                    {(data.capexHidden?.length || 0) > 0 && (
                        <span title={data.capexHidden?.join(', ')}>
                            {data.capexHidden?.length} CAPEX-only {data.capexHidden?.length === 1 ? 'property is' : 'properties are'} not shown. Change this in Property Management.
                        </span>
                    )}
                </div>
            </section>

            {spocEdit && (() => {
                const p = data.properties.find(x => x.id === spocEdit.pid);
                const m = data.modules.find(x => x.key === spocEdit.mod);
                const team = data.members?.[spocEdit.pid] || [];
                if (!p || !m) return null;
                return (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 px-4 py-4" onClick={() => !spocSaving && setSpocEdit(null)}>
                        <div role="dialog" aria-modal="true" aria-labelledby="spoc-title" onClick={e => e.stopPropagation()}
                            className="w-full max-w-sm space-y-3 rounded-2xl bg-white px-5 py-5 shadow-2xl">
                            <div className="flex items-start justify-between gap-x-3 gap-y-3">
                                <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Single point of contact</p>
                                    <h3 id="spoc-title" className="text-base text-slate-900">{p.name} · {m.label}</h3>
                                </div>
                                <button type="button" onClick={() => setSpocEdit(null)} aria-label="Close" className="rounded-lg px-1 py-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                            </div>
                            <p className="text-xs text-slate-500">Who is responsible for {m.label} entries at {p.name}?</p>
                            <select id="usage-spoc-select" value={spocChoice} onChange={e => setSpocChoice(e.target.value)} autoFocus
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" aria-label="SPOC">
                                <option value="">No SPOC</option>
                                {team.map(t => <option key={t.userId} value={t.userId}>{t.name} · {fmtRole(t.role)}</option>)}
                            </select>
                            {team.length === 0 && <p className="text-xs text-amber-600">No active team members found for this property.</p>}
                            {spocError && <p className="text-xs font-semibold text-rose-600">{spocError}</p>}
                            <div className="flex justify-end gap-x-2 gap-y-2">
                                <button type="button" onClick={() => setSpocEdit(null)} disabled={spocSaving} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
                                <button type="button" onClick={saveSpoc} disabled={spocSaving} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-text-inverse disabled:opacity-60">
                                    {spocSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save SPOC
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {hover && (() => {
                const p = data.properties.find(x => x.id === hover.pid);
                const m = data.modules.find(x => x.key === hover.mod);
                if (!p || !m) return null;
                const c = data.cells[p.id]?.[m.key];
                const unavailable = data.unavailable.includes(m.key);
                const lead = topUsers(p.id, m.key, 1)[0];
                const width = 300;
                const left = Math.min(hover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - width - 8);
                const top = Math.min(hover.y + 14, (typeof window !== 'undefined' ? window.innerHeight : 800) - 240);
                return (
                    <div role="tooltip" className="pointer-events-none fixed z-50 rounded-xl bg-slate-900 px-3.5 py-3 text-xs text-white shadow-xl" style={{ left, top, width }}>
                        <p className="font-semibold">{p.name} · {m.label}</p>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{CADENCE_LABEL[m.cadence]} module</p>
                        {unavailable ? (
                            <p className="text-slate-300">This module&apos;s data could not be read on this deployment.</p>
                        ) : (
                            <div className="space-y-1">
                                <p className="flex justify-between gap-x-3 gap-y-3"><span className="text-slate-400">Adoption</span><b className="tabular-nums">{c?.pct === null || c?.pct === undefined ? '-' : `${c.pct}%`}</b></p>
                                <p className="text-slate-400">Formula: <span className="text-slate-200">{CADENCE_RULE[m.cadence]}</span></p>
                                <p className="text-slate-400">Working: <span className="text-slate-200">{c?.detail || 'No data'}{c?.pct !== null && c?.pct !== undefined ? ` = ${c.pct}%` : ''}</span></p>
                                <p className="flex justify-between gap-x-3 gap-y-3"><span className="text-slate-400">Actions in range</span><span className="tabular-nums">{n(c?.actions || 0)}</span></p>
                                <p className="flex justify-between gap-x-3 gap-y-3"><span className="text-slate-400">Most active</span><span>{lead ? `${lead.name} (${n(lead.byModule[m.key])})` : '-'}</span></p>
                                <p className="flex justify-between gap-x-3 gap-y-3"><span className="text-slate-400">SPOC</span><span className="text-right">{(() => {
                                    if (!c?.spoc) return 'Not assigned';
                                    const own = data.users.find(u => u.userId === c.spoc?.userId && u.propertyId === p.id)?.byModule[m.key] || 0;
                                    const share = c.actions ? ` (${Math.round((own / c.actions) * 100)}% of entries)` : '';
                                    return `${c.spoc.name}${share}${c.spoc.active ? '' : ', no longer on this team'}`;
                                })()}</span></p>
                                <p className="flex justify-between gap-x-3 gap-y-3"><span className="text-slate-400">Last entry</span><span className="text-right">{c?.lastEntry ? `${c.lastEntry.name || 'Not recorded'} · ${fmtWhen(c.lastEntry.at)}` : 'None in this period'}</span></p>
                            </div>
                        )}
                    </div>
                );
            })()}

            <div className="grid grid-cols-1 gap-x-6 gap-y-6 xl:grid-cols-[1.4fr_1fr]">
                {/* Inside one property */}
                <section ref={focusRef} className={`${SECTION} scroll-mt-4 ${loading ? 'opacity-60' : ''}`}>
                    <SectionHead
                        title="Inside one property"
                        hint="Modules ranked by adoption, with who uses each one most. Open a module to see its top users and set its SPOC."
                        right={
                            <select id="usage-focus-property" value={focusProp} onChange={e => { setFocusProp(e.target.value); setHighlight(null); }}
                                className={`${SELECT} max-w-[220px]`} aria-label="Property to inspect">
                                {data.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        }
                    />
                    <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-100">
                        {focusRows.map(({ m, c }, i) => {
                            const used = isUsed(c) && !data.unavailable.includes(m.key);
                            const tops = topUsers(focusProp, m.key, 3);
                            return (
                                <details key={`${focusProp}-${m.key}`} open={highlight === m.key} className={`group ${highlight === m.key ? 'bg-slate-50 ring-1 ring-inset ring-slate-900' : ''}`}>
                                    <summary className="grid cursor-pointer list-none grid-cols-[20px_minmax(0,1.2fr)_minmax(0,1fr)_44px] items-center gap-x-3 gap-y-3 px-3 py-2 hover:bg-slate-50">
                                        <span className="text-xs tabular-nums text-slate-400">{i + 1}</span>
                                        <span className="min-w-0">
                                            <span className={`text-sm font-semibold ${used ? 'text-slate-800' : 'text-slate-400'}`}>{m.label}</span>
                                            <span className="ml-1.5 text-[9px] font-medium uppercase tracking-wider text-slate-400">{CADENCE_LABEL[m.cadence]}</span>
                                            <span className="block truncate text-[11px] text-slate-500">
                                                {!used ? 'Not used at this property' : tops[0] ? `Most active: ${tops[0].name} · ${n(tops[0].byModule[m.key])}` : 'No named user on these records'}
                                            </span>
                                        </span>
                                        <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                            {used && <span className="block h-full rounded-full bg-blue-500" style={{ width: `${Math.max(2, c?.pct ?? 0)}%` }} />}
                                        </span>
                                        <span className={`text-right text-xs font-semibold tabular-nums ${used ? 'text-slate-800' : 'text-slate-400'}`}>{used && c?.pct !== null ? `${c?.pct}%` : '-'}</span>
                                    </summary>
                                    <div className="space-y-1 px-3 pb-3 pl-11 text-xs text-slate-600">
                                        <p className="text-slate-400">{c?.detail || 'No data'} · {n(c?.actions || 0)} actions</p>
                                        {data.spocsAvailable !== false && !data.unavailable.includes(m.key) && (
                                            <div className="flex items-center justify-between gap-x-3 gap-y-2 rounded-md bg-slate-50 px-2.5 py-1.5">
                                                <span>
                                                    <span className="text-slate-400">SPOC: </span>
                                                    {c?.spoc
                                                        ? <span className="font-semibold text-slate-800">{c.spoc.name}{!c.spoc.active && <span className="ml-1.5 text-[10px] font-medium text-amber-600">no longer on this team</span>}</span>
                                                        : <span className="text-slate-500">Not assigned</span>}
                                                </span>
                                                <button type="button" onClick={() => openSpoc(focusProp, m.key)}
                                                    className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-white">
                                                    {c?.spoc ? 'Change' : 'Assign SPOC'}
                                                </button>
                                            </div>
                                        )}
                                        {tops.length === 0 && <p>No named users for this module in the period.</p>}
                                        {tops.map((u, k) => (
                                            <div key={u.userId} className="flex justify-between gap-x-3 gap-y-3">
                                                <span>{k + 1}. <span className="font-semibold text-slate-800">{u.name}</span>{u.role ? ` · ${fmtRole(u.role)}` : ''}</span>
                                                <span className="tabular-nums">{n(u.byModule[m.key])}</span>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            );
                        })}
                    </div>
                </section>

                <div className="space-y-6">
                    {/* Daily active users */}
                    <section className={`${SECTION} ${loading ? 'opacity-60' : ''}`}>
                        <SectionHead
                            title="Daily active users"
                            right={
                                <p className="text-xs text-slate-500">
                                    Average <span className="font-semibold tabular-nums text-slate-700">{Math.round(data.daily.reduce((a, d) => a + d.activeUsers, 0) / Math.max(1, data.daily.length))}</span> a day
                                </p>
                            }
                        />
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="date" tickFormatter={d => fmtDay(d)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={16} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                                        labelFormatter={d => fmtDay(String(d), true)}
                                        formatter={(value, name) => [n(Number(value)), name === 'activeUsers' ? 'Active users' : 'Actions']}
                                        contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                                    />
                                    <Bar dataKey="activeUsers" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </section>

                    {/* Needs attention */}
                    <section className={`${SECTION} ${loading ? 'opacity-60' : ''}`}>
                        <SectionHead title="Needs attention" right={<p className="text-xs text-slate-500">In use, but below 50%</p>} />
                        <div className="space-y-1.5">
                            {derived.alerts.length === 0 && <p className="text-xs text-slate-500">Every module in use is at 50% adoption or above.</p>}
                            {derived.alerts.slice(0, 8).map(a => (
                                <div key={a.label} className="flex gap-2.5 rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                                    <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${a.level === 'crit' ? 'text-rose-600' : 'text-amber-500'}`} />
                                    <span className="min-w-0">
                                        <span className={`block text-[10px] font-semibold uppercase tracking-wider ${a.level === 'crit' ? 'text-rose-600' : 'text-amber-600'}`}>{a.level === 'crit' ? 'Low adoption' : 'Below half'}</span>
                                        <span className="font-semibold text-slate-800">{a.label}</span>: {a.text}{' '}
                                        <span className="font-medium text-slate-700">{a.spoc ? `SPOC: ${a.spoc}` : 'No SPOC'}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>

            {/* SPOC scorecard */}
            <section className={`${SECTION} ${loading ? 'opacity-60' : ''}`}>
                <SectionHead
                    title="SPOC scorecard"
                    icon={<UserCheck className="h-4 w-4 text-slate-500" />}
                    hint={<>Who owns which module at each property. On track means {ON_TRACK_PCT}% adoption or more. Open a SPOC to see their boxes, and click a box to change its SPOC.</>}
                    right={data.spocsAvailable !== false ? (
                        <p className={`text-xs font-semibold ${derived.unassigned.length ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {derived.unassigned.length ? `${derived.unassigned.length} of ${derived.totalBoxes} boxes have no SPOC` : 'Every box has a SPOC'}
                        </p>
                    ) : undefined}
                />
                {data.spocsAvailable === false ? (
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">SPOCs need a one-time database update (migration 20261016000002_module_spocs.sql) before they can be assigned.</p>
                ) : (
                    <div className="space-y-1.5">
                        {derived.scorecard.length === 0 && <p className="text-xs text-slate-500">No SPOCs yet. Assign one from &quot;Inside one property&quot; or from the list of boxes with no SPOC below.</p>}
                        {derived.scorecard.length > 0 && (
                            <div className={`hidden grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_minmax(0,1.2fr)] gap-x-3 gap-y-3 px-3 pb-1 md:grid ${TH}`}>
                                <span>SPOC</span><span className="text-right">Boxes</span><span className="text-right">On track</span><span className="text-right">Behind</span><span className="text-right">Not used</span><span className="text-right">Last active</span>
                            </div>
                        )}
                        {derived.scorecard.map(r => (
                            <details key={r.userId} className="rounded-md border border-slate-100">
                                <summary className="grid cursor-pointer list-none grid-cols-2 gap-x-3 gap-y-1 rounded-md px-3 py-2 text-xs hover:bg-slate-50 md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_minmax(0,1.2fr)]">
                                    <span className="font-semibold text-slate-800">{r.name}{r.leftTeam && <span className="ml-1.5 text-[10px] font-medium text-amber-600">left a team</span>}</span>
                                    <span className="text-right tabular-nums text-slate-600">{r.boxes.length}</span>
                                    <span className="text-right tabular-nums text-emerald-600">{r.onTrack}</span>
                                    <span className={`text-right tabular-nums ${r.behind ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>{r.behind}</span>
                                    <span className={`text-right tabular-nums ${r.notUsed ? 'font-semibold text-amber-600' : 'text-slate-400'}`}>{r.notUsed}</span>
                                    <span className="text-right text-slate-500">{fmtDay(r.lastActive)}</span>
                                </summary>
                                <div className="grid grid-cols-1 gap-x-1 gap-y-1 px-3 pb-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                                    {r.boxes.map(b => (
                                        <button type="button" key={`${b.pid}-${b.mod}`} onClick={() => openSpoc(b.pid, b.mod)} title="Change SPOC"
                                            className="flex justify-between gap-x-2 gap-y-2 rounded-sm bg-slate-50 px-2.5 py-1.5 text-left hover:bg-slate-100">
                                            <span className="truncate text-slate-600">{b.property} · {b.module}</span>
                                            <span className={`font-semibold tabular-nums ${!b.used ? 'text-slate-400' : b.pct !== null && b.pct < ON_TRACK_PCT ? 'text-rose-600' : 'text-slate-700'}`}>
                                                {!b.used ? 'Not used' : b.pct === null ? '-' : `${b.pct}%`}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </details>
                        ))}
                        {derived.unassigned.length > 0 && (
                            <details className="rounded-md border border-dashed border-slate-200">
                                <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Boxes with no SPOC ({derived.unassigned.length})</summary>
                                <div className="grid grid-cols-1 gap-x-1 gap-y-1 px-3 pb-3 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
                                    {derived.unassigned.map(u => (
                                        <button type="button" key={`${u.pid}-${u.mod}`} onClick={() => openSpoc(u.pid, u.mod)}
                                            className="flex items-center justify-between gap-x-2 gap-y-2 rounded-sm px-2.5 py-1.5 text-left hover:bg-slate-50">
                                            <span className="truncate">{u.property} · {u.module}</span>
                                            <span className="shrink-0 font-semibold text-primary">Assign</span>
                                        </button>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                )}
            </section>

            {/* Most active users */}
            <section className={`${SECTION} ${loading ? 'opacity-60' : ''}`}>
                <SectionHead
                    title="Most active users"
                    hint={<>Ranked by actions in {userModule === 'all' ? 'all modules' : moduleLabel(userModule)} at {userProp === 'all' ? 'all properties' : userProp === ORG_WIDE ? 'org-wide modules' : propName(userProp)}</>}
                    right={
                        <select id="usage-user-property" value={userProp} onChange={e => setUserProp(e.target.value)}
                            className={`${SELECT} max-w-[220px]`} aria-label="Property for users">
                            <option value="all">All properties</option>
                            {data.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            <option value={ORG_WIDE}>Org-wide (HR, CRM, Tasks)</option>
                        </select>
                    }
                />
                <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter users by module">
                    {[{ key: 'all', label: 'All modules' }, ...chipModules].map(m => (
                        <button key={m.key} type="button" onClick={() => setUserModule(m.key)} aria-pressed={userModule === m.key}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${userModule === m.key ? 'border-primary bg-primary text-text-inverse' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            {m.label}
                        </button>
                    ))}
                </div>
                <div className="-mx-5 overflow-x-auto px-5">
                    {userList.length === 0 ? (
                        <p className="py-6 text-center text-xs text-slate-500">No one used this module here in the selected period.</p>
                    ) : (
                        <table className="w-full min-w-[720px] text-left text-xs">
                            <thead>
                                <tr className={`border-b border-slate-100 ${TH}`}>
                                    <th className="py-2 pr-2 font-semibold">#</th>
                                    <th className="py-2 pr-2 font-semibold">User</th>
                                    <th className="py-2 pr-2 font-semibold">Property</th>
                                    <th className="py-2 pr-2 text-right font-semibold">Actions</th>
                                    <th className="py-2 pr-2 font-semibold">Top module</th>
                                    <th className="py-2 pr-2 text-right font-semibold">Active days</th>
                                    <th className="py-2 font-semibold">Last active</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {userList.map(({ u, score }, i) => {
                                    const top = Object.entries(u.byModule).sort((a, b) => b[1] - a[1])[0];
                                    return (
                                        <tr key={`${u.userId}-${u.propertyId}`} className="hover:bg-slate-50/60">
                                            <td className="py-2 pr-2 tabular-nums text-slate-400">{i + 1}</td>
                                            <td className="py-2 pr-2"><span className="block font-semibold text-slate-800">{u.name}</span><span className="text-[11px] text-slate-400">{fmtRole(u.role)}</span></td>
                                            <td className="py-2 pr-2 text-slate-600">{propName(u.propertyId)}</td>
                                            <td className="py-2 pr-2 text-right font-semibold tabular-nums text-slate-800">
                                                <span className="mr-2 inline-block h-1.5 rounded-full bg-blue-500 align-middle" style={{ width: Math.round((score / userMax) * 48) }} />{n(score)}
                                            </td>
                                            <td className="py-2 pr-2 text-slate-600">{top ? moduleLabel(top[0]) : '-'}</td>
                                            <td className="py-2 pr-2 text-right tabular-nums text-slate-600">{u.activeDays} / {data.range.days}</td>
                                            <td className="py-2 text-slate-600">{fmtDay(u.lastActive)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </section>

            {/* Org-wide modules */}
            <section className={SECTION}>
                <SectionHead title="Org-wide modules" hint="These modules are not tied to a property, so they show counts instead of adoption." />
                <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-3">
                    {data.orgWide.map(o => (
                        <div key={o.key} className="rounded-md bg-slate-50 px-4 py-3">
                            <p className={TILE_LABEL}>{o.label}</p>
                            {o.available
                                ? <>
                                    <p className={`mt-1 ${TILE_VALUE}`}>{n(o.actions)}</p>
                                    <p className="mt-0.5 text-[11px] text-slate-400">{o.users === null ? 'Count only, never linked to a person' : `actions · ${n(o.users)} people`}</p>
                                </>
                                : <p className="mt-1 text-xs font-medium text-slate-400">No data on this deployment</p>}
                        </div>
                    ))}
                </div>
            </section>

            {data.truncated?.length > 0 && (
                <p className="text-xs font-semibold text-amber-600">
                    Very large range: {data.truncated.map(moduleLabel).join(', ')} hit the row limit, so those numbers are partial. Pick a shorter range for exact figures.
                </p>
            )}
            {data.unavailable.length > 0 && (
                <p className="text-xs text-slate-400">
                    Not shown because the data could not be read: {data.unavailable.map(moduleLabel).join(', ')}.
                </p>
            )}
        </div>
    );
}
