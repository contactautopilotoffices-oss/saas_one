'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    LayoutDashboard, Plus, Clock, CheckCircle2, 
    AlertTriangle, Shield, Layers, FileSpreadsheet,
    IndianRupee, TrendingUp, Filter, Sparkles, User, 
    RefreshCw, Check, ArrowUpRight, BarChart3, Building2,
    Calendar, CheckSquare
} from 'lucide-react';
import { TaskLineItem, UrgencyTier, INITIAL_TEST_TASKS } from './mockData';
import PaymentUrgencyKanban from './PaymentUrgencyKanban';
import TaskSheetUploadView from './TaskSheetUploadView';
import TaskDetailsModal from './TaskDetailsModal';
import NewTaskModal from './NewTaskModal';

interface PaymentUrgencyTrackerTabProps {
    user?: any;
    organizationId?: string;
    propertyId?: string;
    isSuperAdmin?: boolean;
}

export default function PaymentUrgencyTrackerTab({
    user,
    organizationId,
    propertyId,
    isSuperAdmin: propIsSuperAdmin
}: PaymentUrgencyTrackerTabProps) {
    // Detect if role is org_super_admin or master_admin
    const userRole = (user?.user_metadata?.role || '').toLowerCase();
    const defaultIsSuperAdmin = propIsSuperAdmin || userRole === 'org_super_admin' || userRole === 'master_admin';

    // Interactive role perspective switcher for testing/demoing
    const [overrideRole, setOverrideRole] = useState<'super_admin' | 'procurement'>(
        defaultIsSuperAdmin ? 'super_admin' : 'procurement'
    );
    const isSuperAdmin = overrideRole === 'super_admin';

    const [activeView, setActiveView] = useState<'kanban' | 'task_sheet' | 'analytics'>('kanban');
    const [tasks, setTasks] = useState<TaskLineItem[]>(INITIAL_TEST_TASKS);
    const [selectedTask, setSelectedTask] = useState<TaskLineItem | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [isNewModalOpen, setIsNewModalOpen] = useState(false);

    // KPI Aggregations
    const stats = useMemo(() => {
        const p1Tasks = tasks.filter(t => t.urgency_tier === 'P1');
        const p2Tasks = tasks.filter(t => t.urgency_tier === 'P2');
        const p3Tasks = tasks.filter(t => t.urgency_tier === 'P3');
        const completedTasks = tasks.filter(t => t.urgency_tier === 'COMPLETED');

        const p1Value = p1Tasks.reduce((acc, t) => acc + t.estimated_amount, 0);
        const p2Value = p2Tasks.reduce((acc, t) => acc + t.estimated_amount, 0);
        const p3Value = p3Tasks.reduce((acc, t) => acc + t.estimated_amount, 0);
        const completedValue = completedTasks.reduce((acc, t) => acc + t.estimated_amount, 0);

        const totalActive = p1Tasks.length + p2Tasks.length + p3Tasks.length;
        const totalValue = p1Value + p2Value + p3Value + completedValue;

        return {
            p1Count: p1Tasks.length,
            p1Value,
            p2Count: p2Tasks.length,
            p2Value,
            p3Count: p3Tasks.length,
            p3Value,
            completedCount: completedTasks.length,
            completedValue,
            totalActive,
            totalValue
        };
    }, [tasks]);

    // Move task tier
    const handleMoveTier = (taskId: string, targetTier: UrgencyTier) => {
        setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;

            let tatLabel = t.tat_label;
            let tatDeadline = t.tat_deadline;
            if (targetTier === 'P1') {
                tatLabel = 'Immediate (< 24h)';
                tatDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            } else if (targetTier === 'P2') {
                tatLabel = '7 Days TAT';
                tatDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            } else if (targetTier === 'P3') {
                tatLabel = 'Flexible (No SLA)';
                tatDeadline = 'Flexible (No SLA)';
            } else if (targetTier === 'COMPLETED') {
                tatLabel = 'Executed';
            }

            return {
                ...t,
                urgency_tier: targetTier,
                tat_label: tatLabel,
                tat_deadline: tatDeadline,
                status: targetTier === 'COMPLETED' ? 'paid' : t.status,
                payment_status: targetTier === 'COMPLETED' ? 'paid' : t.payment_status,
                triaged_by_name: isSuperAdmin ? 'Org Super Admin' : t.triaged_by_name,
                triaged_at: new Date().toISOString()
            };
        }));
    };

    // Update task
    const handleUpdateTask = (updatedTask: TaskLineItem) => {
        setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
    };

    // Add new tasks
    const handleAddTasks = (newTasks: TaskLineItem[]) => {
        setTasks(prev => [...newTasks, ...prev]);
    };

    const handleOpenDetails = (task: TaskLineItem) => {
        setSelectedTask(task);
        setIsDetailsOpen(true);
    };

    return (
        <div className="space-y-8 font-inter">
            {/* Top Bar with Role Simulator and Title */}
            <div className="bg-white rounded-[2.5rem] border border-slate-200 p-6 md:p-8 shadow-xs">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <span className="px-3 py-1 bg-primary/10 text-primary font-black text-[10px] uppercase tracking-widest rounded-lg">
                                Payment Urgency & Task Board (FMS Tracker)
                            </span>
                            <span className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 text-slate-700 font-bold text-[10px] rounded-lg tracking-wider uppercase">
                                <Shield className="w-3 h-3 text-primary" />
                                Triaged by Org Super Admin
                            </span>
                        </div>
                        <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight leading-tight">
                            Procurement Task & Urgency Tracker
                        </h1>
                        <p className="text-xs font-medium text-slate-500 max-w-3xl">
                            Real-time urgency prioritization board. Tasks uploaded by Procurement are categorized by Org Super Admin into 
                            <strong className="text-rose-600"> P1 (Immediate)</strong>, 
                            <strong className="text-amber-600"> P2 (7 Days TAT)</strong>, and 
                            <strong className="text-blue-600"> P3 (Flexible / No SLA)</strong> for organized execution.
                        </p>
                    </div>

                    {/* View Switcher + Role Perspective Toggle */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        {/* Testing Role Switcher */}
                        <div className="bg-slate-100 p-1 rounded-2xl flex items-center">
                            <button
                                onClick={() => setOverrideRole('super_admin')}
                                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                                    isSuperAdmin 
                                        ? 'bg-slate-900 text-white shadow-sm' 
                                        : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <Shield className="w-3.5 h-3.5 text-amber-400" />
                                Org Super Admin View
                            </button>
                            <button
                                onClick={() => setOverrideRole('procurement')}
                                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                                    !isSuperAdmin 
                                        ? 'bg-primary text-white shadow-sm' 
                                        : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                <User className="w-3.5 h-3.5" />
                                Procurement View
                            </button>
                        </div>

                        {/* Upload Button */}
                        <button
                            onClick={() => setIsNewModalOpen(true)}
                            className="flex items-center justify-center gap-2 px-5 py-3 bg-primary text-white text-xs font-black rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 cursor-pointer"
                        >
                            <Plus className="w-4 h-4" />
                            Upload Task / Bill
                        </button>
                    </div>
                </div>

                {/* KPI Cards Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8 pt-8 border-t border-slate-100">
                    {/* P1 Urgent */}
                    <div className="p-5 bg-gradient-to-br from-rose-50 to-rose-100/40 border border-rose-200/80 rounded-2xl relative overflow-hidden">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-rose-700 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                                P1 · Immediate (&lt; 24h)
                            </span>
                            <span className="px-2 py-0.5 bg-rose-200/70 text-rose-900 rounded-md text-[10px] font-black">
                                {stats.p1Count} Items
                            </span>
                        </div>
                        <p className="text-xl md:text-2xl font-black text-rose-950 flex items-center">
                            <IndianRupee className="w-4 h-4 mr-0.5 text-rose-600" />
                            {stats.p1Value.toLocaleString('en-IN')}
                        </p>
                        <p className="text-[10px] font-bold text-rose-600/90 mt-1">
                            Critical & breakdown payments
                        </p>
                    </div>

                    {/* P2 7-Days */}
                    <div className="p-5 bg-gradient-to-br from-amber-50 to-amber-100/40 border border-amber-200/80 rounded-2xl relative overflow-hidden">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-amber-600" />
                                P2 · 7 Days TAT
                            </span>
                            <span className="px-2 py-0.5 bg-amber-200/70 text-amber-900 rounded-md text-[10px] font-black">
                                {stats.p2Count} Items
                            </span>
                        </div>
                        <p className="text-xl md:text-2xl font-black text-amber-950 flex items-center">
                            <IndianRupee className="w-4 h-4 mr-0.5 text-amber-600" />
                            {stats.p2Value.toLocaleString('en-IN')}
                        </p>
                        <p className="text-[10px] font-bold text-amber-600/90 mt-1">
                            Weekly scheduled vendor bills
                        </p>
                    </div>

                    {/* P3 Flexible */}
                    <div className="p-5 bg-gradient-to-br from-blue-50 to-blue-100/40 border border-blue-200/80 rounded-2xl relative overflow-hidden">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-blue-700 flex items-center gap-1.5">
                                <Layers className="w-3.5 h-3.5 text-blue-600" />
                                P3 · Flexible
                            </span>
                            <span className="px-2 py-0.5 bg-blue-200/70 text-blue-900 rounded-md text-[10px] font-black">
                                {stats.p3Count} Items
                            </span>
                        </div>
                        <p className="text-xl md:text-2xl font-black text-blue-950 flex items-center">
                            <IndianRupee className="w-4 h-4 mr-0.5 text-blue-600" />
                            {stats.p3Value.toLocaleString('en-IN')}
                        </p>
                        <p className="text-[10px] font-bold text-blue-600/90 mt-1">
                            No SLA / TAT constraint
                        </p>
                    </div>

                    {/* Settled / Closed */}
                    <div className="p-5 bg-gradient-to-br from-emerald-50 to-emerald-100/40 border border-emerald-200/80 rounded-2xl relative overflow-hidden">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                Closed / Paid
                            </span>
                            <span className="px-2 py-0.5 bg-emerald-200/70 text-emerald-900 rounded-md text-[10px] font-black">
                                {stats.completedCount} Done
                            </span>
                        </div>
                        <p className="text-xl md:text-2xl font-black text-emerald-950 flex items-center">
                            <IndianRupee className="w-4 h-4 mr-0.5 text-emerald-600" />
                            {stats.completedValue.toLocaleString('en-IN')}
                        </p>
                        <p className="text-[10px] font-bold text-emerald-600/90 mt-1">
                            Cleared & fulfilled
                        </p>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs (Kanban vs Task Sheet vs Analytics) */}
            <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-xs w-fit">
                <button
                    onClick={() => setActiveView('kanban')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        activeView === 'kanban'
                            ? 'bg-primary text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <LayoutDashboard className="w-4 h-4" />
                    Urgency Kanban Board ({stats.totalActive})
                </button>

                <button
                    onClick={() => setActiveView('task_sheet')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        activeView === 'task_sheet'
                            ? 'bg-primary text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-800'
                    }`}
                >
                    <FileSpreadsheet className="w-4 h-4" />
                    Daily & Weekly Task Sheet
                </button>
            </div>

            {/* View Render */}
            <AnimatePresence mode="wait">
                {activeView === 'kanban' && (
                    <motion.div
                        key="kanban"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                    >
                        <PaymentUrgencyKanban
                            tasks={tasks}
                            isSuperAdmin={isSuperAdmin}
                            onSelectTask={handleOpenDetails}
                            onMoveTier={handleMoveTier}
                            onOpenNewModal={() => setIsNewModalOpen(true)}
                        />
                    </motion.div>
                )}

                {activeView === 'task_sheet' && (
                    <motion.div
                        key="task_sheet"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                    >
                        <TaskSheetUploadView
                            tasks={tasks}
                            onAddTasks={handleAddTasks}
                            onOpenNewModal={() => setIsNewModalOpen(true)}
                            onSelectTask={handleOpenDetails}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Modals */}
            <TaskDetailsModal
                isOpen={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
                task={selectedTask}
                isSuperAdmin={isSuperAdmin}
                onUpdateTask={handleUpdateTask}
            />

            <NewTaskModal
                isOpen={isNewModalOpen}
                onClose={() => setIsNewModalOpen(false)}
                onAddTask={(newTask) => handleAddTasks([newTask])}
                userName={user?.user_metadata?.full_name || 'Procurement User'}
                userEmail={user?.email || 'procurement@autopilotoffices.com'}
            />
        </div>
    );
}
