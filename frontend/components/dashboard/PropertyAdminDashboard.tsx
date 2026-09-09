'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import {
    LayoutDashboard, Users, Ticket, Settings, UserCircle, UsersRound,
    Search, Plus, Filter, LogOut, ChevronRight, MapPin, Building2,
    Calendar, CheckCircle2, AlertCircle, Clock, Coffee, IndianRupee, FileDown, Fuel, Store, Activity, Upload, FileBarChart, Menu, X, Zap, RefreshCw,
    Package, ClipboardCheck, Scan, ChevronDown, ChevronUp, Check, GitBranch, CalendarDays, ShoppingCart, Droplets, TrendingUp, QrCode, Smartphone, MessageSquarePlus, Bot
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import { useAuth } from '@/frontend/context/AuthContext';
import { useDataCache } from '@/frontend/context/DataCacheContext';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import UserDirectory from './UserDirectory';
import SignOutModal from '@/frontend/components/ui/SignOutModal';
import DieselAnalyticsDashboard from '@/frontend/components/diesel/DieselAnalyticsDashboard';
import DieselStaffDashboard from '@/frontend/components/diesel/DieselStaffDashboard';
import ElectricityStaffDashboard from '@/frontend/components/electricity/ElectricityStaffDashboard';
import ElectricityAnalyticsDashboard from '@/frontend/components/electricity/ElectricityAnalyticsDashboard';
import NotificationBell from './NotificationBell';
import Image from 'next/image';
import Skeleton from '@/frontend/components/ui/Skeleton';
import VendorExportModal from '@/frontend/components/vendor/VendorExportModal';
import { Toast } from '@/frontend/components/ui/Toast';
import VMSAdminDashboard from '@/frontend/components/vms/VMSAdminDashboard';
import TenantTicketingDashboard from '@/frontend/components/tickets/TenantTicketingDashboard';
import TicketCreateModal from '@/frontend/components/tickets/TicketCreateModal';
import TicketsView from './TicketsView';
import { useTheme } from '@/frontend/context/ThemeContext';
import { Sun, Moon } from 'lucide-react';
import SettingsView from './SettingsView';
import AddMemberModal from './InviteMemberModal';
import { ImportReportsView } from '@/frontend/components/snags';
import AdminRoomManager from '@/frontend/components/meeting-rooms/AdminRoomManager';
import StockDashboard from '@/frontend/components/stock/StockDashboard';
import StockMovementModal from '@/frontend/components/stock/StockMovementModal';
import SOPDashboard from '@/frontend/components/sop/SOPDashboard';
import EscalationHierarchyBuilder from '@/frontend/components/escalation/EscalationHierarchyBuilder';
import PPMModule from '@/frontend/components/ppm/PPMModule';
import ProcurementModule from '@/frontend/components/procurement/ProcurementModule';
import UniversalQRScannerModal, { QRScanResult } from '@/frontend/components/shared/UniversalQRScannerModal';
import { RosterDashboard } from '@/frontend/components/roster/RosterDashboard';
import { WaterDashboard } from '@/frontend/components/water/WaterDashboard';
import WaterAnalyticsDashboard from '@/frontend/components/water/WaterAnalyticsDashboard';
import ClientQRGeneratorModal from '@/frontend/components/vms/ClientQRGeneratorModal';

import VendorManagementModal from '@/frontend/components/vendor/VendorManagementModal';
import GuestExperienceDashboard from '@/frontend/components/guest-experience/GuestExperienceDashboard';
import FeedbackModal from '@/frontend/components/ui/FeedbackModal';
import AITicketsDashboard from '@/frontend/components/ai-tickets/AITicketsDashboard';

// Types
type Tab = 'overview' | 'requests' | 'guest_experience' | 'reports' | 'users' | 'visitors' | 'rooms' | 'diesel' | 'diesel_analytics' | 'electricity' | 'electricity_analytics' | 'cafeteria' | 'settings' | 'profile' | 'units' | 'vendor_revenue' | 'stock' | 'checklist' | 'escalation' | 'ppm' | 'procurement' | 'roster' | 'water' | 'water_analytics' | 'ai_tickets';

interface Property {
    id: string;
    name: string;
    code: string;
    address: string;
    organization_id: string;
    image_url?: string;
}

interface TicketData {
    id: string;
    title: string;
    status: 'open' | 'in_progress' | 'resolved' | 'closed';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    created_at: string;
}

function useCountUp(target: number, duration = 1400): number {
    const [display, setDisplay] = useState(0);
    const raf = useRef<number | null>(null);
    const startRef = useRef<{ from: number; to: number; startTime: number } | null>(null);

    useEffect(() => {
        const from = display;
        startRef.current = { from, to: target, startTime: performance.now() };

        const tick = (now: number) => {
            if (!startRef.current) return;
            const { from: f, to, startTime } = startRef.current;
            const t = Math.min((now - startTime) / duration, 1);
            const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const current = Math.round(f + (to - f) * eased);
            setDisplay(current);
            if (t < 1) raf.current = requestAnimationFrame(tick);
        };

        if (raf.current) cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(tick);
        return () => { if (raf.current) cancelAnimationFrame(raf.current); };
    }, [target, duration]);

    return display;
}

interface PropertyAdminDashboardProps {
    propertyId?: string;
}

interface PropertySelectorDropdownProps {
    currentProperty: { id?: string; name?: string; code?: string; image_url?: string } | null;
    assignedProperties: { id: string; name: string; code?: string; image_url?: string }[];
    onSelectProperty: (propertyId: string) => void;
    variant?: 'dark' | 'light';
}

const PropertySelectorDropdown = memo(function PropertySelectorDropdown({
    currentProperty,
    assignedProperties,
    onSelectProperty,
    variant = 'light'
}: PropertySelectorDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 50);
        } else {
            setSearchQuery('');
        }
    }, [isOpen]);

    const displayProperties = useMemo(() => {
        if (assignedProperties.length <= 1) return assignedProperties;
        const allOption: { id: string; name: string; code?: string; image_url?: string } = { id: 'all', name: 'All Properties', code: 'ALL' };
        return [allOption, ...assignedProperties];
    }, [assignedProperties]);

    const filteredProperties = useMemo(() => {
        if (!searchQuery.trim()) return displayProperties;
        const q = searchQuery.toLowerCase().trim();
        return displayProperties.filter(
            p => p.name?.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q)
        );
    }, [displayProperties, searchQuery]);

    const isSingleProperty = assignedProperties.length <= 1;

    return (
        <div className="relative z-[300]" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => !isSingleProperty && setIsOpen(prev => !prev)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all text-xs font-bold shadow-sm ${
                    variant === 'dark'
                        ? 'bg-white/15 hover:bg-white/25 text-white border border-white/25 backdrop-blur-md'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
                } ${isSingleProperty ? 'cursor-default' : 'cursor-pointer'}`}
            >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${
                    variant === 'dark' ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                }`}>
                    {currentProperty?.image_url ? (
                        <img src={currentProperty.image_url} alt="" className="w-full h-full object-cover rounded-full" />
                    ) : (
                        <Building2 className="w-3.5 h-3.5" />
                    )}
                </div>
                <span className="max-w-[120px] sm:max-w-[160px] md:max-w-[200px] truncate leading-tight font-black">
                    {currentProperty?.name || 'Select Property'}
                </span>
                {!isSingleProperty && (
                    <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${
                        variant === 'dark' ? 'text-white/80' : 'text-slate-400'
                    } ${isOpen ? 'rotate-180' : ''}`} />
                )}
            </button>

            <AnimatePresence>
                {isOpen && !isSingleProperty && (
                    <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className="absolute top-full right-0 mt-2 bg-white border border-slate-200/80 rounded-2xl shadow-2xl z-[400] overflow-hidden w-[290px] sm:w-[320px] max-w-[calc(100vw-2rem)] text-slate-900"
                    >
                        {/* Header & Search */}
                        <div className="p-3 bg-slate-50/80 border-b border-slate-100 space-y-2">
                            <div className="flex items-center justify-between px-1">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Select Property</span>
                                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                    {assignedProperties.length} total
                                </span>
                            </div>
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder="Search properties..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Property List */}
                        <div className="max-h-[260px] overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
                            {filteredProperties.length === 0 ? (
                                <div className="p-4 text-center text-xs font-semibold text-slate-400">
                                    No properties match "{searchQuery}"
                                </div>
                            ) : (
                                filteredProperties.map(p => {
                                    const isSelected = p.id === currentProperty?.id;
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => {
                                                setIsOpen(false);
                                                if (!isSelected) onSelectProperty(p.id);
                                            }}
                                            className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl transition-all text-left group ${
                                                isSelected
                                                    ? 'bg-primary/10 text-primary font-bold'
                                                    : 'hover:bg-slate-50 text-slate-700 hover:pl-4'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden transition-colors ${
                                                    isSelected ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                                                }`}>
                                                    {p.image_url ? (
                                                        <img src={p.image_url} alt="" className="w-full h-full object-cover rounded-full" />
                                                    ) : (
                                                        <Building2 className="w-4 h-4" />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className={`text-xs font-bold truncate ${isSelected ? 'text-primary' : 'text-slate-800'}`}>
                                                        {p.name}
                                                    </div>
                                                    {p.code && (
                                                        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                                            {p.code}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                                                    <Check className="w-3 h-3 text-primary font-bold" />
                                                </div>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});

const PropertyAdminDashboard = ({ propertyId: propPropertyId }: PropertyAdminDashboardProps = {}) => {
    const { user, signOut, membership } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const params = useParams();
    const router = useRouter();
    const orgSlug = params?.orgId as string;
    const urlPropertyId = params?.propertyId as string;
    const searchParams = useSearchParams();

    // Resolved active property id: prop -> url param -> searchParam
    const [activePropId, setActivePropId] = useState<string | undefined>(
        propPropertyId || urlPropertyId || searchParams.get('propertyId') || undefined
    );

    useEffect(() => {
        const nextId = propPropertyId || urlPropertyId || searchParams.get('propertyId');
        if (nextId && nextId !== activePropId) {
            setActivePropId(nextId);
        }
    }, [propPropertyId, urlPropertyId, searchParams]);

    const propertyId = activePropId || (params?.propertyId as string) || '';

    // State
    const [openTab, setActiveTab] = useState<Tab>('overview');
    const supabase = useMemo(() => createClient(), []);
    const { getCachedData, setCachedData } = useDataCache();
    const cacheKey = `property-${propertyId}`;

    // State initialized from cache if available
    const [property, setProperty] = useState<Property | null>(() => propertyId ? getCachedData(cacheKey) : null);
    const [tickets, setTickets] = useState<TicketData[]>([]);
    const [isLoading, setIsLoading] = useState(!property);
    const [errorMsg, setErrorMsg] = useState('');
    const [showSignOutModal, setShowSignOutModal] = useState(false);
    const [showCreateTicketModal, setShowCreateTicketModal] = useState(false);
    const [showAddMemberModal, setShowAddMemberModal] = useState(false);
    const [statsVersion, setStatsVersion] = useState(0);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [showScannerModal, setShowScannerModal] = useState(false);
    const [showUniversalScanner, setShowUniversalScanner] = useState(false);
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [preSelectedStockItemId, setPreSelectedStockItemId] = useState<string | undefined>();
    const [pendingStatusFilter, setPendingStatusFilter] = useState('all');

    const userOrgRole = (membership?.org_role || '').toLowerCase();
    const isOpsSuperAdmin = userOrgRole === 'ops_super_admin';
    const isElevatedRole = ['ops_super_admin', 'org_super_admin', 'master_admin', 'org_admin'].includes(userOrgRole);

    // Organization properties for ops/super admins
    const [orgProperties, setOrgProperties] = useState<any[]>([]);

    useEffect(() => {
        const fetchOrgProperties = async () => {
            const orgId = property?.organization_id || membership?.org_id;
            if (!orgId) return;
            const { data } = await supabase
                .from('properties')
                .select('id, name, code, image_url, organization_id')
                .eq('organization_id', orgId)
                .is('deleted_at', null)
                .order('name');
            if (data && data.length > 0) {
                setOrgProperties(data);
                if (!activePropId) {
                    setActivePropId(isElevatedRole ? 'all' : data[0].id);
                }
            }
        };

        if (isElevatedRole) {
            fetchOrgProperties();
        }
    }, [membership?.org_id, property?.organization_id, isElevatedRole, activePropId, supabase]);

    // Property switcher — derive from all org properties for ops/super admins, or membership properties
    const assignedProperties = useMemo(() => {
        if (isElevatedRole && orgProperties.length > 0) {
            return orgProperties;
        }
        return (membership?.properties || [])
            .filter(p => !['tenant', 'super_tenant'].includes((p.role || '').toLowerCase()))
            .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);
    }, [membership, isElevatedRole, orgProperties]);

    useEffect(() => {
        if (!activePropId && assignedProperties.length > 0) {
            setActivePropId(isElevatedRole ? 'all' : assignedProperties[0].id);
        }
    }, [activePropId, assignedProperties, isElevatedRole]);

    const [showPropertyDropdown, setShowPropertyDropdown] = useState(false);
    const [showClientQRModal, setShowClientQRModal] = useState(false);
    const propertyDropdownRef = useRef<HTMLDivElement>(null);

    // Ref to prevent duplicate fetches
    const fetchedPropertyId = useRef<string | null>(null);

    useEffect(() => {
        if (propertyId && fetchedPropertyId.current !== propertyId) {
            fetchedPropertyId.current = propertyId;
            fetchPropertyDetails(true);
        }
    }, [propertyId]);

    // Close property dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (propertyDropdownRef.current && !propertyDropdownRef.current.contains(e.target as Node)) {
                setShowPropertyDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Restore tab from URL
    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab && ['overview', 'requests', 'reports', 'users', 'visitors', 'rooms', 'diesel', 'diesel_analytics', 'electricity', 'electricity_analytics', 'cafeteria', 'settings', 'profile', 'units', 'vendor_revenue', 'stock', 'checklist', 'roster', 'water', 'water_analytics', 'facility_qr', 'ai_tickets'].includes(tab)) {
            setActiveTab(tab as Tab);
        }
        const filter = searchParams.get('filter');
        if (filter) {
            setPendingStatusFilter(filter);
        } else {
            setPendingStatusFilter('all');
        }
    }, [searchParams]);

    // Helper to change tab with URL persistence
    const handleTabChange = (tab: Tab, filter: string = 'all', dateFrom?: string, dateTo?: string) => {
        setActiveTab(tab);
        setPendingStatusFilter(filter);
        setSidebarOpen(false);
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tab);
        if (filter !== 'all') {
            url.searchParams.set('filter', filter);
        } else {
            url.searchParams.delete('filter');
        }

        if (dateFrom && dateTo) {
            url.searchParams.set('dateFrom', dateFrom);
            url.searchParams.set('dateTo', dateTo);
        } else if (tab === 'requests') {
            url.searchParams.delete('dateFrom');
            url.searchParams.delete('dateTo');
        }
        window.history.pushState({}, '', url.toString());
    };

    const fetchPropertyDetails = async (isInitial = false) => {
        if (!propertyId) return;
        if (propertyId === 'all') {
            const allPropertyObj: Property = {
                id: 'all',
                name: 'All Properties',
                code: 'ALL',
                address: 'All Organization Properties',
                organization_id: orgProperties[0]?.organization_id || membership?.org_id || ''
            };
            setProperty(allPropertyObj);
            setIsLoading(false);
            return;
        }
        const currentCacheKey = `property-${propertyId}`;
        const cached = getCachedData(currentCacheKey);

        // If we have cached data, use it and only fetch if explicitly needed
        if (cached) {
            setProperty(cached);
            if (isInitial) {
                setIsLoading(false);
                return;
            }
        }

        if (!property || property.id !== propertyId) setIsLoading(true);
        setErrorMsg('');

        try {
            const { data, error } = await supabase
                .from('properties')
                .select('*')
                .eq('id', propertyId)
                .maybeSingle();

            if (error || !data) {
                setErrorMsg('Property not found.');
            } else {
                setProperty(data);
                setCachedData(currentCacheKey, data);
            }
        } catch (err) {
            setErrorMsg('Network error. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Loading timeout logic
    useEffect(() => {
        let timeout: NodeJS.Timeout;
        if (isLoading && !property) {
            timeout = setTimeout(() => {
                setErrorMsg('Loading is taking longer than usual... Please check your connection or try again.');
            }, 10000);
        }
        return () => clearTimeout(timeout);
    }, [isLoading, property]);


    if (isLoading && !property) return (
        <div className="min-h-screen bg-white flex">
            <aside className="w-72 border-r border-border p-6 space-y-6 hidden lg:block">
                <Skeleton className="w-full h-12" />
                <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="w-full h-10" />)}
                </div>
            </aside>
            <main className="flex-1 p-8 space-y-8">
                <header className="flex justify-between">
                    <Skeleton className="w-64 h-12" />
                    <Skeleton className="w-32 h-12" />
                </header>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Skeleton className="w-full h-32" />
                    <Skeleton className="w-full h-32" />
                    <Skeleton className="w-full h-32" />
                </div>
                <Skeleton className="w-full h-96" />
            </main>
        </div>
    );

    if (!property && !isLoading) return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-10 text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-black text-slate-900">Unable to Load Dashboard</h2>
            <p className="text-slate-500 mt-2 max-w-sm">{errorMsg || 'We couldn\'t find the property details you\'re looking for.'}</p>
            <div className="flex gap-4 mt-8">
                <button onClick={() => router.back()} className="px-6 py-2.5 bg-slate-100 text-slate-900 font-bold rounded-xl hover:bg-slate-200 transition-all">Go Back</button>
                <button onClick={() => fetchPropertyDetails()} className="px-6 py-2.5 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-all">Try Again</button>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-white flex font-inter text-text-primary">
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
                w-72 bg-white border-r border-slate-300 flex flex-col inset-y-0 z-50 transition-all duration-300
                fixed left-0
                ${sidebarOpen ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 lg:translate-x-0 lg:opacity-100'}
                overflow-hidden
            `}>
                {/* Mobile Close Button */}
                <button
                    onClick={() => setSidebarOpen(false)}
                    className="absolute top-4 right-4 lg:hidden p-2 rounded-lg hover:bg-surface-elevated transition-colors"
                >
                    <X className="w-5 h-5 text-text-secondary" />
                </button>
                <div className="p-4 lg:p-5 pb-2">
                    <div className="flex flex-col items-center gap-1 mb-3">
                        <img src="/autopilot-logo-new.png" alt="Autopilot Logo" className="h-10 w-auto object-contain" />
                        <p className="text-[10px] text-text-tertiary font-black uppercase tracking-[0.2em]">{isOpsSuperAdmin ? 'Ops Super Admin' : 'Property Manager'}</p>
                    </div>

                </div>

                <nav className="flex-1 px-4 overflow-y-auto min-h-0 custom-scrollbar">
                    {/* Quick Actions - Compact Version */}
                    <div className="mb-6">
                        {/* Quick Actions - Simplified Dark Version */}
                        <div className="mb-8">
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-6 mb-4 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse"></span>
                                Quick Actions
                            </p>
                            <div className="px-4 grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setShowCreateTicketModal(true)}
                                    className="flex flex-col items-center justify-center gap-1.5 p-2.5 bg-white text-text-primary rounded-xl hover:bg-muted transition-all border-2 border-primary/20 group shadow-sm"
                                >
                                    <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                        <Plus className="w-5 h-5 font-black" />
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-center mt-1">New Request</span>
                                </button>
                                <button
                                    onClick={() => setShowUniversalScanner(true)}
                                    className="flex flex-col items-center justify-center gap-1.5 p-2.5 bg-white text-text-primary rounded-xl hover:bg-muted transition-all border-2 border-primary/20 group shadow-sm"
                                >
                                    <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                        <Scan className="w-5 h-5 font-black" />
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-center mt-1">Scanner</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Core Operations */}
                    <div className="mb-6">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-4 mb-3 flex items-center gap-2">
                            <span className="w-0.5 h-3 bg-primary rounded-full"></span>
                            Core Operations
                        </p>
                        <div className="space-y-1">
                            <button
                                onClick={() => handleTabChange('overview')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'overview'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <LayoutDashboard className="w-4 h-4" />
                                Dashboard
                            </button>
                            <button
                                onClick={() => handleTabChange('requests')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'requests'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Ticket className="w-4 h-4" />
                                Requests
                            </button>
                            <button
                                onClick={() => handleTabChange('guest_experience')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'guest_experience'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Smartphone className="w-4 h-4" />
                                Client Support
                            </button>
                            <button
                                onClick={() => handleTabChange('reports')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'reports'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <FileBarChart className="w-4 h-4" />
                                Reports
                            </button>

                        </div>
                    </div>

                    {/* Management Hub */}
                    <div className="mb-6">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-4 mb-3 flex items-center gap-2">
                            <span className="w-0.5 h-3 bg-primary rounded-full"></span>
                            Management Hub
                        </p>
                        <div className="space-y-1">

                            <button
                                onClick={() => handleTabChange('users')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'users'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Users className="w-4 h-4" />
                                User Management
                            </button>
                            <button
                                onClick={() => handleTabChange('visitors')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'visitors'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <UsersRound className="w-4 h-4" />
                                Visitor Management
                            </button>
                            <button
                                onClick={() => handleTabChange('rooms')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'rooms'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Calendar className="w-4 h-4" />
                                Meeting Rooms
                            </button>
                            <button
                                onClick={() => handleTabChange('diesel')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'diesel'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Fuel className="w-4 h-4" />
                                Diesel Logger
                            </button>
                            <button
                                onClick={() => handleTabChange('diesel_analytics')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'diesel_analytics'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Fuel className="w-4 h-4" />
                                Diesel Analytics
                            </button>
                            <button
                                onClick={() => handleTabChange('electricity')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'electricity'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Zap className="w-4 h-4" />
                                Electricity Logger
                            </button>
                            <button
                                onClick={() => handleTabChange('electricity_analytics')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'electricity_analytics'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Zap className="w-4 h-4" />
                                Electricity Analytics
                            </button>
                            <button
                                onClick={() => handleTabChange('roster')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'roster'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <CalendarDays className="w-4 h-4" />
                                Roster Management
                            </button>
                            <button
                                onClick={() => handleTabChange('water')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'water'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Droplets className="w-4 h-4" />
                                Water Logger
                            </button>
                            <button
                                onClick={() => handleTabChange('water_analytics')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'water_analytics'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Droplets className="w-4 h-4" />
                                Water Analytics
                            </button>
                            <button
                                onClick={() => handleTabChange('stock')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'stock'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Package className="w-4 h-4" />
                                Stock Management
                            </button>
                            <button
                                onClick={() => handleTabChange('procurement')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'procurement'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <ShoppingCart className="w-4 h-4" />
                                Procurement
                            </button>
                            <button
                                onClick={() => handleTabChange('checklist')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'checklist'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <ClipboardCheck className="w-4 h-4" />
                                Checklists
                            </button>

                            <button
                                onClick={() => handleTabChange('ppm')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'ppm'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <CalendarDays className="w-4 h-4" />
                                PPM
                            </button>
                            <button
                                onClick={() => handleTabChange('escalation')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'escalation'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <GitBranch className="w-4 h-4" />
                                Escalation
                            </button>
                            <button
                                onClick={() => handleTabChange('vendor_revenue')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'vendor_revenue'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Coffee className="w-4 h-4" />
                                Cafeteria Revenue
                            </button>
                            <button
                                onClick={() => router.push(`/${property?.organization_id}/crm`)}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-bold text-sm text-text-secondary hover:bg-muted hover:text-text-primary"
                            >
                                <TrendingUp className="w-4 h-4" />
                                CRM
                            </button>
                        </div>
                    </div>

                    {/* System & Personal */}
                    <div className="mb-6">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-4 mb-3 flex items-center gap-2">
                            <span className="w-0.5 h-3 bg-primary rounded-full"></span>
                            System & Personal
                        </p>
                        <div className="space-y-1">
                            <button
                                onClick={() => handleTabChange('ai_tickets')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm group ${openTab === 'ai_tickets'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-primary/10 hover:text-primary'
                                    }`}
                            >
                                <Bot className={`w-4 h-4 transition-transform ${openTab === 'ai_tickets' ? '' : 'group-hover:scale-110'}`} />
                                AI Automation
                            </button>
                            <button
                                onClick={() => setShowFeedbackModal(true)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm text-text-secondary hover:bg-primary/10 hover:text-primary group"
                            >
                                <MessageSquarePlus className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                Feedback / Bug
                            </button>

            <FeedbackModal isOpen={showFeedbackModal} onClose={() => setShowFeedbackModal(false)} />

                            <button
                                onClick={() => handleTabChange('settings')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'settings'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <Settings className="w-4 h-4" />
                                Settings
                            </button>
                            <button
                                onClick={() => handleTabChange('profile')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-bold text-sm ${openTab === 'profile'
                                    ? 'bg-primary text-text-inverse shadow-sm'
                                    : 'text-text-secondary hover:bg-muted hover:text-text-primary'
                                    }`}
                            >
                                <UserCircle className="w-4 h-4" />
                                Profile
                            </button>
                        </div>
                    </div>
                </nav>

                <div className="px-4 pt-3 pb-12 border-t border-border mt-auto flex-shrink-0 bg-white">
                    <button
                        onClick={() => setShowSignOutModal(true)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-text-secondary hover:bg-red-50 hover:text-red-600 transition-all font-bold text-xs"
                    >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                    </button>
                </div>
            </aside>

            <SignOutModal
                isOpen={showSignOutModal}
                onClose={() => setShowSignOutModal(false)}
                onConfirm={signOut}
            />

            {
                property && (
                    <TicketCreateModal
                        isOpen={showCreateTicketModal}
                        onClose={() => setShowCreateTicketModal(false)}
                        propertyId={property.id}
                        organizationId={property.organization_id}
                        showInternalToggle={true}
                        onSuccess={() => {
                            setStatsVersion(v => v + 1);
                        }}
                    />
                )
            }

            {/* Main Content */}
            <main className="flex-1 min-w-0 overflow-x-hidden lg:ml-72 flex flex-col bg-white border-l border-slate-300 shadow-[-4px_0_12px_-4px_rgba(0,0,0,0.05)] relative z-10">
                {openTab !== 'overview' && (
                    <header className="h-14 flex justify-between items-center px-3 md:px-8 lg:px-12 mb-2 md:mb-4 border-b border-border/10">
                        <div className="flex items-center gap-3">
                            {/* Mobile Menu Toggle */}
                            <button
                                onClick={() => setSidebarOpen(true)}
                                className="w-9 h-9 flex items-center justify-center lg:hidden text-text-tertiary hover:text-text-primary transition-colors rounded-lg hover:bg-slate-100"
                            >
                                <Menu className="w-5 h-5" />
                            </button>
                            {openTab !== 'checklist' && (
                                <div className="hidden md:block">
                                    <h1 className="text-2xl md:text-3xl font-black text-text-primary tracking-tight capitalize">
                                        {openTab === 'ppm' ? 'Planned Preventive Maintenance' : 
                                         openTab === 'rooms' ? 'Meeting Rooms' : 
                                         openTab.replace(/_/g, ' ')}
                                    </h1>
                                    <p className="text-text-tertiary text-xs md:text-sm font-medium mt-0.5">{property?.address || 'Property Management Hub'}</p>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2 md:gap-3">
                            {/* Property Indicator / Switcher — always visible, dropdown when 2+ properties */}
                            <PropertySelectorDropdown
                                currentProperty={property}
                                assignedProperties={assignedProperties}
                                onSelectProperty={(id) => {
                                    setActivePropId(id);
                                    if (id === 'all') {
                                        setProperty({
                                            id: 'all',
                                            name: 'All Properties',
                                            code: 'ALL',
                                            address: 'All Organization Properties',
                                            organization_id: orgProperties[0]?.organization_id || membership?.org_id || ''
                                        });
                                    } else {
                                        const found = orgProperties.find(p => p.id === id) || (membership?.properties || []).find(p => p.id === id);
                                        if (found) setProperty(found as any);
                                    }
                                    const url = new URL(window.location.href);
                                    if (url.pathname.includes('/property/')) {
                                        const newPath = url.pathname.replace(/\/property\/[^\/]+/, `/property/${id}`);
                                        window.history.pushState({}, '', newPath + url.search);
                                    } else {
                                        url.searchParams.set('propertyId', id);
                                        window.history.pushState({}, '', url.toString());
                                    }
                                }}
                                variant="light"
                            />

                            {/* Notification Bell */}
                            <NotificationBell />

                            {/* User Account Info */}
                            <button
                                onClick={() => handleTabChange('profile')}
                                className="flex items-center gap-2 group transition-all"
                            >
                                <div className="w-9 h-9 bg-primary rounded-full flex items-center justify-center text-text-inverse font-bold text-sm group-hover:scale-105 transition-transform shadow-sm shadow-primary/20 flex-shrink-0">
                                    {user?.email?.[0].toUpperCase() || 'P'}
                                </div>
                                <div className="text-left hidden md:block">
                                    <h4 className="text-[13px] font-black text-text-primary leading-none mb-0.5 group-hover:text-primary transition-colors">
                                        {user?.user_metadata?.full_name || (isOpsSuperAdmin ? 'Ops Super Admin' : 'Property Admin')}
                                    </h4>
                                    <p className="text-[10px] text-text-tertiary font-black uppercase tracking-[0.15em]">
                                        View Profile
                                    </p>
                                </div>
                            </button>

                            <div className="hidden lg:flex flex-col items-end border-l border-border pl-4 h-8 justify-center">
                                <span className="text-[11px] font-black text-text-tertiary uppercase tracking-widest leading-none mb-1">Access Level</span>
                                <span className="text-xs text-primary font-black uppercase tracking-widest leading-none">{isOpsSuperAdmin ? 'Ops super admin' : 'Property admin'}</span>
                            </div>
                        </div>
                    </header>
                )}

                <AnimatePresence mode="wait">
                    <motion.div
                        key={openTab}
                        className={['overview', 'checklist'].includes(openTab) ? '' : 'px-0 md:px-8 lg:px-12 pt-0 md:pt-4 pb-8'}

                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                    >
                        {openTab === 'overview' && <OverviewTab
                            propertyId={propertyId}
                            statsVersion={statsVersion}
                            property={property}
                            onMenuToggle={() => setSidebarOpen(true)}
                            onRefresh={() => setStatsVersion(v => v + 1)}
                            onTabChange={handleTabChange}
                            assignedProperties={assignedProperties}
                            onPropertySwitch={(id) => {
                                setActivePropId(id);
                                if (id === 'all') {
                                    setProperty({
                                        id: 'all',
                                        name: 'All Properties',
                                        code: 'ALL',
                                        address: 'All Organization Properties',
                                        organization_id: orgProperties[0]?.organization_id || membership?.org_id || ''
                                    });
                                } else {
                                    const found = orgProperties.find(p => p.id === id) || (membership?.properties || []).find(p => p.id === id);
                                    if (found) setProperty(found as any);
                                }
                                const url = new URL(window.location.href);
                                if (url.pathname.includes('/property/')) {
                                    const newPath = url.pathname.replace(/\/property\/[^\/]+/, `/property/${id}`);
                                    window.history.pushState({}, '', newPath + url.search);
                                } else {
                                    url.searchParams.set('propertyId', id);
                                    window.history.pushState({}, '', url.toString());
                                }
                            }}
                        />}
                        {openTab === 'users' && <UserDirectory
                            propertyId={propertyId}
                            orgId={property?.organization_id}
                            orgName={orgSlug}
                            properties={property ? [property] : []}
                            onUserUpdated={Object.assign(() => setStatsVersion((v: number) => v + 1), {
                                __triggerModal: () => setShowAddMemberModal(true)
                            })}
                        />}
                        {openTab === 'roster' && property && <RosterDashboard propertyId={property.id} />}
                        {openTab === 'water' && property && <WaterDashboard propertyId={property.id} />}

                        {openTab === 'water_analytics' && property && <WaterAnalyticsDashboard propertyId={property.id} />}
                        {openTab === 'guest_experience' && property && <GuestExperienceDashboard propertyId={property.id} />}
                        {openTab === 'vendor_revenue' && <VendorRevenueTab propertyId={propertyId} />}
                        {openTab === 'requests' && property && (
                            <TicketsView
                                key={`tickets-${statsVersion}`}
                                propertyId={property.id}
                                initialStatusFilter={pendingStatusFilter}
                                canDelete={true}
                                onNewRequest={() => setShowCreateTicketModal(true)}
                            />
                        )}
                        {openTab === 'reports' && property && (
                            <ImportReportsView
                                propertyId={property.id}
                                organizationId={property.organization_id}
                            />
                        )}
                        {openTab === 'visitors' && property && (
                            <VMSAdminDashboard propertyId={property.id} />
                        )}
                        {openTab === 'rooms' && property && (
                            <AdminRoomManager propertyId={property.id} user={user} />
                        )}
                        {openTab === 'units' && (
                            <div className="p-12 text-center text-slate-400 font-bold italic bg-white rounded-3xl border border-slate-100 shadow-sm">
                                <Building2 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                                <h3 className="text-xl font-bold text-slate-900 mb-2 font-inter not-italic">Unit Management</h3>
                                <p className="text-slate-500 font-inter not-italic font-medium">Unit inventory management loading...</p>
                            </div>
                        )}
                        {openTab === 'diesel' && property && <DieselStaffDashboard propertyId={property.id} />}
                        {openTab === 'diesel_analytics' && <DieselAnalyticsDashboard />}
                        {openTab === 'electricity' && property && <ElectricityStaffDashboard propertyId={property.id} />}
                        {openTab === 'electricity_analytics' && property && <ElectricityAnalyticsDashboard propertyId={property.id} />}
                        {openTab === 'stock' && property && <StockDashboard propertyId={property.id} initialItemId={searchParams.get('scanItem') ?? undefined} />}
                        {openTab === 'checklist' && property && <SOPDashboard propertyId={property.id} />}
                        {openTab === 'ppm' && property && (
                            <PPMModule
                                organizationId={property.organization_id}
                                propertyId={property.id}
                            />
                        )}
                        {openTab === 'escalation' && property && (
                            <EscalationHierarchyBuilder
                                organizationId={property.organization_id}
                                propertyId={property.id}
                            />
                        )}
                        {openTab === 'procurement' && property && (
                            <ProcurementModule
                                orgId={property.organization_id}
                                isAdmin={false}
                                properties={[property]}
                            />
                        )}
                        {openTab === 'settings' && <SettingsView />}
                        {openTab === 'ai_tickets' && <AITicketsDashboard propertyId={propertyId || property?.id || (assignedProperties && assignedProperties[0]?.id)} />}
                        {openTab === 'profile' && (
                            <div className="flex justify-center items-start py-8">
                                <div className="bg-white border border-slate-100 rounded-3xl shadow-lg w-full max-w-md overflow-hidden">
                                    {/* Card Header with Autopilot Logo */}
                                    <div className="bg-primary/5 p-8 flex flex-col items-center border-b border-border">
                                        {/* Autopilot Logo */}
                                        <div className="flex items-center justify-center mb-6">
                                            <img
                                                src="/autopilot-logo-new.png"
                                                alt="Autopilot Logo"
                                                className="h-10 w-auto object-contain"
                                            />
                                        </div>

                                        {/* User Avatar */}
                                        <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center border-4 border-white mb-4 overflow-hidden">
                                            {user?.user_metadata?.user_photo_url || user?.user_metadata?.avatar_url ? (
                                                <Image
                                                    src={user.user_metadata.user_photo_url || user.user_metadata.avatar_url}
                                                    alt="Profile"
                                                    width={96}
                                                    height={96}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <span className="text-4xl font-black text-primary">
                                                    {user?.user_metadata?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                                                </span>
                                            )}
                                        </div>

                                        {/* Role Badge */}
                                        <span className="px-4 py-1.5 bg-blue-500 text-white rounded-full text-xs font-black uppercase tracking-wider">
                                            Property Admin
                                        </span>
                                    </div>

                                    {/* Card Body with User Info */}
                                    <div className="p-8 space-y-6">
                                        <div className="space-y-4">
                                            <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Full Name</span>
                                                <span className="text-sm font-bold text-slate-900">
                                                    {user?.user_metadata?.full_name || 'Not Set'}
                                                </span>
                                            </div>

                                            <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone</span>
                                                <span className="text-sm font-bold text-slate-900">
                                                    {user?.user_metadata?.phone || 'Not Set'}
                                                </span>
                                            </div>

                                            <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</span>
                                                <span className="text-sm font-medium text-slate-700">
                                                    {user?.email || 'Not Set'}
                                                </span>
                                            </div>

                                            <div className="flex justify-between items-center py-3 border-b border-slate-100">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Property</span>
                                                <span className="text-sm font-bold text-slate-900">
                                                    {property?.name || 'Not Assigned'}
                                                </span>
                                            </div>

                                            <div className="flex justify-between items-center py-3">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Role</span>
                                                <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold capitalize">
                                                    Property Admin
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>
            </main>

            <AddMemberModal
                isOpen={showAddMemberModal}
                onClose={() => setShowAddMemberModal(false)}
                orgId={property?.organization_id || ''}
                orgName={orgSlug || 'Organization'}
                properties={property ? [property] : []}
                fixedPropertyId={propertyId}
                onSuccess={() => setStatsVersion(v => v + 1)}
            />

            <StockMovementModal
                isOpen={showScannerModal}
                onClose={() => { setShowScannerModal(false); setPreSelectedStockItemId(undefined); }}
                propertyId={propertyId}
                preSelectedItemId={preSelectedStockItemId}
                autoOpenScanner={!preSelectedStockItemId}
                onSuccess={() => setStatsVersion(v => v + 1)}
            />

            {showUniversalScanner && (
                <UniversalQRScannerModal
                    title="Scanner"
                    onClose={() => setShowUniversalScanner(false)}
                    onResult={(result: QRScanResult) => {
                        setShowUniversalScanner(false);
                        if (result.type === 'checklist') {
                            router.push(`/checklist/${result.templateId}`);
                        } else if (result.type === 'stock') {
                            router.push(`/property/${propertyId}/dashboard?tab=stock&scanItem=${result.itemId}`);
                        } else if (result.type === 'barcode') {
                            router.push(`/property/${propertyId}/dashboard?tab=stock&scanItem=${result.value}`);
                        }
                    }}
                />
            )}

            {/* Modal: Client QR Generator */}
            <ClientQRGeneratorModal
                isOpen={showClientQRModal}
                onClose={() => setShowClientQRModal(false)}
                propertyId={propertyId}
                propertyName={property?.name || ''}
            />
        </div>
    );
};

// Diesel Sphere Visualization (copied from OrgAdminDashboard for consistency)
const DieselSphere = ({ percentage }: { percentage: number }) => {
    return (
        <div className="relative w-full aspect-square max-w-[200px] mx-auto group">
            <div className="absolute inset-0 rounded-full border-4 border-white/20 bg-slate-900/10 backdrop-blur-[2px] shadow-2xl overflow-hidden group-hover:scale-105 transition-transform duration-700">
                <div className="absolute inset-0 rounded-full shadow-[inset_0_10px_40px_rgba(0,0,0,0.5)] z-20" />
                <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${percentage}%` }}
                    transition={{ duration: 2, ease: "circOut" }}
                    className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-600 via-amber-500 to-amber-400"
                >
                    <motion.div
                        animate={{ x: [0, -100] }}
                        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                        className="absolute top-0 left-0 w-[400%] h-8 bg-amber-400/50 -translate-y-1/2 opacity-60"
                        style={{ borderRadius: '38% 42% 35% 45%' }}
                    />
                    <motion.div
                        animate={{ x: [-100, 0] }}
                        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                        className="absolute top-1 left-0 w-[400%] h-8 bg-amber-400/30 -translate-y-1/2 opacity-40"
                        style={{ borderRadius: '45% 35% 42% 38%' }}
                    />
                    {[...Array(5)].map((_, i) => (
                        <motion.div
                            key={i}
                            animate={{ y: [0, -40], opacity: [0, 0.6, 0], x: [0, (i % 2 === 0 ? 10 : -10)] }}
                            transition={{ duration: 2 + i, repeat: Infinity, delay: i * 0.5 }}
                            className="absolute bottom-0 rounded-full bg-white/30 backdrop-blur-sm"
                            style={{ width: 4 + (i * 2), height: 4 + (i * 2), left: `${20 + (i * 15)}%` }}
                        />
                    ))}
                </motion.div>
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-white/20 z-30 pointer-events-none" />
                <div className="absolute top-[10%] left-[15%] w-[25%] h-[15%] bg-white/20 rounded-full blur-[4px] rotate-[-25deg] z-30 pointer-events-none" />
                <div className="absolute bottom-[15%] right-[15%] w-[10%] h-[10%] bg-amber-500/20 rounded-full blur-[2px] z-30 pointer-events-none" />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center z-40 pointer-events-none">
                <motion.span initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} className="text-4xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                    {Math.round(percentage)}<span className="text-sm ml-0.5 opacity-80">%</span>
                </motion.span>
                <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest drop-shadow-md">Consumption</span>
            </div>
            <div className={`absolute -bottom-4 left-1/2 -translate-x-1/2 w-[60%] h-4 bg-amber-500/20 blur-xl rounded-full transition-opacity duration-300 ${percentage > 0 ? 'opacity-100' : 'opacity-0'}`} />
        </div>
    );
};

const OverviewTab = memo(function OverviewTab({
    propertyId,
    statsVersion,
    property,
    onMenuToggle,
    onRefresh,
    onTabChange,
    assignedProperties = [],
    onPropertySwitch,
}: {
    propertyId: string,
    statsVersion: number,
    property: { name: string; code: string; address?: string; image_url?: string } | null,
    onMenuToggle?: () => void,
    onRefresh: () => void,
    onTabChange: (tab: Tab, filter?: string, dateFrom?: string, dateTo?: string) => void,
    assignedProperties?: { id: string; name: string; code: string }[],
    onPropertySwitch?: (id: string) => void,
}) {
    const { getCachedData, setCachedData } = useDataCache();
    const [timePeriod, setTimePeriod] = useState<'today' | 'month' | 'all'>('all');
    
    const handleKPIClick = (filter: string) => {
        if (timePeriod === 'all') {
            onTabChange('requests', filter);
            return;
        }
        const date = new Date();
        let dateFrom, dateTo;
        if (timePeriod === 'today') {
            const todayStr = date.toISOString().split('T')[0];
            dateFrom = todayStr;
            dateTo = todayStr;
        } else if (timePeriod === 'month') {
            const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split('T')[0];
            dateFrom = startOfMonth;
            dateTo = endOfMonth;
        }
        onTabChange('requests', filter, dateFrom, dateTo);
    };
    // v2 prefix busts any pre-API-migration cached data that had 0/0 for visitors
    const fetchKey = `v2-${propertyId}-${statsVersion}-${timePeriod}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const initialCached = useMemo(() => getCachedData(fetchKey), [fetchKey]);
    const supabase = useMemo(() => createClient(), []);
    const hasFetched = useRef(false);
    const lastFetchKey = useRef('');
    const [showOverviewPropDropdown, setShowOverviewPropDropdown] = useState(false);
    const overviewPropDropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (overviewPropDropdownRef.current && !overviewPropDropdownRef.current.contains(e.target as Node)) {
                setShowOverviewPropDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Stats State initialized from cache if available
    const [ticketStats, setTicketStats] = useState(initialCached?.ticketStats || { total: 0, open: 0, waitlist: 0, in_progress: 0, resolved: 0, sla_breached: 0, avg_resolution_hours: 0, pending_validation: 0, urgent_open: 0 });
    const [validationEnabled, setValidationEnabled] = useState<boolean>(initialCached?.validationEnabled ?? false);
    const [electricityStats, setElectricityStats] = useState(initialCached?.electricityStats || { 
        total_units: 0, 
        total_units_today: 0, 
        total_units_month: 0, 
        total_cost: 0, 
        total_cost_month: 0, 
        total_cost_today: 0,
        latest_reading: 0,
        latest_reading_month: 0,
        latest_reading_today: 0,
    });
    const [dieselStats, setDieselStats] = useState(initialCached?.dieselStats || { total_units: 0, total_units_today: 0, total_units_month: 0, total_kwh: 0, total_kwh_today: 0, total_kwh_month: 0, total_litres: 0, total_litres_today: 0, total_litres_month: 0 });
    const [vmsStats, setVmsStats] = useState(initialCached?.vmsStats || { total_visitors: 0, checked_in: 0, checked_out: 0 });
    const [vendorStats, setVendorStats] = useState(initialCached?.vendorStats || { total_revenue: 0, total_commission: 0, total_vendors: 0 });
    const [recentTickets, setRecentTickets] = useState<any[]>(initialCached?.recentTickets || []);
    const [checklistStats, setChecklistStats] = useState(initialCached?.checklistStats || { completed: 0, total: 0, day_total: 0, day_completed: 0, night_total: 0, night_completed: 0 });
    const [isLoading, setIsLoading] = useState(!initialCached);

    useEffect(() => {
        // v2 prefix busts any pre-API-migration cached data that had 0/0 for visitors
        const fetchKey = `v2-${propertyId}-${statsVersion}-${timePeriod}`;

        // Prevent duplicate fetches for the same key
        if (lastFetchKey.current === fetchKey && hasFetched.current) {
            return;
        }

        const fetchPropertyData = async (isInitial = false) => {
            // Check if we already have fresh cached data
            const cached = getCachedData(fetchKey);
            if (isInitial && cached) {
                // If the data is less than 2 minutes old, skip re-fetching
                if (Date.now() - (cached.timestamp || 0) < 2 * 60 * 1000) {
                    setTicketStats(cached.ticketStats);
                    setRecentTickets(cached.recentTickets);
                    setElectricityStats(cached.electricityStats);
                    if (cached.dieselStats) setDieselStats(cached.dieselStats);
                    setVmsStats(cached.vmsStats);
                    setVendorStats(cached.vendorStats);
                    setIsLoading(false);
                    hasFetched.current = true;
                    lastFetchKey.current = fetchKey;
                    return;
                }
            }

            setIsLoading(true);
            lastFetchKey.current = fetchKey;
            hasFetched.current = true;

            try {
                // --- Tickets (all in parallel) ---
                const todayForTickets = new Date().toISOString().split('T')[0];
                const d = new Date();
                const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

                const validPropIds = assignedProperties.filter(p => p.id !== 'all').map(p => p.id);

                let openQuery = supabase.from('tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'waitlist', 'blocked', 'client_raised']);
                let waitlistQuery = supabase.from('tickets').select('id', { count: 'exact', head: true }).in('status', ['waitlist']);
                let inProgressQuery = supabase.from('tickets').select('id', { count: 'exact', head: true }).in('status', ['assigned', 'in_progress', 'paused', 'work_started']);
                let resolvedQuery = supabase.from('tickets').select('id', { count: 'exact', head: true }).in('status', ['resolved', 'closed', 'satisfied', 'pending_validation']);
                let totalQuery = supabase.from('tickets').select('id', { count: 'exact', head: true });
                let pendingValQuery = supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'pending_validation');
                let urgentOpenQuery = supabase.from('tickets').select('id', { count: 'exact', head: true }).in('priority', ['urgent', 'high', 'critical']).not('status', 'in', '("resolved","closed","satisfied")');
                let slaBreachedQuery = supabase.from('tickets').select('id', { count: 'exact', head: true }).or(`sla_deadline.lt.${new Date().toISOString()},sla_breached.eq.true`).not('status', 'in', '("resolved","closed")');
                let recentsQuery = supabase.from('tickets').select('id, title, status, created_at').order('created_at', { ascending: false }).limit(5);

                if (propertyId !== 'all') {
                    openQuery = openQuery.eq('property_id', propertyId);
                    waitlistQuery = waitlistQuery.eq('property_id', propertyId);
                    inProgressQuery = inProgressQuery.eq('property_id', propertyId);
                    resolvedQuery = resolvedQuery.eq('property_id', propertyId);
                    totalQuery = totalQuery.eq('property_id', propertyId);
                    pendingValQuery = pendingValQuery.eq('property_id', propertyId);
                    urgentOpenQuery = urgentOpenQuery.eq('property_id', propertyId);
                    slaBreachedQuery = slaBreachedQuery.eq('property_id', propertyId);
                    recentsQuery = recentsQuery.eq('property_id', propertyId);
                } else if (validPropIds.length > 0) {
                    openQuery = openQuery.in('property_id', validPropIds);
                    waitlistQuery = waitlistQuery.in('property_id', validPropIds);
                    inProgressQuery = inProgressQuery.in('property_id', validPropIds);
                    resolvedQuery = resolvedQuery.in('property_id', validPropIds);
                    totalQuery = totalQuery.in('property_id', validPropIds);
                    pendingValQuery = pendingValQuery.in('property_id', validPropIds);
                    urgentOpenQuery = urgentOpenQuery.in('property_id', validPropIds);
                    slaBreachedQuery = slaBreachedQuery.in('property_id', validPropIds);
                    recentsQuery = recentsQuery.in('property_id', validPropIds);
                }

                if (timePeriod === 'today') {
                    openQuery = openQuery.gte('created_at', todayForTickets);
                    waitlistQuery = waitlistQuery.gte('created_at', todayForTickets);
                    inProgressQuery = inProgressQuery.gte('created_at', todayForTickets);
                    resolvedQuery = resolvedQuery.gte('created_at', todayForTickets);
                    totalQuery = totalQuery.gte('created_at', todayForTickets);
                    pendingValQuery = pendingValQuery.gte('created_at', todayForTickets);
                    urgentOpenQuery = urgentOpenQuery.gte('created_at', todayForTickets);
                    slaBreachedQuery = slaBreachedQuery.gte('created_at', todayForTickets);
                } else if (timePeriod === 'month') {
                    openQuery = openQuery.gte('created_at', monthStart);
                    waitlistQuery = waitlistQuery.gte('created_at', monthStart);
                    inProgressQuery = inProgressQuery.gte('created_at', monthStart);
                    resolvedQuery = resolvedQuery.gte('created_at', monthStart);
                    totalQuery = totalQuery.gte('created_at', monthStart);
                    pendingValQuery = pendingValQuery.gte('created_at', monthStart);
                    urgentOpenQuery = urgentOpenQuery.gte('created_at', monthStart);
                    slaBreachedQuery = slaBreachedQuery.gte('created_at', monthStart);
                }

                const validationFeaturePromise = propertyId === 'all'
                    ? Promise.resolve({ data: { is_enabled: true }, error: null })
                    : supabase.from('property_features').select('is_enabled').eq('property_id', propertyId).eq('feature_key', 'ticket_validation').maybeSingle();

                const [openRes, waitlistRes, inProgressRes, resolvedRes, totalRes, recentsRes, pendingValRes, urgentOpenRes, slaBreachedRes, validationFeatureRes] = await Promise.all([
                    openQuery,
                    waitlistQuery,
                    inProgressQuery,
                    resolvedQuery,
                    totalQuery,
                    recentsQuery,
                    pendingValQuery,
                    urgentOpenQuery,
                    slaBreachedQuery,
                    validationFeaturePromise,
                ]);

                // --- Electricity, VMS, Vendors (all in parallel via APIs) ---
                const today = new Date().toISOString().split('T')[0];
                const apiPeriod = timePeriod; // 'today' | 'month' | 'all'

                // Optimize electricity fetch: only fetch what's needed for the period
                let electricityQuery = supabase.from('electricity_readings').select('computed_units, final_units, computed_cost, closing_reading, reading_date, electricity_meters!inner(meter_type)').eq('electricity_meters.meter_type', 'main').order('reading_date', { ascending: false });
                if (propertyId !== 'all') {
                    electricityQuery = electricityQuery.eq('property_id', propertyId);
                } else if (validPropIds.length > 0) {
                    electricityQuery = electricityQuery.in('property_id', validPropIds);
                }

                if (timePeriod === 'today') {
                    electricityQuery = electricityQuery.eq('reading_date', today);
                } else if (timePeriod === 'month') {
                    electricityQuery = electricityQuery.gte('reading_date', monthStart);
                }
                
                let dieselQuery = supabase.from('diesel_readings').select('computed_consumed_litres, closing_kwh, opening_kwh, reading_date');
                if (propertyId !== 'all') {
                    dieselQuery = dieselQuery.eq('property_id', propertyId);
                } else if (validPropIds.length > 0) {
                    dieselQuery = dieselQuery.in('property_id', validPropIds);
                }

                if (timePeriod === 'today') {
                    dieselQuery = dieselQuery.eq('reading_date', today);
                } else if (timePeriod === 'month') {
                    dieselQuery = dieselQuery.gte('reading_date', monthStart);
                }
                
                // Checklist progress
                const todayForChecklist = new Date().toISOString().split('T')[0];
                const monthStartForChecklist = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

                let checklistQuery = supabase.from('sop_completions').select('status, due_at');
                if (propertyId !== 'all') {
                    checklistQuery = checklistQuery.eq('property_id', propertyId);
                } else if (validPropIds.length > 0) {
                    checklistQuery = checklistQuery.in('property_id', validPropIds);
                }

                if (timePeriod === 'today') {
                    checklistQuery = checklistQuery.eq('completion_date', todayForChecklist);
                } else if (timePeriod === 'month') {
                    checklistQuery = checklistQuery.gte('completion_date', monthStartForChecklist);
                }

                const [electricityRes, dieselRes, vmsApiRes, vendorApiRes, checklistRes] = await Promise.all([
                    electricityQuery,
                    dieselQuery,
                    fetch(`/api/properties/${propertyId}/vms-summary?period=${apiPeriod}`),
                    fetch(`/api/properties/${propertyId}/vendor-summary?period=${apiPeriod}`),
                    checklistQuery
                ]);

                // Process checklist stats
                const checklistData = checklistRes.data || [];
                const getShiftFromDueAt = (dueAtUTC: string | null) => {
                    if (!dueAtUTC) return 'day';
                    const hours = new Date(dueAtUTC).getHours();
                    return (hours >= 6 && hours < 18) ? 'day' : 'night';
                };
                
                const checklistStatsObj = {
                    total: checklistData.length,
                    completed: checklistData.filter((d: any) => d.status === 'completed').length,
                    day_total: checklistData.filter((d: any) => getShiftFromDueAt(d.due_at) === 'day').length,
                    day_completed: checklistData.filter((d: any) => getShiftFromDueAt(d.due_at) === 'day' && d.status === 'completed').length,
                    night_total: checklistData.filter((d: any) => getShiftFromDueAt(d.due_at) === 'night').length,
                    night_completed: checklistData.filter((d: any) => getShiftFromDueAt(d.due_at) === 'night' && d.status === 'completed').length,
                };

                // Process electricity
                const periodUnits = electricityRes.data?.reduce((acc: number, r: any) => {
                    const val = r.final_units ?? r.computed_units ?? 0;
                    return acc + (val > 0 ? val : 0);
                }, 0) || 0;
                const periodCost = electricityRes.data?.reduce((acc: number, r: any) => {
                    const val = r.computed_cost ?? 0;
                    return acc + (val > 0 ? val : 0);
                }, 0) || 0;
                const latestReading = electricityRes.data?.[0]?.closing_reading || 0;
                
                // Process diesel
                const periodDieselLitres = dieselRes?.data?.reduce((acc: number, r: any) => acc + (r.computed_consumed_litres || 0), 0) || 0;
                const periodDieselKwh = dieselRes?.data?.reduce((acc: number, r: any) => acc + ((r.closing_kwh || 0) - (r.opening_kwh || 0)), 0) || 0;
                const periodDieselUnits = periodDieselLitres > 0 ? periodDieselLitres : periodDieselKwh;
                
                // For 'all' time, we might still want to know today/month units for other parts of UI if needed,
                // but let's keep it simple and just use the period units for the main display.
                const totalUnits = timePeriod === 'all' ? periodUnits : 0; // We'll handle this in the state update
                const monthUnits = timePeriod === 'month' ? periodUnits : 0;
                const todayUnits = timePeriod === 'today' ? periodUnits : 0;

                // Process VMS from API
                let vmsData: any = null;
                if (vmsApiRes.ok) {
                    vmsData = await vmsApiRes.json();
                } else {
                    console.error('[Dashboard] VMS API failed:', vmsApiRes.status, await vmsApiRes.text());
                }
                const checkedInCount = vmsData?.checked_in ?? 0;
                const checkedOutCount = vmsData?.checked_out ?? 0;
                const totalVisitors = vmsData?.total_visitors ?? 0;

                // Process Vendors from API
                let vendorData: any = null;
                if (vendorApiRes.ok) {
                    vendorData = await vendorApiRes.json();
                } else {
                    console.error('[Dashboard] Vendor API failed:', vendorApiRes.status, await vendorApiRes.text());
                }
                const totalRev = vendorData?.total_revenue ?? 0;
                const totalComm = vendorData?.total_commission ?? 0;

                const isValidationEnabled = validationFeatureRes.data?.is_enabled ?? false;
                setValidationEnabled(isValidationEnabled);

                const result = {
                    ticketStats: {
                        total: totalRes.count || 0,
                        open: openRes.count || 0,
                        waitlist: waitlistRes.count || 0,
                        in_progress: inProgressRes.count || 0,
                        resolved: resolvedRes.count || 0,
                        sla_breached: slaBreachedRes.count || 0,
                        avg_resolution_hours: 0,
                        pending_validation: pendingValRes.count || 0,
                        urgent_open: urgentOpenRes.count || 0,
                    },
                    validationEnabled: isValidationEnabled,
                    timePeriod: timePeriod,
                    recentTickets: recentsRes.data || [],
                    checklistStats: checklistStatsObj,
                    electricityStats: { 
                        total_units: timePeriod === 'all' ? Math.round(periodUnits) : (electricityStats.total_units || 0), 
                        total_units_month: timePeriod === 'month' ? Math.round(periodUnits) : (electricityStats.total_units_month || 0), 
                        total_units_today: timePeriod === 'today' ? Math.round(periodUnits) : (electricityStats.total_units_today || 0),
                        total_cost: timePeriod === 'all' ? Math.round(periodCost) : (electricityStats.total_cost || 0),
                        total_cost_month: timePeriod === 'month' ? Math.round(periodCost) : (electricityStats.total_cost_month || 0),
                        total_cost_today: timePeriod === 'today' ? Math.round(periodCost) : (electricityStats.total_cost_today || 0),
                        latest_reading: timePeriod === 'all' ? latestReading : (electricityStats.latest_reading || 0),
                        latest_reading_month: timePeriod === 'month' ? latestReading : (electricityStats.latest_reading_month || 0),
                        latest_reading_today: timePeriod === 'today' ? latestReading : (electricityStats.latest_reading_today || 0)
                    },
                    dieselStats: {
                        total_units: timePeriod === 'all' ? Math.round(periodDieselUnits) : (dieselStats.total_units || 0),
                        total_units_month: timePeriod === 'month' ? Math.round(periodDieselUnits) : (dieselStats.total_units_month || 0),
                        total_units_today: timePeriod === 'today' ? Math.round(periodDieselUnits) : (dieselStats.total_units_today || 0),
                        total_kwh: timePeriod === 'all' ? Math.round(periodDieselKwh) : (dieselStats.total_kwh || 0),
                        total_kwh_month: timePeriod === 'month' ? Math.round(periodDieselKwh) : (dieselStats.total_kwh_month || 0),
                        total_kwh_today: timePeriod === 'today' ? Math.round(periodDieselKwh) : (dieselStats.total_kwh_today || 0),
                        total_litres: timePeriod === 'all' ? Math.round(periodDieselLitres) : (dieselStats.total_litres || 0),
                        total_litres_month: timePeriod === 'month' ? Math.round(periodDieselLitres) : (dieselStats.total_litres_month || 0),
                        total_litres_today: timePeriod === 'today' ? Math.round(periodDieselLitres) : (dieselStats.total_litres_today || 0)
                    },
                    vmsStats: { total_visitors: totalVisitors, checked_in: checkedInCount, checked_out: checkedOutCount },
                    vendorStats: { total_revenue: totalRev, total_commission: totalComm, total_vendors: vendorData?.total_vendors || 0 },
                    timestamp: Date.now()
                };

                setTicketStats(result.ticketStats);
                setRecentTickets(result.recentTickets);
                setChecklistStats(result.checklistStats);
                setElectricityStats(result.electricityStats);
                setDieselStats(result.dieselStats);
                setVmsStats(result.vmsStats);
                setVendorStats(result.vendorStats);
                setCachedData(fetchKey, result);

            } catch (err) {
                console.error('Error fetching property overview data:', err);
            } finally {
                setIsLoading(false);
            }
        };

        if (propertyId) fetchPropertyData(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propertyId, statsVersion, timePeriod, supabase]);

    // Open = tickets NOT closed (open, assigned, in_progress, waitlist)
    // Closed = tickets ARE closed (completed, closed, pending_validation)
    const closedCount = ticketStats.resolved;
    const openCount = ticketStats.total - closedCount;
    const completionRate = ticketStats.total > 0 ? Math.round((closedCount / ticketStats.total) * 100 * 10) / 10 : 0;
    const trulyClosedCount = ticketStats.resolved - ticketStats.pending_validation;

    // Animated Counters
    const animatedTotal = useCountUp(ticketStats.total);
    const animatedOpen = useCountUp(openCount);
    const animatedClosed = useCountUp(closedCount);
    const animatedPending = useCountUp(ticketStats.pending_validation);

    if (isLoading && ticketStats.total === 0) return (
        <div className="p-8 space-y-6">
            <div className="h-48 bg-slate-100 rounded-3xl animate-pulse p-8">
                <Skeleton className="w-1/3 h-8 mb-4" />
                <div className="grid grid-cols-3 gap-4">
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                <div className="md:col-span-3 space-y-4">
                    <Skeleton className="h-64" />
                    <Skeleton className="h-48" />
                </div>
                <div className="md:col-span-4">
                    <Skeleton className="h-[430px]" />
                </div>
                <div className="md:col-span-5 space-y-4">
                    <Skeleton className="h-64" />
                    <Skeleton className="h-48" />
                </div>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-background">
            {/* Header Section */}
            <div className="bg-[#708F96] px-2 lg:px-12 py-8 border-b border-white/10 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-y-3 mb-5">
                    <div className="flex items-center gap-3">
                        {/* Mobile Menu Toggle */}
                        <button
                            onClick={onMenuToggle}
                            className="p-2 -ml-2 lg:hidden text-white/70 hover:text-white transition-colors"
                        >
                            <Menu className="w-6 h-6" />
                        </button>
                        <h1 className="text-xl md:text-3xl font-black text-white">Unified Dashboard</h1>
                    </div>

                    <div className="flex items-center gap-2 md:gap-3">
                        {/* Global Time Period Filter — always visible, smaller on mobile */}
                        <div className="flex items-center bg-white/15 backdrop-blur-sm rounded-full p-0.5 md:p-1 border border-white/20 shadow-inner">
                            {([
                                { value: 'today', label: 'TODAY' },
                                { value: 'month', label: 'THIS MONTH' },
                                { value: 'all', label: 'ALL TIME' },
                            ] as const).map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => setTimePeriod(opt.value)}
                                    className={`px-2.5 md:px-4 py-1.5 text-[9px] md:text-[10px] font-black tracking-wider md:tracking-widest rounded-full transition-all whitespace-nowrap ${timePeriod === opt.value
                                        ? 'bg-yellow-400 text-slate-900 shadow-md'
                                        : 'text-white/80 hover:text-white'}`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        {/* Property Indicator / Switcher — icon + name + chevron pill */}
                        {property && (
                            <PropertySelectorDropdown
                                currentProperty={property}
                                assignedProperties={assignedProperties}
                                onSelectProperty={(id) => onPropertySwitch?.(id)}
                                variant="dark"
                            />
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 mb-5">
                    <span className="text-white text-sm font-bold">Dashboard / {property?.name || 'Property'}</span>
                </div>

                {/* KPI Cards Row — 4 insightful cards */}
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5 relative ${validationEnabled ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>

                    {/* Card 1 — Total Tickets */}
                    <motion.div
                        whileHover={{ y: -4, transition: { duration: 0.2 } }}
                        onClick={() => handleKPIClick('all')}
                        className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:shadow-md cursor-pointer hover:border-slate-300 transition-all group relative overflow-hidden"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">
                                Total Tickets {timePeriod === 'today' ? '(Today)' : timePeriod === 'month' ? '(This Month)' : '(All Time)'}
                            </span>
                            <div className="w-7 h-7 rounded-xl bg-slate-100 flex items-center justify-center">
                                <Ticket className="w-3.5 h-3.5 text-slate-500" />
                            </div>
                        </div>
                        <div className="flex items-baseline gap-2 mb-2">
                            <span className="text-4xl font-black text-slate-900">{animatedTotal}</span>
                            <span className="text-xs text-slate-400 font-bold">{completionRate}% resolved</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full mb-2 overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${Math.min(completionRate, 100)}%` }} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                            <span>{ticketStats.open + ticketStats.in_progress} open</span>
                            <span>{ticketStats.avg_resolution_hours > 0 ? `Avg ${ticketStats.avg_resolution_hours}h` : 'No data'}</span>
                        </div>
                    </motion.div>

                    {/* Card 2 — Open & Active */}
                    <motion.div
                        whileHover={{ y: -4, transition: { duration: 0.2 } }}
                        onClick={() => handleKPIClick('open,assigned,in_progress,blocked,waitlist')}
                        className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:shadow-md cursor-pointer hover:border-blue-200 transition-all group relative overflow-hidden"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-blue-500 transition-colors">Open & Active</span>
                            <div className={`w-7 h-7 rounded-xl flex items-center justify-center ${ticketStats.sla_breached > 0 ? 'bg-rose-50' : 'bg-blue-50'}`}>
                                <AlertCircle className={`w-3.5 h-3.5 ${ticketStats.sla_breached > 0 ? 'text-rose-500' : 'text-blue-500'}`} />
                            </div>
                        </div>
                        <div className="flex items-baseline gap-2 mb-2">
                            <span className="text-4xl font-black text-slate-900">{animatedOpen}</span>
                            {ticketStats.sla_breached > 0 && (
                                <span className="text-[10px] text-rose-500 font-black uppercase bg-rose-50 px-1.5 py-0.5 rounded-md">{ticketStats.sla_breached} SLA</span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2">

                            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                                {ticketStats.waitlist} Waitlist
                            </span>

                            {ticketStats.urgent_open > 0 && (
                                <span className="flex items-center gap-1 text-[10px] font-bold text-rose-500">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
                                    {ticketStats.urgent_open} High/Urgent
                                </span>
                            )}
                        </div>
                    </motion.div>

                    {/* Card 3 — Resolved & Closed */}
                    <motion.div
                        whileHover={{ y: -4, transition: { duration: 0.2 } }}
                        onClick={() => handleKPIClick('resolved,closed,pending_validation')}
                        className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:shadow-md cursor-pointer hover:border-emerald-200 transition-all group relative overflow-hidden"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-emerald-500 transition-colors">Resolved & Closed</span>
                            <div className="w-7 h-7 rounded-xl bg-emerald-50 flex items-center justify-center">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            </div>
                        </div>
                        <div className="flex items-baseline gap-2 mb-2">
                            <span className="text-4xl font-black text-slate-900">{animatedClosed}</span>
                            <span className="text-xs text-emerald-500 font-bold">{completionRate}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full mb-2 overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${Math.min(completionRate, 100)}%` }} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                            <span>
                                <span className="text-emerald-600">{trulyClosedCount} confirmed</span>
                                {ticketStats.pending_validation > 0 && <span className="text-amber-500"> · {ticketStats.pending_validation} awaiting</span>}
                            </span>
                            <span>{ticketStats.avg_resolution_hours > 0 ? `Avg ${ticketStats.avg_resolution_hours}h` : ''}</span>
                        </div>
                    </motion.div>

                    {/* Card 4 — Pending Validation (only if validation is enabled) */}
                    {validationEnabled && (
                        <motion.div
                            whileHover={{ y: -4, transition: { duration: 0.2 } }}
                            onClick={() => handleKPIClick('pending_validation')}
                            className={`bg-white rounded-2xl p-4 border shadow-sm hover:shadow-md cursor-pointer transition-all group relative overflow-hidden ${ticketStats.pending_validation > 0 ? 'border-amber-200 hover:border-amber-300' : 'border-slate-100 hover:border-slate-200'}`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-amber-500 transition-colors">Needs Review</span>
                                <div className={`w-7 h-7 rounded-xl flex items-center justify-center ${ticketStats.pending_validation > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
                                    <Clock className={`w-3.5 h-3.5 ${ticketStats.pending_validation > 0 ? 'text-amber-500' : 'text-emerald-500'}`} />
                                </div>
                            </div>
                            <div className="flex items-baseline gap-2 mb-2">
                                <span className={`text-4xl font-black ${ticketStats.pending_validation > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                                    {animatedPending}
                                </span>
                                {ticketStats.pending_validation === 0 ? (
                                    <span className="text-[10px] text-emerald-500 font-black">All clear ✓</span>
                                ) : (
                                    <span className="text-[10px] text-amber-500 font-black bg-amber-50 px-1.5 py-0.5 rounded-md">Needs action</span>
                                )}
                            </div>
                            <div className="text-[10px] font-bold text-slate-400 leading-relaxed">
                                {ticketStats.pending_validation > 0
                                    ? <span className="text-amber-600">Awaiting tenant sign-off</span>
                                    : <span className="text-emerald-600">All resolved tickets confirmed</span>
                                }
                            </div>
                        </motion.div>
                    )}
                </div>
            </div>


            {/* Main Content Grid */}
            <div className="px-2 lg:px-12 py-5 space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    {/* Left Column */}
                    <div className="lg:col-span-3 space-y-5">
                        <div
                            className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm hover:shadow-md hover:border-yellow-300/50 transition-all group relative overflow-hidden"
                        >
                            <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-sm font-black text-slate-900">Electricity</h3>
                            </div>
                            <div className="text-yellow-600 text-xs font-bold mb-4 flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full animate-pulse ${timePeriod === 'all' ? 'bg-slate-400' : timePeriod === 'today' ? 'bg-blue-400' : 'bg-yellow-500'}`} />
                                {timePeriod === 'today' ? 'Today' : timePeriod === 'month' ? 'This Month' : 'All Time'}
                            </div>
                            <div className="flex justify-center my-4" onClick={() => onTabChange('electricity_analytics' as any)}>
                                <div className="relative w-[140px] h-[140px] cursor-pointer">
                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                                        <circle cx="60" cy="60" r="52" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                                        <circle
                                            cx="60" cy="60" r="52" fill="none"
                                            stroke="url(#propElecGrad)" strokeWidth="10" strokeLinecap="round"
                                            strokeDasharray={`${Math.min(326, (((timePeriod === 'today' ? electricityStats.total_units_today : timePeriod === 'month' ? electricityStats.total_units_month : electricityStats.total_units) || 0) / (timePeriod === 'today' ? 100 : 1000)) * 326)} 326`}
                                        />
                                        <defs>
                                            <linearGradient id="propElecGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stopColor="#facc15" />
                                                <stop offset="100%" stopColor="#f59e0b" />
                                            </linearGradient>
                                        </defs>
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <Zap className="w-5 h-5 text-yellow-500 mb-1" />
                                        <span className="text-xl font-black text-slate-900">
                                            {(timePeriod === 'today' ? electricityStats.total_units_today : timePeriod === 'month' ? electricityStats.total_units_month : electricityStats.total_units || 0).toLocaleString()}
                                        </span>
                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">kWh</span>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-1" onClick={() => onTabChange('electricity_analytics' as any)}>
                                <div className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Main Meter Consumed</div>
                                <div className="text-3xl font-black text-slate-900 flex items-baseline gap-1">
                                    {(timePeriod === 'today' ? electricityStats.total_units_today : timePeriod === 'month' ? electricityStats.total_units_month : electricityStats.total_units || 0).toLocaleString()}
                                    <span className="text-sm text-slate-400 font-bold">kWh</span>
                                </div>
                                <div className="text-sm font-bold text-slate-600">
                                    ₹{(timePeriod === 'today' ? electricityStats.total_cost_today : timePeriod === 'month' ? electricityStats.total_cost_month : electricityStats.total_cost)?.toLocaleString()}
                                </div>
                                <div className="pt-2 border-t border-slate-50 mt-2">
                                    <span className="text-[10px] font-bold text-yellow-600 uppercase group-hover:underline cursor-pointer">View Analytics →</span>
                                </div>
                            </div>
                        </div>
                        
                        {/* DG Consumption Tile */}
                        <div
                            className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm hover:shadow-md hover:border-amber-300/50 transition-all group relative overflow-hidden cursor-pointer"
                            onClick={() => onTabChange('diesel_analytics' as any)}
                        >
                            <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-sm font-black text-slate-900">DG Consumption</h3>
                            </div>
                            <div className="text-amber-600 text-xs font-bold mb-4 flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full animate-pulse ${timePeriod === 'all' ? 'bg-slate-400' : timePeriod === 'today' ? 'bg-amber-400' : 'bg-amber-500'}`} />
                                {timePeriod === 'today' ? 'Today' : timePeriod === 'month' ? 'This Month' : 'All Time'}
                            </div>
                            <div className="space-y-1">
                                <div className="text-slate-400 text-[10px] font-black uppercase tracking-widest">
                                    {(timePeriod === 'today' ? dieselStats.total_litres_today : timePeriod === 'month' ? dieselStats.total_litres_month : dieselStats.total_litres) === 0 && (timePeriod === 'today' ? dieselStats.total_kwh_today : timePeriod === 'month' ? dieselStats.total_kwh_month : dieselStats.total_kwh) > 0 ? 'kWh' : 'Litres'} Consumed
                                </div>
                                <div className="text-3xl font-black text-slate-900 flex items-baseline gap-1">
                                    {(Number(timePeriod === 'today' ? dieselStats?.total_units_today : timePeriod === 'month' ? dieselStats?.total_units_month : dieselStats?.total_units) || 0).toLocaleString()}
                                    <span className="text-sm text-slate-400 font-bold">
                                        {(timePeriod === 'today' ? dieselStats?.total_litres_today : timePeriod === 'month' ? dieselStats?.total_litres_month : dieselStats?.total_litres) === 0 && (timePeriod === 'today' ? dieselStats?.total_kwh_today : timePeriod === 'month' ? dieselStats?.total_kwh_month : dieselStats?.total_kwh) > 0 ? 'kWh' : 'Litres'}
                                    </span>
                                </div>
                                <div className="pt-2 border-t border-slate-50 mt-2">
                                    <span className="text-[10px] font-bold text-amber-600 uppercase group-hover:underline cursor-pointer">View Analytics →</span>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm">
                            <h3 className="text-sm font-black text-slate-900 mb-2">Vendor Revenue</h3>
                            <div className="text-slate-400 text-xs font-bold mb-2">{timePeriod === 'today' ? 'Today' : timePeriod === 'month' ? 'This Month' : 'All Time'}</div>
                            <div className="text-3xl font-black text-slate-900">₹ {(Number(vendorStats?.total_revenue) || 0).toLocaleString()}</div>
                            <div className="text-xs text-slate-500 mt-2">Commission: ₹ {(Number(vendorStats?.total_commission) || 0).toLocaleString()} from {vendorStats?.total_vendors || 0} vendors</div>
                        </div>
                    </div>

                    {/* Center Column - Property Card */}
                    <div className="lg:col-span-4">
                        <div className="bg-yellow-400 rounded-3xl p-5 h-full relative overflow-hidden">
                            <h3 className="text-2xl font-black text-slate-900 mb-2 truncate">{property?.name || 'Property'}</h3>
                            <div className="text-red-600 text-sm font-bold mb-5 truncate">Property: {property?.code || 'N/A'}</div>
                            <div className="bg-yellow-500/50 rounded-[2rem] h-56 mb-5 flex items-center justify-center overflow-hidden border-4 border-white/30 shadow-2xl group relative">
                                {property?.image_url ? (
                                    <>
                                        <Image
                                            src={property.image_url}
                                            alt={property.name}
                                            fill
                                            className="object-cover transition-transform duration-700 group-hover:scale-110"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-yellow-400/20 to-transparent" />
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center gap-2"><Building2 className="w-20 h-20 text-yellow-600/30" /><span className="text-[10px] font-black text-yellow-700/40 uppercase tracking-widest">Awaiting Visuals</span></div>
                                )}
                            </div>
                            <div className="space-y-4">
                                <div><div className="text-slate-700 text-xs font-bold">Visitors {timePeriod === 'today' ? 'Today' : timePeriod === 'month' ? 'This Month' : 'All Time'}</div><div className="text-2xl font-black text-slate-900">{vmsStats.total_visitors}</div></div>
                                <div><div className="text-slate-700 text-xs font-bold">Checked In / Out</div><div className="text-2xl font-black text-slate-900">{vmsStats.checked_in} / {vmsStats.checked_out}</div></div>
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-5 space-y-5">
                        <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex flex-col">
                            <h3 className="text-sm font-black text-slate-900 mb-4">Recent Tickets & Checklists</h3>
                            
                            {/* Checklist Progress Bar */}
                            <div 
                                onClick={() => onTabChange('checklist')}
                                className="mb-6 p-4 rounded-xl bg-slate-50 border border-slate-100 cursor-pointer hover:border-emerald-500/30 transition-colors group flex flex-col gap-4"
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <ClipboardCheck className="w-4 h-4 text-emerald-500" />
                                        <span className="text-xs font-bold text-slate-700 group-hover:text-emerald-600 transition-colors">Checklist Progress</span>
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-400">
                                        {timePeriod === 'today' ? 'Today' : timePeriod === 'month' ? 'This Month' : 'All Time'}
                                    </span>
                                </div>
                                
                                <div className="space-y-3">
                                    {/* Day Shift */}
                                    {(checklistStats.day_total > 0 || checklistStats.total === 0) && (
                                        <div>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                                                    <Sun className="w-3 h-3" /> Day Shift
                                                </span>
                                                <span className="text-[10px] font-black text-amber-600">
                                                    {checklistStats.day_total > 0 ? Math.round((checklistStats.day_completed / checklistStats.day_total) * 100) : 0}%
                                                </span>
                                            </div>
                                            <div className="w-full bg-amber-100/50 rounded-full h-1.5 overflow-hidden mb-1">
                                                <div 
                                                    className="bg-amber-500 h-1.5 rounded-full transition-all duration-1000" 
                                                    style={{ width: `${checklistStats.day_total > 0 ? (checklistStats.day_completed / checklistStats.day_total) * 100 : 0}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-[9px] font-bold text-slate-400">{checklistStats.day_completed} of {checklistStats.day_total} completed</span>
                                                {checklistStats.total === 0 && <span className="text-[9px] font-bold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">View History &rarr;</span>}
                                            </div>
                                        </div>
                                    )}

                                    {/* Night Shift */}
                                    {checklistStats.night_total > 0 && (
                                        <div>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className="text-[10px] font-bold text-indigo-600 flex items-center gap-1">
                                                    <Moon className="w-3 h-3" /> Night Shift
                                                </span>
                                                <span className="text-[10px] font-black text-indigo-600">
                                                    {checklistStats.night_total > 0 ? Math.round((checklistStats.night_completed / checklistStats.night_total) * 100) : 0}%
                                                </span>
                                            </div>
                                            <div className="w-full bg-indigo-100/50 rounded-full h-1.5 overflow-hidden mb-1">
                                                <div 
                                                    className="bg-indigo-500 h-1.5 rounded-full transition-all duration-1000" 
                                                    style={{ width: `${checklistStats.night_total > 0 ? (checklistStats.night_completed / checklistStats.night_total) * 100 : 0}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-[9px] font-bold text-slate-400">{checklistStats.night_completed} of {checklistStats.night_total} completed</span>
                                                {checklistStats.total > 0 && <span className="text-[9px] font-bold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">View History &rarr;</span>}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                                {recentTickets.map((t, idx) => (
                                    <div key={t.id || idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                        <div>
                                            <div className="font-bold text-slate-900 text-sm truncate max-w-[200px]">{t.title}</div>
                                            <div className="flex items-center gap-2">
                                                <div className="text-xs text-slate-500 capitalize">{t.status?.replace('_', ' ')}</div>
                                            </div>
                                        </div>
                                        <div className="text-right"><div className="text-xs text-slate-400">{new Date(t.created_at).toLocaleDateString()}</div></div>
                                    </div>
                                ))}
                                {recentTickets.length === 0 && <div className="text-center text-slate-400 py-4">No recent tickets.</div>}
                            </div>
                        </div>
                        <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm">
                            <h3 className="text-sm font-black text-slate-900 mb-4">Module Summary</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-blue-50 rounded-xl"><div className="text-xs font-bold text-blue-600 mb-1">Tickets</div><div className="text-2xl font-black text-blue-900">{ticketStats.total}</div></div>
                                <div className="p-4 bg-emerald-50 rounded-xl">
                                    <div className="text-xs font-bold text-emerald-600 mb-1">Visitors ({timePeriod === 'today' ? 'Today' : timePeriod === 'month' ? 'Month' : 'All'})</div>
                                    <div className="text-2xl font-black text-emerald-900">{vmsStats.total_visitors}</div>
                                </div>
                                <div className="p-4 bg-yellow-50 rounded-xl"><div className="text-xs font-bold text-yellow-600 mb-1">Electricity ({timePeriod === 'today' ? 'Today' : timePeriod === 'month' ? 'Month' : 'All'})</div><div className="text-2xl font-black text-slate-900">{(Number(timePeriod === 'today' ? electricityStats?.total_units_today : timePeriod === 'month' ? electricityStats?.total_units_month : electricityStats?.total_units) || 0).toLocaleString()}</div></div>
                                <div className="p-4 bg-purple-50 rounded-xl">
                                    <div className="text-xs font-bold text-purple-600 mb-1">Vendor Revenue ({timePeriod === 'today' ? 'Today' : timePeriod === 'month' ? 'Month' : 'All'})</div>
                                    <div className="text-2xl font-black text-purple-900">₹{(Number(vendorStats?.total_revenue) || 0).toLocaleString()}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
});

// Helper to format time ago
const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (mins > 0) return `${mins}m ago`;
    return 'Just now';
};

const StatCard = ({ title, value, icon: Icon, color, bg, breakdown }: any) => (
    <div className="bg-white p-6 rounded-3xl border border-border shadow-sm">
        {Icon && (
            <div className={`w-12 h-12 ${bg} ${color} rounded-2xl flex items-center justify-center mb-4`}>
                <Icon className="w-6 h-6" />
            </div>
        )}
        <h3 className="text-text-tertiary font-bold text-xs uppercase tracking-widest mb-1">{title}</h3>
        <p className="text-3xl font-black text-text-primary">{value}</p>
        {breakdown && breakdown.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border space-y-1.5">
                {breakdown.map((b: any) => (
                    <div key={b.label} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-text-tertiary font-medium truncate">{b.label}</span>
                        <span className="text-text-secondary font-bold shrink-0">{b.value}</span>
                    </div>
                ))}
            </div>
        )}
    </div>
);

const ActivityItem = ({ icon: Icon, color, title, desc, time, onClick }: any) => (
    <div
        className={`flex gap-4 p-2 rounded-xl transition-all ${onClick ? 'cursor-pointer hover:bg-muted' : ''}`}
        onClick={onClick}
    >
        <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center shrink-0`}>
            <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
            <h4 className="text-sm font-bold text-text-primary">{title}</h4>
            <p className="text-xs text-text-secondary">{desc}</p>
        </div>
        <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-tighter">{time}</span>
    </div>
);

const InspectionItem = ({ date, unit, status }: any) => (
    <div className="flex items-center justify-between p-4 bg-surface-elevated rounded-2xl border border-border">
        <div className="flex items-center gap-4">
            <div className="bg-white w-12 py-2 rounded-xl text-center border border-border">
                <span className="block text-[8px] font-black text-text-tertiary uppercase tracking-tighter">Jan</span>
                <span className="block font-black text-sm text-text-primary leading-none">{date.split(' ')[1]}</span>
            </div>
            <div>
                <p className="font-bold text-text-primary text-sm">{unit}</p>
                <p className="text-[10px] text-text-tertiary font-bold uppercase tracking-widest">{status}</p>
            </div>
        </div>
        <ChevronRight className="w-4 h-4 text-text-tertiary" />
    </div>
);

const VendorRevenueTab = memo(function VendorRevenueTab({ propertyId }: { propertyId: string }) {
    const [vendors, setVendors] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showExportModal, setShowExportModal] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    
    // Range Filters State
    const [rangeMode, setRangeMode] = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('month');
    const [startDate, setStartDate] = useState<string>(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    });
    const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
    const [expandedVendorId, setExpandedVendorId] = useState<string | null>(null);

    // Toast state
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; visible: boolean }>({
        message: '',
        type: 'success',
        visible: false,
    });

    // CRUD State
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [vendorToEdit, setVendorToEdit] = useState<any | null>(null);

    const supabase = useMemo(() => createClient(), []);
    const hasFetched = useRef(false);

    useEffect(() => {
        if (!hasFetched.current) {
            hasFetched.current = true;
            fetchVendors();
        }
    }, [propertyId]);

    const fetchVendors = async () => {
        setIsLoading(true);
        try {
            // Fetch food vendors and all their daily revenue entries via API route
            const res = await fetch(`/api/properties/${propertyId}/vendors`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to fetch vendors');
            }
            const data = await res.json();
            setVendors(data || []);
        } catch (err: any) {
            console.error('Error fetching vendors:', err.message || err);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePresetChange = (mode: 'today' | 'yesterday' | 'week' | 'month' | 'custom') => {
        setRangeMode(mode);
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        if (mode === 'today') {
            setStartDate(todayStr);
            setEndDate(todayStr);
        } else if (mode === 'yesterday') {
            const y = new Date(today);
            y.setDate(y.getDate() - 1);
            const yStr = y.toISOString().split('T')[0];
            setStartDate(yStr);
            setEndDate(yStr);
        } else if (mode === 'week') {
            const w = new Date(today);
            w.setDate(w.getDate() - 6);
            setStartDate(w.toISOString().split('T')[0]);
            setEndDate(todayStr);
        } else if (mode === 'month') {
            const mStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
            setStartDate(mStr);
            setEndDate(todayStr);
        }
    };

    const handleExport = async (options: any) => {
        setIsExporting(true);
        try {
            const params = new URLSearchParams({ format: options.format });

            if (options.period === 'today') {
                const today = new Date().toISOString().split('T')[0];
                params.append('startDate', today);
                params.append('endDate', today);
            } else if (options.period === 'month') {
                const d = new Date();
                params.append('startDate', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
                params.append('endDate', new Date().toISOString().split('T')[0]);
            } else if (options.period === 'year') {
                const yearStart = new Date();
                yearStart.setMonth(0, 1);
                params.append('startDate', yearStart.toISOString().split('T')[0]);
                params.append('endDate', new Date().toISOString().split('T')[0]);
            } else if (options.startDate && options.endDate) {
                params.append('startDate', options.startDate);
                params.append('endDate', options.endDate);
            } else {
                params.append('startDate', startDate);
                params.append('endDate', endDate);
            }

            const response = await fetch(`/api/properties/${propertyId}/vendor-export?${params}`);

            if (!response.ok) throw new Error('Export failed');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vendor_revenue_export.${options.format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            setShowExportModal(false);
        } catch (err) {
            console.error('Export error:', err);
            alert('Export failed. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    // Helper: filter entries within selected range
    const getVendorEntriesInRange = (vendor: any) => {
        return (vendor.vendor_daily_revenue || []).filter((r: any) => {
            const dateVal = r.revenue_date || r.entry_date;
            return dateVal >= startDate && dateVal <= endDate;
        }).sort((a: any, b: any) => {
            const dA = a.revenue_date || a.entry_date || '';
            const dB = b.revenue_date || b.entry_date || '';
            return dB.localeCompare(dA);
        });
    };

    const totalRevenue = vendors.reduce((acc, v) => {
        const entries = getVendorEntriesInRange(v);
        const vSum = entries.reduce((sum: number, r: any) => sum + (Number(r.revenue_amount) || 0), 0);
        return acc + vSum;
    }, 0);

    const totalCommission = vendors.reduce((acc, v) => {
        const entries = getVendorEntriesInRange(v);
        const vSum = entries.reduce((sum: number, r: any) => sum + (Number(r.revenue_amount) || 0), 0);
        return acc + (vSum * ((v.commission_rate || 0) / 100));
    }, 0);

    const totalEntriesLogged = vendors.reduce((acc, v) => {
        return acc + getVendorEntriesInRange(v).length;
    }, 0);

    const revenueBreakdown = vendors
        .map((v) => {
            const entries = getVendorEntriesInRange(v);
            const revenue = entries.reduce((sum: number, r: any) => sum + (Number(r.revenue_amount) || 0), 0);
            return { label: v.shop_name, revenue, commission: revenue * ((v.commission_rate || 0) / 100) };
        })
        .filter((b) => b.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue);

    const perVendorRevenue = revenueBreakdown.map((b) => ({ label: b.label, value: `₹${b.revenue.toLocaleString('en-IN')}` }));
    const perVendorCommission = revenueBreakdown.map((b) => ({ label: b.label, value: `₹${Math.round(b.commission).toLocaleString('en-IN')}` }));

    const isSingleDay = startDate === endDate;

    if (isLoading) return <div className="p-12 text-center text-slate-400 font-bold">Loading Revenue Data...</div>;

    return (
        <div className="space-y-8">
            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard
                    title={`Total Revenue (${isSingleDay ? startDate : `${startDate} to ${endDate}`})`}
                    value={`₹${totalRevenue.toLocaleString('en-IN')}`}
                    icon={IndianRupee}
                    color="text-blue-600"
                    bg="bg-blue-50"
                    breakdown={perVendorRevenue}
                />
                <StatCard
                    title="Total Commission"
                    value={`₹${Math.round(totalCommission).toLocaleString('en-IN')}`}
                    icon={Calendar}
                    color="text-emerald-600"
                    bg="bg-emerald-50"
                    breakdown={perVendorCommission}
                />
                <StatCard
                    title="Logged Daily Entries"
                    value={totalEntriesLogged.toString()}
                    icon={Clock}
                    color="text-amber-600"
                    bg="bg-amber-50"
                />
                <StatCard
                    title="Active Vendors"
                    value={vendors.length.toString()}
                    icon={Store}
                    color="text-indigo-600"
                    bg="bg-indigo-50"
                />
            </div>

            {/* Table Container */}
            <div className="bg-white border border-border rounded-3xl overflow-hidden shadow-sm">
                <div className="p-6 sm:p-8 border-b border-border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white">
                    <div>
                        <h3 className="text-xl font-bold text-text-primary">Cafeteria Performance</h3>
                        {/* Range Selection Controls */}
                        <div className="flex flex-wrap items-center gap-3 mt-3">
                            <span className="text-xs text-text-secondary font-medium">Filter Range:</span>
                            <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-[#161b22] p-1 rounded-lg border border-slate-200 dark:border-[#30363d]">
                                {(['month', 'week', 'today', 'yesterday', 'custom'] as const).map((m) => (
                                    <button
                                        key={m}
                                        onClick={() => handlePresetChange(m)}
                                        className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all capitalize ${
                                            rangeMode === m
                                                ? 'bg-white dark:bg-[#30363d] shadow-sm text-indigo-600 dark:text-indigo-400'
                                                : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                    >
                                        {m === 'month' ? 'This Month' : m === 'week' ? 'Last 7 Days' : m}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-2">
                                <input 
                                    type="date" 
                                    value={startDate}
                                    onChange={(e) => {
                                        setRangeMode('custom');
                                        setStartDate(e.target.value);
                                    }}
                                    className="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                />
                                <span className="text-xs text-slate-400 font-bold">to</span>
                                <input 
                                    type="date" 
                                    value={endDate}
                                    onChange={(e) => {
                                        setRangeMode('custom');
                                        setEndDate(e.target.value);
                                    }}
                                    className="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <button
                            onClick={() => {
                                setVendorToEdit(null);
                                setIsManageModalOpen(true);
                            }}
                            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-black hover:opacity-90 transition-all shadow-lg shadow-indigo-600/20"
                        >
                            <Plus className="w-4 h-4" /> Add Vendor
                        </button>
                        <button
                            onClick={() => setShowExportModal(true)}
                            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-text-inverse rounded-xl text-sm font-black hover:opacity-90 transition-all shadow-lg shadow-primary/20"
                        >
                            <FileDown className="w-4 h-4" /> Export
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-surface-elevated border-b border-border">
                            <tr>
                                <th className="px-6 py-4 text-[10px] font-black text-text-tertiary uppercase tracking-widest">Vendor / Shop</th>
                                <th className="px-6 py-4 text-[10px] font-black text-text-tertiary uppercase tracking-widest text-center">Commission %</th>
                                <th className="px-6 py-4 text-[10px] font-black text-text-tertiary uppercase tracking-widest text-right">Range Revenue</th>
                                <th className="px-6 py-4 text-[10px] font-black text-text-tertiary uppercase tracking-widest text-right">Commission Due</th>
                                <th className="px-6 py-4 text-[10px] font-black text-text-tertiary uppercase tracking-widest text-center">Logs / Status</th>
                                <th className="px-6 py-4 text-[10px] font-black text-text-tertiary uppercase tracking-widest text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {vendors.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-8 py-12 text-center text-slate-400 italic">No vendors found for this property.</td>
                                </tr>
                            ) : (
                                vendors.map((vendor) => {
                                    const entriesInRange = getVendorEntriesInRange(vendor);
                                    const periodRevenue = entriesInRange.reduce((sum: number, r: any) => sum + (Number(r.revenue_amount) || 0), 0);
                                    const commission = (periodRevenue * ((vendor.commission_rate || 0) / 100)).toFixed(2);
                                    const isExpanded = expandedVendorId === vendor.id;

                                    return (
                                        <React.Fragment key={vendor.id}>
                                            <tr className="hover:bg-slate-50/50 transition-all">
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            onClick={() => setExpandedVendorId(isExpanded ? null : vendor.id)}
                                                            className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                                                            title="Toggle daily revenue breakdown"
                                                        >
                                                            {isExpanded ? <ChevronUp className="w-4 h-4 text-indigo-600" /> : <ChevronDown className="w-4 h-4" />}
                                                        </button>
                                                        <div>
                                                            <p className="font-black text-slate-900 text-sm">{vendor.shop_name}</p>
                                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{vendor.owner_name}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5 text-center">
                                                    <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border border-blue-100">
                                                        {vendor.commission_rate}%
                                                    </span>
                                                </td>
                                                <td className="px-6 py-5 text-right">
                                                    <p className={`font-black text-sm ${periodRevenue > 0 ? 'text-slate-900' : 'text-slate-300'}`}>
                                                        ₹{periodRevenue.toLocaleString('en-IN')}
                                                    </p>
                                                </td>
                                                <td className="px-6 py-5 text-right text-emerald-600 font-black text-sm">
                                                    ₹{Number(commission).toLocaleString('en-IN')}
                                                </td>
                                                <td className="px-6 py-5 text-center">
                                                    <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${entriesInRange.length > 0
                                                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                                        : 'bg-amber-50 text-amber-600 border-amber-100'
                                                        }`}>
                                                        {isSingleDay
                                                            ? (entriesInRange.length > 0 ? 'Submitted' : 'Pending')
                                                            : `${entriesInRange.length} day${entriesInRange.length === 1 ? '' : 's'} logged`}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-5 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => setExpandedVendorId(isExpanded ? null : vendor.id)}
                                                            className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all ${isExpanded ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
                                                        >
                                                            {isExpanded ? 'Hide Logs' : 'View Logs'}
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setVendorToEdit(vendor);
                                                                setIsManageModalOpen(true);
                                                            }}
                                                            className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-lg transition-colors"
                                                            title="Vendor Settings"
                                                        >
                                                            <Settings className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={async () => {
                                                                if (confirm(`Are you sure you want to delete "${vendor.shop_name}"? This cannot be undone.`)) {
                                                                    try {
                                                                        const res = await fetch(`/api/properties/${propertyId}/vendors?id=${vendor.id}`, { method: 'DELETE' });
                                                                        if (res.ok) {
                                                                            setToast({ message: `Vendor "${vendor.shop_name}" deleted successfully!`, type: 'success', visible: true });
                                                                            fetchVendors();
                                                                        } else {
                                                                            const errData = await res.json().catch(() => ({}));
                                                                            setToast({ message: errData.error || 'Failed to delete vendor', type: 'error', visible: true });
                                                                        }
                                                                    } catch (e: any) {
                                                                        console.error(e);
                                                                        setToast({ message: e.message || 'Failed to delete vendor', type: 'error', visible: true });
                                                                    }
                                                                }
                                                            }}
                                                            className="p-2 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
                                                            title="Delete Vendor"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>

                                            {/* Expandable Daily Revenue Breakdown Sub-Table */}
                                            {isExpanded && (
                                                <tr className="bg-indigo-50/30">
                                                    <td colSpan={6} className="px-8 py-4">
                                                        <div className="bg-white border border-indigo-100 rounded-2xl p-5 shadow-sm">
                                                            <div className="flex items-center justify-between mb-3">
                                                                <h4 className="text-xs font-black uppercase text-indigo-700 tracking-wider">
                                                                    Daily Logs Breakdown: {vendor.shop_name} ({startDate} to {endDate})
                                                                </h4>
                                                                <span className="text-[11px] font-bold text-slate-500">
                                                                    {entriesInRange.length} record{entriesInRange.length === 1 ? '' : 's'} found
                                                                </span>
                                                            </div>
                                                            {entriesInRange.length === 0 ? (
                                                                <p className="text-xs text-slate-400 italic py-2">No daily revenue entries recorded for this selected date range.</p>
                                                            ) : (
                                                                <table className="w-full text-xs text-left border-collapse">
                                                                    <thead>
                                                                        <tr className="border-b border-slate-100 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                                                                            <th className="py-2">Date</th>
                                                                            <th className="py-2 text-right">Daily Revenue</th>
                                                                            <th className="py-2 text-right">Commission ({vendor.commission_rate}%)</th>
                                                                            <th className="py-2 pl-6">Entry Status</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-100">
                                                                        {entriesInRange.map((entry: any) => {
                                                                            const dRev = Number(entry.revenue_amount) || 0;
                                                                            const dComm = (dRev * ((vendor.commission_rate || 0) / 100)).toFixed(2);
                                                                            const entryDate = entry.revenue_date || entry.entry_date;
                                                                            return (
                                                                                <tr key={entry.id || entryDate} className="hover:bg-slate-50">
                                                                                    <td className="py-2.5 font-bold text-slate-800">
                                                                                        {new Date(entryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                                                    </td>
                                                                                    <td className="py-2.5 text-right font-black text-slate-900">
                                                                                        ₹{dRev.toLocaleString('en-IN')}
                                                                                    </td>
                                                                                    <td className="py-2.5 text-right font-black text-emerald-600">
                                                                                        ₹{Number(dComm).toLocaleString('en-IN')}
                                                                                    </td>
                                                                                    <td className="py-2.5 pl-6 text-slate-500 font-medium">
                                                                                        {dRev > 0 ? (
                                                                                            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">Logged</span>
                                                                                        ) : (
                                                                                            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">₹0 Logged</span>
                                                                                        )}
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <VendorExportModal
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                onExport={handleExport}
                isExporting={isExporting}
            />

            <VendorManagementModal
                isOpen={isManageModalOpen}
                onClose={() => setIsManageModalOpen(false)}
                propertyId={propertyId}
                vendorToEdit={vendorToEdit}
                onSuccess={() => fetchVendors()}
            />

            <Toast
                visible={toast.visible}
                message={toast.message}
                type={toast.type}
                onClose={() => setToast(prev => ({ ...prev, visible: false }))}
            />
        </div>
    );
});

export default PropertyAdminDashboard;
