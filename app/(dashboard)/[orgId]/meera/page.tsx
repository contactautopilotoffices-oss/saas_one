'use client';

/**
 * Meera, the procurement agent. Same console as /[orgId]/satej, which stays so
 * links already sent on WhatsApp keep working (the agent was called Satej until
 * 2026-10-06, the name of a person on the purchase team).
 */

import { useParams } from 'next/navigation';
import SatejConsole from '@/frontend/components/satej/SatejConsole';

export default function MeeraPage() {
    const params = useParams<{ orgId: string }>();
    return <SatejConsole orgId={params.orgId} />;
}
