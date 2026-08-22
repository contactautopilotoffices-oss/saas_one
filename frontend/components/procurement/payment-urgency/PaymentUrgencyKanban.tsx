'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    AlertCircle, Clock, CheckCircle2, ChevronRight, 
    Building2, IndianRupee, Tag, Shield, Filter, 
    Search, Plus, ArrowRight, UserCheck, AlertTriangle,
    SlidersHorizontal, RefreshCw, Eye, Sparkles, Check,
    MoveRight, ArrowUpRight, CheckSquare, Zap, Layers
} from 'lucide-react';
import { TaskLineItem, UrgencyTier, TEST_PROPERTIES } from './mockData';

interface PaymentUrgencyKanbanProps {
    tasks: TaskLineItem[];
    isSuperAdmin: boolean;
    onSelectTask: (task: TaskLineItem) => void;
    onMoveTier: (taskId: string, targetTier: UrgencyTier) => void;
    onOpenNewModal: () => void;
}

export default function PaymentUrgencyKanban({
    tasks,
    isSuperAdmin,
    onSelectTask,
    onMoveTier,
    onOpenNewModal
}: PaymentUrgencyKanbanProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProperty, setSelectedProperty] = useState('all');
    const [frequencyFilter, setFrequencyFilter] = useState<string>('all');
    const [quickMovedId, setQuickMovedId] = useState<string | null>(null);

    // Filter tasks
    const filteredTasks = useMemo(() => {
        return tasks.filter(t => {
            if (selectedProperty !== 'all' && t.property_id !== selectedProperty) {
                return false;
            }
            if (frequencyFilter !== 'all' && t.frequency !== frequencyFilter) {
                return false;
            }
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const match = 
                    t.title.toLowerCase().includes(q) ||
                    t.task_code.toLowerCase().includes(q) ||
                    t.vendor_name.toLowerCase().includes(q) ||
                    t.property_name.toLowerCase().includes(q) ||
                    (t.vendor_invoice_ref && t.vendor_invoice_ref.toLowerCase().includes(q));
                if (!match) return false;
            }
            return true;
        });
    }, [tasks, selectedProperty, frequencyFilter, searchQuery]);

    // Group into columns
    const columns: { tier: UrgencyTier; title: string; subtitle: string; color: string; border: string; bg: string; badge: string; icon: any }[] = [
        {
            tier: 'P1',
            title: 'P1 · Immediate',
            subtitle: '< 24 Hours SLA',
            color: 'text-rose-600',
            border: 'border-rose-300',
            bg: 'bg-rose-50/40',
            badge: 'bg-rose-500 text-white shadow-rose-200',
            icon: AlertTriangle
        },
        {
            tier: 'P2',
            title: 'P2 · 7 Days TAT',
            subtitle: 'Weekly Turnaround',
            color: 'text-amber-600',
            border: 'border-amber-300',
            bg: 'bg-amber-50/40',
            badge: 'bg-amber-500 text-white shadow-amber-200',
            icon: Clock
        },
        {
            tier: 'P3',
            title: 'P3 · Flexible',
            subtitle: 'No SLA / TAT Constraint',
            color: 'text-blue-600',
            border: 'border-blue-300',
            bg: 'bg-blue-50/40',
            badge: 'bg-blue-500 text-white shadow-blue-200',
            icon: Layers
        },
        {
            tier: 'COMPLETED',
            title: 'Closed / Settled',
            subtitle: 'Paid & Executed',
            color: 'text-emerald-600',
            border: 'border-emerald-300',
            bg: 'bg-emerald-50/40',
            badge: 'bg-emerald-500 text-white shadow-emerald-200',
            icon: CheckCircle2
        }
    ];

    const getColumnTasks = (tier: UrgencyTier) => {
        return filteredTasks.filter(t => t.urgency_tier === tier);
    };

    const handleQuickMove = (e: React.MouseEvent, taskId: string, tier: UrgencyTier) => {
        e.stopPropagation();
        setQuickMovedId(taskId);
        onMoveTier(taskId, tier);
        setTimeout(() => setQuickMovedId(null), 500);
    };

    return (
        <div className="space-y-6 font-inter">
            {/* Filter & Action Toolbar */}
            <div className="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Search & Selectors */}
                <div className="flex flex-wrap items-center gap-3 flex-1">
                    {/* Search */}
                    <div className="relative min-w-[240px] max-w-sm flex-1">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search task, vendor, invoice, property..."
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                        />
                    </div>

                    {/* Property Filter */}
                    <div className="relative">
                        <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <select
                            value={selectedProperty}
                            onChange={(e) => setSelectedProperty(e.target.value)}
                            className="pl-10 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer appearance-none"
                        >
                            {TEST_PROPERTIES.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Frequency Filter Pills */}
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                        {[
                            { id: 'all', label: 'All Tasks' },
                            { id: 'daily', label: 'Daily' },
                            { id: 'weekly', label: 'Weekly' },
                            { id: 'emergency', label: 'Emergency' }
                        ].map(f => (
                            <button
                                key={f.id}
                                onClick={() => setFrequencyFilter(f.id)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                    frequencyFilter === f.id
                                        ? 'bg-white text-slate-900 shadow-xs'
                                        : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={onOpenNewModal}
                        className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-xs font-black rounded-xl shadow-md shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        Upload Task / Line Item
                    </button>
                </div>
            </div>

            {/* Kanban Columns Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-start">
                {columns.map(col => {
                    const colTasks = getColumnTasks(col.tier);
                    const colTotalValue = colTasks.reduce((acc, t) => acc + t.estimated_amount, 0);
                    const ColIcon = col.icon;

                    return (
                        <div
                            key={col.tier}
                            className={`rounded-[2rem] border ${col.border} ${col.bg} p-4 flex flex-col min-h-[580px] shadow-xs`}
                        >
                            {/* Column Header */}
                            <div className="pb-3.5 mb-3 border-b border-slate-200/80 flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${col.badge} shadow-xs font-black`}>
                                        <ColIcon className="w-4 h-4 text-white" />
                                    </div>
                                    <div>
                                        <h3 className={`text-sm font-black tracking-tight ${col.color}`}>
                                            {col.title}
                                        </h3>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                            {col.subtitle}
                                        </p>
                                    </div>
                                </div>

                                <div className="text-right">
                                    <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-black bg-white border border-slate-200 text-slate-800 shadow-xs">
                                        {colTasks.length}
                                    </span>
                                    <p className="text-[10px] font-black text-slate-500 mt-0.5">
                                        ₹{colTotalValue.toLocaleString('en-IN')}
                                    </p>
                                </div>
                            </div>

                            {/* Column Cards */}
                            <div className="space-y-3.5 flex-1 overflow-y-auto max-h-[720px] pr-0.5 custom-scrollbar">
                                <AnimatePresence>
                                    {colTasks.length === 0 ? (
                                        <div className="text-center py-16 px-4 bg-white/60 rounded-2xl border border-dashed border-slate-200 text-slate-400">
                                            <p className="text-xs font-bold">No tasks in {col.title}</p>
                                            <p className="text-[10px] text-slate-400 mt-1">
                                                {isSuperAdmin ? 'Drag or triage items here' : 'Awaiting super admin assignment'}
                                            </p>
                                        </div>
                                    ) : (
                                        colTasks.map(task => (
                                            <motion.div
                                                key={task.id}
                                                layout
                                                initial={{ opacity: 0, scale: 0.96 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.96 }}
                                                onClick={() => onSelectTask(task)}
                                                className={`bg-white rounded-2xl p-4.5 border border-slate-200 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group relative overflow-hidden ${
                                                    task.urgency_tier === 'P1' ? 'ring-1 ring-rose-200' : ''
                                                } ${quickMovedId === task.id ? 'animate-pulse' : ''}`}
                                            >
                                                {/* Urgency Edge Stripe */}
                                                {task.urgency_tier === 'P1' && (
                                                    <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-rose-500" />
                                                )}
                                                {task.urgency_tier === 'P2' && (
                                                    <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-amber-500" />
                                                )}
                                                {task.urgency_tier === 'P3' && (
                                                    <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-blue-400" />
                                                )}
                                                {task.urgency_tier === 'COMPLETED' && (
                                                    <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-emerald-500" />
                                                )}

                                                {/* Card Header */}
                                                <div className="flex items-center justify-between gap-2 mb-2 pl-1">
                                                    <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md tracking-wider">
                                                        {task.task_code}
                                                    </span>
                                                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                                                        task.frequency === 'emergency' ? 'bg-rose-100 text-rose-700' :
                                                        task.frequency === 'daily' ? 'bg-indigo-100 text-indigo-700' :
                                                        'bg-slate-100 text-slate-700'
                                                    }`}>
                                                        {task.frequency}
                                                    </span>
                                                </div>

                                                {/* Title */}
                                                <h4 className="text-xs font-black text-slate-900 leading-snug mb-2 pl-1 line-clamp-2 group-hover:text-primary transition-colors">
                                                    {task.title}
                                                </h4>

                                                {/* Property & Vendor */}
                                                <div className="space-y-1 mb-3 pl-1 text-[11px] text-slate-500">
                                                    <div className="flex items-center gap-1.5">
                                                        <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                        <span className="font-bold text-slate-700 truncate">{task.property_name}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-[10px]">
                                                        <span className="text-slate-400 truncate">Vendor: <strong className="text-slate-600">{task.vendor_name}</strong></span>
                                                    </div>
                                                </div>

                                                {/* Price & TAT */}
                                                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between pl-1">
                                                    <div>
                                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Amount</p>
                                                        <p className="text-sm font-black text-slate-900 flex items-center">
                                                            <IndianRupee className="w-3.5 h-3.5 text-primary mr-0.5" />
                                                            {task.estimated_amount.toLocaleString('en-IN')}
                                                        </p>
                                                    </div>

                                                    <div className="text-right">
                                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Turnaround</p>
                                                        <span className={`inline-block text-[10px] font-black px-2 py-0.5 rounded-md ${
                                                            task.urgency_tier === 'P1' ? 'bg-rose-50 text-rose-600 border border-rose-200' :
                                                            task.urgency_tier === 'P2' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                                                            task.urgency_tier === 'P3' ? 'bg-blue-50 text-blue-600 border border-blue-200' :
                                                            'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                                        }`}>
                                                            {task.tat_label}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Super Admin Quick Triage Actions */}
                                                {isSuperAdmin && (
                                                    <div className="mt-3 pt-2.5 border-t border-dashed border-slate-200 flex items-center justify-between gap-1 text-[10px]">
                                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                                            Quick Shift:
                                                        </span>
                                                        <div className="flex items-center gap-1">
                                                            {col.tier !== 'P1' && (
                                                                <button
                                                                    type="button"
                                                                    title="Shift to P1 (Immediate)"
                                                                    onClick={(e) => handleQuickMove(e, task.id, 'P1')}
                                                                    className="px-2 py-1 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-md font-black uppercase text-[9px] transition-all cursor-pointer"
                                                                >
                                                                    → P1
                                                                </button>
                                                            )}
                                                            {col.tier !== 'P2' && (
                                                                <button
                                                                    type="button"
                                                                    title="Shift to P2 (7 Days)"
                                                                    onClick={(e) => handleQuickMove(e, task.id, 'P2')}
                                                                    className="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-md font-black uppercase text-[9px] transition-all cursor-pointer"
                                                                >
                                                                    → P2
                                                                </button>
                                                            )}
                                                            {col.tier !== 'P3' && (
                                                                <button
                                                                    type="button"
                                                                    title="Shift to P3 (Flexible)"
                                                                    onClick={(e) => handleQuickMove(e, task.id, 'P3')}
                                                                    className="px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md font-black uppercase text-[9px] transition-all cursor-pointer"
                                                                >
                                                                    → P3
                                                                </button>
                                                            )}
                                                            {col.tier !== 'COMPLETED' && (
                                                                <button
                                                                    type="button"
                                                                    title="Mark Closed"
                                                                    onClick={(e) => handleQuickMove(e, task.id, 'COMPLETED')}
                                                                    className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-md font-black uppercase text-[9px] transition-all cursor-pointer"
                                                                >
                                                                    ✓ Done
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </motion.div>
                                        ))
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
