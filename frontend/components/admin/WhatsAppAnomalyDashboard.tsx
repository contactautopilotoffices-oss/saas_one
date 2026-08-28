'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MessageSquare, CheckCircle2, XCircle, AlertTriangle, Clock,
    RefreshCw, Search, Send, ShieldAlert, Sparkles, Filter,
    Layers, ArrowUpRight, Zap, Loader2, Check, ExternalLink,
    AlertCircle, HelpCircle, Wrench, ChevronRight, Info, Phone
} from 'lucide-react';

interface WhatsAppAnomalyItem {
    id: string;
    queue_id?: string;
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
    lastFailedAt?: string | null;
    status: 'healthy' | 'degraded' | 'failing' | 'idle';
    primaryError?: string | null;
    suggestedFix?: string | null;
    errorSamples?: string[];
}

const formatDateTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return { full: 'N/A', relative: '', date: '', time: '' };
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return { full: String(dateStr), relative: '', date: '', time: '' };
        const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
        
        const diffMs = Date.now() - d.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        let rel = '';
        if (diffMins < 1) rel = 'Just now';
        else if (diffMins < 60) rel = `${diffMins}m ago`;
        else if (diffMins < 1440) rel = `${Math.floor(diffMins / 60)}h ago`;
        else rel = `${Math.floor(diffMins / 1440)}d ago`;

        return { full: `${datePart}, ${timePart}`, relative: rel, date: datePart, time: timePart };
    } catch {
        return { full: String(dateStr), relative: '', date: '', time: '' };
    }
};

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
    const [expandedTemplates, setExpandedTemplates] = useState<Record<string, boolean>>({});
    const [anomalyTab, setAnomalyTab] = useState<'active' | 'resolved' | 'all'>('active');
    const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('acknowledged_whatsapp_anomalies');
                if (saved) {
                    setAcknowledgedIds(new Set(JSON.parse(saved)));
                }
            } catch (e) {
                console.error('Error reading acknowledged whatsapp anomalies:', e);
            }
        }
    }, []);

    const toggleTemplateExpand = (templateName: string) => {
        setExpandedTemplates(prev => ({
            ...prev,
            [templateName]: !prev[templateName]
        }));
    };

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3500);
    };

    const handleAcknowledge = (id: string) => {
        setAcknowledgedIds(prev => {
            const next = new Set(prev);
            next.add(id);
            if (typeof window !== 'undefined') {
                localStorage.setItem('acknowledged_whatsapp_anomalies', JSON.stringify(Array.from(next)));
            }
            return next;
        });
        showToast('✓ WhatsApp anomaly acknowledged and classified as resolved.');
    };

    const handleReopen = (id: string) => {
        setAcknowledgedIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            if (typeof window !== 'undefined') {
                localStorage.setItem('acknowledged_whatsapp_anomalies', JSON.stringify(Array.from(next)));
            }
            return next;
        });
        showToast('Anomaly reopened to active review list.');
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

    const [templateSearch, setTemplateSearch] = useState<string>('');
    const [templateCategoryFilter, setTemplateCategoryFilter] = useState<string>('all');

    const filteredTemplateHealth = templateHealth.filter(tpl => {
        const query = templateSearch.toLowerCase().trim();
        const matchesQuery = !query || tpl.templateName.toLowerCase().includes(query) || (tpl.eventKey || '').toLowerCase().includes(query);
        if (!matchesQuery) return false;

        if (templateCategoryFilter === 'all') return true;
        if (templateCategoryFilter === 'active') return tpl.total > 0;
        if (templateCategoryFilter === 'tickets') return tpl.templateName.includes('ticket');
        if (templateCategoryFilter === 'checklists') return tpl.templateName.includes('checklist');
        if (templateCategoryFilter === 'procurement') return tpl.templateName.includes('material') || tpl.templateName.includes('comparative') || tpl.templateName.includes('procurement');
        if (templateCategoryFilter === 'requisitions') return tpl.templateName.includes('requisition');
        if (templateCategoryFilter === 'crm') return tpl.templateName.includes('crm') || tpl.templateName.includes('lead');
        if (templateCategoryFilter === 'revenue') return tpl.templateName.includes('vendor_revenue') || tpl.templateName.includes('revenue');
        if (templateCategoryFilter === 'rooms') return tpl.templateName.includes('meeting_room') || tpl.templateName.includes('room');
        return true;
    });

    const activeAnomalies = anomalies.filter(a => !acknowledgedIds.has(a.id));
    const resolvedAnomalies = anomalies.filter(a => acknowledgedIds.has(a.id));
    const displayedAnomalies = anomalyTab === 'active' 
        ? activeAnomalies 
        : anomalyTab === 'resolved' 
        ? resolvedAnomalies 
        : anomalies;

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
        <div className="w-full space-y-6 animate-in fade-in duration-300">
            {/* Header Banner - Full Width */}
            <div className="w-full flex flex-col lg:flex-row lg:items-center justify-between gap-5 p-6 md:p-8 bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-950 text-white rounded-3xl shadow-xl border border-emerald-800/40">
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
                        <p className="text-xs md:text-sm text-emerald-200/90 mt-1.5 max-w-4xl leading-relaxed">
                            Live telemetry of all outgoing WhatsApp notifications, automated root-cause detection for failed templates, parameter validation diagnostics, and 1-click retry dispatch.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => fetchAnalytics(false)}
                    disabled={isRefreshing}
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-2xl transition-all border border-white/15 cursor-pointer shadow-sm hover:shadow-md disabled:opacity-50 shrink-0 self-start lg:self-center"
                >
                    <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    <span>Refresh Telemetry</span>
                </button>
            </div>

            {/* Metrics Overview Cards - Full Width Responsive Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="p-5 bg-white rounded-2xl md:rounded-3xl border border-slate-200/80 shadow-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Total Queued</span>
                        <MessageSquare className="w-5 h-5 text-emerald-600" />
                    </div>
                    <p className="text-3xl font-black text-slate-900">{metrics.totalMessages}</p>
                    <span className="text-xs font-semibold text-slate-500">Total Outgoing Dispatches</span>
                </div>

                <div className="p-5 bg-white rounded-2xl md:rounded-3xl border border-slate-200/80 shadow-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Delivery Rate</span>
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    </div>
                    <p className="text-3xl font-black text-emerald-700">{metrics.deliveryRate}%</p>
                    <span className="text-xs font-semibold text-emerald-600">{metrics.sentCount} Successfully Delivered</span>
                </div>

                <div className="p-5 bg-white rounded-2xl md:rounded-3xl border border-slate-200/80 shadow-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Delivery Failures</span>
                        <XCircle className="w-5 h-5 text-rose-600" />
                    </div>
                    <p className="text-3xl font-black text-rose-600">{metrics.failedCount}</p>
                    <span className="text-xs font-semibold text-rose-500">Provider / Meta Rejections</span>
                </div>

                <div className="p-5 bg-white rounded-2xl md:rounded-3xl border border-slate-200/80 shadow-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Queue Backlog</span>
                        <Clock className="w-5 h-5 text-amber-600" />
                    </div>
                    <p className="text-3xl font-black text-slate-900">{metrics.pendingCount + metrics.processingCount}</p>
                    <span className="text-xs font-semibold text-slate-500">Pending Instant Dispatch</span>
                </div>

                <div className="p-5 bg-white rounded-2xl md:rounded-3xl border border-slate-200/80 shadow-xs col-span-2 md:col-span-1 space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider">Active Anomalies</span>
                        <ShieldAlert className="w-5 h-5 text-amber-600" />
                    </div>
                    <p className={`text-3xl font-black ${activeAnomalies.length > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                        {activeAnomalies.length}
                    </p>
                    <span className="text-xs font-semibold text-slate-500">
                        {activeAnomalies.length === 0 ? 'Zero Active Issues 🛡️' : `${activeAnomalies.length} Anomalies Need Review ⚠️`}
                    </span>
                </div>
            </div>

            {/* Delivery Anomaly Alerts Banner - Spacious Full Width */}
            {anomalies.length > 0 && (
                <div className="w-full p-6 md:p-7 bg-amber-50/90 border border-amber-200 rounded-3xl space-y-4 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <AlertTriangle className="w-6 h-6 text-amber-700 shrink-0" />
                            <div>
                                <h4 className="text-base md:text-lg font-black text-amber-950">Active Delivery Anomalies & Warnings ({displayedAnomalies.length})</h4>
                                <p className="text-xs text-amber-800">Review flagged delivery issues, exact failure timestamps, root causes, and suggested fixes below.</p>
                            </div>
                        </div>

                        {/* Status Classification Filter Tabs */}
                        <div className="flex items-center gap-1 bg-white/90 p-1.5 rounded-2xl border border-amber-200 shadow-sm w-fit">
                            <button
                                type="button"
                                onClick={() => setAnomalyTab('active')}
                                className={`px-4 py-2 min-h-[36px] rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                                    anomalyTab === 'active'
                                        ? 'bg-amber-600 text-white shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                                }`}
                            >
                                <span>⚠️ Active ({activeAnomalies.length})</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setAnomalyTab('resolved')}
                                className={`px-4 py-2 min-h-[36px] rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                                    anomalyTab === 'resolved'
                                        ? 'bg-emerald-600 text-white shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                                }`}
                            >
                                <span>✓ Resolved ({resolvedAnomalies.length})</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setAnomalyTab('all')}
                                className={`px-4 py-2 min-h-[36px] rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                                    anomalyTab === 'all'
                                        ? 'bg-slate-900 text-white shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                                }`}
                            >
                                <span>All ({anomalies.length})</span>
                            </button>
                        </div>
                    </div>

                    {displayedAnomalies.length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-500 bg-white/70 rounded-2xl border border-amber-100 font-medium">
                            {anomalyTab === 'active' 
                                ? '🎉 All WhatsApp anomalies have been acknowledged and resolved!' 
                                : 'No resolved anomalies in record.'}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pt-1">
                            {displayedAnomalies.map(anom => {
                                const isResolved = acknowledgedIds.has(anom.id);
                                const timeInfo = formatDateTime(anom.created_at);
                                const qId = anom.queue_id || anom.id.replace('fail_', '').replace('stuck_', '');
                                const isRetrying = retryingId === qId;

                                return (
                                    <div key={anom.id} className={`p-4 md:p-5 bg-white rounded-2xl border transition-all space-y-4 flex flex-col justify-between shadow-2xs min-h-[220px] ${
                                        isResolved ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200/90'
                                    }`}>
                                        <div className="space-y-3 flex-1 flex flex-col justify-start">
                                            <div className="flex items-start justify-between gap-2">
                                                <span className="font-extrabold text-slate-900 text-xs md:text-sm break-words leading-tight flex-1">
                                                    {anom.title}
                                                </span>
                                                <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-md shrink-0 whitespace-nowrap ${
                                                    isResolved
                                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                                        : anom.severity === 'HIGH' 
                                                        ? 'bg-rose-100 text-rose-800 border border-rose-200' 
                                                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                                                }`}>
                                                    {isResolved ? 'RESOLVED' : anom.severity}
                                                </span>
                                            </div>

                                            {/* Timestamp Badge - Single Line Legible */}
                                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-lg w-fit whitespace-nowrap">
                                                <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                                <span className="font-bold text-slate-700">Failed at:</span>
                                                <span className="font-semibold text-slate-900">{timeInfo.full}</span>
                                                {timeInfo.relative && (
                                                    <span className="text-slate-400">({timeInfo.relative})</span>
                                                )}
                                            </div>

                                            <p className="text-xs text-slate-600 leading-relaxed break-words">{anom.description}</p>
                                            
                                            {anom.suggested_fix && (
                                                <div className="p-3.5 bg-blue-50/90 border border-blue-200/80 rounded-xl flex items-start gap-2.5 text-xs text-blue-950 mt-1">
                                                    <Wrench className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                                                    <div className="flex-1 min-w-0 pr-1">
                                                        <span className="font-bold text-blue-950">Recommended Fix: </span>
                                                        <span className="text-blue-900 leading-relaxed break-words">{anom.suggested_fix}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Card Actions Footer - 2 Clean Stacked Rows (No Overlap) */}
                                        <div className="pt-3 border-t border-slate-100 space-y-2.5 mt-auto">
                                            {/* Row 1: Recipient Phone + Template Pill (100% Width) */}
                                            <div className="flex items-center justify-between gap-2 text-xs">
                                                <div className="flex items-center gap-1.5 font-mono text-slate-900 font-bold text-xs tracking-tight">
                                                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                    <span className="whitespace-nowrap">{anom.phone}</span>
                                                </div>
                                                <span className="font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-[10px] truncate max-w-[150px]" title={anom.template_name || anom.event_type}>
                                                    {anom.template_name || anom.event_type}
                                                </span>
                                            </div>

                                            {/* Row 2: Full Width Symmetrical Action Buttons */}
                                            <div className="flex items-center gap-2 w-full">
                                                {isResolved ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleReopen(anom.id)}
                                                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-3xs"
                                                    >
                                                        <RefreshCw className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                                        <span>Reopen</span>
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAcknowledge(anom.id)}
                                                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3.5 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold tracking-wide transition-all cursor-pointer shadow-3xs"
                                                    >
                                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                                        <span>Acknowledge</span>
                                                    </button>
                                                )}

                                                {qId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRetry(qId)}
                                                        disabled={isRetrying}
                                                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black tracking-wide transition-all disabled:opacity-50 cursor-pointer shadow-xs hover:shadow-sm"
                                                    >
                                                        {isRetrying ? (
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-white shrink-0" />
                                                        ) : (
                                                            <Zap className="w-3.5 h-3.5 text-white shrink-0" />
                                                        )}
                                                        <span>Retry</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Meta Template Health Matrix with Wide Responsive Cards */}
            <div className="w-full p-6 md:p-8 bg-white border border-slate-200/90 rounded-3xl shadow-xs space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h4 className="text-lg md:text-xl font-black text-slate-900 flex items-center gap-2.5">
                            <Sparkles className="w-5 h-5 text-emerald-600" />
                            Meta Approved Campaign Template Health Matrix
                        </h4>
                        <p className="text-xs md:text-sm text-slate-500 mt-0.5">
                            Real-time pass/fail rates, parameter counts, and exact root cause diagnostics with timestamps for every active & approved campaign template.
                        </p>
                    </div>
                    <span className="text-xs font-black text-emerald-800 bg-emerald-50 border border-emerald-200 px-4 py-1.5 rounded-xl w-fit">
                        {filteredTemplateHealth.length} / {templateHealth.length} Approved Templates
                    </span>
                </div>

                {/* Filter & Search Bar for Templates */}
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar text-xs font-bold">
                        {[
                            { id: 'all', label: 'All Templates' },
                            { id: 'active', label: 'Active Dispatches' },
                            { id: 'tickets', label: 'Tickets' },
                            { id: 'checklists', label: 'Checklists' },
                            { id: 'procurement', label: 'Procurement' },
                            { id: 'requisitions', label: 'Requisitions' },
                            { id: 'rooms', label: 'Meeting Rooms' },
                            { id: 'crm', label: 'CRM Leads' },
                            { id: 'revenue', label: 'Cafeteria' },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setTemplateCategoryFilter(tab.id)}
                                className={`px-3.5 py-1.5 rounded-xl whitespace-nowrap transition-all cursor-pointer ${
                                    templateCategoryFilter === tab.id
                                        ? 'bg-emerald-600 text-white shadow-2xs font-black'
                                        : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200/80'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="relative min-w-[220px]">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={templateSearch}
                            onChange={(e) => setTemplateSearch(e.target.value)}
                            placeholder="Filter template name or key..."
                            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                    </div>
                </div>

                {/* Wide Grid filling all screen space with uniform gap-4 (16px) */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredTemplateHealth.map(tpl => {
                        const isHealthy = tpl.status === 'healthy';
                        const isDegraded = tpl.status === 'degraded';
                        const isFailing = tpl.status === 'failing';
                        const isIdle = tpl.status === 'idle';
                        const hasFailures = tpl.failed > 0;
                        const isExpanded = !!expandedTemplates[tpl.templateName];

                        return (
                            <div key={tpl.templateName} className={`p-4 md:p-4.5 rounded-2xl border transition-all space-y-3 shadow-2xs flex flex-col justify-between ${
                                hasFailures
                                    ? 'bg-rose-50/20 border-rose-200/80 hover:border-rose-300'
                                    : isIdle
                                    ? 'bg-slate-50/20 border-slate-200/70 hover:border-slate-300'
                                    : 'bg-emerald-50/20 border-emerald-200/60 hover:border-emerald-300'
                            }`}>
                                <div className="space-y-2.5">
                                    {/* Card Header with Dynamic Flex Title Wrapping */}
                                    <div className="flex items-start justify-between gap-2.5 min-w-0">
                                        <span className="font-mono font-bold text-xs md:text-sm text-slate-900 flex-1 min-w-0 break-words leading-snug" title={tpl.templateName}>
                                            {tpl.templateName}
                                        </span>
                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md shrink-0 whitespace-nowrap ${
                                            isHealthy
                                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                                : isDegraded
                                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                                : isFailing
                                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                                        }`}>
                                            {isIdle ? 'STANDBY 🟢' : `${tpl.status.toUpperCase()} (${tpl.successRate}%)`}
                                        </span>
                                    </div>

                                    {/* Metrics Stat Box */}
                                    <div className="flex items-center justify-between gap-1.5 py-1.5 px-2.5 bg-white rounded-xl border border-slate-200/80 shadow-3xs">
                                        <div className="text-center flex-1">
                                            <span className="text-[9px] text-slate-400 font-extrabold uppercase block">TOTAL</span>
                                            <span className="text-xs md:text-sm font-black text-slate-900">{tpl.total}</span>
                                        </div>
                                        <div className="w-px h-5 bg-slate-100" />
                                        <div className="text-center flex-1">
                                            <span className="text-[9px] text-emerald-600 font-extrabold uppercase block">SENT</span>
                                            <span className="text-xs md:text-sm font-black text-emerald-700">{tpl.sent}</span>
                                        </div>
                                        <div className="w-px h-5 bg-slate-100" />
                                        <div className="text-center flex-1">
                                            <span className="text-[9px] text-rose-600 font-extrabold uppercase block">FAILED</span>
                                            <span className="text-xs md:text-sm font-black text-rose-600">{tpl.failed}</span>
                                        </div>
                                    </div>

                                    {/* Alert Box: default compact with Show More toggle */}
                                    {hasFailures && (
                                        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-xs">
                                            <div className="flex items-center justify-between gap-1">
                                                <div className="flex items-center gap-1 text-rose-900 font-bold text-[10px]">
                                                    <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                                                    <span>Diagnosis</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleTemplateExpand(tpl.templateName)}
                                                    className="text-[10px] font-bold text-rose-700 hover:text-rose-950 underline cursor-pointer"
                                                >
                                                    {isExpanded ? 'Show Less' : 'Details'}
                                                </button>
                                            </div>
                                            <p className={`text-[10px] md:text-[11px] text-rose-800 font-medium leading-tight ${isExpanded ? '' : 'line-clamp-2'}`}>
                                                {tpl.primaryError || 'Disparity in Meta approved campaign name or parameter payload.'}
                                            </p>
                                            {isExpanded && tpl.suggestedFix && (
                                                <div className="pt-1.5 border-t border-rose-200/80 text-[10px] md:text-[11px] text-slate-700 flex items-start gap-1">
                                                    <span className="font-bold text-slate-900 shrink-0">💡 Fix:</span>
                                                    <span className="text-slate-800 leading-tight">{tpl.suggestedFix}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Timestamps: Last Failed & Last Sent */}
                                <div className="pt-2 border-t border-slate-100/80 space-y-1 text-[10px]">
                                    {tpl.failed > 0 && tpl.lastFailedAt && (
                                        <div className="flex items-center justify-between text-rose-600 font-semibold">
                                            <span className="flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3 shrink-0" /> Last Failed:
                                            </span>
                                            <span className="font-mono text-rose-700">{formatDateTime(tpl.lastFailedAt).full}</span>
                                        </div>
                                    )}
                                    {tpl.sent > 0 && tpl.lastSentAt && (
                                        <div className="flex items-center justify-between text-slate-500 font-medium">
                                            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                                                <CheckCircle2 className="w-3 h-3 shrink-0" /> Last Sent:
                                            </span>
                                            <span className="font-mono text-slate-600">{formatDateTime(tpl.lastSentAt).full}</span>
                                        </div>
                                    )}
                                    {!tpl.lastFailedAt && !tpl.lastSentAt && (
                                        <p className="text-slate-400 text-right italic">No recent activity</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Message Queue Logs & Search - Full Width */}
            <div className="w-full p-6 md:p-8 bg-white border border-slate-200/90 rounded-3xl shadow-xs space-y-5">
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
                                                <span className="font-bold text-slate-800">
                                                    {formatDateTime(row.created_at).time}
                                                </span>
                                                <span className="block text-[10px] text-slate-400 font-sans">
                                                    {formatDateTime(row.created_at).date}
                                                    {formatDateTime(row.created_at).relative && (
                                                        <span className="ml-1 font-medium text-slate-400">({formatDateTime(row.created_at).relative})</span>
                                                    )}
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
                                            <td className="py-3.5 px-4 text-slate-600 max-w-md" title={row.error_message || row.message}>
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
