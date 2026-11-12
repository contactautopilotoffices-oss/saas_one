import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/vms-face/[propertyId]/hosts
 * Searchable list of hosts (active property members) for the VMS Face (testing) check-in form.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    try {
        const { propertyId } = await params;

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const search = (searchParams.get('q') || '').replace(/[,()%]/g, '').trim();
        const limit = Math.min(parseInt(searchParams.get('limit') || '20') || 20, 50);

        let query = supabaseAdmin
            .from('property_memberships')
            // property_memberships has two links to users (user_id, updated_by), so name the one to use.
            .select('user_id, role, user:users!user_id!inner(id, full_name, email)')
            .eq('property_id', propertyId)
            .eq('is_active', true);

        if (search) {
            query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`, { foreignTable: 'users' });
        }

        const { data: memberships, error } = await query
            .limit(limit)
            .order('full_name', { foreignTable: 'users' });

        if (error) {
            console.error('[VMS Face] Hosts fetch error:', error);
            return NextResponse.json({ error: 'Failed to fetch hosts' }, { status: 500 });
        }

        type MembershipRow = { user_id: string; role: string; user: { full_name: string; email: string } | { full_name: string; email: string }[] };
        const hosts = ((memberships || []) as MembershipRow[]).map(m => {
            const u = Array.isArray(m.user) ? m.user[0] : m.user;
            return { id: m.user_id, name: u?.full_name, email: u?.email, role: m.role };
        });

        return NextResponse.json({ hosts, total: hosts.length });
    } catch (error) {
        console.error('[VMS Face] Hosts error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
