'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE } from './types';

function useCountUp(target: number, reduce: boolean) {
    const [value, setValue] = useState(0);
    const from = useRef(0);

    useEffect(() => {
        if (reduce) return; // reduced motion: the value is shown directly, no animation
        const start = performance.now();
        const a = from.current;
        let raf = 0;
        const tick = (now: number) => {
            const p = Math.min(1, (now - start) / 700);
            const eased = 1 - Math.pow(1 - p, 3);
            setValue(Math.round(a + (target - a) * eased));
            if (p < 1) raf = requestAnimationFrame(tick); else from.current = target;
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, reduce]);

    return reduce ? target : value;
}

function Ring({ pct, reduce }: { pct: number; reduce: boolean }) {
    const r = 24;
    const c = 2 * Math.PI * r;
    return (
        <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0 -rotate-90" aria-hidden="true">
            <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-zinc-200 dark:stroke-zinc-800" />
            <motion.circle
                cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
                className="stroke-emerald-500"
                strokeDasharray={c}
                initial={{ strokeDashoffset: reduce ? c * (1 - pct / 100) : c }}
                animate={{ strokeDashoffset: c * (1 - pct / 100) }}
                transition={{ duration: reduce ? 0 : 0.9, ease: EASE }}
            />
        </svg>
    );
}

const item = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

export interface StatCounts { todo: number; doing: number; done: number; carried: number }

export default function StatCards({ counts }: { counts: StatCounts }) {
    const reduce = !!useReducedMotion();
    const total = counts.todo + counts.doing + counts.done;
    const pct = total > 0 ? Math.round((counts.done / total) * 100) : 0;

    const todo = useCountUp(counts.todo, reduce);
    const doing = useCountUp(counts.doing, reduce);
    const done = useCountUp(counts.done, reduce);
    const carried = useCountUp(counts.carried, reduce);
    const pctShown = useCountUp(pct, reduce);

    const card = 'rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-xs';
    const label = 'text-[10px] font-black uppercase tracking-widest text-zinc-400';

    return (
        <motion.div
            className="grid grid-cols-2 lg:grid-cols-5 gap-3"
            initial={reduce ? false : 'hidden'}
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } }}
        >
            <motion.div variants={item} className={`${card} col-span-2 lg:col-span-1 flex items-center gap-3`}>
                <div className="relative">
                    <Ring pct={pct} reduce={reduce} />
                    <span className="absolute inset-0 flex items-center justify-center text-[13px] font-black tabular-nums text-zinc-900 dark:text-zinc-100">{pctShown}%</span>
                </div>
                <div>
                    <p className={label}>Progress</p>
                    <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{counts.done} of {total} done</p>
                </div>
            </motion.div>

            <motion.div variants={item} className={card}>
                <p className={`${label} flex items-center gap-1.5`}><span className="w-2 h-2 rounded-full bg-zinc-400" />To do</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-zinc-900 dark:text-zinc-100">{todo}</p>
            </motion.div>
            <motion.div variants={item} className={card}>
                <p className={`${label} flex items-center gap-1.5`}><span className="w-2 h-2 rounded-full bg-indigo-500" />In progress</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-zinc-900 dark:text-zinc-100">{doing}</p>
            </motion.div>
            <motion.div variants={item} className={card}>
                <p className={`${label} flex items-center gap-1.5`}><span className="w-2 h-2 rounded-full bg-emerald-500" />Done</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-zinc-900 dark:text-zinc-100">{done}</p>
            </motion.div>
            <motion.div variants={item} className={`${card} ${counts.carried > 0 ? 'border-amber-300/70 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                <p className={`${label} flex items-center gap-1.5 ${counts.carried > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}><span className="w-2 h-2 rounded-full bg-amber-400" />Carried forward</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-zinc-900 dark:text-zinc-100">{carried}</p>
            </motion.div>
        </motion.div>
    );
}
