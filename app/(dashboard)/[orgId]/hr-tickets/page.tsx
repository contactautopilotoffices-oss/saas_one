'use client';

import React, { use } from 'react';
import HRTicketsContent from '@/frontend/components/hr/HRTicketsContent';

export default function HRTicketsPage({ params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = use(params);
    return <HRTicketsContent orgId={orgId} />;
}
