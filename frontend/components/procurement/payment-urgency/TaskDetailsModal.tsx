'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    X, AlertCircle, Clock, CheckCircle2, Shield, 
    Building2, IndianRupee, Calendar, User, Tag, 
    FileText, Send, ArrowRight, Check, AlertTriangle,
    CreditCard, Sparkles, RefreshCw
} from 'lucide-react';
import { TaskLineItem, UrgencyTier, TaskStatus } from './mockData';

interface TaskDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    task: TaskLineItem | null;
    isSuperAdmin: boolean;
    onUpdateTask: (updatedTask: TaskLineItem) => void;
}

export default function TaskDetailsModal({
    isOpen,
    onClose,
    task,
    isSuperAdmin,
    onUpdateTask
}: TaskDetailsModalProps) {
    if (!isOpen || !task) return null;

    const [currentTier, setCurrentTier] = useState<UrgencyTier>(task.urgency_tier);
    const [currentStatus, setCurrentStatus] = useState<TaskStatus>(task.status);
    const [paymentStatus, setPaymentStatus] = useState(task.payment_status);
    const [triageNotes, setTriageNotes] = useState(task.triage_notes || '');
    const [isSaving, setIsSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);

    const handleSave = () => {
        setIsSaving(true);
        setTimeout(() => {
            let tatLabel = task.tat_label;
            let tatDeadline = task.tat_deadline;

            if (currentTier === 'P1') {
                tatLabel = 'Immediate (< 24h)';
                tatDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            } else if (currentTier === 'P2') {
                tatLabel = '7 Days TAT';
                tatDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            } else if (currentTier === 'P3') {
                tatLabel = 'Flexible (No SLA)';
                tatDeadline = 'Flexible (No SLA)';
            } else if (currentTier === 'COMPLETED') {
                tatLabel = 'Executed';
            }

            const updated: TaskLineItem = {
                ...task,
                urgency_tier: currentTier,
                status: currentStatus,
                payment_status: paymentStatus,
                tat_label: tatLabel,
                tat_deadline: tatDeadline,
                triage_notes: triageNotes,
                triaged_by_name: isSuperAdmin ? 'Org Super Admin' : task.triaged_by_name,
                triaged_by_email: isSuperAdmin ? 'superadmin@autopilotoffices.com' : task.triaged_by_email,
                triaged_at: new Date().toISOString()
            };

            onUpdateTask(updated);
            setIsSaving(false);
            setSavedSuccess(true);
            setTimeout(() => {
                setSavedSuccess(false);
                onClose();
            }, 600);
        }, 300);
    };

    const getTierBadge = (tier: UrgencyTier) => {
        switch (tier) {
            case 'P1':
                return {
                    bg: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
                    dot: 'bg-rose-500 animate-pulse',
                    label: 'P1 · Immediate (< 24h TAT)'
                };
            case 'P2':
                return {
                    bg: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
                    dot: 'bg-amber-500',
                    label: 'P2 · 7 Days TAT'
                };
            case 'P3':
                return {
                    bg: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
                    dot: 'bg-blue-500',
                    label: 'P3 · Flexible (No SLA)'
                };
            case 'COMPLETED':
                return {
                    bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
                    dot: 'bg-emerald-500',
                    label: 'Closed / Fulfilled'
                };
        }
    };

    const currentBadge = getTierBadge(currentTier);

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
                />

                {/* Modal Window */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 12 }}
                    className="relative w-full max-w-3xl bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden z-10 max-h-[92vh] flex flex-col font-inter"
                >
                    {/* Header */}
                    <div className="p-6 md:p-8 border-b border-slate-100 bg-slate-50/70 flex items-start justify-between gap-4">
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2.5">
                                <span className="px-3 py-1 bg-slate-200/80 text-slate-700 font-black text-[10px] rounded-lg tracking-wider uppercase">
                                    {task.task_code}
                                </span>
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${currentBadge.bg}`}>
                                    <span className={`w-2 h-2 rounded-full ${currentBadge.dot}`} />
                                    {currentBadge.label}
                                </span>
                                <span className="px-2.5 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 font-black text-[10px] rounded-lg uppercase tracking-wider">
                                    {task.frequency} task
                                </span>
                            </div>
                            <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight leading-snug">
                                {task.title}
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-all"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="p-6 md:p-8 overflow-y-auto space-y-6 custom-scrollbar">
                        {/* Quick Stats Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Amount</p>
                                <p className="text-lg font-black text-slate-900 flex items-center">
                                    <IndianRupee className="w-4 h-4 mr-0.5 text-primary" />
                                    {task.estimated_amount.toLocaleString('en-IN')}
                                </p>
                            </div>
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Property</p>
                                <p className="text-xs font-black text-slate-800 truncate" title={task.property_name}>
                                    {task.property_name}
                                </p>
                            </div>
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Vendor / Beneficiary</p>
                                <p className="text-xs font-black text-slate-800 truncate" title={task.vendor_name}>
                                    {task.vendor_name}
                                </p>
                            </div>
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Invoice Ref</p>
                                <p className="text-xs font-black text-slate-700">
                                    {task.vendor_invoice_ref || 'PO Pending'}
                                </p>
                            </div>
                        </div>

                        {/* Description */}
                        <div className="bg-slate-50/60 p-5 rounded-2xl border border-slate-200/80">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Requirement Details</p>
                            <p className="text-sm font-medium text-slate-700 leading-relaxed">
                                {task.description}
                            </p>
                            {task.tags && task.tags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-4">
                                    {task.tags.map((t, i) => (
                                        <span key={i} className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600">
                                            #{t}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Org Super Admin Triaging Section */}
                        <div className={`p-6 rounded-2xl border ${isSuperAdmin ? 'bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/30 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Shield className={`w-4 h-4 ${isSuperAdmin ? 'text-primary' : 'text-slate-400'}`} />
                                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-900">
                                        Org Super Admin Triage & Urgency Configuration
                                    </h4>
                                </div>
                                {isSuperAdmin ? (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-primary/10 text-primary uppercase tracking-wider">
                                        Super Admin Control
                                    </span>
                                ) : (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-slate-200 text-slate-600 uppercase tracking-wider">
                                        Procurement Read Mode
                                    </span>
                                )}
                            </div>

                            {/* Urgency Tier Selector (Super Admin enabled, Procurement disabled/read-only) */}
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                        Urgency Tier Classification (SLA & TAT)
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                        {[
                                            { tier: 'P1' as UrgencyTier, title: 'P1 · Immediate', sub: '< 24 Hours TAT', color: 'border-rose-400 bg-rose-50/50 text-rose-700' },
                                            { tier: 'P2' as UrgencyTier, title: 'P2 · 7 Days', sub: 'Weekly Cycle', color: 'border-amber-400 bg-amber-50/50 text-amber-700' },
                                            { tier: 'P3' as UrgencyTier, title: 'P3 · Flexible', sub: 'No SLA TAT', color: 'border-blue-400 bg-blue-50/50 text-blue-700' },
                                            { tier: 'COMPLETED' as UrgencyTier, title: 'Closed', sub: 'Paid / Fulfilled', color: 'border-emerald-400 bg-emerald-50/50 text-emerald-700' }
                                        ].map(item => {
                                            const isSelected = currentTier === item.tier;
                                            return (
                                                <button
                                                    key={item.tier}
                                                    type="button"
                                                    disabled={!isSuperAdmin}
                                                    onClick={() => setCurrentTier(item.tier)}
                                                    className={`p-3 rounded-xl border text-left transition-all relative ${
                                                        isSelected
                                                            ? `${item.color} shadow-sm ring-2 ring-primary/20 font-black`
                                                            : 'border-slate-200 bg-white hover:border-slate-300 text-slate-600'
                                                    } ${!isSuperAdmin ? 'opacity-80 cursor-default' : 'cursor-pointer'}`}
                                                >
                                                    <p className="text-xs font-black leading-none mb-1">{item.title}</p>
                                                    <p className="text-[10px] font-bold opacity-70">{item.sub}</p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Status & Payment Approval Grid */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                            Workflow Status
                                        </label>
                                        <select
                                            disabled={!isSuperAdmin}
                                            value={currentStatus}
                                            onChange={(e) => setCurrentStatus(e.target.value as TaskStatus)}
                                            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 cursor-pointer"
                                        >
                                            <option value="pending_triage">Pending Triage Review</option>
                                            <option value="approved_for_payment">Approved for Payment</option>
                                            <option value="in_progress">In Progress / Execution</option>
                                            <option value="dispatched">Dispatched on Site</option>
                                            <option value="paid">Paid & Settled</option>
                                            <option value="deferred">Deferred / On Hold</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                            Payment Clearance Status
                                        </label>
                                        <select
                                            disabled={!isSuperAdmin}
                                            value={paymentStatus}
                                            onChange={(e) => setPaymentStatus(e.target.value as any)}
                                            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 cursor-pointer"
                                        >
                                            <option value="unpaid">Unpaid (Awaiting Authorization)</option>
                                            <option value="processing">Processing (Accounts Queue)</option>
                                            <option value="paid">Paid (Disbursed via UPI/RTGS)</option>
                                            <option value="hold">Hold (Payment Blocked)</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Triage Notes */}
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                        Super Admin Instructions / Justification
                                    </label>
                                    {isSuperAdmin ? (
                                        <textarea
                                            rows={2}
                                            value={triageNotes}
                                            onChange={(e) => setTriageNotes(e.target.value)}
                                            placeholder="Add priority justification, payment release terms, or execution instructions for procurement team..."
                                            className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                                        />
                                    ) : (
                                        <p className="p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 italic">
                                            {task.triage_notes || 'No specific instructions logged by Super Admin yet.'}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Audit Trail Info */}
                        <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100 gap-2">
                            <div>
                                Requested by: <span className="font-bold text-slate-700">{task.requested_by_name}</span> ({task.requested_by_email})
                            </div>
                            <div>
                                Triaged by: <span className="font-bold text-slate-700">{task.triaged_by_name || 'Pending Review'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-5 md:p-6 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between gap-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-all"
                        >
                            Close
                        </button>

                        <div className="flex items-center gap-3">
                            {isSuperAdmin ? (
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white text-xs font-black rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50"
                                >
                                    {isSaving ? (
                                        <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            Saving Changes...
                                        </>
                                    ) : savedSuccess ? (
                                        <>
                                            <Check className="w-3.5 h-3.5 text-white" />
                                            Saved!
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            Apply Super Admin Triage
                                        </>
                                    )}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const updated = {
                                            ...task,
                                            status: task.status === 'in_progress' ? 'approved_for_payment' : 'in_progress' as TaskStatus
                                        };
                                        onUpdateTask(updated);
                                        onClose();
                                    }}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-xs font-black rounded-xl shadow-md hover:bg-indigo-700 transition-all"
                                >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {task.status === 'in_progress' ? 'Mark Task Executed' : 'Acknowledge & Start Execution'}
                                </button>
                            )}
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
