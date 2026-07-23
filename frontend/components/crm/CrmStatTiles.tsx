'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Users, Sparkles, Bell, ChevronDown } from 'lucide-react';
import BorderGlow from '@/frontend/components/ui/BorderGlow';

export type StatPeriod = 'today' | 'week' | 'month' | 'all';

interface CampaignCount {
    campaign: string;
    count: number;
}

interface CrmStatTilesProps {
    total: number;
    newLeads: number;
    newLeadsByCampaign?: CampaignCount[];
    followups: number;
    period: StatPeriod;
    onPeriodChange: (p: StatPeriod) => void;
    orgId?: string;
    loading?: boolean;
    compact?: boolean;
}

const PERIODS: { value: StatPeriod; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'all', label: 'Total' },
];

const TILE_GLOW: Record<string, { glow: string; colors: string[] }> = {
    '#708F96': { glow: '192 20 58', colors: ['#708F96', '#94b8bf', '#708F96'] },
    '#0EA5E9': { glow: '199 89 49', colors: ['#0EA5E9', '#38bdf8', '#7dd3fc'] },
    '#F59E0B': { glow: '38 92 50',  colors: ['#F59E0B', '#fbbf24', '#fcd34d'] },
};

const CAMPAIGN_COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#10B981'];

export default function CrmStatTiles({
    total, newLeads, newLeadsByCampaign, followups, period, onPeriodChange, orgId, loading, compact,
}: CrmStatTilesProps) {
    const [showCampaignBreakdown, setShowCampaignBreakdown] = useState(false);
    const campaigns = (newLeadsByCampaign || []).sort((a, b) => b.count - a.count);

    const tiles = [
        { label: 'Total Leads', value: total, icon: Users, color: '#708F96', href: orgId ? `/${orgId}/crm/leads` : undefined },
        { label: 'New Leads', value: newLeads, icon: Sparkles, color: '#0EA5E9', href: orgId ? `/${orgId}/crm/leads` : undefined, hasCampaigns: true },
        { label: 'Followup Needed', value: followups, icon: Bell, color: '#F59E0B', href: orgId ? `/${orgId}/crm/leads?filter=followups` : undefined },
    ];

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-text-tertiary px-1">Overview</p>
                <div className="inline-flex bg-muted rounded-xl p-0.5">
                    {PERIODS.map((p) => (
                        <button
                            key={p.value}
                            onClick={() => onPeriodChange(p.value)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                                period === p.value ? 'bg-surface text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                            }`}
                        >{p.label}</button>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {tiles.map((t) => {
                    const Icon = t.icon;
                    const tileGlow = TILE_GLOW[t.color] || TILE_GLOW['#708F96'];

                    const inner = (
                        <BorderGlow
                            backgroundColor="var(--surface)"
                            glowColor={tileGlow.glow}
                            colors={tileGlow.colors}
                            fillOpacity={0.03}
                            borderRadius={16}
                            glowRadius={16}
                            glowIntensity={0.6}
                            coneSpread={35}
                            edgeSensitivity={40}
                        >
                            <div className={`flex flex-col justify-between h-full ${compact ? 'p-3' : 'p-4'}`}>
                                <div className="flex items-start justify-between mb-3">
                                    <span className="text-[10px] font-black uppercase tracking-widest leading-tight" style={{ color: t.color }}>{t.label}</span>
                                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${t.color}1A` }}>
                                        <Icon className="w-4 h-4" style={{ color: t.color }} />
                                    </div>
                                </div>
                                <span className={`${compact ? 'text-2xl' : 'text-3xl'} font-black text-text-primary`}>{loading ? '—' : t.value}</span>
                                {t.hasCampaigns && campaigns.length > 0 && !loading && (
                                    <button
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowCampaignBreakdown(v => !v); }}
                                        className="flex items-center gap-1 mt-2 text-[10px] font-bold text-sky-600 hover:text-sky-700"
                                    >
                                        By Campaign <ChevronDown className={`w-3 h-3 transition-transform ${showCampaignBreakdown ? 'rotate-180' : ''}`} />
                                    </button>
                                )}
                            </div>
                        </BorderGlow>
                    );

                    return t.href
                        ? <Link key={t.label} href={t.href} className="block">{inner}</Link>
                        : <div key={t.label}>{inner}</div>;
                })}
            </div>

            {showCampaignBreakdown && campaigns.length > 0 && (
                <div className="mt-3 bg-surface border border-border rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-text-tertiary mb-3">New Leads by Campaign</p>
                    <div className="space-y-2">
                        {campaigns.map((c, i) => {
                            const color = CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length];
                            const pct = newLeads > 0 ? Math.round((c.count / newLeads) * 100) : 0;
                            return (
                                <div key={c.campaign} className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                                    <span className="text-sm font-semibold text-text-primary min-w-[120px]">{c.campaign}</span>
                                    <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                                    </div>
                                    <span className="text-sm font-black text-text-primary w-10 text-right">{c.count}</span>
                                    <span className="text-[10px] text-text-tertiary font-medium w-10 text-right">{pct}%</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
