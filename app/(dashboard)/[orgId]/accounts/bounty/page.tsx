import type { Metadata } from 'next';
import BountyInbox from '@/frontend/components/aop/BountyInbox';

export const metadata: Metadata = {
    title: 'AOP Bounty | Autopilot',
    description: 'What is still missing for this month’s AOP actuals, and who is being asked for it.',
};

export default async function AccountsBountyPage({ params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = await params;
    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <BountyInbox orgId={orgId} invoicesHref={`/${orgId}/accounts?tab=invoices`} />
        </div>
    );
}
