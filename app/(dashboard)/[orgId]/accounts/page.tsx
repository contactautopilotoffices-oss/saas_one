import type { Metadata } from 'next';
import AccountsDashboard from '@/frontend/components/accounts/AccountsDashboard';
import FinanceOverview from '@/frontend/components/accounts/FinanceOverview';

export const metadata: Metadata = {
    title: 'Payment Tracker | Autopilot',
    description: 'PO payment alignment, disbursement and UTR tracking for the accounts team.',
};

export default function AccountsPage() {
    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <FinanceOverview />
            {/* Anchor for the overview's click-throughs; the tracker owns its own tab state. */}
            <div id="payment-tracker" className="scroll-mt-24">
                <AccountsDashboard />
            </div>
        </div>
    );
}
