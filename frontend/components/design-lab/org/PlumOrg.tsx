'use client';

import React, { useId, useState } from 'react';
import {
    AlertTriangle, BarChart3, Bell, Building2, CheckCircle2, Droplets, Fuel, Home, LineChart, ListChecks, Menu, Presentation,
    ShieldCheck, Ticket, Users, Wallet, Zap,
} from 'lucide-react';
import { Columns, LineArea, Ring, TipBox, useTip } from '../lab/charts';
import { themeVars, type LabTheme } from '../lab/frame';
import { num } from '../lab/format';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { RED } from '../lab/status';
import { EmptyState, H, OfflineBanner, SkeletonRows, cx, listKeys, rowProps } from '../lab/ui';
import { RED_ON_DARK } from './palette';
import { APPROVAL_ICONS, Fed, InlineError, Sample } from './parts';
import { dayLabels, portfolioTrend, riskItems, QUEUE_NAMES } from './derive';
import { healthOf, type OrgModel } from './useOrgModel';

/**
 * Plum: dark, quiet, lilac accent. Jump chips take you to any part of the page; the hero chart
 * switches between bars and a line; approval queues are pills whose length is the count; sites
 * are score dials; staff on duty is a grid of dots, one per person; AMC renewals sit on a 30
 * day timeline. Sora.
 */

const P = {
    page: '#121016',
    card: '#1C1922',
    card2: '#26222E',
    border: '#2F2A3A',
    text: '#F4F2F8',
    text2: '#BDB7CB',
    text3: '#9C96AA',
    accent: '#B9A6FF',
    accentDim: 'rgba(185,166,255,0.42)',
    accentSoft: 'rgba(185,166,255,0.15)',
    onAccent: '#17131F',
    redSoft: 'rgba(229,72,77,0.16)',
};

const theme: LabTheme = {
    font: 'var(--font-lab-sora), Sora, system-ui, sans-serif',
    page: P.page, surface: P.card, tile: P.card2, border: P.border, borderStrong: '#3C3648', grid: '#2A2633',
    text: P.text, text2: P.text2, text3: P.text3, primary: P.accent, onPrimary: P.onAccent, tint: P.accentSoft,
    ramp: ['#B9A6FF', '#9A86E6', '#7A68C2', '#5A4C91'], radius: '22px', radiusSm: '14px', chipRadius: '999px', btnRadius: '999px',
    focus: P.accent, skeletonA: '#221E2A', skeletonB: '#2C2735', tooltipBg: '#F4F2F8', tooltipFg: '#17131F',
};

const fig: React.CSSProperties = { fontWeight: 600, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' };

function Block({ id, title, right, children }: { id: string; title: string; right?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section id={id} aria-label={title} className="scroll-mt-[12px] px-[16px] pt-[24px]">
            <div className="mb-[10px] flex items-center justify-between gap-[8px]">
                <H level={2} className="text-[16px] font-semibold tracking-[-0.02em]">{title}</H>
                <span className="flex items-center gap-[6px]">{right}</span>
            </div>
            {children}
        </section>
    );
}

/* ------------------------------------------------------------ hero */

function HeroChart({ m }: { m: OrgModel }) {
    const [kind, setKind] = useState<'bars' | 'line'>('bars');
    const [range, setRange] = useState<7 | 14>(7);
    const days = dayLabels(m.now, range);
    return (
        <section aria-label="Active tickets" className="mx-[16px] mt-[16px] rounded-[26px] p-[16px]" style={{ background: P.card }}>
            <div className="flex items-start justify-between gap-[8px]">
                <div>
                    <span className="flex items-center gap-[6px] text-[13px]" style={{ color: P.text2 }}>Active tickets<Sample feed={m.sites} dark /></span>
                    <Fed feed={m.sites} dark compact rows={1} height={40} className="mt-[6px] w-[120px]">
                        {sites => <span className="mt-[4px] block text-[50px] leading-none" style={fig}>{sites.length ? num(portfolioTrend(sites, 1)[0]) : 0}</span>}
                    </Fed>
                </div>
                <div role="radiogroup" aria-label="Chart type" className="flex flex-col gap-[4px] rounded-full p-[4px]" style={{ background: P.card2 }}>
                    {([['bars', BarChart3, 'Bars'], ['line', LineChart, 'Line']] as const).map(([k, Icon, label]) => (
                        <button key={k} type="button" role="radio" aria-checked={kind === k} aria-label={label} onClick={() => setKind(k)}
                            className="grid h-10 w-10 place-items-center rounded-full" style={kind === k ? { background: P.accent, color: P.onAccent } : { color: P.text2 }}>
                            <Icon className="h-[18px] w-[18px]" aria-hidden />
                        </button>
                    ))}
                </div>
            </div>
            <div role="radiogroup" aria-label="Range" className="mt-[10px] flex gap-[6px]">
                {([7, 14] as const).map(r => (
                    <button key={r} type="button" role="radio" aria-checked={range === r} onClick={() => setRange(r)} className="h-10 rounded-full px-[14px] text-[12.5px] font-medium"
                        style={range === r ? { background: P.accentSoft, color: P.accent, boxShadow: `inset 0 0 0 1px ${P.accentDim}` } : { color: P.text2, boxShadow: `inset 0 0 0 1px ${P.border}` }}>{r} days</button>
                ))}
            </div>
            <Fed feed={m.sites} dark rows={2} height={50} className="mt-[12px]">
                {sites => {
                    if (sites.length === 0) return <p className="mt-[12px] text-[13px]" style={{ color: P.text2 }}>No properties yet.</p>;
                    const series = portfolioTrend(sites, range);
                    return (
                        <div className="mt-[12px]">
                            {kind === 'bars' ? (
                                <Columns data={series.map((v, i) => ({ label: days[i].short, tipLabel: days[i].long, values: [v], highlight: i === range - 1 }))}
                                    series={[{ name: 'Active tickets', color: P.accentDim }]} highlightColor={P.accent} keyIndex="last" showAxis={false} height={150}
                                    maxBar={22} barRadius={11} gridColor={P.border} textColor={P.text3} keyColor={P.text} xLabelEvery={range > 7 ? 2 : 1}
                                    ariaLabel={`Active tickets, last ${range} days, today ${series[range - 1]}`} />
                            ) : (
                                <LineArea data={series.map((v, i) => ({ label: days[i].long, value: v }))} color={P.accent} height={150} fillOpacity={0.12} fitRange
                                    gridColor={P.border} textColor={P.text3} keyColor={P.text} dotFill={P.card}
                                    xLabels={[{ index: 0, text: days[0].short }, { index: range - 1, text: 'Today' }]}
                                    ariaLabel={`Active tickets, last ${range} days, today ${series[range - 1]}`} />
                            )}
                        </div>
                    );
                }}
            </Fed>
        </section>
    );
}

/* -------------------------------------------------- people dot grid */

function DotGrid({ onTime, late, absent }: { onTime: number; late: number; absent: number }) {
    const { host, tip, show, hide } = useTip();
    const dots = [
        ...Array.from({ length: onTime }, () => 0),
        ...Array.from({ length: late }, () => 1),
        ...Array.from({ length: absent }, () => 2),
    ];
    const style = (k: number): React.CSSProperties => k === 0 ? { background: P.accent } : k === 1 ? { background: P.accentDim } : { boxShadow: `inset 0 0 0 1.5px ${P.text3}` };
    return (
        <div ref={host} className="relative" onMouseLeave={hide}>
            <div role="img" aria-label={`${onTime} on time, ${late} late, ${absent} absent`} className="flex flex-wrap gap-[4px]"
                onMouseEnter={e => show(e.currentTarget, <span>{onTime} on time, {late} late, {absent} absent</span>)}>
                {dots.map((k, i) => <span key={i} aria-hidden className="h-[9px] w-[9px] rounded-full" style={style(k)} />)}
            </div>
            <TipBox tip={tip} />
        </div>
    );
}

/* ------------------------------------------------- AMC 30 day timeline */

function RenewalLine({ items }: { items: { id: string; asset: string; site: string; days: number }[] }) {
    const { host, tip, show, hide } = useTip();
    return (
        <div ref={host} className="relative pb-[34px] pt-[8px]" onMouseLeave={hide}>
            <div role="img" aria-label={`AMC renewals: ${items.map(a => `${a.asset} in ${a.days} days`).join(', ')}`} className="relative h-[2px] rounded" style={{ background: P.border }}>
                {[0, 10, 20, 30].map(d => (
                    <span key={d} aria-hidden className="absolute top-[8px] -translate-x-1/2 text-[10.5px]" style={{ left: `${(d / 30) * 100}%`, color: P.text3 }}>{d === 0 ? 'Today' : `${d}d`}</span>
                ))}
                {items.map(a => (
                    <span key={a.id} className="absolute -top-[7px] h-4 w-4 -translate-x-1/2 rounded-full" style={{ left: `${Math.min(30, a.days) / 30 * 100}%`, background: P.accent, boxShadow: `0 0 0 4px ${P.card}` }}
                        onMouseEnter={e => show(e.currentTarget, <span>{a.asset}, {a.site}: <b>{a.days} days</b></span>)} />
                ))}
            </div>
            <TipBox tip={tip} />
        </div>
    );
}

/* ------------------------------------------------------------ screen */

const TABS = [
    { label: 'Home', icon: Home }, { label: 'Approvals', icon: ListChecks }, { label: 'Sites', icon: Building2 }, { label: 'Tickets', icon: Ticket }, { label: 'More', icon: Menu },
];

export default function PlumOrg({ m }: { m: OrgModel }) {
    const uid = useId().replace(/:/g, '');
    const ids = { approvals: `${uid}-approvals`, alerts: `${uid}-alerts`, sites: `${uid}-sites`, money: `${uid}-money`, people: `${uid}-people`, compliance: `${uid}-compliance` };
    const health = m.sites.data ? healthOf(m.sites.data) : null;
    const risk = riskItems(m);
    const queues = m.approvals.flatMap(a => (a.state === 'ready' && a.data && a.data.count > 0 ? [a.data] : []));
    const maxQ = Math.max(1, ...queues.map(q => q.count));
    const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    return (
        <div className="lab-root relative flex min-h-full flex-col" style={{ ...themeVars(theme), background: P.page, color: P.text }}>
            <header className="px-[16px]" style={{ paddingTop: 'calc(var(--org-safe-top, 0px) + 10px)' }}>
                <div className="flex items-center gap-[10px]">
                    <span className="grid h-10 w-10 place-items-center rounded-full text-[13px] font-semibold" style={{ background: P.accent, color: P.onAccent }}>{m.user.initials}</span>
                    <span className="min-w-0 flex-1 text-[12.5px]" style={{ color: P.text3 }}><span className="block truncate">{m.orgName}</span><span className="block truncate">{m.user.roleLabel}</span></span>
                    <button type="button" aria-label="Notifications" onClick={() => m.previewAction('Notifications')} className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: P.card }}>
                        <Bell className="h-[18px] w-[18px]" aria-hidden /><span className="absolute right-[11px] top-[10px] h-2 w-2 rounded-full" style={{ background: P.accent }} />
                    </button>
                </div>
                <H level={1} className="mt-[18px] text-[28px] font-semibold leading-tight tracking-[-0.035em]">Hi {m.user.firstName},</H>
                <p className="text-[15px]" style={{ color: P.text2 }}>here is everything{health?.count ? ` across ${health.count} sites` : ''}.</p>
            </header>

            <div className="lab-scroll-x mt-[14px] flex gap-[8px] overflow-x-auto px-[16px]" role="navigation" aria-label="Jump to">
                {([['Approvals', ids.approvals, m.waitingTotal], ['Alerts', ids.alerts, risk.loading ? null : risk.items.length], ['Sites', ids.sites, health?.needAttention ?? null], ['Money', ids.money, null], ['People', ids.people, null], ['Compliance', ids.compliance, null]] as const).map(([label, id, n]) => (
                    <button key={label} type="button" onClick={() => jump(id)} className="inline-flex h-10 shrink-0 items-center gap-[6px] rounded-full px-[14px] text-[13px] font-medium" style={{ background: P.card, color: P.text }}>
                        {label}{n !== null && n > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full px-[5px] text-[11px] font-semibold" style={{ background: P.accent, color: P.onAccent }}>{n}</span>}
                    </button>
                ))}
            </div>

            <OfflineBanner online={m.online} className="mx-[16px] mt-[10px]" style={{ background: P.card, borderRadius: 16, color: P.text }} />
            <HeroChart m={m} />

            <Block id={ids.approvals} title="Waiting on you" right={<Sample feed={m.waiting} dark />}>
                <Fed feed={m.waiting} dark rows={4} height={48}>
                    {total => total === 0 ? <p className="flex items-center gap-[8px] text-[13px]" style={{ color: P.text2 }}><CheckCircle2 className="h-4 w-4" aria-hidden />Nothing is waiting on you.</p> : (
                        <>
                            <ul className="flex flex-col gap-[8px]" onKeyDown={listKeys} aria-label="Approval queues, length shows the count">
                                {queues.map(q => {
                                    const Icon = APPROVAL_ICONS[q.id];
                                    return (
                                        <li key={q.id}>
                                            <div {...rowProps(() => m.previewAction(`${q.action} ${q.label.toLowerCase()}`), `${q.label}: ${q.count}`)} className="flex items-center gap-[10px]">
                                                <span className="flex h-12 min-w-0 items-center gap-[8px] rounded-full px-[14px]" style={{ width: `${40 + (q.count / maxQ) * 50}%`, background: P.accentSoft, boxShadow: `inset 0 0 0 1px ${P.accentDim}` }}>
                                                    <Icon className="h-4 w-4 shrink-0" style={{ color: P.accent }} aria-hidden />
                                                    <span className="truncate text-[13px] font-medium">{QUEUE_NAMES[q.id]}</span>
                                                </span>
                                                <span className="text-[18px]" style={fig}>{q.count}</span>
                                                <span className="min-w-0 flex-1 truncate text-right text-[11.5px]" style={{ color: P.text3 }}>{q.value ?? ''}</span>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                            <button type="button" onClick={() => m.previewAction('Review all approvals')} className="mt-[12px] h-12 w-full rounded-full text-[14px] font-semibold" style={{ background: P.accent, color: P.onAccent }}>Review all {total}</button>
                        </>
                    )}
                </Fed>
            </Block>

            <Block id={ids.alerts} title="Alerts" right={<Sample feed={{ sample: risk.items.some(r => r.sample) }} dark />}>
                {risk.failed.length > 0 && <InlineError dark onRetry={() => risk.failed.forEach(f => f.retry())} className="mb-[8px]" />}
                {risk.loading && risk.items.length === 0 ? <SkeletonRows rows={3} height={64} gap={8} /> : risk.items.length === 0 && risk.failed.length === 0 ? (
                    <p className="flex items-center gap-[8px] text-[13px]" style={{ color: P.text2 }}><CheckCircle2 className="h-4 w-4" aria-hidden />No alerts right now.</p>
                ) : (
                    <ul className="flex flex-col gap-[8px]" onKeyDown={listKeys}>
                        {risk.items.map(r => (
                            <li key={r.key}>
                                <div {...rowProps(() => m.previewAction(`Open ${r.title}`), r.title)} className="relative flex items-center gap-[12px] overflow-hidden rounded-[18px] py-[12px] pl-[18px] pr-[14px]" style={{ background: r.red ? P.redSoft : P.card }}>
                                    <span aria-hidden className="absolute inset-y-0 left-0 w-[4px]" style={{ background: r.red ? RED : P.accent }} />
                                    <r.icon className="h-[18px] w-[18px] shrink-0" style={{ color: r.red ? RED_ON_DARK : P.accent }} aria-hidden />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[13.5px] font-semibold leading-snug" style={{ color: r.red ? RED_ON_DARK : P.text }}>{r.title}</span>
                                        <span className="block truncate text-[12px]" style={{ color: P.text3 }}>{r.meta}</span>
                                    </span>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Block>

            <Block id={ids.sites} title="Sites" right={<><Sample feed={m.sites} dark />{health?.score != null && <span className="text-[12.5px]" style={{ color: P.text2 }}>avg {health.score}</span>}</>}>
                <Fed feed={m.sites} dark rows={1} height={130}>
                    {sites => sites.length === 0 ? <EmptyState dark compact title="No properties yet" body="Add a property to see it here." actionLabel="Add property" onAction={() => m.previewAction('Add property')} /> : (
                        <ul className="lab-scroll-x -mx-[16px] flex gap-[10px] overflow-x-auto px-[16px] pb-[4px]" onKeyDown={listKeys}>
                            {sites.map(s => (
                                <li key={s.id} className="shrink-0">
                                    <div {...rowProps(() => m.previewAction(`Open ${s.name}`), `${s.name}, score ${s.score}`)} className="flex w-[128px] flex-col items-center rounded-[22px] px-[10px] py-[14px] text-center" style={{ background: P.card }}>
                                        <Ring value={s.score / 100} size={72} stroke={7} color={s.score < 85 ? P.accent : P.accentDim} track={P.card2} tipText={`${s.name}: ${s.score}`} ariaLabel={`${s.name} score ${s.score}`}>
                                            <span className="text-[20px] leading-none" style={fig}>{s.score}</span>
                                        </Ring>
                                        <span className="mt-[8px] w-full truncate text-[12.5px] font-medium">{s.name}</span>
                                        <span className="flex items-center gap-[4px] text-[11px]" style={{ color: P.text3 }}>
                                            {s.score < 85 ? <><AlertTriangle className="h-3 w-3" aria-hidden />Needs you</> : <>{s.active} active</>}
                                        </span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Fed>
            </Block>

            <Block id={ids.money} title="Money this month" right={<Sample feed={m.elec} dark />}>
                <div className="rounded-[22px] p-[16px]" style={{ background: P.card }}>
                    <Fed feed={m.budget} dark rows={2} height={20}>
                        {b => (
                            <>
                                <div className="relative h-[24px] overflow-hidden rounded-full" style={{ background: P.card2 }} role="meter" aria-label="Budget used" aria-valuenow={b.pct} aria-valuemin={0} aria-valuemax={100}>
                                    <div className="flex h-full items-center rounded-full px-[10px] text-[12px] font-semibold" style={{ width: `${Math.max(18, b.pct)}%`, background: P.accent, color: P.onAccent }}>{b.pct}% used</div>
                                </div>
                                <p className="mt-[8px] text-[12.5px]" style={{ color: P.text2 }}>{inr(b.spent, { compact: true })} of {inr(b.total, { compact: true })}{b.overSites.length ? `. Over: ${b.overSites.map(o => `${o.name} ${inr(o.over, { compact: true })}`).join(', ')}` : ''}</p>
                            </>
                        )}
                    </Fed>
                    <div className="mt-[14px] grid grid-cols-3 gap-[6px] border-t pt-[12px]" style={{ borderColor: P.border }}>
                        <Fed feed={m.elec} dark compact rows={1} height={18}>{e => <span><span className="flex items-center gap-[4px] text-[11.5px]" style={{ color: P.text3 }}><Zap className="h-3 w-3" aria-hidden />Power</span><b className="text-[17px]" style={fig}>{e.deltaPct === null ? 'None' : `${e.deltaPct > 0 ? '+' : ''}${e.deltaPct}%`}</b></span>}</Fed>
                        <Fed feed={m.bills} dark compact rows={1} height={18}>{b => <span><span className="flex items-center gap-[4px] text-[11.5px]" style={{ color: P.text3 }}><Wallet className="h-3 w-3" aria-hidden />At risk</span><b className="text-[17px]" style={fig}>{inr(b.atRisk, { compact: true })}</b></span>}</Fed>
                        <Fed feed={m.vendor} dark compact rows={1} height={18}>{v => <span><span className="text-[11.5px]" style={{ color: P.text3 }}>Vendors</span><b className="block text-[17px]" style={fig}>{inr(v.revenue, { compact: true })}</b></span>}</Fed>
                    </div>
                </div>
            </Block>

            <Block id={ids.people} title="On duty now" right={<Sample feed={m.roster} dark />}>
                <div className="rounded-[22px] p-[16px]" style={{ background: P.card }}>
                    <Fed feed={m.roster} dark rows={3} height={16}>
                        {r => (
                            <>
                                <div className="mb-[12px] flex items-baseline justify-between gap-[8px]">
                                    <span className="text-[24px] leading-none" style={fig}>{r.coveragePct}%<span className="ml-[6px] text-[12.5px] font-normal" style={{ color: P.text2 }}>{r.present} of {r.scheduled} present</span></span>
                                    <span className="text-[11.5px]" style={{ color: P.text3 }}>one dot per person</span>
                                </div>
                                <DotGrid onTime={r.present} late={r.late} absent={r.absent} />
                                <ul aria-label="Legend" className="mt-[12px] flex flex-wrap gap-x-[14px] gap-y-[4px] text-[12px]" style={{ color: P.text2 }}>
                                    <li className="flex items-center gap-[6px]"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: P.accent }} />On time {r.present}</li>
                                    <li className="flex items-center gap-[6px]"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: P.accentDim }} />Late {r.late}</li>
                                    <li className="flex items-center gap-[6px]"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ boxShadow: `inset 0 0 0 1.5px ${P.text3}` }} />Absent {r.absent}</li>
                                </ul>
                                <p className="mt-[8px] text-[12px]" style={{ color: P.text3 }}>{r.shortTomorrow} short tomorrow. Most absent: {r.worst.name}.</p>
                            </>
                        )}
                    </Fed>
                </div>
            </Block>

            <Block id={ids.compliance} title="Compliance" right={<Sample feed={m.ppm} dark />}>
                <div className="rounded-[22px] p-[16px]" style={{ background: P.card }}>
                    <Fed feed={m.ppm} dark rows={2} height={16}>
                        {p => (
                            <div className="flex items-center gap-[12px]">
                                <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: P.accent }} aria-hidden />
                                <span className="min-w-0 flex-1 text-[13px]"><b className="text-[15px]" style={fig}>{p.pct}%</b> PPM on time<span className="block text-[12px]" style={{ color: P.text3 }}>target {p.target}%, {p.overdue} overdue, {p.dueToday} due today</span></span>
                            </div>
                        )}
                    </Fed>
                    <Fed feed={m.amc} dark rows={1} height={40} className="mt-[14px]">
                        {list => list.length === 0 ? <p className="mt-[14px] text-[12.5px]" style={{ color: P.text2 }}>No AMC renewals in the next 30 days.</p> : (
                            <div className="mt-[16px]">
                                <span className="mb-[12px] flex items-center gap-[6px] text-[12.5px]" style={{ color: P.text2 }}>AMC renewals, next 30 days <Sample feed={m.amc} dark /></span>
                                <RenewalLine items={list} />
                                <ul className="flex flex-col gap-[4px] text-[12.5px]">
                                    {list.map(a => <li key={a.id} className="flex justify-between gap-[8px]"><span style={{ color: P.text2 }}>{a.asset}, {a.site}</span><b style={fig}>{a.days}d</b></li>)}
                                </ul>
                            </div>
                        )}
                    </Fed>
                </div>
            </Block>

            <Block id={`${uid}-today`} title="Today" right={<Sample feed={m.visitors} dark />}>
                <ul className="rounded-[22px] px-[16px]" style={{ background: P.card }}>
                    {([
                        { k: 'v', icon: Users, label: 'Visitors', node: <Fed feed={m.visitors} dark compact rows={1} height={14} className="w-[60px]">{v => <>{v.today}<span className="ml-[6px] text-[12px] font-normal" style={{ color: P.text3 }}>{v.inside} inside</span></>}</Fed> },
                        { k: 'r', icon: Presentation, label: 'Rooms booked', node: <Fed feed={m.rooms} dark compact rows={1} height={14} className="w-[60px]">{r => <>{r.pct}%</>}</Fed> },
                        { k: 'd', icon: Fuel, label: 'Lowest diesel tank', node: <Fed feed={m.diesel} dark compact rows={1} height={14} className="w-[60px]">{d => <>{d.lowTank.pct}%<span className="ml-[6px] text-[12px] font-normal" style={{ color: P.text3 }}>{d.lowTank.dg}</span></>}</Fed> },
                        { k: 'w', icon: Droplets, label: 'Water tankers', node: <Fed feed={m.water} dark compact rows={1} height={14} className="w-[60px]">{w => <>{w.tankers}</>}</Fed> },
                    ]).map((row, i, all) => (
                        <li key={row.k} className={cx('flex min-h-[52px] items-center gap-[12px]', i < all.length - 1 && 'border-b')} style={{ borderColor: P.border }}>
                            <row.icon className="h-[18px] w-[18px] shrink-0" style={{ color: P.accent }} aria-hidden />
                            <span className="flex-1 text-[13px]" style={{ color: P.text2 }}>{row.label}</span>
                            <span className="text-[15px] font-semibold tabular-nums">{row.node}</span>
                        </li>
                    ))}
                </ul>
            </Block>

            <div className="h-[24px]" />
            <nav aria-label="Main" className="sticky bottom-0 z-30 mt-auto flex justify-center px-[12px] pb-[14px] pt-[8px]" style={{ background: `linear-gradient(180deg, rgba(18,16,22,0) 0%, ${P.page} 45%)` }}>
                <div className="flex items-center gap-[4px] rounded-full p-[6px]" style={{ background: P.card2, boxShadow: '0 12px 30px rgba(0,0,0,0.45)' }}>
                    {TABS.map((t, i) => (
                        <button key={t.label} type="button" aria-label={t.label} aria-current={i === 0 ? 'page' : undefined} onClick={() => i !== 0 && m.previewAction(`Open ${t.label}`)}
                            className="inline-flex h-12 items-center justify-center gap-[8px] rounded-full text-[13px] font-semibold"
                            style={i === 0 ? { background: P.accent, color: P.onAccent, padding: '0 18px' } : { color: P.text2, width: 48 }}>
                            <t.icon className="h-5 w-5" aria-hidden />{i === 0 && <span>{t.label}</span>}
                        </button>
                    ))}
                </div>
            </nav>
        </div>
    );
}
