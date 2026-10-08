'use client';

import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { DesignProps } from '../../DesignLab';
import { Ticks } from '../../lab/charts';
import { ChatThread, DetailTabs, MaterialSteps, MediaPair, TimelineList, infoItems } from '../../lab/detail';
import { clockTime, countdownParts, raisedLabel } from '../../lab/format';
import { RED } from '../../lab/status';
import { ACTION_ICONS, ACTION_LABELS, runAction } from '../../lab/actions';
import { CategoryChip, EmptyState, ErrorState, PriorityChip, SampleBadge, Skeleton, StatusChip, H } from '../../lab/ui';
import { INK, InkButton, inkNum } from './InkDesign';

export default function InkDetail(props: DesignProps) {
    const { lab, setScreen } = props;
    const [tab, setTab] = useState<'details' | 'timeline' | 'chat'>('details');
    const t = lab.selected;
    const tk = lab.tickets;

    if (tk.loading) {
        return (
            <div className="grid grid-cols-12 gap-[24px]" role="status" aria-label="Loading ticket">
                <div className="col-span-12 flex flex-col gap-[16px] lg:col-span-8">
                    <Skeleton className="h-7 w-56" /><Skeleton className="h-10 w-3/4" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" />
                </div>
                <div className="col-span-12 lg:col-span-4"><Skeleton className="h-[420px] w-full" style={{ borderRadius: 24 }} /></div>
            </div>
        );
    }
    if (tk.error) return <ErrorState message={tk.error} onRetry={tk.retry} />;
    if (!t) return <EmptyState title="No ticket to show" body="There are no tickets at this property yet." actionLabel="Go to tickets" onAction={() => setScreen('tickets')} />;

    const sla = lab.sla(t);
    const parts = countdownParts(sla.minutesLeft ?? 0);
    const ticks = 24;
    const usedTicks = Math.min(ticks, Math.round(sla.used * ticks));
    const { primary, secondary } = lab.detail.actions;

    return (
        <div className="flex flex-col gap-[24px]">
            <button type="button" onClick={() => setScreen('tickets')} className="inline-flex h-10 items-center gap-[8px] self-start rounded-full pr-3 text-[13.5px] font-semibold" style={{ color: INK.text2 }}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> Tickets
            </button>
            <div className="grid grid-cols-12 gap-[24px] lg:gap-10">
                <article className="col-span-12 min-w-0 lg:col-span-8">
                    <div className="flex flex-wrap items-center gap-[8px]">
                        <PriorityChip priority={t.priority} />
                        <StatusChip status={t.status} />
                        <CategoryChip label={t.category} />
                    </div>
                    <H level={1} className="mt-4 text-[30px] font-bold leading-tight tracking-[-0.02em]">{t.title}</H>
                    <p className="mt-2 text-[14px]" style={{ color: INK.text2 }}>
                        {t.raisedBy ? <>Raised by <b className="font-semibold" style={{ color: INK.text }}>{t.raisedBy}</b>{t.company ? `, ${t.company}` : ''} · </> : null}
                        {raisedLabel(t.raisedAt, lab.now)} · {t.number}
                    </p>
                    {lab.detail.description && (
                        <div className="mt-6 rounded-[24px] p-[24px]" style={{ background: INK.tile }}>
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: INK.text3 }}>Description</span>
                                {lab.detail.description.sample && <SampleBadge />}
                            </div>
                            <p className="text-[15.5px] leading-relaxed">{lab.detail.description.text}</p>
                        </div>
                    )}

                    <DetailTabs
                        tab={tab}
                        setTab={setTab}
                        lab={lab}
                        className="mt-8 border-b"
                        tabClass="relative rounded-none"
                        activeStyle={{ color: INK.text, boxShadow: `inset 0 -2px 0 ${INK.black}` }}
                        idleStyle={{ color: INK.text2 }}
                    />
                    <div className="pt-6" role="tabpanel">
                        {tab === 'details' && (
                            <div className="flex flex-col gap-8">
                                <section aria-label="Photos and videos">
                                    <H level={2} className="mb-3 text-[15px] font-semibold">Before and after</H>
                                    <MediaPair lab={lab} height={220} slotStyle={{ background: INK.tile, borderRadius: 24 }} />
                                </section>
                                {lab.detail.material && (
                                    <section aria-label="Material request" className="rounded-[24px] border p-[24px]" style={{ borderColor: INK.border }}>
                                        <H level={2} className="mb-4 text-[15px] font-semibold">Material request</H>
                                        <MaterialSteps lab={lab} color={INK.black} />
                                    </section>
                                )}
                            </div>
                        )}
                        {tab === 'timeline' && <TimelineList events={lab.detail.timeline} accent={INK.black} />}
                        {tab === 'chat' && (
                            <ChatThread lab={lab} messages={lab.detail.chat.messages} sample={lab.detail.chat.sample}
                                mineStyle={{ background: INK.black, color: '#FFFFFF', borderRadius: '20px 20px 6px 20px' }}
                                otherStyle={{ background: INK.tile, color: INK.text, borderRadius: '20px 20px 20px 6px' }}
                                sendStyle={{ background: INK.black, color: '#FFFFFF' }} />
                        )}
                    </div>
                </article>

                <aside className="col-span-12 lg:col-span-4">
                    <div className="flex flex-col gap-[16px] lg:sticky" style={{ top: 'calc(var(--lab-bar-h) + 96px)' }}>
                        <section aria-label="SLA" className="rounded-[24px] bg-[#0B0B0C] p-7 text-white">
                            <div className="flex items-center justify-between text-[13.5px]">
                                <span className="font-medium text-white/70">SLA countdown</span>
                                <span className="inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-semibold" style={{ background: sla.danger ? RED : 'rgba(255,255,255,0.14)', color: '#FFFFFF' }}>
                                    {sla.breached ? 'Breached' : sla.done ? 'Met' : sla.danger ? 'At risk' : 'On track'}
                                </span>
                            </div>
                            {sla.minutesLeft === null ? (
                                <div className="mt-4 text-[20px] font-semibold">No SLA on this ticket</div>
                            ) : (
                                <>
                                    <div className="mt-3 flex items-baseline gap-[4px] leading-none" style={inkNum}>
                                        {Number(parts.h) > 0 && <><span className="text-[64px]">{parts.h}</span><span className="mr-2 text-[22px] text-white/60">h</span></>}
                                        <span className="text-[64px]">{parts.m}</span><span className="text-[22px] text-white/60">m</span>
                                    </div>
                                    <div className="mt-2 text-[14px] text-white/75">{sla.breached ? 'over' : 'left'} · due {clockTime(sla.due)}</div>
                                    <div className="mt-6">
                                        <Ticks
                                            ariaLabel={`${Math.round(sla.used * 100)}% of the SLA window used`}
                                            height={30}
                                            width={4}
                                            gap={4}
                                            items={Array.from({ length: ticks }, (_, i) => ({
                                                color: i < usedTicks ? (sla.danger ? RED : '#FFFFFF') : 'rgba(255,255,255,0.22)',
                                                tip: `${Math.round(((i + 1) / ticks) * (sla.targetHours ?? 0) * 60)} min into the SLA`,
                                            }))}
                                        />
                                    </div>
                                    <div className="mt-3 flex justify-between text-[12.5px] text-white/65">
                                        <span>{sla.targetHours ?? '?'} h target</span>
                                        <span><b className="text-white" style={inkNum}>{Math.min(999, Math.round(sla.used * 100))}%</b> used</span>
                                    </div>
                                </>
                            )}
                        </section>

                        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[24px]" style={{ background: INK.border, border: `1px solid ${INK.border}` }}>
                            {infoItems(lab).map(i => (
                                <div key={i.label} className="bg-white px-5 py-4">
                                    <dt className="text-[12px]" style={{ color: INK.text2 }}>{i.label}</dt>
                                    <dd className="mt-1 line-clamp-2 text-[14px] font-semibold">{i.value}</dd>
                                </div>
                            ))}
                        </dl>

                        <div className="hidden flex-col gap-[8px] lg:flex">
                            {primary.map(a => {
                                const Icon = ACTION_ICONS[a];
                                return (
                                    <button key={a} type="button" onClick={() => runAction(lab, a)} className="inline-flex h-12 items-center justify-center gap-[8px] rounded-full bg-[#0B0B0C] text-[15px] font-semibold text-white">
                                        <Icon className="h-4.5 w-4.5" /> {ACTION_LABELS[a]}
                                    </button>
                                );
                            })}
                            <div className="flex gap-[8px]">
                                {secondary.map(a => {
                                    const Icon = ACTION_ICONS[a];
                                    return <InkButton key={a} variant="outline" icon={Icon} className="h-11 flex-1" onClick={() => runAction(lab, a)}>{ACTION_LABELS[a]}</InkButton>;
                                })}
                            </div>
                        </div>
                    </div>
                </aside>
            </div>

            {(primary.length > 0 || secondary.length > 0) && (
                <div className="fixed inset-x-3 bottom-[88px] z-30 flex gap-[8px] rounded-full border bg-white p-[8px] shadow-xl md:bottom-4 lg:hidden" style={{ borderColor: INK.border }}>
                    {secondary.slice(0, 1).map(a => {
                        const Icon = ACTION_ICONS[a];
                        return (
                            <button key={a} type="button" aria-label={ACTION_LABELS[a]} onClick={() => runAction(lab, a)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: INK.tile }}>
                                <Icon className="h-4.5 w-4.5" />
                            </button>
                        );
                    })}
                    {primary.map(a => (
                        <button key={a} type="button" onClick={() => runAction(lab, a)} className="h-11 flex-1 rounded-full bg-[#0B0B0C] text-[14.5px] font-semibold text-white">
                            {ACTION_LABELS[a]}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
