import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

async function checkMeetingRoomPermission(userId: string, propertyId: string): Promise<boolean> {
    // 1. Check user global role in users table
    const { data: userRecord } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

    if (userRecord && ['master_admin', 'ops_super_admin', 'org_admin', 'admin', 'super_admin'].includes(userRecord.role)) {
        return true;
    }

    // 2. Check property membership role
    const { data: membership } = await supabaseAdmin
        .from('property_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('property_id', propertyId)
        .maybeSingle();

    if (membership && ['property_admin', 'staff', 'mst', 'admin', 'super_admin', 'ops_super_admin', 'org_admin'].includes(membership.role)) {
        return true;
    }

    // 3. Check organization membership role
    const { data: property } = await supabaseAdmin
        .from('properties')
        .select('organization_id')
        .eq('id', propertyId)
        .maybeSingle();

    if (property?.organization_id) {
        const { data: orgMembership } = await supabaseAdmin
            .from('organization_memberships')
            .select('role')
            .eq('user_id', userId)
            .eq('organization_id', property.organization_id)
            .maybeSingle();

        if (orgMembership && ['org_admin', 'org_super_admin', 'admin', 'master_admin'].includes(orgMembership.role)) {
            return true;
        }
    }

    return false;
}

/**
 * PATCH /api/meeting-rooms/[id]
 * Update meeting room details
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient();
        const { id } = await params;
        const body = await request.json();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { data: room, error: fetchError } = await supabaseAdmin
            .from('meeting_rooms')
            .select('property_id')
            .eq('id', id)
            .maybeSingle();

        if (fetchError || !room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

        // Permission check
        const hasAccess = await checkMeetingRoomPermission(user.id, room.property_id);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const {
            name,
            photo_url,
            location,
            capacity,
            size,
            amenities,
            status,
            propertyId
        } = body;

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (photo_url !== undefined) updateData.photo_url = photo_url;
        if (location !== undefined) updateData.location = location;
        if (capacity !== undefined) updateData.capacity = parseInt(capacity.toString());
        if (size !== undefined) updateData.size = size ? parseInt(size.toString()) : null;
        if (amenities !== undefined) updateData.amenities = amenities;
        if (status !== undefined) updateData.status = status;
        if (propertyId !== undefined) updateData.property_id = propertyId;

        // Recalculate organization_id if property is changing
        if (propertyId !== undefined && propertyId !== room.property_id) {
            const { data: newProperty } = await supabaseAdmin
                .from('properties')
                .select('organization_id')
                .eq('id', propertyId)
                .maybeSingle();
            if (newProperty) {
                updateData.organization_id = newProperty.organization_id;
            }
        }

        const { data: updated, error: updateError } = await supabaseAdmin
            .from('meeting_rooms')
            .update(updateData)
            .eq('id', id)
            .select('*')
            .single();

        if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
        return NextResponse.json({ success: true, room: updated });
    } catch (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * DELETE /api/meeting-rooms/[id]
 * Soft delete by setting status to inactive
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient();
        const { id } = await params;

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { data: room, error: fetchError } = await supabaseAdmin
            .from('meeting_rooms')
            .select('property_id')
            .eq('id', id)
            .maybeSingle();

        if (fetchError || !room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

        // Permission check
        const hasAccess = await checkMeetingRoomPermission(user.id, room.property_id);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { error: deleteError } = await supabaseAdmin
            .from('meeting_rooms')
            .update({ status: 'inactive' })
            .eq('id', id);

        if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

