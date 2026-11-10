'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, Download, Loader2, RefreshCw, Ticket, QrCode, HeartHandshake, ClipboardCheck, Wrench,
    Zap, Fuel, Droplets, Package, Boxes, FileBadge, Users, DoorOpen, Wallet, ShoppingCart, CalendarCheck,
    CalendarDays, ListChecks, ShieldCheck, UserCircle2, Building2,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Property Overview Report (Reports tab, after a property is chosen).
 *
 * One page for one property across every service and module it runs. Reads
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
        }>;
        guest_requests: Section<{ total: number; pending: number; in_progress: number; resolved: number; by_category: Count[] }>;
        hr_tickets: Section<{ total: number; open: number; resolved: number; escalated: number; by_type: Count[]; by_priority: Count[] }>;
        sop: Section<{ scheduled: number; completed: number; late: number; missed: number; pending: number; completion_rate: number | null; templates: number }>;
        ppm: Section<{ total: number; done: number; pending: number; postponed: number; skipped: number; compliance: number | null; overdue_now: number; by_system: { name: string; total: number; done: number }[] }>;
        electricity: Section<{ readings: number; days_logged: number; days_in_range: number; meters: number; units: number; cost: number; unit_label: string; by_meter: { name: string; units: number; cost: number }[] }>;
        diesel: Section<{ readings: number; days_logged: number; days_in_range: number; litres: number; cost: number; by_generator: { name: string; litres: number; cost: number }[] }>;
        water: Section<{ sources: number; readings: number; days_logged: number; days_in_range: number; quantity: number; cost: number; by_source: { name: string; quantity: number; cost: number }[] }>;
        stock: Section<{ items: number; low_stock: number; low_stock_items: { name: string; quantity: number; min: number }[]; movements: number; added: number; removed: number; days_with_movement: number }>;
        assets: Section<{ total: number; active: number; under_repair: number; inactive: number; warranty_expiring_90d: number; amc_required: number; purchase_value: number; events_in_range: number; by_category: Count[] }>;
        amc: Section<{ total: number; active: number; expired: number; expiring_60d: number; total_value: number; expiring_list: { system: string; vendor: string; ends: string }[] }>;
        visitors: Section<{ total: number; checked_in: number; checked_out: number; per_day: number }>;
        meeting_rooms: Section<{ rooms: number; bookings: number; confirmed: number; cancelled: number; hours_booked: number; by_status: Count[] }>;
        petty_cash: Section<{ requests: number; requested_amount: number; approved_amount: number; paid_amount: number; pending_approval: number; rejected: number; closed: number; by_status: Count[] }>;
        procurement: Section<{ requests: number; pending: number; approved: number; delivered: number; rejected: number; total_amount: number; by_status: Count[] }>;
        requisitions: Section<{ months_in_range: number; submitted: number; acknowledged: number; missing_months: string[] }>;
        roster: Section<{ shifts: number; staff_rostered: number; reliever_shifts: number; days_covered: number; days_in_range: number }>;
        tasks: Section<{ total: number; completed: number; in_progress: number; pending: number; completion_rate: number | null }>;
        audit: Section<{ items: number; compliant: number; pending_review: number; missing: number; not_applicable: number; compliance: number | null }>;
        team: Section<{ members: number; by_role: Count[] }>;
    };
}

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
        const first = `${today.slice(0, 7)}-01`;
        const lastMonthEnd = addDays(first, -1);
        return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
    }
    if (p === '30') return { from: addDays(today, -29), to: today };
    return { from: addDays(today, -89), to: today };
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const n0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
function fmtDay(d: string) { return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function fmtRange(from: string, to: string) { return `${fmtDay(from)} to ${fmtDay(to)} ${to.slice(0, 4)}`; }
function fmtPct(v: number | null) { return v === null ? 'n/a' : `${n1.format(v)}%`; }
function fmtHours(h: number | null) {
    if (h === null) return 'n/a';
    if (h < 48) return `${n1.format(h)} h`;
    return `${n1.format(h / 24)} d`;
}
function titleCase(s: string) { return s.replace(/\b\w/g, c => c.toUpperCase()); }

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

function Breakdown({ title, rows, total }: { title: string; rows: { name: string; count: number }[]; total?: number }) {
    if (!rows.length) return null;
    const max = total ?? rows.reduce((s, r) => s + r.count, 0);
    return (
        <div className="mt-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</div>
            <ul className="space-y-1.5">
                {rows.map(r => (
                    <li key={r.name} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-slate-700">{titleCase(r.name)}</span>
                            <span className="font-bold tabular-nums text-slate-900">{n0.format(r.count)}</span>
                        </div>
                        <div className="h-1 rounded-full bg-slate-100 mt-1">
                            <div className="h-1 rounded-full bg-slate-400" style={{ width: `${max > 0 ? Math.min(100, (r.count / max) * 100) : 0}%` }} />
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function ModuleCard({ icon: Icon, title, section, children, wide }: {
    icon: React.ElementType; title: string; section: Section<object>; children?: React.ReactNode; wide?: boolean;
}) {
    return (
        <section className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col ${wide ? 'md:col-span-2 xl:col-span-3' : ''}`}>
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
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => setPreset(p.id)}
                                aria-pressed={preset === p.id}
                                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${preset === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                            >
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
                    <button
                        type="button"
                        onClick={handleDownloadPdf}
                        disabled={isExporting || isLoading || !report}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-900 transition-colors disabled:opacity-50"
                    >
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
                                    <h2 className="text-xl font-black leading-tight">{report.property.name}</h2>
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

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {/* Tickets */}
                        <ModuleCard icon={Ticket} title="Requests & tickets" section={s.tickets} wide>
                            {s.tickets.available && (
                                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                                    <div className="lg:col-span-2">
                                        <div className="grid grid-cols-3 gap-3">
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
                                        <Breakdown title="By category" rows={s.tickets.by_category} total={s.tickets.total} />
                                    </div>
                                    <div className="lg:col-span-3 flex flex-col">
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Raised vs closed per day</div>
                                        <div className="h-56">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={s.tickets.daily} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barGap={2}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={18} />
                                                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                                    <Tooltip cursor={{ fill: '#f1f5f9' }} labelFormatter={d => fmtDay(String(d))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                                                    <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                                                    <Bar name="Raised" dataKey="raised" fill="#2563eb" radius={[4, 4, 0, 0]} />
                                                    <Bar name="Closed" dataKey="closed" fill="#d97706" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="grid grid-cols-2 gap-5">
                                            <Breakdown title="By priority" rows={s.tickets.by_priority} total={s.tickets.total} />
                                            <Breakdown title="By floor" rows={s.tickets.by_floor} total={s.tickets.total} />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </ModuleCard>

                        {/* Guest requests */}
                        <ModuleCard icon={QrCode} title="Guest requests (QR)" section={s.guest_requests}>
                            {s.guest_requests.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="received" value={n0.format(s.guest_requests.total)} />
                                    <Stat label="resolved" value={n0.format(s.guest_requests.resolved)} tone="good" />
                                    <Stat label="pending" value={n0.format(s.guest_requests.pending)} tone={s.guest_requests.pending > 0 ? 'warn' : 'default'} />
                                    <Stat label="in progress" value={n0.format(s.guest_requests.in_progress)} />
                                </div>
                                <Breakdown title="By category" rows={s.guest_requests.by_category} total={s.guest_requests.total} />
                            </>)}
                        </ModuleCard>

                        {/* HR */}
                        <ModuleCard icon={HeartHandshake} title="HR grievances (property team)" section={s.hr_tickets}>
                            {s.hr_tickets.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="raised" value={n0.format(s.hr_tickets.total)} />
                                    <Stat label="resolved" value={n0.format(s.hr_tickets.resolved)} tone="good" />
                                    <Stat label="open" value={n0.format(s.hr_tickets.open)} tone={s.hr_tickets.open > 0 ? 'warn' : 'default'} />
                                    <Stat label="escalated" value={n0.format(s.hr_tickets.escalated)} tone={s.hr_tickets.escalated > 0 ? 'bad' : 'default'} />
                                </div>
                                <Breakdown title="By type" rows={s.hr_tickets.by_type} total={s.hr_tickets.total} />
                            </>)}
                        </ModuleCard>

                        {/* SOP */}
                        <ModuleCard icon={ClipboardCheck} title="SOP checklists" section={s.sop}>
                            {s.sop.available && (
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="completion" value={fmtPct(s.sop.completion_rate)} tone={s.sop.completion_rate !== null && s.sop.completion_rate < 80 ? 'warn' : 'good'} />
                                    <Stat label="scheduled" value={n0.format(s.sop.scheduled)} />
                                    <Stat label="completed" value={n0.format(s.sop.completed)} tone="good" />
                                    <Stat label="completed late" value={n0.format(s.sop.late)} tone={s.sop.late > 0 ? 'warn' : 'default'} />
                                    <Stat label="missed" value={n0.format(s.sop.missed)} tone={s.sop.missed > 0 ? 'bad' : 'default'} />
                                    <Stat label="active templates" value={n0.format(s.sop.templates)} />
                                </div>
                            )}
                        </ModuleCard>

                        {/* PPM */}
                        <ModuleCard icon={Wrench} title="Planned maintenance (PPM)" section={s.ppm}>
                            {s.ppm.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="compliance" value={fmtPct(s.ppm.compliance)} tone={s.ppm.compliance !== null && s.ppm.compliance < 80 ? 'warn' : 'good'} />
                                    <Stat label="planned" value={n0.format(s.ppm.total)} />
                                    <Stat label="done" value={n0.format(s.ppm.done)} tone="good" />
                                    <Stat label="pending" value={n0.format(s.ppm.pending)} />
                                    <Stat label="postponed / skipped" value={n0.format(s.ppm.postponed + s.ppm.skipped)} />
                                    <Stat label="overdue now" value={n0.format(s.ppm.overdue_now)} tone={s.ppm.overdue_now > 0 ? 'bad' : 'good'} />
                                </div>
                                <Breakdown title="By system (planned)" rows={s.ppm.by_system.map(r => ({ name: `${r.name} (${r.done}/${r.total} done)`, count: r.total }))} total={s.ppm.total} />
                            </>)}
                        </ModuleCard>

                        {/* Electricity */}
                        <ModuleCard icon={Zap} title="Electricity" section={s.electricity}>
                            {s.electricity.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label={`units (${s.electricity.unit_label})`} value={n0.format(s.electricity.units)} />
                                    <Stat label="cost" value={inr.format(s.electricity.cost)} />
                                    <Stat label="days logged" value={`${s.electricity.days_logged} / ${s.electricity.days_in_range}`} tone={s.electricity.days_logged < s.electricity.days_in_range ? 'warn' : 'good'} />
                                    <Stat label="meters" value={n0.format(s.electricity.meters)} />
                                </div>
                                <Breakdown title="By main meter (units)" rows={s.electricity.by_meter.map(m => ({ name: m.name, count: m.units }))} total={s.electricity.units} />
                            </>)}
                        </ModuleCard>

                        {/* Diesel */}
                        <ModuleCard icon={Fuel} title="Diesel generators" section={s.diesel}>
                            {s.diesel.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="litres consumed" value={n0.format(s.diesel.litres)} />
                                    <Stat label="cost" value={inr.format(s.diesel.cost)} />
                                    <Stat label="days logged" value={`${s.diesel.days_logged} / ${s.diesel.days_in_range}`} tone={s.diesel.days_logged < s.diesel.days_in_range ? 'warn' : 'good'} />
                                    <Stat label="readings" value={n0.format(s.diesel.readings)} />
                                </div>
                                <Breakdown title="By generator (litres)" rows={s.diesel.by_generator.map(g => ({ name: g.name, count: g.litres }))} total={s.diesel.litres} />
                            </>)}
                        </ModuleCard>

                        {/* Water */}
                        <ModuleCard icon={Droplets} title="Water" section={s.water}>
                            {s.water.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="quantity" value={n0.format(s.water.quantity)} />
                                    <Stat label="cost" value={inr.format(s.water.cost)} />
                                    <Stat label="days logged" value={`${s.water.days_logged} / ${s.water.days_in_range}`} tone={s.water.days_logged < s.water.days_in_range ? 'warn' : 'good'} />
                                    <Stat label="sources" value={n0.format(s.water.sources)} />
                                </div>
                                <Breakdown title="By source" rows={s.water.by_source.map(w => ({ name: w.name, count: w.quantity }))} total={s.water.quantity} />
                            </>)}
                        </ModuleCard>

                        {/* Stock */}
                        <ModuleCard icon={Package} title="Stock & consumables" section={s.stock}>
                            {s.stock.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="items tracked" value={n0.format(s.stock.items)} />
                                    <Stat label="below threshold" value={n0.format(s.stock.low_stock)} tone={s.stock.low_stock > 0 ? 'warn' : 'good'} />
                                    <Stat label="added" value={n0.format(s.stock.added)} />
                                    <Stat label="consumed" value={n0.format(s.stock.removed)} />
                                    <Stat label="movements" value={n0.format(s.stock.movements)} />
                                    <Stat label="days with activity" value={n0.format(s.stock.days_with_movement)} />
                                </div>
                                <Breakdown title="Low stock (qty / min)" rows={s.stock.low_stock_items.map(i => ({ name: `${i.name} (${i.quantity} / ${i.min})`, count: i.quantity }))} total={Math.max(1, ...s.stock.low_stock_items.map(i => i.min))} />
                            </>)}
                        </ModuleCard>

                        {/* Assets */}
                        <ModuleCard icon={Boxes} title="Assets" section={s.assets}>
                            {s.assets.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="registered" value={n0.format(s.assets.total)} />
                                    <Stat label="active" value={n0.format(s.assets.active)} tone="good" />
                                    <Stat label="under repair" value={n0.format(s.assets.under_repair)} tone={s.assets.under_repair > 0 ? 'warn' : 'default'} />
                                    <Stat label="inactive / disposed" value={n0.format(s.assets.inactive)} />
                                    <Stat label="warranty ends in 90d" value={n0.format(s.assets.warranty_expiring_90d)} tone={s.assets.warranty_expiring_90d > 0 ? 'warn' : 'default'} />
                                    <Stat label="events in range" value={n0.format(s.assets.events_in_range)} />
                                </div>
                                <Breakdown title="By category" rows={s.assets.by_category} total={s.assets.total} />
                            </>)}
                        </ModuleCard>

                        {/* AMC */}
                        <ModuleCard icon={FileBadge} title="AMC contracts" section={s.amc}>
                            {s.amc.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="contracts" value={n0.format(s.amc.total)} />
                                    <Stat label="active" value={n0.format(s.amc.active)} tone="good" />
                                    <Stat label="expiring in 60d" value={n0.format(s.amc.expiring_60d)} tone={s.amc.expiring_60d > 0 ? 'warn' : 'default'} />
                                    <Stat label="expired" value={n0.format(s.amc.expired)} tone={s.amc.expired > 0 ? 'bad' : 'default'} />
                                    <Stat label="contract value" value={inr.format(s.amc.total_value)} />
                                </div>
                                {s.amc.expiring_list.length > 0 && (
                                    <div className="mt-4">
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Expiring soon</div>
                                        <ul className="space-y-1 text-xs text-slate-700">
                                            {s.amc.expiring_list.map(c => <li key={`${c.system}-${c.ends}`} className="flex justify-between gap-2"><span className="truncate">{c.system} · {c.vendor}</span><span className="tabular-nums font-bold shrink-0">{fmtDay(c.ends)}</span></li>)}
                                        </ul>
                                    </div>
                                )}
                            </>)}
                        </ModuleCard>

                        {/* Visitors */}
                        <ModuleCard icon={Users} title="Visitors" section={s.visitors}>
                            {s.visitors.available && (
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="visitors" value={n0.format(s.visitors.total)} />
                                    <Stat label="per day" value={n1.format(s.visitors.per_day)} />
                                    <Stat label="checked out" value={n0.format(s.visitors.checked_out)} tone="good" />
                                    <Stat label="not checked out" value={n0.format(s.visitors.checked_in)} tone={s.visitors.checked_in > 0 ? 'warn' : 'default'} />
                                </div>
                            )}
                        </ModuleCard>

                        {/* Meeting rooms */}
                        <ModuleCard icon={DoorOpen} title="Meeting rooms" section={s.meeting_rooms}>
                            {s.meeting_rooms.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="bookings" value={n0.format(s.meeting_rooms.bookings)} />
                                    <Stat label="hours booked" value={n1.format(s.meeting_rooms.hours_booked)} />
                                    <Stat label="confirmed" value={n0.format(s.meeting_rooms.confirmed)} tone="good" />
                                    <Stat label="cancelled" value={n0.format(s.meeting_rooms.cancelled)} />
                                    <Stat label="rooms" value={n0.format(s.meeting_rooms.rooms)} />
                                </div>
                                <Breakdown title="By status" rows={s.meeting_rooms.by_status} total={s.meeting_rooms.bookings} />
                            </>)}
                        </ModuleCard>

                        {/* Petty cash */}
                        <ModuleCard icon={Wallet} title="Petty cash" section={s.petty_cash}>
                            {s.petty_cash.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="requests" value={n0.format(s.petty_cash.requests)} />
                                    <Stat label="requested" value={inr.format(s.petty_cash.requested_amount)} />
                                    <Stat label="approved" value={inr.format(s.petty_cash.approved_amount)} />
                                    <Stat label="paid" value={inr.format(s.petty_cash.paid_amount)} />
                                    <Stat label="awaiting approval" value={n0.format(s.petty_cash.pending_approval)} tone={s.petty_cash.pending_approval > 0 ? 'warn' : 'default'} />
                                    <Stat label="rejected" value={n0.format(s.petty_cash.rejected)} />
                                </div>
                                <Breakdown title="By status" rows={s.petty_cash.by_status} total={s.petty_cash.requests} />
                            </>)}
                        </ModuleCard>

                        {/* Procurement */}
                        <ModuleCard icon={ShoppingCart} title="Procurement (material requests)" section={s.procurement}>
                            {s.procurement.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="requests" value={n0.format(s.procurement.requests)} />
                                    <Stat label="value" value={inr.format(s.procurement.total_amount)} />
                                    <Stat label="pending" value={n0.format(s.procurement.pending)} tone={s.procurement.pending > 0 ? 'warn' : 'default'} />
                                    <Stat label="approved / ordered" value={n0.format(s.procurement.approved)} />
                                    <Stat label="delivered" value={n0.format(s.procurement.delivered)} tone="good" />
                                    <Stat label="rejected" value={n0.format(s.procurement.rejected)} />
                                </div>
                                <Breakdown title="By status" rows={s.procurement.by_status} total={s.procurement.requests} />
                            </>)}
                        </ModuleCard>

                        {/* Monthly requisitions */}
                        <ModuleCard icon={CalendarCheck} title="Monthly requisitions" section={s.requisitions}>
                            {s.requisitions.available && (<>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="months in range" value={n0.format(s.requisitions.months_in_range)} />
                                    <Stat label="submitted" value={n0.format(s.requisitions.submitted)} tone={s.requisitions.submitted >= s.requisitions.months_in_range ? 'good' : 'warn'} />
                                    <Stat label="acknowledged" value={n0.format(s.requisitions.acknowledged)} />
                                    <Stat label="missing" value={n0.format(s.requisitions.missing_months.length)} tone={s.requisitions.missing_months.length > 0 ? 'bad' : 'good'} />
                                </div>
                                {s.requisitions.missing_months.length > 0 && (
                                    <p className="mt-3 text-xs text-slate-600">Not submitted: {s.requisitions.missing_months.join(', ')}</p>
                                )}
                            </>)}
                        </ModuleCard>

                        {/* Roster */}
                        <ModuleCard icon={CalendarDays} title="Staff roster" section={s.roster}>
                            {s.roster.available && (
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="shifts rostered" value={n0.format(s.roster.shifts)} />
                                    <Stat label="staff rostered" value={n0.format(s.roster.staff_rostered)} />
                                    <Stat label="days covered" value={`${s.roster.days_covered} / ${s.roster.days_in_range}`} tone={s.roster.days_covered < s.roster.days_in_range ? 'warn' : 'good'} />
                                    <Stat label="reliever shifts" value={n0.format(s.roster.reliever_shifts)} />
                                </div>
                            )}
                        </ModuleCard>

                        {/* Tasks */}
                        <ModuleCard icon={ListChecks} title="Task manager (property team)" section={s.tasks}>
                            {s.tasks.available && (
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="tasks assigned" value={n0.format(s.tasks.total)} />
                                    <Stat label="completion" value={fmtPct(s.tasks.completion_rate)} />
                                    <Stat label="completed" value={n0.format(s.tasks.completed)} tone="good" />
                                    <Stat label="pending / in progress" value={n0.format(s.tasks.pending + s.tasks.in_progress)} tone={s.tasks.pending + s.tasks.in_progress > 0 ? 'warn' : 'default'} />
                                </div>
                            )}
                        </ModuleCard>

                        {/* Audit */}
                        <ModuleCard icon={ShieldCheck} title="Statutory audit (current)" section={s.audit}>
                            {s.audit.available && (
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="compliance" value={fmtPct(s.audit.compliance)} tone={s.audit.compliance !== null && s.audit.compliance < 80 ? 'warn' : 'good'} />
                                    <Stat label="items" value={n0.format(s.audit.items)} />
                                    <Stat label="compliant" value={n0.format(s.audit.compliant)} tone="good" />
                                    <Stat label="pending review" value={n0.format(s.audit.pending_review)} />
                                    <Stat label="missing" value={n0.format(s.audit.missing)} tone={s.audit.missing > 0 ? 'bad' : 'default'} />
                                    <Stat label="not applicable" value={n0.format(s.audit.not_applicable)} />
                                </div>
                            )}
                        </ModuleCard>

                        {/* Team */}
                        <ModuleCard icon={UserCircle2} title="Property team" section={s.team}>
                            {s.team.available && (<>
                                <Stat label="active members" value={n0.format(s.team.members)} />
                                <Breakdown title="By role" rows={s.team.by_role} total={s.team.members} />
                            </>)}
                        </ModuleCard>
                    </div>

                    <p className="text-[11px] text-slate-400 px-2 pb-1">
                        Range figures count records created or planned within the selected dates (IST). Assets, AMC, stock levels, audit and team show the current state.
                        Modules shown as &ldquo;not set up&rdquo; have no data for this property.
                    </p>
                </div>
            ) : null}
        </div>
    );
}
