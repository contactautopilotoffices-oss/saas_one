'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import { CRMDashboard } from '@/frontend/components/crm';
import BdSuperAdminDashboard from '@/frontend/components/crm/BdSuperAdminDashboard';
import { isBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';
import { CrmTour, dashboardSteps } from '@/frontend/components/crm/onboarding';

export default function CRMPage() {
    const { user, membership } = useAuth();
    const [isAuthorized, setIsAuthorized] = useState(false);
    const router = useRouter();
    const params = useParams();
    const orgId = params.orgId as string;

    useEffect(() => {
        if (!membership) return;
        const CRM_ROLES = ['bd_rep', 'bd_admin', 'bd_super_admin', 'org_admin', 'org_super_admin'];
        // 1. Master admin: always full access.
        if (membership.is_master_admin) {
            setIsAuthorized(true);
            return;
        }
        // 2. Org-level CRM role on the requested org.
        //    (org_role alone is not enough — primaryOrg may be a different
        //     org if the user holds roles in multiple organizations.)
        if (membership.org_role && CRM_ROLES.includes(membership.org_role)
            && membership.org_id === orgId) {
            setIsAuthorized(true);
            return;
        }
        // 3. Property-level CRM role on a property that belongs to this org.
        //    Covers the common case of a bd_rep assigned to one property.
        const hasPropertyCrmRole = (membership.properties || []).some(
            (p: any) => p.organization_id === orgId && CRM_ROLES.includes(p.role)
        );
        if (hasPropertyCrmRole) {
            setIsAuthorized(true);
            return;
        }
        // 4. User is a member of THIS org at any level (last-resort allow for
        //    cross-org roles where AuthContext picked a different primaryOrg).
        //    We require the membership to actually be in the requested org.
        const memberOfThisOrg = (membership.all_org_memberships || []).some(
            (m: any) => m.org_id === orgId && CRM_ROLES.includes(m.role)
        );
        if (memberOfThisOrg) {
            setIsAuthorized(true);
        }
    }, [membership, orgId]);

    if (!isAuthorized) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <h2 className="text-xl font-bold text-text-primary mb-2">Access Denied</h2>
                    <p className="text-text-secondary">
                        You don&apos;t have permission to access the CRM module.
                    </p>
                </div>
            </div>
        );
    }

    // BD Super Admin sees the CEO / GTM command-center dashboard instead of the
    // standard rep/admin CRM dashboard. Gated by email allowlist (or explicit role).
    if (isBdSuperAdmin(user?.email, membership?.org_role)) {
        return <BdSuperAdminDashboard />;
    }

    return (
        <>
            <CRMDashboard />
            <CrmTour
                tourId="crm-dashboard"
                steps={dashboardSteps}
                onComplete={() => router.push(`/${orgId}/crm/leads`)}
            />
        </>
    );
}
