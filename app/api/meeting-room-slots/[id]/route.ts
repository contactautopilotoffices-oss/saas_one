import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * PUT /api/meeting-room-slots/[id]
 * Update a meeting room slot
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { start_time, end_time } = body;

        // Validation for Admin
        const { data: orgMembership } = await supabase
            .from('organization_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('role', 'org_admin')
            .limit(1);

        const { data: propMembership } = await supabase
            .from('property_memberships')
            .select('role')
            .eq('user_id', user.id)
            .in('role', ['property_admin', 'staff', 'mst'])
            .limit(1);

        const isSuperAdmin = orgMembership && orgMembership.length > 0;
        const isPropertyAdmin = propMembership && propMembership.length > 0;

        if (!isSuperAdmin && !isPropertyAdmin) {
             return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
        }

        const { data: slot, error: updateError } = await supabase
            .from('meeting_room_slots')
            .update({ start_time, end_time })
            .eq('id', id)
            .select('*')
            .single();

        if (updateError) {
            console.error('Error updating meeting room slot:', updateError);
            return NextResponse.json({ error: 'Failed to update slot' }, { status: 500 });
        }

        return NextResponse.json({ success: true, slot });
    } catch (error) {
        console.error('Meeting Room Slot PUT error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * DELETE /api/meeting-room-slots/[id]
 * Delete a meeting room slot
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Validation for Admin
        const { data: orgMembership } = await supabase
            .from('organization_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('role', 'org_admin')
            .limit(1);

        const { data: propMembership } = await supabase
            .from('property_memberships')
            .select('role')
            .eq('user_id', user.id)
            .in('role', ['property_admin', 'staff', 'mst'])
            .limit(1);

        const isSuperAdmin = orgMembership && orgMembership.length > 0;
        const isPropertyAdmin = propMembership && propMembership.length > 0;

        if (!isSuperAdmin && !isPropertyAdmin) {
             return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
        }

        const { error: deleteError } = await supabase
            .from('meeting_room_slots')
            .delete()
            .eq('id', id);

        if (deleteError) {
            console.error('Error deleting meeting room slot:', deleteError);
            return NextResponse.json({ error: 'Failed to delete slot' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Meeting Room Slot DELETE error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
