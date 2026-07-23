import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(request.url);
        const propertyId = url.searchParams.get('propertyId');
        const staffUserId = url.searchParams.get('userId');

        if (!propertyId || !staffUserId) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
        }

        // Verify caller is a property_admin for this property
        const { data: callerMembership } = await supabase
            .from('property_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('property_id', propertyId)
            .eq('is_active', true)
            .maybeSingle();

        if (!callerMembership || callerMembership.role !== 'property_admin') {
            return NextResponse.json({ error: 'Only property admins can remove staff from the roster' }, { status: 403 });
        }

        // Deactivate membership
        const { error } = await supabase
            .from('property_memberships')
            .update({ is_active: false })
            .eq('user_id', staffUserId)
            .eq('property_id', propertyId);

        if (error) {
            console.error('[DELETE /api/roster/remove-staff] Update error:', error);
            return NextResponse.json({ error: 'Failed to remove staff from property' }, { status: 500 });
        }

        const adminClient = createAdminClient();
        await adminClient.from('user_management_audit_logs').insert({
            action: 'remove_staff',
            target_user_id: staffUserId,
            admin_user_id: user.id,
            details: { propertyId }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[DELETE /api/roster/remove-staff] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
