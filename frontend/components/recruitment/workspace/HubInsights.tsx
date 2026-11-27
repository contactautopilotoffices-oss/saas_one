'use client';

import React from 'react';
import HubBars from './HubBars';
import type { RecruitmentDashboard } from '@/backend/lib/candidates/types';
import { conversions, GLASS, H2, INK2, INK3, plural, stageFill, TRACK } from './hub-ui';

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

    const interviewed = data.funnel.find(f => /interview/i.test(f.column))?.count;
    const late = data.roles.filter(r => r.ageing).length;
    const maxAge = Math.max(1, ...data.roles.map(r => Math.max(r.daysOpen, r.targetDays)));
    const tiles = [
        { value: data.activeCandidates, label: 'Active candidates', activity: data.activity?.candidateMoves, activityLabel: 'Current active applications by day of last stage change', note: `Across ${plural(data.roles.length, 'open role', 'open roles')}` },
        { value: interviewed ?? '—', label: 'In interview stage', note: 'Current pipeline' },
        { value: data.roles.length, label: 'Open roles', activity: data.activity?.openings, activityLabel: 'Current open roles created per day over the last seven days', note: `${late} past target` },
    ] as const;
    let angle = 0;
    const ring: string[] = [];
    for (const [i, source] of data.sources.entries()) {
        const end = angle + source.count / sourceTotal * 360;
        ring.push(`${stageFill(i)[0]} ${angle}deg ${end}deg`);
        angle = end;
    }
    return (
        <div className="flex flex-col gap-4">
            <div role="group" aria-label="Key measures" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {tiles.map(t => (
                    <div key={t.label} className={`${GLASS} flex flex-col p-4`}>
                        <span className="mb-2 block text-sm font-extrabold">{t.label}</span>
                        <span className="flex items-end justify-between gap-2"><strong className="font-display text-4xl leading-tight tracking-tight tabular-nums">{t.value}</strong>{'activityLabel' in t && t.activityLabel && <HubBars values={t.activity} label={t.activityLabel} />}</span>
                        <span className={`block text-[13px] ${INK2}`}>{t.note}</span>
                    </div>
                ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
                <section aria-label="Where candidates come from" className={`${GLASS} min-w-0 flex-[1_1_340px] p-[22px]`}>
                    <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
                        <h2 className={`${H2} grow`}>Where candidates come from</h2>
                        <span className={`text-[13px] ${INK3}`}>{plural(sourceTotal, 'person', 'people')} in the open roles</span>
                    </div>
                    {sourceTotal === 0 ? <p className={`m-0 text-sm ${INK3}`}>Nobody is in a pipeline yet.</p> : (
                        <div className="flex flex-wrap items-center gap-4">
                            <div aria-hidden className="grid size-28 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${ring})` }}>
                                <div className="grid size-[76px] content-center rounded-full bg-surface text-center"><strong className="text-xl">{sourceTotal}</strong><span className={`text-[10px] ${INK3}`}>candidates</span></div>
                            </div>
                            <ul className="m-0 flex min-w-[130px] flex-1 list-none flex-col gap-2 p-0 text-xs">
                                {data.sources.map((s, i) => (
                                    <li key={s.source} className="flex items-center gap-2.5">
                                        <span aria-hidden className="h-3 w-3 shrink-0 rounded" style={{ background: stageFill(i)[0] }} />
                                        <span className="grow truncate font-semibold" title={s.source}>{s.source}</span>
                                        <span className="font-extrabold tabular-nums">{s.count}</span>
                                        <span className={`w-10 text-right text-xs tabular-nums ${INK3}`}>{Math.round((s.count / sourceTotal) * 100)}%</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
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
                <section aria-label="Days to hire" className={`${GLASS} min-w-0 p-5`}>
                    <h2 className={H2}>Days to hire</h2>
                    <p className={`mb-3 text-xs ${INK3}`}>Days open against each role’s target{avgTarget ? ` · average target ${avgTarget} days` : ''}</p>
                    {!data.roles.length && <p className={`text-sm ${INK3}`}>No open roles.</p>}
                    {data.roles.slice(0, 5).map(role => <div key={role.id} className="mb-3">
                        <div className="mb-1 flex justify-between gap-1 text-xs font-bold"><span>{role.title}</span><span className={`shrink-0 ${role.ageing ? 'text-error' : 'text-primary'}`}>{role.daysOpen}d / {role.targetDays}d</span></div>
                        <div className={`relative h-2 rounded-full ${TRACK}`}>
                            <div className={`h-full rounded-full ${role.ageing ? 'bg-red-500' : 'bg-indigo-600'}`} style={{ width: `${role.daysOpen / maxAge * 100}%` }} />
                            <span aria-hidden className="absolute -top-0.5 h-3 w-px bg-current" style={{ left: `min(calc(100% - 1px), ${role.targetDays / maxAge * 100}%)` }} />
                        </div>
                    </div>)}
                </section>
            </div>

            {m && <details className={`${GLASS} px-5 py-3`}>
                <summary className="cursor-pointer text-sm font-bold">More hiring metrics</summary>
                <p className={`mt-3 text-sm ${INK2}`}>Last {m.periodDays} days · Average time to fill {m.timeToFill.days ?? '—'} days · Offer acceptance {m.offerAcceptance.ratePct == null ? '—' : `${m.offerAcceptance.ratePct}%`} · Request approval {hours(m.approvalTurnaround.requisitionHours)} · Offer approval {hours(m.approvalTurnaround.offerHours)}</p>
                <div className="mt-3 flex flex-wrap items-stretch gap-4">
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
                                        <div className={`h-2 rounded ${TRACK}`}><div className="h-2 rounded bg-[#353535]" style={{ width: `${(r.inPipeline / loadMax) * 100}%` }} /></div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <p className={`mb-0 mt-3 text-xs ${INK3}`}>The bar is the people in each recruiter&apos;s pipelines.</p>
                    </section>
                </div>
            </details>}
        </div>
    );
}
