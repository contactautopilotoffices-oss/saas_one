'use client';

import React, { useEffect, useState } from 'react';
import { CalendarClock, Layers, Mail, MapPin, Users } from 'lucide-react';
import { findStage, unlistedStage } from '@/backend/lib/candidates/stage-list';
import { INTERVIEW_STATUS_LABELS, type Interview, type Position, type PositionMember } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate } from './format';
import { StageChip, useStages } from './stage-ui';
import { Avatar, CopyButton, LABEL, ScoreTag, Spinner, Tag, WELL } from './ui';

/*
 * Owner 2026-11-25: beside an email that is linked to a candidate, where that person stands: the positions they are in
 * with the stage in each, and their interviews (upcoming first). So HR can answer without leaving the email. Read-only;
 * it uses the same lists as the candidate's own panel. Laid out as the inbox's right-hand pane: who (with the email
 * address of the message party as the only contact shown — nothing else is fetched), applied for, interview schedule.
 */

/** A small uppercase section label (the inbox's group headings). */
export const CAPS = 'text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary';

/** The round initials badge beside a person in the inbox, from the shared Avatar. */
export function InitialsAvatar({ name }: { name: string }) {
    return <Avatar name={name} size="md" />;
}

type Membership = { member: Omit<PositionMember, 'record'>; position: Pick<Position, 'id' | 'title' | 'location' | 'status'> };

/** "2026-11-21T11:00" (India time, as the form gave it) → its parts for the date block: "Sat", "21", "Nov", "11:00 am". */
function whenParts(at: string) {
    const [d, t = ''] = at.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh = 0, mm = 0] = t.split(':').map(Number);
    const date = new Date(Date.UTC(y, (m || 1) - 1, day || 1, hh, mm));
    const f = (o: Intl.DateTimeFormatOptions) => date.toLocaleString('en-IN', { ...o, timeZone: 'UTC' });
    return { weekday: f({ weekday: 'short' }), day: f({ day: 'numeric' }), month: f({ month: 'short' }), time: f({ hour: 'numeric', minute: '2-digit' }) };
}

const MODE_LABELS: Record<string, string> = { online: 'Online', in_person: 'In person', video: 'Video', phone: 'Phone' };

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
    return (
        <section className="border-t border-border px-4 py-4" aria-label={title}>
            <h4 className={`${LABEL} mb-2 flex items-center gap-x-1.5`}><Icon className="h-3.5 w-3.5" aria-hidden />{title}</h4>
            {children}
        </section>
    );
}

export default function EmailCandidateContext({ orgId, candidateId, contact }: {
    orgId: string; candidateId: string;
    /** The email's other party (the candidate): their name when the email gave one, and the address. */
    contact: { name: string; address: string; label: string; initialsOf: string };
}) {
    const stages = useStages(orgId)?.stages ?? [];
    const [data, setData] = useState<{ id: string; memberships: Membership[] | null; interviews: Interview[] | null; nowLocal: string } | null>(null);

    useEffect(() => {
        const ctrl = new AbortController();
        void Promise.all([
            api<{ memberships: Membership[] }>(`/api/candidates/${encodeURIComponent(candidateId)}/positions${qs({ orgId, by: 'candidate' })}`, { signal: ctrl.signal }),
            api<{ interviews: Interview[] }>(`/api/candidates/interviews${qs({ orgId, candidateId })}`, { signal: ctrl.signal }),
        ]).then(([m, iv]) => {
            if (ctrl.signal.aborted) return;
            // Now, in India time as the interviews are written ("2026-11-21T11:00"), to put the upcoming ones first.
            setData({ id: candidateId, memberships: m.ok ? m.data.memberships : null, interviews: iv.ok ? iv.data.interviews : null, nowLocal: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16) });
        });
        return () => ctrl.abort();
    }, [orgId, candidateId]);

    const loaded = data?.id === candidateId ? data : null;
    const todayLocal = loaded?.nowLocal ?? '';
    const interviews = [...(loaded?.interviews ?? [])].filter(i => i.status !== 'cancelled')
        .sort((a, b) => Number(b.at >= todayLocal) - Number(a.at >= todayLocal) || (a.at >= todayLocal ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)))
        .slice(0, 4);
    // When they first joined a position here: the closest thing to "applied on" the data has.
    const firstAdded = loaded?.memberships?.map(x => x.member.addedAt).filter(Boolean).sort()[0];

    return (
        <div className="min-w-0">
            <header className="flex min-w-0 items-center gap-x-3 px-4 py-4">
                <Avatar name={contact.initialsOf} size="lg" />
                <div className="min-w-0">
                    <p className="truncate font-display text-base font-semibold text-text-primary" title={contact.label}>{contact.label}</p>
                    <p className="text-xs text-text-secondary">{firstAdded ? `In hiring since ${formatDate(firstAdded)}` : 'Linked candidate'}</p>
                </div>
            </header>

            <Section icon={Mail} title="Contact">
                <div className="inline-flex h-8 max-w-full items-center gap-x-1.5 rounded-full bg-surface-elevated pl-3 pr-0.5 text-xs font-medium text-text-primary ring-1 ring-inset ring-border">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                    <span className="min-w-0 truncate" title={contact.address}>{contact.address}</span>
                    <CopyButton value={contact.address} label="email address" />
                </div>
            </Section>

            {!loaded ? (
                <p className="flex items-center gap-x-2 border-t border-border px-4 py-4 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading the candidate</p>
            ) : !loaded.memberships && !loaded.interviews ? (
                <p className="border-t border-border px-4 py-4 text-sm text-text-secondary">Could not load this candidate’s positions and interviews.</p>
            ) : <>
                <Section icon={Layers} title="Applied for">
                    {loaded.memberships?.length ? (
                        <ul className="space-y-2">
                            {loaded.memberships.map(({ member, position }) => (
                                <li key={member.id} className={`${WELL} min-w-0 px-3 py-3`}>
                                    <p className="break-words text-sm font-semibold text-text-primary">{position.title}</p>
                                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-text-secondary">
                                        {position.location && <><MapPin className="h-3 w-3 shrink-0" aria-hidden />{position.location} ·</>}
                                        <span>{position.status === 'closed' ? 'Closed' : 'Open'}</span>
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
                                        <StageChip stage={findStage(stages, member.stage) ?? unlistedStage(member.stage)} />
                                        <ScoreTag score={member.score} />
                                    </div>
                                    <p className="mt-2 text-xs text-text-tertiary">Added {formatDate(member.addedAt)} · in this stage since {formatDate(member.stageChangedAt)}</p>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-sm text-text-tertiary">Not in any position yet.</p>}
                </Section>

                <Section icon={CalendarClock} title="Interview schedule">
                    {interviews.length ? (
                        <ul className="space-y-3">
                            {interviews.map(i => {
                                const w = whenParts(i.at);
                                const upcoming = i.at >= todayLocal;
                                const where = [i.mode ? MODE_LABELS[i.mode] ?? i.mode : null, i.venue].filter(Boolean).join(' · ');
                                return (
                                    <li key={i.id} className="flex min-w-0 gap-x-3">
                                        <span className={`${WELL} flex w-12 shrink-0 flex-col items-center justify-center py-1.5 text-center ${upcoming ? 'ring-1 ring-inset ring-primary/30' : ''}`} aria-hidden>
                                            <span className="text-[10px] font-medium uppercase text-text-tertiary">{w.weekday}</span>
                                            <span className="font-display text-lg font-bold leading-tight text-text-primary tabular-nums">{w.day}</span>
                                            <span className="text-[10px] font-medium text-text-secondary">{w.month}</span>
                                        </span>
                                        <div className="min-w-0 flex-1 text-xs">
                                            <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                                                <span className="truncate text-sm font-semibold text-text-primary">{i.round ?? 'Interview'}</span>
                                                {i.status && i.status !== 'scheduled' ? <Tag>{INTERVIEW_STATUS_LABELS[i.status]}</Tag> : !upcoming ? <Tag>Past</Tag> : null}
                                            </p>
                                            <p className="text-text-secondary"><span className="sr-only">{w.weekday} {w.day} {w.month}, </span>{w.time}{where ? ` · ${where}` : ''}</p>
                                            {i.interviewers && <p className="flex min-w-0 items-center gap-x-1 text-text-secondary"><Users className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate" title={i.interviewers}>{i.interviewers}</span></p>}
                                            {i.positionTitle && <p className="truncate text-text-tertiary">{i.positionTitle}</p>}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : <p className="text-sm text-text-tertiary">No interviews booked.</p>}
                </Section>
            </>}
        </div>
    );
}
