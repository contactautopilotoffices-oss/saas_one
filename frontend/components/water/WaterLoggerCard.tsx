'use client';

import React, { useState } from 'react';
import { Droplets, CheckCircle, Clock, AlertTriangle, Plus, Save, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface Source {
    id: string;
    name: string;
    source_type: 'jar' | 'tanker';
    capacity_litres: number;
    water_tariffs: { id: string; rate_per_unit: number; effective_from: string }[];
}

interface Props {
    source: Source;
    mtdUnits: number;
    mtdCost: number;
    onSave: (sourceId: string, quantity: number, date: string) => Promise<void>;
    onShowHistory: () => void;
    isDark?: boolean;
    isSubmitting?: boolean;
}

export default function WaterLoggerCard({ source, mtdUnits, mtdCost, onSave, onShowHistory, isDark = false, isSubmitting = false }: Props) {
    const [quantity, setQuantity] = useState<number | ''>('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [localLoading, setLocalLoading] = useState(false);

    const activeRate = source.water_tariffs?.[source.water_tariffs.length - 1]?.rate_per_unit || 0;
    
    const hasValidReading = quantity !== '' && Number(quantity) >= 0 && date;

    const handleLogReading = async () => {
        if (!hasValidReading) return;
        setLocalLoading(true);
        try {
            await onSave(source.id, Number(quantity), date);
            setQuantity('');
        } finally {
            setLocalLoading(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative w-full h-auto flex flex-col ${isDark ? 'bg-[#161b22] border-[#21262d]' : 'bg-white border-slate-200'} rounded-2xl shadow-sm border overflow-hidden`}
        >
            <div className={`absolute top-0 left-0 w-1.5 h-full ${hasValidReading ? 'bg-blue-500' : (isDark ? 'bg-[#21262d]' : 'bg-slate-200')} transition-colors z-10`} />

            <div className="p-3 sm:p-4 pl-4 sm:pl-5 space-y-3">
                {/* Header row: name + info */}
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-start gap-2.5">
                        <Droplets className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? 'text-blue-400' : 'text-blue-500'}`} />
                        <div>
                            <h2 className={`text-base font-bold ${isDark ? 'text-white' : 'text-slate-900'} leading-tight`}>
                                {source.name}
                            </h2>
                            <p className={`text-xs font-medium ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                                {source.source_type === 'jar' ? 'Drinking Water' : 'Tanker Water'} · ₹{activeRate} / {source.source_type === 'jar' ? 'Jar' : 'Load'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onShowHistory}
                        className={`p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-300`}
                        title="View History"
                    >
                        <Clock className="w-4 h-4" />
                    </button>
                </div>

                {/* Inline MTD Stats */}
                <div className="grid grid-cols-2 gap-2">
                    <div className={`${isDark ? 'bg-[#0d1117] border-[#21262d]' : 'bg-slate-50 border-slate-200'} rounded-xl p-2 border border-dashed flex flex-col justify-center`}>
                        <span className={`text-[9px] font-bold ${isDark ? 'text-slate-500' : 'text-slate-500'} uppercase tracking-wide block mb-0.5`}>MTD Units</span>
                        <div className={`text-sm sm:text-base font-mono font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'} leading-none`}>
                            {mtdUnits}
                        </div>
                    </div>
                    <div className={`${isDark ? 'bg-[#0d1117] border-[#21262d]' : 'bg-slate-50 border-slate-200'} rounded-xl p-2 border border-dashed flex flex-col justify-center`}>
                        <span className={`text-[9px] font-bold ${isDark ? 'text-slate-500' : 'text-slate-500'} uppercase tracking-wide block mb-0.5`}>MTD Expense</span>
                        <div className={`font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'} leading-none ${mtdCost.toLocaleString().length > 6 ? 'text-xs sm:text-sm' : 'text-sm sm:text-base'}`}>
                            ₹{mtdCost.toLocaleString()}
                        </div>
                    </div>
                </div>

                {!activeRate && (
                    <div className="p-2 bg-amber-500/10 rounded-xl flex items-center gap-2 border border-amber-500/20">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-500">No active tariff found</span>
                    </div>
                )}

                {/* Date Selection */}
                <div>
                    <span className={`text-[10px] font-bold ${isDark ? 'text-slate-500' : 'text-slate-500'} uppercase tracking-wide block mb-1`}>
                        Reading Date
                    </span>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className={`w-full ${isDark ? 'bg-[#0d1117] border-[#21262d] text-white' : 'bg-white border-slate-200 text-slate-900'} text-sm font-bold rounded-xl p-2.5 border focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all`}
                        max={new Date().toISOString().split('T')[0]}
                    />
                </div>

                {/* Quantity Input */}
                <div>
                    <span className="text-[10px] font-bold text-blue-600 dark:text-blue-500 uppercase tracking-wide block mb-1">
                        Received Today
                    </span>
                    <div className="relative">
                        <input
                            type="number"
                            min="0"
                            placeholder="Quantity"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                            className={`w-full ${isDark ? 'bg-[#0d1117] border-blue-500/50 text-white placeholder-slate-600' : 'bg-white border-blue-500/30 text-slate-900 placeholder-slate-300'} border-2 focus:ring-2 focus:ring-blue-500/10 text-base font-bold rounded-xl py-2.5 pl-3 pr-14 shadow-sm transition-all outline-none`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                            {source.source_type === 'jar' ? 'Jars' : 'Loads'}
                        </span>
                    </div>
                </div>

                {/* Derived Cost Preview */}
                {hasValidReading && activeRate > 0 && (
                    <div className={`${isDark ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-100'} rounded-xl p-2.5 border`}>
                        <div className="flex justify-between items-center mb-0.5">
                            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase">Derived Cost</span>
                            <span className={`text-[9px] ${isDark ? 'text-slate-500' : 'text-slate-400'} font-mono`}>× ₹{activeRate}</span>
                        </div>
                        <div className="text-xl font-black text-blue-600 dark:text-blue-500 flex items-baseline gap-1">
                            ₹{((Number(quantity) || 0) * activeRate).toLocaleString()}
                        </div>
                    </div>
                )}

                {/* Save Button */}
                <button
                    onClick={handleLogReading}
                    disabled={!hasValidReading || isSubmitting || localLoading}
                    className={`w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                        hasValidReading && !isSubmitting && !localLoading
                            ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 active:scale-[0.98]'
                            : `${isDark ? 'bg-[#21262d] text-slate-600' : 'bg-slate-100 text-slate-400'} cursor-not-allowed`
                    }`}
                >
                    {isSubmitting || localLoading ? (
                        <Loader2 className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            <Save className="w-4 h-4" />
                            Save Entry
                        </>
                    )}
                </button>
            </div>
        </motion.div>
    );
}
