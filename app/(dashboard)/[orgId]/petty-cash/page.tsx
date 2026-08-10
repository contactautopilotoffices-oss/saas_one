import type { Metadata } from 'next';
import PettyCashDashboard from '@/frontend/components/pettyCash/PettyCashDashboard';

export const metadata: Metadata = {
    title: 'Petty Cash | Autopilot',
    description: 'Petty cash requests, approvals, disbursement and settlement.',
};

export default function PettyCashPage() {
    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <PettyCashDashboard />
        </div>
    );
}
