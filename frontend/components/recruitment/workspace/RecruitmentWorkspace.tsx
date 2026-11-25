'use client';

import React, { useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
    ArrowLeft, BadgeIndianRupee, BarChart3, ClipboardList, FileSpreadsheet, FileText, FolderKanban, LayoutDashboard,
    Layers, Mail, Plus, Search, Send, Settings2, Sparkles, Users,
} from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { HR_SIDEBAR_ROLES } from '@/frontend/components/layout/DashboardSidebar';
import CandidateSearchTab, { RECRUITMENT_VIEW_IDS, type RecruitmentView } from '@/frontend/components/candidates/CandidateSearchTab';
import RecruitmentHub from './RecruitmentHub';

/*
 * The Recruitment workspace (owner 2026-11-25): the base of the HRMS. The sidebar's Recruitment item opens it, the way
 * Business Development opens the CRM. It has its own chrome (design "21 · Hub"): a glass rail on the left with Home and
 * every recruitment screen, and "Autopilot" at the foot to go back to the app. Home is the Hub; the other rail items
 * are the existing Recruitment views, unchanged. The open item is kept in ?view= so a refresh or a shared link lands
 * on the same screen.
 */

type WorkspaceView = 'home' | RecruitmentView;

const RAIL: Array<{ id: WorkspaceView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'home', label: 'Home', icon: LayoutDashboard },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'requisitions', label: 'Requests', icon: ClipboardList },
    { id: 'positions', label: 'Positions', icon: FolderKanban },
    { id: 'pipeline', label: 'Pipeline', icon: Layers },
    { id: 'offers', label: 'Offers', icon: BadgeIndianRupee },
    { id: 'candidates', label: 'People', icon: Users },
    { id: 'resumes', label: 'Resumes', icon: FileText },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'outreach', label: 'Outreach', icon: Send },
    { id: 'sheets', label: 'Sheets', icon: FileSpreadsheet },
    { id: 'dashboard', label: 'Reports', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings2 },
];

const TITLES: Record<WorkspaceView, string> = {
    home: 'Recruitment', search: 'Search', requisitions: 'Hiring requests', positions: 'Positions', pipeline: 'Pipeline',
    offers: 'Offers', candidates: 'People', resumes: 'Resumes', email: 'Email', outreach: 'Outreach', sheets: 'Sheets',
    dashboard: 'Reports', settings: 'Settings',
};

const isView = (v: string | null): v is RecruitmentView => !!v && (RECRUITMENT_VIEW_IDS as readonly string[]).includes(v);

export default function RecruitmentWorkspace({ orgId }: { orgId: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { user, membership } = useAuth();

    const viewParam = searchParams?.get('view') ?? null;
    const view: WorkspaceView = isView(viewParam) ? viewParam : 'home';

    const go = useCallback((next: WorkspaceView) => {
        const params = new URLSearchParams(searchParams?.toString() ?? '');
        if (next === 'home') params.delete('view'); else params.set('view', next);
        const q = params.toString();
        router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
    }, [pathname, router, searchParams]);

    // Back to the app: the HR logins' home is the HR console, everyone else's (Tech, admins) the dashboard.
    // Same role source as the shared sidebar.
    const role = (user?.user_metadata?.role || membership?.org_role || membership?.properties?.[0]?.role || 'employee').toLowerCase();
    const appHref = HR_SIDEBAR_ROLES.includes(role) ? '/hr-tickets' : '/dashboard';

    const firstName = ((user?.user_metadata?.full_name as string | undefined) || user?.email?.split('@')[0] || '').split(' ')[0];
    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

    return (
        // data-recruitment-workspace switches on the workspace skin in app/globals.css (indigo glass tokens, this page only).
        <div data-recruitment-workspace="" className="relative isolate flex min-h-[calc(100dvh/var(--app-zoom,1))] flex-col overflow-hidden bg-[#f6f7fb] text-[#17152d] md:flex-row dark:bg-[#0f1020] dark:text-[#f0eff4]">
            {/* Soft colour behind the glass (design "21 · Hub"). Decoration only. */}
            <div aria-hidden className="pointer-events-none absolute -top-44 left-40 -z-10 h-[520px] w-[520px] rounded-full bg-[#c7d2fe] opacity-[.24] blur-[100px] motion-safe:animate-[rw-drift_17s_ease-in-out_infinite_alternate] dark:opacity-[.16]" />
            <div aria-hidden className="pointer-events-none absolute -right-32 top-64 -z-10 h-[460px] w-[460px] rounded-full bg-[#ddd6fe] opacity-[.24] blur-[100px] motion-safe:animate-[rw-drift_17s_ease-in-out_-6s_infinite_alternate] dark:opacity-[.16]" />
            <div aria-hidden className="pointer-events-none absolute -bottom-52 left-[34%] -z-10 h-[500px] w-[500px] rounded-full bg-[#e0e7ff] opacity-[.24] blur-[100px] motion-safe:animate-[rw-drift_17s_ease-in-out_-11s_infinite_alternate] dark:opacity-[.16]" />
            <style>{'@keyframes rw-drift{from{transform:translate(0,0) scale(1)}to{transform:translate(50px,-36px) scale(1.14)}}'}</style>

            <nav
                aria-label="Recruitment sections"
                className="relative z-10 m-3 flex shrink-0 gap-0.5 overflow-x-auto rounded-[26px] border border-white/95 bg-white/65 p-2 shadow-[0_14px_38px_rgba(60,60,120,.1)] backdrop-blur-[26px] md:sticky md:top-4 md:m-4 md:max-h-[calc(100dvh/var(--app-zoom,1)-2rem)] md:w-[88px] md:flex-col md:overflow-y-auto md:overflow-x-hidden md:px-2 md:py-3 dark:border-white/[.13] dark:bg-white/[.07] dark:shadow-[0_14px_38px_rgba(0,0,0,.45)]"
            >
                <div className="hidden justify-center pb-2.5 pt-0.5 md:flex">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#4f46e5] text-white"><Sparkles className="h-5 w-5" aria-hidden /></span>
                </div>
                {RAIL.map(({ id, label, icon: Icon }) => {
                    const on = view === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => go(id)}
                            aria-current={on ? 'page' : undefined}
                            className={`flex min-h-[54px] min-w-[68px] shrink-0 flex-col items-center justify-center gap-[3px] rounded-[18px] px-0.5 py-2 text-[11px] font-bold transition-[background-color,color,transform] duration-200 md:min-w-0 ${on
                                ? 'bg-[#4f46e5] text-white shadow-[0_10px_24px_rgba(79,70,229,.25)]'
                                : 'text-[#4a4765] hover:-translate-y-0.5 hover:bg-[#17152d]/5 hover:text-[#17152d] dark:text-[#c2c0d0] dark:hover:bg-white/[.07] dark:hover:text-white'}`}
                        >
                            <Icon className="h-[19px] w-[19px]" aria-hidden />
                            <span>{label}</span>
                        </button>
                    );
                })}
                <div className="hidden min-h-3 grow md:block" />
                {/* Back to the app, the way the CRM's switch goes back to the FMS. */}
                <Link
                    href={appHref}
                    title="Back to the Autopilot app"
                    className="flex min-h-[54px] min-w-[68px] shrink-0 flex-col items-center justify-center gap-[3px] rounded-[18px] px-0.5 py-2 text-[11px] font-bold text-[#4a4765] transition-[background-color,color,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#17152d]/5 hover:text-[#17152d] md:min-w-0 dark:text-[#c2c0d0] dark:hover:bg-white/[.07] dark:hover:text-white"
                >
                    <ArrowLeft className="h-[19px] w-[19px]" aria-hidden />
                    <span>Autopilot</span>
                </Link>
            </nav>

            <main id="recruitment-main" className="relative z-0 flex min-w-0 flex-1 flex-col gap-4 px-3 pb-7 md:py-[18px] md:pl-1 md:pr-6">
                <header className="flex flex-wrap items-center gap-3">
                    <div className="mr-2">
                        <h1 className="m-0 font-display text-2xl font-extrabold tracking-[-0.03em]">{TITLES[view]}</h1>
                        <p className="m-0 text-[13px] text-[#4a4765] dark:text-[#c2c0d0]">{view === 'home' ? today : 'Recruitment'}</p>
                    </div>
                    <div className="grow" />
                    {view !== 'search' && (
                        <button
                            type="button"
                            onClick={() => go('search')}
                            className="flex min-h-11 w-full items-center gap-2.5 rounded-full border border-white/95 bg-white/65 px-4 text-left text-sm text-[#5f5c79] backdrop-blur-[24px] transition-colors hover:text-[#17152d] sm:w-[260px] dark:border-white/[.13] dark:bg-white/[.07] dark:text-[#a3a1b6] dark:hover:text-white"
                        >
                            <Search className="h-[17px] w-[17px] shrink-0" aria-hidden />Search people or roles
                        </button>
                    )}
                    {view !== 'requisitions' && (
                        <button
                            type="button"
                            onClick={() => go('requisitions')}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#4f46e5] bg-[#4f46e5] px-[18px] text-sm font-bold text-white shadow-[0_10px_24px_rgba(79,70,229,.22)] transition-transform hover:-translate-y-0.5 active:scale-[.96]"
                        >
                            <Plus className="h-4 w-4" aria-hidden />Hiring requests
                        </button>
                    )}
                </header>

                {view === 'home' && <RecruitmentHub orgId={orgId} firstName={firstName} onOpen={go} />}

                {/* Every other rail item is the existing Recruitment view. Kept mounted once opened, so going Home and
                    back never loses a search or an upload in progress. */}
                <div data-recruitment-views="" className="min-w-0">
                    <CandidateSearchTab
                        orgId={orgId}
                        collapseStyle="chevron"
                        view={view === 'home' ? null : view}
                        onViewChange={go}
                        hideTabs
                    />
                </div>
            </main>
        </div>
    );
}
