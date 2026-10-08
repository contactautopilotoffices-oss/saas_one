'use client';

import React from 'react';
import { ChevronRight, Plus, Search } from 'lucide-react';
import type { DesignProps } from '../../DesignLab';
import { SegmentBar } from '../../lab/charts';
import { PeriodSwitch } from '../../lab/frame';
import { FilterChips, STATUS_TABS, useTicketFilters } from '../../lab/filters';
import { raisedLabel } from '../../lab/format';
import { STATUS_META } from '../../lab/status';
import {
    Avatar, EmptyState, ErrorState, PriorityChip, SkeletonRows, SlaBar, SlaText, StatusChip, listKeys, rowProps, stop, H,
} from '../../lab/ui';
import type { LabTicket } from '../../lab/types';
import { INK, InkButton, inkNum } from './InkDesign';

const COLS = 'lg:grid-cols-[112px_128px_minmax(0,1fr)_176px_176px_96px]';

function Row({ lab, setScreen, t }: DesignProps & { t: LabTicket }) {
    const sla = lab.sla(t);
    const open = () => { lab.selectTicket(t.id); setScreen('detail'); };
    const meta = [t.location, t.category, t.number, raisedLabel(t.raisedAt, lab.now)].filter(Boolean).join(' · ');
    return (
        <div
            {...rowProps(open, `${t.number} ${t.title}`)}
            className={`grid cursor-pointer grid-cols-2 items-center gap-[12px] border-b px-2 py-4 transition-colors hover:bg-[#FAFAFA] lg:min-h-[84px] lg:gap-[16px] lg:py-3 ${COLS}`}
            style={{ borderColor: INK.border }}
        >
            <div className="col-span-2 flex items-center gap-1.5 lg:col-span-1 lg:block">
                <PriorityChip priority={t.priority} size="sm" />
                <span className="lg:hidden"><StatusChip status={t.status} size="sm" /></span>
            </div>
            <div className="hidden lg:block"><StatusChip status={t.status} size="sm" /></div>
            <div className="col-span-2 min-w-0 lg:col-span-1">
                <div className="truncate text-[15px] font-semibold">{t.title}</div>
                <div className="mt-1 truncate text-[12.5px]" style={{ color: INK.text2 }}>{meta}</div>
            </div>
            <div className="flex items-center gap-2.5">
                {t.assignee ? (
                    <>
                        <Avatar name={t.assignee} size={30} />
                        <span className="truncate text-[13.5px] font-medium">{t.assignee}</span>
                    </>
                ) : (
                    <span className="text-[13.5px]" style={{ color: INK.text2 }}>Unassigned</span>
                )}
            </div>
            <div className="flex flex-col gap-1.5">
                <SlaText sla={sla} className="text-[13.5px] font-semibold" />
                <SlaBar sla={sla} height={3} className="max-w-[160px]" />
            </div>
            <div className="col-span-2 flex empty:hidden lg:col-span-1 lg:justify-end">
                {!t.assignee && t.status !== 'closed' && t.status !== 'resolved' ? (
                    <button type="button" onClick={stop(() => { lab.selectTicket(t.id); lab.openDrawer(); })} className="h-10 rounded-full bg-[#0B0B0C] px-4 text-[13px] font-semibold text-white">
                        Assign
                    </button>
                ) : (
                    <ChevronRight className="hidden h-5 w-5 lg:block" style={{ color: INK.text3 }} aria-hidden />
                )}
            </div>
        </div>
    );
}

export default function InkTickets(props: DesignProps) {
    const { lab } = props;
    const f = useTicketFilters(lab);
    const s = lab.stats;
    const t = lab.tickets;
    const segments = [
        { label: 'Open', value: s.open, color: '#FFFFFF' },
        { label: 'Assigned', value: s.assigned, color: 'rgba(255,255,255,0.62)' },
        { label: 'In progress', value: s.inProgress, color: 'rgba(255,255,255,0.34)' },
    ];
    const atRisk = t.active.filter(x => lab.sla(x).danger).length;
    const chip = 'h-10 rounded-full px-4 text-[13px] font-medium';

    return (
        <div className="flex flex-col gap-[24px]">
            <div className="flex flex-col gap-[16px] lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <H level={1} className="text-[30px] font-bold leading-tight tracking-[-0.02em]">Tickets</H>
                    <p className="mt-1 text-[14px]" style={{ color: INK.text2 }}>Every request raised at {lab.propertyName}</p>
                </div>
                <div className="flex flex-wrap items-center gap-[8px]">
                    <PeriodSwitch lab={lab} counts className="rounded-full" track={{ background: INK.tile, borderRadius: 999 }} thumb={{ background: INK.black, borderRadius: 999 }} idleText={INK.text2} activeText="#FFFFFF" />
                    <InkButton icon={Plus} onClick={() => lab.previewAction('Raise ticket')}>Raise ticket</InkButton>
                </div>
            </div>

            <section aria-label="Active tickets summary" className="grid gap-[24px] rounded-[24px] bg-[#0B0B0C] p-7 text-white md:grid-cols-[auto_1fr] md:items-center md:gap-12">
                {t.loading ? (
                    <div className="h-20 w-40 rounded-2xl bg-white/10" role="status" aria-label="Loading" />
                ) : (
                    <div className="flex items-end gap-[16px]">
                        <span className="text-[80px] leading-[0.9]" style={inkNum}>{s.active}</span>
                        <span className="mb-2 text-[14px] leading-snug text-white/75">active<br />{s.unassigned} unassigned</span>
                    </div>
                )}
                <div>
                    <SegmentBar segments={segments} height={12} gap={2} radius={3} ariaLabel="Active tickets by status" />
                    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/80">
                        {(['open', 'assigned', 'in_progress'] as const).map((k, i) => {
                            const Icon = STATUS_META[k].icon;
                            return (
                                <span key={k} className="inline-flex items-center gap-[8px]">
                                    <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: segments[i].color }} />
                                    <Icon className="h-3.5 w-3.5" aria-hidden />
                                    {STATUS_META[k].label} <b className="text-white" style={inkNum}>{segments[i].value}</b>
                                </span>
                            );
                        })}
                        <span className="inline-flex items-center gap-[8px]">Critical <b className="text-white" style={inkNum}>{s.critical}</b></span>
                        <span className="inline-flex items-center gap-[8px]">SLA at risk <b className="text-white" style={inkNum}>{atRisk}</b></span>
                    </div>
                </div>
            </section>

            <div className="flex flex-col gap-[16px]">
                <div role="tablist" aria-label="Status" className="lab-scroll-x flex gap-[4px] overflow-x-auto border-b" style={{ borderColor: INK.border }}>
                    {STATUS_TABS.map(tab => {
                        const on = f.tab === tab.id;
                        return (
                            <button key={tab.id} type="button" role="tab" aria-selected={on} onClick={() => f.setTab(tab.id)}
                                className="relative inline-flex h-11 shrink-0 items-center gap-[8px] px-3 text-[14px] font-semibold"
                                style={{ color: on ? INK.text : INK.text2 }}>
                                {tab.label}
                                <span className="tabular-nums" style={{ color: on ? INK.text : INK.text3 }}>{f.counts[tab.id]}</span>
                                {on && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[#0B0B0C]" />}
                            </button>
                        );
                    })}
                </div>
                <div className="flex flex-col gap-[12px] xl:flex-row xl:items-center xl:justify-between">
                    <FilterChips f={f} chipClass={chip} chipStyle={{ border: `1px solid ${INK.border}`, background: '#FFFFFF', color: INK.text }} activeStyle={{ background: INK.black, color: '#FFFFFF', borderColor: INK.black }} />
                    <label className="flex h-10 items-center gap-[8px] rounded-full px-4 xl:w-[260px]" style={{ background: INK.tile }}>
                        <Search className="h-4 w-4" style={{ color: INK.text3 }} aria-hidden />
                        <input value={f.query} onChange={e => f.setQuery(e.target.value)} placeholder="Search title or number" aria-label="Search tickets" className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-[#8A8A8F]" />
                    </label>
                </div>
            </div>

            <section aria-label="Ticket list">
                <div className={`hidden border-b px-2 pb-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] lg:grid lg:gap-[16px] ${COLS}`} style={{ color: INK.text3, borderColor: INK.border }}>
                    <span>Priority</span><span>Status</span><span>Ticket</span><span>Assignee</span><span>SLA left</span><span className="sr-only">Action</span>
                </div>
                {t.loading ? (
                    <div className="pt-4"><SkeletonRows rows={6} height={64} /></div>
                ) : t.error ? (
                    <ErrorState message={t.error} onRetry={t.retry} />
                ) : f.rows.length === 0 ? (
                    f.activeFilters > 0
                        ? <EmptyState title="No tickets match these filters" body="Try removing a filter to widen the list." actionLabel="Clear filters" onAction={f.clear} />
                        : <EmptyState title="No tickets here" body="When something is raised in this status it shows up here." actionLabel="Raise ticket" onAction={() => lab.previewAction('Raise ticket')} />
                ) : (
                    <div onKeyDown={listKeys}>
                        {f.rows.map(x => <Row key={x.id} {...props} t={x} />)}
                    </div>
                )}
            </section>
        </div>
    );
}
