import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * Accounts / Payment Tracker access (service-role, enforced in the API layer).
 *
 *   - View the tracker:  accounts + procurement + org admins + super/master.
 *   - Align a payment (procurement action): procurement + admins + accounts.
 *   - Complete a payment / enter UTR (finance): the `accounts` role + super/master.
 */

const ORG_ADMIN_ROLES = ['org_super_admin', 'org_admin', 'master_admin'];
// NOTE: property_admin is deliberately NOT a procurement role here. Property admins run
// a site, not the purchase ledger, and must not reach the Payment Tracker at all.
const PROCUREMENT_ROLES = ['purchase_manager', 'purchase_executive', 'procurement'];
// ops_super_admin is view-only here — the electricity checker role oversees payment
// status but must not inherit align/complete authority (see the role's own doc comment
// in 20260804000002_electricity_validation_and_ops_role.sql). It stays out of
// ALIGN_ROLES/COMPLETE_ROLES below on purpose.
const VIEW_ROLES = [...new Set([...ORG_ADMIN_ROLES, ...PROCUREMENT_ROLES, 'accounts', 'ops_super_admin'])];
const ALIGN_ROLES = [...new Set([...ORG_ADMIN_ROLES, ...PROCUREMENT_ROLES, 'accounts'])];
const COMPLETE_ROLES = ['accounts', 'org_super_admin', 'master_admin'];

export interface AccountsAccess {
    user: { id: string; email?: string };
    isMasterAdmin: boolean;
    organizationId: string;
    isAdmin: boolean;
    canAlign: boolean;
    canComplete: boolean;
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
    return sp.get('org_id') || sp.get('organization_id') || sp.get('orgId') || body?.organization_id || body?.org_id || null;
}

/**
 * Same rules as resolveAccountsAccess, for an already-established identity.
 *
 * Used by the one-click email actions, where the actor comes from a single-use token
 * rather than a session. Permissions are still derived from LIVE memberships at call
 * time, so a token issued last week cannot outlive the access it was issued under.
 */
export async function resolveAccountsAccessForUser(
    user: { id: string; email?: string },
    requestedOrgId?: string | null,
): Promise<AccountsAccess | NextResponse> {
    return resolveAccessForUser(user, requestedOrgId);
}

export async function resolveAccountsAccess(
    request: NextRequest,
    requestedOrgId?: string | null,
): Promise<AccountsAccess | NextResponse> {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return resolveAccessForUser(user, requestedOrgId);
}

async function resolveAccessForUser(
    user: { id: string; email?: string },
    requestedOrgId?: string | null,
): Promise<AccountsAccess | NextResponse> {
    const { data: profile } = await supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle();
    const isMasterAdmin = !!profile?.is_master_admin;

    const [propRes, orgRes] = await Promise.all([
        supabaseAdmin.from('property_memberships').select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('organization_memberships').select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
    ]);
    const memberships: Membership[] = [...(propRes.data || []), ...(orgRes.data || [])];
    const viewMemberships = memberships.filter((m) => m.role && VIEW_ROLES.includes(m.role));

    const orgIds = [...new Set(viewMemberships.map((m) => m.organization_id).filter(Boolean))] as string[];
    let organizationId: string | null = requestedOrgId || null;
    if (organizationId) {
        if (!(isMasterAdmin || orgIds.includes(organizationId)))
            return NextResponse.json({ error: 'Forbidden: no accounts access to this organization' }, { status: 403 });
    } else if (orgIds.length === 1) {
        organizationId = orgIds[0];
    } else if (orgIds.length > 1) {
        return NextResponse.json({ error: 'organization_id is required (multiple organizations)' }, { status: 400 });
    } else if (isMasterAdmin) {
        return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    } else {
        return NextResponse.json({ error: 'Forbidden: no accounts access' }, { status: 403 });
    }

    const roles = [...new Set(memberships.filter((m) => m.organization_id === organizationId && m.role).map((m) => m.role as string))];
    const isAdmin = isMasterAdmin || roles.some((r) => ORG_ADMIN_ROLES.includes(r));
    const canAlign = isMasterAdmin || roles.some((r) => ALIGN_ROLES.includes(r));
    const canComplete = isMasterAdmin || roles.some((r) => COMPLETE_ROLES.includes(r));

    return { user, isMasterAdmin, organizationId, isAdmin, canAlign, canComplete, roles };
}

export function isAccountsAccessError(x: AccountsAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}
