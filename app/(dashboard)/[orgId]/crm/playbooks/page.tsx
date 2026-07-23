'use client';

import React from 'react';
import { BookOpen, Play, Clock, Users, ArrowRight } from 'lucide-react';

const PLAYBOOKS = [
    { title: 'New Lead Outreach', steps: 5, desc: 'Standardized first-touch sequence for inbound leads — call, WhatsApp, email cadence.', tag: 'Inbound', color: 'blue' },
    { title: 'Discovery to Demo', steps: 4, desc: 'Qualify requirements, book site visit, and move qualified leads to proposal.', tag: 'Qualification', color: 'violet' },
    { title: 'Enterprise ABM', steps: 7, desc: 'Multi-stakeholder engagement plan for Tier 1 accounts with executive briefings.', tag: 'ABM', color: 'amber' },
    { title: 'Stalled Deal Revival', steps: 3, desc: 'Re-engage cold or stalled pipeline with value-led nudges and incentives.', tag: 'Recovery', color: 'rose' },
    { title: 'Closing & Negotiation', steps: 4, desc: 'Proposal review, objection handling, and contract close best practices.', tag: 'Closing', color: 'emerald' },
    { title: 'Post-Win Onboarding', steps: 5, desc: 'Smooth handoff from sales to delivery, ensuring expansion readiness.', tag: 'Expansion', color: 'slate' },
];

const tagColor: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export default function PlaybooksPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-black text-text-primary tracking-tight">Playbooks</h1>
                <p className="text-sm text-text-secondary mt-1">Repeatable sales motions your team can run with one click</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {PLAYBOOKS.map(p => (
                    <div key={p.title} className="bg-surface rounded-2xl border border-border p-5 hover:border-primary/30 transition-colors group">
                        <div className="flex items-start justify-between mb-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                <BookOpen className="w-5 h-5 text-primary" />
                            </div>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${tagColor[p.color]}`}>{p.tag}</span>
                        </div>
                        <h2 className="text-sm font-black text-text-primary">{p.title}</h2>
                        <p className="text-xs text-text-secondary leading-relaxed mt-1.5">{p.desc}</p>
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                            <span className="text-[11px] text-text-tertiary font-medium flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {p.steps} steps
                            </span>
                            <button className="inline-flex items-center gap-1 text-[11px] font-bold text-primary group-hover:gap-2 transition-all">
                                <Play className="w-3 h-3" /> Run playbook
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
