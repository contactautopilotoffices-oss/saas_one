'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Building2, ChevronDown, ClipboardList, Droplets, FlaskConical, FolderOpen, Fuel, GitBranch, Layers, LayoutDashboard, LogOut,
    Menu, Mic, ScanFace, TrendingUp, Gauge, UserCircle, Users, Wrench, X, Zap,
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { useAuth } from '@/frontend/context/AuthContext';
import SignOutModal from '@/frontend/components/ui/SignOutModal';
import TabLoading from './TabLoading';

/**
 * Tech console (owner 2026-10-22): the Tech team's own dashboard. It is a separate copy, not the Super Admin console:
 * changing one never changes the other. It holds only the Super Admin tabs that work for a 'tech' login WITHOUT any
 * super-admin permission, plus the Task Manager Control Centre (which is Tech-only).
 */

const TaskManagerSuperuserDashboard = dynamic(() => import('@/frontend/components/task-manager/TaskManagerSuperuserDashboard'), { loading: TabLoading });
const TaskManagerTestingDashboard = dynamic(() => import('@/frontend/components/task-manager/TaskManagerTestingDashboard'), { loading: TabLoading });
const MeetingsTab = dynamic(() => import('@/frontend/components/task-manager/meetings/MeetingsTab'), { loading: TabLoading });
const WaterDashboard = dynamic(() => import('@/frontend/components/water/WaterDashboard').then(m => m.WaterDashboard), { loading: TabLoading });
const WaterAnalyticsDashboard = dynamic(() => import('@/frontend/components/water/WaterAnalyticsDashboard'), { loading: TabLoading });
const DieselStaffDashboard = dynamic(() => import('../diesel/DieselStaffDashboard'), { loading: TabLoading });
const DieselAnalyticsDashboard = dynamic(() => import('../diesel/DieselAnalyticsDashboard'), { loading: TabLoading });
const ElectricityStaffDashboard = dynamic(() => import('../electricity/ElectricityStaffDashboard'), { loading: TabLoading });
const OrgProgressTracker = dynamic(() => import('@/frontend/components/org-efficiency/OrgProgressTracker'), { loading: TabLoading });
const OrgEfficiencyMeter = dynamic(() => import('@/frontend/components/org-efficiency/OrgEfficiencyMeter'), { loading: TabLoading });
const VMSOrgVisitorDashboard = dynamic(() => import('@/frontend/components/vms/VMSOrgVisitorDashboard'), { loading: TabLoading });
const VMSFaceDashboard = dynamic(() => import('@/frontend/components/vms-face/VMSFaceDashboard'), { loading: TabLoading });
const EscalationHierarchyBuilder = dynamic(() => import('@/frontend/components/escalation/EscalationHierarchyBuilder'), { loading: TabLoading });
const PPMModule = dynamic(() => import('@/frontend/components/ppm/PPMModule'), { loading: TabLoading });
// Owner 2026-10-29: the drive Tech shares with the Design team (the Design console has the same tab)
const FilesTab = dynamic(() => import('@/frontend/components/files/FilesTab'), { loading: TabLoading });

type TechTab =
    | 'tasks' | 'control_centre' | 'meetings' | 'vms_face' | 'files'
    | 'water_logger' | 'water' | 'diesel_logger' | 'diesel' | 'electricity_logger' | 'ppm'
    | 'org_progress' | 'org_efficiency' | 'visitors' | 'escalation'
    | 'profile';

interface NavItem { id: TechTab; label: string; icon: React.ComponentType<{ className?: string }> }

const NAV: Array<{ section: string; items: NavItem[] }> = [
    {
        section: 'Tech',
        items: [
            { id: 'tasks', label: 'Task Manager', icon: ClipboardList },
            { id: 'control_centre', label: 'Control Centre', icon: FlaskConical },
            // Owner 2026-10-29: Meeting Assistant (record a meeting, review the task list, send the tasks)
            { id: 'meetings', label: 'Meeting Assistant', icon: Mic },
            { id: 'vms_face', label: 'VMS Face (Testing)', icon: ScanFace },
            { id: 'files', label: 'Files', icon: FolderOpen },
        ],
    },
    {
        section: 'Utilities & Maintenance',
        items: [
            { id: 'water_logger', label: 'Water Logger', icon: Droplets },
            { id: 'water', label: 'Water Analytics', icon: Droplets },
            { id: 'diesel_logger', label: 'Diesel Logger', icon: Fuel },
            { id: 'diesel', label: 'Diesel Analytics', icon: Fuel },
            { id: 'electricity_logger', label: 'Electricity Logger', icon: Zap },
            { id: 'ppm', label: 'PPM', icon: Wrench },
        ],
    },
    {
        section: 'Organisation',
        items: [
            { id: 'org_progress', label: 'Org Progress', icon: TrendingUp },
            { id: 'org_efficiency', label: 'Org Efficiency', icon: Gauge },
            { id: 'visitors', label: 'Visitors', icon: Users },
            { id: 'escalation', label: 'Escalation', icon: GitBranch },
        ],
    },
    {
        section: 'Personal',
        items: [{ id: 'profile', label: 'Profile', icon: UserCircle }],
    },
];
const ALL_TABS = NAV.flatMap(s => s.items);
const DEFAULT_TAB: TechTab = 'tasks';
const isTechTab = (v: string | null): v is TechTab => !!v && ALL_TABS.some(t => t.id === v);

/** Tabs that need one property chosen first (they log readings for a building). */
const NEEDS_PROPERTY: Partial<Record<TechTab, string>> = {
    water_logger: 'water logs',
    diesel_logger: 'diesel logs',
    electricity_logger: 'electricity logs',
    vms_face: 'the face VMS',
};

interface Property { id: string; name: string; code: string; image_url?: string }
interface Organization { id: string; name: string }

export default function TechDashboard() {
    const { user, signOut } = useAuth();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = useMemo(() => createClient(), []);
    const orgId = decodeURIComponent((params?.orgId as string) || '').trim().replace(/\s+/g, '');

    const tabParam = searchParams.get('tab');
    const activeTab: TechTab = isTechTab(tabParam) ? tabParam : DEFAULT_TAB;
    // Owner 2026-10-29: the Meeting Assistant stays mounted once opened (hidden on other tabs), so switching tabs never stops a recording
    const [assistantOpened, setAssistantOpened] = useState(false);
    if (activeTab === 'meetings' && !assistantOpened) setAssistantOpened(true);
    const selectedPropertyId = searchParams.get('propertyId') || 'all';

    const [org, setOrg] = useState<Organization | null>(null);
    const [properties, setProperties] = useState<Property[]>([]);
    const [errorMsg, setErrorMsg] = useState('');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [showSignOut, setShowSignOut] = useState(false);

    useEffect(() => {
        if (!orgId) return;
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase.from('organizations').select('id, name').eq('id', orgId).is('deleted_at', null).maybeSingle();
            if (cancelled) return;
            if (error || !data) { setErrorMsg('Could not load your organisation.'); return; }
            setOrg(data);
            const { data: props } = await supabase.from('properties').select('id, name, code, image_url').eq('organization_id', data.id).order('name');
            if (!cancelled) setProperties(props || []);
        })();
        return () => { cancelled = true; };
    }, [orgId, supabase]);

    const setQuery = useCallback((patch: Record<string, string | null>) => {
        const next = new URLSearchParams(window.location.search);
        Object.entries(patch).forEach(([k, v]) => (v === null ? next.delete(k) : next.set(k, v)));
        router.replace(`${window.location.pathname}?${next.toString()}`, { scroll: false });
    }, [router]);

    const openTab = (tab: TechTab) => { setSidebarOpen(false); setQuery({ tab }); };
    const pickProperty = (id: string) => { setSelectorOpen(false); setQuery({ propertyId: id === 'all' ? null : id }); };

    const activeProperty = properties.find(p => p.id === selectedPropertyId) || null;
    const tabLabel = ALL_TABS.find(t => t.id === activeTab)?.label || 'Tech Console';
    const fullName = (user?.user_metadata?.full_name as string | undefined) || user?.email || 'Tech';
    const photo = (user?.user_metadata?.user_photo_url || user?.user_metadata?.avatar_url) as string | undefined;

    const propertySelector = properties.length > 0 && (
        <div className="relative">
            <button type="button" onClick={() => setSelectorOpen(o => !o)} aria-haspopup="listbox" aria-expanded={selectorOpen}
                className="flex min-w-[180px] items-center gap-2.5 rounded-xl border border-border bg-surface-elevated px-3 py-2 text-left transition-all hover:border-primary sm:min-w-[220px]">
                <Building2 className="h-4 w-4 shrink-0 text-text-tertiary" />
                <span className="flex-1 truncate text-sm font-medium text-text-primary">{activeProperty ? activeProperty.name : 'All Properties'}</span>
                <ChevronDown className={`h-4 w-4 text-text-tertiary transition-transform ${selectorOpen ? 'rotate-180' : ''}`} />
            </button>
            {selectorOpen && (
                <>
                    <button type="button" aria-label="Close" className="fixed inset-0 z-[60] cursor-default" onClick={() => setSelectorOpen(false)} />
                    <div role="listbox" aria-label="Property" className="absolute right-0 z-[70] mt-2 max-h-80 w-72 overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-2 shadow-2xl">
                        <button type="button" role="option" aria-selected={selectedPropertyId === 'all'} onClick={() => pickProperty('all')}
                            className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${selectedPropertyId === 'all' ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:bg-background'}`}>
                            <LayoutDashboard className="h-4 w-4" />
                            <span className="text-xs font-black uppercase tracking-tight">All Properties</span>
                        </button>
                        {properties.map(p => (
                            <button key={p.id} type="button" role="option" aria-selected={selectedPropertyId === p.id} onClick={() => pickProperty(p.id)}
                                className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${selectedPropertyId === p.id ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:bg-background'}`}>
                                <Building2 className="h-4 w-4 shrink-0" />
                                <span className="min-w-0">
                                    <span className="block truncate text-xs font-black uppercase tracking-tight">{p.name}</span>
                                    <span className="block text-[10px] font-bold uppercase tracking-widest opacity-70">{p.code}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );

    const needsProperty = NEEDS_PROPERTY[activeTab];
    const propertyFilter = selectedPropertyId === 'all' ? undefined : selectedPropertyId;

    return (
        <div className="flex min-h-screen bg-background font-inter text-foreground">
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-hidden border-r border-border bg-white transition-all duration-300 ${sidebarOpen ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 lg:translate-x-0 lg:opacity-100'}`}>
                <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Close menu" className="absolute right-4 top-4 rounded-lg p-2 hover:bg-surface-elevated lg:hidden">
                    <X className="h-5 w-5 text-text-secondary" />
                </button>
                <div className="flex shrink-0 flex-col items-center gap-1 p-5 pb-3">
                    <img src="/autopilot-logo-new.png" alt="Autopilot" className="h-10 w-auto object-contain" />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-text-tertiary">Tech Console</p>
                </div>
                <nav className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4" aria-label="Tech console">
                    {NAV.map(group => (
                        <div key={group.section} className="mb-6">
                            <p className="mb-3 flex items-center gap-2 px-4 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                <span className="h-3 w-0.5 rounded-full bg-primary" />{group.section}
                            </p>
                            <div className="space-y-1">
                                {group.items.map(item => {
                                    const Icon = item.icon;
                                    const on = activeTab === item.id;
                                    return (
                                        <button key={item.id} type="button" onClick={() => openTab(item.id)} aria-current={on ? 'page' : undefined}
                                            className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 ${on ? 'bg-primary text-text-inverse shadow-sm' : 'text-text-secondary hover:bg-muted hover:text-text-primary'}`}>
                                            <Icon className="h-4 w-4" />{item.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>
                <div className="shrink-0 border-t border-border p-4">
                    <div className="mb-3 flex items-center gap-3 px-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700">{fullName[0]?.toUpperCase()}</span>
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-bold text-text-primary">{fullName}</span>
                            <span className="block text-[10px] font-black uppercase tracking-widest text-text-tertiary">Access: Tech</span>
                        </span>
                    </div>
                    <button type="button" onClick={() => setShowSignOut(true)} className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50">
                        <LogOut className="h-4 w-4" /> Sign out
                    </button>
                </div>
            </aside>

            <SignOutModal isOpen={showSignOut} onClose={() => setShowSignOut(false)} onConfirm={signOut} />

            {/* Main */}
            <main className="w-full min-w-0 flex-1 bg-white lg:ml-72">
                <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border/10 bg-white px-4 md:px-8">
                    <div className="flex min-w-0 items-center gap-3">
                        <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Open menu" className="-ml-2 p-2 text-text-tertiary lg:hidden">
                            <Menu className="h-6 w-6" />
                        </button>
                        <h1 className="truncate font-display text-xl font-semibold tracking-tight text-text-primary md:text-2xl">{tabLabel}</h1>
                    </div>
                    {activeTab !== 'tasks' && activeTab !== 'control_centre' && activeTab !== 'meetings' && activeTab !== 'files' && activeTab !== 'profile' && propertySelector}
                </header>

                <div className="p-4 md:p-8">
                    {errorMsg && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{errorMsg}</p>}

                    {needsProperty && selectedPropertyId === 'all' ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <Layers className="mb-4 h-10 w-10 text-slate-300" />
                            <h3 className="mb-2 text-lg font-bold text-gray-900">Select a Property</h3>
                            <p className="max-w-xs text-sm text-gray-500">Please select a specific property from the dropdown above to view {needsProperty}.</p>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'tasks' && <TaskManagerSuperuserDashboard orgId={org?.id || ''} />}
                            {activeTab === 'control_centre' && <TaskManagerTestingDashboard orgId={org?.id || ''} />}
                            {assistantOpened && <div className={activeTab === 'meetings' ? '' : 'hidden'}><MeetingsTab space="tech" /></div>}
                            {activeTab === 'files' && org && <FilesTab orgId={org.id} team="tech" />}
                            {activeTab === 'vms_face' && propertyFilter && org && <VMSFaceDashboard key={propertyFilter} orgId={org.id} propertyId={propertyFilter} propertyName={activeProperty?.name || ''} />}
                            {activeTab === 'water_logger' && propertyFilter && <WaterDashboard propertyId={propertyFilter} />}
                            {activeTab === 'water' && <WaterAnalyticsDashboard key="water-analytics-tab" propertyId={propertyFilter} orgId={org?.id} properties={properties} />}
                            {activeTab === 'diesel_logger' && propertyFilter && <DieselStaffDashboard propertyId={propertyFilter} />}
                            {activeTab === 'diesel' && <DieselAnalyticsDashboard key="diesel-tab" propertyId={propertyFilter} orgId={org?.id} />}
                            {activeTab === 'electricity_logger' && propertyFilter && <ElectricityStaffDashboard propertyId={propertyFilter} />}
                            {activeTab === 'ppm' && org && <PPMModule organizationId={org.id} propertyId={propertyFilter} properties={properties} />}
                            {activeTab === 'org_progress' && <OrgProgressTracker key="org-progress-tab" />}
                            {activeTab === 'org_efficiency' && <OrgEfficiencyMeter key="org-efficiency-tab" />}
                            {activeTab === 'visitors' && org && <VMSOrgVisitorDashboard key="visitors-tab" orgId={org.id} />}
                            {activeTab === 'escalation' && org && <EscalationHierarchyBuilder organizationId={org.id} propertyId={propertyFilter} />}
                            {activeTab === 'profile' && (
                                <div className="flex justify-center py-8">
                                    <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-lg">
                                        <div className="flex flex-col items-center bg-gradient-to-br from-slate-900 to-slate-800 p-8">
                                            <div className="mb-4 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-white/20 bg-white/10">
                                                {photo
                                                    ? <Image src={photo} alt="Profile" width={96} height={96} className="h-full w-full object-cover" />
                                                    : <span className="text-4xl font-black text-white">{fullName[0]?.toUpperCase()}</span>}
                                            </div>
                                            <span className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-slate-900">Tech</span>
                                        </div>
                                        <dl className="space-y-1 p-8">
                                            {([['Name', fullName], ['Email', user?.email || '—'], ['Organisation', org?.name || '—']] as const).map(([k, v]) => (
                                                <div key={k} className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
                                                    <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{k}</dt>
                                                    <dd className="truncate text-sm font-semibold text-slate-900">{v}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
