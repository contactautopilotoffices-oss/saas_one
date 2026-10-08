'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import { isInternalPettyCashRole } from '@/frontend/lib/pettyCash/roles';

export const DashboardContentContext = createContext<ReactNode>(undefined);

/** Reuse the role's chrome, replacing only its main content and active nav. */
export function useDashboardContent() {
    const content = useContext(DashboardContentContext);
    const router = useRouter();
    const params = useParams();
    const { membership } = useAuth();
    const orgId = typeof params?.orgId === 'string' ? params.orgId
        : membership?.properties?.find(p => p.id === params?.propertyId)?.organization_id || membership?.org_id;
    const currentOrgRole = membership?.org_id === orgId ? membership?.org_role : undefined;
    const scopedOrgRoles = [
        ...(membership?.all_org_memberships?.filter(m => m.org_id === orgId).map(m => m.role) || []),
        ...(currentOrgRole ? [currentOrgRole] : []),
    ].filter(role => content === undefined || isInternalPettyCashRole(role));
    const scopedProperties = (membership?.properties?.filter(p => p.organization_id === orgId) || [])
        .filter(property => content === undefined || isInternalPettyCashRole(property.role));
    const priority = ['master_admin', 'org_super_admin', 'org_admin', 'ops_super_admin', 'procurement', 'accounts'];
    const dashboardRole = membership?.is_master_admin ? 'master_admin'
        : priority.find(role => scopedOrgRoles.includes(role)) || scopedOrgRoles[0] || scopedProperties[0]?.role;
    const propertyId = typeof params?.propertyId === 'string' ? params.propertyId
        : scopedProperties.find(p => p.role === dashboardRole)?.id || scopedProperties[0]?.id;
    const navigate = (tab: string, query: Record<string, string | undefined> = {}) => {
        const search = new URLSearchParams(window.location.search);
        search.set('tab', tab);
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined) search.delete(key); else search.set(key, value);
        }
        router.push(`/${orgId}/dashboard?${search.toString()}`, { scroll: false });
    };
    return { dashboardContent: content, dashboardPropertyId: propertyId || '', dashboardRole, dashboardOrgId: orgId, navigateDashboard: navigate };
}
