'use client';

import React, { useRef, useState } from 'react';
import {
    AlertTriangle, ArrowUpRight, Bell, CalendarDays, CheckCircle2, ChevronRight, ClipboardX, Droplets, Fuel, Megaphone,
    Presentation, ShieldCheck, Siren, Timer, UserCheck, Users, Wrench, Zap,
} from 'lucide-react';
import { Columns, Meter, SegmentBar, Sparkline } from '../lab/charts';
import { themeVars, type LabTheme } from '../lab/frame';
import { num } from '../lab/format';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { RED, RED_BG, RED_TEXT } from '../lab/status';
import { EmptyState, H, OfflineBanner, cx, listKeys, rowProps, stop } from '../lab/ui';
import { GOLD } from './palette';
import { APPROVAL_ICONS, Fed, ORG_TABS, Sample } from './parts';
import { healthOf, type Approval, type Feed, type OrgModel, type OrgPeriod, type OrgSite } from './useOrgModel';

/**
 * Pulse: soft grey page, white rounded cards, one gold hero chart per screen, number tiles in
 * a 2x2 grid with a small arrow to open each, progress bars for comparisons and a floating
 * pill tab bar. Simple shapes, one idea per card. Geist throughout.
 */

export type PulseTab = 'home' | 'approvals' | 'sites';

const P = {
    page: '#ECECE9',
    card: '#FFFFFF',
    tile: '#F4F4F1',
    border: '#E3E3DF',
    text: '#0B0B0C',
    text2: '#505056',
    text3: '#6B6B71',
    black: '#0B0B0C',
    track: '#EDEDEA',
    hero: `linear-gradient(155deg, ${GOLD.pale} 0%, ${GOLD.light} 48%, #D9B862 100%)`,
    onHero: '#3B3220',
    barOnHero: 'rgba(11,11,12,0.55)',
    gridOnHero: 'rgba(11,11,12,0.12)',
};

const theme: LabTheme = {
    font: 'var(--font-lab-geist), Geist, system-ui, sans-serif',
    page: P.page, surface: P.card, tile: P.tile, border: P.border, borderStrong: '#CFCFCA', grid: '#ECECE8',
    text: P.text, text2: P.text2, text3: P.text3, primary: P.black, onPrimary: '#FFFFFF', tint: GOLD.tint,
    ramp: ['#0B0B0C', '#4A3B17', '#8B6B22', '#C9A24A'], radius: '24px', radiusSm: '16px', chipRadius: '999px', btnRadius: '999px',
    focus: GOLD.deep, skeletonA: '#F1F1EE', skeletonB: '#E4E4E0', tooltipBg: '#0B0B0C', tooltipFg: '#FFFFFF',
};

const fig: React.CSSProperties = { fontWeight: 600, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' };
const PERIODS: { id: OrgPeriod; label: string; word: string }[] = [
    { id: 'today', label: 'Today', word: 'today' }, { id: 'month', label: 'Month', word: 'this month' }, { id: 'all', label: 'All', word: 'all time' },
];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Portfolio active tickets per day: the sites' daily series added up, aligned to today. */
function portfolioTrend(sites: OrgSite[], days: number): number[] {
    return Array.from({ length: days }, (_, i) => sites.reduce((sum, s) => sum + (s.trend[s.trend.length - days + i] ?? 0), 0));
}

/** The small round arrow that opens a card's detail. 40px target. */
function OpenArrow({ label, onOpen, onHero }: { label: string; onOpen: () => void; onHero?: boolean }) {
    return (
        <button type="button" aria-label={label} onClick={stop(onOpen)}
            className="-mr-[6px] -mt-[6px] grid h-10 w-10 shrink-0 place-items-center rounded-full"
            style={{ background: onHero ? 'rgba(255,255,255,0.55)' : P.tile, color: P.black }}>
            <ArrowUpRight className="h-[18px] w-[18px]" aria-hidden />
        </button>
    );
}

function Card({ title, label, right, children, className, onOpen }: {
    title?: string; label?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; onOpen?: () => void;
}) {
    return (
        <section aria-label={label ?? title} className={cx('rounded-[24px] p-[16px]', className)} style={{ background: P.card }}>
            {(title || right || onOpen) && (
                <div className="mb-[12px] flex items-start justify-between gap-[8px]">
                    {title && <H level={2} className="pt-[2px] text-[14.5px] font-medium tracking-[-0.01em]">{title}</H>}
                    <span className="flex items-center gap-[8px]">{right}{onOpen && <OpenArrow label={`Open ${title ?? label}`} onOpen={onOpen} />}</span>
                </div>
            )}
            {children}
        </section>
    );
}

/** A number tile: big figure, short label, arrow to open. Red only when `red` (SLA, late rounds). */
function Tile<T>({ feed, title, value, sub, red, icon: Icon, onOpen }: {
    feed: Feed<T>; title: string; value: (d: T) => string; sub: (d: T) => string; red?: (d: T) => boolean; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; onOpen: () => void;
}) {
    const isRed = feed.data !== null && red?.(feed.data);
    return (
        <section aria-label={title} className="flex min-h-[124px] flex-col rounded-[22px] p-[14px]" style={{ background: P.card }}>
            <div className="flex items-start justify-between gap-[6px]">
                <Fed feed={feed} compact rows={1} height={32} className="min-w-0 flex-1 pt-[4px]">
                    {d => <span className="text-[32px] leading-none" style={{ ...fig, color: red?.(d) ? RED_TEXT : P.text }}>{value(d)}</span>}
                </Fed>
                <OpenArrow label={`Open ${title}`} onOpen={onOpen} />
            </div>
            <div className="mt-auto pt-[10px]">
                <span className="flex items-center gap-[5px] text-[13px] font-medium" style={{ color: isRed ? RED_TEXT : P.text }}>
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: isRed ? RED : P.text2 }} />{title}
                </span>
                {feed.data !== null && <span className="mt-[2px] block text-[12px] leading-snug" style={{ color: P.text3 }}>{sub(feed.data)}</span>}
                {feed.sample && <span className="mt-[6px] block"><Sample feed={feed} /></span>}
            </div>
        </section>
    );
}

function Chip({ icon: Icon, children, onHero }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; onHero?: boolean }) {
    return (
        <span className="inline-flex h-8 items-center gap-[6px] rounded-full px-[12px] text-[12px] font-medium"
            style={{ background: onHero ? 'rgba(255,255,255,0.55)' : P.tile, color: onHero ? P.onHero : P.text2 }}>
            {Icon && <Icon className="h-3.5 w-3.5" />}{children}
        </span>
    );
}

function Hero({ label, children }: { label: string; children: React.ReactNode }) {
    return <section aria-label={label} className="rounded-[26px] p-[16px]" style={{ background: P.hero, color: P.text }}>{children}</section>;
}

/* ---------------------------------------------------------------- Home */

function HomeScreen({ m, go }: { m: OrgModel; go: (t: PulseTab) => void }) {
    const health = m.sites.data ? healthOf(m.sites.data) : null;
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(m.now);
        d.setDate(d.getDate() - (6 - i));
        return { label: i === 6 ? 'Today' : WEEKDAY[d.getDay()], tip: d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }) };
    });

    return (
        <>
            <Hero label="Active tickets">
                <div className="flex items-start justify-between gap-[8px]">
                    <span className="pt-[2px] text-[14.5px] font-medium">Active tickets</span>
                    <span className="flex items-center gap-[6px]"><Sample feed={m.sites} /><Chip icon={CalendarDays} onHero>Last 7 days</Chip><OpenArrow label="Open tickets" onOpen={() => m.previewAction('Open tickets')} onHero /></span>
                </div>
                <Fed feed={m.sites} rows={3} height={36} className="mt-[10px]">
                    {sites => {
                        if (sites.length === 0) return <p className="mt-[10px] text-[14px]" style={{ color: P.onHero }}>No properties yet. Tickets show here once a site is set up.</p>;
                        const week = portfolioTrend(sites, 7);
                        const prev = portfolioTrend(sites, 14)[6];
                        const today = week[6];
                        const delta = prev > 0 ? Math.round(((today - prev) / prev) * 100) : null;
                        return (
                            <>
                                <div className="mt-[6px] flex items-end gap-[10px]">
                                    <span className="text-[56px] leading-[0.95]" style={fig}>{num(today)}</span>
                                    {delta !== null && (
                                        <span className="mb-[6px] text-[12.5px] font-medium" style={{ color: P.onHero }}>
                                            {delta > 0 ? '+' : ''}{delta}% vs last week
                                        </span>
                                    )}
                                </div>
                                <div className="mt-[8px]">
                                    <Columns
                                        data={week.map((v, i) => ({ label: days[i].label, tipLabel: days[i].tip, values: [v], highlight: i === 6 }))}
                                        series={[{ name: 'Active tickets', color: P.barOnHero }]}
                                        highlightColor={P.black} keyIndex="last" showAxis={false} height={150} maxBar={24} barRadius={12}
                                        gridColor={P.gridOnHero} textColor={P.onHero} keyColor={P.text}
                                        ariaLabel={`Active tickets across all sites, last 7 days. Today ${today}.`}
                                    />
                                </div>
                            </>
                        );
                    }}
                </Fed>
            </Hero>

            <div className="grid grid-cols-2 gap-[10px]">
                <Tile feed={m.waiting} title="Waiting on you" icon={Timer} value={n => num(n)} sub={() => 'approvals and escalations'} onOpen={() => go('approvals')} />
                <Tile feed={m.tickets} title="SLA breached" icon={Siren} value={t => num(t.breached)} red={t => t.breached > 0} sub={t => `${t.urgent} urgent still open`} onOpen={() => m.previewAction('Open SLA breaches')} />
                <Tile feed={m.roster} title="On duty" icon={UserCheck} value={r => `${r.coveragePct}%`} sub={r => `${r.present} of ${r.scheduled} staff, ${r.absent} absent`} onOpen={() => m.previewAction('Open roster')} />
                <Tile feed={m.ppm} title="PPM on time" icon={ShieldCheck} value={p => `${p.pct}%`} sub={p => `target ${p.target}%, ${p.overdue} overdue`} onOpen={() => m.previewAction('Open PPM')} />
            </div>

            <Card label="Tickets raised" className="!py-[14px]">
                <div className="flex items-center justify-between gap-[10px]">
                    <div className="min-w-0">
                        <span className="block text-[13px] font-medium" style={{ color: P.text2 }}>Tickets raised</span>
                        <Fed feed={m.raised} compact rows={1} height={24}>
                            {v => <span className="block text-[26px] leading-tight" style={fig}>{num(v)}</span>}
                        </Fed>
                    </div>
                    <div role="radiogroup" aria-label="Period" className="inline-flex shrink-0 rounded-full p-[4px]" style={{ background: P.tile }}>
                        {PERIODS.map(p => (
                            <button key={p.id} type="button" role="radio" aria-checked={m.period === p.id} onClick={() => m.setPeriod(p.id)}
                                className="h-10 rounded-full px-[12px] text-[12.5px] font-medium"
                                style={m.period === p.id ? { background: P.black, color: '#FFFFFF' } : { color: P.text2 }}>{p.label}</button>
                        ))}
                    </div>
                </div>
            </Card>

            <Card title="Sites, worst first" right={<Sample feed={m.sites} />} onOpen={() => go('sites')}>
                <Fed feed={m.sites} rows={4} height={30}>
                    {sites => sites.length === 0
                        ? <EmptyState compact title="No properties yet" body="Add a property to see its score here." actionLabel="Add property" onAction={() => m.previewAction('Add property')} />
                        : (
                            <ul className="flex flex-col gap-[14px]">
                                {sites.slice(0, 5).map(s => (
                                    <li key={s.id}>
                                        <div className="mb-[6px] flex items-baseline justify-between gap-[8px] text-[13px]">
                                            <span className="flex min-w-0 items-center gap-[6px] font-medium">
                                                <span className="truncate">{s.name}</span>
                                                {s.score < 85 && <span className="inline-flex shrink-0 items-center gap-[3px] text-[11.5px] font-normal" style={{ color: P.text2 }}><AlertTriangle className="h-3 w-3" aria-hidden />Needs attention</span>}
                                            </span>
                                            <span className="shrink-0 tabular-nums" style={{ color: s.score < 85 ? P.text : P.text2, fontWeight: s.score < 85 ? 600 : 400 }}>{s.score}</span>
                                        </div>
                                        <Meter value={s.score / 100} label={`${s.name} score`} color={P.black} track={P.track} height={8} tip={`${s.name}: score ${s.score}, ${s.active} active, ${s.urgent} urgent`} />
                                    </li>
                                ))}
                            </ul>
                        )}
                </Fed>
                {health && health.count > 0 && <p className="mt-[12px] text-[12px]" style={{ color: P.text3 }}>Portfolio average {health.score}. {health.healthy} of {health.count} sites at 95 or above.</p>}
            </Card>

            <Card title="Money" right={<><Sample feed={m.budget} /><Chip>This month</Chip></>}>
                <Fed feed={m.budget} rows={2} height={20}>
                    {b => (
                        <>
                            <div className="flex items-baseline gap-[8px]">
                                <span className="text-[30px] leading-none" style={fig}>{b.pct}%</span>
                                <span className="text-[12.5px]" style={{ color: P.text2 }}>of {inr(b.total, { compact: true })} budget used</span>
                            </div>
                            <div className="mt-[10px]"><Meter value={b.pct / 100} label="Budget used this month" color={P.black} track={P.track} height={8} tip={`${inr(b.spent, { compact: true })} of ${inr(b.total, { compact: true })}`} /></div>
                            {b.overSites.length > 0 && (
                                <p className="mt-[8px] text-[12px]" style={{ color: P.text3 }}>Over budget: {b.overSites.map(o => `${o.name} ${inr(o.over, { compact: true })}`).join(', ')}</p>
                            )}
                        </>
                    )}
                </Fed>
                <div className="mt-[12px] grid grid-cols-2 gap-[8px]">
                    <div className="rounded-[16px] p-[12px]" style={{ background: P.tile }}>
                        <span className="flex items-center justify-between text-[12px]" style={{ color: P.text2 }}><span className="flex items-center gap-[5px]"><Zap className="h-3.5 w-3.5" aria-hidden />Electricity</span><Sample feed={m.elec} /></span>
                        <Fed feed={m.elec} compact rows={1} height={22}>
                            {e => <><span className="mt-[4px] block text-[20px]" style={fig}>{e.deltaPct === null ? 'No data' : `${e.deltaPct > 0 ? '+' : ''}${e.deltaPct}%`}</span><span className="text-[11.5px]" style={{ color: P.text3 }}>vs same days last month</span></>}
                        </Fed>
                    </div>
                    <div className="rounded-[16px] p-[12px]" style={{ background: P.tile }}>
                        <span className="flex items-center justify-between text-[12px]" style={{ color: P.text2 }}>Bills at risk<Sample feed={m.bills} /></span>
                        <Fed feed={m.bills} compact rows={1} height={22}>
                            {b => <><span className="mt-[4px] block text-[20px]" style={fig}>{inr(b.atRisk, { compact: true })}</span><span className="text-[11.5px]" style={{ color: P.text3 }}>{b.count} {b.count === 1 ? 'bill' : 'bills'} to pay</span></>}
                        </Fed>
                    </div>
                </div>
            </Card>

            <Card title="Risk and compliance" label="Risk and compliance">
                <ul className="flex flex-col" onKeyDown={listKeys}>
                    <RiskRow feed={m.rounds} icon={ClipboardX} red={d => d.missed > 0}
                        title={d => `${d.missed} ${d.missed === 1 ? 'round' : 'rounds'} late`} sub={d => d.missed > 0 ? `${d.sites} ${d.sites === 1 ? 'site' : 'sites'}. ${d.worst}` : 'Every round on time'} onOpen={() => m.previewAction('Open late rounds')} />
                    <RiskRow feed={m.amc} icon={Wrench}
                        title={a => a.length ? `${a.length} AMC ${a.length === 1 ? 'renewal' : 'renewals'} due` : 'No AMC renewals due'} sub={a => a.length ? `Soonest: ${a[0].asset}, ${a[0].site}, ${a[0].days} days` : 'Nothing in the next 30 days'} onOpen={() => m.previewAction('Open AMC renewals')} />
                    <RiskRow feed={m.oldestOpen} icon={Timer}
                        title={o => o.days ? `Oldest open ticket, ${o.days} days` : 'No old tickets'} sub={o => o.title ? `${o.title}, ${o.site}` : 'Nothing older than a day'} onOpen={() => m.previewAction('Open oldest ticket')} />
                    <RiskRow feed={m.grievances} icon={Megaphone}
                        title={g => `${g.open} HR ${g.open === 1 ? 'grievance' : 'grievances'} open`} sub={g => g.open ? `Oldest ${g.oldestDays} days` : 'None open'} onOpen={() => m.previewAction('Open grievances')} last />
                </ul>
            </Card>

            <Card title="Across sites today" label="Utilities and today">
                <div className="grid grid-cols-2 gap-[8px]">
                    <MiniTile feed={m.diesel} icon={Fuel} label="Lowest diesel tank" value={d => `${d.lowTank.pct}%`} sub={d => `${d.lowTank.site} ${d.lowTank.dg}`}
                        extra={d => <div className="mt-[8px]"><Meter value={d.lowTank.pct / 100} label="Lowest diesel tank" color={P.black} track="#E2E2DE" height={6} tip={`${d.lowTank.site} ${d.lowTank.dg}: ${d.lowTank.pct}% full`} /></div>} />
                    <MiniTile feed={m.water} icon={Droplets} label="Water tankers" value={w => num(w.tankers)} sub={w => `today, ${w.sites} ${w.sites === 1 ? 'site' : 'sites'}`} />
                    <MiniTile feed={m.visitors} icon={Users} label="Visitors" value={v => num(v.today)} sub={v => `${v.inside} inside now`} />
                    <MiniTile feed={m.rooms} icon={Presentation} label="Rooms booked" value={r => `${r.pct}%`} sub={() => 'of meeting hours'} />
                </div>
                <Fed feed={m.vendor} rows={1} height={14} className="mt-[10px]">
                    {v => <p className="mt-[12px] flex items-center justify-between gap-[8px] text-[12.5px]" style={{ color: P.text2 }}><span>Vendor revenue this month <b style={{ ...fig, color: P.text }}>{inr(v.revenue, { compact: true })}</b></span><Sample feed={m.vendor} /></p>}
                </Fed>
            </Card>
        </>
    );
}

function RiskRow<T>({ feed, icon: Icon, title, sub, red, onOpen, last }: {
    feed: Feed<T>; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; title: (d: T) => string; sub: (d: T) => string; red?: (d: T) => boolean; onOpen: () => void; last?: boolean;
}) {
    const isRed = feed.data !== null && !!red?.(feed.data);
    return (
        <li className={cx('py-[10px]', !last && 'border-b')} style={{ borderColor: P.border }}>
            <Fed feed={feed} rows={1} height={40}>
                {d => (
                    <div {...rowProps(onOpen, title(d))} className="flex min-h-[44px] items-center gap-[12px] rounded-[14px]">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]" style={{ background: isRed ? RED_BG : P.tile }}>
                            <Icon className="h-[18px] w-[18px]" style={{ color: isRed ? RED : P.text }} />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-[6px]">
                                <span className="text-[13.5px] font-medium" style={{ color: isRed ? RED_TEXT : P.text }}>{title(d)}</span><Sample feed={feed} />
                            </span>
                            <span className="mt-[1px] block truncate text-[12px]" style={{ color: P.text3 }}>{sub(d)}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0" style={{ color: P.text3 }} aria-hidden />
                    </div>
                )}
            </Fed>
        </li>
    );
}

function MiniTile<T>({ feed, icon: Icon, label, value, sub, extra }: {
    feed: Feed<T>; icon: React.ComponentType<{ className?: string }>; label: string; value: (d: T) => string; sub: (d: T) => string; extra?: (d: T) => React.ReactNode;
}) {
    return (
        <div className="rounded-[16px] p-[12px]" style={{ background: P.tile }}>
            <span className="flex items-center justify-between gap-[4px] text-[12px]" style={{ color: P.text2 }}><span className="flex items-center gap-[5px]"><Icon className="h-3.5 w-3.5" />{label}</span></span>
            <Fed feed={feed} compact rows={1} height={22}>
                {d => <><span className="mt-[4px] block text-[20px]" style={fig}>{value(d)}</span><span className="block text-[11.5px]" style={{ color: P.text3 }}>{sub(d)}</span>{extra?.(d)}</>}
            </Fed>
            {feed.sample && <span className="mt-[6px] block"><Sample feed={feed} /></span>}
        </div>
    );
}

/* ----------------------------------------------------------- Approvals */

const QUEUE: Record<Approval['id'], { name: string; color: string }> = {
    po: { name: 'Purchase orders', color: P.black },
    mr: { name: 'Material requests', color: '#5A4A22' },
    petty: { name: 'Petty cash', color: '#8B6B22' },
    escalation: { name: 'Escalations', color: '#FFFFFF' },
};

function ApprovalsScreen({ m }: { m: OrgModel }) {
    const ready = m.approvals.flatMap(a => (a.state === 'ready' && a.data && a.data.count > 0 ? [a.data] : []));
    return (
        <>
            <Hero label="Waiting on you">
                <div className="flex items-start justify-between gap-[8px]">
                    <span className="pt-[2px] text-[14.5px] font-medium">Waiting on you</span>
                    <span className="flex items-center gap-[6px]"><Sample feed={m.waiting} />{m.waiting.state === 'ready' && <Chip icon={Timer} onHero>{ready.length} {ready.length === 1 ? 'queue' : 'queues'}</Chip>}</span>
                </div>
                <Fed feed={m.waiting} rows={2} height={36} className="mt-[10px]">
                    {n => (
                        <>
                            <div className="mt-[6px] flex items-end gap-[10px]">
                                <span className="text-[56px] leading-[0.95]" style={fig}>{num(n)}</span>
                                <span className="mb-[6px] text-[12.5px] font-medium" style={{ color: P.onHero }}>{n === 0 ? 'nothing to decide' : 'decisions across the portfolio'}</span>
                            </div>
                            {ready.length > 0 && (
                                <>
                                    <SegmentBar className="mt-[16px]" height={14} gap={3}
                                        segments={ready.map(a => ({ label: QUEUE[a.id].name, value: a.count, color: QUEUE[a.id].color }))}
                                        ariaLabel={ready.map(a => `${QUEUE[a.id].name}: ${a.count}`).join(', ')} />
                                    <ul aria-label="Legend" className="mt-[12px] grid grid-cols-2 gap-[6px]">
                                        {ready.map(a => (
                                            <li key={a.id} className="flex items-center gap-[8px] rounded-[14px] px-[10px] py-[8px] text-[12px]" style={{ background: 'rgba(255,255,255,0.5)', color: P.onHero }}>
                                                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: QUEUE[a.id].color, boxShadow: '0 0 0 1px rgba(11,11,12,0.3)' }} />
                                                <span className="min-w-0 flex-1 truncate">{QUEUE[a.id].name}</span>
                                                <b style={{ ...fig, color: P.text }}>{a.count}</b>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </>
                    )}
                </Fed>
            </Hero>

            <Card title="Queue" right={m.approvals.some(a => a.sample) ? <Sample feed={{ sample: true }} /> : null}>
                <ul className="flex flex-col" onKeyDown={listKeys}>
                    {m.approvals.map((f, i) => {
                        const id = (['po', 'mr', 'petty', 'escalation'] as const)[i];
                        const Icon = APPROVAL_ICONS[id];
                        return (
                            <li key={id} className={cx('py-[10px]', i < m.approvals.length - 1 && 'border-b')} style={{ borderColor: P.border }}>
                                <Fed feed={f} rows={1} height={44}>
                                    {a => (
                                        <div {...rowProps(() => m.previewAction(`Open ${a.label.toLowerCase()}`), a.label)} className="flex items-center gap-[12px] rounded-[14px]">
                                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]" style={{ background: P.tile }}>
                                                <Icon className="h-[18px] w-[18px]" style={{ color: P.text }} aria-hidden />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[13.5px] font-medium leading-snug">{a.label}</span>
                                                <span className="mt-[1px] block truncate text-[12px]" style={{ color: P.text3 }}>{a.detail}{a.value ? `, ${a.value}` : ''}</span>
                                            </span>
                                            <span className="text-[18px]" style={fig}>{a.count}</span>
                                            <button type="button" onClick={stop(() => m.previewAction(`${a.action} ${a.label.toLowerCase()}`))}
                                                className="h-10 shrink-0 rounded-full px-[14px] text-[12.5px] font-medium" style={{ background: P.black, color: '#FFFFFF' }}>{a.action}</button>
                                        </div>
                                    )}
                                </Fed>
                            </li>
                        );
                    })}
                </ul>
            </Card>

            <Card title="Escalated to you" right={<Sample feed={m.escalations} />}>
                <Fed feed={m.escalations} rows={2} height={18}>
                    {e => e.count === 0 ? <p className="text-[13px]" style={{ color: P.text2 }}>Nothing escalated to you.</p> : (
                        <div className="rounded-[16px] p-[12px]" style={{ background: P.tile }}>
                            <span className="text-[12px]" style={{ color: P.text2 }}>{e.count} open. Top one</span>
                            <p className="mt-[2px] text-[13.5px] font-medium">{e.top}</p>
                        </div>
                    )}
                </Fed>
            </Card>
        </>
    );
}

/* --------------------------------------------------------------- Sites */

function SitesScreen({ m }: { m: OrgModel }) {
    const health = m.sites.data ? healthOf(m.sites.data) : null;
    return (
        <>
            <Hero label="Portfolio score">
                <div className="flex items-start justify-between gap-[8px]">
                    <span className="pt-[2px] text-[14.5px] font-medium">Portfolio score</span>
                    <span className="flex items-center gap-[6px]"><Sample feed={m.sites} /><Chip onHero>Out of 100</Chip></span>
                </div>
                <Fed feed={m.sites} rows={3} height={36} className="mt-[10px]">
                    {sites => sites.length === 0 || !health || health.score === null
                        ? <p className="mt-[10px] text-[14px]" style={{ color: P.onHero }}>No properties yet.</p>
                        : (
                            <>
                                <div className="mt-[6px] flex items-end gap-[10px]">
                                    <span className="text-[56px] leading-[0.95]" style={fig}>{health.score}</span>
                                    <span className="mb-[6px] text-[12.5px] font-medium" style={{ color: P.onHero }}>average of {health.count} sites</span>
                                </div>
                                <div className="mt-[8px]">
                                    <Columns
                                        data={sites.map((s, i) => ({ label: s.code, tipLabel: s.name, values: [s.score], highlight: i === 0 }))}
                                        series={[{ name: 'Score', color: P.barOnHero }]}
                                        highlightColor={P.black} keyIndex={0} showAxis={false} height={150} maxBar={24} barRadius={12}
                                        gridColor={P.gridOnHero} textColor={P.onHero} keyColor={P.text}
                                        ariaLabel={`Site scores, worst first. ${sites.map(s => `${s.name} ${s.score}`).join(', ')}.`}
                                    />
                                </div>
                                <p className="mt-[6px] text-[12px]" style={{ color: P.onHero }}>Darkest bar is the site that needs you most: {sites[0].name}.</p>
                            </>
                        )}
                </Fed>
            </Hero>

            <div className="grid grid-cols-2 gap-[10px]">
                <Tile feed={m.sites} title="Need attention" icon={AlertTriangle} value={s => num(healthOf(s).needAttention)} sub={() => 'sites scoring under 85'} onOpen={() => m.previewAction('Filter sites that need attention')} />
                <Tile feed={m.sites} title="Healthy" icon={CheckCircle2} value={s => num(healthOf(s).healthy)} sub={() => 'sites at 95 or above'} onOpen={() => m.previewAction('Filter healthy sites')} />
                <Tile feed={m.tickets} title="Active tickets" icon={Timer} value={t => num(t.active)} sub={t => `${t.urgent} urgent`} onOpen={() => m.previewAction('Open tickets')} />
                <Tile feed={m.tickets} title="SLA breached" icon={Siren} value={t => num(t.breached)} red={t => t.breached > 0} sub={() => 'across all sites'} onOpen={() => m.previewAction('Open SLA breaches')} />
            </div>

            <Fed feed={m.sites} rows={3} height={110}>
                {sites => sites.length === 0 ? <Card><EmptyState compact title="No properties yet" body="Add a property to see it here." actionLabel="Add property" onAction={() => m.previewAction('Add property')} /></Card> : (
                    <ul className="flex flex-col gap-[10px]" onKeyDown={listKeys}>
                        {sites.map(s => (
                            <li key={s.id}>
                                <div {...rowProps(() => m.previewAction(`Open ${s.name}`), `${s.name}, score ${s.score}`)} className="rounded-[22px] p-[14px]" style={{ background: P.card }}>
                                    <div className="flex items-center gap-[12px]">
                                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-[12.5px] font-semibold" style={{ background: P.black, color: GOLD.light }}>{s.code}</span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[14px] font-medium">{s.name}</span>
                                            <span className="flex items-center gap-[4px] text-[12px]" style={{ color: P.text3 }}>
                                                {s.score < 85 ? <><AlertTriangle className="h-3 w-3" aria-hidden />Needs attention</> : s.score >= 95 ? <><CheckCircle2 className="h-3 w-3" aria-hidden />Healthy</> : 'Steady'}
                                            </span>
                                        </span>
                                        <span className="text-[26px] leading-none" style={fig}>{s.score}</span>
                                    </div>
                                    <div className="mt-[12px] flex items-end justify-between gap-[10px]">
                                        <span className="text-[12px]" style={{ color: P.text2 }}>
                                            <b style={{ ...fig, color: P.text }}>{s.active}</b> active, <b style={{ ...fig, color: P.text }}>{s.urgent}</b> urgent
                                            {s.overBudget ? <span className="block" style={{ color: P.text3 }}>{inr(s.overBudget, { compact: true })} over budget</span> : null}
                                        </span>
                                        {s.trend.length > 1 && <Sparkline values={s.trend} color={P.black} width={110} height={30} ariaLabel={`${s.name} active tickets, last ${s.trend.length} days`} />}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Fed>
        </>
    );
}

/* ---------------------------------------------------------------- Shell */

const TITLES: Record<PulseTab, string> = { home: 'Overview', approvals: 'Approvals', sites: 'Sites' };
const TAB_FOR: (PulseTab | null)[] = ['home', 'approvals', 'sites', null, null];

export default function PulseOrg({ m, initialTab = 'home' }: { m: OrgModel; initialTab?: PulseTab }) {
    const [tab, setTab] = useState<PulseTab>(initialTab);
    const top = useRef<HTMLDivElement>(null);
    // Switching tabs starts the new screen at the top: reset the nearest scroller (the phone frame, or the page).
    const go = (t: PulseTab) => {
        setTab(t);
        let el = top.current?.parentElement ?? null;
        while (el && el !== document.body) {
            if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible') { el.scrollTop = 0; return; }
            el = el.parentElement;
        }
        window.scrollTo({ top: 0 });
    };

    return (
        <div ref={top} className="lab-root relative flex min-h-full flex-col" style={{ ...themeVars(theme), background: P.page }}>
            <header className="px-[16px] pb-[6px]" style={{ paddingTop: 'calc(var(--org-safe-top, 0px) + 10px)' }}>
                <div className="flex items-center gap-[10px]">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-[15px] font-semibold" style={{ background: P.black, color: GOLD.light }}>A</span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{m.user.name}</span>
                        <span className="block truncate text-[12px]" style={{ color: P.text3 }}>{m.user.roleLabel}, {m.orgName}</span>
                    </span>
                    <button type="button" aria-label="Notifications" onClick={() => m.previewAction('Notifications')} className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: P.card }}>
                        <Bell className="h-[18px] w-[18px]" aria-hidden /><span className="absolute right-[11px] top-[11px] h-2 w-2 rounded-full" style={{ background: GOLD.base }} />
                    </button>
                </div>
                <div className="mt-[18px] flex items-center justify-between gap-[8px]">
                    <H level={1} className="text-[26px] font-semibold tracking-[-0.03em]">{TITLES[tab]}</H>
                    <Chip>All properties</Chip>
                </div>
            </header>

            <main className="flex flex-1 flex-col gap-[10px] px-[12px] pb-[16px] pt-[8px]">
                <OfflineBanner online={m.online} style={{ background: P.card, borderRadius: 18 }} />
                {tab === 'home' && <HomeScreen m={m} go={go} />}
                {tab === 'approvals' && <ApprovalsScreen m={m} />}
                {tab === 'sites' && <SitesScreen m={m} />}
            </main>

            <nav aria-label="Main" className="sticky bottom-0 z-30 flex justify-center px-[12px] pb-[14px] pt-[8px]" style={{ background: `linear-gradient(180deg, rgba(236,236,233,0) 0%, ${P.page} 45%)` }}>
                <div className="flex items-center gap-[6px] rounded-[24px] p-[8px]" style={{ background: P.black, boxShadow: '0 12px 30px rgba(0,0,0,0.22)' }}>
                    {ORG_TABS.map((t, i) => {
                        const target = TAB_FOR[i];
                        const on = target === tab;
                        return (
                            <button key={t.label} type="button" aria-label={t.label} aria-current={on ? 'page' : undefined}
                                onClick={() => (target ? go(target) : m.previewAction(`Open ${t.label}`))}
                                className="grid h-12 w-12 place-items-center rounded-[16px]"
                                style={on ? { background: '#FFFFFF', color: P.black } : { color: 'rgba(255,255,255,0.72)' }}>
                                <t.icon className="h-5 w-5" aria-hidden />
                            </button>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}
