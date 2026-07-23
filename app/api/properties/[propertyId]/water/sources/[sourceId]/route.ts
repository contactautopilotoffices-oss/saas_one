import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

// Update a specific water source
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; sourceId: string }> }
) {
    const { propertyId, sourceId } = await params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();

        // 1. Validate property access
        const { data: membership } = await supabase
            .from('property_memberships')
            .select('role')
            .eq('property_id', propertyId)
            .eq('user_id', user.id)
            .eq('is_active', true)
            .single();

        if (!membership) return NextResponse.json({ error: 'Unauthorized for this property' }, { status: 403 });

        // 2. Update source
        const updateData: any = { updated_by: user.id, updated_at: new Date().toISOString() };
        if (body.name) updateData.name = body.name;
        if (body.source_type) updateData.source_type = body.source_type;
        if (body.capacity_litres !== undefined) updateData.capacity_litres = body.capacity_litres || null;
        if (body.is_active !== undefined) updateData.is_active = body.is_active;

        const { data, error } = await supabase
            .from('water_sources')
            .update(updateData)
            .eq('id', sourceId)
            .eq('property_id', propertyId)
            .select()
            .single();

        if (error) throw error;

        // 3. Optional: add new tariff if rate is provided
        if (body.rate_per_unit !== undefined) {
             const { error: tariffErr } = await supabase
                .from('water_tariffs')
                .insert({
                    source_id: sourceId,
                    rate_per_unit: body.rate_per_unit,
                    effective_from: new Date().toISOString().split('T')[0],
                    created_by: user.id
                });
             if(tariffErr) throw tariffErr;
        }

        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// Delete (soft delete via is_active = false)
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; sourceId: string }> }
) {
    const { propertyId, sourceId } = await params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { error } = await supabase
            .from('water_sources')
            .update({ is_active: false, updated_by: user.id, updated_at: new Date().toISOString() })
            .eq('id', sourceId)
            .eq('property_id', propertyId);

        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
