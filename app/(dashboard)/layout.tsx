'use client';

import { useAuth } from "@/frontend/context/AuthContext";
import { useRouter, useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { ContextBar } from "@/frontend/components/layout/ContextBar";
import DashboardSidebar, { HR_SIDEBAR_ROLES, MobileHeader } from "@/frontend/components/layout/DashboardSidebar";
import Loader from "@/frontend/components/ui/Loader";
import PettyCashShell from '@/frontend/components/layout/PettyCashShell';
import ModuleSwitch from "@/frontend/components/layout/ModuleSwitch";
import { isBdSuperAdmin } from "@/frontend/constants/bdSuperAdmins";
import CrmBackground, { useWallpaper, crmThemeVars, useIsDark } from "@/frontend/components/ui/CrmBackground";
import AppZoom from "@/frontend/components/layout/AppZoom";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, membership, isLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const pathname = usePathname();
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const wallpaper = useWallpaper();
    const isDark = useIsDark();

    useEffect(() => {
        try {
            const saved = localStorage.getItem('dashboard_sidebar_open');
            if (saved !== null) {
                setIsSidebarOpen(saved === 'true');
            }
        } catch {}
    }, []);

    const toggleSidebar = (openState?: boolean) => {
        setIsSidebarOpen(prev => {
            const next = openState !== undefined ? openState : !prev;
            try {
                localStorage.setItem('dashboard_sidebar_open', String(next));
            } catch {}
            return next;
        });
    };
    // Wallpaper + chameleon theming are gated to CRM routes for now (test here,
    // then go global). Non-CRM modules keep the standard chrome.
    const isCrmRoute = pathname?.split('/').includes('crm') ?? false;
    const wallpaperActive = !!wallpaper.url && isCrmRoute;
    // Chameleon theme: shift sidebar, cards, buttons + text toward the accent.
    const tintStyle = wallpaperActive ? crmThemeVars(wallpaper.accent, isDark) : undefined;
    useEffect(() => {
        if (!isLoading && !user) {
            router.push('/login');
        }
    }, [user, isLoading, router]);

    // Close mobile sidebar on route change
    useEffect(() => {
        setIsMobileSidebarOpen(false);
    }, [pathname]);

    // Prevent body scroll when mobile sidebar is open
    useEffect(() => {
        if (isMobileSidebarOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isMobileSidebarOpen]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background text-primary font-display font-bold">
                <Loader size="lg" text="Initializing..." />
            </div>
        );
    }

    if (!user) {
        return null;
    }

    const isFullDashboard = pathname?.endsWith('/dashboard');
    const isPettyCashWorkspace = !!pathname && /\/petty-cash(\/|$)/.test(pathname);
    // The Accounts (Finance) workspace renders its OWN chrome via its nested
    // layout — same pattern as the FMS dashboard — so skip the shared sidebar.
    const isAccountsWorkspace = !!pathname && /\/(accounts|aop)(\/|$)/.test(pathname);

    if (isFullDashboard || isPettyCashWorkspace) {
        // FMS dashboard renders its own chrome (no shared sidebar) — still surface
        // the CRM⇄FMS switch for BD Super Admins.
        return <><AppZoom /><PettyCashShell>{isPettyCashWorkspace ? children : undefined}</PettyCashShell><ModuleSwitch /></>;
    }

    if (isAccountsWorkspace) {
        // Accounts workspace provides its own sidebar; render it bare.
        return <><AppZoom />{children}</>;
    }

    // BD Super Admin's CEO dashboard (/{orgId}/crm) renders its own rich top bar
    // (search + AI Agent + notifications + profile), so the shared ContextBar
    // breadcrumb strip would be redundant — hide it on that one route.
    const hideContextBar = pathname?.endsWith('/crm')
        && isBdSuperAdmin(user?.email, membership?.org_role);

    // Owner 2026-11-09: for the HR logins a collapsed sidebar stays as an 80px icon rail (see DashboardSidebar), so the
    // content keeps that much room and the header's "open sidebar" button is not needed. Same role source as the sidebar.
    const sidebarRole = (user?.user_metadata?.role || membership?.org_role || membership?.properties?.[0]?.role || 'employee').toLowerCase();
    const hasSidebarRail = HR_SIDEBAR_ROLES.includes(sidebarRole);

    // Owner 2026-11-09: on the HR console page (/hr-tickets) the content scrolls inside <main>, not the page, so the
    // header bar stays put and Candidate Search's filters can stick. <body> has overflow-x: hidden app-wide, which stops
    // position: sticky working against the page (the Tech console does the same for the same reason). Desktop only:
    // phones keep the page scroll under the fixed mobile header. Other pages of this layout are unchanged.
    const containedScroll = !!pathname && /\/hr-tickets$/.test(pathname);

    return (
        <div className={`flex min-h-screen ${containedScroll ? 'lg:h-[calc(100dvh/var(--app-zoom,1))] lg:overflow-hidden' : ''} ${wallpaperActive ? '' : 'bg-[#fafbfc]'}`} style={tintStyle}>
            {/* Owner 2026-10-26: one consistent scale on every screen */}
            <AppZoom />

            {/* Per-user CRM wallpaper — CRM routes only for now */}
            {isCrmRoute && <CrmBackground />}

            {/* Mobile Header */}
            <MobileHeader onMenuToggle={() => setIsMobileSidebarOpen(true)} />

            {/* Sidebar */}
            <DashboardSidebar
                isOpen={isSidebarOpen}
                onClose={() => toggleSidebar(false)}
                onOpen={() => toggleSidebar(true)}
                isMobileOpen={isMobileSidebarOpen}
                onMobileClose={() => setIsMobileSidebarOpen(false)}
            />

            {/* Fallback Floating Open Sidebar button if ContextBar is hidden on desktop */}
            {!isSidebarOpen && hideContextBar && (
                <button
                    type="button"
                    onClick={() => toggleSidebar(true)}
                    className="hidden lg:flex fixed top-3 left-4 z-50 items-center justify-center p-2.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:text-[#587e85] border border-slate-200 dark:border-slate-800 rounded-xl shadow-md transition-all group active:scale-95 cursor-pointer"
                    title="Open Sidebar"
                    aria-label="Open Sidebar"
                >
                    <Menu className="w-4 h-4 text-[#587e85] group-hover:scale-110 transition-transform" />
                </button>
            )}

            {/* Main Content */}
            <div className={`flex-1 flex flex-col min-w-0 pt-[56px] lg:pt-0 ${isSidebarOpen ? 'lg:pl-72' : hasSidebarRail ? 'lg:pl-20' : 'lg:pl-0'} ${containedScroll ? 'lg:min-h-0' : ''} transition-[padding] duration-300 ease-in-out border-l border-slate-300 shadow-[-4px_0_12px_-4px_rgba(0,0,0,0.05)] relative z-10 ${wallpaperActive ? 'bg-transparent crm-chameleon' : 'bg-background'}`}>
                {/* Context Bar - Hidden on mobile, shown on desktop */}
                {!hideContextBar && (
                    <div className="hidden lg:block shrink-0">
                        <ContextBar
                            isSidebarOpen={isSidebarOpen || hasSidebarRail}
                            onToggleSidebar={() => toggleSidebar(true)}
                        />
                    </div>
                )}

                {/* --panel-sticky-top: where a sticky side panel (Candidate Search's filters) rests. The header bar is
                    outside this scroller, so 1rem; the Tech console keeps its header inside and uses the 5rem default. */}
                <main className={`flex-1 overflow-y-auto overflow-x-hidden max-w-full min-w-0 touch-scroll responsive-container py-4 lg:py-6 ${containedScroll ? 'lg:min-h-0 lg:[--panel-sticky-top:1rem]' : ''}`}>
                    {children}
                </main>
            </div>

            {/* CRM ⇄ FMS switch (BD Super Admins only; self-gates) */}
            <ModuleSwitch />
        </div>
    );
}
