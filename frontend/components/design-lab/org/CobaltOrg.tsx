'use client';

import React, { useRef, useState } from 'react';
import {
    AlertTriangle, Bell, Building2, CheckCircle2, ChevronRight, Droplets, FileBarChart, Home, ListChecks, Menu, Plus,
    Presentation, Search, ShieldCheck, Siren, Stamp, UserPlus, Users, Wallet, Zap,
} from 'lucide-react';
import { Donut, LineArea, Ring, SegmentBar, TipBox, useTip } from '../lab/charts';
import { themeVars, type LabTheme } from '../lab/frame';
import { greeting, initials, num } from '../lab/format';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { RED, RED_BG, RED_TEXT } from '../lab/status';
import { EmptyState, H, OfflineBanner, SkeletonRows, cx, listKeys, rowProps } from '../lab/ui';
import { APPROVAL_ICONS, Fed, InlineError, Sample } from './parts';
import { dayLabels, portfolioTrend, riskItems, QUEUE_NAMES } from './derive';
import { healthOf, type Feed, type OrgModel, type OrgSite } from './useOrgModel';

/**
 * Cobalt: light and friendly, one blue accent. A swipeable deck of three hero cards opens the
 * screen, round quick actions sit under it, and one filterable "Needs you" list holds every
 * approval and risk. Sites are thick bars with the name inside. Plus Jakarta Sans.
 */

const C = {
    page: '#F2F4F9',
    card: '#FFFFFF',
    tint: '#E7EDFD',
    accent: '#2B59E8',
    accentDeep: '#1E44C2',
    bar: '#C7D5FA',
    barWarn: '#93AEF6',
    text: '#0E1424',
    text2: '#485069',
    text3: '#5F677C',
    border: '#E2E6EF',
    track: '#EEF1F7',
};

const theme: LabTheme = {
    font: 'var(--font-lab-jakarta), "Plus Jakarta Sans", system-ui, sans-serif',
    page: C.page, surface: C.card, tile: C.track, border: C.border, borderStrong: '#CDD3E0', grid: '#EBEEF5',
    text: C.text, text2: C.text2, text3: C.text3, primary: C.accent, onPrimary: '#FFFFFF', tint: C.tint,
    ramp: ['#1E44C2', '#2B59E8', '#7D9BF2', '#C7D5FA'], radius: '22px', radiusSm: '14px', chipRadius: '999px', btnRadius: '999px',
    focus: C.accentDeep, skeletonA: '#EEF1F7', skeletonB: '#E1E6F0', tooltipBg: '#0E1424', tooltipFg: '#FFFFFF',
};

const fig: React.CSSProperties = { fontWeight: 700, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' };
const QUEUE_COLORS = { po: '#1E44C2', mr: '#2B59E8', petty: '#7D9BF2', escalation: '#C7D5FA' } as const;

function Section({ title, right, children, label }: { title: string; right?: React.ReactNode; children: React.ReactNode; label?: string }) {
    return (
        <section aria-label={label ?? title} className="px-[16px] pt-[22px]">
            <div className="mb-[10px] flex items-center justify-between gap-[8px]">
                <H level={2} className="text-[17px] font-bold tracking-[-0.02em]">{title}</H>
                <span className="flex items-center gap-[6px]">{right}</span>
            </div>
            {children}
        </section>
    );
}

/* ---------------------------------------------------------- hero deck */

function HeroDeck({ m }: { m: OrgModel }) {
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

    return (
        <div>
            <div ref={scroller} onScroll={onScroll} className="lab-scroll-x flex snap-x snap-mandatory gap-[10px] overflow-x-auto px-[16px] pb-[4px]" aria-label="Highlights" role="group">
                {/* 1. Active tickets: the one hero number on this screen */}
                <section aria-label={cards[0]} className="flex w-[84%] shrink-0 snap-center flex-col rounded-[24px] p-[16px] text-white" style={{ background: `linear-gradient(150deg, #3D6BF0 0%, ${C.accent} 45%, ${C.accentDeep} 100%)` }}>
                    <div className="flex items-center justify-between gap-[6px] text-[13px] font-semibold text-white/85">{cards[0]}<Sample feed={m.sites} dark /></div>
                    <Fed feed={m.sites} dark rows={3} height={30} className="mt-[10px]">
                        {sites => {
                            if (sites.length === 0) return <p className="mt-[10px] text-[14px] text-white/85">No properties yet.</p>;
                            const week = portfolioTrend(sites, 7);
                            return (
                                <>
                                    <span className="mt-[4px] text-[52px] leading-none" style={fig}>{num(week[6])}</span>
                                    <Fed feed={m.tickets} dark compact rows={1} height={14}>
                                        {t => t.breached > 0 ? (
                                            <span className="mt-[10px] inline-flex h-8 w-fit items-center gap-[6px] rounded-full bg-white px-[10px] text-[12.5px] font-semibold" style={{ color: RED_TEXT }}>
                                                <Siren className="h-3.5 w-3.5" style={{ color: RED }} aria-hidden />{t.breached} past SLA
                                            </span>
                                        ) : <span className="mt-[10px] inline-flex items-center gap-[6px] text-[12.5px] text-white/85"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Nothing past SLA</span>}
                                    </Fed>
                                    <div className="mt-[8px]">
                                        <LineArea data={week.map((v, i) => ({ label: days[i].long, value: v }))} color="#FFFFFF" height={92} fillOpacity={0.14} fitRange
                                            gridColor="rgba(255,255,255,0.18)" textColor="rgba(255,255,255,0.85)" keyColor="#FFFFFF"
                                            xLabels={[{ index: 0, text: days[0].short }, { index: 6, text: 'Today' }]}
                                            ariaLabel={`Active tickets, last 7 days, today ${week[6]}`} />
                                    </div>
                                </>
                            );
                        }}
                    </Fed>
                </section>

                {/* 2. Waiting on you: split of the four queues */}
                <section aria-label={cards[1]} className="w-[84%] shrink-0 snap-center rounded-[24px] p-[16px]" style={{ background: C.card }}>
                    <div className="flex items-center justify-between gap-[6px] text-[13px] font-semibold" style={{ color: C.text2 }}>{cards[1]}<Sample feed={m.waiting} /></div>
                    <Fed feed={m.waiting} rows={3} height={30} className="mt-[10px]">
                        {total => {
                            const queues = m.approvals.flatMap(a => (a.state === 'ready' && a.data && a.data.count > 0 ? [a.data] : []));
                            return (
                                <div className="mt-[10px] flex items-center gap-[14px]">
                                    <Donut size={112} thickness={14} gapDeg={4} ariaLabel={queues.map(q => `${QUEUE_NAMES[q.id]} ${q.count}`).join(', ') || 'Nothing waiting'}
                                        segments={queues.length ? queues.map(q => ({ label: QUEUE_NAMES[q.id], value: q.count, color: QUEUE_COLORS[q.id] })) : [{ label: 'Nothing waiting', value: 1, color: C.track }]}>
                                        <span className="text-center"><span className="block text-[30px] leading-none" style={fig}>{total}</span><span className="text-[11px]" style={{ color: C.text3 }}>waiting</span></span>
                                    </Donut>
                                    <ul aria-label="Legend" className="flex min-w-0 flex-1 flex-col gap-[6px] text-[12.5px]">
                                        {queues.map(q => (
                                            <li key={q.id} className="flex items-center gap-[8px]">
                                                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: QUEUE_COLORS[q.id] }} />
                                                <span className="min-w-0 flex-1 truncate" style={{ color: C.text2 }}>{QUEUE_NAMES[q.id]}</span>
                                                <b style={fig}>{q.count}</b>
                                            </li>
                                        ))}
                                        {queues.length === 0 && <li style={{ color: C.text2 }}>Nothing is waiting on you.</li>}
                                    </ul>
                                </div>
                            );
                        }}
                    </Fed>
                </section>

                {/* 3. Budget */}
                <section aria-label={cards[2]} className="w-[84%] shrink-0 snap-center rounded-[24px] p-[16px]" style={{ background: C.card }}>
                    <div className="flex items-center justify-between gap-[6px] text-[13px] font-semibold" style={{ color: C.text2 }}>{cards[2]}<Sample feed={m.budget} /></div>
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

function NeedsYou({ m }: { m: OrgModel }) {
    const [filter, setFilter] = useState<Filter>('all');
    const [more, setMore] = useState(false);
    const queues = m.approvals.flatMap(a => (a.state === 'ready' && a.data && a.data.count > 0 ? [{ a: a.data, sample: a.sample }] : []));
    const risk = riskItems(m);
    const showQ = filter !== 'risks';
    const showR = filter !== 'approvals';
    const loading = (showQ && m.waiting.state === 'loading') || (showR && risk.loading && risk.items.length === 0);
    const failed = [...(showQ && m.waiting.state === 'error' ? [m.waiting] : []), ...(showR ? risk.failed : [])];
    const counts: Record<Filter, number> = { all: queues.length + risk.items.length, approvals: queues.length, risks: risk.items.length };
    // Risks first, then approvals; five rows unless the list is opened up.
    const limit = more ? Infinity : 5;
    const riskRows = showR ? risk.items.slice(0, limit) : [];
    const queueRows = showQ ? queues.slice(0, Math.max(0, limit - riskRows.length)) : [];
    const hidden = counts[filter] - riskRows.length - queueRows.length;

    return (
        <Section title="Needs you" right={<Sample feed={{ sample: queues.some(q => q.sample) || risk.items.some(r => r.sample) }} />}>
            <div role="radiogroup" aria-label="Show" className="mb-[10px] flex gap-[6px]">
                {(['all', 'approvals', 'risks'] as Filter[]).map(f => (
                    <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}
                        className="inline-flex h-10 items-center gap-[6px] rounded-full px-[14px] text-[13px] font-semibold capitalize"
                        style={filter === f ? { background: C.text, color: '#FFFFFF' } : { background: C.card, color: C.text2, boxShadow: `inset 0 0 0 1px ${C.border}` }}>
                        {f}{!loading && failed.length === 0 && <span className="tabular-nums opacity-70">{counts[f]}</span>}
                    </button>
                ))}
            </div>
            <div className="rounded-[22px] p-[6px]" style={{ background: C.card }}>
                {failed.length > 0 && <InlineError onRetry={() => failed.forEach(f => f.retry())} className="px-[10px] py-[8px]" />}
                {loading ? <div className="p-[8px]"><SkeletonRows rows={4} height={52} gap={8} /></div> : (
                    <ul onKeyDown={listKeys}>
                        {riskRows.map(r => (
                            <li key={r.key}>
                                <div {...rowProps(() => m.previewAction(`Open ${r.title}`), r.title)} className="flex min-h-[60px] items-center gap-[12px] rounded-[16px] px-[10px] py-[8px]">
                                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: r.red ? RED_BG : C.tint }}>
                                        <r.icon className="h-[18px] w-[18px]" style={{ color: r.red ? RED : C.accentDeep }} aria-hidden />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[13.5px] font-semibold leading-snug" style={{ color: r.red ? RED_TEXT : C.text }}>{r.title}</span>
                                        <span className="block truncate text-[12px]" style={{ color: C.text3 }}>{r.meta}</span>
                                    </span>
                                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: C.text3 }} aria-hidden />
                                </div>
                            </li>
                        ))}
                        {queueRows.map(({ a }) => {
                            const Icon = APPROVAL_ICONS[a.id];
                            return (
                                <li key={a.id}>
                                    <div {...rowProps(() => m.previewAction(`${a.action} ${a.label.toLowerCase()}`), a.label)} className="flex min-h-[60px] items-center gap-[12px] rounded-[16px] px-[10px] py-[8px]">
                                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: C.tint }}><Icon className="h-[18px] w-[18px]" style={{ color: C.accentDeep }} aria-hidden /></span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-[13.5px] font-semibold leading-snug">{a.label}</span>
                                            <span className="block truncate text-[12px]" style={{ color: C.text3 }}>{a.detail}{a.value ? `, ${a.value}` : ''}</span>
                                        </span>
                                        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-[8px] text-[12.5px] font-bold" style={{ background: C.tint, color: C.accentDeep }}>{a.count}</span>
                                    </div>
                                </li>
                            );
                        })}
                        {(hidden > 0 || more) && counts[filter] > 5 && (
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
            </div>
        </Section>
    );
}

/* ------------------------------------------------------------ sites */

function SiteBars({ sites, onOpen }: { sites: OrgSite[]; onOpen: (s: OrgSite) => void }) {
    const { host, tip, show, hide } = useTip();
    return (
        <div ref={host} className="relative" onMouseLeave={hide}>
            <ul className="flex flex-col gap-[8px]" onKeyDown={listKeys} aria-label="Site scores out of 100">
                {sites.map(s => {
                    const weak = s.score < 85;
                    return (
                        <li key={s.id}>
                            <div {...rowProps(() => onOpen(s), `${s.name}, score ${s.score}`)} className="relative flex h-10 items-center rounded-full"
                                style={{ background: C.track }} onMouseEnter={e => show(e.currentTarget, <span>{s.name}: <b>{s.score}</b>, {s.active} active, {s.urgent} urgent</span>)}>
                                <span aria-hidden className="absolute inset-y-[8px] left-[8px] rounded-full" style={{ width: `calc(${s.score}% - 16px)`, background: weak ? C.barWarn : C.bar }} />
                                <span className="relative flex min-w-0 flex-1 items-center gap-[6px] pl-[18px] text-[13px] font-semibold">
                                    {weak && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                                    <span className="truncate">{s.name}</span>
                                    {weak && <span className="sr-only">needs attention</span>}
                                </span>
                                <span className="relative pr-[16px] text-[14px]" style={fig}>{s.score}</span>
                            </div>
                        </li>
                    );
                })}
            </ul>
            <TipBox tip={tip} />
        </div>
    );
}

function Cell<T>({ feed, icon: Icon, value, sub, divider }: { feed: Feed<T>; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; value: (d: T) => string; sub: (d: T) => string; divider?: boolean }) {
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

const TABS = [
    { label: 'Home', icon: Home }, { label: 'Approvals', icon: ListChecks }, null, { label: 'Sites', icon: Building2 }, { label: 'More', icon: Menu },
] as const;

export default function CobaltOrg({ m }: { m: OrgModel }) {
    const health = m.sites.data ? healthOf(m.sites.data) : null;
    return (
        <div className="lab-root relative flex min-h-full flex-col" style={{ ...themeVars(theme), background: C.page }}>
            <header className="flex items-center gap-[10px] px-[16px] pb-[14px]" style={{ paddingTop: 'calc(var(--org-safe-top, 0px) + 10px)' }}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[14px] font-bold text-white" style={{ background: C.accent }}>{initials(m.user.name)}</span>
                <span className="min-w-0 flex-1">
                    <H level={1} className="truncate text-[17px] font-bold tracking-[-0.02em]">{greeting(m.now)}, {m.user.firstName}</H>
                    <span className="block truncate text-[12px]" style={{ color: C.text3 }}>{m.orgName}{health && health.count ? `, ${health.count} sites, score ${health.score}` : ''}</span>
                </span>
                <button type="button" aria-label="Search" onClick={() => m.previewAction('Search')} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: C.card }}><Search className="h-[18px] w-[18px]" aria-hidden /></button>
                <button type="button" aria-label="Notifications" onClick={() => m.previewAction('Notifications')} className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: C.card }}>
                    <Bell className="h-[18px] w-[18px]" aria-hidden /><span className="absolute right-[11px] top-[10px] h-2 w-2 rounded-full" style={{ background: C.accent }} />
                </button>
            </header>

            <OfflineBanner online={m.online} className="mx-[16px] mb-[10px]" style={{ background: C.card, borderRadius: 16 }} />
            <HeroDeck m={m} />

            <nav aria-label="Quick actions" className="mt-[6px] grid grid-cols-4 gap-[8px] px-[16px]">
                {([['Approve', Stamp], ['Assign', UserPlus], ['Raise', Plus], ['Report', FileBarChart]] as const).map(([label, Icon], i) => (
                    <button key={label} type="button" onClick={() => m.previewAction(label === 'Raise' ? 'Raise a ticket' : label)} className="flex flex-col items-center gap-[6px] text-[12px] font-semibold" style={{ color: C.text2 }}>
                        <span className="grid h-14 w-14 place-items-center rounded-full" style={i === 0 ? { background: C.accent, color: '#FFFFFF' } : { background: C.card, color: C.accentDeep, boxShadow: `inset 0 0 0 1px ${C.border}` }}>
                            <Icon className="h-5 w-5" aria-hidden />
                        </span>
                        {label}
                    </button>
                ))}
            </nav>

            <NeedsYou m={m} />

            <Section title="Sites by score" right={<><Sample feed={m.sites} /><span className="text-[12px]" style={{ color: C.text3 }}>worst first</span></>}>
                <Fed feed={m.sites} rows={5} height={40}>
                    {sites => sites.length === 0
                        ? <EmptyState compact title="No properties yet" body="Add a property to see its score." actionLabel="Add property" onAction={() => m.previewAction('Add property')} />
                        : <SiteBars sites={sites} onOpen={s => m.previewAction(`Open ${s.name}`)} />}
                </Fed>
            </Section>

            <Section title="People on shift" right={<Sample feed={m.roster} />}>
                <div className="rounded-[22px] p-[16px]" style={{ background: C.card }}>
                    <Fed feed={m.roster} rows={3} height={18}>
                        {r => (
                            <>
                                <div className="flex items-baseline justify-between gap-[8px]">
                                    <span className="text-[26px] leading-none" style={fig}>{r.present}<span className="text-[14px] font-semibold" style={{ color: C.text3 }}> of {r.scheduled} present</span></span>
                                    <span className="text-[12.5px] font-semibold" style={{ color: C.accentDeep }}>{r.coveragePct}% coverage</span>
                                </div>
                                <SegmentBar className="mt-[12px]" height={12} gap={3} ariaLabel={`On time ${r.present}, late ${r.late}, absent ${r.absent}`}
                                    segments={[{ label: 'On time', value: r.present, color: C.accent }, { label: 'Late', value: r.late, color: C.barWarn }, { label: 'Absent', value: r.absent, color: '#D5DAE5' }]} />
                                <ul aria-label="Legend" className="mt-[10px] flex flex-wrap gap-x-[14px] gap-y-[4px] text-[12px]" style={{ color: C.text2 }}>
                                    {([['On time', r.present, C.accent], ['Late', r.late, C.barWarn], ['Absent', r.absent, '#D5DAE5']] as const).map(([l, v, c]) => (
                                        <li key={l} className="flex items-center gap-[6px]"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l} <b style={{ ...fig, color: C.text }}>{v}</b></li>
                                    ))}
                                </ul>
                                <p className="mt-[10px] flex items-center gap-[6px] text-[12px]" style={{ color: C.text3 }}><Users className="h-3.5 w-3.5" aria-hidden />{r.shortTomorrow} short tomorrow. Most absent: {r.worst.name}.</p>
                            </>
                        )}
                    </Fed>
                    <Fed feed={m.grievances} rows={1} height={14} className="mt-[10px]">
                        {g => <p className="mt-[10px] border-t pt-[10px] text-[12.5px]" style={{ borderColor: C.border, color: C.text2 }}><b style={{ color: C.text }}>{g.open}</b> HR grievances open, oldest {g.oldestDays} days <Sample feed={m.grievances} /></p>}
                    </Fed>
                </div>
            </Section>

            <Section title="Compliance" right={<Sample feed={m.ppm} />}>
                <div className="rounded-[22px] p-[16px]" style={{ background: C.card }}>
                    <Fed feed={m.ppm} rows={2} height={16}>
                        {p => (
                            <>
                                <div className="flex items-center justify-between text-[13px] font-semibold"><span className="flex items-center gap-[6px]"><ShieldCheck className="h-4 w-4" style={{ color: C.accentDeep }} aria-hidden />PPM done on time</span><span style={fig}>{p.pct}%</span></div>
                                <div className="relative mt-[10px] h-[10px] rounded-full" style={{ background: C.track }} role="meter" aria-label="PPM done on time" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100}>
                                    <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: C.accent }} />
                                    <span aria-hidden className="absolute -top-[4px] h-[18px] w-[2px] rounded" style={{ left: `${p.target}%`, background: C.text }} />
                                </div>
                                <p className="mt-[6px] text-[12px]" style={{ color: C.text3 }}>Target {p.target}%. {p.overdue} overdue, {p.dueToday} due today. Most overdue: {p.worstSystem.name}.</p>
                            </>
                        )}
                    </Fed>
                    <Fed feed={m.amc} rows={1} height={36} className="mt-[12px]">
                        {list => list.length === 0 ? <p className="mt-[12px] text-[12.5px]" style={{ color: C.text2 }}>No AMC renewals in the next 30 days.</p> : (
                            <div className="mt-[14px]">
                                <span className="flex items-center gap-[6px] text-[12.5px] font-semibold" style={{ color: C.text2 }}>AMC renewals <Sample feed={m.amc} /></span>
                                <div className="lab-scroll-x -mx-[4px] mt-[8px] flex gap-[6px] overflow-x-auto px-[4px]">
                                    {list.map(a => (
                                        <button key={a.id} type="button" onClick={() => m.previewAction(`Renew ${a.asset} AMC`)} className="inline-flex h-10 shrink-0 items-center gap-[6px] rounded-full px-[12px] text-[12.5px] font-semibold" style={{ background: C.tint, color: C.accentDeep }}>
                                            {a.asset}, {a.site.split(' ')[0]} <span className="rounded-full bg-white px-[6px] py-[1px] text-[11.5px]" style={{ color: C.text }}>{a.days}d</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Fed>
                </div>
            </Section>

            <Section title="This month" right={<Sample feed={m.elec} />}>
                <ul className="rounded-[22px] px-[16px]" style={{ background: C.card }} aria-label="Money and utilities">
                    <li className="flex min-h-[56px] items-center gap-[12px] border-b py-[8px]" style={{ borderColor: C.border }}>
                        <Wallet className="h-[18px] w-[18px] shrink-0" style={{ color: C.accentDeep }} aria-hidden />
                        <Fed feed={m.budget} rows={1} height={16} className="flex-1">
                            {b => <><span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold">Budget used</span><span className="block truncate text-[12px]" style={{ color: C.text3 }}>{b.overSites.length ? `Over: ${b.overSites.map(o => o.name).join(', ')}` : 'Every site within budget'}</span></span><span className="text-[16px]" style={fig}>{b.pct}%</span></>}
                        </Fed>
                    </li>
                    <li className="flex min-h-[56px] items-center gap-[12px] border-b py-[8px]" style={{ borderColor: C.border }}>
                        <Zap className="h-[18px] w-[18px] shrink-0" style={{ color: C.accentDeep }} aria-hidden />
                        <Fed feed={m.elec} rows={1} height={16} className="flex-1">
                            {e => <><span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold">Electricity</span><span className="block truncate text-[12px]" style={{ color: C.text3 }}>{e.topSite ? `Highest: ${e.topSite.name} ${e.topSite.deltaPct > 0 ? '+' : ''}${e.topSite.deltaPct}%` : 'vs same days last month'}</span></span><span className="text-[16px]" style={fig}>{e.deltaPct === null ? 'No data' : `${e.deltaPct > 0 ? '+' : ''}${e.deltaPct}%`}</span></>}
                        </Fed>
                    </li>
                    <li className="flex min-h-[56px] items-center gap-[12px] border-b py-[8px]" style={{ borderColor: C.border }}>
                        <Droplets className="h-[18px] w-[18px] shrink-0" style={{ color: C.accentDeep }} aria-hidden />
                        <Fed feed={m.diesel} rows={1} height={16} className="flex-1">
                            {d => <><span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold">Lowest diesel tank <Sample feed={m.diesel} /></span><span className="block text-[12px]" style={{ color: C.text3 }}>{d.lowTank.site} {d.lowTank.dg}, {num(d.litres)} L used</span></span>
                                <span className="relative h-[34px] w-[18px] overflow-hidden rounded-[6px]" style={{ background: C.track }} role="meter" aria-label="Lowest diesel tank" aria-valuenow={d.lowTank.pct} aria-valuemin={0} aria-valuemax={100}>
                                    <span className="absolute inset-x-0 bottom-0" style={{ height: `${d.lowTank.pct}%`, background: C.accent }} />
                                </span><span className="w-[38px] text-right text-[16px]" style={fig}>{d.lowTank.pct}%</span></>}
                        </Fed>
                    </li>
                    <li className="flex min-h-[56px] items-center gap-[12px] py-[8px]">
                        <Wallet className="h-[18px] w-[18px] shrink-0" style={{ color: C.accentDeep }} aria-hidden />
                        <Fed feed={m.vendor} rows={1} height={16} className="flex-1">
                            {v => <><span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold">Vendor revenue</span><span className="block truncate text-[12px]" style={{ color: C.text3 }}>{v.leader ? `Led by ${v.leader}` : 'This month'}</span></span><span className="text-[16px]" style={fig}>{inr(v.revenue, { compact: true })}</span></>}
                        </Fed>
                    </li>
                </ul>
            </Section>

            <Section title="Today" right={<Sample feed={m.visitors} />}>
                <div className="grid grid-cols-3 rounded-[22px] py-[14px]" style={{ background: C.card }}>
                    <Cell feed={m.visitors} icon={Users} value={v => num(v.today)} sub={v => `visitors, ${v.inside} inside`} />
                    <Cell feed={m.rooms} icon={Presentation} value={r => `${r.pct}%`} sub={() => 'rooms booked'} divider />
                    <Cell feed={m.water} icon={Droplets} value={w => num(w.tankers)} sub={() => 'water tankers'} divider />
                </div>
            </Section>

            <div className="h-[22px]" />
            <nav aria-label="Main" className="sticky bottom-0 z-30 mt-auto">
                <div className="relative flex h-[72px] items-center justify-around px-[8px] pb-[6px]" style={{ background: C.card, boxShadow: '0 -8px 24px rgba(14,20,36,0.06)' }}>
                    {TABS.map((t, i) => t === null ? (
                        <button key="raise" type="button" aria-label="Raise a ticket" onClick={() => m.previewAction('Raise a ticket')}
                            className="-mt-[34px] grid h-[60px] w-[60px] place-items-center rounded-full text-white" style={{ background: C.accent, boxShadow: `0 10px 24px rgba(43,89,232,0.38), 0 0 0 6px ${C.page}` }}>
                            <Plus className="h-6 w-6" aria-hidden />
                        </button>
                    ) : (
                        <button key={t.label} type="button" aria-current={i === 0 ? 'page' : undefined} onClick={() => i !== 0 && m.previewAction(`Open ${t.label}`)}
                            className="flex h-12 w-14 flex-col items-center justify-center gap-[3px] text-[11px] font-semibold" style={{ color: i === 0 ? C.accentDeep : C.text3 }}>
                            <t.icon className="h-5 w-5" aria-hidden />{t.label}
                        </button>
                    ))}
                </div>
            </nav>
        </div>
    );
}
