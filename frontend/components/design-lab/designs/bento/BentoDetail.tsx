'use client';

import React, { useState } from 'react';
import { ArrowLeft, Building2, Camera, CircleUser, History, Layers, MessageCircle, Package, ShieldAlert, Timer } from 'lucide-react';
import type { DesignProps } from '../../DesignLab';
import { ACTION_ICONS, ACTION_LABELS, runAction } from '../../lab/actions';
import { ChatThread, DetailTabs, MaterialSteps, MediaPair, TimelineList } from '../../lab/detail';
import { clockTime, countdownParts, raisedLabel } from '../../lab/format';
import { RED } from '../../lab/status';
import { CategoryChip, EmptyState, ErrorState, H, PriorityChip, SampleBadge, Skeleton, StatusChip, cx } from '../../lab/ui';
import { BENTO, BentoButton, Widget, bentoNum } from './BentoDesign';

type Tab = 'details' | 'timeline' | 'chat';

export default function BentoDetail(props: DesignProps) {
    const { lab, setScreen } = props;
    const [tab, setTab] = useState<Tab>('details');
    const t = lab.selected;
    const tk = lab.tickets;

    if (tk.loading) {
        return (
            <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-6" role="status" aria-label="Loading ticket">
                <Skeleton className="h-[220px] lg:col-span-4" style={{ borderRadius: 26 }} />
                <Skeleton className="h-[220px] lg:col-span-2" style={{ borderRadius: 26 }} />
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[110px]" style={{ borderRadius: 26 }} />)}
            </div>
        );
    }
    if (tk.error) return <div className="rounded-[26px] bg-white" style={{ boxShadow: BENTO.shadow }}><ErrorState message={tk.error} onRetry={tk.retry} /></div>;
    if (!t) return <div className="rounded-[26px] bg-white" style={{ boxShadow: BENTO.shadow }}><EmptyState title="No ticket to show" body="There are no tickets at this property yet." actionLabel="Go to tickets" onAction={() => setScreen('tickets')} /></div>;

    const sla = lab.sla(t);
    const parts = countdownParts(sla.minutesLeft ?? 0);
    const { primary, secondary } = lab.detail.actions;
    const info = [
        { label: 'Location', value: t.location ?? 'Not recorded', icon: Building2 },
        { label: 'Category', value: t.category ?? 'Unclassified', icon: Layers },
        { label: 'Assignee', value: t.assignee ?? 'Unassigned', icon: CircleUser },
        { label: 'Escalation', value: t.escalationLevel > 0 ? `Level ${t.escalationLevel}` : 'None', icon: ShieldAlert },
    ];
    const pick = (next: Tab) => {
        setTab(next);
        if (window.matchMedia('(min-width: 1024px)').matches) document.getElementById(`bento-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const show = (which: Tab) => cx(tab === which ? 'flex' : 'hidden', 'lg:flex');

    return (
        <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-6">
            <div className="flex flex-col gap-[16px] lg:col-span-4">
                <Widget label="Ticket">
                    <div className="flex items-center justify-between gap-[8px]">
                        <button type="button" onClick={() => setScreen('tickets')} className="inline-flex h-10 items-center gap-[6px] rounded-[14px] px-[10px] text-[13px] font-semibold" style={{ background: '#F2F8F5', color: BENTO.deep }}>
                            <ArrowLeft className="h-4 w-4" aria-hidden />Tickets
                        </button>
                        <span className="text-[12.5px] tabular-nums" style={{ color: BENTO.text3 }}>{t.number}</span>
                    </div>
                    <div className="mt-[14px] flex flex-wrap gap-[6px]">
                        <PriorityChip priority={t.priority} />
                        <StatusChip status={t.status} />
                        <CategoryChip label={t.category} />
                    </div>
                    <H level={1} className="mt-[10px] text-[26px] font-semibold leading-tight tracking-[-0.02em]">{t.title}</H>
                    <p className="mt-[4px] text-[13.5px]" style={{ color: BENTO.text2 }}>
                        {t.raisedBy && <>Raised by <b style={{ color: BENTO.text }}>{t.raisedBy}</b>{t.company ? `, ${t.company}` : ''} · </>}{raisedLabel(t.raisedAt, lab.now)}
                    </p>
                    {lab.detail.description && (
                        <div className="mt-[14px] rounded-[18px] p-[14px]" style={{ background: '#F4F9F6' }}>
                            {lab.detail.description.sample && <SampleBadge className="float-right ml-[8px]" />}
                            <p className="text-[14.5px] leading-relaxed">{lab.detail.description.text}</p>
                        </div>
                    )}
                    <DetailTabs tab={tab} setTab={pick} lab={lab} className="mt-[14px] self-start rounded-[16px] bg-[#F2F8F5] p-[4px]" tabClass="rounded-[12px]"
                        activeStyle={{ background: '#FFFFFF', color: BENTO.deep, boxShadow: BENTO.shadow }} idleStyle={{ color: BENTO.text2, background: 'transparent' }} />
                </Widget>

                <div className="grid grid-cols-2 gap-[16px] md:grid-cols-4">
                    {info.map(i => (
                        <Widget key={i.label} label={i.label} className="!p-[16px]">
                            <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: BENTO.tint }}><i.icon className="h-4 w-4" style={{ color: BENTO.deep }} /></span>
                            <span className="mt-[10px] text-[12px]" style={{ color: BENTO.text2 }}>{i.label}</span>
                            <span className="mt-[2px] line-clamp-2 text-[14px] font-semibold">{i.value}</span>
                        </Widget>
                    ))}
                </div>

                <div id="bento-details" className={cx(show('details'), 'flex-col gap-[16px]')}>
                    <Widget title="Before and after" icon={Camera}>
                        <MediaPair lab={lab} height={200} slotStyle={{ background: '#F2F8F5', borderRadius: 18 }} />
                    </Widget>
                    {lab.detail.material && (
                        <Widget title="Material request" icon={Package}>
                            <MaterialSteps lab={lab} color={BENTO.primary} track={BENTO.track} />
                        </Widget>
                    )}
                </div>

                <div id="bento-chat" className={show('chat')}>
                    <Widget title="Chat" icon={MessageCircle} className="w-full">
                        <ChatThread lab={lab} messages={lab.detail.chat.messages} sample={lab.detail.chat.sample}
                            mineStyle={{ background: BENTO.primary, color: '#FFFFFF', borderRadius: '18px 18px 6px 18px' }}
                            otherStyle={{ background: '#F2F8F5', color: BENTO.text, borderRadius: '18px 18px 18px 6px' }}
                            inputStyle={{ background: '#F2F8F5' }}
                            sendStyle={{ background: BENTO.primary, color: '#FFFFFF' }} />
                    </Widget>
                </div>
            </div>

            <div className="flex flex-col gap-[16px] lg:col-span-2">
                <Widget tone="emerald" title="SLA" icon={Timer}
                    right={<span className="inline-flex h-7 items-center rounded-full px-[10px] text-[12px] font-semibold text-white" style={{ background: sla.danger ? RED : 'rgba(255,255,255,0.2)' }}>
                        {sla.breached ? 'Breached' : sla.done ? 'Met' : sla.danger ? 'At risk' : 'On track'}
                    </span>}>
                    {sla.minutesLeft === null ? (
                        <span className="text-[18px] font-semibold">No SLA on this ticket</span>
                    ) : (
                        <>
                            <div className="flex items-baseline gap-[2px]" style={bentoNum}>
                                {Number(parts.h) > 0 && <><span className="text-[56px] leading-none">{parts.h}</span><span className="mr-[6px] text-[20px] text-white/75">h</span></>}
                                <span className="text-[56px] leading-none">{parts.m}</span><span className="text-[20px] text-white/75">m</span>
                            </div>
                            <span className="mt-[4px] text-[13px] text-white/85">{sla.breached ? 'over' : 'left'}, due {clockTime(sla.due)}</span>
                            <div className="mt-[16px] h-[8px] w-full overflow-hidden rounded-full bg-white/20" role="progressbar" aria-label="SLA used" aria-valuenow={Math.round(sla.used * 100)}>
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, sla.used * 100)}%`, background: sla.danger ? RED : '#FFFFFF' }} />
                            </div>
                            <div className="mt-[8px] flex justify-between text-[12px] text-white/85">
                                <span>{sla.targetHours ?? '?'} h target</span>
                                <span><b className="text-white">{Math.round(sla.used * 100)}%</b> used</span>
                            </div>
                        </>
                    )}
                </Widget>

                {(primary.length > 0 || secondary.length > 0) && (
                    <Widget label="Actions" className="!p-[12px]">
                        <div className="flex flex-col gap-[8px]">
                            {primary.map(a => {
                                const Icon = ACTION_ICONS[a];
                                return <BentoButton key={a} icon={Icon} className="h-12 w-full rounded-[18px] text-[14.5px]" onClick={() => runAction(lab, a)}>{ACTION_LABELS[a]}</BentoButton>;
                            })}
                            <div className="grid grid-cols-2 gap-[8px]">
                                {secondary.map(a => {
                                    const Icon = ACTION_ICONS[a];
                                    return <BentoButton key={a} variant="tint" icon={Icon} className="h-11 w-full rounded-[16px] px-[10px] text-[12.5px]" onClick={() => runAction(lab, a)}>{ACTION_LABELS[a]}</BentoButton>;
                                })}
                            </div>
                        </div>
                    </Widget>
                )}

                <div id="bento-timeline" className={show('timeline')}>
                    <Widget title="Timeline" icon={History} className="w-full">
                        <TimelineList events={lab.detail.timeline} accent={BENTO.primary} line={BENTO.track} />
                    </Widget>
                </div>
            </div>
        </div>
    );
}
