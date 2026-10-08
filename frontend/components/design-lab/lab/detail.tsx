'use client';

import React, { useState } from 'react';
import { Camera, Check, Circle, CircleDot, Paperclip, Send, Video } from 'lucide-react';
import type { LabModel } from './useLabModel';
import { MATERIAL_STAGES } from './sample';
import type { ChatMessage, TimelineEvent } from './types';
import { Avatar, SampleBadge, cx } from './ui';
import { clockTime } from './format';

/**
 * Ticket detail building blocks. Designs compose and skin them; the structure (what a
 * timeline row or a chat bubble contains) stays identical so the comparison is fair.
 */

export function TimelineList({ events, accent, line = 'var(--lab-border)', dark }: { events: TimelineEvent[]; accent: string; line?: string; dark?: boolean }) {
    return (
        <ol className="relative flex flex-col">
            {events.map((e, i) => {
                const last = i === events.length - 1;
                const Icon = e.state === 'done' ? Check : e.state === 'current' ? CircleDot : Circle;
                return (
                    <li key={e.id} className="relative flex gap-3.5 pb-5">
                        {!last && <span aria-hidden className="absolute left-[13px] top-7 bottom-0 w-px" style={{ background: line }} />}
                        <span
                            className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full"
                            style={{
                                background: e.state === 'done' ? accent : e.state === 'current' ? 'var(--lab-surface)' : 'var(--lab-tile)',
                                border: e.state === 'current' ? `2px solid ${accent}` : 'none',
                                color: e.state === 'done' ? 'var(--lab-on-primary)' : e.state === 'current' ? accent : 'var(--lab-text3)',
                            }}
                        >
                            <Icon className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden />
                        </span>
                        <div className="min-w-0 pt-0.5">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="text-[14px] font-semibold" style={{ color: dark ? '#FFFFFF' : e.state === 'pending' ? 'var(--lab-text2)' : 'var(--lab-text)' }}>{e.label}</span>
                                {e.at && <span className="text-[12.5px] tabular-nums" style={{ color: dark ? 'rgba(255,255,255,0.7)' : 'var(--lab-text3)' }}>{clockTime(e.at)}</span>}
                                {e.state === 'pending' && <span className="text-[12px]" style={{ color: 'var(--lab-text3)' }}>Pending</span>}
                            </div>
                            <div className="mt-0.5 text-[13px]" style={{ color: dark ? 'rgba(255,255,255,0.75)' : 'var(--lab-text2)' }}>{e.detail}</div>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

export function ChatThread({ lab, messages, sample, mineStyle, otherStyle, inputStyle, sendStyle }: {
    lab: LabModel; messages: ChatMessage[]; sample: boolean; mineStyle: React.CSSProperties; otherStyle: React.CSSProperties; inputStyle?: React.CSSProperties; sendStyle: React.CSSProperties;
}) {
    const [draft, setDraft] = useState('');
    return (
        <div className="flex flex-col gap-[12px]">
            {sample && <div className="flex justify-end"><SampleBadge /></div>}
            {messages.length === 0 && (
                <div className="py-8 text-center text-[13.5px]" style={{ color: 'var(--lab-text2)' }}>No messages yet. Start the conversation below.</div>
            )}
            {messages.map(m => (
                <div key={m.id} className={cx('flex gap-2.5', m.mine && 'flex-row-reverse')}>
                    <Avatar name={m.author} size={32} />
                    <div className={cx('max-w-[78%]', m.mine && 'items-end text-right')}>
                        <div className="mb-1 text-[12px]" style={{ color: 'var(--lab-text3)' }}>
                            <span className="font-semibold" style={{ color: 'var(--lab-text2)' }}>{m.author}</span> · {m.at}
                        </div>
                        <div className="inline-block px-3.5 py-2.5 text-left text-[14px] leading-relaxed" style={m.mine ? mineStyle : otherStyle}>
                            {renderMentions(m.text)}
                        </div>
                    </div>
                </div>
            ))}
            <form
                className="mt-2 flex items-center gap-[8px]"
                onSubmit={e => { e.preventDefault(); if (draft.trim()) { lab.previewAction('Send message'); setDraft(''); } }}
            >
                <button type="button" aria-label="Attach file" onClick={() => lab.previewAction('Attach file')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: 'var(--lab-tile)' }}>
                    <Paperclip className="h-4 w-4" />
                </button>
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Message, or @mention someone"
                    aria-label="Message"
                    className="h-10 min-w-0 flex-1 px-4 text-[14px] outline-none placeholder:text-[var(--lab-text3)]"
                    style={{ background: 'var(--lab-tile)', borderRadius: 999, ...inputStyle }}
                />
                <button type="submit" aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={sendStyle}>
                    <Send className="h-4 w-4" />
                </button>
            </form>
        </div>
    );
}

function renderMentions(text: string) {
    const parts = text.split(/(@[A-Z][a-z]+(?: [A-Z][a-z]+)?)/g);
    return parts.map((p, i) => (p.startsWith('@') ? <b key={i}>{p}</b> : <React.Fragment key={i}>{p}</React.Fragment>));
}

/** Before and after slots. A missing photo shows an add prompt, never a fake image. */
export function MediaPair({ lab, slotStyle, labelStyle, height = 168, dark }: {
    lab: LabModel; slotStyle: React.CSSProperties; labelStyle?: React.CSSProperties; height?: number; dark?: boolean;
}) {
    const m = lab.detail.media;
    const slots = [
        { id: 'before', label: 'Before', photo: m.before, video: m.beforeVideo, sampleNote: m.sample ? 'Photo at 6:07 AM' : null },
        { id: 'after', label: 'After', photo: m.after, video: m.afterVideo, sampleNote: null },
    ];
    return (
        <div className="grid grid-cols-2 gap-[12px]">
            {slots.map(s => (
                <figure key={s.id} className="relative flex flex-col overflow-hidden" style={{ height, ...slotStyle }}>
                    {m.loading ? (
                        <div className="lab-skeleton h-full w-full" />
                    ) : s.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.photo} alt={`${s.label} photo`} className="h-full w-full object-cover" />
                    ) : s.video ? (
                        <video src={s.video} controls className="h-full w-full object-cover" aria-label={`${s.label} video`} />
                    ) : s.sampleNote ? (
                        <div className="flex h-full flex-col items-center justify-center gap-[8px] px-3 text-center" style={{ color: dark ? 'rgba(255,255,255,0.8)' : 'var(--lab-text2)' }}>
                            <Camera className="h-6 w-6" aria-hidden />
                            <span className="text-[12.5px]">{s.sampleNote}</span>
                        </div>
                    ) : (
                        <button type="button" onClick={() => lab.previewAction(`Add ${s.label.toLowerCase()} photo or video`)}
                            className="flex h-full w-full flex-col items-center justify-center gap-[8px] px-3 text-center" style={{ color: dark ? 'rgba(255,255,255,0.8)' : 'var(--lab-text2)' }}>
                            <span className="flex gap-1.5"><Camera className="h-5 w-5" aria-hidden /><Video className="h-5 w-5" aria-hidden /></span>
                            <span className="text-[12.5px] font-medium">Add {s.label.toLowerCase()} photo or video</span>
                        </button>
                    )}
                    <figcaption className="absolute left-2.5 top-2.5 inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-semibold"
                        style={{ background: 'rgba(255,255,255,0.92)', color: '#17171A', ...labelStyle }}>
                        {s.label}
                    </figcaption>
                    {m.sample && s.id === 'before' && <span className="absolute right-2.5 top-2.5"><SampleBadge /></span>}
                </figure>
            ))}
        </div>
    );
}

/** Requested, Quoted, Approved, Ordered, Delivered. */
export function MaterialSteps({ lab, color, track = 'var(--lab-border)', dark }: { lab: LabModel; color: string; track?: string; dark?: boolean }) {
    const mr = lab.detail.material;
    if (!mr) return null;
    const idx = MATERIAL_STAGES.indexOf(mr.stage);
    return (
        <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-[8px]">
                <div className="min-w-0">
                    <div className="text-[14px] font-semibold" style={{ color: dark ? '#FFFFFF' : 'var(--lab-text)' }}>{mr.title}</div>
                    <div className="text-[12.5px]" style={{ color: dark ? 'rgba(255,255,255,0.7)' : 'var(--lab-text2)' }}>{mr.number} · {mr.stage}</div>
                </div>
                {mr.sample && <SampleBadge dark={dark} />}
            </div>
            <ol className="grid grid-cols-5 gap-1.5" aria-label={`Material request stage: ${mr.stage}`}>
                {MATERIAL_STAGES.map((s, i) => (
                    <li key={s} className="flex flex-col gap-1.5">
                        <span className="h-1.5 rounded-full" style={{ background: i <= idx ? color : track }} />
                        <span className="text-[11.5px]" style={{ color: i === idx ? (dark ? '#FFFFFF' : 'var(--lab-text)') : dark ? 'rgba(255,255,255,0.65)' : 'var(--lab-text3)', fontWeight: i === idx ? 600 : 400 }}>{s}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

/** Location, Category, Assignee, Escalation and friends, as label/value pairs. */
export function infoItems(lab: LabModel): { label: string; value: string }[] {
    const t = lab.selected;
    if (!t) return [];
    const sla = lab.sla(t);
    return [
        { label: 'Location', value: t.location ?? 'Not recorded' },
        { label: 'Category', value: t.category ?? 'Unclassified' },
        { label: 'Assignee', value: t.assignee ?? 'Unassigned' },
        { label: 'Escalation', value: t.escalationLevel > 0 ? `Level ${t.escalationLevel}` : 'None' },
        { label: 'Raised', value: clockTime(t.raisedAt) },
        { label: 'SLA due', value: sla.due ? clockTime(sla.due) : 'No SLA' },
    ];
}

export function DetailTabs({ tab, setTab, lab, activeStyle, idleStyle, className, tabClass }: {
    tab: 'details' | 'timeline' | 'chat'; setTab: (t: 'details' | 'timeline' | 'chat') => void; lab: LabModel;
    activeStyle: React.CSSProperties; idleStyle: React.CSSProperties; className?: string; tabClass?: string;
}) {
    const tabs = [
        { id: 'details' as const, label: 'Details', count: null },
        { id: 'timeline' as const, label: 'Timeline', count: lab.detail.timeline.length },
        { id: 'chat' as const, label: 'Chat', count: lab.detail.chat.messages.length },
    ];
    return (
        <div role="tablist" aria-label="Ticket sections" className={cx('flex items-center gap-[4px]', className)}>
            {tabs.map(t => (
                <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={cx('inline-flex h-10 items-center gap-1.5 whitespace-nowrap px-4 text-[14px] font-semibold', tabClass)}
                    style={tab === t.id ? activeStyle : idleStyle}
                >
                    {t.label}
                    {t.count !== null && <span className="tabular-nums opacity-60">{t.count}</span>}
                </button>
            ))}
        </div>
    );
}
