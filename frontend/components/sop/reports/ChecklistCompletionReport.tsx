'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Building2,
    Check,
    X,
    Clock,
    Minus,
    ChevronRight,
    Download,
    Search,
    RefreshCw,
    ListChecks,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Timer,
} from 'lucide-react';
import Skeleton from '@/frontend/components/ui/Skeleton';

type RangeMode = 'today' | 'last_7' | 'last_14' | 'last_30' | 'this_month' | 'custom';

interface Bucket {
    total: number;
    done: number;
    missed: number;
    pending: number;
    inProgress: number;
    partial: number;
    late: number;
    completionRate: number | null;
    avgScore: number | null;
}

interface RunRow {
    id: string;
    date: string;
    propertyId: string;
    propertyName: string;
    templateId: string;
    title: string;
    frequency: string | null;
    category: string | null;
    slotTime: string | null;
    status: string;
    isLate: boolean;
    score: number | null;
    completedAt: string | null;
    dueAt: string | null;
    approvalStatus: string | null;
    completedBy: string | null;
}

interface ReportPayload {
    success: boolean;
    range: { from: string; to: string };
    properties: Array<{ id: string; name: string }>;
    summary: Bucket;
    rows: RunRow[];
    truncated: boolean;
}

interface ChecklistCompletionReportProps {
    propertyId?: string;
    propertyIds?: string[];
    /** Opens a single checklist run in the detail view, when the host provides it. */
    onViewRun?: (completionId: string, templateId: string, propertyId: string) => void;
}

/** A date's worth of runs for one checklist (or one whole property). */
interface Cell {
    total: number;
    onTime: number;
    late: number;
    missed: number;
    pending: number;
    runs: RunRow[];
}

const MAX_COLUMNS = 62;

/** Today in IST as YYYY-MM-DD */
function istDate(offsetDays = 0): string {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

function startOfISTMonth(): string {
    return `${istDate().slice(0, 7)}-01`;
}

function rangeFor(mode: RangeMode, customFrom: string, customTo: string): { from: string; to: string } {
    switch (mode) {
        case 'today':
            return { from: istDate(), to: istDate() };
        case 'last_7':
            return { from: istDate(-6), to: istDate() };
        case 'last_14':
            return { from: istDate(-13), to: istDate() };
        case 'last_30':
            return { from: istDate(-29), to: istDate() };
        case 'this_month':
            return { from: startOfISTMonth(), to: istDate() };
        case 'custom':
        default:
            return { from: customFrom, to: customTo };
    }
}

const RANGE_LABELS: Record<RangeMode, string> = {
    today: 'Today',
    last_7: 'Last 7 days',
    last_14: 'Last 14 days',
    last_30: 'Last 30 days',
    this_month: 'This month',
    custom: 'Custom',
};

/** Every date from `from` to `to` inclusive, oldest first. */
function datesInRange(from: string, to: string): string[] {
    const out: string[] = [];
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    let cursor = Date.UTC(fy, (fm || 1) - 1, fd || 1);
    const end = Date.UTC(ty, (tm || 1) - 1, td || 1);
    while (cursor <= end && out.length < MAX_COLUMNS * 4) {
        out.push(new Date(cursor).toISOString().slice(0, 10));
        cursor += 86400000;
    }
    return out;
}

function dayLabel(iso: string): { day: string; weekday: string } {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    return {
        day: dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
        weekday: dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    };
}

function prettyDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const label = dt.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    });
    if (iso === istDate()) return `Today · ${label}`;
    if (iso === istDate(-1)) return `Yesterday · ${label}`;
    return label;
}

function rateTone(rate: number | null): string {
    if (rate === null) return 'text-slate-400 bg-slate-100 border-slate-200';
    if (rate >= 90) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (rate >= 70) return 'text-amber-700 bg-amber-50 border-amber-200';
    if (rate >= 50) return 'text-orange-700 bg-orange-50 border-orange-200';
    return 'text-rose-700 bg-rose-50 border-rose-200';
}

const emptyCell = (): Cell => ({ total: 0, onTime: 0, late: 0, missed: 0, pending: 0, runs: [] });

function addRun(cell: Cell, run: RunRow) {
    cell.total += 1;
    cell.runs.push(run);
    const status = (run.status || '').toLowerCase();
    if (status === 'completed') {
        if (run.isLate) cell.late += 1;
        else cell.onTime += 1;
    } else if (status === 'missed') {
        cell.missed += 1;
    } else {
        cell.pending += 1;
    }
}

/** Plain-words label for one run, reused by the tooltip and the CSV. */
function runLabel(run: RunRow): string {
    const status = (run.status || '').toLowerCase();
    if (status === 'completed') return run.isLate ? 'Done late' : 'Done';
    if (status === 'missed') return 'Missed';
    if (status === 'in_progress') return 'In progress';
    if (status === 'partial') return 'Partial';
    return 'Pending';
}

function cellTooltip(cell: Cell, label: string, date: string): string {
    const head = `${label} · ${prettyDate(date)}`;
    if (cell.total === 0) return `${head}\nNot scheduled`;
    const lines = cell.runs
        .slice()
        .sort((a, b) => (a.slotTime || '').localeCompare(b.slotTime || ''))
        .map(run => {
            const bits = [runLabel(run)];
            if (run.slotTime) bits.push(`slot ${run.slotTime}`);
            if (run.completedBy) bits.push(run.completedBy);
            return `• ${bits.join(' · ')}`;
        });
    return `${head}\n${lines.join('\n')}`;
}

/** Cell text for the CSV: "Done", "2 done, 1 missed", … */
function cellText(cell: Cell): string {
    if (cell.total === 0) return '';
    if (cell.total === 1) return runLabel(cell.runs[0]);
    const parts: string[] = [];
    if (cell.onTime) parts.push(`${cell.onTime} done`);
    if (cell.late) parts.push(`${cell.late} done late`);
    if (cell.missed) parts.push(`${cell.missed} missed`);
    if (cell.pending) parts.push(`${cell.pending} pending`);
    return parts.join(', ');
}

const ChecklistCompletionReport: React.FC<ChecklistCompletionReportProps> = ({
    propertyId,
    propertyIds,
    onViewRun,
}) => {
    const [rangeMode, setRangeMode] = useState<RangeMode>('last_7');
    const [customFrom, setCustomFrom] = useState(istDate(-6));
    const [customTo, setCustomTo] = useState(istDate());
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [data, setData] = useState<ReportPayload | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { from, to } = useMemo(
        () => rangeFor(rangeMode, customFrom, customTo),
        [rangeMode, customFrom, customTo]
    );

    const queryString = useMemo(() => {
        const params = new URLSearchParams({ from, to });
        if (propertyId) {
            params.set('propertyId', propertyId);
        } else if (propertyIds && propertyIds.length) {
            params.set('propertyIds', propertyIds.join(','));
        }
        return params.toString();
    }, [from, to, propertyId, propertyIds]);

    const fetchReport = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/sop/completion-report?${queryString}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error || 'Could not load the checklist report');
            setData(json as ReportPayload);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not load the checklist report');
            setData(null);
        } finally {
            setIsLoading(false);
        }
    }, [queryString]);

    useEffect(() => {
        fetchReport();
    }, [fetchReport]);

    const allDates = useMemo(() => datesInRange(from, to), [from, to]);
    const dates = useMemo(
        () => (allDates.length > MAX_COLUMNS ? allDates.slice(allDates.length - MAX_COLUMNS) : allDates),
        [allDates]
    );

    const query = searchQuery.trim().toLowerCase();

    /**
     * property → its checklists → per-date cells, plus a per-date property rollup.
     */
    const matrix = useMemo(() => {
        if (!data) return [];

        const visibleDates = new Set(dates);
        const properties = new Map<
            string,
            {
                propertyId: string;
                propertyName: string;
                byDate: Map<string, Cell>;
                total: Cell;
                templates: Map<
                    string,
                    {
                        templateId: string;
                        title: string;
                        frequency: string | null;
                        byDate: Map<string, Cell>;
                        total: Cell;
                    }
                >;
            }
        >();

        for (const run of data.rows) {
            if (!visibleDates.has(run.date)) continue;

            if (!properties.has(run.propertyId)) {
                properties.set(run.propertyId, {
                    propertyId: run.propertyId,
                    propertyName: run.propertyName,
                    byDate: new Map(),
                    total: emptyCell(),
                    templates: new Map(),
                });
            }
            const property = properties.get(run.propertyId)!;

            if (!property.byDate.has(run.date)) property.byDate.set(run.date, emptyCell());
            addRun(property.byDate.get(run.date)!, run);
            addRun(property.total, run);

            if (!property.templates.has(run.templateId)) {
                property.templates.set(run.templateId, {
                    templateId: run.templateId,
                    title: run.title,
                    frequency: run.frequency,
                    byDate: new Map(),
                    total: emptyCell(),
                });
            }
            const template = property.templates.get(run.templateId)!;
            if (!template.byDate.has(run.date)) template.byDate.set(run.date, emptyCell());
            addRun(template.byDate.get(run.date)!, run);
            addRun(template.total, run);
        }

        return [...properties.values()]
            .map(property => ({
                ...property,
                templateList: [...property.templates.values()].sort((a, b) => a.title.localeCompare(b.title)),
            }))
            .sort((a, b) => a.propertyName.localeCompare(b.propertyName))
            .map(property => {
                if (!query) return property;
                const propertyMatches = property.propertyName.toLowerCase().includes(query);
                return {
                    ...property,
                    templateList: propertyMatches
                        ? property.templateList
                        : property.templateList.filter(t => t.title.toLowerCase().includes(query)),
                };
            })
            .filter(property => property.templateList.length > 0);
    }, [data, dates, query]);

    const toggleProperty = (pid: string) => setCollapsed(prev => ({ ...prev, [pid]: !prev[pid] }));

    const handleExportCSV = () => {
        if (!data) return;
        const header = ['Property', 'Checklist', ...dates, 'Done', 'Done late', 'Missed', 'Pending', 'Completion %'];
        const lines: string[][] = [];

        matrix.forEach(property => {
            const rate =
                property.total.total > 0
                    ? Math.round(((property.total.onTime + property.total.late) / property.total.total) * 100)
                    : null;
            lines.push([
                property.propertyName,
                'ALL CHECKLISTS',
                ...dates.map(d => cellText(property.byDate.get(d) || emptyCell())),
                String(property.total.onTime),
                String(property.total.late),
                String(property.total.missed),
                String(property.total.pending),
                rate === null ? '' : String(rate),
            ]);
            property.templateList.forEach(template => {
                const tRate =
                    template.total.total > 0
                        ? Math.round(((template.total.onTime + template.total.late) / template.total.total) * 100)
                        : null;
                lines.push([
                    property.propertyName,
                    template.title,
                    ...dates.map(d => cellText(template.byDate.get(d) || emptyCell())),
                    String(template.total.onTime),
                    String(template.total.late),
                    String(template.total.missed),
                    String(template.total.pending),
                    tRate === null ? '' : String(tRate),
                ]);
            });
        });

        const csv = [header, ...lines]
            .map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
            .join('\r\n');
        const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `checklist-completion-${from}_to_${to}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const summary = data?.summary;
    const lateTotal = summary?.late ?? 0;

    return (
        <div className="space-y-3">
            {/* Controls */}
            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-2xs p-3 md:p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                            <ListChecks size={16} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-slate-900 tracking-tight">Checklist Completion Report</h3>
                            <p className="text-[11px] font-semibold text-slate-400">
                                {prettyDate(from)}
                                {from !== to && ` → ${prettyDate(to)}`}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={fetchReport}
                            title="Refresh"
                            className="w-8 h-8 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer"
                        >
                            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            type="button"
                            onClick={handleExportCSV}
                            disabled={!data || matrix.length === 0}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                            <Download size={12} />
                            CSV
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                        {(Object.keys(RANGE_LABELS) as RangeMode[]).map(mode => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => setRangeMode(mode)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer ${rangeMode === mode ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:text-slate-800'}`}
                            >
                                {RANGE_LABELS[mode]}
                            </button>
                        ))}
                    </div>

                    {rangeMode === 'custom' && (
                        <div className="flex items-center gap-1.5">
                            <input
                                type="date"
                                value={customFrom}
                                max={customTo}
                                onChange={e => setCustomFrom(e.target.value)}
                                className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <span className="text-[10px] font-black text-slate-400">TO</span>
                            <input
                                type="date"
                                value={customTo}
                                min={customFrom}
                                max={istDate()}
                                onChange={e => setCustomTo(e.target.value)}
                                className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                        </div>
                    )}

                    <div className="relative ml-auto">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search property or checklist…"
                            className="pl-7 pr-2.5 py-1.5 w-56 rounded-xl border border-slate-200 text-[11px] font-semibold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                    </div>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100">
                    <LegendItem tone="emerald" icon={<Check size={9} strokeWidth={3.5} />} label="Done" />
                    <LegendItem tone="amber" icon={<Clock size={9} strokeWidth={3} />} label="Done late" />
                    <LegendItem tone="rose" icon={<X size={9} strokeWidth={3.5} />} label="Missed" />
                    <LegendItem tone="slate" icon={<Minus size={9} strokeWidth={3.5} />} label="Pending" />
                    <span className="text-[10px] font-bold text-slate-400">· a cell with several runs shows counts</span>
                </div>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
                {[
                    { label: 'Checklists', value: summary?.total ?? 0, tone: 'text-slate-900', bg: 'bg-slate-100 text-slate-600', icon: ListChecks },
                    { label: 'Done', value: summary?.done ?? 0, tone: 'text-emerald-600', bg: 'bg-emerald-50 text-emerald-600', icon: CheckCircle2 },
                    { label: 'Done late', value: lateTotal, tone: 'text-amber-600', bg: 'bg-amber-50 text-amber-600', icon: Clock },
                    { label: 'Missed', value: summary?.missed ?? 0, tone: 'text-rose-600', bg: 'bg-rose-50 text-rose-600', icon: XCircle },
                    {
                        label: 'Completion',
                        value: !summary || summary.completionRate === null ? '—' : `${summary.completionRate}%`,
                        tone: 'text-slate-900',
                        bg: 'bg-primary/10 text-primary',
                        icon: Timer,
                    },
                ].map(card => (
                    <div key={card.label} className="bg-white border border-slate-200/80 rounded-2xl shadow-2xs p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{card.label}</span>
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${card.bg}`}>
                                <card.icon size={12} />
                            </span>
                        </div>
                        <div className={`mt-1.5 text-xl md:text-2xl font-black tracking-tight ${card.tone}`}>
                            {isLoading && !data ? '–' : card.value}
                        </div>
                    </div>
                ))}
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-2">
                    <AlertTriangle size={16} className="text-rose-600 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="text-xs font-black text-rose-800">{error}</p>
                        <button
                            type="button"
                            onClick={fetchReport}
                            className="mt-1 text-[11px] font-black text-rose-700 underline cursor-pointer"
                        >
                            Try again
                        </button>
                    </div>
                </div>
            )}

            {isLoading && !data && (
                <div className="space-y-2">
                    <Skeleton className="h-12 rounded-2xl" />
                    <Skeleton className="h-12 rounded-2xl" />
                    <Skeleton className="h-12 rounded-2xl" />
                </div>
            )}

            {allDates.length > MAX_COLUMNS && (
                <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    Showing the most recent {MAX_COLUMNS} days of this range as columns.
                </p>
            )}

            {data?.truncated && (
                <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    Showing the first 8,000 checklist runs for this range. Narrow the dates for a complete picture.
                </p>
            )}

            {!error && data && (
                matrix.length === 0 ? (
                    <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center">
                        <ListChecks size={28} className="mx-auto text-slate-300" />
                        <h4 className="mt-2 text-sm font-black text-slate-700">No checklist runs in this range</h4>
                        <p className="text-[11px] font-semibold text-slate-400 mt-1">
                            Pick another date range, or check that the checklist templates are active for these properties.
                        </p>
                    </div>
                ) : (
                    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-2xs overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="border-separate border-spacing-0">
                                <thead>
                                    <tr>
                                        <th className="sticky left-0 z-20 bg-slate-50 border-b border-r border-slate-200 px-3 py-2 text-left min-w-[220px] max-w-[320px]">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                                Property / Checklist
                                            </span>
                                        </th>
                                        {dates.map(date => {
                                            const { day, weekday } = dayLabel(date);
                                            const isToday = date === istDate();
                                            return (
                                                <th
                                                    key={date}
                                                    className={`border-b border-slate-200 px-1 py-1.5 min-w-[58px] ${isToday ? 'bg-primary/5' : 'bg-slate-50'}`}
                                                >
                                                    <div className="flex flex-col items-center leading-none gap-0.5">
                                                        <span className={`text-[10px] font-black ${isToday ? 'text-primary' : 'text-slate-700'}`}>
                                                            {day}
                                                        </span>
                                                        <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">
                                                            {weekday}
                                                        </span>
                                                    </div>
                                                </th>
                                            );
                                        })}
                                        <th className="border-b border-l border-slate-200 bg-slate-50 px-2 py-2 min-w-[86px]">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Range</span>
                                        </th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {matrix.map(property => {
                                        const isCollapsed = !!collapsed[property.propertyId];
                                        const propertyDone = property.total.onTime + property.total.late;
                                        const propertyRate =
                                            property.total.total > 0
                                                ? Math.round((propertyDone / property.total.total) * 100)
                                                : null;

                                        return (
                                            <React.Fragment key={property.propertyId}>
                                                {/* Property row */}
                                                <tr
                                                    onClick={() => toggleProperty(property.propertyId)}
                                                    className="cursor-pointer group"
                                                >
                                                    <td className="sticky left-0 z-10 bg-slate-100/90 group-hover:bg-slate-200/80 border-b border-r border-slate-200 px-3 py-2 transition-colors">
                                                        <div className="flex items-center gap-1.5">
                                                            <ChevronRight
                                                                size={13}
                                                                className={`text-slate-400 transition-transform flex-shrink-0 ${isCollapsed ? '' : 'rotate-90'}`}
                                                            />
                                                            <Building2 size={12} className="text-slate-400 flex-shrink-0" />
                                                            <span className="text-xs font-black text-slate-900 truncate">
                                                                {property.propertyName}
                                                            </span>
                                                            <span className="text-[9px] font-black text-slate-400 flex-shrink-0">
                                                                {property.templateList.length}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    {dates.map(date => {
                                                        const cell = property.byDate.get(date) || emptyCell();
                                                        const done = cell.onTime + cell.late;
                                                        const rate = cell.total > 0 ? Math.round((done / cell.total) * 100) : null;
                                                        return (
                                                            <td
                                                                key={date}
                                                                title={cellTooltip(cell, property.propertyName, date)}
                                                                className="border-b border-slate-200 bg-slate-100/60 px-1 py-1.5 text-center"
                                                            >
                                                                {cell.total === 0 ? (
                                                                    <span className="text-[10px] font-bold text-slate-300">·</span>
                                                                ) : (
                                                                    <span
                                                                        className={`inline-block px-1 py-0.5 rounded-md border text-[9px] font-black ${rateTone(rate)}`}
                                                                    >
                                                                        {done}/{cell.total}
                                                                    </span>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="border-b border-l border-slate-200 bg-slate-100/60 px-2 py-1.5 text-center">
                                                        <span className={`inline-block px-1.5 py-0.5 rounded-md border text-[10px] font-black ${rateTone(propertyRate)}`}>
                                                            {propertyRate === null ? '—' : `${propertyRate}%`}
                                                        </span>
                                                    </td>
                                                </tr>

                                                {/* Checklist rows */}
                                                {!isCollapsed &&
                                                    property.templateList.map(template => {
                                                        const done = template.total.onTime + template.total.late;
                                                        const rate =
                                                            template.total.total > 0
                                                                ? Math.round((done / template.total.total) * 100)
                                                                : null;
                                                        return (
                                                            <tr key={template.templateId} className="group">
                                                                <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-b border-r border-slate-200 px-3 py-1.5 transition-colors">
                                                                    <div className="flex items-center gap-1.5 pl-5">
                                                                        <span className="text-[11px] font-bold text-slate-700 truncate" title={template.title}>
                                                                            {template.title}
                                                                        </span>
                                                                        {template.frequency && (
                                                                            <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 bg-slate-100 border border-slate-200 rounded px-1 py-0.5 flex-shrink-0">
                                                                                {template.frequency.replace(/_/g, ' ')}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                {dates.map(date => {
                                                                    const cell = template.byDate.get(date) || emptyCell();
                                                                    const single = cell.total === 1 ? cell.runs[0] : null;
                                                                    return (
                                                                        <td
                                                                            key={date}
                                                                            title={cellTooltip(cell, template.title, date)}
                                                                            onClick={
                                                                                single && onViewRun
                                                                                    ? () =>
                                                                                        onViewRun(
                                                                                            single.id,
                                                                                            single.templateId,
                                                                                            single.propertyId
                                                                                        )
                                                                                    : undefined
                                                                            }
                                                                            className={`border-b border-slate-200 px-1 py-1 text-center ${single && onViewRun ? 'cursor-pointer' : ''} ${date === istDate() ? 'bg-primary/5' : ''}`}
                                                                        >
                                                                            <CellView cell={cell} />
                                                                        </td>
                                                                    );
                                                                })}
                                                                <td className="border-b border-l border-slate-200 px-2 py-1 text-center">
                                                                    <span className={`inline-block px-1.5 py-0.5 rounded-md border text-[10px] font-black ${rateTone(rate)}`}>
                                                                        {rate === null ? '—' : `${rate}%`}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            )}
        </div>
    );
};

const TONES = {
    emerald: 'bg-emerald-500 text-white border-emerald-600',
    amber: 'bg-amber-400 text-white border-amber-500',
    rose: 'bg-rose-500 text-white border-rose-600',
    slate: 'bg-slate-200 text-slate-500 border-slate-300',
} as const;

const LegendItem: React.FC<{ tone: keyof typeof TONES; icon: React.ReactNode; label: string }> = ({
    tone,
    icon,
    label,
}) => (
    <span className="flex items-center gap-1">
        <span className={`w-4 h-4 rounded-md border flex items-center justify-center ${TONES[tone]}`}>{icon}</span>
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</span>
    </span>
);

/** One date's result for one checklist: a single marker, or counts when the day had several runs. */
const CellView: React.FC<{ cell: Cell }> = ({ cell }) => {
    if (cell.total === 0) {
        return <span className="text-[10px] font-bold text-slate-200">·</span>;
    }

    if (cell.total === 1) {
        const run = cell.runs[0];
        const status = (run.status || '').toLowerCase();
        if (status === 'completed') {
            return run.isLate ? (
                <Marker tone="amber" icon={<Clock size={10} strokeWidth={3} />} />
            ) : (
                <Marker tone="emerald" icon={<Check size={11} strokeWidth={3.5} />} />
            );
        }
        if (status === 'missed') {
            return <Marker tone="rose" icon={<X size={11} strokeWidth={3.5} />} />;
        }
        return <Marker tone="slate" icon={<Minus size={11} strokeWidth={3.5} />} />;
    }

    return (
        <div className="flex items-center justify-center gap-0.5 flex-wrap">
            {cell.onTime > 0 && <CountChip tone="emerald" value={cell.onTime} />}
            {cell.late > 0 && <CountChip tone="amber" value={cell.late} />}
            {cell.missed > 0 && <CountChip tone="rose" value={cell.missed} />}
            {cell.pending > 0 && <CountChip tone="slate" value={cell.pending} />}
        </div>
    );
};

const Marker: React.FC<{ tone: keyof typeof TONES; icon: React.ReactNode }> = ({ tone, icon }) => (
    <span className={`inline-flex w-5 h-5 rounded-md border items-center justify-center ${TONES[tone]}`}>{icon}</span>
);

const CountChip: React.FC<{ tone: keyof typeof TONES; value: number }> = ({ tone, value }) => (
    <span className={`inline-flex min-w-[15px] h-4 px-0.5 rounded border items-center justify-center text-[9px] font-black ${TONES[tone]}`}>
        {value}
    </span>
);

export default ChecklistCompletionReport;
