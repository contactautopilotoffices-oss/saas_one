import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Shared purchase-mailbox access — PROCUREMENT and SUPER ADMIN only.
 *
 * Deliberately narrower than accounts/petty-cash access. The digest exposes the contents
 * of purchase@worksquare.in: vendor names, commercial terms, and who is chasing whom.
 * `accounts` and `org_admin` can reach the Payment Tracker but must NOT read this — the
 * 20260801000003 RLS policy originally granted them both, and 20260801000005 tightens it
 * to match this list. Keep the two in step; the API guard and the policy are one rule
 * expressed twice.
 */

const SUPER_ADMIN_ROLES = ['org_super_admin', 'master_admin'];
const PROCUREMENT_ROLES = ['purchase_manager', 'purchase_executive', 'procurement'];
const MAILBOX_ROLES = [...SUPER_ADMIN_ROLES, ...PROCUREMENT_ROLES];

export interface MailboxAccess {
    user: { id: string; email?: string };
    organizationId: string;
    isSuperAdmin: boolean;
    roles: string[];
}

type Membership = { organization_id: string | null; role: string | null };

async function authenticate(request: NextRequest): Promise<{ id: string; email?: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { id: user.id, email: user.email ?? undefined };

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const { data: { user: tokenUser } } = await supabaseAdmin.auth.getUser(token);
        if (tokenUser) return { id: tokenUser.id, email: tokenUser.email ?? undefined };
    }
    return null;
}

export function readOrgId(request: NextRequest, body?: any): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('org_id') || sp.get('organization_id') || sp.get('orgId') ||
        body?.organization_id || body?.org_id || null
    );
}

export async function resolveMailboxAccess(
    request: NextRequest,
    requestedOrgId?: string | null,
): Promise<MailboxAccess | NextResponse> {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabaseAdmin
        .from('users').select('is_master_admin').eq('id', user.id).maybeSingle();
    const isMasterAdmin = !!profile?.is_master_admin;

    const [propRes, orgRes] = await Promise.all([
        supabaseAdmin.from('property_memberships')
            .select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('organization_memberships')
            .select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
    ]);

    const memberships: Membership[] = [...(propRes.data || []), ...(orgRes.data || [])];
    const permitted = memberships.filter(m => m.role && MAILBOX_ROLES.includes(m.role));
    const orgIds = [...new Set(permitted.map(m => m.organization_id).filter(Boolean))] as string[];

    let organizationId = requestedOrgId || null;
    if (organizationId) {
        if (!(isMasterAdmin || orgIds.includes(organizationId))) {
            return NextResponse.json({ error: 'Forbidden: no mailbox access to this organization' }, { status: 403 });
        }
    } else if (orgIds.length === 1) {
        organizationId = orgIds[0];
    } else if (orgIds.length > 1) {
        return NextResponse.json({ error: 'organization_id is required (multiple organizations)' }, { status: 400 });
    } else {
        return NextResponse.json({ error: 'Forbidden: the purchase mailbox is restricted to procurement and super admins' }, { status: 403 });
    }

    const roles = [...new Set(
        memberships.filter(m => m.organization_id === organizationId && m.role).map(m => m.role as string),
    )];
    const isSuperAdmin = isMasterAdmin || roles.some(r => SUPER_ADMIN_ROLES.includes(r));

    return { user, organizationId, isSuperAdmin, roles };
}

export function isMailboxAccessError(x: MailboxAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}
