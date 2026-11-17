'use client';

import { useParams } from 'next/navigation';
import SatejConsole from '@/frontend/components/satej/SatejConsole';

export default function SatejPage() {
    const params = useParams<{ orgId: string }>();
    return <SatejConsole orgId={params.orgId} />;
}
