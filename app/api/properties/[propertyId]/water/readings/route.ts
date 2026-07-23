import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const month = searchParams.get('month'); // YYYY-MM
    
    let query = supabase
        .from('water_readings')
        .select(`
            *,
            water_sources!inner(property_id)
        `)
        .eq('water_sources.property_id', propertyId);

    if (month) {
        const startDate = `${month}-01`;
        const nextMonth = new Date(startDate);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const endDateStr = nextMonth.toISOString().split('T')[0];
        
        query = query.gte('reading_date', startDate).lt('reading_date', endDateStr);
    }

    const { data, error } = await query;

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

    const computeReadingWithCost = async (reading: any) => {
        let tariffRate = 0;
        let tariffId = null;

        const { data: tariffData } = await supabase
            .from('water_tariffs')
            .select('id, rate_per_unit')
            .eq('source_id', reading.source_id)
            .lte('effective_from', reading.reading_date)
            .order('effective_from', { ascending: false })
            .limit(1);

        if (tariffData && tariffData.length > 0) {
            tariffId = tariffData[0].id;
            tariffRate = tariffData[0].rate_per_unit || 0;
        }

        const computedCost = (reading.quantity || 0) * tariffRate;

        return {
            source_id: reading.source_id,
            reading_date: reading.reading_date,
            quantity: reading.quantity || 0,
            tariff_id: tariffId,
            tariff_rate_used: tariffRate,
            computed_cost: computedCost,
            created_by: user.id,
            updated_by: user.id,
            updated_at: new Date().toISOString()
        };
    };

    if (Array.isArray(body.readings)) {
        const processedReadings = await Promise.all(
            body.readings.map((r: any) => computeReadingWithCost(r))
        );

        const { data, error } = await supabase
            .from('water_readings')
            .upsert(processedReadings, { onConflict: 'source_id,reading_date' })
            .select();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json(data, { status: 201 });
    }

    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
}
