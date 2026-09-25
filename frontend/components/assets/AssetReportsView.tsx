'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { Loader2, ShieldAlert, CalendarClock, IndianRupee, Wrench, Ticket } from 'lucide-react';
import { GRADE_META } from '@/backend/lib/assets/performance';
import { inr } from '@/frontend/lib/assets/roles';

interface Props {
    organizationId: string;
    propertyId?: string;
}

interface ReportData {
    total_assets: number;
    by_grade: Record<'P1' | 'P2' | 'P3', number>;
    by_category: { name: string; color: string | null; count: number }[];
    by_property: { property_id: string; name: string; count: number; grades: Record<string, number> }[];
    expiring_warranty: { id: string; asset_code: string; name: string; property: string; warranty_end: string }[];
    expiring_amc: { id: string; asset_code: string; name: string; property: string; contract_end_date: string; system_name: string }[];
    amc_pending: { id: string; asset_code: string; name: string; property: string; grade: string }[];
    rnm_spend: { property_id: string; name: string; mtd: number; ytd: number }[];
    overdue_ppm_total: number;
    open_ticket_total: number;
}

export default function AssetReportsView({ organizationId, propertyId }: Props) {
    const [data, setData] = useState<ReportData | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ organization_id: organizationId });
            if (propertyId) params.set('property_id', propertyId);
            const res = await fetch(`/api/assets/reports?${params}`);
            if (res.ok) setData(await res.json());
        } finally {
            setLoading(false);
        }
    }, [organizationId, propertyId]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary" size={28} /></div>;
    if (!data) return <p className="text-center text-sm text-slate-400 py-20">No report data available</p>;

    const gradeData = (['P1', 'P2', 'P3'] as const).map((g) => ({ grade: g, count: data.by_grade[g], color: GRADE_META[g].color, label: GRADE_META[g].label }));

    return (
        <div className="space-y-6">
            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi label="Total Assets" value={String(data.total_assets)} icon={Wrench} color="#708F96" />
                <Kpi label="Open Tickets" value={String(data.open_ticket_total)} icon={Ticket} color="#3B82F6" />
                <Kpi label="Overdue PPM" value={String(data.overdue_ppm_total)} icon={CalendarClock} color="#F59E0B" />
                <Kpi label="AMC Needed" value={String(data.amc_pending.length)} icon={ShieldAlert} color="#EF4444" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Grade distribution */}
                <div className="rounded-2xl border border-slate-100 p-5">
                    <p className="text-sm font-black text-slate-700 mb-4">Performance Distribution</p>
                    <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                            <Pie data={gradeData} dataKey="count" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={2}>
                                {gradeData.map((g) => <Cell key={g.grade} fill={g.color} />)}
                            </Pie>
                            <Tooltip />
                            <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* By category */}
                <div className="rounded-2xl border border-slate-100 p-5">
                    <p className="text-sm font-black text-slate-700 mb-4">Assets by Category</p>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={data.by_category} layout="vertical" margin={{ left: 12 }}>
                            <XAxis type="number" hide />
                            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                {data.by_category.map((c, i) => <Cell key={i} fill={c.color || '#708F96'} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* R&M spend */}
            {data.rnm_spend.length > 0 && (
                <div className="rounded-2xl border border-slate-100 p-5">
                    <p className="text-sm font-black text-slate-700 mb-4 flex items-center gap-2"><IndianRupee size={16} className="text-amber-500" /> R&amp;M Spend by Property</p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-xs text-slate-400 uppercase tracking-wide">
                                <tr><th className="text-left py-2">Property</th><th className="text-right py-2">This Month</th><th className="text-right py-2">Year to Date</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {data.rnm_spend.map((r) => (
                                    <tr key={r.property_id}>
                                        <td className="py-2 font-semibold text-slate-700">{r.name}</td>
                                        <td className="py-2 text-right text-slate-600">{inr(r.mtd)}</td>
                                        <td className="py-2 text-right font-bold text-slate-800">{inr(r.ytd)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Watchlist title="Warranty Expiring (60 days)" rows={data.expiring_warranty.map((w) => ({ id: w.id, primary: w.name, secondary: `${w.asset_code} · ${w.property}`, tag: new Date(w.warranty_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }))} empty="No warranties expiring soon" />
                <Watchlist title="AMC Needs Processing" rows={data.amc_pending.map((a) => ({ id: a.id, primary: a.name, secondary: `${a.asset_code} · ${a.property}`, tag: a.grade }))} empty="Every asset that needs AMC has one" />
            </div>
        </div>
    );
}

function Kpi({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
    return (
        <div className="rounded-2xl border border-slate-100 p-4">
            <div className="flex items-center gap-2 mb-2">
                <Icon size={15} style={{ color }} />
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
            </div>
            <p className="text-2xl font-black text-slate-900">{value}</p>
        </div>
    );
}

function Watchlist({ title, rows, empty }: { title: string; rows: { id: string; primary: string; secondary: string; tag: string }[]; empty: string }) {
    return (
        <div className="rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                <p className="text-xs font-black text-slate-500 uppercase tracking-wide">{title}</p>
            </div>
            <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
                {rows.length === 0 && <p className="p-4 text-sm text-slate-400 text-center">{empty}</p>}
                {rows.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{r.primary}</p>
                            <p className="text-xs text-slate-400 truncate">{r.secondary}</p>
                        </div>
                        <span className="text-xs font-black text-amber-600 flex-shrink-0">{r.tag}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
