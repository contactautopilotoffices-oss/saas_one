'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ClipboardList, CheckCircle2, Circle, Clock, ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { TextShimmer } from '@/frontend/components/ui/text-shimmer';

interface Task {
    id: string;
    company_name: string;
    contact_person: string;
    status_name: string;
    next_followup_date: string | null;
    last_update: string | null;
    priority: string;
}

export default function TasksPage() {
    const params = useParams();
    const router = useRouter();
    const orgId = params?.orgId as string;
    const { membership } = useAuth();
    const [leads, setLeads] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        fetch(`/api/crm/leads?sort=updated_at&order=desc&limit=50`)
            .then(r => r.ok ? r.json() : { leads: [] })
            .then(data => {
                const tasks = (data.leads || []).filter((l: any) =>
                    l.next_followup_date || /hold|action|pending/i.test(l.status_info?.name || '')
                ).map((l: any) => ({
                    id: l.id,
                    company_name: l.company_name,
                    contact_person: l.contact_person,
                    status_name: l.status_info?.name || 'Unknown',
                    next_followup_date: l.next_followup_date,
                    last_update: l.updated_at,
                    priority: l.priority || 'Medium',
                }));
                setLeads(tasks);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center animate-pulse">
                    <ClipboardList className="w-6 h-6 text-primary" />
                </div>
                <TextShimmer duration={1.2} className="text-sm font-bold" baseColor="#64748b" gradientColor="#cbd5e1">
                    Loading tasks…
                </TextShimmer>
            </div>
        );
    }

    const overdue = leads.filter(l => l.next_followup_date && new Date(l.next_followup_date) < new Date());
    const upcoming = leads.filter(l => l.next_followup_date && new Date(l.next_followup_date) >= new Date());
    const noDate = leads.filter(l => !l.next_followup_date);

    const priorityColor = (p: string) => {
        if (/high|urgent/i.test(p)) return 'text-rose-500';
        if (/medium/i.test(p)) return 'text-amber-500';
        return 'text-emerald-500';
    };

    const renderTask = (task: Task) => (
        <div
            key={task.id}
            onClick={() => router.push(`/${orgId}/crm/leads?lead=${task.id}`)}
            className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-elevated cursor-pointer transition-colors"
        >
            <Circle className="w-4 h-4 text-border flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-text-primary truncate">{task.company_name || task.contact_person}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5">{task.status_name}</p>
            </div>
            <span className={`text-[10px] font-black uppercase ${priorityColor(task.priority)}`}>{task.priority}</span>
            {task.next_followup_date && (
                <span className={`text-[10px] font-medium flex-shrink-0 ${
                    new Date(task.next_followup_date) < new Date() ? 'text-rose-500' : 'text-text-tertiary'
                }`}>
                    {new Date(task.next_followup_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
            )}
            <ChevronRight className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-text-primary tracking-tight">Tasks</h1>
                    <p className="text-sm text-text-secondary mt-1">All pending actions across your leads</p>
                </div>
            </div>

            {leads.length === 0 ? (
                <div className="bg-surface rounded-2xl border border-border flex flex-col items-center justify-center py-16">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
                    <p className="text-sm font-bold text-text-secondary">No pending tasks</p>
                    <p className="text-xs text-text-tertiary mt-1">All your leads are up to date</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {overdue.length > 0 && (
                        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                            <div className="px-5 py-3 border-b border-border bg-rose-50/50 dark:bg-rose-950/20">
                                <h2 className="text-xs font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                                    Overdue · {overdue.length}
                                </h2>
                            </div>
                            <div className="divide-y divide-border">{overdue.map(renderTask)}</div>
                        </div>
                    )}
                    {upcoming.length > 0 && (
                        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                            <div className="px-5 py-3 border-b border-border">
                                <h2 className="text-xs font-black text-text-secondary uppercase tracking-wider">
                                    Upcoming · {upcoming.length}
                                </h2>
                            </div>
                            <div className="divide-y divide-border">{upcoming.map(renderTask)}</div>
                        </div>
                    )}
                    {noDate.length > 0 && (
                        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
                            <div className="px-5 py-3 border-b border-border">
                                <h2 className="text-xs font-black text-text-tertiary uppercase tracking-wider">
                                    No Due Date · {noDate.length}
                                </h2>
                            </div>
                            <div className="divide-y divide-border">{noDate.map(renderTask)}</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
