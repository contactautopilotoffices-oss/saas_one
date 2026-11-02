'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import UnifiedDashboard from '@/frontend/components/dashboard/UnifiedDashboard';

// UnifiedDashboard uses useAppSession to detect role and renders:
// - org_super_admin / org_admin → OrgDashboard
// - super_tenant               → SuperTenantDashboard
// - master_admin               → MasterAdminDashboard
// - property_admin             → PropertyAdminDashboard
export default function OrgDashboardPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    useEffect(() => {
        const qs = searchParams?.toString();
        router.replace(qs ? `/dashboard?${qs}` : '/dashboard');
    }, [router, searchParams]);

    return <UnifiedDashboard />;
}
