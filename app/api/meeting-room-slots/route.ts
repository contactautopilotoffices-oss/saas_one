import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { hasAnyOrgOrPropRole } from '@/backend/lib/meetingRooms/bookingVisibility';

/**
 * GET /api/meeting-room-slots
 * Fetch all predefined meeting room slots
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: slots, error: fetchError } = await supabase
            .from('meeting_room_slots')
            .select('*')
            .order('start_time', { ascending: true });

        if (fetchError) {
            console.error('Error fetching meeting room slots:', fetchError);
            return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 });
        }

        return NextResponse.json({ slots: slots || [] });
    } catch (error) {
        console.error('Meeting Room Slots GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * POST /api/meeting-room-slots
 * Create a new meeting room slot (Admin/Staff only)
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { start_time, end_time } = body;

        if (!start_time || !end_time) {
            return NextResponse.json(
                { error: 'Missing required fields: start_time, end_time' },
                { status: 400 }
            );
        }

        // We check if they are an org admin (including org_super_admin/ops_super_admin/master_admin) or property admin.
        const hasAccess = await hasAnyOrgOrPropRole(
            user.id,
            ['property_admin', 'staff', 'mst', 'ops_super_admin'],
            ['org_admin', 'org_super_admin', 'ops_super_admin', 'master_admin']
        );

        if (!hasAccess) {
             return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
        }

        const { data: slot, error: insertError } = await supabase
            .from('meeting_room_slots')
            .insert({ start_time, end_time })
            .select('*')
            .single();

        if (insertError) {
            console.error('Error creating meeting room slot:', insertError);
            return NextResponse.json({ error: 'Failed to create slot' }, { status: 500 });
        }

        return NextResponse.json({ success: true, slot }, { status: 201 });
    } catch (error) {
        console.error('Meeting Room Slots POST error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
