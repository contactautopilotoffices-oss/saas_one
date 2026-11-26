'use client';

import React, { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { ScreeningView } from '@/backend/lib/candidates/screening';
import type { ApplicationField } from '@/backend/lib/candidates/outreach-settings';
import type { CandidateRecord } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate } from './format';
import { BTN_GHOST, LABEL, Tag, WELL } from './ui';

/*
 * The screening screen (owner 2026-11-24, 23 Nov meeting: "on the HR screen the JD and questionnaire should be shown,
 * with a button to record the call"). For each position the candidate is in: the job description, HR's screening
 * questions, and the candidate's answers once they reply to the WhatsApp. The call itself: record it on your phone and
 * upload it just below (option A; a calling service that records on its own comes later).
 */

const STATUS: Record<NonNullable<ScreeningView['screening']>['status'], { label: string; tone: 'info' | 'success' | 'warn' | 'neutral' }> = {
    sending: { label: 'Sending', tone: 'info' }, sent: { label: 'Waiting for answers', tone: 'info' }, failed: { label: 'Not sent', tone: 'warn' },
    answered: { label: 'Answered', tone: 'success' }, no_response: { label: 'No response', tone: 'neutral' },
};

export default function ScreeningPanel({ orgId, record, onChanged }: { orgId: string; record: CandidateRecord; onChanged?: () => void }) {
    const [data, setData] = useState<{ candidateId: string; questions: ApplicationField[]; views: ScreeningView[] } | null>(null);
    const [positionId, setPositionId] = useState('');
    const [showJd, setShowJd] = useState(false);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ questions: ApplicationField[]; views: ScreeningView[] }>(`/api/candidates/screening${qs({ orgId, candidateId: record.candidateId })}`, { signal: ctrl.signal }).then(res => {
            if (!ctrl.signal.aborted && res.ok) setData({ candidateId: record.candidateId, ...res.data });
        });
        return () => ctrl.abort();
    }, [orgId, record.candidateId]);
    const d = data?.candidateId === record.candidateId ? data : null;
    if (!d || !d.views.length) return null;
    const view = d.views.find(v => v.positionId === positionId) ?? d.views[0];
    const s = view.screening;
    return (
        <section className={`${WELL} space-y-3 px-4 py-3`} aria-label="Screening">
            <div className="flex flex-wrap items-center gap-2">
                <ClipboardList className="h-4 w-4 text-text-secondary" aria-hidden />
                <h3 className="text-sm font-semibold text-text-primary">Screening call</h3>
                {d.views.length > 1 ? (
                    <select aria-label="Position" value={view.positionId} onChange={e => { setPositionId(e.target.value); setShowJd(false); }} className="h-8 rounded-lg border border-border bg-surface px-2 text-sm">
                        {d.views.map(v => <option key={v.positionId} value={v.positionId}>{v.positionTitle}</option>)}
                    </select>
                ) : <span className="text-sm text-text-secondary">{view.positionTitle}</span>}
                {s && <Tag tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Tag>}
            </div>
            {s?.status === 'failed' && s.error && <p className="text-xs text-warning">{s.error}</p>}
            {s?.sentAt && <p className="text-xs text-text-tertiary">Sent {formatDate(s.sentAt)}{s.sentByName ? ` by ${s.sentByName}` : ''}{s.answeredAt ? ` · answered ${formatDate(s.answeredAt)}` : ''}</p>}

            <div>
                <p className={LABEL}>{s?.status === 'answered' ? 'Their answers' : 'Ask on the call'}</p>
                <ol className="mt-1 space-y-1.5 text-sm">
                    {(view.questions ?? d.questions).map((q, i) => {
                        const a = s?.answers?.[q.id];
                        return (
                            <li key={q.id} className="flex gap-2">
                                <span className="tabular-nums text-text-tertiary">{i + 1}.</span>
                                <span className="min-w-0 flex-1"><span className="text-text-primary">{q.label}</span>{a !== undefined && a !== null && a !== '' && <span className="block font-semibold text-text-primary">{String(a)}</span>}</span>
                            </li>
                        );
                    })}
                </ol>
            </div>
            {view.jd && (
                <div>
                    <button type="button" onClick={() => setShowJd(v => !v)} className={`${BTN_GHOST} h-7 px-0 text-sm`}>{showJd ? 'Hide the job description' : 'Show the job description'}</button>
                    {showJd && <p className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{view.jd}</p>}
                </div>
            )}
            <p className="text-xs text-text-secondary">Record the call on your phone (its call recorder), then upload it below: the transcript, sentiment and the facts heard come back here.</p>
        </section>
    );
}
