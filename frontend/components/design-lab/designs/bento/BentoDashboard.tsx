'use client';

import React from 'react';
import {
    Boxes, CalendarClock, ChevronRight, ClipboardCheck, Coffee, DoorOpen, Droplets, Fuel, Gauge, Plus, QrCode,
    CircleCheck, Moon, ShieldCheck, Siren, Ticket, UserPlus, Users, Wrench, Zap,
} from 'lucide-react';
import type { DesignProps } from '../../DesignLab';
import { Columns, LineArea, Ring, SegmentBar, TipBox, useTip } from '../../lab/charts';
import { PeriodSwitch } from '../../lab/frame';
import { duration, greeting, inrCompact, longDate, num } from '../../lab/format';
import {
    SAMPLE_CAFETERIA, SAMPLE_ENERGY, SAMPLE_KPIS, SAMPLE_ON_SHIFT, SAMPLE_PPM, SAMPLE_ROUNDS, SAMPLE_ROUND_STATS,
    SAMPLE_STOCK, SAMPLE_TEAM, SAMPLE_VISITORS, SAMPLE_WEEK,
} from '../../lab/sample';
import { PRIORITY_META, RED, RED_BG, RED_TEXT, STATUS_META } from '../../lab/status';
import { Avatar, EmptyState, ErrorState, H, SampleBadge, Skeleton, SlaBar, SlaText, listKeys, rowProps, stop } from '../../lab/ui';
import { BENTO, BentoButton, Widget, bentoNum } from './BentoDesign';

const SIZE = {
    small: 'col-span-1 row-span-1',
    wide: 'col-span-2 row-span-1',
    tall: 'col-span-1 row-span-2',
    large: 'col-span-2 row-span-2',
};

function ActiveWidget({ lab }: DesignProps) {
    const s = lab.stats;
    const t = lab.tickets;
    const segs = [
        { key: 'open' as const, value: s.open, color: '#FFFFFF' },
        { key: 'assigned' as const, value: s.assigned, color: 'rgba(255,255,255,0.62)' },
        { key: 'in_progress' as const, value: s.inProgress, color: 'rgba(255,255,255,0.34)' },
    ];
    return (
        <Widget tone="emerald" title="Active tickets" icon={Ticket} className="col-span-2 row-span-2 xl:row-span-1" right={<SampleBadge dark size="xs" />}>
            {t.loading ? (
                <div className="flex flex-1 flex-col gap-[10px]" role="status" aria-label="Loading"><div className="h-12 w-24 rounded-[12px] bg-white/15" /><div className="h-3 w-full rounded-full bg-white/15" /></div>
            ) : t.error ? (
                <ErrorState dark compact message={t.error} onRetry={t.retry} />
            ) : (
                <div className="grid min-h-0 flex-1 grid-cols-1 gap-[16px] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="flex min-w-0 flex-col">
                        <span className="text-[56px] leading-[0.85]" style={bentoNum}>{s.active}</span>
                        <span className="mt-[4px] text-[12.5px] text-white/85">{s.unassigned} have no owner</span>
                        <div className="mt-auto">
                            <SegmentBar segments={segs.map(x => ({ label: STATUS_META[x.key].label, value: x.value, color: x.color }))} height={8} gap={2} radius={3} ariaLabel="Active tickets by status" />
                            <div className="mt-[6px] flex flex-wrap gap-x-[10px] gap-y-[1px] text-[11px] text-white/85">
                                {segs.map(x => {
                                    const Icon = STATUS_META[x.key].icon;
                                    return <span key={x.key} className="inline-flex items-center gap-[4px] whitespace-nowrap"><Icon className="h-3 w-3" aria-hidden />{STATUS_META[x.key].label} <b className="text-white">{x.value}</b></span>;
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-col justify-end">
                        <Columns
                            ariaLabel="Tickets raised and closed this week"
                            height={86}
                            showAxis={false}
                            maxBar={8}
                            groupGap={2}
                            gridColor="rgba(255,255,255,0.18)"
                            textColor="rgba(255,255,255,0.75)"
                            keyColor="#FFFFFF"
                            data={SAMPLE_WEEK.map(d => ({ label: d.label.slice(0, 1), values: [d.raised, d.closed], partial: d.today, tipLabel: `${d.label} ${d.date}` }))}
                            series={[{ name: 'Raised', color: '#FFFFFF' }, { name: 'Closed', color: BENTO.ramp[0] }]}
                            partialColors={['rgba(255,255,255,0.5)', 'rgba(5,74,51,0.45)']}
                        />
                        <span className="mt-[2px] inline-flex items-center gap-[10px] text-[11px] text-white/85">
                            <span className="inline-flex items-center gap-[4px]"><span className="h-2 w-2 rounded-[2px] bg-white" />Raised</span>
                            <span className="inline-flex items-center gap-[4px]"><span className="h-2 w-2 rounded-[2px]" style={{ background: BENTO.ramp[0] }} />Closed</span>
                            <span className="ml-auto">This week</span>
                        </span>
                    </div>
                </div>
            )}
        </Widget>
    );
}

function CriticalWidget({ lab, setScreen }: DesignProps) {
    const t = lab.tickets;
    const crit = lab.attention.find(x => x.priority === 'critical');
    const sla = crit ? lab.sla(crit) : null;
    return (
        <Widget title="Critical" icon={Siren} narrow className={SIZE.small} right={<button type="button" aria-label="Open critical tickets" onClick={() => setScreen('tickets')} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: RED_BG }}><ChevronRight className="h-4 w-4" style={{ color: RED_TEXT }} /></button>}>
            {t.loading ? <Skeleton className="h-12 w-14" /> : (
                <>
                    <span className="text-[44px] leading-none" style={{ ...bentoNum, color: RED_TEXT }}>{lab.stats.critical}</span>
                    {sla && sla.minutesLeft !== null && !sla.breached ? (
                        <span className="mt-auto inline-flex min-h-7 items-center gap-[6px] self-start rounded-[12px] px-[10px] py-[4px] text-[11.5px] font-semibold leading-tight" style={{ background: RED_BG, color: RED_TEXT }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: RED }} />SLA breach in {duration(sla.minutesLeft)}
                        </span>
                    ) : (
                        <span className="mt-auto text-[12.5px]" style={{ color: BENTO.text2 }}>{lab.stats.critical === 0 ? 'Nothing critical right now' : 'Already breached'}</span>
                    )}
                </>
            )}
        </Widget>
    );
}

function AttentionWidget({ lab, setScreen }: DesignProps) {
    const t = lab.tickets;
    return (
        <Widget title="Needs attention" icon={ShieldCheck} className={SIZE.large} right={<span className="text-[12px]" style={{ color: BENTO.text3 }}>SLA left</span>}>
            {t.loading ? <div className="flex flex-col gap-[8px]">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[58px]" />)}</div>
                : t.error ? <ErrorState compact message={t.error} onRetry={t.retry} />
                    : lab.attention.length === 0 ? <EmptyState compact title="All caught up" body="Nothing needs a person right now." actionLabel="Raise ticket" onAction={() => lab.previewAction('Raise ticket')} />
                        : (
                            <div className="-mx-[6px] flex min-h-0 flex-1 flex-col gap-[4px] overflow-hidden" onKeyDown={listKeys}>
                                {lab.attention.slice(0, 4).map(x => {
                                    const sla = lab.sla(x);
                                    const P = PRIORITY_META[x.priority].icon;
                                    return (
                                        <div key={x.id} {...rowProps(() => { lab.selectTicket(x.id); setScreen('detail'); }, `${x.number} ${x.title}`)}
                                            className="flex cursor-pointer items-center gap-[12px] rounded-[18px] px-[10px] py-[8px] hover:bg-[#F2F8F5]">
                                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px]" style={{ background: x.priority === 'critical' ? RED_BG : BENTO.tint }} title={PRIORITY_META[x.priority].label}>
                                                <P className="h-4 w-4" style={{ color: x.priority === 'critical' ? RED : BENTO.deep }} aria-hidden />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[13.5px] font-semibold">{x.title}</span>
                                                <span className="mt-[5px] flex items-center gap-[8px]">
                                                    <SlaBar sla={sla} height={4} className="max-w-[140px]" />
                                                    <SlaText sla={sla} className="whitespace-nowrap text-[12px] font-semibold" />
                                                </span>
                                            </span>
                                            <span className="sr-only">{PRIORITY_META[x.priority].label} priority, {STATUS_META[x.status].label}</span>
                                            {!x.assignee ? (
                                                <button type="button" onClick={stop(() => { lab.selectTicket(x.id); lab.openDrawer(); })}
                                                    className="h-10 shrink-0 rounded-[14px] px-[12px] text-[12.5px] font-semibold" style={{ background: BENTO.tint, color: BENTO.deep }}>
                                                    Assign
                                                </button>
                                            ) : (
                                                <Avatar name={x.assignee} size={30} style={{ background: BENTO.tint, color: BENTO.deep }} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
        </Widget>
    );
}

function SlaWidget() {
    return (
        <Widget title="SLA met" icon={Gauge} sample narrow className={SIZE.tall}>
            <div className="flex flex-1 flex-col items-center justify-center gap-[12px]">
                <Ring value={SAMPLE_KPIS.slaMetPct / 100} size={168} stroke={16} color={BENTO.primary} track={BENTO.track}
                    tipText={`${SAMPLE_KPIS.slaMetOnTime} of ${SAMPLE_KPIS.slaMetTotal} closed on time`} ariaLabel={`SLA met ${SAMPLE_KPIS.slaMetPct}%`}>
                    <span className="flex flex-col items-center">
                        <span className="text-[40px] leading-none" style={bentoNum}>{SAMPLE_KPIS.slaMetPct}%</span>
                        <span className="mt-[4px] text-[11.5px]" style={{ color: BENTO.text2 }}>on time</span>
                    </span>
                </Ring>
                <span className="text-center text-[12.5px]" style={{ color: BENTO.text2 }}>{SAMPLE_KPIS.slaMetOnTime} of {SAMPLE_KPIS.slaMetTotal} closed within SLA today</span>
            </div>
        </Widget>
    );
}

function ShortcutWidget({ lab }: DesignProps) {
    const items = [
        { label: 'Raise ticket', icon: Plus, solid: true },
        { label: 'Check in visitor', icon: UserPlus },
        { label: 'Log reading', icon: Gauge },
        { label: 'Scan QR', icon: QrCode },
    ];
    return (
        <Widget label="Shortcuts" className={`${SIZE.wide} !p-[12px]`}>
            <div className="grid h-full grid-cols-2 gap-[8px]">
                {items.map(i => (
                    <button key={i.label} type="button" onClick={() => lab.previewAction(i.label)}
                        className="flex min-h-10 items-center gap-[10px] rounded-[18px] px-[14px] text-left text-[13.5px] font-semibold"
                        style={i.solid ? { background: BENTO.gradient, color: '#FFFFFF' } : { background: '#F2F8F5', color: BENTO.text }}>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: i.solid ? 'rgba(255,255,255,0.2)' : '#FFFFFF' }}>
                            <i.icon className="h-4 w-4" />
                        </span>
                        {i.label}
                    </button>
                ))}
            </div>
        </Widget>
    );
}

function WaterWidget() {
    const w = SAMPLE_ENERGY.water;
    return (
        <Widget title="Water" icon={Droplets} sample narrow className={SIZE.small}>
            <div className="flex items-baseline gap-[4px]"><span className="text-[28px] leading-none" style={bentoNum}>{w.jarsToday}</span><span className="text-[12px]" style={{ color: BENTO.text2 }}>jars so far</span></div>
            <span className="text-[11.5px]" style={{ color: BENTO.text2 }}>+{w.tankersToday} tanker loads</span>
            <div className="mt-auto">
                <Columns ariaLabel="Water jars per day" height={52} showAxis={false} showXLabels={false} maxBar={10} keyIndex={null}
                    data={w.last7.map((d, i) => ({ label: d.label, values: [d.value], partial: i === w.last7.length - 1 }))}
                    series={[{ name: 'Jars', color: BENTO.primary }]} partialColors={[BENTO.light]} />
            </div>
        </Widget>
    );
}

function ElectricityWidget() {
    const e = SAMPLE_ENERGY.electricity;
    return (
        <Widget title="Electricity, last 14 days" icon={Zap} sample className={SIZE.wide}>
            <div className="flex items-baseline gap-[10px] text-[12px]" style={{ color: BENTO.text2 }}>
                <span><b className="text-[18px]" style={{ ...bentoNum, color: BENTO.text }}>{num(e.todayKwh)}</b> kWh so far today</span>
                <span className="inline-flex items-center gap-[4px]"><span className="h-2 w-2 rounded-[2px]" style={{ background: BENTO.deep }} />Yesterday {num(e.yesterdayKwh)}</span>
            </div>
            <div className="mt-auto">
                <Columns ariaLabel="Electricity per day, last 14 days" height={88} showAxis={false} maxBar={14} xLabelEvery={2}
                    data={e.last14.map((d, i) => ({ label: d.label.split(' ')[0], values: [d.value], partial: i === e.last14.length - 1, highlight: i === e.last14.length - 2, tipLabel: d.label }))}
                    series={[{ name: 'kWh', color: BENTO.light }]} highlightColor={BENTO.deep} partialColors={[BENTO.lighter]}
                    format={n => num(n)} />
            </div>
        </Widget>
    );
}

/** 52 rounds around a ring. Done emerald, late red, upcoming pale. Every segment has a tooltip. */
function RoundDial({ size = 168 }: { size?: number }) {
    const { host, tip, show, hide } = useTip();
    const n = SAMPLE_ROUNDS.length;
    const stroke = 13;
    const r = size / 2 - stroke / 2 - 1;
    const c = size / 2;
    const seg = 360 / n;
    const pt = (deg: number) => [c + r * Math.cos((deg * Math.PI) / 180), c + r * Math.sin((deg * Math.PI) / 180)];
    return (
        <div ref={host} className="relative" style={{ width: size, height: size }} onMouseLeave={hide}>
            <svg width={size} height={size} role="img" aria-label={`Rounds today: ${SAMPLE_ROUND_STATS.doneSoFar} done, ${SAMPLE_ROUND_STATS.late} late, ${SAMPLE_ROUND_STATS.later} later`}>
                {SAMPLE_ROUNDS.map((x, i) => {
                    const a0 = -90 + i * seg + 0.9;
                    const a1 = -90 + (i + 1) * seg - 0.9;
                    const [x0, y0] = pt(a0);
                    const [x1, y1] = pt(a1);
                    const color = x.state === 'done' ? BENTO.primary : x.state === 'late' ? RED : '#E3EEE8';
                    return (
                        <path key={x.id} d={`M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`} stroke={color} strokeWidth={stroke} fill="none"
                            onMouseEnter={e => show(e.currentTarget, `${x.time} · ${x.name}, ${x.floor} · ${x.state === 'done' ? 'Done' : x.state === 'late' ? 'Late' : 'Upcoming'}`)} />
                    );
                })}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[30px] leading-none" style={bentoNum}>{SAMPLE_ROUND_STATS.doneSoFar}/{SAMPLE_ROUND_STATS.dueSoFar}</span>
                <span className="mt-[4px] text-[11px]" style={{ color: BENTO.text2 }}>due so far done</span>
                <span className="text-[11px]" style={{ color: BENTO.text3 }}>{SAMPLE_ROUND_STATS.later} later today</span>
            </div>
            <TipBox tip={tip} />
        </div>
    );
}

function RoundsWidget({ lab }: DesignProps) {
    const r = SAMPLE_ROUND_STATS;
    return (
        <Widget title="Rounds" icon={ClipboardCheck} sample narrow className={SIZE.tall}>
            <div className="flex min-h-0 flex-1 flex-col items-center gap-[10px]">
                <RoundDial size={150} />
                <div className="w-full rounded-[14px] px-[10px] py-[6px] text-[11.5px] font-medium leading-snug" style={{ background: RED_BG, color: RED_TEXT }}>
                    <span className="mr-[5px] inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: RED }} />
                    {r.late} late: {r.lateName}, {r.lateDue}
                </div>
                <BentoButton className="mt-auto w-full" onClick={() => lab.previewAction('Open round')}>Open round</BentoButton>
            </div>
        </Widget>
    );
}

function VisitorsWidget({ lab }: DesignProps) {
    const v = SAMPLE_VISITORS;
    return (
        <Widget title="Visitors" icon={DoorOpen} sample narrow className={SIZE.tall}>
            <div className="flex items-baseline gap-[6px]"><span className="text-[30px] leading-none" style={bentoNum}>{v.onSite}</span><span className="text-[12px]" style={{ color: BENTO.text2 }}>on site · {v.checkedInToday} today</span></div>
            <div className="mt-[6px]">
                <LineArea ariaLabel="Visitors on site through the morning" data={v.onSiteByHour} color={BENTO.primary} height={64} partialLast
                    xLabels={[{ index: 0, text: v.onSiteByHour[0].label }, { index: v.onSiteByHour.length - 1, text: 'Now' }]} />
            </div>
            <ul className="mt-[8px] flex flex-col gap-[6px]">
                {v.recent.map(x => (
                    <li key={x.id} className="flex items-center gap-[8px]">
                        <Avatar name={x.name} size={26} style={{ background: BENTO.tint, color: BENTO.deep }} />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{x.name}</span>
                        <span className="text-[11px]" style={{ color: BENTO.text3 }}>{x.time.replace(' AM', '')}</span>
                    </li>
                ))}
            </ul>
            <BentoButton className="mt-auto w-full" icon={UserPlus} onClick={() => lab.previewAction('Check in visitor')}>Check in</BentoButton>
        </Widget>
    );
}

function Tank({ name, pct, capacity }: { name: string; pct: number; capacity: number }) {
    const { host, tip, show, hide } = useTip();
    return (
        <div ref={host} className="relative flex flex-1 flex-col items-center gap-[6px]" onMouseLeave={hide}>
            <span className="text-[13px] font-semibold" style={bentoNum}>{pct}%</span>
            <div role="meter" aria-label={`${name} tank`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                className="relative w-[46px] flex-1 overflow-hidden rounded-[14px]" style={{ background: BENTO.track, minHeight: 90 }}
                onMouseEnter={e => show(e.currentTarget, `${name}: ${pct}% of ${capacity} L`)}>
                <div className="absolute inset-x-0 bottom-0" style={{ height: `${pct}%`, background: BENTO.gradient }} />
                {[25, 50, 75].map(m => <span key={m} className="absolute inset-x-[10px] h-px bg-white/70" style={{ bottom: `${m}%` }} />)}
            </div>
            <span className="text-[12px] font-medium" style={{ color: BENTO.text2 }}>{name}</span>
            <TipBox tip={tip} />
        </div>
    );
}

function DieselWidget() {
    const d = SAMPLE_ENERGY.diesel;
    return (
        <Widget title="Diesel" icon={Fuel} sample narrow className={SIZE.tall}>
            <div className="flex items-baseline gap-[4px]"><span className="text-[30px] leading-none" style={bentoNum}>{d.usedTodayL}</span><span className="text-[12px]" style={{ color: BENTO.text2 }}>L used today</span></div>
            <div className="mt-[14px] flex min-h-0 flex-1 gap-[12px]">
                {d.generators.map(g => <Tank key={g.id} name={g.name} pct={g.levelPct} capacity={g.capacityL} />)}
            </div>
        </Widget>
    );
}

function ShiftIcon({ shift }: { shift: (typeof SAMPLE_TEAM)[number]['shift'] }) {
    const Icon = shift === 'on_a_ticket' ? Wrench : shift === 'free' ? CircleCheck : Moon;
    return (
        <span aria-hidden className="absolute -bottom-[3px] -right-[3px] grid h-[16px] w-[16px] place-items-center rounded-full bg-white" style={{ boxShadow: '0 1px 3px rgba(15,32,26,0.2)' }}>
            <Icon className="h-[10px] w-[10px]" style={{ color: shift === 'off_shift' ? BENTO.text3 : BENTO.deep }} strokeWidth={2.6} />
        </span>
    );
}

function ShiftWidget() {
    const { host, tip, show, hide } = useTip();
    return (
        <Widget title="On shift" icon={Users} sample narrow className={SIZE.small}>
            <span className="-mt-[4px] text-[12.5px]" style={{ color: BENTO.text2 }}><b className="text-[15px]" style={{ ...bentoNum, color: BENTO.text }}>{SAMPLE_ON_SHIFT.on}</b> of {SAMPLE_ON_SHIFT.total} on shift</span>
            <div ref={host} className="relative mt-auto grid grid-cols-3 gap-[8px]" onMouseLeave={hide}>
                {SAMPLE_TEAM.map(p => (
                    <span key={p.id} onMouseEnter={e => show(e.currentTarget, `${p.name}, ${p.skill}: ${p.shift === 'off_shift' ? 'Off shift' : p.shift === 'free' ? 'Free' : 'On a ticket'}`)}
                        className="grid place-items-center">
                        <span className="relative">
                            <Avatar name={p.name} size={38} style={{
                                borderRadius: 13,
                                background: p.shift === 'off_shift' ? '#F2F4F3' : p.shift === 'free' ? BENTO.tint : BENTO.primary,
                                color: p.shift === 'off_shift' ? BENTO.text3 : p.shift === 'free' ? BENTO.deep : '#FFFFFF',
                            }} />
                            <ShiftIcon shift={p.shift} />
                        </span>
                    </span>
                ))}
                <TipBox tip={tip} />
            </div>
            <span className="sr-only">{SAMPLE_TEAM.map(p => `${p.name}: ${p.shift === 'off_shift' ? 'off shift' : p.shift === 'free' ? 'free' : 'on a ticket'}`).join(', ')}</span>
        </Widget>
    );
}

function PpmWidget({ lab }: DesignProps) {
    const p = SAMPLE_PPM;
    const { host, tip, show, hide } = useTip();
    return (
        <Widget title="PPM this week" icon={CalendarClock} sample className={SIZE.wide}
            right={<button type="button" onClick={() => lab.previewAction('Open PPM schedule')} className="h-10 rounded-[12px] px-[10px] text-[12.5px] font-semibold" style={{ color: BENTO.deep, background: BENTO.tint }}>Schedule</button>}>
            <div ref={host} className="relative grid grid-cols-7 gap-[6px]" onMouseLeave={hide}>
                {p.week.map(d => {
                    const today = d.label === 'Tue';
                    return (
                        <div key={d.label} className="flex flex-col items-center gap-[6px] rounded-[14px] py-[6px]"
                            style={{ background: today ? BENTO.tint : 'transparent' }}
                            onMouseEnter={e => show(e.currentTarget, `${d.label}: ${d.count} scheduled`)}>
                            <span className="text-[11px] font-semibold" style={{ color: today ? BENTO.deep : BENTO.text3 }}>{d.label.slice(0, 1)}</span>
                            <span className="flex h-[22px] flex-col items-center justify-center gap-[3px]">
                                {d.count === 0
                                    ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#DCE6E1' }} />
                                    : Array.from({ length: d.count }).map((_, i) => <span key={i} className="h-2 w-2 rounded-full" style={{ background: BENTO.primary }} />)}
                            </span>
                        </div>
                    );
                })}
                <TipBox tip={tip} />
            </div>
            <div className="mt-auto truncate text-[12.5px]" style={{ color: BENTO.text2 }}>
                Next: <b style={{ color: BENTO.text }}>{p.items[0].title}</b>, {p.items[0].when.replace('Today, ', '')}
            </div>
        </Widget>
    );
}

function Pill({ label, value, icon: Icon, onClick }: { label: string; value: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick}
            className="flex min-h-0 flex-1 items-center gap-[10px] rounded-full bg-white pl-[10px] pr-[14px] text-left"
            style={{ boxShadow: BENTO.shadow }}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: BENTO.tint }}><Icon className="h-4 w-4" style={{ color: BENTO.deep }} /></span>
            <span className="min-w-0">
                <span className="block truncate text-[11.5px] font-medium" style={{ color: BENTO.text2 }}>{label}</span>
                <span className="block truncate text-[16px] font-semibold" style={bentoNum}>{value}</span>
            </span>
        </button>
    );
}

function PillsWidget({ lab }: DesignProps) {
    return (
        <div className={`${SIZE.small} flex flex-col items-stretch gap-[8px]`} aria-label="Cafeteria and stock">
            <Pill label="Cafeteria today" value={inrCompact(SAMPLE_CAFETERIA.todayInr)} icon={Coffee} onClick={() => lab.previewAction('Open cafeteria')} />
            <SampleBadge className="self-center" />
            <Pill label="Stock below min" value={`${SAMPLE_STOCK.lowCount} items`} icon={Boxes} onClick={() => lab.previewAction('Open stock')} />
        </div>
    );
}

export default function BentoDashboard(props: DesignProps) {
    const { lab } = props;
    return (
        <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-end justify-between gap-[12px]">
                <div>
                    <H level={1} className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{greeting(lab.now)}, {lab.user.firstName}</H>
                    <p className="mt-[2px] text-[14px]" style={{ color: BENTO.text2 }}>{longDate(lab.now)} · {lab.propertyName}</p>
                </div>
                <div className="lg:hidden">
                    <PeriodSwitch lab={lab} size="sm" track={{ background: 'rgba(15,32,26,0.06)', borderRadius: 14 }} thumb={{ background: '#FFFFFF', borderRadius: 11, boxShadow: BENTO.shadow }} idleText={BENTO.text2} activeText={BENTO.deep} />
                </div>
            </div>
            <div className="grid grid-flow-row-dense auto-rows-[176px] grid-cols-2 gap-[16px] md:grid-cols-4 xl:auto-rows-[180px] xl:grid-cols-6">
                <ActiveWidget {...props} />
                <CriticalWidget {...props} />
                <AttentionWidget {...props} />
                <SlaWidget />
                <ShortcutWidget {...props} />
                <WaterWidget />
                <ElectricityWidget />
                <RoundsWidget {...props} />
                <VisitorsWidget {...props} />
                <DieselWidget />
                <ShiftWidget />
                <PpmWidget {...props} />
                <PillsWidget {...props} />
            </div>
        </div>
    );
}
