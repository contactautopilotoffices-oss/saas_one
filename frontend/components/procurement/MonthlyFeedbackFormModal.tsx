'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, CheckCircle2, AlertCircle, Calendar, Sparkles,
    FileText, ThumbsUp, ShieldCheck, Clock, UserCheck, MessageSquare, Loader2
} from 'lucide-react';

interface Property {
    id: string;
    name: string;
}

interface MonthlyFeedbackFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    properties?: Property[];
    selectedPropertyId?: string;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export default function MonthlyFeedbackFormModal({
    isOpen,
    onClose,
    onSuccess,
    properties = [],
    selectedPropertyId
}: MonthlyFeedbackFormModalProps) {
    const currentDate = new Date();
    const [propertyId, setPropertyId] = useState<string>(selectedPropertyId || (properties[0]?.id || ''));
    const [month, setMonth] = useState<number>(currentDate.getMonth() + 1);
    const [year, setYear] = useState<number>(currentDate.getFullYear());

    // Category 1: Housekeeping, Beverages & Tissue
    const [hkReceived, setHkReceived] = useState<'Yes' | 'No'>('Yes');
    const [hkReceivedRemark, setHkReceivedRemark] = useState<string>('');
    const [hkQuality, setHkQuality] = useState<'High' | 'Medium' | 'Low'>('High');
    const [hkQualityRemark, setHkQualityRemark] = useState<string>('');

    // Category 2: Manpower
    const [mpQuality, setMpQuality] = useState<'Good' | 'Average' | 'Poor'>('Good');
    const [mpQualityRemark, setMpQualityRemark] = useState<string>('');
    const [mpRelieverOnTime, setMpRelieverOnTime] = useState<'Yes' | 'No'>('Yes');
    const [mpRelieverRemark, setMpRelieverRemark] = useState<string>('');

    // Category 3: AMC
    const [amcReportOnTime, setAmcReportOnTime] = useState<'Yes' | 'No'>('Yes');
    const [amcReportRemark, setAmcReportRemark] = useState<string>('');
    const [amcServiceOnSchedule, setAmcServiceOnSchedule] = useState<'Yes' | 'No'>('Yes');
    const [amcScheduleRemark, setAmcScheduleRemark] = useState<string>('');

    const [remarks, setRemarks] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    React.useEffect(() => {
        if (selectedPropertyId) {
            setPropertyId(selectedPropertyId);
        } else if (properties.length > 0 && !propertyId) {
            setPropertyId(properties[0].id);
        }
    }, [selectedPropertyId, properties]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setSuccessMsg(null);

        if (!propertyId) {
            setErrorMsg('Please select a property.');
            return;
        }

        setIsSubmitting(true);

        try {
            const res = await fetch('/api/procurement/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    property_id: propertyId,
                    month,
                    year,
                    hk_received_as_approved: hkReceived,
                    hk_received_remark: hkReceivedRemark,
                    hk_material_quality: hkQuality,
                    hk_quality_remark: hkQualityRemark,
                    manpower_quality_satisfaction: mpQuality,
                    manpower_quality_remark: mpQualityRemark,
                    manpower_reliever_on_time: mpRelieverOnTime,
                    manpower_reliever_remark: mpRelieverRemark,
                    amc_service_report_on_time: amcReportOnTime,
                    amc_report_remark: amcReportRemark,
                    amc_services_on_schedule: amcServiceOnSchedule,
                    amc_schedule_remark: amcScheduleRemark,
                    remarks
                })
            });

            const data = await res.json();

            if (!res.ok) {
                setErrorMsg(data.error || 'Failed to submit monthly feedback.');
                setIsSubmitting(false);
                return;
            }

            setSuccessMsg('Monthly feedback submitted successfully!');
            setTimeout(() => {
                setIsSubmitting(false);
                if (onSuccess) onSuccess();
                onClose();
            }, 1200);
        } catch (err: any) {
            console.error('Submission error:', err);
            setErrorMsg(err.message || 'Network error while submitting feedback.');
            setIsSubmitting(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-8"
                >
                    {/* Header */}
                    <div className="relative px-6 py-5 bg-gradient-to-r from-amber-500/10 via-primary/5 to-purple-500/10 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold shadow-2xs">
                                <FileText className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    Monthly Requisition & Vendor Feedback
                                    <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                                </h3>
                                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                    Consolidated evaluation for Property Requisitions, Manpower & AMC Vendors
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Form Content */}
                    <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[78vh] overflow-y-auto custom-scrollbar">
                        {errorMsg && (
                            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2.5">
                                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                                <span>{errorMsg}</span>
                            </div>
                        )}

                        {successMsg && (
                            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2.5">
                                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                                <span>{successMsg}</span>
                            </div>
                        )}

                        {/* Target Selection: Property, Month, Year */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                                    Property
                                </label>
                                {properties.length > 0 ? (
                                    <select
                                        value={propertyId}
                                        onChange={(e) => setPropertyId(e.target.value)}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        {properties.map((p) => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        readOnly
                                        value="Assigned Property"
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-500"
                                    />
                                )}
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                                    Evaluation Month
                                </label>
                                <select
                                    value={month}
                                    onChange={(e) => setMonth(Number(e.target.value))}
                                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary/20"
                                >
                                    {MONTH_NAMES.map((name, idx) => (
                                        <option key={idx + 1} value={idx + 1}>{name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                                    Year
                                </label>
                                <select
                                    value={year}
                                    onChange={(e) => setYear(Number(e.target.value))}
                                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary/20"
                                >
                                    {[currentDate.getFullYear() - 1, currentDate.getFullYear(), currentDate.getFullYear() + 1].map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* SECTION 1: Housekeeping, Beverages & Tissue */}
                        <div className="space-y-4 p-4 rounded-2xl border border-amber-200/80 dark:border-amber-900/40 bg-amber-500/5">
                            <div className="flex items-center gap-2 pb-2 border-b border-amber-200/50 dark:border-amber-900/30">
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                                    Housekeeping, Beverages & Tissue
                                </h4>
                            </div>

                            {/* Q1 */}
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    1. Was the material received as per your approved requisition?
                                </p>
                                <div className="flex items-center gap-3">
                                    {(['Yes', 'No'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            type="button"
                                            onClick={() => setHkReceived(opt)}
                                            className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${hkReceived === opt
                                                    ? opt === 'Yes'
                                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                                        : 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                                                }`}
                                        >
                                            {opt === 'Yes' ? '☐ Yes' : '☐ No'}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    value={hkReceivedRemark}
                                    onChange={(e) => setHkReceivedRemark(e.target.value)}
                                    placeholder="Remark for Q1 (Optional)..."
                                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-amber-500/20 transition-all font-medium"
                                />
                            </div>

                            {/* Q2 */}
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    2. How would you rate the quality of the material received?
                                </p>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['High', 'Medium', 'Low'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            type="button"
                                            onClick={() => setHkQuality(opt)}
                                            className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${hkQuality === opt
                                                    ? opt === 'High'
                                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                                        : opt === 'Medium'
                                                            ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                                                            : 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                                                }`}
                                        >
                                            ☐ {opt}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    value={hkQualityRemark}
                                    onChange={(e) => setHkQualityRemark(e.target.value)}
                                    placeholder="Remark for Q2 (Optional)..."
                                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-amber-500/20 transition-all font-medium"
                                />
                            </div>
                        </div>

                        {/* SECTION 2: Manpower */}
                        <div className="space-y-4 p-4 rounded-2xl border border-blue-200/80 dark:border-blue-900/40 bg-blue-500/5">
                            <div className="flex items-center gap-2 pb-2 border-b border-blue-200/50 dark:border-blue-900/30">
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                                <h4 className="text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300">
                                    Manpower
                                </h4>
                            </div>

                            {/* Q1 */}
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    1. How satisfied are you with the quality of manpower services provided?
                                </p>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['Good', 'Average', 'Poor'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            type="button"
                                            onClick={() => setMpQuality(opt)}
                                            className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${mpQuality === opt
                                                    ? opt === 'Good'
                                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                                        : opt === 'Average'
                                                            ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                                                            : 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                                                }`}
                                        >
                                            ☐ {opt}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    value={mpQualityRemark}
                                    onChange={(e) => setMpQualityRemark(e.target.value)}
                                    placeholder="Remark for Manpower Quality (Optional)..."
                                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                                />
                            </div>

                            {/* Q2 */}
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    2. Does the reliever report on time when required?
                                </p>
                                <div className="flex items-center gap-3">
                                    {(['Yes', 'No'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            type="button"
                                            onClick={() => setMpRelieverOnTime(opt)}
                                            className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${mpRelieverOnTime === opt
                                                    ? opt === 'Yes'
                                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                                        : 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                                                }`}
                                        >
                                            {opt === 'Yes' ? '☐ Yes' : '☐ No'}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    value={mpRelieverRemark}
                                    onChange={(e) => setMpRelieverRemark(e.target.value)}
                                    placeholder="Remark for Reliever Punctuality (Optional)..."
                                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                                />
                            </div>
                        </div>

                        {/* SECTION 3: AMC (Annual Maintenance Contract) */}
                        <div className="space-y-4 p-4 rounded-2xl border border-purple-200/80 dark:border-purple-900/40 bg-purple-500/5">
                            <div className="flex items-center gap-2 pb-2 border-b border-purple-200/50 dark:border-purple-900/30">
                                <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-800 dark:text-purple-300">
                                    AMC (Annual Maintenance Contract)
                                </h4>
                            </div>

                            {/* Q1 */}
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    1. Does the vendor provide the service report on time?
                                </p>
                                <div className="flex items-center gap-3">
                                    {(['Yes', 'No'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            type="button"
                                            onClick={() => setAmcReportOnTime(opt)}
                                            className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${amcReportOnTime === opt
                                                    ? opt === 'Yes'
                                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                                        : 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                                                }`}
                                        >
                                            {opt === 'Yes' ? '☐ Yes' : '☐ No'}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    value={amcReportRemark}
                                    onChange={(e) => setAmcReportRemark(e.target.value)}
                                    placeholder="Remark for Service Report (Optional)..."
                                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-purple-500/20 transition-all font-medium"
                                />
                            </div>

                            {/* Q2 */}
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    2. Does the vendor provide the required services within the scheduled time?
                                </p>
                                <div className="flex items-center gap-3">
                                    {(['Yes', 'No'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            type="button"
                                            onClick={() => setAmcServiceOnSchedule(opt)}
                                            className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${amcServiceOnSchedule === opt
                                                    ? opt === 'Yes'
                                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                                        : 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                                                }`}
                                        >
                                            {opt === 'Yes' ? '☐ Yes' : '☐ No'}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    value={amcScheduleRemark}
                                    onChange={(e) => setAmcScheduleRemark(e.target.value)}
                                    placeholder="Remark for Service Schedule (Optional)..."
                                    className="w-full px-3 py-1.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-purple-500/20 transition-all font-medium"
                                />
                            </div>
                        </div>

                        {/* Optional Overall Remarks */}
                        <div className="space-y-2">
                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                                Additional Overall Remarks / Comments (Optional)
                            </label>
                            <textarea
                                rows={3}
                                value={remarks}
                                onChange={(e) => setRemarks(e.target.value)}
                                placeholder="Specify any general details regarding material delays, quality issues, or vendor notes..."
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        </div>

                        {/* Actions */}
                        <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isSubmitting}
                                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="px-6 py-2.5 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-white shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 className="w-4 h-4" />
                                        Submit Monthly Feedback
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
