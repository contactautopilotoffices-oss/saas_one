'use client';

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Clock, Plus, X } from 'lucide-react';
import { COLUMNS, EASE, WAssignable, WMember, WTask, avatarGradient, initials, shortDate } from './types';

const item = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

function MemberCard({ m, open, done, canAssign, onOpen, onAssign }: {
    m: WMember; open: number; done: number; canAssign: boolean; onOpen: () => void; onAssign: () => void;
}) {
    const total = open + done;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
        <motion.article
            variants={item}
            whileHover={{ y: -3 }}
            className="flex flex-col gap-4 rounded-3xl border border-zinc-200 bg-white p-5 text-center shadow-xs transition-shadow hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
            <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${avatarGradient(m.name)} text-sm font-black text-white shadow-md`}>
                {initials(m.name)}
            </div>
            <div>
                <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100">{m.name}</h3>
                {m.isMe && <span className="mt-1 inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-black text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">You</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div><p className="text-2xl font-black tabular-nums text-zinc-900 dark:text-zinc-100">{open}</p><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Open</p></div>
                <div><p className="text-2xl font-black tabular-nums text-zinc-900 dark:text-zinc-100">{done}</p><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Done</p></div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.name} progress`}>
                <motion.div className="h-full rounded-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: EASE }} />
            </div>
            <div className="flex gap-2">
                <button type="button" onClick={onOpen} className="flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    View tasks
                </button>
                {canAssign && (
                    <button type="button" onClick={onAssign} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white transition-colors hover:bg-indigo-700">
                        <Plus className="h-3.5 w-3.5" /> Assign
                    </button>
                )}
            </div>
        </motion.article>
    );
}

function Drawer({ member, tasks, canAssign, onClose, onAssign }: {
    member: WMember; tasks: WTask[]; canAssign: boolean; onClose: () => void; onAssign: () => void;
}) {
    return (
        <motion.div className="fixed inset-0 z-50 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
            <motion.aside
                role="dialog" aria-modal="true" aria-label={`${member.name}'s tasks`}
                className="relative flex h-full w-full max-w-sm flex-col gap-5 overflow-y-auto bg-white p-6 shadow-2xl dark:bg-zinc-900"
                initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.45, ease: EASE }}
            >
                <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br ${avatarGradient(member.name)} text-xs font-black text-white`}>{initials(member.name)}</div>
                    <h3 className="flex-1 text-base font-black text-zinc-900 dark:text-zinc-100">{member.name}</h3>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
                </div>

                {tasks.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">No open or recent tasks.</p>}

                {COLUMNS.map(col => {
                    const list = tasks.filter(t => t.status === col.id);
                    if (list.length === 0) return null;
                    return (
                        <div key={col.id} className="space-y-2">
                            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400"><span className={`h-2 w-2 rounded-full ${col.dot}`} />{col.label} · {list.length}</p>
                            {list.map(t => (
                                <div key={t.id} className={`rounded-2xl border p-3 ${t.isCarriedForward ? 'border-amber-300/70 bg-amber-50/70 dark:border-amber-700/40 dark:bg-amber-950/20' : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40'}`}>
                                    <p className={`text-[13px] font-bold break-words ${t.status === 'completed' ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-zinc-100'}`}>{t.title}</p>
                                    {t.isCarriedForward && <p className="mt-1.5 flex items-center gap-1 text-[10px] font-black text-amber-700 dark:text-amber-300"><Clock className="h-3 w-3" /> Carried from {shortDate(t.assignedDate)}</p>}
                                </div>
                            ))}
                        </div>
                    );
                })}

                {canAssign && (
                    <button type="button" onClick={onAssign} className="mt-auto flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white transition-colors hover:bg-indigo-700">
                        <Plus className="h-4 w-4" /> Assign a task to {member.name.split(' ')[0]}
                    </button>
                )}
            </motion.aside>
        </motion.div>
    );
}

export default function TeamView({ members, tasks, assignable, onAssign }: {
    members: WMember[]; tasks: WTask[]; assignable: WAssignable[]; onAssign: (userId: string) => void;
}) {
    const reduce = !!useReducedMotion();
    const [openId, setOpenId] = useState<string | null>(null);

    // Counts come from the tasks on screen, so they stay correct the moment a card is moved.
    const stats = useMemo(() => {
        const map = new Map<string, { open: number; done: number }>();
        members.forEach(m => map.set(m.userId, { open: 0, done: 0 }));
        tasks.forEach(t => {
            const s = map.get(t.ownerId);
            if (!s) return;
            if (t.status === 'completed') s.done++; else s.open++;
        });
        return map;
    }, [members, tasks]);

    const canAssign = (id: string) => assignable.some(a => a.userId === id);
    const opened = members.find(m => m.userId === openId) || null;

    return (
        <>
            <motion.div
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
                initial={reduce ? false : 'hidden'}
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.08 } } }}
            >
                {members.map(m => (
                    <MemberCard
                        key={m.userId}
                        m={m}
                        open={stats.get(m.userId)?.open ?? 0}
                        done={stats.get(m.userId)?.done ?? 0}
                        canAssign={canAssign(m.userId)}
                        onOpen={() => setOpenId(m.userId)}
                        onAssign={() => onAssign(m.userId)}
                    />
                ))}
            </motion.div>

            <AnimatePresence>
                {opened && (
                    <Drawer
                        member={opened}
                        tasks={tasks.filter(t => t.ownerId === opened.userId)}
                        canAssign={canAssign(opened.userId)}
                        onClose={() => setOpenId(null)}
                        onAssign={() => { setOpenId(null); onAssign(opened.userId); }}
                    />
                )}
            </AnimatePresence>
        </>
    );
}
