'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, Download, Loader2, RefreshCw, Ticket, QrCode, HeartHandshake, ClipboardCheck, Wrench,
    Zap, Fuel, Droplets, Package, Boxes, FileBadge, Users, DoorOpen, Wallet, ShoppingCart, CalendarCheck,
    CalendarDays, ListChecks, ShieldCheck, UserCircle2, Building2, Gauge, Lightbulb, CheckCircle2, AlertCircle, Info, IndianRupee,
} from 'lucide-react';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, LabelList, ReferenceLine, Cell,
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

interface Report {
    property: { id: string; name: string; code: string | null; address: string | null; city: string | null; is_active: boolean | null };
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
        hr_tickets: Section<{ total: number; open: number; resolved: number; escalated: number; by_type: Count[]; by_priority: Count[] }>;
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
        requisitions: Section<{ months_in_range: number; submitted: number; acknowledged: number; missing_months: string[] }>;
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
function fmtPct(v: number | null) { return v === null ? 'n/a' : `${n1.format(v)}%`; }
function fmtHours(h: number | null) { if (h === null) return 'n/a'; return h < 48 ? `${n1.format(h)} h` : `${n1.format(h / 24)} d`; }
function titleCase(s: string) { return s.replace(/\b\w/g, c => c.toUpperCase()); }
function share(part: number, whole: number) { return whole > 0 ? Math.round((part / whole) * 100) : 0; }
function maxBy<T>(arr: T[], f: (t: T) => number): T | null { return arr.length ? arr.reduce((a, b) => (f(b) > f(a) ? b : a)) : null; }

// ── building blocks ──────────────────────────────────────────────────────────

function Stat({ label, value, tone = 'default', hint }: { label: string; value: string | number; tone?: 'default' | 'good' | 'warn' | 'bad'; hint?: string }) {
    const toneCls = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : 'text-slate-900';
    return (
        <div className="min-w-0" title={hint}>
            <div className={`text-xl font-black tabular-nums leading-tight ${toneCls}`}>{value}</div>
            <div className="text-[11px] font-medium text-slate-500 lowercase truncate">{label}</div>
        </div>
    );
}

function ChartTitle({ children, note }: { children: React.ReactNode; note?: string }) {
    return (
        <div className="flex items-baseline justify-between gap-2 mb-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{children}</div>
            {note && <div className="text-[10px] text-slate-400">{note}</div>}
        </div>
    );
}

function Empty({ text = 'nothing in this range' }: { text?: string }) {
    return <div className="h-full min-h-[96px] flex items-center justify-center text-xs text-slate-400 italic">{text}</div>;
}

/** Ranking: horizontal bars, one hue, value labelled at the bar end. */
function Ranking({ rows, color = C.blue, height, valueFormatter = (v: number) => n0.format(v) }: { rows: Count[]; color?: string; height?: number; valueFormatter?: (v: number) => string }) {
    if (!rows.length) return <Empty />;
    const h = height ?? Math.max(96, rows.length * 26 + 8);
    return (
        <div style={{ height: h }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }} barCategoryGap={6}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} tickFormatter={(v: string) => titleCase(v).slice(0, 18)} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={TIP} formatter={v => [valueFormatter(Number(v)), '']} />
                    <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} maxBarSize={14}>
                        <LabelList dataKey="count" position="right" formatter={v => valueFormatter(Number(v))} style={{ fontSize: 10, fill: '#334155', fontWeight: 700 }} />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

/** Trend: one or more series per day. Bars for counts, area for continuous measures. */
function Trend<T extends { date: string }>({ data, series, kind = 'bar', height = 180, unit }: {
    data: T[]; series: { key: keyof T & string; name: string; color: string }[]; kind?: 'bar' | 'area'; height?: number; unit?: string;
}) {
    if (!data.length || !data.some(d => series.some(s => Number(d[s.key]) > 0))) return <Empty />;
    const fmt = (v: number) => `${n1.format(v)}${unit ? ` ${unit}` : ''}`;
    const common = {
        data, margin: { top: 6, right: 6, left: -18, bottom: 0 },
    };
    const axes = (<>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tick={TICK} axisLine={false} tickLine={false} minTickGap={18} />
        <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} />
        <Tooltip cursor={kind === 'bar' ? { fill: '#f1f5f9' } : { stroke: '#94a3b8', strokeDasharray: '3 3' }} labelFormatter={d => fmtDay(String(d))} contentStyle={TIP} formatter={v => [fmt(Number(v)), '']} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />}
    </>);
    return (
        <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
                {kind === 'bar' ? (
                    <BarChart {...common} barGap={2}>
                        {axes}
                        {series.map(s => <Bar key={s.key} name={s.name} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
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
                        {series.map(s => <Area key={s.key} type="monotone" name={s.name} dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} dot={{ r: 2.5, strokeWidth: 0, fill: s.color }} activeDot={{ r: 5 }} />)}
                    </AreaChart>
                )}
            </ResponsiveContainer>
        </div>
    );
}

/** Stacked daily bars for a status mix over time. */
function StackedTrend<T extends { date: string }>({ data, series, height = 180 }: { data: T[]; series: { key: keyof T & string; name: string; color: string }[]; height?: number }) {
    if (!data.length || !data.some(d => series.some(s => Number(d[s.key]) > 0))) return <Empty />;
    return (
        <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={TICK} axisLine={false} tickLine={false} minTickGap={18} />
                    <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} labelFormatter={d => fmtDay(String(d))} contentStyle={TIP} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                    {series.map((s, i) => <Bar key={s.key} name={s.name} dataKey={s.key} stackId="a" fill={s.color} stroke="#fff" strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={28} />)}
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

/** Mix: one 100% bar split into segments, with a legend that carries the numbers. */
function Mix({ parts, total }: { parts: { name: string; value: number; color: string }[]; total?: number }) {
    const sum = total ?? parts.reduce((s, p) => s + p.value, 0);
    if (sum <= 0) return <Empty />;
    return (
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
}

/** Timing: weekday x hour grid, one hue light to dark. */
function Heatmap({ grid }: { grid: number[][] }) {
    const max = Math.max(0, ...grid.flat());
    if (max === 0) return <Empty />;
    const hours = Array.from({ length: 24 }, (_, i) => i);
    return (
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
}

/** Scorecard: every % metric against the same 90% target, coloured by state and labelled with an icon. */
function Scorecard({ rows }: { rows: { name: string; value: number; detail: string }[] }) {
    if (!rows.length) return <Empty text="no rate-based measures available" />;
    const tone = (v: number) => (v >= 90 ? S.good : v >= 70 ? S.warn : S.bad);
    return (
        <div style={{ height: Math.max(120, rows.length * 30 + 20) }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }} barCategoryGap={8}>
                    <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={TICK} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={TIP} formatter={(v, _n, p) => [`${n1.format(Number(v))}% · ${(p?.payload as { detail?: string } | undefined)?.detail ?? ''}`, '']} />
                    <ReferenceLine x={90} stroke="#64748b" strokeDasharray="4 3" label={{ value: 'target 90%', position: 'top', fontSize: 9, fill: '#64748b' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={14}>
                        {rows.map(r => <Cell key={r.name} fill={tone(r.value)} />)}
                        <LabelList dataKey="value" position="right" formatter={v => `${n1.format(Number(v))}%`} style={{ fontSize: 10, fill: '#334155', fontWeight: 700 }} />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function ModuleCard({ icon: Icon, title, section, children, span = 1 }: {
    icon: React.ElementType; title: string; section: Section<object>; children?: React.ReactNode; span?: 1 | 2 | 3;
}) {
    const spanCls = span === 3 ? 'md:col-span-2 xl:col-span-3' : span === 2 ? 'md:col-span-2' : '';
    return (
        <section className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col ${spanCls}`}>
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

type Finding = { level: 'bad' | 'warn' | 'good' | 'info'; text: string; module: string };

function buildFindings(r: Report): Finding[] {
    const s = r.sections;
    const out: Finding[] = [];
    const push = (level: Finding['level'], module: string, text: string) => out.push({ level, module, text });

    if (s.tickets.available && s.tickets.total > 0) {
        const t = s.tickets;
        const top = t.by_category[0];
        if (top) push('info', 'Requests', `${titleCase(top.name)} is the largest request category at ${share(top.count, t.total)}% of ${n0.format(t.total)} raised.`);
        if (t.closure_rate !== null) push(t.closure_rate >= 85 ? 'good' : t.closure_rate >= 60 ? 'warn' : 'bad', 'Requests', `${fmtPct(t.closure_rate)} of requests raised in the range are closed; ${n0.format(t.open)} still open, ${n0.format(t.pending_validation)} awaiting validation.`);
        if (t.sla_breached > 0) push('bad', 'Requests', `${n0.format(t.sla_breached)} request${t.sla_breached === 1 ? '' : 's'} breached SLA (${share(t.sla_breached, t.total)}% of raised).`);
        if (t.avg_resolution_hours !== null) push(t.avg_resolution_hours <= 48 ? 'good' : 'warn', 'Requests', `Average time to close is ${fmtHours(t.avg_resolution_hours)}; ${n0.format(t.resolution_buckets[4]?.count || 0)} took over 7 days.`);
        const peakDay = maxBy(t.daily, d => d.raised);
        if (peakDay && peakDay.raised > 0) push('info', 'Requests', `Busiest day was ${fmtDay(peakDay.date)} with ${peakDay.raised} raised.`);
        let best = { wd: 0, h: 0, v: 0 };
        t.heatmap.forEach((row, wd) => row.forEach((v, h) => { if (v > best.v) best = { wd, h, v }; }));
        if (best.v > 1) push('info', 'Requests', `Requests peak on ${WEEKDAYS[best.wd]} around ${best.h}:00 to ${best.h + 1}:00 (${best.v} in that slot).`);
    }
    if (s.sop.available && s.sop.scheduled > 0) {
        const c = s.sop.completion_rate ?? 0;
        push(c >= 90 ? 'good' : c >= 70 ? 'warn' : 'bad', 'Checklists', `Checklist completion is ${fmtPct(s.sop.completion_rate)}: ${n0.format(s.sop.completed)} of ${n0.format(s.sop.scheduled)} done, ${n0.format(s.sop.late)} late, ${n0.format(s.sop.missed)} missed.`);
    }
    if (s.ppm.available) {
        if (s.ppm.overdue_now > 0) push('bad', 'PPM', `${n0.format(s.ppm.overdue_now)} planned maintenance task${s.ppm.overdue_now === 1 ? ' is' : 's are'} overdue today.`);
        if (s.ppm.total > 0) {
            const weakest = maxBy(s.ppm.by_system.filter(x => x.total >= 2), x => x.total - x.done);
            if (weakest && weakest.total - weakest.done > 0) push('warn', 'PPM', `${weakest.name} has the most open PPM work: ${weakest.total - weakest.done} of ${weakest.total} not done.`);
        }
    }
    const logging = (label: string, sec: { days_logged: number; days_in_range: number } | null) => {
        if (!sec) return;
        const gap = sec.days_in_range - sec.days_logged;
        if (gap > 0) push(gap > sec.days_in_range * 0.3 ? 'bad' : 'warn', label, `${label} readings missing on ${gap} of ${sec.days_in_range} days.`);
    };
    logging('Electricity', s.electricity.available ? s.electricity : null);
    logging('Diesel', s.diesel.available ? s.diesel : null);
    logging('Water', s.water.available ? s.water : null);
    if (s.electricity.available && s.electricity.units > 0) {
        const peak = maxBy(s.electricity.daily, d => d.units);
        if (peak) push('info', 'Electricity', `Electricity averaged ${n0.format(s.electricity.units / Math.max(1, s.electricity.days_logged))} ${s.electricity.unit_label} per logged day; peak ${n0.format(peak.units)} on ${fmtDay(peak.date)}.`);
    }
    if (s.diesel.available && s.diesel.litres > 0 && s.electricity.available && s.electricity.cost > 0) {
        push('info', 'Utilities', `Diesel is ${share(s.diesel.cost, s.diesel.cost + s.electricity.cost + (s.water.available ? s.water.cost : 0))}% of utility spend (${inr.format(s.diesel.cost)}).`);
    }
    if (s.stock.available && s.stock.low_stock > 0) push('warn', 'Stock', `${n0.format(s.stock.low_stock)} stock item${s.stock.low_stock === 1 ? ' is' : 's are'} below the minimum threshold${s.stock.low_stock_items[0] ? `, including ${s.stock.low_stock_items[0].name}` : ''}.`);
    if (s.assets.available) {
        if (s.assets.under_repair > 0) push('warn', 'Assets', `${n0.format(s.assets.under_repair)} asset${s.assets.under_repair === 1 ? '' : 's'} under repair.`);
        if (s.assets.warranty_expiring_90d > 0) push('info', 'Assets', `${n0.format(s.assets.warranty_expiring_90d)} asset warrant${s.assets.warranty_expiring_90d === 1 ? 'y ends' : 'ies end'} within 90 days.`);
    }
    if (s.amc.available) {
        if (s.amc.expired > 0) push('bad', 'AMC', `${n0.format(s.amc.expired)} AMC contract${s.amc.expired === 1 ? ' has' : 's have'} expired.`);
        if (s.amc.expiring_60d > 0) push('warn', 'AMC', `${n0.format(s.amc.expiring_60d)} AMC contract${s.amc.expiring_60d === 1 ? '' : 's'} expire within 60 days${s.amc.expiring_list[0] ? ` (${s.amc.expiring_list[0].system}, ${fmtDay(s.amc.expiring_list[0].ends)})` : ''}.`);
    }
    if (s.visitors.available && s.visitors.total > 0) {
        const wd = s.visitors.by_weekday.indexOf(Math.max(...s.visitors.by_weekday));
        push('info', 'Visitors', `${n0.format(s.visitors.total)} visitors, ${n1.format(s.visitors.per_day)} per day; ${WEEKDAYS[wd]} is the busiest weekday.`);
        if (s.visitors.checked_in > 0) push('warn', 'Visitors', `${n0.format(s.visitors.checked_in)} visitor${s.visitors.checked_in === 1 ? '' : 's'} never checked out.`);
    }
    if (s.meeting_rooms.available && s.meeting_rooms.by_room[0]) {
        const r0 = s.meeting_rooms.by_room[0];
        push('info', 'Rooms', `${r0.name} is the most used room (${n1.format(r0.hours)} h of ${n1.format(s.meeting_rooms.hours_booked)} h booked).`);
    }
    if (s.petty_cash.available && s.petty_cash.pending_approval > 0) push('warn', 'Petty cash', `${n0.format(s.petty_cash.pending_approval)} petty cash request${s.petty_cash.pending_approval === 1 ? '' : 's'} awaiting approval.`);
    if (s.procurement.available && s.procurement.pending > 0) push('warn', 'Procurement', `${n0.format(s.procurement.pending)} material request${s.procurement.pending === 1 ? '' : 's'} still pending.`);
    if (s.requisitions.available && s.requisitions.missing_months.length) push('bad', 'Requisitions', `Monthly requisition not submitted for ${s.requisitions.missing_months.join(', ')}.`);
    if (s.roster.available && s.roster.days_covered < s.roster.days_in_range) push('warn', 'Roster', `Roster covers ${s.roster.days_covered} of ${s.roster.days_in_range} days.`);
    if (s.tasks.available && s.tasks.total > 0 && s.tasks.completion_rate !== null) push(s.tasks.completion_rate >= 85 ? 'good' : 'warn', 'Tasks', `Task completion for the property team is ${fmtPct(s.tasks.completion_rate)} (${n0.format(s.tasks.completed)} of ${n0.format(s.tasks.total)}).`);
    if (s.audit.available && s.audit.missing > 0) push('bad', 'Audit', `${n0.format(s.audit.missing)} statutory audit item${s.audit.missing === 1 ? ' is' : 's are'} missing.`);
    if (s.hr_tickets.available && s.hr_tickets.escalated > 0) push('bad', 'HR', `${n0.format(s.hr_tickets.escalated)} HR grievance${s.hr_tickets.escalated === 1 ? '' : 's'} escalated.`);

    const order = { bad: 0, warn: 1, good: 2, info: 3 };
    return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, 12);
}

function buildScorecard(r: Report): { name: string; value: number; detail: string }[] {
    const s = r.sections;
    const rows: { name: string; value: number; detail: string }[] = [];
    const add = (name: string, value: number | null, detail: string) => { if (value !== null && Number.isFinite(value)) rows.push({ name, value: Math.max(0, Math.min(100, value)), detail }); };
    if (s.tickets.available && s.tickets.total > 0) {
        add('Request closure', s.tickets.closure_rate, `${s.tickets.closed} of ${s.tickets.total} closed`);
        add('SLA met', 100 - (s.tickets.sla_breached / s.tickets.total) * 100, `${s.tickets.sla_breached} breached`);
    }
    if (s.sop.available && s.sop.scheduled > 0) add('Checklist completion', s.sop.completion_rate, `${s.sop.completed} of ${s.sop.scheduled}`);
    if (s.ppm.available && s.ppm.total > 0) add('PPM compliance', s.ppm.compliance, `${s.ppm.done} of ${s.ppm.total} done`);
    if (s.tasks.available && s.tasks.total > 0) add('Task completion', s.tasks.completion_rate, `${s.tasks.completed} of ${s.tasks.total}`);
    if (s.audit.available && s.audit.items > 0) add('Audit compliance', s.audit.compliance, `${s.audit.compliant} compliant`);
    if (s.roster.available) add('Roster coverage', (s.roster.days_covered / Math.max(1, s.roster.days_in_range)) * 100, `${s.roster.days_covered} of ${s.roster.days_in_range} days`);
    if (s.electricity.available && s.electricity.meters > 0) add('Electricity logging', (s.electricity.days_logged / Math.max(1, s.electricity.days_in_range)) * 100, `${s.electricity.days_logged} of ${s.electricity.days_in_range} days`);
    if (s.diesel.available && s.diesel.readings > 0) add('Diesel logging', (s.diesel.days_logged / Math.max(1, s.diesel.days_in_range)) * 100, `${s.diesel.days_logged} of ${s.diesel.days_in_range} days`);
    if (s.water.available && s.water.sources > 0) add('Water logging', (s.water.days_logged / Math.max(1, s.water.days_in_range)) * 100, `${s.water.days_logged} of ${s.water.days_in_range} days`);
    if (s.requisitions.available && s.requisitions.months_in_range > 0) add('Requisitions submitted', (s.requisitions.submitted / s.requisitions.months_in_range) * 100, `${s.requisitions.submitted} of ${s.requisitions.months_in_range} months`);
    return rows;
}

const LEVEL_ICON: Record<Finding['level'], { icon: React.ElementType; cls: string }> = {
    bad: { icon: AlertCircle, cls: 'text-red-600' },
    warn: { icon: AlertTriangle, cls: 'text-amber-600' },
    good: { icon: CheckCircle2, cls: 'text-emerald-600' },
    info: { icon: Info, cls: 'text-slate-400' },
};

// ── report ───────────────────────────────────────────────────────────────────

interface Props {
    propertyId: string;
    /** Shown while the report loads, before the API returns the property's own name. */
    propertyName?: string;
}

export default function PropertyOverviewReport({ propertyId, propertyName }: Props) {
    const [preset, setPreset] = useState<Preset>('mtd');
    const [custom, setCustom] = useState<{ from: string; to: string }>(() => presetRange('30'));
    const [report, setReport] = useState<Report | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);

    const range = useMemo(() => preset === 'custom' ? custom : presetRange(preset), [preset, custom]);

    const load = useCallback(async () => {
        if (!propertyId) return;
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/reports/property-overview?propertyId=${propertyId}&from=${range.from}&to=${range.to}`, { cache: 'no-store' });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to load the property report');
            setReport(data as Report);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load the property report');
        } finally {
            setIsLoading(false);
        }
    }, [propertyId, range.from, range.to]);

    useEffect(() => {
        if (preset === 'custom' && custom.from > custom.to) return;
        load();
    }, [load, preset, custom.from, custom.to]);

    const findings = useMemo(() => (report ? buildFindings(report) : []), [report]);
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
        <div className="space-y-4">
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
                                        {[report.property.code, report.property.city, report.property.address].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[11px] uppercase tracking-wide text-slate-300 font-bold">property report</div>
                                <div className="text-sm font-bold">{fmtRange(report.range.from, report.range.to)}</div>
                                <div className="text-[11px] text-slate-300">{report.range.days} days · generated {new Date(report.generated_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                            </div>
                        </div>
                    </header>

                    {/* Headline tiles */}
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                        {[
                            { label: 'requests raised', value: s.tickets.available ? n0.format(s.tickets.total) : 'n/a' },
                            { label: 'open requests now', value: s.tickets.available ? n0.format(s.tickets.open_now) : 'n/a' },
                            { label: 'checklist completion', value: s.sop.available ? fmtPct(s.sop.completion_rate) : 'n/a' },
                            { label: 'ppm compliance', value: s.ppm.available ? fmtPct(s.ppm.compliance) : 'n/a' },
                            { label: `electricity ${s.electricity.available ? s.electricity.unit_label : ''}`.trim(), value: s.electricity.available ? n0.format(s.electricity.units) : 'n/a' },
                            { label: 'diesel litres', value: s.diesel.available ? n0.format(s.diesel.litres) : 'n/a' },
                            { label: 'visitors', value: s.visitors.available ? n0.format(s.visitors.total) : 'n/a' },
                            { label: 'petty cash paid', value: s.petty_cash.available ? inr.format(s.petty_cash.paid_amount) : 'n/a' },
                        ].map(t => (
                            <div key={t.label} className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
                                <div className="text-lg font-black text-slate-900 tabular-nums truncate">{t.value}</div>
                                <div className="text-[11px] font-medium text-slate-500 lowercase">{t.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Analyst layer: scorecard + findings */}
                    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                        <section className="xl:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                            <header className="flex items-center gap-2 mb-1">
                                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center"><Gauge className="w-4 h-4 text-slate-700" /></div>
                                <h3 className="text-sm font-black text-slate-900">Operational health scorecard</h3>
                            </header>
                            <p className="text-[11px] text-slate-500 mb-3">Every rate in the range against one target. Green is 90% or better, amber 70 to 90, red below 70.</p>
                            <Scorecard rows={scorecard} />
                        </section>
                        <section className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                            <header className="flex items-center gap-2 mb-3">
                                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center"><Lightbulb className="w-4 h-4 text-slate-700" /></div>
                                <h3 className="text-sm font-black text-slate-900">What stands out</h3>
                            </header>
                            {findings.length === 0 ? <Empty text="no findings for this range" /> : (
                                <ul className="space-y-2">
                                    {findings.map((f, i) => {
                                        const L = LEVEL_ICON[f.level];
                                        return (
                                            <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                                                <L.icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${L.cls}`} />
                                                <span><span className="font-bold text-slate-900">{f.module}.</span> {f.text}</span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>
                    </div>

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
                                        <Stat label="closure rate" value={fmtPct(s.tickets.closure_rate)} />
                                        <Stat label="avg time to close" value={fmtHours(s.tickets.avg_resolution_hours)} />
                                        <Stat label="sla breached" value={n0.format(s.tickets.sla_breached)} tone={s.tickets.sla_breached > 0 ? 'bad' : 'good'} />
                                        <Stat label="internal" value={n0.format(s.tickets.internal)} />
                                        <Stat label="open now (all time)" value={n0.format(s.tickets.open_now)} />
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                                        <div className="lg:col-span-3">
                                            <ChartTitle note="trend">Raised vs closed per day</ChartTitle>
                                            <Trend data={s.tickets.daily} series={[{ key: 'raised', name: 'Raised', color: C.blue }, { key: 'closed', name: 'Closed', color: C.amber }]} height={200} />
                                        </div>
                                        <div className="lg:col-span-2">
                                            <ChartTitle note="distribution">How long requests take to close</ChartTitle>
                                            <Ranking rows={s.tickets.resolution_buckets} color={C.cyan} height={150} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                                        <div>
                                            <ChartTitle note="ranking">By category</ChartTitle>
                                            <Ranking rows={s.tickets.by_category} />
                                        </div>
                                        <div>
                                            <ChartTitle note="ranking">By floor</ChartTitle>
                                            <Ranking rows={s.tickets.by_floor} color={C.violet} />
                                        </div>
                                        <div className="space-y-5">
                                            <div>
                                                <ChartTitle note="mix">Priority mix</ChartTitle>
                                                <Mix parts={['urgent', 'high', 'medium', 'low'].map((p, i) => ({ name: p, value: s.tickets.available ? (s.tickets.by_priority.find(x => x.name === p)?.count || 0) : 0, color: [C.red, C.amber, C.blue, C.cyan][i] }))} total={s.tickets.total} />
                                            </div>
                                            <div>
                                                <ChartTitle note="mix">Status mix</ChartTitle>
                                                <Mix parts={s.tickets.by_status.slice(0, 6).map((x, i) => ({ name: x.name.replace(/_/g, ' '), value: x.count, color: [C.blue, C.amber, C.cyan, C.violet, C.magenta, C.red][i] }))} total={s.tickets.total} />
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <ChartTitle note="timing, IST">When requests come in (weekday by hour)</ChartTitle>
                                        <Heatmap grid={s.tickets.heatmap} />
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
                                            <Stat label="days logged" value={`${s.electricity.days_logged}/${s.electricity.days_in_range}`} tone={s.electricity.days_logged < s.electricity.days_in_range ? 'warn' : 'good'} />
                                        </div>
                                        <ChartTitle note="trend">Units per day (main meters)</ChartTitle>
                                        <Trend data={s.electricity.daily} series={[{ key: 'units', name: 'Units', color: C.blue }]} kind="area" height={150} unit={s.electricity.unit_label} />
                                        <div className="mt-3"><ChartTitle note="ranking">By main meter</ChartTitle><Ranking rows={s.electricity.by_meter.map(m => ({ name: m.name, count: m.units }))} /></div>
                                    </>) : <p className="text-xs text-slate-400 italic">{s.electricity.reason}</p>}
                                </div>
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2"><Fuel className="w-3.5 h-3.5 text-slate-500" /><span className="text-xs font-bold text-slate-800">Diesel</span></div>
                                    {s.diesel.available ? (<>
                                        <div className="grid grid-cols-3 gap-3 mb-3">
                                            <Stat label="litres" value={n0.format(s.diesel.litres)} />
                                            <Stat label="cost" value={inr.format(s.diesel.cost)} />
                                            <Stat label="days logged" value={`${s.diesel.days_logged}/${s.diesel.days_in_range}`} tone={s.diesel.days_logged < s.diesel.days_in_range ? 'warn' : 'good'} />
                                        </div>
                                        <ChartTitle note="trend">Litres per day</ChartTitle>
                                        <Trend data={s.diesel.daily} series={[{ key: 'litres', name: 'Litres', color: C.amber }]} kind="area" height={150} unit="L" />
                                        <div className="mt-3"><ChartTitle note="ranking">By generator</ChartTitle><Ranking rows={s.diesel.by_generator.map(g => ({ name: g.name, count: g.litres }))} color={C.amber} /></div>
                                    </>) : <p className="text-xs text-slate-400 italic">{s.diesel.reason}</p>}
                                </div>
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2"><Droplets className="w-3.5 h-3.5 text-slate-500" /><span className="text-xs font-bold text-slate-800">Water</span></div>
                                    {s.water.available ? (<>
                                        <div className="grid grid-cols-3 gap-3 mb-3">
                                            <Stat label="quantity" value={n0.format(s.water.quantity)} />
                                            <Stat label="cost" value={inr.format(s.water.cost)} />
                                            <Stat label="days logged" value={`${s.water.days_logged}/${s.water.days_in_range}`} tone={s.water.days_logged < s.water.days_in_range ? 'warn' : 'good'} />
                                        </div>
                                        <ChartTitle note="trend">Quantity per day</ChartTitle>
                                        <Trend data={s.water.daily} series={[{ key: 'quantity', name: 'Quantity', color: C.cyan }]} kind="area" height={150} />
                                        <div className="mt-3"><ChartTitle note="ranking">By source</ChartTitle><Ranking rows={s.water.by_source.map(w => ({ name: w.name, count: w.quantity }))} color={C.cyan} /></div>
                                    </>) : <p className="text-xs text-slate-400 italic">{s.water.reason}</p>}
                                </div>
                            </div>
                            {(s.electricity.available || s.diesel.available || s.water.available) && (
                                <div className="mt-5 pt-4 border-t border-slate-100">
                                    <ChartTitle note="mix">Utility spend split</ChartTitle>
                                    <Mix parts={[
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
                                    <Stat label="completion" value={fmtPct(s.sop.completion_rate)} tone={s.sop.completion_rate !== null && s.sop.completion_rate < 80 ? 'warn' : 'good'} />
                                    <Stat label="scheduled" value={n0.format(s.sop.scheduled)} />
                                    <Stat label="completed" value={n0.format(s.sop.completed)} tone="good" />
                                    <Stat label="completed late" value={n0.format(s.sop.late)} tone={s.sop.late > 0 ? 'warn' : 'default'} />
                                    <Stat label="missed" value={n0.format(s.sop.missed)} tone={s.sop.missed > 0 ? 'bad' : 'default'} />
                                    <Stat label="active templates" value={n0.format(s.sop.templates)} />
                                </div>
                                <ChartTitle note="stacked trend">Checklist outcomes per day</ChartTitle>
                                <StackedTrend data={s.sop.daily} series={[
                                    { key: 'on_time', name: 'On time', color: C.blue }, { key: 'late', name: 'Late', color: C.amber },
                                    { key: 'missed', name: 'Missed', color: C.red }, { key: 'pending', name: 'Pending', color: S.neutral },
                                ]} />
                            </>)}
                        </ModuleCard>

                        {/* PPM */}
                        <ModuleCard icon={Wrench} title="Planned maintenance (PPM)" section={s.ppm}>
                            {s.ppm.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="compliance" value={fmtPct(s.ppm.compliance)} tone={s.ppm.compliance !== null && s.ppm.compliance < 80 ? 'warn' : 'good'} />
                                    <Stat label="overdue now" value={n0.format(s.ppm.overdue_now)} tone={s.ppm.overdue_now > 0 ? 'bad' : 'good'} />
                                </div>
                                <ChartTitle note="mix">Planned work by status</ChartTitle>
                                <Mix parts={[
                                    { name: 'Done', value: s.ppm.done, color: C.blue }, { name: 'Pending', value: s.ppm.pending, color: C.amber },
                                    { name: 'Postponed', value: s.ppm.postponed, color: C.violet }, { name: 'Skipped', value: s.ppm.skipped, color: S.neutral },
                                ]} total={s.ppm.total} />
                                <div className="mt-4">
                                    <ChartTitle note="ranking, done vs open">By system</ChartTitle>
                                    {s.ppm.by_system.length ? (
                                        <div style={{ height: Math.max(96, s.ppm.by_system.length * 26 + 8) }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={s.ppm.by_system.map(x => ({ name: x.name, done: x.done, open: x.total - x.done }))} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }} barCategoryGap={6}>
                                                    <XAxis type="number" hide />
                                                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                                                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={TIP} />
                                                    <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                                                    <Bar name="Done" dataKey="done" stackId="a" fill={C.blue} stroke="#fff" strokeWidth={1} maxBarSize={14} />
                                                    <Bar name="Open" dataKey="open" stackId="a" fill={C.amber} stroke="#fff" strokeWidth={1} radius={[0, 4, 4, 0]} maxBarSize={14} />
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
                                        <ChartTitle note="trend">Visitors per day</ChartTitle>
                                        <Trend data={s.visitors.daily} series={[{ key: 'visitors', name: 'Visitors', color: C.violet }]} height={160} />
                                    </div>
                                    <div className="lg:col-span-2">
                                        <ChartTitle note="timing">By weekday</ChartTitle>
                                        <Ranking rows={[1, 2, 3, 4, 5, 6, 0].map(i => ({ name: WEEKDAYS[i], count: s.visitors.available ? s.visitors.by_weekday[i] : 0 }))} color={C.violet} height={190} />
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
                                <ChartTitle note="trend">Hours booked per day</ChartTitle>
                                <Trend data={s.meeting_rooms.daily} series={[{ key: 'hours', name: 'Hours', color: C.magenta }]} height={140} unit="h" />
                                <div className="mt-3"><ChartTitle note="ranking, hours">By room</ChartTitle><Ranking rows={s.meeting_rooms.by_room.map(r => ({ name: r.name, count: r.hours }))} color={C.magenta} valueFormatter={v => `${n1.format(v)} h`} /></div>
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
                                        <ChartTitle note="trend">Added vs consumed per day</ChartTitle>
                                        <Trend data={s.stock.daily} series={[{ key: 'added', name: 'Added', color: C.blue }, { key: 'removed', name: 'Consumed', color: C.amber }]} height={160} />
                                    </div>
                                    <div className="lg:col-span-2">
                                        <ChartTitle note="quantity vs minimum">Low stock items</ChartTitle>
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
                                <ChartTitle note="mix">Status mix</ChartTitle>
                                <Mix parts={[
                                    { name: 'Active', value: s.assets.active, color: C.blue }, { name: 'Under repair', value: s.assets.under_repair, color: C.amber },
                                    { name: 'Inactive / disposed', value: s.assets.inactive, color: S.neutral },
                                ]} total={s.assets.total} />
                                <div className="mt-4"><ChartTitle note="ranking">By category</ChartTitle><Ranking rows={s.assets.by_category} /></div>
                            </>)}
                        </ModuleCard>

                        {/* AMC */}
                        <ModuleCard icon={FileBadge} title="AMC contracts" section={s.amc}>
                            {s.amc.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="contracts" value={n0.format(s.amc.total)} />
                                    <Stat label="contract value" value={inr.format(s.amc.total_value)} />
                                </div>
                                <ChartTitle note="mix">Contract status</ChartTitle>
                                <Mix parts={[
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
                                <ChartTitle note="funnel, amount">Requested to paid</ChartTitle>
                                <Ranking rows={[
                                    { name: 'Requested', count: s.petty_cash.requested_amount }, { name: 'Approved', count: s.petty_cash.approved_amount }, { name: 'Paid', count: s.petty_cash.paid_amount },
                                ]} color={C.blue} height={96} valueFormatter={v => inr.format(v)} />
                                <div className="mt-4"><ChartTitle note="mix">By status</ChartTitle>
                                    <Mix parts={s.petty_cash.by_status.slice(0, 6).map((x, i) => ({ name: x.name, value: x.count, color: [C.blue, C.cyan, C.amber, C.violet, C.red, C.magenta][i] }))} total={s.petty_cash.requests} /></div>
                            </>)}
                        </ModuleCard>

                        {/* Procurement */}
                        <ModuleCard icon={ShoppingCart} title="Procurement (material requests)" section={s.procurement}>
                            {s.procurement.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="requests" value={n0.format(s.procurement.requests)} />
                                    <Stat label="value" value={inr.format(s.procurement.total_amount)} />
                                </div>
                                <ChartTitle note="pipeline">Pending, approved, delivered</ChartTitle>
                                <Ranking rows={[
                                    { name: 'Pending', count: s.procurement.pending }, { name: 'Approved / ordered', count: s.procurement.approved },
                                    { name: 'Delivered', count: s.procurement.delivered }, { name: 'Rejected', count: s.procurement.rejected },
                                ]} color={C.cyan} height={120} />
                            </>)}
                        </ModuleCard>

                        {/* Guest requests */}
                        <ModuleCard icon={QrCode} title="Guest requests (QR)" section={s.guest_requests}>
                            {s.guest_requests.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="received" value={n0.format(s.guest_requests.total)} />
                                    <Stat label="pending" value={n0.format(s.guest_requests.pending)} tone={s.guest_requests.pending > 0 ? 'warn' : 'default'} />
                                </div>
                                <ChartTitle note="mix">Status</ChartTitle>
                                <Mix parts={[
                                    { name: 'Resolved', value: s.guest_requests.resolved, color: C.blue }, { name: 'In progress', value: s.guest_requests.in_progress, color: C.cyan }, { name: 'Pending', value: s.guest_requests.pending, color: C.amber },
                                ]} total={s.guest_requests.total} />
                                <div className="mt-4"><ChartTitle note="ranking">By category</ChartTitle><Ranking rows={s.guest_requests.by_category} /></div>
                            </>)}
                        </ModuleCard>

                        {/* HR */}
                        <ModuleCard icon={HeartHandshake} title="HR grievances (property team)" section={s.hr_tickets}>
                            {s.hr_tickets.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="raised" value={n0.format(s.hr_tickets.total)} />
                                    <Stat label="escalated" value={n0.format(s.hr_tickets.escalated)} tone={s.hr_tickets.escalated > 0 ? 'bad' : 'default'} />
                                </div>
                                <ChartTitle note="mix">Open vs resolved</ChartTitle>
                                <Mix parts={[{ name: 'Resolved', value: s.hr_tickets.resolved, color: C.blue }, { name: 'Open', value: s.hr_tickets.open, color: C.amber }]} total={s.hr_tickets.total} />
                                <div className="mt-4"><ChartTitle note="ranking">By type</ChartTitle><Ranking rows={s.hr_tickets.by_type} /></div>
                            </>)}
                        </ModuleCard>

                        {/* Tasks */}
                        <ModuleCard icon={ListChecks} title="Task manager (property team)" section={s.tasks}>
                            {s.tasks.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="tasks assigned" value={n0.format(s.tasks.total)} />
                                    <Stat label="completion" value={fmtPct(s.tasks.completion_rate)} tone={s.tasks.completion_rate !== null && s.tasks.completion_rate < 80 ? 'warn' : 'good'} />
                                </div>
                                <ChartTitle note="mix">Status</ChartTitle>
                                <Mix parts={[
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
                                <ChartTitle note="mix">Submission state</ChartTitle>
                                <Mix parts={[
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
                                    <Stat label="days covered" value={`${s.roster.days_covered} / ${s.roster.days_in_range}`} tone={s.roster.days_covered < s.roster.days_in_range ? 'warn' : 'good'} />
                                    <Stat label="reliever shifts" value={n0.format(s.roster.reliever_shifts)} />
                                </div>
                                <ChartTitle note="mix">Regular vs reliever shifts</ChartTitle>
                                <Mix parts={[{ name: 'Regular', value: s.roster.shifts - s.roster.reliever_shifts, color: C.blue }, { name: 'Reliever', value: s.roster.reliever_shifts, color: C.amber }]} total={s.roster.shifts} />
                            </>)}
                        </ModuleCard>

                        {/* Audit */}
                        <ModuleCard icon={ShieldCheck} title="Statutory audit (current)" section={s.audit}>
                            {s.audit.available && (<>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <Stat label="compliance" value={fmtPct(s.audit.compliance)} tone={s.audit.compliance !== null && s.audit.compliance < 80 ? 'warn' : 'good'} />
                                    <Stat label="items" value={n0.format(s.audit.items)} />
                                </div>
                                <ChartTitle note="mix">Item status</ChartTitle>
                                <Mix parts={[
                                    { name: 'Compliant', value: s.audit.compliant, color: C.blue }, { name: 'Pending review', value: s.audit.pending_review, color: C.amber },
                                    { name: 'Missing', value: s.audit.missing, color: C.red }, { name: 'Not applicable', value: s.audit.not_applicable, color: S.neutral },
                                ]} total={s.audit.items} />
                            </>)}
                        </ModuleCard>

                        {/* Team */}
                        <ModuleCard icon={UserCircle2} title="Property team" section={s.team}>
                            {s.team.available && (<>
                                <Stat label="active members" value={n0.format(s.team.members)} />
                                <div className="mt-4"><ChartTitle note="ranking">By role</ChartTitle><Ranking rows={s.team.by_role} color={C.violet} /></div>
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
    );
}
