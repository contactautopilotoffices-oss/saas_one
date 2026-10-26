'use client';

import dynamic from 'next/dynamic';

// Client only: the lab reads its view state (?design, ?screen, ?state) from the URL on first render.
const DesignLab = dynamic(() => import('@/frontend/components/design-lab/DesignLab'), {
    ssr: false,
    loading: () => <div className="min-h-screen bg-white" />,
});

export default function DesignLabPage() {
    return <DesignLab />;
}
