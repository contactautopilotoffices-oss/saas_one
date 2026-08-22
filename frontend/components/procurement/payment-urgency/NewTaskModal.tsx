'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    X, Plus, Building2, IndianRupee, Calendar, 
    FileText, Tag, AlertCircle, CheckCircle2, User, Sparkles
} from 'lucide-react';
import { TaskLineItem, TaskCategory, TaskFrequency, TEST_PROPERTIES } from './mockData';

interface NewTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddTask: (task: TaskLineItem) => void;
    userEmail?: string;
    userName?: string;
}

export default function NewTaskModal({
    isOpen,
    onClose,
    onAddTask,
    userEmail = 'procurement@autopilotoffices.com',
    userName = 'Procurement Team'
}: NewTaskModalProps) {
    if (!isOpen) return null;

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [propertyId, setPropertyId] = useState('prop-ss-plaza');
    const [category, setCategory] = useState<TaskCategory>('consumables');
    const [frequency, setFrequency] = useState<TaskFrequency>('daily');
    const [amount, setAmount] = useState<number | ''>('');
    const [vendorName, setVendorName] = useState('');
    const [invoiceRef, setInvoiceRef] = useState('');
    const [urgencyPreference, setUrgencyPreference] = useState<'P1' | 'P2' | 'P3'>('P2');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title || !vendorName || amount === '') return;

        setIsSubmitting(true);
        const selectedProp = TEST_PROPERTIES.find(p => p.id === propertyId);
        const propName = selectedProp ? selectedProp.name.split(' (')[0] : 'SS Plaza Tower A';

        const randomCode = `PUT-0821-${Math.floor(10 + Math.random() * 90)}`;

        let tatDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        let tatLabel = '7 Days TAT';

        if (urgencyPreference === 'P1') {
            tatDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            tatLabel = 'Immediate (< 24h)';
        } else if (urgencyPreference === 'P3') {
            tatDeadline = 'Flexible (No SLA)';
            tatLabel = 'Flexible (No SLA)';
        }

        const newTask: TaskLineItem = {
            id: `task-${Date.now()}`,
            task_code: randomCode,
            title,
            description: description || 'No additional details provided.',
            property_id: propertyId,
            property_name: propName,
            category,
            frequency,
            urgency_tier: urgencyPreference,
            tat_deadline: tatDeadline,
            tat_label: tatLabel,
            estimated_amount: Number(amount),
            vendor_name: vendorName,
            vendor_invoice_ref: invoiceRef || undefined,
            requested_by_name: userName,
            requested_by_email: userEmail,
            requested_at: new Date().toISOString(),
            status: 'pending_triage',
            payment_status: 'unpaid',
            tags: [frequency, category.replace('_', ' ')]
        };

        setTimeout(() => {
            onAddTask(newTask);
            setIsSubmitting(false);
            onClose();
        }, 300);
    };

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

                {/* Modal Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 16 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 16 }}
                    className="relative w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden z-10 font-inter max-h-[90vh] flex flex-col"
                >
                    {/* Header */}
                    <div className="p-6 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                                Procurement Task Sheet Module
                            </span>
                            <h2 className="text-xl font-black text-slate-900 tracking-tight">
                                New Payment Requirement / Task Entry
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-all"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Form Body */}
                    <form onSubmit={handleSubmit} className="p-6 md:p-8 overflow-y-auto space-y-5 custom-scrollbar">
                        {/* Title */}
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                Task / Payment Item Title *
                            </label>
                            <input
                                required
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g., Weekly Cleaning Chemicals & Sanitizer Batch Restock"
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all"
                            />
                        </div>

                        {/* Property & Category */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                    Target Property *
                                </label>
                                <select
                                    value={propertyId}
                                    onChange={(e) => setPropertyId(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all cursor-pointer"
                                >
                                    {TEST_PROPERTIES.filter(p => p.id !== 'all').map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                    Category *
                                </label>
                                <select
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value as TaskCategory)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all cursor-pointer"
                                >
                                    <option value="consumables">Consumables & Housekeeping</option>
                                    <option value="emergency_repair">Emergency Breakdown & Repair</option>
                                    <option value="utility_bill">Utility & Tanker Supply</option>
                                    <option value="vendor_amc">Vendor AMC Maintenance</option>
                                    <option value="raw_material">Raw Materials & Hardware</option>
                                    <option value="contractor_milestone">Contractor Milestone</option>
                                    <option value="general_ops">General Operations</option>
                                </select>
                            </div>
                        </div>

                        {/* Frequency & Requested Urgency */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                    Task Frequency Type
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['daily', 'weekly', 'emergency'] as TaskFrequency[]).map(freq => (
                                        <button
                                            type="button"
                                            key={freq}
                                            onClick={() => setFrequency(freq)}
                                            className={`py-2.5 rounded-xl border text-[11px] font-black uppercase tracking-wider capitalize transition-all cursor-pointer ${
                                                frequency === freq
                                                    ? 'bg-primary text-white border-primary shadow-sm'
                                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                            }`}
                                        >
                                            {freq}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                    Requested Urgency Tier
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { tier: 'P1' as const, label: 'P1 (Immediate)', color: 'text-rose-600 border-rose-200 bg-rose-50' },
                                        { tier: 'P2' as const, label: 'P2 (7 Days)', color: 'text-amber-600 border-amber-200 bg-amber-50' },
                                        { tier: 'P3' as const, label: 'P3 (No SLA)', color: 'text-blue-600 border-blue-200 bg-blue-50' }
                                    ].map(item => (
                                        <button
                                            type="button"
                                            key={item.tier}
                                            onClick={() => setUrgencyPreference(item.tier)}
                                            className={`py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                                urgencyPreference === item.tier
                                                    ? `${item.color} ring-2 ring-primary/20 font-black shadow-xs`
                                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                            }`}
                                        >
                                            {item.tier}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Amount & Vendor */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                    Estimated Amount (₹) *
                                </label>
                                <div className="relative">
                                    <IndianRupee className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        required
                                        type="number"
                                        min="1"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                                        placeholder="45000"
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                    Vendor / Beneficiary Name *
                                </label>
                                <input
                                    required
                                    type="text"
                                    value={vendorName}
                                    onChange={(e) => setVendorName(e.target.value)}
                                    placeholder="e.g. Voltas Facility Care / Diversey"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all"
                                />
                            </div>
                        </div>

                        {/* Invoice Ref & Description */}
                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                Vendor Quotation / Bill Reference (Optional)
                            </label>
                            <input
                                type="text"
                                value={invoiceRef}
                                onChange={(e) => setInvoiceRef(e.target.value)}
                                placeholder="e.g. INV-2026-8812 or Quote Ref #441"
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                Scope & Description
                            </label>
                            <textarea
                                rows={3}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Provide brief rationale, site urgency reason, or deliverables..."
                                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white transition-all resize-none"
                            />
                        </div>

                        {/* Submit Button */}
                        <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-5 py-2.5 bg-slate-50 border border-slate-200 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-100 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white font-black text-xs rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50"
                            >
                                <Plus className="w-4 h-4" />
                                {isSubmitting ? 'Submitting...' : 'Upload to Task Board'}
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
