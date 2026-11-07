'use client';

import React, { useRef, useState } from 'react';
import {
    AlertTriangle, Bell, CheckCircle2, ChevronRight, Droplets, FileBarChart, Plus, Presentation, RotateCw, Search, ShieldAlert,
    ShieldCheck, Siren, Stamp, Users, Wallet,
} from 'lucide-react';
import { Donut, LineArea, Ring, SegmentBar, TipBox, useTip } from '../../lab/charts';
import { greeting, initials, num } from '../../lab/format';
import { RED, RED_TEXT } from '../../lab/status';
import { EmptyState, H, OfflineBanner, SkeletonRows, cx, listKeys } from '../../lab/ui';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { APPROVAL_ICONS, Fed, InlineError, Sample } from '../parts';
import { dayLabels, portfolioTrend, riskItems, type RiskItem } from '../derive';
import { healthOf, type Feed, type OrgSite } from '../useOrgModel';
import { C, QUEUES, QUEUE_COLORS, QUEUE_SHORT, fig, useApp, type Route } from './core';
import { Card, Pills, Row, Section } from './ui';

/**
 * Home: what changed, what waits on you, and where to go next. Every card, row and number
 * opens the screen behind it. The deeper detail (people, compliance, money) lives on its own
 * screens, so Home stays a short read.
 */

function CardHead({ title, onOpen, dark, feed }: { title: string; onOpen: () => void; dark?: boolean; feed: { sample: boolean } }) {
    return (
        <div className="flex items-center justify-between gap-[6px]">
            <span className="flex items-center gap-[6px] text-[13px] font-semibold" style={{ color: dark ? 'rgba(255,255,255,0.85)' : C.text2 }}>{title}<Sample feed={feed} dark={dark} /></span>
            <button type="button" onClick={onOpen} aria-label={`Open ${title}`} className="-mr-[6px] -mt-[6px] grid h-10 w-10 place-items-center rounded-full"
                style={{ background: dark ? 'rgba(255,255,255,0.16)' : C.track, color: dark ? '#FFFFFF' : C.accentDeep }}>
                <ChevronRight className="h-[18px] w-[18px]" aria-hidden />
            </button>
        </div>
    );
}

function HeroDeck() {
    const { m, pending, pendingTotal, push, go } = useApp();
    const scroller = useRef<HTMLDivElement>(null);
    const [index, setIndex] = useState(0);
    const days = dayLabels(m.now, 7);
    const cards = ['Active tickets', 'Waiting on you', 'Budget this month'];

    const onScroll = () => {
        const el = scroller.current;
        const first = el?.firstElementChild as HTMLElement | null;
        if (!el || !first) return;
        setIndex(Math.max(0, Math.min(cards.length - 1, Math.round(el.scrollLeft / (first.offsetWidth + 10)))));
    };
    const goTo = (i: number) => {
        const el = scroller.current;
        const card = el?.children[i] as HTMLElement | undefined;
        if (el && card) el.scrollTo({ left: card.offsetLeft - 16, behavior: 'smooth' });
    };
    const queues = QUEUES.filter(q => (pending[q] ?? 0) > 0);

    return (
        <div>
            <div ref={scroller} onScroll={onScroll} className="lab-scroll-x flex snap-x snap-mandatory gap-[10px] overflow-x-auto px-[16px] pb-[4px]" aria-label="Highlights" role="group">
                <section aria-label={cards[0]} className="flex w-[84%] shrink-0 snap-center flex-col rounded-[24px] p-[16px] text-white" style={{ background: `linear-gradient(150deg, #3D6BF0 0%, ${C.accent} 45%, ${C.accentDeep} 100%)` }}>
                    <CardHead title={cards[0]} dark feed={m.sites} onOpen={() => go({ name: 'sites', sort: 'active' })} />
                    <Fed feed={m.sites} dark rows={3} height={30} className="mt-[10px]">
                        {sites => {
                            if (sites.length === 0) return <p className="mt-[10px] text-[14px] text-white/85">No properties yet.</p>;
                            const week = portfolioTrend(sites, 7);
                            const change = week[6] - week[0];
                            return (
                                <>
                                    <span className="mt-[2px] flex items-end gap-[10px]">
                                        <span className="text-[52px] leading-none" style={fig}>{num(week[6])}</span>
                                        <span className="pb-[6px] text-[12.5px] font-semibold text-white/85">{change === 0 ? 'same as a week ago' : `${change > 0 ? '+' : ''}${change} in 7 days`}</span>
                                    </span>
                                    <Fed feed={m.tickets} dark compact rows={1} height={14}>
                                        {t => t.breached > 0 ? (
                                            <button type="button" onClick={() => go({ name: 'approvals', queue: 'escalation' })}
                                                className="mt-[10px] inline-flex h-9 w-fit items-center gap-[6px] rounded-full bg-white px-[12px] text-[12.5px] font-semibold" style={{ color: RED_TEXT }}>
                                                <Siren className="h-3.5 w-3.5" style={{ color: RED }} aria-hidden />{t.breached} past SLA<ChevronRight className="h-3.5 w-3.5" aria-hidden />
                                            </button>
                                        ) : <span className="mt-[10px] inline-flex items-center gap-[6px] text-[12.5px] text-white/85"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Nothing past SLA</span>}
                                    </Fed>
                                    <div className="mt-[8px]">
                                        <LineArea data={week.map((v, i) => ({ label: days[i].long, value: v }))} color="#FFFFFF" height={88} fillOpacity={0.14} fitRange
                                            gridColor="rgba(255,255,255,0.18)" textColor="rgba(255,255,255,0.85)" keyColor="#FFFFFF"
                                            xLabels={[{ index: 0, text: days[0].short }, { index: 6, text: 'Today' }]}
                                            ariaLabel={`Active tickets, last 7 days, today ${week[6]}`} />
                                    </div>
                                </>
                            );
                        }}
                    </Fed>
                </section>

                <section aria-label={cards[1]} className="w-[84%] shrink-0 snap-center rounded-[24px] p-[16px]" style={{ background: C.card }}>
                    <CardHead title={cards[1]} feed={m.waiting} onOpen={() => go({ name: 'approvals' })} />
                    <Fed feed={m.waiting} rows={3} height={30} className="mt-[10px]">
                        {() => (
                            <div className="mt-[10px] flex items-center gap-[14px]">
                                <Donut size={112} thickness={14} gapDeg={4} ariaLabel={queues.map(q => `${QUEUE_SHORT[q]} ${pending[q]}`).join(', ') || 'Nothing waiting'}
                                    segments={queues.length ? queues.map(q => ({ label: QUEUE_SHORT[q], value: pending[q] ?? 0, color: QUEUE_COLORS[q] })) : [{ label: 'Nothing waiting', value: 1, color: C.track }]}>
                                    <span className="text-center"><span className="block text-[30px] leading-none" style={fig}>{pendingTotal ?? 0}</span><span className="text-[11px]" style={{ color: C.text3 }}>waiting</span></span>
                                </Donut>
                                <ul aria-label="Legend" className="flex min-w-0 flex-1 flex-col gap-[2px] text-[12.5px]">
                                    {queues.map(q => (
                                        <li key={q}>
                                            <button type="button" onClick={() => go({ name: 'approvals', queue: q })} className="flex h-8 w-full items-center gap-[8px] rounded-[8px] text-left">
                                                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: QUEUE_COLORS[q] }} />
                                                <span className="min-w-0 flex-1 truncate" style={{ color: C.text2 }}>{QUEUE_SHORT[q]}</span>
                                                <b style={fig}>{pending[q]}</b>
                                            </button>
                                        </li>
                                    ))}
                                    {queues.length === 0 && <li style={{ color: C.text2 }}>Nothing is waiting on you.</li>}
                                </ul>
                            </div>
                        )}
                    </Fed>
                </section>

                <section aria-label={cards[2]} className="w-[84%] shrink-0 snap-center rounded-[24px] p-[16px]" style={{ background: C.card }}>
                    <CardHead title={cards[2]} feed={m.budget} onOpen={() => push({ name: 'money' })} />
                    <Fed feed={m.budget} rows={3} height={30} className="mt-[10px]">
                        {b => (
                            <div className="mt-[10px] flex items-center gap-[14px]">
                                <Ring value={b.pct / 100} size={112} stroke={14} color={C.accent} track={C.track} tipText={`${inr(b.spent, { compact: true })} of ${inr(b.total, { compact: true })}`} ariaLabel={`Budget used ${b.pct}%`}>
                                    <span className="text-[28px] leading-none" style={fig}>{b.pct}%</span>
                                </Ring>
                                <div className="min-w-0 flex-1 text-[12.5px]" style={{ color: C.text2 }}>
                                    <b className="block text-[15px]" style={{ ...fig, color: C.text }}>{inr(b.spent, { compact: true })}</b>
                                    spent of {inr(b.total, { compact: true })}
                                    {b.overSites.length > 0 && <span className="mt-[8px] flex items-start gap-[5px]"><AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0" aria-hidden />{b.overSites.length} {b.overSites.length === 1 ? 'site' : 'sites'} over budget</span>}
                                </div>
                            </div>
                        )}
                    </Fed>
                </section>
            </div>
            <div className="flex justify-center" role="tablist" aria-label="Highlight cards">
                {cards.map((c, i) => (
                    <button key={c} type="button" role="tab" aria-selected={index === i} aria-label={c} onClick={() => goTo(i)} className="grid h-10 place-items-center px-[3px]">
                        <span className="block h-[6px] rounded-full transition-all" style={{ width: index === i ? 22 : 6, background: index === i ? C.accent : '#C3CAD9' }} />
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ------------------------------------------------------- needs you list */

type Filter = 'all' | 'approvals' | 'risks';

function riskRoute(r: RiskItem, site: (name: string) => OrgSite | null, oldestSite: string | null): Route | null {
    if (r.key === 'sla') return { name: 'approvals', queue: 'escalation' };
    if (r.key === 'rounds' || r.key === 'amc') return { name: 'compliance' };
    if (r.key === 'diesel' || r.key === 'bills') return { name: 'money' };
    if (r.key === 'oldest' && oldestSite) { const s = site(oldestSite); return s ? { name: 'site', id: s.id } : null; }
    return null;
}

function NeedsYou() {
    const { m, pending, push, go, siteByName } = useApp();
    const [filter, setFilter] = useState<Filter>('all');
    const [more, setMore] = useState(false);
    const queues = m.approvals.flatMap((a, i) => {
        const q = QUEUES[i];
        return a.state === 'ready' && a.data && (pending[q] ?? 0) > 0 ? [{ a: a.data, q, count: pending[q] ?? 0, sample: a.sample }] : [];
    });
    const risk = riskItems(m);
    const showQ = filter !== 'risks';
    const showR = filter !== 'approvals';
    const loading = (showQ && m.waiting.state === 'loading') || (showR && risk.loading && risk.items.length === 0);
    const failed: Feed<unknown>[] = [...(showQ && m.waiting.state === 'error' ? [m.waiting] : []), ...(showR ? risk.failed : [])];
    const counts: Record<Filter, number> = { all: queues.length + risk.items.length, approvals: queues.length, risks: risk.items.length };
    const limit = more ? Infinity : 5;
    const riskRows = showR ? risk.items.slice(0, limit) : [];
    const queueRows = showQ ? queues.slice(0, Math.max(0, limit - riskRows.length)) : [];
    const known = !loading && failed.length === 0;

    return (
        <Section title="Needs you" right={<Sample feed={{ sample: queues.some(q => q.sample) || risk.items.some(r => r.sample) }} />}>
            <Pills className="-mx-[16px] mb-[10px]" label="Show" value={filter} onChange={setFilter}
                options={[{ id: 'all', label: 'All', count: known ? counts.all : null }, { id: 'approvals', label: 'Approvals', count: known ? counts.approvals : null }, { id: 'risks', label: 'Risks', count: known ? counts.risks : null }]} />
            <Card className="p-[6px]">
                {failed.length > 0 && <InlineError onRetry={() => failed.forEach(f => f.retry())} className="px-[10px] py-[8px]" />}
                {loading ? <div className="p-[8px]"><SkeletonRows rows={4} height={52} gap={8} /></div> : (
                    <ul onKeyDown={listKeys}>
                        {riskRows.map(r => {
                            const to = riskRoute(r, siteByName, m.oldestOpen.data?.site ?? null);
                            return (
                                <li key={r.key}>
                                    <Row icon={r.icon} red={r.red} title={r.title} sub={r.meta} label={r.title}
                                        onClick={() => (to ? (to.name === 'approvals' ? go(to) : push(to)) : m.previewAction(`Open ${r.title}`))} />
                                </li>
                            );
                        })}
                        {queueRows.map(({ a, q, count }) => (
                            <li key={q}>
                                <Row icon={APPROVAL_ICONS[q]} title={a.label} sub={`${a.detail}${a.value ? `, ${a.value}` : ''}`} label={`${a.label}, ${count}`} onClick={() => go({ name: 'approvals', queue: q })}
                                    right={<span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-[8px] text-[12.5px] font-bold" style={{ background: C.tint, color: C.accentDeep }}>{count}</span>} />
                            </li>
                        ))}
                        {counts[filter] > 5 && (
                            <li>
                                <button type="button" onClick={() => setMore(v => !v)} className="h-11 w-full rounded-[14px] text-[13px] font-semibold" style={{ color: C.accentDeep }}>
                                    {more ? 'Show fewer' : `Show all ${counts[filter]}`}
                                </button>
                            </li>
                        )}
                        {counts[filter] === 0 && failed.length === 0 && (
                            <li className="flex items-center gap-[8px] px-[12px] py-[16px] text-[13px]" style={{ color: C.text2 }}><CheckCircle2 className="h-4 w-4" aria-hidden />Nothing here right now.</li>
                        )}
                    </ul>
                )}
            </Card>
        </Section>
    );
}

/* ------------------------------------------------------------ sites */

export function SiteBars({ sites, onOpen }: { sites: OrgSite[]; onOpen: (s: OrgSite) => void }) {
    const { host, tip, show, hide } = useTip();
    return (
        <div ref={host} className="relative" onMouseLeave={hide}>
            <ul className="flex flex-col gap-[8px]" onKeyDown={listKeys} aria-label="Site scores out of 100">
                {sites.map(s => {
                    const weak = s.score < 85;
                    return (
                        <li key={s.id}>
                            <button type="button" data-lab-item onClick={() => onOpen(s)} aria-label={`${s.name}, score ${s.score}${weak ? ', needs attention' : ''}`}
                                className="relative flex h-11 w-full items-center rounded-full text-left" style={{ background: C.card }}
                                onMouseEnter={e => show(e.currentTarget, <span>{s.name}: <b>{s.score}</b>, {s.active} active, {s.urgent} urgent</span>)}>
                                <span aria-hidden className="absolute inset-y-[8px] left-[8px] rounded-full" style={{ width: `calc(${s.score}% - 16px)`, background: weak ? C.barWarn : C.bar }} />
                                <span className="relative flex min-w-0 flex-1 items-center gap-[6px] pl-[18px] text-[13px] font-semibold">
                                    {weak && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                                    <span className="truncate">{s.name}</span>
                                </span>
                                <span className="relative pr-[16px] text-[14px]" style={fig}>{s.score}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <TipBox tip={tip} />
        </div>
    );
}

/* ------------------------------------------------------ at a glance */

function Glance() {
    const { m, push } = useApp();
    const rows: { key: string; icon: typeof Users; title: string; feed: Feed<unknown>; to: Route; body: React.ReactNode }[] = [
        {
            key: 'people', icon: Users, title: 'People on shift', feed: m.roster as Feed<unknown>, to: { name: 'people' },
            body: m.roster.data && (
                <>
                    <span className="flex items-baseline justify-between gap-[8px]"><span className="text-[13.5px] font-semibold">People on shift</span><span className="text-[15px]" style={fig}>{m.roster.data.present}<span className="text-[12px] font-semibold" style={{ color: C.text3 }}> of {m.roster.data.scheduled}</span></span></span>
                    <SegmentBar className="mt-[8px]" height={8} gap={2} ariaLabel={`On time ${m.roster.data.present}, late ${m.roster.data.late}, absent ${m.roster.data.absent}`}
                        segments={[{ label: 'On time', value: m.roster.data.present, color: C.accent }, { label: 'Late', value: m.roster.data.late, color: C.barWarn }, { label: 'Absent', value: m.roster.data.absent, color: C.muted }]} />
                </>
            ),
        },
        {
            key: 'ppm', icon: ShieldCheck, title: 'PPM on time', feed: m.ppm as Feed<unknown>, to: { name: 'compliance' },
            body: m.ppm.data && (
                <>
                    <span className="flex items-baseline justify-between gap-[8px]"><span className="text-[13.5px] font-semibold">PPM on time</span><span className="text-[15px]" style={fig}>{m.ppm.data.pct}%<span className="text-[12px] font-semibold" style={{ color: C.text3 }}> target {m.ppm.data.target}%</span></span></span>
                    <span className="relative mt-[8px] block h-[8px] rounded-full" style={{ background: C.track }}>
                        <span className="block h-full rounded-full" style={{ width: `${m.ppm.data.pct}%`, background: C.accent }} />
                        <span aria-hidden className="absolute -top-[3px] h-[14px] w-[2px] rounded" style={{ left: `${m.ppm.data.target}%`, background: C.text }} />
                    </span>
                </>
            ),
        },
        {
            key: 'money', icon: Wallet, title: 'Budget used', feed: m.budget as Feed<unknown>, to: { name: 'money' },
            body: m.budget.data && (
                <>
                    <span className="flex items-baseline justify-between gap-[8px]"><span className="text-[13.5px] font-semibold">Budget used</span><span className="text-[15px]" style={fig}>{m.budget.data.pct}%<span className="text-[12px] font-semibold" style={{ color: C.text3 }}> of {inr(m.budget.data.total, { compact: true })}</span></span></span>
                    <span className="mt-[8px] block h-[8px] rounded-full" style={{ background: C.track }}><span className="block h-full rounded-full" style={{ width: `${Math.min(100, m.budget.data.pct)}%`, background: C.accent }} /></span>
                </>
            ),
        },
    ];
    return (
        <Section title="At a glance" right={<Sample feed={m.roster} />}>
            <Card className="px-[6px] py-[4px]">
                <ul>
                    {rows.map((r, i) => (
                        <li key={r.key} className={cx(i > 0 && 'border-t')} style={{ borderColor: C.border }}>
                            {r.feed.state === 'ready' && r.body ? (
                                <button type="button" onClick={() => push(r.to)} aria-label={`Open ${r.title}`} className="flex min-h-[66px] w-full items-center gap-[12px] rounded-[16px] px-[10px] py-[10px] text-left">
                                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: C.tint }}><r.icon className="h-[18px] w-[18px]" style={{ color: C.accentDeep }} aria-hidden /></span>
                                    <span className="min-w-0 flex-1">{r.body}</span>
                                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.text3 }} aria-hidden />
                                </button>
                            ) : (
                                <div className="flex min-h-[66px] items-center gap-[12px] px-[10px] py-[10px]">
                                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: C.tint }}><r.icon className="h-[18px] w-[18px]" style={{ color: C.accentDeep }} aria-hidden /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[13.5px] font-semibold">{r.title}</span>
                                        <Fed feed={r.feed} rows={1} height={8} compact className="mt-[6px]">{() => null}</Fed>
                                    </span>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </Card>
        </Section>
    );
}

function Cell<T>({ feed, icon: Icon, value, sub, divider }: { feed: Feed<T>; icon: typeof Users; value: (d: T) => string; sub: (d: T) => string; divider?: boolean }) {
    return (
        <div className={cx('flex flex-col items-center px-[6px] text-center', divider && 'border-l')} style={{ borderColor: C.border }}>
            <Icon className="h-4 w-4" style={{ color: C.accentDeep }} aria-hidden />
            <Fed feed={feed} compact rows={1} height={20}>
                {d => <><span className="mt-[4px] text-[19px]" style={fig}>{value(d)}</span><span className="text-[11.5px]" style={{ color: C.text3 }}>{sub(d)}</span></>}
            </Fed>
        </div>
    );
}

/* ------------------------------------------------------------ screen */

export function HomeScreen() {
    const { m, push, go, openSheet, unread, refresh, refreshing, updatedLabel } = useApp();
    const health = m.sites.data ? healthOf(m.sites.data) : null;
    return (
        <div>
            <header className="flex items-center gap-[10px] px-[16px] pb-[6px] pt-[10px]">
                <button type="button" onClick={() => go({ name: 'more' })} aria-label="Your profile" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[14px] font-bold text-white" style={{ background: C.accent }}>{initials(m.user.name)}</button>
                <span className="min-w-0 flex-1">
                    <H level={1} className="truncate text-[17px] font-bold tracking-[-0.02em]"><span data-screen-title tabIndex={-1} className="outline-none">{greeting(m.now)}, {m.user.firstName}</span></H>
                    <span className="block truncate text-[12px]" style={{ color: C.text3 }}>{m.orgName}</span>
                </span>
                <button type="button" aria-label="Search" onClick={() => push({ name: 'search' })} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: C.card }}><Search className="h-[18px] w-[18px]" aria-hidden /></button>
                <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => push({ name: 'notifications' })} className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: C.card }}>
                    <Bell className="h-[18px] w-[18px]" aria-hidden />
                    {unread > 0 && <span aria-hidden className="absolute right-[5px] top-[5px] grid h-[18px] min-w-[18px] place-items-center rounded-full px-[4px] text-[10.5px] font-bold text-white" style={{ background: C.accent, boxShadow: `0 0 0 2px ${C.page}` }}>{unread}</span>}
                </button>
            </header>

            <div className="flex items-center gap-[8px] px-[16px] pb-[10px] text-[12px]" style={{ color: C.text3 }}>
                <span className="min-w-0 flex-1 truncate">{health && health.count ? `All ${health.count} sites, average score ${health.score}` : 'All sites'}</span>
                <button type="button" onClick={refresh} disabled={refreshing} aria-label="Refresh" className="-mr-[8px] inline-flex h-9 items-center gap-[6px] rounded-full px-[10px] font-semibold" style={{ color: C.accentDeep }}>
                    <RotateCw className={cx('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden />{refreshing ? 'Refreshing' : updatedLabel}
                </button>
            </div>

            <OfflineBanner online={m.online} className="mx-[16px] mb-[10px]" style={{ background: C.card, borderRadius: 16 }} />
            <HeroDeck />

            <nav aria-label="Quick actions" className="mt-[4px] grid grid-cols-4 gap-[8px] px-[16px]">
                {([
                    ['Approve', Stamp, () => go({ name: 'approvals' })],
                    ['Escalations', ShieldAlert, () => go({ name: 'approvals', queue: 'escalation' })],
                    ['Raise', Plus, () => openSheet({ kind: 'create' })],
                    ['Report', FileBarChart, () => m.previewAction('Share the morning report')],
                ] as const).map(([label, Icon, onClick], i) => (
                    <button key={label} type="button" onClick={onClick} className="flex flex-col items-center gap-[6px] text-[12px] font-semibold" style={{ color: C.text2 }}>
                        <span className="grid h-14 w-14 place-items-center rounded-full" style={i === 0 ? { background: C.accent, color: '#FFFFFF' } : { background: C.card, color: C.accentDeep, boxShadow: `inset 0 0 0 1px ${C.border}` }}>
                            <Icon className="h-5 w-5" aria-hidden />
                        </span>
                        {label}
                    </button>
                ))}
            </nav>

            <NeedsYou />

            <Section title="Sites by score" right={<Sample feed={m.sites} />} more={m.sites.data && m.sites.data.length > 3 ? { label: `All ${m.sites.data.length}`, onClick: () => go({ name: 'sites' }) } : undefined}>
                <Fed feed={m.sites} rows={3} height={44}>
                    {sites => sites.length === 0
                        ? <Card><EmptyState compact title="No properties yet" body="Add a property to see its score." actionLabel="Add property" onAction={() => m.previewAction('Add property')} /></Card>
                        : <SiteBars sites={sites.slice(0, 3)} onOpen={s => push({ name: 'site', id: s.id })} />}
                </Fed>
            </Section>

            <Glance />

            <Section title="Today" right={<Sample feed={m.visitors} />}>
                <Card className="grid grid-cols-3 py-[14px]">
                    <Cell feed={m.visitors} icon={Users} value={v => num(v.today)} sub={v => `visitors, ${v.inside} inside`} />
                    <Cell feed={m.rooms} icon={Presentation} value={r => `${r.pct}%`} sub={() => 'rooms booked'} divider />
                    <Cell feed={m.water} icon={Droplets} value={w => num(w.tankers)} sub={() => 'water tankers'} divider />
                </Card>
            </Section>
        </div>
    );
}
