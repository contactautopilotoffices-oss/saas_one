'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { CalendarClock, Check, Copy, MessageCircle, Mic, Search, Video, X } from 'lucide-react';
import { boardColumns, columnIndexOf, findStage, stageGroups, type StageDef } from '@/backend/lib/candidates/stage-list';
import { INTERVIEW_MODE_LABELS, INTERVIEW_MODES, INTERVIEW_STATUS_LABELS, RECOMMENDATION_LABELS, type CandidateRecord, type Interview, type InterviewMode, type InterviewSend, type Position, type PositionMember } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import CallInsightsView from './CallInsightsView';
import { CandidateOffers } from './OffersView';
import { REMARK_MAX } from './Remarks';
import { StageOptions } from './stage-ui';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL, Spinner, useUi, WELL } from './ui';

// The Meeting Assistant's call and recorder, loaded only when opened (they bring the video library with them).
const VideoCall = dynamic(() => import('@/frontend/components/task-manager/meetings/VideoCall'), { ssr: false });
const MeetingRecorder = dynamic(() => import('@/frontend/components/task-manager/meetings/MeetingRecorder'), { ssr: false });
const MeetingReview = dynamic(() => import('@/frontend/components/task-manager/meetings/MeetingReview'), { ssr: false });

/*
 * Schedule interview (owner 2026-11-19; HRMS meeting: "generate meeting links directly within the platform", "both
 * physical and online meeting scheduling in one flow", invites "also sent to the respective hiring managers,
 * potentially via WhatsApp copy-link sharing"). Online makes the Meeting Assistant's video call (one link for
 * everyone); in person names the venue (owner: no hybrid). Invites go only where HR ticks.
 * Owner 2026-11-19, "it must be within the recruitment tab": the candidate's Interviews tab (InterviewsList) joins the
 * call ("Join call") and records an in-person interview ("Record interview") over the Recruitment page, and shows the
 * notes after; HR never goes to the Meeting Assistant, where these meetings are not listed.
 */

interface Person { id: string; name: string; department?: string | null }

/** Tomorrow at 11:00, local, as a datetime-local input wants it. */
function tomorrowAt11(): string {
    const d = new Date(Date.now() + 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T11:00`;
}

/** "L1 · Hiring Manager" -> "L1": the round's short name, from the column the person is in. */
function roundFor(stages: StageDef[], stageKey: string): string {
    const at = columnIndexOf(stages, stageKey);
    const column = at >= 0 ? boardColumns(stages, s => s.key === stageKey)[at]?.name : null;
    return (column ?? 'Interview').split(' · ')[0].trim().slice(0, 60);
}

/** "Fri, 21 Nov, 11:00 am": the form's India time, shown back. */
export function interviewWhen(local: string): string {
    const d = new Date(`${local}:00+05:30`);
    if (!Number.isFinite(d.getTime())) return local;
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function CopyLink({ url, text }: { url: string; text: string }) {
    const { notify } = useUi();
    const copy = async () => {
        try { await navigator.clipboard.writeText(url); notify('Link copied', 'success'); } catch { notify('Copy did not work: select the link and copy it.', 'error'); }
    };
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="The interview's link" className={`${INPUT} h-9 min-w-0 flex-1 font-mono text-xs`} />
            <button type="button" onClick={() => void copy()} className={`${BTN_SECONDARY} h-9 px-3`}><Copy className="h-4 w-4" />Copy</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`} target="_blank" rel="noreferrer" className={`${BTN_SECONDARY} h-9 px-3`}><MessageCircle className="h-4 w-4" />Share on WhatsApp</a>
        </div>
    );
}

export function ScheduleInterviewForm({ orgId, record, position, member, stages, onCancel, onSaved }: {
    orgId: string; record: CandidateRecord; position: Position; member: PositionMember; stages: StageDef[];
    onCancel: () => void;
    /** The interview was made (the history and the board refetch). `moved` is the stage's name when they were moved too. */
    onSaved: (moved: string | null) => void;
}) {
    const { notify, reportError } = useUi();
    const [round, setRound] = useState(() => roundFor(stages, member.stage));
    const [at, setAt] = useState(tomorrowAt11);
    const [mode, setMode] = useState<InterviewMode>('online');
    const [venue, setVenue] = useState('');
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState('');
    const [note, setNote] = useState('');
    const [moveTo, setMoveTo] = useState('');
    const canWhatsApp = !!record.phone && !record.blacklisted;
    const canEmail = !!record.email && !record.blacklisted;
    const [toWhatsApp, setToWhatsApp] = useState(canWhatsApp);
    const [toEmail, setToEmail] = useState(canEmail);
    const [toInterviewers, setToInterviewers] = useState(true);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<{ interview: Interview; sent: InterviewSend[]; moved: string | null } | null>(null);

    const [people, setPeople] = useState<Person[] | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ people: Person[] }>(`/api/candidates/interviews${qs({ orgId, people: '1' })}`, { signal: ctrl.signal }).then(res => {
            if (!ctrl.signal.aborted) setPeople(res.ok ? res.data.people : []);
        });
        return () => ctrl.abort();
    }, [orgId]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = people ?? [];
        return (q ? list.filter(p => p.name.toLowerCase().includes(q) || (p.department ?? '').toLowerCase().includes(q)) : list).slice(0, 50);
    }, [people, query]);
    const choices = stageGroups(stages).map(g => ({ ...g, stages: g.stages.filter(x => x.key !== member.stage && !x.needsRemark) })).filter(g => g.stages.length);
    const first = record.fullName.split(' ')[0];

    const save = async () => {
        if (!at || !round.trim() || busy) return;
        setBusy(true);
        const res = await api<{ interview: Interview; sent: InterviewSend[] }>('/api/candidates/interviews', {
            json: {
                orgId, applicationId: record.id, positionId: position.id, round: round.trim(), at, mode,
                ...(venue.trim() ? { venue: venue.trim() } : {}), interviewerIds: [...picked], ...(note.trim() ? { note: note.trim() } : {}),
                ...(moveTo ? { moveTo } : {}), notify: { whatsapp: toWhatsApp && canWhatsApp, email: toEmail && canEmail, interviewers: toInterviewers },
            },
        });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        const moved = moveTo ? findStage(stages, moveTo)?.name ?? null : null;
        setDone({ ...res.data, moved });
        onSaved(moved);
    };

    if (done) {
        const failed = done.sent.filter(s => !s.ok);
        return (
            <div className={`${WELL} mt-3 space-y-3 px-3 py-3`}>
                <p className="flex items-center gap-x-2 text-sm font-semibold text-text-primary"><Check className="h-4 w-4 text-green-700" aria-hidden />Interview scheduled: {done.interview?.round ?? round}, {interviewWhen(at)}{done.moved ? ` · moved to ${done.moved}` : ''}</p>
                {done.interview?.joinUrl && (
                    <div>
                        <p className={LABEL}>The link, for everyone: interviewers go straight in, {first} waits to be let in</p>
                        <div className="mt-1.5"><CopyLink url={done.interview.joinUrl} text={`Interview: ${record.fullName} · ${done.interview.round ?? round} · ${position.title} · ${interviewWhen(at)}`} /></div>
                    </div>
                )}
                {done.sent.length > 0 && (
                    <ul className="space-y-1">
                        {done.sent.map((s, i) => (
                            <li key={i} className="flex items-start gap-x-2 text-sm">
                                {s.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden />}
                                <span className="text-text-primary">{s.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} to {s.name}{s.to === 'interviewer' ? ' (interviewer)' : ''}{s.ok ? ' sent' : ' not sent'}{s.note ? <span className="text-text-secondary">: {s.note}</span> : null}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {failed.length > 0 && <p className="text-xs text-text-secondary">Share the link above by hand where a message did not go.</p>}
                <div className="flex justify-end"><button type="button" onClick={onCancel} className={BTN_PRIMARY}>Done</button></div>
            </div>
        );
    }

    return (
        <div className={`${WELL} mt-3 px-3 py-3`}>
            <p className="flex items-center gap-x-2 text-sm font-semibold text-text-primary"><CalendarClock className="h-4 w-4 text-text-tertiary" aria-hidden />Schedule an interview</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-medium text-text-secondary">Round
                    <input value={round} onChange={e => setRound(e.target.value)} maxLength={60} placeholder="L1" className={`${INPUT} mt-1`} />
                </label>
                <label className="block text-xs font-medium text-text-secondary">When (India time)
                    <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} className={`${INPUT} mt-1`} />
                </label>
            </div>
            <div role="radiogroup" aria-label="How" className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {INTERVIEW_MODES.map(m => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                        className={`${BTN_SECONDARY} h-auto min-h-10 justify-start whitespace-normal px-3 py-2 text-left text-xs ${mode === m ? 'ring-[1.5px] ring-inset ring-primary' : ''}`}>
                        {m === 'online' ? <Video className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden />}{INTERVIEW_MODE_LABELS[m]}
                    </button>
                ))}
            </div>
            <p className="mt-1 text-xs text-text-tertiary">
                {mode === 'online'
                    ? 'Makes a video call with one link. Join it from the candidate’s Interviews tab; interviewers go straight in, the candidate waits until someone in the call lets them in. Recorded, and the notes show in the Interviews tab.'
                    : 'No video call. When it starts, press “Record interview” in the candidate’s Interviews tab; the notes show there after.'}
            </p>
            {mode === 'in_person' && (
                <label className="mt-2 block text-xs font-medium text-text-secondary">Where
                    <input value={venue} onChange={e => setVenue(e.target.value)} maxLength={200} placeholder="e.g. Autopilot Offices, 3rd floor meeting room, Vadodara" className={`${INPUT} mt-1`} />
                </label>
            )}

            <div className="mt-2">
                <p className="text-xs font-medium text-text-secondary">Interviewers {picked.size > 0 && <span className="text-text-tertiary">· {picked.size} picked</span>}</p>
                {picked.size > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                        {[...picked].map(id => {
                            const p = people?.find(x => x.id === id);
                            return <button key={id} type="button" onClick={() => setPicked(s => { const n = new Set(s); n.delete(id); return n; })} className="inline-flex h-7 items-center gap-x-1 rounded-full bg-surface px-2.5 text-xs font-semibold text-text-primary ring-1 ring-inset ring-border hover:ring-error" aria-label={`Remove ${p?.name ?? 'interviewer'}`}>{p?.name ?? '…'}<X className="h-3 w-3" aria-hidden /></button>;
                        })}
                    </div>
                )}
                <div className="relative mt-1.5">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder={people === null ? 'Loading the people…' : 'Search by name or department'} aria-label="Search the interviewers" className={`${INPUT} pl-9`} />
                </div>
                {query.trim() && (
                    <ul className="mt-1 max-h-48 overflow-y-auto rounded-xl bg-surface ring-1 ring-inset ring-border">
                        {shown.map(p => {
                            const on = picked.has(p.id);
                            return (
                                <li key={p.id}>
                                    <button type="button" onClick={() => { setPicked(s => { const n = new Set(s); if (on) n.delete(p.id); else if (n.size < 10) n.add(p.id); return n; }); setQuery(''); }}
                                        className="flex w-full items-center gap-x-2 px-3 py-2 text-left text-sm hover:bg-surface-elevated">
                                        <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-primary bg-primary text-white' : 'border-border'}`}>{on && <Check className="h-3 w-3" />}</span>
                                        <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{p.name}</span>
                                        {p.department && <span className="shrink-0 text-xs text-text-tertiary">{p.department}</span>}
                                    </button>
                                </li>
                            );
                        })}
                        {!shown.length && <li className="px-3 py-2 text-sm text-text-tertiary">Nobody by that name in the Task Manager.</li>}
                    </ul>
                )}
            </div>

            <label className="mt-2 block text-xs font-medium text-text-secondary">Note (optional, for the interviewers and the history)
                <input value={note} onChange={e => setNote(e.target.value)} maxLength={REMARK_MAX} placeholder="What this round should check" className={`${INPUT} mt-1`} />
            </label>
            {choices.length > 0 && (
                <label className="mt-2 block text-xs font-medium text-text-secondary">Also move to (optional)
                    <select value={moveTo} onChange={e => setMoveTo(e.target.value)} className={`${INPUT} mt-1`}>
                        <option value="">Keep at {findStage(stages, member.stage)?.name ?? 'this stage'}</option>
                        <StageOptions groups={choices} />
                    </select>
                </label>
            )}

            <fieldset className="mt-3">
                <legend className="text-xs font-medium text-text-secondary">Send the invite</legend>
                <div className="mt-1 space-y-1">
                    <label className={`flex items-center gap-x-2 text-sm ${canWhatsApp ? 'text-text-primary' : 'text-text-tertiary'}`}>
                        <input type="checkbox" checked={toWhatsApp && canWhatsApp} disabled={!canWhatsApp} onChange={e => setToWhatsApp(e.target.checked)} className="h-4 w-4 accent-primary" />
                        {first} on WhatsApp{!canWhatsApp && <span className="text-xs">· {record.blacklisted ? 'blacklisted' : 'no mobile number'}</span>}
                    </label>
                    <label className={`flex items-center gap-x-2 text-sm ${canEmail ? 'text-text-primary' : 'text-text-tertiary'}`}>
                        <input type="checkbox" checked={toEmail && canEmail} disabled={!canEmail} onChange={e => setToEmail(e.target.checked)} className="h-4 w-4 accent-primary" />
                        {first} by email{!canEmail && <span className="text-xs">· {record.blacklisted ? 'blacklisted' : 'no email address'}</span>}
                    </label>
                    <label className={`flex items-center gap-x-2 text-sm ${picked.size ? 'text-text-primary' : 'text-text-tertiary'}`}>
                        <input type="checkbox" checked={toInterviewers && picked.size > 0} disabled={!picked.size} onChange={e => setToInterviewers(e.target.checked)} className="h-4 w-4 accent-primary" />
                        The interviewers by email{!picked.size && <span className="text-xs">· pick them above</span>}
                    </label>
                </div>
                <p className="mt-1 text-xs text-text-tertiary">You also get the link to copy or share on WhatsApp once it is scheduled.</p>
            </fieldset>

            <div className="mt-3 flex justify-end gap-x-2">
                <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>Cancel</button>
                <button type="button" onClick={() => void save()} disabled={busy || !at || !round.trim() || (mode === 'in_person' && !venue.trim())} className={BTN_PRIMARY}>{busy && <Spinner />}Schedule interview</button>
            </div>
        </div>
    );
}

const STATUS_WORDS: Record<string, string> = {
    scheduled: 'Not started', live: 'In the call now', recording: 'Recording', uploaded: 'Writing the notes', transcribing: 'Writing the notes',
    identifying: 'Writing the notes', extracting: 'Writing the notes', ready: 'Notes ready', failed: 'Not recorded', discarded: 'Meeting deleted', deleted: 'Meeting deleted',
};

/** Over the Recruitment page: the call or the recorder, with nothing else around it. */
function Overlay({ dark, children }: { dark: boolean; children: React.ReactNode }) {
    return <div data-meeting-surface role="dialog" aria-label="Recruitment interview" aria-modal="true" className={`fixed inset-0 z-50 overflow-y-auto ${dark ? 'bg-zinc-950' : 'bg-surface px-4 py-6 sm:py-10'}`}>{children}</div>;
}

/** The candidate's Interviews tab: each interview, Join call / Record interview, its link while it is ahead, its analysis and notes once written. */
export function InterviewsList({ orgId, record, nonce, onRecord }: { orgId: string; record: CandidateRecord; nonce: number; onRecord?: (record: CandidateRecord) => void }) {
    const { notify, reportError } = useUi();
    const [reload, setReload] = useState(0);
    const [retrying, setRetrying] = useState<string | null>(null);
    const [opened, setOpened] = useState<null | { kind: 'call' | 'notes'; meetingId: string } | { kind: 'record'; meetingId: string; title: string; people: { id: string; name: string; department: string | null }[] }>(null);
    const [starting, setStarting] = useState<string | null>(null);
    const close = () => { setOpened(null); setReload(n => n + 1); };
    const retryAnalysis = async (callId: string) => {
        if (retrying) return;
        setRetrying(callId);
        const res = await api(`/api/candidates/calls/${encodeURIComponent(callId)}/retry`, { json: { orgId } });
        setRetrying(null);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        notify('Analysing the interview again', 'info');
        setReload(n => n + 1);
    };
    const [analysisConsentFor, setAnalysisConsentFor] = useState<string | null>(null);
    const record_ = async (i: Interview) => {
        if (starting) return;
        setStarting(i.id);
        const [res, people] = await Promise.all([
            api<{ meetingId: string; title: string }>('/api/candidates/interviews/record', { json: { orgId, candidateId: record.candidateId, interviewId: i.id, analysisConsent: analysisConsentFor === i.id } }),
            api<{ people: Person[] }>(`/api/candidates/interviews${qs({ orgId, people: '1' })}`),
        ]);
        setStarting(null);
        if (!res.ok) { notify(res.error, 'error'); if (res.noAccess) reportError(res); return; }
        setAnalysisConsentFor(null);
        setOpened({ kind: 'record', meetingId: res.data.meetingId, title: res.data.title, people: (people.ok ? people.data.people : []).map(p => ({ id: p.id, name: p.name, department: p.department ?? null })) });
    };
    // `at`: when the list was loaded (the links of interviews more than 3 hours past are not shown)
    const [state, setState] = useState<{ id: string; list: Interview[]; error: string; at: number } | null>(null);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ interviews: Interview[] }>(`/api/candidates/interviews${qs({ orgId, candidateId: record.candidateId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (res.ok) setState({ id: record.candidateId, list: res.data.interviews, error: '', at: Date.now() });
            else { if (res.noAccess) reportError(res); setState({ id: record.candidateId, list: [], error: res.error, at: Date.now() }); }
        });
        return () => ctrl.abort();
    }, [orgId, record.candidateId, nonce, reload, reportError]);
    const list = state?.id === record.candidateId ? state.list : null;
    const processing = list?.some(i =>
        (i.meeting && ['live', 'uploaded', 'transcribing', 'identifying', 'extracting'].includes(i.meeting.status)) ||
        (i.analysis && ['uploaded', 'transcribing', 'analysing'].includes(i.analysis.status)),
    ) ?? false;
    useEffect(() => {
        if (!processing || opened) return;
        const timer = window.setInterval(() => setReload(n => n + 1), 10_000);
        return () => window.clearInterval(timer);
    }, [processing, opened]);
    if (opened?.kind === 'notes') {
        return <Overlay dark={false}><MeetingReview space="hr" meetingId={opened.meetingId} onBack={close} backLabel="Back to candidate"
            onContinueRecording={(meetingId, title) => setOpened({ kind: 'record', meetingId, title, people: [] })} /></Overlay>;
    }
    if (opened?.kind === 'call') {
        return <Overlay dark><VideoCall meetingId={opened.meetingId} onClose={close} notesWhere="in the candidate’s Interviews tab in Recruitment" /></Overlay>;
    }
    if (opened?.kind === 'record') {
        return (
            <Overlay dark={false}>
                <MeetingRecorder space="hr" meetingId={opened.meetingId} title={opened.title} people={opened.people} onDone={close} onBack={close} onDiscarded={close} />
            </Overlay>
        );
    }
    if (list === null) return <p className="flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p>;
    if (state?.error) return <p role="alert" className="text-sm text-error">{state.error}</p>;
    if (!list.length) return <p className="text-sm text-text-tertiary">No interviews yet. Open the candidate from a position&rsquo;s pipeline and use Schedule interview.</p>;
    return (
        <ul className="space-y-2.5">
            {list.map(i => {
                const ahead = Date.parse(`${i.at}:00+05:30`) > (state?.at ?? 0) - 3 * 3_600_000;
                const summary = i.meeting?.summary;
                const analysis = i.analysis ?? null;
                const analysisWorking = analysis && ['uploaded', 'transcribing', 'analysing'].includes(analysis.status);
                const statusLabel = analysis?.status === 'done' && analysis.result
                    ? 'Analysis ready'
                    : analysisWorking
                        ? 'Analysing interview'
                        : analysis?.status === 'failed'
                            ? 'Analysis failed'
                            : i.meeting ? (STATUS_WORDS[i.meeting.status] ?? i.meeting.status) : null;
                const statusTone = analysis?.status === 'done' && analysis.result
                    ? 'text-green-800'
                    : analysis?.status === 'failed' || i.meeting?.status === 'failed'
                        ? 'text-red-800'
                        : i.meeting?.status === 'ready'
                            ? 'text-green-800'
                            : 'text-text-secondary';
                return (
                    <li key={i.id} className={`${CARD} px-4 py-3`}>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold text-text-primary">{i.round ?? 'Interview'} · {interviewWhen(i.at)}</span>
                            <span className="text-xs text-text-secondary">{[i.positionTitle, i.mode && (INTERVIEW_MODE_LABELS as Record<string, string>)[i.mode], i.venue].filter(Boolean).join(' · ')}</span>
                            {statusLabel && <span className={`ml-auto text-xs font-semibold ${statusTone}`}>{statusLabel}</span>}
                        </div>
                        {(i.interviewers || i.byName) && <p className="mt-0.5 text-xs text-text-secondary">{i.interviewers ? `With ${i.interviewers}` : ''}{i.interviewers && i.byName ? ' · ' : ''}{i.byName ? `scheduled by ${i.byName}` : ''}</p>}
                        {i.note && <p className="mt-1 text-xs italic text-text-secondary">“{i.note}”</p>}
                        {i.meetingId && i.meeting && !['scheduled', 'live', 'recording', 'deleted', 'discarded'].includes(i.meeting.status) && (
                            <button type="button" className={`${BTN_SECONDARY} mt-2`} onClick={() => setOpened({ kind: 'notes', meetingId: i.meetingId! })}>Full notes and transcript</button>
                        )}
                        {i.mode === 'online' && i.meetingId && ahead && (!i.meeting || i.meeting.status === 'scheduled' || i.meeting.status === 'live') && (
                            <div className="mt-2.5 space-y-2">
                                <button type="button" onClick={() => setOpened({ kind: 'call', meetingId: i.meetingId! })} className={BTN_PRIMARY}><Video className="h-4 w-4" />{i.meeting?.status === 'live' ? 'Join the call now' : 'Join call'}</button>
                                {i.joinUrl && <CopyLink url={i.joinUrl} text={`Interview: ${record.fullName} · ${i.round ?? ''} · ${interviewWhen(i.at)}`} />}
                            </div>
                        )}
                        {i.mode === 'in_person' && (!i.meeting || ['recording', 'failed', 'deleted', 'discarded'].includes(i.meeting.status)) && (
                            <div className="mt-2.5">
                                <label className="mb-2 flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={analysisConsentFor === i.id} onChange={e => setAnalysisConsentFor(e.target.checked ? i.id : null)} />The candidate agreed to AI analysis of this recorded interview.</label>
                                <button type="button" onClick={() => void record_(i)} disabled={!!starting} className={BTN_PRIMARY}>
                                    {starting === i.id ? <Spinner /> : <Mic className="h-4 w-4" />}{i.meeting?.status === 'recording' ? 'Continue recording' : 'Record interview'}
                                </button>
                                <p className="mt-1 text-xs text-text-tertiary">Press it when the interview starts, with this laptop or phone in the room.</p>
                            </div>
                        )}
                        {analysis?.status === 'failed' && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-error">
                                <span>{analysis.error ?? 'Could not analyse the interview.'}</span>
                                <button type="button" onClick={() => void retryAnalysis(analysis.id)} disabled={retrying === analysis.id} className="font-semibold text-primary-dark hover:underline disabled:opacity-50">
                                    {retrying === analysis.id ? 'Retrying…' : 'Retry analysis'}
                                </button>
                            </div>
                        )}
                        {summary && (
                            <details className="mt-2">
                                <summary className="cursor-pointer text-sm font-semibold text-primary-dark hover:underline">Meeting notes</summary>
                                <div className={`${WELL} mt-2 space-y-2 px-3 py-3 text-sm text-text-primary`}>
                                    <p className="whitespace-pre-line leading-relaxed">{summary.summary}</p>
                                    {summary.decisions.length > 0 && <div><p className={LABEL}>Decisions</p><ol className="mt-1 list-decimal space-y-0.5 pl-5">{summary.decisions.map((d, k) => <li key={k}>{d}</li>)}</ol></div>}
                                    {summary.openQuestions.length > 0 && <div><p className={LABEL}>Open questions</p><ol className="mt-1 list-decimal space-y-0.5 pl-5">{summary.openQuestions.map((d, k) => <li key={k}>{d}</li>)}</ol></div>}
                                </div>
                            </details>
                        )}
                        {analysis?.status === 'done' && analysis.result && (
                            <div className="mt-2">
                                <button type="button" onClick={() => setOpen(o => ({ ...o, [i.id]: !o[i.id] }))} aria-expanded={!!open[i.id]} className="text-sm font-semibold text-primary-dark hover:underline">
                                    {open[i.id] ? 'Hide interview analysis' : 'Read interview analysis'}
                                </button>
                                {open[i.id] && (
                                    <div className="mt-2 space-y-3">
                                        <CallInsightsView
                                            orgId={orgId}
                                            call={analysis}
                                            record={record}
                                            onApplied={(_updated, saved) => { if (saved) onRecord?.(saved); setReload(n => n + 1); }}
                                        />
                                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
                                            <span>Advisory only: the AI never changes a status.</span>
                                            {analysis.language && <><span aria-hidden>·</span><span>{analysis.language}</span></>}
                                            {analysis.model && <><span aria-hidden>·</span><span>Model {analysis.model.replace(/^anthropic:/, '')}</span></>}
                                            <span aria-hidden>·</span>
                                            <button type="button" onClick={() => void retryAnalysis(analysis.id)} disabled={retrying === analysis.id} className="font-semibold text-primary-dark hover:underline disabled:opacity-50">
                                                {retrying === analysis.id ? 'Retrying…' : 'Read it again'}
                                            </button>
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                        <InterviewFollowUp orgId={orgId} interview={i} onChanged={() => setReload(n => n + 1)} />
                    </li>
                );
            })}
            <li><CandidateOffers orgId={orgId} record={record} interviews={list} /></li>
        </ul>
    );
}

/**
 * Owner 2026-11-21 (spec Stage 6): the interview's status (done, no-show, cancelled), moving it to a new time (the
 * candidate and the panel are told), and the panel's scorecards (HR sees them all; each interviewer fills theirs from
 * the link in their invite).
 */
function InterviewFollowUp({ orgId, interview: i, onChanged }: { orgId: string; interview: Interview; onChanged: () => void }) {
    const { notify } = useUi();
    const [busy, setBusy] = useState(false);
    const [moving, setMoving] = useState(false);
    const [at, setAt] = useState(i.at);
    const [reason, setReason] = useState('');
    const [manualCopy, setManualCopy] = useState<{ id: string; url: string } | null>(null);
    if (!i.followUpId) return null;
    const status = i.status ?? 'scheduled';
    const share = async (scorecardId: string, action: 'copy' | 'email') => {
        setBusy(true);
        try {
            const res = await api<{ url?: string; email?: string }>('/api/candidates/interviews/follow-up', { json: { orgId, scorecardId, action } });
            if (!res.ok) { notify(res.error, 'error'); return; }
            if (res.data.url) {
                try {
                    await navigator.clipboard.writeText(res.data.url);
                    setManualCopy(null);
                    notify('Scorecard link copied', 'success');
                } catch {
                    setManualCopy({ id: scorecardId, url: res.data.url });
                    notify('Select and copy the scorecard link below.', 'info');
                }
            } else if (res.data.email) notify(`Scorecard link emailed to ${res.data.email}`, 'success');
        } finally { setBusy(false); }
    };
    const patch = async (json: Record<string, unknown>, done: string) => {
        setBusy(true);
        const res = await api<{ told?: number }>('/api/candidates/interviews/follow-up', { method: 'PATCH', json: { orgId, id: i.followUpId, ...json } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify(`${done}${res.data.told ? ` · ${res.data.told} told by email` : ''}`, 'success');
        setMoving(false); setReason('');
        onChanged();
    };
    const cards = i.scorecards ?? [];
    const submitted = cards.filter(c => c.submittedAt);
    return (
        <div className="mt-2.5 border-t border-border-subtle pt-2.5">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status === 'done' ? 'bg-green-50 text-green-800' : status === 'scheduled' ? 'bg-stone-50 text-stone-800' : 'bg-slate-100 text-slate-700'}`}>{INTERVIEW_STATUS_LABELS[status]}</span>
                {i.statusReason && <span className="text-xs text-text-secondary">“{i.statusReason}”</span>}
                {/* Owner 2026-11-24: the candidate's answer on their interview page */}
                {status === 'scheduled' && i.rsvp && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i.rsvp === 'yes' ? 'bg-green-50 text-green-800' : 'bg-rose-50 text-rose-800'}`} title={i.rsvpNote ?? undefined}>{i.rsvp === 'yes' ? 'Confirmed' : `Cannot attend${i.rsvpNote ? `: ${i.rsvpNote}` : ''}`}</span>}
                {status === 'scheduled' && (
                    <span className="ml-auto flex flex-wrap gap-1">
                        <button type="button" onClick={() => void patch({ status: 'done' }, 'Marked done')} disabled={busy} className={`${BTN_GHOST} h-8`}><Check className="h-4 w-4" />Done</button>
                        <button type="button" onClick={() => void patch({ status: 'no_show' }, 'Marked no-show')} disabled={busy} className={`${BTN_GHOST} h-8`}>No-show</button>
                        <button type="button" onClick={() => setMoving(m => !m)} disabled={busy} className={`${BTN_GHOST} h-8`}><CalendarClock className="h-4 w-4" />Reschedule</button>
                        <button type="button" onClick={() => void patch({ status: 'cancelled', reason: reason || undefined }, 'Cancelled')} disabled={busy} className={`${BTN_GHOST} h-8 text-error`}><X className="h-4 w-4" />Cancel</button>
                    </span>
                )}
            </div>
            {moving && (
                <div className={`${WELL} mt-2 flex flex-wrap items-end gap-2 px-3 py-2.5`}>
                    <label className="text-xs text-text-secondary">New time (IST)<input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} className={`${INPUT} mt-1 h-9`} /></label>
                    <label className="min-w-[160px] flex-1 text-xs text-text-secondary">Why (optional)<input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} className={`${INPUT} mt-1 h-9`} /></label>
                    <button type="button" onClick={() => void patch({ reschedule: at, reason: reason || undefined }, 'Moved')} disabled={busy || !at} className={BTN_PRIMARY}>{busy && <Spinner />}Move and tell everyone</button>
                </div>
            )}
            {cards.length > 0 && (
                <div className="mt-2">
                    <p className={LABEL}>Optional scorecards · {submitted.length} of {cards.length} in</p>
                    <ul className="mt-1 space-y-1">
                        {cards.map(c => (
                            <li key={c.id} className="text-xs text-text-primary">
                                <span className="font-semibold">{c.panelName ?? 'Interviewer'}</span>{' · '}
                                {c.submittedAt ? <>{c.overall}/5 · {c.recommendation ? RECOMMENDATION_LABELS[c.recommendation] : '—'}{Object.keys(c.ratings).length > 0 && <span className="text-text-secondary"> ({Object.entries(c.ratings).map(([k, v]) => `${k} ${v}`).join(', ')})</span>}{c.comments && <span className="block italic text-text-secondary">“{c.comments}”</span>}</> : <>
                                    <span className="text-text-tertiary">Awaiting feedback</span>
                                    {(status === 'scheduled' || status === 'done') && <span className="ml-2 inline-flex flex-wrap gap-1">
                                        <button type="button" disabled={busy} className={BTN_GHOST} onClick={() => void share(c.id, 'copy')}>Copy scorecard link</button>
                                        <button type="button" disabled={busy} className={BTN_GHOST} onClick={() => void share(c.id, 'email')}>Resend by email</button>
                                    </span>}
                                    {manualCopy?.id === c.id && <input readOnly value={manualCopy.url} aria-label={`Scorecard link for ${c.panelName ?? 'interviewer'}`} onFocus={e => e.currentTarget.select()} className={`${INPUT} mt-1 w-full`} />}
                                </>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
