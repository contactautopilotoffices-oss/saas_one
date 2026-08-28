'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    PhoneCall, Phone, AlertTriangle, CheckCircle2, XCircle, Clock,
    Search, RefreshCw, Volume2, Play, Sparkles, Filter, ShieldAlert,
    ChevronDown, Info, ArrowUpRight, BarChart2, ShieldCheck, Zap, Download, Loader2
} from 'lucide-react';

interface VoiceAnomalyItem {
    id: string;
    type: 'RAPID_DUPLICATE' | 'PROVIDER_FAILURE' | 'DROPPED_CALL' | 'MALFORMED_PHONE';
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    description: string;
    recipient_phone: string;
    event_type: string;
    created_at: string;
    call_status: string;
    duration_seconds?: number;
}

interface VoiceMetrics {
    totalCalls: number;
    completedCount: number;
    failedCount: number;
    inProgressCount: number;
    throttledCount: number;
    successRate: number;
    avgDurationSeconds: number;
    anomalyCount: number;
}

interface VoiceAnomalyDashboardProps {
    organizationId: string;
    onTestCallClick?: () => void;
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

export default function VoiceAnomalyDashboard({ organizationId, onTestCallClick }: VoiceAnomalyDashboardProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [metrics, setMetrics] = useState<VoiceMetrics>({
        totalCalls: 0,
        completedCount: 0,
        failedCount: 0,
        inProgressCount: 0,
        throttledCount: 0,
        successRate: 100,
        avgDurationSeconds: 0,
        anomalyCount: 0
    });
    const [anomalies, setAnomalies] = useState<VoiceAnomalyItem[]>([]);
    const [logs, setLogs] = useState<any[]>([]);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [filterEvent, setFilterEvent] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [playingLogId, setPlayingLogId] = useState<string | null>(null);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [anomalyTab, setAnomalyTab] = useState<'active' | 'resolved' | 'all'>('active');
    const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('acknowledged_voice_anomalies');
                if (saved) {
                    setAcknowledgedIds(new Set(JSON.parse(saved)));
                }
            } catch (e) {
                console.error('Error reading acknowledged voice anomalies:', e);
            }
        }
    }, []);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleAcknowledge = (id: string) => {
        setAcknowledgedIds(prev => {
            const next = new Set(prev);
            next.add(id);
            if (typeof window !== 'undefined') {
                localStorage.setItem('acknowledged_voice_anomalies', JSON.stringify(Array.from(next)));
            }
            return next;
        });
        showToast('✓ Telephony anomaly acknowledged and classified as resolved.');
    };

    const handleReopen = (id: string) => {
        setAcknowledgedIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            if (typeof window !== 'undefined') {
                localStorage.setItem('acknowledged_voice_anomalies', JSON.stringify(Array.from(next)));
            }
            return next;
        });
        showToast('Anomaly reopened to active review list.');
    };

    const fetchVoiceData = async (showLoading = false) => {
        if (showLoading) setIsLoading(true);
        setIsRefreshing(true);
        try {
            const url = new URL('/api/voice/analytics', window.location.origin);
            if (organizationId) url.searchParams.set('organizationId', organizationId);
            if (filterStatus !== 'all') url.searchParams.set('status', filterStatus);
            if (filterEvent !== 'all') url.searchParams.set('eventType', filterEvent);

            const res = await fetch(url.toString());
            if (res.ok) {
                const data = await res.json();
                setMetrics(data.metrics || {});
                setAnomalies(data.anomalies || []);
                setLogs(data.logs || []);
            }
        } catch (err) {
            console.error('Error loading voice analytics:', err);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchVoiceData(true);
    }, [organizationId, filterStatus, filterEvent]);

    const playVoiceSample = (text: string, logId: string) => {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        setPlayingLogId(logId);

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.1;

        const voices = window.speechSynthesis.getVoices();
        const indVoice = voices.find(v => (v.lang === 'en-IN' || v.name.toLowerCase().includes('india') || v.name.toLowerCase().includes('aditi')));
        if (indVoice) utterance.voice = indVoice;

        utterance.onend = () => setPlayingLogId(null);
        utterance.onerror = () => setPlayingLogId(null);
        window.speechSynthesis.speak(utterance);
    };

    const handleDownloadAudio = async (scriptText: string, logId: string, eventType?: string) => {
        if (!scriptText || downloadingId) return;
        setDownloadingId(logId);
        showToast('Generating MP3 audio file... ⏳');
        try {
            const filename = `voice_${(eventType || 'alert').toLowerCase()}_${logId.slice(0, 8)}.mp3`;
            const downloadUrl = `/api/voice/download-audio?text=${encodeURIComponent(scriptText)}&filename=${encodeURIComponent(filename)}`;
            
            const res = await fetch(downloadUrl);
            if (!res.ok) {
                throw new Error(`Server returned status ${res.status}`);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);
            showToast('✓ Audio downloaded successfully 📥');
        } catch (err: any) {
            console.error('Audio download error:', err);
            showToast('❌ Error downloading audio. Please try again.', 'error');
        } finally {
            setDownloadingId(null);
        }
    };

    const filteredLogs = logs.filter(log => {
        const query = searchQuery.toLowerCase();
        return (
            (log.recipient_phone || '').toLowerCase().includes(query) ||
            (log.spoken_script || '').toLowerCase().includes(query) ||
            (log.event_type || '').toLowerCase().includes(query) ||
            (log.bolna_call_id || '').toLowerCase().includes(query)
        );
    });

    const activeAnomalies = anomalies.filter(a => !acknowledgedIds.has(a.id));
    const resolvedAnomalies = anomalies.filter(a => acknowledgedIds.has(a.id));
    const displayedAnomalies = anomalyTab === 'active' 
        ? activeAnomalies 
        : anomalyTab === 'resolved' 
        ? resolvedAnomalies 
        : anomalies;

    const uniqueEvents = Array.from(new Set(logs.map(l => l.event_type).filter(Boolean)));

    return (
        <div className="space-y-6 animate-in fade-in duration-300 relative">
            {/* Toast Notification */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-2xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-in slide-in-from-bottom duration-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{toast.message}</span>
                </div>
            )}

            {/* Header & Quick Action */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-gradient-to-r from-slate-900 via-purple-950 to-indigo-950 text-white rounded-3xl shadow-xl border border-purple-800/40">
                <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300 shadow-inner shrink-0">
                        <PhoneCall className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-base md:text-lg font-bold text-white">Voice Telephony & Anomaly Monitor</h3>
                            <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold rounded-full border border-emerald-500/30 tracking-wider">
                                TELEPHONY LIVE 🟢
                            </span>
                        </div>
                        <p className="text-xs text-purple-200 mt-0.5">
                            Real-time AI voice dispatches, Plivo provider connectivity, rapid dialing detection, and unreached alerts.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => fetchVoiceData(false)}
                        disabled={isRefreshing}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl transition-all border border-white/10 cursor-pointer disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                        <span>Refresh Telemetry</span>
                    </button>
                    {onTestCallClick && (
                        <button
                            type="button"
                            onClick={onTestCallClick}
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer"
                        >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Test Live Call</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Metrics Row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider">Total Calls</span>
                        <Phone className="w-4 h-4 text-purple-600" />
                    </div>
                    <p className="text-2xl font-black text-slate-900">{metrics.totalCalls}</p>
                    <span className="text-[10px] font-bold text-slate-500 mt-1 block">Recorded Telephony Logs</span>
                </div>

                <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider">Delivery Rate</span>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    </div>
                    <p className="text-2xl font-black text-emerald-700">{metrics.successRate}%</p>
                    <span className="text-[10px] font-bold text-emerald-600 mt-1 block">{metrics.completedCount} Completed / Active</span>
                </div>

                <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider">Unreached / Failed</span>
                        <XCircle className="w-4 h-4 text-rose-600" />
                    </div>
                    <p className="text-2xl font-black text-rose-600">{metrics.failedCount}</p>
                    <span className="text-[10px] font-bold text-rose-500 mt-1 block">Carrier / Provider drops</span>
                </div>

                <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider">Avg Duration</span>
                        <Clock className="w-4 h-4 text-blue-600" />
                    </div>
                    <p className="text-2xl font-black text-slate-900">{metrics.avgDurationSeconds}s</p>
                    <span className="text-[10px] font-bold text-slate-500 mt-1 block">Per connected dispatch</span>
                </div>

                <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs col-span-2 md:col-span-1">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider">Active Anomalies</span>
                        <ShieldAlert className="w-4 h-4 text-amber-600" />
                    </div>
                    <p className={`text-2xl font-black ${activeAnomalies.length > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                        {activeAnomalies.length}
                    </p>
                    <span className="text-[10px] font-bold text-slate-500 mt-1 block">
                        {activeAnomalies.length === 0 ? 'All Systems Healthy 🛡️' : `${activeAnomalies.length} Issues Need Review ⚠️`}
                    </span>
                </div>
            </div>

            {/* Anomaly & Delivery Issues Center with Classification Tabs */}
            {anomalies.length > 0 && (
                <div className="p-5 md:p-6 bg-amber-50/80 border border-amber-200 rounded-3xl space-y-4 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
                            <div>
                                <h4 className="text-sm md:text-base font-bold text-amber-950">Detected Telephony Anomalies ({displayedAnomalies.length})</h4>
                                <p className="text-xs text-amber-800">Track and acknowledge automated throttling alerts, dropped calls, and duplicate dials.</p>
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
                                ? '🎉 All telephony anomalies have been acknowledged and resolved!' 
                                : 'No resolved anomalies in record.'}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pt-1">
                            {displayedAnomalies.map(anom => {
                                const isResolved = acknowledgedIds.has(anom.id);
                                const timeInfo = formatDateTime(anom.created_at);

                                return (
                                    <div key={anom.id} className={`p-4 md:p-5 bg-white rounded-2xl border transition-all space-y-4 text-xs flex flex-col justify-between shadow-2xs min-h-[200px] ${
                                        isResolved 
                                            ? 'border-emerald-200 bg-emerald-50/30' 
                                            : 'border-amber-200'
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
                                                    {isResolved ? 'RESOLVED' : `${anom.severity} PRIORITY`}
                                                </span>
                                            </div>

                                            {/* Formatted Date & Time Badge - Single Line */}
                                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-medium bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-lg w-fit whitespace-nowrap">
                                                <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                                <span className="font-bold text-slate-700">Detected:</span>
                                                <span className="font-semibold text-slate-900">{timeInfo.full}</span>
                                                {timeInfo.relative && (
                                                    <span className="text-slate-400">({timeInfo.relative})</span>
                                                )}
                                            </div>

                                            <p className="text-slate-600 leading-relaxed text-xs break-words">{anom.description}</p>
                                        </div>

                                        {/* Card Actions Footer - 2 Clean Stacked Rows (No Overlap) */}
                                        <div className="pt-3 border-t border-slate-100 space-y-2.5 mt-auto">
                                            {/* Row 1: Recipient Phone + Event Pill (100% Width) */}
                                            <div className="flex items-center justify-between gap-2 text-xs">
                                                <div className="flex items-center gap-1.5 font-mono text-slate-900 font-bold text-xs tracking-tight">
                                                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                    <span className="whitespace-nowrap">{anom.recipient_phone}</span>
                                                </div>
                                                <span className="font-mono font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md text-[10px] truncate max-w-[150px]" title={anom.event_type}>
                                                    {anom.event_type}
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
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Filter Bar & Search */}
            <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-3">
                <div className="flex flex-col md:flex-row items-center justify-between gap-3">
                    <div className="relative flex-1 w-full">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by recipient phone, script text, or Call UUID..."
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-hidden focus:ring-2 focus:ring-purple-400"
                        />
                    </div>

                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 p-1 rounded-xl text-xs">
                            <span className="text-[10px] font-bold text-slate-400 px-2 uppercase">Status:</span>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="bg-transparent font-bold text-slate-700 outline-hidden cursor-pointer"
                            >
                                <option value="all">All Statuses</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="FAILED">Failed</option>
                                <option value="IN_PROGRESS">In Progress</option>
                                <option value="THROTTLED">Throttled</option>
                            </select>
                        </div>

                        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 p-1 rounded-xl text-xs">
                            <span className="text-[10px] font-bold text-slate-400 px-2 uppercase">Event:</span>
                            <select
                                value={filterEvent}
                                onChange={(e) => setFilterEvent(e.target.value)}
                                className="bg-transparent font-bold text-slate-700 outline-hidden cursor-pointer"
                            >
                                <option value="all">All Events</option>
                                <option value="CHECKLIST_STARTED">Checklist Started</option>
                                <option value="CHECKLIST_SLOT_REMINDER">Checklist Reminder</option>
                                <option value="CHECKLIST_OVERDUE">Checklist Overdue</option>
                                <option value="PPM_REMINDER">PPM Reminder</option>
                                <option value="VENDOR_REVENUE_REMINDER">Revenue Reminder</option>
                                <option value="TEST_CALL">Test Call</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Call Records Table */}
                <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
                    <div className="p-4 md:p-5 border-b border-slate-100 flex items-center justify-between">
                        <div>
                            <h4 className="text-sm md:text-base font-extrabold text-slate-900">Recent Dispatches & Audio Recordings</h4>
                            <p className="text-xs text-slate-500">Live feed of outbound calls with duration metrics, script audit, and audio downloads.</p>
                        </div>
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-lg">
                            {filteredLogs.length} Records
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        {isLoading ? (
                            <div className="py-12 text-center text-xs text-slate-400 font-medium">
                                Loading AI voice dispatches...
                            </div>
                        ) : filteredLogs.length === 0 ? (
                            <div className="py-12 text-center text-xs text-slate-400 font-medium">
                                No voice call dispatches found matching your search.
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] uppercase font-black tracking-wider text-slate-600">
                                        <th className="py-3 px-4">Dispatch Time</th>
                                        <th className="py-3 px-3">Recipient Mobile</th>
                                        <th className="py-3 px-3">Event Key</th>
                                        <th className="py-3 px-3">Delivery Status</th>
                                        <th className="py-3 px-3">Duration</th>
                                        <th className="py-3 px-3">Spoken Script Prompt</th>
                                        <th className="py-3 px-3 text-right">Audio Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredLogs.map(log => {
                                        const timeInfo = formatDateTime(log.created_at);
                                        const isSuccess = log.call_status === 'COMPLETED';
                                        const isThrottled = log.call_status === 'THROTTLED';

                                        return (
                                            <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                                                <td className="py-3 px-4 whitespace-nowrap">
                                                    <div className="font-bold text-slate-900">{timeInfo.time}</div>
                                                    <div className="text-[10px] text-slate-600">{timeInfo.date}</div>
                                                </td>
                                                <td className="py-3 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                                                    {log.recipient_phone}
                                                </td>
                                                <td className="py-3 px-3 whitespace-nowrap">
                                                    <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-mono font-bold">
                                                        {log.event_type}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-3 whitespace-nowrap">
                                                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                                                        isSuccess
                                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : isThrottled
                                                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                                                    }`}>
                                                        {log.call_status}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-3 font-bold text-slate-700 whitespace-nowrap">
                                                    {log.duration_seconds ? `${log.duration_seconds}s` : '—'}
                                                </td>
                                                <td className="py-3 px-3 text-slate-600 max-w-xs truncate" title={log.spoken_script}>
                                                    {log.spoken_script || '—'}
                                                </td>
                                                <td className="py-3 px-3 text-right whitespace-nowrap">
                                                    {log.spoken_script && (
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={() => playVoiceSample(log.spoken_script, log.id)}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                                                                title="Listen to speech sample"
                                                            >
                                                                <Volume2 className={`w-3.5 h-3.5 ${playingLogId === log.id ? 'animate-bounce text-purple-800' : ''}`} />
                                                                <span>{playingLogId === log.id ? 'Playing...' : 'Audio'}</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDownloadAudio(log.spoken_script, log.id, log.event_type)}
                                                                disabled={downloadingId === log.id}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                                                                title="Download audio recording / speech file"
                                                            >
                                                                {downloadingId === log.id ? (
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
                                                                ) : (
                                                                    <Download className="w-3.5 h-3.5 text-slate-600" />
                                                                )}
                                                                <span>{downloadingId === log.id ? 'Saving...' : 'Download'}</span>
                                                            </button>
                                                        </div>
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
            </div>
        </div>
    );
}
