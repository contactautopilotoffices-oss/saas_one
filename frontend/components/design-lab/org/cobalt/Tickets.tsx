'use client';

import React, { useRef, useState } from 'react';
import {
    AlertCircle, ArrowUpRight, Camera, CheckCircle2, Clock, MapPin, Phone, Plus, RotateCcw, Search, Send, Siren, UserPlus, Users, X,
} from 'lucide-react';
import { countdownParts, duration, slaInfo, slaSortKey } from '../../lab/format';
import { PRIORITY_META, STATUS_META } from '../../lab/status';
import type { Priority, TicketStatus } from '../../lab/types';
import { EmptyState, SkeletonRows, cx, listKeys } from '../../lab/ui';
import { InlineError, Sample } from '../parts';
import { ORG_TECHS, SLA_HOURS, TICKET_CATEGORIES } from '../orgTickets';
import { C, fig, sinceLabel, useApp, type OrgTicket, type TicketView } from './core';
import { Card, GhostButton, LargeTitle, Pills, PrimaryButton, Section, SheetFrame, Tag, TopBar } from './ui';

/**
 * Tickets across every site: a list you can cut by SLA, urgency, assignment and site, a
 * ticket page with its SLA clock, people, activity and the next action, a form to raise one,
 * and a sheet to assign or reassign. Every change is local preview state with Undo.
 */

const ACTIVE: TicketStatus[] = ['open', 'assigned', 'in_progress'];
const isActive = (t: OrgTicket) => ACTIVE.includes(t.status);
const isUrgent = (t: OrgTicket) => t.priority === 'critical' || t.priority === 'urgent';

const VIEWS: { id: TicketView; label: string; test: (t: OrgTicket, now: Date) => boolean }[] = [
    { id: 'active', label: 'Active', test: t => isActive(t) },
    { id: 'sla', label: 'Past SLA', test: (t, now) => isActive(t) && slaInfo(t, now).breached },
    { id: 'urgent', label: 'Urgent', test: t => isActive(t) && isUrgent(t) },
    { id: 'unassigned', label: 'Unassigned', test: t => isActive(t) && !t.assignee },
    { id: 'waitlist', label: 'Waitlist', test: t => t.status === 'waitlist' },
    { id: 'resolved', label: 'Resolved', test: t => t.status === 'resolved' || t.status === 'closed' },
];

type Sort = 'sla' | 'newest' | 'priority';
const SORTS: { id: Sort; label: string }[] = [{ id: 'sla', label: 'SLA, soonest first' }, { id: 'priority', label: 'Priority' }, { id: 'newest', label: 'Newest first' }];

export function StatusTag({ status }: { status: TicketStatus }) {
    const meta = STATUS_META[status];
    return <Tag tone={status === 'open' ? 'tint' : 'plain'} icon={meta.icon}>{meta.label}</Tag>;
}

/** Priority as icon and label. Critical and urgent are ink, never red: red is for SLA. */
export function PriorityTag({ priority }: { priority: Priority }) {
    const meta = PRIORITY_META[priority];
    return <Tag tone={priority === 'critical' || priority === 'urgent' ? 'ink' : 'plain'} icon={meta.icon}>{meta.label}</Tag>;
}

function Avatar({ name, size = 26 }: { name: string | null; size?: number }) {
    if (!name) return <span aria-hidden className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, boxShadow: `inset 0 0 0 1.5px ${C.muted}`, color: C.text3 }}><UserPlus className="h-3.5 w-3.5" /></span>;
    const ini = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return <span aria-hidden className="grid shrink-0 place-items-center rounded-full text-[10.5px] font-bold" style={{ width: size, height: size, background: C.tint, color: C.accentDeep }}>{ini}</span>;
}

function SlaLine({ t }: { t: OrgTicket }) {
    const { m } = useApp();
    const s = slaInfo(t, m.now);
    if (t.status === 'waitlist') return <span className="text-[12px] font-semibold" style={{ color: C.text3 }}>SLA paused</span>;
    return (
        <span className="inline-flex shrink-0 items-center gap-[4px] text-[12px] font-semibold tabular-nums" style={{ color: s.breached && !s.done ? C.redText : C.text2 }}>
            {s.breached && !s.done ? <Siren className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}{s.label}
        </span>
    );
}

export function TicketCard({ t, compact }: { t: OrgTicket; compact?: boolean }) {
    const { m, push, openSheet } = useApp();
    const s = slaInfo(t, m.now);
    const late = s.breached && !s.done;
    return (
        <article className="overflow-hidden rounded-[22px]" style={{ background: C.card }}>
            <button type="button" data-lab-item onClick={() => push({ name: 'ticket', id: t.id })} aria-label={`${t.number}, ${t.title}, ${t.site}, ${PRIORITY_META[t.priority].label}, ${STATUS_META[t.status].label}, ${t.status === 'waitlist' ? 'SLA paused' : s.label}`}
                className="block w-full px-[14px] pb-[10px] pt-[12px] text-left">
                <span className="flex items-center gap-[6px]">
                    <PriorityTag priority={t.priority} />
                    {!compact && <StatusTag status={t.status} />}
                    <span className="ml-auto"><SlaLine t={t} /></span>
                </span>
                <span className="mt-[8px] block text-[15px] font-semibold leading-snug">{t.title}</span>
                <span className="mt-[2px] block truncate text-[12px]" style={{ color: C.text3 }}>{t.number} · {t.site}{t.location ? ` · ${t.location}` : ''}</span>
            </button>
            {!compact && (
                <div className="flex items-center gap-[8px] px-[14px] pb-[12px]">
                    <Avatar name={t.assignee} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: t.assignee ? C.text2 : C.text3 }}>{t.assignee ?? 'Nobody assigned'} · {sinceLabel(m.now, t.raisedAt)}</span>
                    {!t.assignee && isActive(t) && (
                        <button type="button" onClick={() => openSheet({ kind: 'assign', id: t.id })} aria-label={`Assign ${t.number}`}
                            className="inline-flex h-9 shrink-0 items-center gap-[5px] rounded-full px-[12px] text-[12.5px] font-bold" style={{ background: C.accent, color: C.onAccent }}>
                            <UserPlus className="h-3.5 w-3.5" aria-hidden />Assign
                        </button>
                    )}
                </div>
            )}
            {t.slaHours !== null && !s.done && t.status !== 'waitlist' && (
                <span aria-hidden className="block h-[4px]" style={{ background: C.track }}>
                    <span className="block h-full" style={{ width: `${Math.min(100, Math.max(3, s.used * 100))}%`, background: late ? C.red : C.accent }} />
                </span>
            )}
        </article>
    );
}

/* -------------------------------------------------------------- list */

export function TicketsScreen({ initialView, initialSite }: { initialView?: TicketView; initialSite?: string }) {
    const { m, tickets, push } = useApp();
    const [view, setView] = useState<TicketView>(initialView ?? 'active');
    const [site, setSite] = useState(initialSite ?? 'all');
    const [sort, setSort] = useState<Sort>('sla');
    const [query, setQuery] = useState('');
    const all = tickets.data ?? [];
    const inSite = all.filter(t => site === 'all' || t.site === site);
    const count = (v: TicketView) => inSite.filter(t => VIEWS.find(x => x.id === v)!.test(t, m.now)).length;
    const q = query.trim().toLowerCase();
    const list = inSite
        .filter(t => VIEWS.find(x => x.id === view)!.test(t, m.now))
        .filter(t => !q || [t.title, t.number, t.site, t.location ?? '', t.assignee ?? '', t.category ?? ''].some(x => x.toLowerCase().includes(q)))
        .sort((a, b) => sort === 'newest' ? b.raisedAt.getTime() - a.raisedAt.getTime()
            : sort === 'priority' ? PRIORITY_META[b.priority].rank - PRIORITY_META[a.priority].rank || slaSortKey(a, m.now) - slaSortKey(b, m.now)
                : slaSortKey(a, m.now) - slaSortKey(b, m.now));
    const sites = Array.from(new Set(all.map(t => t.site))).sort();
    const ready = tickets.state === 'ready';

    return (
        <div>
            <LargeTitle title="Tickets" sub={site === 'all' ? `Across ${sites.length || 'all'} sites` : site}
                right={<button type="button" onClick={() => push({ name: 'newTicket', site: site === 'all' ? undefined : site })} className="inline-flex h-10 items-center gap-[6px] rounded-full px-[14px] text-[13px] font-bold" style={{ background: C.accent, color: C.onAccent }}><Plus className="h-4 w-4" aria-hidden />Raise</button>} />

            <Card className="mx-[16px] mt-[8px] p-[16px]">
                {tickets.state === 'loading' ? <SkeletonRows rows={2} height={34} gap={10} /> : tickets.state === 'error' ? <InlineError onRetry={tickets.retry} /> : tickets.state === 'off' ? (
                    <p className="text-[13px]" style={{ color: C.text2 }}>{tickets.offReason}</p>
                ) : (
                    <>
                        <div className="flex items-end gap-[12px]">
                            <span className="text-[52px] leading-[0.9]" style={fig}>{count('active')}</span>
                            <span className="pb-[4px] text-[13px] font-semibold" style={{ color: C.text2 }}>active<br />tickets</span>
                            <span className="ml-auto self-start"><Sample feed={tickets} /></span>
                        </div>
                        <div className="mt-[14px] grid grid-cols-3 gap-[8px]">
                            {(['sla', 'urgent', 'unassigned'] as TicketView[]).map(v => {
                                const n = count(v);
                                const red = v === 'sla' && n > 0;
                                return (
                                    <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                                        className="rounded-[14px] px-[10px] py-[8px] text-left" style={{ background: red ? C.redBg : C.track, boxShadow: view === v ? `inset 0 0 0 2px ${red ? C.red : C.accent}` : undefined }}>
                                        <span className="flex items-center gap-[4px] text-[11.5px] font-semibold" style={{ color: red ? C.redText : C.text3 }}>{red && <Siren className="h-3 w-3" aria-hidden />}{VIEWS.find(x => x.id === v)!.label}</span>
                                        <span className="block text-[18px]" style={{ ...fig, color: red ? C.redText : C.text }}>{n}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </Card>

            <div className="mt-[14px] px-[16px]">
                <label className="flex h-12 items-center gap-[8px] rounded-full px-[14px]" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.border}` }}>
                    <Search className="h-[18px] w-[18px] shrink-0" style={{ color: C.text3 }} aria-hidden />
                    <span className="sr-only">Search tickets</span>
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Title, number, place, person" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[color:var(--cb-placeholder)]" />
                    {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="-mr-[8px] grid h-10 w-10 place-items-center rounded-full"><X className="h-4 w-4" aria-hidden /></button>}
                </label>
            </div>

            <Pills className="mt-[10px]" label="Show" value={view} onChange={setView} options={VIEWS.map(v => ({ id: v.id, label: v.label, count: ready ? count(v.id) : null }))} />

            <div className="mt-[10px] flex items-center gap-[8px] px-[16px]">
                <label className="inline-flex h-10 min-w-0 items-center rounded-full px-[12px] text-[12.5px] font-semibold" style={{ background: C.card }}>
                    <span className="sr-only">Site</span>
                    <select value={site} onChange={e => setSite(e.target.value)} className="min-w-0 max-w-[150px] truncate bg-transparent font-semibold outline-none" style={{ color: C.text }}>
                        <option value="all">All sites</option>
                        {sites.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </label>
                <label className="ml-auto inline-flex h-10 items-center rounded-full px-[12px] text-[12.5px] font-semibold" style={{ background: C.card }}>
                    <span className="sr-only">Sort</span>
                    <select value={sort} onChange={e => setSort(e.target.value as Sort)} className="bg-transparent font-semibold outline-none" style={{ color: C.text }}>
                        {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                </label>
            </div>

            <div className="flex flex-col gap-[10px] px-[16px] pt-[10px]">
                {tickets.state === 'loading' ? <SkeletonRows rows={3} height={120} gap={10} />
                    : tickets.state === 'error' ? <Card className="p-[14px]"><InlineError onRetry={tickets.retry} /></Card>
                        : list.length === 0 ? (
                            <Card>
                                <EmptyState icon={q ? Search : CheckCircle2}
                                    title={q ? `No ticket matches "${query.trim()}"` : view === 'sla' ? 'Nothing is past SLA' : view === 'unassigned' ? 'Everything has an owner' : all.length === 0 ? 'No tickets yet' : 'Nothing in this view'}
                                    body={q ? 'Try a ticket number, a site or a person.' : all.length === 0 ? 'Tickets your sites raise will show up here.' : undefined}
                                    actionLabel={q ? 'Clear search' : view === 'active' ? 'Raise a ticket' : 'Show active tickets'}
                                    onAction={() => (q ? setQuery('') : view === 'active' ? push({ name: 'newTicket' }) : setView('active'))} />
                            </Card>
                        ) : (
                            <ul className="flex flex-col gap-[10px]" onKeyDown={listKeys} aria-label={`${VIEWS.find(v => v.id === view)!.label} tickets`}>
                                {list.map(t => <li key={t.id}><TicketCard t={t} /></li>)}
                            </ul>
                        )}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------ detail */

export function TicketScreen({ id }: { id: string }) {
    const { m, tickets, back, openSheet, updateTicket, addNote, siteByName, push } = useApp();
    const [note, setNote] = useState('');
    const t = tickets.data?.find(x => x.id === id) ?? null;

    if (tickets.state !== 'ready' || !t) {
        return (
            <div>
                <TopBar title="Ticket" />
                <div className="px-[16px]">
                    {tickets.state === 'loading' ? <SkeletonRows rows={4} height={90} gap={10} />
                        : tickets.state === 'error' ? <Card className="p-[14px]"><InlineError onRetry={tickets.retry} /></Card>
                            : <Card><EmptyState compact title="This ticket is not available" body="It may have been closed and archived, or moved to a site you do not manage." actionLabel="Back to tickets" onAction={back} /></Card>}
                </div>
            </div>
        );
    }

    const s = slaInfo(t, m.now);
    const late = s.breached && !s.done;
    const done = t.status === 'resolved' || t.status === 'closed';
    const site = siteByName(t.site);
    const tech = ORG_TECHS.find(x => x.name === t.assignee);
    const parts = s.minutesLeft !== null ? countdownParts(s.minutesLeft) : null;

    const events = [
        { at: t.raisedAt, text: `Raised by ${t.raisedBy ?? 'someone'}${t.company ? `, ${t.company}` : ''}` },
        ...t.escalations.map(e => ({ at: e.at, text: `Escalated to ${e.to === 'You' ? 'you' : e.to ?? 'a manager'}` })),
        ...(t.resolvedAt ? [{ at: t.resolvedAt, text: `Resolved by ${t.assignee ?? 'the team'}` }] : []),
        ...t.notes.map(n => ({ at: n.at, text: `You: ${n.text}` })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    const send = () => { const text = note.trim(); if (!text) return; addNote(t.id, text); setNote(''); };

    const actions = done
        ? <PrimaryButton icon={RotateCcw} className="w-full" onClick={() => updateTicket(t.id, { status: t.assignee ? 'assigned' : 'open' }, `${t.number} reopened.`)}>Reopen ticket</PrimaryButton>
        : !t.assignee
            ? <PrimaryButton icon={UserPlus} className="w-full" onClick={() => openSheet({ kind: 'assign', id: t.id })}>Assign a technician</PrimaryButton>
            : (
                <div className="grid grid-cols-2 gap-[8px]">
                    <GhostButton icon={Users} onClick={() => openSheet({ kind: 'assign', id: t.id })}>Reassign</GhostButton>
                    {t.status === 'waitlist'
                        ? <PrimaryButton icon={ArrowUpRight} onClick={() => updateTicket(t.id, { status: 'assigned' }, `${t.number} is back in the active queue.`)}>Resume</PrimaryButton>
                        : <PrimaryButton icon={CheckCircle2} onClick={() => updateTicket(t.id, { status: 'resolved' }, `${t.number} marked resolved.`)}>Resolve</PrimaryButton>}
                </div>
            );

    return (
        <div className="flex min-h-full flex-col">
            <TopBar title={t.number} right={t.assignee && (
                <button type="button" onClick={() => m.previewAction(`Call ${t.assignee}`)} aria-label={`Call ${t.assignee}`} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: C.card }}><Phone className="h-[18px] w-[18px]" aria-hidden /></button>
            )} />
            <div className="flex flex-col gap-[10px] px-[16px]">
                <Card className="p-[16px]">
                    <div className="flex flex-wrap items-center gap-[6px]">
                        <PriorityTag priority={t.priority} /><StatusTag status={t.status} />
                        {t.category && <Tag tone="plain">{t.category}</Tag>}
                        {t.escalationLevel > 0 && <Tag tone="tint" icon={ArrowUpRight}>Escalated to you</Tag>}
                        <Sample feed={tickets} />
                    </div>
                    <p className="mt-[10px] text-[20px] font-bold leading-snug tracking-[-0.02em]">{t.title}</p>
                    <button type="button" onClick={() => site && push({ name: 'site', id: site.id })} disabled={!site}
                        className="mt-[6px] flex items-center gap-[5px] text-left text-[13px] font-semibold" style={{ color: site ? C.accentDeep : C.text3 }}>
                        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{t.site}{t.location ? `, ${t.location}` : ''}
                    </button>
                    {t.description && <p className="mt-[10px] text-[13.5px] leading-relaxed" style={{ color: C.text2 }}>{t.description}</p>}
                </Card>

                <Card className="p-[16px]" style={late ? { boxShadow: `inset 0 0 0 1.5px ${C.red}` } : undefined}>
                    <p className="flex items-center justify-between text-[13px] font-semibold" style={{ color: C.text2 }}>
                        <span>SLA{t.slaHours ? `, ${t.slaHours} h to fix` : ''}</span>
                        {s.due && !done && <span className="tabular-nums">{late ? 'Was due' : 'Due'} {s.due.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>}
                    </p>
                    {t.status === 'waitlist' ? (
                        <p className="mt-[8px] text-[15px] font-bold">Paused while it waits{t.hasMaterialRequest ? ' for material' : ''}</p>
                    ) : done ? (
                        <p className="mt-[8px] flex items-center gap-[8px] text-[22px] font-bold"><CheckCircle2 className="h-6 w-6" style={{ color: C.accentDeep }} aria-hidden />{s.label === 'Met' ? 'Met the SLA' : 'Closed after the SLA'}</p>
                    ) : parts ? (
                        <>
                            <p className="mt-[6px] flex items-end gap-[8px]" style={{ color: late ? C.redText : C.text }}>
                                <span className="text-[52px] leading-[0.95]" style={fig}>{parts.h}h {parts.m}m</span>
                                <span className="pb-[6px] text-[13px] font-bold">{late ? 'overdue' : 'left'}</span>
                            </p>
                            <span className="mt-[12px] block h-[10px] rounded-full" style={{ background: C.track }} role="meter" aria-label="SLA used" aria-valuenow={Math.round(s.used * 100)} aria-valuemin={0} aria-valuemax={100}
                                title={`${Math.round(s.used * 100)}% of the SLA window used`}>
                                <span className="block h-full rounded-full" style={{ width: `${Math.min(100, s.used * 100)}%`, background: late ? C.red : C.accent }} />
                            </span>
                            {late && <p className="mt-[8px] flex items-center gap-[6px] text-[12.5px] font-semibold" style={{ color: C.redText }}><Siren className="h-3.5 w-3.5" aria-hidden />Past SLA by {duration(Math.abs(s.minutesLeft ?? 0))}</p>}
                        </>
                    ) : <p className="mt-[8px] text-[14px]" style={{ color: C.text2 }}>No SLA on this ticket.</p>}
                </Card>

                <Card className="flex items-center gap-[12px] p-[14px]">
                    <Avatar name={t.assignee} size={44} />
                    <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-bold">{t.assignee ?? 'Nobody is on this yet'}</span>
                        <span className="block text-[12px]" style={{ color: C.text3 }}>{tech ? `${tech.skill}, ${tech.shift === 'free' ? 'free now' : tech.shift === 'on_a_ticket' ? 'on another ticket' : 'off shift'}` : t.assignee ? 'Technician' : 'Assign someone so the clock has an owner'}</span>
                    </span>
                    {t.assignee && !done && <button type="button" onClick={() => openSheet({ kind: 'assign', id: t.id })} className="inline-flex h-10 items-center rounded-full px-[12px] text-[12.5px] font-bold" style={{ background: C.track, color: C.accentDeep }}>Change</button>}
                </Card>

                <Card className="p-[16px]">
                    <p className="mb-[10px] text-[14px] font-bold">Activity</p>
                    <ol className="flex flex-col">
                        {events.map((e, i) => (
                            <li key={`${e.at.getTime()}-${i}`} className="flex gap-[12px]">
                                <span className="flex flex-col items-center">
                                    <span className="mt-[4px] h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: i === events.length - 1 ? C.accent : C.muted }} />
                                    {i < events.length - 1 && <span className="w-[2px] flex-1" style={{ background: C.track }} />}
                                </span>
                                <span className="min-w-0 pb-[12px]">
                                    <span className="block text-[13.5px] font-semibold">{e.text}</span>
                                    <span className="block text-[12px]" style={{ color: C.text3 }}>{sinceLabel(m.now, e.at)}</span>
                                </span>
                            </li>
                        ))}
                    </ol>
                    <div className="mt-[4px] flex items-center gap-[8px] rounded-full py-[4px] pl-[14px] pr-[4px]" style={{ background: C.track }}>
                        <label className="min-w-0 flex-1">
                            <span className="sr-only">Add a note for the team</span>
                            <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="Add a note for the team"
                                className="h-10 w-full bg-transparent text-[13.5px] outline-none placeholder:text-[color:var(--cb-placeholder)]" />
                        </label>
                        <button type="button" onClick={send} disabled={!note.trim()} aria-label="Send note" className="grid h-10 w-10 shrink-0 place-items-center rounded-full disabled:opacity-40" style={{ background: C.accent, color: C.onAccent }}>
                            <Send className="h-4 w-4" aria-hidden />
                        </button>
                    </div>
                </Card>
            </div>

            <div className="sticky bottom-0 z-10 mt-auto px-[16px] pb-[8px] pt-[14px]" style={{ background: `linear-gradient(180deg, transparent 0%, ${C.page} 35%)` }}>{actions}</div>
        </div>
    );
}

/* ------------------------------------------------------------- raise */

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent', 'critical'];

/** A field error: ink with an icon, since red is kept for SLA. Shows once the form was tried. */
function Err({ tried, show, children }: { tried: boolean; show: boolean; children: React.ReactNode }) {
    if (!tried || !show) return null;
    return <p role="alert" className="mt-[6px] flex items-center gap-[6px] text-[12.5px] font-semibold" style={{ color: C.text }}><AlertCircle className="h-3.5 w-3.5" aria-hidden />{children}</p>;
}

export function NewTicketScreen({ initialSite }: { initialSite?: string }) {
    const { m, raiseTicket, replace, notify } = useApp();
    const sites = (m.sites.data ?? []).map(s => s.name);
    const [site, setSite] = useState<string | null>(initialSite ?? null);
    const [category, setCategory] = useState<string | null>(null);
    const [priority, setPriority] = useState<Priority>('medium');
    const [title, setTitle] = useState('');
    const [location, setLocation] = useState('');
    const [description, setDescription] = useState('');
    const [assignee, setAssignee] = useState<string | null>(null);
    const [tried, setTried] = useState(false);
    const titleRef = useRef<HTMLInputElement>(null);
    const errors = { site: !site, category: !category, title: title.trim().length < 4 };
    const techs = [...ORG_TECHS].sort((a, b) => Number(b.skill === category) - Number(a.skill === category) || (a.shift === 'free' ? -1 : 1) - (b.shift === 'free' ? -1 : 1));

    const submit = () => {
        setTried(true);
        if (errors.site || errors.category || errors.title) {
            if (errors.title && !errors.site && !errors.category) titleRef.current?.focus();
            return;
        }
        const id = raiseTicket({ site: site!, category: category!, priority, title: title.trim(), location: location.trim(), description: description.trim(), assignee });
        replace({ name: 'ticket', id });
        notify('Ticket raised. Preview only, nothing was saved.');
    };

    const chip = (on: boolean) => (on ? { background: C.ink, color: C.onInk } : { background: C.card, color: C.text2, boxShadow: `inset 0 0 0 1px ${C.border}` });

    return (
        <div className="flex min-h-full flex-col">
            <TopBar title="Raise a ticket" />
            <form className="flex flex-col" onSubmit={e => { e.preventDefault(); submit(); }} noValidate>
                <Section title="Site" className="pt-[6px]">
                    <div role="radiogroup" aria-label="Site" className="flex flex-wrap gap-[6px]">
                        {sites.map(s => <button key={s} type="button" role="radio" aria-checked={site === s} onClick={() => setSite(s)} className="inline-flex h-10 items-center rounded-full px-[14px] text-[13px] font-semibold" style={chip(site === s)}>{s}</button>)}
                        {sites.length === 0 && <p className="text-[13px]" style={{ color: C.text2 }}>Sites are still loading.</p>}
                    </div>
                    <Err tried={tried} show={errors.site}>Pick the site this is at.</Err>
                </Section>

                <Section title="What kind of problem">
                    <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-[6px]">
                        {TICKET_CATEGORIES.map(c => <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)} className="inline-flex h-10 items-center rounded-full px-[14px] text-[13px] font-semibold" style={chip(category === c)}>{c}</button>)}
                    </div>
                    <Err tried={tried} show={errors.category}>Pick a category so the right team sees it.</Err>
                </Section>

                <Section title="How urgent">
                    <div role="radiogroup" aria-label="Priority" className="grid grid-cols-5 gap-[4px] rounded-full p-[4px]" style={{ background: C.card }}>
                        {PRIORITIES.map(pr => {
                            const Icon = PRIORITY_META[pr].icon;
                            return (
                                <button key={pr} type="button" role="radio" aria-checked={priority === pr} onClick={() => setPriority(pr)}
                                    className="flex h-12 flex-col items-center justify-center gap-[2px] rounded-full text-[11px] font-bold" style={priority === pr ? { background: C.ink, color: C.onInk } : { color: C.text2 }}>
                                    <Icon className="h-3.5 w-3.5" aria-hidden />{PRIORITY_META[pr].label}
                                </button>
                            );
                        })}
                    </div>
                    <p className="mt-[8px] flex items-center gap-[6px] text-[12.5px]" style={{ color: C.text3 }}><Clock className="h-3.5 w-3.5" aria-hidden />{PRIORITY_META[priority].label} tickets must be fixed within {SLA_HOURS[priority]} hours.</p>
                </Section>

                <Section title="Details">
                    <Card className="flex flex-col p-[4px]">
                        <label className="block rounded-[18px] px-[12px] py-[8px]" style={tried && errors.title ? { boxShadow: `inset 0 0 0 2px ${C.text}` } : undefined}>
                            <span className="flex justify-between text-[11.5px] font-semibold" style={{ color: C.text3 }}>What is wrong<span className="tabular-nums">{title.length}/80</span></span>
                            <input ref={titleRef} value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder="e.g. AC not cooling in Conference Room 3" aria-invalid={tried && errors.title}
                                className="h-9 w-full bg-transparent text-[14.5px] font-semibold outline-none placeholder:font-normal placeholder:text-[color:var(--cb-placeholder)]" />
                        </label>
                        <span aria-hidden className="mx-[12px] h-px" style={{ background: C.border }} />
                        <label className="block px-[12px] py-[8px]">
                            <span className="block text-[11.5px] font-semibold" style={{ color: C.text3 }}>Where exactly</span>
                            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Floor 4, near the pantry" className="h-9 w-full bg-transparent text-[14px] outline-none placeholder:text-[color:var(--cb-placeholder)]" />
                        </label>
                        <span aria-hidden className="mx-[12px] h-px" style={{ background: C.border }} />
                        <label className="block px-[12px] py-[8px]">
                            <span className="block text-[11.5px] font-semibold" style={{ color: C.text3 }}>More detail (optional)</span>
                            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What you saw, since when, anything already tried" className="mt-[4px] w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-[color:var(--cb-placeholder)]" />
                        </label>
                    </Card>
                    <Err tried={tried} show={errors.title}>Say what is wrong in a few words.</Err>
                    <button type="button" onClick={() => m.previewAction('Add a photo')} className="mt-[10px] inline-flex h-11 items-center gap-[8px] rounded-full px-[16px] text-[13px] font-bold" style={{ background: C.card, color: C.accentDeep, boxShadow: `inset 0 0 0 1px ${C.border}` }}>
                        <Camera className="h-4 w-4" aria-hidden />Add a photo
                    </button>
                </Section>

                <Section title="Assign now" right={<span className="text-[12px]" style={{ color: C.text3 }}>optional</span>}>
                    <div role="radiogroup" aria-label="Assign to" className="lab-scroll-x -mx-[16px] flex gap-[8px] overflow-x-auto px-[16px]">
                        {[null, ...techs.map(x => x.name)].map(name => {
                            const tech = ORG_TECHS.find(x => x.name === name);
                            const on = assignee === name;
                            return (
                                <button key={name ?? 'later'} type="button" role="radio" aria-checked={on} onClick={() => setAssignee(name)}
                                    className="flex w-[104px] shrink-0 flex-col items-center gap-[6px] rounded-[18px] px-[8px] py-[12px] text-center" style={{ background: C.card, boxShadow: on ? `inset 0 0 0 2px ${C.accent}` : `inset 0 0 0 1px ${C.border}` }}>
                                    <Avatar name={name} size={36} />
                                    <span className="w-full truncate text-[12.5px] font-bold">{name ?? 'Decide later'}</span>
                                    <span className="text-[11px]" style={{ color: C.text3 }}>{tech ? `${tech.skill}${tech.skill === category ? ', best fit' : ''}` : 'Stays open'}</span>
                                </button>
                            );
                        })}
                    </div>
                </Section>

                <div className="sticky bottom-0 z-10 mt-[18px] px-[16px] pb-[8px] pt-[14px]" style={{ background: `linear-gradient(180deg, transparent 0%, ${C.page} 35%)` }}>
                    <PrimaryButton icon={Send} className="w-full" onClick={submit}>Raise ticket</PrimaryButton>
                </div>
            </form>
        </div>
    );
}

/* ------------------------------------------------------- assign sheet */

export function AssignSheet({ id }: { id: string }) {
    const { tickets, closeSheet, updateTicket } = useApp();
    const t = tickets.data?.find(x => x.id === id) ?? null;
    const [pick, setPick] = useState<string | null>(t?.assignee ?? null);
    if (!t) return <SheetFrame title="Assign" onClose={closeSheet}><p className="py-[16px] text-[13px]" style={{ color: C.text2 }}>This ticket is no longer available.</p></SheetFrame>;

    const load = (name: string) => (tickets.data ?? []).filter(x => x.assignee === name && ACTIVE.includes(x.status)).length;
    const techs = [...ORG_TECHS].sort((a, b) => Number(b.skill === t.category) - Number(a.skill === t.category)
        || ['free', 'on_a_ticket', 'off_shift'].indexOf(a.shift) - ['free', 'on_a_ticket', 'off_shift'].indexOf(b.shift) || load(a.name) - load(b.name));
    const changed = pick !== t.assignee;
    const confirm = () => {
        if (!pick) return;
        updateTicket(t.id, { assignee: pick, status: t.status === 'open' ? 'assigned' : t.status }, `${pick} now owns ${t.number}.`);
        closeSheet();
    };

    return (
        <SheetFrame title={t.assignee ? `Reassign ${t.number}` : `Assign ${t.number}`} onClose={closeSheet}
            footer={<PrimaryButton icon={UserPlus} className="w-full" disabled={!pick || !changed} onClick={confirm}>{pick && changed ? `Assign to ${pick}` : 'Pick a technician'}</PrimaryButton>}>
            <p className="text-[13.5px]" style={{ color: C.text2 }}>{t.title}, {t.site}. Best fits for {t.category ?? 'this job'} come first.</p>
            <div role="radiogroup" aria-label="Technician" className="mt-[12px] flex flex-col gap-[8px]">
                {techs.map((x, i) => {
                    const on = pick === x.name;
                    const n = load(x.name);
                    return (
                        <button key={x.name} type="button" role="radio" aria-checked={on} onClick={() => setPick(x.name)}
                            className={cx('flex min-h-[64px] items-center gap-[12px] rounded-[18px] px-[12px] py-[10px] text-left', x.shift === 'off_shift' && 'opacity-70')}
                            style={{ background: C.card, boxShadow: on ? `inset 0 0 0 2px ${C.accent}` : `inset 0 0 0 1px ${C.border}` }}>
                            <Avatar name={x.name} size={40} />
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-[6px] text-[14px] font-bold">{x.name}{x.name === t.assignee && <Tag tone="plain">Current</Tag>}{i === 0 && x.skill === t.category && x.name !== t.assignee && <Tag>Best fit</Tag>}</span>
                                <span className="block text-[12px]" style={{ color: C.text3 }}>{x.skill} · {x.shift === 'free' ? 'Free now' : x.shift === 'on_a_ticket' ? 'On a ticket' : 'Off shift'} · {n} open</span>
                            </span>
                            <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${on ? C.accent : C.muted}` }}>
                                {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.accent }} />}
                            </span>
                        </button>
                    );
                })}
            </div>
        </SheetFrame>
    );
}
