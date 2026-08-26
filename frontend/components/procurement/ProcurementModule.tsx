'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { 
    Settings, List, ShoppingCart, 
    FileText, FileSpreadsheet,
    DollarSign, IndianRupee, Layers,
    Sparkles, RefreshCw
} from 'lucide-react';
import ProcurementAdminSettings from './ProcurementAdminSettings';
import ProcurementRequestList from './ProcurementRequestList';
import ProcurementPOProcessor from './ProcurementPOProcessor';
import ProcurementCatalogModal from './ProcurementCatalogModal';
import MonthlyRequisitionsTab from './MonthlyRequisitionsTab';
import SitePricingAdminTab from './SitePricingAdminTab';
import PropertyBudgetsTab from './PropertyBudgetsTab';
import PaymentUrgencyTrackerTab from './payment-urgency/PaymentUrgencyTrackerTab';
import { useAuth } from '@/frontend/context/AuthContext';

type TabType = 'orders' | 'urgency-tracker' | 'requisitions' | 'site-budgets' | 'site-pricing' | 'catalog' | 'po-generator' | 'settings';

function ProcurementModuleSkeleton() {
    return (
        <div className="space-y-6 animate-pulse">
            {/* Header / Tabs skeleton */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {[120, 160, 150, 130, 140, 150].map((w, i) => (
                    <div key={i} className="h-10 bg-slate-200 dark:bg-slate-800 rounded-xl shrink-0" style={{ width: `${w}px` }} />
                ))}
            </div>

            {/* Content Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                    <div className="h-14 bg-slate-200 dark:bg-slate-800 rounded-2xl w-full" />
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800/60 rounded-3xl p-4 space-y-3 border border-slate-200/50">
                            <div className="flex justify-between items-center">
                                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-md w-28" />
                                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-md w-20" />
                            </div>
                            <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded-md w-3/4" />
                            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-md w-1/2" />
                        </div>
                    ))}
                </div>
                <div className="hidden lg:block lg:col-span-1">
                    <div className="h-[420px] bg-slate-100 dark:bg-slate-800/60 rounded-3xl border border-slate-200/50 p-6 space-y-4">
                        <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded-md w-1/3" />
                        <div className="h-20 bg-slate-200 dark:bg-slate-700 rounded-2xl" />
                        <div className="h-20 bg-slate-200 dark:bg-slate-700 rounded-2xl" />
                        <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded-xl" />
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ProcurementModule({ 
    orgId: propOrgId, 
    isAdmin: propIsAdmin, 
    properties: propProperties 
}: { 
    orgId?: string; 
    isAdmin?: boolean; 
    properties?: any[];
}) {
    const params = useParams();
    const orgId = propOrgId || (params?.orgId as string) || '';
    const propertyId = (params?.propertyId as string) || '';
    const { user, membership } = useAuth();
    
    const [activeTab, setActiveTab] = useState<TabType>('orders');
    const [properties, setProperties] = useState<any[]>(propProperties || []);
    const [isInitialLoading, setIsInitialLoading] = useState(!propProperties || propProperties.length === 0);
    const [counts, setCounts] = useState({ orders: 0, pending_quotation: 0 });
    const isMountedRef = useRef(false);

    // Robust Role Hierarchy
    const userRole = (membership?.org_role || (user?.user_metadata?.role as string) || '').toLowerCase();
    const isMasterAdmin = Boolean(membership?.is_master_admin || userRole === 'master_admin');
    const isSuperAdmin = isMasterAdmin || userRole === 'org_super_admin' || userRole === 'owner' || propIsAdmin === true;
    const isProcurementUser = isSuperAdmin || userRole.includes('procurement') || userRole === 'org_admin';
    const canManageCatalogAndPricing = isSuperAdmin || isProcurementUser;
    const canViewUrgencyTracker = isSuperAdmin || isProcurementUser;

    const fetchProperties = useCallback(async () => {
        if (!orgId) return;
        try {
            const res = await fetch(`/api/properties?organization_id=${orgId}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    setProperties(data);
                }
            }
        } catch (err) {
            console.error('Failed to fetch properties:', err);
        }
    }, [orgId]);

    const fetchCounts = useCallback(async () => {
        if (!orgId) return;
        try {
            let ordersUrl = `/api/procurement/requests?organizationId=${orgId}`;
            if (propertyId) ordersUrl += `&propertyId=${propertyId}`;
            const ordersRes = await fetch(ordersUrl);
            if (ordersRes.ok) {
                const ordersData = await ordersRes.json();
                const allOrders = Array.isArray(ordersData) ? ordersData : [];
                setCounts({
                    orders: allOrders.length,
                    pending_quotation: allOrders.filter((r: any) => r.status === 'pending_quotation').length
                });
            }
        } catch (err) {
            console.error('Failed to fetch counts:', err);
        }
    }, [orgId, propertyId]);

    // Initial Load - runs only once on mount or when orgId changes
    useEffect(() => {
        let isCurrent = true;
        const loadInitialData = async () => {
            if (!propProperties || propProperties.length === 0) {
                await fetchProperties();
            } else {
                setProperties(propProperties);
            }
            await fetchCounts();
            if (isCurrent) {
                setIsInitialLoading(false);
            }
        };

        loadInitialData();
        return () => {
            isCurrent = false;
        };
    }, [orgId, fetchProperties, fetchCounts]);

    // Sync properties when passed from parent without full reload
    useEffect(() => {
        if (propProperties && propProperties.length > 0) {
            setProperties(propProperties);
        }
    }, [propProperties]);

    // Tab URL sync
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            const tabParam = urlParams.get('procurement_tab') || urlParams.get('subtab');
            if (tabParam && ['orders', 'urgency-tracker', 'requisitions', 'site-budgets', 'site-pricing', 'catalog', 'po-generator', 'settings'].includes(tabParam)) {
                setActiveTab(tabParam as TabType);
            }
        }
    }, []);

    const TABS = useMemo(() => [
        { id: 'orders', label: 'All Orders', icon: List, show: true, count: counts.orders },
        { id: 'urgency-tracker', label: 'Urgency Tracker (P1-P3)', icon: Layers, show: canViewUrgencyTracker, count: 0 },
        { id: 'requisitions', label: 'Monthly Requisitions', icon: FileSpreadsheet, show: true, count: 0 },
        { id: 'site-budgets', label: 'Property Budgets', icon: IndianRupee, show: canManageCatalogAndPricing, count: 0 },
        { id: 'site-pricing', label: 'Site Pricing & Aliases', icon: DollarSign, show: canManageCatalogAndPricing, count: 0 },
        { id: 'catalog', label: 'Manage Items Master', icon: ShoppingCart, show: canManageCatalogAndPricing, count: 0 },
        { id: 'po-generator', label: 'PO Generator', icon: FileText, show: canManageCatalogAndPricing || userRole === 'org_admin', count: 0 },
        { id: 'settings', label: 'Settings', icon: Settings, show: isSuperAdmin, count: 0 },
    ], [counts.orders, canViewUrgencyTracker, canManageCatalogAndPricing, userRole, isSuperAdmin]);

    if (isInitialLoading) {
        return <ProcurementModuleSkeleton />;
    }

    return (
        <div className="space-y-6">
            {/* Unified SaaS One Tab Bar */}
            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-x-auto scrollbar-hide max-w-full">
                {TABS.filter(t => t.show).map(tab => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={`tab-${tab.id}`}
                            onClick={() => setActiveTab(tab.id as TabType)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all whitespace-nowrap cursor-pointer select-none
                                ${isActive 
                                    ? 'bg-primary text-white shadow-md shadow-primary/20 scale-[1.01]' 
                                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                        >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span>{tab.label}</span>
                            
                            {tab.id === 'po-generator' && (
                                <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider ${isActive ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'}`}>
                                    Beta
                                </span>
                            )}
                            
                            {tab.count > 0 && (
                                <span className={`ml-1 px-2 py-0.5 rounded-full text-[9px] font-black
                                    ${isActive 
                                        ? 'bg-white/20 text-white' 
                                        : tab.id === 'orders' && counts.pending_quotation > 0
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse' 
                                            : 'bg-primary/10 text-primary dark:bg-primary/20'}`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Tab Body */}
            <div className="min-h-[55vh] transition-opacity duration-200">
                {activeTab === 'settings' && isSuperAdmin && (
                    <ProcurementAdminSettings organizationId={orgId} properties={properties} />
                )}

                {activeTab === 'orders' && (
                    <ProcurementRequestList organizationId={orgId} propertyId={propertyId} onAction={fetchCounts} />
                )}

                {activeTab === 'urgency-tracker' && canViewUrgencyTracker && (
                    <PaymentUrgencyTrackerTab
                        user={user}
                        organizationId={orgId}
                        propertyId={propertyId}
                        isSuperAdmin={isSuperAdmin}
                    />
                )}

                {activeTab === 'requisitions' && (
                    <MonthlyRequisitionsTab 
                        user={user} 
                        organizationId={orgId} 
                        propertyId={propertyId} 
                        userRole={userRole || 'property_admin'}
                        onNavigateToBudgets={() => setActiveTab('site-budgets')}
                    />
                )}

                {activeTab === 'site-budgets' && canManageCatalogAndPricing && (
                    <PropertyBudgetsTab user={user} organizationId={orgId || ''} properties={properties} />
                )}

                {activeTab === 'site-pricing' && canManageCatalogAndPricing && (
                    <SitePricingAdminTab user={user} organizationId={orgId || ''} properties={properties} />
                )}

                {activeTab === 'catalog' && canManageCatalogAndPricing && (
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs">
                        <ProcurementCatalogModal 
                            isOpen={true}
                            onClose={() => setActiveTab('orders')}
                            ticketId="dashboard_catalog_management"
                            propertyId={propertyId || ''}
                            organizationId={orgId || ''}
                            isProcurementUser={true}
                        />
                    </div>
                )}

                {activeTab === 'po-generator' && (canManageCatalogAndPricing || userRole === 'org_admin') && (
                    <ProcurementPOProcessor organizationId={orgId} />
                )}
            </div>
        </div>
    );
}
