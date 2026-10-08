import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export const isInternalPettyCashRole = (role: string | null | undefined) => Boolean(role && !/tenant|vendor/i.test(role));
export interface PettyCashAccess {
    user: { id: string; email?: string };
    isMasterAdmin: boolean;
    organizationId: string;
    isAdmin: boolean;
    canManageRouting: boolean;
    canAllocate: boolean;
    canApprove: boolean;
    canDisburse: boolean;
    propertyIds: string[];
    roles: string[];
}
export function readOrgId(request: NextRequest, body?: Record<string, unknown>): string | null {
    const q = new URL(request.url).searchParams;
    return q.get('org_id') || q.get('organization_id') || q.get('orgId') || String(body?.organization_id || body?.org_id || '') || null;
}
export async function resolvePettyCashAccess(request: NextRequest, org?: string | null): Promise<PettyCashAccess | NextResponse> {
    const client = await createClient();
    let user = (await client.auth.getUser()).data.user;
    if (!user) {
        const header = request.headers.get('authorization') || '';
        if (/^bearer /i.test(header)) user = (await supabaseAdmin.auth.getUser(header.slice(7))).data.user;
    }
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return resolvePettyCashAccessForUser({ id: user.id, email: user.email }, org);
}
export async function resolvePettyCashAccessForUser(user: { id: string; email?: string }, org?: string | null): Promise<PettyCashAccess | NextResponse> {
    const [profile, pm, om] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle(),
        supabaseAdmin.from('property_memberships').select('organization_id,property_id,role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('organization_memberships').select('organization_id,role').eq('user_id', user.id).eq('is_active', true),
    ]);
    if (profile.error || pm.error || om.error) return NextResponse.json({ error: 'Could not verify petty cash access' }, { status: 503 });
    const master = Boolean(profile.data?.is_master_admin);
    const memberships = [...(pm.data || []), ...(om.data || [])].filter(m => isInternalPettyCashRole(m.role));
    const orgs = [...new Set(memberships.map(m => m.organization_id).filter(Boolean))];
    const organizationId = org || (orgs.length === 1 ? orgs[0] : null);
    if (!organizationId) return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    if (!master && !orgs.includes(organizationId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (master) {
        const { error } = await supabaseAdmin.rpc('pc_audit_support', { actor: user.id, org: organizationId });
        if (error) return NextResponse.json({ error: 'Could not verify and audit selected-organization support access' }, { status: 503 });
    }
    const roles = [...new Set(memberships.filter(m => m.organization_id === organizationId).map(m => m.role as string))];
    const propertyIds = [...new Set((pm.data || []).filter(m => m.organization_id === organizationId && isInternalPettyCashRole(m.role)).map(m => m.property_id))];
    const [assignments, assigned] = await Promise.all([
        supabaseAdmin.from('petty_cash_property_assignments').select('kind').eq('organization_id', organizationId).eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('petty_cash_requests').select('assigned_allocator_id,assigned_approver_id').eq('organization_id', organizationId).or(`assigned_allocator_id.eq.${user.id},assigned_approver_id.eq.${user.id}`).limit(1),
    ]);
    if (assignments.error || assigned.error) return NextResponse.json({ error: 'Petty cash workflow migration must be applied before using this module' }, { status: 503 });
    const canManageRouting = roles.some(r => r === 'org_super_admin' || r === 'ops_super_admin');
    return {
        user, organizationId, roles, propertyIds, isMasterAdmin: master, isAdmin: master || canManageRouting, canManageRouting,
        canAllocate: Boolean(assignments.data?.some(a => a.kind === 'allocator') || assigned.data?.some(a => a.assigned_allocator_id === user.id)),
        canApprove: Boolean(assignments.data?.some(a => a.kind === 'approver') || assigned.data?.some(a => a.assigned_approver_id === user.id)),
        canDisburse: roles.includes('accounts'),
    };
}
export function isPettyCashAccessError(value: PettyCashAccess | NextResponse): value is NextResponse { return value instanceof NextResponse; }
