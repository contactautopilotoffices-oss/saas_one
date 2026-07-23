'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { 
    Settings, List, ShoppingCart, 
    Loader2, FileText 
} from 'lucide-react';
import ProcurementAdminSettings from './ProcurementAdminSettings';
import ProcurementRequestList from './ProcurementRequestList';
import ProcurementPOProcessor from './ProcurementPOProcessor';
import ProcurementCatalogModal from './ProcurementCatalogModal';
import { useAuth } from '@/frontend/context/AuthContext';

type TabType = 'orders' | 'catalog' | 'po-generator' | 'settings';

export default function ProcurementModule({ orgId: propOrgId, isAdmin: propIsAdmin, properties: propProperties }: { orgId?: string, isAdmin?: boolean, properties?: any[] }) {
    const params = useParams();
    const orgId = propOrgId || (params.orgId as string);
    const propertyId = params.propertyId as string;
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<TabType>('orders');
    const [properties, setProperties] = useState<any[]>(propProperties || []);
    const [isLoading, setIsLoading] = useState(true);
    const [counts, setCounts] = useState({ orders: 0, pending_quotation: 0 });

    const isSuperAdmin = propIsAdmin || user?.user_metadata?.role === 'org_super_admin' || user?.user_metadata?.role === 'master_admin';
    const isProcurementUser = user?.user_metadata?.role?.toLowerCase().includes('procurement');

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
        try {
            const res = await fetch(`/api/properties?organizationId=${orgId}`);
            const data = await res.json();
            setProperties(data || []);
        } catch (err) {
            console.error(err);
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
        { id: 'catalog', label: 'Manage Items', icon: ShoppingCart, show: isSuperAdmin || isProcurementUser, count: 0 },
        { id: 'po-generator', label: 'PO Generator', icon: FileText, show: isSuperAdmin || isProcurementUser || user?.user_metadata?.role === 'org_admin', count: 0 },
        { id: 'settings', label: 'Settings', icon: Settings, show: isSuperAdmin, count: 0 },
    ];

    return (
        <div className="space-y-6">
            {/* Tabs Navigation */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-sm w-fit">
                {TABS.filter(t => t.show).map(tab => (
                    <button
                        key={`tab-${tab.id}`}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black transition-all relative
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

                {activeTab === 'catalog' && (isSuperAdmin || isProcurementUser) && (
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

                {activeTab === 'po-generator' && (isSuperAdmin || isProcurementUser || user?.user_metadata?.role === 'org_admin') && (
                    <ProcurementPOProcessor organizationId={orgId} />
                )}
            </div>
        </div>
    );
}
