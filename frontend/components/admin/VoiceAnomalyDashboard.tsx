'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    PhoneCall, Phone, AlertTriangle, CheckCircle2, XCircle, Clock,
    Search, RefreshCw, Volume2, Play, Sparkles, Filter, ShieldAlert,
    ChevronDown, Info, ArrowUpRight, BarChart2, ShieldCheck, Zap
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

    const filteredLogs = logs.filter(log => {
        const query = searchQuery.toLowerCase();
        return (
            (log.recipient_phone || '').toLowerCase().includes(query) ||
            (log.spoken_script || '').toLowerCase().includes(query) ||
            (log.event_type || '').toLowerCase().includes(query) ||
            (log.bolna_call_id || '').toLowerCase().includes(query)
        );
    });

    const uniqueEvents = Array.from(new Set(logs.map(l => l.event_type).filter(Boolean)));

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
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
                        <span className="text-[11px] font-bold uppercase tracking-wider">Flagged Anomalies</span>
                        <ShieldAlert className="w-4 h-4 text-amber-600" />
                    </div>
                    <p className={`text-2xl font-black ${anomalies.length > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                        {anomalies.length}
                    </p>
                    <span className="text-[10px] font-bold text-slate-500 mt-1 block">
                        {anomalies.length === 0 ? 'All Systems Healthy 🛡️' : 'Issues Need Review ⚠️'}
                    </span>
                </div>
            </div>

            {/* Anomaly & Delivery Issues Center */}
            {anomalies.length > 0 && (
                <div className="p-5 bg-amber-50/80 border border-amber-200 rounded-3xl space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
                            <h4 className="text-sm font-bold text-amber-950">Detected Telephony Anomalies ({anomalies.length})</h4>
                        </div>
                        <span className="text-[11px] font-extrabold text-amber-800 uppercase tracking-wide bg-amber-200/60 px-2.5 py-0.5 rounded-full">
                            Active Protection Guard
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        {anomalies.map(anom => (
                            <div key={anom.id} className="p-3.5 bg-white rounded-2xl border border-amber-200 shadow-2xs space-y-1.5 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-slate-900">{anom.title}</span>
                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                                        anom.severity === 'HIGH' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                                    }`}>
                                        {anom.severity} PRIORITY
                                    </span>
                                </div>
                                <p className="text-slate-600 leading-relaxed">{anom.description}</p>
                                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-100">
                                    <span className="font-mono font-bold text-slate-700">{anom.recipient_phone}</span>
                                    <span>{new Date(anom.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                                </div>
                            </div>
                        ))}
                    </div>
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
                                className="bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 px-2 py-1 outline-hidden"
                            >
                                <option value="all">All Statuses</option>
                                <option value="completed">Completed / Answered</option>
                                <option value="in_progress">In Progress</option>
                                <option value="failed">Failed / Dropped</option>
                                <option value="throttled_duplicate">Throttled Duplicates</option>
                            </select>
                        </div>

                        {uniqueEvents.length > 0 && (
                            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 p-1 rounded-xl text-xs">
                                <span className="text-[10px] font-bold text-slate-400 px-2 uppercase">Event:</span>
                                <select
                                    value={filterEvent}
                                    onChange={(e) => setFilterEvent(e.target.value)}
                                    className="bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 px-2 py-1 outline-hidden"
                                >
                                    <option value="all">All Events</option>
                                    {uniqueEvents.map(ev => (
                                        <option key={ev} value={ev}>{ev}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Call Records Table */}
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
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400 bg-slate-50/70">
                                    <th className="py-2.5 px-3 rounded-l-xl">Dispatch Time</th>
                                    <th className="py-2.5 px-3">Recipient Mobile</th>
                                    <th className="py-2.5 px-3">Event Key</th>
                                    <th className="py-2.5 px-3">Delivery Status</th>
                                    <th className="py-2.5 px-3">Duration</th>
                                    <th className="py-2.5 px-3">Spoken Script Prompt</th>
                                    <th className="py-2.5 px-3 text-right rounded-r-xl">Listen Preview</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredLogs.map(log => {
                                    const s = (log.call_status || '').toLowerCase();
                                    const isThrottled = s.includes('throttled');
                                    const isSuccess = s === 'completed' || s === 'in_progress';

                                    return (
                                        <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                                            <td className="py-3 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                                                {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                <span className="block text-[10px] text-slate-400">
                                                    {new Date(log.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                                </span>
                                            </td>
                                            <td className="py-3 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                                                {log.recipient_phone}
                                            </td>
                                            <td className="py-3 px-3 whitespace-nowrap">
                                                <span className="px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-[10px] font-extrabold">
                                                    {log.event_type}
                                                </span>
                                            </td>
                                            <td className="py-3 px-3 whitespace-nowrap">
                                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
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
                                                    <button
                                                        type="button"
                                                        onClick={() => playVoiceSample(log.spoken_script, log.id)}
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                                                    >
                                                        <Volume2 className={`w-3.5 h-3.5 ${playingLogId === log.id ? 'animate-bounce text-purple-800' : ''}`} />
                                                        <span>{playingLogId === log.id ? 'Playing...' : 'Audio'}</span>
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
        </div>
    );
}
