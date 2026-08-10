import type { Metadata } from 'next';
import PoDetailWorkspace from '@/frontend/components/accounts/PoDetailWorkspace';

export const metadata: Metadata = {
    title: 'Purchase Order | Autopilot',
    description: 'PO particulars, payment tranches, documents, vendor compliance and activity — the shared record accounts, procurement and admins all read from.',
};

// Next 16: route params arrive as a Promise.
export default async function PoDetailPage({ params }: { params: Promise<{ orgId: string; poId: string }> }) {
    const { orgId, poId } = await params;

    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <PoDetailWorkspace orgId={orgId} poId={poId} />
        </div>
    );
}
