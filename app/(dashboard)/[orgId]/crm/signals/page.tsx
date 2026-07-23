'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Radio, Flame, ChevronRight, TrendingUp } from 'lucide-react';
import { TextShimmer } from '@/frontend/components/ui/text-shimmer';

interface SignalLead {
    id: string;
    name: string;
    meta: string;
    reason: string;
    score: number;
    tier: 'Very Hot' | 'Hot';
}

const SAMPLE_SIGNALS: SignalLead[] = [
    { id: 's1', name: 'InnoTech Solutions', meta: 'AI Automation · 200+ emp', reason: 'New funding round', score: 98, tier: 'Very Hot' },
    { id: 's2', name: 'NextGen Retail', meta: 'Retail E-commerce · 500+ emp', reason: 'Expanding to new markets', score: 95, tier: 'Very Hot' },
    { id: 's3', name: 'FinEdge Advisors', meta: 'Financial Services · 100+ emp', reason: 'Leadership change', score: 93, tier: 'Hot' },
    { id: 's4', name: 'DataScale Systems', meta: 'SaaS Analytics · 50+ emp', reason: 'Tech stack expansion', score: 91, tier: 'Hot' },
    { id: 's5', name: 'Vertex Logistics', meta: 'Supply Chain · 300+ emp', reason: 'Hiring surge in sales', score: 88, tier: 'Hot' },
    { id: 's6', name: 'BrightPath EdTech', meta: 'Education · 150+ emp', reason: 'Product launch', score: 85, tier: 'Hot' },
];

export default function SignalsPage() {
    const params = useParams();
    const router = useRouter();
    const orgId = params?.orgId as string;
    const [signals, setSignals] = useState<SignalLead[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        fetch(`/api/crm/stats?type=admin&period=month`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                const pl = data?.priority_leads || [];
                if (pl.length) {
                    setSignals(pl.slice(0, 12).map((l: any, i: number) => ({
                        id: l.id,
                        name: l.company_name || l.full_name,
                        meta: l.location || '—',
                        reason: l.campaign || 'High intent signal',
                        score: Math.max(60, 98 - i * 3),
                        tier: /hot/i.test(l.status_name) ? 'Very Hot' : 'Hot',
                    })));
                } else {
                    setSignals(SAMPLE_SIGNALS);
                }
                setLoading(false);
            })
            .catch(() => { setSignals(SAMPLE_SIGNALS); setLoading(false); });
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 bg-rose-100 dark:bg-rose-900/30 rounded-2xl flex items-center justify-center animate-pulse">
                    <Radio className="w-6 h-6 text-rose-500" />
                </div>
                <TextShimmer duration={1.2} className="text-sm font-bold" baseColor="#64748b" gradientColor="#cbd5e1">
                    Loading signals…
                </TextShimmer>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-black text-text-primary tracking-tight">Signals</h1>
                <p className="text-sm text-text-secondary mt-1">Highest-scoring intent signals across your market</p>
            </div>

            <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                <div className="divide-y divide-border">
                    {signals.map(s => (
                        <div
                            key={s.id}
                            onClick={() => router.push(`/${orgId}/crm/leads?lead=${s.id}`)}
                            className="flex items-center gap-4 px-5 py-4 hover:bg-surface-elevated cursor-pointer transition-colors"
                        >
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-sm ${s.tier === 'Very Hot' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                                {s.score}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-text-primary truncate">{s.name}</p>
                                <p className="text-xs text-text-tertiary truncate">{s.meta}</p>
                                <p className="text-xs text-text-secondary mt-0.5 truncate">{s.reason}</p>
                            </div>
                            <span className={`inline-flex items-center gap-1 text-[10px] font-black ${s.tier === 'Very Hot' ? 'text-rose-500' : 'text-amber-500'}`}>
                                <Flame className="w-3 h-3" /> {s.tier}
                            </span>
                            <ChevronRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
