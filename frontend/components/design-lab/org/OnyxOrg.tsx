'use client';

import React, { useState } from 'react';
import {
    AlertTriangle, Bell, CalendarClock, ClipboardCheck, Coffee, DoorOpen, Droplets, FileWarning, Fuel, Presentation, ShieldCheck, Siren,
    Users, Zap, type LucideIcon,
} from 'lucide-react';
import { Meter, Sparkline } from '../lab/charts';
import { themeVars, type LabTheme } from '../lab/frame';
import { greeting, num } from '../lab/format';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { RED, RED_BG } from '../lab/status';
import { Avatar, EmptyState, H, OfflineBanner, cx, listKeys, rowProps, stop } from '../lab/ui';
import { GOLD, RED_ON_DARK } from './palette';
import { APPROVAL_ICONS, Fed, InlineError, ORG_TABS, Sample } from './parts';
import { healthOf, type Feed, type OrgModel, type OrgPeriod } from './useOrgModel';

/**
 * Onyx: dark triage for people who live in the app. Act now, Watch and Trends are tabs.
 * Act now is one inbox of every approval and risk, most urgent first, each with its action.
 * Black panes, gold for selection and primary actions, Inter throughout.
 */

const OX = {
    page: '#0B0B0C', pane: '#111113', card: '#17171A', tile: '#1F1F23', border: '#26262B',
    text: '#F4F3EF', text2: '#B5B2AA', text3: '#85827A', gold: '#D4AF5A', goldTint: 'rgba(212,175,90,0.13)',
    hero: 'radial-gradient(300px 180px at 100% 0%, rgba(255,255,255,0.35), rgba(255,255,255,0) 60%), linear-gradient(135deg, #EED79A 0%, #D4AF5A 48%, #A98632 100%)',
};

const theme: LabTheme = {
    font: 'var(--font-lab-inter), Inter, system-ui, sans-serif',
    page: OX.page, surface: OX.card, tile: OX.tile, border: OX.border, borderStrong: '#3A3A40', grid: '#222226',
    text: OX.text, text2: OX.text2, text3: OX.text3, primary: OX.gold, onPrimary: OX.page, tint: OX.goldTint,
    ramp: ['#F0D387', '#D4AF5A', '#A88838', '#6E5A28'], radius: '16px', radiusSm: '12px', chipRadius: '8px', btnRadius: '10px',
    focus: GOLD.onDark, skeletonA: '#18181B', skeletonB: '#232327', tooltipBg: '#F4F3EF', tooltipFg: '#0B0B0C',
};

const fig: React.CSSProperties = { fontWeight: 600, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' };
type Tab = 'act' | 'watch' | 'trends';

interface Row { key: string; icon: LucideIcon; reason: string; title: string; meta: string; right: string; red: boolean; action: string; primary: boolean; sample: boolean }

/** Turn the risk feeds into inbox rows (only when they say something needs a person). */
function riskRows(m: OrgModel): Row[] {
    const rows: Row[] = [];
    const t = m.tickets.state === 'ready' ? m.tickets.data : null;
    if (t && t.breached > 0) rows.push({ key: 'sla', icon: Siren, reason: 'SLA breached', title: `${t.breached} tickets past SLA`, meta: `${t.urgent} urgent open across the portfolio`, right: String(t.breached), red: true, action: 'Open', primary: true, sample: m.tickets.sample });
    const r = m.rounds.state === 'ready' ? m.rounds.data : null;
    if (r && r.missed > 0) rows.push({ key: 'rounds', icon: ClipboardCheck, reason: 'Rounds late', title: r.worst, meta: `${r.missed} late across ${r.sites} sites`, right: String(r.missed), red: true, action: 'View', primary: false, sample: m.rounds.sample });
    const b = m.bills.state === 'ready' ? m.bills.data : null;
    if (b && b.count > 0) rows.push({ key: 'bills', icon: FileWarning, reason: 'Bills at risk', title: `${b.count} electricity bills to pay`, meta: 'Overdue or losing an early payment discount', right: inr(b.atRisk, { compact: true }), red: false, action: 'Pay', primary: false, sample: m.bills.sample });
    const a = m.amc.state === 'ready' ? m.amc.data?.[0] : null;
    if (a && a.days <= 14) rows.push({ key: 'amc', icon: CalendarClock, reason: 'AMC expiring', title: `${a.asset} at ${a.site}`, meta: `Contract ends in ${a.days} days`, right: `${a.days}d`, red: false, action: 'Renew', primary: false, sample: m.amc.sample });
    const d = m.diesel.state === 'ready' ? m.diesel.data : null;
    if (d && d.lowTank.pct < 30) rows.push({ key: 'dg', icon: Fuel, reason: 'Diesel low', title: `${d.lowTank.site} ${d.lowTank.dg}`, meta: 'Order a refill before the next outage', right: `${d.lowTank.pct}%`, red: false, action: 'Order', primary: false, sample: m.diesel.sample });
    return rows;
}

function Card({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
    return (
        <section aria-label={title} className={cx('rounded-[16px] p-[16px]', className)} style={{ background: OX.card, boxShadow: `inset 0 0 0 1px ${OX.border}` }}>
            <div className="mb-[10px] flex items-center justify-between gap-[8px]">
                <H level={3} className="text-[14px] font-semibold">{title}</H>
                <span className="flex items-center gap-[6px]">{right}</span>
            </div>
            {children}
        </section>
    );
}

function Stat<T>({ feed, label, render, red }: { feed: Feed<T>; label: string; render: (d: T) => string; red?: (d: T) => boolean }) {
    return (
        <div className="min-w-[104px] shrink-0 rounded-[14px] px-[12px] py-[10px]" style={{ background: OX.card, boxShadow: `inset 0 0 0 1px ${OX.border}` }}>
            <span className="block whitespace-nowrap text-[11.5px]" style={{ color: OX.text2 }}>{label}</span>
            <Fed feed={feed} compact rows={1} height={20}>
                {d => <span className="flex items-center gap-[6px]"><span className="text-[20px] leading-tight" style={{ ...fig, color: red?.(d) ? RED_ON_DARK : OX.text }}>{render(d)}</span><Sample feed={feed} /></span>}
            </Fed>
        </div>
    );
}

export default function OnyxOrg({ m }: { m: OrgModel }) {
    const [tab, setTab] = useState<Tab>('act');
    const health = m.sites.data ? healthOf(m.sites.data) : null;
    const risks = riskRows(m);
    // Risk rows come from five feeds; until they all answer, the list is not "no risks".
    const riskFeeds: Feed<unknown>[] = [m.tickets, m.rounds, m.bills, m.amc, m.diesel];
    const risksLoading = riskFeeds.some(f => f.state === 'loading');
    const risksFailed = riskFeeds.filter(f => f.state === 'error');
    const actCount = m.waitingTotal === null || risksLoading ? null : m.waitingTotal + risks.length;

    return (
        <div className="lab-root relative flex min-h-full flex-col" style={themeVars(theme)}>
            <header className="sticky top-0 z-30 px-[16px] pb-[10px]" style={{ background: 'rgba(11,11,12,0.94)', backdropFilter: 'blur(12px)', paddingTop: 'calc(var(--org-safe-top, 0px) + 8px)' }}>
                <div className="flex items-center gap-[10px]">
                    <Avatar name={m.user.name} size={38} style={{ background: OX.hero, color: OX.page, borderRadius: 12 }} />
                    <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate text-[14px] font-semibold">{greeting(m.now)}, {m.user.firstName}</span>
                        <span className="block truncate text-[12px]" style={{ color: OX.text3 }}>{m.orgName} · all properties</span>
                    </span>
                    <button type="button" aria-label="Notifications" onClick={() => m.previewAction('Notifications')} className="relative grid h-10 w-10 place-items-center rounded-[12px]" style={{ background: OX.card, boxShadow: `inset 0 0 0 1px ${OX.border}` }}>
                        <Bell className="h-[18px] w-[18px]" /><span className="absolute right-[9px] top-[9px] h-2 w-2 rounded-full" style={{ background: OX.gold }} />
                    </button>
                </div>
                <div role="tablist" aria-label="Dashboard view" className="mt-[12px] grid grid-cols-3 gap-[4px] rounded-[12px] p-[4px]" style={{ background: OX.card, boxShadow: `inset 0 0 0 1px ${OX.border}` }}>
                    {([['act', 'Act now', actCount], ['watch', 'Watch', health ? health.needAttention : null], ['trends', 'Trends', null]] as const).map(([id, label, n]) => (
                        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                            className="inline-flex h-10 items-center justify-center gap-[6px] rounded-[9px] text-[13px] font-semibold"
                            style={tab === id ? { background: OX.gold, color: OX.page } : { color: OX.text2 }}>
                            {label}{n !== null && <span className="tabular-nums opacity-70">{n}</span>}
                        </button>
                    ))}
                </div>
            </header>

            <main className="flex flex-1 flex-col gap-[12px] px-[16px] pb-[24px] pt-[6px]">
                <OfflineBanner online={m.online} style={{ boxShadow: `inset 0 0 0 1px ${OX.border}` }} />

                <div className="lab-scroll-x -mx-[16px] flex gap-[8px] overflow-x-auto px-[16px]" aria-label="Counts">
                    <Stat feed={m.tickets} label="SLA breached" render={t => String(t.breached)} red={t => t.breached > 0} />
                    <Stat feed={m.tickets} label="Urgent open" render={t => String(t.urgent)} />
                    <Stat feed={m.roster} label="On duty" render={r => `${r.coveragePct}%`} />
                    <Stat feed={m.ppm} label="PPM on time" render={p => `${p.pct}%`} />
                    <Stat feed={m.budget} label="Budget used" render={b => `${b.pct}%`} />
                </div>

                {tab === 'act' && (
                    <section aria-label="Act now" className="overflow-hidden rounded-[16px]" style={{ background: OX.pane, boxShadow: `inset 0 0 0 1px ${OX.border}` }}>
                        <div className="flex items-center justify-between px-[14px] pb-[4px] pt-[12px] text-[11.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: OX.text3 }}>Waiting on you</div>
                        <ul onKeyDown={listKeys}>
                            {m.approvals.map((f, i) => {
                                const id = (['po', 'mr', 'petty', 'escalation'] as const)[i];
                                const Icon = APPROVAL_ICONS[id];
                                return (
                                    <li key={id} className="border-b" style={{ borderColor: OX.border }}>
                                        <Fed feed={f} rows={1} height={48} className="p-[14px]">
                                            {a => (
                                                <div {...rowProps(() => m.previewAction(`${a.action} ${a.label.toLowerCase()}`), a.label)} className="flex cursor-pointer gap-[12px] px-[14px] py-[12px]">
                                                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]" style={{ background: a.id === 'escalation' ? RED_BG : OX.goldTint }}>
                                                        <Icon className="h-4 w-4" style={{ color: a.id === 'escalation' ? RED : GOLD.onDark }} aria-hidden />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="flex items-center gap-[8px]">
                                                            <span className="min-w-0 line-clamp-2 text-[14px] font-semibold leading-snug">{a.label}</span><Sample feed={f} />
                                                            <span className="ml-auto text-[18px] leading-none" style={fig}>{a.count}</span>
                                                        </span>
                                                        <span className="mt-[2px] flex items-center gap-[8px]">
                                                            <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: OX.text3 }}>{a.detail}{a.value ? ` · ${a.value}` : ''}</span>
                                                            <button type="button" onClick={stop(() => m.previewAction(`${a.action} ${a.label.toLowerCase()}`))} className="h-10 shrink-0 rounded-[10px] px-[12px] text-[12.5px] font-semibold" style={{ background: OX.gold, color: OX.page }}>{a.action}</button>
                                                        </span>
                                                    </span>
                                                </div>
                                            )}
                                        </Fed>
                                    </li>
                                );
                            })}
                        </ul>
                        <div className="px-[14px] pb-[4px] pt-[14px] text-[11.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: OX.text3 }}>Risks</div>
                        {risksFailed.length > 0 && <InlineError onRetry={() => risksFailed.forEach(f => f.retry())} className="px-[14px] pb-[12px]" />}
                        {risks.length === 0 ? (
                            risksLoading
                                ? <Fed feed={riskFeeds.find(f => f.state === 'loading')!} rows={3} height={52} className="px-[14px] pb-[14px]">{() => null}</Fed>
                                : risksFailed.length === 0 && <p className="px-[14px] pb-[14px] text-[13px]" style={{ color: OX.text2 }}>No risks need a person right now.</p>
                        ) : (
                            <ul onKeyDown={listKeys}>
                                {risks.map(r => (
                                    <li key={r.key} className="border-b last:border-0" style={{ borderColor: OX.border }}>
                                        <div {...rowProps(() => m.previewAction(`${r.action} ${r.title}`), `${r.reason}: ${r.title}`)} className="flex cursor-pointer gap-[12px] px-[14px] py-[12px]">
                                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]" style={{ background: r.red ? RED_BG : OX.tile }}>
                                                <r.icon className="h-4 w-4" style={{ color: r.red ? RED : GOLD.onDark }} aria-hidden />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-[8px]">
                                                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: r.red ? RED_ON_DARK : GOLD.onDark }}>{r.reason}</span>
                                                    {r.sample && <Sample feed={{ sample: true }} />}
                                                    <span className="ml-auto text-[13px] font-semibold tabular-nums" style={{ color: r.red ? RED_ON_DARK : OX.text }}>{r.right}</span>
                                                </span>
                                                <span className="mt-[2px] line-clamp-2 text-[14px] font-semibold leading-snug">{r.title}</span>
                                                <span className="flex items-center gap-[8px]">
                                                    <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: OX.text3 }}>{r.meta}</span>
                                                    <button type="button" onClick={stop(() => m.previewAction(`${r.action} ${r.title}`))} className="h-10 shrink-0 rounded-[10px] px-[12px] text-[12.5px] font-semibold"
                                                        style={r.primary ? { background: OX.gold, color: OX.page } : { background: OX.tile, color: OX.text, boxShadow: `inset 0 0 0 1px ${OX.border}` }}>{r.action}</button>
                                                </span>
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}

                {tab === 'watch' && (
                    <>
                        <section aria-label="Portfolio score" className="rounded-[18px] p-[18px]" style={{ background: OX.hero, color: OX.page }}>
                            <div className="flex items-center justify-between text-[13px] font-semibold"><span>Portfolio score</span><Sample feed={m.sites} /></div>
                            <Fed feed={m.sites} rows={1} height={56}>
                                {() => health?.score != null ? (
                                    <>
                                        <div className="mt-[2px] flex items-end gap-[10px]"><span className="text-[60px] leading-none" style={fig}>{health.score}</span><span className="mb-[8px] text-[13px] font-medium">{health.needAttention} of {health.count} sites need attention</span></div>
                                        <Meter value={health.score / 100} label="Portfolio score" color={OX.page} track="rgba(11,11,12,0.15)" height={6} tip={`Average of ${health.count} site scores`} />
                                    </>
                                ) : <span className="text-[15px] font-semibold">No properties yet</span>}
                            </Fed>
                        </section>
                        <Card title="Sites, worst first" right={<Sample feed={m.sites} />}>
                            <Fed feed={m.sites} rows={4} height={40}>
                                {sites => sites.length === 0 ? <EmptyState compact title="No properties yet" body="Add a property to watch it here." actionLabel="Add property" onAction={() => m.previewAction('Add property')} /> : (
                                    <ul className="flex flex-col gap-[4px]" onKeyDown={listKeys}>
                                        {sites.map(s => (
                                            <li key={s.id}>
                                                <div {...rowProps(() => m.previewAction(`Open ${s.name}`), s.name)} className="flex cursor-pointer items-center gap-[12px] rounded-[12px] px-[8px] py-[8px]">
                                                    <span className="w-[34px] text-[18px]" style={{ ...fig, color: s.score >= 85 ? GOLD.onDark : OX.text }}>{s.score}</span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-[13.5px] font-semibold">{s.name}</span>
                                                        <span className="flex items-center gap-[6px] text-[12px]" style={{ color: OX.text3 }}>
                                                            {s.score < 85 && <AlertTriangle className="h-3 w-3" style={{ color: OX.text }} aria-hidden />}
                                                            {s.score < 85 ? 'Needs attention' : 'Healthy'} · {s.active} active · {s.urgent} urgent{s.overBudget ? ` · ${inr(s.overBudget, { compact: true })} over` : ''}
                                                        </span>
                                                    </span>
                                                    {s.trend.length > 1 && <Sparkline values={s.trend} color={OX.gold} width={64} height={24} ariaLabel={`${s.name} active tickets, last 14 days`} />}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </Fed>
                        </Card>
                        <Card title="People" right={<Sample feed={m.roster} />}>
                            <Fed feed={m.roster} rows={2} height={16}>
                                {r => (
                                    <div className="flex items-center gap-[12px]">
                                        <Users className="h-5 w-5 shrink-0" style={{ color: GOLD.onDark }} aria-hidden />
                                        <div className="min-w-0 flex-1 text-[12.5px]" style={{ color: OX.text2 }}>
                                            <div className="text-[14px] font-semibold" style={{ color: OX.text }}>{r.present} of {r.scheduled} on duty</div>
                                            <Meter value={r.coveragePct / 100} label="Attendance" color={OX.gold} track={OX.tile} height={5} tip={`${r.coveragePct}% coverage`} />
                                            <div className="mt-[4px]">{r.late} late · {r.absent} absent · {r.shortTomorrow} short tomorrow</div>
                                        </div>
                                    </div>
                                )}
                            </Fed>
                            <Fed feed={m.grievances} rows={1} height={14} className="mt-[8px]">
                                {g => <p className="mt-[10px] flex items-center gap-[6px] border-t pt-[10px] text-[12.5px]" style={{ borderColor: OX.border, color: OX.text2 }}><b style={{ color: OX.text }}>{g.open}</b> HR grievances open, oldest {g.oldestDays} days <Sample feed={m.grievances} /></p>}
                            </Fed>
                        </Card>
                        <Card title="Compliance" right={<Sample feed={m.ppm} />}>
                            <Fed feed={m.ppm} rows={2} height={16}>
                                {p => (
                                    <div>
                                        <div className="flex items-center justify-between text-[13px]"><span className="flex items-center gap-[6px]"><ShieldCheck className="h-4 w-4" style={{ color: GOLD.onDark }} aria-hidden />PPM on time</span><b style={fig}>{p.pct}% <span className="font-normal" style={{ color: OX.text3 }}>/ {p.target}%</span></b></div>
                                        <Meter value={p.pct / 100} label="PPM compliance" color={OX.gold} track={OX.tile} height={5} tip={`${p.pct}% done on time, target ${p.target}%`} />
                                        <p className="mt-[6px] text-[12px]" style={{ color: OX.text3 }}>{p.overdue} overdue · {p.dueToday} due today{p.worstSystem?.count ? ` · ${p.worstSystem.name} most overdue` : ''}</p>
                                    </div>
                                )}
                            </Fed>
                            <Fed feed={m.amc} rows={1} height={14} className="mt-[8px]">
                                {list => list.length ? (
                                    <div className="mt-[10px] border-t pt-[10px]" style={{ borderColor: OX.border }}>
                                        <div className="mb-[4px] flex items-center gap-[6px] text-[12.5px] font-semibold">AMC expiring in 30 days <Sample feed={m.amc} /></div>
                                        {list.map(a => <div key={a.id} className="flex justify-between py-[3px] text-[12.5px]" style={{ color: OX.text2 }}><span>{a.asset}, {a.site}</span><b style={{ color: OX.text }}>{a.days} days</b></div>)}
                                    </div>
                                ) : null}
                            </Fed>
                        </Card>
                    </>
                )}

                {tab === 'trends' && (
                    <>
                        <Card title="Tickets raised" right={
                            <div role="radiogroup" aria-label="Period" className="flex gap-[2px] rounded-[10px] p-[3px]" style={{ background: OX.tile }}>
                                {(['today', 'month', 'all'] as OrgPeriod[]).map(p => (
                                    <button key={p} type="button" role="radio" aria-checked={m.period === p} onClick={() => m.setPeriod(p)} className="h-10 rounded-[8px] px-[10px] text-[12px] font-semibold capitalize"
                                        style={m.period === p ? { background: OX.card, color: GOLD.onDark, boxShadow: `inset 0 0 0 1px ${OX.border}` } : { color: OX.text2 }}>{p}</button>
                                ))}
                            </div>
                        }>
                            <Fed feed={m.raised} rows={1} height={30}>{v => <span className="text-[34px] leading-none" style={fig}>{num(v)}</span>}</Fed>
                        </Card>
                        <Card title="Money" right={<Sample feed={m.budget} />}>
                            <Fed feed={m.budget} rows={2} height={16}>
                                {b => (
                                    <div>
                                        <div className="flex items-baseline justify-between text-[13px]"><span>Budget used</span><b className="text-[18px]" style={fig}>{b.pct}%</b></div>
                                        <Meter value={b.pct / 100} label="Budget used" color={OX.gold} track={OX.tile} height={6} tip={`${inr(b.spent, { compact: true })} of ${inr(b.total, { compact: true })}`} />
                                        <p className="mt-[6px] text-[12px]" style={{ color: OX.text3 }}>{inr(b.spent, { compact: true })} of {inr(b.total, { compact: true })}{b.overSites.length ? ` · over: ${b.overSites.map(o => o.name).join(', ')}` : ''}</p>
                                    </div>
                                )}
                            </Fed>
                            <div className="mt-[12px] grid grid-cols-2 gap-[8px]">
                                <div className="rounded-[12px] p-[12px]" style={{ background: OX.tile }}>
                                    <div className="flex items-center justify-between text-[12px]" style={{ color: OX.text2 }}><span className="flex items-center gap-[5px]"><Zap className="h-3.5 w-3.5" aria-hidden />Electricity</span><Sample feed={m.elec} /></div>
                                    <Fed feed={m.elec} rows={1} height={18}>{e => <><span className="block text-[20px]" style={fig}>{e.deltaPct === null ? 'No baseline' : `${e.deltaPct > 0 ? '+' : ''}${Math.round(e.deltaPct)}%`}</span><span className="text-[11.5px]" style={{ color: OX.text3 }}>vs last month{e.topSite ? `, ${e.topSite.name} +${e.topSite.deltaPct}%` : ''}</span></>}</Fed>
                                </div>
                                <div className="rounded-[12px] p-[12px]" style={{ background: OX.tile }}>
                                    <div className="flex items-center justify-between text-[12px]" style={{ color: OX.text2 }}>Bills at risk<Sample feed={m.bills} /></div>
                                    <Fed feed={m.bills} rows={1} height={18}>{b => <><span className="block text-[20px]" style={fig}>{inr(b.atRisk, { compact: true })}</span><span className="text-[11.5px]" style={{ color: OX.text3 }}>{b.count} bills</span></>}</Fed>
                                </div>
                            </div>
                        </Card>
                        <Card title="Utilities" right={<Sample feed={m.diesel} />}>
                            <Fed feed={m.diesel} rows={2} height={14}>
                                {d => (
                                    <div className="flex flex-col gap-[8px] text-[12.5px]">
                                        <div className="flex items-center gap-[8px]"><Fuel className="h-4 w-4" style={{ color: GOLD.onDark }} aria-hidden /><span className="flex-1">{d.lowTank.site} {d.lowTank.dg}</span><span className="w-[90px]"><Meter value={d.lowTank.pct / 100} label="Lowest diesel tank" color={OX.gold} track={OX.tile} height={5} tip={`${d.lowTank.pct}% full`} /></span><b style={fig}>{d.lowTank.pct}%</b></div>
                                        <div className="flex items-center gap-[8px]" style={{ color: OX.text2 }}><Droplets className="h-4 w-4" style={{ color: GOLD.onDark }} aria-hidden />{m.water.data?.tankers ?? 0} water tankers today · {num(d.litres)} L diesel this month</div>
                                    </div>
                                )}
                            </Fed>
                        </Card>
                        <Card title="Also today" right={<Sample feed={m.rooms} />}>
                            <div className="grid grid-cols-3 gap-[8px]">
                                {[
                                    { icon: DoorOpen, node: <Fed feed={m.visitors} rows={1} height={18}>{v => <span className="text-[18px]" style={fig}>{num(v.today)}</span>}</Fed>, label: 'Visitors' },
                                    { icon: Coffee, node: <Fed feed={m.vendor} rows={1} height={18}>{v => <span className="text-[18px]" style={fig}>{inr(v.revenue, { compact: true })}</span>}</Fed>, label: 'Vendor revenue' },
                                    { icon: Presentation, node: <Fed feed={m.rooms} rows={1} height={18}>{r => <span className="text-[18px]" style={fig}>{r.pct}%</span>}</Fed>, label: 'Rooms booked' },
                                ].map(x => (
                                    <div key={x.label} className="rounded-[12px] p-[10px]" style={{ background: OX.tile }}>
                                        <x.icon className="h-4 w-4" style={{ color: GOLD.onDark }} aria-hidden />
                                        <div className="mt-[4px]">{x.node}</div>
                                        <span className="text-[11px]" style={{ color: OX.text3 }}>{x.label}</span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </>
                )}
            </main>

            <nav aria-label="Main" className="sticky bottom-0 z-30 grid h-[64px] grid-cols-5 border-t" style={{ background: OX.page, borderColor: OX.border }}>
                {ORG_TABS.map((t, i) => (
                    <button key={t.label} type="button" aria-current={i === 0 ? 'page' : undefined} onClick={() => i !== 0 && m.previewAction(`Open ${t.label}`)}
                        className="flex flex-col items-center justify-center gap-[3px] text-[10.5px] font-medium" style={{ color: i === 0 ? GOLD.onDark : OX.text3 }}>
                        <t.icon className="h-5 w-5" aria-hidden />{t.label}
                    </button>
                ))}
            </nav>
        </div>
    );
}
