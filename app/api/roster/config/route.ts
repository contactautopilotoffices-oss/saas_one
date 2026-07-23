import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const propertyId = searchParams.get('propertyId') || searchParams.get('property_id');

        if (!propertyId) {
            return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
        }

        const supabase = await createClient();
        const { data, error } = await supabase
            .from('shift_configurations')
            .select('*')
            .eq('property_id', propertyId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('[GET /api/roster/config] Fetch error:', error);
            return NextResponse.json({ error: 'Failed to fetch shift configs' }, { status: 500 });
        }

        return NextResponse.json({ data: data || [] });
    } catch (error) {
        console.error('[GET /api/roster/config] API error:', error);
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
        const { propertyId, configs } = body;

        if (!propertyId || !Array.isArray(configs)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // Upsert configs
        const upsertData = configs.map((c: any) => {
            const row: any = {
                id: c.id || crypto.randomUUID(),
                property_id: propertyId,
                code: c.code,
                name: c.name,
                start_time: c.start_time || null,
                end_time: c.end_time || null,
                is_working_day: c.is_working_day ?? true,
                color: c.color || '#f1f5f9'
            };
            return row;
        });

        const { data, error } = await supabase
            .from('shift_configurations')
            .upsert(upsertData, { onConflict: 'property_id,code' })
            .select('*');

        if (error) {
            console.error('[POST /api/roster/config] Upsert error:', error);
            return NextResponse.json({ error: 'Failed to save shift configs' }, { status: 500 });
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error('[POST /api/roster/config] API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
