'use client';

import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { RecruitmentDashboard } from '@/backend/lib/candidates/types';
import type { RecruitmentView } from '@/frontend/components/candidates/CandidateSearchTab';
import { BTN, conversions, GLASS, H2, INK3, plural, ROW_HOVER, stageFill, TONE, TRACK, type Tone } from './hub-ui';

/*
 * The Hub's Pipeline tab (owner 2026-11-25, design "21 · Hub"): pick a role (or all of them) and see its people across
 * the board's columns, the share who moved from each column to the next, every role side by side, and the open roles
 * against their target days. Counts are today's, from the recruitment dashboard; nothing here changes a record.
 */

export default function HubPipeline({ data, onOpen }: { data: RecruitmentDashboard; onOpen: (view: RecruitmentView) => void }) {
    const [roleId, setRoleId] = useState<string>('all');
    const columns = data.funnel.map(f => f.column);
    const role = data.roles.find(r => r.id === roleId) ?? null;
    const counts = role ? role.byColumn : data.funnel.map(f => f.count);
    const rejected = role ? role.rejectedByColumn : data.funnel.map(f => f.rejected);
    const total = counts.reduce((n, c) => n + c, 0);
    const rejectedTotal = rejected.reduce((n, c) => n + c, 0);
    const conv = conversions(columns, counts, rejected);
    const allInPipeline = data.roles.reduce((n, r) => n + r.inPipeline, 0);

    const chips = [
        { id: 'all', label: 'All roles', sub: plural(data.roles.length, 'open role', 'open roles'), n: allInPipeline, color: '#5145e4' },
        ...data.roles.map(r => ({ id: r.id, label: r.title, sub: [r.location, r.recruiterName ?? 'No recruiter'].filter(Boolean).join(' · '), n: r.inPipeline, color: r.ageing ? '#f87171' : r.daysOpen >= r.targetDays * 0.8 ? '#f59e0b' : '#5145e4' })),
    ];

    const aging = data.roles.slice(0, 8);
    const maxDays = Math.max(1, ...aging.map(r => Math.max(r.daysOpen, r.targetDays)));

    if (columns.length === 0) {
        return <div className={`${GLASS} p-6 text-sm ${INK3}`}>The pipeline has no stages yet. Set them up under Settings.</div>;
    }

    return (
        <div className="flex flex-col gap-3">
            <div role="group" aria-label="Pick a role" className="flex gap-2.5 overflow-x-auto px-0.5 pb-1.5 pt-0.5">
                {chips.map(c => {
                    const on = c.id === roleId;
                    return (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => setRoleId(c.id)}
                            aria-pressed={on}
                            className={`flex min-h-14 shrink-0 items-center gap-3 rounded-[20px] border py-2 pl-2.5 pr-4 text-left backdrop-blur-[24px] transition-[transform,background-color,color] duration-300 hover:-translate-y-0.5 ${on
                                ? 'border-[#5145e4] bg-[#5145e4] text-white shadow-[0_12px_28px_rgba(53,53,53,.25)]'
                                : 'border-white/95 bg-white/65 dark:border-white/[.13] dark:bg-white/[.07]'}`}
                        >
                            <span aria-hidden className="h-[34px] w-2 shrink-0 rounded" style={{ background: on ? '#ffffff' : c.color }} />
                            <span className="leading-tight">
                                <span className="block max-w-[220px] truncate whitespace-nowrap font-extrabold">{c.label}</span>
                                <span className={`block max-w-[220px] truncate whitespace-nowrap text-xs ${on ? 'text-white/85' : INK3}`}>{c.sub}</span>
                            </span>
                            <span className="ml-1.5 text-xl font-extrabold tabular-nums">{c.n}</span>
                        </button>
                    );
                })}
            </div>

            <section aria-label="Pipeline flow" className={`${GLASS} px-[22px] py-5`}>
                <div className="mb-3 flex flex-wrap items-baseline gap-3">
                    <h2 className={`${H2} grow`}>Pipeline flow · {role ? role.title : 'All roles'}</h2>
                    <span className={`text-[13px] ${INK3}`}>{plural(total, 'person in the running', 'people in the running')}{rejectedTotal ? ` · ${rejectedTotal} rejected` : ''}</span>
                </div>
                {total + rejectedTotal === 0 ? (
                    <p className={`m-0 text-sm ${INK3}`}>Nobody in this pipeline yet.{role ? ' Search the database for people who fit the role.' : ''}</p>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <div className="flex min-w-[560px] gap-1.5">
                                {columns.map((name, i) => {
                                    const [bg, fg] = stageFill(i);
                                    return (
                                        <div key={name} className="flex h-[62px] min-w-0 flex-col justify-center rounded-[16px] px-3.5 py-2" style={{ flex: `${Math.max(1, counts[i])} 1 92px`, background: bg, color: fg }}>
                                            <div className="text-2xl font-extrabold leading-none tabular-nums">{counts[i]}</div>
                                            <div className="mt-1 truncate text-[13px] font-bold leading-tight" title={name}>{name}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="mt-3.5 flex flex-wrap gap-x-[18px] gap-y-2">
                            {conv.map(c => (
                                <span key={`${c.from}-${c.to}`} className={`text-[13px] ${INK3}`}>{c.from} to {c.to}: <b className="text-[#262626] dark:text-[#fafaf9]">{c.pct === null ? '—' : `${c.pct}%`}</b></span>
                            ))}
                        </div>
                        <p className={`mb-0 mt-2 text-xs ${INK3}`}>The share of people who reached a stage and went on to the next one, rejected people included.</p>
                    </>
                )}
                <div className="mt-4 flex flex-wrap gap-2.5">
                    <button type="button" onClick={() => onOpen('pipeline')} className={BTN}>Open the board<ArrowRight className="h-4 w-4" aria-hidden /></button>
                </div>
            </section>

            <div className="hub-split">
                <section aria-label="Hiring pipeline by role" className={`${GLASS} min-w-0 flex-[1.6_1_520px] p-[22px]`}>
                    <div className="mb-3.5 flex flex-wrap items-center gap-3">
                        <h2 className={`${H2} grow`}>Hiring pipeline by role</h2>
                        {columns.map((name, i) => (
                            <span key={name} className={`inline-flex items-center gap-1.5 text-xs font-bold ${INK3}`}><span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: stageFill(i)[0] }} />{name}</span>
                        ))}
                    </div>
                    {data.roles.length === 0 && <p className={`m-0 text-sm ${INK3}`}>No open roles.</p>}
                    <div className="overflow-x-auto">
                        <div className="flex min-w-[440px] flex-col gap-1.5">
                            {data.roles.map(r => (
                                <button
                                    key={r.id}
                                    type="button"
                                    onClick={() => setRoleId(r.id)}
                                    aria-pressed={r.id === roleId}
                                    className={`flex items-center gap-3.5 rounded-2xl px-2 py-1.5 text-left ${ROW_HOVER} ${roleId !== 'all' && r.id !== roleId ? 'opacity-50' : ''}`}
                                >
                                    <span className="block w-[145px] shrink-0">
                                        <span className="block truncate font-extrabold">{r.title}</span>
                                        <span className={`block text-xs ${INK3}`}>{plural(r.inPipeline, 'person', 'people')} · {r.daysOpen} days open</span>
                                    </span>
                                    <span className="flex flex-1 gap-[3px]">
                                        {r.byColumn.map((n, i) => {
                                            const [bg, fg] = stageFill(i);
                                            const last = i === r.byColumn.length - 1;
                                            return (
                                                <span
                                                    key={i}
                                                    title={`${columns[i]}: ${n}`}
                                                    className="flex h-8 items-center justify-center text-[13px] font-extrabold tabular-nums"
                                                    style={{
                                                        flex: `${Math.max(1, n)} 1 24px`,
                                                        // An empty column stays as a faint grey step, so the row keeps its shape.
                                                        background: n ? bg : 'rgba(130,130,125,.16)',
                                                        color: n ? fg : 'inherit',
                                                        clipPath: i === 0 ? 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%)'
                                                            : last ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 10px 50%)'
                                                                : 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)',
                                                        borderRadius: i === 0 ? '10px 0 0 10px' : last ? '0 10px 10px 0' : undefined,
                                                    }}
                                                >
                                                    {n}
                                                </span>
                                            );
                                        })}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </section>

                <section aria-label="Open roles, by days open" className={`${GLASS} min-w-0 flex-[1_1_340px] p-[22px]`}>
                    <div className="mb-2 flex flex-wrap items-baseline gap-2.5">
                        <h2 className={`${H2} grow`}>Open roles, by days open</h2>
                        <span className={`text-[13px] ${INK3}`}>{data.roles.length > aging.length ? `${aging.length} of ${data.roles.length} shown` : plural(data.roles.length, 'role', 'roles')}</span>
                    </div>
                    {aging.length === 0 && <p className={`m-0 text-sm ${INK3}`}>No open roles.</p>}
                    {aging.map(r => {
                        const tone: Tone = r.ageing ? 'c' : r.daysOpen >= r.targetDays * 0.8 ? 'a' : 'v';
                        const bar = r.ageing ? '#f87171' : tone === 'a' ? '#f59e0b' : '#5145e4';
                        return (
                            <button key={r.id} type="button" onClick={() => setRoleId(r.id)} className={`flex w-full items-center gap-3 rounded-2xl p-2 text-left ${ROW_HOVER}`}>
                                <span className={`w-14 shrink-0 rounded-[14px] py-[9px] text-center text-[13px] font-extrabold tabular-nums ${TONE[tone]}`}>{r.daysOpen}d</span>
                                <span className="block min-w-0 flex-1">
                                    <span className="flex gap-2"><span className="grow truncate font-extrabold">{r.title}</span><span className={`shrink-0 text-xs font-extrabold ${r.ageing ? 'text-[#b91c1c] dark:text-[#fca5a5]' : INK3}`}>{r.ageing ? `${r.daysOpen - r.targetDays} days late` : `${r.targetDays - r.daysOpen} days left`}</span></span>
                                    <span className={`block truncate text-xs ${INK3}`}>{r.nextAction}</span>
                                    <span className={`relative mt-1.5 block h-2 rounded ${TRACK}`}>
                                        <span className="block h-2 rounded" style={{ width: `${Math.min(100, (r.daysOpen / maxDays) * 100)}%`, background: bar }} />
                                        <span aria-hidden className="absolute -top-[3px] h-3.5 w-0.5 rounded-sm bg-[#262626] dark:bg-[#fafaf9]" style={{ left: `${Math.min(100, (r.targetDays / maxDays) * 100)}%` }} />
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                    {aging.length > 0 && <p className={`mx-2 mb-0 mt-2.5 text-xs ${INK3}`}>The thin mark on each bar is the target.</p>}
                </section>
            </div>
        </div>
    );
}
