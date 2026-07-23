'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    TrendingUp, Download, Droplets, AlertTriangle,
    BarChart3, Plus, IndianRupee, Activity, ChevronDown, Calendar, GlassWater, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import { ResponsiveContainer, Tooltip, XAxis, Area, AreaChart, YAxis, CartesianGrid } from 'recharts';
import { WaterDashboard } from './WaterDashboard';
import { useDataCache } from '@/frontend/context/DataCacheContext';

interface WaterSource {
    id: string;
    name: string;
    source_type: 'jar' | 'tanker';
}

interface WaterReading {
    id: string;
    source_id: string;
    reading_date: string;
    created_at: string;
    quantity: number;
    computed_cost: number;
    source: { name: string; source_type: string };
}

interface TrendPoint {
    date: string;
    cost: number;
    quantity: number;
}

interface WaterAnalyticsDashboardProps {
    propertyId?: string;
    orgId?: string;
    properties?: { id: string; name: string }[];
}

const isValidId = (id?: string) => !!id && id !== 'undefined' && id !== 'null' && id !== 'all';

const WaterAnalyticsDashboard: React.FC<WaterAnalyticsDashboardProps> = ({ propertyId: propIdFromProps, orgId, properties = [] }) => {
    const params = useParams();
    const propertyId = propIdFromProps || (params?.propertyId as string);
    const supabase = useMemo(() => createClient(), []);

    const { getCachedData, setCachedData } = useDataCache();
    const fetchKey = `dashboard-water-analytics-${propertyId}`;
    const initialCached = useMemo(() => getCachedData(fetchKey), [fetchKey]);

    // UI State
    const [viewMode, setViewMode] = useState<'combined' | 'source'>('combined');
    const [selectedSourceId, setSelectedSourceId] = useState<string>('all');
    const [costTimeframe, setCostTimeframe] = useState<'today' | 'month'>('month');
    const [qtyTimeframe, setQtyTimeframe] = useState<'today' | 'month'>('month');
    const [trendMetric, setTrendMetric] = useState<'cost' | 'quantity'>('cost');
    const [trendPeriod, setTrendPeriod] = useState<'7D' | '30D'>('7D');
    const [showLogModal, setShowLogModal] = useState(false);

    // Data State
    const [property, setProperty] = useState<{ name: string } | null>(initialCached?.property || null);
    const [sources, setSources] = useState<WaterSource[]>(initialCached?.sources || []);
    const [rawReadings, setRawReadings] = useState<{
        today: WaterReading[];
        month: WaterReading[];
        prevMonth: WaterReading[];
        trend: WaterReading[];
        custom: WaterReading[];
    }>(initialCached?.rawReadings || { today: [], month: [], prevMonth: [], trend: [], custom: [] });

    // Date Range Filter State
    const todayStr = new Date().toISOString().split('T')[0];
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');
    const [pendingDateFrom, setPendingDateFrom] = useState<string>('');
    const [pendingDateTo, setPendingDateTo] = useState<string>('');
    const [isCustomRange, setIsCustomRange] = useState(false);

    const [isLoading, setIsLoading] = useState(!initialCached);

    // Fetch Data
    const fetchData = useCallback(async (isInitial = false) => {
        if (!isValidId(propertyId)) return;
        
        if (!isInitial || !initialCached) {
            setIsLoading(true);
        }

        try {
            // 1. Property Name
            const { data: propData } = await supabase.from('properties').select('name').eq('id', propertyId).single();
            setProperty(propData);

            // 2. Sources
            const { data: sourcesData } = await supabase
                .from('water_sources')
                .select('id, name, source_type')
                .eq('property_id', propertyId)
                .eq('is_active', true);
            
            const fetchedSources = sourcesData || [];
            setSources(fetchedSources);

            if (fetchedSources.length === 0) {
                setIsLoading(false);
                return;
            }

            const sourceIds = fetchedSources.map(s => s.id);

            // 3. Readings
            const dates = {
                today: todayStr,
                monthStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
                prevMonthStart: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split('T')[0],
                prevMonthEnd: new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().split('T')[0],
                trendStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            };

            const fetchReadings = async (start: string, end?: string) => {
                let q = supabase
                    .from('water_readings')
                    .select(`id, source_id, reading_date, created_at, quantity, computed_cost, source:water_sources(name, source_type)`)
                    .in('source_id', sourceIds)
                    .gte('reading_date', start);
                if (end) {
                    q = q.lte('reading_date', end);
                }
                const { data } = await q;
                return (data as any) || [];
            };

            const [todayR, monthR, prevMonthR, trendR, customR] = await Promise.all([
                fetchReadings(dates.today, dates.today),
                fetchReadings(dates.monthStart),
                fetchReadings(dates.prevMonthStart, dates.prevMonthEnd),
                fetchReadings(dates.trendStart),
                isCustomRange && dateFrom && dateTo ? fetchReadings(dateFrom, dateTo) : Promise.resolve([])
            ]);

            const newRawReadings = {
                today: todayR || [],
                month: monthR || [],
                prevMonth: prevMonthR || [],
                trend: trendR || [],
                custom: customR || []
            };
            setRawReadings(newRawReadings);
            
            setCachedData(fetchKey, {
                property: propData,
                sources: fetchedSources,
                rawReadings: newRawReadings
            });
        } catch (error) {
            console.error('Error fetching water analytics:', error);
        } finally {
            setIsLoading(false);
        }
    }, [propertyId, supabase, dateFrom, dateTo, isCustomRange, trendPeriod, initialCached, fetchKey, setCachedData]);

    useEffect(() => {
        fetchData(true);
    }, [fetchData]);

    // Derived Metrics
    const metrics = useMemo(() => {
        const filterFn = (r: WaterReading) => {
            if (viewMode === 'combined') return true;
            return r.source_id === selectedSourceId;
        };

        const calc = (readings: WaterReading[]) => {
            return readings.filter(filterFn).reduce((acc, r) => {
                return {
                    cost: acc.cost + (r.computed_cost || 0),
                    quantity: acc.quantity + (r.quantity || 0)
                };
            }, { cost: 0, quantity: 0 });
        };

        const today = calc(rawReadings.today);
        const month = calc(rawReadings.month);
        const prevMonth = calc(rawReadings.prevMonth);
        const custom = calc(rawReadings.custom);

        const avgCalc = (readings: WaterReading[]) => {
            const uniqueDays = new Set(readings.filter(filterFn).map(r => r.reading_date)).size || 1;
            const totals = calc(readings);
            return { cost: totals.cost / uniqueDays, quantity: totals.quantity / uniqueDays };
        };

        const monthAvgs = avgCalc(rawReadings.month);
        const customAvgs = isCustomRange ? avgCalc(rawReadings.custom) : monthAvgs;

        return { today, month, prevMonth, custom, averages: isCustomRange ? customAvgs : monthAvgs };
    }, [rawReadings, viewMode, selectedSourceId, isCustomRange]);

    // Trend Chart Data
    const chartData = useMemo(() => {
        const filterFn = (r: WaterReading) => {
            if (viewMode === 'combined') return true;
            return r.source_id === selectedSourceId;
        };

        if (isCustomRange && dateFrom && dateTo) {
            const result: TrendPoint[] = [];
            const relevantReadings = rawReadings.custom.filter(filterFn);
            const start = new Date(dateFrom);
            const end = new Date(dateTo);
            const dayMs = 24 * 60 * 60 * 1000;
            const totalDays = Math.round((end.getTime() - start.getTime()) / dayMs) + 1;

            for (let i = 0; i < totalDays; i++) {
                const d = new Date(start.getTime() + i * dayMs);
                const dateStr = d.toISOString().split('T')[0];
                const label = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

                const dayTotals = relevantReadings.filter(r => r.reading_date === dateStr).reduce((acc, r) => {
                    return { cost: acc.cost + (r.computed_cost || 0), quantity: acc.quantity + (r.quantity || 0) };
                }, { cost: 0, quantity: 0 });

                result.push({ date: label, ...dayTotals });
            }
            return result;
        }

        const days = trendPeriod === '7D' ? 7 : 30;
        const result: TrendPoint[] = [];
        const now = new Date();
        const relevantReadings = rawReadings.trend.filter(filterFn);

        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const label = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

            const dayTotals = relevantReadings.filter(r => r.reading_date === dateStr).reduce((acc, r) => {
                return { cost: acc.cost + (r.computed_cost || 0), quantity: acc.quantity + (r.quantity || 0) };
            }, { cost: 0, quantity: 0 });

            result.push({ date: label, ...dayTotals });
        }
        return result;
    }, [rawReadings.trend, rawReadings.custom, trendPeriod, viewMode, selectedSourceId, isCustomRange, dateFrom, dateTo]);

    // Formatting
    const fmtCost = (val: number, units?: number) => {
        if (val === 0 && (units === 0 || units === undefined)) return '—';
        return `₹${(val || 0).toLocaleString()}`;
    };
    const fmtQty = (val: number) => {
        if (val === 0 || !val) return '—';
        return `${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`;
    };

    const displayCost = isCustomRange ? metrics.custom.cost : (costTimeframe === 'today' ? metrics.today.cost : metrics.month.cost);
    const displayQty = isCustomRange ? metrics.custom.quantity : (qtyTimeframe === 'today' ? metrics.today.quantity : metrics.month.quantity);

    if (isLoading) return (
        <div className="space-y-8 animate-pulse">
            <div className="h-8 w-64 bg-slate-200 rounded-lg" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[1,2,3].map(i => <div key={i} className="h-48 bg-slate-100 rounded-2xl" />)}
            </div>
            <div className="h-64 w-full bg-slate-100 rounded-2xl" />
        </div>
    );

    return (
        <div className="space-y-4 animate-in fade-in duration-500 pb-4">
            {/* Header Area */}
            <div className="flex flex-col gap-3">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="md:hidden">
                        <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                            Analytics Overview
                            <span className="text-[8px] font-black text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">LIVE</span>
                        </h1>
                        <p className="text-[11px] font-medium text-slate-500 mt-1">Real-time usage monitoring and costs.</p>
                    </div>
                    <button
                        onClick={() => setShowLogModal(true)}
                        className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-sm h-10"
                    >
                        <Plus className="w-4 h-4" />
                        Log Entry
                    </button>
                </div>

                {/* Filters Row */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    {/* Date Range Filter */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1.5 shadow-sm">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            <input
                                type="date"
                                value={pendingDateFrom}
                                max={pendingDateTo || todayStr}
                                onChange={(e) => setPendingDateFrom(e.target.value)}
                                className="text-xs font-medium text-slate-700 bg-transparent border-none outline-none focus:ring-0 w-28"
                            />
                            <span className="text-[10px] text-slate-400">to</span>
                            <input
                                type="date"
                                value={pendingDateTo}
                                min={pendingDateFrom}
                                max={todayStr}
                                onChange={(e) => setPendingDateTo(e.target.value)}
                                className="text-xs font-medium text-slate-700 bg-transparent border-none outline-none focus:ring-0 w-28"
                            />
                        </div>
                        <button
                            onClick={() => { 
                                if (pendingDateFrom && pendingDateTo) {
                                    setDateFrom(pendingDateFrom);
                                    setDateTo(pendingDateTo);
                                    setIsCustomRange(true); 
                                }
                            }}
                            disabled={!pendingDateFrom || !pendingDateTo}
                            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm h-8"
                        >
                            Apply
                        </button>
                        {isCustomRange && (
                            <button
                                onClick={() => { 
                                    setIsCustomRange(false); 
                                    setDateFrom(''); 
                                    setDateTo(''); 
                                    setPendingDateFrom('');
                                    setPendingDateTo('');
                                }}
                                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all shadow-sm h-8"
                            >
                                Reset
                            </button>
                        )}
                    </div>

                    {/* Scope Toggle */}
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 shadow-sm">
                        <button
                            onClick={() => { setViewMode('combined'); setSelectedSourceId('all'); }}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'combined' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Combined
                        </button>
                        <div className="relative">
                            <button
                                onClick={() => { setViewMode('source'); if (sources.length && selectedSourceId === 'all') setSelectedSourceId(sources[0].id); }}
                                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${viewMode === 'source' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Source-wise
                                {viewMode === 'source' && <ChevronDown className="w-3 h-3" />}
                            </button>
                            {viewMode === 'source' && (
                                <select
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    value={selectedSourceId}
                                    onChange={(e) => setSelectedSourceId(e.target.value)}
                                >
                                    {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 3-Tile Layout */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Tile 1: Cost */}
                <div className="bg-white rounded-2xl p-5 md:p-4 shadow-sm border border-slate-200 relative flex flex-col items-center justify-center md:h-[150px]">
                    <div className="absolute top-4 left-4">
                        <span className="p-2.5 md:p-2 bg-green-50 rounded-full text-green-600 flex items-center justify-center">
                            <IndianRupee className="w-5 h-5 md:w-4 md:h-4" />
                        </span>
                    </div>
                    <div className="absolute top-4 right-4 text-right">
                        <span className="text-xs md:text-[10px] font-bold text-slate-700 uppercase tracking-widest block">WATER COST</span>
                        <span className="text-[10px] md:text-[9px] text-blue-500 font-medium">{isCustomRange ? 'Custom Range' : (costTimeframe === 'today' ? 'Today' : 'This Month')}</span>
                    </div>
                    <div className="text-center mt-6">
                        <div className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                            {fmtCost(displayCost, displayQty)}
                        </div>
                        <p className="text-[10px] md:text-[9px] font-medium text-slate-500 mt-1 uppercase tracking-wide">
                            {isCustomRange ? `${dateFrom} to ${dateTo}` : (costTimeframe === 'today' ? 'Total today' : 'Total this month')}
                        </p>
                    </div>
                </div>

                {/* Tile 2: Quantity */}
                <div className="bg-white rounded-2xl p-5 md:p-4 shadow-sm border border-slate-200 relative flex flex-col items-center justify-center md:h-[150px]">
                    <div className="absolute top-4 left-4">
                        <span className="p-2.5 md:p-2 bg-blue-50 rounded-full text-blue-600 flex items-center justify-center">
                            <Droplets className="w-5 h-5 md:w-4 md:h-4" />
                        </span>
                    </div>
                    <div className="absolute top-4 right-4 text-right">
                        <span className="text-xs md:text-[10px] font-bold text-slate-700 uppercase tracking-widest block">QUANTITY CONSUMED</span>
                        <span className="text-[10px] md:text-[9px] text-blue-500 font-medium">{isCustomRange ? 'Custom Range' : (qtyTimeframe === 'today' ? 'Today' : 'This Month')}</span>
                    </div>
                    <div className="text-center mt-6">
                        <div className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight flex items-baseline justify-center gap-1.5">
                            {fmtQty(displayQty)}
                            <span className="text-[10px] md:text-[9px] font-bold text-slate-500 uppercase tracking-wider">{viewMode === 'source' ? sources.find(s=>s.id === selectedSourceId)?.source_type === 'jar' ? 'JARS' : 'LOADS' : 'TOTAL'}</span>
                        </div>
                        <p className="text-[10px] md:text-[9px] font-medium text-slate-500 mt-1 uppercase tracking-wide">
                            {isCustomRange ? `${dateFrom} to ${dateTo}` : (qtyTimeframe === 'today' ? 'Total consumption' : 'Total consumption')}
                        </p>
                    </div>
                </div>

                {/* Tile 3: Averages */}
                <div className="bg-white rounded-2xl p-5 md:p-4 shadow-sm border border-slate-200 relative flex flex-col items-center justify-center md:h-[150px]">
                    <div className="absolute top-4 left-4">
                        <span className="p-2.5 md:p-2 bg-purple-50 rounded-full text-purple-600 flex items-center justify-center">
                            <BarChart3 className="w-5 h-5 md:w-4 md:h-4" />
                        </span>
                    </div>
                    <div className="absolute top-4 right-4 text-right">
                        <span className="text-xs md:text-[10px] font-bold text-slate-700 uppercase tracking-widest block">DAILY AVERAGE</span>
                    </div>
                    <div className="w-full px-8 mt-6">
                        <div className="space-y-3 md:space-y-2">
                            <div className="flex justify-between items-end">
                                <span className="text-[10px] md:text-[9px] text-slate-500 block">Avg Daily Cost</span>
                                <div className="text-xl md:text-lg font-black text-slate-900 leading-none">{fmtCost(metrics.averages.cost, metrics.averages.quantity)}</div>
                            </div>
                            <div className="h-px w-full bg-slate-100" />
                            <div className="flex justify-between items-end">
                                <span className="text-[10px] md:text-[9px] text-slate-500 block">Avg Daily Vol</span>
                                <div className="text-xl md:text-lg font-black text-slate-900 flex items-baseline gap-1 leading-none">
                                    {fmtQty(metrics.averages.quantity)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Trends Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900">Consumption Trends</h3>
                        <p className="text-sm text-slate-500">
                            {isCustomRange ? `Showing data from ${dateFrom} to ${dateTo}` : 'Analyze usage patterns over time'}
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        {/* Metric Toggle */}
                        <div className="flex bg-slate-100 rounded-lg p-1 shadow-inner border border-slate-200">
                            <button onClick={() => setTrendMetric('cost')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${trendMetric === 'cost' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
                                <IndianRupee className="w-3 h-3" /> Cost
                            </button>
                            <button onClick={() => setTrendMetric('quantity')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${trendMetric === 'quantity' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                                <Droplets className="w-3 h-3" /> Quantity
                            </button>
                        </div>
                        {/* Period Toggle */}
                        <div className="flex gap-2">
                            <button onClick={() => setTrendPeriod('7D')} className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${trendPeriod === '7D' ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 shadow-sm'}`}>7 Days</button>
                            <button onClick={() => setTrendPeriod('30D')} className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${trendPeriod === '30D' ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 shadow-sm'}`}>30 Days</button>
                        </div>
                    </div>
                </div>

                {/* Chart */}
                <div className="h-[250px] w-full">
                    {chartData.every(d => d[trendMetric] === 0) ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            <TrendingUp className="w-12 h-12 mb-2 opacity-20" />
                            <p className="font-medium">No data logged for selected period</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={trendMetric === 'cost' ? '#10b981' : '#3b82f6'} stopOpacity={0.15} />
                                        <stop offset="95%" stopColor={trendMetric === 'cost' ? '#10b981' : '#3b82f6'} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 12, fill: '#64748b' }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickMargin={10}
                                />
                                <YAxis
                                    tick={{ fontSize: 12, fill: '#64748b' }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(val) => trendMetric === 'cost' ? `₹${val}` : val}
                                    width={60}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '8px', color: '#fff', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: '#cbd5e1', strokeDasharray: '4 4' }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey={trendMetric}
                                    stroke={trendMetric === 'cost' ? '#10b981' : '#3b82f6'}
                                    fillOpacity={1}
                                    fill="url(#colorValue)"
                                    strokeWidth={3}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* CTA Bar */}
            {propertyId && propertyId !== 'undefined' && (
                <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-3">
                    <button
                        onClick={() => setShowLogModal(true)}
                        className="h-14 w-14 rounded-full bg-slate-900 text-white shadow-xl hover:bg-black transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
                        title="Log Entry"
                    >
                        <Plus className="w-6 h-6" />
                    </button>
                </div>
            )}

            {/* Log Entry Modal */}
            <AnimatePresence>
                {showLogModal && propertyId && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-end"
                        onClick={() => setShowLogModal(false)}
                    >
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                            className="w-full max-w-4xl h-full bg-slate-50 overflow-y-auto"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
                                <div>
                                    <h2 className="text-xl font-black text-slate-900 tracking-tight">Log Water Data</h2>
                                    <p className="text-xs font-medium text-slate-500 mt-0.5">Record water received and manage sources</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowLogModal(false);
                                        fetchData(); // Refresh analytics when closing
                                    }}
                                    className="p-2.5 hover:bg-rose-50 hover:text-rose-600 rounded-xl transition-all border border-transparent hover:border-rose-100 bg-slate-50"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 pb-24">
                                <WaterDashboard propertyId={propertyId} />
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default WaterAnalyticsDashboard;
