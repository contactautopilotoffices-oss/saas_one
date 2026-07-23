'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { DollarSign } from 'lucide-react';
import CampaignSpendManager from '@/frontend/components/crm/CampaignSpendManager';

export default function SpendPage() {
    const params = useParams();
    const orgId = params?.orgId as string;
    return (
        <div className="space-y-4">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
                    <DollarSign className="h-6 w-6 text-primary" />
                    Campaign Spend
                </h1>
                <p className="mt-1 text-sm text-text-secondary">
                    Set per-campaign budgets and log daily spend. The CRM Reports page uses this data for ROI calculations.
                </p>
            </div>
            <CampaignSpendManager orgId={orgId} />
        </div>
    );
}
