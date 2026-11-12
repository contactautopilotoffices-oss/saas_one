import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireSession(): Promise<{ user: User; error?: never } | { error: NextResponse }> {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    return { user };
}

/**
 * The signed-in, approved org super admin of THIS organization. Same rule as the existing WhatsApp assistant settings
 * route (app/api/whatsapp-assistant/settings/route.ts authorize()): settings belong to the org super admin only.
 */
export async function requireOrgSuperAdmin(organizationId: string): Promise<{ user: User; error?: never } | { error: NextResponse }> {
    if (!UUID.test(organizationId)) return { error: NextResponse.json({ error: 'Valid organization ID required' }, { status: 400 }) };
    const session = await requireSession();
    if (session.error) return session;
    const [membership, profile] = await Promise.all([
        supabaseAdmin.from('organization_memberships').select('role').eq('user_id', session.user.id).eq('organization_id', organizationId)
            .eq('is_active', true).eq('role', 'org_super_admin').maybeSingle(),
        supabaseAdmin.from('users').select('is_approved, approval_status').eq('id', session.user.id).maybeSingle(),
    ]);
    if (membership.error || profile.error) return { error: NextResponse.json({ error: 'Authorization unavailable' }, { status: 503 }) };
    const approved = profile.data?.is_approved === true || profile.data?.approval_status === 'approved';
    if (!membership.data || !approved) return { error: NextResponse.json({ error: 'Organization Super Admin access required' }, { status: 403 }) };
    return { user: session.user };
}
