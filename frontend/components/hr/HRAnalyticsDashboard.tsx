'use client';

import React, { useState, useEffect } from 'react';
import { BarChart3, PieChart, TrendingUp, Clock, AlertTriangle, CheckCircle2, ShieldCheck, Filter } from 'lucide-react';

interface HRAnalyticsDashboardProps {
    orgId: string;
    tickets: any[];
}

export default function HRAnalyticsDashboard({ orgId, tickets }: HRAnalyticsDashboardProps) {
    const totalCount = tickets.length;
    const grievancesCount = tickets.filter(t => t.ticket_type === 'grievance').length;
    const queriesCount = tickets.filter(t => t.ticket_type === 'hr_query').length;
    const confidentialCount = tickets.filter(t => t.is_confidential || t.is_anonymous).length;

    const resolvedTickets = tickets.filter(t => ['resolved', 'closed'].includes(t.status));
    const resolvedCount = resolvedTickets.length;
    const openCount = totalCount - resolvedCount;

    // SLA compliance calculation
    const slaBreachedTickets = tickets.filter(t => t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status));
    const slaBreachCount = slaBreachedTickets.length;
    const slaCompliancePct = totalCount > 0 ? Math.round(((totalCount - slaBreachCount) / totalCount) * 100) : 100;

    // Category breakdown
    const categoryCounts: { [key: string]: number } = {};
    tickets.forEach(t => {
        const catName = t.category?.category_name || t.category_id || 'Uncategorized';
        categoryCounts[catName] = (categoryCounts[catName] || 0) + 1;
    });
    const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

    // Location / Property breakdown
    const locationCounts: { [key: string]: number } = {};
    tickets.forEach(t => {
        const loc = t.employee_snapshot?.location || 'Main Site';
        locationCounts[loc] = (locationCounts[loc] || 0) + 1;
    });

    return (
        <div className="space-y-6">
            {/* Top Analytics Banner */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-2xl">
                        <BarChart3 className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                            HR MIS & Governance Analytics
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Organization-wide SLA compliance, grievance trends, resolution ageing, and category breakdowns.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        {slaCompliancePct}% SLA Compliance
                    </span>
                </div>
            </div>

            {/* KPI Stat Overview Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                        <span>Total Tickets</span>
                        <BarChart3 className="w-4 h-4 text-indigo-500" />
                    </div>
                    <div className="text-3xl font-black text-slate-900 dark:text-white mt-2">{totalCount}</div>
                    <div className="text-[11px] text-slate-500 mt-1">
                        {grievancesCount} Grievances | {queriesCount} HR Queries
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-emerald-200 dark:border-emerald-900/40 shadow-sm">
                    <div className="flex items-center justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <span>Resolution Rate</span>
                        <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
                        {totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 100}%
                    </div>
                    <div className="text-[11px] text-emerald-600/80 mt-1">
                        {resolvedCount} Closed / {openCount} Active
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-amber-200 dark:border-amber-900/40 shadow-sm">
                    <div className="flex items-center justify-between text-xs font-semibold text-amber-600 dark:text-amber-400">
                        <span>SLA Breaches</span>
                        <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div className="text-3xl font-black text-amber-600 dark:text-amber-400 mt-2">{slaBreachCount}</div>
                    <div className="text-[11px] text-amber-600/80 mt-1">
                        Requires HR Head / Escalation intervention
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-purple-200 dark:border-purple-900/40 shadow-sm">
                    <div className="flex items-center justify-between text-xs font-semibold text-purple-600 dark:text-purple-400">
                        <span>Confidential Cases</span>
                        <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div className="text-3xl font-black text-purple-600 dark:text-purple-400 mt-2">{confidentialCount}</div>
                    <div className="text-[11px] text-purple-600/80 mt-1">
                        Director Level & Masked Feedback
                    </div>
                </div>
            </div>

            {/* Visual Breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Category-wise Breakdown */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <PieChart className="w-4 h-4 text-indigo-500" />
                        Top Ticket Categories
                    </h3>
                    <div className="space-y-3">
                        {topCategories.length === 0 ? (
                            <p className="text-xs text-slate-400">No ticket category data recorded yet.</p>
                        ) : (
                            topCategories.map(([catName, cnt]) => {
                                const pct = totalCount > 0 ? Math.round((cnt / totalCount) * 100) : 0;
                                return (
                                    <div key={catName} className="space-y-1">
                                        <div className="flex justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                                            <span className="truncate">{catName}</span>
                                            <span className="font-bold">{cnt} ({pct}%)</span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-indigo-600 rounded-full"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Location / Site Breakdown */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-indigo-500" />
                        Location-wise Distribution
                    </h3>
                    <div className="space-y-3">
                        {Object.keys(locationCounts).length === 0 ? (
                            <p className="text-xs text-slate-400">No location data recorded yet.</p>
                        ) : (
                            Object.entries(locationCounts).map(([locName, cnt]) => {
                                const pct = totalCount > 0 ? Math.round((cnt / totalCount) * 100) : 0;
                                return (
                                    <div key={locName} className="space-y-1">
                                        <div className="flex justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                                            <span>{locName}</span>
                                            <span className="font-bold">{cnt} ({pct}%)</span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500 rounded-full"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
