'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { 
    Settings, List, ShoppingCart, 
    Loader2, FileText, FileSpreadsheet,
    DollarSign
} from 'lucide-react';
import ProcurementAdminSettings from './ProcurementAdminSettings';
import ProcurementRequestList from './ProcurementRequestList';
import ProcurementPOProcessor from './ProcurementPOProcessor';
import ProcurementCatalogModal from './ProcurementCatalogModal';
import MonthlyRequisitionsTab from './MonthlyRequisitionsTab';
import SitePricingAdminTab from './SitePricingAdminTab';
import PaymentUrgencyTrackerTab from './payment-urgency/PaymentUrgencyTrackerTab';
import { useAuth } from '@/frontend/context/AuthContext';
import { Layers } from 'lucide-react';

type TabType = 'orders' | 'urgency-tracker' | 'requisitions' | 'site-pricing' | 'catalog' | 'po-generator' | 'settings';

export default function ProcurementModule({ orgId: propOrgId, isAdmin: propIsAdmin, properties: propProperties }: { orgId?: string, isAdmin?: boolean, properties?: any[] }) {
    const params = useParams();
    const orgId = propOrgId || (params.orgId as string);
    const propertyId = params.propertyId as string;
    const { user, membership } = useAuth();
    const [activeTab, setActiveTab] = useState<TabType>('orders');
    const [properties, setProperties] = useState<any[]>(propProperties || []);
    const [isLoading, setIsLoading] = useState(true);
    const [counts, setCounts] = useState({ orders: 0, pending_quotation: 0 });

    const userRole = (membership?.org_role || (user?.user_metadata?.role as string) || '').toLowerCase();
    const isSuperAdmin = propIsAdmin || userRole === 'org_super_admin' || userRole === 'master_admin';
    const isProcurementUser = userRole.includes('procurement') || userRole === 'org_admin' || isSuperAdmin;
    const canManageCatalogAndPricing = isSuperAdmin || isProcurementUser;

    useEffect(() => {
        const initialize = async () => {
            setIsLoading(true);
            if (!propProperties) {
                await fetchProperties();
            } else {
                setProperties(propProperties);
            }
            await fetchCounts();
            setIsLoading(false);
        };
        initialize();
    }, [orgId, propProperties]);

    const fetchCounts = async () => {
        if (!user?.id || !orgId) return;
        try {
            let ordersUrl = `/api/procurement/requests?organizationId=${orgId}`;
            if (propertyId) ordersUrl += `&propertyId=${propertyId}`;
            const ordersRes = await fetch(ordersUrl);
            const ordersData = await ordersRes.json();
            
            const allOrders = Array.isArray(ordersData) ? ordersData : [];
            setCounts({
                orders: allOrders.length,
                pending_quotation: allOrders.filter((r: any) => r.status === 'pending_quotation').length
            });
        } catch (err) {
            console.error('Failed to fetch counts:', err);
        }
    };

    const fetchProperties = async () => {
        if (!orgId) return;
        try {
            const res = await fetch(`/api/properties?organization_id=${orgId}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setProperties(data);
            }
        } catch (err) {
            console.error('Failed to fetch properties:', err);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
        );
    }

    const TABS = [
        { id: 'orders', label: 'All Orders', icon: List, show: true, count: counts.orders },
        { id: 'urgency-tracker', label: 'Urgency Tracker (P1-P3)', icon: Layers, show: true, count: 0 },
        { id: 'requisitions', label: 'Monthly Requisitions', icon: FileSpreadsheet, show: true, count: 0 },
        { id: 'site-pricing', label: 'Site Pricing & Aliases', icon: DollarSign, show: canManageCatalogAndPricing, count: 0 },
        { id: 'catalog', label: 'Manage Items Master', icon: ShoppingCart, show: canManageCatalogAndPricing, count: 0 },
        { id: 'po-generator', label: 'PO Generator', icon: FileText, show: canManageCatalogAndPricing || userRole === 'org_admin', count: 0 },
        { id: 'settings', label: 'Settings', icon: Settings, show: isSuperAdmin, count: 0 },
    ];

    return (
        <div className="space-y-6">
            {/* Tabs Navigation */}
            <div className="flex flex-wrap items-center gap-1 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-xs w-fit">
                {TABS.filter(t => t.show).map(tab => (
                    <button
                        key={`tab-${tab.id}`}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all relative cursor-pointer
                            ${activeTab === tab.id 
                                ? 'bg-primary text-white shadow-md' 
                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                        {tab.id === 'po-generator' && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-100 text-amber-600 uppercase tracking-wider">
                                Coming Soon
                            </span>
                        )}
                        {tab.count > 0 && (
                            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-black
                                ${activeTab === tab.id 
                                    ? 'bg-white/20 text-white' 
                                    : tab.id === 'orders' && counts.pending_quotation > 0
                                        ? 'bg-orange-100 text-orange-600 animate-pulse' 
                                        : 'bg-primary/10 text-primary'}`}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="min-h-[60vh]">
                {activeTab === 'settings' && isSuperAdmin && (
                    <ProcurementAdminSettings organizationId={orgId} properties={properties} />
                )}

                {activeTab === 'orders' && (
                    <ProcurementRequestList organizationId={orgId} propertyId={propertyId} onAction={fetchCounts} />
                )}

                {activeTab === 'urgency-tracker' && (
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
                    />
                )}

                {activeTab === 'site-pricing' && canManageCatalogAndPricing && (
                    <SitePricingAdminTab user={user} organizationId={orgId || ''} properties={properties} />
                )}

                {activeTab === 'catalog' && canManageCatalogAndPricing && (
                    <div className="bg-white rounded-3xl border border-slate-200 p-8">
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
