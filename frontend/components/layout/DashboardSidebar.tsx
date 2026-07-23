'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import {
    LayoutDashboard, Users, Ticket, Package, Settings, LogOut,
    Menu, X, GitMerge, Calendar, ShoppingCart, UsersRound, BarChart3,
    FileUp, Bot, Building2, Send, CalendarDays, Droplets, Coffee,
    Sparkles, DollarSign, ClipboardList, Target, TrendingUp,
    BellRing, HelpCircle, Megaphone, Radio, BookOpen, Smartphone, MessageSquarePlus
} from 'lucide-react';
import CapabilityWrapper from '../auth/CapabilityWrapper';
import { useAuth } from '@/frontend/context/AuthContext';
import FeedbackModal from '../ui/FeedbackModal';
import { isBdSuperAdmin as checkBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';
import SignOutModal from '../ui/SignOutModal';
import ThemeToggle from '../ui/ThemeToggle';
import { motion, AnimatePresence } from 'framer-motion';

interface DashboardSidebarProps {
    isMobileOpen?: boolean;
    onMobileClose?: () => void;
}

export default function DashboardSidebar({ isMobileOpen, onMobileClose }: DashboardSidebarProps) {
    const pathname = usePathname();
    const params = useParams();
    const orgId = params.orgId as string;
    const { signOut, user, membership } = useAuth();
    const [showSignOutModal, setShowSignOutModal] = React.useState(false);
    const [showFeedbackModal, setShowFeedbackModal] = React.useState(false);

    const userRole = user?.user_metadata?.role;
    // Gate the BD Super Admin nav off the SAME source as page.tsx / layout.tsx /
    // CrmOnboardingGate (email allowlist + membership.org_role) so all four
    // call sites agree. user_metadata.role is not reliably populated.
    const isBdSuperAdmin = checkBdSuperAdmin(user?.email, membership?.org_role);
    const isBDRole = userRole === 'bd_rep' || userRole === 'bd_admin' || isBdSuperAdmin;

    const NAV_ITEMS = React.useMemo(() => {
        const isAdmin = userRole === 'org_super_admin' || userRole === 'property_admin';

        if (isBDRole) return [];

        const items = [
            { label: 'Overview', href: `/${orgId}/dashboard`, icon: LayoutDashboard, domain: 'dashboards' as const },
            { label: 'Tickets', href: `/${orgId}/dashboard`, icon: Ticket, domain: 'tickets' as const },
            { label: 'Flow Map', href: `/${orgId}/flow-map`, icon: GitMerge, domain: 'tickets' as const },
            { label: 'Inventory', href: `/${orgId}/procurement-management`, icon: Package, domain: 'procurement' as const },
            { label: 'Procurement', href: `/${orgId}/procurement-management`, icon: ShoppingCart, domain: 'procurement' as const },
            { label: 'Staff', href: `/${orgId}/users`, icon: Users, domain: 'users' as const },
        ];

        if (isAdmin) {
            items.push({ label: 'AI Automation', href: `/${orgId}/ai-tickets`, icon: Bot, domain: 'dashboards' as const });
            items.push({ label: 'Roster Management', href: `/${orgId}/dashboard?tab=roster`, icon: CalendarDays, domain: 'dashboards' as const });
            items.push({ label: 'Client Support', href: `/${orgId}/dashboard?tab=guest_experience`, icon: Smartphone, domain: 'dashboards' as const });
        }

        items.push({ label: 'Cafeteria', href: `/${orgId}/dashboard?tab=cafeteria`, icon: Coffee, domain: 'dashboards' as const });
        items.push({ label: 'Water Level', href: `/${orgId}/dashboard?tab=water_logger`, icon: Droplets, domain: 'dashboards' as const });

        if (userRole === 'org_super_admin') {
            items.push({ label: 'Water Analytics', href: `/${orgId}/dashboard?tab=water`, icon: Droplets, domain: 'dashboards' as const });
        }

        return items;
    }, [orgId, userRole, isBDRole]);

    const isCrmAdmin = userRole && userRole !== 'bd_rep';
    const CRM_NAV_ITEMS = React.useMemo(() => {
        const items = [
            { label: 'Dashboard', href: `/${orgId}/crm`, icon: LayoutDashboard, domain: 'crm' as const },
            { label: 'My Leads', href: `/${orgId}/crm/leads`, icon: UsersRound, domain: 'crm' as const },
            { label: 'Follow Ups', href: `/${orgId}/crm/followups`, icon: BellRing, domain: 'crm' as const },
            { label: 'Calendar', href: `/${orgId}/crm/calendar`, icon: Calendar, domain: 'crm' as const },
            { label: 'Tasks', href: `/${orgId}/crm/tasks`, icon: ClipboardList, domain: 'crm' as const },
            { label: 'Target', href: `/${orgId}/crm/target`, icon: Target, domain: 'crm' as const },
            { label: 'AI Copilot', href: `/${orgId}/crm/ai`, icon: Sparkles, domain: 'crm' as const },
            { label: 'Performance', href: `/${orgId}/crm/performance`, icon: TrendingUp, domain: 'crm' as const },
        ];
        if (isCrmAdmin) {
            items.push({ label: 'Settings', href: `/${orgId}/crm/settings`, icon: Settings, domain: 'crm' as const });
        }
        items.push({ label: 'Help & Support', href: `/${orgId}/crm/help`, icon: HelpCircle, domain: 'crm' as const });
        return items;
    }, [orgId, isCrmAdmin]);

    // BD Super Admin (CEO) portal — grouped OVERVIEW / TOOLS sections.
    const BD_SUPER_NAV_SECTIONS = React.useMemo(() => [
        {
            title: 'Overview',
            items: [
                { label: 'CEO Dashboard', href: `/${orgId}/crm`, icon: LayoutDashboard },
                { label: 'Campaigns', href: `/${orgId}/crm/campaigns`, icon: Megaphone },
                { label: 'Leads', href: `/${orgId}/crm/leads`, icon: UsersRound },
                { label: 'ABM Tracker', href: `/${orgId}/crm/abm`, icon: Target },
                { label: 'Team Performance', href: `/${orgId}/crm/performance`, icon: TrendingUp },
                { label: 'Reports', href: `/${orgId}/crm/reports`, icon: BarChart3 },
            ],
        },
        {
            title: 'Tools',
            items: [
                { label: 'AI Agent', href: `/${orgId}/crm/ai`, icon: Bot },
                { label: 'Calendar', href: `/${orgId}/crm/calendar`, icon: Calendar },
                { label: 'Tasks', href: `/${orgId}/crm/tasks`, icon: ClipboardList },
                { label: 'Signals', href: `/${orgId}/crm/signals`, icon: Radio },
                { label: 'Playbooks', href: `/${orgId}/crm/playbooks`, icon: BookOpen },
            ],
        },
    ], [orgId]);

    const getUserInitials = (name: string) => {
        return name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U';
    };

    // Close sidebar when clicking a link on mobile
    const handleLinkClick = () => {
        if (isMobileOpen && onMobileClose) {
            onMobileClose();
        }
    };

    return (
        <>
            {/* Mobile Overlay */}
            <AnimatePresence>
                {isMobileOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                        onClick={onMobileClose}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={`
                fixed inset-y-0 left-0 z-50 w-72 bg-surface border-r border-border transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0
                ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
                flex flex-col inset-y-0 overflow-hidden
            `}>
                {/* Mobile Close Button */}
                <button
                    onClick={onMobileClose}
                    className="lg:hidden absolute top-4 right-4 p-2 rounded-xl bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors z-50 border border-slate-200"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="p-6 pb-2">
                    <div className="flex flex-col items-center gap-2 mb-2">
                        <img src="/autopilot-logo-new.png" alt="Logo" className="h-10 w-auto object-contain" />
                        <div className="px-3 py-1 bg-primary/5 rounded-full border border-primary/10">
                            <p className="text-[10px] text-primary font-black uppercase tracking-[0.2em]">
                                {isBdSuperAdmin ? 'BD Command Center' : isBDRole ? 'CRM Dashboard' : 'Staff Dashboard'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar touch-scroll min-h-0">
                    {!isBDRole && (
                        <p className="px-3 text-[10px] font-medium text-text-tertiary tracking-wider mb-3 font-body">
                            Management
                        </p>
                    )}
                    {NAV_ITEMS.map((item) => (
                        <CapabilityWrapper key={item.href} domain={item.domain} action="view">
                            <Link
                                href={item.href}
                                onClick={handleLinkClick}
                                className={`
                                    flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-[var(--radius-md)] transition-smooth group
                                    ${pathname === item.href
                                        ? 'bg-primary text-text-inverse shadow-sm'
                                        : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                                    }
                                `}
                            >
                                <item.icon className={`w-5 h-5 transition-smooth group-hover:scale-105 shrink-0`} />
                                <span className="font-body font-medium text-sm">{item.label}</span>
                            </Link>
                        </CapabilityWrapper>
                    ))}

                    {/* BD Super Admin (CEO) — grouped Overview / Tools sections */}
                    {isBdSuperAdmin && (
                        <div className="space-y-5">
                            {BD_SUPER_NAV_SECTIONS.map((section) => (
                                <div key={section.title}>
                                    <p className="px-3 text-[10px] font-medium text-text-tertiary tracking-wider mb-3 font-body uppercase">
                                        {section.title}
                                    </p>
                                    <div className="space-y-1">
                                        {section.items.map((item) => {
                                            const isActive = item.href.endsWith('/crm')
                                                ? pathname === item.href
                                                : pathname?.startsWith(item.href);
                                            return (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    onClick={handleLinkClick}
                                                    className={`
                                                        flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-[var(--radius-md)] transition-smooth group
                                                        ${isActive
                                                            ? 'bg-primary text-text-inverse shadow-sm'
                                                            : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                                                        }
                                                    `}
                                                >
                                                    <item.icon className="w-5 h-5 transition-smooth group-hover:scale-105 shrink-0" />
                                                    <span className="font-body font-medium text-sm">{item.label}</span>
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* CRM Section (standard rep/admin) */}
                    {!isBdSuperAdmin && (
                        <div className={isBDRole ? '' : 'pt-4 mt-4 border-t border-border'}>
                            <p className="px-3 text-[10px] font-medium text-text-tertiary tracking-wider mb-3 font-body">
                                CRM
                            </p>
                            {CRM_NAV_ITEMS.map((item) => {
                                const isActive = item.href.endsWith('/crm')
                                    ? pathname === item.href
                                    : pathname?.startsWith(item.href);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={handleLinkClick}
                                        className={`
                                            flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-[var(--radius-md)] transition-smooth group
                                            ${isActive
                                                ? 'bg-primary text-text-inverse shadow-sm'
                                                : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                                            }
                                        `}
                                    >
                                        <item.icon className={`w-5 h-5 transition-smooth group-hover:scale-105 shrink-0`} />
                                        <span className="font-body font-medium text-sm">{item.label}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </nav>

                {/* Bottom Section */}
                <div className="p-4 space-y-3 border-t border-border flex-shrink-0 bg-surface">
                    {/* User Profile */}
                    {user?.user_metadata?.role !== 'org_super_admin' && !isBdSuperAdmin && (
                        <div className="px-3 py-3 rounded-[var(--radius-lg)] border border-border/5">
                            <div className="flex items-center gap-3">
                                {user?.user_metadata?.user_photo_url || user?.user_metadata?.avatar_url ? (
                                    <img
                                        src={user.user_metadata.user_photo_url || user.user_metadata.avatar_url}
                                        alt="Profile"
                                        className="w-10 h-10 rounded-full object-cover border border-border shrink-0"
                                    />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-display font-bold text-sm shrink-0">
                                        {getUserInitials(user?.email || 'User')}
                                    </div>
                                )}
                                <div className="flex flex-col flex-1 min-w-0">
                                    <span className="text-xs font-semibold text-text-primary font-body truncate">
                                        {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
                                    </span>
                                    <span className="text-[10px] text-text-tertiary font-body font-medium">
                                        {user?.user_metadata?.role || 'User'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="space-y-1">
                        {isBdSuperAdmin && (
                            <Link
                                href={`/${orgId}/crm/help`}
                                onClick={handleLinkClick}
                                className="flex items-center gap-2 px-3 py-2.5 lg:py-2 rounded-[var(--radius-md)] text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-smooth"
                            >
                                <HelpCircle className="w-4 h-4 shrink-0" />
                                <span className="text-xs font-semibold font-body">Help & Support</span>
                            </Link>
                        )}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowFeedbackModal(true)}
                                className="flex-1 flex items-center gap-2 px-3 py-2.5 lg:py-2 rounded-[var(--radius-md)] bg-primary/10 text-primary hover:bg-primary/20 transition-smooth"
                            >
                                <MessageSquarePlus className="w-4 h-4 shrink-0" />
                                <span className="text-xs font-semibold font-body">Feedback / Bug</span>
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <Link
                                href={isBdSuperAdmin ? `/${orgId}/crm/settings` : `/${orgId}/settings`}
                                onClick={handleLinkClick}
                                className="flex-1 flex items-center gap-2 px-3 py-2.5 lg:py-2 rounded-[var(--radius-md)] text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-smooth"
                            >
                                <Settings className="w-4 h-4 shrink-0" />
                                <span className="text-xs font-semibold font-body">Settings</span>
                            </Link>
                            <ThemeToggle />
                        </div>

                        <button
                            onClick={() => setShowSignOutModal(true)}
                            className="w-full flex items-center gap-2 px-3 py-2.5 lg:py-2 rounded-[var(--radius-md)] text-error hover:bg-error/10 transition-smooth"
                        >
                            <LogOut className="w-4 h-4 shrink-0" />
                            <span className="text-xs font-semibold font-body">Logout</span>
                        </button>
                    </div>

                </div>
            </aside >

            <SignOutModal
                isOpen={showSignOutModal}
                onClose={() => setShowSignOutModal(false)}
                onConfirm={signOut}
            />

            <FeedbackModal
                isOpen={showFeedbackModal}
                onClose={() => setShowFeedbackModal(false)}
            />
        </>
    );
}

// Mobile Header with Menu Toggle
export function MobileHeader({ onMenuToggle }: { onMenuToggle: () => void }) {
    return (
        <div className="mobile-header lg:hidden">
            <button
                onClick={onMenuToggle}
                className="mobile-menu-toggle"
                aria-label="Open menu"
            >
                <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center">
                <img src="/autopilot-logo-new.png" alt="Autopilot" className="h-7 w-auto object-contain" />
            </div>

            <div className="w-11" /> {/* Spacer for centering */}
        </div>
    );
}
