'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
    Building2, Users, Activity, Wifi, Clock, Gauge, Ticket, ClipboardCheck,
    AlertTriangle, Search, Loader2, RefreshCw, ChevronDown, Zap, Droplets,
    Flame, ShieldAlert, TrendingUp, Download, Trophy,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    PieChart, Pie, Cell, AreaChart, Area, RadialBarChart, RadialBar,
} from 'recharts';

type Period = 'today' | '7d' | '30d' | 'all';

interface UsageData {
    generated_at: string;
    period: Period;
    property_id: string | null;
    scope_label: string;
    properties: { id: string; name: string; code: string | null }[];
    global: {
        total_properties: number;
        total_users: number;
        active_users_7d: number;
        online_now: number;
        avg_session_duration_minutes: number;
        total_sessions_logged: number;
        module_usage_pct: number;
        active_modules: number;
        total_modules: number;
    };
    modules: { key: string; label: string; active: boolean; count: number }[];
    perProperty: {
        property_id: string; name: string; code: string | null; user_count: number;
        online_now: number; tickets_total: number; tickets_open: number; tickets_resolved: number;
        sop_completed: number; sop_missed: number; sop_compliance_pct: number; activity_score: number;
    }[];
    leaderboards: {
        properties_by_activity: { property_id: string; name: string; code: string | null; score: number; user_count: number; tickets_total: number; sop_compliance_pct: number }[];
        properties_by_compliance: { property_id: string; name: string; code: string | null; sop_compliance_pct: number; sop_completed: number; sop_missed: number }[];
        top_users: { user_id: string; full_name: string; email: string; total_sessions: number; sessions_this_week: number; avg_duration_minutes: number; online: boolean }[];
    };
    users: {
        user_id: string; full_name: string; email: string; sessions_this_week: number;
        avg_duration_minutes: number; total_sessions: number; last_active: string | null; online: boolean;
    }[];
    tickets: { total: number; open: number; in_progress: number; resolved: number; pending_validation: number };
    violations: { sla_breached: number; missed_checklists: number; escalations: number };
    sop: { completed: number; missed: number; pending: number; in_progress: number; completed_late: number; compliance_pct: number };
    loggers: Record<'electricity' | 'diesel' | 'water', { count: number; last: string | null; coverage_pct: number }>;
    sessionsTrend: { date: string; sessions: number }[];
}

const PERIODS: { id: Period; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 Days' },
    { id: '30d', label: '30 Days' },
    { id: 'all', label: 'All Time' },
];

const TICKET_COLORS = ['#3B82F6', '#F59E0B', '#10B981', '#8B5CF6'];
const fmtDuration = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
const fmtNum = (n: number) => n.toLocaleString();
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '—');

const RankBadge = ({ rank }: { rank: number }) => {
    const styles: Record<number, string> = {
        1: 'bg-amber-100 text-amber-700 border-amber-300',
        2: 'bg-slate-100 text-slate-600 border-slate-300',
        3: 'bg-orange-100 text-orange-700 border-orange-300',
    };
    const cls = styles[rank] || 'bg-surface-elevated text-text-tertiary border-border';
    return (
        <span className={`w-7 h-7 shrink-0 rounded-lg border flex items-center justify-center text-xs font-black tabular-nums ${cls}`}>
            {rank}
        </span>
    );
};

const UsageDashboardTab = () => {
    const [data, setData] = useState<UsageData | null>(null);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<Period>('30d');
    const [propertyId, setPropertyId] = useState<string | null>(null);
    const [propOpen, setPropOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [propList, setPropList] = useState<{ id: string; name: string; code: string | null }[]>([]);
    const [exporting, setExporting] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const qs = new URLSearchParams({ period });
            if (propertyId) qs.set('propertyId', propertyId);
            const res = await fetch(`/api/admin/usage-dashboard?${qs.toString()}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('fetch failed');
            const json: UsageData = await res.json();
            setData(json);
            // Cache the full property list once (only when unscoped — a scoped response
            // only contains the single selected property). Functional update so this
            // isn't a fetchData dependency (avoids a redundant double-fetch on mount).
            if (json.properties?.length && !propertyId) {
                setPropList((prev) => (prev.length === 0 ? json.properties : prev));
            }
        } catch (e) {
            console.error('[UsageDashboard] error:', e);
        } finally {
            setLoading(false);
        }
    }, [period, propertyId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Export the current view to a multi-sheet .xlsx (SheetJS is already a dependency).
    const handleExport = useCallback(async () => {
        if (!data) return;
        setExporting(true);
        try {
            const XLSX = await import('xlsx');
            const wb = XLSX.utils.book_new();
            const add = (name: string, rows: any[]) =>
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name.slice(0, 31));

            add('Summary', [
                { Metric: 'Scope', Value: data.scope_label },
                { Metric: 'Period', Value: data.period },
                { Metric: 'Generated', Value: new Date(data.generated_at).toLocaleString() },
                { Metric: 'Properties', Value: data.global.total_properties },
                { Metric: 'Total Users', Value: data.global.total_users },
                { Metric: 'Active Users (7d)', Value: data.global.active_users_7d },
                { Metric: 'Online Now', Value: data.global.online_now },
                { Metric: 'Avg Session (min)', Value: data.global.avg_session_duration_minutes },
                { Metric: 'Module Usage %', Value: data.global.module_usage_pct },
                { Metric: 'Tickets (total)', Value: data.tickets.total },
                { Metric: 'SLA Breached', Value: data.violations.sla_breached },
                { Metric: 'Missed Checklists', Value: data.violations.missed_checklists },
                { Metric: 'Escalations', Value: data.violations.escalations },
                { Metric: 'Checklist Compliance %', Value: data.sop.compliance_pct },
            ]);
            add('Per-Property', data.perProperty.map((p) => ({
                Property: p.name, Code: p.code, Users: p.user_count, Online: p.online_now,
                'Tickets Total': p.tickets_total, 'Tickets Open': p.tickets_open, 'Tickets Resolved': p.tickets_resolved,
                'Checklists Filled': p.sop_completed, 'Checklists Missed': p.sop_missed, 'Compliance %': p.sop_compliance_pct,
                'Activity Score': p.activity_score,
            })));
            add('Leaderboard-Activity', data.leaderboards.properties_by_activity.map((p, i) => ({
                Rank: i + 1, Property: p.name, Code: p.code, Score: p.score, Users: p.user_count, Tickets: p.tickets_total, 'Compliance %': p.sop_compliance_pct,
            })));
            add('Leaderboard-Users', data.leaderboards.top_users.map((u, i) => ({
                Rank: i + 1, Name: u.full_name, Email: u.email, 'Total Sessions': u.total_sessions, 'Sessions (wk)': u.sessions_this_week, 'Avg (min)': u.avg_duration_minutes, Online: u.online ? 'Yes' : 'No',
            })));
            add('Modules', data.modules.map((m) => ({ Module: m.label, Active: m.active ? 'Yes' : 'No', Records: m.count })));
            add('Users', data.users.map((u) => ({
                Name: u.full_name, Email: u.email, Online: u.online ? 'Yes' : 'No',
                'Sessions (wk)': u.sessions_this_week, 'Total Sessions': u.total_sessions,
                'Avg (min)': u.avg_duration_minutes, 'Last Active': fmtDate(u.last_active),
            })));
            add('Loggers', (['electricity', 'diesel', 'water'] as const).map((k) => ({
                Utility: k, Readings: data.loggers[k].count, 'Last Reading': fmtDate(data.loggers[k].last), 'Coverage %': data.loggers[k].coverage_pct,
            })));

            const scope = data.scope_label.replace(/[^a-z0-9]+/gi, '_');
            XLSX.writeFile(wb, `Usage_${scope}_${data.period}_${new Date().toISOString().split('T')[0]}.xlsx`);
        } catch (e) {
            console.error('[UsageDashboard] export error:', e);
        } finally {
            setExporting(false);
        }
    }, [data]);

    const options = propList.length ? propList : (data?.properties || []);
    const selectedName = propertyId ? (options.find((p) => p.id === propertyId)?.name || 'Property') : 'All Properties';

    if (loading && !data) {
        return (
            <div className="h-96 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <p className="text-text-tertiary font-bold animate-pulse">Aggregating platform usage…</p>
            </div>
        );
    }

    const g = data?.global;
    const modules = data?.modules || [];
    const usagePct = g?.module_usage_pct || 0;

    const ticketPie = [
        { name: 'Open', value: data?.tickets.open || 0 },
        { name: 'In Progress', value: data?.tickets.in_progress || 0 },
        { name: 'Resolved', value: data?.tickets.resolved || 0 },
        { name: 'Pending Val.', value: data?.tickets.pending_validation || 0 },
    ].filter((d) => d.value > 0);

    const filteredUsers = (data?.users || []).filter((u) =>
        u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase())
    );

    const kpis = [
        { label: 'Properties', value: fmtNum(g?.total_properties || 0), icon: Building2, tint: 'bg-violet-50 text-violet-600' },
        { label: 'Total Users', value: fmtNum(g?.total_users || 0), icon: Users, tint: 'bg-blue-50 text-blue-600' },
        { label: 'Active (7d)', value: fmtNum(g?.active_users_7d || 0), icon: Activity, tint: 'bg-emerald-50 text-emerald-600' },
        { label: 'Online Now', value: fmtNum(g?.online_now || 0), icon: Wifi, tint: 'bg-teal-50 text-teal-600', live: true },
        { label: 'Avg Session', value: fmtDuration(g?.avg_session_duration_minutes || 0), icon: Clock, tint: 'bg-amber-50 text-amber-600' },
        { label: 'Module Usage', value: `${usagePct}%`, icon: Gauge, tint: 'bg-rose-50 text-rose-600', sub: `${g?.active_modules || 0}/${g?.total_modules || 0} active` },
    ];

    // Static class strings (Tailwind JIT can't see dynamically-built class names).
    const violationTiles = [
        { label: 'SLA Breached', value: data?.violations.sla_breached || 0, icon: ShieldAlert, box: 'bg-rose-50 border-rose-200', num: 'text-rose-600', cap: 'text-rose-700', ico: 'text-rose-400' },
        { label: 'Missed Checklists', value: data?.violations.missed_checklists || 0, icon: ClipboardCheck, box: 'bg-amber-50 border-amber-200', num: 'text-amber-600', cap: 'text-amber-700', ico: 'text-amber-400' },
        { label: 'Escalations', value: data?.violations.escalations || 0, icon: AlertTriangle, box: 'bg-orange-50 border-orange-200', num: 'text-orange-600', cap: 'text-orange-700', ico: 'text-orange-400' },
    ];

    const loggerRows = [
        { key: 'Electricity', icon: Zap, color: 'text-amber-500', d: data?.loggers.electricity },
        { key: 'Diesel / DG', icon: Flame, color: 'text-orange-500', d: data?.loggers.diesel },
        { key: 'Water', icon: Droplets, color: 'text-sky-500', d: data?.loggers.water },
    ];

    return (
        <div className="space-y-8 w-full min-w-0">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-text-primary tracking-tight flex items-center gap-2">
                        <Gauge className="w-6 h-6 text-primary" /> Usage Overview
                    </h2>
                    <p className="text-text-tertiary text-sm font-medium mt-1">
                        Consolidated platform usage · <span className="font-bold text-text-secondary">{selectedName}</span> ·
                        {' '}updated {data ? new Date(data.generated_at).toLocaleTimeString() : '—'}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Property dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setPropOpen((o) => !o)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-surface border border-border rounded-xl text-sm font-bold text-text-primary hover:border-primary transition-colors min-w-[180px] justify-between"
                        >
                            <span className="flex items-center gap-2 truncate"><Building2 className="w-4 h-4 text-text-tertiary shrink-0" />{selectedName}</span>
                            <ChevronDown className={`w-4 h-4 text-text-tertiary transition-transform ${propOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {propOpen && (
                            <div className="absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto bg-surface border border-border rounded-xl shadow-xl z-50 p-1.5 custom-scrollbar">
                                <button
                                    onClick={() => { setPropertyId(null); setPropOpen(false); }}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold ${!propertyId ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-muted'}`}
                                >All Properties</button>
                                {options.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => { setPropertyId(p.id); setPropOpen(false); }}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-between gap-2 ${propertyId === p.id ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-muted'}`}
                                    >
                                        <span className="truncate">{p.name}</span>
                                        {p.code && <span className="text-[10px] font-bold text-text-tertiary shrink-0">{p.code}</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Period toggle */}
                    <div className="flex items-center gap-1 bg-surface-elevated rounded-full p-1 border border-border">
                        {PERIODS.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setPeriod(p.id)}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${period === p.id ? 'bg-primary text-text-inverse shadow-sm' : 'text-text-tertiary hover:text-text-primary'}`}
                            >{p.label}</button>
                        ))}
                    </div>

                    <button
                        onClick={handleExport}
                        disabled={!data || exporting}
                        className="flex items-center gap-2 px-4 py-2.5 bg-primary text-text-inverse rounded-xl text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                        title="Export to Excel"
                    >
                        {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        Export
                    </button>

                    <button
                        onClick={fetchData}
                        className="p-2.5 bg-surface border border-border rounded-xl text-text-tertiary hover:text-primary hover:border-primary transition-colors"
                        title="Refresh"
                    ><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
                </div>
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                {kpis.map((k, i) => (
                    <motion.div
                        key={k.label}
                        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                        className="bg-surface border border-border rounded-2xl p-5 hover:border-primary/40 transition-colors"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.tint}`}><k.icon className="w-5 h-5" /></div>
                            {k.live && (g?.online_now ?? 0) > 0 && (
                                <span className="flex items-center gap-1 text-[10px] font-black text-emerald-500 uppercase tracking-widest">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live
                                </span>
                            )}
                        </div>
                        <p className="text-3xl font-black text-text-primary tracking-tight tabular-nums">{k.value}</p>
                        <p className="text-[10px] font-black text-text-tertiary uppercase tracking-widest mt-1">{k.label}</p>
                        {k.sub && <p className="text-[10px] font-semibold text-text-tertiary mt-0.5">{k.sub}</p>}
                    </motion.div>
                ))}
            </div>

            {/* Module usage + Tickets donut */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Module usage bar */}
                <div className="lg:col-span-8 bg-surface border border-border rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-base font-black text-text-primary">Module Activity</h3>
                            <p className="text-xs text-text-tertiary font-medium">Records created per module in window · activity-based usage signal</p>
                        </div>
                        <div className="text-right">
                            <span className="text-2xl font-black text-primary tabular-nums">{usagePct}%</span>
                            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest">modules active</p>
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={modules} margin={{ top: 4, right: 8, left: 4, bottom: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                            <XAxis dataKey="label" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} interval={0} angle={-25} textAnchor="end" height={68}
                                label={{ value: 'Module', position: 'insideBottom', offset: -8, fontSize: 11, fontWeight: 700, fill: '#64748B' }} />
                            <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={11} allowDecimals={false}
                                label={{ value: 'Records created', angle: -90, position: 'insideLeft', fontSize: 11, fontWeight: 700, fill: '#64748B', style: { textAnchor: 'middle' } }} />
                            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} cursor={{ fill: 'rgba(112,143,150,0.06)' }} />
                            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                                {modules.map((m) => (
                                    <Cell key={m.key} fill={m.active ? 'var(--primary)' : '#CBD5E1'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Tickets donut */}
                <div className="lg:col-span-4 bg-surface border border-border rounded-2xl p-6 flex flex-col">
                    <div className="flex items-center gap-2 mb-2">
                        <Ticket className="w-4 h-4 text-primary" />
                        <h3 className="text-base font-black text-text-primary">Tickets</h3>
                        <span className="ml-auto text-2xl font-black text-text-primary tabular-nums">{fmtNum(data?.tickets.total || 0)}</span>
                    </div>
                    {ticketPie.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm font-medium italic">No tickets in window</div>
                    ) : (
                        <>
                            <ResponsiveContainer width="100%" height={180}>
                                <PieChart>
                                    <Pie data={ticketPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2}>
                                        {ticketPie.map((_, i) => <Cell key={i} fill={TICKET_COLORS[i % TICKET_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                {ticketPie.map((t, i) => (
                                    <div key={t.name} className="flex items-center gap-2 text-xs">
                                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: TICKET_COLORS[i % TICKET_COLORS.length] }} />
                                        <span className="text-text-secondary font-semibold">{t.name}</span>
                                        <span className="ml-auto font-black text-text-primary tabular-nums">{t.value}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Violations */}
            <div>
                <h3 className="text-sm font-black text-text-tertiary uppercase tracking-widest mb-3">Violations & Risk</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {violationTiles.map((v) => (
                        <div key={v.label} className={`rounded-2xl p-5 border ${v.box}`}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className={`text-3xl font-black tabular-nums ${v.num}`}>{fmtNum(v.value)}</p>
                                    <p className={`text-[11px] font-black uppercase tracking-widest mt-1 ${v.cap}`}>{v.label}</p>
                                </div>
                                <v.icon className={`w-9 h-9 ${v.ico}`} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Leaderboards */}
            <div>
                <h3 className="text-sm font-black text-text-tertiary uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-500" /> Leaderboards
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Top properties by activity */}
                    <div className="bg-surface border border-border rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <TrendingUp className="w-4 h-4 text-primary" />
                            <h4 className="font-black text-text-primary text-sm">Most Active Properties</h4>
                        </div>
                        <div className="space-y-1.5">
                            {(data?.leaderboards?.properties_by_activity || []).length === 0 ? (
                                <p className="text-text-tertiary text-xs italic py-4 text-center">No data</p>
                            ) : (data?.leaderboards?.properties_by_activity || []).map((p, i) => (
                                <div key={p.property_id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/40 transition-colors">
                                    <RankBadge rank={i + 1} />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-text-primary text-sm truncate">{p.name}</div>
                                        <div className="text-[11px] text-text-tertiary font-semibold">{p.user_count} users · {p.tickets_total} tickets · {p.sop_compliance_pct}% compliance</div>
                                    </div>
                                    <span className="font-black text-primary tabular-nums text-sm">{fmtNum(p.score)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Best compliance */}
                    <div className="bg-surface border border-border rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <ClipboardCheck className="w-4 h-4 text-emerald-600" />
                            <h4 className="font-black text-text-primary text-sm">Best Checklist Compliance</h4>
                        </div>
                        <div className="space-y-1.5">
                            {(data?.leaderboards?.properties_by_compliance || []).length === 0 ? (
                                <p className="text-text-tertiary text-xs italic py-4 text-center">No checklist data</p>
                            ) : (data?.leaderboards?.properties_by_compliance || []).map((p, i) => (
                                <div key={p.property_id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/40 transition-colors">
                                    <RankBadge rank={i + 1} />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-text-primary text-sm truncate">{p.name}</div>
                                        <div className="text-[11px] text-text-tertiary font-semibold">{p.sop_completed} filled · {p.sop_missed} missed</div>
                                    </div>
                                    <span className="font-black text-emerald-600 tabular-nums text-sm">{p.sop_compliance_pct}%</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Top users */}
                    <div className="bg-surface border border-border rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <Users className="w-4 h-4 text-blue-600" />
                            <h4 className="font-black text-text-primary text-sm">Top Active Users</h4>
                        </div>
                        <div className="space-y-1.5">
                            {(data?.leaderboards?.top_users || []).length === 0 ? (
                                <p className="text-text-tertiary text-xs italic py-4 text-center">No session data</p>
                            ) : (data?.leaderboards?.top_users || []).map((u, i) => (
                                <div key={u.user_id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/40 transition-colors">
                                    <RankBadge rank={i + 1} />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-text-primary text-sm truncate flex items-center gap-1.5">
                                            {u.full_name || 'System User'}
                                            {u.online && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
                                        </div>
                                        <div className="text-[11px] text-text-tertiary font-semibold truncate">{u.sessions_this_week}/wk · {fmtDuration(u.avg_duration_minutes)} avg</div>
                                    </div>
                                    <span className="font-black text-blue-600 tabular-nums text-sm">{fmtNum(u.total_sessions)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Checklists + Sessions trend */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Checklists stacked bar per property */}
                <div className="lg:col-span-7 bg-surface border border-border rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <ClipboardCheck className="w-4 h-4 text-primary" />
                            <h3 className="text-base font-black text-text-primary">Checklists — Filled vs Missed</h3>
                        </div>
                        <span className="text-sm font-black text-emerald-600 tabular-nums">{data?.sop.compliance_pct || 0}% compliance</span>
                    </div>
                    {(data?.perProperty || []).length === 0 ? (
                        <div className="h-[240px] flex items-center justify-center text-text-tertiary text-sm italic">No checklist data</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={260}>
                            <BarChart data={(data?.perProperty || []).slice(0, 12)} margin={{ top: 4, right: 8, left: 4, bottom: 16 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                                <XAxis dataKey="code" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} interval={0} angle={-20} textAnchor="end" height={58}
                                    label={{ value: 'Property', position: 'insideBottom', offset: -8, fontSize: 11, fontWeight: 700, fill: '#64748B' }} />
                                <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={11} allowDecimals={false}
                                    label={{ value: 'Checklists', angle: -90, position: 'insideLeft', fontSize: 11, fontWeight: 700, fill: '#64748B', style: { textAnchor: 'middle' } }} />
                                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} cursor={{ fill: 'rgba(112,143,150,0.06)' }} />
                                <Bar dataKey="sop_completed" stackId="a" name="Filled" fill="#10B981" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="sop_missed" stackId="a" name="Missed" fill="#EF4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                    <div className="flex items-center gap-4 mt-3 text-xs font-semibold">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Filled ({data?.sop.completed || 0})</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" />Missed ({data?.sop.missed || 0})</span>
                        <span className="flex items-center gap-1.5 text-text-tertiary">Late: {data?.sop.completed_late || 0}</span>
                        <span className="flex items-center gap-1.5 text-text-tertiary">Pending: {data?.sop.pending || 0}</span>
                    </div>
                </div>

                {/* Sessions trend + module usage radial */}
                <div className="lg:col-span-5 space-y-6">
                    <div className="bg-surface border border-border rounded-2xl p-6">
                        <div className="flex items-center gap-2 mb-3">
                            <TrendingUp className="w-4 h-4 text-primary" />
                            <h3 className="text-base font-black text-text-primary">Activity Trend</h3>
                            <span className="ml-auto text-xs text-text-tertiary font-semibold">last 14 days · sessions</span>
                        </div>
                        <ResponsiveContainer width="100%" height={150}>
                            <AreaChart data={data?.sessionsTrend || []} margin={{ top: 4, right: 8, left: 4, bottom: 14 }}>
                                <defs>
                                    <linearGradient id="sessGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                                <XAxis dataKey="date" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={9} height={34}
                                    tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} interval={3}
                                    label={{ value: 'Date', position: 'insideBottom', offset: -6, fontSize: 10, fontWeight: 700, fill: '#64748B' }} />
                                <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} allowDecimals={false}
                                    label={{ value: 'Sessions', angle: -90, position: 'insideLeft', fontSize: 10, fontWeight: 700, fill: '#64748B', style: { textAnchor: 'middle' } }} />
                                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} />
                                <Area type="monotone" dataKey="sessions" stroke="var(--primary)" strokeWidth={2} fill="url(#sessGrad)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="bg-surface border border-border rounded-2xl p-6 flex items-center gap-4">
                        <ResponsiveContainer width="50%" height={130}>
                            <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ name: 'usage', value: usagePct, fill: 'var(--primary)' }]} startAngle={90} endAngle={90 - (usagePct / 100) * 360}>
                                <RadialBar background dataKey="value" cornerRadius={8} />
                            </RadialBarChart>
                        </ResponsiveContainer>
                        <div className="flex-1">
                            <p className="text-4xl font-black text-text-primary tabular-nums">{usagePct}%</p>
                            <p className="text-[11px] font-black text-text-tertiary uppercase tracking-widest">Module Usage</p>
                            <p className="text-xs text-text-secondary font-medium mt-1">{g?.active_modules || 0} of {g?.total_modules || 0} modules active this period</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Per-property table */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                    <h3 className="text-base font-black text-text-primary flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />Per-Property Breakdown</h3>
                    <span className="text-xs text-text-tertiary font-semibold">{data?.perProperty.length || 0} properties</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-surface-elevated text-text-tertiary">
                                <th className="text-left font-black text-[10px] uppercase tracking-widest px-6 py-3">Property</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Users</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Online</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Tickets</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Open</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Checklist ✓</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Missed</th>
                                <th className="text-right font-black text-[10px] uppercase tracking-widest px-6 py-3">Compliance</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {(data?.perProperty || []).length === 0 ? (
                                <tr><td colSpan={8} className="px-6 py-10 text-center text-text-tertiary italic">No property data.</td></tr>
                            ) : (data?.perProperty || []).map((p) => (
                                <tr key={p.property_id} className="hover:bg-muted/40 transition-colors">
                                    <td className="px-6 py-3">
                                        <div className="font-bold text-text-primary">{p.name}</div>
                                        {p.code && <div className="text-[11px] text-text-tertiary font-semibold">{p.code}</div>}
                                    </td>
                                    <td className="px-3 py-3 text-center font-black tabular-nums text-text-primary">{p.user_count}</td>
                                    <td className="px-3 py-3 text-center font-bold tabular-nums">
                                        {p.online_now > 0 ? <span className="text-emerald-600">{p.online_now}</span> : <span className="text-text-tertiary">0</span>}
                                    </td>
                                    <td className="px-3 py-3 text-center font-bold tabular-nums text-text-secondary">{p.tickets_total}</td>
                                    <td className="px-3 py-3 text-center font-bold tabular-nums text-amber-600">{p.tickets_open}</td>
                                    <td className="px-3 py-3 text-center font-bold tabular-nums text-emerald-600">{p.sop_completed}</td>
                                    <td className="px-3 py-3 text-center font-bold tabular-nums text-rose-600">{p.sop_missed}</td>
                                    <td className="px-6 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                                                <div className="h-full rounded-full" style={{ width: `${p.sop_compliance_pct}%`, background: p.sop_compliance_pct >= 80 ? '#10B981' : p.sop_compliance_pct >= 50 ? '#F59E0B' : '#EF4444' }} />
                                            </div>
                                            <span className="font-black tabular-nums text-text-primary w-10 text-right">{p.sop_compliance_pct}%</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Loggers coverage */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {loggerRows.map((r) => (
                    <div key={r.key} className="bg-surface border border-border rounded-2xl p-5">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <r.icon className={`w-5 h-5 ${r.color}`} />
                                <h3 className="font-black text-text-primary">{r.key}</h3>
                            </div>
                            <span className="text-2xl font-black text-text-primary tabular-nums">{fmtNum(r.d?.count || 0)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-text-tertiary font-semibold mb-2">
                            <span>Last reading: {fmtDate(r.d?.last || null)}</span>
                            <span>{r.d?.coverage_pct || 0}% coverage</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${r.d?.coverage_pct || 0}%`, background: (r.d?.coverage_pct || 0) >= 80 ? '#10B981' : (r.d?.coverage_pct || 0) >= 50 ? '#F59E0B' : '#EF4444' }} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Power users table */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
                    <h3 className="text-base font-black text-text-primary flex items-center gap-2"><Users className="w-4 h-4 text-primary" />User Uptime & Engagement</h3>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                        <input
                            type="text" placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-surface-elevated border border-border rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 w-56"
                        />
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-surface-elevated text-text-tertiary">
                                <th className="text-left font-black text-[10px] uppercase tracking-widest px-6 py-3">User</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Status</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Sessions (wk)</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Total</th>
                                <th className="text-center font-black text-[10px] uppercase tracking-widest px-3 py-3">Avg Time</th>
                                <th className="text-right font-black text-[10px] uppercase tracking-widest px-6 py-3">Last Active</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredUsers.length === 0 ? (
                                <tr><td colSpan={6} className="px-6 py-10 text-center text-text-tertiary italic">No usage data for this selection.</td></tr>
                            ) : filteredUsers.slice(0, 100).map((u) => (
                                <tr key={u.user_id} className="hover:bg-muted/40 transition-colors">
                                    <td className="px-6 py-3">
                                        <div className="font-bold text-text-primary leading-tight">{u.full_name || 'System User'}</div>
                                        <div className="text-[11px] text-text-tertiary font-medium">{u.email}</div>
                                    </td>
                                    <td className="px-3 py-3 text-center">
                                        {u.online ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Online</span>
                                        ) : (
                                            <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Offline</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-3 text-center font-black tabular-nums text-text-primary">{u.sessions_this_week}</td>
                                    <td className="px-3 py-3 text-center font-bold tabular-nums text-text-secondary">{u.total_sessions}</td>
                                    <td className="px-3 py-3 text-center font-bold tabular-nums text-text-secondary">{fmtDuration(u.avg_duration_minutes)}</td>
                                    <td className="px-6 py-3 text-right font-semibold text-text-tertiary text-xs">{fmtDate(u.last_active)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default UsageDashboardTab;
