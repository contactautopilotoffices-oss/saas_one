'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, AlertTriangle, MessageSquareWarning, Loader2, Check } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

interface ReliabilityBadgeProps {
    /** User to show the score for. Omit to show the signed-in user's own score. */
    userId?: string;
    /** 'card' renders a standalone panel; 'inline' renders a compact pill. */
    variant?: 'card' | 'inline';
}

interface ReliabilityScore {
    user_id: string;
    score: number;
    strike_count: number;
    last_strike_at: string | null;
}

interface StrikeEvent {
    id: string;
    kind: string;
    note: string | null;
    created_at: string;
    is_overturned: boolean;
}

interface ContestRecord {
    id: string;
    event_id: string;
    status: 'open' | 'upheld' | 'overturned';
    reason: string;
    resolution_note: string | null;
}

/**
 * Employee reliability ("CIBIL") score badge — reads the employee_reliability_scores
 * view directly (RLS: the employee themself + electricity-access roles).
 * Renders nothing while the score is unavailable so it is safe to mount anywhere.
 */
export default function ReliabilityBadge({ userId, variant = 'card' }: ReliabilityBadgeProps) {
    const supabase = useMemo(() => createClient(), []);
    const [score, setScore] = useState<ReliabilityScore | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [viewerId, setViewerId] = useState<string | null>(null);
    const [strikes, setStrikes] = useState<StrikeEvent[]>([]);
    const [contests, setContests] = useState<ContestRecord[]>([]);

    const load = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        const targetId = userId || user?.id;
        setViewerId(user?.id ?? null);
        if (!targetId) { setIsLoading(false); return; }

        const { data, error } = await supabase
            .from('employee_reliability_scores')
            .select('user_id, score, strike_count, last_strike_at')
            .eq('user_id', targetId)
            .maybeSingle();

        if (error) {
            // View may not exist yet in some environments — fail quiet like other widgets.
            console.warn('ReliabilityBadge: score unavailable', error.message);
        } else {
            setScore(data);
        }

        // The individual strikes, so the subject can see WHAT they are being marked down
        // for and contest a specific one. A score with no itemisation is not contestable
        // in any meaningful sense (SPEC-ELECTRICITY.md REQ-E-06, condition 2).
        const { data: events } = await supabase
            .from('employee_reliability_events')
            .select('id, kind, note, created_at, is_overturned')
            .eq('user_id', targetId)
            .eq('kind', 'strike')
            .order('created_at', { ascending: false })
            .limit(20);
        setStrikes((events || []) as StrikeEvent[]);

        // Only the subject can see their own contest threads.
        if (user?.id && user.id === targetId) {
            const res = await fetch('/api/reliability/contests?scope=mine');
            const body = await res.json().catch(() => ({}));
            if (res.ok && Array.isArray(body.contests)) setContests(body.contests as ContestRecord[]);
        }

        setIsLoading(false);
    }, [supabase, userId]);

    useEffect(() => { void load(); }, [load]);

    if (isLoading) {
        return variant === 'card' ? (
            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl animate-pulse h-20" />
        ) : null;
    }

    // No events yet → clean 100 with zero strikes.
    const value = score?.score ?? 100;
    const strikeCount = score?.strike_count ?? 0;
    const tone = value >= 90 ? 'emerald' : value >= 70 ? 'amber' : 'rose';
    // Contesting is only ever offered to the person the record is about.
    const isOwnRecord = !!viewerId && (!userId || userId === viewerId);

    if (variant === 'inline') {
        return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border
                ${tone === 'emerald' ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                    : tone === 'amber' ? 'bg-amber-50 text-amber-600 border-amber-100'
                    : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                {strikeCount > 0 ? <AlertTriangle className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                Reliability {value}
            </span>
        );
    }

    return (
        <div className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center
                        ${tone === 'emerald' ? 'bg-emerald-50 text-emerald-600'
                            : tone === 'amber' ? 'bg-amber-50 text-amber-600'
                            : 'bg-rose-50 text-rose-600'}`}>
                        {strikeCount > 0 ? <AlertTriangle className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reliability Score</p>
                        <p className="text-2xl font-black text-slate-900">{value}<span className="text-sm text-slate-400 font-bold">/100</span></p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Strikes (12m)</p>
                    <p className={`text-2xl font-black ${strikeCount > 0 ? 'text-rose-500' : 'text-slate-900'}`}>{strikeCount}</p>
                </div>
            </div>
            {score?.last_strike_at && (
                <p className="mt-3 text-[11px] font-medium text-slate-400">
                    Last strike {new Date(score.last_strike_at).toLocaleDateString()}
                </p>
            )}

            {strikes.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        {isOwnRecord ? 'Your strikes' : 'Strike history'}
                    </p>
                    {strikes.map(s => (
                        <StrikeRow
                            key={s.id}
                            strike={s}
                            contest={contests.find(c => c.event_id === s.id)}
                            canContest={isOwnRecord}
                            onFiled={() => void load()}
                        />
                    ))}
                    {isOwnRecord && (
                        <p className="text-[10px] font-medium text-slate-400 pt-1 leading-relaxed">
                            If a strike is wrong — you were on leave, the site had no power, or the task was
                            never yours — contest it. A super admin reviews it, and an overturned strike stops
                            counting against your score.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

/** One strike, with its contest state and the action to challenge it. */
function StrikeRow({ strike, contest, canContest, onFiled }: {
    strike: StrikeEvent;
    contest?: ContestRecord;
    canContest: boolean;
    onFiled: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const submit = async () => {
        setSaving(true); setErr(null);
        try {
            const res = await fetch('/api/reliability/contests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event_id: strike.id, reason }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.error || 'Could not file the contest');
            setOpen(false); setReason('');
            onFiled();
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Could not file the contest');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={`rounded-xl border p-3 ${strike.is_overturned ? 'border-emerald-100 bg-emerald-50/40' : 'border-slate-100 bg-slate-50/60'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className={`text-[11px] font-bold ${strike.is_overturned ? 'text-emerald-700 line-through' : 'text-slate-700'}`}>
                        {strike.note || 'Reliability strike'}
                    </p>
                    <p className="text-[10px] font-medium text-slate-400">
                        {new Date(strike.created_at).toLocaleDateString()}
                    </p>
                </div>

                {strike.is_overturned ? (
                    <span className="flex items-center gap-1 text-[10px] font-black text-emerald-600 flex-shrink-0">
                        <Check className="w-3 h-3" /> Overturned
                    </span>
                ) : contest ? (
                    <span className={`text-[10px] font-black flex-shrink-0 ${
                        contest.status === 'open' ? 'text-amber-600' : 'text-slate-500'}`}>
                        {contest.status === 'open' ? 'Under review' : 'Upheld'}
                    </span>
                ) : canContest ? (
                    <button onClick={() => setOpen(o => !o)}
                        className="flex items-center gap-1 text-[10px] font-black text-blue-600 hover:text-blue-700 flex-shrink-0">
                        <MessageSquareWarning className="w-3 h-3" /> Contest
                    </button>
                ) : null}
            </div>

            {contest?.resolution_note && (
                <p className="mt-2 text-[10px] font-medium text-slate-500 italic">
                    Reviewer: {contest.resolution_note}
                </p>
            )}

            {open && (
                <div className="mt-3 space-y-2">
                    <textarea
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        rows={3}
                        placeholder="What actually happened? Anything relevant — leave, a site outage, the task belonged to someone else."
                        aria-label="Why this strike is wrong"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-[11px] font-medium text-slate-700 outline-none focus:border-blue-400 resize-y"
                    />
                    <div className="flex items-center gap-2">
                        <button onClick={() => void submit()} disabled={saving || reason.trim().length < 10}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold disabled:opacity-40 flex items-center gap-1.5">
                            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                            Submit for review
                        </button>
                        <button onClick={() => { setOpen(false); setErr(null); }}
                            className="text-[11px] font-bold text-slate-400 hover:text-slate-600">Cancel</button>
                    </div>
                    {reason.trim().length > 0 && reason.trim().length < 10 && (
                        <p className="text-[10px] font-medium text-slate-400">A sentence or two, please — at least 10 characters.</p>
                    )}
                    {err && <p className="text-[10px] font-bold text-rose-500">{err}</p>}
                </div>
            )}
        </div>
    );
}
