'use client';

import React, { useEffect, useState } from 'react';
import {
    Sparkles, Loader2, TrendingUp, TrendingDown, Minus,
    Mic, Award, AlertCircle, ChevronRight, Users,
} from 'lucide-react';
import {
    CoachingOverview, RepTrend, COACHING_LAYER_KEYS,
    COACHING_LAYER_LABELS, CoachingLayerKey,
} from '@/frontend/types/crm';
import CoachingTrendChart from '@/frontend/components/crm/CoachingTrendChart';

export default function CoachingPage() {
    const [data, setData] = useState<CoachingOverview | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
    const [selectedTrend, setSelectedTrend] = useState<RepTrend | null>(null);
    const [isLoadingRep, setIsLoadingRep] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/crm/coaching/overview?window=20', { cache: 'no-store' });
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error(j.error || `HTTP ${res.status}`);
                }
                const json: CoachingOverview = await res.json();
                if (cancelled) return;
                setData(json);
                if (json.reps.length > 0) setSelectedRepId(json.reps[0].bdRepId);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // When a rep is selected, fetch their full trend (in case overview window differs).
    useEffect(() => {
        if (!selectedRepId) {
            setSelectedTrend(null);
            return;
        }
        let cancelled = false;
        setIsLoadingRep(true);
        (async () => {
            const res = await fetch(`/api/crm/coaching/reps/${selectedRepId}?window=20`, { cache: 'no-store' });
            if (cancelled) return;
            if (res.ok) {
                const j = await res.json();
                if (!cancelled) setSelectedTrend(j.trend);
            }
            if (!cancelled) setIsLoadingRep(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedRepId]);

    if (isLoading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-error">
                <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
                <p className="mt-1 text-text-secondary">
                    Make sure you have admin access to this organization.
                </p>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="space-y-6">
            <Header totals={data.totals} />

            {data.reps.length === 0 ? (
                <EmptyState />
            ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
                    <RepLeaderboard
                        reps={data.reps}
                        selectedRepId={selectedRepId}
                        onSelect={setSelectedRepId}
                    />
                    <RepDetail trend={selectedTrend} isLoading={isLoadingRep} />
                </div>
            )}
        </div>
    );
}

function Header({ totals }: { totals: CoachingOverview['totals'] }) {
    return (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
                    <Sparkles className="h-6 w-6 text-primary" />
                    Call Coaching
                </h1>
                <p className="mt-1 text-sm text-text-secondary">
                    How your BD reps are doing across the 5 layers of a sales conversation — and whether they're getting better.
                </p>
            </div>
            <div className="flex gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3">
                    <div className="text-xs text-text-secondary">Calls analyzed</div>
                    <div className="mt-0.5 text-2xl font-bold text-text-primary">
                        {totals.callsAnalyzed}
                    </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3">
                    <div className="text-xs text-text-secondary">Org average</div>
                    <div className="mt-0.5 text-2xl font-bold text-text-primary">
                        {totals.avgOrgScore.toFixed(1)}
                        <span className="ml-1 text-sm font-normal text-text-secondary">/10</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function RepLeaderboard({
    reps, selectedRepId, onSelect,
}: {
    reps: RepTrend[];
    selectedRepId: string | null;
    onSelect: (id: string) => void;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                <Users className="h-4 w-4 text-text-secondary" />
                <h2 className="text-sm font-semibold text-text-primary">BD Reps</h2>
            </div>
            <div className="max-h-[640px] overflow-y-auto">
                {reps.map((rep) => {
                    const isSelected = rep.bdRepId === selectedRepId;
                    return (
                        <button
                            key={rep.bdRepId}
                            onClick={() => onSelect(rep.bdRepId)}
                            className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 p-3 text-left transition-colors hover:bg-slate-50 ${
                                isSelected ? 'bg-primary/5' : ''
                            }`}
                        >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div
                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                                        rep.avgOverallScore >= 7
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : rep.avgOverallScore >= 5
                                            ? 'bg-amber-100 text-amber-700'
                                            : 'bg-red-100 text-red-700'
                                    }`}
                                >
                                    <span className="text-sm font-bold">
                                        {rep.avgOverallScore.toFixed(1)}
                                    </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="truncate text-sm font-medium text-text-primary">
                                            {rep.bdRepName}
                                        </span>
                                        {rep.direction === 'improving' && (
                                            <TrendingUp className="h-3 w-3 shrink-0 text-emerald-500" />
                                        )}
                                        {rep.direction === 'declining' && (
                                            <TrendingDown className="h-3 w-3 shrink-0 text-red-500" />
                                        )}
                                        {rep.direction === 'flat' && (
                                            <Minus className="h-3 w-3 shrink-0 text-slate-500" />
                                        )}
                                    </div>
                                    <div className="text-xs text-text-secondary">
                                        {rep.callCount} call{rep.callCount === 1 ? '' : 's'} ·{' '}
                                        talk {Math.round(rep.avgRepTalkRatio * 100)}%
                                    </div>
                                </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-text-tertiary" />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function RepDetail({ trend, isLoading }: { trend: RepTrend | null; isLoading: boolean }) {
    if (isLoading) {
        return (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
        );
    }
    if (!trend) return null;

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-bold text-text-primary">
                            {trend.bdRepName}
                        </h2>
                        <p className="text-xs text-text-secondary">
                            {trend.callCount} analyzed call{trend.callCount === 1 ? '' : 's'} ·{' '}
                            avg talk ratio {Math.round(trend.avgRepTalkRatio * 100)}%
                        </p>
                    </div>
                    <div className="text-right">
                        <div className="text-3xl font-bold text-text-primary">
                            {trend.avgOverallScore.toFixed(1)}
                            <span className="text-base font-normal text-text-secondary">/10</span>
                        </div>
                        <div className="text-xs text-text-secondary">avg overall</div>
                    </div>
                </div>
                {trend.weakestLayer && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
                        <Award className="h-4 w-4 text-amber-600" />
                        <span className="text-text-primary">
                            Coaching target: <span className="font-semibold">{COACHING_LAYER_LABELS[trend.weakestLayer]}</span>{' '}
                            <span className="text-text-secondary">
                                (avg {trend.avgLayers[trend.weakestLayer].toFixed(1)}/10)
                            </span>
                        </span>
                    </div>
                )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">Score trend</h3>
                <CoachingTrendChart trend={trend} height={260} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">Layer averages</h3>
                <div className="space-y-2.5">
                    {COACHING_LAYER_KEYS.map((key) => {
                        const score = trend.avgLayers[key];
                        const pct = (score / 10) * 100;
                        const tone =
                            score >= 7 ? 'bg-emerald-500' :
                            score >= 5 ? 'bg-amber-500' :
                            'bg-red-500';
                        return (
                            <div key={key}>
                                <div className="mb-1 flex items-center justify-between text-sm">
                                    <span className="font-medium text-text-primary">
                                        {COACHING_LAYER_LABELS[key]}
                                    </span>
                                    <span className="font-semibold text-text-primary">
                                        {score.toFixed(1)}/10
                                    </span>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                    <div
                                        className={`h-full ${tone} transition-all`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {trend.history.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h3 className="mb-3 text-sm font-semibold text-text-primary">
                        Recent calls
                    </h3>
                    <div className="space-y-2">
                        {[...trend.history].reverse().slice(0, 8).map((p) => (
                            <div
                                key={p.callId}
                                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
                            >
                                <div>
                                    <div className="font-medium text-text-primary">
                                        {p.leadCompanyName || '—'}
                                    </div>
                                    <div className="text-xs text-text-secondary">
                                        {new Date(p.uploadedAt).toLocaleDateString(undefined, {
                                            month: 'short', day: 'numeric',
                                        })}{' '}
                                        · talk {Math.round(p.repTalkRatio * 100)}%
                                    </div>
                                </div>
                                <div className="text-lg font-bold text-text-primary">
                                    {p.overallScore.toFixed(1)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function EmptyState() {
    return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-16 text-center">
            <Mic className="h-10 w-10 text-text-tertiary" />
            <h3 className="mt-3 text-base font-semibold text-text-primary">
                No call recordings yet
            </h3>
            <p className="mt-1 max-w-md text-sm text-text-secondary">
                Once BD reps upload call recordings from lead pages, you'll see per-rep coaching
                trends and a leaderboard here. The first few calls seed the rubrics.
            </p>
        </div>
    );
}
