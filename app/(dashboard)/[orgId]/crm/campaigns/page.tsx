'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import CampaignsManager from '@/frontend/components/crm/CampaignsManager';

export default function CRMCampaignsPage() {
    const params = useParams();
    const orgId = params?.orgId as string;
    const { membership } = useAuth();
    const role = membership?.org_role;
    const authorized = role && ['bd_admin', 'bd_super_admin', 'org_admin', 'org_super_admin'].includes(role);

    if (!authorized) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <h2 className="text-xl font-bold text-text-primary mb-2">Admins only</h2>
                    <p className="text-text-secondary">Campaign management is available to BD Admins.</p>
                </div>
            </div>
        );
    }

    return <CampaignsManager orgId={orgId} />;
}
