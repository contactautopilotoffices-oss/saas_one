import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { hasPropertyOrOrgRole } from '@/backend/lib/meetingRooms/bookingVisibility';

/**
 * GET /api/meeting-rooms
 * Fetch meeting rooms for a property
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const propertyId = searchParams.get('propertyId') || searchParams.get('property_id');
        const status = searchParams.get('status');

        if (!propertyId) {
            return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 });
        }

        let query = supabase
            .from('meeting_rooms')
            .select('*')
            .eq('property_id', propertyId)
            .order('name', { ascending: true });

        if (status) {
            query = query.eq('status', status);
        }

        const { data: rooms, error: fetchError } = await query;

        if (fetchError) {
            console.error('Error fetching meeting rooms:', fetchError);
            return NextResponse.json({ error: 'Failed to fetch meeting rooms' }, { status: 500 });
        }

        return NextResponse.json({ rooms: rooms || [] });
    } catch (error) {
        console.error('Meeting Rooms GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * POST /api/meeting-rooms
 * Create a new meeting room (Admin/Staff only)
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            name,
            photo_url,
            propertyId,
            location,
            capacity,
            size,
            amenities,
            status = 'active',
            hourly_rate
        } = body;

        if (!name || !photo_url || !propertyId || !capacity) {
            return NextResponse.json(
                { error: 'Missing required fields: name, photo_url, propertyId, capacity' },
                { status: 400 }
            );
        }

        // Check permissions (must be property_admin/staff/ops_super_admin for property OR org_admin/org_super_admin/ops_super_admin/master_admin for org)
        const hasAccess = await hasPropertyOrOrgRole(
            user.id,
            propertyId,
            ['property_admin', 'staff', 'mst', 'ops_super_admin'],
            ['org_admin', 'org_super_admin', 'ops_super_admin', 'master_admin']
        );
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
        }

        // Fetch organization_id from property
        const { data: property } = await supabase
            .from('properties')
            .select('organization_id')
            .eq('id', propertyId)
            .single();

        // Price per hour is optional. Only sent when set, so creating rooms keeps working
        // even before the hourly_rate migration is applied.
        let hourlyRate: number | null = null;
        if (hourly_rate !== undefined && hourly_rate !== null && hourly_rate !== '') {
            hourlyRate = typeof hourly_rate === 'number' || typeof hourly_rate === 'string' ? Number(hourly_rate) : NaN;
            if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
                return NextResponse.json({ error: 'Price per hour must be a number of 0 or more' }, { status: 400 });
            }
        }

        const { data: room, error: insertError } = await supabase
            .from('meeting_rooms')
            .insert({
                name,
                photo_url,
                property_id: propertyId,
                organization_id: property?.organization_id,
                location,
                capacity,
                size,
                amenities: amenities || [],
                status,
                created_by: user.id,
                ...(hourlyRate !== null ? { hourly_rate: hourlyRate } : {})
            })
            .select('*')
            .single();

        if (insertError) {
            console.error('Error creating meeting room:', insertError);
            return NextResponse.json({ error: 'Failed to create meeting room' }, { status: 500 });
        }

        return NextResponse.json({ success: true, room }, { status: 201 });
    } catch (error) {
        console.error('Meeting Rooms POST error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
