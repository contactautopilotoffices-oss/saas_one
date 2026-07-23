'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    TrendingUp, Download, Zap, AlertTriangle,
    BarChart3, Plus, X, IndianRupee, Activity, ChevronDown, ShieldCheck, Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import ElectricityStaffDashboard from './ElectricityStaffDashboard';
import GridTariffModal from './GridTariffModal';
import ElectricityOCRModule from './ElectricityOCRModule';
import { ResponsiveContainer, Tooltip, XAxis, Area, AreaChart, YAxis, CartesianGrid } from 'recharts';
import { useDataCache } from '@/frontend/context/DataCacheContext';

interface ElectricityMeter {
    id: string;
    name: string;
    meter_number?: string;
    meter_type?: string;
}

interface ElectricityReading {
    id: string;
    meter_id: string;
    reading_date: string;
    created_at: string;
    opening_reading: number;
    closing_reading: number;
    computed_units: number; // raw units
    final_units: number;    // v2: multiplier applied
    computed_cost: number;
    tariff_rate_used: number;
    multiplier_value_used: number;
    multiplier_value?: number; // legacy
    meter: { name: string; meter_type: string };
}

interface TrendPoint {
    date: string;
    cost: number;
    units: number;
}

interface ElectricityAnalyticsDashboardProps {
    propertyId?: string;
    orgId?: string;
    properties?: { id: string; name: string }[];
}

const isValidId = (id?: string) => !!id && id !== 'undefined' && id !== 'null' && id !== 'all';

const ElectricityAnalyticsDashboard: React.FC<ElectricityAnalyticsDashboardProps> = ({ propertyId: propIdFromProps, orgId, properties = [] }) => {
    const params = useParams();
    const propertyId = propIdFromProps || (params?.propertyId as string);
    const supabase = useMemo(() => createClient(), []);
    const { getCachedData, setCachedData, invalidateCache } = useDataCache();

    // UI State
    const [viewMode, setViewMode] = useState<'main' | 'meter'>('main');
    const [selectedMeterId, setSelectedMeterId] = useState<string>('all');
    const [costTimeframe, setCostTimeframe] = useState<'today' | 'month'>('month');
    const [unitsTimeframe, setUnitsTimeframe] = useState<'today' | 'month'>('month');
    const [trendMetric, setTrendMetric] = useState<'cost' | 'units'>('cost');
    const [trendPeriod, setTrendPeriod] = useState<'7D' | '30D'>('7D');
    const [showLogModal, setShowLogModal] = useState(false);
    const [showTariffModal, setShowTariffModal] = useState(false);
    const [showOCRCenter, setShowOCRCenter] = useState(false);

    // Data State
    const [property, setProperty] = useState<{ name: string } | null>(null);
    const [meters, setMeters] = useState<ElectricityMeter[]>([]);
    const [categories, setCategories] = useState<any[]>([]);
    const [rawReadings, setRawReadings] = useState<{
        today: ElectricityReading[];
        month: ElectricityReading[];
        prevMonth: ElectricityReading[];
        trend: ElectricityReading[];
        custom: ElectricityReading[];
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
        
        const supabase = createClient();
        const cacheKey = isCustomRange && dateFrom && dateTo
            ? `electricity-analytics-${propertyId || orgId}-${dateFrom}-${dateTo}`
            : `electricity-analytics-${propertyId || orgId}`;
        const cached = getCachedData(cacheKey);

        if (cached) {
            console.log('[ElectricityAnalytics] Loading from cache:', propertyId || orgId);
            setProperty(cached.property);
            setMeters(cached.meters);
            setCategories(cached.categories || []);
            setActiveTariff(cached.activeTariff);
            setRawReadings(cached.rawReadings);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);

        let metersData: ElectricityMeter[] = [];
        let activeTariffValue = 0;
        let readingsData = { today: [] as ElectricityReading[], month: [] as ElectricityReading[], prevMonth: [] as ElectricityReading[], trend: [] as ElectricityReading[], custom: [] as ElectricityReading[] };
        let propData: { name: string } | null = property;

        try {
            // 1. Property Name
            if (isValidId(propertyId)) {
                const { data: fetchedPropData } = await supabase.from('properties').select('name').eq('id', propertyId).single();
                propData = fetchedPropData;
                setProperty(propData);
            }

            // 2. Meters
            let metersRes = null;
            if (isValidId(propertyId)) {
                metersRes = await fetch(`/api/properties/${propertyId}/electricity-meters`);
            } else if (isValidId(orgId)) {
                metersRes = await fetch(`/api/organizations/${orgId}/electricity-meters`);
            }

            if (metersRes && metersRes.ok) {
                metersData = await metersRes.json();
                if (Array.isArray(metersData)) {
                    setMeters(metersData);
                }
            }

            // 2.5 Categories (for Sheet/Location mapping)
            let categoriesData: any[] = [];
            if (isValidId(propertyId)) {
                try {
                    const layoutRes = await fetch(`/api/properties/${propertyId}/facility-meters`);
                    if (layoutRes.ok) {
                        const layoutData = await layoutRes.json();
                        if (Array.isArray(layoutData)) {
                            categoriesData = layoutData;
                            setCategories(categoriesData);
                        }
                    }
                } catch (err) {
                    console.warn("Failed to fetch facility layout", err);
                }
            }

            // 3. Tariff
            const today = new Date().toISOString().split('T')[0];
            if (isValidId(propertyId)) {
                const tariffRes = await fetch(`/api/properties/${propertyId}/grid-tariffs?date=${today}`);
                if (tariffRes && tariffRes.ok) {
                    const t = await tariffRes.json();
                    activeTariffValue = t?.rate_per_unit || 0;
                    setActiveTariff(activeTariffValue);
                }
            }

            // 4. Readings (Batch or separate)
            const readingsBaseUrl = isValidId(propertyId)
                ? `/api/properties/${propertyId}/electricity-readings`
                : isValidId(orgId)
                    ? `/api/organizations/${orgId}/electricity-readings`
                    : null;

            if (readingsBaseUrl) {
                const getLocalYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const now = new Date();
                const dates = {
                    today: today,
                    monthStart: getLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1)),
                    prevMonthStart: getLocalYMD(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
                    prevMonthEnd: getLocalYMD(new Date(now.getFullYear(), now.getMonth(), 0)),
                    trendStart: getLocalYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30))
                };

                const handleFetch = (url: string) => fetch(url).then(r => r.ok ? r.json() : []).catch(() => []);
                const fetchTasks: Promise<ElectricityReading[]>[] = [
                    handleFetch(`${readingsBaseUrl}?startDate=${dates.today}&endDate=${dates.today}`),
                    handleFetch(`${readingsBaseUrl}?startDate=${dates.monthStart}`),
                    handleFetch(`${readingsBaseUrl}?startDate=${dates.prevMonthStart}&endDate=${dates.prevMonthEnd}`),
                    handleFetch(`${readingsBaseUrl}?startDate=${dates.trendStart}`)
                ];

                // If custom range is active, also fetch custom range data
                if (isCustomRange && dateFrom && dateTo) {
                    fetchTasks.push(handleFetch(`${readingsBaseUrl}?startDate=${dateFrom}&endDate=${dateTo}`));
                }

                const [todayR, monthR, prevMonthR, trendR, customR] = await Promise.all(fetchTasks);

                readingsData = {
                    today: Array.isArray(todayR) ? todayR : [],
                    month: Array.isArray(monthR) ? monthR : [],
                    prevMonth: Array.isArray(prevMonthR) ? prevMonthR : [],
                    trend: Array.isArray(trendR) ? trendR : [],
                    custom: isCustomRange && Array.isArray(customR) ? customR : []
                };
                setRawReadings(readingsData);
            }

            // Update Cache
            setCachedData(cacheKey, {
                property: propData || property,
                meters: metersData,
                categories: categoriesData,
                activeTariff: activeTariffValue || activeTariff,
                rawReadings: readingsData
            });

        } catch (error) {
            console.error('Failed to load electricity data:', error);
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId, orgId, supabase, dateFrom, dateTo, isCustomRange]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const meterLayoutMap = useMemo(() => {
        const map: Record<string, { sheetName: string, locationName: string }> = {};
        categories.forEach(cat => {
            (cat.groups || []).forEach((group: any) => {
                (group.meters || []).forEach((m: any) => {
                    map[m.id] = { sheetName: cat.name, locationName: group.name };
                });
            });
        });
        return map;
    }, [categories]);

    // Derived Metrics based on View Filters
    const metrics = useMemo(() => {
        const mainMeterIds = new Set(meters.filter(m => m.meter_type === 'main').map(m => m.id));
        const filterFn = (r: ElectricityReading) => {
            if (viewMode === 'main') {
                if (mainMeterIds.size > 0) {
                    return mainMeterIds.has(r.meter_id);
                }
                return false; // Strict fallback: if no main meters, show nothing.
            }
            return r.meter_id === selectedMeterId;
        };

        const calc = (readings: ElectricityReading[]) => {
            return readings.filter(filterFn).reduce((acc, r) => {
                let cost = r.computed_cost || 0;
                if (cost === 0 && activeTariff > 0) {
                    cost = (r.final_units ?? r.computed_units ?? 0) * activeTariff;
                }
                return {
                    cost: acc.cost + cost,
                    units: acc.units + (r.final_units ?? r.computed_units ?? 0)
                };
            }, { cost: 0, units: 0 });
        };

        const today = calc(rawReadings.today);
        const month = calc(rawReadings.month);
        const prevMonth = calc(rawReadings.prevMonth);
        const custom = calc(rawReadings.custom);

        // Averages
        const avgCalc = (readings: ElectricityReading[]) => {
            const uniqueDays = new Set(readings.filter(filterFn).map(r => r.reading_date)).size || 1;
            const totals = calc(readings);
            return { cost: totals.cost / uniqueDays, units: totals.units / uniqueDays };
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
    }, [rawReadings, viewMode, selectedMeterId, activeTariff, isCustomRange]);

    // Derived Trend Data
    const chartData = useMemo(() => {
        const mainMeterIds = new Set(meters.filter(m => m.meter_type === 'main').map(m => m.id));
        const filterFn = (r: ElectricityReading) => {
            if (viewMode === 'main') {
                if (mainMeterIds.size > 0) {
                    return mainMeterIds.has(r.meter_id);
                }
                return false;
            }
            return r.meter_id === selectedMeterId;
        };

        // Custom range: iterate from dateFrom to dateTo
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
                    if (cost === 0 && activeTariff > 0) {
                        cost = (r.final_units ?? r.computed_units ?? 0) * activeTariff;
                    }
                    return {
                        cost: acc.cost + cost,
                        units: acc.units + (r.final_units ?? r.computed_units ?? 0)
                    };
                }, { cost: 0, units: 0 });

                result.push({ date: label, cost: dayTotals.cost, units: dayTotals.units });
            }
            return result;
        }

        // Default: last 7 or 30 days
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
                if (cost === 0 && activeTariff > 0) {
                    cost = (r.final_units ?? r.computed_units ?? 0) * activeTariff;
                }
                return {
                    cost: acc.cost + cost,
                    units: acc.units + (r.final_units ?? r.computed_units ?? 0)
                };
            }, { cost: 0, units: 0 });

            result.push({ date: label, cost: dayTotals.cost, units: dayTotals.units });
        }
        return result;
    }, [rawReadings.trend, rawReadings.custom, trendPeriod, viewMode, selectedMeterId, isCustomRange, dateFrom, dateTo, activeTariff]);

    // Format Helpers
    const fmtCost = (val: number, units?: number) => {
        if (val === 0 && (units === 0 || units === undefined)) return '—';
        return `₹${(val || 0).toLocaleString()}`;
    };
    const fmtUnits = (val: number) => {
        if (val === 0 || !val) return '—';
        return `${val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 3 })} kWh`;
    };

    // Current Display Values based on Toggles
    const displayCost = isCustomRange
        ? metrics.custom.cost
        : (costTimeframe === 'today' ? metrics.today.cost : metrics.month.cost);
    const displayUnits = isCustomRange
        ? metrics.custom.units
        : (unitsTimeframe === 'today' ? metrics.today.units : metrics.month.units);

    if (isLoading) return (
        <div className="space-y-8 animate-pulse">
            {/* Skeleton Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <div className="h-8 w-64 bg-slate-200 rounded-lg" />
                    <div className="flex items-center gap-3 mt-3">
                        <div className="h-5 w-32 bg-slate-200 rounded-full" />
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
                                <div className="h-3 w-20 bg-emerald-100 rounded" />
                                <div className="h-3 w-12 bg-emerald-100 rounded" />
                            </div>
                        </div>
                        <div className="h-7 w-28 bg-emerald-100/50 rounded-lg" />
                    </div>
                    <div className="h-8 w-32 bg-emerald-200/50 rounded-lg mt-4" />
                    <div className="h-1.5 w-12 bg-emerald-200 rounded-full mt-4 mb-4" />
                    <div className="h-3 w-24 bg-emerald-100 rounded mt-2" />
                </div>

                {/* Tile 2: Units Skeleton */}
                <div className="bg-[#eff6ff] rounded-2xl p-6 border border-blue-100">
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-100 rounded-full" />
                            <div className="space-y-1.5">
                                <div className="h-3 w-16 bg-blue-100 rounded" />
                                <div className="h-3 w-20 bg-blue-100 rounded" />
                            </div>
                        </div>
                        <div className="h-7 w-28 bg-blue-100/50 rounded-lg" />
                    </div>
                    <div className="h-8 w-36 bg-blue-200/50 rounded-lg mt-4" />
                    <div className="h-1.5 w-12 bg-blue-200 rounded-full mt-4 mb-4" />
                    <div className="h-3 w-28 bg-blue-100 rounded mt-2" />
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
                                Active Tariff: ₹{activeTariff}/kWh
                            </span>
                        ) : (
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full border border-amber-100 flex items-center gap-1.5 ">
                                    <AlertTriangle className="w-3 h-3" />
                                    No Active Tariff
                                </span>
                                <span className="text-[10px] text-slate-400 font-medium">Costs will show as ₹0</span>
                            </div>
                        )}
                        <span className="text-xs font-medium text-slate-400">
                            Updates daily based on logs
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        {propertyId && propertyId !== 'all' && (
                            <button
                                onClick={() => setShowTariffModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
                            >
                                <Plus className="w-4 h-4" />
                                Set Tariff
                            </button>
                        )}
                        <button
                            onClick={() => setShowLogModal(true)}
                            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-primary/20"
                        >
                            <Activity className="w-5 h-5" />
                            Log Entry
                        </button>
                        <button
                            onClick={() => setShowOCRCenter(true)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-black transition-all shadow-lg shadow-slate-900/10"
                        >
                            <ShieldCheck className="w-5 h-5 text-emerald-400" />
                            OCR Insights
                        </button>
                    </div>

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
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary text-white hover:bg-primary-dark transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
                        onClick={() => { setViewMode('main'); setSelectedMeterId('all'); }}
                        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'main' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Main
                    </button>
                    <div className="relative">
                        <button
                            onClick={() => { setViewMode('meter'); if (meters.length && selectedMeterId === 'all') setSelectedMeterId(meters[0].id); }}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${viewMode === 'meter' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            {viewMode === 'meter' && selectedMeterId !== 'all' 
                                ? (() => {
                                    const m = meters.find(m => m.id === selectedMeterId);
                                    if (!m) return 'Meter-wise';
                                    const layout = meterLayoutMap[m.id];
                                    return layout ? `${m.name} (${layout.sheetName} - ${layout.locationName})` : m.name;
                                })()
                                : 'Meter-wise'
                            }
                            {viewMode === 'meter' && <ChevronDown className="w-3 h-3" />}
                        </button>
                        {/* Meter Dropdown (Simple implementation) */}
                        {viewMode === 'meter' && (
                            <select
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                value={selectedMeterId}
                                onChange={(e) => setSelectedMeterId(e.target.value)}
                            >
                                {meters.map(m => {
                                    const layout = meterLayoutMap[m.id];
                                    const displayName = layout ? `${m.name} (${layout.sheetName} - ${layout.locationName})` : m.name;
                                    return (
                                        <option key={m.id} value={m.id}>{displayName}</option>
                                    );
                                })}
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
                        <span className="text-xs md:text-[10px] font-bold text-slate-700 uppercase tracking-widest block">ELECTRICITY COST</span>
                        {!isCustomRange && (
                            <div className="flex bg-slate-100/50 rounded-lg p-0.5 mt-1 justify-end">
                                <button onClick={() => setCostTimeframe('today')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${costTimeframe === 'today' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-emerald-600'}`}>Today</button>
                                <button onClick={() => setCostTimeframe('month')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${costTimeframe === 'month' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-emerald-600'}`}>Month</button>
                            </div>
                        )}
                    </div>
                    <div className="text-center mt-6">
                        <div className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                            {fmtCost(displayCost, displayUnits)}
                        </div>
                        <p className="text-[10px] md:text-[9px] font-medium text-slate-500 mt-1 uppercase tracking-wide truncate">
                            {isCustomRange
                                ? `${dateFrom} to ${dateTo}`
                                : (costTimeframe === 'today' ? 'Total today' : 'Total this month')}
                        </p>
                    </div>
                </div>

                {/* Tile 2: Units (Secondary) */}
                <div className="bg-[#eff6ff] rounded-2xl p-5 md:p-4 shadow-sm border border-blue-100 relative flex flex-col items-center justify-center md:h-[150px]">
                    <div className="absolute top-4 left-4">
                        <span className="p-2.5 md:p-2 bg-blue-50 rounded-full text-blue-600 flex items-center justify-center">
                            <Zap className="w-5 h-5 md:w-4 md:h-4" />
                        </span>
                    </div>
                    <div className="absolute top-4 right-4 text-right">
                        <span className="text-xs md:text-[10px] font-bold text-slate-700 uppercase tracking-widest block">UNITS CONSUMED</span>
                        {!isCustomRange && (
                            <div className="flex bg-slate-100/50 rounded-lg p-0.5 mt-1 justify-end">
                                <button onClick={() => setUnitsTimeframe('today')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${unitsTimeframe === 'today' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-blue-600'}`}>Today</button>
                                <button onClick={() => setUnitsTimeframe('month')} className={`px-2 py-0.5 text-[8px] font-bold rounded-md transition-all ${unitsTimeframe === 'month' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-blue-600'}`}>Month</button>
                            </div>
                        )}
                    </div>
                    <div className="text-center mt-6">
                        <div className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                            {fmtUnits(displayUnits)}
                        </div>
                        <p className="text-[10px] md:text-[9px] font-medium text-slate-500 mt-1 uppercase tracking-wide truncate">
                            {isCustomRange
                                ? `${dateFrom} to ${dateTo}`
                                : (unitsTimeframe === 'today' ? 'Total consumption' : 'Total consumption')}
                        </p>
                    </div>
                </div>

                {/* Tile 3: Averages */}
                <div className="bg-[#fff7ed] rounded-2xl p-5 md:p-4 shadow-sm border border-orange-100 relative flex flex-col items-center justify-center md:h-[150px]">
                    <div className="absolute top-4 left-4">
                        <span className="p-2.5 md:p-2 bg-orange-50 rounded-full text-orange-500 flex items-center justify-center">
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
                                <div className="text-xl md:text-lg font-black text-slate-900 leading-none">{fmtCost(metrics.averages.cost, metrics.averages.units)}</div>
                            </div>
                            <div className="h-px w-full bg-slate-100" />
                            <div className="flex justify-between items-end">
                                <span className="text-[10px] md:text-[9px] text-slate-500 block">Avg Daily Units</span>
                                <div className="text-xl md:text-lg font-black text-slate-900 flex items-baseline gap-1 leading-none">
                                {fmtUnits(metrics.averages.units)}
                            </div>
                        </div>
                    </div>
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
                            <button onClick={() => setTrendMetric('cost')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${trendMetric === 'cost' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}>
                                <IndianRupee className="w-3 h-3" /> Cost
                            </button>
                            <button onClick={() => setTrendMetric('units')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${trendMetric === 'units' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                                <Zap className="w-3 h-3" /> Units
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
                                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={trendMetric === 'cost' ? '#3b82f6' : '#64748b'} stopOpacity={0.1} />
                                        <stop offset="95%" stopColor={trendMetric === 'cost' ? '#3b82f6' : '#64748b'} stopOpacity={0} />
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
                                    stroke={trendMetric === 'cost' ? '#3b82f6' : '#64748b'}
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
                    <button
                        onClick={() => {
                            const now = new Date();
                            const today = now.toISOString().split('T')[0];
                            const monthAgoDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                            const monthAgo = `${monthAgoDate.getFullYear()}-${String(monthAgoDate.getMonth() + 1).padStart(2, '0')}-${String(monthAgoDate.getDate()).padStart(2, '0')}`;
                            window.open(`/api/properties/${propertyId}/electricity-export?startDate=${monthAgo}&endDate=${today}`, '_blank');
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
                            <div className="sticky top-0 right-0 z-10 flex justify-end p-4">
                                <button onClick={() => { 
                                    setShowLogModal(false); 
                                    invalidateCache(`electricity-analytics-${propertyId || orgId}`);
                                    fetchData(); 
                                }} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors">
                                    <X className="w-5 h-5 text-slate-500" />
                                </button>
                            </div>
                            <div className="px-4 pb-4 -mt-4">
                                <ElectricityStaffDashboard propertyId={propertyId} isEmbedded />
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            {/* Grid Tariff Modal */}
            {propertyId && propertyId !== 'all' && (
                <GridTariffModal
                    isOpen={showTariffModal}
                    onClose={() => {
                        setShowTariffModal(false);
                        invalidateCache(`electricity-analytics-${propertyId || orgId}`);
                        fetchData();
                    }}
                    propertyId={propertyId}
                />
            )}
            {/* OCR Control Center View - Absolute to stay within dashboard content area */}
            <AnimatePresence>
                {showOCRCenter && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="absolute inset-0 z-[60] bg-[#0d1117] overflow-y-auto"
                    >
                        <ElectricityOCRModule 
                            readings={rawReadings.month as any} 
                            onBack={() => setShowOCRCenter(false)} 
                            properties={properties}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ElectricityAnalyticsDashboard;
