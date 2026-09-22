'use client';

import React, { use, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import HRTicketsContent from '@/frontend/components/hr/HRTicketsContent';

export default function HRTicketsPage({ params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = use(params);
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, membership } = useAuth();

    const isOrgSuperAdmin = membership?.org_role === 'org_super_admin' || user?.user_metadata?.role === 'org_super_admin';

    useEffect(() => {
        if (isOrgSuperAdmin) {
            const subtab = searchParams.get('subtab') || searchParams.get('tab');
            const action = searchParams.get('action');
            const targetParams = new URLSearchParams();
            targetParams.set('tab', 'grievance');
            if (subtab && subtab !== 'tickets' && subtab !== 'grievance') {
                targetParams.set('subtab', subtab);
            }
            if (action) {
                targetParams.set('action', action);
            }
            router.replace(`/${orgId}/dashboard?${targetParams.toString()}`);
        }
    }, [isOrgSuperAdmin, orgId, router, searchParams]);

    return <HRTicketsContent orgId={orgId} />;
}
