'use client';

import React, { use } from 'react';
import HRTicketsContent from '@/frontend/components/hr/HRTicketsContent';

export default function AccountsGrievancePage({ params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = use(params);
    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <HRTicketsContent orgId={orgId} />
        </div>
    );
}
