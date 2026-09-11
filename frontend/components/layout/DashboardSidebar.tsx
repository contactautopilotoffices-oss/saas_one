'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useParams, useSearchParams } from 'next/navigation';
import {
    LayoutDashboard, Users, Ticket, Package, Settings, LogOut,
    Menu, X, GitMerge, Calendar, ShoppingCart, UsersRound, BarChart3,
    FileUp, Bot, Building2, Send, CalendarDays, Droplets, Coffee,
    Sparkles, DollarSign, ClipboardList, Target, TrendingUp,
    BellRing, HelpCircle, Megaphone, Radio, BookOpen, Smartphone, MessageSquarePlus,
    ShieldCheck, Wallet, Zap, Gauge, UserCheck, Plus, UserCircle, FileText
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CapabilityDomain } from '@/frontend/types/rbac';
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
    const searchParams = useSearchParams();
    const orgId = params.orgId as string;
    const currentTab = searchParams?.get('tab');
    const { signOut, user, membership } = useAuth();
    const [showSignOutModal, setShowSignOutModal] = React.useState(false);
    const [showFeedbackModal, setShowFeedbackModal] = React.useState(false);

    const userRole = user?.user_metadata?.role || membership?.org_role;
    // Gate the BD Super Admin nav off the SAME source as page.tsx / layout.tsx /
    // CrmOnboardingGate (email allowlist + membership.org_role) so all four
    // call sites agree. user_metadata.role is not reliably populated.
    const isBdSuperAdmin = checkBdSuperAdmin(user?.email, membership?.org_role);
    const isCrmRoute = pathname?.split('/').includes('crm') ?? false;
    const isBDRole = (userRole === 'bd_rep' || userRole === 'bd_admin' || isBdSuperAdmin) && isCrmRoute;
    // The email allowlist says WHO may see the BD portal, not WHERE. Gating chrome on the
    // allowlist alone put BD Command Center branding and CRM actions on every non-CRM page
    // for these three users — an org super admin opening /org-progress got a CRM sidebar.
    // isBDRole already pairs the allowlist with isCrmRoute; chrome must do the same.
    const showBdChrome = isBdSuperAdmin && isCrmRoute;
    // An org super admin landing on a non-CRM page was being labelled "Staff Dashboard"
    // because the label had only three branches and staff was the fallback. Their console
    // has a name; use it.
    const isOrgSuperAdmin = userRole === 'org_super_admin' || membership?.org_role === 'org_super_admin';

    // Finance (Petty Cash + Payment Tracker) now lives in its own Accounts
    // workspace chrome — it is no longer injected into this shared sidebar.

    const NAV_ITEMS = React.useMemo(() => {
        const isAdmin = userRole === 'org_super_admin' || userRole === 'property_admin' || membership?.org_role === 'org_super_admin';

        if (isBDRole) return [];

        const isHrRoute = pathname?.includes('/hr-tickets');
        if (isHrRoute) {
            if (userRole === 'hr' || userRole === 'hr_head' || userRole === 'director' || isOrgSuperAdmin) {
                return [
                    { label: 'Requests & Grievances', href: `/${orgId}/hr-tickets?tab=tickets`, icon: Ticket, domain: 'tickets' as const },
                    { label: 'Employee Directory', href: `/${orgId}/hr-tickets?tab=directory`, icon: Users, domain: 'tickets' as const },
                    { label: 'Identity Reconciliation', href: `/${orgId}/hr-tickets?tab=reconciliation`, icon: UserCheck, domain: 'tickets' as const },
                    { label: 'Admin Config', href: `/${orgId}/hr-tickets?tab=config`, icon: Settings, domain: 'tickets' as const },
                    { label: 'Analytics', href: `/${orgId}/hr-tickets?tab=analytics`, icon: BarChart3, domain: 'tickets' as const },
                    { label: 'Main Dashboard', href: `/${orgId}/dashboard`, icon: LayoutDashboard, domain: 'dashboards' as const },
                ];
            }
            return [
                { label: 'My Requests', href: `/${orgId}/hr-tickets?tab=tickets`, icon: Ticket, domain: 'tickets' as const },
                { label: 'Raise Request', href: `/${orgId}/hr-tickets?action=create`, icon: Plus, domain: 'tickets' as const },
                { label: 'Main Dashboard', href: `/${orgId}/dashboard`, icon: LayoutDashboard, domain: 'dashboards' as const },
            ];
        }

        const items: { label: string; href: string; icon: LucideIcon; domain: CapabilityDomain }[] = [
            { label: 'Overview', href: `/${orgId}/dashboard`, icon: LayoutDashboard, domain: 'dashboards' as const },
            { label: 'Tickets', href: `/${orgId}/dashboard`, icon: Ticket, domain: 'tickets' as const },
            { label: 'Flow Map', href: `/${orgId}/flow-map`, icon: GitMerge, domain: 'tickets' as const },
            { label: 'Inventory', href: `/${orgId}/procurement-management`, icon: Package, domain: 'procurement' as const },
            { label: 'Procurement', href: `/${orgId}/procurement-management`, icon: ShoppingCart, domain: 'procurement' as const },
            { label: 'Monthly Requisitions', href: `/${orgId}/procurement-management?tab=monthly-requisitions`, icon: FileUp, domain: 'procurement' as const },
            {label: 'HR & Grievances', href: `/${orgId}/hr-tickets`, icon: ShieldCheck, domain: 'tickets' as const },
            { label: 'Staff', href: `/${orgId}/users`, icon: Users, domain: 'users' as const },
        ];

        if (isAdmin || userRole === 'org_super_admin') {
            items.push({ label: 'AI Automation', href: `/${orgId}/dashboard?tab=ai_tickets`, icon: Bot, domain: 'dashboards' as const });
            items.push({ label: 'Roster Management', href: `/${orgId}/dashboard?tab=roster`, icon: CalendarDays, domain: 'dashboards' as const });
            items.push({ label: 'Client Support', href: `/${orgId}/dashboard?tab=guest_experience`, icon: Smartphone, domain: 'dashboards' as const });
        }

        items.push({ label: 'Cafeteria', href: `/${orgId}/dashboard?tab=cafeteria`, icon: Coffee, domain: 'dashboards' as const });
        items.push({ label: 'Water Level', href: `/${orgId}/dashboard?tab=water_logger`, icon: Droplets, domain: 'dashboards' as const });

        // Petty Cash belongs to the general FMS for every non-tenant role — the API already
        // grants them create access (backend/lib/pettyCash/access.ts) but there was no way
        // in from this sidebar, only from the admin dashboards. Visibility is gated by the
        // `petty_cash` capability, so tenant-like roles never see it.
        // The Payment Tracker deliberately stays out: it is finance-only (item 7).
        items.push({ label: 'Petty Cash', href: `/${orgId}/petty-cash`, icon: Wallet, domain: 'petty_cash' as const });

        if (userRole === 'org_super_admin') {
            items.push({ label: 'Water Analytics', href: `/${orgId}/dashboard?tab=water`, icon: Droplets, domain: 'dashboards' as const });
            // Both render as tabs of the super-admin console. Linking the standalone
            // /org-progress and /org-efficiency pages instead dropped the user into the
            // (dashboard) route group and its staff sidebar.
            items.push({ label: 'Org Progress Meter', href: `/${orgId}/dashboard?tab=org_progress`, icon: Gauge, domain: 'dashboards' as const });
            items.push({ label: 'Org Efficiency', href: `/${orgId}/dashboard?tab=org_efficiency`, icon: TrendingUp, domain: 'dashboards' as const });
        }

        // Ops Super Admin — electricity checker workspace: validation queue, disputes, reports.
        if (userRole === 'ops_super_admin') {
            items.push({ label: 'Electricity Validation', href: `/${orgId}/procurement-management?tab=electricity&view=validation`, icon: Zap, domain: 'dashboards' as const });
            items.push({ label: 'Disputes', href: `/${orgId}/procurement-management?tab=electricity&view=disputes`, icon: MessageSquarePlus, domain: 'tickets' as const });
            items.push({ label: 'Reports', href: `/${orgId}/procurement-management?tab=electricity&view=reports`, icon: BarChart3, domain: 'reports' as const });
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
                fixed inset-y-0 left-0 z-40 w-72 h-screen bg-surface border-r border-border transform transition-transform duration-300 ease-in-out lg:translate-x-0
                ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
                flex flex-col overflow-hidden
            `}>
                {/* Mobile Close Button */}
                <button
                    onClick={onMobileClose}
                    className="lg:hidden absolute top-4 right-4 p-2 rounded-xl bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors z-50 border border-slate-200"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="p-6 pb-2 shrink-0">
                    <div className="flex flex-col items-center gap-1.5 mb-4">
                        <img src="/autopilot-logo-new.png" alt="Autopilot" className="h-9 w-auto object-contain" />
                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-[0.2em] mt-1">
                            {(userRole === 'hr' || userRole === 'hr_head') ? 'HR HQ CONSOLE' : isOrgSuperAdmin ? 'SUPER ADMIN CONSOLE' : showBdChrome ? 'BD COMMAND CENTER' : isBDRole ? 'CRM DASHBOARD' : 'STAFF DASHBOARD'}
                        </p>
                    </div>

                    {!isBDRole && (
                        <div className="mt-3 space-y-2">
                            <div className="flex items-center gap-1.5 px-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                                    QUICK ACTIONS
                                </p>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <Link
                                    href={`/${orgId}/hr-tickets?action=create`}
                                    className="flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl bg-[#587e85] hover:bg-[#48686e] text-white transition-all text-[9.5px] font-extrabold text-center gap-1 shadow-sm active:scale-95 border border-[#48686e]/40"
                                >
                                    <Plus className="w-4 h-4 shrink-0" />
                                    <span className="tracking-tight uppercase truncate max-w-full px-0.5 leading-none">Grievance</span>
                                </Link>
                                {(userRole === 'hr' || userRole === 'hr_head' || isOrgSuperAdmin) ? (
                                    <>
                                        <Link
                                            href={`/${orgId}/hr-tickets?tab=directory&action=add`}
                                            className="flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl bg-[#f6f2ec] dark:bg-[#aa895f]/20 hover:bg-[#ede5d8] dark:hover:bg-[#aa895f]/30 text-[#8f6d3d] dark:text-[#c4a479] transition-all text-[9.5px] font-extrabold text-center gap-1 border border-[#d8c4a5] dark:border-[#aa895f]/40 active:scale-95 shadow-sm"
                                        >
                                            <Users className="w-4 h-4 shrink-0 text-[#aa895f] dark:text-[#c4a479]" />
                                            <span className="tracking-tight uppercase truncate max-w-full px-0.5 leading-none">Member</span>
                                        </Link>
                                        <Link
                                            href={`/${orgId}/hr-tickets?tab=config`}
                                            className="flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all text-[9.5px] font-extrabold text-center gap-1 border border-slate-200 dark:border-slate-700 active:scale-95 shadow-sm"
                                        >
                                            <Settings className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                            <span className="tracking-tight uppercase truncate max-w-full px-0.5 leading-none">Config</span>
                                        </Link>
                                    </>
                                ) : (
                                    <>
                                        <Link
                                            href={`/${orgId}/hr-tickets?tab=tickets`}
                                            className="flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl bg-[#f6f2ec] dark:bg-[#aa895f]/20 hover:bg-[#ede5d8] dark:hover:bg-[#aa895f]/30 text-[#8f6d3d] dark:text-[#c4a479] transition-all text-[9.5px] font-extrabold text-center gap-1 border border-[#d8c4a5] dark:border-[#aa895f]/40 active:scale-95 shadow-sm"
                                        >
                                            <Ticket className="w-4 h-4 shrink-0 text-[#aa895f] dark:text-[#c4a479]" />
                                            <span className="tracking-tight uppercase truncate max-w-full px-0.5 leading-none">My Tickets</span>
                                        </Link>
                                        <Link
                                            href={`/${orgId}/settings?tab=profile`}
                                            className="flex flex-col items-center justify-center py-2.5 px-1 rounded-2xl bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all text-[9.5px] font-extrabold text-center gap-1 border border-slate-200 dark:border-slate-700 active:scale-95 shadow-sm"
                                        >
                                            <UserCircle className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                            <span className="tracking-tight uppercase truncate max-w-full px-0.5 leading-none">Profile</span>
                                        </Link>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar touch-scroll min-h-0 pt-2">
                    {!isBDRole && (
                        <div className="flex items-center gap-2 px-2 py-1 mb-2">
                            <span className="w-0.5 h-3.5 bg-[#587e85] rounded-full" />
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 tracking-wider font-mono uppercase">
                                {(userRole === 'hr' || userRole === 'hr_head') ? 'CORE OPERATIONS' : 'CORE OPERATIONS'}
                            </p>
                        </div>
                    )}
                    {NAV_ITEMS.map((item) => {
                        let isActive = false;
                        if (item.href.includes('?tab=')) {
                            const itemTab = item.href.split('?tab=')[1];
                            isActive = pathname.endsWith('/hr-tickets') && currentTab === itemTab;
                        } else if (item.href.includes('?')) {
                            const queryPart = item.href.split('?')[1];
                            isActive = pathname === item.href.split('?')[0] && (searchParams.toString().includes(queryPart));
                        } else {
                            isActive = pathname === item.href && (!searchParams.get('tab'));
                        }
                        return (
                            <CapabilityWrapper key={`${item.label}-${item.href}`} domain={item.domain} action="view">
                                <Link
                                    href={item.href}
                                    onClick={handleLinkClick}
                                    className={`
                                        flex items-center gap-3.5 px-4 py-2.5 rounded-2xl transition-all font-semibold text-xs sm:text-sm group
                                        ${isActive
                                            ? 'bg-[#587e85] text-white shadow-sm font-bold'
                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                        }
                                    `}
                                >
                                    <item.icon className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-105 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                                    <span className="truncate">{item.label}</span>
                                </Link>
                            </CapabilityWrapper>
                        );
                    })}

                    {/* SYSTEM & PERSONAL Section */}
                    {!isBDRole && (
                        <div className="pt-3 mt-3 border-t border-slate-200/60 dark:border-slate-800 space-y-1">
                            <div className="flex items-center gap-2 px-2 py-1 mb-2">
                                <span className="w-0.5 h-3.5 bg-[#587e85] rounded-full" />
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 tracking-wider font-mono uppercase">
                                    SYSTEM & PERSONAL
                                </p>
                            </div>

                            <Link
                                href={`/${orgId}/hr-tickets?tab=tickets`}
                                onClick={handleLinkClick}
                                className={`flex items-center gap-3.5 px-4 py-2.5 rounded-2xl transition-all font-semibold text-xs sm:text-sm group ${
                                    pathname?.includes('/hr-tickets') && (!currentTab || currentTab === 'tickets')
                                        ? 'bg-[#587e85] text-white shadow-sm font-bold'
                                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                }`}
                            >
                                <ShieldCheck className="w-4 h-4 shrink-0 transition-transform group-hover:scale-105" />
                                <span className="truncate">My Grievances & HR Tickets</span>
                            </Link>

                            <Link
                                href={`/${orgId}/hr-tickets?action=create`}
                                onClick={handleLinkClick}
                                className="flex items-center gap-3.5 px-4 py-2.5 rounded-2xl transition-all font-semibold text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 group"
                            >
                                <Plus className="w-4 h-4 shrink-0 transition-transform group-hover:scale-105 text-[#587e85]" />
                                <span className="truncate">+ Raise Grievance</span>
                            </Link>

                            {(userRole !== 'hr' && userRole !== 'hr_head' && (isOrgSuperAdmin || userRole === 'property_admin')) && (
                                <Link
                                    href={`/${orgId}/dashboard?tab=ai_tickets`}
                                    onClick={handleLinkClick}
                                    className={`flex items-center gap-3.5 px-4 py-2.5 rounded-2xl transition-all font-semibold text-xs sm:text-sm group ${
                                        pathname?.includes('tab=ai_tickets')
                                            ? 'bg-[#587e85] text-white shadow-sm font-bold'
                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                    }`}
                                >
                                    <Bot className="w-4 h-4 shrink-0 transition-transform group-hover:scale-105" />
                                    <span className="truncate">AI Automation</span>
                                </Link>
                            )}

                            <button
                                type="button"
                                onClick={() => {
                                    setShowFeedbackModal(true);
                                    handleLinkClick();
                                }}
                                className="w-full flex items-center gap-3.5 px-4 py-2.5 rounded-2xl transition-all font-semibold text-xs sm:text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 text-left group"
                            >
                                <MessageSquarePlus className="w-4 h-4 shrink-0 transition-transform group-hover:scale-105" />
                                <span className="truncate">Feedback / Bug</span>
                            </button>

                            <Link
                                href={`/${orgId}/settings`}
                                onClick={handleLinkClick}
                                className={`flex items-center gap-3.5 px-4 py-2.5 rounded-2xl transition-all font-semibold text-xs sm:text-sm group ${
                                    pathname?.endsWith('/settings') && (!currentTab || currentTab !== 'profile')
                                        ? 'bg-[#587e85] text-white shadow-sm font-bold'
                                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                }`}
                            >
                                <Settings className="w-4 h-4 shrink-0 transition-transform group-hover:scale-105" />
                                <span className="truncate">Settings</span>
                            </Link>

                            <Link
                                href={`/${orgId}/settings?tab=profile`}
                                onClick={handleLinkClick}
                                className={`flex items-center gap-3.5 px-4 py-2.5 rounded-2xl transition-all font-semibold text-xs sm:text-sm group ${
                                    pathname?.includes('tab=profile')
                                        ? 'bg-[#587e85] text-white shadow-sm font-bold'
                                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                }`}
                            >
                                <UserCircle className="w-4 h-4 shrink-0 transition-transform group-hover:scale-105" />
                                <span className="truncate">Profile</span>
                            </Link>
                        </div>
                    )}

                    {/* BD Super Admin (CEO) — grouped Overview / Tools sections */}
                    {isBdSuperAdmin && isCrmRoute && (
                        <div className="space-y-3">
                            {BD_SUPER_NAV_SECTIONS.map((section) => (
                                <div key={section.title}>
                                    <p className="px-3 text-[10px] font-medium text-text-tertiary tracking-wider mb-1.5 font-body uppercase">
                                        {section.title}
                                    </p>
                                    <div className="space-y-0.5 pl-2">
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
                                                        flex items-center gap-3 px-3 py-1.5 rounded-[var(--radius-md)] transition-smooth group
                                                        ${isActive
                                                            ? 'bg-primary text-text-inverse shadow-sm'
                                                            : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                                                        }
                                                    `}
                                                >
                                                    <item.icon className="w-4 h-4 mr-0.5 transition-smooth group-hover:scale-105 shrink-0" />
                                                    <span className="font-body font-medium text-xs md:text-sm">{item.label}</span>
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* CRM Section (only on CRM routes or for BD roles, strictly excluded for HR) */}
                    {(isCrmRoute || isBDRole) && userRole !== 'hr' && userRole !== 'hr_head' && (
                        <div className={isBDRole ? '' : 'pt-2.5 mt-2.5 border-t border-border'}>
                            <p className="px-3 text-[10px] font-medium text-text-tertiary tracking-wider mb-1.5 font-body">
                                CRM
                            </p>
                            <div className="space-y-0.5 pl-2">
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
                                                flex items-center gap-3 px-3 py-1.5 rounded-[var(--radius-md)] transition-smooth group
                                                ${isActive
                                                    ? 'bg-primary text-text-inverse shadow-sm'
                                                    : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                                                }
                                            `}
                                        >
                                            <item.icon className={`w-4 h-4 mr-0.5 transition-smooth group-hover:scale-105 shrink-0`} />
                                            <span className="font-body font-medium text-xs md:text-sm">{item.label}</span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </nav>

                {/* Bottom Section */}
                <div className="p-4 space-y-2 border-t border-slate-200/60 dark:border-slate-800 shrink-0 bg-surface mt-auto">
                    {/* User Profile */}
                    {!showBdChrome && (
                        <div className="px-2 py-1">
                            <div className="flex items-center gap-3">
                                {user?.user_metadata?.user_photo_url || user?.user_metadata?.avatar_url ? (
                                    <img
                                        src={user.user_metadata.user_photo_url || user.user_metadata.avatar_url}
                                        alt="Profile"
                                        className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-200"
                                    />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-[#587e85] flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm">
                                        {getUserInitials(user?.email || 'User')}
                                    </div>
                                )}
                                <div className="flex flex-col flex-1 min-w-0">
                                    <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 truncate">
                                        {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-medium truncate">
                                        {user?.email || 'user@worksquare.in'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                        <button
                            onClick={() => setShowSignOutModal(true)}
                            className="flex items-center gap-2 px-2 py-1 text-slate-500 hover:text-red-600 transition-colors text-xs font-bold"
                        >
                            <LogOut className="w-4 h-4 shrink-0" />
                            <span>Sign Out</span>
                        </button>
                        <ThemeToggle />
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
