'use client';

import React, { useState, useEffect } from 'react';
import {
    Brain,
    Zap,
    Clock,
    IndianRupee,
    Activity,
    AlertCircle,
    ChevronRight,
    TrendingUp,
    BarChart3,
    Cpu
} from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * USD -> INR conversion for the "Estimated Cost" tile.
 * STATIC APPROXIMATION, not a live rate — /api/admin/ai-metrics reports cost in
 * USD and this dashboard shows rupees. It will drift; this constant is the one
 * place to change it. Used by the Estimated Cost MetricCard's value and by its
 * own subtitle, so the two can never disagree.
 */
const USD_TO_INR = 83;

/** Rendered wherever a figure is genuinely unknown. An unknown number is not zero. */
const UNKNOWN = '—';

/** null for anything that is not a real number (undefined, null, NaN, a string). */
const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

/** a / b, or null when either side is unknown or the denominator is zero. */
const ratio = (a: unknown, b: unknown): number | null => {
    const x = num(a);
    const y = num(b);
    if (x === null || y === null || y === 0) return null;
    return x / y;
};

interface MetricCardProps {
    title: string;
    value: string | number;
    subValue?: string;
    icon: React.ReactNode;
    color: string;
    isDark: boolean;
}

const MetricCard = ({ title, value, subValue, icon, color, isDark }: MetricCardProps) => (
    <div className={`p-5 rounded-2xl border ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200'} shadow-sm`}>
        <div className="flex items-start justify-between">
            <div>
                <p className={`text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-slate-400'} mb-1`}>{title}</p>
                <h3 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>{value}</h3>
                {subValue && <p className={`text-[10px] font-bold mt-1 ${color}`}>{subValue}</p>}
            </div>
            <div className={`p-2.5 rounded-xl ${isDark ? 'bg-slate-800' : 'bg-slate-50'} ${color}`}>
                {icon}
            </div>
        </div>
    </div>
);

export default function AIInsightsDashboard({ isDark = true }: { isDark?: boolean }) {
    const [stats, setStats] = useState<any>(null);
    const [dailyUsage, setDailyUsage] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchMetrics = async () => {
            try {
                const res = await fetch('/api/admin/ai-metrics?days=7');
                const data = await res.json();
                if (data && !data.error) {
                    setStats(data.stats || null);
                    setDailyUsage(data.daily_usage || []);
                } else {
                    console.error('API Error:', data?.error);
                }
            } catch (err) {
                console.error('Failed to fetch AI metrics:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchMetrics();
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Brain className="w-12 h-12 text-primary animate-pulse mb-4" />
                <p className={`text-xs font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'} uppercase tracking-[0.2em]`}>
                    Syncing AI Intelligence...
                </p>
            </div>
        );
    }

    /* Every figure below is null when the metrics call returned nothing usable.
       None of them fall back to 0 — an absent metric is not a measurement of zero. */
    const invocations = num(stats?.llm_invocations);
    const llmShare = ratio(stats?.llm_invocations, stats?.total_invocations);
    const avgLatency = num(stats?.avg_latency);
    const totalTokens = num(stats?.total_tokens);
    const completionShare = ratio(stats?.completion_tokens, stats?.total_tokens);
    const costUsd = num(stats?.estimated_cost_usd);
    const costPerTriage = ratio(stats?.estimated_cost_usd, stats?.llm_invocations);

    const latencyLabel = avgLatency === null ? UNKNOWN : `${avgLatency.toFixed(0)}ms`;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Brain className="w-5 h-5 text-primary" />
                        <h2 className={`text-xl font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>AI Insights Dashboard</h2>
                    </div>
                    <p className={`text-[11px] font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'} uppercase tracking-wider`}>
                        Monitoring Groq Llama-3.3-70B Performance & Economics
                    </p>
                </div>
                <div className={`px-4 py-2 rounded-xl border ${isDark ? 'bg-success/5 border-success/20 text-success' : 'bg-success/5 border-success/20 text-success'} text-[10px] font-black uppercase tracking-widest flex items-center gap-2`}>
                    <Activity className="w-3.5 h-3.5" />
                    System Healthy
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    title="Total AI Invocations"
                    value={invocations ?? UNKNOWN}
                    subValue={llmShare === null
                        ? 'Share of total tickets unknown'
                        : `${(llmShare * 100).toFixed(1)}% of total tickets`}
                    icon={<Cpu className="w-5 h-5" />}
                    color="text-primary"
                    isDark={isDark}
                />
                <MetricCard
                    title="Avg API Latency"
                    value={latencyLabel}
                    subValue="Target: < 2000ms"
                    icon={<Clock className="w-5 h-5" />}
                    color="text-info"
                    isDark={isDark}
                />
                <MetricCard
                    title="Total Tokens Used"
                    value={totalTokens === null ? UNKNOWN : `${(totalTokens / 1000).toFixed(1)}k`}
                    subValue={completionShare === null
                        ? 'Completion share unknown'
                        : `${(completionShare * 100).toFixed(1)}% Completion`}
                    icon={<Zap className="w-5 h-5" />}
                    color="text-warning"
                    isDark={isDark}
                />
                <MetricCard
                    title="Estimated Cost"
                    value={costUsd === null ? UNKNOWN : `₹${(costUsd * USD_TO_INR).toFixed(2)}`}
                    subValue={`Converted from USD (1$ = ₹${USD_TO_INR})`}
                    icon={<IndianRupee className="w-5 h-5" />}
                    color="text-success"
                    isDark={isDark}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Cost & Token Breakdown */}
                <div className={`lg:col-span-2 p-6 rounded-3xl border ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-white border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-8">
                        <h4 className={`text-xs font-black uppercase tracking-widest ${isDark ? 'text-white' : 'text-slate-900'}`}>Usage Timeline (7 Days)</h4>
                        <BarChart3 className={`w-4 h-4 ${isDark ? 'text-slate-600' : 'text-slate-400'}`} />
                    </div>

                    <div className="h-[240px] flex items-end justify-between gap-1 px-2">
                        {(!dailyUsage || dailyUsage.length === 0) ? (
                            <div className="w-full flex items-center justify-center h-full italic text-xs text-slate-500">No data for period</div>
                        ) : dailyUsage.map((day, idx) => {
                            const calls = num(day?.calls);
                            // A day with no usable count sits at the floor height rather than
                            // animating to NaN, and says so in the tooltip.
                            const barHeight = Math.max(20, ((calls ?? 0) / 10) * 100);
                            const dateLabel = typeof day?.date === 'string'
                                ? day.date.split('-').slice(1).join('/')
                                : UNKNOWN;
                            return (
                            <div key={idx} className="flex-1 flex flex-col items-center gap-2 group cursor-help">
                                <div className="w-full relative">
                                    <motion.div
                                        initial={{ height: 0 }}
                                        animate={{ height: barHeight }}
                                        className={`w-full rounded-t-lg ${isDark ? 'bg-primary/40 group-hover:bg-primary/60' : 'bg-primary/20 group-hover:bg-primary/40'} transition-colors relative min-h-[4px]`}
                                    >
                                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-black text-white text-[9px] font-bold px-2 py-1 rounded">
                                            {calls === null ? 'calls unknown' : `${calls} calls`}
                                        </div>
                                    </motion.div>
                                </div>
                                <span className="text-[9px] font-black text-slate-500 rotate-45 mt-2 origin-left">{dateLabel}</span>
                            </div>
                            );
                        })}
                    </div>
                </div>

                {/* Performance Alerts / Signals */}
                <div className={`p-6 rounded-3xl border ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-white border-slate-200'}`}>
                    <h4 className={`text-xs font-black uppercase tracking-widest ${isDark ? 'text-white' : 'text-slate-900'} mb-6`}>Intelligence Signals</h4>

                    <div className="space-y-4">
                        <div className={`p-4 rounded-2xl ${isDark ? 'bg-error/5 border border-error/10' : 'bg-error/5 border border-error/10'}`}>
                            <div className="flex items-center gap-3 mb-2">
                                <Activity className="w-4 h-4 text-error" />
                                <span className={`text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-error' : 'text-error'}`}>System Latency</span>
                            </div>
                            <p className={`text-[11px] font-medium leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                {avgLatency === null
                                    ? <>Groq&apos;s Llama 3.3 70B latency is <strong className="text-white">{UNKNOWN}</strong> — no measurement returned for this period.</>
                                    : <>Groq&apos;s Llama 3.3 70B is currently averaging <strong className="text-white">{latencyLabel}</strong> per request. High situational reasoning complexity detected.</>}
                            </p>
                        </div>

                        <div className={`p-4 rounded-2xl ${isDark ? 'bg-primary/5 border border-primary/10' : 'bg-primary/5 border border-primary/10'}`}>
                            <div className="flex items-center gap-3 mb-2">
                                <TrendingUp className="w-4 h-4 text-primary" />
                                <span className={`text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-primary-light' : 'text-primary'}`}>Cost Efficiency</span>
                            </div>
                            <p className={`text-[11px] font-medium leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                Average cost per triage: <strong className="text-white">{costPerTriage === null ? UNKNOWN : `$${costPerTriage.toFixed(5)}`}</strong>.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
