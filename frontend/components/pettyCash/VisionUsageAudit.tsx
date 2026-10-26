'use client';

import { useEffect, useState, useMemo } from 'react';
import {
    Sparkles,
    Cpu,
    Coins,
    RefreshCw,
    Search,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    ShieldCheck,
    CheckCircle2,
    Clock,
    FileText,
    ArrowUpRight,
    Loader2
} from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { inr } from '@/frontend/lib/pettyCash/roles';
import { pcFetch } from './workflowTypes';

interface ScanItem {
    id: string;
    createdAt: string;
    actorName: string;
    fileName?: string;
    tokens: number;
    model: string;
    confidence?: number;
    extractedAmount?: number | null;
}

interface RequestUsage {
    requestId: string;
    requestNo: string;
    requesterName: string;
    status: string;
    amountRequested: number;
    scanCount: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    latestScanAt: string;
    models: string[];
    scans: ScanItem[];
}

interface VisionUsageResponse {
    ok: boolean;
    summary: {
        total_scans: number;
        total_tokens: number;
        prompt_tokens: number;
        completion_tokens: number;
        estimated_cost_inr: number;
        model_breakdown: Record<string, { count: number; tokens: number }>;
    };
    per_request: RequestUsage[];
    recent_scans: Array<{
        id: string;
        requestId?: string;
        requestNo: string;
        actorName: string;
        createdAt: string;
        model: string;
        tokens: number;
        fileName?: string;
        confidence?: number;
        extractedAmount?: number | null;
    }>;
}

export default function VisionUsageAudit({
    org,
    onOpenRequest
}: {
    org: string;
    onOpenRequest: (id: string) => void;
}) {
    const [data, setData] = useState<VisionUsageResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [expandedRequest, setExpandedRequest] = useState<string | null>(null);

    const loadMetrics = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await pcFetch<VisionUsageResponse>(`/api/petty-cash/vision-usage?org_id=${org}`);
            setData(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load Vision usage metrics');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadMetrics();
    }, [org]);

    const filteredRequests = useMemo(() => {
        if (!data?.per_request) return [];
        if (!search.trim()) return data.per_request;
        const q = search.toLowerCase().trim();
        return data.per_request.filter(
            r => r.requestNo.toLowerCase().includes(q) || r.requesterName.toLowerCase().includes(q)
        );
    }, [data?.per_request, search]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm">
                <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 shadow-sm shrink-0">
                        <Sparkles size={22} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                AI AUDIT & TOKEN USAGE
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                                Org Super Admin
                            </span>
                        </div>
                        <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-tight mt-0.5">
                            Vision Model Tracking Per Request
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Auditing multimodal OCR scans, token consumption, and model inference costs across all petty cash claims.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="solid"
                        size="icon"
                        aria-label="Refresh metrics"
                        disabled={loading}
                        onClick={() => void loadMetrics()}
                        className="rounded-xl border border-slate-200 dark:border-[#30363d] hover:bg-slate-100 dark:hover:bg-[#21262d]"
                    >
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    </Button>
                </div>
            </div>

            {error && (
                <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 font-bold">
                    {error}
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm">
                    <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            TOTAL OCR SCANS
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                            <FileText size={15} />
                        </div>
                    </div>
                    <div className="text-3xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                        {loading ? '…' : data?.summary.total_scans || 0}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium mt-1 block">
                        Across {data?.per_request.length || 0} petty cash requests
                    </span>
                </div>

                <div className="p-5 rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm">
                    <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            TOKENS CONSUMED
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
                            <Cpu size={15} />
                        </div>
                    </div>
                    <div className="text-3xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                        {loading ? '…' : (data?.summary.total_tokens || 0).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-400 font-medium mt-1 flex items-center gap-1.5">
                        <span>P: {(data?.summary.prompt_tokens || 0).toLocaleString()}</span>
                        <span>•</span>
                        <span>C: {(data?.summary.completion_tokens || 0).toLocaleString()}</span>
                    </div>
                </div>

                <div className="p-5 rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm">
                    <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            EST. INFERENCE COST
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                            <Coins size={15} />
                        </div>
                    </div>
                    <div className="text-3xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                        {loading ? '…' : `₹${(data?.summary.estimated_cost_inr || 0).toFixed(2)}`}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium mt-1 block">
                        Calculated at ~₹0.04 / 1k tokens
                    </span>
                </div>

                <div className="p-5 rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm">
                    <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            PRIMARY VISION MODEL
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
                            <Sparkles size={15} />
                        </div>
                    </div>
                    <div className="text-xl font-black text-slate-900 dark:text-white mt-2 truncate">
                        {Object.keys(data?.summary.model_breakdown || {})[0] || 'qwen3.8-27b'}
                    </div>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-1 flex items-center gap-1">
                        <ShieldCheck size={12} /> Active multimodal endpoint
                    </span>
                </div>
            </div>

            {/* Per-Request Usage Table Card */}
            <div className="p-6 rounded-3xl bg-white dark:bg-[#161b22] border border-slate-100 dark:border-[#30363d] shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#30363d]">
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            PER-REQUEST BREAKDOWN
                        </span>
                        <h3 className="text-lg font-black text-slate-900 dark:text-white">
                            Vision AI Usage by Request
                        </h3>
                    </div>

                    <div className="relative min-w-[240px]">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search by Request No or Requester…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-[#30363d] bg-slate-50 dark:bg-[#0d1117] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                </div>

                {loading ? (
                    <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500">
                        <Loader2 size={18} className="animate-spin text-primary" />
                        Loading usage breakdown per request…
                    </div>
                ) : filteredRequests.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 space-y-1">
                        <Sparkles size={24} className="mx-auto opacity-40" />
                        <p className="text-sm font-bold">No Vision OCR scans recorded yet</p>
                        <p className="text-xs">When users upload receipts or payment screenshots, usage will be tracked here per request.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-[#30363d] overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                    <th className="py-2.5 px-3">Request</th>
                                    <th className="py-2.5 px-3">Requester</th>
                                    <th className="py-2.5 px-3">Status</th>
                                    <th className="py-2.5 px-3 text-right">Scans</th>
                                    <th className="py-2.5 px-3 text-right">Total Tokens</th>
                                    <th className="py-2.5 px-3 text-right">Est. Cost</th>
                                    <th className="py-2.5 px-3">Latest Scan</th>
                                    <th className="py-2.5 px-3 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-[#30363d]/60">
                                {filteredRequests.map(req => {
                                    const isExpanded = expandedRequest === req.requestId;
                                    const costInr = (req.totalTokens / 1000) * 0.04;
                                    const dateStr = new Date(req.latestScanAt).toLocaleDateString('en-IN', {
                                        day: 'numeric',
                                        month: 'short',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    });

                                    return (
                                        <>
                                            <tr key={req.requestId} className="hover:bg-slate-50/70 dark:hover:bg-[#21262d]/50 transition-colors">
                                                <td className="py-3 px-3 font-black text-slate-900 dark:text-white">
                                                    <button
                                                        type="button"
                                                        onClick={() => onOpenRequest(req.requestId)}
                                                        className="text-primary hover:underline font-black flex items-center gap-1"
                                                    >
                                                        {req.requestNo}
                                                        <ArrowUpRight size={12} />
                                                    </button>
                                                </td>
                                                <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                                                    {req.requesterName}
                                                </td>
                                                <td className="py-3 px-3">
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                                        {req.status}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-3 text-right font-black text-slate-900 dark:text-white tabular-nums">
                                                    {req.scanCount}
                                                </td>
                                                <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-white">
                                                    <span className="font-bold">{req.totalTokens.toLocaleString()}</span>
                                                    <span className="text-[10px] text-slate-400 block font-sans">
                                                        P: {req.promptTokens.toLocaleString()} / C: {req.completionTokens.toLocaleString()}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-3 text-right font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                    ₹{costInr.toFixed(3)}
                                                </td>
                                                <td className="py-3 px-3 text-slate-500 text-[11px]">
                                                    {dateStr}
                                                </td>
                                                <td className="py-3 px-3 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedRequest(isExpanded ? null : req.requestId)}
                                                        className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-[#30363d] text-slate-500"
                                                        title="Toggle scan details"
                                                    >
                                                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                                    </button>
                                                </td>
                                            </tr>

                                            {/* Expanded Detailed Audit Log per Request */}
                                            {isExpanded && (
                                                <tr key={`${req.requestId}-details`} className="bg-slate-50/50 dark:bg-[#12161c]">
                                                    <td colSpan={8} className="p-4 space-y-2">
                                                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                                            <span>Individual OCR Scans for {req.requestNo}:</span>
                                                            <span className="text-[10px] uppercase tracking-wider text-slate-400">
                                                                Model: {req.models.join(', ')}
                                                            </span>
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            {req.scans.map((scan, idx) => (
                                                                <div
                                                                    key={scan.id || idx}
                                                                    className="p-2.5 rounded-xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-[#30363d] flex flex-wrap items-center justify-between gap-2 text-xs"
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <Sparkles size={13} className="text-primary" />
                                                                        <span className="font-semibold text-slate-900 dark:text-white">
                                                                            {scan.fileName || 'Receipt Image'}
                                                                        </span>
                                                                        {scan.extractedAmount && (
                                                                            <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 font-bold text-[10px]">
                                                                                ₹{scan.extractedAmount}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-3 text-[11px] font-mono">
                                                                        <span className="text-slate-500">
                                                                            {scan.tokens} tokens
                                                                        </span>
                                                                        <span className="text-emerald-600 font-bold">
                                                                            {scan.confidence || 80}% confidence
                                                                        </span>
                                                                        <span className="text-slate-400 text-[10px] font-sans">
                                                                            {new Date(scan.createdAt).toLocaleTimeString('en-IN', { timeStyle: 'short' })}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
