'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Bell, CheckCircle2, Clock, Eye, Loader2, Lock, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { EASE } from './types';

/**
 * Notifications view: a team sets WHEN its Task Manager messages go out and WHAT they say.
 * Scope and permissions are enforced by the server; this screen never sends anything.
 * "Preview" is a simulation that sends and writes nothing.
 */

type RuleType = 'morning_digest' | 'pending_reminder' | 'eod_summary';
type Field = 'headerGreeting' | 'customMessage' | 'footerInstruction';

interface ServerRule {
    id: string;
    name: string;
    enabled: boolean;
    targetTimeIST: string;
    daysOfWeek: number[];
    ruleType: RuleType;
    customTemplate?: { headerGreeting?: string; customMessage?: string; footerInstruction?: string; includeQuickReplies?: boolean };
    lastRunDate?: string | null;
    lastRunSummary?: string | null;
}

interface Draft {
    key: string;
    id?: string;
    name: string;
    ruleType: RuleType;
    targetTimeIST: string;
    daysOfWeek: number[];
    enabled: boolean;
    headerGreeting: string;
    customMessage: string;
    footerInstruction: string;
    includeQuickReplies: boolean;
    lastRunSummary?: string | null;
}

interface Preview {
    sample: string;
    audience: Array<{ name: string; taskCount: number; status: 'would_receive' | 'not_unlocked' | 'no_tasks' }>;
    pretendMode: boolean;
    sandboxOn: boolean;
}

const TYPES: Array<{ id: RuleType; label: string; time: string; blurb: string; icon: React.ReactNode }> = [
    { id: 'morning_digest', label: 'Morning list', time: '09:00', blurb: 'Everyone gets their tasks for the day.', icon: <Sun className="h-4 w-4" /> },
    { id: 'pending_reminder', label: 'Midday reminder', time: '14:30', blurb: 'Only people with unfinished tasks.', icon: <Clock className="h-4 w-4" /> },
    { id: 'eod_summary', label: 'Evening summary', time: '18:30', blurb: 'What got done and what carries over.', icon: <Moon className="h-4 w-4" /> },
];
const typeOf = (t: RuleType) => TYPES.find(x => x.id === t) ?? TYPES[0];

const DAYS: Array<{ n: number; short: string; long: string }> = [
    { n: 1, short: 'M', long: 'Monday' }, { n: 2, short: 'T', long: 'Tuesday' }, { n: 3, short: 'W', long: 'Wednesday' },
    { n: 4, short: 'T', long: 'Thursday' }, { n: 5, short: 'F', long: 'Friday' }, { n: 6, short: 'S', long: 'Saturday' }, { n: 0, short: 'S', long: 'Sunday' },
];
const VARIABLE_HELP: Record<string, string> = {
    firstName: 'first name', fullName: 'full name', totalTasks: 'task count', pendingTasks: 'unfinished', completedTasks: 'finished', date: 'date',
};

const fromServer = (r: ServerRule): Draft => ({
    key: r.id, id: r.id, name: r.name, ruleType: r.ruleType, targetTimeIST: r.targetTimeIST, daysOfWeek: r.daysOfWeek || [], enabled: r.enabled !== false,
    headerGreeting: r.customTemplate?.headerGreeting || '', customMessage: r.customTemplate?.customMessage || '', footerInstruction: r.customTemplate?.footerInstruction || '',
    includeQuickReplies: r.customTemplate?.includeQuickReplies !== false, lastRunSummary: r.lastRunSummary,
});

const toPayload = (d: Draft) => ({
    id: d.id, name: d.name, ruleType: d.ruleType, targetTimeIST: d.targetTimeIST, daysOfWeek: d.daysOfWeek, enabled: d.enabled,
    customTemplate: { headerGreeting: d.headerGreeting, customMessage: d.customMessage, footerInstruction: d.footerInstruction, includeQuickReplies: d.includeQuickReplies },
});

const signature = (d: Draft) => JSON.stringify({ ...toPayload(d), lastRunSummary: undefined });

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <button
            type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}
        >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
    );
}

function RuleCard({ draft, baseline, canEdit, variables, department, onChange, onSave, onDelete, saving }: {
    draft: Draft; baseline: string | null; canEdit: boolean; variables: string[]; department: string;
    onChange: (d: Draft) => void; onSave: () => void; onDelete: () => void; saving: boolean;
}) {
    const reduce = !!useReducedMotion();
    const [customize, setCustomize] = useState(!!(draft.headerGreeting || draft.customMessage || draft.footerInstruction));
    const [showPreview, setShowPreview] = useState(false);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const lastField = useRef<Field>('customMessage');
    const t = typeOf(draft.ruleType);
    const dirty = baseline === null || baseline !== signature(draft);

    const sig = signature(draft);
    useEffect(() => {
        if (!showPreview) return;
        const timer = setTimeout(async () => {
            setPreviewing(true);
            try {
                const res = await fetch('/api/task-manager/department-rules', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'preview', department, rule: toPayload(draft) }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Preview failed');
                setPreview(data); setPreviewError(null);
            } catch (e) {
                setPreviewError(e instanceof Error ? e.message : 'Preview failed');
            } finally {
                setPreviewing(false);
            }
        }, 450);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showPreview, sig, department]);

    const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
    const toggleDay = (n: number) => set({ daysOfWeek: draft.daysOfWeek.includes(n) ? draft.daysOfWeek.filter(d => d !== n) : [...draft.daysOfWeek, n] });
    const insertVariable = (v: string) => set({ [lastField.current]: `${draft[lastField.current]}{{${v}}}` } as Partial<Draft>);

    const input = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
    const cap = 'text-[10px] font-black uppercase tracking-widest text-zinc-500';

    return (
        <motion.article
            layout={!reduce}
            initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, scale: 0.97 }} transition={{ duration: 0.5, ease: EASE }}
            className={`space-y-4 rounded-3xl border bg-white p-5 shadow-xs dark:bg-zinc-900 ${draft.enabled ? 'border-zinc-200 dark:border-zinc-800' : 'border-dashed border-zinc-300 opacity-80 dark:border-zinc-700'}`}
        >
            <header className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">{t.icon}</span>
                <div className="min-w-0 flex-1">
                    <input id={`rule-name-${draft.key}`} value={draft.name} disabled={!canEdit} onChange={e => set({ name: e.target.value })} maxLength={80} aria-label="Notification name"
                        className="w-full truncate bg-transparent text-sm font-black text-zinc-900 outline-none focus:underline disabled:opacity-100 dark:text-zinc-100" />
                    <p className="text-[11px] text-zinc-500">{t.label}</p>
                </div>
                <Switch on={draft.enabled} disabled={!canEdit} onChange={v => set({ enabled: v })} label={`${draft.name} on or off`} />
            </header>

            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <div>
                    <p className={cap}>Send at (IST)</p>
                    <input id={`rule-time-${draft.key}`} type="time" value={draft.targetTimeIST} disabled={!canEdit} onChange={e => set({ targetTimeIST: e.target.value })} className={`${input} mt-1.5 w-36`} />
                </div>
                <div>
                    <p className={cap}>On these days</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
                        {DAYS.map(d => {
                            const on = draft.daysOfWeek.includes(d.n);
                            return (
                                <button key={d.n} type="button" disabled={!canEdit} onClick={() => toggleDay(d.n)} aria-pressed={on} aria-label={d.long} title={d.long}
                                    className={`h-9 w-9 rounded-full text-xs font-black transition-all disabled:opacity-60 ${on ? 'bg-indigo-600 text-white shadow-sm' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700'}`}>{d.short}</button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {canEdit && (
                <div>
                    <button type="button" onClick={() => setCustomize(c => !c)} className="text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-300">
                        {customize ? 'Use the standard wording' : 'Customize the wording'}
                    </button>
                    <AnimatePresence initial={false}>
                        {customize && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
                                <div className="space-y-3 pt-3">
                                    <label className="block"><span className={cap}>Greeting</span>
                                        <input id={`rule-greeting-${draft.key}`} value={draft.headerGreeting} onFocus={() => { lastField.current = 'headerGreeting'; }} onChange={e => set({ headerGreeting: e.target.value })} maxLength={300} placeholder="Good morning {{firstName}}!" className={`${input} mt-1.5`} /></label>
                                    <label className="block"><span className={cap}>Message</span>
                                        <textarea id={`rule-message-${draft.key}`} rows={2} value={draft.customMessage} onFocus={() => { lastField.current = 'customMessage'; }} onChange={e => set({ customMessage: e.target.value })} maxLength={1000} placeholder="Optional note for the team" className={`${input} mt-1.5 resize-none`} /></label>
                                    <label className="block"><span className={cap}>Closing line</span>
                                        <input id={`rule-footer-${draft.key}`} value={draft.footerInstruction} onFocus={() => { lastField.current = 'footerInstruction'; }} onChange={e => set({ footerInstruction: e.target.value })} maxLength={500} placeholder="You have {{pendingTasks}} left today" className={`${input} mt-1.5`} /></label>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-[11px] font-bold text-zinc-500">Insert:</span>
                                        {variables.map(v => (
                                            <button key={v} type="button" onClick={() => insertVariable(v)} className="rounded-lg bg-zinc-100 px-2 py-1 text-[11px] font-bold text-zinc-700 transition-colors hover:bg-indigo-100 hover:text-indigo-700 dark:bg-zinc-800 dark:text-zinc-300">
                                                {VARIABLE_HELP[v] || v}
                                            </button>
                                        ))}
                                    </div>
                                    <label className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                        <input id={`rule-quick-${draft.key}`} type="checkbox" checked={draft.includeQuickReplies} onChange={e => set({ includeQuickReplies: e.target.checked })} />
                                        Add the reply hints (&ldquo;done 1&rdquo;, &ldquo;done all&rdquo;)
                                    </label>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

            <div>
                <button type="button" onClick={() => setShowPreview(p => !p)} className="flex items-center gap-1.5 text-xs font-bold text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
                    <Eye className="h-3.5 w-3.5" /> {showPreview ? 'Hide preview' : 'Preview this message'}
                </button>
                <AnimatePresence initial={false}>
                    {showPreview && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
                            <div className="mt-3 grid gap-4 md:grid-cols-2">
                                <div className="rounded-2xl bg-[#EFEAE2] p-3 dark:bg-zinc-800">
                                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                        Example message {previewing && <Loader2 className="h-3 w-3 animate-spin" />}
                                    </p>
                                    <div className="whitespace-pre-line rounded-xl rounded-tl-sm bg-white p-3 text-[12px] leading-relaxed text-zinc-800 shadow-sm dark:bg-zinc-900 dark:text-zinc-100">
                                        {previewError ? <span className="text-rose-600">{previewError}</span> : preview?.sample || 'Loading…'}
                                    </div>
                                </div>
                                <div>
                                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">Who this would go to today</p>
                                    {preview && preview.audience.length === 0 && <p className="text-xs text-zinc-500">Nobody right now.</p>}
                                    <ul className="space-y-1">
                                        {preview?.audience.map((a, i) => (
                                            <li key={`${a.name}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                                                <span className="truncate font-semibold text-zinc-800 dark:text-zinc-200">{a.name}</span>
                                                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black ${a.status === 'would_receive' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}`}>
                                                    {a.status === 'would_receive' ? `${a.taskCount} task${a.taskCount === 1 ? '' : 's'}` : a.status === 'not_unlocked' ? 'not unlocked' : 'no tasks'}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                    {preview?.sandboxOn && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">The sandbox is on, so only the test number would really receive messages.</p>}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">{draft.lastRunSummary ? `Last run: ${draft.lastRunSummary}` : 'Has not run yet'}</p>
                {canEdit && (
                    <div className="flex items-center gap-2">
                        {confirmDelete ? (
                            <>
                                <span className="text-xs font-bold text-rose-600">Delete this notification?</span>
                                <button type="button" onClick={onDelete} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-black text-white hover:bg-rose-700">Delete</button>
                                <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-bold dark:border-zinc-700">Keep</button>
                            </>
                        ) : (
                            <>
                                <button type="button" onClick={() => (draft.id ? setConfirmDelete(true) : onDelete())} aria-label="Delete notification" className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"><Trash2 className="h-4 w-4" /></button>
                                <button type="button" disabled={!dirty || saving || draft.daysOfWeek.length === 0} onClick={onSave}
                                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white shadow-sm transition-all hover:bg-indigo-700 disabled:opacity-40">
                                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{dirty ? 'Save changes' : 'Saved'}
                                </button>
                            </>
                        )}
                    </div>
                )}
            </footer>
        </motion.article>
    );
}

export default function NotificationsView({ departmentName = 'Procurement' }: { departmentName?: string }) {
    const reduce = !!useReducedMotion();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [meta, setMeta] = useState<{ delegated: boolean; canEdit: boolean; pretendMode: boolean; sandboxOn: boolean; variables: string[]; departmentName: string } | null>(null);
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [baselines, setBaselines] = useState<Record<string, string>>({});
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const newCounter = useRef(0);

    const say = useCallback((kind: 'ok' | 'err', text: string) => {
        setNotice({ kind, text });
        setTimeout(() => setNotice(n => (n && n.text === text ? null : n)), 3600);
    }, []);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/task-manager/department-rules?department=${encodeURIComponent(departmentName)}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not load notifications');
            const list: Draft[] = (data.rules as ServerRule[]).map(fromServer);
            setDrafts(prev => [...list, ...prev.filter(p => !p.id)]); // keep unsaved new ones
            setBaselines(Object.fromEntries(list.map(d => [d.key, signature(d)])));
            setMeta({ delegated: data.delegated, canEdit: data.canEdit, pretendMode: data.pretendMode, sandboxOn: data.sandboxOn, variables: data.variables, departmentName: data.departmentName });
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load notifications');
        } finally {
            setLoading(false);
        }
    }, [departmentName]);

    useEffect(() => { load(); }, [load]);

    const post = async (body: Record<string, unknown>) => {
        const res = await fetch('/api/task-manager/department-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ department: departmentName, ...body }) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'That did not work');
        return data;
    };

    const save = async (d: Draft) => {
        setSavingKey(d.key);
        try {
            await post({ action: 'save', rule: toPayload(d) });
            setDrafts(prev => prev.filter(x => x.key !== d.key));
            await load();
            say('ok', 'Saved');
        } catch (e) {
            say('err', e instanceof Error ? e.message : 'Could not save');
        } finally {
            setSavingKey(null);
        }
    };

    const remove = async (d: Draft) => {
        if (!d.id) { setDrafts(prev => prev.filter(x => x.key !== d.key)); return; }
        try {
            await post({ action: 'delete', ruleId: d.id });
            setDrafts(prev => prev.filter(x => x.key !== d.key));
            await load();
            say('ok', 'Deleted');
        } catch (e) {
            say('err', e instanceof Error ? e.message : 'Could not delete');
        }
    };

    const addNew = (type: RuleType) => {
        const t = typeOf(type);
        newCounter.current += 1;
        setDrafts(prev => [...prev, {
            key: `new-${newCounter.current}`, name: t.label, ruleType: type, targetTimeIST: t.time, daysOfWeek: [1, 2, 3, 4, 5, 6], enabled: true,
            headerGreeting: '', customMessage: '', footerInstruction: '', includeQuickReplies: true,
        }]);
        setAdding(false);
    };

    const ordered = useMemo(() => drafts, [drafts]);

    if (loading) return <div className="space-y-4" aria-busy="true">{[0, 1].map(i => <div key={i} className="h-56 animate-pulse rounded-3xl bg-zinc-200/70 dark:bg-zinc-800/70" />)}</div>;
    if (error || !meta) {
        return (
            <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error || 'Could not load notifications'}
                <button type="button" onClick={load} className="ml-auto rounded-lg border border-rose-300 px-3 py-1 text-xs font-bold dark:border-rose-800">Try again</button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white"><Bell className="h-5 w-5" /></span>
                <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100">WhatsApp notifications for {meta.departmentName}</h3>
                    <p className="text-xs leading-relaxed text-zinc-500">
                        Choose when your team gets its task messages. A message goes out within about 15 minutes of the time you pick.
                        Your own wording is delivered as written to people who messaged the bot in the last 24 hours; everyone else gets the approved template.
                    </p>
                </div>
            </div>

            {meta.pretendMode && (
                <div className="flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs font-semibold text-indigo-900 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-200">
                    <CheckCircle2 className="h-4 w-4 shrink-0" /> Messages are being simulated right now. Nothing is delivered to anyone yet.
                </div>
            )}
            {!meta.canEdit && (
                <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    <Lock className="h-4 w-4 shrink-0" /> Your administrator manages these settings. You can see the schedule but not change it.
                </div>
            )}

            <AnimatePresence>
                {notice && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status"
                        className={`rounded-2xl px-4 py-2.5 text-xs font-bold ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'}`}>
                        {notice.text}
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
                {ordered.map(d => (
                    <RuleCard key={d.key} draft={d} baseline={d.id ? baselines[d.key] ?? null : null} canEdit={meta.canEdit} variables={meta.variables} department={departmentName}
                        onChange={next => setDrafts(prev => prev.map(x => (x.key === d.key ? next : x)))}
                        onSave={() => save(d)} onDelete={() => remove(d)} saving={savingKey === d.key} />
                ))}
            </AnimatePresence>

            {ordered.length === 0 && (
                <div className="rounded-3xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
                    <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200">No notifications set up yet</p>
                    <p className="mt-1 text-xs text-zinc-500">{meta.canEdit ? 'Add one to send your team their tasks on a schedule.' : 'Your administrator has not set any up yet.'}</p>
                </div>
            )}

            {meta.canEdit && (
                <div>
                    <AnimatePresence initial={false} mode="wait">
                        {adding ? (
                            <motion.div key="picker" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-3 sm:grid-cols-3">
                                {TYPES.map(t => (
                                    <button key={t.id} type="button" onClick={() => addNew(t.id)} className="space-y-1 rounded-2xl border border-zinc-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                                        <span className="flex items-center gap-2 text-sm font-black text-zinc-900 dark:text-zinc-100"><span className="text-indigo-600 dark:text-indigo-300">{t.icon}</span>{t.label}</span>
                                        <span className="block text-[11px] text-zinc-500">{t.blurb}</span>
                                    </button>
                                ))}
                            </motion.div>
                        ) : (
                            <motion.button key="add" type="button" onClick={() => setAdding(true)} initial={false}
                                className="flex items-center gap-1.5 rounded-2xl border border-dashed border-zinc-300 px-4 py-3 text-xs font-black text-zinc-600 transition-colors hover:border-indigo-400 hover:text-indigo-700 dark:border-zinc-700 dark:text-zinc-300">
                                <Plus className="h-4 w-4" /> Add a notification
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}
