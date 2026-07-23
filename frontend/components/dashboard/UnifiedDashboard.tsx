'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PropertyAdminDashboard from './PropertyAdminDashboard';
import OrgAdminDashboard from './OrgAdminDashboard';
import MasterAdminDashboard from './MasterAdminDashboard';
import SoftServiceManagerDashboard from './SoftServiceManagerDashboard';
import SuperTenantDashboard from './SuperTenantDashboard';
import VendorDashboard from '@/frontend/components/vendors/VendorDashboard';
import ProcurementDashboard from './ProcurementDashboard';
import Loader from '@/frontend/components/ui/Loader';
import { useAppSession } from '@/frontend/hooks/useAppSession';
import { AlertCircle, TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { TextShimmer } from '@/frontend/components/ui/text-shimmer';
import BorderGlow from '@/frontend/components/ui/BorderGlow';

interface BDQuickStatsData {
    total_leads: number;
    lead_source_analytics?: { source_name: string; count: number }[];
    status_breakdown?: { status_id: string; status_name: string; color: string; count: number }[];
}

function BDQuickStats({ orgId }: { orgId: string }) {
    const [stats, setStats] = React.useState<BDQuickStatsData | null>(null);
    const [loading, setLoading] = React.useState(true);

    useEffect(() => {
        setLoading(true);
        fetch(`/api/crm/stats?type=admin&org_id=${orgId}&period=all`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { setStats(data); setLoading(false); })
            .catch(() => setLoading(false));
    }, [orgId]);

    const sources = stats?.lead_source_analytics || [];
    const statusBreakdown = stats?.status_breakdown || [];
    const total = stats?.total_leads || 0;

    return (
        <BorderGlow
            backgroundColor="#ffffff"
            glowColor="192 20 58"
            colors={['#708F96', '#0EA5E9', '#F59E0B']}
            fillOpacity={0.03}
            borderRadius={24}
            glowRadius={20}
            glowIntensity={0.6}
            coneSpread={30}
            edgeSensitivity={45}
        >
            <div>
                {/* Compact header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-primary/10 rounded-lg flex items-center justify-center">
                            <TrendingUp className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-slate-900">BD Pipeline</h3>
                            <p className="text-[10px] text-slate-400 font-bold">{total} total leads</p>
                        </div>
                    </div>
                    <Link
                        href={`/${orgId}/crm`}
                        className="flex items-center gap-1 text-[10px] font-bold text-primary hover:underline"
                    >
                        Open CRM <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>

                <div className="p-4 space-y-4">
                    {/* Source-wise tiles */}
                    {loading ? (
                        <div className="flex items-center justify-center py-6">
                            <TextShimmer duration={1.2} className="text-sm font-bold" baseColor="#94a3b8" gradientColor="#cbd5e1">
                                Loading pipeline data…
                            </TextShimmer>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-2">
                            {sources.slice(0, 3).map((src) => (
                                <div key={src.source_name} className="p-3 bg-slate-50 rounded-xl">
                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate mb-1">{src.source_name}</div>
                                    <div className="text-xl font-black text-slate-900">{src.count}</div>
                                </div>
                            ))}
                            {sources.length === 0 && (
                                <div className="col-span-3 text-center text-slate-400 text-xs py-3">No source data</div>
                            )}
                        </div>
                    )}

                    {/* Leads by Status — color-coded bars */}
                    {!loading && statusBreakdown.length > 0 && (
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Leads by Status</p>
                            <div className="space-y-1.5">
                                {statusBreakdown.map((s) => (
                                    <div key={s.status_id} className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                                        <span className="text-[11px] font-bold text-slate-600 flex-1 truncate">{s.status_name}</span>
                                        <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden flex-shrink-0">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%`, backgroundColor: s.color }}
                                            />
                                        </div>
                                        <span className="text-[11px] font-black text-slate-700 w-8 text-right">{s.count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </BorderGlow>
    );
}

const UnifiedDashboard = () => {
    const { session, isLoading } = useAppSession();
    const router = useRouter();

    // Auto-redirect BD roles to CRM immediately
    useEffect(() => {
        if (!isLoading && (session?.role === 'bd_admin' || session?.role === 'bd_super_admin' || session?.role === 'bd_rep')) {
            const orgId = session?.org_id || (session as any)?.organization_id;
            if (orgId) {
                router.replace(`/${orgId}/crm`);
            }
        }
    }, [isLoading, session, router]);

    if (isLoading) {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-background gap-3">
                <Loader size="lg" />
                <TextShimmer duration={1.2} className="text-sm font-medium" baseColor="#64748b" gradientColor="#cbd5e1">
                    Loading your dashboard…
                </TextShimmer>
            </div>
        );
    }

    const role = session?.role?.toLowerCase();
    const propertyIds = session?.property_ids || [];

    console.log('[UnifiedDashboard] Session Data:', { role, propertyIds, userId: session?.user_id });

    // Master Admin view
    if (role === 'master_admin') {
        return <MasterAdminDashboard />;
    }

    if (role === 'org_super_admin' || role === 'org_admin') {
        // OrgAdminDashboard includes BDQuickStats card — fetches its own CRM data
        return <OrgAdminDashboard />;
    }

    // Procurement role - global dashboard
    if (role === 'procurement') {
        return <ProcurementDashboard />;
    }

    // Super Tenant — multi-property analytics dashboard
    if (role === 'super_tenant') {
        return <SuperTenantDashboard />;
    }

    // Soft Service Manager/Supervisor — dedicated dashboard
    if (role === 'soft_service_manager' || role === 'soft_service_supervisor' || role === 'soft_service_staff') {
        const activePropertyId = propertyIds[0] || 'prop-1';
        return <SoftServiceManagerDashboard propertyId={activePropertyId} userRole={role} />;
    }

    if (role === 'property_admin') {
        return <PropertyAdminDashboard />;
    }

    // Maintenance Vendor — their own task dashboard
    if (role === 'maintenance_vendor') {
        return <VendorDashboard />;
    }

    // BD roles already redirected above via useEffect
    // Show brief loading state while redirecting
    if (role === 'bd_admin' || role === 'bd_super_admin' || role === 'bd_rep') {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50">
                <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-4 animate-pulse">
                    <TrendingUp className="w-8 h-8" />
                </div>
                <TextShimmer duration={1} className="text-xl font-black" baseColor="#1e293b" gradientColor="#94a3b8">
                    Opening CRM…
                </TextShimmer>
                <p className="text-slate-500 mt-2 text-sm">Taking you to your workspace</p>
            </div>
        );
    }

    // Default Fallback
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-10 text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mb-4">
                <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-black text-slate-900">Access Restricted</h2>
            <p className="text-slate-500 mt-2 max-w-sm">
                You don&apos;t have an active role assigned for this property. Please contact your administrator.
            </p>
        </div>
    );
};

export { BDQuickStats };
export default UnifiedDashboard;