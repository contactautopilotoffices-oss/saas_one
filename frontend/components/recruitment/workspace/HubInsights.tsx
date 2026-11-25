'use client';

import React from 'react';
import type { RecruitmentDashboard } from '@/backend/lib/candidates/types';
import { conversions, GLASS, H2, INK2, INK3, plural, stageFill, TONE, TRACK, type Tone } from './hub-ui';

/*
 * The Hub's Insights tab (owner 2026-11-25, design "21 · Hub"): how hiring is going. Where today's pipeline came from,
 * the share who move from stage to stage across all open roles, days to hire, offer acceptance, approval times,
 * rejection reasons and each recruiter's load. Measures over time are the recruitment dashboard's last 90 days.
 */

const hours = (h: number | null) => (h === null ? '—' : h >= 48 ? `${Math.round((h / 24) * 10) / 10} days` : `${h} h`);

export default function HubInsights({ data }: { data: RecruitmentDashboard }) {
    const m = data.metrics;
    const columns = data.funnel.map(f => f.column);
    const conv = conversions(columns, data.funnel.map(f => f.count), data.funnel.map(f => f.rejected));
    const sourceTotal = data.sources.reduce((n, s) => n + s.count, 0);
    const targets = data.roles.map(r => r.targetDays);
    const avgTarget = targets.length ? Math.round(targets.reduce((a, b) => a + b, 0) / targets.length) : null;
    const reasonMax = Math.max(1, ...(m?.rejectionReasons ?? []).map(r => r.count));
    const loadMax = Math.max(1, ...(m?.recruiterLoad ?? []).map(r => r.inPipeline));

    const tiles: Array<{ value: string; label: string; note: string; tone: Tone }> = [
        {
            value: m?.timeToFill.days == null ? '—' : String(m.timeToFill.days),
            label: 'Days to hire',
            note: m?.timeToFill.days == null ? 'No accepted offer in this time' : `Average of ${plural(m.timeToFill.offers, 'offer', 'offers')}${avgTarget ? ` · target ${avgTarget}` : ''}`,
            tone: m?.timeToFill.days != null && avgTarget && m.timeToFill.days > avgTarget ? 'c' : 'v',
        },
        {
            value: m?.offerAcceptance.ratePct == null ? '—' : `${m.offerAcceptance.ratePct}%`,
            label: 'Offers accepted',
            note: m ? `${m.offerAcceptance.accepted} accepted · ${m.offerAcceptance.declined} declined · ${m.offerAcceptance.waiting} waiting` : 'Not available',
            tone: 'p',
        },
        {
            value: hours(m?.approvalTurnaround.requisitionHours ?? null),
            label: 'Hiring request approval',
            note: m ? `Submit to decision · ${plural(m.approvalTurnaround.requisitions, 'request', 'requests')}` : 'Not available',
            tone: 'b',
        },
        {
            value: hours(m?.approvalTurnaround.offerHours ?? null),
            label: 'Offer approval',
            note: m ? `Proposal to final approval · ${plural(m.approvalTurnaround.offers, 'offer', 'offers')}` : 'Not available',
            tone: 'a',
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div role="group" aria-label="Key measures" className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                {tiles.map(t => (
                    <div key={t.label} className={`${GLASS} flex flex-col p-4`}>
                        <span className={`self-start rounded-full px-3 py-1 font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] tabular-nums ${TONE[t.tone]}`}>{t.value}</span>
                        <span className="mt-2.5 block font-extrabold">{t.label}</span>
                        <span className={`block text-[13px] ${INK2}`}>{t.note}</span>
                    </div>
                ))}
            </div>
            {m && <p className={`-mt-1 mb-0 text-xs ${INK3}`}>These four are over the last {m.periodDays} days.</p>}

            <div className="flex flex-wrap items-stretch gap-4">
                <section aria-label="Where candidates come from" className={`${GLASS} min-w-0 flex-[1_1_340px] p-[22px]`}>
                    <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
                        <h2 className={`${H2} grow`}>Where candidates come from</h2>
                        <span className={`text-[13px] ${INK3}`}>{plural(sourceTotal, 'person', 'people')} in the open roles</span>
                    </div>
                    {sourceTotal === 0 ? <p className={`m-0 text-sm ${INK3}`}>Nobody is in a pipeline yet.</p> : (
                        <>
                            <div aria-hidden className="mb-4 flex h-3.5 overflow-hidden rounded-full">
                                {data.sources.map((s, i) => <span key={s.source} style={{ flex: `${s.count} 1 0`, background: stageFill(i)[0] }} />)}
                            </div>
                            <ul className="m-0 flex list-none flex-col gap-2 p-0">
                                {data.sources.map((s, i) => (
                                    <li key={s.source} className="flex items-center gap-2.5">
                                        <span aria-hidden className="h-3 w-3 shrink-0 rounded" style={{ background: stageFill(i)[0] }} />
                                        <span className="grow truncate font-semibold" title={s.source}>{s.source}</span>
                                        <span className="font-extrabold tabular-nums">{s.count}</span>
                                        <span className={`w-10 text-right text-xs tabular-nums ${INK3}`}>{Math.round((s.count / sourceTotal) * 100)}%</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </section>

                <section aria-label="Stage to stage" className={`${GLASS} min-w-0 flex-[1.2_1_380px] p-[22px]`}>
                    <div className="mb-1 flex flex-wrap items-baseline gap-2.5"><h2 className={`${H2} grow`}>Stage to stage</h2></div>
                    <p className={`mb-3 mt-0 text-[13px] ${INK3}`}>Share of people who move on, all open roles</p>
                    {conv.length === 0 ? <p className={`m-0 text-sm ${INK3}`}>The board needs at least two stages.</p> : (
                        <div className="flex flex-col gap-3">
                            {conv.map((c, i) => (
                                <div key={`${c.from}-${c.to}`}>
                                    <div className="mb-1 flex gap-2 text-sm"><span className="grow truncate font-semibold">{c.from} <span className={INK3}>to</span> {c.to}</span><span className="font-extrabold tabular-nums">{c.pct === null ? '—' : `${c.pct}%`}</span></div>
                                    <div className={`h-2 rounded ${TRACK}`}><div className="h-2 rounded" style={{ width: `${c.pct ?? 0}%`, background: stageFill(i + 1)[0] }} /></div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {m && (
                <div className="flex flex-wrap items-stretch gap-4">
                    <section aria-label="Rejection reasons" className={`${GLASS} min-w-0 flex-[1_1_340px] p-[22px]`}>
                        <div className="mb-3 flex flex-wrap items-baseline gap-2.5"><h2 className={`${H2} grow`}>Why people were rejected</h2><span className={`text-[13px] ${INK3}`}>Last {m.periodDays} days</span></div>
                        {m.rejectionReasons.length === 0 ? <p className={`m-0 text-sm ${INK3}`}>No rejections in this time.</p> : (
                            <div className="flex flex-col gap-2.5">
                                {m.rejectionReasons.slice(0, 6).map(r => (
                                    <div key={r.reason}>
                                        <div className="mb-1 flex gap-2 text-sm"><span className="grow truncate font-semibold" title={r.reason}>{r.reason}</span><span className="font-extrabold tabular-nums">{r.count}</span></div>
                                        <div className={`h-2 rounded ${TRACK}`}><div className="h-2 rounded bg-[#f87171]" style={{ width: `${(r.count / reasonMax) * 100}%` }} /></div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section aria-label="Recruiter load" className={`${GLASS} min-w-0 flex-[1_1_340px] p-[22px]`}>
                        <div className="mb-3 flex flex-wrap items-baseline gap-2.5"><h2 className={`${H2} grow`}>Recruiter load</h2><span className={`text-[13px] ${INK3}`}>Open roles today</span></div>
                        {m.recruiterLoad.length === 0 ? <p className={`m-0 text-sm ${INK3}`}>No open roles.</p> : (
                            <div className="flex flex-col gap-2.5">
                                {m.recruiterLoad.map(r => (
                                    <div key={r.recruiter}>
                                        <div className="mb-1 flex gap-2 text-sm">
                                            <span className="grow truncate font-semibold">{r.recruiter}</span>
                                            <span className={`text-xs ${INK3}`}>{plural(r.openRoles, 'role', 'roles')}{r.ageing ? ` · ${r.ageing} late` : ''}</span>
                                            <span className="font-extrabold tabular-nums">{r.inPipeline}</span>
                                        </div>
                                        <div className={`h-2 rounded ${TRACK}`}><div className="h-2 rounded bg-[#4f46e5]" style={{ width: `${(r.inPipeline / loadMax) * 100}%` }} /></div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <p className={`mb-0 mt-3 text-xs ${INK3}`}>The bar is the people in each recruiter&apos;s pipelines.</p>
                    </section>
                </div>
            )}
        </div>
    );
}
