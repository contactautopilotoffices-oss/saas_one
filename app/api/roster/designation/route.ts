import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { guardProperty } from '@/backend/lib/auth/callerAccess';

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const { propertyId, userId, designation } = body;

        if (!propertyId || !userId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify caller has internal access to this property
        const denied = await guardProperty(request, propertyId);
        if (denied) return denied;

        const adminClient = createAdminClient();

        const { error } = await adminClient
            .from('property_memberships')
            .update({ custom_designation: designation || null })
            .eq('property_id', propertyId)
            .eq('user_id', userId);

        if (error) {
            console.error('[PATCH /api/roster/designation] Update error:', error);
            return NextResponse.json({ error: 'Failed to update designation' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[PATCH /api/roster/designation] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
