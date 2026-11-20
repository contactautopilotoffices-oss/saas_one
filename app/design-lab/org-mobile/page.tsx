'use client';

import dynamic from 'next/dynamic';

// Client only: the lab reads its view state (?design, ?state) from the URL on first render.
const OrgMobileLab = dynamic(() => import('@/frontend/components/design-lab/org/OrgMobileLab'), {
    ssr: false,
    loading: () => <div className="min-h-screen bg-[#E9E7E2]" />,
});

export default function OrgMobileLabPage() {
    return <OrgMobileLab />;
}
