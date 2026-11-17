'use client';

import React, { useEffect, useState } from 'react';
import { daysSince, RESUME_REMIND_AFTER_DAYS } from '@/backend/lib/candidates/resume-pick';
import type { ResumeSummary } from '@/backend/lib/candidates/types';
import { api, qs } from './api';

/**
 * A small "N d" tag next to Candidate Search in the HR sidebar (owner 2026-11-10, phase 3) when the signed-in person
 * has not uploaded resumes for RESUME_REMIND_AFTER_DAYS days. Owner 2026-11-11: uploads are filed under the person's
 * name, which the server takes from the login and sends back with the totals, so nothing is read from this browser.
 * For someone who never uploaded, nothing shows. The answer is kept for half an hour per tab and organisation, so
 * the sidebar does not call the server on every page.
 */
const CACHE_KEY = 'cand-resume-reminder';
const CACHE_MS = 30 * 60 * 1000;

type Cached = { at: number; days: number | null; who: string | null; orgId: string };

function readCache(orgId: string): Cached | null {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        const c = raw ? (JSON.parse(raw) as Cached) : null;
        return c && c.orgId === orgId && Date.now() - c.at < CACHE_MS ? c : null;
    } catch {
        return null;
    }
}

export default function ResumeReminderBadge({ orgId }: { orgId: string }) {
    const [state, setState] = useState<{ days: number | null; who: string | null }>(() => {
        const cached = orgId ? readCache(orgId) : null;
        return { days: cached?.days ?? null, who: cached?.who ?? null };
    });

    useEffect(() => {
        if (!orgId || readCache(orgId)) return;
        const ctrl = new AbortController();
        void api<ResumeSummary>(`/api/candidates/resumes/summary${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted || !res.ok) return;
            const who = res.data.uploader ?? null;
            const mine = who ? res.data.devices.find(d => d.label === who) : null;
            const days = mine?.lastUploadedAt ? daysSince(mine.lastUploadedAt) : null;
            try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), days, who, orgId } satisfies Cached)); } catch { /* ignore */ }
            setState({ days, who });
        });
        return () => ctrl.abort();
    }, [orgId]);

    if (state.days === null || state.days < RESUME_REMIND_AFTER_DAYS) return null;
    return (
        <span
            className="ml-auto shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            title={`You have not uploaded resumes for ${state.days} days`}
        >
            {state.days}d
        </span>
    );
}
