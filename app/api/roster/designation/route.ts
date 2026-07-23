import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { propertyId, userId, designation } = body;

        if (!propertyId || !userId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const { error } = await supabase
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
