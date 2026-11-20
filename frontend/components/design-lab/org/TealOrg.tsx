'use client';

import React, { useState } from 'react';
import {
    AlertTriangle, Bell, Building2, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Droplets, Fuel, Home, ListChecks,
    Menu, Minus, Presentation, ShieldCheck, Siren, Ticket, Users, Wallet, Zap,
} from 'lucide-react';
import { LineArea, Meter, Sparkline } from '../lab/charts';
import { themeVars, type LabTheme } from '../lab/frame';
import { longDate, num } from '../lab/format';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { RED, RED_BG, RED_TEXT } from '../lab/status';
import { EmptyState, H, OfflineBanner, cx, listKeys, rowProps } from '../lab/ui';
import { APPROVAL_ICONS, Fed, Sample } from './parts';
import { dayLabels, portfolioTrend } from './derive';
import { healthOf, type OrgModel, type OrgPeriod } from './useOrgModel';

/**
 * Teal: calm and roomy, mint on white. A 14 day line opens the screen, approvals are a stack
 * of cards you flip through one queue at a time, sites sit in a two column grid, and people,
 * compliance, money and utilities fold into an accordion so the screen stays short. Manrope.
 */

const T = {
    page: '#F3F7F6',
    card: '#FFFFFF',
    tint: '#DCF1EC',
    accent: '#0F766E',
    accentDeep: '#0B5C56',
    text: '#0B1A18',
    text2: '#41524E',
    text3: '#586763',
    border: '#E0E8E6',
    track: '#E7EFED',
};

const theme: LabTheme = {
    font: 'var(--font-lab-manrope), Manrope, system-ui, sans-serif',
    page: T.page, surface: T.card, tile: T.track, border: T.border, borderStrong: '#C8D5D2', grid: '#E5EDEB',
    text: T.text, text2: T.text2, text3: T.text3, primary: T.accent, onPrimary: '#FFFFFF', tint: T.tint,
    ramp: ['#0B5C56', '#0F766E', '#4FA79E', '#A9D9D1'], radius: '20px', radiusSm: '14px', chipRadius: '999px', btnRadius: '14px',
    focus: T.accentDeep, skeletonA: '#EEF4F3', skeletonB: '#E0E9E7', tooltipBg: '#0B1A18', tooltipFg: '#FFFFFF',
};

const fig: React.CSSProperties = { fontWeight: 800, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' };
const PERIOD_WORD: Record<OrgPeriod, string> = { today: 'today', month: 'this month', all: 'all time' };

/* ------------------------------------------------------- approvals stack */

function ApprovalStack({ m }: { m: OrgModel }) {
    const [i, setI] = useState(0);
    const queues = m.approvals.flatMap(a => (a.state === 'ready' && a.data && a.data.count > 0 ? [a.data] : []));
    return (
        <section aria-label="Waiting on you" className="px-[16px] pt-[22px]">
            <div className="mb-[10px] flex items-center justify-between gap-[8px]">
                <H level={2} className="text-[17px] font-extrabold tracking-[-0.02em]">Waiting on you</H>
                <span className="flex items-center gap-[6px]"><Sample feed={m.waiting} />{m.waiting.data !== null && <span className="text-[13px] font-bold" style={{ color: T.accentDeep }}>{m.waiting.data} total</span>}</span>
            </div>
            <Fed feed={m.waiting} rows={2} height={60}>
                {() => {
                    if (queues.length === 0) return <div className="flex items-center gap-[8px] rounded-[20px] p-[18px] text-[13.5px]" style={{ background: T.card, color: T.text2 }}><CheckCircle2 className="h-4 w-4" aria-hidden />Nothing is waiting on you.</div>;
                    const q = queues[i % queues.length];
                    const Icon = APPROVAL_ICONS[q.id];
                    const layers = Math.min(2, queues.length - 1);
                    return (
                        <div className="relative" style={{ paddingBottom: layers * 8 }}>
                            {Array.from({ length: layers }).map((_, k) => (
                                <div key={k} aria-hidden className="absolute inset-x-0 top-0 rounded-[20px]"
                                    style={{ bottom: (layers - 1 - k) * 8, transform: `scale(${1 - (k + 1) * 0.04})`, transformOrigin: 'bottom center', background: k === 0 ? '#E9F4F1' : '#F1F8F6', boxShadow: `0 0 0 1px ${T.border}`, zIndex: 0 }} />
                            ))}
                            <div className="relative z-[1] rounded-[20px] p-[16px]" style={{ background: T.card, boxShadow: '0 6px 20px rgba(11,26,24,0.06)' }} aria-live="polite">
                                <div className="flex items-start gap-[12px]">
                                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]" style={{ background: q.id === 'escalation' ? RED_BG : T.tint }}>
                                        <Icon className="h-5 w-5" style={{ color: q.id === 'escalation' ? RED : T.accentDeep }} aria-hidden />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[14.5px] font-bold leading-snug">{q.label}</span>
                                        <span className="mt-[2px] block text-[12.5px]" style={{ color: T.text3 }}>{q.detail}{q.value ? `, ${q.value}` : ''}</span>
                                    </span>
                                    <span className="text-[34px] leading-none" style={fig}>{q.count}</span>
                                </div>
                                <div className="mt-[14px] flex items-center gap-[8px]">
                                    <button type="button" onClick={() => m.previewAction(`${q.action} ${q.label.toLowerCase()}`)} className="h-11 flex-1 rounded-[14px] text-[13.5px] font-bold text-white" style={{ background: T.accent }}>{q.action}</button>
                                    {queues.length > 1 && (
                                        <button type="button" onClick={() => setI(x => (x + 1) % queues.length)} className="inline-flex h-11 items-center gap-[4px] rounded-[14px] px-[14px] text-[13px] font-bold" style={{ color: T.accentDeep, boxShadow: `inset 0 0 0 1.5px ${T.tint}` }}>
                                            {(i % queues.length) + 1} of {queues.length}<ChevronRight className="h-4 w-4" aria-hidden /><span className="sr-only">Next queue</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                }}
            </Fed>
        </section>
    );
}

/* ------------------------------------------------------------ accordion */

type Fold = 'people' | 'compliance' | 'money' | 'utilities';

function FoldRow({ id, open, setOpen, icon: Icon, title, summary, children, red }: {
    id: Fold; open: Fold | null; setOpen: (f: Fold | null) => void; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    title: string; summary: React.ReactNode; children: React.ReactNode; red?: boolean;
}) {
    const isOpen = open === id;
    return (
        <div className="border-b last:border-b-0" style={{ borderColor: T.border }}>
            <button type="button" aria-expanded={isOpen} aria-controls={`teal-fold-${id}`} onClick={() => setOpen(isOpen ? null : id)}
                className="flex min-h-[60px] w-full items-center gap-[12px] px-[14px] py-[10px] text-left">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: red ? RED_BG : T.tint }}><Icon className="h-[18px] w-[18px]" style={{ color: red ? RED : T.accentDeep }} /></span>
                <span className="min-w-0 flex-1 text-[14.5px] font-bold">{title}</span>
                <span className="text-right text-[12.5px] font-semibold" style={{ color: T.text2 }}>{summary}</span>
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform" style={{ color: T.text3, transform: isOpen ? 'rotate(180deg)' : 'none' }} aria-hidden />
            </button>
            {isOpen && <div id={`teal-fold-${id}`} className="px-[14px] pb-[16px] pl-[66px]">{children}</div>}
        </div>
    );
}

function Line({ label, value, red }: { label: React.ReactNode; value: React.ReactNode; red?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-[10px] py-[5px] text-[13px]">
            <span style={{ color: red ? RED_TEXT : T.text2 }} className={red ? 'font-semibold' : undefined}>{label}</span>
            <span className="text-right font-bold tabular-nums" style={{ color: red ? RED_TEXT : T.text }}>{value}</span>
        </div>
    );
}

/* ------------------------------------------------------------ screen */

const TABS = [
    { label: 'Home', icon: Home }, { label: 'Approvals', icon: ListChecks }, { label: 'Sites', icon: Building2 }, { label: 'Tickets', icon: Ticket }, { label: 'More', icon: Menu },
];

export default function TealOrg({ m }: { m: OrgModel }) {
    const [open, setOpen] = useState<Fold | null>('compliance');
    const health = m.sites.data ? healthOf(m.sites.data) : null;
    const days = dayLabels(m.now, 14);

    return (
        <div className="lab-root relative flex min-h-full flex-col" style={{ ...themeVars(theme), background: T.page }}>
            <header className="px-[16px] pb-[4px]" style={{ paddingTop: 'calc(var(--org-safe-top, 0px) + 10px)' }}>
                <div className="flex items-center gap-[8px]">
                    <button type="button" onClick={() => m.previewAction('Switch property')} className="inline-flex h-10 min-w-0 items-center gap-[6px] rounded-full px-[14px] text-[13px] font-bold" style={{ background: T.card, boxShadow: `inset 0 0 0 1px ${T.border}` }}>
                        <Building2 className="h-4 w-4 shrink-0" style={{ color: T.accent }} aria-hidden /><span className="truncate">All properties</span><ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                    </button>
                    <span className="flex-1" />
                    <button type="button" aria-label="Notifications" onClick={() => m.previewAction('Notifications')} className="relative grid h-10 w-10 place-items-center rounded-full" style={{ background: T.card }}>
                        <Bell className="h-[18px] w-[18px]" aria-hidden /><span className="absolute right-[10px] top-[9px] h-2 w-2 rounded-full" style={{ background: T.accent }} />
                    </button>
                    <span className="grid h-10 w-10 place-items-center rounded-full text-[13px] font-extrabold text-white" style={{ background: T.accentDeep }} aria-label={m.user.name}>{m.user.initials}</span>
                </div>
                <p className="mt-[18px] text-[12.5px] font-semibold" style={{ color: T.text3 }}>{longDate(m.now)}</p>
                <H level={1} className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">Hello {m.user.firstName}, here is the portfolio.</H>
            </header>

            <OfflineBanner online={m.online} className="mx-[16px] mt-[10px]" style={{ background: T.card, borderRadius: 16 }} />

            {/* Hero: active tickets, 14 day line */}
            <section aria-label="Active tickets" className="mx-[16px] mt-[16px] rounded-[22px] p-[16px]" style={{ background: T.card }}>
                <div className="flex items-center justify-between gap-[8px] text-[13px] font-bold" style={{ color: T.text2 }}>Active tickets, 14 days<Sample feed={m.sites} /></div>
                <Fed feed={m.sites} rows={3} height={34} className="mt-[10px]">
                    {sites => {
                        if (sites.length === 0) return <p className="mt-[10px] text-[13.5px]" style={{ color: T.text2 }}>No properties yet.</p>;
                        const series = portfolioTrend(sites, 14);
                        const delta = series[0] > 0 ? Math.round(((series[13] - series[0]) / series[0]) * 100) : null;
                        return (
                            <>
                                <div className="mt-[4px] flex items-end gap-[10px]">
                                    <span className="text-[54px] leading-none" style={fig}>{num(series[13])}</span>
                                    {delta !== null && <span className="mb-[6px] inline-flex h-7 items-center rounded-full px-[10px] text-[12px] font-bold" style={{ background: T.tint, color: T.accentDeep }}>{delta > 0 ? '+' : ''}{delta}% in 2 weeks</span>}
                                </div>
                                <div className="mt-[6px]">
                                    <LineArea data={series.map((v, k) => ({ label: days[k].long, value: v }))} color={T.accent} height={110} fillOpacity={0.1} fitRange
                                        xLabels={[{ index: 0, text: days[0].long.split(',')[0] }, { index: 13, text: 'Today' }]} ariaLabel={`Active tickets over 14 days, today ${series[13]}`} />
                                </div>
                            </>
                        );
                    }}
                </Fed>
                <div className="mt-[10px] grid grid-cols-3 border-t pt-[12px]" style={{ borderColor: T.border }}>
                    <Fed feed={m.tickets} compact rows={1} height={20}>
                        {t => (
                            <>
                                <span className="flex flex-col">
                                    <span className="flex items-center gap-[4px] text-[11.5px] font-bold" style={{ color: t.breached > 0 ? RED_TEXT : T.text3 }}><Siren className="h-3 w-3" style={{ color: t.breached > 0 ? RED : T.text3 }} aria-hidden />Past SLA</span>
                                    <span className="text-[20px]" style={{ ...fig, color: t.breached > 0 ? RED_TEXT : T.text }}>{t.breached}</span>
                                </span>
                                <span className="flex flex-col border-l pl-[12px]" style={{ borderColor: T.border }}>
                                    <span className="text-[11.5px] font-bold" style={{ color: T.text3 }}>Urgent</span>
                                    <span className="text-[20px]" style={fig}>{t.urgent}</span>
                                </span>
                            </>
                        )}
                    </Fed>
                    <span className="flex flex-col border-l pl-[12px]" style={{ borderColor: T.border }}>
                        <button type="button" onClick={() => m.setPeriod(m.period === 'today' ? 'month' : m.period === 'month' ? 'all' : 'today')} className="-my-[10px] inline-flex min-h-[40px] items-center gap-[2px] text-left text-[11.5px] font-bold" style={{ color: T.accentDeep }} aria-label={`Raised ${PERIOD_WORD[m.period]}. Change period`}>
                            Raised {PERIOD_WORD[m.period]}<ChevronDown className="h-3 w-3" aria-hidden />
                        </button>
                        <Fed feed={m.raised} compact rows={1} height={18}>{v => <span className="text-[20px]" style={fig}>{num(v)}</span>}</Fed>
                    </span>
                </div>
            </section>

            <ApprovalStack m={m} />

            {/* Sites grid */}
            <section aria-label="Sites" className="px-[16px] pt-[22px]">
                <div className="mb-[10px] flex items-center justify-between gap-[8px]">
                    <H level={2} className="text-[17px] font-extrabold tracking-[-0.02em]">Sites</H>
                    <span className="flex items-center gap-[6px] text-[12.5px] font-bold" style={{ color: T.text2 }}><Sample feed={m.sites} />{health?.score != null && <>Average {health.score}</>}</span>
                </div>
                <Fed feed={m.sites} rows={3} height={96}>
                    {sites => sites.length === 0
                        ? <div className="rounded-[20px]" style={{ background: T.card }}><EmptyState compact title="No properties yet" body="Add a property to see it here." actionLabel="Add property" onAction={() => m.previewAction('Add property')} /></div>
                        : (
                            <ul className="grid grid-cols-2 gap-[10px]" onKeyDown={listKeys}>
                                {sites.map(s => {
                                    const state = s.score < 85 ? { icon: AlertTriangle, label: 'Needs attention' } : s.score >= 95 ? { icon: CheckCircle2, label: 'Healthy' } : { icon: Minus, label: 'Steady' };
                                    return (
                                        <li key={s.id}>
                                            <div {...rowProps(() => m.previewAction(`Open ${s.name}`), `${s.name}, score ${s.score}, ${state.label}`)} className="flex h-full flex-col rounded-[20px] p-[14px]" style={{ background: T.card, boxShadow: s.score < 85 ? `inset 0 0 0 1.5px ${T.accent}` : 'none' }}>
                                                <div className="flex items-center justify-between gap-[6px]">
                                                    <span className="grid h-9 min-w-9 place-items-center rounded-[11px] px-[6px] text-[11.5px] font-extrabold" style={{ background: T.tint, color: T.accentDeep }}>{s.code}</span>
                                                    <span className="text-[24px] leading-none" style={fig}>{s.score}</span>
                                                </div>
                                                <span className="mt-[10px] block truncate text-[13px] font-bold">{s.name}</span>
                                                <span className="flex items-center gap-[4px] text-[11.5px] font-semibold" style={{ color: T.text3 }}><state.icon className="h-3 w-3" aria-hidden />{state.label}</span>
                                                <div className="mt-auto flex items-end justify-between gap-[6px] pt-[10px]">
                                                    <span className="text-[11.5px]" style={{ color: T.text2 }}><b style={{ color: T.text }}>{s.active}</b> active</span>
                                                    {s.trend.length > 1 && <Sparkline values={s.trend} color={T.accent} width={64} height={24} ariaLabel={`${s.name} active tickets trend`} />}
                                                </div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                </Fed>
            </section>

            {/* Accordion */}
            <section aria-label="More detail" className="px-[16px] pt-[22px]">
                <H level={2} className="mb-[10px] text-[17px] font-extrabold tracking-[-0.02em]">At a glance</H>
                <div className="rounded-[22px]" style={{ background: T.card }}>
                    <FoldRow id="people" open={open} setOpen={setOpen} icon={Users} title="People"
                        summary={m.roster.data && <>{m.roster.data.coveragePct}% present</>}>
                        <Fed feed={m.roster} rows={3} height={14}>
                            {r => (
                                <>
                                    <Line label="Present" value={`${r.present} of ${r.scheduled}`} />
                                    <Line label="Late" value={r.late} />
                                    <Line label="Absent" value={r.absent} />
                                    <Line label="Short tomorrow" value={r.shortTomorrow} />
                                    <p className="mt-[4px] text-[12px]" style={{ color: T.text3 }}>Most absent today: {r.worst.name} <Sample feed={m.roster} /></p>
                                </>
                            )}
                        </Fed>
                        <Fed feed={m.grievances} rows={1} height={14} className="mt-[8px]">{g => <Line label={<>HR grievances open <Sample feed={m.grievances} /></>} value={`${g.open}, oldest ${g.oldestDays}d`} />}</Fed>
                    </FoldRow>
                    <FoldRow id="compliance" open={open} setOpen={setOpen} icon={ShieldCheck} title="Compliance" red={(m.rounds.data?.missed ?? 0) > 0}
                        summary={m.ppm.data && <>PPM {m.ppm.data.pct}%</>}>
                        <Fed feed={m.ppm} rows={2} height={14}>
                            {p => (
                                <>
                                    <div className="flex items-center justify-between text-[12.5px] font-semibold" style={{ color: T.text2 }}><span>PPM on time, target {p.target}%</span><Sample feed={m.ppm} /></div>
                                    <div className="mt-[6px]"><Meter value={p.pct / 100} label="PPM on time" color={T.accent} track={T.track} height={8} tip={`${p.pct}% done on time, target ${p.target}%`} /></div>
                                    <Line label="Overdue" value={p.overdue} />
                                    <Line label="Due today" value={p.dueToday} />
                                </>
                            )}
                        </Fed>
                        <Fed feed={m.rounds} rows={1} height={14} className="mt-[6px]">
                            {r => <Line red={r.missed > 0} label={<span className="inline-flex items-center gap-[5px]"><ClipboardCheck className="h-3.5 w-3.5" aria-hidden />Checklist rounds late</span>} value={r.missed} />}
                        </Fed>
                        <Fed feed={m.amc} rows={2} height={14} className="mt-[6px]">
                            {list => <>{list.map(a => <Line key={a.id} label={`AMC: ${a.asset}, ${a.site}`} value={`${a.days} days`} />)}{list.length === 0 && <Line label="AMC renewals" value="None due" />}</>}
                        </Fed>
                    </FoldRow>
                    <FoldRow id="money" open={open} setOpen={setOpen} icon={Wallet} title="Money"
                        summary={m.budget.data && <>{m.budget.data.pct}% used</>}>
                        <Fed feed={m.budget} rows={2} height={14}>
                            {b => (
                                <>
                                    <div className="mt-[2px]"><Meter value={b.pct / 100} label="Budget used" color={T.accent} track={T.track} height={8} tip={`${inr(b.spent, { compact: true })} of ${inr(b.total, { compact: true })}`} /></div>
                                    <Line label="Spent this month" value={`${inr(b.spent, { compact: true })} of ${inr(b.total, { compact: true })}`} />
                                    {b.overSites.map(o => <Line key={o.name} label={`Over budget: ${o.name}`} value={inr(o.over, { compact: true })} />)}
                                </>
                            )}
                        </Fed>
                        <Fed feed={m.elec} rows={1} height={14}>{e => <Line label={<span className="inline-flex items-center gap-[5px]"><Zap className="h-3.5 w-3.5" aria-hidden />Electricity vs last month <Sample feed={m.elec} /></span>} value={e.deltaPct === null ? 'No data' : `${e.deltaPct > 0 ? '+' : ''}${e.deltaPct}%`} />}</Fed>
                        <Fed feed={m.bills} rows={1} height={14}>{b => <Line label={<>Bills at risk <Sample feed={m.bills} /></>} value={`${b.count}, ${inr(b.atRisk, { compact: true })}`} />}</Fed>
                        <Fed feed={m.vendor} rows={1} height={14}>{v => <Line label="Vendor revenue" value={inr(v.revenue, { compact: true })} />}</Fed>
                    </FoldRow>
                    <FoldRow id="utilities" open={open} setOpen={setOpen} icon={Fuel} title="Utilities"
                        summary={m.diesel.data && <>Lowest {m.diesel.data.lowTank.pct}%</>}>
                        <Fed feed={m.diesel} rows={2} height={14}>
                            {d => (
                                <>
                                    <div className="flex items-center justify-between text-[12.5px] font-semibold" style={{ color: T.text2 }}><span>{d.lowTank.site} {d.lowTank.dg}</span><Sample feed={m.diesel} /></div>
                                    <div className="mt-[6px]"><Meter value={d.lowTank.pct / 100} label="Lowest diesel tank" color={T.accent} track={T.track} height={8} tip={`${d.lowTank.pct}% full`} /></div>
                                    <Line label="Diesel used this month" value={`${num(d.litres)} L`} />
                                </>
                            )}
                        </Fed>
                        <Fed feed={m.water} rows={1} height={14}>{w => <Line label={<span className="inline-flex items-center gap-[5px]"><Droplets className="h-3.5 w-3.5" aria-hidden />Water tankers today</span>} value={w.tankers} />}</Fed>
                    </FoldRow>
                </div>
            </section>

            {/* Also today chips */}
            <section aria-label="Also today" className="pt-[22px]">
                <H level={2} className="mb-[10px] px-[16px] text-[17px] font-extrabold tracking-[-0.02em]">Also today</H>
                <div className="lab-scroll-x flex gap-[8px] overflow-x-auto px-[16px] pb-[4px]">
                    <Fed feed={m.visitors} compact rows={1} height={40} className="w-[120px]">
                        {v => <span className="inline-flex h-12 shrink-0 items-center gap-[8px] rounded-full px-[14px] text-[13px] font-bold" style={{ background: T.card }}><Users className="h-4 w-4" style={{ color: T.accent }} aria-hidden />{v.today} visitors<span className="font-semibold" style={{ color: T.text3 }}>{v.inside} inside</span><Sample feed={m.visitors} /></span>}
                    </Fed>
                    <Fed feed={m.rooms} compact rows={1} height={40} className="w-[120px]">
                        {r => <span className="inline-flex h-12 shrink-0 items-center gap-[8px] rounded-full px-[14px] text-[13px] font-bold" style={{ background: T.card }}><Presentation className="h-4 w-4" style={{ color: T.accent }} aria-hidden />{r.pct}% rooms booked<Sample feed={m.rooms} /></span>}
                    </Fed>
                    <Fed feed={m.oldestOpen} compact rows={1} height={40} className="w-[120px]">
                        {o => o.days ? <span className="inline-flex h-12 shrink-0 items-center gap-[8px] rounded-full px-[14px] text-[13px] font-bold" style={{ background: T.card }}><Ticket className="h-4 w-4" style={{ color: T.accent }} aria-hidden />Oldest open {o.days}d<span className="font-semibold" style={{ color: T.text3 }}>{o.site}</span></span> : null}
                    </Fed>
                </div>
            </section>

            <div className="h-[20px]" />
            <nav aria-label="Main" className="sticky bottom-0 z-30 mt-auto border-t" style={{ background: T.card, borderColor: T.border }}>
                <div className="flex h-[70px] items-center justify-around px-[4px]">
                    {TABS.map((t, i) => (
                        <button key={t.label} type="button" aria-current={i === 0 ? 'page' : undefined} onClick={() => i !== 0 && m.previewAction(`Open ${t.label}`)}
                            className="flex w-[64px] flex-col items-center gap-[4px] text-[11.5px] font-bold" style={{ color: i === 0 ? T.text : T.text3 }}>
                            <span className={cx('grid h-8 w-14 place-items-center rounded-full')} style={i === 0 ? { background: T.tint, color: T.accentDeep } : undefined}><t.icon className="h-5 w-5" aria-hidden /></span>
                            {t.label}
                        </button>
                    ))}
                </div>
            </nav>
        </div>
    );
}
