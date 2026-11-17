import type { Metadata } from 'next';
import AccountsDashboard from '@/frontend/components/accounts/AccountsDashboard';

export const metadata: Metadata = {
    title: 'Payment Tracker | Autopilot',
    description: 'PO payment alignment, disbursement and UTR tracking for the accounts team.',
};

export default function AccountsPage() {
    return (
        <div className="p-4 sm:p-6 lg:p-8">
            {/* The tracker leads the page. The overview tiles (FinanceOverview) were removed from
                here on request; Procurement's Payment Tracker tab still renders them. */}
            <div id="payment-tracker" className="scroll-mt-24">
                <AccountsDashboard />
            </div>
        </div>
    );
}
