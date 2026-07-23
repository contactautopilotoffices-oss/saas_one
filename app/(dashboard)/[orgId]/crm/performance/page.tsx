'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { TrendingUp, Phone, Calendar, FileText, Users, CheckCircle2, BarChart3 } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { TextShimmer } from '@/frontend/components/ui/text-shimmer';

export default function PerformancePage() {
    const params = useParams();
    const orgId = params?.orgId as string;
    const { membership } = useAuth();
    const isBdAdmin = membership?.org_role === 'bd_admin' || membership?.org_role === 'bd_super_admin';
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<'week' | 'month'>('week');

    useEffect(() => {
        setLoading(true);
        fetch(`/api/crm/stats?type=rep&period=${period}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { setStats(data); setLoading(false); })
            .catch(() => setLoading(false));
    }, [period]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center animate-pulse">
                    <TrendingUp className="w-6 h-6 text-primary" />
                </div>
                <TextShimmer duration={1.2} className="text-sm font-bold" baseColor="#64748b" gradientColor="#cbd5e1">
                    Loading performance…
                </TextShimmer>
            </div>
        );
    }

    const s = stats || {
        total_leads: 0, hot_leads: 0, warm_leads: 0, deals_closed: 0,
        meetings_today: 0, followups_needed: 0, new_leads: 0, lost_leads: 0,
    };

    const metrics = [
        { label: 'Total Leads', value: s.total_leads, target: 100, icon: Users, color: 'bg-primary' },
        { label: 'New Leads', value: s.new_leads, target: 15, icon: Users, color: 'bg-blue-500' },
        { label: 'Meetings Booked', value: s.meetings_today, target: 10, icon: Calendar, color: 'bg-violet-500' },
        { label: 'Proposals Sent', value: s.deals_open, target: 10, icon: FileText, color: 'bg-amber-500' },
        { label: 'Deals Closed', value: s.deals_closed, target: 5, icon: CheckCircle2, color: 'bg-emerald-500' },
        { label: 'Win Rate', value: s.total_leads > 0 ? Math.round((s.deals_closed / s.total_leads) * 100) : 0, target: 100, icon: TrendingUp, color: 'bg-rose-500', suffix: '%' },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl font-black text-text-primary tracking-tight">Performance</h1>
                    <p className="text-sm text-text-secondary mt-1">Your activity metrics and conversion rates</p>
                </div>
                <div className="flex items-center gap-1 bg-surface-elevated rounded-xl p-1 shrink-0 max-w-full overflow-x-auto no-scrollbar">
                    {(['week', 'month'] as const).map(p => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                                period === p ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary'
                            }`}
                        >
                            This {p === 'week' ? 'Week' : 'Month'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {metrics.map(m => {
                    const pct = m.target > 0 ? Math.min(100, Math.round((m.value / m.target) * 100)) : 0;
                    return (
                        <div key={m.label} className="bg-surface rounded-2xl border border-border p-5">
                            <div className="flex items-center justify-between mb-3">
                                <m.icon className="w-4 h-4 text-text-tertiary" />
                                <span className="text-[10px] font-bold text-text-tertiary uppercase">{m.label}</span>
                            </div>
                            <p className="text-2xl font-black text-text-primary">{m.value}{m.suffix || ''}</p>
                            <div className="mt-3">
                                <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all duration-500 ${m.color}`} style={{ width: `${pct}%` }} />
                                </div>
                                <p className="text-[10px] text-text-tertiary mt-1 font-medium">
                                    {m.value} / {m.target}{m.suffix || ''}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
