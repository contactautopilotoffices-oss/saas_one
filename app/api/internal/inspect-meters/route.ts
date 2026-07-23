import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET() {
    try {
        const supabase = await createClient();
        
        // 1. Find EB-1 meter
        const { data: meter } = await supabase.from('electricity_meters').select('id, name').ilike('name', 'EB-1').single();
        if (!meter) return NextResponse.json({ error: 'No EB-1 meter' });

        // 2. Fetch all readings for EB-1
        const { data: readings } = await supabase.from('electricity_readings').select('reading_date, multiplier_value_used, final_units').eq('meter_id', meter.id).order('reading_date', { ascending: true });

        // Build a text string to see all
        const text = readings?.map(r => `${r.reading_date}: ${r.multiplier_value_used}`).join('\n') || '';

        return new NextResponse(text);
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
