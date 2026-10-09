"use client";

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import TaskAssignmentDashboard from './TaskAssignmentDashboard';
import { ConsoleNotifications, ConsoleTasksView, useConsoleTasks } from './ConsoleTasks';

type SubTab = 'my' | 'assign' | 'notifications';

const TABS: ReadonlyArray<{ id: SubTab; label: string }> = [
    { id: 'my', label: 'My tasks' },
    { id: 'assign', label: 'Assign & monitor' },
    { id: 'notifications', label: 'Notifications' },
];

/**
 * Task Manager tab of the admin consoles. For a superuser it adds "My tasks" (all departments) and "Notifications"
 * beside the existing assign-and-monitor screen. Everyone else gets the existing screen, exactly as before.
 */
export default function TaskManagerSuperuserDashboard({ orgId }: { orgId?: string }) {
    const c = useConsoleTasks();
    const [tab, setTab] = useState<SubTab>('my');

    if (c.status === 'loading') {
        return <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
    }
    if (c.status !== 'ok' || !c.data) return <TaskAssignmentDashboard orgId={orgId} isSuperuserView={true} />;

    return (
        <div className="space-y-4">
            <div role="tablist" className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900">
                {TABS.map(t => (
                    <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                        className={`rounded-xl px-4 py-2 text-xs font-bold ${tab === t.id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}>
                        {t.label}
                    </button>
                ))}
            </div>
            {tab === 'my' && <ConsoleTasksView c={c} />}
            {tab === 'assign' && <TaskAssignmentDashboard orgId={orgId} isSuperuserView={true} />}
            {tab === 'notifications' && <ConsoleNotifications departments={c.data.departments} />}
        </div>
    );
}
