'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarClock, Check, Clock, Loader2, Plus, Send, Trash2, X } from 'lucide-react';
import { buildPingText } from '@/task-manager/pingMessage';
import { useSuperuserPings } from './useSuperuserPings';
import TimeWheelPicker from './TimeWheelPicker';

/**
 * The "superuser" view (the manager): see the tasks your team gave them, remind them about some or all of them — now or
 * later — with a live preview of the exact WhatsApp message, and set the team's one shared regular reminder.
 * The server decides what is allowed; this screen only shows and sends.
 */

const DAYS = [{ d: 1, l: 'Mon' }, { d: 2, l: 'Tue' }, { d: 3, l: 'Wed' }, { d: 4, l: 'Thu' }, { d: 5, l: 'Fri' }, { d: 6, l: 'Sat' }, { d: 0, l: 'Sun' }];

const pad = (n: number) => String(n).padStart(2, '0');
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** The next quarter-hour at least `minutes` from now (the scheduler runs every 15 minutes). */
function quarterHourFromNow(minutes: number): Date {
    const d = new Date(Date.now() + minutes * 60000);
    d.setSeconds(0, 0);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
    return d;
}
const whenLabel = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });

const STATUS_STYLE: Record<string, string> = {
    scheduled: 'bg-amber-100 text-amber-800', sending: 'bg-amber-100 text-amber-800', sent: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-rose-100 text-rose-800', cancelled: 'bg-zinc-200 text-zinc-600',
};

export default function SuperuserPanel({ onAddTask, onDeleteTask, onChanged }: {
    onAddTask: (recipientId: string, title: string) => Promise<boolean>;
    onDeleteTask: (taskId: string) => Promise<boolean>;
    onChanged: () => void;
}) {
    const { panel, loading, error, send, cancel, saveReminder, reload } = useSuperuserPings(true);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [from, setFrom] = useState('');
    const [note, setNote] = useState('');
    const [whenDate, setWhenDate] = useState('');
    const [whenTime, setWhenTime] = useState('09:00');
    const [newTask, setNewTask] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [rem, setRem] = useState<{ enabled: boolean; time: string; days: number[] } | null>(null);

    // pick everything by default, and keep the picks valid when the list changes
    useEffect(() => {
        if (!panel) return;
        setPicked(prev => {
            const ids = new Set(panel.tasks.map(t => t.id));
            const kept = new Set([...prev].filter(id => ids.has(id)));
            return prev.size === 0 && kept.size === 0 ? ids : kept;
        });
        setFrom(f => f || panel.me.name);
        setRem(r => r || { enabled: panel.reminder.enabled, time: panel.reminder.time, days: panel.reminder.days });
    }, [panel]);

    const when = whenDate ? `${whenDate}T${whenTime}` : '';
    const chosen = useMemo(() => (panel?.tasks || []).filter(t => picked.has(t.id)), [panel, picked]);
    const preview = panel ? buildPingText({ fromLabel: from || panel.me.name, department: panel.department, tasks: chosen.map(t => t.title), note }) : '';

    if (loading && !panel) return <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
    if (error && !panel) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>;
    if (!panel) return null;
    if (!panel.recipient) {
        return <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900">
            {panel.superusers.length ? 'Choose who to work with.' : 'There is no superuser set up to work with yet. Ask an admin to make sure they are switched on for the Task Manager.'}
        </div>;
    }
    const who = panel.recipient;
    const first = 'Manager';

    const flash = (kind: 'ok' | 'err', text: string) => { setMessage({ kind, text }); setTimeout(() => setMessage(null), 5000); };

    const doSend = async (sendAt: string | null, force = false) => {
        if (!chosen.length) return flash('err', 'Choose at least one task first.');
        setBusy('send');
        const r = await send({ taskIds: chosen.map(t => t.id), fromLabel: from, note, sendAt, force });
        setBusy(null);
        if (r.ok) { flash('ok', r.status === 'sent' ? `Sent to ${first}.` : `Scheduled for ${whenLabel(sendAt!)}.`); setNote(''); setWhenDate(''); return; }
        if (r.code === 'RECENT' && window.confirm(`${r.message}`)) return doSend(sendAt, true);
        if (r.code !== 'RECENT') flash('err', r.message);
    };

    const schedule = () => {
        if (!when) return flash('err', 'Pick a date and time first.');
        const t = new Date(when);
        if (t.getTime() <= Date.now()) return flash('err', 'That time has already passed. Pick a later time, or use "Send now".');
        doSend(t.toISOString());
    };

    const addTask = async () => {
        const title = newTask.trim();
        if (!title) return;
        setBusy('add');
        const ok = await onAddTask(who.id, title);
        setBusy(null);
        if (ok) { setNewTask(''); await reload(); onChanged(); }
    };

    const remove = async (id: string) => {
        setBusy(`del-${id}`);
        const ok = await onDeleteTask(id);
        setBusy(null);
        if (ok) { await reload(); onChanged(); }
    };

    const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const card = 'rounded-3xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900';
    const h = 'text-sm font-black text-zinc-900 dark:text-zinc-100';
    const input = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {message && <div className={`lg:col-span-2 rounded-2xl px-4 py-3 text-xs font-bold ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{message.text}</div>}

            {/* 1. what he has from the team */}
            <section className={card} aria-label={`Waiting on ${first}`}>
                <div className="mb-3 flex items-center justify-between">
                    <h3 className={h}>Waiting on {first} <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-black text-zinc-600 dark:bg-zinc-800">{panel.tasks.length}</span></h3>
                    {panel.tasks.length > 0 && (
                        <button type="button" className="text-[11px] font-bold text-indigo-600 hover:underline" onClick={() => setPicked(picked.size === panel.tasks.length ? new Set() : new Set(panel.tasks.map(t => t.id)))}>
                            {picked.size === panel.tasks.length ? 'Clear' : 'Select all'}
                        </button>
                    )}
                </div>
                {panel.tasks.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-xs text-zinc-500 dark:border-zinc-700">Nothing yet. Add a task for the {first.toLowerCase()} below.</p>}
                <ul className="space-y-1.5">
                    {panel.tasks.map(t => (
                        <li key={t.id}>
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-200 p-2.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                                <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                                <span className="min-w-0 flex-1">
                                    <span className="block break-words font-bold text-zinc-900 dark:text-zinc-100">{t.title}</span>
                                    <span className="text-[11px] text-zinc-500">from {t.assignerName}{t.status === 'in_progress' ? ' · in progress' : ''}</span>
                                </span>
                                {t.assignerId === panel.me.id && (
                                    <button type="button" disabled={busy === `del-${t.id}`} aria-label={`Delete ${t.title}`} title="Delete task"
                                        onClick={e => { e.preventDefault(); e.stopPropagation(); remove(t.id); }}
                                        className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/30">
                                        {busy === `del-${t.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                    </button>
                                )}
                            </label>
                        </li>
                    ))}
                </ul>

                <form className="mt-3 flex items-center gap-2" onSubmit={e => { e.preventDefault(); addTask(); }}>
                    <input className={input} value={newTask} onChange={e => setNewTask(e.target.value)} maxLength={200} placeholder={`Add a task for ${first}`} aria-label={`Add a task for ${first}`} />
                    <button type="submit" disabled={busy === 'add' || !newTask.trim()} className="flex shrink-0 items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                        {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                    </button>
                </form>
            </section>

            {/* 2. the message */}
            <section className={card} aria-label="Message">
                <h3 className={`${h} mb-3`}>Remind {first}</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-[11px] font-bold text-zinc-500">From (you can change the name)
                        <input className={`${input} mt-1`} value={from} onChange={e => setFrom(e.target.value)} maxLength={60} />
                    </label>
                    <label className="text-[11px] font-bold text-zinc-500">Department
                        <input className={`${input} mt-1 opacity-70`} value={panel.department} readOnly />
                    </label>
                </div>
                <label className="mt-2 block text-[11px] font-bold text-zinc-500">Note (optional)
                    <textarea className={`${input} mt-1 h-16 resize-none`} value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Anything the manager should know" />
                </label>

                <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-zinc-400">What {first} will see</p>
                <div className="rounded-2xl bg-[#dcf8c6] p-3 text-[13px] leading-relaxed text-zinc-900 shadow-inner dark:bg-emerald-900/40 dark:text-emerald-50">
                    {chosen.length ? <pre className="whitespace-pre-wrap break-words font-sans">{preview}</pre> : <span className="text-zinc-500">Choose at least one task to see the message.</span>}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy === 'send' || !chosen.length} onClick={() => doSend(null)} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
                        {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send now
                    </button>
                    <span className="text-[11px] font-bold text-zinc-400">or later:</span>
                    <input type="date" min={dateInput(new Date())} value={whenDate} onChange={e => setWhenDate(e.target.value)} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-950" aria-label="Date to send" />
                    <TimeWheelPicker value={whenTime} onChange={setWhenTime} ariaLabel="Time to send" />
                    <button type="button" disabled={busy === 'send' || !chosen.length || !whenDate} onClick={schedule} className="flex items-center gap-1.5 rounded-xl border border-indigo-300 px-3 py-2 text-xs font-black text-indigo-700 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300">
                        <Clock className="h-3.5 w-3.5" /> Schedule
                    </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <button type="button" className="rounded-full bg-zinc-100 px-2.5 py-1 font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300" onClick={() => { const d = quarterHourFromNow(60); setWhenDate(dateInput(d)); setWhenTime(timeInput(d)); }}>In 1 hour</button>
                    <button type="button" className="rounded-full bg-zinc-100 px-2.5 py-1 font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 1); setWhenDate(dateInput(d)); setWhenTime('09:00'); }}>Tomorrow 9:00</button>
                </div>
                <p className="mt-2 text-[11px] text-zinc-400">Scheduled reminders go out within 15 minutes of the time you pick.</p>
            </section>

            {/* 3. scheduled and sent */}
            <section className={card} aria-label="Scheduled and sent">
                <h3 className={`${h} mb-3 flex items-center gap-2`}><CalendarClock className="h-4 w-4 text-zinc-400" /> Scheduled and sent</h3>
                {panel.pings.length === 0 && <p className="text-xs text-zinc-500">Nothing yet.</p>}
                <ul className="space-y-1.5">
                    {panel.pings.map(p => (
                        <li key={p.id} className="flex items-center gap-2 rounded-xl border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase ${STATUS_STYLE[p.status] || ''}`}>{p.status}</span>
                            <span className="min-w-0 flex-1 truncate font-semibold text-zinc-700 dark:text-zinc-200">{p.count} task{p.count === 1 ? '' : 's'} · from {p.fromLabel} · {whenLabel(p.sentAt || p.sendAt)}</span>
                            {p.status === 'scheduled' && (
                                <button type="button" disabled={busy === `cancel-${p.id}`} onClick={async () => { setBusy(`cancel-${p.id}`); const e = await cancel(p.id); setBusy(null); if (e) flash('err', e); }}
                                    className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1 text-[11px] font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700"><X className="h-3 w-3" /> Cancel</button>
                            )}
                        </li>
                    ))}
                </ul>
            </section>

            {/* 4. the team's shared regular reminder */}
            <section className={card} aria-label="Regular reminders">
                <h3 className={`${h} mb-1 flex items-center gap-2`}><Bell className="h-4 w-4 text-zinc-400" /> Regular reminders (shared by the whole team)</h3>
                <p className="mb-3 text-[11px] text-zinc-500">One reminder for everyone: the {first.toLowerCase()}&rsquo;s pending tasks from your team, grouped by who gave them.</p>
                {rem && (
                    <>
                        <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-200">
                            <input type="checkbox" checked={rem.enabled} onChange={e => setRem({ ...rem, enabled: e.target.checked })} className="h-4 w-4 accent-indigo-600" /> Send regular reminders
                        </label>
                        <div className="mb-3 flex flex-wrap items-center gap-3">
                            <div className="text-[11px] font-bold text-zinc-500">At
                                <div className="ml-2 inline-block align-middle">
                                    <TimeWheelPicker value={rem.time} onChange={time => setRem({ ...rem, time })} ariaLabel="Reminder time" />
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                                {DAYS.map(({ d, l }) => (
                                    <button key={d} type="button" aria-pressed={rem.days.includes(d)}
                                        onClick={() => setRem({ ...rem, days: rem.days.includes(d) ? rem.days.filter(x => x !== d) : [...rem.days, d].sort() })}
                                        className={`rounded-full px-2.5 py-1 text-[11px] font-black ${rem.days.includes(d) ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>{l}</button>
                                ))}
                            </div>
                        </div>
                        <button type="button" disabled={busy === 'rem'} onClick={async () => { setBusy('rem'); const e = await saveReminder(rem); setBusy(null); flash(e ? 'err' : 'ok', e || 'Saved. This applies to the whole team.'); }}
                            className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
                            {busy === 'rem' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                        </button>
                    </>
                )}
            </section>
        </div>
    );
}
