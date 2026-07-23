import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { propertyId, fullName, designation } = body;

        if (!propertyId || !fullName) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('offline_roster_staff')
            .insert([{
                property_id: propertyId,
                full_name: fullName,
                custom_designation: designation || null
            }])
            .select()
            .single();

        if (error) {
            console.error('[POST /api/roster/offline] Insert error:', error);
            return NextResponse.json({ error: 'Failed to add offline staff' }, { status: 500 });
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error('[POST /api/roster/offline] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
        const { offlineStaffId, designation, fullName } = body;

        if (!offlineStaffId) {
            return NextResponse.json({ error: 'Missing offline staff ID' }, { status: 400 });
        }

        const updateData: any = {};
        if (designation !== undefined) updateData.custom_designation = designation;
        if (fullName !== undefined && fullName.trim() !== '') updateData.full_name = fullName.trim();

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ success: true });
        }

        const { data, error } = await supabase
            .from('offline_roster_staff')
            .update(updateData)
            .eq('id', offlineStaffId)
            .select()
            .single();

        if (error) {
            console.error('[PATCH /api/roster/offline] Update error:', error);
            return NextResponse.json({ error: 'Failed to update offline staff designation' }, { status: 500 });
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error('[PATCH /api/roster/offline] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(request.url);
        const offlineStaffId = url.searchParams.get('id');

        if (!offlineStaffId) {
            return NextResponse.json({ error: 'Missing offline staff ID' }, { status: 400 });
        }

        const { error } = await supabase
            .from('offline_roster_staff')
            .delete()
            .eq('id', offlineStaffId);

        if (error) {
            console.error('[DELETE /api/roster/offline] Delete error:', error);
            return NextResponse.json({ error: 'Failed to delete offline staff' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[DELETE /api/roster/offline] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
