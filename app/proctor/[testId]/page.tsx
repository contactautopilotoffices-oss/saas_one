'use client';

import { use } from 'react';
import ProctorRunner from '@/frontend/components/proctor/ProctorRunner';

/** The locked test for a signed-in member: /proctor/<testId>. */
export default function ProctoredTestPage({ params }: { params: Promise<{ testId: string }> }) {
    const { testId } = use(params);
    return <ProctorRunner mode="authed" testId={testId} />;
}
