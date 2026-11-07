'use client';

import React from 'react';
import {
    Bell, Building, ClipboardX, FileBarChart, Fuel, HelpCircle, MessageSquare, Settings, ShieldCheck, Users, Wallet, Wrench, Zap,
} from 'lucide-react';
import { LineArea, Ring, SegmentBar } from '../../lab/charts';
import { inrCompact, initials, num } from '../../lab/format';
import { RED, RED_TEXT } from '../../lab/status';
import { listKeys } from '../../lab/ui';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { Fed, Sample } from '../parts';
import { dayLabels } from '../derive';
import { ORG_SAMPLE } from '../orgSample';
import { sampleFeed, preview } from '../useOrgModel';
import { C, fig, useApp } from './core';
import { PPM_OVERDUE, SITE_EXTRAS } from './sample';
import { Bars, Card, GhostButton, LargeTitle, Row, Section, Tag, TargetMeter, TopBar } from './ui';

/** More, and the three screens it leads to: Money, People and Compliance. */

export function MoreScreen() {
    const { m, push, unread } = useApp();
    const b = m.budget.data;
    const r = m.roster.data;
    const p = m.ppm.data;
    return (
        <div>
            <LargeTitle title="More" />
            <Card className="mx-[16px] mt-[8px] flex items-center gap-[12px] p-[16px]">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-[18px] font-bold text-white" style={{ background: C.accent }}>{initials(m.user.name)}</span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-bold">{m.user.name}</span>
                    <span className="block truncate text-[12.5px]" style={{ color: C.text3 }}>{m.user.roleLabel}, {m.orgName}</span>
                </span>
                <button type="button" onClick={() => m.previewAction('Switch organisation')} className="inline-flex h-10 items-center rounded-full px-[12px] text-[12.5px] font-bold" style={{ background: C.track, color: C.accentDeep }}>Switch</button>
            </Card>

            <Section title="Overview">
                <Card className="p-[6px]">
                    <ul onKeyDown={listKeys}>
                        <li><Row icon={Wallet} title="Money and utilities" sub="Budget, electricity, diesel, vendors" onClick={() => push({ name: 'money' })} right={b && <span className="text-[14px]" style={fig}>{b.pct}%</span>} /></li>
                        <li><Row icon={Users} title="People" sub="On shift, by site, HR grievances" onClick={() => push({ name: 'people' })} right={r && <span className="text-[14px]" style={fig}>{r.present}/{r.scheduled}</span>} /></li>
                        <li><Row icon={ShieldCheck} title="Compliance" sub="PPM, late rounds, AMC renewals" onClick={() => push({ name: 'compliance' })} right={p && <span className="text-[14px]" style={fig}>{p.pct}%</span>} /></li>
                        <li><Row icon={Bell} title="Notifications" sub={unread ? `${unread} unread` : 'All read'} onClick={() => push({ name: 'notifications' })} /></li>
                    </ul>
                </Card>
            </Section>

            <Section title="Tools">
                <Card className="p-[6px]">
                    <ul onKeyDown={listKeys}>
                        <li><Row icon={FileBarChart} title="Reports" sub="Morning report, monthly review" onClick={() => m.previewAction('Open reports')} /></li>
                        <li><Row icon={Building} title="Properties and teams" sub="Add a site, assign managers" onClick={() => m.previewAction('Open properties and teams')} /></li>
                        <li><Row icon={Settings} title="Settings" sub="Alerts, approval limits, language" onClick={() => m.previewAction('Open settings')} /></li>
                        <li><Row icon={HelpCircle} title="Help" sub="Guides and support" onClick={() => m.previewAction('Open help')} /></li>
                    </ul>
                </Card>
            </Section>
        </div>
    );
}

/* ------------------------------------------------------------- money */

export function MoneyScreen() {
    const { m, push, siteByName } = useApp();
    const days = dayLabels(m.now, 14);
    // The 14 day electricity series is not in the pace feed yet, so it is sample everywhere.
    const elec14 = preview(sampleFeed(ORG_SAMPLE.elec.last14), m.preview, null);
    return (
        <div>
            <TopBar title="Money and utilities" />
            <Card className="mx-[16px] p-[16px]">
                <p className="flex items-center gap-[6px] text-[13px] font-semibold" style={{ color: C.text2 }}>Budget used this month<Sample feed={m.budget} /></p>
                <Fed feed={m.budget} rows={3} height={26} className="mt-[10px]">
                    {b => (
                        <>
                            <div className="mt-[4px] flex items-center gap-[14px]">
                                <span className="text-[56px] leading-[0.9]" style={fig}>{b.pct}%</span>
                                <span className="text-[13px]" style={{ color: C.text2 }}><b className="block text-[15px]" style={{ ...fig, color: C.text }}>{inr(b.spent, { compact: true })}</b>of {inr(b.total, { compact: true })}</span>
                            </div>
                            <div className="mt-[14px]"><TargetMeter pct={b.pct} label="Budget used" tip={`${inr(b.spent, { compact: true })} spent, ${inr(Math.max(0, b.total - b.spent), { compact: true })} left`} /></div>
                            <p className="mt-[8px] text-[12.5px]" style={{ color: C.text3 }}>{inr(Math.max(0, b.total - b.spent), { compact: true })} left for the rest of the month.</p>
                        </>
                    )}
                </Fed>
            </Card>

            <Section title="Over budget" right={<Sample feed={m.budget} />}>
                <Fed feed={m.budget} rows={2} height={56}>
                    {b => b.overSites.length === 0
                        ? <Card className="px-[16px] py-[16px] text-[13px]" style={{ color: C.text2 }}>Every site is within budget.</Card>
                        : (
                            <Card className="p-[16px]">
                                <Bars ariaLabel="Sites over budget" rows={b.overSites.map(o => {
                                    const s = siteByName(o.name);
                                    const max = Math.max(...b.overSites.map(x => x.over));
                                    return { key: o.name, name: o.name, value: o.over, max, text: `${inrCompact(o.over)} over`, tip: `${o.name}: ${inr(o.over)} over this month`, color: C.barWarn, onOpen: s ? () => push({ name: 'site', id: s.id }) : undefined };
                                })} />
                            </Card>
                        )}
                </Fed>
            </Section>

            <Section title="Electricity" right={<Sample feed={elec14} />}>
                <Card className="p-[16px]">
                    <Fed feed={m.elec} rows={2} height={20}>
                        {e => (
                            <div className="flex items-start gap-[10px]">
                                <Zap className="mt-[2px] h-[18px] w-[18px] shrink-0" style={{ color: C.accentDeep }} aria-hidden />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[15px] font-bold">{e.deltaPct === null ? 'No reading yet' : `${e.deltaPct > 0 ? '+' : ''}${e.deltaPct}% vs last month`}</span>
                                    <span className="block text-[12.5px]" style={{ color: C.text3 }}>{e.topSite ? `Highest: ${e.topSite.name}, ${e.topSite.deltaPct > 0 ? '+' : ''}${e.topSite.deltaPct}%` : 'Same days last month'}</span>
                                </span>
                                <span className="text-[15px]" style={fig}>{num(e.units)}<span className="block text-right text-[11px] font-semibold" style={{ color: C.text3 }}>units</span></span>
                            </div>
                        )}
                    </Fed>
                    <Fed feed={elec14} rows={1} height={100} className="mt-[12px]">
                        {series => (
                            <div className="mt-[12px]">
                                <LineArea data={series.map((v, i) => ({ label: days[i].long, value: v }))} color={C.accent} height={110} fitRange format={n => `${n.toFixed(1)}k`}
                                    xLabels={[{ index: 0, text: days[0].short }, { index: series.length - 1, text: 'Today' }]} partialLast
                                    ariaLabel="Electricity per day, last 14 days, in thousand units" />
                                <p className="mt-[4px] text-[12px]" style={{ color: C.text3 }}>Thousand units per day. Today is still counting.</p>
                            </div>
                        )}
                    </Fed>
                </Card>
            </Section>

            <Section title="Bills and fuel" right={<Sample feed={m.diesel} />}>
                <Card className="p-[6px]">
                    <ul onKeyDown={listKeys}>
                        <li>
                            <Fed feed={m.bills} rows={1} height={44} className="p-[10px]">
                                {bl => <Row icon={Zap} title={bl.count ? `${bl.count} electricity ${bl.count === 1 ? 'bill' : 'bills'} at risk` : 'No bills at risk'} sub={bl.count ? `${inr(bl.atRisk, { compact: true })} overdue or losing a discount` : 'Everything paid on time'} onClick={() => m.previewAction('Review bills')} />}
                            </Fed>
                        </li>
                        <li>
                            <Fed feed={m.diesel} rows={1} height={44} className="p-[10px]">
                                {d => <Row icon={Fuel} title={`Lowest tank: ${d.lowTank.site} ${d.lowTank.dg}`} sub={`${num(d.litres)} L used this month, ${inr(d.cost, { compact: true })}`} onClick={() => m.previewAction('Order a diesel refill')}
                                    right={<Tag tone="plain">{d.lowTank.pct}%</Tag>} />}
                            </Fed>
                        </li>
                        <li>
                            <Fed feed={m.vendor} rows={1} height={44} className="p-[10px]">
                                {v => <Row icon={Wallet} title={`Vendor revenue ${inr(v.revenue, { compact: true })}`} sub={v.leader ? `Led by ${v.leader}` : 'This month'} onClick={() => m.previewAction('Open vendor revenue')} />}
                            </Fed>
                        </li>
                    </ul>
                </Card>
            </Section>
        </div>
    );
}

/* ------------------------------------------------------------ people */

export function PeopleScreen() {
    const { m, push, siteByName } = useApp();
    const sites = Object.entries(SITE_EXTRAS);
    return (
        <div>
            <TopBar title="People" />
            <Card className="mx-[16px] p-[16px]">
                <p className="flex items-center gap-[6px] text-[13px] font-semibold" style={{ color: C.text2 }}>On shift now<Sample feed={m.roster} /></p>
                <Fed feed={m.roster} rows={3} height={24} className="mt-[10px]">
                    {r => (
                        <>
                            <div className="mt-[4px] flex items-end gap-[10px]">
                                <span className="text-[56px] leading-[0.9]" style={fig}>{r.present}</span>
                                <span className="pb-[4px] text-[13px] font-semibold" style={{ color: C.text2 }}>of {r.scheduled} present<br /><span style={{ color: C.accentDeep }}>{r.coveragePct}% coverage</span></span>
                            </div>
                            <SegmentBar className="mt-[14px]" height={12} gap={3} ariaLabel={`On time ${r.present}, late ${r.late}, absent ${r.absent}`}
                                segments={[{ label: 'On time', value: r.present, color: C.accent }, { label: 'Late', value: r.late, color: C.barWarn }, { label: 'Absent', value: r.absent, color: C.muted }]} />
                            <ul aria-label="Legend" className="mt-[10px] flex flex-wrap gap-x-[14px] gap-y-[4px] text-[12px]" style={{ color: C.text2 }}>
                                {([['On time', r.present, C.accent], ['Late', r.late, C.barWarn], ['Absent', r.absent, C.muted]] as const).map(([l, v, c]) => (
                                    <li key={l} className="flex items-center gap-[6px]"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l} <b style={{ ...fig, color: C.text }}>{v}</b></li>
                                ))}
                            </ul>
                        </>
                    )}
                </Fed>
            </Card>

            <Section title="By site" right={<Sample feed={{ sample: true }} />}>
                <Fed feed={m.roster} rows={4} height={30}>
                    {() => (
                        <Card className="p-[16px]">
                            <Bars ariaLabel="Staff on shift by site" rows={sites.map(([name, x]) => {
                                const s = siteByName(name);
                                return { key: name, name, value: x.present, max: x.scheduled, text: `${x.present} of ${x.scheduled}`, tip: `${name}: ${x.present} of ${x.scheduled} on shift, ${x.scheduled - x.present} missing`, color: x.present / x.scheduled < 0.9 ? C.barWarn : C.accent, onOpen: s ? () => push({ name: 'site', id: s.id }) : undefined };
                            })} />
                        </Card>
                    )}
                </Fed>
            </Section>

            <Section title="Coming up">
                <Card className="p-[6px]">
                    <ul onKeyDown={listKeys}>
                        <li>
                            <Fed feed={m.roster} rows={1} height={44} className="p-[10px]">
                                {r => <Row icon={Users} title={r.shortTomorrow ? `${r.shortTomorrow} short tomorrow` : 'Tomorrow is fully staffed'} sub={`Most absent today: ${r.worst.name}`} onClick={() => m.previewAction('Open tomorrow\'s roster')} />}
                            </Fed>
                        </li>
                        <li>
                            <Fed feed={m.grievances} rows={1} height={44} className="p-[10px]">
                                {g => <Row icon={MessageSquare} title={`${g.open} HR ${g.open === 1 ? 'grievance' : 'grievances'} open`} sub={g.open ? `Oldest ${g.oldestDays} days` : 'Nothing open'} onClick={() => m.previewAction('Open HR grievances')} right={<Sample feed={m.grievances} />} />}
                            </Fed>
                        </li>
                    </ul>
                </Card>
            </Section>

            <div className="px-[16px] pt-[18px]"><GhostButton icon={MessageSquare} className="w-full" onClick={() => m.previewAction('Message all site managers')}>Message site managers</GhostButton></div>
        </div>
    );
}

/* -------------------------------------------------------- compliance */

export function ComplianceScreen() {
    const { m, siteByName, push } = useApp();
    const overdue = preview(sampleFeed(PPM_OVERDUE), m.preview, []);
    return (
        <div>
            <TopBar title="Compliance" />
            <Card className="mx-[16px] p-[16px]">
                <p className="flex items-center gap-[6px] text-[13px] font-semibold" style={{ color: C.text2 }}>PPM done on time<Sample feed={m.ppm} /></p>
                <Fed feed={m.ppm} rows={3} height={24} className="mt-[10px]">
                    {p => (
                        <>
                            <div className="mt-[4px] flex items-center gap-[14px]">
                                <span className="text-[56px] leading-[0.9]" style={fig}>{p.pct}%</span>
                                <span className="text-[13px]" style={{ color: C.text2 }}>target {p.target}%<br /><b style={{ color: C.text }}>{p.pct >= p.target ? 'On target' : `${p.target - p.pct} points short`}</b></span>
                            </div>
                            <div className="mt-[16px]"><TargetMeter pct={p.pct} target={p.target} label="PPM done on time" tip={`${p.pct}% done on time, target ${p.target}%`} /></div>
                            <div className="mt-[12px] grid grid-cols-2 gap-[8px]">
                                {([['Overdue', p.overdue], ['Due today', p.dueToday]] as const).map(([k, v]) => (
                                    <div key={k} className="rounded-[14px] px-[12px] py-[8px]" style={{ background: C.track }}>
                                        <span className="block text-[11.5px] font-semibold" style={{ color: C.text3 }}>{k}</span>
                                        <span className="block text-[18px]" style={fig}>{v}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </Fed>
            </Card>

            <Section title="Overdue by system" right={<Sample feed={overdue} />}>
                <Fed feed={overdue} rows={4} height={24}>
                    {list => list.length === 0 ? <Card className="px-[16px] py-[16px] text-[13px]" style={{ color: C.text2 }}>Nothing overdue.</Card> : (
                        <Card className="p-[16px]">
                            <Bars ariaLabel="Overdue PPM by system" rows={list.map(x => ({ key: x.name, name: x.name, value: x.count, max: Math.max(...list.map(y => y.count)), text: `${x.count} overdue`, tip: `${x.name}: ${x.count} overdue` }))} />
                        </Card>
                    )}
                </Fed>
            </Section>

            <Section title="Rounds" right={<Sample feed={m.rounds} />}>
                <Fed feed={m.rounds} rows={1} height={60}>
                    {r => r.missed === 0
                        ? <Card className="px-[16px] py-[16px] text-[13px]" style={{ color: C.text2 }}>Every round is on time.</Card>
                        : (
                            <Card className="flex items-start gap-[12px] p-[16px]">
                                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: '#FDECEC' }}><ClipboardX className="h-[18px] w-[18px]" style={{ color: RED }} aria-hidden /></span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[14px] font-bold" style={{ color: RED_TEXT }}>{r.missed} {r.missed === 1 ? 'round' : 'rounds'} late at {r.sites} {r.sites === 1 ? 'site' : 'sites'}</span>
                                    <span className="block text-[12.5px]" style={{ color: C.text3 }}>Latest: {r.worst}</span>
                                </span>
                            </Card>
                        )}
                </Fed>
            </Section>

            <Section title="AMC renewals" right={<Sample feed={m.amc} />}>
                <Fed feed={m.amc} rows={3} height={56}>
                    {list => list.length === 0 ? <Card className="px-[16px] py-[16px] text-[13px]" style={{ color: C.text2 }}>No renewals in the next 30 days.</Card> : (
                        <Card className="p-[6px]">
                            <ul onKeyDown={listKeys}>
                                {list.map(a => {
                                    const s = siteByName(a.site);
                                    return (
                                        <li key={a.id} className="flex items-center gap-[12px] px-[10px] py-[10px]">
                                            <Ring value={1 - a.days / 30} size={44} stroke={5} color={a.days <= 14 ? C.accentDeep : C.bar} track={C.track} tipText={`${a.days} of 30 days left`} ariaLabel={`${a.days} days left`}>
                                                <span className="text-[12px]" style={fig}>{a.days}d</span>
                                            </Ring>
                                            <button type="button" data-lab-item onClick={() => (s ? push({ name: 'site', id: s.id }) : m.previewAction(a.site))} className="min-w-0 flex-1 rounded-[10px] text-left">
                                                <span className="block truncate text-[13.5px] font-semibold"><Wrench className="mr-[6px] inline h-3.5 w-3.5" style={{ color: C.accentDeep }} aria-hidden />{a.asset}</span>
                                                <span className="block truncate text-[12px]" style={{ color: C.text3 }}>{a.site}, ends in {a.days} days</span>
                                            </button>
                                            <button type="button" onClick={() => m.previewAction(`Renew ${a.asset} AMC at ${a.site}`)} className="inline-flex h-10 shrink-0 items-center rounded-full px-[14px] text-[12.5px] font-bold" style={{ background: C.tint, color: C.accentDeep }}>Renew</button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </Card>
                    )}
                </Fed>
            </Section>
        </div>
    );
}
