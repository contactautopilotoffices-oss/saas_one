'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import PerformanceMarketingDashboard from '@/frontend/components/crm/PerformanceMarketingDashboard';
import { CompetitorAdWatch } from '@/frontend/components/crm';

export default function PerformanceMarketingPage() {
    const params = useParams();
    const orgId = params?.orgId as string;
    const { membership } = useAuth();
    const role = membership?.org_role;
    const isAdmin = membership?.is_master_admin ||
        (role && ['bd_admin', 'bd_super_admin', 'org_admin', 'org_super_admin'].includes(role)) ||
        (membership?.properties || []).some((p: any) =>
            p.organization_id === orgId &&
            ['bd_admin', 'bd_super_admin', 'org_admin', 'org_super_admin'].includes(p.role)
        );

    if (!isAdmin) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <div style={{ textAlign: 'center' }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>
                        Admins only
                    </h2>
                    <p style={{ color: '#64748B', fontSize: 13 }}>
                        Performance Marketing is available to BD admins.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PerformanceMarketingDashboard />
            <CompetitorAdWatch orgId={orgId} />
        </div>
    );
}