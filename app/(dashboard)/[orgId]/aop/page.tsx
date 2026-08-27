import type { Metadata } from 'next';
import AopWorkspace from '@/frontend/components/aop/AopWorkspace';

export const metadata: Metadata = {
    title: 'AOP Budget vs Actual | Autopilot',
    description: 'Annual Operating Plan tracker — site-wise budget against actual spend.',
};

// Next 16: route params arrive as a Promise.
export default async function AopPage({ params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = await params;

    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <AopWorkspace orgId={orgId} />
        </div>
    );
}
