'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Boxes, Building2, Bug, ChevronDown, ClipboardList, DoorOpen, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck,
    UserCircle, X,
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { useAuth } from '@/frontend/context/AuthContext';
import SignOutModal from '@/frontend/components/ui/SignOutModal';
import FeedbackModal from '@/frontend/components/ui/FeedbackModal';
import TabLoading from './TabLoading';

/**
 * IT and Design consoles (owner 2026-10-28): each team's own dashboard after sign-in. One component, configured per
 * department, so the two stay identical except for the tabs each team gets (IT also has Assets). Every tab reuses the
 * screen the rest of the app already uses; nothing here is IT- or Design-specific logic.
 * The HR policy chatbot is mounted app-wide (app/layout.tsx) and already admits these roles.
 */

const DepartmentTasksTab = dynamic(() => import('@/frontend/components/task-manager/DepartmentTasksTab'), { loading: TabLoading });
const AssetsModule = dynamic(() => import('@/frontend/components/assets/AssetsModule'), { loading: TabLoading });
const HRTicketsContent = dynamic(() => import('@/frontend/components/hr/HRTicketsContent'), { loading: TabLoading });
const SettingsView = dynamic(() => import('./SettingsView'), { loading: TabLoading });
// The same booking screen HR and CRM open at /{orgId}/book-room (property, then room and slot; no credits).
const BookMeetingRoom = dynamic(() => import('@/app/(dashboard)/[orgId]/book-room/page'), { loading: TabLoading });

export type ConsoleDepartment = 'it' | 'design';

type ConsoleTab = 'tasks' | 'assets' | 'meeting_room' | 'grievance' | 'settings' | 'profile';

interface NavItem { id: ConsoleTab | 'feedback'; label: string; icon: React.ComponentType<{ className?: string }> }

const DEPARTMENTS: Record<ConsoleDepartment, { name: string; work: NavItem[] }> = {
    it: {
        name: 'IT',
        work: [
            { id: 'assets', label: 'Assets', icon: Boxes },
            { id: 'meeting_room', label: 'Meeting Room', icon: DoorOpen },
            { id: 'grievance', label: 'Grievances', icon: ShieldCheck },
            { id: 'tasks', label: 'Task Manager', icon: ClipboardList },
        ],
    },
    design: {
        name: 'Design',
        work: [
            { id: 'meeting_room', label: 'Meeting Room', icon: DoorOpen },
            { id: 'grievance', label: 'Grievances', icon: ShieldCheck },
            { id: 'tasks', label: 'Task Manager', icon: ClipboardList },
        ],
    },
};

// "Feedback / Bug" opens the app-wide feedback form (FeedbackModal) instead of a tab.
const PERSONAL: NavItem[] = [
    { id: 'feedback', label: 'Feedback / Bug', icon: Bug },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'profile', label: 'Profile', icon: UserCircle },
];

interface Property { id: string; name: string; code: string; image_url?: string }
interface Organization { id: string; name: string }

export default function DepartmentConsole({ department }: { department: ConsoleDepartment }) {
    const { user, signOut } = useAuth();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = useMemo(() => createClient(), []);
    const orgId = decodeURIComponent((params?.orgId as string) || '').trim().replace(/\s+/g, '');

    const dept = DEPARTMENTS[department];
    const nav = useMemo(() => [
        { section: dept.name, items: dept.work },
        { section: 'Personal', items: PERSONAL },
    ], [dept]);
    const tabs = useMemo(() => nav.flatMap(s => s.items).filter(t => t.id !== 'feedback'), [nav]);

    const tabParam = searchParams.get('tab');
    // Sign-in opens the first tab in the list (owner 2026-10-29): Assets for IT, Meeting Room for Design.
    const activeTab = (tabs.some(t => t.id === tabParam) ? tabParam : dept.work[0].id) as ConsoleTab;
    const selectedPropertyId = searchParams.get('propertyId') || 'all';

    const [org, setOrg] = useState<Organization | null>(null);
    const [properties, setProperties] = useState<Property[]>([]);
    const [errorMsg, setErrorMsg] = useState('');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [showSignOut, setShowSignOut] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);

    useEffect(() => {
        if (!orgId) return;
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase.from('organizations').select('id, name').eq('id', orgId).is('deleted_at', null).maybeSingle();
            if (cancelled) return;
            if (error || !data) { setErrorMsg('Could not load your organisation.'); return; }
            setOrg(data);
            // Only IT has the property dropdown (Design has none).
            if (department !== 'it') return;
            const { data: props } = await supabase.from('properties').select('id, name, code, image_url').eq('organization_id', data.id).order('name');
            if (!cancelled) setProperties(props || []);
        })();
        return () => { cancelled = true; };
    }, [orgId, supabase, department]);

    const setQuery = useCallback((patch: Record<string, string | null>) => {
        const next = new URLSearchParams(window.location.search);
        Object.entries(patch).forEach(([k, v]) => (v === null ? next.delete(k) : next.set(k, v)));
        router.replace(`${window.location.pathname}?${next.toString()}`, { scroll: false });
    }, [router]);

    const openItem = (id: NavItem['id']) => {
        setSidebarOpen(false);
        if (id === 'feedback') { setShowFeedback(true); return; }
        setQuery({ tab: id });
    };
    const pickProperty = (id: string) => { setSelectorOpen(false); setQuery({ propertyId: id === 'all' ? null : id }); };

    const activeProperty = properties.find(p => p.id === selectedPropertyId) || null;
    const propertyFilter = selectedPropertyId === 'all' ? undefined : selectedPropertyId;
    const tabLabel = tabs.find(t => t.id === activeTab)?.label || `${dept.name} Console`;
    const fullName = (user?.user_metadata?.full_name as string | undefined) || user?.email || dept.name;
    const photo = (user?.user_metadata?.user_photo_url || user?.user_metadata?.avatar_url) as string | undefined;

    // IT only (owner 2026-10-28): the Super Admin console's property pill (OrgAdminDashboard renderPropertySelector),
    // shown in the header on every tab. Design has no property dropdown.
    const propertySelector = department === 'it' && properties.length > 0 && (
        <div className="relative">
            <button type="button" onClick={() => setSelectorOpen(o => !o)} aria-haspopup="listbox" aria-expanded={selectorOpen}
                className="group flex min-w-[200px] items-center gap-3 rounded-xl border border-border bg-surface-elevated px-4 py-2.5 transition-all hover:border-primary">
                <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-lg bg-background">
                    {activeProperty?.image_url
                        ? <img src={activeProperty.image_url} alt="" className="h-full w-full object-cover" />
                        : <Building2 className="h-3.5 w-3.5 text-text-tertiary" />}
                </div>
                <span className="flex-1 truncate text-left font-body text-sm font-medium text-text-primary">{activeProperty ? activeProperty.name : 'All Properties'}</span>
                <ChevronDown className={`h-4 w-4 text-text-tertiary transition-transform ${selectorOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {selectorOpen && (
                    <>
                        <div className="fixed inset-0 z-[60]" onClick={() => setSelectorOpen(false)} />
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            role="listbox" aria-label="Property"
                            className="absolute right-0 z-[70] mt-2 w-72 overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-2xl"
                        >
                            <div className="border-b border-border p-2">
                                <button type="button" role="option" aria-selected={selectedPropertyId === 'all'} onClick={() => pickProperty('all')}
                                    className={`flex w-full items-center gap-3 rounded-xl p-2 transition-colors ${selectedPropertyId === 'all' ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:bg-background'}`}>
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background">
                                        <LayoutDashboard className="h-4 w-4" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-xs font-black uppercase tracking-tight">All Properties</p>
                                        <p className="font-body text-[10px] font-medium text-text-tertiary">{properties.length} Locations</p>
                                    </div>
                                </button>
                            </div>
                            <div className="max-h-64 space-y-1 overflow-y-auto p-2">
                                {properties.map(p => (
                                    <button key={p.id} type="button" role="option" aria-selected={selectedPropertyId === p.id} onClick={() => pickProperty(p.id)}
                                        className={`flex w-full items-center gap-3 rounded-xl p-2 transition-colors ${selectedPropertyId === p.id ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:bg-background'}`}>
                                        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-background">
                                            {p.image_url
                                                ? <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                                                : <Building2 className="h-4 w-4 text-slate-400" />}
                                        </div>
                                        <div className="overflow-hidden text-left">
                                            <p className="truncate text-xs font-black uppercase tracking-tight">{p.name}</p>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{p.code}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );

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
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-text-tertiary">{dept.name} Console</p>
                </div>
                <nav className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4" aria-label={`${dept.name} console`}>
                    {nav.map(group => (
                        <div key={group.section} className="mb-6">
                            <p className="mb-3 flex items-center gap-2 px-4 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                <span className="h-3 w-0.5 rounded-full bg-primary" />{group.section}
                            </p>
                            <div className="space-y-1">
                                {group.items.map(item => {
                                    const Icon = item.icon;
                                    const on = activeTab === item.id;
                                    return (
                                        <button key={item.id} type="button" onClick={() => openItem(item.id)} aria-current={on ? 'page' : undefined}
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
                            <span className="block text-[10px] font-black uppercase tracking-widest text-text-tertiary">Access: {dept.name}</span>
                        </span>
                    </div>
                    <button type="button" onClick={() => setShowSignOut(true)} className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50">
                        <LogOut className="h-4 w-4" /> Sign out
                    </button>
                </div>
            </aside>

            <SignOutModal isOpen={showSignOut} onClose={() => setShowSignOut(false)} onConfirm={signOut} />
            <FeedbackModal isOpen={showFeedback} onClose={() => setShowFeedback(false)} />

            {/* Main */}
            <main className="w-full min-w-0 flex-1 bg-white lg:ml-72">
                <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border/10 bg-white px-4 md:px-8">
                    <div className="flex min-w-0 items-center gap-3">
                        <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Open menu" className="-ml-2 p-2 text-text-tertiary lg:hidden">
                            <Menu className="h-6 w-6" />
                        </button>
                        <h1 className="truncate font-display text-xl font-semibold tracking-tight text-text-primary md:text-2xl">{tabLabel}</h1>
                    </div>
                    {propertySelector}
                </header>

                <div className="p-4 md:p-8">
                    {errorMsg && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{errorMsg}</p>}

                    {activeTab === 'tasks' && <DepartmentTasksTab />}
                    {activeTab === 'assets' && org && (
                        <AssetsModule
                            organizationId={org.id}
                            propertyId={propertyFilter}
                            propertyName={activeProperty?.name}
                            properties={properties}
                            canManage={true}
                        />
                    )}
                    {activeTab === 'meeting_room' && <BookMeetingRoom />}
                    {activeTab === 'grievance' && org && <HRTicketsContent orgId={org.id} />}
                    {activeTab === 'settings' && <SettingsView />}
                    {activeTab === 'profile' && (
                        <div className="flex justify-center py-8">
                            <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-lg">
                                <div className="flex flex-col items-center bg-gradient-to-br from-slate-900 to-slate-800 p-8">
                                    <div className="mb-4 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-white/20 bg-white/10">
                                        {photo
                                            ? <Image src={photo} alt="Profile" width={96} height={96} className="h-full w-full object-cover" />
                                            : <span className="text-4xl font-black text-white">{fullName[0]?.toUpperCase()}</span>}
                                    </div>
                                    <span className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-slate-900">{dept.name}</span>
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
                </div>
            </main>
        </div>
    );
}
