'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import HiringRequestsPage from '@/frontend/components/recruitment/HiringRequestsPage';

/** Owner 2026-11-20: "Hiring requests" in the sidebar of the roles and people the Tech team picked. */
export default function Page() {
    const params = useParams();
    const { membership } = useAuth();
    const orgId = (typeof params.orgId === 'string' ? params.orgId : '') || membership?.org_id || membership?.properties?.[0]?.organization_id || '';
    return <HiringRequestsPage orgId={orgId} />;
}
