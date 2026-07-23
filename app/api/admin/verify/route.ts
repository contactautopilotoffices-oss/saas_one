import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

/**
 * GET /api/admin/verify
 * 
 * Verify if the current user is a Master Admin
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ isMasterAdmin: false }, { status: 401 });
        }

        // Check is_master_admin column from database
        const adminClient = createAdminClient();
        const { data: userRecord, error: checkError } = await adminClient
            .from('users')
            .select('is_master_admin')
            .eq('id', user.id)
            .single();

        if (checkError) {
            // Log error without exposing details
            return NextResponse.json({ isMasterAdmin: false }, { status: 500 });
        }

        return NextResponse.json({
            isMasterAdmin: userRecord?.is_master_admin === true
        });

    } catch (error) {
        console.error('Verify admin API error:', error);
        return NextResponse.json({ isMasterAdmin: false }, { status: 500 });
    }
}
