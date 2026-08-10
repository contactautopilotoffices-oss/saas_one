'use client';

import React from 'react';
import { Bell, CalendarDays, Plus } from 'lucide-react';

/**
 * The teal masthead.
 *
 * Greets by time of day and states, in one line, how fresh the board is. The
 * sync stamp sits here rather than on each card because the whole page shares a
 * refresh cycle — repeating "2 min ago" sixteen times would be noise.
 */

function greetingFor(d: Date): string {
    const h = d.getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
}

function agoLabel(ts: number | null): string {
    if (!ts) return 'never';
    const mins = Math.floor((Date.now() - ts) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
    firstName: string;
    syncedAt: number | null;
    notificationCount?: number;
    onAddWidget?: () => void;
    onOpenNotifications?: () => void;
    onOpenCalendar?: () => void;
}

export default function CommandHeader({
    firstName, syncedAt, notificationCount = 0,
    onAddWidget, onOpenNotifications, onOpenCalendar,
}: Props) {
    // Rendered client-side only so the greeting matches the viewer's clock
    // rather than the server's, and so the relative stamp stays honest.
    const [now, setNow] = React.useState<Date | null>(null);
    React.useEffect(() => {
        setNow(new Date());
        const t = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(t);
    }, []);

    return (
        <header className="cc-header">
            <div className="min-w-0 flex-1">
                <h1 className="cc-greeting truncate">
                    {now ? greetingFor(now) : 'Hello'}, {firstName} <span aria-hidden="true">👋</span>
                </h1>
                <p className="cc-greeting-sub">
                    Here&apos;s what&apos;s happening across your portfolio today.
                </p>
            </div>

            <div className="flex items-center gap-3 flex-none">
                <div className="cc-sync" title="Dashboard data freshness">
                    <span>Data synced</span>
                    <span>{now ? agoLabel(syncedAt) : '—'}</span>
                </div>

                <button
                    type="button"
                    className="cc-hicon"
                    onClick={onOpenNotifications}
                    aria-label={notificationCount > 0
                        ? `Notifications, ${notificationCount} unread`
                        : 'Notifications'}
                >
                    <Bell className="w-4 h-4" />
                    {notificationCount > 0 && (
                        <span className="cc-hicon-badge" aria-hidden="true">
                            {notificationCount > 99 ? '99+' : notificationCount}
                        </span>
                    )}
                </button>

                <button type="button" className="cc-hicon" onClick={onOpenCalendar} aria-label="Calendar">
                    <CalendarDays className="w-4 h-4" />
                </button>

                <button type="button" className="cc-add" onClick={onAddWidget}>
                    <Plus className="w-4 h-4" />
                    Add Widget
                </button>
            </div>
        </header>
    );
}
