import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import AiTrainingChat from '@/frontend/components/ai-layer/AiTrainingChat';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { createClient } from '@/frontend/utils/supabase/server';

export const metadata: Metadata = { title: 'AI training chat' };

/** Training chat for the AI assistant. Org super admins of this organization only (the API checks it again). */
export default async function AiTrainingPage({ params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) notFound();
    const { data } = await supabaseAdmin.from('organization_memberships').select('role').eq('user_id', user.id)
        .eq('organization_id', orgId).eq('role', 'org_super_admin').eq('is_active', true).maybeSingle();
    if (!data) notFound();
    return <div className="p-4 md:p-6"><AiTrainingChat organizationId={orgId} /></div>;
}
