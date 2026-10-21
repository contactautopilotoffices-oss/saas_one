import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { isCreditExemptBooker } from '@/backend/lib/meetingRooms/creditExempt';

/**
 * GET /api/meeting-rooms/bookable-properties?orgId=
 * Properties in the organization that have at least one active meeting room.
 * For HR and CRM users, who hold an org-level role and no property membership,
 * so RLS on `properties` would hide every property from a client-side query.
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const orgId = request.nextUrl.searchParams.get('orgId');
        if (!orgId) {
            return NextResponse.json({ error: 'Missing orgId' }, { status: 400 });
        }

        if (!(await isCreditExemptBooker(user.id, orgId))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { data: properties, error: propError } = await supabaseAdmin
            .from('properties')
            .select('id, name')
            .eq('organization_id', orgId)
            .is('deleted_at', null)
            .order('name', { ascending: true });

        if (propError) {
            console.error('Error fetching bookable properties:', propError);
            return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
        }

        const propertyIds = (properties || []).map(p => p.id);
        if (propertyIds.length === 0) {
            return NextResponse.json({ properties: [] });
        }

        const { data: rooms, error: roomsError } = await supabaseAdmin
            .from('meeting_rooms')
            .select('property_id')
            .in('property_id', propertyIds)
            .eq('status', 'active');

        if (roomsError) {
            console.error('Error fetching meeting rooms for properties:', roomsError);
            return NextResponse.json({ error: 'Failed to fetch meeting rooms' }, { status: 500 });
        }

        const roomCount: Record<string, number> = {};
        (rooms || []).forEach(r => { roomCount[r.property_id] = (roomCount[r.property_id] || 0) + 1; });

        const bookable = (properties || [])
            .filter(p => roomCount[p.id])
            .map(p => ({ id: p.id, name: p.name, room_count: roomCount[p.id] }));

        return NextResponse.json({ properties: bookable });
    } catch (error) {
        console.error('Bookable properties GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
