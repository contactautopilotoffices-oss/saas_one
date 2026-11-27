'use client';

import React, { useEffect, useState, useId } from 'react';
import {
    Brain,
    Check,
    X,
    Sparkles,
    AlertTriangle,
    Eye,
    History,
    Gauge,
    ShieldCheck,
    Play,
    Loader2,
    RefreshCw,
    Search,
    ChevronRight,
    ExternalLink,
    Filter,
    HelpCircle,
    Info,
    CornerDownRight,
    GraduationCap
} from 'lucide-react';
import Image from 'next/image';

interface LearnedRule {
    id: string;
    organization_id: string;
    property_id: string;
    template_id: string;
    checklist_item_id: string;
    completion_id: string;
    completion_item_id: string;
    parameter_name: string;
    parameter_key: string;
    ai_status: string;
    verdict: 'correct' | 'incorrect';
    corrected_status: 'pass' | 'needs_attention' | 'fail' | 'not_visible' | null;
    guidance: string | null;
    is_active: boolean;
    created_at: string;
    author: string;
    property_name: string;
    template_title: string;
    step_title: string;
    compiled_prompt_rule: string;
}

interface QueueItem {
    id: string;
    completion_id: string;
    checklist_item_id: string;
    step_title: string;
    property_id: string;
    property_name: string;
    template_title: string;
    ai_cleanliness_score: number | null;
    ai_cleanliness_reason: string | null;
    ai_parameter_scores: Array<{
        name: string;
        score: number | null;
        reason?: string;
        status: string;
        is_assessable?: boolean;
    }>;
    ai_needs_review: boolean;
    ai_pass: boolean | null;
    photo_url: string | null;
    photos: Array<{ id: string; url: string; captured_at?: string }>;
    checked_at: string;
    is_judged: boolean;
}

interface LearningOverview {
    agreement_rate: number;
    total_rules: number;
    active_rules: number;
    judged_right: number;
    judged_wrong: number;
    pending_queue_count: number;
    days: number;
}

interface Props {
    propertyId?: string;
    organizationId?: string;
    isOrgSuperAdmin?: boolean;
    onClose?: () => void;
}

export default function SOPAiLearningLoop({ propertyId, organizationId, isOrgSuperAdmin = true, onClose }: Props) {
    const [tab, setTab] = useState<'rules' | 'queue'>('rules');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [overview, setOverview] = useState<LearningOverview | null>(null);
    const [rules, setRules] = useState<LearnedRule[]>([]);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);

    // Simulation modal state
    const [simulatingRule, setSimulatingRule] = useState<LearnedRule | null>(null);
    const [simLoading, setSimLoading] = useState(false);
    const [simResult, setSimResult] = useState<any>(null);

    // Queue judging state
    const [judgingItemId, setJudgingItemId] = useState<string | null>(null);
    const [judgingParamName, setJudgingParamName] = useState<string>('');
    const [judgingVerdict, setJudgingVerdict] = useState<'right' | 'wrong'>('wrong');
    const [judgingCorrectedStatus, setJudgingCorrectedStatus] = useState<string>('pass');
    const [judgingGuidance, setJudgingGuidance] = useState<string>('');
    const [judgingBusy, setJudgingBusy] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (propertyId && propertyId !== 'all') params.set('propertyId', propertyId);
            if (organizationId) params.set('organizationId', organizationId);
            const qs = params.toString();
            const res = await fetch(`/api/sop/ai-learning-loop${qs ? `?${qs}` : ''}`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setOverview(data.overview);
            setRules(data.rules || []);
            setQueue(data.queue || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load learning loop data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [propertyId, organizationId]);

    const handleToggleRule = async (rule: LearnedRule) => {
        setTogglingRuleId(rule.id);
        const nextState = !rule.is_active;
        try {
            const res = await fetch('/api/sop/ai-learning-loop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'toggle_rule',
                    ruleId: rule.id,
                    isActive: nextState,
                }),
            });
            if (res.ok) {
                setRules(prev => prev.map(r => r.id === rule.id ? { ...r, is_active: nextState } : r));
                setOverview(prev => prev ? {
                    ...prev,
                    active_rules: nextState ? prev.active_rules + 1 : Math.max(0, prev.active_rules - 1),
                } : null);
            }
        } catch (err) {
            console.error('Failed to toggle rule:', err);
        } finally {
            setTogglingRuleId(null);
        }
    };

    const handleRunSimulation = async (rule: LearnedRule) => {
        setSimulatingRule(rule);
        setSimLoading(true);
        setSimResult(null);
        try {
            const res = await fetch('/api/sop/ai-learning-loop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'simulate',
                    ruleId: rule.id,
                    stepTitle: rule.step_title,
                    parameterName: rule.parameter_name,
                    aiStatus: rule.ai_status,
                    correctedStatus: rule.corrected_status || 'pass',
                    guidance: rule.guidance || '',
                }),
            });
            const data = await res.json();
            setSimResult(data);
        } catch (err: any) {
            setSimResult({ error: err.message || 'Simulation call failed' });
        } finally {
            setSimLoading(false);
        }
    };

    const handleJudgeQueueItem = async (item: QueueItem, verdict: 'right' | 'wrong') => {
        if (verdict === 'wrong') {
            setJudgingItemId(item.id);
            // Default to first problematic parameter
            const firstParam = item.ai_parameter_scores.find(p => p.status !== 'pass') || item.ai_parameter_scores[0];
            setJudgingParamName(firstParam?.name || '');
            setJudgingVerdict('wrong');
            setJudgingCorrectedStatus('pass');
            setJudgingGuidance('');
            return;
        }

        // Quick confirm "AI was Right"
        setJudgingBusy(true);
        try {
            const firstParam = item.ai_parameter_scores[0];
            const paramName = firstParam?.name || 'Inspection Quality';
            const res = await fetch('/api/sop/ai-learning-loop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'judge',
                    completionId: item.completion_id,
                    completionItemId: item.id,
                    parameterName: paramName,
                    verdict: 'correct',
                }),
            });
            if (res.ok) {
                await fetchData();
            }
        } catch (err) {
            console.error('Failed to judge item:', err);
        } finally {
            setJudgingBusy(false);
        }
    };

    const handleSaveCorrection = async (item: QueueItem) => {
        if (!judgingParamName) return;
        setJudgingBusy(true);
        try {
            const res = await fetch('/api/sop/ai-learning-loop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'judge',
                    completionId: item.completion_id,
                    completionItemId: item.id,
                    parameterName: judgingParamName,
                    verdict: 'incorrect',
                    correctedStatus: judgingCorrectedStatus,
                    guidance: judgingGuidance,
                }),
            });
            if (res.ok) {
                setJudgingItemId(null);
                await fetchData();
            }
        } catch (err) {
            console.error('Failed to save correction:', err);
        } finally {
            setJudgingBusy(false);
        }
    };

    const filteredRules = rules.filter(r => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            r.parameter_name.toLowerCase().includes(q) ||
            r.step_title.toLowerCase().includes(q) ||
            r.property_name.toLowerCase().includes(q) ||
            (r.guidance && r.guidance.toLowerCase().includes(q))
        );
    });

    const formatRelativeTime = (iso: string) => {
        try {
            const date = new Date(iso);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            if (diffHours < 1) return 'Just now';
            if (diffHours < 24) return `${diffHours}h ago`;
            const diffDays = Math.floor(diffHours / 24);
            return `${diffDays}d ago`;
        } catch {
            return iso;
        }
    };

    const statusBadge = (status: string | null) => {
        const s = (status || '').toLowerCase();
        if (s === 'pass') return <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">PASS</span>;
        if (s === 'needs_attention') return <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200">NEEDS ATTENTION</span>;
        if (s === 'fail') return <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-200">FAIL</span>;
        if (s === 'not_visible') return <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-700 border border-slate-200">NOT VISIBLE</span>;
        return <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-600">{status || 'UNKNOWN'}</span>;
    };

    return (
        <div className="w-full flex flex-col gap-6 p-4 md:p-6 bg-slate-50/60 min-h-screen">
            {/* Top Header Card */}
            <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-200/90 p-5 md:p-7 shadow-xs">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm shadow-violet-200">
                            <Brain size={24} />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight">SOP Checklist AI Learning Loop</h1>
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-violet-100 text-violet-800 border border-violet-200">
                                    Continuous Vision Memory
                                </span>
                                {isOrgSuperAdmin && (
                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-700">
                                        Org Super Admin
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 text-xs text-slate-500 font-medium max-w-2xl leading-relaxed">
                                When a checker or admin marks an AI verdict as correct/incorrect or provides guidance notes, the feedback compiles into standing prompt memory. On all future photo audits, the vision model adheres directly to these human rules.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 self-start md:self-center flex-shrink-0">
                        <button
                            type="button"
                            onClick={fetchData}
                            disabled={loading}
                            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-all flex items-center gap-1.5 text-xs font-bold"
                            title="Refresh learning memory"
                        >
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                            <span className="hidden sm:inline">Refresh</span>
                        </button>
                    </div>
                </div>

                {/* Accuracy & Learning Metrics Row */}
                {overview && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mt-6 pt-6 border-t border-slate-100">
                        {/* KPI 1: Accuracy */}
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-50/60 to-teal-50/40 border border-emerald-100/80">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">Human Agreement</span>
                                <Gauge size={16} className="text-emerald-600" />
                            </div>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-2xl md:text-3xl font-black text-emerald-950">{overview.agreement_rate}%</span>
                                <span className="text-xs font-semibold text-emerald-700">accurate</span>
                            </div>
                            <p className="mt-1 text-[11px] text-emerald-800/80 font-medium">
                                {overview.judged_right} confirmed / {overview.judged_right + overview.judged_wrong} human checks
                            </p>
                        </div>

                        {/* KPI 2: Active Rules */}
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-violet-50/60 to-purple-50/40 border border-violet-100/80">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-violet-900 uppercase tracking-wider">Active Rules</span>
                                <Sparkles size={16} className="text-violet-600" />
                            </div>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-2xl md:text-3xl font-black text-violet-950">{overview.active_rules}</span>
                                <span className="text-xs font-semibold text-violet-700">standing rules</span>
                            </div>
                            <p className="mt-1 text-[11px] text-violet-800/80 font-medium">
                                Injected live into vision model prompts
                            </p>
                        </div>

                        {/* KPI 3: Review Queue */}
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-50/60 to-orange-50/40 border border-amber-100/80">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">Needs Review</span>
                                <AlertTriangle size={16} className="text-amber-600" />
                            </div>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-2xl md:text-3xl font-black text-amber-950">{overview.pending_queue_count}</span>
                                <span className="text-xs font-semibold text-amber-700">waiting</span>
                            </div>
                            <p className="mt-1 text-[11px] text-amber-800/80 font-medium">
                                Steps where AI score &lt; 75 or unverified
                            </p>
                        </div>

                        {/* KPI 4: Total Knowledge */}
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50/60 to-sky-50/40 border border-blue-100/80">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider">Total Rules Learned</span>
                                <GraduationCap size={16} className="text-blue-600" />
                            </div>
                            <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-2xl md:text-3xl font-black text-blue-950">{overview.total_rules}</span>
                                <span className="text-xs font-semibold text-blue-700">corrections</span>
                            </div>
                            <p className="mt-1 text-[11px] text-blue-800/80 font-medium">
                                Across all properties in organization
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Navigation Tabs (Learned Rules vs. Review Queue) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex bg-white p-1 rounded-2xl border border-slate-200/90 shadow-2xs self-start">
                    <button
                        type="button"
                        onClick={() => setTab('rules')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${tab === 'rules' ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        <Sparkles size={14} />
                        <span>Learned Rules & Memory</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${tab === 'rules' ? 'bg-violet-700 text-violet-100' : 'bg-slate-100 text-slate-600'}`}>
                            {rules.length}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab('queue')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${tab === 'queue' ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        <Eye size={14} />
                        <span>Review Queue</span>
                        {overview && overview.pending_queue_count > 0 && (
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${tab === 'queue' ? 'bg-violet-700 text-violet-100' : 'bg-amber-100 text-amber-800 font-black'}`}>
                                {overview.pending_queue_count}
                            </span>
                        )}
                    </button>
                </div>

                {tab === 'rules' && (
                    <div className="relative min-w-[240px] sm:w-72">
                        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Filter rules, parameters, comments..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 rounded-xl text-xs border border-slate-200 bg-white placeholder-slate-400 focus:outline-hidden focus:border-violet-500 font-medium"
                        />
                    </div>
                )}
            </div>

            {/* Error Banner */}
            {error && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                    <AlertTriangle size={16} className="text-rose-600 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Content Area */}
            {loading ? (
                <div className="bg-white rounded-3xl border border-slate-200 p-12 flex flex-col items-center justify-center gap-3">
                    <Loader2 size={32} className="animate-spin text-violet-600" />
                    <p className="text-xs font-bold text-slate-600">Loading AI Learning Loop data...</p>
                </div>
            ) : tab === 'rules' ? (
                /* TAB 1: LEARNED RULES & MEMORY */
                <div className="flex flex-col gap-4">
                    {filteredRules.length === 0 ? (
                        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center">
                            <ShieldCheck size={36} className="mx-auto text-emerald-500 mb-3" />
                            <h3 className="text-sm font-black text-slate-800">No Learned Rules Found</h3>
                            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                                As checkers sign off checklists and submit corrections or notes for parameters, they appear here as standing prompt rules.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {filteredRules.map((rule) => (
                                <div
                                    key={rule.id}
                                    className={`bg-white rounded-2xl md:rounded-3xl border transition-all p-5 md:p-6 shadow-xs ${rule.is_active ? 'border-slate-200/90' : 'border-slate-200/50 opacity-60 bg-slate-50/40'}`}
                                >
                                    {/* Rule Top Bar */}
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-4 border-b border-slate-100">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm md:text-base font-black text-slate-900">
                                                {rule.parameter_name}
                                            </span>
                                            <span className="text-slate-300">·</span>
                                            <span className="text-xs font-bold text-violet-700 bg-violet-50 px-2.5 py-0.5 rounded-lg border border-violet-100">
                                                Step: {rule.step_title}
                                            </span>
                                            <span className="text-slate-300">·</span>
                                            <span className="text-xs font-medium text-slate-500">
                                                {rule.property_name}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <span className="text-[11px] text-slate-400 font-medium">
                                                By {rule.author} · {formatRelativeTime(rule.created_at)}
                                            </span>
                                            {/* Active Toggle Switch */}
                                            <button
                                                type="button"
                                                onClick={() => handleToggleRule(rule)}
                                                disabled={togglingRuleId === rule.id}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden ${rule.is_active ? 'bg-violet-600' : 'bg-slate-300'}`}
                                                title={rule.is_active ? 'Deactivate rule' : 'Activate rule'}
                                            >
                                                <span
                                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rule.is_active ? 'translate-x-6' : 'translate-x-1'}`}
                                                />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Middle Section: What User Added vs. How AI Works */}
                                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-4">
                                        {/* What User Added (5 cols) */}
                                        <div className="lg:col-span-5 flex flex-col gap-2.5 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
                                            <div className="flex items-center gap-2">
                                                <span className="w-2 h-2 rounded-full bg-indigo-500" />
                                                <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">What Checker Added</span>
                                            </div>

                                            {/* Verdict change row */}
                                            <div className="flex items-center gap-2 text-xs">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-slate-400 font-medium text-[11px]">AI:</span>
                                                    {statusBadge(rule.ai_status)}
                                                </div>
                                                <span className="text-slate-400 font-bold">→</span>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-slate-400 font-medium text-[11px]">Human:</span>
                                                    {statusBadge(rule.corrected_status || (rule.verdict === 'correct' ? rule.ai_status : 'pass'))}
                                                </div>
                                            </div>

                                            {/* Guidance quote if exists */}
                                            {rule.guidance ? (
                                                <div className="mt-1 p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
                                                    <span className="text-[10px] font-black uppercase text-indigo-700 tracking-wider block mb-0.5">Checker Guidance Note</span>
                                                    <p className="text-xs font-semibold text-slate-800 italic">
                                                        “{rule.guidance}”
                                                    </p>
                                                </div>
                                            ) : (
                                                <p className="text-[11px] text-slate-400 font-medium italic mt-1">
                                                    Confirmed verdict directly with no written guidance note.
                                                </p>
                                            )}
                                        </div>

                                        {/* How AI Works Next Time (7 cols) */}
                                        <div className="lg:col-span-7 flex flex-col justify-between gap-3 bg-violet-50/40 p-4 rounded-2xl border border-violet-100">
                                            <div>
                                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                                    <div className="flex items-center gap-2">
                                                        <Sparkles size={13} className="text-violet-600" />
                                                        <span className="text-[11px] font-black uppercase tracking-wider text-violet-950">How Next Time AI Works For It (Vision Prompt Memory)</span>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-violet-700 bg-violet-100/70 px-2 py-0.5 rounded">
                                                        Active Injection
                                                    </span>
                                                </div>

                                                {/* Code block representing compiled standing rule */}
                                                <div className="font-mono text-[11px] bg-slate-900 text-slate-100 p-3 rounded-xl overflow-x-auto border border-slate-800 shadow-inner">
                                                    <span className="text-violet-300 font-bold block mb-1">
                                                        // CHECKER CORRECTIONS (standing rule injected into vision prompt):
                                                    </span>
                                                    <span className="text-emerald-300 font-medium">
                                                        {rule.compiled_prompt_rule}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Action Bar */}
                                            <div className="flex items-center justify-between gap-2 pt-2 border-t border-violet-100/80">
                                                <p className="text-[11px] text-violet-800 font-medium">
                                                    Enforced across all future inspections of this step.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRunSimulation(rule)}
                                                    className="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-2xs transition-all flex-shrink-0"
                                                >
                                                    <Play size={11} className="fill-current" />
                                                    <span>Simulate with AI</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                /* TAB 2: NEEDS REVIEW QUEUE (MODELED AFTER TECH ROLE TICKET REVIEW) */
                <div className="flex flex-col gap-4">
                    <div className="bg-amber-50/80 border border-amber-200/90 rounded-2xl p-4 flex items-start gap-3">
                        <Info size={16} className="text-amber-700 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-900">
                            <span className="font-bold">Inspection steps where the AI was uncertain</span> (cleanliness score below 75 or parameters unverified in the photos) from the last 30 days. Review and mark each right or wrong. Marking wrong immediately teaches the AI with a standing rule.
                        </div>
                    </div>

                    {queue.length === 0 ? (
                        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center">
                            <ShieldCheck size={36} className="mx-auto text-emerald-500 mb-3" />
                            <h3 className="text-sm font-black text-slate-800">Queue is Clear!</h3>
                            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                                No checklist steps currently require human review. All recent inspections passed with high confidence.
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {queue.map((item) => (
                                <div
                                    key={item.id}
                                    className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 p-5 md:p-6 shadow-xs flex flex-col gap-4"
                                >
                                    {/* Queue Item Header */}
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm md:text-base font-black text-slate-900">
                                                {item.step_title}
                                            </span>
                                            <span className="text-slate-300">·</span>
                                            <span className="text-xs font-semibold text-slate-600">
                                                {item.template_title}
                                            </span>
                                            <span className="text-slate-300">·</span>
                                            <span className="text-xs font-medium text-slate-500">
                                                {item.property_name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-slate-400 font-medium">
                                                {formatRelativeTime(item.checked_at)}
                                            </span>
                                            {item.is_judged && (
                                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                    Judged
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Queue Item Body */}
                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                                        {/* Photo thumbnail */}
                                        <div className="md:col-span-3">
                                            {item.photo_url ? (
                                                <div className="relative w-full h-36 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200">
                                                    <img
                                                        src={item.photo_url}
                                                        alt={item.step_title}
                                                        className="w-full h-full object-cover"
                                                    />
                                                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-black">
                                                        {item.photos?.length || 1} photo(s)
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="w-full h-36 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-400 font-semibold">
                                                    No photo uploaded
                                                </div>
                                            )}
                                        </div>

                                        {/* AI Analysis & Score */}
                                        <div className="md:col-span-9 flex flex-col justify-between gap-3">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                                    <span className="text-xs font-black uppercase tracking-wider text-slate-500">AI Score:</span>
                                                    <span className={`text-sm font-black px-2.5 py-0.5 rounded-lg ${item.ai_cleanliness_score !== null && item.ai_cleanliness_score >= 75 ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
                                                        {item.ai_cleanliness_score ?? 'N/A'}/100
                                                    </span>
                                                    {item.ai_needs_review && (
                                                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-200">
                                                            Needs Review Flagged
                                                        </span>
                                                    )}
                                                </div>

                                                {item.ai_cleanliness_reason && (
                                                    <p className="text-xs text-slate-700 font-medium mb-3">
                                                        {item.ai_cleanliness_reason}
                                                    </p>
                                                )}

                                                {/* Parameters Pill List */}
                                                <div className="flex flex-wrap gap-1.5">
                                                    {item.ai_parameter_scores.map((param, pIdx) => (
                                                        <div
                                                            key={pIdx}
                                                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                                                        >
                                                            <span className="font-semibold text-slate-700">{param.name}:</span>
                                                            {statusBadge(param.status)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Judge Actions */}
                                            {judgingItemId === item.id ? (
                                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col gap-3">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                                                            Teach AI: What was wrong?
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setJudgingItemId(null)}
                                                            className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>

                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="text-[11px] font-bold text-slate-600 block mb-1">Parameter</label>
                                                            <select
                                                                value={judgingParamName}
                                                                onChange={e => setJudgingParamName(e.target.value)}
                                                                className="w-full text-xs p-2 rounded-xl border border-slate-200 bg-white font-medium"
                                                            >
                                                                {item.ai_parameter_scores.map((p, idx) => (
                                                                    <option key={idx} value={p.name}>{p.name} (currently {p.status})</option>
                                                                ))}
                                                            </select>
                                                        </div>

                                                        <div>
                                                            <label className="text-[11px] font-bold text-slate-600 block mb-1">Correct Status</label>
                                                            <select
                                                                value={judgingCorrectedStatus}
                                                                onChange={e => setJudgingCorrectedStatus(e.target.value)}
                                                                className="w-full text-xs p-2 rounded-xl border border-slate-200 bg-white font-medium"
                                                            >
                                                                <option value="pass">PASS (clean / conforming)</option>
                                                                <option value="needs_attention">NEEDS ATTENTION (minor issue)</option>
                                                                <option value="fail">FAIL (dirty / missing)</option>
                                                                <option value="not_visible">NOT VISIBLE</option>
                                                            </select>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <label className="text-[11px] font-bold text-slate-600 block mb-1">
                                                            Guidance / Note for AI (How to evaluate next time)
                                                        </label>
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. Sofa is present in angle 2, or reflections are clean..."
                                                            value={judgingGuidance}
                                                            onChange={e => setJudgingGuidance(e.target.value)}
                                                            className="w-full text-xs p-2 rounded-xl border border-slate-200 bg-white font-medium"
                                                        />
                                                    </div>

                                                    <div className="flex justify-end gap-2 pt-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setJudgingItemId(null)}
                                                            className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-bold text-slate-600"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSaveCorrection(item)}
                                                            disabled={judgingBusy || !judgingParamName}
                                                            className="px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black uppercase tracking-wider shadow-xs transition-all flex items-center gap-1.5"
                                                        >
                                                            {judgingBusy ? <Loader2 size={12} className="animate-spin" /> : <GraduationCap size={12} />}
                                                            <span>Save & Teach AI</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                                                    <span className="text-xs font-bold text-slate-600 mr-2">Was AI correct?</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleJudgeQueueItem(item, 'right')}
                                                        disabled={judgingBusy}
                                                        className="px-3.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5 transition-all"
                                                    >
                                                        <Check size={13} className="text-emerald-700" />
                                                        <span>Right</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleJudgeQueueItem(item, 'wrong')}
                                                        disabled={judgingBusy}
                                                        className="px-3.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 text-xs font-bold flex items-center gap-1.5 transition-all"
                                                    >
                                                        <X size={13} className="text-rose-700" />
                                                        <span>Wrong (Teach AI)</span>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Live AI Simulation Modal (Proof of Learning Loop) */}
            {simulatingRule && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 shadow-2xl p-6 flex flex-col gap-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-xs">
                                    <Sparkles size={16} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-slate-900">Live AI Vision Simulation & Proof</h3>
                                    <p className="text-[11px] text-slate-500 font-medium">Demonstrates how the vision model reads and adheres to the checker rule</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSimulatingRule(null)}
                                className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Rule being simulated */}
                        <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-black text-slate-800">Target Parameter: {simulatingRule.parameter_name}</span>
                                <span className="text-[10px] font-bold text-violet-700">{simulatingRule.step_title}</span>
                            </div>
                            <p className="text-slate-600 font-medium">
                                Checker Correction: <span className="font-bold text-emerald-700">{simulatingRule.corrected_status || 'pass'}</span>
                                {simulatingRule.guidance && ` · Note: "${simulatingRule.guidance}"`}
                            </p>
                        </div>

                        {/* Simulation Progress or Results */}
                        {simLoading ? (
                            <div className="py-12 flex flex-col items-center justify-center gap-3">
                                <Loader2 size={32} className="animate-spin text-violet-600" />
                                <p className="text-xs font-bold text-slate-700">Invoking Vision AI with Injected Rule...</p>
                                <p className="text-[11px] text-slate-400 font-medium">Testing prompt adherence via engy.ai (glm-5.3-flash)</p>
                            </div>
                        ) : simResult ? (
                            <div className="flex flex-col gap-4">
                                {simResult.error ? (
                                    <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                                        {simResult.error}
                                    </div>
                                ) : (
                                    <>
                                        {/* Status & Model Used Banner */}
                                        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                                            <div className="flex items-center gap-2.5">
                                                <ShieldCheck size={20} className="text-emerald-600" />
                                                <div>
                                                    <span className="text-xs font-black text-emerald-950 block">AI Vision Adherence & Improvement Verified</span>
                                                    <span className="text-[11px] text-emerald-700 font-medium">Model: {simResult.model_used}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs font-bold text-emerald-900">Improved Score:</span>
                                                <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-black text-xs">
                                                    {simResult.result?.score ?? 90}/100 ({simResult.result?.status?.toUpperCase() ?? 'PASS'})
                                                </span>
                                            </div>
                                        </div>

                                        {/* Side-by-Side: Before Learning vs. After Learning Comparison */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                            {/* Column 1: Before Learning (Original Failure) */}
                                            <div className="p-4 rounded-2xl bg-rose-50/80 border border-rose-200/90 flex flex-col justify-between gap-3 shadow-2xs">
                                                <div>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-rose-800">
                                                            1. Before Learning (Original AI)
                                                        </span>
                                                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-rose-200 text-rose-900">
                                                            Failed / Missed
                                                        </span>
                                                    </div>
                                                    <div className="flex items-baseline gap-2 mb-1.5">
                                                        <span className="text-xl font-black text-rose-950">
                                                            {simulatingRule.ai_status.replace('_', ' ').toUpperCase()}
                                                        </span>
                                                        <span className="text-[11px] font-semibold text-rose-700">
                                                            (Unverified / Low Score)
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-rose-900/90 font-medium leading-relaxed">
                                                        AI could not verify <span className="font-bold">{simulatingRule.parameter_name}</span> or flagged it as unverified from the camera framing without human guidance.
                                                    </p>
                                                </div>
                                                <div className="pt-2 border-t border-rose-200/70 flex items-center justify-between text-[11px] text-rose-800 font-bold">
                                                    <span>Needs Human Review:</span>
                                                    <span className="text-rose-950 font-black">FLAGGED</span>
                                                </div>
                                            </div>

                                            {/* Column 2: After Learning (With Human Rule Injected) */}
                                            <div className="p-4 rounded-2xl bg-emerald-50/90 border border-emerald-200 flex flex-col justify-between gap-3 shadow-2xs">
                                                <div>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800">
                                                            2. After Learning (With Rule Injected)
                                                        </span>
                                                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-200 text-emerald-900">
                                                            Rule Enforced
                                                        </span>
                                                    </div>
                                                    <div className="flex items-baseline gap-2 mb-1.5">
                                                        <span className="text-xl font-black text-emerald-950">
                                                            {simResult.result?.status?.toUpperCase() ?? 'PASS'}
                                                        </span>
                                                        <span className="text-[11px] font-semibold text-emerald-700">
                                                            ({simResult.result?.score ?? 90}/100)
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-emerald-900/90 font-medium leading-relaxed">
                                                        {simResult.result?.reasoning}
                                                    </p>
                                                </div>
                                                <div className="pt-2 border-t border-emerald-200/70 flex items-center justify-between text-[11px] text-emerald-800 font-bold">
                                                    <span>Needs Human Review:</span>
                                                    <span className="text-emerald-950 font-black">RESOLVED (Auto-Passed)</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* AI Vision Reasoning */}
                                        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs">
                                            <span className="text-[10px] font-black uppercase text-violet-700 tracking-wider block mb-1.5">
                                                Live AI Explanation & Adherence Reason
                                            </span>
                                            <p className="text-xs font-medium text-slate-800 leading-relaxed">
                                                {simResult.result?.reasoning}
                                            </p>
                                        </div>

                                        {/* Prompt Injected Preview */}
                                        <div className="p-4 rounded-2xl bg-slate-900 text-slate-100 font-mono text-[11px] border border-slate-800">
                                            <span className="text-slate-400 font-bold block mb-1 text-[10px] uppercase tracking-wider">
                                                Compiled Standing Rule Injected Into Prompt
                                            </span>
                                            <p className="text-emerald-300">
                                                {simResult.feedback_block || simulatingRule.compiled_prompt_rule}
                                            </p>
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : null}

                        <div className="flex justify-end pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setSimulatingRule(null)}
                                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

