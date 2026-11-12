'use client';

import React from 'react';

export interface Ring { name: string; detail: string; pct: number }

const COLORS = [
    { stroke: '#4f46e5', track: '#eef2ff' },
    { stroke: '#059669', track: '#e6f7f1' },
    { stroke: '#d97706', track: '#fff4e5' },
];

/** Organisation progress: three nested rings (company-wide, departments, staff) with a legend. */
export default function ProgressRings({ rings, caption }: { rings: [Ring, Ring, Ring]; caption: string }) {
    const radii = [64, 49, 34];
    const label = rings.map(r => `${r.name} ${r.pct}%`).join(', ');
    return (
        <section aria-labelledby="org-progress-title" className="flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 sm:gap-6 sm:px-5 dark:border-zinc-800 dark:bg-zinc-900">
            <svg role="img" aria-label={label} viewBox="0 0 150 150" className="h-[100px] w-[100px] shrink-0 sm:h-[140px] sm:w-[140px]">
                {rings.map((r, i) => {
                    const circ = 2 * Math.PI * radii[i];
                    return (
                        <g key={r.name + i}>
                            <circle cx="75" cy="75" r={radii[i]} fill="none" stroke={COLORS[i].track} strokeWidth="11" className="dark:opacity-20" />
                            <circle cx="75" cy="75" r={radii[i]} fill="none" stroke={COLORS[i].stroke} strokeWidth="11" strokeLinecap="round"
                                strokeDasharray={`${Math.max(0.001, (circ * r.pct) / 100)} ${circ}`} transform="rotate(-90 75 75)" />
                        </g>
                    );
                })}
                <text x="75" y="81" textAnchor="middle" fontSize="18" fontWeight="700" className="fill-zinc-900 dark:fill-zinc-100">{rings[0].pct}%</text>
            </svg>
            <div className="min-w-0 flex-1 space-y-2.5">
                <div>
                    <h2 id="org-progress-title" className="text-[15px] font-bold text-zinc-900 sm:text-base dark:text-zinc-100">Organisation progress</h2>
                    <p className="hidden text-[13px] text-zinc-600 sm:block dark:text-zinc-400">{caption}</p>
                </div>
                {rings.map((r, i) => (
                    <div key={r.name + i} className="flex items-center gap-2.5 text-[13px] sm:text-sm">
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[i].stroke }} />
                        <span className="truncate font-semibold text-zinc-800 dark:text-zinc-200">{r.name}</span>
                        <span className="hidden truncate text-zinc-500 sm:inline">{r.detail}</span>
                        <span className="ml-auto font-bold text-zinc-900 dark:text-zinc-100">{r.pct}%</span>
                    </div>
                ))}
            </div>
        </section>
    );
}
