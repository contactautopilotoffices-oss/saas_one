'use client';

import React from 'react';
import {
    AlertTriangle, Bell, CheckCircle2, ClipboardCheck, Coffee, DoorOpen, Droplets, Fuel, Presentation, ShieldCheck, Siren, Users, Zap,
} from 'lucide-react';
import { Meter, Ring } from '../lab/charts';
import { themeVars, type LabTheme } from '../lab/frame';
import { greeting, longDate, num } from '../lab/format';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { RED, RED_BG, RED_TEXT } from '../lab/status';
import { EmptyState, H, OfflineBanner, cx, listKeys, rowProps, stop } from '../lab/ui';
import { GOLD } from './palette';
import { APPROVAL_ICONS, Fed, ORG_TABS, Sample } from './parts';
import { healthOf, type OrgModel, type OrgPeriod } from './useOrgModel';

/**
 * Gilt: light, airy and photo led. The building sits under a dark gradient, frosted glass
 * tiles float over it, buttons are black pills, and gold appears only on good news. Sora.
 */

const GT = {
    page: '#F2F0EB', black: '#0B0B0C', text: '#0B0B0C', text2: '#55524B', text3: '#8C887F',
    glass: 'rgba(255,255,255,0.72)', glassBorder: 'rgba(255,255,255,0.9)', soft: 'rgba(11,11,12,0.05)', line: 'rgba(11,11,12,0.08)',
    photo: '/hero-building.jpg',
};

const theme: LabTheme = {
    font: 'var(--font-lab-sora), Sora, system-ui, sans-serif',
    page: `radial-gradient(500px 400px at 90% 40%, rgba(201,162,74,0.16), transparent 70%), radial-gradient(400px 400px at 0% 85%, rgba(11,11,12,0.06), transparent 70%), ${'#F2F0EB'}`,
    surface: '#FFFFFF', tile: GT.soft, border: GT.line, borderStrong: 'rgba(11,11,12,0.18)', grid: 'rgba(11,11,12,0.07)',
    text: GT.text, text2: GT.text2, text3: GT.text3, primary: GT.black, onPrimary: '#FFFFFF', tint: 'rgba(201,162,74,0.14)',
    ramp: ['#0B0B0C', '#3A3833', '#6E6A61', '#A39E92'], radius: '22px', radiusSm: '16px', chipRadius: '999px', btnRadius: '999px',
    focus: GT.black, skeletonA: 'rgba(11,11,12,0.05)', skeletonB: 'rgba(11,11,12,0.1)', tooltipBg: GT.black, tooltipFg: '#FFFFFF',
};

const fig: React.CSSProperties = { fontWeight: 600, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' };
const glassStyle: React.CSSProperties = { background: GT.glass, border: `1px solid ${GT.glassBorder}`, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', boxShadow: '0 10px 30px rgba(11,11,12,0.07)' };

function Glass({ children, className, style, label }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; label?: string }) {
    return <section aria-label={label} className={cx('rounded-[22px] p-[14px]', className)} style={{ ...glassStyle, ...style }}>{children}</section>;
}

function Head({ title, right }: { title: string; right?: React.ReactNode }) {
    return (
        <div className="mb-[10px] flex items-center justify-between gap-[8px] px-[2px]">
            <H level={2} className="text-[16px] font-semibold tracking-[-0.02em]">{title}</H>
            <span className="flex items-center gap-[6px]">{right}</span>
        </div>
    );
}

export default function GiltOrg({ m }: { m: OrgModel }) {
    const health = m.sites.data ? healthOf(m.sites.data) : null;

    return (
        <div className="lab-root relative flex min-h-full flex-col" style={themeVars(theme)}>
            <section className="relative text-white" style={{
                background: `linear-gradient(180deg, rgba(11,11,12,0.82) 0%, rgba(11,11,12,0.55) 55%, rgba(11,11,12,0.62) calc(100% - 44px), ${GT.page} 100%), url(${GT.photo}) center 30% / cover no-repeat`,
                paddingTop: 'calc(var(--org-safe-top, 0px) + 8px)',
            }}>
                <div className="px-[16px] pb-[64px]">
                    <div className="flex h-[52px] items-center gap-[8px] rounded-full px-[6px]" style={{ background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.28)', backdropFilter: 'blur(16px)' }}>
                        <span className="grid h-10 w-10 place-items-center rounded-full text-[14px] font-bold" style={{ background: GT.black, color: GOLD.light }}>A</span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{m.orgName}</span>
                        <button type="button" aria-label="Notifications" onClick={() => m.previewAction('Notifications')} className="relative grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.16)' }}>
                            <Bell className="h-[18px] w-[18px]" /><span className="absolute right-[9px] top-[9px] h-2 w-2 rounded-full" style={{ background: GOLD.base }} />
                        </button>
                    </div>
                    <p className="mt-[20px] text-[12.5px] text-white/70">{longDate(m.now)}</p>
                    <H level={1} className="text-[27px] font-semibold leading-tight tracking-[-0.03em]">{greeting(m.now)}, {m.user.firstName}</H>

                    <div className="mt-[16px] flex items-center gap-[14px] rounded-[24px] p-[16px]" style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.24)', backdropFilter: 'blur(16px)' }}>
                        <Fed feed={m.sites} dark rows={1} height={72} className="flex-1">
                            {() => health?.score != null ? (
                                <>
                                    <Ring value={health.score / 100} size={86} stroke={8} color={GOLD.base} track="rgba(255,255,255,0.2)" tipText={`Average of ${health.count} site scores`} ariaLabel={`Portfolio score ${health.score}`}>
                                        <span className="text-[12px] font-semibold text-white/75">/100</span>
                                    </Ring>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-[6px] text-[12px] text-white/75">Portfolio <Sample feed={m.sites} dark /></div>
                                        <div className="text-[56px] leading-none" style={fig}>{health.score}</div>
                                        <div className="mt-[4px] flex items-center gap-[5px] text-[12px] text-white/85">
                                            {health.needAttention > 0 ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                                            {health.healthy} of {health.count} sites healthy
                                        </div>
                                    </div>
                                </>
                            ) : <span className="text-[15px]">No properties yet</span>}
                        </Fed>
                    </div>

                    <div className="mt-[12px] flex items-center justify-between gap-[8px]">
                        <div role="radiogroup" aria-label="Period" className="inline-flex rounded-full p-[3px]" style={{ background: 'rgba(11,11,12,0.45)', border: '1px solid rgba(255,255,255,0.22)', backdropFilter: 'blur(16px)' }}>
                            {(['today', 'month', 'all'] as OrgPeriod[]).map(p => (
                                <button key={p} type="button" role="radio" aria-checked={m.period === p} onClick={() => m.setPeriod(p)} className="h-10 rounded-full px-[14px] text-[12.5px] font-semibold capitalize"
                                    style={m.period === p ? { background: '#FFFFFF', color: GT.black } : { color: 'rgba(255,255,255,0.85)' }}>{p}</button>
                            ))}
                        </div>
                        <Fed feed={m.raised} dark compact rows={1} height={14} className="w-[80px] justify-end">
                            {v => <span className="text-right text-[12px] leading-tight text-white/80"><b className="block text-[17px] text-white" style={fig}>{num(v)}</b>tickets raised</span>}
                        </Fed>
                    </div>
                </div>
            </section>

            <main className="relative -mt-[40px] flex flex-1 flex-col gap-[16px] px-[14px] pb-[24px]">
                <OfflineBanner online={m.online} style={{ ...glassStyle, borderRadius: 18 }} />

                <div className="grid grid-cols-2 gap-[10px]">
                    <Glass label="Waiting on you" className="!p-[14px]">
                        <span className="text-[12px]" style={{ color: GT.text2 }}>Waiting on you</span>
                        <Fed feed={m.waiting} compact rows={1} height={30}>{n => <span className="block text-[30px] leading-tight" style={fig}>{n}</span>}</Fed>
                        <span className="text-[11.5px]" style={{ color: GT.text3 }}>approvals and escalations</span>
                    </Glass>
                    <Glass label="SLA breached" className="!p-[14px]">
                        <span className="flex items-center gap-[6px] text-[12px]" style={{ color: GT.text2 }}><Siren className="h-3.5 w-3.5" style={{ color: RED }} aria-hidden />SLA breached</span>
                        <Fed feed={m.tickets} compact rows={1} height={30}>{t => <><span className="block text-[30px] leading-tight" style={{ ...fig, color: t.breached > 0 ? RED_TEXT : GT.text }}>{t.breached}</span><span className="text-[11.5px]" style={{ color: GT.text3 }}>{t.urgent} urgent open</span></>}</Fed>
                    </Glass>
                    <Glass label="On duty" className="!p-[14px]">
                        <span className="flex items-center justify-between text-[12px]" style={{ color: GT.text2 }}><span className="flex items-center gap-[6px]"><Users className="h-3.5 w-3.5" aria-hidden />On duty</span><Sample feed={m.roster} /></span>
                        <Fed feed={m.roster} compact rows={1} height={30}>{r => <><span className="block text-[30px] leading-tight" style={fig}>{r.coveragePct}%</span><span className="text-[11.5px]" style={{ color: GT.text3 }}>{r.absent} absent, {r.shortTomorrow} short tomorrow</span></>}</Fed>
                    </Glass>
                    <Glass label="PPM on time" className="!p-[14px]">
                        <span className="flex items-center justify-between text-[12px]" style={{ color: GT.text2 }}><span className="flex items-center gap-[6px]"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />PPM on time</span><Sample feed={m.ppm} /></span>
                        <Fed feed={m.ppm} compact rows={1} height={30}>{p => (
                            <>
                                <span className="inline-block text-[30px] leading-tight" style={{ ...fig, color: p.pct >= p.target ? GOLD.deep : GT.text }}>{p.pct}%</span>
                                <span className="block text-[11.5px]" style={{ color: GT.text3 }}>target {p.target}%, {p.overdue} overdue</span>
                            </>
                        )}</Fed>
                    </Glass>
                </div>

                <div>
                    <Head title="Waiting on you" />
                    <div className="flex flex-col gap-[8px]" onKeyDown={listKeys}>
                        {m.approvals.map((f, i) => {
                            const id = (['po', 'mr', 'petty', 'escalation'] as const)[i];
                            const Icon = APPROVAL_ICONS[id];
                            return (
                                <Fed key={id} feed={f} rows={1} height={62}>
                                    {a => (
                                        <div {...rowProps(() => m.previewAction(`${a.action} ${a.label.toLowerCase()}`), a.label)} className="flex cursor-pointer items-center gap-[12px] rounded-[20px] px-[12px] py-[12px]" style={glassStyle}>
                                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: a.id === 'escalation' ? RED_BG : GT.soft }}>
                                                <Icon className="h-[18px] w-[18px]" style={{ color: a.id === 'escalation' ? RED : GT.text }} aria-hidden />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-[6px] text-[13.5px] font-semibold">{a.count} {a.label.toLowerCase()}<Sample feed={f} /></span>
                                                <span className="block truncate text-[12px]" style={{ color: GT.text2 }}>{a.detail}{a.value ? ` · ${a.value}` : ''}</span>
                                            </span>
                                            <button type="button" onClick={stop(() => m.previewAction(`${a.action} ${a.label.toLowerCase()}`))} className="h-10 shrink-0 rounded-full px-[14px] text-[12.5px] font-semibold text-white" style={{ background: GT.black }}>{a.action}</button>
                                        </div>
                                    )}
                                </Fed>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <Head title="Sites" right={<Sample feed={m.sites} />} />
                    <Fed feed={m.sites} rows={1} height={140}>
                        {sites => sites.length === 0 ? <Glass><EmptyState compact title="No properties yet" body="Add a property to see it here." actionLabel="Add property" onAction={() => m.previewAction('Add property')} /></Glass> : (
                            <div className="lab-scroll-x -mx-[14px] flex snap-x gap-[10px] overflow-x-auto px-[14px] pb-[4px]">
                                {sites.map(s => {
                                    const ok = s.score >= 85;
                                    return (
                                        <button key={s.id} type="button" onClick={() => m.previewAction(`Open ${s.name}`)} className="flex w-[170px] shrink-0 snap-start flex-col rounded-[22px] p-[14px] text-left" style={glassStyle}>
                                            <span className="flex items-center justify-between">
                                                <span className="grid h-10 w-10 place-items-center rounded-full text-[12px] font-bold" style={{ background: GT.black, color: GOLD.light }}>{s.code.slice(0, 3)}</span>
                                                <span className="text-[26px] leading-none" style={{ ...fig, color: ok ? GOLD.deep : GT.text }}>{s.score}</span>
                                            </span>
                                            <span className="mt-[10px] truncate text-[13.5px] font-semibold">{s.name}</span>
                                            <span className="flex items-center gap-[4px] text-[11.5px]" style={{ color: GT.text2 }}>
                                                {ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}{ok ? 'Healthy' : 'Needs attention'}
                                            </span>
                                            <span className="mt-[8px] text-[11.5px]" style={{ color: GT.text3 }}>{s.active} active · {s.urgent} urgent{s.overBudget ? ` · ${inr(s.overBudget, { compact: true })} over` : ''}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </Fed>
                </div>

                <Glass label="Compliance">
                    <Head title="Compliance" right={<Sample feed={m.rounds} />} />
                    <Fed feed={m.rounds} rows={1} height={16}>
                        {r => r.missed > 0 ? <p className="flex items-start gap-[8px] text-[12.5px]"><ClipboardCheck className="mt-[1px] h-4 w-4 shrink-0" style={{ color: RED }} aria-hidden /><span><b style={{ color: RED_TEXT }}>{r.missed} rounds late</b> at {r.sites} sites. {r.worst}.</span></p> : <p className="text-[12.5px]">No rounds late.</p>}
                    </Fed>
                    <Fed feed={m.amc} rows={1} height={16} className="mt-[8px]">
                        {list => list.length ? (
                            <div className="mt-[10px] flex flex-col gap-[6px]">
                                {list.map(a => (
                                    <div key={a.id} className="flex items-center justify-between rounded-[14px] px-[12px] py-[8px] text-[12.5px]" style={{ background: GT.soft }}>
                                        <span>AMC: {a.asset}, {a.site}</span><b>{a.days} days</b>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </Fed>
                    <Fed feed={m.grievances} rows={1} height={14} className="mt-[8px]">
                        {g => <p className="mt-[10px] text-[12.5px]" style={{ color: GT.text2 }}><b style={{ color: GT.text }}>{g.open}</b> HR grievances open, oldest {g.oldestDays} days</p>}
                    </Fed>
                </Glass>

                <Glass label="Money">
                    <Head title="Money" right={<Sample feed={m.budget} />} />
                    <Fed feed={m.budget} rows={2} height={16}>
                        {b => (
                            <div>
                                <div className="flex items-baseline justify-between text-[13px]"><span>Budget used this month</span><b className="text-[20px]" style={fig}>{b.pct}%</b></div>
                                <Meter value={b.pct / 100} label="Budget used" color={GT.black} track="rgba(11,11,12,0.08)" height={8} tip={`${inr(b.spent, { compact: true })} of ${inr(b.total, { compact: true })}`} />
                                <p className="mt-[6px] text-[12px]" style={{ color: GT.text2 }}>{b.overSites.length ? `Over: ${b.overSites.map(o => `${o.name} ${inr(o.over, { compact: true })}`).join(', ')}` : 'No site over budget'}</p>
                            </div>
                        )}
                    </Fed>
                    <div className="mt-[12px] grid grid-cols-2 gap-[8px]">
                        <div className="rounded-[16px] p-[12px]" style={{ background: GT.soft }}>
                            <span className="flex items-center justify-between text-[12px]" style={{ color: GT.text2 }}><span className="flex items-center gap-[5px]"><Zap className="h-3.5 w-3.5" aria-hidden />Electricity</span><Sample feed={m.elec} /></span>
                            <Fed feed={m.elec} rows={1} height={18}>{e => <><span className="block text-[20px]" style={fig}>{e.deltaPct === null ? 'No baseline' : `${e.deltaPct > 0 ? '+' : ''}${Math.round(e.deltaPct)}%`}</span><span className="text-[11px]" style={{ color: GT.text3 }}>vs last month so far</span></>}</Fed>
                        </div>
                        <div className="rounded-[16px] p-[12px]" style={{ background: GT.soft }}>
                            <span className="flex items-center justify-between text-[12px]" style={{ color: GT.text2 }}>Bills at risk<Sample feed={m.bills} /></span>
                            <Fed feed={m.bills} rows={1} height={18}>{b => <><span className="block text-[20px]" style={fig}>{inr(b.atRisk, { compact: true })}</span><span className="text-[11px]" style={{ color: GT.text3 }}>{b.count} bills</span></>}</Fed>
                        </div>
                    </div>
                </Glass>

                <Glass label="Utilities">
                    <Head title="Utilities" right={<Sample feed={m.diesel} />} />
                    <Fed feed={m.diesel} rows={2} height={14}>
                        {d => (
                            <div className="flex flex-col gap-[8px] text-[12.5px]">
                                <div className="flex items-center gap-[8px]"><Fuel className="h-4 w-4" aria-hidden /><span className="flex-1">{d.lowTank.site} {d.lowTank.dg}</span><span className="w-[100px]"><Meter value={d.lowTank.pct / 100} label="Lowest diesel tank" color={GT.black} track="rgba(11,11,12,0.08)" height={6} tip={`${d.lowTank.pct}% full`} /></span><b>{d.lowTank.pct}%</b></div>
                                <div className="flex items-center gap-[8px]" style={{ color: GT.text2 }}><Droplets className="h-4 w-4" aria-hidden />{m.water.data?.tankers ?? 0} tankers today · {num(d.litres)} L diesel this month</div>
                            </div>
                        )}
                    </Fed>
                </Glass>

                <div className="grid grid-cols-3 gap-[8px]">
                    <Glass className="!p-[12px]"><DoorOpen className="h-4 w-4" aria-hidden /><Fed feed={m.visitors} rows={1} height={18}>{v => <span className="mt-[4px] block text-[18px]" style={fig}>{num(v.today)}</span>}</Fed><span className="text-[11px]" style={{ color: GT.text3 }}>Visitors</span></Glass>
                    <Glass className="!p-[12px]"><Coffee className="h-4 w-4" aria-hidden /><Fed feed={m.vendor} rows={1} height={18}>{v => <span className="mt-[4px] block text-[18px]" style={fig}>{inr(v.revenue, { compact: true })}</span>}</Fed><span className="text-[11px]" style={{ color: GT.text3 }}>Vendor revenue</span></Glass>
                    <Glass className="!p-[12px]"><span className="flex items-center justify-between"><Presentation className="h-4 w-4" aria-hidden /><Sample feed={m.rooms} /></span><Fed feed={m.rooms} rows={1} height={18}>{r => <span className="mt-[4px] block text-[18px]" style={fig}>{r.pct}%</span>}</Fed><span className="text-[11px]" style={{ color: GT.text3 }}>Rooms booked</span></Glass>
                </div>
            </main>

            <nav aria-label="Main" className="sticky bottom-0 z-30 px-[12px] pb-[12px] pt-[6px]">
                <div className="flex h-[60px] items-center justify-around rounded-full px-[6px]" style={{ ...glassStyle, background: 'rgba(255,255,255,0.82)' }}>
                    {ORG_TABS.map((t, i) => (
                        <button key={t.label} type="button" aria-label={t.label} aria-current={i === 0 ? 'page' : undefined} onClick={() => i !== 0 && m.previewAction(`Open ${t.label}`)}
                            className="grid h-11 w-11 place-items-center rounded-full" style={i === 0 ? { background: GT.black, color: '#FFFFFF' } : { color: GT.text2 }}>
                            <t.icon className="h-5 w-5" aria-hidden />
                        </button>
                    ))}
                </div>
            </nav>
        </div>
    );
}
