import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolvePettyCashAccess, isPettyCashAccessError, readOrgId } from '@/backend/lib/pettyCash/access';

/**
 * GET /api/properties/[propertyId]/approvers?q=search_term
 * Returns a list of candidate approvers for the specified property (property admins, managers, org admins).
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const access = await resolvePettyCashAccess(request, readOrgId(request));
    if (isPettyCashAccessError(access)) return access;

    const sp = new URL(request.url).searchParams;
    const search = (sp.get('q') || sp.get('search') || '').trim();

    try {
        // Fetch property members who are non-tenants (property admins, managers, supervisors, etc.)
        let propQuery = supabaseAdmin
            .from('property_memberships')
            .select(`
                user_id,
                role,
                user:users!inner(id, full_name, email)
            `)
            .eq('property_id', propertyId)
            .eq('is_active', true)
            .not('role', 'in', '("tenant","tenant_user","super_tenant","vendor")');

        if (search) {
            propQuery = propQuery.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`, { foreignTable: 'users' });
        }

        // Fetch org admins / master admins
        let orgQuery = supabaseAdmin
            .from('organization_memberships')
            .select(`
                user_id,
                role,
                user:users!inner(id, full_name, email)
            `)
            .eq('organization_id', access.organizationId)
            .eq('is_active', true)
            .in('role', ['org_super_admin', 'org_admin', 'master_admin', 'ops_super_admin']);

        if (search) {
            orgQuery = orgQuery.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`, { foreignTable: 'users' });
        }

        const [propRes, orgRes] = await Promise.all([propQuery.limit(30), orgQuery.limit(30)]);

        const map = new Map<string, { id: string; name: string; email?: string; role?: string }>();

        (orgRes.data || []).forEach((m: any) => {
            if (m.user && m.user.id) {
                map.set(m.user.id, {
                    id: m.user.id,
                    name: m.user.full_name || m.user.email || 'Admin',
                    email: m.user.email,
                    role: m.role
                });
            }
        });

        (propRes.data || []).forEach((m: any) => {
            if (m.user && m.user.id && !map.has(m.user.id)) {
                map.set(m.user.id, {
                    id: m.user.id,
                    name: m.user.full_name || m.user.email || 'User',
                    email: m.user.email,
                    role: m.role
                });
            }
        });

        const approvers = Array.from(map.values());
        return NextResponse.json({ approvers });
    } catch (err: any) {
        console.error('Approvers GET error:', err);
        return NextResponse.json({ error: err.message || 'Failed to fetch approvers' }, { status: 500 });
    }
}
