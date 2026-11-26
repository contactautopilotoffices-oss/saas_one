'use client';

import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import type { HmPosition } from '@/backend/lib/candidates/hiring-manager';
import { api, qs } from '@/frontend/components/candidates/api';
import { formatDate } from '@/frontend/components/candidates/format';
import { CARD, Tag, WELL } from '@/frontend/components/candidates/ui';

/*
 * Owner 2026-11-24 (product safety): on the Hiring requests page, the candidates for the roles you asked for (or head):
 * where each one stands, the interviews, the panel's scorecards and their assignment. No salary figures and no AI
 * score: HR keeps those, so your view of the candidate stays your own.
 */
const REC: Record<string, string> = { proceed: 'Proceed', hold: 'Hold', reject: 'Reject' };

export default function HiringManagerCandidates({ orgId }: { orgId: string }) {
    const [positions, setPositions] = useState<HmPosition[] | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ positions: HmPosition[] }>(`/api/recruitment/hiring-manager${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted) setPositions(res.ok ? res.data.positions : []); });
        return () => ctrl.abort();
    }, [orgId]);
    if (!positions?.length) return null;
    return (
        <section className="mt-6 space-y-3" aria-label="Candidates for your roles">
            <div>
                <h2 className="flex items-center gap-2 font-display text-base font-semibold text-text-primary"><Users className="h-4 w-4" aria-hidden />Candidates for your roles</h2>
                <p className="text-xs text-text-secondary">Where each candidate stands, the interviews, the panel&rsquo;s scorecards and their assignment. Salary figures stay with HR.</p>
            </div>
            {positions.map(p => (
                <div key={p.id} className={`${CARD} space-y-2 px-4 py-3`}>
                    <p className="text-sm font-semibold text-text-primary">{p.title}<span className="font-normal text-text-secondary">{[p.requisitionNo, p.location].filter(Boolean).map(x => ` · ${x}`).join('')}</span> <Tag tone={p.status === 'open' ? 'info' : 'neutral'}>{p.status === 'open' ? 'Open' : 'Closed'}</Tag></p>
                    {!p.candidates.length && <p className="text-sm text-text-secondary">No candidates in this role yet.</p>}
                    {p.candidates.map(c => (
                        <details key={c.memberId} className={`${WELL} px-3 py-2`}>
                            <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                <span className="font-semibold text-text-primary">{c.name}</span>
                                <Tag tone="info">{c.stageName}</Tag>
                                <span className="text-xs text-text-secondary">{[c.currentDesignation, c.currentOrganization].filter(Boolean).join(' at ')}{c.totalExpYears != null ? ` · ${c.totalExpYears} yrs` : ''}</span>
                            </summary>
                            <div className="mt-2 space-y-2 text-sm">
                                <p className="text-xs text-text-secondary">{[c.location, c.noticePeriodDays != null ? `${c.noticePeriodDays} days' notice` : null].filter(Boolean).join(' · ')}</p>
                                {c.interviews.map((iv, k) => (
                                    <div key={k}>
                                        <p className="font-medium text-text-primary">{iv.round ?? 'Interview'} · {formatDate(iv.at)} · {iv.status}</p>
                                        {iv.scorecards.map((s, j) => <p key={j} className="text-xs text-text-secondary">{s.panelName ?? 'Panel'}: {s.overall ?? '—'}/5 · {s.recommendation ? REC[s.recommendation] ?? s.recommendation : '—'}{s.comments ? ` · “${s.comments}”` : ''}</p>)}
                                    </div>
                                ))}
                                {c.assignment && (
                                    <p className="text-xs text-text-secondary">Assignment “{c.assignment.title}”: {c.assignment.status === 'submitted' ? `submitted ${c.assignment.submittedAt ? formatDate(c.assignment.submittedAt) : ''}` : 'waiting'}
                                        {c.assignment.submissionLink && <> · <a href={c.assignment.submissionLink} target="_blank" rel="noopener noreferrer" className="text-primary underline">their work</a></>}</p>
                                )}
                            </div>
                        </details>
                    ))}
                </div>
            ))}
        </section>
    );
}
