import ProcurementModule from '@/frontend/components/procurement/ProcurementModule';
import { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Procurement Management | Autopilot',
    description: 'Manage property budgets, thresholds, and material requests.',
};

export default function ProcurementPage() {
    return (
        <div className="p-4 sm:p-8">
            <ProcurementModule />
        </div>
    );
}
