import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();

    const { data, error } = await supabase
        .from('water_sources')
        .select(`
            *,
            water_tariffs(id, rate_per_unit, effective_from, effective_to)
        `)
        .eq('property_id', propertyId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const body = await request.json();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
        .from('water_sources')
        .insert({
            property_id: propertyId,
            name: body.name,
            source_type: body.source_type,
            capacity_litres: body.capacity_litres || null,
            created_by: user.id,
            updated_by: user.id
        })
        .select()
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data, { status: 201 });
}
