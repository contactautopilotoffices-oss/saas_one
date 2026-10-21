'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import MeetingsHome from '@/frontend/components/meetings/MeetingsHome';
import { useAppSession } from '@/frontend/hooks/useAppSession';

// Org admins have Meetings as a tab of the main dashboard; send them there.
// Other roles (property admin, procurement) keep this standalone page.
const DASHBOARD_TAB_ROLES = ['org_super_admin', 'org_admin'];

export default function MeetingsPage() {
    const params = useParams<{ orgId: string }>();
    const router = useRouter();
    const { session, isLoading } = useAppSession();
    const role = session?.role?.toLowerCase();
    const useTab = !!role && DASHBOARD_TAB_ROLES.includes(role);

    useEffect(() => {
        if (useTab) router.replace(`/${params.orgId}/dashboard?tab=meetings`);
    }, [useTab, params.orgId, router]);

    if (isLoading || useTab) return null;
    return <MeetingsHome orgId={params.orgId} />;
}
