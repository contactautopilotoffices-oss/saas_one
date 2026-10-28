'use client';

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Bell, Check, ChevronDown, Eye, FileText, Loader2, Paperclip, Search, Send, Trash2, X } from 'lucide-react';
import { ATTACH_ACCEPT, ATTACH_MAX_BYTES, WAttachment, avatarGradient, fileSizeLabel, initials, shortDate, shortDateTime, todayIST } from './types';
import type { CollabIncoming, CollabKind, CollabSent, useCollaboration } from './useCollaboration';
import { DuePicker, DueValue, dueBody } from './due';
import { dueLabel } from '@/task-manager/dueDates';

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
    /** Owner 2026-10-27: Due dates switch ON — a task may get a deadline. Owner 2026-10-28: the start date is separate. */
    dueDates?: boolean;
}) {
    const { data, loading, error } = collab;
    const [dept, setDept] = useState('');
    const [query, setQuery] = useState('');
    const [to, setTo] = useState<string | null>(null);
    const [kind, setKind] = useState<CollabKind>('task');
    const [title, setTitle] = useState('');
    const [details, setDetails] = useState('');
    // Owner 2026-10-28: a task has a Start date (when it shows on their list) and, Due dates ON, an optional Deadline.
    // A support request keeps one "Needed by" date (it starts when they accept it).
    const [neededBy, setNeededBy] = useState('');
    const [startDate, setStartDate] = useState('');
    const [due, setDue] = useState<DueValue | null>(null);
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
    const clear = () => { setTitle(''); setDetails(''); setNeededBy(''); setStartDate(''); setDue(null); setFiles([]); setDuplicate(null); setShowPreview(false); };
    const from = me.department ? `${me.name} (${me.department})` : me.name;
    const start = startDate || todayIST();
    const preview = person ? (kind === 'support'
        ? `🤝 Request from another team\n\nHello ${firstName(person.name)},\n${from} needs your help with a task.\nTask: ${title.trim() || '…'}\nNeeded by: ${neededBy ? longDay(neededBy) : 'No date given'}\n\nTap Accept, or Can't do it.`
        : `🔔 A new task has been assigned to you.\n\nTask: ${title.trim() || '…'}\nAssigned by: ${from}\nDate: ${longDay(start)}\n\nReply "tasks" to see your list and mark it done.`) : '';

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
        const dates = kind === 'support' ? { neededBy } : { startDate: start, ...(dueDates ? dueBody(due) as { dueDate?: string; dueTime?: string } : {}) };
        const r = await collab.send({ targetUserId: person.userId, kind, title: title.trim(), description: details.trim(), ...dates });
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
                    <label className="block"><span className={label}>Note (optional)</span>
                        <textarea rows={2} maxLength={1000} value={details} onChange={e => setDetails(e.target.value)} className={`${field} resize-none`} />
                    </label>
                    <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
                        {kind !== 'support' ? (
                            <label className="block"><span className={label}>{dueDates ? 'Start date' : 'Date'}</span>
                                <input type="date" min={todayIST()} value={start}
                                    onChange={e => { const v = e.target.value || todayIST(); setStartDate(v); if (due && due.date < v) setDue(null); }} className={field} />
                            </label>
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
                    {dueDates && kind !== 'support' && <DuePicker start={start} value={due} onChange={setDue} idPrefix="collab" />}
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
                <SentList sent={data.sent} remind={collab.remind} clearSent={collab.clearSent} reload={collab.reload} flash={flash} />
                <IncomingList incoming={data.incoming} respond={collab.respond} flash={flash} onDone={async accepted => { await collab.reload(); if (accepted) onChanged(); }} />
            </div>
        </div>
    );
}

function SentList({ sent, remind, clearSent, reload, flash }: {
    sent: CollabSent[];
    remind: ReturnType<typeof useCollaboration>['remind'];
    clearSent: ReturnType<typeof useCollaboration>['clearSent'];
    reload: () => Promise<void>;
    flash: (k: 'ok' | 'err', t: string) => void;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [viewing, setViewing] = useState<string | null>(null);
    const open = sent.filter(s => s.canRemind);
    const keyOf = (s: CollabSent) => `${s.kind}-${s.id}`;
    const shown = sent.find(s => keyOf(s) === viewing) || null;
    // Owner 2026-10-28: Delete only clears it from MY list; the task stays on their list
    const doClear = async (items: CollabSent[], key: string) => {
        const many = items.length > 1;
        if (!window.confirm(many ? `Clear all ${items.length} from this list? The tasks stay on the other people's lists.` : 'Clear this from your list? The task stays on their list.')) return;
        setBusy(key);
        const r = await clearSent(items.map(s => ({ kind: s.kind, id: s.id })));
        setBusy(null);
        if (!r.ok) return flash('err', r.error);
        if (viewing && items.some(s => keyOf(s) === viewing)) setViewing(null);
        flash('ok', many ? `Cleared ${r.cleared} from your list.` : 'Cleared from your list.');
        await reload();
    };
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
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-zinc-900 dark:text-zinc-100">
                Waiting on other teams <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-black text-zinc-600 dark:bg-zinc-800">{sent.length}</span>
                {sent.length > 1 && (
                    <button type="button" disabled={!!busy} onClick={() => void doClear(sent, 'clear-all')} title="Clear the whole list (the tasks stay with them)"
                        className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/40">
                        {busy === 'clear-all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete all
                    </button>
                )}
            </h3>
            {sent.length === 0 && <p className="text-xs text-zinc-500">Nothing sent to other teams yet.</p>}
            <ul className="max-h-[380px] space-y-1.5 overflow-y-auto pr-1">
                {sent.map(s => (
                    <li key={keyOf(s)} className="flex items-center gap-2 rounded-xl border border-zinc-100 px-3 py-2 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                        <button type="button" onClick={() => setViewing(keyOf(s))} aria-label={`Open ${s.title}`} className="min-w-0 flex-1 cursor-pointer text-left">
                            <span className="block truncate text-xs font-black text-zinc-900 dark:text-zinc-100">{s.title}</span>
                            <span className="block truncate text-[11px] font-semibold text-zinc-500">{firstName(s.toName)} · {s.department}{s.supportRequest ? ' · support request' : ''} · {shortDate(s.since.slice(0, 10))}</span>
                            {s.reason && <span className="mt-0.5 block text-[11px] font-semibold text-rose-700 dark:text-rose-300">“{s.reason}”</span>}
                        </button>
                        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                        {s.canRemind && (
                            <button type="button" disabled={!!busy} onClick={() => void doRemind([s.id], s.id)} aria-label={`Remind ${s.toName} about ${s.title}`} title="Send a reminder"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300">
                                {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                            </button>
                        )}
                        <button type="button" disabled={!!busy} onClick={() => void doClear([s], `clear-${keyOf(s)}`)} aria-label={`Clear ${s.title} from your list`} title="Delete from this list"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40">
                            {busy === `clear-${keyOf(s)}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                    </li>
                ))}
            </ul>
            <SentDetails item={shown} onClose={() => setViewing(null)} busy={!!busy}
                onRemind={s => void doRemind([s.id], s.id)} onClear={s => void doClear([s], `clear-${keyOf(s)}`)} />
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
            <ul className={compact ? 'space-y-2' : 'max-h-[420px] space-y-2 overflow-y-auto pr-1'}>
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

const noSubscribe = () => () => {};

/**
 * Owner 2026-10-28: a small window with everything about one item on "Waiting on other teams": the full note, who has
 * it, start date and deadline (or "needed by" for a request), the reason they gave, and the files. Remind and Delete
 * (clears it from my list only).
 */
function SentDetails({ item, onClose, onRemind, onClear, busy }: {
    item: CollabSent | null;
    onClose: () => void;
    onRemind: (s: CollabSent) => void;
    onClear: (s: CollabSent) => void;
    busy: boolean;
}) {
    const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);   // the portal needs the browser
    const [files, setFiles] = useState<WAttachment[] | null>(null);
    const [filesError, setFilesError] = useState<string | null>(null);
    const openKey = item ? `${item.kind}-${item.id}` : null;

    useEffect(() => {
        if (!openKey) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [openKey, onClose]);

    useEffect(() => {
        if (!item) return;
        let live = true;
        setFiles(null); setFilesError(null);
        const q = item.kind === 'request' ? `requestId=${encodeURIComponent(item.id)}` : `taskId=${encodeURIComponent(item.id)}`;
        fetch(`/api/task-manager/attachments?${q}`)
            .then(res => res.json().then(body => ({ ok: res.ok, body })))
            .then(({ ok, body }) => { if (!live) return; if (!ok || !body.success) throw new Error(body.error || 'Could not load the files'); setFiles(body.attachments as WAttachment[]); })
            .catch(err => { if (live) setFilesError(err instanceof Error ? err.message : 'Could not load the files'); });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openKey]);

    if (!mounted || !item) return null;
    const st = STATUS[item.status];
    const row = (term: string, value: React.ReactNode) => (<>
        <dt className="font-semibold text-zinc-500 dark:text-zinc-400">{term}</dt>
        <dd className="min-w-0 break-words font-bold text-zinc-900 dark:text-zinc-100">{value}</dd>
    </>);

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-zinc-950/45 p-4 pt-[10vh] backdrop-blur-[2px]"
            onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="sent-details-title" className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-zinc-900">
                <header className="flex items-start gap-3 border-b border-zinc-200 bg-zinc-50 px-5 pb-4 pt-5 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="min-w-0 flex-1 space-y-2">
                        <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-black ${st.cls}`}>{st.label}</span>
                        <h2 id="sent-details-title" className="whitespace-pre-line break-words text-lg font-black leading-snug text-zinc-900 dark:text-zinc-50">{item.title}</h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-xl bg-black/5 p-2 text-zinc-600 hover:bg-black/10 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/15">
                        <X className="h-4 w-4" />
                    </button>
                </header>
                <div className="space-y-4 px-5 pb-5 pt-4">
                    {item.completionRemark && (
                        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                            Completion remark: {item.completionRemark}
                        </p>
                    )}
                    {item.reason && (
                        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                            {firstName(item.toName)} can&apos;t take it: “{item.reason}”
                        </p>
                    )}
                    <section className="space-y-1.5">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Note</h3>
                        {item.description
                            ? <p className="whitespace-pre-wrap break-words rounded-xl bg-zinc-100 px-3 py-2.5 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">{item.description.replace(/^Remark:\s*/gim, '')}</p>
                            : <p className="text-sm text-zinc-500">No note.</p>}
                    </section>
                    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
                        {row('To', `${item.toName} (${item.department})`)}
                        {row('Type', item.kind === 'request' ? 'Support request' : item.supportRequest ? 'Task (accepted support request)' : 'Task')}
                        {row('Sent', shortDateTime(item.createdAt))}
                        {item.startDate && row('Start date', shortDate(item.startDate))}
                        {item.due && row(item.kind === 'request' ? 'Needed by' : 'Deadline', item.kind === 'request' ? shortDate(item.due.date) : dueLabel(item.due))}
                        {item.status === 'completed' && row('Done', shortDateTime(item.since))}
                    </dl>
                    <section className="space-y-1.5">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Files</h3>
                        {filesError ? <p className="text-xs font-semibold text-rose-700">{filesError}</p>
                            : files === null ? <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
                            : files.length === 0 ? <p className="text-sm text-zinc-500">No files.</p>
                            : (
                                <ul className="space-y-1">
                                    {files.map(f => (
                                        <li key={f.id} className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-bold dark:border-zinc-700">
                                            <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden="true" />
                                            {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-indigo-700 hover:underline dark:text-indigo-300">{f.fileName}</a>
                                                : <span className="min-w-0 flex-1 truncate">{f.fileName}</span>}
                                            <span className="shrink-0 text-zinc-500">{fileSizeLabel(f.fileSize)}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                    </section>
                    <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        {item.canRemind && (
                            <button type="button" disabled={busy} onClick={() => onRemind(item)} className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300">
                                <Bell className="h-4 w-4" aria-hidden="true" /> Remind
                            </button>
                        )}
                        <button type="button" disabled={busy} onClick={() => onClear(item)} className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:bg-zinc-900 dark:text-rose-300">
                            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete from list
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
