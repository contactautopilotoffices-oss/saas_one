'use client';

import React from 'react';
import { Plus, Search, Siren } from 'lucide-react';
import type { DesignProps } from '../../DesignLab';
import { PeriodSwitch } from '../../lab/frame';
import { FilterChips, STATUS_TABS, useTicketFilters } from '../../lab/filters';
import { raisedLabel, shortNumber } from '../../lab/format';
import { RED, RED_BG, RED_TEXT, STATUS_META } from '../../lab/status';
import type { LabTicket } from '../../lab/types';
import {
    Avatar, EmptyState, ErrorState, H, PriorityChip, Skeleton, SlaBar, SlaText, StatusChip, listKeys, rowProps, stop,
} from '../../lab/ui';
import { BENTO, BentoButton, bentoNum } from './BentoDesign';

function StatusWidget({ label, value, icon: Icon, color, bg, loading, active, onClick }: {
    label: string; value: number; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; bg: string; loading: boolean; active: boolean; onClick: () => void;
}) {
    return (
        <button type="button" onClick={onClick} aria-pressed={active}
            className="flex h-[124px] flex-col rounded-[26px] bg-white p-[18px] text-left transition-transform active:scale-[0.99]"
            style={{ boxShadow: active ? `0 0 0 2px ${BENTO.primary}, ${BENTO.shadow}` : BENTO.shadow }}>
            <span className="flex items-center gap-[8px] text-[13px] font-semibold" style={{ color: BENTO.text2 }}>
                <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: bg }}><Icon className="h-4 w-4" style={{ color }} /></span>
                {label}
            </span>
            {loading ? <Skeleton className="mt-auto h-9 w-12" /> : <span className="mt-auto text-[36px] leading-none" style={{ ...bentoNum, color: label === 'Critical' ? RED_TEXT : BENTO.text }}>{value}</span>}
        </button>
    );
}

function Card({ lab, setScreen, t }: DesignProps & { t: LabTicket }) {
    const sla = lab.sla(t);
    const done = t.status === 'closed' || t.status === 'resolved';
    return (
        <article
            {...rowProps(() => { lab.selectTicket(t.id); setScreen('detail'); }, `${t.number} ${t.title}`)}
            className="flex cursor-pointer flex-col rounded-[26px] bg-white p-[18px] transition-transform hover:-translate-y-[2px]"
            style={{ boxShadow: BENTO.shadow }}
        >
            <div className="flex items-center gap-[6px]">
                <PriorityChip priority={t.priority} size="sm" />
                <StatusChip status={t.status} size="sm" />
                <span className="ml-auto text-[12px] font-medium tabular-nums" style={{ color: BENTO.text3 }} title={t.number}>{shortNumber(t.number)}</span>
            </div>
            <H level={3} className="mt-[12px] line-clamp-2 min-h-[44px] text-[15.5px] font-semibold leading-snug">{t.title}</H>
            <p className="mt-[4px] truncate text-[12.5px]" style={{ color: BENTO.text2 }}>
                {[t.location, t.category].filter(Boolean).join(' · ') || 'No location recorded'}
            </p>
            <div className="mt-[14px] rounded-[18px] p-[12px]" style={{ background: '#F4F9F6' }}>
                <div className="flex items-center justify-between text-[12.5px]">
                    <span style={{ color: BENTO.text2 }}>{done ? 'SLA' : 'SLA left'}</span>
                    <SlaText sla={sla} className="font-semibold" />
                </div>
                <SlaBar sla={sla} height={5} className="mt-[8px]" track="#E1ECE6" />
            </div>
            <div className="mt-[14px] flex items-center gap-[8px]">
                {t.assignee ? (
                    <>
                        <Avatar name={t.assignee} size={30} style={{ background: BENTO.tint, color: BENTO.deep, borderRadius: 10 }} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.assignee}</span>
                    </>
                ) : (
                    <span className="flex-1 text-[13px]" style={{ color: BENTO.text2 }}>Unassigned</span>
                )}
                <span className="text-[12px]" style={{ color: BENTO.text3 }}>{raisedLabel(t.raisedAt, lab.now)}</span>
                {!t.assignee && !done && (
                    <button type="button" onClick={stop(() => { lab.selectTicket(t.id); lab.openDrawer(); })}
                        className="h-10 rounded-[14px] px-[14px] text-[13px] font-semibold text-white" style={{ background: BENTO.primary }}>
                        Assign
                    </button>
                )}
            </div>
        </article>
    );
}

export default function BentoTickets(props: DesignProps) {
    const { lab } = props;
    const f = useTicketFilters(lab);
    const s = lab.stats;
    const t = lab.tickets;
    const chip = 'h-10 rounded-full px-[14px] text-[13px] font-medium';
    const widgets = [
        { id: 'open' as const, label: 'Open', value: s.open, icon: STATUS_META.open.icon, color: BENTO.ramp[0], bg: BENTO.tint },
        { id: 'assigned' as const, label: 'Assigned', value: s.assigned, icon: STATUS_META.assigned.icon, color: BENTO.ramp[1], bg: BENTO.tint },
        { id: 'in_progress' as const, label: 'In progress', value: s.inProgress, icon: STATUS_META.in_progress.icon, color: BENTO.ramp[2], bg: BENTO.tint },
    ];
    return (
        <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-end justify-between gap-[12px]">
                <div>
                    <H level={1} className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Tickets</H>
                    <p className="mt-[2px] text-[14px]" style={{ color: BENTO.text2 }}><b style={{ ...bentoNum, color: BENTO.text }}>{s.active}</b> active at {lab.propertyName}</p>
                </div>
                <div className="flex flex-wrap items-center gap-[8px]">
                    <PeriodSwitch lab={lab} counts size="sm" track={{ background: 'rgba(15,32,26,0.06)', borderRadius: 14 }} thumb={{ background: '#FFFFFF', borderRadius: 11, boxShadow: BENTO.shadow }} idleText={BENTO.text2} activeText={BENTO.deep} />
                    <BentoButton icon={Plus} onClick={() => lab.previewAction('Raise ticket')}>Raise ticket</BentoButton>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-[16px] lg:grid-cols-4">
                {widgets.map(w => (
                    <StatusWidget key={w.id} label={w.label} value={w.value} icon={w.icon} color={w.color} bg={w.bg} loading={t.loading}
                        active={f.tab === w.id} onClick={() => f.setTab(f.tab === w.id ? 'active' : w.id)} />
                ))}
                <StatusWidget label="Critical" value={s.critical} icon={Siren} color={RED} bg={RED_BG} loading={t.loading}
                    active={f.priority === 'critical'} onClick={() => f.setPriority(f.priority === 'critical' ? null : 'critical')} />
            </div>

            <div className="flex flex-col gap-[12px] rounded-[26px] bg-white p-[12px]" style={{ boxShadow: BENTO.shadow }}>
                <div role="tablist" aria-label="Status" className="lab-scroll-x flex gap-[4px] overflow-x-auto rounded-[18px] p-[4px]" style={{ background: '#F2F8F5' }}>
                    {STATUS_TABS.map(tab => {
                        const on = f.tab === tab.id;
                        return (
                            <button key={tab.id} type="button" role="tab" aria-selected={on} onClick={() => f.setTab(tab.id)}
                                className="inline-flex h-10 shrink-0 items-center gap-[6px] rounded-[14px] px-[14px] text-[13.5px] font-semibold"
                                style={on ? { background: '#FFFFFF', color: BENTO.deep, boxShadow: BENTO.shadow } : { color: BENTO.text2 }}>
                                {tab.label}<span className="tabular-nums opacity-70">{f.counts[tab.id]}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="flex flex-col gap-[10px] px-[4px] xl:flex-row xl:items-center xl:justify-between">
                    <FilterChips f={f} chipClass={chip} chipStyle={{ background: '#F2F8F5', color: BENTO.text }} activeStyle={{ background: BENTO.primary, color: '#FFFFFF' }} />
                    <label className="flex h-10 items-center gap-[8px] rounded-full px-[14px] xl:w-[240px]" style={{ background: '#F2F8F5' }}>
                        <Search className="h-4 w-4" style={{ color: BENTO.text3 }} aria-hidden />
                        <input value={f.query} onChange={e => f.setQuery(e.target.value)} placeholder="Search tickets" aria-label="Search tickets" className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-[#7A8C84]" />
                    </label>
                </div>
            </div>

            {t.loading ? (
                <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[248px]" style={{ borderRadius: 26 }} />)}
                </div>
            ) : t.error ? (
                <div className="rounded-[26px] bg-white" style={{ boxShadow: BENTO.shadow }}><ErrorState message={t.error} onRetry={t.retry} /></div>
            ) : f.rows.length === 0 ? (
                <div className="rounded-[26px] bg-white" style={{ boxShadow: BENTO.shadow }}>
                    {f.activeFilters > 0
                        ? <EmptyState title="No tickets match" body="Remove a filter to see more." actionLabel="Clear filters" onAction={f.clear} />
                        : <EmptyState title="Nothing here yet" body="Tickets in this status will appear as widgets here." actionLabel="Raise ticket" onAction={() => lab.previewAction('Raise ticket')} />}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2 xl:grid-cols-3" onKeyDown={listKeys}>
                    {f.rows.map(x => <Card key={x.id} {...props} t={x} />)}
                </div>
            )}
        </div>
    );
}
