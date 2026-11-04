'use client';

import { resolveOrgDashboardTab, pushDashboardNavigation, type OrgDashboardTab } from '@/frontend/lib/dashboard/orgTabs';
import { useDashboardContent } from '@/frontend/components/layout/DashboardContentSlot';
import PettyCashNavLink from '@/frontend/components/pettyCash/PettyCashNavLink';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    LayoutDashboard, Building2, Users, UserPlus, Ticket, Settings, UserCircle,
    Search, Plus, Filter, LogOut, ChevronRight, MapPin, Edit, Trash2, X, Check, UsersRound,
    Coffee, IndianRupee, FileDown, ChevronDown, Fuel, Menu, Upload, FileBarChart, Zap, Package, ClipboardCheck, Scan,
    Key, GitBranch, DoorOpen, MessageCircle, Send, Loader2, CalendarDays, Wrench, ShoppingCart, Sun, Moon, Droplets, Droplet,
    TrendingUp, Smartphone, MessageSquarePlus, Bot, Gauge, Cpu, FolderLock, Layers, ShieldCheck, ClipboardList,
    FlaskConical, PhoneCall, AlertCircle, CheckCircle2, Clock, Calendar, Mic, BookOpen, FileCheck2, Target
} from 'lucide-react';
import SatejConsole from '@/frontend/components/satej/SatejConsole';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import { useAuth } from '@/frontend/context/AuthContext';
import { useDataCache } from '@/frontend/context/DataCacheContext';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { HapticCard } from '@/frontend/components/ui/HapticCard';
import SignOutModal from '@/frontend/components/ui/SignOutModal';
import RequestsWorkspace, { RequestsViewSwitcher } from '@/frontend/components/tickets/RequestsWorkspace';
import NotificationBell from './NotificationBell';
import Image from 'next/image';
import { assetCaps } from '@/frontend/lib/assets/roles';
import type { QRScanResult } from '@/frontend/components/shared/UniversalQRScannerModal';

import CommandCenter from '@/frontend/components/dashboard/command-center/CommandCenter';
import AgentPulse from '@/frontend/components/agents/AgentPulse';
import type { ModuleKey } from '@/frontend/types/agentRuntime';
import dynamic from 'next/dynamic';
import { usePreloadTabs } from '@/frontend/lib/dashboard/preloadTabs';
import TabLoading from './TabLoading';

// Pop-ups stay mounted exactly as before (they open via isOpen); only their code moves out of this file, so the
// dashboard itself downloads sooner and they arrive right after it, before anyone clicks (performance plan Phase 8).
const InviteMemberModal = dynamic(() => import('./InviteMemberModal'), { loading: () => null });
const TicketCreateModal = dynamic(() => import('@/frontend/components/tickets/TicketCreateModal'), { loading: () => null });
const StockMovementModal = dynamic(() => import('@/frontend/components/stock/StockMovementModal'), { loading: () => null });
const HRTicketsContent = dynamic(() => import('@/frontend/components/hr/HRTicketsContent'), { loading: TabLoading });
const UserDirectory = dynamic(() => import('./UserDirectory'), { loading: TabLoading });
const SettingsView = dynamic(() => import('./SettingsView'), { loading: TabLoading });
const PettyCashDashboard = dynamic(() => import('@/frontend/components/pettyCash/PettyCashDashboard'), { loading: TabLoading });
const DieselAnalyticsDashboard = dynamic(() => import('../diesel/DieselAnalyticsDashboard'), { loading: TabLoading });
const DieselStaffDashboard = dynamic(() => import('../diesel/DieselStaffDashboard'), { loading: TabLoading });
const ElectricityAnalyticsDashboard = dynamic(() => import('../electricity/ElectricityAnalyticsDashboard'), { loading: TabLoading });
const ElectricityStaffDashboard = dynamic(() => import('../electricity/ElectricityStaffDashboard'), { loading: TabLoading });
const StockReportView = dynamic(() => import('@/frontend/components/stock/StockReportView'), { loading: TabLoading });
const SOPDashboard = dynamic(() => import('@/frontend/components/sop/SOPDashboard'), { loading: TabLoading });
const PropertyFeaturesModal = dynamic(() => import('./PropertyFeaturesModal'), { loading: () => null });
const EscalationHierarchyBuilder = dynamic(() => import('@/frontend/components/escalation/EscalationHierarchyBuilder'), { loading: TabLoading });
const AdminRoomManager = dynamic(() => import('@/frontend/components/meeting-rooms/AdminRoomManager'), { loading: TabLoading });
const PPMModule = dynamic(() => import('@/frontend/components/ppm/PPMModule'), { loading: TabLoading });
const AssetsModule = dynamic(() => import('@/frontend/components/assets/AssetsModule'), { loading: TabLoading });
const DocumentBank = dynamic(() => import('@/frontend/components/audit/DocumentBank'), { loading: TabLoading });
const MeetingsHome = dynamic(() => import('@/frontend/components/meetings/MeetingsHome'), { loading: TabLoading });
const MeetingAssistantTab = dynamic(() => import('@/frontend/components/task-manager/meetings/MeetingsTab'), { loading: TabLoading });
const WikiHome = dynamic(() => import('@/frontend/components/wiki/WikiHome'), { loading: TabLoading });
const VendorManagement = dynamic(() => import('@/frontend/components/vendors/VendorManagement'), { loading: TabLoading });
const ProcurementModule = dynamic(() => import('../procurement/ProcurementModule'), { loading: TabLoading });
const BountyInbox = dynamic(() => import('../aop/BountyInbox'), { loading: TabLoading });
const PoApprovals = dynamic(() => import('../approvals/PoApprovals'), { loading: TabLoading });
const VMSOrgVisitorDashboard = dynamic(() => import('@/frontend/components/vms/VMSOrgVisitorDashboard'), { loading: TabLoading });
const WaterAnalyticsDashboard = dynamic(() => import('@/frontend/components/water/WaterAnalyticsDashboard'), { loading: TabLoading });
const VendorManagementModal = dynamic(() => import('@/frontend/components/vendor/VendorManagementModal'), { loading: () => null });
const GuestExperienceDashboard = dynamic(() => import('@/frontend/components/guest-experience/GuestExperienceDashboard'), { loading: TabLoading });
const AITicketsDashboard = dynamic(() => import('@/frontend/components/ai-tickets/AITicketsDashboard'), { loading: TabLoading });
const TaskManagerSuperuserDashboard = dynamic(() => import('@/frontend/components/task-manager/TaskManagerSuperuserDashboard'), { loading: TabLoading });
const OrgProgressTracker = dynamic(() => import('@/frontend/components/org-efficiency/OrgProgressTracker'), { loading: TabLoading });
const OrgEfficiencyMeter = dynamic(() => import('@/frontend/components/org-efficiency/OrgEfficiencyMeter'), { loading: TabLoading });
const AgentConsole = dynamic(() => import('@/frontend/components/agents/AgentConsole'), { loading: TabLoading });
const RosterDashboard = dynamic(() => import('@/frontend/components/roster/RosterDashboard').then(m => m.RosterDashboard), { loading: TabLoading });
const WaterDashboard = dynamic(() => import('@/frontend/components/water/WaterDashboard').then(m => m.WaterDashboard), { loading: TabLoading });
const ImportReportsView = dynamic(() => import('@/frontend/components/snags').then(m => m.ImportReportsView), { loading: TabLoading });
const AppUsageReport = dynamic(() => import('@/frontend/components/dashboard/AppUsageReport'), { loading: TabLoading });

// Tabs live in their own files so the dashboard opens faster; once it is on screen they are downloaded quietly in
// the background (usePreloadTabs), so opening a tab shows no extra spinner (performance plan Phase 1).
const TAB_PRELOADS = [
    () => import('@/frontend/components/hr/HRTicketsContent'),
    () => import('./UserDirectory'),
    () => import('../tickets/AdminSPOCDashboard'),
    () => import('./SettingsView'),
    () => import('../diesel/DieselAnalyticsDashboard'),
    () => import('../diesel/DieselStaffDashboard'),
    () => import('../electricity/ElectricityAnalyticsDashboard'),
    () => import('../electricity/ElectricityStaffDashboard'),
    () => import('@/frontend/components/stock/StockReportView'),
    () => import('@/frontend/components/sop/SOPDashboard'),
    () => import('./PropertyFeaturesModal'),
    () => import('@/frontend/components/escalation/EscalationHierarchyBuilder'),
    () => import('@/frontend/components/meeting-rooms/AdminRoomManager'),
    () => import('@/frontend/components/ppm/PPMModule'),
    () => import('@/frontend/components/assets/AssetsModule'),
    () => import('@/frontend/components/audit/DocumentBank'),
    () => import('@/frontend/components/vendors/VendorManagement'),
    () => import('../ops/TicketFlowMap'),
    () => import('../procurement/ProcurementModule'),
    () => import('@/frontend/components/vms/VMSOrgVisitorDashboard'),
    () => import('@/frontend/components/water/WaterAnalyticsDashboard'),
    () => import('@/frontend/components/vendor/VendorManagementModal'),
    () => import('@/frontend/components/guest-experience/GuestExperienceDashboard'),
    () => import('@/frontend/components/ai-tickets/AITicketsDashboard'),
    () => import('@/frontend/components/task-manager/TaskManagerSuperuserDashboard'),
    () => import('@/frontend/components/org-efficiency/OrgProgressTracker'),
    () => import('@/frontend/components/org-efficiency/OrgEfficiencyMeter'),
    () => import('@/frontend/components/agents/AgentConsole'),
    () => import('@/frontend/components/roster/RosterDashboard'),
    () => import('@/frontend/components/water/WaterDashboard'),
    () => import('@/frontend/components/snags'),
];

// Types
type Tab = OrgDashboardTab;

/**
 * AGENT PULSE MOUNTS — tab -> canonical module slug.
 *
 * `oem_agent_runs.module` is free text with no CHECK, so a strip mounted with a
 * slug nothing ever writes renders empty forever and reports no error. This map
 * is the only place a slug is typed in this file: `satisfies Partial<Record<Tab,
 * ModuleKey>>` makes both halves checked — an unknown tab name or a module slug
 * that is not in AGENT_MODULES (frontend/types/agentRuntime.ts, the one
 * canonical vocabulary) is a COMPILE ERROR, not a silently dead strip.
 */
const AGENT_PULSE_BY_TAB = {
    procurement: 'procurement',
    roster: 'roster',
    requests: 'tickets',
    reports: 'reports',
    diesel: 'diesel',
    electricity: 'electricity',
    checklist: 'sop',
    ppm: 'ppm',
    vendors: 'vendors',
} as const satisfies Partial<Record<Tab, ModuleKey>>;

interface Property {
    id: string;
    name: string;
    code: string;
    address: string;
    image_url?: string;
    created_at: string;
    /** 'opex' = operational (default), 'capex' = CAPEX only. Missing until the migration is applied. */
    operation_type?: 'opex' | 'capex';
}

interface OrgUser {
    user_id: string;
    role?: string; // Org role
    is_active: boolean;
    user: {
        id: string;
        email: string;
        full_name: string;
    };
    propertyMemberships: {
        property_id: string;
        property_name?: string;
        role: string;
    }[];
}

interface Organization {
    id: string;
    name: string;
    code: string;
    logo_url?: string;
}

const OrgAdminDashboard = () => {
    usePreloadTabs(TAB_PRELOADS);
    const { dashboardContent, navigateDashboard } = useDashboardContent();
    const { user, signOut, membership } = useAuth();
    const routeParams = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const orgSlugOrId = (routeParams?.orgId as string) || membership?.org_id || '';

    const isOpsTabScope = ['ops_super_admin', 'ops super admin'].includes((membership?.org_role || '').toLowerCase());
    const dashboardTab = resolveOrgDashboardTab(searchParams.get('tab'), isOpsTabScope);
    const activeTab = dashboardContent !== undefined ? 'petty-cash' as Tab : dashboardTab;

    const [org, setOrg] = useState<Organization | null>(null);
    const [properties, setProperties] = useState<Property[]>([]);
    const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showCreatePropModal, setShowCreatePropModal] = useState(false);
    const [editingProperty, setEditingProperty] = useState<Property | null>(null);
    const [showUserModal, setShowUserModal] = useState(false);
    const [editingUser, setEditingUser] = useState<OrgUser | null>(null);
    const [showAddMemberModal, setShowAddMemberModal] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [showSignOutModal, setShowSignOutModal] = useState(false);
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [showTicketCreateModal, setShowTicketCreateModal] = useState(false);
    const [selectedPropertyId, setSelectedPropertyId] = useState('all');
    const [isScannerModalOpen, setIsScannerModalOpen] = useState(false);
    const [openDropdown, setOpenDropdown] = useState<'prop' | 'checklist' | 'escalation' | 'rooms' | null>(null);
    const [checklistPropertyId, setChecklistPropertyId] = useState<string>('all');
    const [escalationPropertyId, setEscalationPropertyId] = useState<string>('all');
    const [roomsPropertyId, setRoomsPropertyId] = useState<string>('all');
    const [userRole, setUserRole] = useState<string>('User');
    const rawOrgRole = (membership?.org_role || userRole || '').toLowerCase();
    const isOpsSuperAdmin = rawOrgRole.includes('ops_super_admin') || rawOrgRole.includes('ops super admin');
    // Reports → App usage is for org super admins only (the API enforces the same rule).
    const isOrgSuperAdmin = rawOrgRole.includes('org_super_admin');
    // Owner 2026-10-29: the Super Admin's own Meeting Assistant. Kept mounted once opened, so switching tabs never stops a recording.
    const [assistantOpened, setAssistantOpened] = useState(false);
    if (activeTab === 'meeting_assistant' && isOrgSuperAdmin && !assistantOpened) setAssistantOpened(true);
    const reportsView: 'imports' | 'app_usage' = isOrgSuperAdmin && searchParams.get('report') === 'app_usage' ? 'app_usage' : 'imports';
    const setReportsView = (next: 'imports' | 'app_usage') => {
        const params = new URLSearchParams(window.location.search);
        if (next === 'app_usage') params.set('report', 'app_usage');
        else params.delete('report');
        router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
    };
    const [isSelectorOpen, setIsSelectorOpen] = useState(false); // Global toggle state
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [pendingStatusFilter, setPendingStatusFilter] = useState('all');
    const [requestsView, setRequestsView] = useState<'list' | 'board' | 'flow'>('list');
    const [showFeaturesModal, setShowFeaturesModal] = useState(false);
    const [selectedPropertyForFeatures, setSelectedPropertyForFeatures] = useState<Property | null>(null);
    
    const { getCachedData, setCachedData, invalidateCache } = useDataCache();

    // Only restore subordinate filters. The validated URL owns the active tab.
    useEffect(() => {
        setPendingStatusFilter(searchParams.get('filter') || 'all');
        setSelectedPropertyId(searchParams.get('propertyId') || 'all');
        const view = searchParams.get('view');
        setRequestsView(view === 'board' || view === 'flow' ? view : 'list');
    }, [searchParams]);

    // Robust Unified Scroll Restoration for Org Admin
    useEffect(() => {
        // We restore scroll when the tab is 'requests' and we're not loading
        if (activeTab === 'requests' && !isLoading) {
            let savedScrollY: string | null = null;
            let lastTicketId: string | null = null;
            try {
                savedScrollY = sessionStorage.getItem(`orgScrollY-${org?.id}`);
                lastTicketId = sessionStorage.getItem(`orgLastTicketId-${org?.id}`);
            } catch {}

            if (savedScrollY || lastTicketId) {
                const scrollContainer = document.getElementById('main-scroll-container');
                let retryCount = 0;
                const maxRetries = 3;

                const attemptRestoration = () => {
                    const container = scrollContainer || window;
                    
                    // Set scroll behavior to auto to avoid smooth-scroll race conditions
                    if (container instanceof HTMLElement) {
                        container.style.scrollBehavior = 'auto';
                    }

                    // Priority 1: Scroll the specific ticket into center view
                    if (lastTicketId) {
                        const targetElement = document.getElementById(`ticket-${lastTicketId}`);
                        if (targetElement) {
                            targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                            
                            // Cleanup only after success
                            try {
                                sessionStorage.removeItem(`orgLastTicketId-${org?.id}`);
                                sessionStorage.removeItem(`orgScrollY-${org?.id}`);
                            } catch {}
                            
                            if (container instanceof HTMLElement) {
                                setTimeout(() => { container.style.scrollBehavior = ''; }, 50);
                            }
                            return;
                        }
                    }

                    // Priority 2: Fallback to exact pixel offset
                    if (savedScrollY) {
                        container.scrollTo({
                            top: parseInt(savedScrollY, 10),
                            behavior: 'auto'
                        });
                        
                        try {
                            sessionStorage.removeItem(`orgScrollY-${org?.id}`);
                            sessionStorage.removeItem(`orgLastTicketId-${org?.id}`);
                        } catch {}
                        
                        if (container instanceof HTMLElement) {
                            setTimeout(() => { container.style.scrollBehavior = ''; }, 50);
                        }
                        return;
                    }

                    // Retry if prioritized element not found yet
                    if (retryCount < maxRetries) {
                        retryCount++;
                        requestAnimationFrame(() => setTimeout(attemptRestoration, 50));
                    }
                };

                // Start restoration cycle
                requestAnimationFrame(() => setTimeout(attemptRestoration, 50));
            }
        }
    }, [activeTab, isLoading, org?.id]);

    // Derived state
    const activeProperty = selectedPropertyId === 'all'
        ? null
        : properties.find(p => p.id === selectedPropertyId);

    // Property selector pill + dropdown — shared between the per-tab header and the
    // Dashboard/Overview header, so both scope the same way and never drift apart.
    const renderPropertySelector = () => properties.length > 0 && (
        <div className="hidden lg:block relative">
            <button
                onClick={() => setIsSelectorOpen(!isSelectorOpen)}
                className="flex items-center gap-3 bg-surface-elevated border border-border rounded-[10px] px-4 py-2 hover:border-primary transition-colors duration-150 group min-w-[200px]"
            >
                <div className="w-6 h-6 rounded-[8px] bg-background flex items-center justify-center overflow-hidden">
                    {activeProperty && activeProperty.image_url ? (
                        <img src={activeProperty.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <Building2 className="w-3.5 h-3.5 text-text-tertiary" />
                    )}
                </div>
                <span className="text-sm font-body font-medium text-text-primary flex-1 text-left">
                    {selectedPropertyId === 'all' ? 'All properties' : activeProperty?.name}
                </span>
                <ChevronDown className={`w-4 h-4 text-text-tertiary transition-transform ${isSelectorOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isSelectorOpen && (
                    <>
                        <div
                            className="fixed inset-0 z-[60]"
                            onClick={() => setIsSelectorOpen(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute right-0 mt-2 w-72 bg-surface-elevated rounded-2xl shadow-lg border border-border z-[70] overflow-hidden"
                        >
                            <div className="p-2 border-b border-border">
                                <button
                                    onClick={() => { handlePropertyChange('all'); setIsSelectorOpen(false); }}
                                    className={`w-full flex items-center gap-2.5 p-2 rounded-[10px] transition-colors duration-150 ${selectedPropertyId === 'all' ? 'bg-primary/15 text-primary-dark' : 'text-text-secondary hover:bg-background'}`}
                                >
                                    <div className="w-8 h-8 rounded-[8px] bg-background flex items-center justify-center">
                                        <LayoutDashboard className="w-4 h-4" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-sm font-medium">All properties</p>
                                        <p className="text-xs text-text-tertiary font-body tabular-nums">{properties.length} locations</p>
                                    </div>
                                </button>
                            </div>
                            <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                                {properties.map(prop => (
                                    <button
                                        key={prop.id}
                                        onClick={() => { handlePropertyChange(prop.id); setIsSelectorOpen(false); }}
                                        className={`w-full flex items-center gap-2.5 p-2 rounded-[10px] transition-colors duration-150 ${selectedPropertyId === prop.id ? 'bg-primary/15 text-primary-dark' : 'text-text-secondary hover:bg-background'}`}
                                    >
                                        <div className="w-8 h-8 rounded-[8px] bg-background flex items-center justify-center overflow-hidden">
                                            {prop.image_url ? (
                                                <img src={prop.image_url} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <Building2 className="w-4 h-4 text-slate-400" />
                                            )}
                                        </div>
                                        <div className="text-left overflow-hidden">
                                            <p className="text-sm font-medium truncate">{prop.name}</p>
                                            <p className="text-[11px] text-text-tertiary font-mono uppercase">{prop.code}</p>
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

    const allPropertyIds = useMemo(() => properties.map(p => p.id), [properties]);

    const supabase = useMemo(() => createClient(), []);

    // Refs to prevent duplicate fetches
    const hasFetchedOrg = useRef(false);
    const hasFetchedProperties = useRef(false);

    const fetchUserRole = useCallback(async () => {
        if (!org || !user) return;

        const { data } = await supabase
            .from('organization_memberships')
            .select('role')
            .eq('organization_id', org.id)
            .eq('user_id', user.id)
            .single();

        if (data?.role) {
            // Format role for display (e.g., 'org_admin' -> 'Org Admin')
            const formattedRole = data.role.split('_').map((word: string) =>
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ');
            setUserRole(formattedRole);
        }
    }, [org, user, supabase]);

    const fetchOrgDetails = useCallback(async () => {
        // 1. Check cache first
        const cacheKey = `org-details-${orgSlugOrId}`;
        const cached = getCachedData(cacheKey);
        if (cached) {
            setOrg(cached);
            setIsLoading(false);
        } else {
            setIsLoading(true);
        }

        setErrorMsg('');

        if (!orgSlugOrId) {
            setIsLoading(false);
            return;
        }

        // 2. Decode URL param
        const decoded = decodeURIComponent(orgSlugOrId);

        // 2. Sanitize ID (Remove spaces/newlines that might have crept in)
        const cleanId = decoded.trim().replace(/\s+/g, '');
        if (!cleanId) {
            setIsLoading(false);
            return;
        }

        // 3. Fetch by ID (if UUID) or by Code (if slug)
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
        const query = supabase
            .from('organizations')
            .select('*')
            .is('deleted_at', null);

        const { data, error } = await (isUUID ? query.eq('id', cleanId) : query.eq('code', cleanId)).maybeSingle();

        if (error) {
            console.error('❌ [Dashboard] Supabase Error:', error);
            setErrorMsg(`Access Denied (403) or System Error. ID: ${cleanId}`);
        } else if (!data) {
            console.warn('⚠️ [Dashboard] Organization not found in DB.');
            setErrorMsg(`Organization not found. ID: ${cleanId}`);
        } else {
            
            setOrg(data);
            setCachedData(cacheKey, data);
        }
        setIsLoading(false);
    }, [orgSlugOrId, supabase]);

    const fetchProperties = useCallback(async () => {
        if (!org) return;

        const cacheKey = `org-properties-${org.id}`;
        const cached = getCachedData(cacheKey);
        if (cached) setProperties(cached);

        const { data: props, error: propError } = await supabase
            .from('properties')
            .select('*')
            .eq('organization_id', org.id)
            .order('created_at', { ascending: false });

        if (propError || !props) return;

        // Fetch ticket_validation feature status for all these properties
        const { data: features, error: featError } = await supabase
            .from('property_features')
            .select('property_id, is_enabled')
            .eq('feature_key', 'ticket_validation')
            .in('property_id', props.map(p => p.id));

        if (!featError && features) {
            const featureMap = new Map(features.map(f => [f.property_id, f.is_enabled]));
            const updatedProps = props.map(p => ({
                ...p,
                validation_enabled: featureMap.has(p.id) ? featureMap.get(p.id) : true
            }));
            setProperties(updatedProps);
            setCachedData(cacheKey, updatedProps);
        } else {
            setProperties(props);
            setCachedData(cacheKey, props);
        }
    }, [org, supabase]);

    useEffect(() => {
        const init = async () => {
            if (orgSlugOrId && !hasFetchedOrg.current) {
                hasFetchedOrg.current = true;
                await fetchOrgDetails();
            }
        };
        init();
    }, [orgSlugOrId, fetchOrgDetails]);

    // Fetch properties ONCE when org is loaded (not on every tab change)
    useEffect(() => {
        const init = async () => {
            if (org && !hasFetchedProperties.current) {
                hasFetchedProperties.current = true;
                await Promise.all([fetchProperties(), fetchUserRole()]);
            }
        };
        init();
    }, [org, fetchProperties, fetchUserRole]);


    const fetchOrgUsers = async () => {
        if (!org) return;

        // 🔹 Step 1: Fetch ORG-level users
        const { data: orgUsers, error: orgError } = await supabase
            .from('organization_memberships')
            .select(`
                user_id,
                role,
                is_active,
                user:users!user_id (
                    id,
                    full_name,
                    email
                )
            `)
            .eq('organization_id', org.id)
            .eq('is_active', true);

        if (orgError) console.error('Error fetching org users:', orgError);

        // 🔹 Step 2: Fetch PROPERTY-level users for same org
        // 💡 !inner ensures only properties belonging to this org are included
        const { data: propertyUsers, error: propError } = await supabase
            .from('property_memberships')
            .select(`
                user_id,
                role,
                is_active,
                property:properties!inner (
                    id,
                    organization_id,
                    name
                ),
                user:users!user_id (
                    id,
                    full_name,
                    email
                )
            `)
            .eq('property.organization_id', org.id)
            .eq('is_active', true);

        if (propError) console.error('Error fetching property users:', propError);

        // 🔹 Step 3: Merge + deduplicate users (CRITICAL)
        const userMap = new Map<string, OrgUser>();

        // Org users
        orgUsers?.forEach((row: any) => {
            userMap.set(row.user_id, {
                user_id: row.user_id,
                role: row.role,
                is_active: row.is_active,
                user: row.user,
                propertyMemberships: []
            });
        });

        // Property users
        propertyUsers?.forEach((row: any) => {
            const existing = userMap.get(row.user_id);

            if (existing) {
                existing.propertyMemberships.push({
                    property_id: row.property.id,
                    property_name: row.property.name,
                    role: row.role
                });
            } else {
                userMap.set(row.user_id, {
                    user_id: row.user_id,
                    role: undefined, // No org-level role
                    is_active: row.is_active,
                    user: row.user,
                    propertyMemberships: [{
                        property_id: row.property.id,
                        property_name: row.property.name,
                        role: row.role
                    }]
                });
            }
        });

        setOrgUsers(Array.from(userMap.values()));
    };

    useEffect(() => {
        const handleCreated = () => {
            invalidateCache('tickets-');
            invalidateCache('spoc-dashboard-');
        };
        window.addEventListener('ticket-created', handleCreated);
        window.addEventListener('request-created', handleCreated);
        return () => {
            window.removeEventListener('ticket-created', handleCreated);
            window.removeEventListener('request-created', handleCreated);
        };
    }, [invalidateCache]);

    const uploadBase64IfNeeded = async (url: string | undefined) => {
        if (!url || !url.startsWith('data:image/')) return url;
        try {
            const formData = new FormData();
            formData.append('base64', url);
            const res = await fetch('/api/properties/upload-image', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (res.ok && data.url) return data.url;
        } catch (err) {
            console.error('Failed base64 auto-upload:', err);
        }
        return url;
    };

    const handleCreateProperty = async (propData: any) => {
        if (!org) return;
        const { validation_enabled, ...rest } = propData;
        if (rest.image_url) {
            rest.image_url = await uploadBase64IfNeeded(rest.image_url);
        }
        const { data: newProp, error } = await supabase.from('properties').insert({
            ...rest,
            organization_id: org.id
        }).select().single();

        if (!error && newProp) {
            // Also set initial validation feature
            await supabase.from('property_features').insert({
                property_id: newProp.id,
                feature_key: 'ticket_validation',
                is_enabled: validation_enabled !== false
            });

            invalidateCache(`org-properties-${org.id}`);
            fetchProperties();
            setShowCreatePropModal(false);
        } else {
            alert('Failed to create property: ' + (error?.message || 'Unknown error'));
        }
    };

    const handleUpdateProperty = async (id: string, propData: any) => {
        const { validation_enabled, ...rest } = propData;
        if (rest.image_url) {
            rest.image_url = await uploadBase64IfNeeded(rest.image_url);
        }

        try {
            const res = await fetch(`/api/properties/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rest),
            });
            const resData = await res.json();

            if (!res.ok) {
                throw new Error(resData.error || 'Failed to update property');
            }

            // Also update property_features
            await supabase.from('property_features').upsert({
                property_id: id,
                feature_key: 'ticket_validation',
                is_enabled: validation_enabled !== false
            }, { onConflict: 'property_id,feature_key' });

            // Invalidate cache so old image_url is cleared
            if (org?.id) {
                invalidateCache(`org-properties-${org.id}`);
            }

            // Optimistically update properties in local state
            setProperties(prev => prev.map(p => p.id === id ? { ...p, ...rest, validation_enabled: validation_enabled !== false } : p));

            fetchProperties();
            setEditingProperty(null);
        } catch (err: any) {
            console.error('Property update error:', err);
            alert('Update failed: ' + (err.message || 'Unknown error'));
        }
    };

    const handleDeleteProperty = async (id: string) => {
        if (!confirm('Are you sure you want to delete this property? This cannot be undone.')) return;
        const { error } = await supabase
            .from('properties')
            .delete()
            .eq('id', id);

        if (!error) {
            fetchProperties();
        } else {
            alert('Delete failed: ' + error.message);
        }
    };

    const handleUpdateUser = async (userId: string, data: any) => {
        // Update user profile
        const { error: profileError } = await supabase
            .from('users')
            .update({
                full_name: data.full_name,
                phone: data.phone
            })
            .eq('id', userId);

        if (profileError) {
            alert('Failed to update profile: ' + profileError.message);
            return;
        }

        // Update org role if exists
        if (data.orgRole) {
            await supabase
                .from('organization_memberships')
                .update({ role: data.orgRole })
                .eq('user_id', userId)
                .eq('organization_id', org?.id);
        }

        fetchOrgUsers();
        setEditingUser(null);
        setShowUserModal(false);
    };

    const handleDeleteUser = async (userId: string) => {
        if (!confirm('Remove this user from the organization?')) return;

        // Remove from org memberships
        await supabase
            .from('organization_memberships')
            .delete()
            .eq('user_id', userId)
            .eq('organization_id', org?.id);

        // Remove from property memberships
        await supabase
            .from('property_memberships')
            .delete()
            .eq('user_id', userId)
            .eq('organization_id', org?.id);

        fetchOrgUsers();
    };


    // Helper to change selected property with URL persistence
    const handlePropertyChange = (id: string) => {
        setSelectedPropertyId(id);
        // Synchronize specialized states
        setChecklistPropertyId(id);
        setEscalationPropertyId(id);
        setRoomsPropertyId(id);

        // `propertyId`, not `property`: that is the param the restore effect above
        // reads, so the selector survives a reload or a back-navigation.
        const pId = id;
        const params = new URLSearchParams(window.location.search);
        if (pId !== 'all') {
            params.set('propertyId', pId);
        } else {
            params.delete('propertyId');
        }
        
        router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
    };

    const handleTabChange = (tab: Tab, filter: string = 'all', dateFrom?: string, dateTo?: string, procurementTab?: string) => {
        const effectiveTab = (isOpsSuperAdmin && (tab === 'org_progress' || tab === 'org_efficiency' || tab === 'agent_console' || tab === 'wiki')) ? 'overview' : tab;
        setPendingStatusFilter(filter);
        setSidebarOpen(false);
        const params = new URLSearchParams(window.location.search);
        params.set('tab', effectiveTab);
        if (filter !== 'all') {
            params.set('filter', filter);
        } else {
            params.delete('filter');
        }

        // Deep-link straight into a Procurement sub-tab (e.g. Payment Urgency Tracker,
        // Payment Tracker) instead of always landing on its default "All Orders" view.
        if (tab === 'procurement' && procurementTab) {
            params.set('procurement_tab', procurementTab);
        } else {
            params.delete('procurement_tab');
        }

        if (dateFrom && dateTo) {
            params.set('dateFrom', dateFrom);
            params.set('dateTo', dateTo);
        } else if (tab === 'requests') {
            params.delete('dateFrom');
            params.delete('dateTo');
        }
        
        if (tab !== 'reports') params.delete('report');

        if (tab !== 'requests') {
            params.delete('view');
        } else {
            params.set('view', requestsView);
        }
        
        const path = dashboardContent !== undefined ? (typeof routeParams?.orgId === 'string' ? `/${orgSlugOrId}/dashboard` : '/dashboard') : window.location.pathname;
        if (dashboardContent !== undefined) router.push(`${path}?${params.toString()}`, { scroll: false });
        else pushDashboardNavigation(`${path}?${params.toString()}${window.location.hash}`);
    };

    // COMMAND CENTER — the body of the Overview tab, and nothing else. This dashboard
    // keeps its own chrome: the sidebar, the shared header, the tabs and the ?tab= URLs
    // are untouched, and only the content of <main> swaps to the board on overview.
    // NB: typed `boolean`, not a literal, so TS does not narrow `activeTab` inside the
    // branches below — narrowing would turn the dormant `activeTab === 'overview'`
    // comparisons into non-overlapping-type errors and reset control-flow analysis
    // across hundreds of lines.
    const showCommandCenter: boolean = activeTab === 'overview';

    return (
        <div className="min-h-screen bg-background flex font-inter text-foreground">
            {/* Mobile Overlay */}
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={`
                w-72 bg-white border-r border-border flex flex-col inset-y-0 z-50 transition-[transform,opacity] duration-300
                fixed left-0
                ${sidebarOpen ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 lg:translate-x-0 lg:opacity-100'}
                overflow-hidden
            `}>
                {/* Mobile Close Button */}
                <button
                    onClick={() => setSidebarOpen(false)}
                    className="absolute top-4 right-4 lg:hidden p-2 rounded-[10px] hover:bg-surface-elevated transition-colors"
                >
                    <X className="w-5 h-5 text-text-secondary" />
                </button>

                <div className="p-4 lg:p-5 pb-2 flex-shrink-0">
                    <div className="flex flex-col items-center gap-1 mb-3">
        <img src="/autopilot-logo-new.png" alt="Logo" className="h-10 w-auto object-contain" />
                        <p className="text-xs text-text-tertiary font-medium">Super admin console</p>
                    </div>
                </div>

                <nav className="flex-1 px-4 overflow-y-auto min-h-0 custom-scrollbar">
                    {/* Quick Action Row */}
                    <div className="mb-6">
                        <p className="text-xs font-medium text-text-tertiary px-4 mb-2">
                            Quick actions
                        </p>
                        <div className="px-4 grid grid-cols-3 gap-2.5">
                            {/* Primary Action: New Ticket */}
                            <button
                                type="button"
                                onClick={() => setShowTicketCreateModal(true)}
                                className="w-full flex flex-col items-center justify-center gap-1.5 p-2.5 bg-primary text-text-inverse rounded-[10px] hover:bg-primary-dark hover:border-primary-dark transition-colors duration-150 border border-primary shadow-sm min-h-16 cursor-pointer group"
                                title="Create ticket"
                            >
                                <div className="w-7 h-7 bg-white/20 rounded-[8px] flex items-center justify-center text-white">
                                    <Plus className="w-4 h-4" />
                                </div>
                                <span className="text-[11px] font-medium text-center">New</span>
                            </button>

                            {/* Secondary Action: Add Member */}
                            <button
                                type="button"
                                onClick={() => setShowAddMemberModal(true)}
                                className="w-full flex flex-col items-center justify-center gap-1.5 p-2.5 bg-secondary/10 hover:bg-secondary/15 text-secondary-dark rounded-[10px] transition-colors duration-150 border border-secondary/30 shadow-2xs min-h-16 cursor-pointer group"
                                title="Add organization member"
                            >
                                <div className="w-7 h-7 bg-secondary/20 rounded-[8px] flex items-center justify-center text-secondary-dark">
                                    <UserPlus className="w-4 h-4" />
                                </div>
                                <span className="text-[11px] font-medium text-center">Member</span>
                            </button>

                            {/* Utility Action: Scanner */}
                            <button
                                type="button"
                                onClick={() => selectedPropertyId !== 'all' && setIsScannerModalOpen(true)}
                                disabled={selectedPropertyId === 'all'}
                                className={`w-full flex flex-col items-center justify-center gap-1.5 p-2.5 bg-slate-50 text-slate-800 rounded-[10px] transition-colors duration-150 border border-slate-200 shadow-2xs min-h-16 group ${
                                    selectedPropertyId === 'all' 
                                        ? 'opacity-40 cursor-not-allowed' 
                                        : 'hover:bg-slate-100 cursor-pointer'
                                }`}
                                title={selectedPropertyId === 'all' ? 'Select a property first' : 'Stock scanner'}
                            >
                                <div className="w-7 h-7 bg-slate-200 rounded-[8px] flex items-center justify-center text-slate-700">
                                    <Scan className="w-4 h-4" />
                                </div>
                                <span className="text-[11px] font-medium text-center">Scanner</span>
                            </button>
                        </div>
                    </div>

                    {/* Core Operations */}
                    <div className="mb-6">
                        <p className="text-xs font-medium text-text-tertiary px-4 mb-2">
                            Core operations
                        </p>
                        <div className="space-y-1">
                            <button
                                onClick={() => handleTabChange('overview')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'overview'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <LayoutDashboard className="w-4 h-4" />
                                Dashboard
                            </button>
                            {!isOpsSuperAdmin && (
                                <>
                                    <button
                                        onClick={() => handleTabChange('org_progress')}
                                        className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'org_progress'
                                            ? 'bg-primary/15 text-primary-dark'
                                            : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                            }`}
                                    >
                                        <Gauge className="w-4 h-4" />
                                        Organization progress
                                    </button>
                                    <button
                                        onClick={() => handleTabChange('org_efficiency')}
                                        className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'org_efficiency'
                                            ? 'bg-primary/15 text-primary-dark'
                                            : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                            }`}
                                    >
                                        <TrendingUp className="w-4 h-4" />
                                        Org efficiency
                                    </button>
                                    <button
                                        onClick={() => handleTabChange('agent_console')}
                                        className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'agent_console'
                                            ? 'bg-primary/15 text-primary-dark'
                                            : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                            }`}
                                    >
                                        <Cpu className="w-4 h-4" />
                                        Agent console
                                    </button>
                                    <button
                                        onClick={() => handleTabChange('wiki')}
                                        className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'wiki'
                                            ? 'bg-primary/15 text-primary-dark'
                                            : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                            }`}
                                    >
                                        <BookOpen className="w-4 h-4" />
                                        Wiki
                                    </button>
                                </>
                            )}
                            <button
                                onClick={() => handleTabChange('requests')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'requests'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Ticket className="w-4 h-4" />
                                Requests
                            </button>
                            <button
                                onClick={() => handleTabChange('reports')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'reports'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <FileBarChart className="w-4 h-4" />
                                Reports
                            </button>
                            <button
                                onClick={() => handleTabChange('guest_experience')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'guest_experience'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Smartphone className="w-4 h-4" />
                                Client support
                            </button>
                        </div>
                    </div>

                    {/* Management Hub */}
                    <div className="mb-6">
                        <p className="text-xs font-medium text-text-tertiary px-4 mb-2">
                            Management hub
                        </p>
                        <div className="space-y-1">
                            <PettyCashNavLink onNavigate={() => setSidebarOpen(false)} />
                            <button
                                onClick={() => handleTabChange('properties')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'properties'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Building2 className="w-4 h-4" />
                                Property management
                            </button>
                            <button
                                onClick={() => handleTabChange('users')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'users'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Users className="w-4 h-4" />
                                User management
                            </button>
                            <button
                                onClick={() => handleTabChange('visitors')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'visitors'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <UsersRound className="w-4 h-4" />
                                Visitor management
                            </button>
                            <button
                                onClick={() => handleTabChange('revenue')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'revenue'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Coffee className="w-4 h-4" />
                                Cafeteria revenue
                            </button>
                            <button
                                onClick={() => handleTabChange('water_logger')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'water_logger'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Droplets className="w-4 h-4" />
                                Water logger
                            </button>
                            <button
                                onClick={() => handleTabChange('water')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'water'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Droplets className="w-4 h-4" />
                                Water analytics
                            </button>
                            <button
                                onClick={() => handleTabChange('diesel_logger')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'diesel_logger'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Fuel className="w-4 h-4" />
                                Diesel logger
                            </button>
                            <button
                                onClick={() => handleTabChange('diesel')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'diesel'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Fuel className="w-4 h-4" />
                                Diesel analytics
                            </button>
                            <button
                                onClick={() => handleTabChange('electricity_logger')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'electricity_logger'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Zap className="w-4 h-4" />
                                Electricity logger
                            </button>
                            <button
                                onClick={() => handleTabChange('electricity')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'electricity'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Zap className="w-4 h-4" />
                                Electricity analytics
                            </button>
                            <button
                                onClick={() => handleTabChange('roster')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'roster'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <CalendarDays className="w-4 h-4" />
                                Roster management
                            </button>
                            <button
                                onClick={() => handleTabChange('stock_reports')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'stock_reports'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Package className="w-4 h-4" />
                                Stock reports
                            </button>
                            <button
                                onClick={() => handleTabChange('procurement')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'procurement'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <ShoppingCart className="w-4 h-4" />
                                Procurement
                            </button>

                            <button
                                onClick={() => handleTabChange('procurement', 'all', undefined, undefined, 'payment-tracker')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'procurement' && searchParams.get('procurement_tab') === 'payment-tracker'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <IndianRupee className="w-4 h-4" />
                                Payment tracker
                            </button>
                            <button
                                onClick={() => handleTabChange('procurement', 'all', undefined, undefined, 'invoices')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'procurement' && searchParams.get('procurement_tab') === 'invoices'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <FileCheck2 className="w-4 h-4" />
                                Invoice control
                            </button>
                            {isOrgSuperAdmin && (
                                <button
                                    onClick={() => handleTabChange('po-approvals')}
                                    className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'po-approvals'
                                        ? 'bg-primary/15 text-primary-dark'
                                        : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                        }`}
                                >
                                    <FileCheck2 className="w-4 h-4" />
                                    PO Approvals
                                </button>
                            )}
                            <button
                                onClick={() => handleTabChange('bounty')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'bounty'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Target className="w-4 h-4" />
                                AOP Bounty
                            </button>
                            <button
                                onClick={() => handleTabChange('procurement', 'all', undefined, undefined, 'vendor-discovery')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'procurement' && searchParams.get('procurement_tab') === 'vendor-discovery'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <PhoneCall className="w-4 h-4" />
                                Vendor discovery (Meera)
                            </button>
                            {org && (
                                <button
                                    onClick={() => handleTabChange('meetings')}
                                    className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'meetings'
                                        ? 'bg-primary/15 text-primary-dark'
                                        : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                        }`}
                                >
                                    <Mic className="w-4 h-4" />
                                    Meetings (Ira)
                                </button>
                            )}
                            {/* Owner 2026-10-29: Meeting Assistant — record a meeting, get notes + tasks (Super Admin's own meetings) */}
                            {isOrgSuperAdmin && (
                                <button
                                    onClick={() => handleTabChange('meeting_assistant')}
                                    className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'meeting_assistant'
                                        ? 'bg-primary/15 text-primary-dark'
                                        : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                        }`}
                                >
                                    <Mic className="w-4 h-4" />
                                    Meeting assistant
                                </button>
                            )}
                            <button
                                onClick={() => handleTabChange('checklist')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'checklist'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <ClipboardCheck className="w-4 h-4" />
                                Checklists
                            </button>
                            <button
                                onClick={() => handleTabChange('ppm')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'ppm'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <CalendarDays className="w-4 h-4" />
                                PPM
                            </button>
                            <button
                                onClick={() => handleTabChange('assets')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'assets'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Wrench className="w-4 h-4" />
                                Assets
                            </button>
                            {/* The vault is reachable at PPM > Digital Audit > Document Bank —
                                three stateful clicks with nothing on the way naming "documents".
                                This is a direct entry to the same component, not a second copy. */}
                            <button
                                onClick={() => handleTabChange('document_bank')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'document_bank'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <FolderLock className="w-4 h-4" />
                                Document bank
                            </button>
                            <button
                                onClick={() => handleTabChange('escalation')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'escalation'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <GitBranch className="w-4 h-4" />
                                Escalation
                            </button>
                            <button
                                onClick={() => handleTabChange('rooms')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'rooms'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <DoorOpen className="w-4 h-4" />
                                Meeting rooms
                            </button>
                            <button
                                onClick={() => router.push(`/${org?.id}/crm`)}
                                className="w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm text-text-secondary hover:bg-muted hover:text-text-primary"
                            >
                                <TrendingUp className="w-4 h-4" />
                                Business development
                            </button>
                        </div>
                    </div>

                    {/* System & Personal */}
                    <div className="mb-6">
                        <p className="text-xs font-medium text-text-tertiary px-4 mb-2">
                            System & personal
                        </p>
                        <div className="space-y-1">
                            <button
                                onClick={() => handleTabChange('tasks')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group ${activeTab === 'tasks'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <ClipboardList className="w-4 h-4" />
                                <span className="flex-1 text-left">Task manager</span>
                            </button>
                            <button
                                onClick={() => handleTabChange('ai_tickets')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group ${activeTab === 'ai_tickets'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Bot className="w-4 h-4" />
                                AI automation
                            </button>
                            <button
                                onClick={() => handleTabChange('grievance')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm group ${activeTab === 'grievance'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <ShieldCheck className="w-4 h-4" />
                                <span className="flex-1 text-left">HR & Grievances</span>
                            </button>
                            <button
                                onClick={() => setShowFeedbackModal(true)}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm text-text-secondary hover:bg-muted hover:text-text-primary`}
                            >
                                <MessageSquarePlus className="w-4 h-4" />
                                Feedback / bug
                            </button>
                            <button
                                onClick={() => handleTabChange('settings')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'settings'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Settings className="w-4 h-4" />
                                Settings
                            </button>
                            <button
                                onClick={() => handleTabChange('profile')}
                                className={`w-full flex items-center gap-2.5 px-4 py-2 rounded-[10px] transition-colors duration-150 font-medium text-sm ${activeTab === 'profile'
                                    ? 'bg-primary/15 text-primary-dark'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <UserCircle className="w-4 h-4" />
                                Profile
                            </button>
                        </div>
                    </div>
                </nav>

                <div className="pt-3 border-t border-border px-4 pb-6 flex-shrink-0 bg-white">
                    {/* User Profile Section */}
                    {user?.user_metadata?.role !== 'org_super_admin' && (
                        <div className="flex items-center gap-2 px-1 mb-2">
                            <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-text-inverse font-semibold text-xs">
                                {user?.email?.[0].toUpperCase() || 'O'}
                            </div>
                            <div className="flex flex-col overflow-hidden">
                                <span className="font-display font-semibold text-xs text-text-primary truncate">
                                    {user?.user_metadata?.full_name || 'Super Admin'}
                                </span>
                                <span className="text-[11px] text-text-tertiary truncate font-body">
                                    {user?.email}
                                </span>
                            </div>
                        </div>
                    )}

                    <button
                        onClick={() => setShowSignOutModal(true)}
                        className="flex items-center gap-2 px-3 py-2 text-text-tertiary hover:text-red-400 hover:bg-red-500/10 rounded-[10px] w-full transition-colors duration-150 text-xs font-medium"
                    >
                        <LogOut className="w-4 h-4" />
                        Sign out
                    </button>
                </div>
            </aside>

            <SignOutModal
                isOpen={showSignOutModal}
                onClose={() => setShowSignOutModal(false)}
                onConfirm={signOut}
            />

            {/* Main Content */}
            {/* Owner 2026-10-26: globals.css redefines .p-4 (32px) after the utilities, so on phones it beat pt-16 and the top of
                each tab sat under the fixed 64px bar; max-md:!pt-16 gives phones the full room back (md and up unchanged). */}
            <main id="main-scroll-container" className={`flex-1 min-w-0 w-full lg:ml-72 bg-white overflow-y-auto ${activeTab === 'overview' ? 'pt-16 px-4 pb-4 md:p-6 lg:p-8' : activeTab === 'requests' ? 'pt-16 lg:pt-0 lg:p-12' : 'pt-16 lg:pt-0 p-4 md:p-8 lg:p-12 max-md:!pt-16'}`}>
                {(showCommandCenter || dashboardContent !== undefined) && (
                    <div className="lg:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-border flex items-center gap-3 px-4 z-30">
                        <button type="button" aria-label="Open menu" onClick={() => setSidebarOpen(true)} className="p-2 text-text-secondary"><Menu className="w-6 h-6" /></button>
                        <span className="font-semibold">{dashboardContent !== undefined ? 'Petty Cash' : 'Dashboard'}</span>
                    </div>
                )}
                {dashboardContent ?? (<>


            {/* Overview IS the Command Center board — same tab, same URL, same chrome;
                only what sits inside <main> changes. It gets its own thin header (not the
                shared one below, which is skipped for this tab) so the property selector
                that scopes every other tab is available here too — the board's cards read
                the same selectedPropertyId via the propertyId prop. */}
            {showCommandCenter ? (
                <>
                    <div className="flex items-center justify-between gap-4 mb-6">
                        <div>
                            <h1 className="text-2xl md:text-3xl font-display font-semibold text-text-primary tracking-tight">Dashboard</h1>
                            <p className="hidden md:block text-text-tertiary text-xs font-body font-medium mt-1">
                                What&apos;s happening across your portfolio today
                            </p>
                        </div>
                        {renderPropertySelector()}
                    </div>
                    <CommandCenter
                        userName={user?.user_metadata?.full_name || 'Super Admin'}
                        userEmail={user?.email || ''}
                        orgId={org?.id ?? ''}
                        propertyId={selectedPropertyId === 'all' ? undefined : selectedPropertyId}
                    />
                </>
            ) : !org && !isLoading ? (
                <div className="p-10 text-center">
                    <h2 className="text-xl font-semibold text-red-600">Couldn&apos;t load the dashboard</h2>
                    <p className="text-slate-600 mt-2">{errorMsg || 'Organization not found'}</p>
                </div>
            ) : (
            <>

                {/* Shared Header for all tabs except Overview (which has its own high-fidelity header) */}
                {activeTab !== 'overview' && (
                    <header className="fixed top-0 left-0 right-0 lg:static h-16 bg-white border-b border-border/10 flex justify-between items-center px-4 md:px-8 lg:px-0 mb-10 z-30">
                        <div className="flex items-center gap-4">
                            {/* Mobile Menu Toggle */}
                            <button
                                onClick={() => setSidebarOpen(true)}
                                className="p-2 -ml-2 lg:hidden text-text-tertiary hover:text-text-primary transition-colors"
                            >
                                <Menu className="w-6 h-6" />
                            </button>
                            <div>
                                <h1 className="text-2xl md:text-3xl font-display font-semibold text-text-primary tracking-tight capitalize">{activeTab === 'ppm' ? 'Planned Preventive Maintenance' : activeTab.replace(/_/g, ' ')}</h1>
                                <p className="hidden md:block text-text-tertiary text-xs font-body font-medium mt-1">Manage your organization's resources</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">

                            {/* Property Selector for Requests/Other tabs */}
                            {renderPropertySelector()}

                            {/* Requests View Switcher (shared with the Tech console) */}
                            {activeTab === 'requests' && (
                                <RequestsViewSwitcher
                                    view={requestsView}
                                    onChange={view => {
                                        setRequestsView(view);
                                        const url = new URL(window.location.href);
                                        url.searchParams.set('view', view);
                                        window.history.pushState({}, '', url.toString());
                                    }}
                                />
                            )}
                            <div className="flex flex-col items-end">
                                <span className="text-sm font-display font-semibold text-text-primary tracking-tight">System status</span>
                                <span className="text-xs text-primary-dark font-medium">Online</span>
                            </div>
                        </div>
                    </header>
                )}

                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                    >
                        {/* AGENT PROVIDENCE. Every module tab opens with one line saying which agentic
                            employees are working this module and when they last moved. AgentPulse renders
                            NOTHING when the runtime is unprovisioned or no agent claims the module, so it
                            is safe on every tab and never invents a presence. */}
                        {activeTab === 'procurement' && org && (
                            <>
                                <AgentPulse orgId={org.id} module={AGENT_PULSE_BY_TAB.procurement} consoleTab="agent_console" className="mb-3" />
                                {searchParams.get('procurement_tab') === 'vendor-discovery'
                                    ? <SatejConsole orgId={org.id} />
                                    : <ProcurementModule key="procurement-admin" orgId={org.id} isAdmin={true} properties={properties} />}
                            </>
                        )}
                        {activeTab === 'roster' && selectedPropertyId === 'all' && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center mb-4">
                                    <ClipboardList className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.5} />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a property</h3>
                                <p className="text-sm text-slate-500 max-w-xs">Choose a property from the selector above to view the roster</p>
                            </div>
                        )}
                        {activeTab === 'roster' && selectedPropertyId !== 'all' && (
                            <>
                                <AgentPulse orgId={org?.id} module={AGENT_PULSE_BY_TAB.roster} consoleTab="agent_console" className="mb-3" />
                                <RosterDashboard propertyId={selectedPropertyId} />
                            </>
                        )}
                        {activeTab === 'water_logger' && selectedPropertyId === 'all' && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center mb-4">
                                    <Droplet className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.5} />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a property</h3>
                                <p className="text-sm text-slate-500 max-w-xs">Choose a property from the selector above to view water logs</p>
                            </div>
                        )}
                        {activeTab === 'water_logger' && selectedPropertyId !== 'all' && <WaterDashboard propertyId={selectedPropertyId} />}
                        
                        {activeTab === 'guest_experience' && selectedPropertyId === 'all' && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center mb-4">
                                    <Smartphone className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.5} />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a property</h3>
                                <p className="text-sm text-slate-500 max-w-xs">Choose a property from the selector above to view client support requests</p>
                            </div>
                        )}
                        {activeTab === 'guest_experience' && selectedPropertyId !== 'all' && (
                            <div className="h-full bg-slate-50 relative min-h-[calc(100vh-12rem)]">
                                <GuestExperienceDashboard propertyId={selectedPropertyId} />
                            </div>
                        )}
                        {activeTab === 'grievance' && (
                            <HRTicketsContent orgId={org?.id || membership?.org_id || membership?.organization_id || (user as any)?.organization_id || user?.user_metadata?.organization_id || '211e1330-ad83-446d-941f-dcea48396798'} />
                        )}
                        
                        {activeTab === 'water' && (
                            <WaterAnalyticsDashboard
                                key="water-analytics-tab"
                                propertyId={selectedPropertyId === 'all' ? undefined : selectedPropertyId}
                                orgId={org?.id}
                                properties={properties}
                            />
                        )}
                        {!isOpsSuperAdmin && activeTab === 'org_progress' && <OrgProgressTracker key="org-progress-tab" />}
                        {!isOpsSuperAdmin && activeTab === 'org_efficiency' && <OrgEfficiencyMeter key="org-efficiency-tab" />}
                        {/* Agentic employee console — a TAB of this dashboard, not a route of its own.
                            Registry, sandbox, live activity, uptime, reliability profile, reinforcement
                            and credentials all live behind it. */}
                        {!isOpsSuperAdmin && activeTab === 'agent_console' && <AgentConsole key="agent-console-tab" orgId={org?.id ?? ''} />}
                        {isOrgSuperAdmin && activeTab === 'po-approvals' && org && <PoApprovals orgId={org.id} />}
                        {activeTab === 'bounty' && org && (
                            <div className="space-y-3">
                                <div>
                                    <h2 className="text-xl font-semibold text-text-primary">AOP bounty</h2>
                                    <p className="text-sm text-text-secondary">What the month&apos;s AOP still needs, who owes it, and how long it has waited</p>
                                </div>
                                <BountyInbox orgId={org.id} />
                            </div>
                        )}
                        {!isOpsSuperAdmin && activeTab === 'wiki' && org && (
                            <div className="w-full min-h-screen bg-white">
                                <WikiHome orgId={org.id} />
                            </div>
                        )}
                        {activeTab === 'ai_tickets' && <AITicketsDashboard propertyId={selectedPropertyId === 'all' ? undefined : selectedPropertyId} />}
                        {activeTab === 'tasks' && <TaskManagerSuperuserDashboard orgId={org?.id || ''} underFixedHeader />}
                        {activeTab === 'revenue' && <RevenueTab key="revenue-tab" properties={properties} selectedPropertyId={selectedPropertyId} />}
                        {activeTab === 'properties' && (
                            <PropertiesTab
                                key="properties-tab"
                                properties={properties}
                                onCreate={() => setShowCreatePropModal(true)}
                                onEdit={(p: any) => setEditingProperty(p)}
                                onConfigure={(p: any) => {
                                    setSelectedPropertyForFeatures(p);
                                    setShowFeaturesModal(true);
                                }}
                                onDelete={handleDeleteProperty}
                            />
                        )}
                        <div className="w-full min-w-0 max-w-full overflow-x-hidden" style={{ display: activeTab === 'requests' ? 'block' : 'none' }}>
                            {/* Gated on activeTab, not on the wrapper: this block stays mounted with
                                display:none on every other tab, and an always-mounted pulse would keep
                                polling from screens that are not showing it. */}
                            <RequestsWorkspace
                                view={requestsView}
                                organizationId={org?.id}
                                selectedPropertyId={selectedPropertyId}
                                propertyName={activeProperty?.name}
                                adminUserName={user?.user_metadata?.full_name || 'Super Admin'}
                                properties={properties}
                                onPropertyChange={handlePropertyChange}
                                initialStatusFilter={pendingStatusFilter}
                                showAgentPulse={activeTab === 'requests'}
                                agentConsoleTab="agent_console"
                            />
                        </div>

                        {activeTab === 'visitors' && org?.id && <VMSOrgVisitorDashboard key="visitors-tab" orgId={org.id} />}

                        {activeTab === 'reports' && org && (
                            <div key="reports-tab" className="space-y-6">
                                {isOrgSuperAdmin && (
                                    <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Report">
                                        {([['imports', 'Import reports'], ['app_usage', 'App usage']] as const).map(([id, label]) => (
                                            <button
                                                key={id}
                                                type="button"
                                                onClick={() => setReportsView(id)}
                                                aria-pressed={reportsView === id}
                                                className={`rounded-[8px] px-4 py-1.5 text-xs font-medium transition-colors duration-150 ${reportsView === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {reportsView === 'app_usage' ? (
                                    <AppUsageReport orgId={org.id} />
                                ) : (
                                    <>
                                        <AgentPulse orgId={org.id} module={AGENT_PULSE_BY_TAB.reports} consoleTab="agent_console" />
                                        <ImportReportsView
                                            organizationId={org.id}
                                            propertyId={selectedPropertyId === 'all' ? undefined : selectedPropertyId}
                                        />
                                    </>
                                )}
                            </div>
                        )}

                        {activeTab === 'users' && (
                            <UserDirectory
                                key="users-tab"
                                orgId={org?.id}
                                orgName={org?.name}
                                properties={properties}
                                onUserUpdated={fetchOrgUsers}
                            />
                        )}

                        {activeTab === 'diesel_logger' && selectedPropertyId === 'all' && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center mb-4">
                                    <Fuel className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.5} />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a property</h3>
                                <p className="text-sm text-slate-500 max-w-xs">Choose a property from the selector above to view diesel logs</p>
                            </div>
                        )}
                        {activeTab === 'diesel_logger' && selectedPropertyId !== 'all' && (
                            <DieselStaffDashboard propertyId={selectedPropertyId} />
                        )}

                        {activeTab === 'diesel' && (
                            <>
                                <AgentPulse orgId={org?.id} module={AGENT_PULSE_BY_TAB.diesel} consoleTab="agent_console" className="mb-3" />
                                <DieselAnalyticsDashboard
                                    key="diesel-tab"
                                    propertyId={selectedPropertyId === 'all' ? undefined : selectedPropertyId}
                                    orgId={org?.id}
                                />
                            </>
                        )}

                        {activeTab === 'electricity_logger' && selectedPropertyId === 'all' && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center mb-4">
                                    <Zap className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.5} />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a property</h3>
                                <p className="text-sm text-slate-500 max-w-xs">Choose a property from the selector above to view electricity logs</p>
                            </div>
                        )}
                        {activeTab === 'electricity_logger' && selectedPropertyId !== 'all' && (
                            <ElectricityStaffDashboard propertyId={selectedPropertyId} />
                        )}

                        {activeTab === 'electricity' && (
                            <>
                                <AgentPulse orgId={org?.id} module={AGENT_PULSE_BY_TAB.electricity} consoleTab="agent_console" className="mb-3" />
                                <ElectricityAnalyticsDashboard
                                    key="electricity-tab"
                                    propertyId={selectedPropertyId === 'all' ? undefined : selectedPropertyId}
                                    orgId={org?.id}
                                    properties={properties}
                                />
                            </>
                        )}

                        {activeTab === 'stock_reports' && org && (
                            selectedPropertyId !== 'all' ? (
                                <StockReportView key="stock-report-view" propertyId={selectedPropertyId} orgId={org.id} propertyName={activeProperty?.name} />
                            ) : (
                                <div key="stock-report-empty" className="flex flex-col items-center justify-center py-20 text-center">
                                    <div className="w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center mb-4">
                                        <Package className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.5} />
                                    </div>
                                    <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a property</h3>
                                    <p className="text-sm text-slate-500 max-w-md">Choose a property from the selector above to view stock reports</p>
                                </div>
                            )
                        )}

                        {activeTab === 'checklist' && (
                            <div key="checklist-tab" className="w-full min-h-screen bg-slate-50/50">
                                <AgentPulse orgId={org?.id} module={AGENT_PULSE_BY_TAB.checklist} consoleTab="agent_console" className="mb-3" />
                                <SOPDashboard
                                    propertyId={checklistPropertyId === 'all' ? undefined : checklistPropertyId}
                                    propertyIds={checklistPropertyId === 'all' ? allPropertyIds : undefined}
                                    headerRight={<NotificationBell />}
                                    propertySelector={
                                        <PropertySelectorPill
                                            properties={properties}
                                            selectedId={checklistPropertyId}
                                            isOpen={openDropdown === 'checklist'}
                                            onToggle={() => setOpenDropdown(openDropdown === 'checklist' ? null : 'checklist')}
                                            onSelect={(id) => {
                                                setChecklistPropertyId(id);
                                                setOpenDropdown(null);
                                            }}
                                            onClose={() => setOpenDropdown(null)}
                                        />
                                    }
                                />
                            </div>
                        )}



                        {/* Urgency tab content */}
                        {activeTab === 'escalation' && org && (
                            <div className="p-4 md:p-8 lg:p-12">
                                <EscalationHierarchyBuilder
                                    organizationId={org.id}
                                    propertyId={escalationPropertyId !== 'all' ? escalationPropertyId : undefined}
                                />
                            </div>
                        )}

                        {activeTab === 'rooms' && (
                            <div className="p-4 md:p-8 lg:p-12 space-y-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h2 className="text-xl font-semibold text-slate-900">Meeting rooms</h2>
                                        <p className="text-sm text-slate-500 mt-0.5">Manage meeting rooms and bookings across your properties</p>
                                    </div>
                                    {properties.length > 0 && (
                                        <div className="flex flex-col items-end">
                                            <span className="text-xs text-slate-500 font-medium">Property</span>
                                            <span className="text-sm font-medium text-slate-900">{roomsPropertyId === 'all' ? 'All properties' : properties.find(p => p.id === roomsPropertyId)?.name}</span>
                                        </div>
                                    )}
                                </div>
                                {roomsPropertyId !== 'all' ? (
                                    <AdminRoomManager propertyId={roomsPropertyId} user={user!} />
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-20 text-center">
                                        <div className="w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center mb-4">
                                            <DoorOpen className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.5} />
                                        </div>
                                        <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a property</h3>
                                        <p className="text-sm text-slate-500 max-w-md">Choose a property from the selector above to manage its meeting rooms and bookings</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'ppm' && org && (
                            <div className="w-full min-h-screen bg-white">
                                <AgentPulse orgId={org.id} module={AGENT_PULSE_BY_TAB.ppm} consoleTab="agent_console" className="mb-3" />
                                <PPMModule
                                    organizationId={org.id}
                                    propertyId={selectedPropertyId !== 'all' ? selectedPropertyId : undefined}
                                    properties={properties}
                                />
                            </div>
                        )}

                        {activeTab === 'assets' && org && (
                            <div className="w-full min-h-screen bg-white">
                                <AssetsModule
                                    organizationId={org.id}
                                    propertyId={selectedPropertyId !== 'all' ? selectedPropertyId : undefined}
                                    propertyName={selectedPropertyId !== 'all' ? properties.find(p => p.id === selectedPropertyId)?.name : undefined}
                                    properties={properties}
                                    canManage={assetCaps(membership as any).canManage}
                                />
                            </div>
                        )}

                        {activeTab === 'document_bank' && org && (
                            <div className="w-full min-h-screen bg-white">
                                <DocumentBank
                                    organizationId={org.id}
                                    propertyId={selectedPropertyId !== 'all' ? selectedPropertyId : ''}
                                />
                            </div>
                        )}

                        {activeTab === 'meetings' && org && (
                            <div className="w-full min-h-screen bg-white">
                                <MeetingsHome orgId={org.id} embedded />
                            </div>
                        )}

                        {isOrgSuperAdmin && assistantOpened && (
                            <div className={activeTab === 'meeting_assistant' ? 'w-full p-4 sm:p-6' : 'hidden'}>
                                <MeetingAssistantTab space="admin" />
                            </div>
                        )}

                        {activeTab === 'vendors' && org && (
                            <div className="w-full min-h-screen bg-white">
                                <AgentPulse orgId={org.id} module={AGENT_PULSE_BY_TAB.vendors} consoleTab="agent_console" className="mb-3" />
                                <VendorManagement organizationId={org.id} />
                            </div>
                        )}

                        {activeTab === 'super_tenants' && org && (
                            <SuperTenantOrgTab orgId={org.id} properties={properties} />
                        )}

                        {activeTab === 'settings' && <SettingsView />}
                        {activeTab === 'petty-cash' && (
                            <div className="w-full">
                                <PettyCashDashboard orgId={org?.id || orgSlugOrId} />
                            </div>
                        )}
                        {activeTab === 'profile' && (
                            <div className="flex justify-center items-start py-8">
                                <div className="bg-white border border-slate-900/[0.08] rounded-2xl shadow-sm w-full max-w-md overflow-hidden">
                                    {/* Card Header with Autopilot Logo */}
                                    <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-8 flex flex-col items-center">
                                        {/* Autopilot Logo */}
                                        <div className="flex items-center justify-center mb-6">
                                            <img
                                                src="/autopilot-logo-new.png"
                                                alt="Autopilot Logo"
                                                className="h-10 w-auto object-contain invert mix-blend-screen"
                                            />
                                        </div>

                                        {/* User Avatar */}
                                        <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center border-4 border-white/20 mb-4 overflow-hidden">
                                            {user?.user_metadata?.user_photo_url || user?.user_metadata?.avatar_url ? (
                                                <Image
                                                    src={user.user_metadata.user_photo_url || user.user_metadata.avatar_url}
                                                    alt="Profile"
                                                    width={96}
                                                    height={96}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <span className="text-4xl font-semibold text-white">
                                                    {user?.user_metadata?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                                                </span>
                                            )}
                                        </div>

                                        {/* Role Badge */}
                                        <span className="px-3 py-1 bg-secondary/20 text-secondary-light rounded-full text-xs font-medium capitalize">
                                            {userRole}
                                        </span>
                                    </div>

                                    {/* Card Body with User Info */}
                                    <div className="p-8 space-y-6">
                                        <div className="space-y-4">
                                            <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                                <span className="text-xs font-medium text-slate-500">Full name</span>
                                                <span className="text-sm font-medium text-slate-900">
                                                    {user?.user_metadata?.full_name || 'Not set'}
                                                </span>
                                            </div>

                                            <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                                <span className="text-xs font-medium text-slate-500">Phone</span>
                                                <span className="text-sm font-medium text-slate-900 tabular-nums">
                                                    {user?.user_metadata?.phone || 'Not set'}
                                                </span>
                                            </div>

                                            <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                                <span className="text-xs font-medium text-slate-500">Email</span>
                                                <span className="text-sm font-medium text-slate-700">
                                                    {user?.email || 'Not set'}
                                                </span>
                                            </div>

                                            <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                                <span className="text-xs font-medium text-slate-500">Organization</span>
                                                <span className="text-sm font-medium text-slate-900">
                                                    {org?.name || 'Not assigned'}
                                                </span>
                                            </div>

                                            <div className="flex justify-between items-center py-3">
                                                <span className="text-xs font-medium text-slate-500">Role</span>
                                                <span className="px-2 py-0.5 bg-primary/10 text-primary-dark rounded-sm text-xs font-medium capitalize">
                                                    {userRole}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>
            </>
            )}

                </>)}
</main>

            {/* Modals — outside the tab branches so they stay mounted on every tab */}
            {
                (showCreatePropModal || editingProperty) && (
                    <PropertyModal
                        property={editingProperty}
                        supportsOperationType={properties.some(p => 'operation_type' in p)}
                        onClose={() => { setShowCreatePropModal(false); setEditingProperty(null); }}
                        onSave={(data: any) => editingProperty ? handleUpdateProperty(editingProperty.id, data) : handleCreateProperty(data)}
                    />
                )
            }

            {
                showUserModal && (
                    <UserModal
                        user={editingUser}
                        onClose={() => { setShowUserModal(false); setEditingUser(null); }}
                        onSave={(data: any) => editingUser && handleUpdateUser(editingUser.user_id, data)}
                        allProperties={properties}
                        orgId={org?.id || ''}
                    />
                )
            }

            <InviteMemberModal
                isOpen={showAddMemberModal}
                onClose={() => setShowAddMemberModal(false)}
                orgId={org?.id || ''}
                orgName={org?.name || 'Organization'}
                properties={properties}
                onSuccess={() => {
                    fetchOrgUsers();
                    handleTabChange('users');
                }}
            />

            {/* Ticket Create Modal */}
            {org && (
                <TicketCreateModal
                    isOpen={showTicketCreateModal}
                    onClose={() => setShowTicketCreateModal(false)}
                    organizationId={org.id}
                    propertyId={selectedPropertyId === 'all' ? undefined : selectedPropertyId}
                    isAdminMode={true}
                    showInternalToggle={true}
                    onSuccess={(ticket) => {
                        invalidateCache('tickets-');
                        invalidateCache('spoc-dashboard-');
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('ticket-created', { detail: { ticket } }));
                            window.dispatchEvent(new CustomEvent('request-created', { detail: { ticket } }));
                        }
                    }}
                    organizations={(() => {
                        const orgs = org ? [org] : [];
                        // If user is from Autopilot Offices but viewing another org, add Autopilot to the list
                        if (membership?.org_name === 'Autopilot Offices' && membership.org_id && membership.org_id !== org?.id) {
                            orgs.push({ id: membership.org_id, name: membership.org_name, code: 'autopilot' });
                        }
                        return orgs;
                    })()}
                    properties={properties}
                />
            )}

            {/* Stock Scanner Modal */}
            {selectedPropertyId !== 'all' && (
                <StockMovementModal
                    isOpen={isScannerModalOpen}
                    onClose={() => setIsScannerModalOpen(false)}
                    propertyId={selectedPropertyId}
                    autoOpenScanner={true}
                    onSuccess={() => {/* Stats will refresh on tab change or memoized components */ }}
                />
            )}

            {/* Property Features Modal */}
            {showFeaturesModal && selectedPropertyForFeatures && (
                <PropertyFeaturesModal
                    propertyId={selectedPropertyForFeatures.id}
                    propertyName={selectedPropertyForFeatures.name}
                    onClose={() => {
                        setShowFeaturesModal(false);
                        setSelectedPropertyForFeatures(null);
                        fetchProperties(); // Refresh to show updated validation status
                    }}
                />
            )}

        </div>
    );
};

const DieselSphere = ({ percentage }: { percentage: number }) => {
    return (
        <div className="relative w-full aspect-square max-w-[200px] mx-auto">
            {/* Outer Glass Sphere */}
            <div className="absolute inset-0 rounded-full border-4 border-white/20 bg-slate-900/10 shadow-md overflow-hidden">
                {/* 3D Inner Shadow for Depth */}
                <div className="absolute inset-0 rounded-full shadow-[inset_0_4px_16px_rgba(0,0,0,0.16)] z-20" />

                {/* Liquid Fill */}
                <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${percentage}%` }}
                    transition={{ duration: 2, ease: "circOut" }}
                    className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-600 via-amber-500 to-amber-400"
                >
                    {/* Primary Wave */}
                    <motion.div
                        animate={{
                            x: [0, -100],
                        }}
                        transition={{
                            duration: 4,
                            repeat: Infinity,
                            ease: "linear",
                        }}
                        className="absolute top-0 left-0 w-[400%] h-8 bg-amber-400/50 -translate-y-1/2 opacity-60"
                        style={{
                            borderRadius: '38% 42% 35% 45%',
                        }}
                    />

                    {/* Secondary Wave */}
                    <motion.div
                        animate={{
                            x: [-100, 0],
                        }}
                        transition={{
                            duration: 6,
                            repeat: Infinity,
                            ease: "linear",
                        }}
                        className="absolute top-1 left-0 w-[400%] h-8 bg-amber-400/30 -translate-y-1/2 opacity-40"
                        style={{
                            borderRadius: '45% 35% 42% 38%',
                        }}
                    />

                    {/* Bubbles animation */}
                    {[...Array(5)].map((_, i) => (
                        <motion.div
                            key={i}
                            animate={{
                                y: [0, -40],
                                opacity: [0, 0.6, 0],
                                x: [0, (i % 2 === 0 ? 10 : -10)],
                            }}
                            transition={{
                                duration: 2 + i,
                                repeat: Infinity,
                                delay: i * 0.5,
                            }}
                            className="absolute bottom-0 rounded-full bg-white/30"
                            style={{
                                width: 4 + (i * 2),
                                height: 4 + (i * 2),
                                left: `${20 + (i * 15)}%`,
                            }}
                        />
                    ))}
                </motion.div>

                {/* Reflection/Lighting Highlights */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-white/20 z-30 pointer-events-none" />
                <div className="absolute top-[10%] left-[15%] w-[25%] h-[15%] bg-white/20 rounded-full blur-[4px] rotate-[-25deg] z-30 pointer-events-none" />
            </div>

            {/* Percentage Display */}
            <div className="absolute inset-0 flex flex-col items-center justify-center z-40 pointer-events-none">
                <motion.span
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-4xl font-semibold text-slate-900 tabular-nums"
                >
                    {Math.round(percentage)}
                    <span className="text-sm ml-0.5 opacity-80">%</span>
                </motion.span>
                <span className="text-xs font-medium text-slate-700">Consumption</span>
            </div>

        </div>
    );
};

// Sub-components
const PropertiesTab = ({ properties, onCreate, onEdit, onConfigure, onDelete }: any) => (
    <div className="space-y-5">
        <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search properties"
                    className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-64"
                />
            </div>
            <button
                onClick={onCreate}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white font-medium text-sm rounded-[10px] hover:bg-slate-800 transition-colors duration-150 shadow-sm"
            >
                <Plus className="w-4 h-4" /> Add property
            </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-6">
            {properties.map((prop: any) => (
                <div key={prop.id} className="bg-white rounded-2xl border border-slate-900/[0.08] shadow-sm hover:border-slate-900/[0.16] transition-colors duration-150 group overflow-hidden flex flex-col">
                    {/* Image Header with aspect-ratio handling */}
                    <div className="relative h-56 bg-slate-50 overflow-hidden">
                        {prop.image_url ? (
                            <img
                                src={prop.image_url}
                                alt={prop.name}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-200 gap-2">
                                <Building2 className="w-10 h-10" strokeWidth={1.5} />
                                <span className="text-xs font-medium text-slate-400">No photo yet</span>
                            </div>
                        )}

                        {/* Overlay Controls */}
                        <div className="absolute top-4 right-4 flex gap-2 translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 transition-[transform,opacity] duration-200">
                            <button
                                onClick={() => onEdit(prop)}
                                className="p-2.5 bg-white/95 text-slate-600 rounded-[10px] hover:bg-slate-900 hover:text-white shadow-sm transition-colors duration-150"
                            >
                                <Edit className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => onConfigure(prop)}
                                title="Configure features"
                                className="p-2.5 bg-white/95 text-slate-600 rounded-[10px] hover:bg-slate-900 hover:text-white shadow-sm transition-colors duration-150"
                            >
                                <Settings className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => onDelete(prop.id)}
                                className="p-2.5 bg-white/95 text-slate-600 rounded-[10px] hover:bg-rose-600 hover:text-white shadow-sm transition-colors duration-150"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Property Tag */}
                        <div className="absolute bottom-4 left-4">
                            <span className="px-2 py-1 bg-slate-900/80 text-white text-[11px] font-mono font-medium rounded-sm uppercase border border-white/10">
                                {prop.code}
                            </span>
                        </div>
                    </div>

                    <div className="px-6 py-6 flex-1 flex flex-col">
                        <h3 className="text-lg font-semibold text-slate-900 leading-tight mb-2 truncate">{prop.name}</h3>
                        <div className="flex items-start gap-2.5 text-slate-500 text-xs mb-4">
                            <MapPin className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
                            <span className="line-clamp-2 leading-relaxed">{prop.address || 'No physical address registered'}</span>
                        </div>

                        {/* Validation badge */}
                        <div className="mb-6 flex flex-wrap gap-x-2 gap-y-2">
                            {prop.operation_type === 'capex' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-medium border bg-amber-50 text-amber-700 border-amber-200">
                                    CAPEX only
                                </span>
                            )}
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] font-medium border ${prop.validation_enabled !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${prop.validation_enabled !== false ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                {prop.validation_enabled !== false ? 'Validation on' : 'Validation off'}
                            </span>
                        </div>

                        <button
                            onClick={() => onConfigure(prop)}
                            className="w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-900 font-medium rounded-[10px] text-sm hover:bg-slate-100 transition-colors duration-150 mt-auto flex items-center justify-center gap-2"
                        >
                            <Settings className="w-4 h-4" /> Configure property
                        </button>
                    </div>
                </div>
            ))}
        </div>
    </div>
);

const UsersTab = ({ users, orgId, allProperties, onEdit, onDelete }: any) => (
    <div className="bg-white border border-slate-900/[0.08] rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-semibold text-slate-900">User directory</h3>
            <div className="flex gap-2">
                <button className="p-2 bg-slate-50 text-slate-400 rounded-[10px] hover:text-slate-900 transition-colors">
                    <Filter className="w-4 h-4" />
                </button>
            </div>
        </div>
        <table className="w-full text-left">
            <thead className="bg-slate-50/50 border-b border-slate-100">
                <tr>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500">Name</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500">Active role</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500">Properties</th>
                    <th className="px-5 py-3 text-xs font-medium text-slate-500">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
                {users.map((u: any) => (
                    <tr key={`${u.user_id}-${orgId}`} className="hover:bg-slate-50/30 transition-colors group">
                        <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 font-semibold text-xs">
                                    {u.user?.full_name?.substring(0, 1) || 'U'}
                                </div>
                                <div>
                                    <p className="font-medium text-slate-900 text-sm">{u.user?.full_name || 'Unknown'}</p>
                                    <p className="text-xs text-slate-500">{u.user?.email}</p>
                                </div>
                            </div>
                        </td>
                        <td className="px-5 py-4">
                            {u.role ? (
                                <span className={`px-2 py-0.5 rounded-sm text-[11px] font-medium capitalize ${u.role === 'org_super_admin' ? 'bg-primary/15 text-primary-dark' : 'bg-slate-100 text-slate-700'
                                    }`}>
                                    {u.role?.replace(/_/g, ' ')}
                                </span>
                            ) : u.propertyMemberships?.[0] ? (
                                <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium capitalize bg-secondary/10 text-secondary-dark border border-secondary/20">
                                    {u.propertyMemberships[0].role?.replace(/_/g, ' ')}
                                </span>
                            ) : (
                                <span className="text-[11px] font-medium text-slate-400">
                                    No assignment
                                </span>
                            )}
                        </td>
                        <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-1.5 max-w-[280px]">
                                {u.role === 'org_super_admin' ? (
                                    // Super Admins see all properties
                                    allProperties.map((p: any) => (
                                        <div key={p.id} className="bg-primary/10 text-primary-dark px-2 py-1 rounded-sm text-[11px] font-medium border border-primary/20 flex items-center gap-1">
                                            <Building2 className="w-3 h-3" />
                                            {p.name}
                                            <span className="opacity-60 ml-1">All access</span>
                                        </div>
                                    ))
                                ) : (
                                    // Others see assigned properties with their specific roles
                                    u.propertyMemberships?.map((pm: any) => (
                                        <div key={pm.property_id} className="bg-slate-50 text-slate-600 px-2 py-1 rounded-sm text-[11px] font-medium border border-slate-100 flex items-center gap-1 group/chip hover:bg-white transition-colors duration-150">
                                            <Building2 className="w-3 h-3 text-slate-400" />
                                            {pm.property_name}
                                            <span className="bg-slate-200 text-slate-500 px-1 py-0.5 rounded ml-1 capitalize">
                                                {pm.role?.replace(/_/g, ' ')}
                                            </span>
                                        </div>
                                    ))
                                )}
                                {u.role !== 'org_super_admin' && (!u.propertyMemberships || u.propertyMemberships.length === 0) && (
                                    <span className="text-slate-400 text-xs">No directly assigned properties</span>
                                )}
                            </div>
                        </td>
                        <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                                <button onClick={() => onEdit(u)} className="p-2 text-slate-400 hover:text-slate-900 transition-colors duration-150">
                                    <Edit className="w-4 h-4" />
                                </button>
                                <button onClick={() => onDelete(u.user_id)} className="p-2 text-slate-400 hover:text-rose-600 transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const PropertyModal = ({ property, supportsOperationType, onClose, onSave }: any) => {
    const [name, setName] = useState(property?.name || '');
    const [operationType, setOperationType] = useState<'opex' | 'capex'>(property?.operation_type === 'capex' ? 'capex' : 'opex');
    const [code, setCode] = useState(property?.code || '');
    const [address, setAddress] = useState(property?.address || '');
    const [imageUrl, setImageUrl] = useState(property?.image_url || '');
    const [validationEnabled, setValidationEnabled] = useState<boolean>(property?.validation_enabled !== false);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const uploadFile = async (file: File) => {
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/properties/upload-image', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (res.ok && data.url) {
                setImageUrl(data.url);
            } else {
                alert('Failed to upload image: ' + (data.error || 'Unknown error'));
            }
        } catch (err: any) {
            console.error('Upload error:', err);
            alert('Image upload error: ' + err.message);
        } finally {
            setIsUploading(false);
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            uploadFile(file);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) {
            uploadFile(file);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-[9998] p-4">
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white rounded-2xl p-8 max-w-md w-full shadow-xl relative overflow-hidden max-h-[85vh] overflow-y-auto custom-scrollbar border border-slate-900/[0.08]"
            >
                <button onClick={onClose} className="absolute right-6 top-6 text-slate-400 hover:text-slate-900 transition-colors duration-150">
                    <X className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center text-slate-600">
                        <Building2 className="w-5 h-5" strokeWidth={1.5} />
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold text-slate-900 leading-tight">
                            {property ? 'Edit property' : 'Add property'}
                        </h3>
                        <p className="text-slate-500 text-sm">Name, code, address and photo</p>
                    </div>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Property name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 rounded-[10px] border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors duration-150" placeholder="e.g. Skyline Towers" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Property code</label>
                        <input type="text" value={code} onChange={e => setCode(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 rounded-[10px] border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors duration-150" placeholder="e.g. SKY-01" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Address</label>
                        <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 rounded-[10px] border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors duration-150" placeholder="123 Main St, City" />
                    </div>

                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Property image</label>
                        <div
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                            className={`relative h-40 rounded-2xl border-2 border-dashed transition-colors duration-150 flex flex-col items-center justify-center overflow-hidden bg-slate-50 ${isDragging ? 'border-primary bg-primary/5' : 'border-slate-200'
                                }`}
                        >
                            {isUploading ? (
                                <div className="flex flex-col items-center gap-2">
                                    <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                                    <p className="text-xs font-medium text-slate-500">Uploading photo...</p>
                                </div>
                            ) : imageUrl ? (
                                <>
                                    <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" />
                                    <button
                                        type="button"
                                        onClick={() => setImageUrl('')}
                                        className="absolute top-2 right-2 p-1.5 bg-rose-500 text-white rounded-full shadow-sm hover:bg-rose-600 transition-colors duration-150"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </>
                            ) : (
                                <div className="flex flex-col items-center gap-2 pointer-events-none">
                                    <div className="w-10 h-10 bg-white rounded-md shadow-sm flex items-center justify-center text-slate-400">
                                        <Plus className="w-5 h-5" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs font-medium text-slate-600">Drop an image here</p>
                                        <p className="text-[11px] text-slate-400">or click to browse</p>
                                    </div>
                                </div>
                            )}
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleImageChange}
                                disabled={isUploading}
                                className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                            />
                        </div>
                    </div>

                    {/* OPEX / CAPEX only. Hidden until the operation_type column exists. */}
                    {supportsOperationType && (
                        <div>
                            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Property type</label>
                            <div className="grid grid-cols-2 gap-2">
                                {([
                                    { id: 'opex', label: 'OPEX', hint: 'Operational, uses the app daily' },
                                    { id: 'capex', label: 'CAPEX only', hint: 'Project or fit-out, no operations' },
                                ] as const).map(o => (
                                    <button
                                        key={o.id}
                                        type="button"
                                        onClick={() => setOperationType(o.id)}
                                        aria-pressed={operationType === o.id}
                                        className={`text-left px-4 py-3 rounded-[10px] border transition-colors duration-150 ${operationType === o.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
                                    >
                                        <span className="block text-sm font-medium">{o.label}</span>
                                        <span className={`block text-[11px] mt-0.5 ${operationType === o.id ? 'text-slate-300' : 'text-slate-400'}`}>{o.hint}</span>
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1.5">CAPEX-only properties are left out of the App usage report</p>
                        </div>
                    )}

                    {/* Validation Flow Toggle */}
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div>
                            <p className="text-sm font-medium text-slate-800">Client validation flow</p>
                            <p className="text-xs text-slate-400 mt-0.5">When enabled, tenants must approve completed tickets before they close</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setValidationEnabled(v => !v)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${validationEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${validationEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    <div className="flex gap-3 mt-8">
                        <button onClick={onClose} className="flex-1 py-2.5 font-medium text-slate-700 bg-slate-100 rounded-[10px] hover:bg-slate-200 transition-colors duration-150 text-sm">Cancel</button>
                        <button onClick={() => onSave({ name, code, address, image_url: imageUrl, validation_enabled: validationEnabled, ...(supportsOperationType ? { operation_type: operationType } : {}) })} className="flex-1 py-2.5 font-medium text-white bg-slate-900 rounded-[10px] hover:bg-slate-800 transition-colors duration-150 shadow-sm text-sm flex items-center justify-center gap-2">
                            <Check className="w-4 h-4" /> {property ? 'Update' : 'Create'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

const UserModal = ({ user, onClose, onSave, allProperties = [], orgId = '' }: any) => {
    const [fullName, setFullName] = useState(user?.user?.full_name || '');
    const [phone, setPhone] = useState(user?.user?.phone || '');
    const [orgRole, setOrgRole] = useState(user?.role || 'org_admin');

    // Property assignment state (only for property-level users)
    const isPropertyUser = !user?.role || user?.role === '';
    const currentPropIds: string[] = (user?.propertyMemberships || []).map((pm: any) => pm.property_id);
    const [assigningPropId, setAssigningPropId] = useState('');
    const [propAssignRole, setPropAssignRole] = useState('property_admin');
    const [assignedProps, setAssignedProps] = useState<{ property_id: string; property_name: string; role: string }[]>(
        (user?.propertyMemberships || []).map((pm: any) => ({
            property_id: pm.property_id,
            property_name: pm.property_name,
            role: pm.role,
        }))
    );
    const [propSaving, setPropSaving] = useState(false);
    const [propError, setPropError] = useState('');

    const unassignedProps = allProperties.filter((p: any) => !assignedProps.find(a => a.property_id === p.id));

    const handleAddProperty = async () => {
        if (!assigningPropId) return;
        setPropSaving(true);
        setPropError('');
        try {
            const res = await fetch('/api/users/assign-property', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.user_id,
                    propertyId: assigningPropId,
                    role: propAssignRole,
                    organizationId: orgId,
                    action: 'add',
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: 'Failed' }));
                setPropError(data.error || 'Failed');
                return;
            }
            const data = await res.json();
            const prop = allProperties.find((p: any) => p.id === assigningPropId);
            setAssignedProps(prev => [...prev, { property_id: assigningPropId, property_name: prop?.name || '', role: propAssignRole }]);
            setAssigningPropId('');
        } catch {
            setPropError('Network error');
        } finally {
            setPropSaving(false);
        }
    };

    const handleRemoveProperty = async (propId: string) => {
        setPropSaving(true);
        setPropError('');
        try {
            const res = await fetch('/api/users/assign-property', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.user_id,
                    propertyId: propId,
                    organizationId: orgId,
                    action: 'remove',
                }),
            });
            if (res.ok) {
                setAssignedProps(prev => prev.filter(p => p.property_id !== propId));
            }
        } catch {
            setPropError('Network error');
        } finally {
            setPropSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-[9998] p-4">
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white rounded-2xl p-8 max-w-lg w-full shadow-xl relative border border-slate-900/[0.08] max-h-[90vh] overflow-y-auto"
            >
                <button onClick={onClose} className="absolute right-6 top-6 text-slate-400 hover:text-slate-900 transition-colors duration-150">
                    <X className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-slate-100 rounded-md flex items-center justify-center text-slate-600">
                        <Users className="w-5 h-5" strokeWidth={1.5} />
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold text-slate-900 leading-tight">Edit user</h3>
                        <p className="text-slate-500 text-sm">{user?.user?.email}</p>
                    </div>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Full name</label>
                        <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 rounded-[10px] border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors duration-150" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1.5 block">Phone number</label>
                        <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 rounded-[10px] border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors duration-150" />
                    </div>
                    {user?.role && (
                        <div>
                            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Organization role</label>
                            <select value={orgRole} onChange={e => setOrgRole(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 rounded-[10px] border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary appearance-none">
                                <option value="org_super_admin">Super Admin</option>
                                <option value="org_admin">Admin</option>
                            </select>
                        </div>
                    )}

                    {/* Property Access Manager — shown for property-level users */}
                    {isPropertyUser && (
                        <div className="pt-2 border-t border-slate-100">
                            <label className="text-xs font-medium text-slate-600 mb-3 flex items-center gap-2">
                                <Building2 className="w-4 h-4" /> Property access
                            </label>

                            {/* Current assignments */}
                            <div className="space-y-2 mb-3">
                                {assignedProps.length === 0 && (
                                    <p className="text-xs text-slate-400">No properties assigned yet</p>
                                )}
                                {assignedProps.map(pm => (
                                    <div key={pm.property_id} className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-100 rounded-[10px]">
                                        <div>
                                            <span className="text-sm font-medium text-slate-800">{pm.property_name}</span>
                                            <span className="ml-2 text-[11px] font-medium capitalize text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">{pm.role?.replace(/_/g, ' ')}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveProperty(pm.property_id)}
                                            disabled={propSaving}
                                            className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors rounded-[8px] hover:bg-rose-50"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Add new property */}
                            {unassignedProps.length > 0 && (
                                <div className="flex gap-2">
                                    <select
                                        value={assigningPropId}
                                        onChange={e => setAssigningPropId(e.target.value)}
                                        className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-[10px] text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none"
                                    >
                                        <option value="">+ Add property…</option>
                                        {unassignedProps.map((p: any) => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                    <select
                                        value={propAssignRole}
                                        onChange={e => setPropAssignRole(e.target.value)}
                                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-[10px] text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none"
                                    >
                                        <option value="property_admin">Admin</option>
                                        <option value="staff">Staff</option>
                                        <option value="mst">MST</option>
                                        <option value="security">Security</option>
                                        <option value="tenant">Tenant</option>
                                    </select>
                                    <button
                                        type="button"
                                        onClick={handleAddProperty}
                                        disabled={!assigningPropId || propSaving}
                                        className="px-4 py-2 bg-slate-900 text-white rounded-[10px] text-sm font-medium disabled:opacity-40 hover:bg-slate-800 transition-colors duration-150"
                                    >
                                        {propSaving ? '…' : 'Add'}
                                    </button>
                                </div>
                            )}
                            {propError && <p className="text-xs text-rose-600 font-medium mt-2">{propError}</p>}
                        </div>
                    )}

                    <div className="flex gap-3 mt-8">
                        <button onClick={onClose} className="flex-1 py-2.5 font-medium text-slate-700 bg-slate-100 rounded-[10px] hover:bg-slate-200 transition-colors duration-150 text-sm">Cancel</button>
                        <button onClick={() => onSave({ full_name: fullName, phone, orgRole })} className="flex-1 py-2.5 font-medium text-white bg-slate-900 rounded-[10px] hover:bg-slate-800 transition-colors duration-150 shadow-sm text-sm">
                            Save changes
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

const RevenueTab = ({ properties, selectedPropertyId }: { properties: any[], selectedPropertyId: string }) => {
    const [vendors, setVendors] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedProperty, setSelectedProperty] = useState(selectedPropertyId);
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [vendorToEdit, setVendorToEdit] = useState<any | null>(null);
    const supabase = createClient();

    useEffect(() => {
        setSelectedProperty(selectedPropertyId);
    }, [selectedPropertyId]);

    useEffect(() => {
        fetchRevenueData();
    }, [selectedProperty]);

    const fetchRevenueData = async () => {
        setIsLoading(true);
        try {
            let query = supabase.from('vendors').select('*, properties(name), vendor_daily_revenue(*)');
            if (selectedProperty !== 'all') {
                query = query.eq('property_id', selectedProperty);
            }
            const { data, error } = await query;
            if (error) throw error;
            setVendors(data || []);
        } catch (err) {
            console.error('Error fetching revenue:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleExportAll = () => {
        const headers = ['Property', 'Shop Name', 'Owner', 'Commission %', 'Revenue', 'Commission Due'];
        const rows = vendors.map(v => {
            const rev = v.vendor_daily_revenue?.reduce((sum: number, r: any) => sum + r.revenue_amount, 0) || 0;
            const comm = (rev * (v.commission_rate / 100)).toFixed(2);
            return [v.properties?.name, v.shop_name, v.owner_name, v.commission_rate + '%', rev, comm];
        });

        const csvContent = "data:text/csv;charset=utf-8,"
            + headers.join(",") + "\n"
            + rows.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `organization_revenue_report.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (isLoading) return <div className="p-12 text-center text-sm text-slate-400">Loading revenue...</div>;

    const totalRevenue = vendors.reduce((acc, v) => acc + (v.vendor_daily_revenue?.reduce((sum: number, r: any) => sum + r.revenue_amount, 0) || 0), 0);
    const totalCommission = vendors.reduce((acc, v) => {
        const rev = v.vendor_daily_revenue?.reduce((sum: number, r: any) => sum + r.revenue_amount, 0) || 0;
        return acc + (rev * (v.commission_rate / 100));
    }, 0);

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-900/[0.08] shadow-sm">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900 leading-tight">Revenue analytics</h2>
                    <p className="text-slate-500 text-sm">Cafeteria vendor revenue and commission by property</p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <select
                        value={selectedProperty}
                        onChange={(e) => setSelectedProperty(e.target.value)}
                        className="flex-1 md:flex-none px-3 py-2 bg-slate-50 border border-slate-200 rounded-[10px] font-medium text-slate-900 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                        <option value="all">All properties</option>
                        {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button
                        onClick={() => {
                            if (selectedProperty === 'all') {
                                alert('Please select a specific property from the dropdown to add a vendor.');
                                return;
                            }
                            setVendorToEdit(null);
                            setIsManageModalOpen(true);
                        }}
                        className="px-4 py-2 bg-primary-dark text-white rounded-[10px] font-medium text-sm hover:bg-primary-dark/90 transition-colors duration-150 shadow-sm flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> Add vendor
                    </button>
                    <button
                        onClick={handleExportAll}
                        className="px-4 py-2 bg-white border border-slate-200 text-slate-900 rounded-[10px] font-medium text-sm hover:bg-slate-50 transition-colors duration-150 flex items-center gap-2"
                    >
                        <FileDown className="w-4 h-4" /> Export all
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5 gap-y-5">
                <div className="bg-white px-6 py-6 rounded-2xl border border-slate-900/[0.08] shadow-sm">
                    <p className="text-xs font-medium text-slate-500 mb-1">Total revenue</p>
                    <p className="text-3xl font-semibold text-slate-900 tabular-nums">₹{totalRevenue.toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-white px-6 py-6 rounded-2xl border border-slate-900/[0.08] shadow-sm">
                    <p className="text-xs font-medium text-slate-500 mb-1">Total commission</p>
                    <p className="text-3xl font-semibold text-slate-900 tabular-nums">₹{totalCommission.toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-white px-6 py-6 rounded-2xl border border-slate-900/[0.08] shadow-sm">
                    <p className="text-xs font-medium text-slate-500 mb-1">Vendors</p>
                    <p className="text-3xl font-semibold text-slate-900 tabular-nums">{vendors.length}</p>
                </div>
            </div>

            <div className="bg-white border border-slate-900/[0.08] rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/50 border-b border-slate-100">
                            <tr>
                                <th className="px-6 py-3 text-xs font-medium text-slate-500">Property / shop</th>
                                <th className="px-6 py-3 text-xs font-medium text-slate-500">Vendor</th>
                                <th className="px-6 py-3 text-xs font-medium text-slate-500 text-center">Comm %</th>
                                <th className="px-6 py-3 text-xs font-medium text-slate-500 text-right">Revenue</th>
                                <th className="px-6 py-3 text-xs font-medium text-slate-500 text-center">Last entry</th>
                                <th className="px-6 py-3 text-xs font-medium text-slate-500 text-right">Commission</th>
                                <th className="px-6 py-3 text-xs font-medium text-slate-500 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {vendors.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-16 text-center text-sm text-slate-400">No vendors yet</td>
                                </tr>
                            ) : (
                                vendors.map((v) => {
                                    const rev = v.vendor_daily_revenue?.reduce((sum: number, r: any) => sum + r.revenue_amount, 0) || 0;
                                    const comm = rev * (v.commission_rate / 100);
                                    const lastEntry = v.vendor_daily_revenue?.reduce((latest: string | null, r: any) =>
                                        !latest || r.revenue_date > latest ? r.revenue_date : latest, null as string | null);
                                    const lastEntryDisplay = lastEntry
                                        ? new Date(lastEntry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                        : '—';
                                    return (
                                        <tr key={v.id} className="hover:bg-slate-50/50 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-medium text-slate-900 text-sm">{v.shop_name}</p>
                                                    <p className="text-xs text-slate-500 mt-0.5">{v.properties?.name}</p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-600">{v.owner_name}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="px-2 py-0.5 bg-slate-100 rounded-sm text-xs font-medium text-slate-600 tabular-nums">{v.commission_rate}%</span>
                                            </td>
                                            <td className="px-6 py-4 text-right font-medium text-sm text-slate-900 tabular-nums">₹{(Number(rev) || 0).toLocaleString('en-IN')}</td>
                                            <td className="px-6 py-4 text-center text-xs font-mono tabular-nums text-text-tertiary">{lastEntryDisplay}</td>
                                            <td className="px-6 py-4 text-right font-medium text-sm text-slate-900 tabular-nums">₹{(Number(comm) || 0).toLocaleString('en-IN')}</td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => {
                                                            setVendorToEdit(v);
                                                            setIsManageModalOpen(true);
                                                        }}
                                                        className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-[10px] transition-colors"
                                                    >
                                                        <Settings className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            if (confirm('Are you sure you want to delete this vendor? This cannot be undone.')) {
                                                                try {
                                                                    const res = await fetch(`/api/properties/${v.property_id}/vendors?id=${v.id}`, { method: 'DELETE' });
                                                                    if (res.ok) fetchRevenueData();
                                                                    else alert('Failed to delete vendor');
                                                                } catch (e) {
                                                                    console.error(e);
                                                                }
                                                            }
                                                        }}
                                                        className="p-2 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-[10px] transition-colors"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {isManageModalOpen && (
                <VendorManagementModal
                    isOpen={isManageModalOpen}
                    onClose={() => setIsManageModalOpen(false)}
                    propertyId={vendorToEdit?.property_id || selectedProperty}
                    vendorToEdit={vendorToEdit}
                    onSuccess={() => fetchRevenueData()}
                />
            )}
        </div>
    );
};

const VisitorsTab = ({ properties, selectedPropertyId }: { properties: any[], selectedPropertyId: string }) => {
    const [visitors, setVisitors] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedProperty, setSelectedProperty] = useState(selectedPropertyId);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedVisitor, setSelectedVisitor] = useState<any | null>(null);
    const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
    const supabase = createClient();

    useEffect(() => {
        setSelectedProperty(selectedPropertyId);
    }, [selectedPropertyId]);

    useEffect(() => {
        const init = async () => {
            await fetchVisitors();
        };
        init();
    }, [selectedProperty, dateFilter]);

    const fetchVisitors = async () => {
        setIsLoading(true);
        try {
            // Use API routes (admin client) instead of direct Supabase query to avoid RLS restrictions
            const targetProperties = selectedProperty === 'all'
                ? properties.map((p: any) => p.id)
                : [selectedProperty];

            const allVisitors: any[] = [];

            for (const propId of targetProperties) {
                const params = new URLSearchParams();
                if (dateFilter !== 'all') params.set('date', dateFilter); // API uses 'date' param
                const res = await fetch(`/api/vms/${propId}?${params.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    const visitors = Array.isArray(data) ? data : (data.visitors || data.data || []);
                    // Attach property name from the properties prop
                    const prop = properties.find((p: any) => p.id === propId);
                    allVisitors.push(...visitors.map((v: any) => ({
                        ...v,
                        properties: { name: prop?.name || '' },
                    })));
                }
            }

            // Sort by checkin_time descending
            allVisitors.sort((a, b) => new Date(b.checkin_time).getTime() - new Date(a.checkin_time).getTime());
            setVisitors(allVisitors);
        } catch (err) {
            console.error('Error fetching visitors:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const filteredVisitors = visitors.filter(v =>
        v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.visitor_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.mobile && v.mobile.includes(searchTerm))
    );

    const getDuration = (checkin: string, checkout: string | null) => {
        const start = new Date(checkin);
        const end = checkout ? new Date(checkout) : new Date();
        const diffMs = end.getTime() - start.getTime();
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    };

    const handleExport = () => {
        const headers = ['Visitor ID', 'Property', 'Name', 'Mobile', 'Category', 'Host', 'Check In', 'Status'];
        const rows = filteredVisitors.map(v => [
            v.visitor_id,
            v.properties?.name || 'Unknown',
            v.name,
            v.mobile || '-',
            v.category,
            v.whom_to_meet,
            new Date(v.checkin_time).toLocaleString(),
            v.status
        ]);

        const csvContent = "data:text/csv;charset=utf-8,"
            + headers.join(",") + "\n"
            + rows.map(e => e.join(",")).join("\n");

        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "visitor_logs.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-900/[0.08] shadow-sm">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900 leading-tight">Visitor management</h2>
                    <p className="text-slate-500 text-sm">Track and manage visitors across all properties</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <div className="relative flex-1 md:flex-none">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search visitors"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full md:w-64 pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </div>
                    <select
                        value={selectedProperty}
                        onChange={(e) => setSelectedProperty(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-[10px] font-medium text-sm text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                    >
                        <option value="all">All properties</option>
                        {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value as any)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-[10px] font-medium text-sm text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                    >
                        <option value="all">All time</option>
                        <option value="today">Today</option>
                        <option value="week">This week</option>
                        <option value="month">This month</option>
                    </select>
                    <button
                        onClick={handleExport}
                        className="p-2 bg-slate-900 text-white rounded-[10px] hover:bg-slate-800 transition-colors duration-150"
                    >
                        <FileDown className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="bg-white border border-slate-900/[0.08] rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/50 border-b border-slate-100">
                            <tr>
                                <th className="px-5 py-3 text-xs font-medium text-slate-500">Visitor</th>
                                <th className="px-5 py-3 text-xs font-medium text-slate-500">Property</th>
                                <th className="px-5 py-3 text-xs font-medium text-slate-500">Host / purpose</th>
                                <th className="px-5 py-3 text-xs font-medium text-slate-500">Timing</th>
                                <th className="px-5 py-3 text-xs font-medium text-slate-500">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {isLoading ? (
                                <tr><td colSpan={5} className="p-8 text-center text-slate-400">Loading visitors...</td></tr>
                            ) : filteredVisitors.length === 0 ? (
                                <tr><td colSpan={5} className="p-8 text-center text-slate-400">No visitors match these filters</td></tr>
                            ) : (
                                filteredVisitors.map((visitor) => (
                                    <tr
                                        key={visitor.id}
                                        className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                                        onClick={() => setSelectedVisitor(visitor)}
                                    >
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                {visitor.photo_url ? (
                                                    <img
                                                        src={visitor.photo_url}
                                                        alt={visitor.name}
                                                        className="w-10 h-10 rounded-full object-cover border-2 border-slate-100"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-semibold">
                                                        {visitor.name?.[0]}
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="font-medium text-slate-900 text-sm">{visitor.name}</div>
                                                    <div className="text-xs text-slate-500 tabular-nums">{visitor.mobile || 'No mobile'}</div>
                                                    <div className="text-[11px] text-slate-400 mt-0.5 font-mono">{visitor.visitor_id}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-1.5">
                                                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                                <span className="text-sm font-medium text-slate-700">{visitor.properties?.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="text-sm font-medium text-slate-900">{visitor.whom_to_meet}</div>
                                            <div className="text-xs text-slate-500 capitalize">{visitor.category}</div>
                                            <div className="text-[11px] text-slate-400 mt-1">
                                                Logged by: <span className="font-semibold text-slate-600">{visitor.creator?.full_name || 'Gate / Kiosk'}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="text-xs font-mono tabular-nums text-slate-700">
                                                In: {new Date(visitor.checkin_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                            {visitor.checkout_time && (
                                                <div className="text-xs font-mono tabular-nums text-text-tertiary mt-1">
                                                    Out: {new Date(visitor.checkout_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`px-2 py-0.5 rounded-sm text-[11px] font-medium ${visitor.status === 'checked_in'
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : 'bg-slate-100 text-slate-600'
                                                }`}>
                                                {visitor.status === 'checked_in' ? 'On premises' : 'Checked out'}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Visitor Info Modal */}
            <AnimatePresence>
                {selectedVisitor && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
                        onClick={() => setSelectedVisitor(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0.9 }}
                            className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header with Photo */}
                            <div className="bg-slate-900 p-6 text-white relative">
                                <button
                                    onClick={() => setSelectedVisitor(null)}
                                    className="absolute top-4 right-4 p-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors duration-150"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                                <div className="flex items-center gap-4">
                                    {selectedVisitor.photo_url ? (
                                        <img
                                            src={selectedVisitor.photo_url}
                                            alt={selectedVisitor.name}
                                            className="w-20 h-20 rounded-2xl object-cover border-4 border-white/30"
                                        />
                                    ) : (
                                        <div className="w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center">
                                            <UserCircle className="w-10 h-10" />
                                        </div>
                                    )}
                                    <div>
                                        <h3 className="text-xl font-semibold">{selectedVisitor.name}</h3>
                                        <p className="text-white/70 font-mono text-sm">{selectedVisitor.visitor_id}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Details */}
                            <div className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs font-medium text-slate-500">Category</p>
                                        <p className="text-slate-900 font-medium capitalize">{selectedVisitor.category}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium text-slate-500">Mobile</p>
                                        <p className="text-slate-900 font-medium tabular-nums">{selectedVisitor.mobile || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium text-slate-500">Coming from</p>
                                        <p className="text-slate-900 font-medium">{selectedVisitor.coming_from || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium text-slate-500">Whom to meet</p>
                                        <p className="text-slate-900 font-medium">{selectedVisitor.whom_to_meet}</p>
                                    </div>
                                </div>

                                <div className="border-t border-slate-100 pt-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <div>
                                            <p className="text-xs font-medium text-slate-500">Check-in</p>
                                            <p className="text-slate-900 font-mono tabular-nums">
                                                {new Date(selectedVisitor.checkin_time).toLocaleString('en-IN', {
                                                    day: '2-digit',
                                                    month: '2-digit',
                                                    year: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-medium text-slate-500">Duration</p>
                                            <p className="text-slate-900 font-medium tabular-nums">
                                                {getDuration(selectedVisitor.checkin_time, selectedVisitor.checkout_time)}
                                            </p>
                                        </div>
                                    </div>
                                    {selectedVisitor.checkout_time && (
                                        <div>
                                            <p className="text-xs font-medium text-slate-500">Check-out</p>
                                            <p className="text-slate-900 font-mono tabular-nums">
                                                {new Date(selectedVisitor.checkout_time).toLocaleString('en-IN', {
                                                    day: '2-digit',
                                                    month: '2-digit',
                                                    year: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

        </div>
    );
};

// ── SuperTenantOrgTab ─────────────────────────────────────────────────────────

interface STProperty { id: string; name: string; code: string; }

const SuperTenantOrgTab = ({ orgId, properties }: { orgId: string; properties: STProperty[] }) => {
    const supabase = createClient();
    const [superTenants, setSuperTenants] = useState<any[]>([]);
    const [orgUsers, setOrgUsers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [toastMsg, setToastMsg] = useState<{ msg: string; ok: boolean } | null>(null);

    const showToast = (msg: string, ok = true) => {
        setToastMsg({ msg, ok });
        setTimeout(() => setToastMsg(null), 3000);
    };

    useEffect(() => { fetchData(); }, [orgId]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const { data: stMems } = await supabase
                .from('organization_memberships')
                .select('user_id, users!user_id(id, full_name, email)')
                .eq('organization_id', orgId)
                .eq('role', 'super_tenant')
                .eq('is_active', true);

            const enriched = await Promise.all(
                (stMems || []).map(async (row: any) => {
                    const { data: props } = await supabase
                        .from('super_tenant_properties')
                        .select('property_id, properties(name, code)')
                        .eq('user_id', row.user_id);
                    return { ...row, assignedProperties: props || [] };
                })
            );
            setSuperTenants(enriched);

            const { data: members } = await supabase
                .from('organization_memberships')
                .select('user_id, role, users!user_id(id, full_name, email)')
                .eq('organization_id', orgId)
                .eq('is_active', true)
                .neq('role', 'super_tenant');
            setOrgUsers((members || []).map((m: any) => m.users).filter(Boolean));
        } catch (err) {
            console.error('[SuperTenantOrgTab] fetch error', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAssign = async () => {
        if (!selectedUserId || selectedPropertyIds.length === 0) {
            showToast('Select a user and at least one property', false);
            return;
        }
        setIsSaving(true);
        try {
            const res = await fetch('/api/super-tenant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: selectedUserId, organization_id: orgId, property_ids: selectedPropertyIds }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: 'Request failed' }));
                throw new Error(data.error || 'Request failed');
            }
            const data = await res.json();
            showToast('Super tenant assigned');
            setShowModal(false);
            setSelectedUserId('');
            setSelectedPropertyIds([]);
            fetchData();
        } catch (err: any) {
            showToast(err.message || 'Failed to assign', false);
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemove = async (userId: string, propertyId: string) => {
        if (!confirm('Remove this property from the super tenant?')) return;
        const res = await fetch('/api/super-tenant', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, property_id: propertyId }),
        });
        if (res.ok) { showToast('Property removed'); fetchData(); }
        else showToast('Couldn\'t remove the property', false);
    };

    const toggleProp = (id: string) =>
        setSelectedPropertyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Super tenants</h2>
                    <p className="text-sm text-slate-500 mt-0.5">Assign cross-property analytics access to tenant accounts</p>
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary-dark text-white font-medium text-sm rounded-[10px] hover:bg-primary-dark/90 transition-colors duration-150 shadow-sm"
                >
                    <Plus className="w-4 h-4" /> Assign super tenant
                </button>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-600">
                <Key className="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-400" strokeWidth={1.5} />
                <p className="text-xs leading-relaxed">
                    Super Tenants have read-only access to view and analyze all tickets across their assigned properties. They cannot create tickets, manage users, or access admin settings.
                </p>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
            ) : superTenants.length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed border-slate-200 rounded-2xl">
                    <Key className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                    <p className="text-sm font-medium text-slate-500">No super tenant accounts yet</p>
                    <p className="text-xs text-slate-400 mt-1">Use Assign super tenant above to add one</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {superTenants.map((st, i) => (
                        <div key={i} className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary-dark font-semibold text-sm">
                                        {st.users?.full_name?.[0]?.toUpperCase() || 'S'}
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-900 text-sm">{st.users?.full_name || '—'}</p>
                                        <p className="text-xs text-slate-500">{st.users?.email}</p>
                                    </div>
                                </div>
                                <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium bg-secondary/10 text-secondary-dark">
                                    Super tenant
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {st.assignedProperties.map((ap: any) => (
                                    <div key={ap.property_id} className="flex items-center gap-2 px-3 py-1.5 rounded-[8px] bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
                                        <Building2 className="w-3 h-3 text-slate-400" />
                                        {ap.properties?.name || ap.property_id}
                                        <button onClick={() => handleRemove(st.user_id, ap.property_id)} className="ml-1 text-slate-400 hover:text-red-500 transition-colors duration-150">
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                                {st.assignedProperties.length === 0 && <span className="text-xs text-slate-400">No properties assigned</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AnimatePresence>
                {showModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                        onClick={() => setShowModal(false)}>
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                            onClick={e => e.stopPropagation()}
                            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-5">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-slate-900 text-lg">Assign super tenant</h3>
                                <button onClick={() => setShowModal(false)} className="p-2 rounded-[10px] hover:bg-slate-100 text-slate-400 transition-colors duration-150"><X className="w-4 h-4" /></button>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-slate-600">User</label>
                                <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                                    <option value="">Choose a user</option>
                                    {orgUsers.map((u: any) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-slate-600">Properties</label>
                                <div className="max-h-48 overflow-y-auto space-y-1 border border-slate-200 rounded-2xl p-2">
                                    {properties.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No properties found</p>}
                                    {properties.map(prop => (
                                        <label key={prop.id} className="flex items-center gap-3 p-2 rounded-[10px] hover:bg-slate-50 cursor-pointer">
                                            <input type="checkbox" checked={selectedPropertyIds.includes(prop.id)} onChange={() => toggleProp(prop.id)} className="w-4 h-4 rounded accent-primary" />
                                            <div>
                                                <p className="text-sm font-medium text-slate-800">{prop.name}</p>
                                                <p className="text-[11px] font-mono text-slate-400">{prop.code}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                {selectedPropertyIds.length > 0 && <p className="text-xs font-medium text-primary-dark tabular-nums">{selectedPropertyIds.length} propert{selectedPropertyIds.length > 1 ? 'ies' : 'y'} selected</p>}
                            </div>
                            <button onClick={handleAssign} disabled={isSaving || !selectedUserId || selectedPropertyIds.length === 0}
                                className="w-full py-2.5 bg-primary-dark text-white font-medium rounded-[10px] hover:bg-primary-dark/90 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-sm">
                                {isSaving ? 'Assigning...' : 'Assign role and properties'}
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {toastMsg && (
                    <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100]">
                        <div className={`px-5 py-3 rounded-2xl shadow-lg font-medium text-sm border ${toastMsg.ok ? 'bg-emerald-900 border-emerald-500/50 text-emerald-50' : 'bg-rose-900 border-rose-500/50 text-rose-50'}`}>
                            {toastMsg.msg}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ── Property Selector Pill (used inside SOPDashboard header slot) ──
function PropertySelectorPill({ properties, selectedId, isOpen, onToggle, onSelect, onClose }: {
    properties: { id: string; name: string; code: string; image_url?: string }[];
    selectedId: string;
    isOpen: boolean;
    onToggle: () => void;
    onSelect: (id: string) => void;
    onClose: () => void;
}) {
    const selected = properties.find(p => p.id === selectedId);
    return (
        <div className="relative">
            <button
                onClick={onToggle}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 border border-slate-200 rounded-[10px] hover:bg-slate-200 transition-colors duration-150"
            >
                <div className="w-4 h-4 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                    {selectedId === 'all'
                        ? <LayoutDashboard className="w-3.5 h-3.5 text-slate-500" />
                        : selected?.image_url
                            ? <img src={selected.image_url} alt="" className="w-full h-full object-cover rounded" />
                            : <Building2 className="w-3.5 h-3.5 text-slate-500" />
                    }
                </div>
                <span className="text-xs font-medium text-slate-700 max-w-[90px] truncate">
                    {selectedId === 'all' ? 'All properties' : selected?.name}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
                {isOpen && (
                    <>
                        <div className="fixed inset-0 z-[60]" onClick={onClose} />
                        <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-lg border border-slate-200 z-[70] overflow-hidden"
                        >
                            <div className="p-2 border-b border-slate-100">
                                <button
                                    onClick={() => onSelect('all')}
                                    className={`w-full flex items-center gap-2.5 p-2 rounded-[10px] transition-colors duration-150 ${selectedId === 'all' ? 'bg-primary/15 text-primary-dark' : 'text-slate-600 hover:bg-slate-50'}`}
                                >
                                    <div className="w-8 h-8 rounded-[8px] bg-slate-100 flex items-center justify-center flex-shrink-0">
                                        <LayoutDashboard className="w-4 h-4 text-slate-500" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-sm font-medium">All properties</p>
                                        <p className="text-xs opacity-70 tabular-nums">{properties.length} locations</p>
                                    </div>
                                </button>
                            </div>
                            <div className="max-h-60 overflow-y-auto p-2 space-y-1">
                                {properties.map(prop => (
                                    <button
                                        key={prop.id}
                                        onClick={() => onSelect(prop.id)}
                                        className={`w-full flex items-center gap-2.5 p-2 rounded-[10px] transition-colors duration-150 ${selectedId === prop.id ? 'bg-primary/15 text-primary-dark' : 'text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        <div className="w-8 h-8 rounded-[8px] bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                                            {prop.image_url
                                                ? <img src={prop.image_url} alt="" className="w-full h-full object-cover" />
                                                : <Building2 className="w-4 h-4 text-slate-400" />
                                            }
                                        </div>
                                        <div className="text-left overflow-hidden">
                                            <p className="text-sm font-medium truncate">{prop.name}</p>
                                            <p className="text-[11px] opacity-70 font-mono uppercase">{prop.code}</p>
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
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Summary Card — shown at the top of the Reports tab
// ─────────────────────────────────────────────────────────────────────────────
function WhatsAppSummaryCard({
    organizationId,
    propertyId,
}: {
    organizationId: string;
    propertyId?: string;
}) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [info, setInfo] = useState<{ recipients: number; open_tickets: number } | null>(null);
    const [errorMsg, setErrorMsg] = useState('');

    const handleSend = async () => {
        setStatus('loading');
        setInfo(null);
        setErrorMsg('');
        try {
            const res = await fetch('/api/reports/send-whatsapp-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, propertyId }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: 'Failed to send report' }));
                setErrorMsg(data.error || 'Failed to send report');
                setStatus('error');
            } else {
                const data = await res.json();
                setInfo({ recipients: data.recipients, open_tickets: data.open_tickets });
                setStatus('success');
                // Auto-reset after 8 seconds
                setTimeout(() => setStatus('idle'), 8000);
            }
        } catch {
            setErrorMsg('Network error. Please try again.');
            setStatus('error');
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Icon + text */}
            <div className="flex items-center gap-4 flex-1">
                <div className="w-12 h-12 rounded-md bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                    <p className="text-sm font-semibold text-slate-900">Send ticket report on WhatsApp</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Sends the open-ticket summary to every org super admin on WhatsApp
                    </p>
                    {status === 'success' && info && (
                        <p className="text-xs text-emerald-600 font-medium mt-1 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" strokeWidth={1.5} />
                            Sent to {info.recipients} admin{info.recipients !== 1 ? 's' : ''}, {info.open_tickets} open ticket{info.open_tickets !== 1 ? 's' : ''} reported
                        </p>
                    )}
                    {status === 'error' && (
                        <p className="text-xs text-rose-600 font-medium mt-1 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" strokeWidth={1.5} />{errorMsg}</p>
                    )}
                </div>
            </div>

            {/* Button */}
            <button
                onClick={handleSend}
                disabled={status === 'loading'}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-medium rounded-[10px] transition-colors duration-150 flex-shrink-0"
            >
                {status === 'loading' ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                    </>
                ) : (
                    <>
                        <Send className="w-4 h-4" />
                        Send report
                    </>
                )}
            </button>
        </div>
    );
}

export default OrgAdminDashboard;
