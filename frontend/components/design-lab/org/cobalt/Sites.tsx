'use client';

import React, { useState } from 'react';
import {
    AlertTriangle, CheckCircle2, ClipboardX, Fuel, MessageSquare, Phone, Plus, Search, Ticket, Timer, Wallet, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { LineArea, Ring, SegmentBar, Sparkline } from '../../lab/charts';
import { inrCompact, num } from '../../lab/format';
import { EmptyState, cx, listKeys } from '../../lab/ui';
import { Fed, Sample } from '../parts';
import { dayLabels } from '../derive';
import { healthOf, type OrgModel, type OrgSite } from '../useOrgModel';
import { C, fig, useApp, type SiteFilter, type SiteSort } from './core';
import { ApprovalCard } from './Approvals';
import { SITE_EXTRAS } from './sample';
import { Card, GhostButton, LargeTitle, Pills, PrimaryButton, Row, Section, Tag, TopBar } from './ui';

/**
 * Sites: the portfolio at one glance, then every property as a card you can search, filter
 * and sort. A site opens its own page with its score, trend, what waits on you there, its
 * risks and its team.
 */

const SORTS: { id: SiteSort; label: string }[] = [
    { id: 'score', label: 'Lowest score first' }, { id: 'active', label: 'Most active tickets' }, { id: 'name', label: 'Name, A to Z' },
];

function band(score: number): { label: string; tone: 'attention' | 'watch' | 'good' } {
    if (score < 85) return { label: 'Needs attention', tone: 'attention' };
    if (score < 95) return { label: 'Watch', tone: 'watch' };
    return { label: 'Healthy', tone: 'good' };
}

function SiteCard({ s, onOpen, days }: { s: OrgSite; onOpen: () => void; days: string[] }) {
    const b = band(s.score);
    const extra = SITE_EXTRAS[s.name];
    return (
        <button type="button" data-lab-item onClick={onOpen} aria-label={`${s.name}, score ${s.score}, ${b.label}, ${s.active} active tickets`}
            className="flex w-full items-center gap-[12px] rounded-[22px] p-[12px] text-left" style={{ background: C.card }}>
            <Ring value={s.score / 100} size={54} stroke={6} color={b.tone === 'attention' ? C.barWarn : C.accent} track={C.track} tipText={`Score ${s.score} of 100`} ariaLabel={`Score ${s.score}`}>
                <span className="text-[15px]" style={fig}>{s.score}</span>
            </Ring>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-[6px] text-[14.5px] font-bold">
                    {b.tone === 'attention' && <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: C.accentDeep }} aria-hidden />}
                    <span className="truncate">{s.name}</span>
                </span>
                <span className="block truncate text-[12px]" style={{ color: C.text3 }}>{s.code}{extra ? `, ${extra.manager}` : ''}</span>
                <span className="mt-[4px] block truncate text-[12px] tabular-nums" style={{ color: C.text2 }}>{s.active} active, {s.urgent} urgent</span>
                {s.overBudget ? <span className="mt-[6px] flex"><Tag tone="plain" icon={Wallet}>{inrCompact(s.overBudget)} over budget</Tag></span> : null}
            </span>
            {s.trend.length > 1 && <Sparkline values={s.trend} labels={days.slice(-s.trend.length)} color={C.accent} width={56} height={30} ariaLabel={`${s.name}, active tickets over ${s.trend.length} days`} />}
        </button>
    );
}

export function SitesScreen({ initialSort, initialFilter }: { initialSort?: SiteSort; initialFilter?: SiteFilter }) {
    const { m, push } = useApp();
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<SiteFilter>(initialFilter ?? 'all');
    const [sort, setSort] = useState<SiteSort>(initialSort ?? 'score');
    const sites = m.sites.data ?? [];
    const health = healthOf(sites);
    const days = dayLabels(m.now, 14).map(d => d.long);
    const watch = sites.filter(s => s.score >= 85 && s.score < 95).length;
    const counts = { all: sites.length, attention: health.needAttention, over: sites.filter(s => s.overBudget).length };
    const q = query.trim().toLowerCase();
    const shown = sites
        .filter(s => filter === 'all' || (filter === 'attention' ? s.score < 85 : !!s.overBudget))
        .filter(s => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
        .sort((a, b) => (sort === 'score' ? a.score - b.score : sort === 'active' ? b.active - a.active : a.name.localeCompare(b.name)));

    return (
        <div>
            <LargeTitle title="Sites" sub={m.sites.state === 'ready' ? `${sites.length} ${sites.length === 1 ? 'property' : 'properties'} in ${m.orgName}` : 'Your properties'} right={<Sample feed={m.sites} />} />

            {!(m.sites.state === 'ready' && sites.length === 0) && <Card className="mx-[16px] mt-[8px] p-[16px]">
                <Fed feed={m.sites} rows={3} height={26}>
                    {() => (
                        <>
                            <div className="flex items-end gap-[12px]">
                                <span className="text-[52px] leading-[0.9]" style={fig}>{health.score}</span>
                                <span className="pb-[4px] text-[13px] font-semibold" style={{ color: C.text2 }}>average<br />site score</span>
                            </div>
                            <SegmentBar className="mt-[14px]" height={12} gap={3} ariaLabel={`Needs attention ${health.needAttention}, watch ${watch}, healthy ${health.healthy}`}
                                segments={[{ label: 'Needs attention', value: health.needAttention, color: C.barWarn }, { label: 'Watch', value: watch, color: C.bar }, { label: 'Healthy', value: health.healthy, color: C.accent }]} />
                            <ul aria-label="Legend" className="mt-[10px] flex flex-wrap gap-x-[14px] gap-y-[4px] text-[12px]" style={{ color: C.text2 }}>
                                {([['Needs attention', health.needAttention, C.barWarn, 'below 85'], ['Watch', watch, C.bar, '85 to 94'], ['Healthy', health.healthy, C.accent, '95 and up']] as const).map(([l, v, c, range]) => (
                                    <li key={l} className="flex items-center gap-[6px]" title={range}><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l} <b style={{ ...fig, color: C.text }}>{v}</b></li>
                                ))}
                            </ul>
                        </>
                    )}
                </Fed>
            </Card>}

            <div className="mt-[14px] px-[16px]">
                <label className="flex h-12 items-center gap-[8px] rounded-full px-[14px]" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.border}` }}>
                    <Search className="h-[18px] w-[18px] shrink-0" style={{ color: C.text3 }} aria-hidden />
                    <span className="sr-only">Search sites</span>
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or code" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[color:var(--cb-placeholder)]" />
                    {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="-mr-[8px] grid h-10 w-10 place-items-center rounded-full"><X className="h-4 w-4" aria-hidden /></button>}
                </label>
            </div>

            <Pills className="mt-[10px]" label="Filter sites" value={filter} onChange={setFilter}
                options={[{ id: 'all', label: 'All', count: m.sites.state === 'ready' ? counts.all : null }, { id: 'attention', label: 'Needs attention', count: m.sites.state === 'ready' ? counts.attention : null }, { id: 'over', label: 'Over budget', count: m.sites.state === 'ready' ? counts.over : null }]} />

            <div className="mt-[10px] flex items-center px-[16px]">
                <span className="text-[12.5px]" style={{ color: C.text3 }}>{m.sites.state === 'ready' ? `${shown.length} shown` : ''}</span>
                <label className="ml-auto inline-flex h-10 items-center rounded-full px-[12px] text-[12.5px] font-semibold" style={{ background: C.card }}>
                    <span className="sr-only">Sort</span>
                    <select value={sort} onChange={e => setSort(e.target.value as SiteSort)} className="bg-transparent font-semibold outline-none" style={{ color: C.text }}>
                        {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                </label>
            </div>

            <div className="px-[16px] pt-[10px]">
                <Fed feed={m.sites} rows={4} height={80}>
                    {() => shown.length === 0 ? (
                        <Card>
                            <EmptyState compact icon={Search} title={q ? `No site matches "${query.trim()}"` : sites.length === 0 ? 'No properties yet' : 'No sites in this filter'}
                                body={q ? 'Try a shorter name or the site code.' : undefined}
                                actionLabel={q ? 'Clear search' : sites.length === 0 ? 'Add property' : 'Show all sites'}
                                onAction={() => (q ? setQuery('') : sites.length === 0 ? m.previewAction('Add property') : setFilter('all'))} />
                        </Card>
                    ) : (
                        <ul className="flex flex-col gap-[10px]" onKeyDown={listKeys}>
                            {shown.map(s => <li key={s.id}><SiteCard s={s} days={days} onOpen={() => push({ name: 'site', id: s.id })} /></li>)}
                        </ul>
                    )}
                </Fed>
            </div>
        </div>
    );
}

/* ---------------------------------------------------------- site detail */

interface SiteRisk { key: string; icon: LucideIcon; title: string; meta: string; red?: boolean; to?: 'compliance' | 'money' }

function risksAt(m: OrgModel, s: OrgSite): SiteRisk[] {
    const out: SiteRisk[] = [];
    const r = m.rounds.data;
    if (r && r.missed > 0 && r.worst.includes(s.name)) out.push({ key: 'round', icon: ClipboardX, title: 'A round is late', meta: r.worst.replace(`, ${s.name}`, ''), red: true, to: 'compliance' });
    if (s.urgent > 0) out.push({ key: 'urgent', icon: AlertTriangle, title: `${s.urgent} urgent ${s.urgent === 1 ? 'ticket' : 'tickets'} open`, meta: `${s.active} active in total` });
    const o = m.oldestOpen.data;
    if (o && o.site === s.name && o.days >= 7) out.push({ key: 'oldest', icon: Timer, title: `Oldest ticket open ${o.days} days`, meta: o.title });
    if (s.overBudget) out.push({ key: 'budget', icon: Wallet, title: `${inrCompact(s.overBudget)} over budget`, meta: 'This month so far', to: 'money' });
    for (const a of m.amc.data ?? []) if (a.site === s.name) out.push({ key: `amc-${a.id}`, icon: Wrench, title: `${a.asset} AMC ends in ${a.days} days`, meta: 'Renew before it lapses', to: 'compliance' });
    const d = m.diesel.data;
    if (d && d.lowTank.site === s.name && d.lowTank.pct < 30) out.push({ key: 'diesel', icon: Fuel, title: `${d.lowTank.dg} diesel at ${d.lowTank.pct}%`, meta: 'Order a refill', to: 'money' });
    return out;
}

export function SiteScreen({ id }: { id: string }) {
    const { m, items, push, go, back } = useApp();
    const site = m.sites.data?.find(s => s.id === id) ?? null;
    const all = m.sites.data ?? [];
    const rank = site ? all.findIndex(s => s.id === site.id) + 1 : 0;
    const extra = site ? SITE_EXTRAS[site.name] : undefined;
    const days = dayLabels(m.now, 14);

    return (
        <div>
            <TopBar title={site?.name ?? 'Site'} right={extra && (
                <button type="button" onClick={() => m.previewAction(`Call ${extra.manager}`)} aria-label={`Call ${extra.manager}`} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: C.card }}>
                    <Phone className="h-[18px] w-[18px]" aria-hidden />
                </button>
            )} />
            <div className="px-[16px]">
                <Fed feed={m.sites} rows={4} height={40}>
                    {() => !site ? (
                        <Card><EmptyState compact title="This site is not available" body="It may have been removed, or you no longer manage it." actionLabel="Back to sites" onAction={back} /></Card>
                    ) : (
                        <>
                            <Card className="p-[16px]">
                                <div className="flex items-start justify-between gap-[10px]">
                                    <span className="flex items-end gap-[8px]">
                                        <span className="text-[56px] leading-[0.9]" style={fig}>{site.score}</span>
                                        <span className="pb-[6px] text-[13px] font-semibold" style={{ color: C.text3 }}>/ 100</span>
                                    </span>
                                    <span className="flex flex-col items-end gap-[6px]">
                                        {band(site.score).tone === 'attention' ? <Tag icon={AlertTriangle}>Needs attention</Tag> : <Tag tone="plain" icon={CheckCircle2}>{band(site.score).label}</Tag>}
                                        <span className="text-[12px]" style={{ color: C.text3 }}>{rank === 1 ? 'Lowest of' : `${rank} of`} {all.length} sites</span>
                                    </span>
                                </div>
                                <div className="mt-[14px] grid grid-cols-3 gap-[8px]">
                                    {([['Active', num(site.active)], ['Urgent', num(site.urgent)], ['On shift', extra ? `${extra.present}/${extra.scheduled}` : 'No data']] as const).map(([k, v]) => (
                                        <div key={k} className="rounded-[14px] px-[10px] py-[8px]" style={{ background: C.track }}>
                                            <span className="block text-[11.5px] font-semibold" style={{ color: C.text3 }}>{k}</span>
                                            <span className="block text-[17px]" style={fig}>{v}</span>
                                        </div>
                                    ))}
                                </div>
                            </Card>

                            {site.trend.length > 1 && (
                                <Card className="mt-[10px] p-[16px]">
                                    <p className="flex items-center justify-between text-[14px] font-bold">Active tickets<span className="text-[12px] font-semibold" style={{ color: C.text3 }}>last {site.trend.length} days</span></p>
                                    <LineArea data={site.trend.map((v, i) => ({ label: days[days.length - site.trend.length + i].long, value: v }))} color={C.accent} height={120} fitRange
                                        xLabels={[{ index: 0, text: days[days.length - site.trend.length].short }, { index: site.trend.length - 1, text: 'Today' }]}
                                        ariaLabel={`${site.name}, active tickets, today ${site.trend[site.trend.length - 1]}`} />
                                </Card>
                            )}
                        </>
                    )}
                </Fed>
            </div>

            {site && (
                <>
                    <SiteWaiting site={site.name} />
                    <Section title="Risks here" right={<Sample feed={m.amc} />}>
                        {(() => {
                            const risks = risksAt(m, site);
                            return risks.length === 0
                                ? <Card className="flex items-center gap-[8px] px-[16px] py-[16px] text-[13px]" style={{ color: C.text2 }}><CheckCircle2 className="h-4 w-4" aria-hidden />Nothing at risk here right now.</Card>
                                : <Card className="p-[6px]"><ul onKeyDown={listKeys}>{risks.map(r => (
                                    <li key={r.key}><Row icon={r.icon} red={r.red} title={r.title} sub={r.meta} chevron={!!r.to} onClick={() => (r.to ? push({ name: r.to }) : m.previewAction(r.title))} /></li>
                                ))}</ul></Card>;
                        })()}
                    </Section>

                    {extra && (
                        <Section title="Team" right={<Sample feed={items} />}>
                            <Card className="p-[16px]">
                                <div className="flex items-center gap-[12px]">
                                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[14px] font-bold" style={{ background: C.tint, color: C.accentDeep }}>{extra.manager.split(' ').map(w => w[0]).join('')}</span>
                                    <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold">{extra.manager}</span><span className="block text-[12px]" style={{ color: C.text3 }}>Site manager</span></span>
                                    <button type="button" onClick={() => m.previewAction(`Message ${extra.manager}`)} aria-label={`Message ${extra.manager}`} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: C.track }}><MessageSquare className="h-[18px] w-[18px]" aria-hidden /></button>
                                </div>
                                {([['On shift now', extra.present, extra.scheduled, `${extra.present} of ${extra.scheduled}`], ['PPM done on time', extra.ppm, 100, `${extra.ppm}%`]] as const).map(([label, v, max, text]) => (
                                    <div key={label} className="mt-[14px]">
                                        <span className="flex justify-between text-[13px]"><span className="font-semibold">{label}</span><span className="tabular-nums" style={{ color: C.text2 }}>{text}</span></span>
                                        <span className="mt-[6px] block h-[10px] rounded-full" style={{ background: C.track }} role="meter" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={max}>
                                            <span className={cx('block h-full rounded-full')} style={{ width: `${(v / max) * 100}%`, background: C.accent }} />
                                        </span>
                                    </div>
                                ))}
                            </Card>
                        </Section>
                    )}

                    <div className="px-[16px] pt-[18px]">
                        <div className="grid grid-cols-2 gap-[8px]">
                            <GhostButton icon={Ticket} onClick={() => go({ name: 'tickets', site: site.name })}>Its tickets</GhostButton>
                            <PrimaryButton icon={Plus} onClick={() => push({ name: 'newTicket', site: site.name })}>Raise one</PrimaryButton>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function SiteWaiting({ site }: { site: string }) {
    const { items, go } = useApp();
    const here = (items.data ?? []).filter(i => i.site === site);
    return (
        <Section title="Waiting on you here" right={<Sample feed={items} />} more={here.length > 2 ? { label: `All ${here.length}`, onClick: () => go({ name: 'approvals' }) } : undefined}>
            <Fed feed={items} rows={2} height={64}>
                {() => here.length === 0
                    ? <Card className="flex items-center gap-[8px] px-[16px] py-[16px] text-[13px]" style={{ color: C.text2 }}><CheckCircle2 className="h-4 w-4" aria-hidden />Nothing from this site is waiting on you.</Card>
                    : <div className="flex flex-col gap-[8px]">{here.slice(0, 2).map(i => <ApprovalCard key={i.id} item={i} compact />)}</div>}
            </Fed>
        </Section>
    );
}
