import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = request.nextUrl;
        const propertyId = searchParams.get('propertyId');
        const companyId = searchParams.get('companyId');
        const userId = searchParams.get('userId');

        if (!propertyId) return NextResponse.json({ error: 'propertyId required' }, { status: 400 });

        // Admin check (simplified, we trust supabaseAdmin for the actual query)
        const { data: membership } = await supabaseAdmin
            .from('property_memberships')
            .select('role')
            .eq('property_id', propertyId)
            .eq('user_id', user.id)
            .maybeSingle();

        const isAdmin = ['property_admin', 'staff', 'org_admin'].includes(membership?.role || '');

        let query = supabaseAdmin
            .from('meeting_room_credit_log')
            .select('*, performed_by_user:users!performed_by(full_name)')
            .order('created_at', { ascending: false });

        if (companyId) {
            query = query.eq('company_id', companyId);
        } else if (userId) {
            query = query.eq('user_id', userId);
        } else {
            // Global property logs
            query = query.eq('organization_id', (await supabaseAdmin.from('properties').select('organization_id').eq('id', propertyId).single()).data?.organization_id);
        }

        // Only let non-admins see their own history
        if (!isAdmin) {
            if (userId && userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            if (!userId && !companyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { data: logs, error } = await query.limit(50);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ logs: logs || [] });
    } catch (err) {
        console.error('[Credit History GET]', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
