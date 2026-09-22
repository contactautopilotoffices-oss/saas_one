'use client';

import { useAuth } from "@/frontend/context/AuthContext";
import { useRouter, useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { ContextBar } from "@/frontend/components/layout/ContextBar";
import DashboardSidebar, { MobileHeader } from "@/frontend/components/layout/DashboardSidebar";
import Loader from "@/frontend/components/ui/Loader";
import ModuleSwitch from "@/frontend/components/layout/ModuleSwitch";
import { isBdSuperAdmin } from "@/frontend/constants/bdSuperAdmins";
import CrmBackground, { useWallpaper, crmThemeVars, useIsDark } from "@/frontend/components/ui/CrmBackground";

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
    // The Accounts (Finance) workspace renders its OWN chrome via its nested
    // layout — same pattern as the FMS dashboard — so skip the shared sidebar.
    const isAccountsWorkspace = !!pathname && /\/(accounts|petty-cash|aop)(\/|$)/.test(pathname);

    if (isFullDashboard) {
        // FMS dashboard renders its own chrome (no shared sidebar) — still surface
        // the CRM⇄FMS switch for BD Super Admins.
        return <>{children}<ModuleSwitch /></>;
    }

    if (isAccountsWorkspace) {
        // Accounts workspace provides its own sidebar; render it bare.
        return <>{children}</>;
    }

    // BD Super Admin's CEO dashboard (/{orgId}/crm) renders its own rich top bar
    // (search + AI Agent + notifications + profile), so the shared ContextBar
    // breadcrumb strip would be redundant — hide it on that one route.
    const hideContextBar = pathname?.endsWith('/crm')
        && isBdSuperAdmin(user?.email, membership?.org_role);

    return (
        <div className={`flex min-h-screen ${wallpaperActive ? '' : 'bg-[#fafbfc]'}`} style={tintStyle}>
            {/* Per-user CRM wallpaper — CRM routes only for now */}
            {isCrmRoute && <CrmBackground />}

            {/* Mobile Header */}
            <MobileHeader onMenuToggle={() => setIsMobileSidebarOpen(true)} />

            {/* Sidebar */}
            <DashboardSidebar
                isOpen={isSidebarOpen}
                onClose={() => toggleSidebar(false)}
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
            <div className={`flex-1 flex flex-col min-w-0 pt-[56px] lg:pt-0 ${isSidebarOpen ? 'lg:pl-72' : 'lg:pl-0'} transition-[padding] duration-300 ease-in-out border-l border-slate-300 shadow-[-4px_0_12px_-4px_rgba(0,0,0,0.05)] relative z-10 ${wallpaperActive ? 'bg-transparent crm-chameleon' : 'bg-background'}`}>
                {/* Context Bar - Hidden on mobile, shown on desktop */}
                {!hideContextBar && (
                    <div className="hidden lg:block">
                        <ContextBar
                            isSidebarOpen={isSidebarOpen}
                            onToggleSidebar={() => toggleSidebar(true)}
                        />
                    </div>
                )}

                <main className="flex-1 overflow-y-auto overflow-x-hidden max-w-full min-w-0 touch-scroll responsive-container py-4 lg:py-6">
                    {children}
                </main>
            </div>

            {/* CRM ⇄ FMS switch (BD Super Admins only; self-gates) */}
            <ModuleSwitch />
        </div>
    );
}
