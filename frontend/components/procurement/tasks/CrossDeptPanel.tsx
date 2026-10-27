'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Bell, Check, ChevronDown, Eye, FileText, Loader2, Paperclip, Search, Send, X } from 'lucide-react';
import { ATTACH_ACCEPT, ATTACH_MAX_BYTES, avatarGradient, fileSizeLabel, initials, shortDate, todayIST } from './types';
import type { CollabIncoming, CollabKind, CollabSent, useCollaboration } from './useCollaboration';

/**
 * Owner 2026-10-26 — the Send tab's "Other departments": give a task to, ask for support from, or work together with
 * anyone in another department. Support requests wait for the receiver's Accept; the receiver's manager is not told
 * (owner decisions). Every rule is checked again by the server (CollaborationService).
 */

const KINDS: ReadonlyArray<{ id: CollabKind; label: string; hint: (first: string) => string }> = [
    { id: 'task', label: 'Give a task', hint: f => `It goes on ${f}'s list. You see it under "Waiting on other teams".` },
    { id: 'support', label: 'Ask for support', hint: f => `${f} accepts it first (or says they can't, with a reason).` },
    { id: 'together', label: 'Work together', hint: () => 'You both get a copy, linked. Each of you finishes your own part.' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDay = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso; };
const firstName = (name: string) => name.split(' ')[0];

const STATUS: Record<CollabSent['status'], { label: string; cls: string }> = {
    awaiting: { label: 'Waiting to accept', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
    declined: { label: "Can't take it", cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
    pending: { label: 'To do', cls: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
    in_progress: { label: 'In progress', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300' },
    completed: { label: 'Done', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
};

export default function CrossDeptPanel({ collab, me, uploadFiles, onChanged, dueDates = false }: {
    collab: ReturnType<typeof useCollaboration>;
    me: { name: string; department: string | null };
    /** Attach files to tasks that were just created (the board's own upload). */
    uploadFiles: (taskIds: string[], files: File[]) => Promise<number>;
    /** The board changed (a task was added to my list): reload it. */
    onChanged: () => void;
    /** Owner 2026-10-27: Due dates switch ON — "needed by" is a deadline (with an optional time); the task starts today. */
    dueDates?: boolean;
}) {
    const { data, loading, error } = collab;
    const [dept, setDept] = useState('');
    const [query, setQuery] = useState('');
    const [to, setTo] = useState<string | null>(null);
    const [kind, setKind] = useState<CollabKind>('task');
    const [title, setTitle] = useState('');
    const [details, setDetails] = useState('');
    const [neededBy, setNeededBy] = useState('');
    const [dueTime, setDueTime] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [showPreview, setShowPreview] = useState(false);
    const [duplicate, setDuplicate] = useState<{ assignedDate: string } | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    const people = useMemo(() => data?.people ?? [], [data]);
    const departments = useMemo(() => [...new Set(people.map(p => p.department))], [people]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return people.filter(p => (!dept || p.department === dept) && (!q || p.name.toLowerCase().includes(q) || p.department.toLowerCase().includes(q)));
    }, [people, dept, query]);
    const groups = useMemo(() => {
        const out = new Map<string, typeof shown>();
        for (const p of shown) out.set(p.department, [...(out.get(p.department) ?? []), p]);
        return [...out.entries()];
    }, [shown]);
    const person = people.find(p => p.userId === to) || null;
    const supportOff = data ? !data.requestsReady : false;

    if (loading && !data) return <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
    if (error && !data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>;
    if (!data) return null;

    const flash = (k: 'ok' | 'err', text: string) => { setMessage({ kind: k, text }); setTimeout(() => setMessage(null), 6000); };
    const clear = () => { setTitle(''); setDetails(''); setNeededBy(''); setDueTime(''); setFiles([]); setDuplicate(null); setShowPreview(false); };
    const from = me.department ? `${me.name} (${me.department})` : me.name;
    // Owner 2026-10-27: a task (not a support request) with a date becomes a deadline when the switch is ON
    const asDeadline = dueDates && kind !== 'support' && !!neededBy;
    const preview = person ? (kind === 'support'
        ? `🤝 Request from another team\n\nHello ${firstName(person.name)},\n${from} needs your help with a task.\nTask: ${title.trim() || '…'}\nNeeded by: ${neededBy ? longDay(neededBy) : 'No date given'}\n\nTap Accept, or Can't do it.`
        : `🔔 A new task has been assigned to you.\n\nTask: ${title.trim() || '…'}\nAssigned by: ${from}\nDate: ${longDay(asDeadline ? todayIST() : neededBy || todayIST())}\n\nReply "tasks" to see your list and mark it done.`) : '';

    const pickFiles = (list: FileList | null) => {
        const picked = Array.from(list || []);
        const tooBig = picked.filter(f => f.size > ATTACH_MAX_BYTES);
        if (tooBig.length) flash('err', `${tooBig.map(f => f.name).join(', ')}: larger than 10 MB`);
        setFiles(prev => [...prev, ...picked.filter(f => f.size > 0 && f.size <= ATTACH_MAX_BYTES)].slice(0, 5));
    };

    const doSend = async (skipCheck = false) => {
        if (!person || !title.trim() || busy) return;
        setBusy('send');
        if (!skipCheck) {
            const match = await collab.checkDuplicate(person.userId, title.trim());
            if (match) { setDuplicate(match); setBusy(null); return; }
        }
        const r = await collab.send({ targetUserId: person.userId, kind, title: title.trim(), description: details.trim(), neededBy, ...(asDeadline && dueTime ? { dueTime } : {}) });
        if (!r.ok) { setBusy(null); flash('err', r.error); return; }
        let fileNote = '';
        if (files.length) {
            if (r.requestId) {
                const failed = await collab.uploadToRequest(r.requestId, files);
                if (failed.length) fileNote = ` Some files were not attached: ${failed.join('; ')}`;
            } else if (r.taskIds.length) {
                const saved = await uploadFiles(r.taskIds, files);
                if (saved < files.length) fileNote = ' Some files were not attached.';
            }
        }
        setBusy(null);
        flash('ok', `${kind === 'support' ? 'Support request sent to' : kind === 'together' ? 'Shared with' : 'Task given to'} ${firstName(person.name)}.${fileNote}`);
        clear();
        await collab.reload();
        if (kind === 'together') onChanged();
    };

    const card = 'rounded-3xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900';
    const h = 'flex items-center gap-2 text-sm font-black text-zinc-900 dark:text-zinc-100';
    const label = 'mb-1.5 block text-[10px] font-black uppercase tracking-widest text-zinc-500';
    const field = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-[13px] font-semibold text-zinc-900 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';

    return (
        <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[260px_minmax(0,1fr)] @6xl:grid-cols-[260px_minmax(0,1fr)_320px]">
            {message && <div className={`rounded-2xl px-4 py-3 text-xs font-bold @4xl:col-span-2 @6xl:col-span-3 ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{message.text}</div>}

            {/* 1. Who */}
            <section className={`${card} space-y-3`} aria-label="Choose a person">
                <h3 className={h}>Who</h3>
                <label className="block">
                    <span className={label}>Department</span>
                    <span className="relative block">
                        <select value={dept} onChange={e => setDept(e.target.value)} className={`${field} cursor-pointer appearance-none pr-8`}>
                            <option value="">All departments</option>
                            {departments.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-zinc-500" aria-hidden="true" />
                    </span>
                </label>
                <label className="relative block">
                    <span className="sr-only">Search people</span>
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" aria-hidden="true" />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a name or department" className={`${field} pl-8`} />
                </label>
                <div className="max-h-[420px] overflow-y-auto pr-1">
                    {groups.length === 0 && <p className="p-2 text-xs text-zinc-500">{people.length ? 'Nobody matches.' : 'Nobody in other departments uses the Task Manager yet.'}</p>}
                    {groups.map(([d, list]) => (
                        <div key={d}>
                            <p className="mb-0.5 ml-2 mt-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">{d}</p>
                            {list.map(p => {
                                const on = p.userId === to;
                                return (
                                    <button key={p.userId} type="button" aria-pressed={on} onClick={() => { setTo(p.userId); setDuplicate(null); }}
                                        className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[13px] font-bold transition-colors ${on ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200' : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800'}`}>
                                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${avatarGradient(p.name)} text-[9px] font-black text-white`}>{initials(p.name)}</span>
                                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                        {on && <Check className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
                <p className="text-[11px] text-zinc-500">Only people who use the Task Manager are listed. Superusers are under “Your manager”.</p>
            </section>

            {/* 2. What */}
            <section className={`${card} space-y-3.5`} aria-label="What to send">
                <h3 className={h}>{person ? <>What · to {person.name} <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-black text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">{person.department}</span></> : 'What'}</h3>
                {!person && <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-xs text-zinc-500 dark:border-zinc-700">Choose a person first.</p>}
                {person && (<>
                    <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-3" role="radiogroup" aria-label="Kind of request">
                        {KINDS.map(k => {
                            const on = kind === k.id;
                            const off = k.id === 'support' && supportOff;
                            return (
                                <button key={k.id} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => setKind(k.id)}
                                    className={`flex flex-col gap-0.5 rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900'}`}>
                                    <span className="text-[13px] font-black text-zinc-900 dark:text-zinc-100">{k.label}</span>
                                    <span className="text-[11px] font-semibold leading-snug text-zinc-500">{off ? 'Available after the latest database update.' : k.hint(firstName(person.name))}</span>
                                </button>
                            );
                        })}
                    </div>
                    <label className="block"><span className={label}>Task</span>
                        <textarea rows={2} maxLength={200} value={title} onChange={e => { setTitle(e.target.value); setDuplicate(null); }}className={`${field} resize-none`} />
                    </label>
                    <label className="block"><span className={label}>Details (optional)</span>
                        <textarea rows={2} maxLength={1000} value={details} onChange={e => setDetails(e.target.value)}className={`${field} resize-none`} />
                    </label>
                    <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
                        {dueDates && kind !== 'support' ? (
                            <div>
                                <span className={label}>Due by (optional)</span>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="block"><span className="sr-only">Due date</span>
                                        <input type="date" min={todayIST()} value={neededBy} onChange={e => setNeededBy(e.target.value)} className={field} />
                                    </label>
                                    <label className="block"><span className="sr-only">Due time (optional)</span>
                                        <input type="time" value={dueTime} disabled={!neededBy} onChange={e => setDueTime(e.target.value)} className={`${field} disabled:opacity-50`} />
                                    </label>
                                </div>
                            </div>
                        ) : (
                            <label className="block"><span className={label}>Needed by (optional)</span>
                                <input type="date" min={todayIST()} value={neededBy} onChange={e => setNeededBy(e.target.value)} className={field} />
                            </label>
                        )}
                        <div>
                            <span className={label}>Files (optional)</span>
                            <input id="collab-files" type="file" multiple accept={ATTACH_ACCEPT} className="sr-only" onChange={e => { pickFiles(e.target.files); e.target.value = ''; }} />
                            <label htmlFor="collab-files" className={`${field} flex cursor-pointer items-center gap-2 text-zinc-600`}><Paperclip className="h-4 w-4" aria-hidden="true" /> Attach document or screenshot</label>
                        </div>
                    </div>
                    {files.length > 0 && (
                        <ul className="space-y-1">
                            {files.map((f, i) => (
                                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-bold dark:border-zinc-700">
                                    <FileText className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{f.name}</span>
                                    <span className="text-zinc-500">{fileSizeLabel(f.size)}</span>
                                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(l => l.filter((_, j) => j !== i))} className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-3.5 w-3.5" /></button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {duplicate && (
                        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                            <span className="min-w-0 flex-1">{firstName(person.name)} already has a similar open task (since {shortDate(duplicate.assignedDate)}). Nothing is sent yet.</span>
                            <span className="flex gap-2">
                                <button type="button" onClick={() => void doSend(true)} disabled={!!busy} className="rounded-lg bg-amber-600 px-3 py-1.5 font-black text-white hover:bg-amber-700 disabled:opacity-50">Send anyway</button>
                                <button type="button" onClick={() => setDuplicate(null)} className="rounded-lg border border-amber-300 px-3 py-1.5 font-black text-amber-900 dark:text-amber-200">Go back</button>
                            </span>
                        </div>
                    )}

                    <div className="relative flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => void doSend()} disabled={!!busy || !title.trim()} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50">
                            {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send to {firstName(person.name)}
                        </button>
                        <button type="button" onClick={clear} className="rounded-xl border border-zinc-300 px-4 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Clear</button>
                        <button type="button" aria-expanded={showPreview} aria-label={`Preview the WhatsApp message ${firstName(person.name)} will get`} title="Preview the WhatsApp message"
                            onClick={() => setShowPreview(v => !v)}
                            className={`ml-auto flex h-9 w-9 items-center justify-center rounded-xl border-2 transition-colors ${showPreview ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-zinc-200 bg-white text-zinc-500 hover:text-indigo-700'} dark:bg-zinc-900`}>
                            <Eye className="h-4 w-4" />
                        </button>
                        {showPreview && (
                            <div role="dialog" aria-label="WhatsApp message preview" className="absolute bottom-11 right-0 z-20 w-[min(340px,100%)] rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">What {firstName(person.name)} will get on WhatsApp</p>
                                <pre className="whitespace-pre-wrap break-words rounded-xl bg-[#dcf8c6] p-3 font-sans text-xs font-semibold leading-relaxed text-emerald-950">{preview}</pre>
                            </div>
                        )}
                    </div>
                </>)}
            </section>

            {/* 3 + 4. Tracking */}
            <div className="space-y-4 @4xl:col-span-2 @6xl:col-span-1">
                <SentList sent={data.sent} remind={collab.remind} flash={flash} />
                <IncomingList incoming={data.incoming} respond={collab.respond} flash={flash} onDone={async accepted => { await collab.reload(); if (accepted) onChanged(); }} />
            </div>
        </div>
    );
}

function SentList({ sent, remind, flash }: { sent: CollabSent[]; remind: ReturnType<typeof useCollaboration>['remind']; flash: (k: 'ok' | 'err', t: string) => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const open = sent.filter(s => s.canRemind);
    const doRemind = async (ids: string[], key: string) => {
        setBusy(key);
        const r = await remind(ids);
        setBusy(null);
        if (!r.ok) return flash('err', r.error);
        const names = r.reminded.map(x => x.name).join(', ');
        flash(names ? 'ok' : 'err', names ? `Reminder sent to ${names}.` : `No reminder was sent${r.skipped[0] ? ` (${r.skipped[0].why})` : ''}.`);
    };
    return (
        <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900" aria-label="Waiting on other teams">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-zinc-900 dark:text-zinc-100">Waiting on other teams <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-black text-zinc-600 dark:bg-zinc-800">{sent.length}</span></h3>
            {sent.length === 0 && <p className="text-xs text-zinc-500">Nothing sent to other teams yet.</p>}
            <ul className="max-h-[380px] space-y-1.5 overflow-y-auto">
                {sent.map(s => (
                    <li key={`${s.kind}-${s.id}`} className="flex items-center gap-2 rounded-xl border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-black text-zinc-900 dark:text-zinc-100">{s.title}</span>
                            <span className="block truncate text-[11px] font-semibold text-zinc-500">{firstName(s.toName)} · {s.department}{s.supportRequest ? ' · support request' : ''} · {shortDate(s.since.slice(0, 10))}</span>
                            {s.reason && <span className="mt-0.5 block text-[11px] font-semibold text-rose-700 dark:text-rose-300">“{s.reason}”</span>}
                        </span>
                        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                        {s.canRemind && (
                            <button type="button" disabled={!!busy} onClick={() => void doRemind([s.id], s.id)} aria-label={`Remind ${s.toName} about ${s.title}`} title="Send a reminder"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300">
                                {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            {open.length > 1 && (
                <button type="button" disabled={!!busy} onClick={() => void doRemind(open.map(s => s.id), 'all')}
                    className="mt-3 flex items-center gap-1.5 rounded-xl border border-indigo-200 px-3 py-1.5 text-xs font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-900/60 dark:text-indigo-300">
                    {busy === 'all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />} Remind about open ones
                </button>
            )}
        </section>
    );
}

/** Support requests other teams sent me: Accept, or say I can't (with a reason that goes back to them). */
export function IncomingList({ incoming, respond, flash, onDone, compact = false }: {
    incoming: CollabIncoming[];
    respond: ReturnType<typeof useCollaboration>['respond'];
    flash: (k: 'ok' | 'err', t: string) => void;
    onDone: (accepted: boolean) => void | Promise<void>;
    compact?: boolean;
}) {
    const [declining, setDeclining] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    if (compact && incoming.length === 0) return null;
    const answer = async (id: string, accept: boolean) => {
        setBusy(id);
        const r = await respond(id, accept, accept ? undefined : reason.trim());
        setBusy(null);
        if (!r.ok) return flash('err', r.error);
        setDeclining(null); setReason('');
        flash('ok', accept ? 'Accepted. It is on your list now.' : 'Sent your reason back.');
        await onDone(accept);
    };
    return (
        <section className={compact ? 'space-y-2' : 'rounded-3xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900'} aria-label="Asked of you by other teams">
            {!compact && <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-zinc-900 dark:text-zinc-100">Asked of you <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-black text-zinc-600 dark:bg-zinc-800">{incoming.length}</span></h3>}
            {!compact && incoming.length === 0 && <p className="text-xs text-zinc-500">No requests from other teams.</p>}
            <ul className="space-y-2">
                {incoming.map(r => (
                    <li key={r.id} className="relative overflow-hidden rounded-2xl border border-orange-300 bg-orange-50/80 p-3 pl-4 dark:border-orange-800/50 dark:bg-orange-950/20">
                        <span className="absolute inset-y-0 left-0 w-1 bg-orange-500" aria-hidden="true" />
                        <p className="whitespace-pre-line break-words text-[13px] font-bold leading-snug text-zinc-900 dark:text-zinc-100">{r.title}</p>
                        {r.description && <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-400">{r.description}</p>}
                        <p className="mt-2 flex flex-wrap gap-1.5">
                            <span className="rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-black text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">Support request · from {firstName(r.fromName)} ({r.fromDepartment})</span>
                            {r.neededBy && <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-black text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">Needed by {shortDate(r.neededBy)}</span>}
                        </p>
                        {declining === r.id ? (
                            <div className="mt-2 space-y-2">
                                <label className="block"><span className="mb-1 block text-[11px] font-bold text-zinc-600 dark:text-zinc-300">Reason (optional, sent to {firstName(r.fromName)})</span>
                                    <textarea autoFocus rows={2} maxLength={300} value={reason} onChange={e => setReason(e.target.value)}
                                        className="w-full resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-rose-400 dark:border-zinc-700 dark:bg-zinc-950" />
                                </label>
                                <div className="flex gap-2">
                                    <button type="button" disabled={busy === r.id} onClick={() => void answer(r.id, false)} className="flex items-center gap-1 rounded-lg bg-rose-700 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50">{busy === r.id && <Loader2 className="h-3 w-3 animate-spin" />} Send</button>
                                    <button type="button" onClick={() => { setDeclining(null); setReason(''); }} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-[11px] font-bold text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">Back</button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-2.5 flex flex-wrap gap-2 border-t border-orange-200 pt-2.5 dark:border-orange-900/40">
                                <button type="button" disabled={busy === r.id} onClick={() => void answer(r.id, true)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-emerald-700 disabled:opacity-50">{busy === r.id && <Loader2 className="h-3 w-3 animate-spin" />} Accept</button>
                                <button type="button" onClick={() => setDeclining(r.id)} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-black text-rose-800 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-zinc-900 dark:text-rose-300">Can&apos;t take this</button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
