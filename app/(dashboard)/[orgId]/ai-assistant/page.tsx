import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import AiAssistantChat from '@/frontend/components/ai-layer/AiAssistantChat';
import { createClient } from '@/frontend/utils/supabase/server';

export const metadata: Metadata = { title: 'AI Assistant' };

/**
 * In-app AI assistant. Any signed-in person can open the page; whether the assistant answers them (and about what) is
 * decided on the server by the org's AI Access settings and their own memberships.
 */
export default async function AiAssistantPage({ params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) notFound();
    return <div className="p-4 md:p-6"><AiAssistantChat organizationId={orgId} /></div>;
}
