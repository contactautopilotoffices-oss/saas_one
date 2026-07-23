import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const supabase = await createClient();
    const body = await request.json();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Ensure older open-ended tariffs for this source are closed
    if (body.effective_from) {
        await supabase
            .from('water_tariffs')
            .update({ effective_to: new Date(new Date(body.effective_from).getTime() - 86400000).toISOString().split('T')[0] })
            .eq('source_id', body.source_id)
            .is('effective_to', null);
    }

    const { data, error } = await supabase
        .from('water_tariffs')
        .insert({
            source_id: body.source_id,
            rate_per_unit: body.rate_per_unit,
            effective_from: body.effective_from || new Date().toISOString().split('T')[0],
            created_by: user.id
        })
        .select()
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data, { status: 201 });
}
