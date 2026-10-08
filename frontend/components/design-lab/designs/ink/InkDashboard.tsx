'use client';

import React from 'react';
import {
    ArrowUpRight, Boxes, CalendarClock, ChevronRight, ClipboardCheck, Coffee, DoorOpen, Droplets, Fuel,
    Gauge, PenLine, Plus, QrCode, Siren, UserPlus, Zap,
} from 'lucide-react';
import type { DesignProps } from '../../DesignLab';
import { Columns, Legend, Meter, Ring, SegmentBar, Ticks } from '../../lab/charts';
import { PeriodSwitch, ShiftLabel } from '../../lab/frame';
import { greeting, inrCompact, longDate, num } from '../../lab/format';
import {
    SAMPLE_CAFETERIA, SAMPLE_ENERGY, SAMPLE_KPIS, SAMPLE_ON_SHIFT, SAMPLE_PPM, SAMPLE_ROUNDS, SAMPLE_ROUND_STATS,
    SAMPLE_STOCK, SAMPLE_TEAM, SAMPLE_VISITORS, SAMPLE_WEEK,
} from '../../lab/sample';
import { RED, RED_BG, RED_TEXT, STATUS_META } from '../../lab/status';
import {
    Avatar, EmptyState, ErrorState, PriorityChip, SampleBadge, Skeleton, SkeletonRows, SlaBar, SlaText, StatusChip,
    listKeys, rowProps, stop, H,
} from '../../lab/ui';
import type { LabTicket } from '../../lab/types';
import { INK, InkButton, InkCard, inkNum } from './InkDesign';

const PERIOD_WORD = { today: 'today', month: 'this month', all: 'in total' } as const;

function CardHead({ title, right, sample }: { title: string; right?: React.ReactNode; sample?: boolean }) {
    return (
        <div className="mb-5 flex items-center justify-between gap-[12px]">
            <H level={2} className="text-[16px] font-semibold tracking-tight">{title}</H>
            <div className="flex items-center gap-[8px]">
                {sample && <SampleBadge />}
                {right}
            </div>
        </div>
    );
}

function HeroCard({ lab }: DesignProps) {
    const s = lab.stats;
    const t = lab.tickets;
    const segments = [
        { key: 'open' as const, label: STATUS_META.open.label, value: s.open, color: '#FFFFFF' },
        { key: 'assigned' as const, label: STATUS_META.assigned.label, value: s.assigned, color: 'rgba(255,255,255,0.62)' },
        { key: 'in_progress' as const, label: STATUS_META.in_progress.label, value: s.inProgress, color: 'rgba(255,255,255,0.34)' },
    ];
    return (
        <section aria-label="Active tickets" className="relative flex min-h-[300px] flex-col overflow-hidden rounded-[24px] bg-[#0B0B0C] p-7 text-white">
            <div className="flex items-center justify-between">
                <span className="text-[14px] font-medium text-white/70">Active tickets</span>
                <span className="text-[12.5px] text-white/60">{lab.propertyName}</span>
            </div>
            {t.loading ? (
                <div className="mt-6 flex flex-col gap-[16px]" role="status" aria-label="Loading">
                    <div className="h-20 w-32 rounded-2xl bg-white/10" />
                    <div className="h-4 w-48 rounded-full bg-white/10" />
                    <div className="mt-6 h-3 w-full rounded-full bg-white/10" />
                </div>
            ) : t.error ? (
                <ErrorState dark compact message={t.error} onRetry={t.retry} />
            ) : s.active === 0 ? (
                <EmptyState dark compact title="No active tickets" body="Everything raised here is closed. New tickets will show up the moment they come in." actionLabel="Raise ticket" onAction={() => lab.previewAction('Raise ticket')} />
            ) : (
                <>
                    <div className="mt-3 flex items-end gap-[16px]">
                        <span className="text-[104px] leading-[0.9]" style={inkNum}>{s.active}</span>
                        <span className="mb-3 text-[15px] text-white/75">{s.unassigned} have no owner yet</span>
                    </div>
                    <div className="mt-auto pt-8">
                        <SegmentBar segments={segments} height={12} gap={2} radius={3} ariaLabel={`Status split: ${segments.map(x => `${x.label} ${x.value}`).join(', ')}`} />
                        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                            {segments.map(seg => {
                                const Icon = STATUS_META[seg.key].icon;
                                return (
                                    <span key={seg.key} className="inline-flex items-center gap-[8px] text-[13px] text-white/80">
                                        <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: seg.color }} />
                                        <Icon className="h-3.5 w-3.5" aria-hidden />
                                        {seg.label}
                                        <b className="font-semibold text-white" style={inkNum}>{seg.value}</b>
                                    </span>
                                );
                            })}
                            <span className="ml-auto text-[13px] text-white/60">
                                <b className="font-semibold text-white" style={inkNum}>{num(lab.periodCounts[lab.period])}</b> raised {PERIOD_WORD[lab.period]}
                            </span>
                        </div>
                    </div>
                </>
            )}
        </section>
    );
}

function CriticalTile({ lab, setScreen }: DesignProps) {
    const t = lab.tickets;
    return (
        <section aria-label="Critical tickets" className="flex min-h-[300px] flex-col rounded-[24px] p-[24px]" style={{ background: RED_BG }}>
            <div className="flex items-center gap-[8px] text-[14px] font-semibold" style={{ color: RED_TEXT }}>
                <Siren className="h-4 w-4" style={{ color: RED }} aria-hidden />
                Critical
            </div>
            {t.loading ? (
                <Skeleton className="mt-4 h-12 w-16" />
            ) : (
                <span className="mt-3 text-[44px] leading-none" style={{ ...inkNum, color: RED_TEXT }}>{lab.stats.critical}</span>
            )}
            {lab.source === 'sample' && (
                <span className="mt-2 inline-flex items-center gap-[4px] text-[13px] font-medium" style={{ color: RED_TEXT }}>
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />+{SAMPLE_KPIS.criticalDelta} since yesterday
                </span>
            )}
            <p className="mt-3 text-[13px] leading-relaxed" style={{ color: RED_TEXT }}>
                Critical tickets stay red until someone owns them and the SLA is safe.
            </p>
            <button type="button" onClick={() => setScreen('tickets')} className="mt-auto inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-[13.5px] font-semibold" style={{ color: RED_TEXT }}>
                View critical <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
        </section>
    );
}

function SlaTile() {
    return (
        <section aria-label="SLA met" className="flex min-h-[300px] flex-col rounded-[24px] p-[24px]" style={{ background: INK.tile }}>
            <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold">SLA met</span>
                <SampleBadge />
            </div>
            <div className="my-auto flex justify-center py-4">
                <Ring value={SAMPLE_KPIS.slaMetPct / 100} size={150} stroke={12} color={INK.black} track="#E2E2E5"
                    tipText={`${SAMPLE_KPIS.slaMetOnTime} of ${SAMPLE_KPIS.slaMetTotal} closed on time`} ariaLabel={`SLA met ${SAMPLE_KPIS.slaMetPct}%`}>
                    <span className="text-[36px] leading-none" style={inkNum}>{SAMPLE_KPIS.slaMetPct}%</span>
                </Ring>
            </div>
            <span className="text-center text-[13px]" style={{ color: INK.text2 }}>{SAMPLE_KPIS.slaMetOnTime} of {SAMPLE_KPIS.slaMetTotal} on time today</span>
        </section>
    );
}

function WeekCard() {
    const today = SAMPLE_WEEK[SAMPLE_WEEK.length - 1];
    return (
        <InkCard className="p-[24px] md:p-7" label="Tickets this week">
            <CardHead
                title="Tickets this week"
                sample
                right={(
                    <span className="hidden h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium sm:inline-flex" style={{ background: INK.tile }}>
                        Today so far <b style={inkNum}>{today.raised}</b> raised, <b style={inkNum}>{today.closed}</b> closed
                    </span>
                )}
            />
            <Legend series={[{ name: 'Raised', color: INK.raised, swatch: 'bar' }, { name: 'Closed', color: INK.black, swatch: 'bar' }]} className="mb-3" />
            <Columns
                ariaLabel="Tickets raised and closed per day, Wednesday to today"
                height={220}
                data={SAMPLE_WEEK.map(d => ({ label: d.label, values: [d.raised, d.closed], partial: d.today, tipLabel: `${d.label} ${d.date}` }))}
                series={[{ name: 'Raised', color: INK.raised }, { name: 'Closed', color: INK.black }]}
                partialColors={['#D9D9DC', '#8A8A8F']}
                maxBar={18}
            />
        </InkCard>
    );
}

function AttentionRow({ lab, setScreen, t }: DesignProps & { t: LabTicket }) {
    const sla = lab.sla(t);
    return (
        <div
            {...rowProps(() => { lab.selectTicket(t.id); setScreen('detail'); }, `${t.number} ${t.title}`)}
            className="group flex cursor-pointer flex-col gap-2.5 rounded-[16px] px-3 py-3.5 hover:bg-[#F7F7F8]"
        >
            <div className="flex flex-wrap items-center gap-1.5">
                <PriorityChip priority={t.priority} size="sm" />
                <StatusChip status={t.status} size="sm" />
            </div>
            <div className="text-[14.5px] font-semibold leading-snug">{t.title}</div>
            <div className="flex items-center gap-[12px]">
                <SlaBar sla={sla} height={3} className="flex-1" />
                <SlaText sla={sla} className="shrink-0 text-[12.5px] font-semibold" />
                {!t.assignee && (
                    <button type="button" onClick={stop(() => { lab.selectTicket(t.id); lab.openDrawer(); })} className="h-10 shrink-0 rounded-full bg-[#0B0B0C] px-3.5 text-[12.5px] font-semibold text-white">
                        Assign
                    </button>
                )}
            </div>
        </div>
    );
}

function AttentionCard(props: DesignProps) {
    const { lab, setScreen } = props;
    const t = lab.tickets;
    const firstUnassigned = lab.attention.find(x => !x.assignee);
    return (
        <InkCard className="flex h-full flex-col p-[24px]" label="Needs attention">
            <CardHead title="Needs attention" right={<span className="text-[13px]" style={{ color: INK.text2 }}>SLA left</span>} />
            {t.loading ? (
                <SkeletonRows rows={4} height={92} />
            ) : t.error ? (
                <ErrorState compact message={t.error} onRetry={t.retry} />
            ) : lab.attention.length === 0 ? (
                <EmptyState compact title="All caught up" body="Nothing needs a person right now." actionLabel="Raise ticket" onAction={() => lab.previewAction('Raise ticket')} />
            ) : (
                <div className="-mx-3 flex flex-col divide-y divide-[#ECECEE]" onKeyDown={listKeys}>
                    {lab.attention.map(x => <AttentionRow key={x.id} {...props} t={x} />)}
                </div>
            )}
            <div className="mt-auto flex gap-[8px] pt-4">
                <InkButton className="flex-1" onClick={() => {
                    if (firstUnassigned) { lab.selectTicket(firstUnassigned.id); lab.openDrawer(); } else setScreen('tickets');
                }}>
                    Assign open tickets
                </InkButton>
                <InkButton variant="outline" onClick={() => setScreen('tickets')} ariaLabel="All tickets"><ChevronRight className="h-4 w-4" /></InkButton>
            </div>
        </InkCard>
    );
}

function EnergyCard({ lab }: DesignProps) {
    const e = SAMPLE_ENERGY;
    const last7 = e.electricity.last14.slice(-7);
    return (
        <InkCard className="p-[24px] md:p-7" label="Energy">
            <CardHead title="Energy" sample right={<InkButton variant="outline" icon={PenLine} onClick={() => lab.previewAction('Log reading')}>Log reading</InkButton>} />
            <div className="grid grid-cols-1 gap-[24px] md:grid-cols-3 md:gap-0 md:divide-x md:divide-[#ECECEE]">
                <div className="md:pr-6">
                    <div className="flex items-center gap-[8px] text-[13px] font-medium" style={{ color: INK.text2 }}><Zap className="h-4 w-4" aria-hidden />Electricity</div>
                    <div className="mt-2 flex items-baseline gap-1.5"><span className="text-[30px] leading-none" style={inkNum}>{num(e.electricity.todayKwh)}</span><span className="text-[13px]" style={{ color: INK.text2 }}>kWh so far today</span></div>
                    <div className="mt-1 text-[12.5px]" style={{ color: INK.text2 }}>Yesterday {num(e.electricity.yesterdayKwh)} kWh</div>
                    <div className="mt-3">
                        <Columns ariaLabel="Electricity per day, last 7 days" height={96} showAxis={false} maxBar={14} keyIndex={null}
                            data={last7.map((d, i) => ({ label: SAMPLE_WEEK[i].label.slice(0, 1), values: [d.value], partial: i === last7.length - 1, tipLabel: `${SAMPLE_WEEK[i].label} ${d.label}` }))}
                            series={[{ name: 'kWh', color: INK.black }]} />
                    </div>
                </div>
                <div className="md:px-6">
                    <div className="flex items-center gap-[8px] text-[13px] font-medium" style={{ color: INK.text2 }}><Fuel className="h-4 w-4" aria-hidden />Diesel</div>
                    <div className="mt-2 flex items-baseline gap-1.5"><span className="text-[30px] leading-none" style={inkNum}>{e.diesel.usedTodayL}</span><span className="text-[13px]" style={{ color: INK.text2 }}>L used today</span></div>
                    <div className="mt-5 flex flex-col gap-[16px]">
                        {e.diesel.generators.map(g => (
                            <div key={g.id}>
                                <div className="mb-1.5 flex justify-between text-[12.5px]"><span className="font-medium">{g.name} tank</span><span style={inkNum}>{g.levelPct}%</span></div>
                                <Meter value={g.levelPct / 100} label={`${g.name} tank level`} color={INK.black} track={INK.tile} height={10} radius={4}
                                    tip={`${g.name}: ${g.levelPct}% of ${g.capacityL} L`} />
                            </div>
                        ))}
                    </div>
                </div>
                <div className="md:pl-6">
                    <div className="flex items-center gap-[8px] text-[13px] font-medium" style={{ color: INK.text2 }}><Droplets className="h-4 w-4" aria-hidden />Water</div>
                    <div className="mt-2 flex items-baseline gap-1.5"><span className="text-[30px] leading-none" style={inkNum}>{e.water.jarsToday}</span><span className="text-[13px]" style={{ color: INK.text2 }}>jars so far today</span></div>
                    <div className="mt-1 text-[12.5px]" style={{ color: INK.text2 }}>Plus {e.water.tankersToday} tanker loads</div>
                    <div className="mt-3">
                        <Columns ariaLabel="Water jars per day, last 7 days" height={96} showAxis={false} maxBar={14} keyIndex={null}
                            data={e.water.last7.map((d, i) => ({ label: d.label.slice(0, 1), values: [d.value], partial: i === e.water.last7.length - 1, tipLabel: d.label }))}
                            series={[{ name: 'Jars', color: INK.black }]} />
                    </div>
                </div>
            </div>
        </InkCard>
    );
}

function RoundsCard({ lab }: DesignProps) {
    const r = SAMPLE_ROUND_STATS;
    return (
        <InkCard className="p-[24px] md:p-7" label="Checklist rounds">
            <CardHead title="Checklist rounds" sample right={<ClipboardCheck className="h-4 w-4" style={{ color: INK.text3 }} aria-hidden />} />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[36px] leading-none" style={inkNum}>{r.doneSoFar}<span style={{ color: INK.text3 }}>/{r.dueSoFar}</span></span>
                <span className="text-[13.5px]" style={{ color: INK.text2 }}>due so far done, {r.later} later today</span>
            </div>
            <div className="mt-4 overflow-x-auto pb-1 pt-6">
                <Ticks
                    ariaLabel="Rounds today: done, late and upcoming"
                    height={34}
                    width={3}
                    gap={4}
                    marker={{ index: r.dueSoFar, color: INK.black, label: 'Now' }}
                    items={SAMPLE_ROUNDS.map(x => ({
                        color: x.state === 'done' ? INK.black : x.state === 'late' ? RED : '#DCDCDF',
                        tip: `${x.time} · ${x.name}, ${x.floor} · ${x.state === 'done' ? 'Done' : x.state === 'late' ? 'Late' : 'Upcoming'}`,
                    }))}
                />
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-[12px]">
                <span className="inline-flex items-center gap-[8px] text-[13px] font-medium" style={{ color: RED_TEXT }}>
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: RED }} />
                    {r.late} late: {r.lateName}, {r.lateFloor}, due {r.lateDue}
                </span>
                <InkButton onClick={() => lab.previewAction('Open round')}>Open round</InkButton>
            </div>
        </InkCard>
    );
}

function ShiftCard() {
    const on = SAMPLE_TEAM.filter(p => p.shift !== 'off_shift');
    return (
        <InkCard className="p-[24px] md:p-7" label="On shift">
            <CardHead title="On shift" sample right={<span className="text-[13px]" style={{ color: INK.text2 }}><b style={{ ...inkNum, color: INK.text }}>{SAMPLE_ON_SHIFT.on}</b> of {SAMPLE_ON_SHIFT.total}</span>} />
            <div className="mb-5 flex -space-x-2">
                {SAMPLE_TEAM.map(p => (
                    <Avatar key={p.id} name={p.name} size={40} style={{ border: '3px solid #FFFFFF', background: p.shift === 'off_shift' ? INK.tile : INK.black, color: p.shift === 'off_shift' ? INK.text3 : '#FFFFFF' }} />
                ))}
            </div>
            <ul className="flex flex-col gap-[12px]">
                {on.map(p => (
                    <li key={p.id} className="flex items-center justify-between gap-[12px]">
                        <span className="min-w-0">
                            <span className="block text-[14px] font-semibold">{p.name}</span>
                            <span className="block text-[12.5px]" style={{ color: INK.text2 }}>{p.skill}</span>
                        </span>
                        <ShiftLabel shift={p.shift} since={p.since} />
                    </li>
                ))}
            </ul>
        </InkCard>
    );
}

function MiniTile({ icon: Icon, label, value, sub, action, onAction }: {
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: string; sub: string; action: string; onAction: () => void;
}) {
    return (
        <section aria-label={label} className="flex h-full min-h-[200px] flex-col rounded-[24px] p-[24px]" style={{ background: INK.tile }}>
            <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-[8px] text-[13.5px] font-semibold"><Icon className="h-4 w-4" aria-hidden />{label}</span>
                <SampleBadge />
            </div>
            <span className="mt-4 text-[32px] leading-none" style={inkNum}>{value}</span>
            <span className="mt-1.5 text-[13px]" style={{ color: INK.text2 }}>{sub}</span>
            <InkButton variant="white" className="mt-auto self-start" onClick={onAction}>{action}</InkButton>
        </section>
    );
}

export default function InkDashboard(props: DesignProps) {
    const { lab } = props;
    const quick = [
        { label: 'Raise ticket', icon: Plus, solid: true },
        { label: 'Check in visitor', icon: UserPlus },
        { label: 'Log reading', icon: Gauge },
        { label: 'Scan QR', icon: QrCode },
    ];
    return (
        <div className="flex flex-col gap-[24px]">
            <div className="flex flex-col gap-[20px] lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <H level={1} className="text-[30px] font-bold leading-tight tracking-[-0.02em]">{greeting(lab.now)}, {lab.user.firstName}</H>
                    <p className="mt-1 text-[14px]" style={{ color: INK.text2 }}>{longDate(lab.now)} · {lab.propertyName}</p>
                </div>
                <div className="flex flex-wrap items-center gap-[8px]">
                    <PeriodSwitch lab={lab} className="rounded-full lg:hidden" track={{ background: INK.tile, borderRadius: 999 }} thumb={{ background: INK.black, borderRadius: 999 }} idleText={INK.text2} activeText="#FFFFFF" />
                    {quick.map(q => (
                        <InkButton key={q.label} variant={q.solid ? 'solid' : 'outline'} icon={q.icon} onClick={() => lab.previewAction(q.label)}>{q.label}</InkButton>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-12 gap-[24px]">
                <div className="col-span-12 lg:col-span-6"><HeroCard {...props} /></div>
                <div className="col-span-12 sm:col-span-6 lg:col-span-3"><CriticalTile {...props} /></div>
                <div className="col-span-12 sm:col-span-6 lg:col-span-3"><SlaTile /></div>

                <div className="col-span-12 flex flex-col gap-[24px] lg:col-span-8">
                    <WeekCard />
                    <EnergyCard {...props} />
                </div>
                <div className="col-span-12 lg:col-span-4"><AttentionCard {...props} /></div>

                <div className="col-span-12 lg:col-span-7"><RoundsCard {...props} /></div>
                <div className="col-span-12 lg:col-span-5"><ShiftCard /></div>

                <div className="col-span-12 sm:col-span-6 xl:col-span-3">
                    <MiniTile icon={DoorOpen} label="Visitors" value={`${SAMPLE_VISITORS.onSite} on site`} sub={`${SAMPLE_VISITORS.checkedInToday} checked in today`} action="Check in visitor" onAction={() => lab.previewAction('Check in visitor')} />
                </div>
                <div className="col-span-12 sm:col-span-6 xl:col-span-3">
                    <MiniTile icon={CalendarClock} label="PPM this week" value={`${SAMPLE_PPM.thisWeek} due`} sub={`Next: ${SAMPLE_PPM.items[0].title}, ${SAMPLE_PPM.items[0].when.replace('Today, ', '')}`} action="View schedule" onAction={() => lab.previewAction('View schedule')} />
                </div>
                <div className="col-span-12 sm:col-span-6 xl:col-span-3">
                    <MiniTile icon={Coffee} label="Cafeteria" value={inrCompact(SAMPLE_CAFETERIA.todayInr)} sub={`Revenue today, yesterday ${inrCompact(SAMPLE_CAFETERIA.yesterdayInr)}`} action="View revenue" onAction={() => lab.previewAction('View revenue')} />
                </div>
                <div className="col-span-12 sm:col-span-6 xl:col-span-3">
                    <MiniTile icon={Boxes} label="Stock" value={`${SAMPLE_STOCK.lowCount} low`} sub="Items below minimum" action="Stock in" onAction={() => lab.previewAction('Stock in')} />
                </div>
            </div>
        </div>
    );
}
