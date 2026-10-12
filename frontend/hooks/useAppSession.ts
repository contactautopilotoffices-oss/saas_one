import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/frontend/context/AuthContext';
import { createClient } from '@/frontend/utils/supabase/client';

export interface AppSession {
    user_id: string;
    role: 'master_admin' | 'org_super_admin' | 'ops_super_admin' | 'org_admin' | 'property_admin' | 'staff' | 'soft_service_manager' | 'soft_service_staff' | 'tenant' | 'super_tenant' | 'maintenance_vendor' | 'bd_admin' | 'bd_super_admin' | 'bd_rep';
    org_id: string;
    property_ids: string[];
    available_modules: string[];
}


const ORG_ROLE_PRIORITY: Record<string, number> = {
    org_super_admin: 1, ops_super_admin: 2, org_admin: 3, super_tenant: 4,
    owner: 5, admin: 6, bd_super_admin: 7, bd_admin: 8, procurement: 9
};

/** AuthProvider owns the approved profile and active memberships.
 * Consumers derive presentation state; backend APIs still enforce access. */
export function useAppSession() {
    const { user, membership, isLoading: authLoading, isMembershipLoading, refreshMembership } = useAuth();
    const [superProperties, setSuperProperties] = useState<{ userId: string; ids: string[]; error?: boolean } | null>(null);
    const verified = !!user && membership?.user_id === user.id;
    const waiting = authLoading || (!!user && (isMembershipLoading || !verified));
    const resolved = useMemo(() => {
        if (waiting || !user || !membership || membership.error || !membership.is_approved) return null;
        const organizations = [...membership.all_org_memberships].sort((a, b) =>
            (ORG_ROLE_PRIORITY[a.role] ?? 99) - (ORG_ROLE_PRIORITY[b.role] ?? 99));
        const organization = organizations[0];
        const property = membership.properties.find(p => p.role && p.role !== 'tenant') || membership.properties[0];
        const role = membership.is_master_admin ? 'master_admin' : organization?.role || property?.role;
        if (!role) return null;
        return {
            user_id: user.id,
            role: role as AppSession['role'],
            org_id: organization?.org_id || property?.organization_id || membership.org_id || '',
            property_ids: membership.properties.map(p => p.id),
            available_modules: ['ticketing', 'viewer', 'analytics', 'stock', 'checklist', 'crm']
        };
    }, [waiting, user?.id, membership]);

    const superUserId = resolved?.role === 'super_tenant' ? resolved.user_id : null;
    useEffect(() => {
        if (!superUserId) return;
        let cancelled = false;
        const client = createClient();
        client.from('super_tenant_properties').select('property_id').eq('user_id', superUserId)
            .then(({ data, error }) => {
                if (!cancelled) setSuperProperties({ userId: superUserId,
                    ids: data?.map(row => row.property_id) || [], error: !!error });
            });
        return () => { cancelled = true; };
    }, [superUserId]);
    const superWaiting = !!superUserId && superProperties?.userId !== superUserId;
    const failed = !!membership?.error || (!!superUserId && superProperties?.userId === superUserId && !!superProperties.error);
    const session = useMemo<AppSession | null>(() => {
        if (superWaiting || failed || !resolved) return null;
        return superUserId ? { ...resolved, property_ids: superProperties?.ids || [] } : resolved;
    }, [resolved, superUserId, superProperties, superWaiting, failed]);
    return { session, isLoading: waiting || superWaiting, error: failed,
        retry: refreshMembership };
}
