'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useParams, useSearchParams } from 'next/navigation';
import {
    LayoutDashboard, Users, Ticket, Package, Settings, LogOut,
    Menu, X, ChevronLeft, GitMerge, Calendar, ShoppingCart, UsersRound, BarChart3,
    FileUp, Bot, Building2, Send, CalendarDays, Droplets, Coffee,
    DollarSign, ClipboardList, Target, TrendingUp,
    BellRing, HelpCircle, Megaphone, Radio, BookOpen, Smartphone, MessageSquarePlus,
    ShieldCheck, Wallet, Zap, Gauge, UserCheck, Plus, UserCircle, FileText, DoorOpen, Mic, ClipboardCheck
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CapabilityDomain } from '@/frontend/types/rbac';
import PettyCashNavLink from '@/frontend/components/pettyCash/PettyCashNavLink';
import CapabilityWrapper from '../auth/CapabilityWrapper';
import { useAuth } from '@/frontend/context/AuthContext';
import FeedbackModal from '../ui/FeedbackModal';
import { isBdSuperAdmin as checkBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';
import SignOutModal from '../ui/SignOutModal';
import { motion, AnimatePresence } from 'framer-motion';
import NotificationBell from '@/frontend/components/dashboard/NotificationBell';
import { isCreditFreeBookingRole } from '@/frontend/lib/meetingRooms/creditFreeRoles';

interface DashboardSidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
    isMobileOpen?: boolean;
    onMobileClose?: () => void;
}

export default function DashboardSidebar({
    isOpen = true,
    onClose,
    isMobileOpen,
    onMobileClose
}: DashboardSidebarProps) {
    const pathname = usePathname();
    const params = useParams();
    const searchParams = useSearchParams();
    const { signOut, user, membership } = useAuth();
    const orgId = (params.orgId as string) || membership?.org_id || '';
    const currentTab = searchParams?.get('tab');
    const [showSignOutModal, setShowSignOutModal] = React.useState(false);
    const [showFeedbackModal, setShowFeedbackModal] = React.useState(false);

    const rawRole = (user?.user_metadata?.role || membership?.org_role || membership?.properties?.[0]?.role || 'employee').toLowerCase();
    const userRole = rawRole;
    // Gate the BD Super Admin nav off the SAME source as page.tsx / layout.tsx /
    // CrmOnboardingGate (email allowlist + membership.org_role) so all four
    // call sites agree. user_metadata.role is not reliably populated.
    const isBdSuperAdmin = checkBdSuperAdmin(user?.email, membership?.org_role);
    const isCrmRoute = (pathname?.split('/').includes('crm') ?? false) || (searchParams?.get('from') === 'crm');
    // Pure BD roles (bd_rep, bd_admin) belong to the CRM workspace permanently.
    // They must never lose their CRM navigation, quick actions, or branding on shared
    // personal pages like /hr-tickets or /settings.
    // BD Super Admins (CEO/Directors with dual FMS+CRM access) switch chrome based on isCrmRoute.
    const isPureBdRole = userRole === 'bd_rep' || userRole === 'bd_admin' || userRole === 'bd';
    const isBDRole = isPureBdRole || (isBdSuperAdmin && isCrmRoute);
    const showBdChrome = isBdSuperAdmin && isCrmRoute;
    // An org super admin landing on a non-CRM page was being labelled "Staff Dashboard"
    // because the label had only three branches and staff was the fallback. Their console
    // has a name; use it.
    const isOrgSuperAdmin = ['org_super_admin', 'director', 'super_admin'].includes(userRole) || ['org_super_admin', 'director', 'super_admin'].includes(membership?.org_role || '');
    // External parties (tenants, external vendors) must not see employee HR grievance options.
    const isExternalRole = Boolean(
        rawRole && (
            rawRole.includes('tenant') ||
            rawRole.includes('vendor') ||
            ['tenant', 'super_tenant', 'tenant_admin', 'vendor', 'maintenance_vendor', 'food_vendor', 'pantry_vendor', 'cafeteria_vendor', 'external_vendor'].includes(rawRole)
        )
    );

    // Finance (Petty Cash + Payment Tracker) now lives in its own Accounts
    // workspace chrome — it is no longer injected into this shared sidebar.

    const NAV_ITEMS = React.useMemo(() => {
        const isAdmin = userRole === 'org_super_admin' || userRole === 'property_admin' || membership?.org_role === 'org_super_admin';

        if (isBDRole) return [];

        if (['hr', 'hr_head', 'hr_manager', 'hr_ops'].includes(userRole)) {
            return [
                { label: 'Requests & Grievances', href: '/hr-tickets?tab=tickets', icon: Ticket, domain: 'tickets' as const },
                { label: 'Notes Tracker', href: '/hr-tickets?tab=notes', icon: FileText, domain: 'tickets' as const },
                { label: 'Org Reporting Tree', href: '/hr-tickets?tab=tree', icon: GitMerge, domain: 'tickets' as const },
                { label: 'Employee Directory', href: '/hr-tickets?tab=directory', icon: Users, domain: 'tickets' as const },
                { label: 'Identity Reconciliation', href: '/hr-tickets?tab=reconciliation', icon: UserCheck, domain: 'tickets' as const },
                { label: 'Admin Config', href: '/hr-tickets?tab=config', icon: Settings, domain: 'tickets' as const },
                { label: 'Analytics', href: '/hr-tickets?tab=analytics', icon: BarChart3, domain: 'tickets' as const },
                { label: 'Task Manager', href: '/hr-tickets?tab=tasks', icon: ClipboardList, domain: 'tickets' as const },
                // Owner 2026-10-29: the HR team's own Meeting Assistant (separate from Tech's and the Super Admin's)
                { label: 'Meeting Assistant', href: '/hr-tickets?tab=meeting_assistant', icon: Mic, domain: 'tickets' as const },
                { label: 'Assessments', href: '/hr-tickets?tab=assessments', icon: ClipboardCheck, domain: 'tickets' as const },
            ];
        }

        const dashPath = '/dashboard';
        const items: { label: string; href: string; icon: LucideIcon; domain: CapabilityDomain }[] = [
            { label: 'Overview', href: dashPath, icon: LayoutDashboard, domain: 'dashboards' as const },
            { label: 'Tickets', href: `${dashPath}?tab=requests`, icon: Ticket, domain: 'tickets' as const },
            { label: 'Flow Map', href: orgId ? `/${orgId}/flow-map` : '/flow-map', icon: GitMerge, domain: 'tickets' as const },
            { label: 'Inventory', href: orgId ? `/${orgId}/procurement-management` : '/procurement-management', icon: Package, domain: 'procurement' as const },
            { label: 'Procurement', href: orgId ? `/${orgId}/procurement-management` : '/procurement-management', icon: ShoppingCart, domain: 'procurement' as const },
            { label: 'Monthly Requisitions', href: orgId ? `/${orgId}/procurement-management?tab=monthly-requisitions` : '/procurement-management?tab=monthly-requisitions', icon: FileUp, domain: 'procurement' as const },
            { label: 'HR & Grievances', href: `${dashPath}?tab=grievance`, icon: ShieldCheck, domain: 'tickets' as const },
            { label: 'Staff', href: orgId ? `/${orgId}/users` : '/users', icon: Users, domain: 'users' as const },
        ];

        if (isAdmin || userRole === 'org_super_admin') {
            items.push({ label: 'AI Automation', href: `${dashPath}?tab=ai_tickets`, icon: Bot, domain: 'dashboards' as const });
            items.push({ label: 'Roster Management', href: `${dashPath}?tab=roster`, icon: CalendarDays, domain: 'dashboards' as const });
            items.push({ label: 'Client Support', href: `${dashPath}?tab=guest_experience`, icon: Smartphone, domain: 'dashboards' as const });
        }

        items.push({ label: 'Cafeteria', href: `${dashPath}?tab=cafeteria`, icon: Coffee, domain: 'dashboards' as const });
        items.push({ label: 'Water Level', href: `${dashPath}?tab=water_logger`, icon: Droplets, domain: 'dashboards' as const });

        // Petty Cash belongs to the general FMS for every non-tenant role — the API already
        // grants them create access (backend/lib/pettyCash/access.ts) but there was no way
        // in from this sidebar, only from the admin dashboards. Visibility is gated by the
        // `petty_cash` capability, so tenant-like roles never see it.
        // The Payment Tracker deliberately stays out: it is finance-only (item 7).
        // Petty Cash is rendered once in the shared personal section for every internal role.

        if (userRole === 'org_super_admin' || isOrgSuperAdmin) {
            items.push({ label: 'Water Analytics', href: `/${orgId}/dashboard?tab=water`, icon: Droplets, domain: 'dashboards' as const });
            // Both render as tabs of the super-admin console. Linking the standalone
            // /org-progress and /org-efficiency pages instead dropped the user into the
            // (dashboard) route group and its staff sidebar.
            items.push({ label: 'Org Progress Meter', href: `/${orgId}/dashboard?tab=org_progress`, icon: Gauge, domain: 'dashboards' as const });
            items.push({ label: 'Org Efficiency', href: `/${orgId}/dashboard?tab=org_efficiency`, icon: TrendingUp, domain: 'dashboards' as const });
            items.push({ label: 'Business Development', href: `/${orgId}/crm`, icon: TrendingUp, domain: 'crm' as const });
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
            { label: 'Dashboard', href: '/crm', icon: LayoutDashboard, domain: 'crm' as const },
            { label: 'My Leads', href: '/crm/leads', icon: UsersRound, domain: 'crm' as const },
            { label: 'Follow Ups', href: '/crm/followups', icon: BellRing, domain: 'crm' as const },
            { label: 'Calendar', href: '/crm/calendar', icon: Calendar, domain: 'crm' as const },
            { label: 'Tasks', href: '/crm/tasks', icon: ClipboardList, domain: 'crm' as const },
            { label: 'Target', href: '/crm/target', icon: Target, domain: 'crm' as const },
            { label: 'AI Copilot', href: '/crm/ai', icon: Bot, domain: 'crm' as const },
            { label: 'Performance', href: '/crm/performance', icon: TrendingUp, domain: 'crm' as const },
        ];
        if (isCrmAdmin) {
            items.push({ label: 'Settings', href: '/crm/settings', icon: Settings, domain: 'crm' as const });
        }
        items.push({ label: 'Help & Support', href: '/crm/help', icon: HelpCircle, domain: 'crm' as const });
        return items;
    }, [isCrmAdmin]);

    // BD Super Admin (CEO) portal — grouped OVERVIEW / TOOLS sections.
    const BD_SUPER_NAV_SECTIONS = React.useMemo(() => [
        {
            title: 'Overview',
            items: [
                { label: 'CEO Dashboard', href: '/crm', icon: LayoutDashboard },
                { label: 'Campaigns', href: '/crm/campaigns', icon: Megaphone },
                { label: 'Leads', href: '/crm/leads', icon: UsersRound },
                { label: 'ABM Tracker', href: '/crm/abm', icon: Target },
                { label: 'Team Performance', href: '/crm/performance', icon: TrendingUp },
                { label: 'Reports', href: '/crm/reports', icon: BarChart3 },
            ],
        },
        {
            title: 'Tools',
            items: [
                { label: 'AI Agent', href: '/crm/ai', icon: Bot },
                { label: 'Calendar', href: '/crm/calendar', icon: Calendar },
                { label: 'Tasks', href: '/crm/tasks', icon: ClipboardList },
                { label: 'Signals', href: '/crm/signals', icon: Radio },
                { label: 'Playbooks', href: '/crm/playbooks', icon: BookOpen },
            ],
        },
    ], []);

    const getUserInitials = (name: string) => {
        return name?.split(' ').map(n => n[0]).join('').toUpperCase() || 'U';
    };

    // Close sidebar when clicking a link on mobile
    const handleLinkClick = () => {
        if (isMobileOpen && onMobileClose) {
            onMobileClose();
        }
    };

    // HR roles see Petty Cash and Book Meeting Room under HR OPERATIONS; everyone else under SYSTEM & PERSONAL.
    const isHrRole = ['hr', 'hr_head', 'hr_manager', 'hr_ops'].includes(userRole);
    const pettyCashAndBookRoomLinks = (
        <>
            <PettyCashNavLink onNavigate={handleLinkClick} />

            {/* HR and CRM teams book meeting rooms here, without credits */}
            {(isCreditFreeBookingRole(userRole) || isCreditFreeBookingRole(membership?.org_role)) && (
                <Link
                    href={`/${orgId}/book-room`}
                    onClick={handleLinkClick}
                    className={`flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group ${
                        pathname?.endsWith('/book-room')
                            ? 'bg-[#587e85] text-white'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                    }`}
                >
                    <DoorOpen className="w-4 h-4 shrink-0" />
                    <span className="truncate">Book Meeting Room</span>
                </Link>
            )}
        </>
    );

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
                fixed inset-y-0 left-0 z-40 w-72 h-screen bg-surface border-r border-border transform transition-transform duration-300 ease-in-out
                ${isOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'}
                ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
                flex flex-col overflow-hidden shadow-xl lg:shadow-none
            `}>
                {/* Collapse / Close Button (Desktop & Mobile) */}
                <button
                    type="button"
                    onClick={() => {
                        onClose?.();
                        onMobileClose?.();
                    }}
                    className="absolute top-4 right-4 p-1.5 rounded-[8px] bg-slate-100/90 hover:bg-slate-200 dark:bg-slate-800/90 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors duration-150 z-50 border border-slate-200/80 dark:border-slate-700/80 shadow-2xs cursor-pointer group"
                    title="Collapse sidebar"
                    aria-label="Collapse sidebar"
                >
                    <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                </button>

                <div className="p-6 pb-2 shrink-0">
                    <div className="flex flex-col items-center gap-2 mb-6">
                        <img src="/autopilot-logo-new.png" alt="Autopilot" className="h-9 w-auto object-contain" />
                        <p className="text-xs font-medium text-text-tertiary">
                            {(() => {
                                if (['hr', 'hr_head'].includes(rawRole)) return 'HR HQ console';
                                if (['org_super_admin', 'director'].includes(rawRole)) return 'Super admin console';
                                if (rawRole === 'bd_admin' || showBdChrome) return 'BD command center';
                                if (rawRole === 'bd_rep' || isBDRole) return 'CRM dashboard';
                                if (['mst', 'mst_technician', 'technician', 'maintenance_staff'].includes(rawRole)) return 'Maintenance portal';
                                if (['security', 'security_guard', 'gatekeeper'].includes(rawRole)) return 'Security dashboard';
                                if (['property_admin', 'building_admin'].includes(rawRole)) return 'Property admin console';
                                if (['soft_service_manager', 'soft_service_supervisor', 'manager'].includes(rawRole)) return 'Operations console';
                                if (['ops_super_admin'].includes(rawRole)) return 'Ops super admin console';
                                if (['procurement', 'procurement_admin', 'procurement_manager'].includes(rawRole)) return 'Procurement console';
                                if (['accounts', 'finance', 'accounts_manager'].includes(rawRole)) return 'Finance console';
                                if (['vendor', 'maintenance_vendor', 'food_vendor', 'pantry_vendor', 'cafeteria_vendor', 'external_vendor'].includes(rawRole) || rawRole.includes('vendor')) return 'Vendor portal';
                                if (['tenant', 'super_tenant', 'tenant_admin'].includes(rawRole) || rawRole.includes('tenant')) return 'Tenant portal';
                                return 'Staff dashboard';
                            })()}
                        </p>
                    </div>

                    {!isExternalRole && (
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-text-tertiary">
                                Quick actions
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                                <Link
                                    href={isOrgSuperAdmin ? `/${orgId}/dashboard?tab=grievance&action=create` : `/${orgId}/hr-tickets?action=create`}
                                    className="flex flex-col items-center justify-center py-2 px-1 rounded-[10px] bg-[#587e85] hover:bg-[#48686e] text-white transition-colors duration-150 text-[11px] font-medium text-center gap-1 shadow-xs active:scale-[0.98] border border-[#48686e]/40 h-13 min-w-0"
                                    title="Raise HR Request / Grievance"
                                >
                                    <Plus className="w-4 h-4 shrink-0" />
                                    <span className="whitespace-nowrap leading-none">Request</span>
                                </Link>
                                {(isBDRole && isCrmRoute) || (isBDRole && !isOrgSuperAdmin) ? (
                                    <>
                                        <Link
                                            href={`/${orgId}/hr-tickets?tab=tickets`}
                                            className="flex flex-col items-center justify-center py-2 px-1 rounded-[10px] bg-[#f6f2ec] dark:bg-[#aa895f]/20 hover:bg-[#ede5d8] dark:hover:bg-[#aa895f]/30 text-[#8f6d3d] dark:text-[#c4a479] transition-colors duration-150 text-[11px] font-medium text-center gap-1 border border-[#d8c4a5] dark:border-[#aa895f]/40 active:scale-[0.98] shadow-xs h-13 min-w-0"
                                            title="My Grievances"
                                        >
                                            <ShieldCheck className="w-4 h-4 shrink-0 text-[#aa895f] dark:text-[#c4a479]" />
                                            <span className="whitespace-nowrap leading-none">Grievance</span>
                                        </Link>
                                        <Link
                                            href={`/${orgId}/crm/leads`}
                                            className="flex flex-col items-center justify-center py-2 px-1 rounded-[10px] bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors duration-150 text-[11px] font-medium text-center gap-1 border border-slate-200 dark:border-slate-700 active:scale-[0.98] shadow-xs h-13 min-w-0"
                                            title="View Leads"
                                        >
                                            <UsersRound className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                            <span className="whitespace-nowrap leading-none">Leads</span>
                                        </Link>
                                    </>
                                ) : (userRole === 'hr' || userRole === 'hr_head' || isOrgSuperAdmin) ? (
                                    <>
                                        <Link
                                            href={isOrgSuperAdmin ? `/${orgId}/dashboard?tab=grievance&subtab=directory&action=add` : `/${orgId}/hr-tickets?tab=directory&action=add`}
                                            className="flex flex-col items-center justify-center py-2 px-1 rounded-[10px] bg-[#f6f2ec] dark:bg-[#aa895f]/20 hover:bg-[#ede5d8] dark:hover:bg-[#aa895f]/30 text-[#8f6d3d] dark:text-[#c4a479] transition-colors duration-150 text-[11px] font-medium text-center gap-1 border border-[#d8c4a5] dark:border-[#aa895f]/40 active:scale-[0.98] shadow-xs h-13 min-w-0"
                                            title="Add Employee Member"
                                        >
                                            <Users className="w-4 h-4 shrink-0 text-[#aa895f] dark:text-[#c4a479]" />
                                            <span className="whitespace-nowrap leading-none">Member</span>
                                        </Link>
                                        <Link
                                            href={isOrgSuperAdmin ? `/${orgId}/dashboard?tab=grievance&subtab=config` : `/${orgId}/hr-tickets?tab=config`}
                                            className="flex flex-col items-center justify-center py-2 px-1 rounded-[10px] bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors duration-150 text-[11px] font-medium text-center gap-1 border border-slate-200 dark:border-slate-700 active:scale-[0.98] shadow-xs h-13 min-w-0"
                                            title="HR Admin Configuration"
                                        >
                                            <Settings className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                            <span className="whitespace-nowrap leading-none">Config</span>
                                        </Link>
                                    </>
                                ) : isBDRole ? (
                                    <>
                                        <Link
                                            href={`/${orgId}/hr-tickets?tab=tickets`}
                                            className="flex flex-col items-center justify-center py-2 px-1 rounded-[10px] bg-[#f6f2ec] dark:bg-[#aa895f]/20 hover:bg-[#ede5d8] dark:hover:bg-[#aa895f]/30 text-[#8f6d3d] dark:text-[#c4a479] transition-colors duration-150 text-[11px] font-medium text-center gap-1 border border-[#d8c4a5] dark:border-[#aa895f]/40 active:scale-[0.98] shadow-xs h-13 min-w-0"
                                            title="My Grievances"
                                        >
                                            <ShieldCheck className="w-4 h-4 shrink-0 text-[#aa895f] dark:text-[#c4a479]" />
                                            <span className="whitespace-nowrap leading-none">Grievance</span>
                                        </Link>
                                        <Link
                                            href={`/${orgId}/crm/leads`}
                                            className="flex flex-col items-center justify-center py-2 px-1 rounded-[10px] bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors duration-150 text-[11px] font-medium text-center gap-1 border border-slate-200 dark:border-slate-700 active:scale-[0.98] shadow-xs h-13 min-w-0"
                                            title="View Leads"
                                        >
                                            <UsersRound className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                            <span className="whitespace-nowrap leading-none">Leads</span>
                                        </Link>
                                    </>
                                ) : (
                                    <>
                                        <Link
                                            href={`/${orgId}/hr-tickets?tab=tickets`}
                                            className="flex flex-col items-center justify-center py-2 px-1 rounded-[10px] bg-[#f6f2ec] dark:bg-[#aa895f]/20 hover:bg-[#ede5d8] dark:hover:bg-[#aa895f]/30 text-[#8f6d3d] dark:text-[#c4a479] transition-colors duration-150 text-[11px] font-medium text-center gap-1 border border-[#d8c4a5] dark:border-[#aa895f]/40 active:scale-[0.98] shadow-xs h-13 min-w-0"
                                            title="My HR Tickets"
                                        >
                                            <Ticket className="w-4 h-4 shrink-0 text-[#aa895f] dark:text-[#c4a479]" />
                                            <span className="whitespace-nowrap leading-none">Tickets</span>
                                        </Link>
                                        <Link
                                            href={`/${orgId}/settings?tab=profile`}
                                            className="flex flex-col items-center justify-center py-2 px-1 rounded-[10px] bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors duration-150 text-[11px] font-medium text-center gap-1 border border-slate-200 dark:border-slate-700 active:scale-[0.98] shadow-xs h-13 min-w-0"
                                            title="Profile Settings"
                                        >
                                            <UserCircle className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                            <span className="whitespace-nowrap leading-none">Profile</span>
                                        </Link>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto custom-scrollbar touch-scroll min-h-0 pt-4 pb-4">
                    {/* 1. CORE OPERATIONS / HR OPERATIONS Section (For non-BD roles) */}
                    {!isBDRole && (
                        <>
                            <p className="px-3 pb-1.5 text-xs font-medium text-text-tertiary">
                                {['hr', 'hr_head', 'hr_manager', 'hr_ops'].includes(userRole) ? 'HR operations' : 'Core operations'}
                            </p>
                            {NAV_ITEMS.map((item) => {
                                let isActive = false;
                                if (item.href.includes('?tab=')) {
                                    const [itemPath, itemQuery] = item.href.split('?');
                                    const itemParams = new URLSearchParams(itemQuery);
                                    const itemTab = itemParams.get('tab');
                                    if (itemPath.endsWith('/hr-tickets')) {
                                        isActive = pathname.endsWith('/hr-tickets') && (currentTab === itemTab || (!currentTab && itemTab === 'tickets'));
                                    } else {
                                        isActive = pathname === itemPath && currentTab === itemTab;
                                    }
                                } else if (item.href.includes('?')) {
                                    const [itemPath, itemQuery] = item.href.split('?');
                                    isActive = pathname === itemPath && (searchParams.toString().includes(itemQuery));
                                } else {
                                    isActive = pathname === item.href && (!searchParams.get('tab'));
                                }

                                const linkElement = (
                                    <Link
                                        href={item.href}
                                        onClick={handleLinkClick}
                                        className={`
                                            flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group
                                            ${isActive
                                                ? 'bg-[#587e85] text-white'
                                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                            }
                                        `}
                                    >
                                        <item.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                                        <span className="truncate">{item.label}</span>
                                    </Link>
                                );

                                if (['hr', 'hr_head', 'hr_manager', 'hr_ops'].includes(userRole) || isOrgSuperAdmin) {
                                    return (
                                        <React.Fragment key={`${item.label}-${item.href}`}>
                                            {linkElement}
                                        </React.Fragment>
                                    );
                                }

                                return (
                                    <CapabilityWrapper key={`${item.label}-${item.href}`} domain={item.domain} action="view">
                                        {linkElement}
                                    </CapabilityWrapper>
                                );
                            })}
                            {isHrRole && pettyCashAndBookRoomLinks}
                        </>
                    )}

                    {/* 2. BD Super Admin (CEO) — grouped Overview / Tools sections */}
                    {isBdSuperAdmin && isCrmRoute && (
                        <div className="space-y-6">
                            {BD_SUPER_NAV_SECTIONS.map((section) => (
                                <div key={section.title}>
                                    <p className="px-3 mb-2 text-xs font-medium text-text-tertiary">
                                        {section.title}
                                    </p>
                                    <div className="space-y-0.5">
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
                                                        flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group
                                                        ${isActive
                                                            ? 'bg-primary text-text-inverse'
                                                            : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                                                        }
                                                    `}
                                                >
                                                    <item.icon className="w-4 h-4 shrink-0" />
                                                    <span className="truncate">{item.label}</span>
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 3. CRM Section (for BD roles, or when visiting CRM routes) */}
                    {(isCrmRoute || isBDRole) && !showBdChrome && !['hr', 'hr_head', 'property_admin', 'building_admin', 'ops_super_admin'].includes(userRole) && (
                        <div className={isBDRole ? '' : 'pt-3 mt-3 border-t border-border'}>
                            <p className="px-3 mb-2 text-xs font-medium text-text-tertiary">
                                CRM
                            </p>
                            <div className="space-y-0.5">
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
                                                flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group
                                                ${isActive
                                                    ? 'bg-primary text-text-inverse'
                                                    : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                                                }
                                            `}
                                        >
                                            <item.icon className="w-4 h-4 shrink-0" />
                                            <span className="truncate">{item.label}</span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 4. SYSTEM & PERSONAL Section (Always below primary role navigation) */}
                    {!isExternalRole && (
                        <div className="pt-3 mt-3 border-t border-slate-200/60 dark:border-slate-800 space-y-0.5">
                            <p className="px-3 pb-1.5 text-xs font-medium text-text-tertiary">
                                System and personal
                            </p>

                            {!isHrRole && pettyCashAndBookRoomLinks}

                            {!['hr', 'hr_head', 'hr_manager', 'hr_ops'].includes(userRole) && (
                                <Link
                                    href={isOrgSuperAdmin ? `/${orgId}/dashboard?tab=grievance` : `/${orgId}/hr-tickets?tab=tickets`}
                                    onClick={handleLinkClick}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group ${
                                        (isOrgSuperAdmin ? (pathname?.endsWith('/dashboard') && currentTab === 'grievance') : (pathname?.includes('/hr-tickets') && (!currentTab || currentTab === 'tickets')))
                                            ? 'bg-[#587e85] text-white'
                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                    }`}
                                >
                                    <ShieldCheck className="w-4 h-4 shrink-0" />
                                    <span className="truncate">{isOrgSuperAdmin ? 'HR & Grievances' : 'My Grievances'}</span>
                                </Link>
                            )}

                            {isOrgSuperAdmin && (
                                <Link
                                    href={isCrmRoute ? `/${orgId}/crm/tasks` : `/${orgId}/dashboard?tab=tasks`}
                                    onClick={handleLinkClick}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group ${
                                        (isCrmRoute ? pathname?.startsWith(`/${orgId}/crm/tasks`) : pathname?.includes('tab=tasks'))
                                            ? 'bg-[#587e85] text-white'
                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                    }`}
                                >
                                    <ClipboardList className="w-4 h-4 shrink-0" />
                                    <span className="truncate">Task Manager</span>
                                </Link>
                            )}

                            {(userRole !== 'hr' && userRole !== 'hr_head' && (isOrgSuperAdmin || userRole === 'property_admin')) && (
                                <Link
                                    href={isCrmRoute ? `/${orgId}/crm/ai` : `/${orgId}/dashboard?tab=ai_tickets`}
                                    onClick={handleLinkClick}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group ${
                                        (isCrmRoute ? pathname?.startsWith(`/${orgId}/crm/ai`) : pathname?.includes('tab=ai_tickets'))
                                            ? 'bg-[#587e85] text-white'
                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                    }`}
                                >
                                    <Bot className="w-4 h-4 shrink-0" />
                                    <span className="truncate">{isCrmRoute ? 'AI Agent' : 'AI Automation'}</span>
                                </Link>
                            )}

                            <button
                                type="button"
                                onClick={() => {
                                    setShowFeedbackModal(true);
                                    handleLinkClick();
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 text-left group"
                            >
                                <MessageSquarePlus className="w-4 h-4 shrink-0" />
                                <span className="truncate">Feedback and bugs</span>
                            </button>

                            <Link
                                href={isCrmRoute ? `/${orgId}/crm/settings` : `/${orgId}/settings`}
                                onClick={handleLinkClick}
                                className={`flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group ${
                                    (isCrmRoute
                                        ? pathname === `/${orgId}/crm/settings` && (!currentTab || currentTab !== 'profile')
                                        : pathname?.endsWith('/settings') && (!currentTab || currentTab !== 'profile'))
                                        ? 'bg-[#587e85] text-white'
                                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                }`}
                            >
                                <Settings className="w-4 h-4 shrink-0" />
                                <span className="truncate">Settings</span>
                            </Link>

                            <Link
                                href={isCrmRoute ? `/${orgId}/crm/settings?tab=profile` : `/${orgId}/settings?tab=profile`}
                                onClick={handleLinkClick}
                                className={`flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group ${
                                    (isCrmRoute
                                        ? pathname === `/${orgId}/crm/settings` && currentTab === 'profile'
                                        : pathname?.includes('tab=profile'))
                                        ? 'bg-[#587e85] text-white'
                                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900'
                                }`}
                            >
                                <UserCircle className="w-4 h-4 shrink-0" />
                                <span className="truncate">Profile</span>
                            </Link>
                        </div>
                    )}
                </nav>

                {/* Bottom Section */}
                <div className="p-3 space-y-1 border-t border-slate-200/60 dark:border-slate-800 shrink-0 bg-surface mt-auto">
                    {/* User Profile */}
                    {!showBdChrome && (
                        <div className="px-2 py-1">
                            <div className="flex items-center gap-2.5">
                                {user?.user_metadata?.user_photo_url || user?.user_metadata?.avatar_url ? (
                                    <img
                                        src={user.user_metadata.user_photo_url || user.user_metadata.avatar_url}
                                        alt="Profile"
                                        className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200"
                                    />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-[#587e85] flex items-center justify-center text-white font-semibold text-xs shrink-0">
                                        {getUserInitials(user?.email || 'User')}
                                    </div>
                                )}
                                <div className="flex flex-col flex-1 min-w-0">
                                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                                        {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
                                    </span>
                                    <span className="text-[11px] text-text-tertiary truncate">
                                        {user?.email || 'user@worksquare.in'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => setShowSignOutModal(true)}
                            className="flex items-center gap-2 px-2 py-1.5 text-slate-500 hover:text-red-600 transition-colors duration-150 text-xs font-medium rounded-[8px] hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                            <LogOut className="w-4 h-4 shrink-0" />
                            <span>Sign out</span>
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

            <div className="flex items-center justify-end">
                <NotificationBell align="right" />
            </div>
        </div>
    );
}
