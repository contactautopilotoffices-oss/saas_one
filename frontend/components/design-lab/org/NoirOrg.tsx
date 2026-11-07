'use client';

import React from 'react';
import {
    AlertTriangle, Bell, CheckCircle2, ChevronRight, ClipboardCheck, Coffee, DoorOpen, Droplets, FileBarChart, Fuel,
    Plus, Presentation, ShieldCheck, Siren, Timer, UserCheck, Users, Zap,
} from 'lucide-react';
import { Meter, Ring, Sparkline } from '../lab/charts';
import { themeVars, type LabTheme } from '../lab/frame';
import { greeting, longDate, num } from '../lab/format';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { RED, RED_BG, RED_TEXT } from '../lab/status';
import { EmptyState, H, OfflineBanner, cx, listKeys, rowProps } from '../lab/ui';
import { GOLD } from './palette';
import { APPROVAL_ICONS, Fed, ORG_TABS, Sample } from './parts';
import { healthOf, type OrgModel, type OrgPeriod } from './useOrgModel';

/**
 * Noir: private banking on a phone. A black band with a gold glow holds the portfolio score,
 * the period and your sites as swipeable cards. A white sheet slides over it with everything
 * else, most urgent first. Manrope throughout.
 */

const N = {
    black: '#0A0A0A',
    tile: '#F5F3EE',
    border: '#ECE9E1',
    text: '#0A0A0A',
    text2: '#4D4A43',
    text3: '#8A867C',
    onBand: 'rgba(255,255,255,0.72)',
    glass: 'rgba(255,255,255,0.08)',
    glassBorder: 'rgba(255,255,255,0.14)',
    band: 'radial-gradient(420px 260px at 100% -10%, rgba(201,162,74,0.38), rgba(201,162,74,0) 62%), linear-gradient(170deg, #1B1812 0%, #0A0A0A 60%, #050505 100%)',
};

const theme: LabTheme = {
    font: 'var(--font-lab-manrope), Manrope, system-ui, sans-serif',
    page: '#FFFFFF', surface: '#FFFFFF', tile: N.tile, border: N.border, borderStrong: '#D9D4C7', grid: '#EFECE5',
    text: N.text, text2: N.text2, text3: N.text3, primary: N.black, onPrimary: '#FFFFFF', tint: GOLD.tint,
    ramp: ['#0A0A0A', '#4A3B17', '#8B6B22', '#C9A24A'], radius: '20px', radiusSm: '14px', chipRadius: '999px', btnRadius: '999px',
    focus: GOLD.deep, skeletonA: '#F3F1EC', skeletonB: '#E7E3DA', tooltipBg: '#0A0A0A', tooltipFg: '#FFFFFF',
};

const num800: React.CSSProperties = { fontWeight: 800, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' };
const PERIODS: { id: OrgPeriod; label: string; word: string }[] = [
    { id: 'today', label: 'Today', word: 'today' }, { id: 'month', label: 'Month', word: 'this month' }, { id: 'all', label: 'All', word: 'all time' },
];

function Section({ title, right, children, label }: { title: string; right?: React.ReactNode; children: React.ReactNode; label?: string }) {
    return (
        <section aria-label={label ?? title} className="pt-[22px]">
            <div className="mb-[10px] flex items-center justify-between gap-[8px]">
                <H level={2} className="text-[17px] font-extrabold tracking-[-0.02em]">{title}</H>
                <span className="flex items-center gap-[6px]">{right}</span>
            </div>
            {children}
        </section>
    );
}

function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
    return <div className={cx('rounded-[18px] border bg-white p-[14px]', className)} style={{ borderColor: N.border, ...style }}>{children}</div>;
}

export default function NoirOrg({ m }: { m: OrgModel }) {
    const health = m.sites.data ? healthOf(m.sites.data) : null;
    const word = PERIODS.find(p => p.id === m.period)?.word ?? 'today';

    return (
        <div className="lab-root relative flex min-h-full flex-col" style={themeVars(theme)}>
            {/* Band */}
            <section className="relative text-white" style={{ background: N.band, paddingTop: 'calc(var(--org-safe-top, 0px) + 10px)' }}>
                <div className="px-[18px] pb-[48px]">
                    <div className="flex items-center gap-[10px]">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-[16px] font-extrabold" style={{ background: N.black, color: GOLD.onDark, border: `1px solid ${N.glassBorder}` }}>A</span>
                        <span className="min-w-0 flex-1 leading-tight">
                            <span className="block truncate text-[14px] font-bold">{m.orgName}</span>
                            <span className="block text-[12px]" style={{ color: N.onBand }}>All properties · {m.user.roleLabel}</span>
                        </span>
                        <button type="button" aria-label="Notifications" onClick={() => m.previewAction('Notifications')} className="relative grid h-10 w-10 place-items-center rounded-full" style={{ background: N.glass, border: `1px solid ${N.glassBorder}` }}>
                            <Bell className="h-[18px] w-[18px]" /><span className="absolute right-[10px] top-[10px] h-2 w-2 rounded-full" style={{ background: GOLD.base }} />
                        </button>
                    </div>

                    <p className="mt-[18px] text-[13px]" style={{ color: N.onBand }}>{greeting(m.now)}, <b className="text-white">{m.user.firstName}</b> · {longDate(m.now)}</p>

                    <div className="mt-[14px] flex items-end justify-between gap-[12px]">
                        <div>
                            <div className="flex items-center gap-[8px] text-[12.5px] font-semibold" style={{ color: N.onBand }}>Portfolio score <Sample feed={m.sites} dark /></div>
                            <Fed feed={m.sites} dark rows={1} height={60}>
                                {() => health && health.score !== null ? (
                                    <div className="flex items-baseline gap-[4px]"><span className="text-[64px] leading-none" style={num800}>{health.score}</span><span className="text-[18px]" style={{ color: N.onBand }}>/100</span></div>
                                ) : <span className="text-[15px]">No properties yet</span>}
                            </Fed>
                        </div>
                        {health && health.count > 0 && (
                            <span className="mb-[6px] inline-flex h-8 items-center gap-[6px] rounded-full px-[12px] text-[12.5px] font-bold"
                                style={health.needAttention > 0 ? { background: '#FFFFFF', color: N.black } : { background: GOLD.gradient, color: N.black }}>
                                {health.needAttention > 0 ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                                {health.needAttention > 0 ? `${health.needAttention} of ${health.count} sites need you` : 'All sites healthy'}
                            </span>
                        )}
                    </div>

                    <div className="mt-[14px] flex items-center justify-between gap-[10px]">
                        <div role="radiogroup" aria-label="Period" className="inline-flex rounded-full p-[3px]" style={{ background: N.glass, border: `1px solid ${N.glassBorder}` }}>
                            {PERIODS.map(p => (
                                <button key={p.id} type="button" role="radio" aria-checked={m.period === p.id} onClick={() => m.setPeriod(p.id)}
                                    className="h-10 rounded-full px-[14px] text-[12.5px] font-bold" style={m.period === p.id ? { background: GOLD.gradient, color: N.black } : { color: 'rgba(255,255,255,0.78)' }}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <Fed feed={m.raised} dark compact rows={1} height={14} className="w-[90px] justify-end">
                            {v => <span className="text-right text-[12.5px] leading-tight" style={{ color: N.onBand }}><b className="block text-[16px] text-white" style={num800}>{num(v)}</b>raised {word}</span>}
                        </Fed>
                    </div>

                    {/* Sites carousel */}
                    <Fed feed={m.sites} dark rows={1} height={120} className="mt-[16px]">
                        {sites => sites.length === 0 ? null : (
                            <div className="lab-scroll-x -mx-[18px] mt-[16px] flex snap-x snap-mandatory gap-[10px] overflow-x-auto px-[18px] pb-[2px]" aria-label="Sites, worst first">
                                {sites.map(s => {
                                    const ok = s.score >= 85;
                                    return (
                                        <button key={s.id} type="button" onClick={() => m.previewAction(`Open ${s.name}`)}
                                            className="flex w-[210px] shrink-0 snap-start flex-col rounded-[18px] p-[14px] text-left" style={{ background: N.glass, border: `1px solid ${N.glassBorder}` }}>
                                            <span className="flex items-center gap-[10px]">
                                                <Ring value={s.score / 100} size={44} stroke={5} color={ok ? GOLD.base : '#FFFFFF'} track="rgba(255,255,255,0.15)" tipText={`${s.name}: score ${s.score}`} ariaLabel={`${s.name} score ${s.score}`}>
                                                    <span className="text-[13px]" style={num800}>{s.score}</span>
                                                </Ring>
                                                <span className="min-w-0">
                                                    <span className="block truncate text-[13.5px] font-bold">{s.name}</span>
                                                    <span className="flex items-center gap-[4px] text-[11.5px]" style={{ color: ok ? GOLD.onDark : '#FFFFFF' }}>
                                                        {ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}{ok ? 'Healthy' : 'Needs attention'}
                                                    </span>
                                                </span>
                                            </span>
                                            <span className="mt-[10px] flex items-end justify-between gap-[8px]">
                                                <span className="text-[11.5px] leading-tight" style={{ color: N.onBand }}><b className="text-[14px] text-white">{s.active}</b> active<br /><b className={s.urgent ? 'text-white' : ''}>{s.urgent}</b> urgent</span>
                                                {s.trend.length > 1 && <Sparkline values={s.trend} color={GOLD.base} width={80} height={26} ariaLabel={`${s.name} active tickets, last 14 days`} />}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </Fed>

                    <div className="mt-[18px] grid grid-cols-4 gap-[8px]">
                        {[{ l: 'Approve', i: CheckCircle2, gold: true }, { l: 'Assign', i: UserCheck }, { l: 'Raise', i: Plus }, { l: 'Report', i: FileBarChart }].map(q => (
                            <button key={q.l} type="button" onClick={() => m.previewAction(q.l)} className="flex flex-col items-center gap-[6px] text-[11.5px] font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
                                <span className="grid h-12 w-12 place-items-center rounded-full" style={q.gold ? { background: GOLD.gradient, color: N.black } : { background: N.glass, border: `1px solid ${N.glassBorder}`, color: '#FFFFFF' }}>
                                    <q.i className="h-5 w-5" aria-hidden />
                                </span>
                                {q.l}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {/* Sheet */}
            <div className="relative -mt-[24px] flex-1 rounded-t-[28px] bg-white px-[16px] pb-[24px]">
                <OfflineBanner online={m.online} className="mt-[16px]" style={{ borderRadius: 14 }} />

                <Section title="Waiting on you" right={m.waitingTotal !== null ? <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-[8px] text-[12px] font-bold text-white" style={{ background: N.black }}>{m.waitingTotal}</span> : undefined}>
                    <Card className="!p-[4px]">
                        <ul onKeyDown={listKeys}>
                            {m.approvals.map((f, i) => {
                                const id = (['po', 'mr', 'petty', 'escalation'] as const)[i];
                                const Icon = APPROVAL_ICONS[id];
                                return (
                                    <li key={id} className="border-b last:border-0" style={{ borderColor: N.border }}>
                                        <Fed feed={f} rows={1} height={44} className="p-[10px]">
                                            {a => (
                                                <div {...rowProps(() => m.previewAction(`${a.action} ${a.label.toLowerCase()}`), a.label)} className="flex min-h-[64px] cursor-pointer items-center gap-[12px] rounded-[14px] px-[10px] py-[10px]">
                                                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px]" style={{ background: a.id === 'escalation' ? RED_BG : N.tile }}>
                                                        <Icon className="h-[18px] w-[18px]" style={{ color: a.id === 'escalation' ? RED : N.text }} aria-hidden />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="flex items-center gap-[6px] text-[13.5px] font-bold">{a.label}<Sample feed={f} /></span>
                                                        <span className="block truncate text-[12px]" style={{ color: N.text2 }}>{a.detail}</span>
                                                    </span>
                                                    <span className="text-right">
                                                        <span className="block text-[20px] leading-none" style={num800}>{a.count}</span>
                                                        {a.value && <span className="text-[11.5px]" style={{ color: N.text2 }}>{a.value}</span>}
                                                    </span>
                                                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: N.text3 }} aria-hidden />
                                                </div>
                                            )}
                                        </Fed>
                                    </li>
                                );
                            })}
                        </ul>
                    </Card>
                </Section>

                <Section title="Service risk" right={<Sample feed={m.escalations} />}>
                    <div className="grid grid-cols-3 gap-[8px]">
                        <Fed feed={m.tickets} rows={1} height={78} className="col-span-3">
                            {t => (
                                <>
                                    <Card className="!p-[12px]" style={t.breached > 0 ? { background: RED_BG, borderColor: '#F6C9CB' } : undefined}>
                                        <Siren className="h-4 w-4" style={{ color: t.breached > 0 ? RED : N.text2 }} aria-hidden />
                                        <span className="mt-[6px] block text-[24px] leading-none" style={{ ...num800, color: t.breached > 0 ? RED_TEXT : N.text }}>{t.breached}</span>
                                        <span className="text-[11.5px]" style={{ color: t.breached > 0 ? RED_TEXT : N.text2 }}>SLA breached</span>
                                    </Card>
                                    <Card className="!p-[12px]">
                                        <AlertTriangle className="h-4 w-4" style={{ color: N.text2 }} aria-hidden />
                                        <span className="mt-[6px] block text-[24px] leading-none" style={num800}>{t.urgent}</span>
                                        <span className="text-[11.5px]" style={{ color: N.text2 }}>Urgent open</span>
                                    </Card>
                                    <Card className="!p-[12px]">
                                        <Timer className="h-4 w-4" style={{ color: N.text2 }} aria-hidden />
                                        <span className="mt-[6px] block text-[24px] leading-none" style={num800}>{t.active}</span>
                                        <span className="text-[11.5px]" style={{ color: N.text2 }}>Active tickets</span>
                                    </Card>
                                </>
                            )}
                        </Fed>
                    </div>
                    <Fed feed={m.oldestOpen} rows={1} height={20} className="mt-[8px]">
                        {o => o.days > 0 ? <p className="mt-[10px] text-[12.5px]" style={{ color: N.text2 }}>Oldest open: <b style={{ color: N.text }}>{o.days} days</b>, {o.title}, {o.site}. <Fed feed={m.escalations} rows={1}>{e => <span>{e.count} escalated today.</span>}</Fed></p> : null}
                    </Fed>
                </Section>

                <Section title="Sites, worst first" right={<Sample feed={m.sites} />}>
                    <Fed feed={m.sites} rows={4} height={44}>
                        {sites => sites.length === 0 ? (
                            <EmptyState compact title="No properties yet" body="Add a property to see its score here." actionLabel="Add property" onAction={() => m.previewAction('Add property')} />
                        ) : (
                            <ul className="flex flex-col gap-[8px]" onKeyDown={listKeys}>
                                {sites.map((s, i) => (
                                    <li key={s.id}>
                                        <div {...rowProps(() => m.previewAction(`Open ${s.name}`), s.name)} className="flex cursor-pointer items-center gap-[12px] rounded-[16px] px-[12px] py-[10px]" style={{ background: N.tile }}>
                                            <span className="w-[18px] text-[12px] font-bold" style={{ color: N.text3 }}>{i + 1}</span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center justify-between gap-[8px]">
                                                    <span className="truncate text-[13.5px] font-bold">{s.name}</span>
                                                    <span className="text-[15px]" style={num800}>{s.score}</span>
                                                </span>
                                                <Meter value={s.score / 100} label={`${s.name} score`} color={s.score >= 85 ? GOLD.base : N.black} track="#E6E2D8" height={5} tip={`${s.name}: score ${s.score} of 100`} />
                                                <span className="mt-[4px] flex flex-wrap gap-x-[10px] text-[11.5px]" style={{ color: N.text2 }}>
                                                    <span>{s.active} active</span><span>{s.urgent} urgent</span>
                                                    {s.overBudget ? <span className="font-bold" style={{ color: N.text }}>{inr(s.overBudget, { compact: true })} over budget</span> : null}
                                                </span>
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Fed>
                </Section>

                <Section title="People" right={<Sample feed={m.roster} />}>
                    <Card>
                        <Fed feed={m.roster} rows={2} height={22}>
                            {r => (
                                <div className="flex items-center gap-[14px]">
                                    <Ring value={r.coveragePct / 100} size={72} stroke={8} color={GOLD.base} track="#EFECE5" tipText={`${r.present} of ${r.scheduled} present`} ariaLabel={`Attendance ${r.coveragePct}%`}>
                                        <span className="text-[17px]" style={num800}>{r.coveragePct}%</span>
                                    </Ring>
                                    <div className="min-w-0 flex-1 text-[12.5px]" style={{ color: N.text2 }}>
                                        <div className="text-[13.5px] font-bold" style={{ color: N.text }}>{r.present} of {r.scheduled} on duty</div>
                                        <div>{r.late} late · {r.absent} absent</div>
                                        <div>{r.shortTomorrow} short tomorrow{r.worst?.absent ? `, worst ${r.worst.name}` : ''}</div>
                                    </div>
                                    <Users className="h-5 w-5 shrink-0" style={{ color: N.text3 }} aria-hidden />
                                </div>
                            )}
                        </Fed>
                        <Fed feed={m.grievances} rows={1} height={16} className="mt-[10px]">
                            {g => <div className="mt-[12px] flex items-center justify-between border-t pt-[10px] text-[12.5px]" style={{ borderColor: N.border }}><span className="flex items-center gap-[6px]"><b>{g.open}</b> HR grievances open, oldest {g.oldestDays} days</span><Sample feed={m.grievances} /></div>}
                        </Fed>
                    </Card>
                </Section>

                <Section title="Compliance" right={<Sample feed={m.ppm} />}>
                    <Card>
                        <Fed feed={m.ppm} rows={2} height={18}>
                            {p => (
                                <div>
                                    <div className="flex items-center justify-between text-[13px]"><span className="flex items-center gap-[6px] font-bold"><ShieldCheck className="h-4 w-4" aria-hidden />PPM done on time</span><span><b className="text-[16px]" style={num800}>{p.pct}%</b> <span style={{ color: N.text2 }}>target {p.target}%</span></span></div>
                                    <div className="relative mt-[8px]">
                                        <Meter value={p.pct / 100} label="PPM compliance" color={p.pct >= p.target ? GOLD.base : N.black} track="#EFECE5" height={8} tip={`${p.pct}% done on time, target ${p.target}%`} />
                                        <span aria-hidden className="absolute top-[-3px] h-[14px] w-[2px] rounded-full" style={{ left: `${p.target}%`, background: GOLD.deep }} />
                                    </div>
                                    <p className="mt-[8px] text-[12px]" style={{ color: N.text2 }}>{p.overdue} overdue · {p.dueToday} due today{p.worstSystem?.count ? ` · most overdue: ${p.worstSystem.name}` : ''}</p>
                                </div>
                            )}
                        </Fed>
                        <Fed feed={m.rounds} rows={1} height={16}>
                            {r => r.missed > 0 ? (
                                <div className="mt-[12px] flex items-start gap-[8px] border-t pt-[10px] text-[12.5px]" style={{ borderColor: N.border }}>
                                    <ClipboardCheck className="mt-[1px] h-4 w-4 shrink-0" style={{ color: RED }} aria-hidden />
                                    <span className="flex-1"><b style={{ color: RED_TEXT }}>{r.missed} rounds late</b> across {r.sites} sites. {r.worst}.</span><Sample feed={m.rounds} />
                                </div>
                            ) : null}
                        </Fed>
                        <Fed feed={m.amc} rows={1} height={16}>
                            {list => list.length ? (
                                <div className="mt-[12px] border-t pt-[10px]" style={{ borderColor: N.border }}>
                                    <div className="mb-[6px] flex items-center justify-between text-[12.5px] font-bold">AMC expiring in 30 days<Sample feed={m.amc} /></div>
                                    {list.map(a => <div key={a.id} className="flex justify-between py-[3px] text-[12.5px]"><span>{a.asset}, {a.site}</span><b>{a.days} days</b></div>)}
                                </div>
                            ) : null}
                        </Fed>
                    </Card>
                </Section>

                <Section title="Money" right={<Sample feed={m.budget} />}>
                    <div className="flex flex-col gap-[8px]">
                        <Card>
                            <Fed feed={m.budget} rows={2} height={18}>
                                {b => (
                                    <div>
                                        <div className="flex items-baseline justify-between"><span className="text-[13px] font-bold">Budget used this month</span><b className="text-[18px]" style={num800}>{b.pct}%</b></div>
                                        <Meter value={b.pct / 100} label="Budget used" color={N.black} track="#EFECE5" height={8} tip={`${inr(b.spent, { compact: true })} of ${inr(b.total, { compact: true })}`} />
                                        <p className="mt-[6px] text-[12px]" style={{ color: N.text2 }}>{inr(b.spent, { compact: true })} of {inr(b.total, { compact: true })}{b.overSites.length ? ` · over: ${b.overSites.map(o => `${o.name} ${inr(o.over, { compact: true })}`).join(', ')}` : ' · no site over budget'}</p>
                                    </div>
                                )}
                            </Fed>
                        </Card>
                        <div className="grid grid-cols-2 gap-[8px]">
                            <Card className="!p-[12px]">
                                <div className="flex items-center justify-between text-[12px]" style={{ color: N.text2 }}><span className="flex items-center gap-[5px]"><Zap className="h-3.5 w-3.5" aria-hidden />Electricity</span><Sample feed={m.elec} /></div>
                                <Fed feed={m.elec} rows={2} height={14}>
                                    {e => (
                                        <>
                                            <span className="mt-[4px] block text-[20px] leading-tight" style={num800}>{e.deltaPct === null ? 'No baseline' : `${e.deltaPct > 0 ? '+' : ''}${Math.round(e.deltaPct)}%`}</span>
                                            <span className="text-[11.5px]" style={{ color: N.text2 }}>vs same days last month{e.topSite ? `, ${e.topSite.name} +${e.topSite.deltaPct}%` : ''}</span>
                                        </>
                                    )}
                                </Fed>
                            </Card>
                            <Card className="!p-[12px]">
                                <div className="flex items-center justify-between text-[12px]" style={{ color: N.text2 }}><span>Bills at risk</span><Sample feed={m.bills} /></div>
                                <Fed feed={m.bills} rows={2} height={14}>
                                    {b => (
                                        <>
                                            <span className="mt-[4px] block text-[20px] leading-tight" style={num800}>{inr(b.atRisk, { compact: true })}</span>
                                            <span className="text-[11.5px]" style={{ color: N.text2 }}>{b.count} bills overdue or losing a discount</span>
                                        </>
                                    )}
                                </Fed>
                            </Card>
                        </div>
                    </div>
                </Section>

                <Section title="Utilities" right={<Sample feed={m.diesel} />}>
                    <Card className="flex flex-col gap-[10px]">
                        <Fed feed={m.diesel} rows={2} height={16}>
                            {d => (
                                <div>
                                    <div className="flex items-center justify-between text-[12.5px]"><span className="flex items-center gap-[6px] font-bold"><Fuel className="h-4 w-4" aria-hidden />{d.lowTank.site} {d.lowTank.dg} tank</span><b>{d.lowTank.pct}%</b></div>
                                    <Meter value={d.lowTank.pct / 100} label="Lowest diesel tank" color={N.black} track="#EFECE5" height={6} tip={`${d.lowTank.site} ${d.lowTank.dg}: ${d.lowTank.pct}%`} />
                                    <p className="mt-[6px] text-[12px]" style={{ color: N.text2 }}>{num(d.litres)} L used this month, {inr(d.cost, { compact: true })}</p>
                                </div>
                            )}
                        </Fed>
                        <Fed feed={m.water} rows={1} height={14}>
                            {w => <p className="flex items-center gap-[6px] text-[12.5px]"><Droplets className="h-4 w-4" aria-hidden /><b>{w.tankers}</b> water tanker loads today at {w.sites} site</p>}
                        </Fed>
                    </Card>
                </Section>

                <Section title="Also today">
                    <div className="grid grid-cols-3 gap-[8px]">
                        <Card className="!p-[12px]">
                            <DoorOpen className="h-4 w-4" style={{ color: N.text2 }} aria-hidden />
                            <Fed feed={m.visitors} rows={1} height={20}>{d => <><span className="mt-[4px] block text-[18px]" style={num800}>{num(d.today)}</span><span className="text-[11px]" style={{ color: N.text2 }}>Visitors today, {d.inside} inside</span></>}</Fed>
                        </Card>
                        <Card className="!p-[12px]">
                            <Coffee className="h-4 w-4" style={{ color: N.text2 }} aria-hidden />
                            <Fed feed={m.vendor} rows={1} height={20}>{d => <><span className="mt-[4px] block text-[18px]" style={num800}>{inr(d.revenue, { compact: true })}</span><span className="text-[11px]" style={{ color: N.text2 }}>Vendor revenue, month</span></>}</Fed>
                        </Card>
                        <Card className="!p-[12px]">
                            <Presentation className="h-4 w-4" style={{ color: N.text2 }} aria-hidden />
                            <Fed feed={m.rooms} rows={1} height={20}>{d => <><span className="mt-[4px] block text-[18px]" style={num800}>{d.pct}%</span><span className="flex items-center gap-[4px] text-[11px]" style={{ color: N.text2 }}>Rooms booked</span></>}</Fed>
                        </Card>
                    </div>
                    <div className="mt-[8px] flex justify-end"><Sample feed={m.rooms} /></div>
                </Section>
            </div>

            <nav aria-label="Main" className="sticky bottom-0 z-30 px-[12px] pb-[12px] pt-[6px]" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, #FFFFFF 40%)' }}>
                <div className="flex h-[60px] items-center justify-around rounded-full px-[6px]" style={{ background: N.black, boxShadow: '0 12px 30px rgba(0,0,0,0.25)' }}>
                    {ORG_TABS.map((t, i) => (
                        <button key={t.label} type="button" aria-label={t.label} aria-current={i === 0 ? 'page' : undefined} onClick={() => i !== 0 && m.previewAction(`Open ${t.label}`)}
                            className="grid h-11 w-11 place-items-center rounded-full" style={i === 0 ? { background: GOLD.gradient, color: N.black } : { color: 'rgba(255,255,255,0.7)' }}>
                            <t.icon className="h-5 w-5" aria-hidden />
                        </button>
                    ))}
                </div>
            </nav>
        </div>
    );
}
