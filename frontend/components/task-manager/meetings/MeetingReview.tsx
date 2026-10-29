'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronDown, Circle, Download, FileText, Loader2, Lock, MessageCircle, Mic, Pencil, Plus, RotateCcw, Send, Trash2, X,
} from 'lucide-react';
import {
    PROCESSING, STATUS_LABEL, call, clock, meetingUrl, niceDate, type MeetingDetail, type MeetingPerson, type MeetingTask, type MeetingSpace, type SendAs,
} from './api';
import { exportPdf, exportWord } from './exportNotes';

/**
 * Owner 2026-10-29: one meeting. While it is processing, this screen polls (each poll moves the work forward one step).
 * When ready: summary, decisions, notes, open questions, and the task list — each task can be edited (what, who, when,
 * note) and sent with its own Send button, or all at once. Tasks are sent "from Autopilot".
 */

type Data = { meeting: MeetingDetail; tasks: MeetingTask[]; people: MeetingPerson[]; me: { name: string; department: string } };
const IN_MEETING = 'In this meeting';
const POLL_MS = 4_000;
const input = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

export default function MeetingReview({ space, meetingId, onBack, onContinueRecording }: {
    space: MeetingSpace;
    meetingId: string;
    onBack: () => void;
    onContinueRecording: (id: string, title: string) => void;
}) {
    const [data, setData] = useState<Data | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [showTranscript, setShowTranscript] = useState(false);
    const [sendAs, setSendAs] = useState<SendAs>('autopilot');
    /** A task just added by hand: shown at the top, its title selected so the person can type straight away */
    const [newTaskId, setNewTaskId] = useState<string | null>(null);
    const [withTranscript, setWithTranscript] = useState(false);
    const [exporting, setExporting] = useState(false);
    /** The meeting's name while it is being changed (null = not editing) */
    const [titleDraft, setTitleDraft] = useState<string | null>(null);
    const saving = useRef(new Set<Promise<unknown>>());
    const alive = useRef(true);

    const load = useCallback(async () => {
        const r = await call<Data>(meetingUrl(meetingId, space));
        if (!alive.current) return null;
        if (!r.ok) { setError(r.error); return null; }
        setError(null);
        setData({ meeting: r.meeting, tasks: r.tasks, people: r.people, me: r.me });
        return r.meeting.status;
    }, [meetingId, space]);

    // Poll while processing: the next poll starts only after the previous one has answered
    useEffect(() => {
        alive.current = true;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const tick = async () => {
            const status = await load();
            if (alive.current && status && PROCESSING.includes(status)) timer = setTimeout(tick, POLL_MS);
        };
        void tick();
        return () => { alive.current = false; if (timer) clearTimeout(timer); };
    }, [load]);

    /** Edits are saved as they are made; Send waits for any save still running. */
    const track = useCallback(<T,>(p: Promise<T>) => {
        saving.current.add(p);
        void p.finally(() => saving.current.delete(p));
        return p;
    }, []);

    const act = async (label: string, body: Record<string, unknown>, after?: (r: Record<string, unknown>) => void) => {
        setBusy(label);
        const r = await call(meetingUrl(meetingId, space), body);
        setBusy(null);
        if (!r.ok) { setFlash(r.error); return false; }
        after?.(r);
        await load();
        return true;
    };

    const send = async (taskIds: string[]) => {
        if (!taskIds.length) return;
        await Promise.allSettled([...saving.current]);
        await act(taskIds.length === 1 ? `send:${taskIds[0]}` : 'send-all', { action: 'send', taskIds, sendAs }, r => {
            const sent = (r.sent as Array<{ name: string }>) || [];
            const skipped = (r.skipped as Array<{ title: string; why: string }>) || [];
            setFlash(`${sent.length ? `Sent ${sent.length} task${sent.length === 1 ? '' : 's'}.` : ''}${skipped.filter(s => s.why !== 'already sent').length ? ` ${skipped.filter(s => s.why !== 'already sent').length} not sent — see the cards.` : ''}`.trim() || 'Nothing to send.');
        });
    };

    // Owner 2026-10-29: the people who were in the meeting come first; everyone else follows by department
    const peopleByDept = useMemo(() => {
        const present = new Set((data?.meeting.attendees ?? []).map(a => a.id));
        const here: MeetingPerson[] = [];
        const groups = new Map<string, MeetingPerson[]>();
        for (const p of data?.people ?? []) {
            if (present.has(p.id)) { here.push(p); continue; }
            const k = p.department || 'Other';
            groups.set(k, [...(groups.get(k) ?? []), p]);
        }
        const rest = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        return here.length ? [[IN_MEETING, here] as [string, MeetingPerson[]], ...rest] : rest;
    }, [data?.people, data?.meeting.attendees]);

    if (!data) {
        return (
            <div className="space-y-4">
                <BackButton onBack={onBack} />
                {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>
                    : <p className="flex items-center gap-2 text-sm font-semibold text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
            </div>
        );
    }

    const { meeting: m, tasks } = data;
    const drafts = tasks.filter(t => t.status === 'draft');
    const readyToSend = drafts.filter(t => t.ownerUserIds.length > 0);
    const sentCount = tasks.filter(t => t.status === 'sent').length;

    return (
        <div className="mx-auto max-w-4xl space-y-5">
            <BackButton onBack={onBack} />

            {/* Header */}
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        {/* Owner 2026-10-29: the meeting's name can be changed */}
                        {titleDraft === null ? (
                            <h2 className="flex items-center gap-2 text-xl font-black text-zinc-900 dark:text-zinc-100">
                                {m.confidential && <Lock className="h-4 w-4 shrink-0 text-zinc-400" aria-label="Confidential" />}
                                <span className="truncate">{m.title}</span>
                                <button type="button" onClick={() => setTitleDraft(m.title)} aria-label="Rename meeting" title="Rename"
                                    className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                                    <Pencil className="h-4 w-4" />
                                </button>
                            </h2>
                        ) : (
                            <form className="flex flex-wrap items-center gap-2"
                                onSubmit={e => { e.preventDefault(); if (titleDraft.trim()) void act('rename', { action: 'rename', title: titleDraft }, () => setTitleDraft(null)); }}>
                                <input autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)} maxLength={150} aria-label="Meeting name"
                                    onKeyDown={e => { if (e.key === 'Escape') setTitleDraft(null); }}
                                    className={`${input} max-w-md text-base font-bold`} />
                                <button type="submit" disabled={!!busy || !titleDraft.trim()} className="flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-40">
                                    {busy === 'rename' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                                </button>
                                <button type="button" onClick={() => setTitleDraft(null)} className="rounded-xl px-3 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>
                            </form>
                        )}
                        <p className="mt-0.5 text-xs font-semibold text-zinc-500">
                            {niceDate(m.meetingDate)}{m.durationSeconds ? ` · ${clock(m.durationSeconds)} long` : ''} · {STATUS_LABEL[m.status]}
                        </p>
                    </div>
                    {m.mine && m.status !== 'discarded' && (
                        <button type="button" disabled={!!busy}
                            onClick={() => { if (window.confirm('Delete this meeting? Tasks already sent stay with the people.')) void act('discard', { action: 'discard' }, () => onBack()); }}
                            className="flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-red-50 hover:text-red-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-red-950/40">
                            <Trash2 className="h-3.5 w-3.5" /> Delete meeting
                        </button>
                    )}
                </div>
                {(m.attendees.length > 0 || m.extraNames.length > 0) && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {m.attendees.map(a => <span key={a.id} className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{a.name}</span>)}
                        {m.extraNames.map(n => <span key={n} className="rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-[11px] font-bold text-zinc-500 dark:border-zinc-700">{n}</span>)}
                    </div>
                )}
                {/* Owner 2026-10-29: download the notes (summary, decisions, notes, tasks, optionally the transcript) */}
                {m.status === 'ready' && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500"><Download className="h-3.5 w-3.5" /> Download notes</span>
                        {([['PDF', exportPdf], ['Word', exportWord]] as const).map(([label, run]) => (
                            <button key={label} type="button" disabled={exporting}
                                onClick={async () => {
                                    setExporting(true);
                                    try { await run({ meeting: m, tasks, includeTranscript: withTranscript }); }
                                    catch { setFlash(`Could not make the ${label} file. Please try again.`); }
                                    finally { setExporting(false); }
                                }}
                                className="rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                                {label}
                            </button>
                        ))}
                        {m.transcript.length > 0 && (
                            <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                <input type="checkbox" checked={withTranscript} onChange={e => setWithTranscript(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" />
                                Include transcript
                            </label>
                        )}
                        {exporting && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
                    </div>
                )}
                {/* Owner 2026-10-29: the notes on WhatsApp to the people present (each also gets their own tasks) */}
                {m.status === 'ready' && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button type="button" disabled={!!busy || m.attendees.length === 0}
                            title={m.attendees.length === 0 ? 'Nobody from the Task Manager was marked as present' : undefined}
                            onClick={() => {
                                const again = m.notesSentAt ? ' They were already sent once — send again?' : '';
                                if (!window.confirm(`Send the summary, decisions and each person's tasks on WhatsApp to the ${m.attendees.length} ${m.attendees.length === 1 ? 'person' : 'people'} present?${again}`)) return;
                                void act('send_notes', { action: 'send_notes' }, r => {
                                    const sent = Number(r.sent) || 0, failed = Number(r.failed) || 0, noPhone = Number(r.noPhone) || 0;
                                    setFlash([
                                        sent ? `Notes sent on WhatsApp to ${sent} ${sent === 1 ? 'person' : 'people'}.` : 'No notes were sent.',
                                        failed ? `${failed} could not be sent (is the "meeting_notes_v1" template approved?).` : '',
                                        noPhone ? `${noPhone} without a WhatsApp number.` : '',
                                    ].filter(Boolean).join(' '));
                                });
                            }}
                            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-40">
                            {busy === 'send_notes' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />} Send notes on WhatsApp
                        </button>
                        {m.notesSentAt && (
                            <span className="text-[11px] font-semibold text-zinc-500">
                                Last sent {new Date(m.notesSentAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} to {m.notesSentCount ?? 0}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {flash && (
                <div className="flex items-start justify-between gap-3 rounded-xl bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200" role="status">
                    <span>{flash}</span>
                    <button type="button" onClick={() => setFlash(null)} className="text-xs font-bold opacity-70 hover:opacity-100">Close</button>
                </div>
            )}
            {error && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{error}</p>}

            {/* Still recording (e.g. the page was reloaded) */}
            {m.status === 'recording' && (
                <Panel>
                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">This meeting is still open for recording.</p>
                    {m.mine ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                            <button type="button" onClick={() => onContinueRecording(m.id, m.title)} className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-700"><Mic className="h-4 w-4" /> Continue recording</button>
                            <button type="button" disabled={!!busy} onClick={() => void act('finish', { action: 'finish' }, () => { void pollAgain(); })} className="flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                                {busy === 'finish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Finish and make notes
                            </button>
                        </div>
                    ) : <p className="mt-1 text-xs text-zinc-500">Only the person who started it can continue or finish it.</p>}
                </Panel>
            )}

            {/* Processing */}
            {PROCESSING.includes(m.status) && (
                <Panel>
                    <Steps status={m.status} />
                    <p className="mt-4 text-xs font-semibold text-zinc-500">This usually takes a few minutes for an hour-long meeting. Keep this page open until it is done.</p>
                </Panel>
            )}

            {/* Failed */}
            {m.status === 'failed' && (
                <Panel>
                    <p className="flex items-start gap-2 text-sm font-semibold text-red-700 dark:text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {m.error || 'Something went wrong.'}</p>
                    {m.canRetry && (
                        <button type="button" disabled={!!busy} onClick={() => void act('retry', { action: 'retry' }, () => { void pollAgain(); })}
                            className="mt-4 flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-black text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900">
                            {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Try again
                        </button>
                    )}
                </Panel>
            )}

            {/* Ready */}
            {m.status === 'ready' && m.summary && (
                <>
                    <Panel title="Summary">
                        <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{m.summary.summary}</p>
                    </Panel>
                    <div className="grid gap-5 md:grid-cols-2">
                        {m.summary.decisions.length > 0 && <Panel title="Decisions"><Bullets items={m.summary.decisions} /></Panel>}
                        {m.summary.openQuestions.length > 0 && <Panel title="Open questions"><Bullets items={m.summary.openQuestions} /></Panel>}
                    </div>
                    {m.summary.notes.length > 0 && (
                        <Panel title="Notes">
                            <div className="space-y-4">
                                {m.summary.notes.map((n, i) => (
                                    <div key={i}>
                                        <p className="text-sm font-black text-zinc-800 dark:text-zinc-200">{n.topic}</p>
                                        <Bullets items={n.points} />
                                    </div>
                                ))}
                            </div>
                        </Panel>
                    )}

                    {/* Tasks */}
                    <section className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                            <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500">
                                Tasks <span className="normal-case tracking-normal text-zinc-400">· {tasks.length} found{sentCount ? `, ${sentCount} sent` : ''}</span>
                            </h3>
                            <div className="flex gap-2">
                                <button type="button" disabled={!!busy} onClick={() => void act('add', { action: 'add_task', title: 'New task' }, r => setNewTaskId((r.id as string) || null))}
                                    className="flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                                    <Plus className="h-3.5 w-3.5" /> Add task
                                </button>
                                <button type="button" disabled={!!busy || !readyToSend.length} onClick={() => void send(readyToSend.map(t => t.id))}
                                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-40">
                                    {busy === 'send-all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send all ready ({readyToSend.length})
                                </button>
                            </div>
                        </div>
                        {readyToSend.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 px-1" role="radiogroup" aria-label="Send as">
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Send as</span>
                                {([['autopilot', 'Autopilot'], ['me', `${data.me.name} (${data.me.department})`]] as Array<[SendAs, string]>).map(([value, label]) => (
                                    <button key={value} type="button" role="radio" aria-checked={sendAs === value} onClick={() => setSendAs(value)}
                                        className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${sendAs === value
                                            ? 'border-indigo-600 bg-indigo-600 text-white'
                                            : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                        {tasks.length === 0 && <Panel><p className="text-sm text-zinc-500">No tasks were found in this meeting. Use &ldquo;Add task&rdquo; if something was missed.</p></Panel>}
                        {tasks.map(t => (
                            <TaskCard key={t.id} task={t} space={space} meetingId={meetingId} groups={peopleByDept} busy={busy} track={track} justAdded={t.id === newTaskId}
                                onSend={() => void send([t.id])} onChanged={() => void load()} onError={setFlash} />
                        ))}
                        <p className="px-1 text-[11px] text-zinc-500">
                            {sendAs === 'autopilot'
                                ? <>Tasks go into each person&apos;s Task Manager list from &ldquo;Autopilot&rdquo;, with the usual WhatsApp alert.</>
                                : <>Tasks go into each person&apos;s list as given by you ({data.me.name}, {data.me.department}), with the usual WhatsApp alert. You will hear when they are done.</>}
                        </p>
                    </section>
                </>
            )}

            {/* Transcript */}
            {m.transcript.length > 0 && (
                <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <button type="button" onClick={() => setShowTranscript(s => !s)} aria-expanded={showTranscript} className="flex w-full items-center justify-between gap-3 p-5 text-left">
                        <span className="flex items-center gap-2 text-sm font-black text-zinc-800 dark:text-zinc-200"><FileText className="h-4 w-4" /> Transcript</span>
                        <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${showTranscript ? 'rotate-180' : ''}`} />
                    </button>
                    {showTranscript && (
                        <div className="max-h-[32rem] space-y-1.5 overflow-y-auto border-t border-zinc-100 p-5 dark:border-zinc-800">
                            {m.transcript.map((l, i) => (
                                <p key={i} id={`t-${Math.floor(l.start)}`} className="text-sm text-zinc-700 dark:text-zinc-300">
                                    <span className="mr-2 font-mono text-[11px] text-zinc-400">{clock(l.start)}</span>
                                    {l.speaker && <span className="mr-1 font-bold text-zinc-500">{l.speaker}:</span>}
                                    {l.text}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    async function pollAgain() {
        let status = await load();
        while (alive.current && status && PROCESSING.includes(status)) {
            await new Promise(r => setTimeout(r, POLL_MS));
            status = await load();
        }
    }
}

function BackButton({ onBack }: { onBack: () => void }) {
    return (
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm font-bold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            <ArrowLeft className="h-4 w-4" /> All meetings
        </button>
    );
}

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            {title && <h3 className="mb-2 text-xs font-black uppercase tracking-widest text-zinc-500">{title}</h3>}
            {children}
        </div>
    );
}

function Bullets({ items }: { items: string[] }) {
    return <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

function Steps({ status }: { status: MeetingDetail['status'] }) {
    // The step being worked on now: the recording is received as soon as processing starts
    const at = status === 'extracting' ? 2 : 1;
    const labels = ['Recording received', 'Turning speech into text', 'Writing notes and tasks'];
    return (
        <ol className="space-y-2.5">
            {labels.map((label, i) => (
                <li key={label} className="flex items-center gap-2.5 text-sm font-semibold">
                    {i < at ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        : i === at ? <Loader2 className="h-4 w-4 animate-spin text-indigo-600" /> : <Circle className="h-4 w-4 text-zinc-300" />}
                    <span className={i <= at ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-400'}>{label}</span>
                </li>
            ))}
        </ol>
    );
}

function TaskCard({ task: t, space, meetingId, groups, busy, track, justAdded, onSend, onChanged, onError }: {
    space: MeetingSpace;
    task: MeetingTask;
    justAdded?: boolean;
    meetingId: string;
    groups: Array<[string, MeetingPerson[]]>;
    busy: string | null;
    track: <T>(p: Promise<T>) => Promise<T>;
    onSend: () => void;
    onChanged: () => void;
    onError: (msg: string) => void;
}) {
    const [title, setTitle] = useState(t.title);
    const [note, setNote] = useState(t.note || '');
    const [saving, setSaving] = useState(false);
    const titleRef = useRef<HTMLInputElement>(null);

    // A task just added by hand: bring it into view and select its title, ready to type over
    useEffect(() => {
        if (!justAdded || !titleRef.current) return;
        titleRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        titleRef.current.focus();
        titleRef.current.select();
    }, [justAdded]);

    const save = (patch: Record<string, unknown>) => {
        setSaving(true);
        return track(call(meetingUrl(meetingId, space), { action: 'update_task', taskId: t.id, ...patch }).then(r => {
            setSaving(false);
            if (!r.ok) onError(r.error); else onChanged();
        }));
    };

    if (t.status === 'sent' || t.status === 'sending') {
        return (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                {t.status === 'sent' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-600" />}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-zinc-800 dark:text-zinc-200">{t.title}</p>
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {t.status === 'sent' ? `Sent to ${t.ownerNames.join(', ') || 'them'}` : 'Sending…'}{t.dueDate ? ` · due ${niceDate(t.dueDate)}${t.dueTime ? ` ${t.dueTime}` : ''}` : ''}
                    </p>
                    {t.error && <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{t.error}</p>}
                </div>
            </div>
        );
    }

    const unmatched = t.ownerUserIds.length === 0 && t.ownerName;
    const nameOf = new Map(groups.flatMap(([, ps]) => ps.map(p => [p.id, p.name] as const)));
    const setOwners = (ids: string[]) => void save({ ownerUserIds: ids });
    return (
        <div className={`space-y-3 rounded-2xl border bg-white p-4 shadow-sm dark:bg-zinc-900 ${justAdded ? 'border-indigo-400 ring-2 ring-indigo-500/20 dark:border-indigo-600' : 'border-zinc-200 dark:border-zinc-800'}`}>
            <div className="flex items-start gap-2">
                <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} aria-label="Task"
                    onBlur={() => { if (title.trim() && title.trim() !== t.title) void save({ title }); }}
                    className={`${input} font-bold`} />
                {t.source === 'manual' && <span className="mt-2 shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-black uppercase text-zinc-500 dark:bg-zinc-800">added</span>}
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                {/* Owner 2026-10-29: one or several people — each gets their own copy of the task */}
                <div className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">For{t.ownerUserIds.length > 1 ? ` (${t.ownerUserIds.length} people)` : ''}</span>
                    {t.ownerUserIds.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                            {t.ownerUserIds.map((id, i) => (
                                <span key={id} className="flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-2.5 pr-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                                    {nameOf.get(id) || t.ownerNames[i] || 'Someone'}
                                    <button type="button" onClick={() => setOwners(t.ownerUserIds.filter(x => x !== id))} aria-label={`Remove ${nameOf.get(id) || 'person'}`}
                                        className="rounded-full p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-900">
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <select value="" aria-label="Add a person" onChange={e => { if (e.target.value) setOwners([...t.ownerUserIds, e.target.value]); }} className={`${input} mt-1`}>
                        <option value="">{t.ownerUserIds.length ? '+ Add another person' : '— choose someone —'}</option>
                        {groups.map(([dept, ps]) => (
                            <optgroup key={dept} label={dept}>
                                {ps.filter(p => !t.ownerUserIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </optgroup>
                        ))}
                    </select>
                </div>
                <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Due date</span>
                    <input type="date" value={t.dueDate || ''} onChange={e => void save({ dueDate: e.target.value || null })} className={`${input} mt-1`} />
                </label>
                <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Time</span>
                    <input type="time" value={t.dueTime || ''} disabled={!t.dueDate} onChange={e => void save({ dueTime: e.target.value || null })} className={`${input} mt-1 disabled:opacity-40`} />
                </label>
            </div>
            {unmatched && <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Heard &ldquo;{t.ownerName}&rdquo; — not matched to anyone in the Task Manager. Choose who it is for.</p>}

            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Note (optional)" aria-label="Note"
                onBlur={() => { if (note.trim() !== (t.note || '')) void save({ note }); }}
                className={`${input} resize-y`} />

            {t.quote && (
                <blockquote className="border-l-2 border-zinc-300 pl-3 text-xs italic text-zinc-500 dark:border-zinc-700">
                    <a href={t.quoteAtSeconds !== null ? `#t-${Math.floor(t.quoteAtSeconds)}` : undefined} className="mr-1.5 not-italic font-mono text-zinc-400 hover:text-indigo-600">{t.quoteAtSeconds !== null ? clock(t.quoteAtSeconds) : ''}</a>
                    &ldquo;{t.quote}&rdquo;
                    {t.quoteFound === false && <span className="ml-1.5 not-italic font-semibold text-amber-600">(not found word for word in the transcript — check it)</span>}
                </blockquote>
            )}

            {t.error && <p className="text-xs font-semibold text-red-600 dark:text-red-400">{t.error}</p>}

            <div className="flex items-center justify-end gap-2">
                {saving && <span className="mr-auto flex items-center gap-1 text-[11px] font-semibold text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> Saving</span>}
                <button type="button" disabled={!!busy} onClick={() => void track(call(meetingUrl(meetingId, space), { action: 'delete_task', taskId: t.id }).then(r => (r.ok ? onChanged() : onError(r.error))))}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-zinc-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
                <button type="button" disabled={!!busy || !t.ownerUserIds.length} onClick={onSend} title={t.ownerUserIds.length ? undefined : 'Choose who it is for first'}
                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-40">
                    {busy === `send:${t.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
                </button>
            </div>
        </div>
    );
}
