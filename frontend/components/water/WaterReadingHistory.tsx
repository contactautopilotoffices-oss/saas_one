'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, Filter, Search, Download, Trash2, Droplets } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

interface WaterReadingHistoryProps {
    propertyId: string;
    isDark?: boolean;
    onBack: () => void;
    onDeleteSuccess?: () => void;
    initialSourceId?: string | null;
}

interface ReadingLog {
    id: string;
    reading_date: string;
    quantity: number;
    computed_cost?: number;
    created_at: string;
    source_id: string;
    source: {
        id: string;
        name: string;
        source_type: 'jar' | 'tanker';
    };
    creator?: {
        full_name: string;
    };
}

interface Source {
    id: string;
    name: string;
    source_type: 'jar' | 'tanker';
}

const WaterReadingHistory: React.FC<WaterReadingHistoryProps> = ({
    propertyId,
    isDark = false,
    onBack,
    onDeleteSuccess,
    initialSourceId
}) => {
    const supabase = createClient();

    const [readings, setReadings] = useState<ReadingLog[]>([]);
    const [sources, setSources] = useState<Source[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [selectedReadings, setSelectedReadings] = useState<Set<string>>(new Set());
    const [deleteMode, setDeleteMode] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    // Filters
    const [selectedSourceId, setSelectedSourceId] = useState<string>(initialSourceId || 'all');
    const [startDate, setStartDate] = useState(
        new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]
    );
    const [endDate, setEndDate] = useState(
        new Date().toISOString().split('T')[0]
    );

    // Get available months for month-wise selection
    const availableMonths = React.useMemo(() => {
        const months = new Map<string, { label: string; count: number }>();
        readings.forEach(r => {
            const date = new Date(r.reading_date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            const existing = months.get(key);
            months.set(key, { label, count: (existing?.count || 0) + 1 });
        });
        return Array.from(months.entries()).map(([key, value]) => ({ key, ...value }));
    }, [readings]);

    const [selectedMonth, setSelectedMonth] = useState<string>('all');

    // Filter readings by selected month
    const filteredReadings = React.useMemo(() => {
        if (selectedMonth === 'all') return readings;
        return readings.filter(r => {
            const date = new Date(r.reading_date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            return key === selectedMonth;
        });
    }, [readings, selectedMonth]);

    // Toggle select all for filtered readings
    const toggleSelectAll = () => {
        if (selectedReadings.size === filteredReadings.length) {
            setSelectedReadings(new Set());
        } else {
            setSelectedReadings(new Set(filteredReadings.map(r => r.id)));
        }
    };

    // Toggle individual selection
    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedReadings);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedReadings(newSet);
    };

    // Select all in a month
    const selectMonth = (monthKey: string) => {
        const idsInMonth = readings
            .filter(r => {
                const date = new Date(r.reading_date);
                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                return key === monthKey;
            })
            .map(r => r.id);

        const allSelected = idsInMonth.every(id => selectedReadings.has(id));

        if (allSelected) {
            const newSet = new Set(selectedReadings);
            idsInMonth.forEach(id => newSet.delete(id));
            setSelectedReadings(newSet);
        } else {
            const newSet = new Set(selectedReadings);
            idsInMonth.forEach(id => newSet.add(id));
            setSelectedReadings(newSet);
        }
    };

    // Bulk delete selected readings
    const handleBulkDelete = async () => {
        if (selectedReadings.size === 0) return;
        if (!confirm(`Delete ${selectedReadings.size} selected reading(s)? This cannot be undone.`)) return;

        setIsBulkDeleting(true);
        let deleted = 0;
        let failed = 0;

        for (const id of selectedReadings) {
            try {
                const res = await fetch(`/api/properties/${propertyId}/water/readings/${id}`, {
                    method: 'DELETE'
                });
                if (res.ok) deleted++;
                else failed++;
            } catch {
                failed++;
            }
        }

        setReadings(prev => prev.filter(r => !selectedReadings.has(r.id)));
        setSelectedReadings(new Set());
        setDeleteMode(false);
        setIsBulkDeleting(false);

        if (onDeleteSuccess) onDeleteSuccess();
        alert(`Deleted ${deleted} reading(s)${failed > 0 ? `. ${failed} failed.` : '.'}`);
    };

    // Unified Data Fetching
    useEffect(() => {
        const loadHistory = async () => {
            setIsLoading(true);
            try {
                // 1. Fetch Sources
                const { data: sourcesData, error: sourcesError } = await supabase
                    .from('water_sources')
                    .select('id, name, source_type')
                    .eq('property_id', propertyId)
                    .eq('is_active', true);

                if (sourcesError) throw sourcesError;

                const currentSources = sourcesData || [];
                setSources(currentSources);

                if (currentSources.length === 0) {
                    setReadings([]);
                    setIsLoading(false);
                    return;
                }

                // 2. Fetch Readings
                const sourceIds = currentSources.map(s => s.id);

                let query = supabase
                    .from('water_readings')
                    .select(`
                        id, reading_date, quantity, computed_cost, created_at, source_id,
                        source:water_sources(id, name, source_type),
                        creator:users!created_by(full_name)
                    `)
                    .in('source_id', sourceIds)
                    .gte('reading_date', startDate)
                    .lte('reading_date', endDate)
                    .order('reading_date', { ascending: false });

                if (selectedSourceId !== 'all') {
                    query = query.eq('source_id', selectedSourceId);
                }

                const { data: readingsData, error: readingsError } = await query;
                if (readingsError) throw readingsError;

                setReadings(readingsData as any || []);

            } catch (err) {
                console.error('Failed to load history:', err);
            } finally {
                setIsLoading(false);
            }
        };

        loadHistory();
    }, [propertyId, startDate, endDate, selectedSourceId, supabase]);

    // Client-side CSV Export
    const handleExportCSV = () => {
        if (filteredReadings.length === 0) return;
        
        const headers = ["Date", "Source Name", "Type", "Quantity", "Cost (INR)", "Logged By", "Log Time"];
        const rows = filteredReadings.map(r => [
            r.reading_date,
            `"${r.source.name}"`,
            r.source.source_type === 'jar' ? 'Jars' : 'Tanker Loads',
            r.quantity,
            r.computed_cost || 0,
            `"${r.creator?.full_name || 'System'}"`,
            new Date(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        ]);
        
        const csvContent = [
            headers.join(","),
            ...rows.map(e => e.join(","))
        ].join("\n");
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Water_History_${startDate}_to_${endDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Delete reading
    const handleDeleteReading = async (id: string) => {
        if (!confirm('Are you sure you want to delete this reading entry?')) {
            return;
        }

        setDeletingId(id);
        try {
            const res = await fetch(`/api/properties/${propertyId}/water/readings/${id}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to delete reading');
            }

            setReadings(prev => prev.filter(r => r.id !== id));
            if (onDeleteSuccess) onDeleteSuccess();

        } catch (err: any) {
            console.error('Delete error:', err);
            alert(err.message || 'Failed to delete reading');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className={`min-h-[100dvh] flex flex-col ${isDark ? 'bg-[#0d1117] text-slate-300' : 'bg-slate-50 text-slate-600'}`}>
            {/* Header */}
            <div className={`sticky top-0 z-10 px-4 py-4 border-b ${isDark ? 'bg-[#161b22]/90 border-[#30363d]' : 'bg-white/90 border-slate-200'} backdrop-blur-md`}>
                <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className={`p-2 rounded-full ${isDark ? 'hover:bg-[#30363d]' : 'hover:bg-slate-100'} transition-colors`}
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Reading History</h1>
                            <p className="text-xs font-medium opacity-70">View past water logs</p>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap items-center gap-3">
                        {/* Source Selector */}
                        <div className="relative">
                            <select
                                value={selectedSourceId}
                                onChange={(e) => setSelectedSourceId(e.target.value)}
                                className={`appearance-none pl-9 pr-8 py-2 text-sm font-bold rounded-lg border ${isDark ? 'bg-[#0d1117] border-[#30363d] text-white' : 'bg-white border-slate-200 text-slate-700'} focus:ring-2 focus:ring-blue-500/20 outline-none`}
                            >
                                <option value="all">All Sources</option>
                                {sources.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
                        </div>

                        {/* Date Range */}
                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-white border-slate-200'}`}>
                            <Calendar className="w-4 h-4 opacity-50" />
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className={`text-sm font-bold bg-transparent outline-none w-28 ${isDark ? 'text-white' : 'text-slate-700'}`}
                            />
                            <span className="opacity-30">to</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className={`text-sm font-bold bg-transparent outline-none w-28 ${isDark ? 'text-white' : 'text-slate-700'}`}
                                max={new Date().toISOString().split('T')[0]}
                            />
                        </div>

                        {/* Export Button */}
                        <button
                            onClick={handleExportCSV}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border transition-colors ${isDark
                                ? 'bg-[#21262d] border-[#30363d] text-white hover:bg-[#30363d]'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            <Download className="w-4 h-4" />
                            <span className="hidden sm:inline">Export CSV</span>
                        </button>

                        {/* Delete Mode Toggle */}
                        <button
                            onClick={() => {
                                setDeleteMode(!deleteMode);
                                setSelectedReadings(new Set());
                            }}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border transition-colors ${deleteMode
                                ? 'bg-red-500 border-red-500 text-white'
                                : isDark
                                    ? 'bg-[#21262d] border-[#30363d] text-white hover:bg-red-500/20 hover:border-red-500/50'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-red-50 hover:border-red-300'
                                }`}
                        >
                            <Trash2 className="w-4 h-4" />
                            <span className="hidden sm:inline">{deleteMode ? 'Cancel' : 'Delete'}</span>
                        </button>

                        {/* Bulk Delete Button */}
                        {deleteMode && selectedReadings.size > 0 && (
                            <button
                                onClick={handleBulkDelete}
                                disabled={isBulkDeleting}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                                <span>Delete {selectedReadings.size} Selected</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Month Selection for Bulk Delete */}
                {deleteMode && availableMonths.length > 0 && (
                    <div className={`max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap items-center gap-2 ${isDark ? 'bg-red-500/10 border-b border-red-500/30' : 'bg-red-50 border-b border-red-200'}`}>
                        <span className="text-xs font-bold text-red-600 uppercase tracking-wide">Select Month:</span>
                        <button
                            onClick={() => { setSelectedMonth('all'); setSelectedReadings(new Set()); }}
                            className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${selectedMonth === 'all' ? 'bg-red-500 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-red-100'}`}
                        >
                            All
                        </button>
                        {availableMonths.map(m => {
                            const idsInMonth = readings
                                .filter(r => {
                                    const date = new Date(r.reading_date);
                                    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` === m.key;
                                })
                                .map(r => r.id);
                            const allSelected = idsInMonth.length > 0 && idsInMonth.every(id => selectedReadings.has(id));
                            const someSelected = idsInMonth.some(id => selectedReadings.has(id));

                            return (
                                <button
                                    key={m.key}
                                    onClick={() => selectMonth(m.key)}
                                    className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                                        allSelected
                                            ? 'bg-red-500 text-white'
                                            : someSelected
                                                ? 'bg-red-200 text-red-700 border border-red-400'
                                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-red-100'
                                    }`}
                                >
                                    {m.label} ({m.count})
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="max-w-[1600px] w-full mx-auto px-4 py-8 flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="text-center py-20 opacity-50 flex flex-col items-center">
                        <Droplets className="w-8 h-8 animate-bounce text-blue-500 mb-4" />
                        Loading water history...
                    </div>
                ) : readings.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Search className="w-8 h-8 text-blue-400" />
                        </div>
                        <h3 className="text-lg font-bold">No readings found</h3>
                        <p className="text-sm opacity-70">Try adjusting the filters</p>
                    </div>
                ) : (
                    <div className={`rounded-xl border overflow-hidden ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-white border-slate-200 shadow-sm'}`}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className={`text-[10px] font-black uppercase tracking-[0.2em] border-b ${isDark ? 'bg-[#0d1117] text-slate-500 border-[#30363d]' : 'bg-slate-50/50 text-slate-500 border-slate-200'}`}>
                                    <tr>
                                        {deleteMode && <th className="px-6 py-4 w-12">
                                            <input
                                                type="checkbox"
                                                checked={filteredReadings.length > 0 && selectedReadings.size === filteredReadings.length}
                                                onChange={toggleSelectAll}
                                                className="w-4 h-4 rounded border-slate-400 cursor-pointer"
                                            />
                                        </th>}
                                        <th className="px-6 py-4">Date</th>
                                        <th className="px-6 py-4">Source Name</th>
                                        <th className="px-6 py-4 text-right">Quantity</th>
                                        <th className="px-6 py-4 text-right">Cost</th>
                                        <th className="px-6 py-4 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody className={`divide-y ${isDark ? 'divide-[#30363d]' : 'divide-slate-100'}`}>
                                    {filteredReadings.map((log) => (
                                        <tr key={log.id} className={`transition-colors ${
                                            selectedReadings.has(log.id)
                                                ? 'bg-red-50 dark:bg-red-500/10'
                                                : isDark ? 'hover:bg-[#0d1117]' : 'hover:bg-slate-50'
                                        }`}>
                                            {deleteMode && (
                                                <td className="px-6 py-4">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedReadings.has(log.id)}
                                                        onChange={() => toggleSelect(log.id)}
                                                        className="w-4 h-4 rounded border-slate-400 cursor-pointer"
                                                    />
                                                </td>
                                            )}
                                            <td className="px-6 py-4 font-medium whitespace-nowrap">
                                                <div className="flex flex-col">
                                                    <span>
                                                        {new Date(log.reading_date).toLocaleDateString('en-US', {
                                                            day: '2-digit', month: 'short', year: 'numeric'
                                                        })}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 font-normal">
                                                        {new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                    {log.creator && (
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm inline-block mt-1 w-max ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                                                            {log.creator.full_name}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 font-bold">
                                                <div className="flex items-center gap-2">
                                                    <div className={`p-1.5 rounded-lg ${isDark ? 'bg-blue-900/20 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                                                        <Droplets className="w-4 h-4" />
                                                    </div>
                                                    <div>
                                                        {log.source.name}
                                                        <div className="text-xs font-normal opacity-50 uppercase tracking-widest">{log.source.source_type}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <span className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-black ${
                                                    isDark ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'
                                                }`}>
                                                    {log.quantity.toLocaleString()} {log.source.source_type === 'jar' ? 'Jars' : 'Loads'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right whitespace-nowrap">
                                                <span className={`text-sm font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                                                    {log.computed_cost ? `₹${log.computed_cost.toLocaleString()}` : '-'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <button
                                                    onClick={() => handleDeleteReading(log.id)}
                                                    disabled={deletingId === log.id}
                                                    className={`p-1.5 rounded-lg transition-all mx-auto block ${isDark ? 'hover:bg-rose-500/10 text-slate-500 hover:text-rose-400' : 'hover:bg-rose-50 text-slate-400 hover:text-rose-500'}`}
                                                    title="Delete Entry"
                                                >
                                                    {deletingId === log.id ? (
                                                        <div className="w-4 h-4 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
                                                    ) : (
                                                        <Trash2 className="w-4 h-4" />
                                                    )}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WaterReadingHistory;
