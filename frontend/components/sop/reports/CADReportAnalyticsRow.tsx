'use client';

import React from 'react';
import { 
    BarChart3, 
    PieChart, 
    Clock, 
    Sparkles, 
    AlertTriangle, 
    CheckCircle2, 
    ShieldAlert, 
    ChevronRight,
    Target
} from 'lucide-react';
import { CategoryMetric, RecentAudit, AIInsight } from './useCADReportData';

interface CADReportAnalyticsRowProps {
    categoryMetrics: CategoryMetric[];
    statusCounts: {
        total: number;
        excellent: number;
        excellentPct: number;
        good: number;
        goodPct: number;
        attention: number;
        attentionPct: number;
        poor: number;
        poorPct: number;
    };
    recentAudits: RecentAudit[];
    aiInsights: AIInsight[];
    onSelectRecentAudit?: (id: string) => void;
}

export const CADReportAnalyticsRow: React.FC<CADReportAnalyticsRowProps> = ({
    categoryMetrics,
    statusCounts,
    recentAudits,
    aiInsights,
    onSelectRecentAudit,
}) => {
    // Donut chart calculations using SVG strokeDasharray
    const donutRadius = 42;
    const donutCircumference = 2 * Math.PI * donutRadius; // ~263.89

    const total = statusCounts.total || 1;
    const excOffset = 0;
    const excLength = (statusCounts.excellent / total) * donutCircumference;

    const goodOffset = -(excLength);
    const goodLength = (statusCounts.good / total) * donutCircumference;

    const attOffset = -(excLength + goodLength);
    const attLength = (statusCounts.attention / total) * donutCircumference;

    const poorOffset = -(excLength + goodLength + attLength);
    const poorLength = (statusCounts.poor / total) * donutCircumference;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* ── Card 1: Cleanliness Score by Area Type (Bar Chart) ── */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="font-black text-xs text-slate-900 tracking-tight">
                        Cleanliness Score by Area Type
                    </h3>
                    <BarChart3 size={15} className="text-slate-400" />
                </div>

                {/* Vertical Bar Chart */}
                <div className="h-44 flex items-end justify-between gap-2 pt-6 pb-2 px-1 relative">
                    {/* Y-Axis Guidelines */}
                    <div className="absolute inset-y-0 left-0 flex flex-col justify-between text-[8px] font-bold text-slate-300 pointer-events-none select-none">
                        <span>100</span>
                        <span>75</span>
                        <span>50</span>
                        <span>25</span>
                        <span>0</span>
                    </div>

                    {categoryMetrics.map((cat, idx) => {
                        const barColor = cat.score >= 85 ? 'bg-emerald-500' :
                                         cat.score >= 70 ? 'bg-yellow-400' :
                                         cat.score >= 60 ? 'bg-amber-500' : 'bg-rose-500';

                        return (
                            <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end z-10">
                                <span className="text-[10px] font-black text-slate-800">{cat.score}</span>
                                <div className="w-full max-w-[28px] bg-slate-100 rounded-t-lg overflow-hidden flex flex-col justify-end h-32">
                                    <div
                                        className={`w-full rounded-t-lg transition-all duration-700 ease-out ${barColor}`}
                                        style={{ height: `${Math.min(100, Math.max(10, cat.score))}%` }}
                                    />
                                </div>
                                <span className="text-[9px] font-bold text-slate-500 text-center truncate max-w-[55px]" title={cat.name}>
                                    {cat.name.split(' ')[0]}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Card 2: Area Status Overview (Donut Chart) ── */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col justify-between space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="font-black text-xs text-slate-900 tracking-tight">
                        Area Status Overview
                    </h3>
                    <PieChart size={15} className="text-slate-400" />
                </div>

                <div className="flex items-center justify-between gap-3 my-auto">
                    {/* SVG Donut Chart with Total Areas in Center */}
                    <div className="relative w-32 h-32 flex-shrink-0 flex items-center justify-center">
                        <svg className="w-32 h-32 -rotate-90 transform" viewBox="0 0 100 100">
                            {/* Track */}
                            <circle cx="50" cy="50" r={donutRadius} fill="none" stroke="#f1f5f9" strokeWidth="12" />

                            {/* Excellent Segment */}
                            <circle
                                cx="50"
                                cy="50"
                                r={donutRadius}
                                fill="none"
                                stroke="#10b981"
                                strokeWidth="12"
                                strokeDasharray={`${excLength} ${donutCircumference}`}
                                strokeDashoffset={excOffset}
                                className="transition-all duration-700"
                            />

                            {/* Good Segment */}
                            <circle
                                cx="50"
                                cy="50"
                                r={donutRadius}
                                fill="none"
                                stroke="#facc15"
                                strokeWidth="12"
                                strokeDasharray={`${goodLength} ${donutCircumference}`}
                                strokeDashoffset={goodOffset}
                                className="transition-all duration-700"
                            />

                            {/* Needs Attention Segment */}
                            <circle
                                cx="50"
                                cy="50"
                                r={donutRadius}
                                fill="none"
                                stroke="#f97316"
                                strokeWidth="12"
                                strokeDasharray={`${attLength} ${donutCircumference}`}
                                strokeDashoffset={attOffset}
                                className="transition-all duration-700"
                            />

                            {/* Poor Segment */}
                            <circle
                                cx="50"
                                cy="50"
                                r={donutRadius}
                                fill="none"
                                stroke="#ef4444"
                                strokeWidth="12"
                                strokeDasharray={`${poorLength} ${donutCircumference}`}
                                strokeDashoffset={poorOffset}
                                className="transition-all duration-700"
                            />
                        </svg>

                        {/* Center Total Count */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                            <span className="text-base font-black text-slate-900 leading-none">
                                {statusCounts.total}
                            </span>
                            <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5">
                                Total Areas
                            </span>
                        </div>
                    </div>

                    {/* Legend Breakdown from Real Counts */}
                    <div className="flex-1 space-y-1.5 text-[11px] font-bold">
                        <div className="flex items-center justify-between text-slate-700">
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                <span>Excellent</span>
                            </span>
                            <span className="font-black text-slate-900">{statusCounts.excellent} ({statusCounts.excellentPct}%)</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-700">
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                                <span>Good</span>
                            </span>
                            <span className="font-black text-slate-900">{statusCounts.good} ({statusCounts.goodPct}%)</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-700">
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                                <span>Attention</span>
                            </span>
                            <span className="font-black text-slate-900">{statusCounts.attention} ({statusCounts.attentionPct}%)</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-700">
                            <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                                <span>Poor</span>
                            </span>
                            <span className="font-black text-slate-900">{statusCounts.poor} ({statusCounts.poorPct}%)</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Card 3: Recent Inspections (Live Stream) ── */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col justify-between space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="font-black text-xs text-slate-900 tracking-tight">
                        Recent Inspections
                    </h3>
                    <button type="button" className="text-[10px] font-bold text-primary hover:underline cursor-pointer">
                        View All →
                    </button>
                </div>

                <div className="space-y-2 flex-1">
                    {recentAudits.slice(0, 4).map((audit, idx) => (
                        <div
                            key={idx}
                            onClick={() => onSelectRecentAudit?.(audit.id)}
                            className="flex items-center justify-between p-1.5 hover:bg-slate-50 rounded-xl transition-all cursor-pointer group"
                        >
                            <div className="flex items-center gap-2.5 min-w-0">
                                {audit.photoUrl ? (
                                    <div className="w-9 h-9 rounded-lg overflow-hidden bg-slate-900 flex-shrink-0 border border-slate-200">
                                        <img src={audit.photoUrl} alt={audit.areaName} className="w-full h-full object-cover" />
                                    </div>
                                ) : (
                                    <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-black text-xs flex-shrink-0">
                                        {audit.areaName.slice(0, 2).toUpperCase()}
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <p className="font-black text-xs text-slate-900 truncate group-hover:text-primary transition-colors">
                                        {audit.areaName}
                                    </p>
                                    <p className="text-[9px] text-slate-400 font-semibold truncate">
                                        {audit.location}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0 text-right">
                                <div className={`px-2 py-0.5 rounded-lg text-xs font-black ${
                                    audit.score >= 90 ? 'bg-emerald-100 text-emerald-800' :
                                    audit.score >= 70 ? 'bg-yellow-100 text-yellow-800' :
                                    audit.score >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                                }`}>
                                    {audit.score}
                                </div>
                                <span className="text-[9px] font-bold text-slate-400 hidden sm:inline">
                                    {audit.timestamp}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Card 4: AI Insights & Recommendations ── */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col justify-between space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="font-black text-xs text-slate-900 tracking-tight flex items-center gap-1.5">
                        <Sparkles size={13} className="text-primary" />
                        AI Insights & Recommendations
                    </h3>
                    <button type="button" className="text-[10px] font-bold text-primary hover:underline cursor-pointer">
                        View All →
                    </button>
                </div>

                <div className="space-y-2 flex-1">
                    {aiInsights.map((insight) => {
                        const icon = insight.type === 'critical' ? <ShieldAlert size={14} className="text-rose-600 flex-shrink-0 mt-0.5" /> :
                                     insight.type === 'warning' ? <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" /> :
                                     insight.type === 'success' ? <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" /> :
                                     <Target size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />;

                        const bg = insight.type === 'critical' ? 'bg-rose-50/70 border-rose-100 text-rose-950' :
                                   insight.type === 'warning' ? 'bg-amber-50/70 border-amber-100 text-amber-950' :
                                   insight.type === 'success' ? 'bg-emerald-50/70 border-emerald-100 text-emerald-950' :
                                   'bg-blue-50/70 border-blue-100 text-blue-950';

                        return (
                            <div key={insight.id} className={`p-2 rounded-xl border flex items-center justify-between gap-2 text-xs transition-colors hover:bg-white cursor-pointer ${bg}`}>
                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                    {icon}
                                    <div className="min-w-0 flex-1">
                                        <p className="font-black text-[11px] leading-tight">{insight.title}</p>
                                        <p className="text-[10px] text-slate-600 font-medium leading-snug mt-0.5 truncate">{insight.description}</p>
                                    </div>
                                </div>
                                <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
