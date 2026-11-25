'use client';

import React, { use } from 'react';
import RecruitmentWorkspace from '@/frontend/components/recruitment/workspace/RecruitmentWorkspace';

/** Owner 2026-11-25: the Recruitment workspace, the base of the HRMS. Renders its own chrome (see the dashboard layout). */
export default function RecruitmentPage({ params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = use(params);
    return <RecruitmentWorkspace orgId={orgId} />;
}
