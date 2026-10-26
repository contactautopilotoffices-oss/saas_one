"use client";

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import SuperuserAssignMonitor from './assign/SuperuserAssignMonitor';
import DepartmentTasksTab from './DepartmentTasksTab';
import { ConsoleNotifications, ConsoleTasksView, useConsoleTasks } from './ConsoleTasks';

type SubTab = 'my' | 'assign' | 'notifications';

// Owner 2026-10-22: "Notifications" is shortened on a phone so all three tabs fit on one row.
const TABS: ReadonlyArray<{ id: SubTab; label: string; phoneLabel: string }> = [
    { id: 'my', label: 'My tasks', phoneLabel: 'My tasks' },
    { id: 'assign', label: 'Assign & monitor', phoneLabel: 'Assign & monitor' },
    { id: 'notifications', label: 'Notifications', phoneLabel: 'Alerts' },
];

/**
 * Task Manager tab of the admin consoles. For a superuser it adds "My tasks" (all departments) and "Notifications"
 * beside the assign-and-monitor screen. Everyone else gets the same Tasks tab Procurement has, for their own department.
 */
export default function TaskManagerSuperuserDashboard({ underFixedHeader = false }: {
    orgId?: string;
    /** The Super Admin console's top bar is fixed on small screens: keep the tabs clear of it (owner 2026-10-22). */
    underFixedHeader?: boolean;
}) {
    const c = useConsoleTasks();
    const [tab, setTab] = useState<SubTab>('my');

    if (c.status === 'loading') {
        return <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
    }
    // Not a superuser: the same Tasks tab Procurement has, for their own department
    if (c.status !== 'ok' || !c.data) return <DepartmentTasksTab />;

    return (
        // Below lg the console's top bar is fixed over the page. On a phone the page's top padding only just clears it, and
        // from md to lg (where md:p-8 wins) it is 32px short, so the tabs get that room back here.
        <div className={`space-y-4 ${underFixedHeader ? 'pt-3 md:pt-10 lg:pt-0' : ''}`}>
            <div>
                <div role="tablist" aria-label="Task Manager" className="grid grid-cols-[1fr_1.35fr_1fr] gap-1 rounded-2xl border border-zinc-200 bg-zinc-100/80 p-1 sm:inline-flex sm:max-w-full dark:border-zinc-800 dark:bg-zinc-900">
                    {TABS.map(t => (
                        <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                            className={`min-h-11 whitespace-nowrap rounded-xl px-2 text-[13px] font-bold sm:px-4 sm:text-sm ${tab === t.id ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>
                            <span className="sm:hidden">{t.phoneLabel}</span>
                            <span className="hidden sm:inline">{t.label}</span>
                        </button>
                    ))}
                </div>
            </div>
            {tab === 'my' && <ConsoleTasksView c={c} />}
            {tab === 'assign' && <SuperuserAssignMonitor />}
            {tab === 'notifications' && <ConsoleNotifications />}
        </div>
    );
}
