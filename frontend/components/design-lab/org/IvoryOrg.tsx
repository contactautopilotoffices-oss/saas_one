'use client';

import React from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import { Meter } from '../lab/charts';
import { themeVars, type LabTheme } from '../lab/frame';
import { longDate, num } from '../lab/format';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { RED, RED_TEXT } from '../lab/status';
import { Avatar, EmptyState, H, OfflineBanner, listKeys, rowProps } from '../lab/ui';
import { GOLD } from './palette';
import { APPROVAL_ICONS, Fed, ORG_TABS, Sample } from './parts';
import { healthOf, type OrgModel, type OrgPeriod } from './useOrgModel';

/**
 * Ivory: the morning brief. One headline sentence says what matters today, then numbered
 * sections read top to bottom like a newspaper. Ivory paper, black ink, gold hairlines,
 * Playfair Display for headings and figures, Plus Jakarta Sans for reading.
 */

const IV = {
    page: '#FAF8F3', tile: '#F3EEE2', border: '#E8E1D1', rule: '#D9C38E',
    text: '#14120E', text2: '#57524A', text3: '#8F897D',
};

const theme: LabTheme = {
    font: 'var(--font-lab-jakarta), "Plus Jakarta Sans", system-ui, sans-serif',
    page: IV.page, surface: '#FFFFFF', tile: IV.tile, border: IV.border, borderStrong: '#D3CAB5', grid: '#EFE9DC',
    text: IV.text, text2: IV.text2, text3: IV.text3, primary: IV.text, onPrimary: IV.page, tint: GOLD.tint,
    ramp: ['#14120E', '#4A3B17', '#8B6B22', '#C9A24A'], radius: '14px', radiusSm: '10px', chipRadius: '6px', btnRadius: '10px',
    focus: GOLD.deep, skeletonA: '#F1EBDF', skeletonB: '#E6DECD', tooltipBg: IV.text, tooltipFg: IV.page,
};

const serif: React.CSSProperties = { fontFamily: 'var(--font-lab-playfair), "Playfair Display", Georgia, serif' };
const fig: React.CSSProperties = { ...serif, fontWeight: 600, fontVariantNumeric: 'lining-nums tabular-nums' };
const PERIODS: { id: OrgPeriod; label: string }[] = [{ id: 'today', label: 'Today' }, { id: 'month', label: 'Month' }, { id: 'all', label: 'All time' }];

function Numbered({ n, title, right, children }: { n: string; title: string; right?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section aria-label={title} className="border-t pt-[14px]" style={{ borderColor: IV.rule }}>
            <div className="mb-[10px] flex items-baseline gap-[10px]">
                <span className="text-[13px] font-semibold" style={{ ...serif, color: GOLD.deep }}>{n}</span>
                <H level={2} className="flex-1 text-[20px] font-semibold leading-tight" style={serif}>{title}</H>
                {right}
            </div>
            {children}
        </section>
    );
}

export default function IvoryOrg({ m }: { m: OrgModel }) {
    const health = m.sites.data ? healthOf(m.sites.data) : null;
    const breached = m.tickets.data?.breached ?? null;
    const headline = !health || health.count === 0
        ? 'No properties to brief on yet.'
        : health.needAttention === 0 ? 'Every site is in good shape this morning.'
            : `${health.needAttention === 1 ? 'One site needs' : `${health.needAttention} sites need`} you this morning.`;

    return (
        <div className="lab-root relative flex min-h-full flex-col" style={themeVars(theme)}>
            <header className="px-[20px] pb-[18px]" style={{ paddingTop: 'calc(var(--org-safe-top, 0px) + 10px)' }}>
                <div className="flex items-center gap-[10px]">
                    <span className="grid h-10 w-10 place-items-center rounded-full border text-[18px] font-semibold" style={{ ...serif, borderColor: GOLD.base }}>A</span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[17px] font-semibold" style={serif}>{m.orgName}</span>
                        <span className="block text-[11.5px]" style={{ color: IV.text3 }}>All properties</span>
                    </span>
                    <button type="button" aria-label="Notifications" onClick={() => m.previewAction('Notifications')} className="relative grid h-10 w-10 place-items-center rounded-full border bg-white" style={{ borderColor: IV.border }}>
                        <Bell className="h-[18px] w-[18px]" /><span className="absolute right-[9px] top-[9px] h-2 w-2 rounded-full" style={{ background: GOLD.base }} />
                    </button>
                    <Avatar name={m.user.name} size={40} style={{ background: IV.text, color: GOLD.onDark }} />
                </div>

                <p className="mt-[22px] text-[11.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: GOLD.deep }}>The morning brief · {longDate(m.now)}</p>
                <Fed feed={m.sites} rows={2} height={30} className="mt-[8px]">
                    {() => <H level={1} className="mt-[6px] text-[31px] font-semibold leading-[1.15]" style={serif}>{headline}</H>}
                </Fed>
                <p className="mt-[10px] text-[14px] leading-relaxed" style={{ color: IV.text2 }}>
                    {m.waitingTotal !== null && <>{m.waitingTotal} decisions are waiting on you{breached !== null ? `, and ${breached} ${breached === 1 ? 'ticket has' : 'tickets have'} broken SLA` : ''}.</>}
                    {health?.score != null && <> Portfolio score <b style={{ ...fig, color: IV.text }}>{health.score}</b> of 100.</>}
                </p>

                <div className="mt-[16px] flex items-center justify-between">
                    <div role="radiogroup" aria-label="Period" className="flex gap-[16px]">
                        {PERIODS.map(p => (
                            <button key={p.id} type="button" role="radio" aria-checked={m.period === p.id} onClick={() => m.setPeriod(p.id)}
                                className="relative h-10 text-[13px] font-semibold" style={{ color: m.period === p.id ? IV.text : IV.text3 }}>
                                {p.label}
                                {m.period === p.id && <span aria-hidden className="absolute inset-x-0 bottom-[6px] h-[2px]" style={{ background: GOLD.base }} />}
                            </button>
                        ))}
                    </div>
                    <Fed feed={m.raised} compact rows={1} height={14} className="w-[80px] justify-end">
                        {v => <span className="text-[12.5px]" style={{ color: IV.text2 }}><b className="text-[17px]" style={{ ...fig, color: IV.text }}>{num(v)}</b> raised</span>}
                    </Fed>
                </div>
                <OfflineBanner online={m.online} className="mt-[12px]" style={{ background: '#FFFFFF', border: `1px solid ${IV.rule}` }} />
            </header>

            <main className="flex flex-1 flex-col gap-[22px] px-[20px] pb-[28px]">
                <Numbered n="01" title="Waiting on you" right={m.waitingTotal !== null ? <span className="text-[20px]" style={fig}>{m.waitingTotal}</span> : undefined}>
                    <ul className="flex flex-col" onKeyDown={listKeys}>
                        {m.approvals.map((f, i) => {
                            const id = (['po', 'mr', 'petty', 'escalation'] as const)[i];
                            const Icon = APPROVAL_ICONS[id];
                            return (
                                <li key={id} className="border-b last:border-0" style={{ borderColor: '#EFE9DC' }}>
                                    <Fed feed={f} rows={1} height={40} className="py-[8px]">
                                        {a => (
                                            <div {...rowProps(() => m.previewAction(`${a.action} ${a.label.toLowerCase()}`), a.label)} className="flex min-h-[60px] cursor-pointer items-center gap-[12px] py-[10px]">
                                                <Icon className="h-[18px] w-[18px] shrink-0" style={{ color: a.id === 'escalation' ? RED : GOLD.deep }} aria-hidden />
                                                <span className="min-w-0 flex-1">
                                                    <span className="flex items-center gap-[6px] text-[14px] font-semibold">{a.label}<Sample feed={f} /></span>
                                                    <span className="block truncate text-[12.5px]" style={{ color: IV.text2 }}>{a.detail}{a.value ? `, ${a.value}` : ''}</span>
                                                </span>
                                                <span className="text-[24px] leading-none" style={fig}>{a.count}</span>
                                                <span className="inline-flex items-center text-[12.5px] font-semibold" style={{ color: GOLD.deep }}>{a.action}<ChevronRight className="h-4 w-4" aria-hidden /></span>
                                            </div>
                                        )}
                                    </Fed>
                                </li>
                            );
                        })}
                    </ul>
                </Numbered>

                <Numbered n="02" title="Service risk" right={<Sample feed={m.escalations} />}>
                    <Fed feed={m.tickets} rows={1} height={60}>
                        {t => (
                            <div className="grid grid-cols-3 divide-x" style={{ borderColor: IV.border }}>
                                {[
                                    { v: t.breached, l: 'SLA breached', red: t.breached > 0 },
                                    { v: t.urgent, l: 'Urgent open' },
                                    { v: t.active, l: 'Active' },
                                ].map((x, i) => (
                                    <div key={x.l} className={i === 0 ? 'pr-[12px]' : 'px-[12px]'} style={{ borderColor: IV.border }}>
                                        <span className="block text-[32px] leading-none" style={{ ...fig, color: x.red ? RED_TEXT : IV.text }}>{x.v}</span>
                                        <span className="text-[12px]" style={{ color: x.red ? RED_TEXT : IV.text2 }}>{x.l}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Fed>
                    <Fed feed={m.oldestOpen} rows={1} height={16} className="mt-[10px]">
                        {o => o.days > 0 ? (
                            <p className="mt-[12px] border-l-[3px] pl-[12px] text-[14px] italic leading-relaxed" style={{ ...serif, borderColor: GOLD.base }}>
                                The oldest open ticket is {o.days} days old: {o.title} at {o.site}.
                                <Fed feed={m.escalations} rows={1}>{e => <> {e.count} were escalated to you today.</>}</Fed>
                            </p>
                        ) : null}
                    </Fed>
                </Numbered>

                <Numbered n="03" title="Sites, worst first" right={<Sample feed={m.sites} />}>
                    <Fed feed={m.sites} rows={4} height={34}>
                        {sites => sites.length === 0 ? (
                            <EmptyState compact title="No properties yet" body="Add a property to rank it here." actionLabel="Add property" onAction={() => m.previewAction('Add property')} />
                        ) : (
                            <div role="table" aria-label="Sites ranked by score">
                                <div role="row" className="grid grid-cols-[22px_minmax(0,1fr)_44px_44px_44px] gap-[6px] border-b pb-[6px] text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: IV.text3, borderColor: IV.border }}>
                                    <span role="columnheader">#</span><span role="columnheader">Site</span><span role="columnheader" className="text-right">Score</span><span role="columnheader" className="text-right">Open</span><span role="columnheader" className="text-right">Urgent</span>
                                </div>
                                <div onKeyDown={listKeys}>
                                    {sites.map((s, i) => (
                                        <div key={s.id} role="row" {...rowProps(() => m.previewAction(`Open ${s.name}`), s.name)} className="grid cursor-pointer grid-cols-[22px_minmax(0,1fr)_44px_44px_44px] items-center gap-[6px] border-b py-[10px]" style={{ borderColor: '#EFE9DC' }}>
                                            <span role="cell" className="text-[14px]" style={{ ...fig, color: IV.text3 }}>{i + 1}</span>
                                            <span role="cell" className="min-w-0">
                                                <span className="block truncate text-[14px] font-semibold">{s.name}</span>
                                                <Meter value={s.score / 100} label={`${s.name} score`} color={s.score >= 85 ? GOLD.base : IV.text} track="#EFE9DC" height={3} tip={`${s.name}: score ${s.score}`} />
                                                {s.overBudget ? <span className="text-[11.5px] italic" style={{ ...serif, color: IV.text2 }}>{inr(s.overBudget, { compact: true })} over budget</span> : null}
                                            </span>
                                            <span role="cell" className="text-right text-[18px]" style={fig}>{s.score}</span>
                                            <span role="cell" className="text-right text-[14px] tabular-nums">{s.active}</span>
                                            <span role="cell" className="text-right text-[14px] tabular-nums">{s.urgent}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Fed>
                </Numbered>

                <Numbered n="04" title="People" right={<Sample feed={m.roster} />}>
                    <Fed feed={m.roster} rows={2} height={18}>
                        {r => (
                            <div>
                                <p className="text-[14px] leading-relaxed"><b className="text-[22px]" style={fig}>{r.present}</b> of {r.scheduled} on duty, <b>{r.coveragePct}%</b> coverage. {r.late} late, {r.absent} absent.</p>
                                <Meter value={r.coveragePct / 100} label="Attendance" color={GOLD.base} track="#EFE9DC" height={4} tip={`${r.present} of ${r.scheduled} present`} />
                                <p className="mt-[6px] text-[12.5px]" style={{ color: IV.text2 }}>{r.shortTomorrow} short tomorrow{r.worst?.absent ? `. Worst today: ${r.worst.name}, ${r.worst.absent} absent` : ''}.</p>
                            </div>
                        )}
                    </Fed>
                    <Fed feed={m.grievances} rows={1} height={14} className="mt-[8px]">
                        {g => <p className="mt-[8px] flex items-center gap-[6px] text-[12.5px]" style={{ color: IV.text2 }}><b style={{ color: IV.text }}>{g.open}</b> HR grievances open, oldest {g.oldestDays} days <Sample feed={m.grievances} /></p>}
                    </Fed>
                </Numbered>

                <Numbered n="05" title="Compliance" right={<Sample feed={m.ppm} />}>
                    <Fed feed={m.ppm} rows={2} height={16}>
                        {p => (
                            <div>
                                <div className="flex items-baseline justify-between"><span className="text-[13.5px] font-semibold">PPM done on time</span><span><b className="text-[22px]" style={fig}>{p.pct}%</b> <span className="text-[12px]" style={{ color: IV.text2 }}>of {p.target}% target</span></span></div>
                                <Meter value={p.pct / 100} label="PPM compliance" color={p.pct >= p.target ? GOLD.base : IV.text} track="#EFE9DC" height={4} tip={`${p.pct}% done on time, target ${p.target}%`} />
                                <p className="mt-[6px] text-[12.5px]" style={{ color: IV.text2 }}>{p.overdue} overdue, {p.dueToday} due today{p.worstSystem?.count ? `. Most overdue: ${p.worstSystem.name}` : ''}.</p>
                            </div>
                        )}
                    </Fed>
                    <Fed feed={m.rounds} rows={1} height={14} className="mt-[8px]">
                        {r => r.missed > 0 ? <p className="mt-[10px] flex items-start gap-[6px] text-[12.5px]"><span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: RED }} /><span><b style={{ color: RED_TEXT }}>{r.missed} rounds late</b> at {r.sites} sites. {r.worst}.</span> <Sample feed={m.rounds} /></p> : null}
                    </Fed>
                    <Fed feed={m.amc} rows={1} height={14} className="mt-[8px]">
                        {list => list.length ? (
                            <div className="mt-[10px]">
                                <div className="mb-[4px] flex items-center gap-[6px] text-[12.5px] font-semibold">AMC renewals due <Sample feed={m.amc} /></div>
                                {list.map(a => <div key={a.id} className="flex justify-between border-b py-[6px] text-[13px] last:border-0" style={{ borderColor: '#EFE9DC' }}><span>{a.asset}, {a.site}</span><span style={fig}>{a.days} days</span></div>)}
                            </div>
                        ) : null}
                    </Fed>
                </Numbered>

                <Numbered n="06" title="Money" right={<Sample feed={m.budget} />}>
                    <Fed feed={m.budget} rows={2} height={16}>
                        {b => (
                            <div>
                                <p className="text-[14px]"><b className="text-[28px]" style={fig}>{b.pct}%</b> of this month&apos;s budget used, {inr(b.spent, { compact: true })} of {inr(b.total, { compact: true })}.</p>
                                <Meter value={b.pct / 100} label="Budget used" color={IV.text} track="#EFE9DC" height={4} tip={`${inr(b.spent, { compact: true })} of ${inr(b.total, { compact: true })}`} />
                                {b.overSites.length > 0 && <p className="mt-[6px] text-[12.5px]" style={{ color: IV.text2 }}>Over budget: {b.overSites.map(o => `${o.name} by ${inr(o.over, { compact: true })}`).join('; ')}.</p>}
                            </div>
                        )}
                    </Fed>
                    <div className="mt-[12px] grid grid-cols-2 gap-[10px]">
                        <div className="rounded-[12px] bg-white p-[12px]" style={{ border: `1px solid ${IV.border}` }}>
                            <div className="flex items-center justify-between text-[12px]" style={{ color: IV.text2 }}>Electricity<Sample feed={m.elec} /></div>
                            <Fed feed={m.elec} rows={2} height={14}>
                                {e => <><span className="block text-[22px]" style={fig}>{e.deltaPct === null ? 'No baseline' : `${e.deltaPct > 0 ? '+' : ''}${Math.round(e.deltaPct)}%`}</span><span className="text-[11.5px]" style={{ color: IV.text2 }}>vs last month so far</span></>}
                            </Fed>
                        </div>
                        <div className="rounded-[12px] bg-white p-[12px]" style={{ border: `1px solid ${IV.border}` }}>
                            <div className="flex items-center justify-between text-[12px]" style={{ color: IV.text2 }}>Bills at risk<Sample feed={m.bills} /></div>
                            <Fed feed={m.bills} rows={2} height={14}>
                                {b => <><span className="block text-[22px]" style={fig}>{inr(b.atRisk, { compact: true })}</span><span className="text-[11.5px]" style={{ color: IV.text2 }}>{b.count} bills need paying</span></>}
                            </Fed>
                        </div>
                    </div>
                </Numbered>

                <Numbered n="07" title="Utilities" right={<Sample feed={m.diesel} />}>
                    <Fed feed={m.diesel} rows={1} height={16}>
                        {d => <p className="text-[13.5px]">Lowest diesel tank: <b>{d.lowTank.site} {d.lowTank.dg}</b> at <b style={fig}>{d.lowTank.pct}%</b>. {num(d.litres)} L used this month.</p>}
                    </Fed>
                    <Fed feed={m.water} rows={1} height={14} className="mt-[6px]">
                        {w => <p className="mt-[6px] text-[13.5px]" style={{ color: IV.text2 }}>{w.tankers} water tanker loads today.</p>}
                    </Fed>
                </Numbered>

                <Numbered n="08" title="Also today" right={<Sample feed={m.rooms} />}>
                    <div className="grid grid-cols-3 gap-[10px]">
                        <Fed feed={m.visitors} rows={1} height={30}>{v => <div><span className="block text-[22px]" style={fig}>{num(v.today)}</span><span className="text-[11.5px]" style={{ color: IV.text2 }}>visitors</span></div>}</Fed>
                        <Fed feed={m.vendor} rows={1} height={30}>{v => <div><span className="block text-[22px]" style={fig}>{inr(v.revenue, { compact: true })}</span><span className="text-[11.5px]" style={{ color: IV.text2 }}>vendor revenue</span></div>}</Fed>
                        <Fed feed={m.rooms} rows={1} height={30}>{r => <div><span className="block text-[22px]" style={fig}>{r.pct}%</span><span className="text-[11.5px]" style={{ color: IV.text2 }}>rooms booked</span></div>}</Fed>
                    </div>
                </Numbered>
            </main>

            <nav aria-label="Main" className="sticky bottom-0 z-30 grid h-[68px] grid-cols-5 border-t" style={{ background: IV.page, borderColor: IV.rule }}>
                {ORG_TABS.map((t, i) => (
                    <button key={t.label} type="button" aria-current={i === 0 ? 'page' : undefined} onClick={() => i !== 0 && m.previewAction(`Open ${t.label}`)}
                        className="relative flex flex-col items-center justify-center gap-[3px] text-[10.5px] font-semibold" style={{ color: i === 0 ? IV.text : IV.text3 }}>
                        {i === 0 && <span aria-hidden className="absolute top-0 h-[3px] w-8 rounded-b-full" style={{ background: GOLD.base }} />}
                        <t.icon className="h-5 w-5" aria-hidden />{t.label}
                    </button>
                ))}
            </nav>
        </div>
    );
}
