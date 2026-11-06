import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

const requesterRoles = ['org_super_admin', 'ops_super_admin', 'master_admin', 'procurement',
    'purchase_manager', 'purchase_executive', 'property_admin', 'property_manager'];
const approverRoles = ['org_super_admin', 'ops_super_admin'];
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const organizationId = request.nextUrl.searchParams.get('organization_id') || '';
        if (!z.string().uuid().safeParse(organizationId).success) {
            return NextResponse.json({ error: 'Select a valid organization' }, { status: 400 });
        }
        const client = await createClient();
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const admin = createAdminClient();
        const { data: profile, error: profileError } = await admin.from('users')
            .select('is_master_admin,deleted_at').eq('id', user.id).maybeSingle();
        if (profileError) throw profileError;
        if (!profile || profile.deleted_at) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        if (!profile.is_master_admin) {
            const memberships = await Promise.all(['organization_memberships', 'property_memberships'].map(table =>
                admin.from(table).select('role').eq('user_id', user.id)
                    .eq('organization_id', organizationId).eq('is_active', true)));
            if (memberships.some(result => result.error)) throw new Error('Access check unavailable');
            // Check legacy aliases in code; unknown literals would fail an app_role enum SQL filter.
            if (!memberships.some(result => result.data?.some(member => requesterRoles.includes(member.role)))) {
                return NextResponse.json({ error: 'Procurement or admin access to this organization is required' }, { status: 403 });
            }
        }
        // Load the small, authorized directory server-side: browser RLS may hide other admins.
        const users = new Map<string, { id: string; full_name: string; email: string; role: string }>();
        const pageSize = 500;
        for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await admin.from('organization_memberships')
                .select('role,user:users!user_id(id,full_name,email,deleted_at)')
                .eq('organization_id', organizationId).eq('is_active', true).in('role', approverRoles)
                .order('user_id').range(offset, offset + pageSize - 1);
            if (error) throw error;
            for (const member of data || []) {
                const profile = Array.isArray(member.user) ? member.user[0] : member.user;
                if (!profile?.id || profile.deleted_at) continue;
                users.set(profile.id, { id: profile.id, full_name: profile.full_name || '',
                    email: profile.email || '', role: member.role });
            }
            if (!data || data.length < pageSize) break;
        }
        const approvers = [...users.values()].sort((a, b) =>
            (a.full_name || a.email).localeCompare(b.full_name || b.email) || a.id.localeCompare(b.id));
        return NextResponse.json({ approvers }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch {
        return NextResponse.json({ error: 'Could not load approvers. Please retry.' }, { status: 503 });
    }
}
