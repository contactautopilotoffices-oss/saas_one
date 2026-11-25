'use client';

import React, { useEffect, useState } from 'react';
import { CalendarClock, Layers } from 'lucide-react';
import { findStage, unlistedStage } from '@/backend/lib/candidates/stage-list';
import { INTERVIEW_STATUS_LABELS, type Interview, type Position, type PositionMember } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { StageChip, useStages } from './stage-ui';
import { LABEL, Spinner, WELL } from './ui';

/*
 * Owner 2026-11-25: beside an email that is linked to a candidate, where that person stands: the positions they are in
 * with the stage in each, and their interviews (upcoming first). So HR can answer without leaving the email. Read-only;
 * it uses the same lists as the candidate's own panel.
 */

type Membership = { member: Omit<PositionMember, 'record'>; position: Pick<Position, 'id' | 'title' | 'location' | 'status'> };

/** "2026-11-21T11:00" (India time, as the form gave it) → "Sat 21 Nov, 11:00 am". */
function whenLocal(at: string): string {
    const [d, t = ''] = at.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh = 0, mm = 0] = t.split(':').map(Number);
    const date = new Date(Date.UTC(y, (m || 1) - 1, day || 1, hh, mm));
    return date.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

export default function EmailCandidateContext({ orgId, candidateId }: { orgId: string; candidateId: string }) {
    const stages = useStages(orgId)?.stages ?? [];
    const [data, setData] = useState<{ id: string; memberships: Membership[] | null; interviews: Interview[] | null; nowLocal: string } | null>(null);

    useEffect(() => {
        const ctrl = new AbortController();
        void Promise.all([
            api<{ memberships: Membership[] }>(`/api/candidates/${encodeURIComponent(candidateId)}/positions${qs({ orgId, by: 'candidate' })}`, { signal: ctrl.signal }),
            api<{ interviews: Interview[] }>(`/api/candidates/interviews${qs({ orgId, candidateId })}`, { signal: ctrl.signal }),
        ]).then(([m, iv]) => {
            if (ctrl.signal.aborted) return;
            // Now, in India time as the interviews are written ("2026-11-21T11:00"), to put the upcoming ones first.
            setData({ id: candidateId, memberships: m.ok ? m.data.memberships : null, interviews: iv.ok ? iv.data.interviews : null, nowLocal: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16) });
        });
        return () => ctrl.abort();
    }, [orgId, candidateId]);

    const loaded = data?.id === candidateId ? data : null;
    if (!loaded) return <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading the candidate</p>;
    if (!loaded.memberships && !loaded.interviews) return null;

    const todayLocal = loaded.nowLocal;
    const interviews = [...(loaded.interviews ?? [])].filter(i => i.status !== 'cancelled')
        .sort((a, b) => Number(b.at >= todayLocal) - Number(a.at >= todayLocal) || (a.at >= todayLocal ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)))
        .slice(0, 4);

    return (
        <section aria-label="This candidate" className={`${WELL} grid gap-4 px-3 py-3 sm:grid-cols-2`}>
            <div className="min-w-0">
                <p className={`${LABEL} mb-1.5 flex items-center gap-1.5`}><Layers className="h-3.5 w-3.5" aria-hidden />Applied for</p>
                {loaded.memberships?.length ? (
                    <ul className="space-y-1.5">
                        {loaded.memberships.map(({ member, position }) => (
                            <li key={member.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="min-w-0 truncate text-sm font-semibold text-text-primary">{position.title}{position.status === 'closed' ? <span className="font-normal text-text-tertiary"> · closed</span> : null}</span>
                                <StageChip stage={findStage(stages, member.stage) ?? unlistedStage(member.stage)} />
                            </li>
                        ))}
                    </ul>
                ) : <p className="text-sm text-text-tertiary">Not in any position yet.</p>}
            </div>
            <div className="min-w-0">
                <p className={`${LABEL} mb-1.5 flex items-center gap-1.5`}><CalendarClock className="h-3.5 w-3.5" aria-hidden />Interviews</p>
                {interviews.length ? (
                    <ul className="space-y-1.5">
                        {interviews.map(i => (
                            <li key={i.id} className="min-w-0 text-sm">
                                <span className="font-semibold text-text-primary">{i.round ?? 'Interview'}</span>
                                <span className="text-text-secondary"> · {whenLocal(i.at)}{i.status && i.status !== 'scheduled' ? ` · ${INTERVIEW_STATUS_LABELS[i.status]}` : ''}</span>
                                {i.positionTitle && <span className="block truncate text-xs text-text-tertiary">{i.positionTitle}</span>}
                            </li>
                        ))}
                    </ul>
                ) : <p className="text-sm text-text-tertiary">No interviews booked.</p>}
            </div>
        </section>
    );
}
