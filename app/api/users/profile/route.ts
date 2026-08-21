import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const adminSupabase = createAdminClient();
        const { data: dbUser, error: dbError } = await adminSupabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

        if (dbError) {
            return NextResponse.json({ error: dbError.message }, { status: 500 });
        }

        return NextResponse.json({
            id: user.id,
            email: user.email,
            full_name: dbUser?.full_name || user.user_metadata?.full_name || '',
            phone: dbUser?.phone || user.user_metadata?.phone || '',
            role: dbUser?.role || user.user_metadata?.role || '',
            user_metadata: user.user_metadata
        });
    } catch (err: any) {
        console.error('Error fetching user profile:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { full_name, phone } = body;

        const cleanName = full_name !== undefined ? String(full_name).trim() : undefined;
        let cleanPhone = phone !== undefined ? String(phone).replace(/[^0-9+]/g, '').trim() : undefined;

        const adminSupabase = createAdminClient();

        // 1. Direct Service-Role update to public.users table (bypasses RLS)
        const updateData: any = {};
        if (cleanName !== undefined) updateData.full_name = cleanName;
        if (cleanPhone !== undefined) updateData.phone = cleanPhone;

        const { data: updatedDbUser, error: updateError } = await adminSupabase
            .from('users')
            .update(updateData)
            .eq('id', user.id)
            .select()
            .single();

        if (updateError) {
            console.error('Error updating public.users table:', updateError);
            return NextResponse.json({ error: 'Failed to update database profile: ' + updateError.message }, { status: 500 });
        }

        // 2. Sync to Supabase Auth User metadata
        try {
            await adminSupabase.auth.admin.updateUserById(user.id, {
                user_metadata: {
                    ...(user.user_metadata || {}),
                    ...(cleanName !== undefined ? { full_name: cleanName } : {}),
                    ...(cleanPhone !== undefined ? { phone: cleanPhone } : {})
                }
            });
        } catch (authSyncErr) {
            console.warn('Warning updating auth user metadata:', authSyncErr);
        }

        return NextResponse.json({
            success: true,
            user: updatedDbUser
        });
    } catch (err: any) {
        console.error('Error updating user profile:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
