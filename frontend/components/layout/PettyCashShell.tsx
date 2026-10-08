'use client';

import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import { pettyCashCaps } from '@/frontend/lib/pettyCash/roles';
import UnifiedDashboard from '@/frontend/components/dashboard/UnifiedDashboard';
import { DashboardContentContext } from './DashboardContentSlot';

/** This component stays mounted across dashboard ↔ petty-cash route changes. */
export default function PettyCashShell({ children }: { children?: ReactNode }) {
    const { membership } = useAuth();
    const params = useParams();
    const orgId = typeof params?.orgId === 'string' ? params.orgId : membership?.org_id;
    if (children !== undefined && !pettyCashCaps(membership, orgId || undefined).canSee) {
        return <div role="alert" className="p-10">Petty Cash is restricted to internal members of this organization.</div>;
    }
    return <DashboardContentContext.Provider value={children}><UnifiedDashboard /></DashboardContentContext.Provider>;
}
