'use client';

import React, { useState } from 'react';
import {
    AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock, CloudOff, ExternalLink, Flame, Info, MapPin, Siren, UserCog, X,
} from 'lucide-react';
import { TipBox, useTip } from '../../lab/charts';
import { inrCompact } from '../../lab/format';
import { EmptyState, SkeletonRows, cx } from '../../lab/ui';
import { inr } from '@/frontend/lib/dashboard/useWidgetData';
import { APPROVAL_ICONS, Fed, InlineError, Sample } from '../parts';
import { C, QUEUE_SHORT, fig, useApp, waitedLabel } from './core';
import { GhostButton, IconDot, LargeTitle, Pills, PrimaryButton, SheetFrame, Tag } from './ui';
import type { ApprovalItem, QueueId } from './sample';

/**
 * Approvals: every item waiting on you, one queue at a time or all together. Approve from the
 * card, open it for the full picture, or select several and approve them at once. Rejecting
 * always asks for a reason, one item at a time. Every decision can be undone for a few seconds.
 */

type Sort = 'critical' | 'oldest' | 'value';
const SORTS: { id: Sort; label: string }[] = [
    { id: 'critical', label: 'Critical first' }, { id: 'oldest', label: 'Waiting longest' }, { id: 'value', label: 'Highest value' },
];

function sortItems(list: ApprovalItem[], sort: Sort): ApprovalItem[] {
    const by = {
        critical: (a: ApprovalItem, b: ApprovalItem) => Number(b.critical) - Number(a.critical) || b.waited - a.waited,
        oldest: (a: ApprovalItem, b: ApprovalItem) => b.waited - a.waited,
        value: (a: ApprovalItem, b: ApprovalItem) => (b.amount ?? -1) - (a.amount ?? -1),
    }[sort];
    return [...list].sort(by);
}

export const canApprove = (i: ApprovalItem) => i.queue !== 'escalation';

/** One item: tap the body for detail, or act from the two buttons. */
export function ApprovalCard({ item, selecting, picked, onPick, compact }: {
    item: ApprovalItem; selecting?: boolean; picked?: boolean; onPick?: () => void; compact?: boolean;
}) {
    const { openSheet, decide, m } = useApp();
    const Icon = APPROVAL_ICONS[item.queue];
    const pickable = selecting && canApprove(item);
    return (
        <article className="rounded-[22px] p-[12px]" style={{ background: C.card, boxShadow: picked ? `inset 0 0 0 2px ${C.accent}` : undefined, opacity: selecting && !pickable ? 0.5 : 1 }}>
            <div className="flex items-start gap-[10px]">
                {pickable && (
                    <button type="button" role="checkbox" aria-checked={!!picked} aria-label={`Select ${item.ref}`} onClick={onPick}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full">
                        <span className="grid h-6 w-6 place-items-center rounded-full" style={picked ? { background: C.accent, color: '#FFFFFF' } : { boxShadow: `inset 0 0 0 2px ${C.muted}` }}>
                            {picked && <Check className="h-4 w-4" aria-hidden />}
                        </span>
                    </button>
                )}
                <button type="button" data-lab-item onClick={() => (pickable ? onPick?.() : openSheet({ kind: 'approval', id: item.id }))}
                    aria-label={`${item.ref}, ${item.title}, ${item.site}${item.amount !== null ? `, ${inrCompact(item.amount)}` : ''}`}
                    className="flex min-w-0 flex-1 items-start gap-[10px] rounded-[14px] p-[2px] text-left">
                    {!pickable && <IconDot icon={Icon} red={!!item.pastSlaHours} />}
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold" style={{ color: C.text3 }}>{item.ref} · {item.site}</span>
                        <span className="mt-[1px] block text-[14.5px] font-semibold leading-snug">{item.title}</span>
                        {!compact && (
                            <span className="mt-[8px] flex flex-wrap items-center gap-[6px]">
                                {item.pastSlaHours ? <Tag tone="red" icon={Siren}>Past SLA by {item.pastSlaHours} h</Tag>
                                    : item.critical && <Tag tone="ink" icon={Flame}>Critical</Tag>}
                                <Tag tone="plain" icon={Clock}>{waitedLabel(item.waited)}</Tag>
                            </span>
                        )}
                    </span>
                    {item.amount !== null && (
                        <span className="shrink-0 text-right">
                            <span className="block text-[16px]" style={fig}>{inrCompact(item.amount)}</span>
                            {item.queue === 'mr' && <span className="block text-[11px]" style={{ color: C.text3 }}>lowest quote</span>}
                        </span>
                    )}
                </button>
            </div>
            {!selecting && !compact && (
                <div className="mt-[12px] grid grid-cols-2 gap-[8px]">
                    {canApprove(item) ? (
                        <>
                            <button type="button" onClick={() => openSheet({ kind: 'approval', id: item.id, reject: true })} aria-label={`Reject ${item.ref}`}
                                className="inline-flex h-11 items-center justify-center gap-[6px] rounded-full text-[13.5px] font-bold" style={{ background: C.track, color: C.text }}>
                                <X className="h-4 w-4" aria-hidden />Reject
                            </button>
                            <button type="button" onClick={() => decide([item.id], 'approved')} aria-label={`Approve ${item.ref}`}
                                className="inline-flex h-11 items-center justify-center gap-[6px] rounded-full text-[13.5px] font-bold text-white" style={{ background: C.accent }}>
                                <Check className="h-4 w-4" aria-hidden />Approve
                            </button>
                        </>
                    ) : (
                        <>
                            <button type="button" onClick={() => m.previewAction(`Reassign ${item.ref}`)} className="inline-flex h-11 items-center justify-center gap-[6px] rounded-full text-[13.5px] font-bold" style={{ background: C.track, color: C.text }}>
                                <UserCog className="h-4 w-4" aria-hidden />Reassign
                            </button>
                            <button type="button" onClick={() => openSheet({ kind: 'approval', id: item.id })} className="inline-flex h-11 items-center justify-center gap-[6px] rounded-full text-[13.5px] font-bold text-white" style={{ background: C.accent }}>
                                <ExternalLink className="h-4 w-4" aria-hidden />Open
                            </button>
                        </>
                    )}
                </div>
            )}
        </article>
    );
}

export function ApprovalsScreen({ initialQueue }: { initialQueue?: QueueId }) {
    const { m, items, pending, pendingTotal, decide, go } = useApp();
    const [queue, setQueue] = useState<QueueId | 'all'>(initialQueue ?? 'all');
    const [sort, setSort] = useState<Sort>('critical');
    const [selecting, setSelecting] = useState(false);
    const [picked, setPicked] = useState<string[]>([]);

    const all = items.data ?? [];
    const list = sortItems(all.filter(i => queue === 'all' || i.queue === queue), sort);
    const pickable = list.filter(canApprove);
    const pickedItems = all.filter(i => picked.includes(i.id));
    const pickedValue = pickedItems.reduce((s, i) => s + (i.amount ?? 0), 0);
    const value = all.reduce((s, i) => s + (i.amount ?? 0), 0);
    const critical = all.filter(i => i.critical).length;
    const oldest = all.reduce((d, i) => Math.max(d, i.waited), 0);

    const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
    const stopSelecting = () => { setSelecting(false); setPicked([]); };
    const approvePicked = () => { decide(picked, 'approved'); stopSelecting(); };

    return (
        <div className="flex min-h-full flex-col">
            <LargeTitle title="Approvals" sub={pendingTotal === null ? 'Checking your queues' : pendingTotal === 0 ? 'Nothing is waiting on you' : 'Waiting on you across all sites'}
                right={pickable.length > 0 && items.state === 'ready' && (
                    <button type="button" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting}
                        className="inline-flex h-10 items-center rounded-full px-[14px] text-[13px] font-bold" style={selecting ? { background: C.text, color: '#FFFFFF' } : { background: C.card, color: C.accentDeep }}>
                        {selecting ? 'Done' : 'Select'}
                    </button>
                )} />

            {/* The one big number on this screen, with three facts that decide what to do first. */}
            <div className="mx-[16px] mt-[8px] rounded-[24px] p-[16px]" style={{ background: C.card }}>
                <Fed feed={m.waiting} rows={2} height={28}>
                    {() => (
                        <div className="flex items-end gap-[14px]">
                            <span className="text-[52px] leading-[0.9]" style={fig}>{pendingTotal ?? 0}</span>
                            <span className="pb-[4px] text-[13px] font-semibold" style={{ color: C.text2 }}>waiting<br />on you</span>
                            <Sample feed={items} />
                        </div>
                    )}
                </Fed>
                {m.waiting.state === 'ready' && !!pendingTotal && <Fed feed={items} rows={1} height={36} className="mt-[12px]">
                    {() => (
                        <dl className="mt-[14px] grid grid-cols-3 gap-[8px]">
                            {([['Value', inrCompact(value)], ['Critical', String(critical)], ['Oldest', oldest ? `${oldest} days` : 'Today']] as const).map(([k, v]) => (
                                <div key={k} className="rounded-[14px] px-[10px] py-[8px]" style={{ background: C.track }}>
                                    <dt className="text-[11.5px] font-semibold" style={{ color: C.text3 }}>{k}</dt>
                                    <dd className="text-[16px]" style={fig}>{v}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                </Fed>}
            </div>

            <Pills className="mt-[14px]" label="Queue" value={queue} onChange={q => { setQueue(q); setPicked([]); }}
                options={[{ id: 'all' as const, label: 'All', count: pendingTotal }, ...(['po', 'mr', 'petty', 'escalation'] as QueueId[]).map(q => ({ id: q, label: QUEUE_SHORT[q], count: pending[q] }))]} />

            <div className="mt-[10px] flex items-center gap-[8px] px-[16px]">
                {selecting ? (
                    <button type="button" onClick={() => setPicked(picked.length === pickable.length ? [] : pickable.map(i => i.id))}
                        className="inline-flex h-10 items-center rounded-full px-[4px] text-[13px] font-bold" style={{ color: C.accentDeep }}>
                        {picked.length === pickable.length ? 'Clear selection' : `Select all ${pickable.length}`}
                    </button>
                ) : (
                    <span className="text-[12.5px]" style={{ color: C.text3 }}>{items.state === 'ready' ? `${list.length} ${list.length === 1 ? 'item' : 'items'}` : ''}</span>
                )}
                <label className="ml-auto inline-flex h-10 items-center gap-[6px] rounded-full px-[12px] text-[12.5px] font-semibold" style={{ background: C.card, color: C.text2 }}>
                    <span className="sr-only">Sort</span>
                    <select value={sort} onChange={e => setSort(e.target.value as Sort)} className="bg-transparent font-semibold outline-none" style={{ color: C.text }}>
                        {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                </label>
            </div>

            <div className="flex flex-col gap-[10px] px-[16px] pt-[10px]">
                {items.state === 'loading' ? <SkeletonRows rows={3} height={130} gap={10} />
                    : items.state === 'error' ? <div className="rounded-[22px] p-[14px]" style={{ background: C.card }}><InlineError onRetry={items.retry} /></div>
                        : list.length === 0 ? (
                            <div className="rounded-[22px]" style={{ background: C.card }}>
                                <EmptyState icon={CheckCircle2} title={queue === 'all' ? 'You are all caught up' : `No ${QUEUE_SHORT[queue].toLowerCase()} waiting`}
                                    body={queue === 'all' ? 'New requests from your sites will appear here.' : 'Other queues may still need you.'}
                                    actionLabel={queue === 'all' ? 'Back to Home' : 'Show all queues'} onAction={() => (queue === 'all' ? go({ name: 'home' }) : setQueue('all'))} />
                            </div>
                        ) : list.map(i => <ApprovalCard key={i.id} item={i} selecting={selecting} picked={picked.includes(i.id)} onPick={() => toggle(i.id)} />)}
                {items.sample && items.state === 'ready' && m.source === 'live' && (
                    <p className="flex items-start gap-[6px] px-[4px] text-[12px]" style={{ color: C.text3 }}><Info className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden />Queue counts are live. The items are sample until a hook lists them.</p>
                )}
            </div>

            {selecting && (
                <div className="sticky bottom-0 z-10 mt-auto px-[12px] pb-[10px] pt-[14px]" style={{ background: `linear-gradient(180deg, rgba(242,244,249,0) 0%, ${C.page} 40%)` }}>
                    <div className="flex items-center gap-[8px] rounded-[22px] p-[8px]" style={{ background: C.text }}>
                        <span className="min-w-0 flex-1 pl-[10px] text-[13px] font-semibold text-white">
                            {picked.length === 0 ? 'Pick items to approve' : <>{picked.length} selected<span className="block text-[12px] font-medium text-white/70">{inrCompact(pickedValue)} in total</span></>}
                        </span>
                        <button type="button" disabled={picked.length === 0} onClick={approvePicked}
                            className="inline-flex h-11 items-center gap-[6px] rounded-full px-[16px] text-[13.5px] font-bold disabled:opacity-40" style={{ background: '#FFFFFF', color: C.text }}>
                            <Check className="h-4 w-4" aria-hidden />Approve {picked.length || ''}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ---------------------------------------------------------- detail sheet */

const REASONS = ['Over budget this month', 'Needs more quotes', 'Not needed right now', 'Wrong vendor or rate'];

function QuoteBars({ quotes }: { quotes: { vendor: string; amount: number }[] }) {
    const { host, tip, show, hide } = useTip();
    const max = Math.max(...quotes.map(q => q.amount));
    return (
        <div ref={host} className="relative" onMouseLeave={hide}>
            <ul aria-label="Quotes received" className="flex flex-col gap-[10px]">
                {quotes.map((q, i) => (
                    <li key={q.vendor}>
                        <span className="flex items-baseline justify-between gap-[8px] text-[13px]">
                            <span className="flex min-w-0 items-center gap-[6px] truncate font-semibold">{q.vendor}{i === 0 && <Tag>Lowest</Tag>}</span>
                            <span className="tabular-nums" style={{ color: C.text2 }}>{inr(q.amount)}</span>
                        </span>
                        <span className="mt-[6px] block h-[12px] rounded-full" style={{ background: C.track }}
                            onMouseEnter={e => show(e.currentTarget, <span>{q.vendor}: <b>{inr(q.amount)}</b>{i > 0 ? `, ${Math.round((q.amount / quotes[0].amount - 1) * 100)}% above lowest` : ', lowest'}</span>)}>
                            <span className="block h-full rounded-full" style={{ width: `${(q.amount / max) * 100}%`, background: i === 0 ? C.accent : C.bar }} />
                        </span>
                    </li>
                ))}
            </ul>
            <TipBox tip={tip} />
        </div>
    );
}

export function ApprovalSheet({ id, startReject }: { id: string; startReject?: boolean }) {
    const { m, items, closeSheet, decide, siteByName } = useApp();
    const [rejecting, setRejecting] = useState(!!startReject);
    const [reason, setReason] = useState<string | null>(null);
    const item = items.data?.find(i => i.id === id) ?? null;

    if (!item) {
        return (
            <SheetFrame title="Approval" onClose={closeSheet}>
                <EmptyState compact icon={CheckCircle2} title={items.state === 'ready' ? 'Already handled' : 'Not available right now'}
                    body={items.state === 'ready' ? 'Someone approved or rejected this, so it left your queue.' : 'Try again once the queue loads.'}
                    actionLabel="Close" onAction={closeSheet} />
            </SheetFrame>
        );
    }

    const site = siteByName(item.site);
    const approvable = canApprove(item);
    const offline = !m.online;
    const steps = [
        { label: `Raised by ${item.by}`, when: item.waited + 1 === 1 ? 'Yesterday' : `${item.waited + 1} days ago`, done: true },
        { label: item.queue === 'mr' ? `${item.quotes?.length ?? 0} quotes received` : item.queue === 'escalation' ? 'Escalated to you' : 'Checked by the site', when: item.waited === 0 ? 'Today' : `${item.waited} ${item.waited === 1 ? 'day' : 'days'} ago`, done: true },
        { label: approvable ? 'Your approval' : 'Your call', when: 'Now', done: false },
    ];

    const footer = rejecting ? (
        <div className="grid grid-cols-[auto_1fr] gap-[8px]">
            <GhostButton icon={ArrowLeft} onClick={() => setRejecting(false)}>Back</GhostButton>
            <PrimaryButton icon={X} tone="ink" disabled={!reason} onClick={() => { decide([item.id], 'rejected', reason ?? undefined); closeSheet(); }}>Reject {item.ref}</PrimaryButton>
        </div>
    ) : (
        <>
            {offline && <p className="mb-[10px] flex items-center gap-[6px] text-[12.5px]" style={{ color: C.text2 }}><CloudOff className="h-4 w-4" aria-hidden />You are offline. This sends when you reconnect.</p>}
            <div className="grid grid-cols-2 gap-[8px]">
                {approvable ? (
                    <>
                        <GhostButton icon={X} onClick={() => setRejecting(true)}>Reject</GhostButton>
                        <PrimaryButton icon={Check} onClick={() => { decide([item.id], 'approved'); closeSheet(); }}>Approve</PrimaryButton>
                    </>
                ) : (
                    <>
                        <GhostButton icon={UserCog} onClick={() => m.previewAction(`Reassign ${item.ref}`)}>Reassign</GhostButton>
                        <PrimaryButton icon={ExternalLink} onClick={() => m.previewAction(`Open ${item.ref}`)}>Open ticket</PrimaryButton>
                    </>
                )}
            </div>
        </>
    );

    return (
        <SheetFrame title={rejecting ? `Reject ${item.ref}?` : item.ref} onClose={closeSheet} footer={footer} tall>
            {rejecting ? (
                <div>
                    <p className="text-[13.5px]" style={{ color: C.text2 }}>{item.by} will see your reason. Pick the one that fits best.</p>
                    <div role="radiogroup" aria-label="Reason" className="mt-[12px] flex flex-col gap-[8px]">
                        {REASONS.map(r => (
                            <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
                                className="flex h-[52px] items-center gap-[12px] rounded-[16px] px-[14px] text-left text-[14px] font-semibold"
                                style={{ background: C.card, boxShadow: reason === r ? `inset 0 0 0 2px ${C.accent}` : `inset 0 0 0 1px ${C.border}` }}>
                                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${reason === r ? C.accent : C.muted}` }}>
                                    {reason === r && <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.accent }} />}
                                </span>
                                {r}
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-[12px]">
                    <div className="rounded-[22px] p-[16px]" style={{ background: C.card }}>
                        <div className="flex flex-wrap items-center gap-[6px]">
                            <Tag>{QUEUE_SHORT[item.queue]}</Tag>
                            {item.pastSlaHours ? <Tag tone="red" icon={Siren}>Past SLA by {item.pastSlaHours} h</Tag> : item.critical && <Tag tone="ink" icon={Flame}>Critical</Tag>}
                            <Sample feed={items} />
                        </div>
                        <p className="mt-[10px] text-[19px] font-bold leading-snug tracking-[-0.02em]">{item.title}</p>
                        <p className="mt-[4px] flex items-center gap-[5px] text-[13px]" style={{ color: C.text3 }}><MapPin className="h-3.5 w-3.5" aria-hidden />{item.site}{item.location ? `, ${item.location}` : ''}</p>
                        {item.amount !== null && (
                            <p className="mt-[14px]">
                                <span className="block text-[12px] font-semibold" style={{ color: C.text3 }}>{item.queue === 'mr' ? 'Lowest quote' : 'Amount'}</span>
                                <span className="text-[34px] leading-tight" style={fig}>{inr(item.amount)}</span>
                            </p>
                        )}
                    </div>

                    {item.queue !== 'escalation' && (
                        <div className="flex items-start gap-[10px] rounded-[18px] p-[14px] text-[13px]" style={{ background: site?.overBudget ? C.tint : C.card, color: C.text2 }}>
                            {site?.overBudget ? <AlertTriangle className="mt-[1px] h-4 w-4 shrink-0" style={{ color: C.accentDeep }} aria-hidden /> : <CheckCircle2 className="mt-[1px] h-4 w-4 shrink-0" style={{ color: C.accentDeep }} aria-hidden />}
                            <span>{site?.overBudget
                                ? <><b style={{ color: C.text }}>{item.site} is {inrCompact(site.overBudget)} over</b> this month&apos;s budget. This adds {inrCompact(item.amount ?? 0)}.</>
                                : <>Fits inside {item.site}&apos;s budget for this month.</>}</span>
                        </div>
                    )}

                    {item.quotes && (
                        <div className="rounded-[22px] p-[16px]" style={{ background: C.card }}>
                            <p className="mb-[12px] text-[14px] font-bold">Quotes</p>
                            <QuoteBars quotes={item.quotes} />
                        </div>
                    )}

                    <dl className="grid grid-cols-2 gap-[8px]">
                        {([
                            [item.queue === 'po' ? 'Vendor' : item.queue === 'mr' ? 'Lowest bidder' : 'Raised by', item.party],
                            ['Requested by', item.by],
                            ['Waiting', waitedLabel(item.waited).replace('Waiting ', '')],
                            ['Site score', site ? `${site.score} of 100` : 'Not listed'],
                        ] as const).map(([k, v]) => (
                            <div key={k} className="rounded-[16px] px-[12px] py-[10px]" style={{ background: C.card }}>
                                <dt className="text-[11.5px] font-semibold" style={{ color: C.text3 }}>{k}</dt>
                                <dd className="truncate text-[13.5px] font-semibold">{v}</dd>
                            </div>
                        ))}
                    </dl>

                    <div className="rounded-[22px] p-[16px]" style={{ background: C.card }}>
                        <p className="mb-[10px] text-[14px] font-bold">History</p>
                        <ol className="flex flex-col">
                            {steps.map((s, i) => (
                                <li key={s.label} className="flex gap-[12px]">
                                    <span className="flex flex-col items-center">
                                        <span className={cx('mt-[3px] h-3 w-3 shrink-0 rounded-full')} style={s.done ? { background: C.accent } : { boxShadow: `inset 0 0 0 2px ${C.accent}` }} />
                                        {i < steps.length - 1 && <span className="w-[2px] flex-1" style={{ background: C.bar }} />}
                                    </span>
                                    <span className="pb-[12px]">
                                        <span className="block text-[13.5px] font-semibold">{s.label}</span>
                                        <span className="block text-[12px]" style={{ color: C.text3 }}>{s.when}</span>
                                    </span>
                                </li>
                            ))}
                        </ol>
                    </div>
                </div>
            )}
        </SheetFrame>
    );
}
