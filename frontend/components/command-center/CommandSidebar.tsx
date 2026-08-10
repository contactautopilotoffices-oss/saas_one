'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutGrid, Sparkles, LifeBuoy, CalendarCheck, Users, PackageSearch,
    FileText, Mail, Zap, Droplets, Fuel, Trash2, IndianRupee, ReceiptText,
    Wallet, BarChart3, Files, Settings, LogOut, SlidersHorizontal,
} from 'lucide-react';

/**
 * Command Center navigation.
 *
 * Grouped by what the person is doing, not by which table the data lives in.
 *
 * Entries whose destination does not exist yet render DISABLED rather than
 * being hidden. Hiding them would make the product look smaller than it is;
 * linking them would send people to a 404. A visible, dimmed entry is the
 * honest third option — it shows the shape of the system and admits what is
 * not built.
 */

interface Item {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    /** Path suffix under /:orgId. Omit for "not built yet". */
    path?: string;
}

const GROUPS: Array<{ group: string; items: Item[] }> = [
    {
        group: 'Overview', items: [
            { label: 'Command Center', icon: LayoutGrid, path: 'command-center' },
            { label: 'AI Brief', icon: Sparkles },
        ],
    },
    {
        group: 'Operations', items: [
            { label: 'Tickets', icon: LifeBuoy, path: 'dashboard' },
            { label: 'PPM Calendar', icon: CalendarCheck },
            { label: 'Roster Management', icon: Users },
            { label: 'Material Requests', icon: PackageSearch },
            { label: 'Purchase Orders', icon: FileText, path: 'procurement-management' },
            { label: 'Purchase Mailbox', icon: Mail },
        ],
    },
    {
        group: 'Utilities', items: [
            { label: 'Electricity', icon: Zap },
            { label: 'Water', icon: Droplets },
            { label: 'DG Monitoring', icon: Fuel },
            { label: 'Waste Management', icon: Trash2 },
        ],
    },
    {
        group: 'Finance', items: [
            { label: 'Budget vs Actual', icon: IndianRupee, path: 'aop' },
            { label: 'Invoices', icon: ReceiptText },
            { label: 'Payments', icon: Wallet, path: 'accounts' },
        ],
    },
    {
        group: 'Other', items: [
            { label: 'Reports', icon: BarChart3 },
            { label: 'Documents', icon: Files },
            { label: 'Settings', icon: Settings, path: 'settings' },
        ],
    },
];

interface Props {
    orgId: string;
    userName: string;
    userEmail: string;
    onCustomize?: () => void;
    onSignOut?: () => void;
}

export default function CommandSidebar({ orgId, userName, userEmail, onCustomize, onSignOut }: Props) {
    const pathname = usePathname() || '';

    const initials = userName
        .split(/\s+/).filter(Boolean).slice(0, 2)
        .map(w => w[0]?.toUpperCase() ?? '').join('') || '?';

    return (
        <aside className="w-[228px] flex-none h-screen sticky top-0 bg-sidebar border-r border-sidebar-border
                          flex flex-col overflow-y-auto">
            <div className="px-4 pt-5 pb-1">
                <div className="text-[15px] font-black tracking-[0.14em] text-text-primary">AUTOPILOT</div>
                <div className="text-[9px] font-bold tracking-[0.16em] text-text-tertiary mt-1">
                    SUPER ADMIN CONSOLE
                </div>
            </div>

            <nav className="flex-1 px-2 pb-4">
                {GROUPS.map(({ group, items }) => (
                    <div key={group}>
                        <div className="cc-nav-group">{group}</div>
                        {items.map(({ label, icon: Icon, path }) => {
                            const href = path ? `/${orgId}/${path}` : undefined;
                            const active = !!href && pathname === href;

                            if (!href) {
                                return (
                                    <span
                                        key={label}
                                        className="cc-nav-item"
                                        data-disabled="true"
                                        title="Not available yet"
                                        aria-disabled="true"
                                    >
                                        <Icon className="w-4 h-4 flex-none" />
                                        <span className="truncate">{label}</span>
                                    </span>
                                );
                            }
                            return (
                                <Link
                                    key={label}
                                    href={href}
                                    className="cc-nav-item"
                                    data-active={active ? 'true' : 'false'}
                                    aria-current={active ? 'page' : undefined}
                                >
                                    <Icon className="w-4 h-4 flex-none" />
                                    <span className="truncate">{label}</span>
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </nav>

            <div className="px-3 py-3 border-t border-sidebar-border space-y-2">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-full bg-primary/12 text-primary flex-none
                                     flex items-center justify-center text-[11px] font-black">
                        {initials}
                    </span>
                    <div className="min-w-0">
                        <div className="text-[12px] font-bold text-text-primary truncate">{userName}</div>
                        <div className="text-[10px] font-medium text-text-tertiary truncate">{userEmail}</div>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onSignOut}
                    className="flex items-center gap-2 text-[12px] font-bold text-[var(--error)] px-1 py-1"
                >
                    <LogOut className="w-3.5 h-3.5" /> Sign Out
                </button>

                <button type="button" onClick={onCustomize} className="cc-action" data-block>
                    <SlidersHorizontal className="w-3.5 h-3.5" /> Customize Dashboard
                </button>
            </div>
        </aside>
    );
}
