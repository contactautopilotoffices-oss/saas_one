'use client';

import React from 'react';
import { Target, Building2, TrendingUp } from 'lucide-react';

const ABM_ACCOUNTS = [
    { account: 'TechMahindra', tier: 1, score: 92, people: 12, activities: 6, pipeline: '₹1.2 Cr', action: 'Executive Briefing' },
    { account: 'Reliance Retail', tier: 1, score: 88, people: 9, activities: 5, pipeline: '₹98.4 L', action: 'Solution Workshop' },
    { account: 'HDFC Bank', tier: 1, score: 85, people: 10, activities: 4, pipeline: '₹76.5 L', action: 'Stakeholder Meeting' },
    { account: 'Tata Motors', tier: 2, score: 72, people: 7, activities: 3, pipeline: '₹42.3 L', action: 'Product Demo' },
    { account: 'Aditya Birla Group', tier: 2, score: 68, people: 6, activities: 2, pipeline: '₹28.6 L', action: 'Nurture Campaign' },
];

export default function AbmTrackerPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-black text-text-primary tracking-tight">ABM Tracker</h1>
                <p className="text-sm text-text-secondary mt-1">Account-based marketing — engagement and pipeline across key accounts</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-surface rounded-2xl border border-border p-5">
                    <Target className="w-5 h-5 text-violet-500 mb-2" />
                    <p className="text-2xl font-black text-text-primary">{ABM_ACCOUNTS.length}</p>
                    <p className="text-xs text-text-tertiary font-medium">Tracked Accounts</p>
                </div>
                <div className="bg-surface rounded-2xl border border-border p-5">
                    <Building2 className="w-5 h-5 text-blue-500 mb-2" />
                    <p className="text-2xl font-black text-text-primary">{ABM_ACCOUNTS.filter(a => a.tier === 1).length}</p>
                    <p className="text-xs text-text-tertiary font-medium">Tier 1 Accounts</p>
                </div>
                <div className="bg-surface rounded-2xl border border-border p-5">
                    <TrendingUp className="w-5 h-5 text-emerald-500 mb-2" />
                    <p className="text-2xl font-black text-text-primary">81</p>
                    <p className="text-xs text-text-tertiary font-medium">Avg Engagement</p>
                </div>
            </div>

            <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border">
                    <h2 className="text-sm font-black text-text-primary">Target Accounts</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-[10px] text-text-tertiary uppercase tracking-wider">
                                <th className="text-left font-bold py-3 px-4">Account</th>
                                <th className="text-left font-bold py-3 px-4">Tier</th>
                                <th className="text-left font-bold py-3 px-4">Engagement</th>
                                <th className="text-right font-bold py-3 px-4">People</th>
                                <th className="text-right font-bold py-3 px-4">Activities</th>
                                <th className="text-right font-bold py-3 px-4">Pipeline</th>
                                <th className="text-left font-bold py-3 px-4">Next Best Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {ABM_ACCOUNTS.map(a => (
                                <tr key={a.account} className="hover:bg-surface-elevated transition-colors">
                                    <td className="py-3 px-4 font-bold text-text-primary">{a.account}</td>
                                    <td className="py-3 px-4">
                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded ${a.tier === 1 ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Tier {a.tier}</span>
                                    </td>
                                    <td className="py-3 px-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-20 h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                                                <div className="h-full rounded-full bg-gradient-to-r from-rose-400 to-amber-400" style={{ width: `${a.score}%` }} />
                                            </div>
                                            <span className="text-xs font-bold text-text-secondary">{a.score}</span>
                                        </div>
                                    </td>
                                    <td className="py-3 px-4 text-right text-text-secondary">{a.people}</td>
                                    <td className="py-3 px-4 text-right text-text-secondary">{a.activities}</td>
                                    <td className="py-3 px-4 text-right font-bold text-text-primary">{a.pipeline}</td>
                                    <td className="py-3 px-4 text-text-secondary">{a.action}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
