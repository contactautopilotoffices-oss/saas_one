'use client';

import React, { useState, useEffect } from 'react';
import { Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface SLALiveTimerProps {
    slaDueAt: string | null;
    status: string;
    compact?: boolean;
}

export default function SLALiveTimer({ slaDueAt, status, compact = false }: SLALiveTimerProps) {
    const [timeLeft, setTimeLeft] = useState<{
        days: number;
        hours: number;
        minutes: number;
        seconds: number;
        isOverdue: boolean;
    } | null>(null);

    const isResolvedOrClosed = status === 'resolved' || status === 'closed';

    useEffect(() => {
        if (!slaDueAt || isResolvedOrClosed) return;

        const updateTimer = () => {
            const dueTime = new Date(slaDueAt).getTime();
            const now = Date.now();
            const diff = dueTime - now;

            const isOverdue = diff <= 0;
            const absDiff = Math.abs(diff);

            const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((absDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((absDiff % (1000 * 60)) / 1000);

            setTimeLeft({ days, hours, minutes, seconds, isOverdue });
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);

        return () => clearInterval(interval);
    }, [slaDueAt, isResolvedOrClosed]);

    if (isResolvedOrClosed) {
        return (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-3 h-3" />
                Resolved
            </span>
        );
    }

    if (!slaDueAt || !timeLeft) {
        return <span className="text-[10px] text-slate-400 italic">No SLA set</span>;
    }

    const { days, hours, minutes, seconds, isOverdue } = timeLeft;

    const timeStr = `${days > 0 ? `${days}d ` : ''}${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;

    if (isOverdue) {
        return (
            <span className={`inline-flex items-center gap-1 font-bold text-[10px] px-2 py-0.5 rounded-lg border bg-red-50 dark:bg-red-950/60 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 animate-pulse ${compact ? 'text-[10px]' : ''}`}>
                <AlertTriangle className="w-3 h-3 shrink-0 text-red-600" />
                <span>Overdue by {timeStr}</span>
            </span>
        );
    }

    if (days === 0 && hours < 4) {
        return (
            <span className="inline-flex items-center gap-1 font-bold text-[10px] px-2 py-0.5 rounded-lg border bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400">
                <Clock className="w-3 h-3 shrink-0 text-red-500 animate-spin" />
                <span>{timeStr} left</span>
            </span>
        );
    }

    if (days === 0) {
        return (
            <span className="inline-flex items-center gap-1 font-semibold text-[10px] px-2 py-0.5 rounded-lg border bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
                <Clock className="w-3 h-3 shrink-0 text-amber-500" />
                <span>{timeStr} left</span>
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1 font-medium text-[10px] px-2 py-0.5 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
            <Clock className="w-3 h-3 shrink-0 text-indigo-500" />
            <span>{timeStr} left</span>
        </span>
    );
}
