'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import {
    Activity, ShieldCheck, BatteryCharging, Factory,
    CheckCircle2, AlertCircle, RefreshCcw, Box, ClipboardCheck, X, Calendar
} from 'lucide-react';
import { HapticCard } from '../ui/HapticCard';

interface DailyProgressDashboardProps {
    isDark?: boolean;
}

export default function DailyProgressDashboard({ isDark = false }: DailyProgressDashboardProps) {
    const supabase = createClient();
    const [isLoading, setIsLoading] = useState(true);
    const [progressData, setProgressData] = useState<any[]>([]);
    const [drillDown, setDrillDown] = useState<
        | { type: 'checklist'; propertyId: string; propertyName: string }
        | { type: 'electricity'; propertyId: string; propertyName: string }
        | { type: 'diesel'; propertyId: string; propertyName: string }
        | null
    >(null);
    const [checklistDetails, setChecklistDetails] = useState<{ id: string; title: string; category: string | null; done: boolean }[]>([]);
    const [meterDetails, setMeterDetails] = useState<{ id: string; name: string; sheet_name: string | null; location: string | null; done: boolean }[]>([]);
    const [checklistLoading, setChecklistLoading] = useState(false);
    const [metersLoading, setMetersLoading] = useState(false);
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

    useEffect(() => {
        fetchDailyProgress();
    }, [selectedDate]);

    const fetchDailyProgress = async () => {
        setIsLoading(true);
        try {
            // Fetch all active properties
            const { data: properties, error: propError } = await supabase
                .from('properties')
                .select('id, name, code')
                .eq('is_active', true);

            if (propError || !properties) throw propError;

            const today = selectedDate;
            const startOfToday = new Date(selectedDate);
            startOfToday.setHours(0, 0, 0, 0);
            const isoStart = startOfToday.toISOString();

            const progress = await Promise.all(properties.map(async (property) => {
                // Electricity
                const { count: elecMetersTotal } = await supabase
                    .from('electricity_meters')
                    .select('*', { count: 'exact', head: true })
                    .eq('property_id', property.id)
                    .is('deleted_at', null);

                const { count: elecReadingsToday } = await supabase
                    .from('electricity_readings')
                    .select('*', { count: 'exact', head: true })
                    .eq('property_id', property.id)
                    .eq('reading_date', today);

                // DG
                const { count: dgMetersTotal } = await supabase
                    .from('generators')
                    .select('*', { count: 'exact', head: true })
                    .eq('property_id', property.id)
                    .eq('status', 'active');

                const { count: dgReadingsToday } = await supabase
                    .from('diesel_readings')
                    .select('*', { count: 'exact', head: true })
                    .eq('property_id', property.id)
                    .eq('reading_date', today);

                // Stock
                const { count: stockTransactionsToday } = await supabase
                    .from('stock_movements')
                    .select('*', { count: 'exact', head: true })
                    .eq('property_id', property.id)
                    .gte('created_at', isoStart);

                // Checklist — count active daily SOP templates and today's completions
                const { count: checklistTotal } = await supabase
                    .from('sop_templates')
                    .select('*', { count: 'exact', head: true })
                    .eq('property_id', property.id)
                    .eq('is_active', true)
                    .eq('frequency', 'daily');

                const { count: checklistDone } = await supabase
                    .from('sop_completions')
                    .select('*', { count: 'exact', head: true })
                    .eq('property_id', property.id)
                    .eq('completion_date', today)
                    .eq('status', 'completed');

                return {
                    propertyId: property.id,
                    propertyName: property.name,
                    propertyCode: property.code,
                    electricity: {
                        total: elecMetersTotal || 0,
                        done: elecReadingsToday || 0,
                        status: (elecReadingsToday || 0) >= (elecMetersTotal || 0) ? 'done' : 'pending'
                    },
                    dg: {
                        total: dgMetersTotal || 0,
                        done: dgReadingsToday || 0,
                        status: (dgReadingsToday || 0) >= (dgMetersTotal || 0) ? 'done' : 'pending'
                    },
                    stock: {
                        transactions: stockTransactionsToday || 0,
                        status: (stockTransactionsToday || 0) > 0 ? 'done' : 'pending'
                    },
                    checklist: {
                        total: checklistTotal || 0,
                        done: checklistDone || 0,
                        status: (checklistTotal || 0) === 0
                            ? 'na'
                            : (checklistDone || 0) >= (checklistTotal || 0)
                                ? 'done'
                                : 'pending'
                    }
                };
            }));

            setProgressData(progress);
        } catch (error) {
            console.error('Error fetching daily progress:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchChecklistDetails = async (propertyId: string) => {
        setChecklistLoading(true);
        try {
            const today = selectedDate;
            const { data: templates, error: tplError } = await supabase
                .from('sop_templates')
                .select('id, title, category')
                .eq('property_id', propertyId)
                .eq('is_active', true)
                .eq('frequency', 'daily')
                .order('title');

            if (tplError) throw tplError;
            if (!templates || templates.length === 0) {
                setChecklistDetails([]);
                return;
            }

            const { data: completions } = await supabase
                .from('sop_completions')
                .select('template_id, status')
                .eq('property_id', propertyId)
                .eq('completion_date', today);

            const doneByTemplate = new Set(
                (completions || [])
                    .filter((c) => c.status === 'completed')
                    .map((c) => c.template_id)
            );

            setChecklistDetails(
                templates.map((t) => ({
                    id: t.id,
                    title: t.title,
                    category: t.category,
                    done: doneByTemplate.has(t.id),
                }))
            );
        } catch (err) {
            console.error('Error fetching checklist details:', err);
            setChecklistDetails([]);
        } finally {
            setChecklistLoading(false);
        }
    };

    const fetchElectricityDetails = async (propertyId: string) => {
        setMetersLoading(true);
        try {
            const today = selectedDate;
            const { data: meters, error: meterError } = await supabase
                .from('electricity_meters')
                .select('id, name')
                .eq('property_id', propertyId)
                .is('deleted_at', null)
                .order('name');

            if (meterError) throw meterError;
            if (!meters || meters.length === 0) {
                setMeterDetails([]);
                return;
            }

            // Fetch facility layout to get sheet and location
            let layoutMap: Record<string, { sheetName: string, locationName: string }> = {};
            try {
                const layoutRes = await fetch(`/api/properties/${propertyId}/facility-meters`);
                if (layoutRes.ok) {
                    const categories = await layoutRes.json();
                    if (Array.isArray(categories)) {
                        categories.forEach(cat => {
                            (cat.groups || []).forEach((group: any) => {
                                (group.meters || []).forEach((m: any) => {
                                    layoutMap[m.id] = { sheetName: cat.name, locationName: group.name };
                                });
                            });
                        });
                    }
                }
            } catch (err) {
                console.warn('Error fetching facility layout:', err);
            }

            const meterIds = meters.map((m) => m.id);
            const { data: readings } = await supabase
                .from('electricity_readings')
                .select('meter_id')
                .in('meter_id', meterIds)
                .eq('reading_date', today);

            const readToday = new Set((readings || []).map((r) => r.meter_id));

            setMeterDetails(
                meters.map((m) => ({
                    id: m.id,
                    name: m.name,
                    sheet_name: layoutMap[m.id]?.sheetName || null,
                    location: layoutMap[m.id]?.locationName || null,
                    done: readToday.has(m.id),
                }))
            );
        } catch (err) {
            console.error('Error fetching electricity meter details:', err);
            setMeterDetails([]);
        } finally {
            setMetersLoading(false);
        }
    };

    const fetchDieselDetails = async (propertyId: string) => {
        setMetersLoading(true);
        try {
            const today = selectedDate;
            const { data: generators, error: genError } = await supabase
                .from('generators')
                .select('id, name, make, capacity_kva')
                .eq('property_id', propertyId)
                .eq('status', 'active')
                .order('name');

            if (genError) throw genError;
            if (!generators || generators.length === 0) {
                setMeterDetails([]);
                return;
            }

            const genIds = generators.map((g) => g.id);
            const { data: readings } = await supabase
                .from('diesel_readings')
                .select('generator_id')
                .in('generator_id', genIds)
                .eq('reading_date', today);

            const readToday = new Set((readings || []).map((r) => r.generator_id));

            setMeterDetails(
                generators.map((g) => ({
                    id: g.id,
                    name: g.name,
                    sheet_name: null,
                    location: [g.make, g.capacity_kva ? `${g.capacity_kva} kVA` : null]
                        .filter(Boolean)
                        .join(' • ') || null,
                    done: readToday.has(g.id),
                }))
            );
        } catch (err) {
            console.error('Error fetching diesel generator details:', err);
            setMeterDetails([]);
        } finally {
            setMetersLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCcw className="w-8 h-8 text-primary animate-spin" />
            </div>
        );
    }

    return (
        <>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white">Daily Progress Dashboard</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Track module usage across all properties for {selectedDate}</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-[#30363d] rounded-lg px-3 py-2">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <input
                            type="date"
                            value={selectedDate}
                            max={new Date().toISOString().split('T')[0]}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="bg-transparent border-none outline-none text-sm font-medium text-slate-700 dark:text-slate-300"
                        />
                    </div>
                    <button
                        onClick={fetchDailyProgress}
                        className="p-2 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-[#30363d] rounded-lg text-slate-500 hover:text-primary transition-colors"
                        title="Refresh Data"
                    >
                        <RefreshCcw className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr>
                            <th className="p-4 border-b border-slate-200 dark:border-[#30363d] font-bold text-slate-600 dark:text-slate-400">Property</th>
                            <th className="p-4 border-b border-slate-200 dark:border-[#30363d] font-bold text-slate-600 dark:text-slate-400 text-center">Electricity</th>
                            <th className="p-4 border-b border-slate-200 dark:border-[#30363d] font-bold text-slate-600 dark:text-slate-400 text-center">Diesel Generators</th>
                            <th className="p-4 border-b border-slate-200 dark:border-[#30363d] font-bold text-slate-600 dark:text-slate-400 text-center">Checklist</th>
                            <th className="p-4 border-b border-slate-200 dark:border-[#30363d] font-bold text-slate-600 dark:text-slate-400 text-center">Stock Management</th>
                        </tr>
                    </thead>
                    <tbody>
                        {progressData.map((row) => (
                            <tr key={row.propertyId} className="border-b border-slate-100 dark:border-[#21262d] hover:bg-slate-50 dark:hover:bg-[#161b22]/50 transition-colors">
                                <td className="p-4">
                                    <div className="font-bold text-slate-800 dark:text-slate-200">{row.propertyName}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-500">{row.propertyCode}</div>
                                </td>
                                
                                <td className="p-2 text-center">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDrillDown({ type: 'electricity', propertyId: row.propertyId, propertyName: row.propertyName });
                                            fetchElectricityDetails(row.propertyId);
                                        }}
                                        className="flex flex-col items-center gap-1 w-full hover:bg-slate-50 dark:hover:bg-[#161b22]/40 rounded-lg py-2 transition-colors cursor-pointer"
                                    >
                                        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                            {row.electricity.done} / {row.electricity.total}
                                        </div>
                                        {row.electricity.total === 0 ? (
                                            <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-[#30363d] text-slate-500 rounded-full font-bold">N/A</span>
                                        ) : row.electricity.done >= row.electricity.total ? (
                                            <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full font-bold">Done</span>
                                        ) : (
                                            <span className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full font-bold">Pending</span>
                                        )}
                                    </button>
                                </td>

                                <td className="p-2 text-center">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDrillDown({ type: 'diesel', propertyId: row.propertyId, propertyName: row.propertyName });
                                            fetchDieselDetails(row.propertyId);
                                        }}
                                        className="flex flex-col items-center gap-1 w-full hover:bg-slate-50 dark:hover:bg-[#161b22]/40 rounded-lg py-2 transition-colors cursor-pointer"
                                    >
                                        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                            {row.dg.done} / {row.dg.total}
                                        </div>
                                        {row.dg.total === 0 ? (
                                            <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-[#30363d] text-slate-500 rounded-full font-bold">N/A</span>
                                        ) : row.dg.done >= row.dg.total ? (
                                            <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full font-bold">Done</span>
                                        ) : (
                                            <span className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full font-bold">Pending</span>
                                        )}
                                    </button>
                                </td>

                                <td className="p-2 text-center">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDrillDown({ type: 'checklist', propertyId: row.propertyId, propertyName: row.propertyName });
                                            fetchChecklistDetails(row.propertyId);
                                        }}
                                        className="flex flex-col items-center gap-1 w-full hover:bg-slate-50 dark:hover:bg-[#161b22]/40 rounded-lg py-2 transition-colors cursor-pointer"
                                    >
                                        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                            {row.checklist.done} / {row.checklist.total}
                                        </div>
                                        {row.checklist.status === 'na' ? (
                                            <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-[#30363d] text-slate-500 rounded-full font-bold">N/A</span>
                                        ) : row.checklist.status === 'done' ? (
                                            <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full font-bold">Done</span>
                                        ) : (
                                            <span className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full font-bold">Pending</span>
                                        )}
                                    </button>
                                </td>

                                <td className="p-4 text-center">
                                    <div className="flex flex-col items-center gap-1">
                                        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                            {row.stock.transactions} txns today
                                        </div>
                                        {row.stock.status === 'done' ? (
                                            <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full font-bold">Active</span>
                                        ) : (
                                            <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-[#30363d] text-slate-500 rounded-full font-bold">No Activity</span>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>

        <AnimatePresence>
            {drillDown && (() => {
                const isChecklist = drillDown.type === 'checklist';
                const headerTitle = isChecklist
                    ? 'Daily Checklists'
                    : drillDown.type === 'electricity'
                        ? 'Electricity Meters'
                        : 'Diesel Generators';
                const headerIcon = isChecklist
                    ? <ClipboardCheck className="w-5 h-5 text-primary" />
                    : drillDown.type === 'electricity'
                        ? <BatteryCharging className="w-5 h-5 text-primary" />
                        : <Factory className="w-5 h-5 text-primary" />;
                const emptyMessage = isChecklist
                    ? 'No daily checklists configured for this property.'
                    : drillDown.type === 'electricity'
                        ? 'No electricity meters configured for this property.'
                        : 'No active diesel generators configured for this property.';
                const isLoading = isChecklist ? checklistLoading : metersLoading;
                type RenderItem = { id: string; name: string; sublabel: string | null; sheet_name: string | null; location: string | null; done: boolean };
                const items: RenderItem[] = isChecklist
                    ? checklistDetails.map((c) => ({ id: c.id, name: c.title, sublabel: c.category, sheet_name: null, location: null, done: c.done }))
                    : meterDetails.map((m) => ({ id: m.id, name: m.name, sublabel: null, sheet_name: m.sheet_name, location: m.location, done: m.done }));
                return (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setDrillDown(null)}
                            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9998]"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
                            onClick={() => setDrillDown(null)}
                        >
                            <div
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-[#30363d] rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
                            >
                                <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-[#30363d]">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                                            {headerIcon}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 dark:text-white">{headerTitle}</h4>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">{drillDown.propertyName}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setDrillDown(null)}
                                        className="p-1 hover:bg-slate-100 dark:hover:bg-[#30363d] rounded transition-colors"
                                    >
                                        <X className="w-5 h-5 text-slate-500" />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto p-5">
                                    {isLoading ? (
                                        <div className="flex items-center justify-center py-12">
                                            <RefreshCcw className="w-6 h-6 text-primary animate-spin" />
                                        </div>
                                    ) : items.length === 0 ? (
                                        <div className="text-center py-12">
                                            <AlertCircle className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                                {emptyMessage}
                                            </p>
                                        </div>
                                    ) : (
                                        <ul className="space-y-2">
                                            {items.map((item) => (
                                                <li
                                                    key={item.id}
                                                    className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-[#30363d] hover:bg-slate-50 dark:hover:bg-[#0d1117]/50 transition-colors"
                                                >
                                                    <div className="flex-1 min-w-0 pr-3">
                                                        {isChecklist ? (
                                                            <>
                                                                <div className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate">
                                                                    {item.name}
                                                                </div>
                                                                {item.sublabel && item.sublabel !== 'general' && (
                                                                    <div className="text-xs text-slate-500 dark:text-slate-500 capitalize">
                                                                        {item.sublabel}
                                                                    </div>
                                                                )}
                                                            </>
                                                        ) : (() => {
                                                            const parts = [item.sheet_name, item.location, item.name].filter(Boolean);
                                                            if (parts.length === 0) return null;
                                                            return (
                                                                <div className="text-sm text-slate-700 dark:text-slate-300 truncate">
                                                                    {parts.map((part, idx, arr) => {
                                                                        const isLast = idx === arr.length - 1;
                                                                        return (
                                                                            <span key={idx}>
                                                                                <span className={isLast ? 'font-bold text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}>
                                                                                    {part}
                                                                                </span>
                                                                                {!isLast && <span className="text-slate-300 dark:text-slate-600"> · </span>}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                    {item.done ? (
                                                        <span className="flex items-center gap-1 text-xs px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full font-bold">
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                            Done
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1 text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full font-bold">
                                                            <AlertCircle className="w-3.5 h-3.5" />
                                                            Pending
                                                        </span>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </>
                );
            })()}
        </AnimatePresence>
    </>);
}
