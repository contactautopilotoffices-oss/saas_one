/**
 * Master-admin guard for every /api/council/* route — the same pattern as
 * app/api/master-admin-chatbot/route.ts: cookie session getUser →
 * users.is_master_admin → 403. Data access then goes through the service
 * role (RLS on council_* is defense-in-depth only).
 *
 * Org resolution: explicit ?org_id / body org_id wins; a single active org
 * membership resolves itself; otherwise the MVP playground default — the one
 * org the council is seeded for (docs/COUNCIL_SPEC.md). Master admin is a
 * cross-org role, so membership is not required for the playground default.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

/** The org the 8 founding agents are seeded for — MVP playground default. */
export const PLAYGROUND_ORG_ID = '211e1330-ad83-446d-941f-dcea48396798';

export interface CouncilAccess {
    user: { id: string; email?: string };
    adminClient: SupabaseClient;
}

export async function requireMasterAdmin(): Promise<CouncilAccess | NextResponse> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
        .from('users')
        .select('is_master_admin')
        .eq('id', user.id)
        .single();

    if (!profile?.is_master_admin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return { user: { id: user.id, email: user.email ?? undefined }, adminClient };
}

export function isCouncilAccessError(x: CouncilAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}

export async function resolveCouncilOrgId(
    access: CouncilAccess,
    request: NextRequest,
    body?: { org_id?: string; organization_id?: string; orgId?: string } | null,
): Promise<string> {
    const sp = new URL(request.url).searchParams;
    const explicit = sp.get('org_id') || sp.get('organization_id') || sp.get('orgId')
        || body?.org_id || body?.organization_id || body?.orgId;
    if (explicit) return explicit;

    const { data: memberships } = await access.adminClient
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', access.user.id)
        .eq('is_active', true);
    const orgIds = [...new Set((memberships || []).map(m => m.organization_id).filter(Boolean))] as string[];
    if (orgIds.length === 1) return orgIds[0];

    return PLAYGROUND_ORG_ID;
}
