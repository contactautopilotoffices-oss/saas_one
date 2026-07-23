import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const propertyId = searchParams.get('propertyId');
        const organizationId = searchParams.get('organizationId');

        if (!propertyId && !organizationId) {
            return NextResponse.json({ error: 'Property ID or Organization ID required' }, { status: 400 });
        }

        let query = supabaseAdmin
            .from('companies')
            .select(`
                *,
                members:company_members(
                    user_id,
                    role,
                    user:users(id, full_name, email)
                ),
                credits:meeting_room_credits(*)
            `);

        if (propertyId) query = query.eq('property_id', propertyId);
        if (organizationId) query = query.eq('organization_id', organizationId);

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching companies:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('Companies GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { property_id, organization_id, name, logo_url } = body;

        if (!property_id || !organization_id || !name) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const { data, error } = await supabaseAdmin
            .from('companies')
            .insert({
                property_id,
                organization_id,
                name,
                logo_url,
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating company:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('Companies POST error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
