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
        return <span className="text-[10px] text-slate-400 italic">No TAT set</span>;
    }

    const { days, hours, minutes, seconds, isOverdue } = timeLeft;

    const timeStr = days > 0 
        ? `${days}d ${hours}h remaining`
        : hours > 0 
        ? `${hours}h ${minutes}m remaining`
        : `${minutes}m ${seconds}s remaining`;

    const overdueStr = days > 0
        ? `${days}d ${hours}h overdue`
        : `${hours}h ${minutes}m overdue`;

    if (isOverdue) {
        return (
            <span className={`inline-flex items-center gap-1 font-bold text-[10px] px-2.5 py-1 rounded-lg border bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 animate-pulse whitespace-nowrap ${compact ? 'text-[10px]' : ''}`}>
                <AlertTriangle className="w-3 h-3 shrink-0 text-rose-600" />
                <span>{overdueStr}</span>
            </span>
        );
    }

    if (days === 0 && hours < 4) {
        return (
            <span className="inline-flex items-center gap-1 font-bold text-[10px] px-2.5 py-1 rounded-lg border bg-rose-50/80 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 whitespace-nowrap">
                <Clock className="w-3 h-3 shrink-0 text-rose-500 animate-spin" />
                <span>{timeStr}</span>
            </span>
        );
    }

    if (days === 0) {
        return (
            <span className="inline-flex items-center gap-1 font-semibold text-[10px] px-2.5 py-1 rounded-lg border bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 whitespace-nowrap">
                <Clock className="w-3 h-3 shrink-0 text-amber-500" />
                <span>{timeStr}</span>
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1 font-semibold text-[10px] px-2.5 py-1 rounded-lg border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 whitespace-nowrap">
            <Clock className="w-3 h-3 shrink-0 text-[#587e85]" />
            <span>{timeStr}</span>
        </span>
    );
}
