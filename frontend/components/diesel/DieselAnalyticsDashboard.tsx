'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Calendar, TrendingUp, Download, Fuel, AlertTriangle,
    BarChart3, Plus, X, IndianRupee, Activity, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import { useDataCache } from '@/frontend/context/DataCacheContext';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, Area, AreaChart, YAxis, CartesianGrid } from 'recharts';
import DGTariffModal from './DGTariffModal';
import DieselStaffDashboard from './DieselStaffDashboard';

interface Generator {
    id: string;
    name: string;
    capacity_kva?: number;
}

interface DieselReading {
    id: string;
    generator_id: string;
    reading_date: string;
    opening_hours: number;
    closing_hours: number;
    opening_kwh?: number;
    closing_kwh?: number;
    diesel_added_litres: number;
    computed_consumed_litres: number;
    computed_cost: number;
    tariff_rate: number;
    tariff_rate_used?: number; // Backend field
    generator: { name: string; capacity_kva?: number };
}

interface TrendPoint {
    date: string;
    cost: number;
    litres: number;
    kwh: number;
}

const isValidId = (id?: string) => !!id && id !== 'undefined' && id !== 'null' && id !== 'all';

interface DieselAnalyticsDashboardProps {
    propertyId?: string;
    orgId?: string;
}

const DieselAnalyticsDashboard: React.FC<DieselAnalyticsDashboardProps> = ({ propertyId: propIdFromProps, orgId }) => {
    const params = useParams();
    const propertyId = propIdFromProps || (params?.propertyId as string);
    const supabase = useMemo(() => createClient(), []);
    const { getCachedData, setCachedData, invalidateCache } = useDataCache();

    // UI State
    const [viewMode, setViewMode] = useState<'combined' | 'generator'>('combined');
    const [selectedGenId, setSelectedGenId] = useState<string>('all');
    const [costTimeframe, setCostTimeframe] = useState<'today' | 'month'>('month');
    const [litresTimeframe, setLitresTimeframe] = useState<'today' | 'month'>('month');
    const [kwhTimeframe, setKwhTimeframe] = useState<'today' | 'month'>('month');
    const [trendMetric, setTrendMetric] = useState<'cost' | 'litres' | 'kwh'>('cost');
    const [trendPeriod, setTrendPeriod] = useState<'7D' | '30D'>('7D');
    const [showLogModal, setShowLogModal] = useState(false);
    const [showTariffModal, setShowTariffModal] = useState(false);

    // Data State
    const [property, setProperty] = useState<{ name: string } | null>(null);
    const [generators, setGenerators] = useState<Generator[]>([]);
    const [rawReadings, setRawReadings] = useState<{
        today: DieselReading[];
        month: DieselReading[];
        prevMonth: DieselReading[];
        trend: DieselReading[];
        custom: DieselReading[];
    }>({ today: [], month: [], prevMonth: [], trend: [], custom: [] });

    // Date Range Filter State
    const todayStr = new Date().toISOString().split('T')[0];
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');
    const [pendingDateFrom, setPendingDateFrom] = useState<string>('');
    const [pendingDateTo, setPendingDateTo] = useState<string>('');
    const [isCustomRange, setIsCustomRange] = useState(false);

    const [activeTariff, setActiveTariff] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch Initial Data
    const fetchData = useCallback(async () => {
        if (!isValidId(propertyId) && !isValidId(orgId)) return;
        
        const cacheKey = isCustomRange && dateFrom && dateTo
            ? `diesel-analytics-${propertyId || orgId}-${dateFrom}-${dateTo}`
            : `diesel-analytics-${propertyId || orgId}`;
        const cached = getCachedData(cacheKey);

        if (cached) {
            console.log('[DieselAnalytics] Loading from cache:', propertyId || orgId);
            if (cached.property) setProperty(cached.property);
            if (cached.generators) setGenerators(cached.generators);
            if (cached.activeTariff !== undefined) setActiveTariff(cached.activeTariff);
            if (cached.rawReadings) setRawReadings(cached.rawReadings);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);

        let propData = property;
        let gensData: Generator[] = [];
        let activeTariffValue = 0;
        let readingsData = { today: [], month: [], prevMonth: [], trend: [], custom: [] };

        try {
            // 1. Property Name (if propertyId exists)
            if (isValidId(propertyId)) {
                const { data } = await supabase.from('properties').select('name').eq('id', propertyId).single();
                setProperty(data);
            }

            // 2. Generators
            let gensRes = null;
            if (isValidId(propertyId)) {
                gensRes = await fetch(`/api/properties/${propertyId}/generators`);
            } else if (isValidId(orgId)) {
                gensRes = await fetch(`/api/organizations/${orgId}/generators`);
            }

            let gens = [];
            if (gensRes && gensRes.ok) {
                gens = await gensRes.json();
                if (Array.isArray(gens)) {
                    setGenerators(gens);
                }
            }

            // 3. Current Tariff (Property required for specific tariff, or find first available)
            const today = new Date().toISOString().split('T')[0];
            if (isValidId(propertyId) && Array.isArray(gens) && gens.length > 0) {
                let tariffFound = false;
                for (const gen of gens) {
                    const tariffRes = await fetch(`/api/properties/${propertyId}/dg-tariffs?generatorId=${gen.id}&date=${today}`);
                    if (tariffRes.ok) {
                        const t = await tariffRes.json();
                        if (t && t.cost_per_litre) {
                            activeTariffValue = t.cost_per_litre;
                            setActiveTariff(activeTariffValue);
                            tariffFound = true;
                            break;
                        }
                    }
                }
                if (!tariffFound) {
                    activeTariffValue = 0;
                    setActiveTariff(0);
                }
            }

            // 4. Readings (Batch or separate)
            // Fetch based on Property or Organization
            const readingsBaseUrl = isValidId(propertyId)
                ? `/api/properties/${propertyId}/diesel-readings`
                : isValidId(orgId)
                    ? `/api/organizations/${orgId}/diesel-readings`
                    : null;

            if (!readingsBaseUrl) {
                setRawReadings({ today: [], month: [], prevMonth: [], trend: [], custom: [] });
                return;
            }

            const fetchTasks: Promise<DieselReading[]>[] = [
                fetch(`${readingsBaseUrl}?period=today`).then(r => r.json()).catch(() => []),
                fetch(`${readingsBaseUrl}?startDate=${new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]}`).then(r => r.json()).catch(() => []),
                fetch(`${readingsBaseUrl}?startDate=${new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split('T')[0]}&endDate=${new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().split('T')[0]}`).then(r => r.json()).catch(() => []),
                fetch(`${readingsBaseUrl}?startDate=${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}`).then(r => r.json()).catch(() => [])
            ];

            if (isCustomRange && dateFrom && dateTo) {
                fetchTasks.push(fetch(`${readingsBaseUrl}?startDate=${dateFrom}&endDate=${dateTo}`).then(r => r.json()).catch(() => []));
            }

            const [todayR, monthR, prevMonthR, trendR, customR] = await Promise.all(fetchTasks);

            const newRawReadings = {
                today: Array.isArray(todayR) ? todayR : [],
                month: Array.isArray(monthR) ? monthR : [],
                prevMonth: Array.isArray(prevMonthR) ? prevMonthR : [],
                trend: Array.isArray(trendR) ? trendR : [],
                custom: isCustomRange && Array.isArray(customR) ? customR : []
            };

            setRawReadings(newRawReadings);

            setCachedData(cacheKey, {
                property: propData,
                generators: gens,
                activeTariff: activeTariffValue,
                rawReadings: newRawReadings
            });

        } catch (error) {
            console.error('Failed to load diesel data:', error);
        } finally {
            setIsLoading(false);
        }
    }, [propertyId, orgId, dateFrom, dateTo, isCustomRange, getCachedData, setCachedData]);

    useEffect(() => {
        if (!isValidId(propertyId) && !isValidId(orgId)) return;
        fetchData();
    }, [fetchData]);

    // Derived Metrics
    const metrics = useMemo(() => {
        const filterFn = (r: DieselReading) => {
            if (viewMode === 'combined') return true;
            return r.generator_id === selectedGenId;
        };

        const calc = (readings: DieselReading[]) => {
            return readings.filter(filterFn).reduce((acc, r) => {
                let cost = r.computed_cost || 0;
                const rate = r.tariff_rate || r.tariff_rate_used || activeTariff || 0;
                
                const consumedKwh = (r.closing_kwh || 0) - (r.opening_kwh || 0);
                const consumedLitres = r.computed_consumed_litres || 0;

                return {
                    cost: acc.cost + cost,
                    litres: acc.litres + consumedLitres,
                    kwh: (acc.kwh || 0) + (consumedKwh > 0 ? consumedKwh : 0)
                };
            }, { cost: 0, litres: 0, kwh: 0 });
        };

        const today = calc(rawReadings.today);
        const month = calc(rawReadings.month);
        const prevMonth = calc(rawReadings.prevMonth);
        const custom = calc(rawReadings.custom);

        const avgCalc = (readings: DieselReading[]) => {
            const uniqueDays = new Set(readings.filter(filterFn).map(r => r.reading_date)).size || 1;
            const totals = calc(readings);
            return { cost: totals.cost / uniqueDays, litres: totals.litres / uniqueDays, kwh: totals.kwh / uniqueDays };
        };

        const monthAvgs = avgCalc(rawReadings.month);
        const customAvgs = isCustomRange ? avgCalc(rawReadings.custom) : monthAvgs;

        return {
            today,
            month,
            prevMonth,
            custom,
            averages: isCustomRange ? customAvgs : monthAvgs
        };
    }, [rawReadings, viewMode, selectedGenId, isCustomRange, activeTariff]);

    // Derived Trend Data
    const chartData = useMemo(() => {
        const filterFn = (r: DieselReading) => {
            if (viewMode === 'combined') return true;
            return r.generator_id === selectedGenId;
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

                const dayReadings = relevantReadings.filter(r => r.reading_date === dateStr);
                const dayTotals = dayReadings.reduce((acc, r) => {
                    let cost = r.computed_cost || 0;
                    const rate = r.tariff_rate || r.tariff_rate_used || activeTariff || 0;
                    
                    const consumedKwh = (r.closing_kwh || 0) - (r.opening_kwh || 0);
                    const consumedLitres = r.computed_consumed_litres || 0;

                    return {
                        cost: acc.cost + cost,
                        litres: acc.litres + consumedLitres,
                        kwh: (acc.kwh || 0) + (consumedKwh > 0 ? consumedKwh : 0)
                    };
                }, { cost: 0, litres: 0, kwh: 0 });

                result.push({ date: label, cost: Math.round(dayTotals.cost), litres: Math.round(dayTotals.litres), kwh: Math.round(dayTotals.kwh) });
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

            const dayReadings = relevantReadings.filter(r => r.reading_date === dateStr);
            const dayTotals = dayReadings.reduce((acc, r) => {
                let cost = r.computed_cost || 0;
                const rate = r.tariff_rate || r.tariff_rate_used || activeTariff || 0;
                
                const consumedKwh = (r.closing_kwh || 0) - (r.opening_kwh || 0);
                const consumedLitres = r.computed_consumed_litres || 0;

                return {
                    cost: acc.cost + cost,
                    litres: acc.litres + consumedLitres,
                    kwh: (acc.kwh || 0) + (consumedKwh > 0 ? consumedKwh : 0)
                };
            }, { cost: 0, litres: 0, kwh: 0 });

            result.push({
                date: label,
                cost: Math.round(dayTotals.cost),
                litres: Math.round(dayTotals.litres),
                kwh: Math.round(dayTotals.kwh)
            });
        }
        return result;
    }, [rawReadings.trend, rawReadings.custom, trendPeriod, viewMode, selectedGenId, isCustomRange, dateFrom, dateTo, activeTariff]);

    // Format Helpers
    const fmtCost = (val: number) => val > 0 ? `₹${val.toLocaleString()}` : '—';
    const fmtLitres = (val: number) => val > 0 ? `${Math.round(val).toLocaleString()} L` : '—';

    // Current Display Values
    const displayCost = isCustomRange
        ? metrics.custom.cost
        : (costTimeframe === 'today' ? metrics.today.cost : metrics.month.cost);
    const displayLitres = isCustomRange
        ? metrics.custom.litres
        : (litresTimeframe === 'today' ? metrics.today.litres : metrics.month.litres);
    const displayKwh = isCustomRange
        ? metrics.custom.kwh
        : (kwhTimeframe === 'today' ? metrics.today.kwh : metrics.month.kwh);

    if (isLoading) return (
        <div className="space-y-8 animate-pulse">
            {/* Skeleton Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <div className="h-8 w-56 bg-slate-200 rounded-lg" />
                    <div className="flex items-center gap-3 mt-3">
                        <div className="h-5 w-36 bg-slate-200 rounded-full" />
                        <div className="h-4 w-40 bg-slate-100 rounded" />
                    </div>
                </div>
                <div className="h-9 w-48 bg-slate-200 rounded-lg" />
            </div>

            {/* Skeleton 3-Tile Layout */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Tile 1: Cost Skeleton */}
                <div className="bg-[#ecfdf5] rounded-2xl p-6 border border-emerald-100">
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-100 rounded-full" />
                            <div className="space-y-1.5">
                                <div className="h-3 w-16 bg-emerald-100 rounded" />
                                <div className="h-3 w-12 bg-emerald-100 rounded" />
                            </div>
                        </div>
                        <div className="h-7 w-28 bg-emerald-100/50 rounded-lg" />
                    </div>
                    <div className="h-8 w-32 bg-emerald-200/50 rounded-lg mt-4" />
                    <div className="h-1.5 w-12 bg-emerald-200 rounded-full mt-4 mb-4" />
                    <div className="h-3 w-24 bg-emerald-100 rounded mt-2" />
                </div>

                {/* Tile 2: Litres Skeleton */}
                <div className="bg-[#fffbeb] rounded-2xl p-6 border border-amber-100">
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-amber-100 rounded-full" />
                            <div className="space-y-1.5">
                                <div className="h-3 w-16 bg-amber-100 rounded" />
                                <div className="h-3 w-20 bg-amber-100 rounded" />
                            </div>
                        </div>
                        <div className="h-7 w-28 bg-amber-100/50 rounded-lg" />
                    </div>
                    <div className="h-8 w-36 bg-amber-200/50 rounded-lg mt-4" />
                    <div className="h-1.5 w-12 bg-amber-200 rounded-full mt-4 mb-4" />
                    <div className="h-3 w-28 bg-amber-100 rounded mt-2" />
                </div>

                {/* Tile 3: Averages Skeleton */}
                <div className="bg-[#fff7ed] rounded-2xl p-6 border border-orange-100">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-orange-100 rounded-full" />
                        <div className="space-y-1.5">
                            <div className="h-3 w-14 bg-orange-100 rounded" />
                            <div className="h-3 w-18 bg-orange-100 rounded" />
                        </div>
                    </div>
                    <div className="space-y-5">
                        <div>
                            <div className="h-7 w-24 bg-orange-200/50 rounded-lg" />
                            <div className="h-1 w-8 bg-orange-200 rounded-full mt-2" />
                        </div>
                        <div>
                            <div className="h-6 w-28 bg-orange-200/40 rounded-lg" />
                            <div className="h-1 w-8 bg-orange-200 rounded-full mt-2" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Skeleton Trends Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                    <div>
                        <div className="h-5 w-44 bg-slate-200 rounded" />
                        <div className="h-4 w-56 bg-slate-100 rounded mt-2" />
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="h-8 w-32 bg-slate-100 rounded-lg" />
                        <div className="h-8 w-28 bg-slate-100 rounded-lg" />
                    </div>
                </div>
                <div className="h-[300px] w-full flex items-end gap-2 px-4">
                    {[40, 65, 35, 80, 55, 70, 45].map((h, i) => (
                        <div key={i} className="flex-1 bg-slate-100 rounded-t-md" style={{ height: `${h}%` }} />
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        {activeTariff > 0 ? (
                            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">
                                Active Tariff: ₹{activeTariff}/L
                            </span>
                        ) : (
                            <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full border border-amber-100 flex items-center gap-1.5 animate-pulse">
                                <AlertTriangle className="w-3 h-3" />
                                No Tariff Configured - Costs will show as ₹0
                            </span>
                        )}
                        <span className="text-xs font-medium text-slate-400">
                            Updates daily based on logs
                        </span>
                    </div>
                    {propertyId && propertyId !== 'all' && (
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowTariffModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
                            >
                                <Plus className="w-4 h-4 text-emerald-500" />
                                Set Tariff
                            </button>
                        </div>
                    )}

                    {/* Date Range Filter */}
                    <div className="flex items-center gap-2 mt-3">
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1.5">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            <input
                                type="date"
                                value={pendingDateFrom}
                                max={pendingDateTo || todayStr}
                                onChange={(e) => setPendingDateFrom(e.target.value)}
                                className="text-xs font-medium text-slate-700 bg-transparent border-none outline-none focus:ring-0"
                            />
                            <span className="text-xs text-slate-400">to</span>
                            <input
                                type="date"
                                value={pendingDateTo}
                                min={pendingDateFrom}
                                max={todayStr}
                                onChange={(e) => setPendingDateTo(e.target.value)}
                                className="text-xs font-medium text-slate-700 bg-transparent border-none outline-none focus:ring-0"
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
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-orange-600 text-white hover:bg-orange-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
                                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all"
                            >
                                Reset
                            </button>
                        )}
                    </div>
                </div>

                {/* Scope Toggle */}
                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                        onClick={() => { setViewMode('combined'); setSelectedGenId('all'); }}
                        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'combined' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Combined
                    </button>
                    <div className="relative">
                        <button
                            onClick={() => { setViewMode('generator'); if (generators.length && selectedGenId === 'all') setSelectedGenId(generators[0].id); }}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${viewMode === 'generator' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Generator-wise
                            {viewMode === 'generator' && <ChevronDown className="w-3 h-3" />}
                        </button>
                        {viewMode === 'generator' && (
                            <select
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                value={selectedGenId}
                                onChange={(e) => setSelectedGenId(e.target.value)}
                            >
                                {generators.map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>
            </div>

            {/* 3-Tile Layout */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Tile 1: Cost (Primary) */}
                <div className="bg-[#ecfdf5] rounded-2xl p-5 md:p-4 shadow-sm border border-emerald-100 relative flex flex-col items-center justify-center md:h-[150px]">
                    <div className="absolute top-4 left-4">
                        <span className="p-2.5 md:p-2 bg-emerald-50 rounded-full text-emerald-600 flex items-center justify-center">
                            <IndianRupee className="w-5 h-5 md:w-4 md:h-4" />
                        </span>
                    </div>
                    <div className="absolute top-4 right-4 text-right">
                        <span className="text-xs md:text-[10px] font-bold text-slate-700 uppercase tracking-widest block">DIESEL COST</span>
                        {!isCustomRange && (
                            <div className="flex bg-slate-100/50 rounded-lg p-0.5 mt-1 justify-end">
                                <button onClick={() => setCostTimeframe('today')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${costTimeframe === 'today' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-emerald-600'}`}>Today</button>
                                <button onClick={() => setCostTimeframe('month')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${costTimeframe === 'month' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-emerald-600'}`}>Month</button>
                            </div>
                        )}
                    </div>
                    <div className="text-center mt-6">
                        <div className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                            {fmtCost(displayCost)}
                        </div>
                        <p className="text-[10px] md:text-[9px] font-medium text-slate-500 mt-1 uppercase tracking-wide truncate">
                            {isCustomRange
                                ? `${dateFrom} to ${dateTo}`
                                : (costTimeframe === 'today' ? 'Total today' : 'Total this month')}
                        </p>
                    </div>
                </div>

                {/* Tile 2: Litres (Secondary) */}
                <div className="bg-[#fffbeb] rounded-2xl p-5 md:p-4 shadow-sm border border-amber-100 relative flex flex-col items-center justify-center md:h-[150px]">
                    <div className="absolute top-4 left-4">
                        <span className="p-2.5 md:p-2 bg-amber-50 rounded-full text-amber-600 flex items-center justify-center">
                            <Fuel className="w-5 h-5 md:w-4 md:h-4" />
                        </span>
                    </div>
                    <div className="absolute top-4 right-4 text-right">
                        <span className="text-xs md:text-[10px] font-bold text-slate-700 uppercase tracking-widest block">LITRES CONSUMED</span>
                        {!isCustomRange && (
                            <div className="flex bg-slate-100/50 rounded-lg p-0.5 mt-1 justify-end">
                                <button onClick={() => setLitresTimeframe('today')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${litresTimeframe === 'today' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400 hover:text-amber-600'}`}>Today</button>
                                <button onClick={() => setLitresTimeframe('month')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${litresTimeframe === 'month' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400 hover:text-amber-600'}`}>Month</button>
                            </div>
                        )}
                    </div>
                    <div className="text-center mt-6">
                        <div className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                            {fmtLitres(displayLitres)}
                        </div>
                        <p className="text-[10px] md:text-[9px] font-medium text-slate-500 mt-1 uppercase tracking-wide truncate">
                            {isCustomRange
                                ? `${dateFrom} to ${dateTo}`
                                : (litresTimeframe === 'today' ? 'Consumed today' : 'Consumed this month')}
                        </p>
                    </div>
                </div>

                {/* Tile 3: KWH Readings */}
                <div className="bg-[#fff7ed] rounded-2xl p-5 md:p-4 shadow-sm border border-orange-100 relative flex flex-col items-center justify-center md:h-[150px]">
                    <div className="absolute top-4 left-4">
                        <span className="p-2.5 md:p-2 bg-orange-50 rounded-full text-orange-500 flex items-center justify-center">
                            <Activity className="w-5 h-5 md:w-4 md:h-4" />
                        </span>
                    </div>
                    <div className="absolute top-4 right-4 text-right">
                        <span className="text-xs md:text-[10px] font-bold text-slate-700 uppercase tracking-widest block">KWH READINGS</span>
                        {!isCustomRange && (
                            <div className="flex bg-slate-100/50 rounded-lg p-0.5 mt-1 justify-end">
                                <button onClick={() => setKwhTimeframe('today')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${kwhTimeframe === 'today' ? 'bg-white text-orange-500 shadow-sm' : 'text-slate-400 hover:text-orange-500'}`}>Today</button>
                                <button onClick={() => setKwhTimeframe('month')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${kwhTimeframe === 'month' ? 'bg-white text-orange-500 shadow-sm' : 'text-slate-400 hover:text-orange-500'}`}>Month</button>
                            </div>
                        )}
                    </div>
                    <div className="text-center mt-6">
                        <div className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                            {displayKwh > 0 ? `${Math.round(displayKwh).toLocaleString()} kWh` : '-'}
                        </div>
                        <p className="text-[10px] md:text-[9px] font-medium text-slate-500 mt-1 uppercase tracking-wide truncate">
                            {isCustomRange
                                ? `${dateFrom} to ${dateTo}`
                                : (kwhTimeframe === 'today' ? 'Readings today' : 'Readings this month')}
                        </p>
                    </div>
                </div>
            </div>

            {/* Trends Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900">Consumption Trends</h3>
                        <p className="text-sm text-slate-500">
                            {isCustomRange
                                ? `Showing data from ${dateFrom} to ${dateTo}`
                                : 'Analyze usage patterns over time'}
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        {/* Metric Toggle */}
                        <div className="flex bg-slate-100 rounded-lg p-1">
                            <button onClick={() => setTrendMetric('cost')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${trendMetric === 'cost' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>
                                <IndianRupee className="w-3 h-3" /> Cost
                            </button>
                            <button onClick={() => setTrendMetric('litres')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${trendMetric === 'litres' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                                <Fuel className="w-3 h-3" /> Litres
                            </button>
                            <button onClick={() => setTrendMetric('kwh')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${trendMetric === 'kwh' ? 'bg-white text-orange-500 shadow-sm' : 'text-slate-500'}`}>
                                <Activity className="w-3 h-3" /> kWh
                            </button>
                        </div>
                        {/* Period Toggle */}
                        <div className="flex gap-2">
                            <button onClick={() => setTrendPeriod('7D')} className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${trendPeriod === '7D' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>7 Days</button>
                            <button onClick={() => setTrendPeriod('30D')} className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${trendPeriod === '30D' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>30 Days</button>
                        </div>
                    </div>
                </div>

                {/* Chart */}
                <div className="h-[300px] w-full">
                    {chartData.every(d => d[trendMetric] === 0) ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <TrendingUp className="w-12 h-12 mb-2 opacity-20" />
                            <p className="font-medium">No data logged for selected period</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="colorValueDiesel" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={trendMetric === 'cost' ? '#10b981' : '#64748b'} stopOpacity={0.1} />
                                        <stop offset="95%" stopColor={trendMetric === 'cost' ? '#10b981' : '#64748b'} stopOpacity={0} />
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
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                                    itemStyle={{ color: '#fff' }}
                                    cursor={{ stroke: '#cbd5e1', strokeDasharray: '4 4' }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey={trendMetric}
                                    stroke={trendMetric === 'cost' ? '#10b981' : (trendMetric === 'kwh' ? '#f97316' : '#64748b')}
                                    fillOpacity={1}
                                    fill="url(#colorValueDiesel)"
                                    strokeWidth={3}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
                {/* Average Unit Placeholder */}
                <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-6 text-xs font-bold text-slate-500 bg-slate-50 p-4 rounded-xl shadow-inner">
                    <span className="flex items-center gap-2 text-slate-700">
                        <BarChart3 className="w-4 h-4 text-emerald-500" />
                        Avg Daily Cost: <span className="text-emerald-600">{fmtCost(Math.round(metrics.averages.cost))}</span>
                    </span>
                    <span className="flex items-center gap-2 text-slate-700">
                        <Fuel className="w-4 h-4 text-amber-500" />
                        Avg Daily Litres: <span className="text-amber-600">{fmtLitres(Math.round(metrics.averages.litres))}</span>
                    </span>
                    <span className="flex items-center gap-2 text-slate-700">
                        <Activity className="w-4 h-4 text-orange-500" />
                        Avg Daily kWh: <span className="text-orange-600">{Math.round(metrics.averages.kwh).toLocaleString()} kWh</span>
                    </span>
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
                    <button
                        onClick={() => {
                            const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                            const today = new Date().toISOString().split('T')[0];
                            window.open(`/api/properties/${propertyId}/diesel-export?startDate=${monthAgo}&endDate=${today}`, '_blank');
                        }}
                        className="h-14 w-14 rounded-full bg-white text-slate-900 shadow-xl border border-slate-200 hover:bg-slate-50 transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
                        title="Export Report"
                    >
                        <Download className="w-6 h-6" />
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
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="h-full w-full max-w-4xl bg-white shadow-2xl overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="absolute top-4 right-4 z-10">
                                <button onClick={() => { setShowLogModal(false); fetchData(); }} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors">
                                    <X className="w-5 h-5 text-slate-500" />
                                </button>
                            </div>
                            <div className="p-2">
                                <DieselStaffDashboard propertyId={propertyId} />
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            {/* Diesel Tariff Modal */}
            {propertyId && propertyId !== 'all' && (
                <DGTariffModal
                    isOpen={showTariffModal}
                    onClose={() => {
                        setShowTariffModal(false);
                        fetchData();
                    }}
                    propertyId={propertyId}
                    generators={generators}
                />
            )}
        </div>
    );
};

export default DieselAnalyticsDashboard;
