'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Target, TrendingUp, ChevronDown } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { TextShimmer } from '@/frontend/components/ui/text-shimmer';

export default function TargetPage() {
    const params = useParams();
    const orgId = params?.orgId as string;
    const { user, membership } = useAuth();
    const isBdAdmin = membership?.org_role === 'bd_admin' || membership?.org_role === 'bd_super_admin';
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        fetch(`/api/crm/stats?type=rep&period=month`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { setStats(data); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center animate-pulse">
                    <Target className="w-6 h-6 text-emerald-600" />
                </div>
                <TextShimmer duration={1.2} className="text-sm font-bold" baseColor="#64748b" gradientColor="#cbd5e1">
                    Loading targets…
                </TextShimmer>
            </div>
        );
    }

    const s = stats || { total_leads: 0, deals_closed: 0, hot_leads: 0, warm_leads: 0, deals_open: 0 };
    const targetLeads = 100;
    const targetClosures = 10;
    const leadPct = Math.min(100, Math.round((s.total_leads / targetLeads) * 100));
    const closurePct = Math.min(100, Math.round((s.deals_closed / targetClosures) * 100));

    const now = new Date();
    const monthName = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-text-primary tracking-tight">Target</h1>
                    <p className="text-sm text-text-secondary mt-1">{monthName} performance targets</p>
                </div>
            </div>

            {/* Progress Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Lead Target */}
                <div className="bg-surface rounded-2xl border border-border p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-sm font-black text-text-primary">Lead Generation</h2>
                        <span className="text-[10px] font-bold text-text-tertiary uppercase">{monthName}</span>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="relative w-28 h-28">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-elevated)" strokeWidth="8" />
                                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--primary)" strokeWidth="8"
                                    strokeDasharray={`${leadPct * 2.64} 264`} strokeLinecap="round" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xl font-black text-text-primary">{leadPct}%</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div>
                                <p className="text-[10px] text-text-tertiary font-medium">Target</p>
                                <p className="text-lg font-black text-text-primary">{targetLeads}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-text-tertiary font-medium">Achieved</p>
                                <p className="text-lg font-black text-primary">{s.total_leads}</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Closure Target */}
                <div className="bg-surface rounded-2xl border border-border p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-sm font-black text-text-primary">Closures</h2>
                        <span className="text-[10px] font-bold text-text-tertiary uppercase">{monthName}</span>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="relative w-28 h-28">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-elevated)" strokeWidth="8" />
                                <circle cx="50" cy="50" r="42" fill="none" stroke="#22C55E" strokeWidth="8"
                                    strokeDasharray={`${closurePct * 2.64} 264`} strokeLinecap="round" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xl font-black text-text-primary">{closurePct}%</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div>
                                <p className="text-[10px] text-text-tertiary font-medium">Target</p>
                                <p className="text-lg font-black text-text-primary">{targetClosures}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-text-tertiary font-medium">Achieved</p>
                                <p className="text-lg font-black text-emerald-600">{s.deals_closed}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Pipeline Breakdown */}
            <div className="bg-surface rounded-2xl border border-border p-6">
                <h2 className="text-sm font-black text-text-primary mb-4">Pipeline Breakdown</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                        { label: 'Hot Leads', value: s.hot_leads, color: 'bg-rose-500' },
                        { label: 'Warm Leads', value: s.warm_leads, color: 'bg-amber-500' },
                        { label: 'Open Deals', value: s.deals_open, color: 'bg-blue-500' },
                        { label: 'Closed Won', value: s.deals_closed, color: 'bg-emerald-500' },
                    ].map(item => (
                        <div key={item.label} className="text-center p-4 bg-surface-elevated rounded-xl">
                            <div className={`w-3 h-3 rounded-full ${item.color} mx-auto mb-2`} />
                            <p className="text-xl font-black text-text-primary">{item.value}</p>
                            <p className="text-[10px] text-text-tertiary font-medium mt-1">{item.label}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
