'use client';

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, Download, Loader2, RefreshCw, Ticket, QrCode, ClipboardCheck, Wrench,
    Zap, Fuel, Droplets, Package, Boxes, FileBadge, Users, DoorOpen, Wallet, ShoppingCart, CalendarCheck,
    CalendarDays, ListChecks, ShieldCheck, UserCircle2, Building2, Gauge, CheckCircle2, Info, IndianRupee, Maximize2, X, ChevronRight, Sparkles,
} from 'lucide-react';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, LabelList, Label,
} from 'recharts';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Property Overview Report (Reports tab, after a property is chosen).
 *
 * One page for one property across every service and module it runs, read the way
 * an analyst would: a health scorecard and written findings first, then one chart
 * form per question (trend, mix, ranking, timing, distribution). Reads
 * /api/reports/property-overview, which degrades per module: a module the property
 * does not run shows "Not set up" instead of hiding the rest of the report.
 */

type Count = { name: string; count: number };
type Section<T> = ({ available: true; truncated?: boolean } & T) | { available: false; reason: string };

type MetricUnit = 'pct' | 'count' | 'inr' | 'hours' | 'units' | 'days';
interface ComparativeMetric { key: string; label: string; module: string; unit: MetricUnit; higherIsBetter: boolean }

interface Report {
    scope: 'property' | 'organization';
    property: { id: string; name: string; code: string | null; address: string | null; city: string | null; is_active: boolean | null };
    properties: { id: string; name: string; city: string | null }[];
    /** Per-property figures, only in organisation scope. */
    comparative: { metrics: ComparativeMetric[]; values: Record<string, Record<string, number | null>> } | null;
    range: { from: string; to: string; days: number };
    generated_at: string;
    sections: {
        tickets: Section<{
            total: number; open: number; closed: number; pending_validation: number; internal: number; open_now: number;
            sla_breached: number; closure_rate: number | null; avg_resolution_hours: number | null;
            by_category: Count[]; by_priority: Count[]; by_status: Count[]; by_floor: Count[];
            daily: { date: string; raised: number; closed: number }[];
            heatmap: number[][]; resolution_buckets: Count[];
        }>;
        guest_requests: Section<{ total: number; pending: number; in_progress: number; resolved: number; by_category: Count[] }>;
        sop: Section<{ scheduled: number; completed: number; late: number; missed: number; pending: number; completion_rate: number | null; templates: number; daily: { date: string; on_time: number; late: number; missed: number; pending: number }[] }>;
        ppm: Section<{ total: number; done: number; pending: number; postponed: number; skipped: number; compliance: number | null; overdue_now: number; by_system: { name: string; total: number; done: number }[] }>;
        electricity: Section<{ readings: number; days_logged: number; days_in_range: number; meters: number; units: number; cost: number; unit_label: string; daily: { date: string; units: number; cost: number }[]; by_meter: { name: string; units: number; cost: number }[] }>;
        diesel: Section<{ readings: number; days_logged: number; days_in_range: number; litres: number; cost: number; daily: { date: string; litres: number; cost: number }[]; by_generator: { name: string; litres: number; cost: number }[] }>;
        water: Section<{ sources: number; readings: number; days_logged: number; days_in_range: number; quantity: number; cost: number; daily: { date: string; quantity: number; cost: number }[]; by_source: { name: string; quantity: number; cost: number }[] }>;
        stock: Section<{ items: number; low_stock: number; low_stock_items: { name: string; quantity: number; min: number }[]; movements: number; added: number; removed: number; days_with_movement: number; daily: { date: string; added: number; removed: number }[] }>;
        assets: Section<{ total: number; active: number; under_repair: number; inactive: number; warranty_expiring_90d: number; amc_required: number; purchase_value: number; events_in_range: number; by_category: Count[] }>;
        amc: Section<{ total: number; active: number; expired: number; expiring_60d: number; total_value: number; expiring_list: { system: string; vendor: string; ends: string }[] }>;
        visitors: Section<{ total: number; checked_in: number; checked_out: number; per_day: number; daily: { date: string; visitors: number }[]; by_weekday: number[] }>;
        meeting_rooms: Section<{ rooms: number; bookings: number; confirmed: number; cancelled: number; hours_booked: number; by_status: Count[]; daily: { date: string; bookings: number; hours: number }[]; by_room: { name: string; bookings: number; hours: number }[] }>;
        petty_cash: Section<{ requests: number; requested_amount: number; approved_amount: number; paid_amount: number; pending_approval: number; rejected: number; closed: number; by_status: Count[] }>;
        procurement: Section<{ requests: number; pending: number; approved: number; delivered: number; rejected: number; total_amount: number; by_status: Count[] }>;
        requisitions: Section<{ months_in_range: number; expected?: number; submitted: number; acknowledged: number; missing_months: string[] }>;
        roster: Section<{ shifts: number; staff_rostered: number; reliever_shifts: number; days_covered: number; days_in_range: number }>;
        tasks: Section<{ total: number; completed: number; in_progress: number; pending: number; completion_rate: number | null }>;
        audit: Section<{ items: number; compliant: number; pending_review: number; missing: number; not_applicable: number; compliance: number | null }>;
        team: Section<{ members: number; by_role: Count[] }>;
    };
}

// ── palette (validated with the dataviz checker, light and dark surfaces) ───
// Categorical hues in fixed order: a series keeps its colour whatever else is on the chart.
const C = { blue: '#2563eb', amber: '#d97706', cyan: '#0891b2', red: '#dc2626', violet: '#7c3aed', magenta: '#be185d' };
// Status colours are reserved for state (good / warning / bad) and never reused for a series.
const S = { good: '#059669', warn: '#d97706', bad: '#dc2626', neutral: '#94a3b8' };
const GRID = '#e2e8f0';
const TICK = { fontSize: 10, fill: '#94a3b8' };
const TIP = { borderRadius: 12, border: `1px solid ${GRID}`, fontSize: 12 };

type Preset = 'mtd' | 'last_month' | '30' | '90' | 'custom';
const PRESETS: { id: Preset; label: string }[] = [
    { id: 'mtd', label: 'This month' },
    { id: 'last_month', label: 'Last month' },
    { id: '30', label: 'Last 30 days' },
    { id: '90', label: 'Last 90 days' },
    { id: 'custom', label: 'Custom' },
];

const IST_OFFSET_MS = 330 * 60 * 1000;
function todayIst(): string { return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10); }
function addDays(day: string, n: number): string { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function presetRange(p: Preset): { from: string; to: string } {
    const today = todayIst();
    if (p === 'mtd') return { from: `${today.slice(0, 7)}-01`, to: today };
    if (p === 'last_month') {
        const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
        return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
    }
    if (p === '30') return { from: addDays(today, -29), to: today };
    return { from: addDays(today, -89), to: today };
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const n0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtDay(d: string) { return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function fmtRange(from: string, to: string) { return `${fmtDay(from)} to ${fmtDay(to)} ${to.slice(0, 4)}`; }
function fmtPct(v: number | null) { return v === null ? 'no data' : `${n1.format(Math.min(100, v))}%`; }
/** One baseline for every rate in the report: Good at 90% or more, Okay from 70%, Needs attention below 70%. */
const GOOD_AT = 90;
const OKAY_AT = 70;
function band(v: number | null): 'good' | 'warn' | 'bad' | 'default' { if (v === null || !Number.isFinite(v)) return 'default'; return v >= GOOD_AT ? 'good' : v >= OKAY_AT ? 'warn' : 'bad'; }
function rateOf(num: number, den: number): number | null { return den > 0 ? (num / den) * 100 : null; }
function fmtHours(h: number | null) { if (h === null) return 'no data'; return h < 48 ? `${n1.format(h)} h` : `${n1.format(h / 24)} d`; }
function titleCase(s: string) { return s.replace(/\b\w/g, c => c.toUpperCase()); }
function share(part: number, whole: number) { return whole > 0 ? Math.round((part / whole) * 100) : 0; }

// ── building blocks ──────────────────────────────────────────────────────────

function Stat({ label, value, tone = 'default', hint, parts }: { label: string; value: string | number; tone?: 'default' | 'good' | 'warn' | 'bad'; hint?: string; parts?: string }) {
    const toneCls = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : 'text-slate-900';
    return (
        <div className="min-w-0" title={hint}>
            <div className={`text-xl font-black tabular-nums leading-tight ${toneCls}`}>{value}</div>
            {parts && <div className="text-[10px] tabular-nums text-slate-500 leading-tight">{parts}</div>}
            <div className="text-[11px] font-medium text-slate-500 lowercase truncate">{label}</div>
        </div>
    );
}
/** The two numbers behind a rate, for the line under it: "48 of 64". */
function rateParts(num: number, den: number): string { return den > 0 ? `${n0.format(num)} of ${n0.format(den)}` : 'no data'; }

/** Chart heading with one plain line under it saying exactly what is counted. */
function ChartTitle({ children, note }: { children: React.ReactNode; note?: string }) {
    return (
        <div className="mb-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{children}</div>
            {note && <div className="text-[11px] text-slate-500 leading-snug">{note}</div>}
        </div>
    );
}

/** The one colour legend used everywhere a figure is coloured. */
function BandLegend({ compact }: { compact?: boolean }) {
    const items = [
        { label: `Good: ${GOOD_AT}% or more`, color: S.good },
        { label: `Okay: ${OKAY_AT} to ${GOOD_AT - 1}%`, color: S.warn },
        { label: `Needs attention: below ${OKAY_AT}%`, color: S.bad },
        { label: 'No data', color: S.neutral },
    ];
    return (
        <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-600`}>
            {items.map(i => <li key={i.label} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: i.color }} />{i.label}</li>)}
        </ul>
    );
}

function Empty({ text = 'nothing in this range' }: { text?: string }) {
    return <div className="h-full min-h-[96px] flex items-center justify-center text-xs text-slate-400 italic">{text}</div>;
}

// ── drill-down: any visual can be opened at full size with the rows behind it ──
type DrillTable = { columns: string[]; rows: (string | number | null)[][] };
type DrillKind = 'trend' | 'stacked' | 'ranking' | 'mix' | 'heatmap' | 'rate' | 'custom';
type DrillSpec = { title: string; note?: string; render: () => React.ReactNode; table?: DrillTable; kind?: DrillKind; analysis?: string[]; focus?: 'analysis' | 'visual' };

// ── analysis: plain sentences worked out from the rows of the visual, by fixed rules ──
const num = (v: string | number | null) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function pctChange(a: number, b: number): string | null {
    if (a <= 0) return null;
    const d = ((b - a) / a) * 100;
    return `${d >= 0 ? 'up' : 'down'} ${n0.format(Math.abs(d))}%`;
}
function analyseTrend(t: DrillTable, stacked: boolean): string[] {
    const out: string[] = [];
    const labels = t.rows.map(r => String(r[0]));
    const seriesCols = t.columns.slice(1, stacked ? -1 : undefined);
    const days = t.rows.length;
    const totals = seriesCols.map((c, i) => ({ name: c, values: t.rows.map(r => num(r[i + 1])) }));
    for (const sr of totals) {
        const total = sr.values.reduce((a, b) => a + b, 0);
        if (total === 0) { out.push(`${sr.name}: nothing recorded in these ${days} days.`); continue; }
        const avg = total / days;
        const maxI = sr.values.indexOf(Math.max(...sr.values));
        const minI = sr.values.indexOf(Math.min(...sr.values));
        const zeros = sr.values.filter(v => v === 0).length;
        const half = Math.floor(days / 2);
        const first = sr.values.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
        const second = sr.values.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, days - half);
        const change = days >= 4 ? pctChange(first, second) : null;
        out.push(`${sr.name}: ${n0.format(total)} in total, about ${n1.format(avg)} per day. Highest on ${labels[maxI]} (${n0.format(sr.values[maxI])}), lowest on ${labels[minI]} (${n0.format(sr.values[minI])}).`);
        if (change) out.push(`${sr.name} in the second half of the period is ${change} compared with the first half (${n1.format(first)} vs ${n1.format(second)} per day).`);
        if (zeros > 0) out.push(`${sr.name} has ${zeros} day${zeros === 1 ? '' : 's'} with nothing recorded (${share(zeros, days)}% of the period).`);
    }
    if (totals.length === 2) {
        const [a, b] = totals.map(x => x.values.reduce((p, q) => p + q, 0));
        const diff = a - b;
        if (diff !== 0) out.push(`${diff > 0 ? totals[0].name : totals[1].name} (${n0.format(Math.max(a, b))}) exceeds ${diff > 0 ? totals[1].name : totals[0].name} (${n0.format(Math.min(a, b))}) by ${n0.format(Math.abs(diff))} over the period.`);
        else out.push(`${totals[0].name} and ${totals[1].name} are equal over the period (${n0.format(a)} each).`);
    }
    if (stacked) {
        const totalCol = t.rows.map(r => num(r[r.length - 1]));
        const grand = totalCol.reduce((a, b) => a + b, 0);
        if (grand > 0) {
            const parts = seriesCols.map((c, i) => ({ name: c, v: t.rows.reduce((a, r) => a + num(r[i + 1]), 0) })).sort((x, y) => y.v - x.v);
            out.push(`Across all ${n0.format(grand)}: ${parts.map(p => `${p.name} ${n0.format(p.v)} (${share(p.v, grand)}%)`).join(', ')}.`);
        }
    }
    return out;
}
function analyseRanking(t: DrillTable): string[] {
    const rows = t.rows.map(r => ({ name: String(r[0]), v: num(r[1]) })).filter(r => r.v !== null);
    const total = rows.reduce((a, r) => a + r.v, 0);
    if (!rows.length || total === 0) return ['Nothing recorded for this visual in the period.'];
    const sorted = [...rows].sort((a, b) => b.v - a.v);
    const out: string[] = [];
    out.push(`${sorted.length} item${sorted.length === 1 ? '' : 's'}, ${n1.format(total)} in total. ${sorted[0].name} is the largest at ${n1.format(sorted[0].v)} (${share(sorted[0].v, total)}% of the total).`);
    if (sorted.length >= 3) {
        const top3 = sorted.slice(0, 3).reduce((a, r) => a + r.v, 0);
        out.push(`The top three (${sorted.slice(0, 3).map(r => r.name).join(', ')}) make up ${share(top3, total)}% of the total.`);
    }
    if (sorted.length >= 2) {
        const last = sorted[sorted.length - 1];
        out.push(`${last.name} is the smallest at ${n1.format(last.v)}; the largest is ${last.v > 0 ? `${n1.format(sorted[0].v / last.v)} times` : 'infinitely'} bigger.`);
    }
    const zeros = rows.filter(r => r.v === 0);
    if (zeros.length) out.push(`${zeros.length} item${zeros.length === 1 ? ' has' : 's have'} nothing recorded: ${zeros.map(r => r.name).join(', ')}.`);
    return out;
}
function analyseMix(t: DrillTable): string[] {
    const rows = t.rows.map(r => ({ name: String(r[0]), v: num(r[1]), pct: num(r[2]) }));
    const total = rows.reduce((a, r) => a + r.v, 0);
    if (!total) return ['Nothing recorded for this visual in the period.'];
    const sorted = [...rows].sort((a, b) => b.v - a.v);
    const out = [`${sorted[0].name} is the biggest part at ${sorted[0].pct}% (${n0.format(sorted[0].v)} of ${n0.format(total)}).`];
    if (sorted.length > 1) out.push(`Remaining parts: ${sorted.slice(1).map(r => `${r.name} ${r.pct}%`).join(', ')}.`);
    return out;
}
function analyseHeatmap(t: DrillTable): string[] {
    const rows = t.rows.map(r => ({ day: String(r[0]), hours: r.slice(1, 25).map(num), total: num(r[25]) }));
    const grand = rows.reduce((a, r) => a + r.total, 0);
    if (!grand) return ['No requests recorded in the period.'];
    const busiestDay = [...rows].sort((a, b) => b.total - a.total)[0];
    const quietestDay = [...rows].sort((a, b) => a.total - b.total)[0];
    const byHour = Array.from({ length: 24 }, (_, h) => rows.reduce((a, r) => a + r.hours[h], 0));
    const peakHour = byHour.indexOf(Math.max(...byHour));
    const office = byHour.slice(9, 18).reduce((a, b) => a + b, 0);
    const night = [...byHour.slice(0, 7), ...byHour.slice(21)].reduce((a, b) => a + b, 0);
    const weekend = rows.filter(r => r.day === 'Sat' || r.day === 'Sun').reduce((a, r) => a + r.total, 0);
    return [
        `${busiestDay.day} is the busiest weekday with ${n0.format(busiestDay.total)} requests (${share(busiestDay.total, grand)}%); ${quietestDay.day} is the quietest with ${n0.format(quietestDay.total)}.`,
        `The peak hour is ${peakHour}:00 to ${peakHour + 1}:00 with ${n0.format(byHour[peakHour])} requests across the period.`,
        `${share(office, grand)}% of requests arrive between 9:00 and 18:00; ${share(night, grand)}% arrive at night (before 7:00 or after 21:00); ${share(weekend, grand)}% arrive on weekends.`,
    ];
}
function analyseRate(t: DrillTable): string[] {
    const r = t.rows[0];
    if (!r) return [];
    const nume = num(r[1]); const den = num(r[2]); const rate = num(r[3]);
    const st = statusOf(rate);
    const need = Math.max(0, Math.ceil(den * GOOD_AT / 100) - nume);
    const out = [`${String(r[0])} is ${n1.format(rate)}%: ${n0.format(nume)} out of ${n0.format(den)}. That is ${STATUS[st].label.toLowerCase()} against the ${GOOD_AT}% target.`];
    if (st !== 'good') out.push(`To reach ${GOOD_AT}% in this period, ${n0.format(need)} more would have been needed (${n0.format(nume + need)} of ${n0.format(den)}).`);
    else out.push(`It is ${n1.format(rate - GOOD_AT)} points above the target. The margin is ${n0.format(nume - Math.ceil(den * GOOD_AT / 100))} ${den === 1 ? '' : 'items'}.`);
    if (den > 0 && den < 10) out.push(`The denominator is ${n0.format(den)}, so each single item changes this rate by ${n1.format(100 / den)} points.`);
    return out;
}
function analyse(spec: DrillSpec): string[] {
    if (spec.analysis) return spec.analysis;
    if (!spec.table) return [];
    switch (spec.kind) {
        case 'trend': return analyseTrend(spec.table, false);
        case 'stacked': return analyseTrend(spec.table, true);
        case 'ranking': return analyseRanking(spec.table);
        case 'mix': return analyseMix(spec.table);
        case 'heatmap': return analyseHeatmap(spec.table);
        case 'rate': return analyseRate(spec.table);
        default: return [];
    }
}
const DrillContext = React.createContext<(spec: DrillSpec) => void>(() => undefined);

function ExploreButton({ spec, label = 'Explore' }: { spec: DrillSpec; label?: string }) {
    const open = useContext(DrillContext);
    const btn = 'inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-2 py-0.5 text-[10px] font-bold shadow-sm hover:border-slate-300 transition';
    return (
        <span className="inline-flex items-center gap-1">
            <button type="button" onClick={() => open({ ...spec, focus: 'analysis' })} title="Read what this visual says" className={`${btn} text-indigo-700 hover:text-indigo-900`}>
                <Sparkles className="w-3 h-3" /> Analyse
            </button>
            <button type="button" onClick={() => open({ ...spec, focus: 'visual' })} title="Open at full size with the data behind it" className={`${btn} text-slate-600 hover:text-slate-900`}>
                <Maximize2 className="w-3 h-3" /> {label}
            </button>
        </span>
    );
}

/** Wraps a chart with its Explore control. `big` renders the same chart at full size inside the panel. */
function Explorable({ title, note, table, big, kind, children }: { title?: string; note?: string; table?: DrillTable; big: () => React.ReactNode; kind?: DrillKind; children: React.ReactNode }) {
    if (!title) return <>{children}</>;
    return (
        <div className="relative group pt-6">
            <div className="absolute right-0 top-0 z-10 opacity-80 group-hover:opacity-100 transition"><ExploreButton spec={{ title, note, render: big, table, kind }} /></div>
            {children}
        </div>
    );
}

function csvOf(t: DrillTable): string {
    const esc = (v: string | number | null) => { const x = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    return [t.columns.map(esc).join(','), ...t.rows.map(r => r.map(esc).join(','))].join('\n');
}

function DrillDrawer({ spec, onClose, period }: { spec: DrillSpec; onClose: () => void; period: string }) {
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);
    const download = () => {
        if (!spec.table) return;
        const blob = new Blob([csvOf(spec.table)], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${spec.title.replace(/[^a-z0-9]+/gi, '_')}.csv`; a.click();
        URL.revokeObjectURL(url);
    };
    return (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={spec.title}>
            <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]" onClick={onClose} />
            <aside className="absolute right-0 top-0 h-full w-full max-w-3xl bg-white shadow-2xl overflow-y-auto">
                <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4 z-10">
                    <div className="min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{period}</div>
                        <h3 className="text-lg font-black text-slate-900 leading-tight">{spec.title}</h3>
                        {spec.note && <p className="text-xs text-slate-600 mt-1">{spec.note}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {spec.table && (
                            <button type="button" onClick={download} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                                <Download className="w-3.5 h-3.5" /> CSV
                            </button>
                        )}
                        <button type="button" onClick={onClose} aria-label="Close" className="rounded-xl border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"><X className="w-4 h-4" /></button>
                    </div>
                </div>
                <div className="px-6 py-5 space-y-6">
                    {(() => {
                        const lines = analyse(spec);
                        if (!lines.length) return null;
                        const block = (
                            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                                <div className="flex items-center gap-2 text-xs font-black text-indigo-900 mb-2"><Sparkles className="w-4 h-4" /> Analysis</div>
                                <ul className="space-y-1.5 text-sm text-slate-800 leading-snug list-disc pl-5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                                <p className="text-[10px] text-indigo-900/60 mt-2">Every sentence is a count, sum, average, share, rank or difference taken from the rows shown below. Nothing is estimated or interpreted.</p>
                            </div>
                        );
                        return spec.focus === 'visual' ? null : block;
                    })()}
                    <div>{spec.render()}</div>
                    {spec.focus === 'visual' && analyse(spec).length > 0 && (
                        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                            <div className="flex items-center gap-2 text-xs font-black text-indigo-900 mb-2"><Sparkles className="w-4 h-4" /> Analysis</div>
                            <ul className="space-y-1.5 text-sm text-slate-800 leading-snug list-disc pl-5">{analyse(spec).map((l, i) => <li key={i}>{l}</li>)}</ul>
                        </div>
                    )}
                    {spec.table && (
                        <div>
                            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">The rows behind this visual</div>
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                                <table className="min-w-full text-xs">
                                    <thead className="bg-slate-50">
                                        <tr>{spec.table.columns.map((c, i) => <th key={c} className={`px-3 py-2 font-bold text-slate-600 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{c}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {spec.table.rows.map((r, i) => (
                                            <tr key={i} className="odd:bg-white even:bg-slate-50/60">
                                                {r.map((v, j) => <td key={j} className={`px-3 py-1.5 tabular-nums whitespace-nowrap ${j === 0 ? 'text-left text-slate-800 font-medium' : 'text-right text-slate-700'}`}>{v === null || v === undefined ? '–' : typeof v === 'number' ? n1.format(v) : v}</td>)}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                        <BandLegend compact />
                        <p className="text-[11px] text-slate-500 mt-2">Press Esc or click outside to close. Download CSV to take these rows into a spreadsheet.</p>
                    </div>
                </div>
            </aside>
        </div>
    );
}

/** Ranking: horizontal bars, one hue, value labelled at the bar end. */
function Ranking({ rows, color = C.blue, height, valueFormatter = (v: number) => n0.format(v), xLabel = 'Count', yLabel, title, note }: { rows: Count[]; color?: string; height?: number; valueFormatter?: (v: number) => string; xLabel?: string; yLabel?: string; title?: string; note?: string }) {
    if (!rows.length) return <Empty />;
    const h = (height ?? Math.max(96, rows.length * 26 + 8)) + 26;
    const chart = (
        <div style={{ height: h }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 14 }} barCategoryGap={6}>
                    <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} tickFormatter={v => valueFormatter(Number(v))} allowDecimals={false}>
                        <Label value={`→ ${xLabel}`} position="insideBottom" offset={-10} style={{ fontSize: 10, fill: '#64748b' }} />
                    </XAxis>
                    <YAxis type="category" dataKey="name" width={118} interval={0} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} tickFormatter={(v: string) => titleCase(v).slice(0, 18)}>
                        {yLabel && <Label value={yLabel} angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b', textAnchor: 'middle' }} />}
                    </YAxis>
                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={TIP} formatter={v => [valueFormatter(Number(v)), xLabel]} />
                    <Bar isAnimationActive={false} dataKey="count" fill={color} radius={[0, 4, 4, 0]} maxBarSize={14}>
                        <LabelList dataKey="count" position="right" formatter={v => valueFormatter(Number(v))} style={{ fontSize: 10, fill: '#334155', fontWeight: 700 }} />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
    return <Explorable kind="ranking" title={title} note={note} table={{ columns: [yLabel || 'Item', xLabel], rows: rows.map(r => [titleCase(r.name), r.count]) }} big={() => <Ranking rows={rows} color={color} height={Math.max(260, rows.length * 34)} valueFormatter={valueFormatter} xLabel={xLabel} yLabel={yLabel} />}>{chart}</Explorable>;
}

/** Trend: one or more series per day. Bars for counts, area for continuous measures. */
function Trend<T extends { date: string }>({ data, series, kind = 'bar', height = 180, unit, yLabel = 'Count', xLabel = 'Day', title, note }: {
    data: T[]; series: { key: keyof T & string; name: string; color: string }[]; kind?: 'bar' | 'area'; height?: number; unit?: string; yLabel?: string; xLabel?: string; title?: string; note?: string;
}) {
    if (!data.length || !data.some(d => series.some(s => Number(d[s.key]) > 0))) return <Empty />;
    const fmt = (v: number) => `${n1.format(v)}${unit ? ` ${unit}` : ''}`;
    const common = {
        data, margin: { top: 6, right: 6, left: 0, bottom: series.length > 1 ? 30 : 14 },
    };
    const axes = (<>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tick={TICK} axisLine={false} tickLine={false} minTickGap={18}>
            <Label value={`→ ${xLabel}`} position="insideBottom" offset={-10} style={{ fontSize: 10, fill: '#64748b' }} />
        </XAxis>
        <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={44}>
            <Label value={`↑ ${yLabel}`} angle={-90} position="insideLeft" offset={12} style={{ fontSize: 10, fill: '#64748b', textAnchor: 'middle' }} />
        </YAxis>
        <Tooltip cursor={kind === 'bar' ? { fill: '#f1f5f9' } : { stroke: '#94a3b8', strokeDasharray: '3 3' }} labelFormatter={d => fmtDay(String(d))} contentStyle={TIP} formatter={v => [fmt(Number(v)), '']} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, paddingTop: 18 }} iconSize={8} />}
    </>);
    const chart = (
        <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
                {kind === 'bar' ? (
                    <BarChart {...common} barGap={2}>
                        {axes}
                        {series.map(s => <Bar isAnimationActive={false} key={s.key} name={s.name} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
                    </BarChart>
                ) : (
                    <AreaChart {...common}>
                        <defs>
                            {series.map(s => (
                                <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                                </linearGradient>
                            ))}
                        </defs>
                        {axes}
                        {series.map(s => <Area isAnimationActive={false} key={s.key} type="monotone" name={s.name} dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} dot={{ r: 2.5, strokeWidth: 0, fill: s.color }} activeDot={{ r: 5 }} />)}
                    </AreaChart>
                )}
            </ResponsiveContainer>
        </div>
    );
    return <Explorable kind="trend" title={title} note={note} table={{ columns: [xLabel, ...series.map(x => x.name)], rows: data.map(d => [fmtDay(d.date), ...series.map(x => Number(d[x.key]))]) }} big={() => <Trend data={data} series={series} kind={kind} height={380} unit={unit} yLabel={yLabel} xLabel={xLabel} />}>{chart}</Explorable>;
}

/** Stacked daily bars for a status mix over time. */
function StackedTrend<T extends { date: string }>({ data, series, height = 200, yLabel = 'Count', xLabel = 'Day', title, note }: { data: T[]; series: { key: keyof T & string; name: string; color: string }[]; height?: number; yLabel?: string; xLabel?: string; title?: string; note?: string }) {
    if (!data.length || !data.some(d => series.some(s => Number(d[s.key]) > 0))) return <Empty />;
    const chart = (
        <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={TICK} axisLine={false} tickLine={false} minTickGap={18}>
                        <Label value={`→ ${xLabel}`} position="insideBottom" offset={-10} style={{ fontSize: 10, fill: '#64748b' }} />
                    </XAxis>
                    <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={44}>
                        <Label value={`↑ ${yLabel}`} angle={-90} position="insideLeft" offset={12} style={{ fontSize: 10, fill: '#64748b', textAnchor: 'middle' }} />
                    </YAxis>
                    <Tooltip cursor={{ fill: '#f1f5f9' }} labelFormatter={d => fmtDay(String(d))} contentStyle={TIP} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 18 }} iconSize={8} />
                    {series.map((s, i) => <Bar isAnimationActive={false} key={s.key} name={s.name} dataKey={s.key} stackId="a" fill={s.color} stroke="#fff" strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />)}
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
    return <Explorable kind="stacked" title={title} note={note} table={{ columns: [xLabel, ...series.map(x => x.name), 'Total'], rows: data.map(d => [fmtDay(d.date), ...series.map(x => Number(d[x.key])), series.reduce((a, x) => a + Number(d[x.key]), 0)]) }} big={() => <StackedTrend data={data} series={series} height={380} yLabel={yLabel} xLabel={xLabel} />}>{chart}</Explorable>;
}

/** Mix: one 100% bar split into segments, with a legend that carries the numbers. */
function Mix({ parts, total, title, note }: { parts: { name: string; value: number; color: string }[]; total?: number; title?: string; note?: string }) {
    const sum = total ?? parts.reduce((s, p) => s + p.value, 0);
    if (sum <= 0) return <Empty />;
    const chart = (
        <div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 gap-[2px]">
                {parts.filter(p => p.value > 0).map(p => (
                    <div key={p.name} title={`${p.name}: ${n0.format(p.value)} (${share(p.value, sum)}%)`} style={{ width: `${(p.value / sum) * 100}%`, background: p.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
                ))}
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                {parts.map(p => (
                    <li key={p.name} className="flex items-center gap-1.5 text-[11px] text-slate-600 min-w-0">
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} />
                        <span className="truncate">{titleCase(p.name)}</span>
                        <span className="ml-auto font-bold tabular-nums text-slate-900">{n0.format(p.value)}</span>
                        <span className="text-slate-400 tabular-nums w-8 text-right">{share(p.value, sum)}%</span>
                    </li>
                ))}
            </ul>
        </div>
    );
    return <Explorable kind="mix" title={title} note={note} table={{ columns: ['Part', 'Count', 'Share %'], rows: parts.map(x => [titleCase(x.name), x.value, share(x.value, total ?? parts.reduce((a, q) => a + q.value, 0))]) }} big={() => <div className="pt-2"><Mix parts={parts} total={total} /><div className="mt-6"><Ranking rows={parts.map(x => ({ name: x.name, count: x.value }))} xLabel="Count" /></div></div>}>{chart}</Explorable>;
}

/** Timing: weekday x hour grid, one hue light to dark. */
function Heatmap({ grid, title, note }: { grid: number[][]; title?: string; note?: string }) {
    const max = Math.max(0, ...grid.flat());
    if (max === 0) return <Empty />;
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const chart = (
        <div className="text-[9px] text-slate-400">
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: `28px repeat(24, minmax(0, 1fr))` }}>
                <div />
                {hours.map(h => <div key={h} className="text-center tabular-nums">{h % 3 === 0 ? h : ''}</div>)}
                {grid.map((row, wd) => (
                    <React.Fragment key={wd}>
                        <div className="flex items-center font-bold text-slate-500">{WEEKDAYS[wd]}</div>
                        {row.map((v, h) => (
                            <div key={h} title={`${WEEKDAYS[wd]} ${h}:00 to ${h + 1}:00: ${v} raised`} className="aspect-square rounded-[3px]"
                                style={{ background: v === 0 ? '#f1f5f9' : `rgba(37, 99, 235, ${0.18 + 0.82 * (v / max)})` }} />
                        ))}
                    </React.Fragment>
                ))}
            </div>
            <div className="flex items-center justify-end gap-1 mt-1.5">
                <span>fewer</span>
                {[0.18, 0.4, 0.6, 0.8, 1].map(a => <span key={a} className="w-3 h-3 rounded-[3px]" style={{ background: `rgba(37, 99, 235, ${a})` }} />)}
                <span>more (max {max})</span>
            </div>
        </div>
    );
    return <Explorable kind="heatmap" title={title} note={note} table={{ columns: ['Weekday', ...Array.from({ length: 24 }, (_, h) => `${h}:00`), 'Total'], rows: grid.map((row, wd) => [WEEKDAYS[wd], ...row, row.reduce((a, b) => a + b, 0)]) }} big={() => <div className="text-sm"><Heatmap grid={grid} /></div>}>{chart}</Explorable>;
}

/** Scorecard: every rate against the same target, each with the two numbers behind it and the formula in words. */
type ScoreRow = { name: string; value: number; num: number; den: number; unit: string; formula: string };
function Scorecard({ rows }: { rows: ScoreRow[] }) {
    const open = useContext(DrillContext);
    if (!rows.length) return <Empty text="no rate-based measures available" />;
    const openRow = (r: ScoreRow) => open({
        title: r.name, note: r.formula,
        render: () => (
            <div className="space-y-4">
                <div className="flex items-end gap-6">
                    <div><div className={`text-5xl font-black tabular-nums ${band(r.value) === 'good' ? 'text-emerald-700' : band(r.value) === 'warn' ? 'text-amber-700' : 'text-red-700'}`}>{n1.format(r.value)}%</div><div className="text-xs text-slate-500">{STATUS[statusOf(r.value)].label} · target {GOOD_AT}%</div></div>
                    <div className="text-sm text-slate-700"><span className="font-black text-slate-900">{n0.format(r.num)}</span> {r.unit} out of <span className="font-black text-slate-900">{n0.format(r.den)}</span></div>
                </div>
                <Scorecard rows={[r]} />
                <p className="text-xs text-slate-600">{r.num} ÷ {r.den} × 100 = {n1.format(r.value)}%. To reach {GOOD_AT}% this period needed {Math.max(0, Math.ceil(r.den * GOOD_AT / 100) - r.num)} more {r.unit}.</p>
            </div>
        ),
        table: { columns: ['Measure', 'Numerator', 'Denominator', 'Rate %'], rows: [[r.name, r.num, r.den, Math.round(r.value * 10) / 10]] },
        kind: 'rate', focus: 'analysis',
    });
    return (
        <div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 pl-[9.5rem] pr-[7.5rem]">
                <span>0%</span><span>target {GOOD_AT}%</span><span>100%</span>
            </div>
            <ul className="space-y-1.5">
                {rows.map(r => {
                    const b = band(r.value);
                    const color = b === 'good' ? S.good : b === 'warn' ? S.warn : S.bad;
                    return (
                        <li key={r.name} className="grid items-center gap-2 rounded-lg -mx-1 px-1 py-0.5 hover:bg-slate-50 cursor-pointer" style={{ gridTemplateColumns: '9rem 1fr 7rem' }} title={`${r.formula}. Click to explore.`} onClick={() => openRow(r)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') openRow(r); }}>
                            <span className="text-xs text-slate-700 truncate flex items-center gap-1"><ChevronRight className="w-3 h-3 text-slate-300" />{r.name}</span>
                            <span className="relative h-3 rounded-full bg-slate-100 overflow-visible">
                                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, r.value))}%`, background: color }} />
                                <span className="absolute -top-0.5 -bottom-0.5 w-px border-l border-dashed border-slate-500" style={{ left: `${GOOD_AT}%` }} aria-hidden />
                            </span>
                            <span className="text-[11px] tabular-nums text-right whitespace-nowrap">
                                <span className="font-black text-slate-900">{n1.format(r.value)}%</span>
                                <span className="text-slate-500"> {n0.format(r.num)} of {n0.format(r.den)} {r.unit}</span>
                            </span>
                        </li>
                    );
                })}
            </ul>
            <p className="text-[10px] text-slate-400 mt-2">Click a row to see its formula and numbers at full size. The dashed line is the {GOOD_AT}% target.</p>
        </div>
    );
}

function ModuleCard({ icon: Icon, title, section, children, span = 1 }: {
    icon: React.ElementType; title: string; section: Section<object>; children?: React.ReactNode; span?: 1 | 2 | 3;
}) {
    const spanCls = span === 3 ? 'md:col-span-2 xl:col-span-3' : span === 2 ? 'md:col-span-2' : '';
    return (
        <section className={`bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col ${spanCls}`}>
            <header className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-slate-700" />
                </div>
                <h3 className="text-sm font-black text-slate-900">{title}</h3>
                {section.available && section.truncated && (
                    <span className="ml-auto text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full" title="More rows than the report reads; figures are a lower bound">partial</span>
                )}
            </header>
            {section.available ? children : (
                <p className="text-xs text-slate-400 italic">{section.reason}</p>
            )}
        </section>
    );
}

// ── analyst layer ────────────────────────────────────────────────────────────

function buildScorecard(r: Report): ScoreRow[] {
    const s = r.sections;
    const rows: ScoreRow[] = [];
    const add = (name: string, num: number, den: number, unit: string, formula: string) => { if (den > 0) rows.push({ name, value: Math.max(0, Math.min(100, (num / den) * 100)), num, den, unit, formula }); };
    if (s.tickets.available) {
        add('Request closure', s.tickets.closed, s.tickets.total, 'closed', 'Requests closed ÷ requests raised in the period');
        add('SLA met', s.tickets.total - s.tickets.sla_breached, s.tickets.total, 'within SLA', 'Requests not breaching SLA ÷ requests raised in the period');
    }
    if (s.sop.available) add('Checklist completion', s.sop.completed, s.sop.scheduled, 'completed', 'Checklists completed ÷ checklists due in the period');
    if (s.ppm.available) add('PPM compliance', s.ppm.done, s.ppm.total, 'done', 'Maintenance jobs done ÷ jobs planned in the period');
    if (s.tasks.available) add('Task completion', s.tasks.completed, s.tasks.total, 'completed', 'Tasks completed ÷ tasks assigned to the property team in the period');
    if (s.audit.available) add('Audit compliance', s.audit.compliant, s.audit.items - s.audit.not_applicable, 'compliant', 'Compliant audit items ÷ (all items − not applicable), current state');
    if (s.roster.available && s.roster.shifts > 0) add('Roster coverage', s.roster.days_covered, s.roster.days_in_range, 'days', 'Days with at least one rostered shift ÷ days in the period');
    if (s.electricity.available && s.electricity.readings > 0) add('Electricity logging', s.electricity.days_logged, s.electricity.days_in_range, 'days', 'Days with at least one electricity reading ÷ days in the period');
    if (s.diesel.available && s.diesel.readings > 0) add('Diesel logging', s.diesel.days_logged, s.diesel.days_in_range, 'days', 'Days with at least one diesel reading ÷ days in the period. A day the generator did not run still counts as missing.');
    if (s.water.available && s.water.sources > 0) add('Water logging', s.water.days_logged, s.water.days_in_range, 'days', 'Days with at least one water reading ÷ days in the period');
    if (s.requisitions.available) add('Requisitions submitted', Math.min(s.requisitions.submitted, s.requisitions.expected ?? s.requisitions.months_in_range), s.requisitions.expected ?? s.requisitions.months_in_range, 'months', 'Monthly requisitions submitted ÷ months expected in the period (months × properties)');
    return rows;
}

// ── property comparison (organisation scope) ────────────────────────────────

function fmtMetric(v: number | null, unit: MetricUnit): string {
    if (v === null || v === undefined) return 'no data';
    switch (unit) {
        case 'pct': return `${n1.format(v)}%`;
        case 'inr': return inr.format(v);
        case 'hours': return fmtHours(v);
        case 'days': return `${n0.format(v)} d`;
        default: return n0.format(v);
    }
}

/** The one rate that tells a non-technical reader how a module is going at a property. Higher is always better here. */
const MODULE_SCORES: { key: string; module: string; question: string }[] = [
    { key: 'tickets_closure', module: 'Requests', question: 'share of requests closed' },
    { key: 'guest_resolved', module: 'Guest requests', question: 'share of guest requests resolved' },
    { key: 'sop_completion', module: 'Checklists', question: 'share of checklists completed' },
    { key: 'ppm_compliance', module: 'Maintenance', question: 'share of planned maintenance done' },
    { key: 'elec_logging', module: 'Electricity', question: 'days with a meter reading' },
    { key: 'diesel_logging', module: 'Diesel', question: 'days with a diesel reading' },
    { key: 'water_logging', module: 'Water', question: 'days with a water reading' },
    { key: 'stock_activity', module: 'Stock', question: 'days stock was updated' },
    { key: 'req_submitted', module: 'Requisitions', question: 'monthly requisitions submitted' },
    { key: 'roster_coverage', module: 'Roster', question: 'days with a roster' },
    { key: 'tasks_completion', module: 'Tasks', question: 'share of tasks completed' },
    { key: 'audit_compliance', module: 'Audit', question: 'share of audit items compliant' },
];
/** Plain numbers shown without judgement: activity, not performance. */
const ACTIVITY_COLUMNS: { key: string; label: string; unit: MetricUnit }[] = [
    { key: 'tickets_total', label: 'Requests raised', unit: 'count' },
    { key: 'tickets_open_now', label: 'Open now', unit: 'count' },
    { key: 'tickets_hours', label: 'Avg time to close', unit: 'hours' },
    { key: 'visitors_total', label: 'Visitors', unit: 'count' },
    { key: 'rooms_hours', label: 'Room hours', unit: 'hours' },
    { key: 'petty_paid', label: 'Petty cash paid', unit: 'inr' },
    { key: 'assets_repair', label: 'Assets in repair', unit: 'count' },
    { key: 'amc_expiring', label: 'AMC ending soon', unit: 'count' },
    { key: 'team_members', label: 'Team', unit: 'count' },
];

type Status = 'good' | 'okay' | 'attention' | 'none';
const STATUS: Record<Status, { label: string; cls: string; dot: string }> = {
    good: { label: 'Good', cls: 'bg-emerald-50 text-emerald-800', dot: S.good },
    okay: { label: 'Okay', cls: 'bg-amber-50 text-amber-800', dot: S.warn },
    attention: { label: 'Needs attention', cls: 'bg-red-50 text-red-800', dot: S.bad },
    none: { label: 'No data', cls: 'bg-slate-50 text-slate-400', dot: S.neutral },
};
function statusOf(v: number | null): Status {
    if (v === null || v === undefined) return 'none';
    return v >= GOOD_AT ? 'good' : v >= OKAY_AT ? 'okay' : 'attention';
}
function clampPct(v: number | null): number | null { return v === null || v === undefined ? null : Math.max(0, Math.min(100, v)); }

type ReportCard = { id: string; name: string; overall: number | null; scored: number; good: number; attention: number; scores: Record<string, number | null> };

function buildReportCards(properties: { id: string; name: string }[], values: Record<string, Record<string, number | null>>): ReportCard[] {
    return properties.map(p => {
        const scores: Record<string, number | null> = {};
        let sum = 0, n = 0, good = 0, attention = 0;
        for (const m of MODULE_SCORES) {
            const v = clampPct(values[p.id]?.[m.key] ?? null);
            scores[m.key] = v;
            if (v === null) continue;
            sum += v; n++;
            const st = statusOf(v);
            if (st === 'good') good++;
            if (st === 'attention') attention++;
        }
        return { id: p.id, name: p.name, overall: n ? Math.round(sum / n) : null, scored: n, good, attention, scores };
    }).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || b.scored - a.scored);
}

function StatusPill({ value, compact, parts }: { value: number | null; compact?: boolean; parts?: string }) {
    const st = statusOf(value);
    const s = STATUS[st];
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums whitespace-nowrap ${s.cls}`} title={`${s.label}${value === null ? '' : ` · ${n0.format(value)}%${parts ? ` (${parts})` : ''}`}`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
            {value === null ? (compact ? '–' : 'no data') : `${n0.format(value)}%`}
        </span>
    );
}

function PropertyComparison({ properties, comparative }: { properties: { id: string; name: string }[]; comparative: NonNullable<Report['comparative']> }) {
    const open = useContext(DrillContext);
    const [sortKey, setSortKey] = useState<string>('overall');
    const [showActivity, setShowActivity] = useState(false);
    const cards = useMemo(() => buildReportCards(properties, comparative.values), [properties, comparative]);
    const sorted = useMemo(() => {
        if (sortKey === 'overall') return cards;
        return [...cards].sort((a, b) => ((b.scores[sortKey] ?? -1) - (a.scores[sortKey] ?? -1)));
    }, [cards, sortKey]);
    const withScore = cards.filter(c => c.overall !== null);
    const best = withScore.slice(0, 3);
    const modulesInUse = MODULE_SCORES.filter(m => cards.some(c => c.scores[m.key] !== null));
    const partsOf = (pid: string, key: string) => {
        const num = comparative.values[pid]?.[`${key}_num`]; const den = comparative.values[pid]?.[`${key}_den`];
        return typeof num === 'number' && typeof den === 'number' ? `${n0.format(num)} of ${n0.format(den)}` : undefined;
    };
    const openProperty = (c: ReportCard) => open({
        title: c.name,
        note: `Overall ${c.overall === null ? 'no data' : `${c.overall} / 100`}: the average of ${c.scored} module scores. Good in ${c.good}, needs attention in ${c.attention}.`,
        render: () => (
            <div className="space-y-5">
                <ul className="space-y-1.5">
                    {MODULE_SCORES.map(m => (
                        <li key={m.key} className="grid items-center gap-3" style={{ gridTemplateColumns: '9rem 1fr 11rem' }}>
                            <span className="text-xs text-slate-700">{m.module}</span>
                            <span className="relative h-3 rounded-full bg-slate-100">
                                {c.scores[m.key] !== null && <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${c.scores[m.key]}%`, background: STATUS[statusOf(c.scores[m.key])].dot }} />}
                                <span className="absolute -top-0.5 -bottom-0.5 w-px border-l border-dashed border-slate-500" style={{ left: `${GOOD_AT}%` }} aria-hidden />
                            </span>
                            <span className="text-right"><StatusPill value={c.scores[m.key]} parts={partsOf(c.id, m.key)} /> <span className="text-[10px] text-slate-500">{partsOf(c.id, m.key) || ''}</span></span>
                        </li>
                    ))}
                </ul>
                <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Activity in the period</div>
                    <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {ACTIVITY_COLUMNS.map(a => <li key={a.key}><div className="text-base font-black text-slate-900 tabular-nums">{fmtMetric(comparative.values[c.id]?.[a.key] ?? null, a.unit)}</div><div className="text-[10px] text-slate-500">{a.label}</div></li>)}
                    </ul>
                </div>
            </div>
        ),
        table: { columns: ['Module', 'Score %', 'Numerator', 'Denominator'], rows: MODULE_SCORES.map(m => [m.module, c.scores[m.key], (comparative.values[c.id]?.[`${m.key}_num`] ?? null) as number | null, (comparative.values[c.id]?.[`${m.key}_den`] ?? null) as number | null]) },
        focus: 'analysis',
        analysis: (() => {
            const used = MODULE_SCORES.filter(m => c.scores[m.key] !== null);
            const strong = used.filter(m => statusOf(c.scores[m.key]) === 'good').map(m => m.module);
            const weak = used.filter(m => statusOf(c.scores[m.key]) === 'attention').map(m => `${m.module} (${n0.format(c.scores[m.key] ?? 0)}%)`);
            const okay = used.filter(m => statusOf(c.scores[m.key]) === 'okay').map(m => `${m.module} (${n0.format(c.scores[m.key] ?? 0)}%)`);
            const unused = MODULE_SCORES.filter(m => c.scores[m.key] === null).map(m => m.module);
            const rank = cards.findIndex(x => x.id === c.id) + 1;
            const lines = [`${c.name} scores ${c.overall === null ? 'no data' : `${c.overall} / 100`}, ranked ${rank} of ${cards.length} properties, from ${used.length} modules with data.`];
            if (strong.length) lines.push(`Good in ${strong.length}: ${strong.join(', ')}.`);
            if (okay.length) lines.push(`Okay but below target in ${okay.length}: ${okay.join(', ')}.`);
            if (weak.length) lines.push(`Needs attention in ${weak.length}: ${weak.join(', ')}.`);
            if (unused.length) lines.push(`Not using: ${unused.join(', ')}. These are left out of the score.`);
            return lines;
        })(),
    });
    const openModule = (m: { key: string; module: string; question: string }) => {
        const rows = [...cards].filter(c => c.scores[m.key] !== null).sort((a, b) => (b.scores[m.key] ?? 0) - (a.scores[m.key] ?? 0));
        open({
            title: `${m.module}: every property`, note: `Score = ${m.question}, out of 100. Sorted best to lowest.`,
            render: () => (
                <ul className="space-y-1.5">
                    {rows.map(c => (
                        <li key={c.id} className="grid items-center gap-3" style={{ gridTemplateColumns: '11rem 1fr 11rem' }}>
                            <span className="text-xs text-slate-700 truncate">{c.name}</span>
                            <span className="relative h-3 rounded-full bg-slate-100"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${c.scores[m.key]}%`, background: STATUS[statusOf(c.scores[m.key])].dot }} /><span className="absolute -top-0.5 -bottom-0.5 w-px border-l border-dashed border-slate-500" style={{ left: `${GOOD_AT}%` }} aria-hidden /></span>
                            <span className="text-right"><StatusPill value={c.scores[m.key]} parts={partsOf(c.id, m.key)} /> <span className="text-[10px] text-slate-500">{partsOf(c.id, m.key) || ''}</span></span>
                        </li>
                    ))}
                </ul>
            ),
            table: { columns: ['Property', 'Score %', 'Numerator', 'Denominator'], rows: rows.map(c => [c.name, c.scores[m.key], (comparative.values[c.id]?.[`${m.key}_num`] ?? null) as number | null, (comparative.values[c.id]?.[`${m.key}_den`] ?? null) as number | null]) },
            focus: 'analysis',
            analysis: (() => {
                if (!rows.length) return ['No property has data for this module in the period.'];
                const vals = rows.map(c => c.scores[m.key] ?? 0);
                const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                const good = rows.filter(c => statusOf(c.scores[m.key]) === 'good');
                const weak = rows.filter(c => statusOf(c.scores[m.key]) === 'attention');
                const lines = [`${rows.length} of ${properties.length} properties use ${m.module}. Average score ${n0.format(avg)}%, ranging from ${n0.format(vals[vals.length - 1])}% (${rows[rows.length - 1].name}) to ${n0.format(vals[0])}% (${rows[0].name}).`];
                lines.push(`${good.length} ${good.length === 1 ? 'is' : 'are'} at or above the ${GOOD_AT}% target${good.length ? `: ${good.map(c => c.name).join(', ')}` : ''}.`);
                if (weak.length) lines.push(`${weak.length} need${weak.length === 1 ? 's' : ''} attention: ${weak.map(c => `${c.name} (${n0.format(c.scores[m.key] ?? 0)}%)`).join(', ')}.`);
                lines.push(`The gap between the highest and the lowest property is ${n0.format(vals[0] - vals[vals.length - 1])} points.`);
                const notUsing = properties.filter(p => !rows.some(c => c.id === p.id)).map(p => p.name);
                if (notUsing.length) lines.push(`Not using it: ${notUsing.join(', ')}.`);
                return lines;
            })(),
        });
    };

    // One plain sentence per module: who is best, who needs attention, how many are fine.
    const moduleLines = modulesInUse.map(m => {
        const have = cards.filter(c => c.scores[m.key] !== null);
        const top = [...have].sort((a, b) => (b.scores[m.key] ?? 0) - (a.scores[m.key] ?? 0))[0];
        const low = [...have].sort((a, b) => (a.scores[m.key] ?? 0) - (b.scores[m.key] ?? 0))[0];
        const goodCount = have.filter(c => statusOf(c.scores[m.key]) === 'good').length;
        const attentionCount = have.filter(c => statusOf(c.scores[m.key]) === 'attention').length;
        return { m, top, low, goodCount, attentionCount, total: have.length };
    });

    return (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <header className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center"><Building2 className="w-4 h-4 text-slate-700" /></div>
                <h3 className="text-sm font-black text-slate-900">How each property is doing</h3>
            </header>
            <p className="text-[11px] text-slate-500 mb-4">
                Each module gets a simple score out of 100 for every property, and the overall score is the average of the modules that property uses.
                {' '}<span className="font-bold text-emerald-700">Good</span> is {GOOD_AT} or more, <span className="font-bold text-amber-700">Okay</span> is {OKAY_AT} to {GOOD_AT - 1}, <span className="font-bold text-red-700">Needs attention</span> is below {OKAY_AT}.
            </p>

            {/* Best and weakest, in sentences */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                    <div className="flex items-center gap-2 text-xs font-black text-emerald-800 mb-2"><CheckCircle2 className="w-4 h-4" /> Doing best</div>
                    {best.length ? (
                        <ol className="space-y-1.5">
                            {best.map((c, i) => (
                                <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                                    <button type="button" onClick={() => openProperty(c)} className="text-slate-800 truncate text-left hover:underline underline-offset-2"><span className="font-bold text-slate-400 mr-1.5">{i + 1}.</span>{c.name}</button>
                                    <span className="shrink-0 text-xs text-slate-600"><span className="font-black text-slate-900 text-sm">{c.overall}</span> / 100 · good in {c.good} of {c.scored} modules</span>
                                </li>
                            ))}
                        </ol>
                    ) : <p className="text-xs text-slate-500">No property has enough data yet.</p>}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-black text-slate-800 mb-2">How the score is worked out</div>
                    <p className="text-[11px] text-slate-600 leading-snug">Each module score is one rate for the period, for example checklists completed ÷ checklists due. The overall score is the plain average of the modules the property has data for. Hover any cell in the report card to see its two numbers.</p>
                    <div className="mt-3"><BandLegend compact /></div>
                </div>
            </div>

            {/* Module by module, in sentences */}
            <ChartTitle note="One sentence per module: best property, lowest property, how many need attention">Module by module</ChartTitle>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mb-5">
                {moduleLines.map(({ m, top, low, goodCount, attentionCount, total }) => (
                    <li key={m.key} className="text-xs text-slate-700 leading-relaxed">
                        <span className="font-bold text-slate-900">{m.module}</span>
                        <span className="text-slate-400"> ({m.question})</span>: {' '}
                        {goodCount === total
                            ? <>all {total} properties are doing well.</>
                            : <>
                                best is <span className="font-bold text-emerald-700">{top.name}</span> at {n0.format(top.scores[m.key] ?? 0)}%
                                {attentionCount > 0 && <>, while <span className="font-bold text-red-700">{attentionCount === 1 ? low.name : `${attentionCount} properties`}</span> need{attentionCount === 1 ? 's' : ''} attention{attentionCount > 1 ? `, lowest ${low.name} at ${n0.format(low.scores[m.key] ?? 0)}%` : ` at ${n0.format(low.scores[m.key] ?? 0)}%`}</>}
                                {attentionCount === 0 && <>; {goodCount} of {total} are good and the rest are okay</>}.
                            </>}
                    </li>
                ))}
                {moduleLines.length === 0 && <li className="text-xs text-slate-400 italic">No module has data for more than one property yet.</li>}
            </ul>

            {/* Report card grid */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <ChartTitle note="One score per module per property. Hover a cell for the two numbers behind it.">Report card</ChartTitle>
                <label className="flex items-center gap-2 text-[11px] text-slate-500">
                    Sort by
                    <select value={sortKey} onChange={e => setSortKey(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 bg-white" aria-label="Sort properties by">
                        <option value="overall">Overall score</option>
                        {modulesInUse.map(m => <option key={m.key} value={m.key}>{m.module}</option>)}
                    </select>
                </label>
            </div>
            <div className="overflow-x-auto -mx-1 px-1">
                <table className="min-w-full text-xs border-separate border-spacing-y-1">
                    <thead>
                        <tr>
                            <th className="text-left font-bold text-slate-500 pr-3 py-1 whitespace-nowrap sticky left-0 bg-white">Property</th>
                            <th className="text-left font-bold text-slate-900 px-2 py-1 whitespace-nowrap">Overall</th>
                            {modulesInUse.map(m => <th key={m.key} className="text-left font-bold text-slate-500 px-2 py-1 whitespace-nowrap"><button type="button" onClick={() => openModule(m)} className="hover:text-slate-900 underline-offset-2 hover:underline" title={`Rank every property on ${m.module}`}>{m.module}</button></th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map(c => (
                            <tr key={c.id} className="hover:bg-slate-50">
                                <td className="pr-3 py-1 whitespace-nowrap sticky left-0 bg-white"><button type="button" onClick={() => openProperty(c)} className="flex items-center gap-1 text-slate-800 font-medium hover:text-slate-900 hover:underline underline-offset-2" title="Open this property's full breakdown"><ChevronRight className="w-3 h-3 text-slate-300" />{c.name}</button></td>
                                <td className="px-2 py-1">
                                    {c.overall === null ? <StatusPill value={null} /> : (
                                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-black tabular-nums ${STATUS[statusOf(c.overall)].cls}`}>
                                            {c.overall} / 100
                                        </span>
                                    )}
                                </td>
                                {modulesInUse.map(m => {
                                    const num = comparative.values[c.id]?.[`${m.key}_num`];
                                    const den = comparative.values[c.id]?.[`${m.key}_den`];
                                    const parts = typeof num === 'number' && typeof den === 'number' ? `${n0.format(num)} of ${n0.format(den)}` : undefined;
                                    return <td key={m.key} className="px-2 py-1"><StatusPill value={c.scores[m.key]} compact parts={parts} /></td>;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Click a property for its full breakdown, or a module heading to rank every property on it. A dash means the property does not use that module, so it is left out of the overall score rather than counted against it.</p>

            {/* Activity figures, no judgement */}
            <button type="button" onClick={() => setShowActivity(v => !v)} className="mt-4 text-xs font-bold text-slate-600 hover:text-slate-900 underline underline-offset-2">
                {showActivity ? 'Hide activity figures' : 'Show activity figures (requests, visitors, spend and more)'}
            </button>
            {showActivity && (
                <div className="overflow-x-auto -mx-1 px-1 mt-2">
                    <table className="min-w-full text-xs border-separate border-spacing-y-1">
                        <thead>
                            <tr>
                                <th className="text-left font-bold text-slate-500 pr-3 py-1 whitespace-nowrap sticky left-0 bg-white">Property</th>
                                {ACTIVITY_COLUMNS.map(a => <th key={a.key} className="text-right font-bold text-slate-500 px-2 py-1 whitespace-nowrap">{a.label}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map(c => (
                                <tr key={c.id} className="odd:bg-slate-50/70">
                                    <td className="pr-3 py-1 text-slate-800 font-medium whitespace-nowrap sticky left-0 bg-white">{c.name}</td>
                                    {ACTIVITY_COLUMNS.map(a => <td key={a.key} className="px-2 py-1 text-right tabular-nums text-slate-700">{fmtMetric(comparative.values[c.id]?.[a.key] ?? null, a.unit)}</td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="text-[10px] text-slate-400 mt-1">These are plain counts for the period. A high or low number is not good or bad on its own: a quiet site raises fewer requests and sees fewer visitors.</p>
                </div>
            )}
        </section>
    );
}


/** Which modules each property actually uses: an entry in the period means the module is in use there. */
const USAGE_MODULES: { key: string; label: string; entry: string }[] = [
    { key: 'use_tickets', label: 'Requests', entry: 'tickets raised' },
    { key: 'use_guest', label: 'Guest requests', entry: 'QR requests' },
    { key: 'use_sop', label: 'Checklists', entry: 'checklists due' },
    { key: 'use_ppm', label: 'Maintenance', entry: 'jobs planned' },
    { key: 'use_elec', label: 'Electricity', entry: 'readings' },
    { key: 'use_diesel', label: 'Diesel', entry: 'readings' },
    { key: 'use_water', label: 'Water', entry: 'readings' },
    { key: 'use_stock', label: 'Stock', entry: 'movements' },
    { key: 'use_visitors', label: 'Visitors', entry: 'check-ins' },
    { key: 'use_rooms', label: 'Meeting rooms', entry: 'bookings' },
    { key: 'use_petty', label: 'Petty cash', entry: 'requests' },
    { key: 'use_proc', label: 'Procurement', entry: 'material requests' },
    { key: 'use_req', label: 'Requisitions', entry: 'submissions' },
    { key: 'use_roster', label: 'Roster', entry: 'shifts' },
    { key: 'use_tasks', label: 'Tasks', entry: 'tasks assigned' },
    { key: 'use_assets', label: 'Assets', entry: 'assets registered' },
    { key: 'use_audit', label: 'Audit', entry: 'audit items' },
];

function UsageAcrossProperties({ properties, comparative, days }: { properties: { id: string; name: string }[]; comparative: NonNullable<Report['comparative']>; days: number }) {
    const open = useContext(DrillContext);
    const [showGrid, setShowGrid] = useState(false);
    const openModule = (m: { key: string; label: string; entry: string }) => {
        const rows = properties.map(p => ({ name: p.name, count: Number(comparative.values[p.id]?.[m.key] ?? 0) })).sort((a, b) => b.count - a.count);
        open({
            title: `${m.label}: ${m.entry} per property`, note: `Entries recorded in the period (${days} days). A property with none is not using the module.`,
            render: () => <Ranking rows={rows} xLabel={titleCase(m.entry)} height={Math.max(220, rows.length * 30)} />,
            table: { columns: ['Property', titleCase(m.entry)], rows: rows.map(r => [r.name, r.count]) },
            kind: 'ranking', focus: 'analysis',
        });
    };
    const rows = USAGE_MODULES.map(m => {
        const per = properties.map(p => ({ p, n: Number(comparative.values[p.id]?.[m.key] ?? 0) }));
        const using = per.filter(x => x.n > 0);
        const total = per.reduce((a, x) => a + x.n, 0);
        return { m, using: using.length, total };
    });
    const N = properties.length;
    const pctUsing = (n: number) => Math.round((n / Math.max(1, N)) * 100);
    const toneCls = (n: number) => { const b = band(pctUsing(n)); return b === 'good' ? S.good : b === 'warn' ? S.warn : S.bad; };
    return (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <header className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center"><ListChecks className="w-4 h-4 text-slate-700" /></div>
                <h3 className="text-sm font-black text-slate-900">Which modules the properties are using</h3>
            </header>
            <p className="text-[11px] text-slate-500 mb-4">A property counts as using a module when it has at least one entry in the period ({days} days). The bar is properties using it ÷ {N} properties, coloured with the same bands.</p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                {rows.map(({ m, using, total }) => (
                    <li key={m.key} className="grid items-center gap-2 text-xs rounded-lg -mx-1 px-1 py-0.5 hover:bg-slate-50 cursor-pointer" style={{ gridTemplateColumns: '7rem 1fr 11rem' }} onClick={() => openModule(m)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') openModule(m); }} title="Click to see every property">
                        <span className="font-bold text-slate-800 truncate flex items-center gap-1"><ChevronRight className="w-3 h-3 text-slate-300" />{m.label}</span>
                        <span className="relative h-2.5 rounded-full bg-slate-100">
                            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pctUsing(using)}%`, background: toneCls(using) }} />
                        </span>
                        <span className="text-right tabular-nums text-slate-600 whitespace-nowrap">
                            <span className="font-black text-slate-900">{using} of {N}</span> · {n0.format(total)} {m.entry}
                        </span>
                    </li>
                ))}
            </ul>
            <button type="button" onClick={() => setShowGrid(v => !v)} className="mt-4 text-xs font-bold text-slate-600 hover:text-slate-900 underline underline-offset-2">
                {showGrid ? 'Hide the property by module grid' : 'Show the property by module grid (entries in the period)'}
            </button>
            {showGrid && (
                <div className="overflow-x-auto -mx-1 px-1 mt-2">
                    <table className="min-w-full text-[11px] border-separate border-spacing-y-1">
                        <thead>
                            <tr>
                                <th className="text-left font-bold text-slate-500 pr-3 py-1 whitespace-nowrap sticky left-0 bg-white">Property</th>
                                {USAGE_MODULES.map(m => <th key={m.key} className="text-right font-bold text-slate-500 px-2 py-1 whitespace-nowrap">{m.label}</th>)}
                                <th className="text-right font-bold text-slate-900 px-2 py-1 whitespace-nowrap">Modules in use</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...properties].map(p => {
                                const counts = USAGE_MODULES.map(m => Number(comparative.values[p.id]?.[m.key] ?? 0));
                                return { p, counts, inUse: counts.filter(n => n > 0).length };
                            }).sort((a, b) => b.inUse - a.inUse).map(({ p, counts, inUse }) => (
                                <tr key={p.id} className="odd:bg-slate-50/70">
                                    <td className="pr-3 py-1 text-slate-800 font-medium whitespace-nowrap sticky left-0 bg-white">{p.name}</td>
                                    {counts.map((n, i) => <td key={USAGE_MODULES[i].key} className={`px-2 py-1 text-right tabular-nums ${n > 0 ? 'text-slate-700' : 'text-slate-300'}`}>{n > 0 ? n0.format(n) : '–'}</td>)}
                                    <td className="px-2 py-1 text-right tabular-nums font-black text-slate-900">{inUse} of {USAGE_MODULES.length}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="text-[10px] text-slate-400 mt-1">A dash means no entry in the period. Assets and audit are counted as of today.</p>
                </div>
            )}
        </section>
    );
}


// ── report ───────────────────────────────────────────────────────────────────

interface Props {
    /** One property. Leave out and pass `orgId` for the cumulative report across every property. */
    propertyId?: string;
    /** Organisation scope: every active property, with a property comparison. */
    orgId?: string;
    /** Shown while the report loads, before the API returns the scope's own name. */
    propertyName?: string;
}

export default function PropertyOverviewReport({ propertyId, orgId, propertyName }: Props) {
    const [preset, setPreset] = useState<Preset>('mtd');
    const [custom, setCustom] = useState<{ from: string; to: string }>(() => presetRange('30'));
    const [report, setReport] = useState<Report | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [showHow, setShowHow] = useState(false);
    const [drill, setDrill] = useState<DrillSpec | null>(null);
    const closeDrill = useCallback(() => setDrill(null), []);
    const reportRef = useRef<HTMLDivElement>(null);

    const range = useMemo(() => preset === 'custom' ? custom : presetRange(preset), [preset, custom]);

    const load = useCallback(async () => {
        if (!propertyId && !orgId) return;
        setIsLoading(true);
        setError(null);
        try {
            const scope = propertyId ? `propertyId=${propertyId}` : `orgId=${orgId}`;
            const res = await fetch(`/api/reports/property-overview?${scope}&from=${range.from}&to=${range.to}`, { cache: 'no-store' });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to load the property report');
            setReport(data as Report);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load the property report');
        } finally {
            setIsLoading(false);
        }
    }, [propertyId, orgId, range.from, range.to]);

    useEffect(() => {
        if (preset === 'custom' && custom.from > custom.to) return;
        load();
    }, [load, preset, custom.from, custom.to]);

    const scorecard = useMemo(() => (report ? buildScorecard(report) : []), [report]);

    const handleDownloadPdf = async () => {
        const element = reportRef.current;
        if (!element || !report) return;
        setIsExporting(true);
        try {
            const canvas = await html2canvas(element, { scale: 1.5, useCORS: true, logging: false, backgroundColor: '#ffffff', windowWidth: 1200 });
            const imgData = canvas.toDataURL('image/png', 0.85);
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            const margin = 12;
            const imgW = pageW - margin * 2;
            const imgH = (canvas.height * imgW) / canvas.width;
            // Long report: slice the one tall image over as many pages as it needs.
            let y = 0;
            let page = 0;
            while (y < imgH) {
                if (page > 0) pdf.addPage();
                pdf.addImage(imgData, 'PNG', margin, margin - y, imgW, imgH, undefined, 'FAST');
                y += pageH - margin * 2;
                page++;
            }
            pdf.save(`Property_Report_${(report.property.name || 'Property').replace(/\s+/g, '_')}_${report.range.from}_${report.range.to}.pdf`);
        } catch (e) {
            console.error('Property report export failed:', e);
            setError('Could not export the PDF');
        } finally {
            setIsExporting(false);
        }
    };

    const s = report?.sections;

    return (
        <DrillContext.Provider value={setDrill}>
        <div className="space-y-4">
            {drill && report && <DrillDrawer spec={drill} onClose={closeDrill} period={`${report.property.name} · ${fmtRange(report.range.from, report.range.to)}`} />}
            {/* Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Date range">
                        {PRESETS.map(p => (
                            <button key={p.id} type="button" onClick={() => setPreset(p.id)} aria-pressed={preset === p.id}
                                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${preset === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                    {preset === 'custom' && (
                        <div className="flex items-center gap-2 text-xs">
                            <input type="date" value={custom.from} max={custom.to} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" aria-label="From date" />
                            <span className="text-slate-400">to</span>
                            <input type="date" value={custom.to} min={custom.from} max={todayIst()} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" aria-label="To date" />
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={load} disabled={isLoading} className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors" title="Refresh">
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <button type="button" onClick={handleDownloadPdf} disabled={isExporting || isLoading || !report}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-900 transition-colors disabled:opacity-50">
                        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        download pdf
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
                </div>
            )}

            {/* How the report is calculated: one legend and five rules, the same for every visual */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <BandLegend />
                    <button type="button" onClick={() => setShowHow(v => !v)} className="text-xs font-bold text-slate-700 hover:text-slate-900 underline underline-offset-2 flex items-center gap-1">
                        <Info className="w-3.5 h-3.5" /> {showHow ? 'Hide how this report is calculated' : 'How this report is calculated'}
                    </button>
                </div>
                {showHow && (
                    <ol className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-700 list-decimal pl-4">
                        <li><span className="font-bold">Period.</span> Only records created, due or planned inside the chosen dates count. Days are Indian time.</li>
                        <li><span className="font-bold">Rates.</span> Every percentage is shown with its two numbers, for example 75% (48 of 64), and uses the same bands: Good {GOOD_AT}% or more, Okay {OKAY_AT} to {GOOD_AT - 1}%, Needs attention below {OKAY_AT}%.</li>
                        <li><span className="font-bold">Counts.</span> Totals such as requests raised, visitors or spend are never coloured. A high or low count is not good or bad on its own.</li>
                        <li><span className="font-bold">Current state.</span> Stock levels, assets, AMC, audit, team, open now and overdue now are as of today, not the period.</li>
                        <li><span className="font-bold">No data.</span> A module with no records at a property shows a dash and is left out of that property&rsquo;s score, never counted as zero.</li>
                        <li><span className="font-bold">Readings.</span> A day without a meter or generator reading counts as a missed day, even if nothing ran.</li>
                        <li><span className="font-bold">Go deeper.</span> Every chart has an Analyse button that writes out what it shows, and an Explore button that opens it at full size with the exact rows behind it and a CSV download. Scorecard rows, property names and module headings open the same way.</li>
                    </ol>
                )}
            </div>

            {isLoading && !report ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 flex flex-col items-center justify-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mb-3" />
                    <p className="text-sm">building the report for {propertyName || 'this property'}</p>
                </div>
            ) : report && s ? (
                <div ref={reportRef} className={`space-y-4 bg-white rounded-2xl p-1 ${isLoading ? 'opacity-60' : ''}`}>
                    {/* Title */}
                    <header className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-700 text-white p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                                    <Building2 className="w-5 h-5" />
                                </div>
                                <div>
                                    {/* Inline colour: a global heading rule otherwise paints this dark on the dark banner. */}
                                    <h2 className="text-xl font-black leading-tight" style={{ color: '#ffffff' }}>{report.property.name}</h2>
                                    <p className="text-xs text-slate-300 mt-0.5">
                                        {report.scope === 'organization'
                                            ? `All properties · cumulative across ${report.properties.length} ${report.properties.length === 1 ? 'property' : 'properties'}`
                                            : [report.property.code, report.property.city, report.property.address].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[11px] uppercase tracking-wide text-slate-300 font-bold">{report.scope === 'organization' ? 'portfolio report' : 'property report'}</div>
                                <div className="text-sm font-bold">{fmtRange(report.range.from, report.range.to)}</div>
                                <div className="text-[11px] text-slate-300">{report.range.days} days · generated {new Date(report.generated_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                            </div>
                        </div>
                    </header>

                    {/* Headline tiles */}
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                        {[
                            { label: 'requests raised', value: s.tickets.available ? n0.format(s.tickets.total) : 'no data' },
                            { label: 'open requests now', value: s.tickets.available ? n0.format(s.tickets.open_now) : 'no data' },
                            { label: 'checklist completion', value: s.sop.available ? fmtPct(rateOf(s.sop.completed, s.sop.scheduled)) : 'no data', sub: s.sop.available ? rateParts(s.sop.completed, s.sop.scheduled) : undefined },
                            { label: 'ppm compliance', value: s.ppm.available ? fmtPct(rateOf(s.ppm.done, s.ppm.total)) : 'no data', sub: s.ppm.available ? rateParts(s.ppm.done, s.ppm.total) : undefined },
                            { label: `electricity ${s.electricity.available ? s.electricity.unit_label : ''}`.trim(), value: s.electricity.available ? n0.format(s.electricity.units) : 'no data' },
                            { label: 'diesel litres', value: s.diesel.available ? n0.format(s.diesel.litres) : 'no data' },
                            { label: 'visitors', value: s.visitors.available ? n0.format(s.visitors.total) : 'no data' },
                            { label: 'petty cash paid', value: s.petty_cash.available ? inr.format(s.petty_cash.paid_amount) : 'no data' },
                        ].map((t: { label: string; value: string; sub?: string }) => (
                            <div key={t.label} className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
                                <div className="text-lg font-black text-slate-900 tabular-nums truncate">{t.value}</div>
                                {t.sub && <div className="text-[10px] tabular-nums text-slate-500 leading-tight">{t.sub}</div>}
                                <div className="text-[11px] font-medium text-slate-500 lowercase">{t.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Scorecard */}
                        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                            <header className="flex items-center gap-2 mb-1">
                                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center"><Gauge className="w-4 h-4 text-slate-700" /></div>
                                <h3 className="text-sm font-black text-slate-900">Operational health scorecard</h3>
                            </header>
                            <p className="text-[11px] text-slate-500 mb-2">Every rate for the period against one target of {GOOD_AT}%. Each row shows the two numbers it was worked out from.</p>
                            <div className="mb-3"><BandLegend compact /></div>
                            <Scorecard rows={scorecard} />
                        </section>

                    {report.comparative && report.properties.length > 1 && (<>
                        <UsageAcrossProperties properties={report.properties} comparative={report.comparative} days={report.range.days} />
                        <PropertyComparison properties={report.properties} comparative={report.comparative} />
                    </>)}

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {/* Requests */}
                        <ModuleCard icon={Ticket} title="Requests & tickets" section={s.tickets} span={3}>
                            {s.tickets.available && (
                                <div className="space-y-5">
                                    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
                                        <Stat label="raised" value={n0.format(s.tickets.total)} />
                                        <Stat label="closed" value={n0.format(s.tickets.closed)} tone="good" />
                                        <Stat label="still open" value={n0.format(s.tickets.open)} tone={s.tickets.open > 0 ? 'warn' : 'default'} />
                                        <Stat label="pending validation" value={n0.format(s.tickets.pending_validation)} />
                                        <Stat label="closure rate" value={fmtPct(rateOf(s.tickets.closed, s.tickets.total))} parts={rateParts(s.tickets.closed, s.tickets.total)} tone={band(rateOf(s.tickets.closed, s.tickets.total))} hint="Requests closed ÷ requests raised in the period" />
                                        <Stat label="avg time to close" value={fmtHours(s.tickets.avg_resolution_hours)} />
                                        <Stat label="sla breached" value={n0.format(s.tickets.sla_breached)} tone={s.tickets.sla_breached > 0 ? 'bad' : 'good'} />
                                        <Stat label="internal" value={n0.format(s.tickets.internal)} />
                                        <Stat label="open now (all time)" value={n0.format(s.tickets.open_now)} />
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                                        <div className="lg:col-span-3">
                                            <ChartTitle note="Blue = tickets created that day. Amber = tickets resolved that day. Counted separately, so closed can exceed raised.">Raised vs closed per day</ChartTitle>
                                            <Trend title="Raised vs closed per day" note="Blue = tickets created that day. Amber = tickets resolved that day. Counted separately, so closed can exceed raised." data={s.tickets.daily} series={[{ key: 'raised', name: 'Raised', color: C.blue }, { key: 'closed', name: 'Closed', color: C.amber }]} height={200} yLabel="Tickets" />
                                        </div>
                                        <div className="lg:col-span-2">
                                            <ChartTitle note="Closed tickets, grouped by hours from created to resolved">How long requests take to close</ChartTitle>
                                            <Ranking title="How long requests take to close" note="Closed tickets, grouped by hours from created to resolved" rows={s.tickets.resolution_buckets} color={C.cyan} height={150} xLabel="Closed tickets" yLabel="Time to close" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                                        <div>
                                            <ChartTitle note="Tickets raised in the period, per category">By category</ChartTitle>
                                            <Ranking title="By category" note="Tickets raised in the period, per category" rows={s.tickets.by_category} xLabel="Tickets raised" />
                                        </div>
                                        <div>
                                            <ChartTitle note="Tickets raised in the period, per floor or per property">{report.scope === 'organization' ? 'By property' : 'By floor'}</ChartTitle>
                                            <Ranking title={report.scope === 'organization' ? 'By property' : 'By floor'} note="Tickets raised in the period, per floor or per property" rows={s.tickets.by_floor} color={C.violet} xLabel="Tickets raised" />
                                        </div>
                                        <div className="space-y-5">
                                            <div>
                                                <ChartTitle note="Tickets raised in the period, split by priority">Priority mix</ChartTitle>
                                                <Mix title="Priority mix" note="Tickets raised in the period, split by priority" parts={['urgent', 'high', 'medium', 'low'].map((p, i) => ({ name: p, value: s.tickets.available ? (s.tickets.by_priority.find(x => x.name === p)?.count || 0) : 0, color: [C.red, C.amber, C.blue, C.cyan][i] }))} total={s.tickets.total} />
                                            </div>
                                            <div>
                                                <ChartTitle note="Tickets raised in the period, split by current status">Status mix</ChartTitle>
                                                <Mix title="Status mix" note="Tickets raised in the period, split by current status" parts={s.tickets.by_status.slice(0, 6).map((x, i) => ({ name: x.name.replace(/_/g, ' '), value: x.count, color: [C.blue, C.amber, C.cyan, C.violet, C.magenta, C.red][i] }))} total={s.tickets.total} />
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <ChartTitle note="Tickets created per weekday and hour (IST). Darker = more.">When requests come in (weekday by hour)</ChartTitle>
                                        <Heatmap title="When requests come in (weekday by hour)" note="Tickets created per weekday and hour (IST). Darker = more." grid={s.tickets.heatmap} />
                                    </div>
                                </div>
                            )}
                        </ModuleCard>

                        {/* Utilities */}
                        <section className="md:col-span-2 xl:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                            <header className="flex items-center gap-2 mb-4">
                                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center"><Zap className="w-4 h-4 text-slate-700" /></div>
                                <h3 className="text-sm font-black text-slate-900">Utilities</h3>
                            </header>
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2"><Zap className="w-3.5 h-3.5 text-slate-500" /><span className="text-xs font-bold text-slate-800">Electricity</span></div>
                                    {s.electricity.available ? (<>
                                        <div className="grid grid-cols-3 gap-3 mb-3">
                                            <Stat label={s.electricity.unit_label} value={n0.format(s.electricity.units)} />
                                            <Stat label="cost" value={inr.format(s.electricity.cost)} />
                                            <Stat label="days logged" value={`${s.electricity.days_logged}/${s.electricity.days_in_range}`} tone={band(rateOf(s.electricity.days_logged, s.electricity.days_in_range))} hint="Days with at least one reading ÷ days in the period" />
                                        </div>
                                        <ChartTitle note="Main-meter units summed per reading date. A zero day means no reading was entered.">Units per day (main meters)</ChartTitle>
                                        <Trend title="Units per day (main meters)" note="Main-meter units summed per reading date. A zero day means no reading was entered." data={s.electricity.daily} series={[{ key: 'units', name: 'Units', color: C.blue }]} kind="area" height={150} unit={s.electricity.unit_label} yLabel={s.electricity.unit_label} />
                                        <div className="mt-3"><ChartTitle note="Units per main meter in the period">By main meter</ChartTitle><Ranking title="By main meter" note="Units per main meter in the period" rows={s.electricity.by_meter.map(m => ({ name: m.name, count: m.units }))} xLabel={s.electricity.unit_label} /></div>
                                    </>) : <p className="text-xs text-slate-400 italic">{s.electricity.reason}</p>}
                                </div>
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2"><Fuel className="w-3.5 h-3.5 text-slate-500" /><span className="text-xs font-bold text-slate-800">Diesel</span></div>
                                    {s.diesel.available ? (<>
                                        <div className="grid grid-cols-3 gap-3 mb-3">
                                            <Stat label="litres" value={n0.format(s.diesel.litres)} />
                                            <Stat label="cost" value={inr.format(s.diesel.cost)} />
                                            <Stat label="days logged" value={`${s.diesel.days_logged}/${s.diesel.days_in_range}`} tone={band(rateOf(s.diesel.days_logged, s.diesel.days_in_range))} hint="Days with at least one reading ÷ days in the period" />
                                        </div>
                                        <ChartTitle note="Litres consumed summed per reading date. A zero day means no reading was entered.">Litres per day</ChartTitle>
                                        <Trend title="Litres per day" note="Litres consumed summed per reading date. A zero day means no reading was entered." data={s.diesel.daily} series={[{ key: 'litres', name: 'Litres', color: C.amber }]} kind="area" height={150} unit="L" yLabel="Litres" />
                                        <div className="mt-3"><ChartTitle note="Litres per generator in the period">By generator</ChartTitle><Ranking title="By generator" note="Litres per generator in the period" rows={s.diesel.by_generator.map(g => ({ name: g.name, count: g.litres }))} color={C.amber} xLabel="Litres" /></div>
                                    </>) : <p className="text-xs text-slate-400 italic">{s.diesel.reason}</p>}
                                </div>
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2"><Droplets className="w-3.5 h-3.5 text-slate-500" /><span className="text-xs font-bold text-slate-800">Water</span></div>
                                    {s.water.available ? (<>
                                        <div className="grid grid-cols-3 gap-3 mb-3">
                                            <Stat label="quantity" value={n0.format(s.water.quantity)} />
                                            <Stat label="cost" value={inr.format(s.water.cost)} />
                                            <Stat label="days logged" value={`${s.water.days_logged}/${s.water.days_in_range}`} tone={band(rateOf(s.water.days_logged, s.water.days_in_range))} hint="Days with at least one reading ÷ days in the period" />
                                        </div>
                                        <ChartTitle note="Water quantity summed per reading date">Quantity per day</ChartTitle>
                                        <Trend title="Quantity per day" note="Water quantity summed per reading date" data={s.water.daily} series={[{ key: 'quantity', name: 'Quantity', color: C.cyan }]} kind="area" height={150} yLabel="Water quantity" />
                                        <div className="mt-3"><ChartTitle note="Quantity per water source in the period">By source</ChartTitle><Ranking title="By source" note="Quantity per water source in the period" rows={s.water.by_source.map(w => ({ name: w.name, count: w.quantity }))} color={C.cyan} xLabel="Water quantity" /></div>
                                    </>) : <p className="text-xs text-slate-400 italic">{s.water.reason}</p>}
                                </div>
                            </div>
                            {(s.electricity.available || s.diesel.available || s.water.available) && (
                                <div className="mt-5 pt-4 border-t border-slate-100">
                                    <ChartTitle note="Electricity cost + diesel cost + water cost for the period = 100%">Utility spend split</ChartTitle>
                                    <Mix title="Utility spend split" note="Electricity cost + diesel cost + water cost for the period = 100%" parts={[
                                        { name: 'Electricity', value: s.electricity.available ? s.electricity.cost : 0, color: C.blue },
                                        { name: 'Diesel', value: s.diesel.available ? s.diesel.cost : 0, color: C.amber },
                                        { name: 'Water', value: s.water.available ? s.water.cost : 0, color: C.cyan },
                                    ]} />
                                </div>
                            )}
                        </section>

                        {/* SOP */}
                        <ModuleCard icon={ClipboardCheck} title="SOP checklists" section={s.sop} span={2}>
                            {s.sop.available && (<>
                                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                                    <Stat label="completion" value={fmtPct(rateOf(s.sop.completed, s.sop.scheduled))} parts={rateParts(s.sop.completed, s.sop.scheduled)} tone={band(rateOf(s.sop.completed, s.sop.scheduled))} hint="Checklists completed ÷ checklists due in the period" />
                                    <Stat label="scheduled" value={n0.format(s.sop.scheduled)} />
                                    <Stat label="completed" value={n0.format(s.sop.completed)} tone="good" />
                                    <Stat label="completed late" value={n0.format(s.sop.late)} tone={s.sop.late > 0 ? 'warn' : 'default'} />
                                    <Stat label="missed" value={n0.format(s.sop.missed)} tone={s.sop.missed > 0 ? 'bad' : 'default'} />
                                    <Stat label="active templates" value={n0.format(s.sop.templates)} />
                                </div>
                                <ChartTitle note="Checklists due each day: completed on time, completed late, missed, or still pending">Checklist outcomes per day</ChartTitle>
                                <StackedTrend title="Checklist outcomes per day" note="Checklists due each day: completed on time, completed late, missed, or still pending" data={s.sop.daily} yLabel="Checklists due" series={[
                                    { key: 'on_time', name: 'On time', color: C.blue }, { key: 'late', name: 'Late', color: C.amber },
                                    { key: 'missed', name: 'Missed', color: C.red }, { key: 'pending', name: 'Pending', color: S.neutral },
                                ]} />
                            </>)}
                        </ModuleCard>

                        {/* PPM */}
                        <ModuleCard icon={Wrench} title="Planned maintenance (PPM)" section={s.ppm}>
                            {s.ppm.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="compliance" value={fmtPct(rateOf(s.ppm.done, s.ppm.total))} parts={rateParts(s.ppm.done, s.ppm.total)} tone={band(rateOf(s.ppm.done, s.ppm.total))} hint="Maintenance jobs done ÷ jobs planned in the period" />
                                    <Stat label="overdue now" value={n0.format(s.ppm.overdue_now)} tone={s.ppm.overdue_now > 0 ? 'bad' : 'good'} />
                                </div>
                                <ChartTitle note="Maintenance jobs planned in the period, by status">Planned work by status</ChartTitle>
                                <Mix title="Planned work by status" note="Maintenance jobs planned in the period, by status" parts={[
                                    { name: 'Done', value: s.ppm.done, color: C.blue }, { name: 'Pending', value: s.ppm.pending, color: C.amber },
                                    { name: 'Postponed', value: s.ppm.postponed, color: C.violet }, { name: 'Skipped', value: s.ppm.skipped, color: S.neutral },
                                ]} total={s.ppm.total} />
                                <div className="mt-4">
                                    <ChartTitle note="Jobs planned per system: done vs still open">By system</ChartTitle>
                                    {s.ppm.by_system.length ? (
                                        <div style={{ height: Math.max(96, s.ppm.by_system.length * 26 + 8) + 44 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={s.ppm.by_system.map(x => ({ name: x.name, done: x.done, open: x.total - x.done }))} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 30 }} barCategoryGap={6}>
                                                    <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false}>
                                                        <Label value="→ Jobs planned" position="insideBottom" offset={-10} style={{ fontSize: 10, fill: '#64748b' }} />
                                                    </XAxis>
                                                    <YAxis type="category" dataKey="name" width={100} interval={0} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                                                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={TIP} />
                                                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 18 }} iconSize={8} />
                                                    <Bar isAnimationActive={false} name="Done" dataKey="done" stackId="a" fill={C.blue} stroke="#fff" strokeWidth={1} maxBarSize={14} />
                                                    <Bar isAnimationActive={false} name="Open" dataKey="open" stackId="a" fill={C.amber} stroke="#fff" strokeWidth={1} radius={[0, 4, 4, 0]} maxBarSize={14} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : <Empty />}
                                </div>
                            </>)}
                        </ModuleCard>

                        {/* Visitors */}
                        <ModuleCard icon={Users} title="Visitors" section={s.visitors} span={2}>
                            {s.visitors.available && (
                                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                                    <div className="lg:col-span-3">
                                        <div className="grid grid-cols-4 gap-3 mb-4">
                                            <Stat label="visitors" value={n0.format(s.visitors.total)} />
                                            <Stat label="per day" value={n1.format(s.visitors.per_day)} />
                                            <Stat label="checked out" value={n0.format(s.visitors.checked_out)} tone="good" />
                                            <Stat label="not checked out" value={n0.format(s.visitors.checked_in)} tone={s.visitors.checked_in > 0 ? 'warn' : 'default'} />
                                        </div>
                                        <ChartTitle note="Visitor check-ins per day">Visitors per day</ChartTitle>
                                        <Trend title="Visitors per day" note="Visitor check-ins per day" data={s.visitors.daily} series={[{ key: 'visitors', name: 'Visitors', color: C.violet }]} height={160} yLabel="Visitors" />
                                    </div>
                                    <div className="lg:col-span-2">
                                        <ChartTitle note="Check-ins per weekday across the period">By weekday</ChartTitle>
                                        <Ranking title="By weekday" note="Check-ins per weekday across the period" rows={[1, 2, 3, 4, 5, 6, 0].map(i => ({ name: WEEKDAYS[i], count: s.visitors.available ? s.visitors.by_weekday[i] : 0 }))} color={C.violet} height={190} xLabel="Visitors" yLabel="Weekday" />
                                    </div>
                                </div>
                            )}
                        </ModuleCard>

                        {/* Meeting rooms */}
                        <ModuleCard icon={DoorOpen} title="Meeting rooms" section={s.meeting_rooms}>
                            {s.meeting_rooms.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="bookings" value={n0.format(s.meeting_rooms.bookings)} />
                                    <Stat label="hours booked" value={n1.format(s.meeting_rooms.hours_booked)} />
                                    <Stat label="confirmed" value={n0.format(s.meeting_rooms.confirmed)} tone="good" />
                                    <Stat label="cancelled" value={n0.format(s.meeting_rooms.cancelled)} tone={s.meeting_rooms.cancelled > 0 ? 'warn' : 'default'} />
                                </div>
                                <ChartTitle note="Confirmed bookings only: end time minus start time, summed per day">Hours booked per day</ChartTitle>
                                <Trend title="Hours booked per day" note="Confirmed bookings only: end time minus start time, summed per day" data={s.meeting_rooms.daily} series={[{ key: 'hours', name: 'Hours', color: C.magenta }]} height={140} unit="h" yLabel="Hours booked" />
                                <div className="mt-3"><ChartTitle note="Confirmed hours per room in the period">By room</ChartTitle><Ranking title="By room" note="Confirmed hours per room in the period" rows={s.meeting_rooms.by_room.map(r => ({ name: r.name, count: r.hours }))} color={C.magenta} valueFormatter={v => `${n1.format(v)} h`} xLabel="Hours booked" /></div>
                            </>)}
                        </ModuleCard>

                        {/* Stock */}
                        <ModuleCard icon={Package} title="Stock & consumables" section={s.stock} span={2}>
                            {s.stock.available && (
                                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                                    <div className="lg:col-span-3">
                                        <div className="grid grid-cols-4 gap-3 mb-4">
                                            <Stat label="items tracked" value={n0.format(s.stock.items)} />
                                            <Stat label="below threshold" value={n0.format(s.stock.low_stock)} tone={s.stock.low_stock > 0 ? 'warn' : 'good'} />
                                            <Stat label="added" value={n0.format(s.stock.added)} />
                                            <Stat label="consumed" value={n0.format(s.stock.removed)} />
                                        </div>
                                        <ChartTitle note="Stock added vs stock removed, per day">Added vs consumed per day</ChartTitle>
                                        <Trend title="Added vs consumed per day" note="Stock added vs stock removed, per day" data={s.stock.daily} series={[{ key: 'added', name: 'Added', color: C.blue }, { key: 'removed', name: 'Consumed', color: C.amber }]} height={160} yLabel="Stock units" />
                                    </div>
                                    <div className="lg:col-span-2">
                                        <ChartTitle note="Bar = current quantity against the item minimum (10 when none is set)">Low stock items</ChartTitle>
                                        {s.stock.low_stock_items.length ? (
                                            <ul className="space-y-2">
                                                {s.stock.low_stock_items.map(i => (
                                                    <li key={i.name} className="text-xs">
                                                        <div className="flex justify-between gap-2"><span className="truncate text-slate-700">{i.name}</span><span className="tabular-nums font-bold text-red-700">{i.quantity} <span className="text-slate-400 font-medium">/ min {i.min}</span></span></div>
                                                        <div className="relative h-1.5 rounded-full bg-slate-100 mt-1">
                                                            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (i.quantity / Math.max(1, i.min)) * 100)}%`, background: S.bad }} />
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : <Empty text="every item is above its minimum" />}
                                    </div>
                                </div>
                            )}
                        </ModuleCard>

                        {/* Assets */}
                        <ModuleCard icon={Boxes} title="Assets" section={s.assets}>
                            {s.assets.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="registered" value={n0.format(s.assets.total)} />
                                    <Stat label="purchase value" value={inr.format(s.assets.purchase_value)} />
                                    <Stat label="warranty ends in 90d" value={n0.format(s.assets.warranty_expiring_90d)} tone={s.assets.warranty_expiring_90d > 0 ? 'warn' : 'default'} />
                                    <Stat label="events in range" value={n0.format(s.assets.events_in_range)} />
                                </div>
                                <ChartTitle note="All registered assets, split by status">Status mix</ChartTitle>
                                <Mix title="Status mix" note="All registered assets, split by status" parts={[
                                    { name: 'Active', value: s.assets.active, color: C.blue }, { name: 'Under repair', value: s.assets.under_repair, color: C.amber },
                                    { name: 'Inactive / disposed', value: s.assets.inactive, color: S.neutral },
                                ]} total={s.assets.total} />
                                <div className="mt-4"><ChartTitle note="Registered assets per category">By category</ChartTitle><Ranking title="By category" note="Registered assets per category" rows={s.assets.by_category} xLabel="Assets" /></div>
                            </>)}
                        </ModuleCard>

                        {/* AMC */}
                        <ModuleCard icon={FileBadge} title="AMC contracts" section={s.amc}>
                            {s.amc.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="contracts" value={n0.format(s.amc.total)} />
                                    <Stat label="contract value" value={inr.format(s.amc.total_value)} />
                                </div>
                                <ChartTitle note="All contracts by end date: active, ending within 60 days, or already ended">Contract status</ChartTitle>
                                <Mix title="Contract status" note="All contracts by end date: active, ending within 60 days, or already ended" parts={[
                                    { name: 'Active', value: Math.max(0, s.amc.active - s.amc.expiring_60d), color: C.blue },
                                    { name: 'Expiring in 60d', value: s.amc.expiring_60d, color: C.amber }, { name: 'Expired', value: s.amc.expired, color: C.red },
                                ]} total={s.amc.total} />
                                {s.amc.expiring_list.length > 0 && (
                                    <div className="mt-4">
                                        <ChartTitle>Expiring soon</ChartTitle>
                                        <ul className="space-y-1 text-xs text-slate-700">
                                            {s.amc.expiring_list.map(c => <li key={`${c.system}-${c.ends}`} className="flex justify-between gap-2"><span className="truncate">{c.system} · {c.vendor}</span><span className="tabular-nums font-bold shrink-0">{fmtDay(c.ends)}</span></li>)}
                                        </ul>
                                    </div>
                                )}
                            </>)}
                        </ModuleCard>

                        {/* Petty cash */}
                        <ModuleCard icon={Wallet} title="Petty cash" section={s.petty_cash}>
                            {s.petty_cash.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="requests" value={n0.format(s.petty_cash.requests)} />
                                    <Stat label="awaiting approval" value={n0.format(s.petty_cash.pending_approval)} tone={s.petty_cash.pending_approval > 0 ? 'warn' : 'default'} />
                                </div>
                                <ChartTitle note="Sum of amount requested, approved and paid on requests created in the period">Requested to paid</ChartTitle>
                                <Ranking title="Requested to paid" note="Sum of amount requested, approved and paid on requests created in the period" rows={[
                                    { name: 'Requested', count: s.petty_cash.requested_amount }, { name: 'Approved', count: s.petty_cash.approved_amount }, { name: 'Paid', count: s.petty_cash.paid_amount },
                                ]} color={C.blue} height={96} valueFormatter={v => inr.format(v)} xLabel="Rupees" />
                                <div className="mt-4"><ChartTitle note="Requests created in the period, by status">By status</ChartTitle>
                                    <Mix title="By status" note="Requests created in the period, by status" parts={s.petty_cash.by_status.slice(0, 6).map((x, i) => ({ name: x.name, value: x.count, color: [C.blue, C.cyan, C.amber, C.violet, C.red, C.magenta][i] }))} total={s.petty_cash.requests} /></div>
                            </>)}
                        </ModuleCard>

                        {/* Procurement */}
                        <ModuleCard icon={ShoppingCart} title="Procurement (material requests)" section={s.procurement}>
                            {s.procurement.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="requests" value={n0.format(s.procurement.requests)} />
                                    <Stat label="value" value={inr.format(s.procurement.total_amount)} />
                                </div>
                                <ChartTitle note="Material requests created in the period, grouped by status">Pending, approved, delivered</ChartTitle>
                                <Ranking title="Pending, approved, delivered" note="Material requests created in the period, grouped by status" rows={[
                                    { name: 'Pending', count: s.procurement.pending }, { name: 'Approved / ordered', count: s.procurement.approved },
                                    { name: 'Delivered', count: s.procurement.delivered }, { name: 'Rejected', count: s.procurement.rejected },
                                ]} color={C.cyan} height={120} xLabel="Material requests" />
                            </>)}
                        </ModuleCard>

                        {/* Guest requests */}
                        <ModuleCard icon={QrCode} title="Guest requests (QR)" section={s.guest_requests}>
                            {s.guest_requests.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="received" value={n0.format(s.guest_requests.total)} />
                                    <Stat label="pending" value={n0.format(s.guest_requests.pending)} tone={s.guest_requests.pending > 0 ? 'warn' : 'default'} />
                                </div>
                                <ChartTitle note="Guest QR requests received in the period, by status">Status</ChartTitle>
                                <Mix title="Status" note="Guest QR requests received in the period, by status" parts={[
                                    { name: 'Resolved', value: s.guest_requests.resolved, color: C.blue }, { name: 'In progress', value: s.guest_requests.in_progress, color: C.cyan }, { name: 'Pending', value: s.guest_requests.pending, color: C.amber },
                                ]} total={s.guest_requests.total} />
                                <div className="mt-4"><ChartTitle note="Guest requests received, per category">By category</ChartTitle><Ranking title="By category" note="Guest requests received, per category" rows={s.guest_requests.by_category} xLabel="Guest requests" /></div>
                            </>)}
                        </ModuleCard>

                        {/* Tasks */}
                        <ModuleCard icon={ListChecks} title="Task manager (property team)" section={s.tasks}>
                            {s.tasks.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="tasks assigned" value={n0.format(s.tasks.total)} />
                                    <Stat label="completion" value={fmtPct(rateOf(s.tasks.completed, s.tasks.total))} parts={rateParts(s.tasks.completed, s.tasks.total)} tone={band(rateOf(s.tasks.completed, s.tasks.total))} hint="Tasks completed ÷ tasks assigned to the property team in the period" />
                                </div>
                                <ChartTitle note="Tasks assigned to the property team in the period, by status">Status</ChartTitle>
                                <Mix title="Status" note="Tasks assigned to the property team in the period, by status" parts={[
                                    { name: 'Completed', value: s.tasks.completed, color: C.blue }, { name: 'In progress', value: s.tasks.in_progress, color: C.cyan }, { name: 'Pending', value: s.tasks.pending, color: C.amber },
                                ]} total={s.tasks.total} />
                            </>)}
                        </ModuleCard>

                        {/* Requisitions */}
                        <ModuleCard icon={CalendarCheck} title="Monthly requisitions" section={s.requisitions}>
                            {s.requisitions.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="months in range" value={n0.format(s.requisitions.months_in_range)} />
                                    <Stat label="submitted" value={n0.format(s.requisitions.submitted)} tone={s.requisitions.submitted >= s.requisitions.months_in_range ? 'good' : 'warn'} />
                                </div>
                                <ChartTitle note="Months in the period: acknowledged, uploaded, or missing">Submission state</ChartTitle>
                                <Mix title="Submission state" note="Months in the period: acknowledged, uploaded, or missing" parts={[
                                    { name: 'Acknowledged', value: s.requisitions.acknowledged, color: C.blue },
                                    { name: 'Uploaded', value: Math.max(0, s.requisitions.submitted - s.requisitions.acknowledged), color: C.cyan },
                                    { name: 'Missing', value: s.requisitions.missing_months.length, color: C.red },
                                ]} total={s.requisitions.months_in_range} />
                                {s.requisitions.missing_months.length > 0 && <p className="mt-3 text-xs text-slate-600">Not submitted: {s.requisitions.missing_months.join(', ')}</p>}
                            </>)}
                        </ModuleCard>

                        {/* Roster */}
                        <ModuleCard icon={CalendarDays} title="Staff roster" section={s.roster}>
                            {s.roster.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="shifts rostered" value={n0.format(s.roster.shifts)} />
                                    <Stat label="staff rostered" value={n0.format(s.roster.staff_rostered)} />
                                    <Stat label="days covered" value={`${s.roster.days_covered} / ${s.roster.days_in_range}`} tone={band(rateOf(s.roster.days_covered, s.roster.days_in_range))} hint="Days with at least one rostered shift ÷ days in the period" />
                                    <Stat label="reliever shifts" value={n0.format(s.roster.reliever_shifts)} />
                                </div>
                                <ChartTitle note="Roster entries in the period: regular vs reliever">Regular vs reliever shifts</ChartTitle>
                                <Mix title="Regular vs reliever shifts" note="Roster entries in the period: regular vs reliever" parts={[{ name: 'Regular', value: s.roster.shifts - s.roster.reliever_shifts, color: C.blue }, { name: 'Reliever', value: s.roster.reliever_shifts, color: C.amber }]} total={s.roster.shifts} />
                            </>)}
                        </ModuleCard>

                        {/* Audit */}
                        <ModuleCard icon={ShieldCheck} title="Statutory audit (current)" section={s.audit}>
                            {s.audit.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="compliance" value={fmtPct(rateOf(s.audit.compliant, s.audit.items - s.audit.not_applicable))} parts={rateParts(s.audit.compliant, s.audit.items - s.audit.not_applicable)} tone={band(rateOf(s.audit.compliant, s.audit.items - s.audit.not_applicable))} hint="Compliant items ÷ (all items − not applicable)" />
                                    <Stat label="items" value={n0.format(s.audit.items)} />
                                </div>
                                <ChartTitle note="All audit items, current state">Item status</ChartTitle>
                                <Mix title="Item status" note="All audit items, current state" parts={[
                                    { name: 'Compliant', value: s.audit.compliant, color: C.blue }, { name: 'Pending review', value: s.audit.pending_review, color: C.amber },
                                    { name: 'Missing', value: s.audit.missing, color: C.red }, { name: 'Not applicable', value: s.audit.not_applicable, color: S.neutral },
                                ]} total={s.audit.items} />
                            </>)}
                        </ModuleCard>

                        {/* Team */}
                        <ModuleCard icon={UserCircle2} title="Property team" section={s.team}>
                            {s.team.available && (<>
                                <Stat label="active members" value={n0.format(s.team.members)} />
                                <div className="mt-4"><ChartTitle note="Active members, by role">By role</ChartTitle><Ranking title="By role" note="Active members, by role" rows={s.team.by_role} color={C.violet} xLabel="People" /></div>
                            </>)}
                        </ModuleCard>
                    </div>

                    <p className="text-[11px] text-slate-400 px-2 pb-1 flex items-start gap-1.5">
                        <IndianRupee className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>Range figures count records created or planned within the selected dates (IST). Assets, AMC, stock levels, audit and team show the current state. Modules shown as &ldquo;not set up&rdquo; have no data for this property. Hover any bar, point or cell for its exact value.</span>
                    </p>
                </div>
            ) : null}
        </div>
        </DrillContext.Provider>
    );
}
