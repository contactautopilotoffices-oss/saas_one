import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function DELETE() {
    try {
        const supabase = await createClient();
        
        const metersToClear = [
            'Utility Panel', 'UPS O/P- 1', 'Meter Cubicle', 'MLP-01', 'LT Panel', 'UPS O/P- 2',
            'A-WING', 'B-WING', 'EB-1'
        ];

        // 1. Get meter IDs
        const { data: meters } = await supabase.from('electricity_meters').select('id, name').in('name', metersToClear);
        if (!meters || meters.length === 0) return NextResponse.json({ success: true, message: 'No meters found' });

        const meterIds = meters.map(m => m.id);

        // 2. Delete the specific dates I restored
        await supabase.from('electricity_readings').delete().in('meter_id', meterIds).in('reading_date', ['2026-06-20', '2026-06-21']);
        await supabase.from('facility_meter_readings').delete().in('meter_id', meterIds).in('reading_date', ['2026-06-20', '2026-06-21']);

        // 3. Reset the last_reading on the meters to 0
        await supabase.from('electricity_meters').update({ last_reading: 0 }).in('id', meterIds);

        return NextResponse.json({ success: true, message: 'Reverted screenshot restorations.' });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
