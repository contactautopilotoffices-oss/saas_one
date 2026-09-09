'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    FileText, Search, Filter, AlertTriangle, CheckCircle2,
    Calendar, RefreshCw, Sparkles, Building2, User, Clock,
    ThumbsUp, ShieldCheck, ChevronDown, Download, MessageSquare, X
} from 'lucide-react';
import MonthlyFeedbackFormModal from './MonthlyFeedbackFormModal';

interface FeedbackItem {
    id: string;
    organization_id: string;
    property_id: string;
    month: number;
    year: number;
    submitted_by: string;
    created_at: string;
    updated_at: string;
    hk_received_as_approved: 'Yes' | 'No';
    hk_received_remark?: string;
    hk_material_quality: 'High' | 'Medium' | 'Low';
    hk_quality_remark?: string;
    manpower_quality_satisfaction: 'Good' | 'Average' | 'Poor';
    manpower_quality_remark?: string;
    manpower_reliever_on_time: 'Yes' | 'No';
    manpower_reliever_remark?: string;
    amc_service_report_on_time: 'Yes' | 'No';
    amc_report_remark?: string;
    amc_services_on_schedule: 'Yes' | 'No';
    amc_schedule_remark?: string;
    has_negative_issues: boolean;
    remarks?: string;
    properties?: { id: string; name: string };
    submitter?: { id: string; full_name: string; email: string; role?: string };
}

interface Stats {
    total: number;
    negativeCount: number;
    hkOkPercent: number;
    manpowerOkPercent: number;
    amcOkPercent: number;
}

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

interface ProcurementFeedbackTabProps {
    organizationId?: string;
    properties?: { id: string; name: string }[];
    currentPropertyId?: string;
    isPropertyAdmin?: boolean;
}

export default function ProcurementFeedbackTab({
    organizationId,
    properties = [],
    currentPropertyId,
    isPropertyAdmin = false
}: ProcurementFeedbackTabProps) {
    const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
    const [stats, setStats] = useState<Stats>({
        total: 0,
        negativeCount: 0,
        hkOkPercent: 100,
        manpowerOkPercent: 100,
        amcOkPercent: 100
    });

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [selectedPropertyId, setSelectedPropertyId] = useState<string>(currentPropertyId || '');
    const [filterHasIssues, setFilterHasIssues] = useState<boolean>(false);
    const [selectedMonth, setSelectedMonth] = useState<string>('all');
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [selectedDetail, setSelectedDetail] = useState<FeedbackItem | null>(null);

    const fetchFeedbacks = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (organizationId) params.append('organizationId', organizationId);
            if (selectedPropertyId) params.append('propertyId', selectedPropertyId);
            if (filterHasIssues) params.append('hasIssues', 'true');
            if (selectedMonth !== 'all') params.append('month', selectedMonth);

            const res = await fetch(`/api/procurement/feedback?${params.toString()}`);
            if (res.ok) {
                const result = await res.json();
                setFeedbacks(result.data || []);
                if (result.stats) setStats(result.stats);
            }
        } catch (err) {
            console.error('Failed to fetch monthly feedback:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleExportCSV = () => {
        if (feedbacks.length === 0) return;
        const headers = [
            'Property Name', 'Month', 'Year', 'Submitted By Name', 'Submitted By Email',
            'Submission Timestamp', 'HK Received As Approved', 'HK Material Quality',
            'Manpower Quality', 'Manpower Reliever On Time', 'AMC Report On Time',
            'AMC Service On Schedule', 'Issues Flagged', 'Remarks'
        ];
        const rows = feedbacks.map(item => [
            `"${item.properties?.name || ''}"`,
            `"${MONTH_NAMES[item.month - 1] || item.month}"`,
            `"${item.year}"`,
            `"${item.submitter?.full_name || ''}"`,
            `"${item.submitter?.email || ''}"`,
            `"${new Date(item.created_at).toLocaleString('en-IN')}"`,
            `"${item.hk_received_as_approved}"`,
            `"${item.hk_material_quality}"`,
            `"${item.manpower_quality_satisfaction}"`,
            `"${item.manpower_reliever_on_time}"`,
            `"${item.amc_service_report_on_time}"`,
            `"${item.amc_services_on_schedule}"`,
            `"${item.has_negative_issues ? 'Yes' : 'No'}"`,
            `"${(item.remarks || '').replace(/"/g, '""')}"`
        ]);

        const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `Monthly_Requisition_Feedback_Responses_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    useEffect(() => {
        fetchFeedbacks();
    }, [selectedPropertyId, filterHasIssues, selectedMonth]);

    const filteredFeedbacks = feedbacks.filter(item => {
        const propName = item.properties?.name || '';
        const submitterName = item.submitter?.full_name || '';
        const submitterEmail = item.submitter?.email || '';
        const query = searchQuery.toLowerCase();

        return (
            propName.toLowerCase().includes(query) ||
            submitterName.toLowerCase().includes(query) ||
            submitterEmail.toLowerCase().includes(query)
        );
    });

    return (
        <div className="space-y-6">
            {/* Header & Main Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        Monthly Requisition Feedback
                        <Sparkles className="w-5 h-5 text-amber-500" />
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Property admin evaluations for monthly material requisitions, manpower quality & AMC vendor compliance
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handleExportCSV}
                        disabled={feedbacks.length === 0}
                        className="px-3.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 text-xs font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                        title="Download all feedback responses in Excel/CSV format"
                    >
                        <Download className="w-3.5 h-3.5 text-emerald-600" />
                        Export Responses (CSV)
                    </button>

                    <button
                        type="button"
                        onClick={fetchFeedbacks}
                        className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>

                    {isPropertyAdmin && (
                        <button
                            type="button"
                            onClick={() => setIsModalOpen(true)}
                            className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                        >
                            <FileText className="w-4 h-4" />
                            + Fill Monthly Feedback
                        </button>
                    )}
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">
                        <span>Total Evaluated</span>
                        <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white">
                        {stats.total}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Monthly Property Reports
                    </div>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">
                        <span>Issues Flagged</span>
                        <AlertTriangle className="w-4 h-4 text-rose-500" />
                    </div>
                    <div className="text-2xl font-black text-rose-600 dark:text-rose-400">
                        {stats.negativeCount}
                    </div>
                    <div className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-1 font-semibold">
                        Requires Vendor Action
                    </div>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">
                        <span>Housekeeping Quality</span>
                        <ShieldCheck className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white">
                        {stats.hkOkPercent}%
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Material & Quantity Match
                    </div>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">
                        <span>Manpower Satisfaction</span>
                        <ThumbsUp className="w-4 h-4 text-blue-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white">
                        {stats.manpowerOkPercent}%
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Good/Average & Punctual
                    </div>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">
                        <span>AMC Compliance</span>
                        <Clock className="w-4 h-4 text-purple-500" />
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white">
                        {stats.amcOkPercent}%
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        On-time Service & Reports
                    </div>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 flex-1">
                    {/* Search */}
                    <div className="relative min-w-[220px] flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search property, submitter..."
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </div>

                    {/* Property Filter */}
                    {properties.length > 0 && (
                        <select
                            value={selectedPropertyId}
                            onChange={(e) => setSelectedPropertyId(e.target.value)}
                            className="px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                        >
                            <option value="">All Properties</option>
                            {properties.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    )}

                    {/* Month Filter */}
                    <select
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                    >
                        <option value="all">All Months</option>
                        {MONTH_NAMES.map((name, i) => (
                            <option key={i + 1} value={i + 1}>{name}</option>
                        ))}
                    </select>

                    {/* Issue Toggle Filter */}
                    <button
                        type="button"
                        onClick={() => setFilterHasIssues(!filterHasIssues)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${filterHasIssues
                                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 text-rose-700 dark:text-rose-300'
                                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                            }`}
                    >
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                        Flagged Issues Only
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                            <tr>
                                <th className="py-3.5 px-4">Property & Month</th>
                                <th className="py-3.5 px-4">Submitted By</th>
                                <th className="py-3.5 px-4">Date & Time</th>
                                <th className="py-3.5 px-4">HK / Beverages</th>
                                <th className="py-3.5 px-4">Manpower</th>
                                <th className="py-3.5 px-4">AMC Vendor</th>
                                <th className="py-3.5 px-4">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={7} className="py-12 text-center text-slate-400">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                                        Loading monthly feedback reports...
                                    </td>
                                </tr>
                            ) : filteredFeedbacks.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-12 text-center text-slate-400">
                                        No monthly feedback records found.
                                    </td>
                                </tr>
                            ) : (
                                filteredFeedbacks.map((item) => (
                                    <tr
                                        key={item.id}
                                        onClick={() => setSelectedDetail(item)}
                                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                                    >
                                        {/* Property & Month */}
                                        <td className="py-3.5 px-4">
                                            <div className="font-bold text-slate-900 dark:text-white text-sm">
                                                {item.properties?.name || 'Property'}
                                            </div>
                                            <div className="text-[11px] font-semibold text-primary flex items-center gap-1 mt-0.5">
                                                <Calendar className="w-3 h-3" />
                                                {MONTH_NAMES[item.month - 1]} {item.year}
                                            </div>
                                        </td>

                                        {/* Submitted By */}
                                        <td className="py-3.5 px-4">
                                            <div className="font-bold text-slate-800 dark:text-slate-200">
                                                {item.submitter?.full_name || 'Property Admin'}
                                            </div>
                                            <div className="text-[11px] text-slate-400">
                                                {item.submitter?.email || '—'}
                                            </div>
                                        </td>

                                        {/* Date & Time */}
                                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                                            <div className="font-semibold text-slate-700 dark:text-slate-300">
                                                {new Date(item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                            </div>
                                            <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                {new Date(item.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </td>

                                        {/* HK / Beverages */}
                                        <td className="py-3.5 px-4">
                                            <div className="space-y-1">
                                                <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${item.hk_received_as_approved === 'Yes'
                                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                                    }`}>
                                                    Approved Rec: {item.hk_received_as_approved}
                                                </span>
                                                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                                    Quality: <span className={item.hk_material_quality === 'Low' ? 'text-rose-600 font-bold' : 'text-slate-800 dark:text-slate-200'}>{item.hk_material_quality}</span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Manpower */}
                                        <td className="py-3.5 px-4">
                                            <div className="space-y-1">
                                                <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${item.manpower_quality_satisfaction === 'Good'
                                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                        : item.manpower_quality_satisfaction === 'Average'
                                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                                    }`}>
                                                    {item.manpower_quality_satisfaction} Quality
                                                </span>
                                                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                                    Reliever On-Time: <span className={item.manpower_reliever_on_time === 'No' ? 'text-rose-600 font-bold' : 'text-slate-800 dark:text-slate-200'}>{item.manpower_reliever_on_time}</span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* AMC */}
                                        <td className="py-3.5 px-4">
                                            <div className="space-y-1 text-[11px]">
                                                <div className="font-semibold text-slate-600 dark:text-slate-400">
                                                    Report On-Time: <span className={item.amc_service_report_on_time === 'No' ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>{item.amc_service_report_on_time}</span>
                                                </div>
                                                <div className="font-semibold text-slate-600 dark:text-slate-400">
                                                    Service On-Schedule: <span className={item.amc_services_on_schedule === 'No' ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>{item.amc_services_on_schedule}</span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Status Pill */}
                                        <td className="py-3.5 px-4">
                                            {item.has_negative_issues ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800 shadow-2xs">
                                                    <AlertTriangle className="w-3 h-3 text-rose-500" />
                                                    Issue Flagged
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shadow-2xs">
                                                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                                    Satisfactory
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal for Submission */}
            <MonthlyFeedbackFormModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={fetchFeedbacks}
                properties={properties}
                selectedPropertyId={selectedPropertyId}
            />

            {/* Detail Drawer / Modal */}
            {selectedDetail && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[85vh] my-auto overflow-hidden"
                    >
                        {/* Sticky Header */}
                        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between shrink-0 bg-white dark:bg-slate-900 sticky top-0 z-10">
                            <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                                        {selectedDetail.properties?.name}
                                    </h3>
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
                                        {MONTH_NAMES[selectedDetail.month - 1]} {selectedDetail.year}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                    Submitted by <strong className="text-slate-700 dark:text-slate-300">{selectedDetail.submitter?.full_name}</strong> on {new Date(selectedDetail.created_at).toLocaleString('en-IN')}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedDetail(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0 ml-2"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Scrollable Content Container */}
                        <div className="p-6 overflow-y-auto space-y-4 text-xs flex-1 custom-scrollbar">
                            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-200/50 space-y-2">
                                <h4 className="font-bold text-amber-800 dark:text-amber-300 uppercase text-[10px] tracking-wider mb-1">
                                    Housekeeping, Beverages & Tissue
                                </h4>
                                <div className="space-y-1.5">
                                    <div>
                                        <p className="text-slate-700 dark:text-slate-300">Material Received as Approved: <strong className={selectedDetail.hk_received_as_approved === 'Yes' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>{selectedDetail.hk_received_as_approved}</strong></p>
                                        {selectedDetail.hk_received_remark && <p className="text-[11px] text-amber-800 dark:text-amber-300 italic mt-0.5">Remark: "{selectedDetail.hk_received_remark}"</p>}
                                    </div>
                                    <div className="pt-1.5 border-t border-amber-200/30">
                                        <p className="text-slate-700 dark:text-slate-300">Material Quality Rating: <strong className={selectedDetail.hk_material_quality === 'Low' ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-emerald-600 dark:text-emerald-400 font-bold'}>{selectedDetail.hk_material_quality}</strong></p>
                                        {selectedDetail.hk_quality_remark && <p className="text-[11px] text-amber-800 dark:text-amber-300 italic mt-0.5">Remark: "{selectedDetail.hk_quality_remark}"</p>}
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-200/50 space-y-2">
                                <h4 className="font-bold text-blue-800 dark:text-blue-300 uppercase text-[10px] tracking-wider mb-1">
                                    Manpower
                                </h4>
                                <div className="space-y-1.5">
                                    <div>
                                        <p className="text-slate-700 dark:text-slate-300">Quality Satisfaction: <strong className={selectedDetail.manpower_quality_satisfaction === 'Poor' ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-emerald-600 dark:text-emerald-400 font-bold'}>{selectedDetail.manpower_quality_satisfaction}</strong></p>
                                        {selectedDetail.manpower_quality_remark && <p className="text-[11px] text-blue-800 dark:text-blue-300 italic mt-0.5">Remark: "{selectedDetail.manpower_quality_remark}"</p>}
                                    </div>
                                    <div className="pt-1.5 border-t border-blue-200/30">
                                        <p className="text-slate-700 dark:text-slate-300">Reliever On-Time: <strong className={selectedDetail.manpower_reliever_on_time === 'Yes' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>{selectedDetail.manpower_reliever_on_time}</strong></p>
                                        {selectedDetail.manpower_reliever_remark && <p className="text-[11px] text-blue-800 dark:text-blue-300 italic mt-0.5">Remark: "{selectedDetail.manpower_reliever_remark}"</p>}
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-200/50 space-y-2">
                                <h4 className="font-bold text-purple-800 dark:text-purple-300 uppercase text-[10px] tracking-wider mb-1">
                                    AMC (Annual Maintenance Contract)
                                </h4>
                                <div className="space-y-1.5">
                                    <div>
                                        <p className="text-slate-700 dark:text-slate-300">Service Report On-Time: <strong className={selectedDetail.amc_service_report_on_time === 'Yes' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>{selectedDetail.amc_service_report_on_time}</strong></p>
                                        {selectedDetail.amc_report_remark && <p className="text-[11px] text-purple-800 dark:text-purple-300 italic mt-0.5">Remark: "{selectedDetail.amc_report_remark}"</p>}
                                    </div>
                                    <div className="pt-1.5 border-t border-purple-200/30">
                                        <p className="text-slate-700 dark:text-slate-300">Services Within Scheduled Time: <strong className={selectedDetail.amc_services_on_schedule === 'Yes' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>{selectedDetail.amc_services_on_schedule}</strong></p>
                                        {selectedDetail.amc_schedule_remark && <p className="text-[11px] text-purple-800 dark:text-purple-300 italic mt-0.5">Remark: "{selectedDetail.amc_schedule_remark}"</p>}
                                    </div>
                                </div>
                            </div>

                            {/* General Submitter Remarks */}
                            {(() => {
                                const rawRemarks = selectedDetail.remarks || '';
                                const cleanRemarks = rawRemarks.split('\n\nQuestion Remarks:')[0].split('Question Remarks:')[0].trim();
                                if (!cleanRemarks) return null;
                                return (
                                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                                        <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase text-[10px] tracking-wider mb-1 flex items-center gap-1.5">
                                            <MessageSquare className="w-3.5 h-3.5 text-primary" />
                                            Remarks / Comments
                                        </h4>
                                        <p className="text-slate-600 dark:text-slate-400 italic whitespace-pre-wrap leading-relaxed mt-1">"{cleanRemarks}"</p>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Sticky Footer */}
                        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
                            <button
                                type="button"
                                onClick={() => setSelectedDetail(null)}
                                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
