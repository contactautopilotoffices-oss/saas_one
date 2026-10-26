import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tickets/mention-users?propertyId=xxx&organizationId=yyy&search=zzz
 *
 * Returns active users available for @mention and assignment in a ticket.
 * Uses admin client to bypass client RLS restrictions while ensuring caller is authenticated.
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser();

        if (authError || !currentUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const propertyId = searchParams.get('propertyId');
        let organizationId = searchParams.get('organizationId');
        const search = searchParams.get('search')?.trim().toLowerCase() || '';

        if (!propertyId && !organizationId) {
            return NextResponse.json(
                { error: 'Missing required parameter: propertyId or organizationId' },
                { status: 400 }
            );
        }

        const adminClient = createAdminClient();

        // Resolve property and its organization if propertyId is provided
        if (propertyId && !organizationId) {
            const { data: prop } = await adminClient
                .from('properties')
                .select('organization_id')
                .eq('id', propertyId)
                .maybeSingle();

            if (prop?.organization_id) {
                organizationId = prop.organization_id;
            }
        }

        // Fetch property memberships and organization memberships in parallel
        const [propResult, orgResult] = await Promise.all([
            propertyId
                ? adminClient
                    .from('property_memberships')
                    .select('role, custom_designation, user:users!property_memberships_user_id_fkey(id, full_name, email)')
                    .eq('property_id', propertyId)
                    .eq('is_active', true)
                : Promise.resolve({ data: [] as any[], error: null }),
            organizationId
                ? adminClient
                    .from('organization_memberships')
                    .select('role, user:users!organization_memberships_user_id_fkey(id, full_name, email)')
                    .eq('organization_id', organizationId)
                    .eq('is_active', true)
                : Promise.resolve({ data: [] as any[], error: null }),
        ]);

        if (propResult.error) {
            console.error('Error fetching property memberships for mention:', propResult.error);
        }
        if (orgResult.error) {
            console.error('Error fetching org memberships for mention:', orgResult.error);
        }

        const userMap = new Map<string, { id: string; full_name: string; role: string; designation: string; email?: string }>();

        // 1. Add property members first (higher precedence for property-specific role)
        (propResult.data || []).forEach((m: any) => {
            const u = m.user;
            if (u && u.id && u.full_name && typeof u.full_name === 'string') {
                const name = u.full_name.trim();
                if (name) {
                    userMap.set(u.id, {
                        id: u.id,
                        full_name: name,
                        role: m.role || '',
                        designation: m.custom_designation || m.role || '',
                        email: u.email || '',
                    });
                }
            }
        });

        // 2. Add organization members if not already added
        (orgResult.data || []).forEach((m: any) => {
            const u = m.user;
            if (u && u.id && u.full_name && typeof u.full_name === 'string' && !userMap.has(u.id)) {
                const name = u.full_name.trim();
                if (name) {
                    userMap.set(u.id, {
                        id: u.id,
                        full_name: name,
                        role: m.role || '',
                        designation: m.role || '',
                        email: u.email || '',
                    });
                }
            }
        });

        let users = Array.from(userMap.values());

        // 3. Filter by search query if provided
        if (search) {
            users = users.filter((u) =>
                u.full_name.toLowerCase().includes(search) ||
                u.role.toLowerCase().includes(search) ||
                u.designation.toLowerCase().includes(search) ||
                (u.email && u.email.toLowerCase().includes(search))
            );
        }

        // 4. Sort alphabetically by full_name
        users.sort((a, b) => a.full_name.localeCompare(b.full_name));

        return NextResponse.json({ users });
    } catch (err: any) {
        console.error('Error in /api/tickets/mention-users:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
