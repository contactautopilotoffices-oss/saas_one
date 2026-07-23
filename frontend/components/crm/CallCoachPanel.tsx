'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
    Phone, Upload, Loader2, PlayCircle, FileAudio, AlertCircle,
    CheckCircle2, XCircle, Sparkles, Clock, Mic, MessageSquare,
    TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CrmCallSummary,
    CrmCallDetail,
    COACHING_LAYER_KEYS,
    COACHING_LAYER_LABELS,
    CoachingLayerKey,
    CoachingReport,
    TranscriptSegment,
} from '@/frontend/types/crm';
import { uploadWithProgress } from '@/frontend/utils/upload-with-progress';

interface CallCoachPanelProps {
    leadId: string;
    /** Pass org id when available — used for cache-busting on refresh. */
    orgId?: string;
    /** Optional initial calls list (e.g. from parent parallel load). */
    initialCalls?: CrmCallSummary[];
    onCallsChange?: (calls: CrmCallSummary[]) => void;
}

type Phase = 'idle' | 'uploading' | 'analyzing' | 'ready' | 'error';

export default function CallCoachPanel({
    leadId,
    orgId,
    initialCalls,
    onCallsChange,
}: CallCoachPanelProps) {
    const [calls, setCalls] = useState<CrmCallSummary[]>(initialCalls || []);
    const [selectedId, setSelectedId] = useState<string | null>(
        initialCalls && initialCalls.length > 0 ? initialCalls[0].id : null
    );
    const [selectedDetail, setSelectedDetail] = useState<CrmCallDetail | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);

    const [phase, setPhase] = useState<Phase>('idle');
    const [uploadProgress, setUploadProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Refresh list when lead changes
    useEffect(() => {
        if (!leadId) return;
        let cancelled = false;
        (async () => {
            const res = await fetch(`/api/crm/calls?lead_id=${leadId}`, { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            if (cancelled) return;
            const list: CrmCallSummary[] = data.calls || [];
            setCalls(list);
            onCallsChange?.(list);
            if (list.length > 0 && !list.find((c) => c.id === selectedId)) {
                setSelectedId(list[0].id);
            } else if (list.length === 0) {
                setSelectedId(null);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leadId, orgId]);

    // Load selected detail
    useEffect(() => {
        if (!selectedId) {
            setSelectedDetail(null);
            return;
        }
        let cancelled = false;
        setIsLoadingDetail(true);
        (async () => {
            const res = await fetch(`/api/crm/calls/${selectedId}`, { cache: 'no-store' });
            if (cancelled) return;
            if (!res.ok) {
                setIsLoadingDetail(false);
                return;
            }
            const data = await res.json();
            if (cancelled) return;
            setSelectedDetail(data.call);
            setIsLoadingDetail(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedId]);

    const handlePickFile = () => fileInputRef.current?.click();

    const handleFile = async (file: File) => {
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) {
            setError('File too large (max 50 MB)');
            setPhase('error');
            return;
        }

        setError(null);
        setPhase('uploading');
        setUploadProgress(0);

        try {
            const data = (await uploadWithProgress(
                '/api/crm/calls',
                file,
                { lead_id: leadId },
                (p) => setUploadProgress(p)
            )) as { url?: string; call_id?: string; status?: string; overall_score?: number; error?: string };

            if (data?.error) {
                setError(data.error);
                setPhase('error');
                return;
            }

            setPhase('analyzing');

            // Refresh the list (the response has call_id + status; the row
            // is already in 'completed' because the pipeline runs inline).
            const res = await fetch(`/api/crm/calls?lead_id=${leadId}`, { cache: 'no-store' });
            const listData = await res.json();
            const list: CrmCallSummary[] = listData.calls || [];
            setCalls(list);
            onCallsChange?.(list);
            if (data.call_id) setSelectedId(data.call_id);
            setPhase('ready');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
            setPhase('error');
        }
    };

    return (
        <div className="flex flex-col gap-4 p-4">
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                }}
            />

            {/* Upload bar */}
            <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-slate-200 bg-white p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Mic className="h-5 w-5" />
                </div>
                <div className="flex-1">
                    <h3 className="font-semibold text-text-primary">AI Call Coach</h3>
                    <p className="text-xs text-text-secondary">
                        Upload an MP3/WAV/M4A recording. We'll transcribe and score the rep on 5 layers of the sales conversation.
                    </p>
                </div>
                <button
                    onClick={handlePickFile}
                    disabled={phase === 'uploading' || phase === 'analyzing'}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                >
                    {phase === 'uploading' || phase === 'analyzing' ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {phase === 'uploading' ? `Uploading ${uploadProgress}%` : 'Analyzing…'}
                        </>
                    ) : (
                        <>
                            <Upload className="h-4 w-4" />
                            Upload recording
                        </>
                    )}
                </button>
            </div>

            {/* Progress bar */}
            <AnimatePresence>
                {phase === 'uploading' && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="rounded-[var(--radius-md)] bg-slate-100 p-1"
                    >
                        <div
                            className="h-2 rounded-[var(--radius-sm)] bg-primary transition-all"
                            style={{ width: `${uploadProgress}%` }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Error */}
            {phase === 'error' && error && (
                <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-error/20 bg-error/5 p-3 text-sm text-error">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            )}

            <div className="flex flex-col gap-4 min-w-0">
                {/* Compact recordings strip — horizontal, frees width for the report */}
                {calls.length > 0 && (
                    <div className="min-w-0">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-text-tertiary uppercase tracking-wide">
                            <FileAudio className="h-3.5 w-3.5" /> Recordings ({calls.length})
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                            {calls.map((call) => (
                                <button
                                    key={call.id}
                                    onClick={() => setSelectedId(call.id)}
                                    className={`shrink-0 rounded-xl border px-3 py-2 text-left transition-colors min-w-[140px] ${
                                        selectedId === call.id ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold text-text-primary whitespace-nowrap">{formatDate(call.uploaded_at)}</span>
                                        <CallStatusBadge status={call.status} />
                                    </div>
                                    {call.overall_score != null && (
                                        <div className="mt-1 flex items-center gap-1 text-[11px] text-text-secondary">
                                            <Sparkles className="h-3 w-3" />
                                            <span className="font-bold text-text-primary">{call.overall_score.toFixed(1)}/10</span>
                                            {call.rep_talk_ratio != null && <span className="text-text-tertiary">· {Math.round(call.rep_talk_ratio * 100)}% talk</span>}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Detail */}
                <div className="min-h-[200px] min-w-0">
                    {isLoadingDetail && (
                        <div className="flex items-center justify-center p-12">
                            <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
                        </div>
                    )}
                    {!isLoadingDetail && !selectedDetail && (
                        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-slate-200 bg-white p-12 text-center">
                            <Phone className="h-8 w-8 text-text-tertiary" />
                            <p className="mt-2 text-sm text-text-secondary">
                                Select a recording on the left, or upload a new one.
                            </p>
                        </div>
                    )}
                    {selectedDetail && (
                        <CallDetailView call={selectedDetail} />
                    )}
                </div>
            </div>
        </div>
    );
}

function CallStatusBadge({ status }: { status: CrmCallSummary['status'] }) {
    const map: Record<CrmCallSummary['status'], { bg: string; text: string; label: string }> = {
        uploaded:    { bg: 'bg-slate-100',  text: 'text-slate-700',   label: 'Uploaded' },
        transcribing:{ bg: 'bg-blue-100',   text: 'text-blue-700',    label: 'Transcribing' },
        scoring:     { bg: 'bg-violet-100', text: 'text-violet-700',  label: 'Scoring' },
        completed:   { bg: 'bg-emerald-100',text: 'text-emerald-700', label: 'Completed' },
        failed:      { bg: 'bg-red-100',    text: 'text-red-700',     label: 'Failed' },
    };
    const c = map[status];
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
}

function CallDetailView({ call }: { call: CrmCallDetail }) {
    if (call.status === 'failed') {
        return (
            <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-6">
                <div className="flex items-center gap-2 text-error">
                    <XCircle className="h-5 w-5" />
                    <h3 className="font-semibold">Analysis failed</h3>
                </div>
                <p className="mt-2 text-sm text-text-secondary">
                    {call.error_message || 'We could not process this recording. Try re-uploading.'}
                </p>
            </div>
        );
    }

    if (call.status !== 'completed') {
        return (
            <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-slate-200 bg-white p-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="mt-3 text-sm text-text-secondary">
                    {call.status === 'transcribing' ? 'Transcribing audio with Whisper…' : 'Scoring against the 5-layer rubric…'}
                </p>
                <p className="mt-1 text-xs text-text-tertiary">Usually takes 30–90 seconds.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                            <Phone className="h-4 w-4" />
                            <span>{call.lead_company_name || 'Call'}</span>
                            <span className="text-text-tertiary">·</span>
                            <Clock className="h-3.5 w-3.5" />
                            <span>{formatDuration(call.duration_seconds)}</span>
                            {call.rep?.full_name && (
                                <>
                                    <span className="text-text-tertiary">·</span>
                                    <span>Rep: {call.rep.full_name}</span>
                                </>
                            )}
                        </div>
                        <p className="mt-2 text-sm text-text-primary">{call.summary}</p>
                    </div>
                    <div className="flex flex-col items-end">
                        <div className="text-3xl font-bold text-text-primary">
                            {call.overall_score?.toFixed(1) ?? '—'}
                            <span className="text-base font-normal text-text-secondary">/10</span>
                        </div>
                        <div className="text-xs text-text-secondary">overall</div>
                    </div>
                </div>
                {call.playback_url && (
                    <audio
                        controls
                        src={call.playback_url}
                        className="mt-4 w-full"
                        preload="metadata"
                    />
                )}
            </div>

            {/* 5-layer scores */}
            {call.coaching && (
                <>
                    <LayerBreakdown report={call.coaching} />
                    <CoachingLists report={call.coaching} />
                </>
            )}

            {/* Transcript — collapsed by default so the coaching report leads */}
            {call.transcript && call.transcript.length > 0 && (
                <details className="rounded-[var(--radius-lg)] border border-slate-200 bg-white group">
                    <summary className="flex items-center justify-between cursor-pointer px-5 py-3 text-sm font-semibold text-text-primary select-none">
                        <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Transcript ({call.transcript.length})</span>
                        <span className="text-xs font-normal text-text-tertiary group-open:hidden">Show</span>
                        <span className="text-xs font-normal text-text-tertiary hidden group-open:inline">Hide</span>
                    </summary>
                    <div className="px-1 pb-1">
                        <TranscriptView segments={call.transcript} />
                    </div>
                </details>
            )}
        </div>
    );
}

function LayerBreakdown({ report }: { report: CoachingReport }) {
    return (
        <div className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-5">
            <h4 className="mb-4 text-sm font-semibold text-text-primary">5-Layer Breakdown</h4>
            <div className="space-y-3">
                {COACHING_LAYER_KEYS.map((key) => {
                    const layer = report.layers[key];
                    const pct = (layer.score / 10) * 100;
                    const tone =
                        layer.score >= 7
                            ? 'bg-emerald-500'
                            : layer.score >= 5
                            ? 'bg-amber-500'
                            : 'bg-red-500';
                    return (
                        <div key={key}>
                            <div className="mb-1 flex items-center justify-between text-sm">
                                <span className="font-medium text-text-primary">
                                    {COACHING_LAYER_LABELS[key]}
                                </span>
                                <span className="font-semibold text-text-primary">
                                    {layer.score.toFixed(1)}/10
                                </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                    className={`h-full ${tone} transition-all`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            <div className="mt-1.5 space-y-1 text-xs text-text-secondary">
                                <div>
                                    <span className="font-medium text-text-primary">Evidence:</span>{' '}
                                    <span className="italic">"{layer.evidence}"</span>
                                </div>
                                <div>
                                    <span className="font-medium text-text-primary">Tip:</span>{' '}
                                    {layer.tip}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Talk-time stats */}
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                <div>
                    <div className="text-xs text-text-secondary">Rep talk ratio</div>
                    <div className="mt-0.5 text-lg font-semibold text-text-primary">
                        {Math.round(report.rep_talk_ratio * 100)}%
                    </div>
                    <div className="text-[10px] text-text-tertiary">
                        {report.rep_talk_ratio > 0.7
                            ? 'Rep dominated'
                            : report.rep_talk_ratio < 0.4
                            ? 'Rep too quiet'
                            : 'Healthy balance'}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-text-secondary">Avg rep monologue</div>
                    <div className="mt-0.5 text-lg font-semibold text-text-primary">
                        {report.avg_rep_talk_seconds.toFixed(1)}s
                    </div>
                    <div className="text-[10px] text-text-tertiary">
                        {report.avg_rep_talk_seconds > 45
                            ? 'Try shorter turns'
                            : report.avg_rep_talk_seconds < 12
                            ? 'Could develop points more'
                            : 'Good turn length'}
                    </div>
                </div>
            </div>
        </div>
    );
}

function CoachingLists({ report }: { report: CoachingReport }) {
    return (
        <div className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-5">
            <h4 className="mb-3 text-sm font-semibold text-text-primary">
                What the rep did right
            </h4>
            <ul className="mb-5 space-y-1.5">
                {report.did_right.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        {item}
                    </li>
                ))}
            </ul>

            <h4 className="mb-3 text-sm font-semibold text-text-primary">What they missed</h4>
            <ul className="mb-5 space-y-1.5">
                {report.missed.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        {item}
                    </li>
                ))}
            </ul>

            <h4 className="mb-3 text-sm font-semibold text-text-primary">Could be better</h4>
            <ul className="mb-5 space-y-1.5">
                {report.could_improve.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        {item}
                    </li>
                ))}
            </ul>

            <div className="rounded-[var(--radius-md)] border border-primary/20 bg-primary/5 p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Next call focus
                </div>
                <div className="text-sm text-text-primary">{report.next_call_focus}</div>
            </div>
        </div>
    );
}

function TranscriptView({ segments }: { segments: TranscriptSegment[] }) {
    return (
        <div className="max-h-96 space-y-2 overflow-y-auto rounded-[var(--radius-md)] bg-slate-50 p-3 min-w-0">
            {segments.map((seg, i) => (
                <div key={i} className="text-sm break-words">
                    <span className="mr-2 font-mono text-xs text-text-tertiary">
                        {formatTime(seg.start)}
                    </span>
                    <span
                        className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            seg.speaker === 'rep'
                                ? 'bg-primary/10 text-primary'
                                : seg.speaker === 'client'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-200 text-slate-700'
                        }`}
                    >
                        {seg.speaker}
                    </span>
                    <span className="text-text-primary">{seg.text}</span>
                </div>
            ))}
        </div>
    );
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDuration(seconds: number | null | undefined): string {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Helper used by parent components
export function trendIcon(direction: 'improving' | 'flat' | 'declining' | 'insufficient_data') {
    switch (direction) {
        case 'improving':
            return <TrendingUp className="h-4 w-4 text-emerald-500" />;
        case 'declining':
            return <TrendingDown className="h-4 w-4 text-red-500" />;
        case 'flat':
            return <Minus className="h-4 w-4 text-slate-500" />;
        default:
            return <Minus className="h-4 w-4 text-text-tertiary" />;
    }
}
