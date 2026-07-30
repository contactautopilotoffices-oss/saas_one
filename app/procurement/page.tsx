import type { Metadata } from 'next';
import { Suspense } from 'react';
import ProcurementDashboard from '@/frontend/components/dashboard/ProcurementDashboard';

export const metadata: Metadata = {
    title: 'Procurement Dashboard | Autopilot',
    description: 'Manage material requests across all properties',
};

export default function Page() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading Procurement...</div>}>
            <ProcurementDashboard />
        </Suspense>
    );
}
