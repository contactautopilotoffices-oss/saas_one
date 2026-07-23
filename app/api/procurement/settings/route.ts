import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

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
            return NextResponse.json({ error: 'Property ID or Organization ID is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // 1. Fetch visibility settings
        let visibilityQuery = adminSupabase
            .from('procurement_price_visibility')
            .select('*');

        if (propertyId) {
            visibilityQuery = visibilityQuery.eq('property_id', propertyId);
        } else {
            visibilityQuery = visibilityQuery.eq('organization_id', organizationId);
        }

        const { data: visibilityData, error: visibilityError } = await visibilityQuery;

        if (visibilityError) {
            console.error('Error fetching visibility:', visibilityError);
        }

        // 2. Merge data
        if (propertyId) {
            const visibility = visibilityData?.[0] || {};
            return NextResponse.json({
                roles: visibility.roles || [],
                users: visibility.users || []
            });
        } else {
            return NextResponse.json(visibilityData || []);
        }
    } catch (error) {
        console.error('Final API Error:', error);
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
        const {
            property_id,
            organization_id,
            price_visibility_roles,
            price_visibility_users
        } = body;

        if (!property_id || !organization_id) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();
        const results = [];

        // Update visibility if provided
        if (price_visibility_roles !== undefined || price_visibility_users !== undefined) {
            results.push(
                adminSupabase
                    .from('procurement_price_visibility')
                    .upsert({
                        property_id,
                        organization_id,
                        roles: price_visibility_roles || [],
                        users: price_visibility_users || [],
                        updated_at: new Date().toISOString()
                    })
                    .select()
                    .single()
            );
        }

        const settled = await Promise.allSettled(results);
        const errors = settled
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map(r => r.reason);

        if (errors.length > 0) {
            console.error('Save errors:', errors);
            return NextResponse.json({ error: 'Failed to save some settings' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
