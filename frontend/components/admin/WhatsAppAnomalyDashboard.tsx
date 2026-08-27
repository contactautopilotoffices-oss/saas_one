'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MessageSquare, CheckCircle2, XCircle, AlertTriangle, Clock,
    RefreshCw, Search, Send, ShieldAlert, Sparkles, Filter,
    Layers, ArrowUpRight, Zap, Loader2, Check, ExternalLink,
    AlertCircle, HelpCircle, Wrench, ChevronRight, Info
} from 'lucide-react';

interface WhatsAppAnomalyItem {
    id: string;
    type: 'DELIVERY_FAILURE' | 'STUCK_QUEUE' | 'PARAMETER_MISMATCH' | 'MALFORMED_PHONE' | 'RAPID_DUPLICATE';
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    description: string;
    phone: string;
    template_name?: string | null;
    event_type: string;
    created_at: string;
    status: string;
    error_message?: string | null;
    root_cause?: string;
    suggested_fix?: string;
}

interface TemplateHealthMetric {
    templateName: string;
    eventKey: string;
    total: number;
    sent: number;
    failed: number;
    pending: number;
    successRate: number;
    lastSentAt: string | null;
    status: 'healthy' | 'degraded' | 'failing' | 'idle';
    primaryError?: string | null;
    suggestedFix?: string | null;
    errorSamples?: string[];
}

interface WhatsAppMetrics {
    totalMessages: number;
    sentCount: number;
    failedCount: number;
    pendingCount: number;
    processingCount: number;
    deliveryRate: number;
    activeTemplatesCount: number;
    anomalyCount: number;
}

interface WhatsAppAnomalyDashboardProps {
    organizationId: string;
}

export default function WhatsAppAnomalyDashboard({ organizationId }: WhatsAppAnomalyDashboardProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [metrics, setMetrics] = useState<WhatsAppMetrics>({
        totalMessages: 0,
        sentCount: 0,
        failedCount: 0,
        pendingCount: 0,
        processingCount: 0,
        deliveryRate: 100,
        activeTemplatesCount: 0,
        anomalyCount: 0
    });
    const [templateHealth, setTemplateHealth] = useState<TemplateHealthMetric[]>([]);
    const [anomalies, setAnomalies] = useState<WhatsAppAnomalyItem[]>([]);
    const [queueRows, setQueueRows] = useState<any[]>([]);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [filterTemplate, setFilterTemplate] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3500);
    };

    const fetchAnalytics = async (showLoading = false) => {
        if (showLoading) setIsLoading(true);
        setIsRefreshing(true);
        try {
            const url = new URL('/api/admin/whatsapp/analytics', window.location.origin);
            if (organizationId) url.searchParams.set('organizationId', organizationId);
            if (filterStatus !== 'all') url.searchParams.set('status', filterStatus);
            if (filterTemplate !== 'all') url.searchParams.set('template', filterTemplate);

            const res = await fetch(url.toString());
            if (res.ok) {
                const data = await res.json();
                setMetrics(data.metrics || {});
                setTemplateHealth(data.templateHealth || []);
                setAnomalies(data.anomalies || []);
                setQueueRows(data.queueRows || []);
            }
        } catch (err) {
            console.error('Error fetching WhatsApp analytics:', err);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAnalytics(true);
    }, [organizationId, filterStatus, filterTemplate]);

    const handleRetry = async (queueId: string) => {
        setRetryingId(queueId);
        try {
            const res = await fetch('/api/admin/whatsapp/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ queueId })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                showToast('⚡ Message re-dispatched successfully via Meta WhatsApp gateway!');
                fetchAnalytics(false);
            } else {
                showToast(data.error || 'Retry failed to deliver.', 'error');
            }
        } catch (err: any) {
            console.error('Retry error:', err);
            showToast('Error retrying message', 'error');
        } finally {
            setRetryingId(null);
        }
    };

    const filteredRows = queueRows.filter(row => {
        const query = searchQuery.toLowerCase();
        return (
            (row.phone || '').toLowerCase().includes(query) ||
            (row.template_name || '').toLowerCase().includes(query) ||
            (row.event_type || '').toLowerCase().includes(query) ||
            (row.message || '').toLowerCase().includes(query) ||
            (row.error_message || '').toLowerCase().includes(query)
        );
    });

    const uniqueTemplates = Array.from(new Set(queueRows.map(r => r.template_name).filter(Boolean)));

    return (
        <div className="w-full space-y-7 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 p-6 md:p-8 bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-950 text-white rounded-3xl shadow-xl border border-emerald-800/40">
                <div className="flex items-start md:items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 shadow-inner shrink-0 mt-1 md:mt-0">
                        <MessageSquare className="w-7 h-7" />
                    </div>
                    <div>
                        <div className="flex flex-wrap items-center gap-2.5">
                            <h3 className="text-xl md:text-2xl font-black tracking-tight text-white">
                                WhatsApp (AiSensy) Health & Delivery Diagnostics
                            </h3>
                            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 text-xs font-black rounded-full border border-emerald-500/30 tracking-wider">
                                META CLOUD API LIVE 🟢
                            </span>
                        </div>
                        <p className="text-xs md:text-sm text-emerald-200/90 mt-1 max-w-3xl leading-relaxed">
                            Live telemetry of all outgoing WhatsApp notifications, automated root-cause detection for failed templates, parameter validation diagnostics, and 1-click retry dispatch.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => fetchAnalytics(false)}
                    disabled={isRefreshing}
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-2xl transition-all border border-white/15 cursor-pointer shadow-sm hover:shadow-md disabled:opacity-50 shrink-0"
                >
                    <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    <span>Refresh Telemetry</span>
                </button>
            </div>

            {/* Metrics Overview Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Total Queued</span>
                        <MessageSquare className="w-5 h-5 text-emerald-600" />
                    </div>
                    <p className="text-3xl font-black text-slate-900">{metrics.totalMessages}</p>
                    <span className="text-xs font-semibold text-slate-500">Recorded Meta Dispatches</span>
                </div>

                <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Delivery Rate</span>
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    </div>
                    <p className="text-3xl font-black text-emerald-700">{metrics.deliveryRate}%</p>
                    <span className="text-xs font-semibold text-emerald-600">{metrics.sentCount} Successfully Delivered</span>
                </div>

                <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Delivery Failures</span>
                        <XCircle className="w-5 h-5 text-rose-600" />
                    </div>
                    <p className="text-3xl font-black text-rose-600">{metrics.failedCount}</p>
                    <span className="text-xs font-semibold text-rose-500">Provider / Meta Rejections</span>
                </div>

                <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Queue Backlog</span>
                        <Clock className="w-5 h-5 text-amber-600" />
                    </div>
                    <p className="text-3xl font-black text-slate-900">{metrics.pendingCount + metrics.processingCount}</p>
                    <span className="text-xs font-semibold text-slate-500">Pending Instant Dispatch</span>
                </div>

                <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs col-span-2 lg:col-span-1 space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Flagged Issues</span>
                        <ShieldAlert className="w-5 h-5 text-amber-600" />
                    </div>
                    <p className={`text-3xl font-black ${anomalies.length > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                        {anomalies.length}
                    </p>
                    <span className="text-xs font-semibold text-slate-500">
                        {anomalies.length === 0 ? 'Zero Delivery Issues 🛡️' : 'Anomalies Need Review ⚠️'}
                    </span>
                </div>
            </div>

            {/* Delivery Anomaly Alerts Banner */}
            {anomalies.length > 0 && (
                <div className="p-6 bg-amber-50/90 border border-amber-200 rounded-3xl space-y-4 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                            <AlertTriangle className="w-6 h-6 text-amber-700 shrink-0" />
                            <div>
                                <h4 className="text-base font-black text-amber-950">Active Delivery Anomalies & Warnings ({anomalies.length})</h4>
                                <p className="text-xs text-amber-800">Review flagged delivery issues, root causes, and suggested fixes below.</p>
                            </div>
                        </div>
                        <span className="text-xs font-black text-amber-900 uppercase tracking-wide bg-amber-200/80 px-3 py-1 rounded-full w-fit">
                            Attention Needed
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                        {anomalies.map(anom => (
                            <div key={anom.id} className="p-4 bg-white rounded-2xl border border-amber-200/90 shadow-2xs space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="font-extrabold text-slate-900 text-xs md:text-sm">{anom.title}</span>
                                    <span className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-md shrink-0 ${
                                        anom.severity === 'HIGH' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                                    }`}>
                                        {anom.severity}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-600 leading-relaxed">{anom.description}</p>
                                
                                {anom.suggested_fix && (
                                    <div className="p-2.5 bg-blue-50/80 border border-blue-100 rounded-xl flex items-start gap-2 text-xs text-blue-900">
                                        <Wrench className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                                        <div>
                                            <span className="font-bold">Recommended Fix: </span>
                                            <span>{anom.suggested_fix}</span>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-100">
                                    <span className="font-mono font-bold text-slate-800">{anom.phone}</span>
                                    <span className="font-mono font-semibold text-emerald-700">{anom.template_name || anom.event_type}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Meta Template Health Matrix with Root Cause Diagnostics */}
            <div className="p-6 md:p-8 bg-white border border-slate-200/90 rounded-3xl shadow-xs space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h4 className="text-lg md:text-xl font-black text-slate-900 flex items-center gap-2.5">
                            <Sparkles className="w-5 h-5 text-emerald-600" />
                            Meta Approved Campaign Template Health Matrix
                        </h4>
                        <p className="text-xs md:text-sm text-slate-500 mt-0.5">
                            Real-time pass/fail rates, parameter counts, and exact root cause diagnostics for every active campaign template.
                        </p>
                    </div>
                    <span className="text-xs font-black text-emerald-800 bg-emerald-50 border border-emerald-200 px-4 py-1.5 rounded-xl w-fit">
                        {templateHealth.length} Configured Templates
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {templateHealth.map(tpl => {
                        const isHealthy = tpl.status === 'healthy';
                        const isDegraded = tpl.status === 'degraded';
                        const isFailing = tpl.status === 'failing';
                        const hasFailures = tpl.failed > 0;

                        return (
                            <div key={tpl.templateName} className={`p-5 rounded-2xl border transition-all space-y-3.5 shadow-2xs flex flex-col justify-between ${
                                hasFailures
                                    ? 'bg-rose-50/20 border-rose-200/80 hover:border-rose-300'
                                    : 'bg-slate-50/40 border-slate-200 hover:border-slate-300'
                            }`}>
                                <div className="space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="font-mono font-black text-slate-900 text-xs md:text-sm truncate max-w-[220px]" title={tpl.templateName}>
                                            {tpl.templateName}
                                        </span>
                                        <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg shrink-0 ${
                                            isHealthy
                                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                                : isDegraded
                                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                                : isFailing
                                                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                                : 'bg-slate-100 text-slate-600'
                                        }`}>
                                            {tpl.status} ({tpl.successRate}%)
                                        </span>
                                    </div>

                                    {/* Stat boxes */}
                                    <div className="grid grid-cols-3 gap-2 py-2 text-center bg-white p-3 rounded-xl border border-slate-200/70 shadow-3xs">
                                        <div>
                                            <span className="text-[10px] text-slate-400 font-extrabold uppercase block">TOTAL</span>
                                            <span className="text-sm font-black text-slate-900">{tpl.total}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] text-emerald-600 font-extrabold uppercase block">SENT</span>
                                            <span className="text-sm font-black text-emerald-700">{tpl.sent}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] text-rose-600 font-extrabold uppercase block">FAILED</span>
                                            <span className="text-sm font-black text-rose-600">{tpl.failed}</span>
                                        </div>
                                    </div>

                                    {/* Root cause diagnostics banner */}
                                    {hasFailures && (
                                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-xs">
                                            <div className="flex items-center gap-1.5 text-rose-900 font-bold">
                                                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                                <span>Exact Root Cause Diagnosis:</span>
                                            </div>
                                            <p className="text-[11px] text-rose-800 leading-snug">
                                                {tpl.primaryError || 'Disparity in Meta approved campaign name or parameter payload.'}
                                            </p>
                                            {tpl.suggestedFix && (
                                                <p className="text-[11px] text-slate-600 font-semibold pt-1 border-t border-rose-200/60 mt-1">
                                                    💡 <span className="font-bold text-slate-900">Fix:</span> {tpl.suggestedFix}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {tpl.lastSentAt && (
                                    <p className="text-[11px] text-slate-400 text-right pt-1 font-semibold">
                                        Last sent: {new Date(tpl.lastSentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Message Queue Logs & Search */}
            <div className="p-6 md:p-8 bg-white border border-slate-200/90 rounded-3xl shadow-xs space-y-5">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="relative flex-1 w-full">
                        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by recipient phone, template name, event key, or error description..."
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-hidden focus:ring-2 focus:ring-emerald-500"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 p-1.5 rounded-xl text-xs">
                            <span className="text-[10px] font-extrabold text-slate-400 px-2 uppercase">Status:</span>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 px-2.5 py-1 outline-hidden"
                            >
                                <option value="all">All</option>
                                <option value="sent">Sent / Delivered</option>
                                <option value="failed">Failed / Rejected</option>
                                <option value="pending">Pending</option>
                            </select>
                        </div>

                        {uniqueTemplates.length > 0 && (
                            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 p-1.5 rounded-xl text-xs">
                                <span className="text-[10px] font-extrabold text-slate-400 px-2 uppercase">Template:</span>
                                <select
                                    value={filterTemplate}
                                    onChange={(e) => setFilterTemplate(e.target.value)}
                                    className="bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 px-2.5 py-1 outline-hidden"
                                >
                                    <option value="all">All Templates</option>
                                    {uniqueTemplates.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Queue Log Table */}
                <div className="overflow-x-auto">
                    {isLoading ? (
                        <div className="py-16 text-center text-xs text-slate-400 font-medium">
                            Loading WhatsApp queue dispatches...
                        </div>
                    ) : filteredRows.length === 0 ? (
                        <div className="py-16 text-center text-xs text-slate-400 font-medium">
                            No WhatsApp messages found matching your search criteria.
                        </div>
                    ) : (
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 text-[10px] uppercase font-extrabold text-slate-400 bg-slate-50/80">
                                    <th className="py-3 px-4 rounded-l-xl">Queued Time</th>
                                    <th className="py-3 px-4">Recipient Mobile</th>
                                    <th className="py-3 px-4">Campaign Template</th>
                                    <th className="py-3 px-4">Delivery Status</th>
                                    <th className="py-3 px-4">Root Cause / Error Diagnostics</th>
                                    <th className="py-3 px-4 text-right rounded-r-xl">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredRows.map(row => {
                                    const s = (row.status || '').toLowerCase();
                                    const isSent = s === 'sent' || s === 'delivered' || s === 'read';
                                    const isFailed = s === 'failed';
                                    const isPending = s === 'pending' || s === 'processing';

                                    return (
                                        <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                                            <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                                                {new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                <span className="block text-[10px] text-slate-400">
                                                    {new Date(row.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                                                {row.phone}
                                            </td>
                                            <td className="py-3.5 px-4 whitespace-nowrap">
                                                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-[10px] font-mono font-extrabold">
                                                    {row.template_name || row.event_type}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 whitespace-nowrap">
                                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                                                    isSent
                                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                        : isFailed
                                                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                                                }`}>
                                                    {row.status}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 text-slate-600 max-w-sm" title={row.error_message || row.message}>
                                                {row.error_message ? (
                                                    <span className="text-rose-600 font-semibold">{row.error_message}</span>
                                                ) : (
                                                    <span className="truncate block">{row.message || 'Dispatched successfully'}</span>
                                                )}
                                            </td>
                                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                                {isFailed && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRetry(row.id)}
                                                        disabled={retryingId === row.id}
                                                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white text-[11px] font-bold rounded-xl transition-all shadow-xs cursor-pointer disabled:opacity-50"
                                                    >
                                                        {retryingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                                                        <span>Retry</span>
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Toast Feedback */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100]"
                    >
                        <div className={`px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border ${
                            toast.type === 'success' ? 'bg-slate-900 text-white border-slate-800' : 'bg-rose-900 text-white border-rose-800'
                        }`}>
                            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertTriangle className="w-5 h-5 text-rose-400" />}
                            <span className="font-bold text-xs">{toast.message}</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
