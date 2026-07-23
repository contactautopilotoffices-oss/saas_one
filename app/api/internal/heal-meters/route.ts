import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET(request: Request) {
    try {
        const supabase = await createClient();
        
        // 1. Fetch all electricity meters
        const { data: meters, error: mErr } = await supabase.from('electricity_meters').select('*').order('created_at', { ascending: true });
        if (mErr) throw mErr;

        if (!meters) return NextResponse.json({ msg: 'No meters' });

        // Group by name
        const groups: Record<string, any[]> = {};
        for (const m of meters) {
            const name = m.name.toLowerCase().trim();
            if (!groups[name]) groups[name] = [];
            groups[name].push(m);
        }

        let healedCount = 0;
        const logs = [];

        // For each group with duplicates
        for (const name in groups) {
            if (groups[name].length > 1) {
                // We have duplicates!
                // The first one is the OLD meter (has historical data)
                // The last one is the NEW meter (created by CSV upload, linked to spreadsheet)
                const oldMeters = groups[name].slice(0, groups[name].length - 1);
                const newMeter = groups[name][groups[name].length - 1];

                for (const oldMeter of oldMeters) {
                    logs.push(`Migrating data from OLD '${oldMeter.name}' (${oldMeter.id}) to NEW '${newMeter.name}' (${newMeter.id})`);
                    
                    // 1. Move all electricity_readings to new meter
                    await supabase.from('electricity_readings')
                        .update({ meter_id: newMeter.id })
                        .eq('meter_id', oldMeter.id);

                    // 2. Move all facility_meter_readings to new meter
                    await supabase.from('facility_meter_readings')
                        .update({ meter_id: newMeter.id })
                        .eq('meter_id', oldMeter.id);

                    // 3. Move multipliers if needed (Optional, usually we just keep the new one)
                    
                    // 4. Update the new meter's last_reading if the old one had a bigger one (or just let it be)
                    // We'll recalculate last_reading based on the absolute latest reading later.

                    // 5. Delete the old meter (this safely removes the ghost card from the UI)
                    await supabase.from('electricity_meters').delete().eq('id', oldMeter.id);
                    healedCount++;
                }

                // Recalculate latest reading for the new meter
                const { data: latest } = await supabase.from('electricity_readings')
                    .select('closing_reading')
                    .eq('meter_id', newMeter.id)
                    .order('reading_date', { ascending: false })
                    .limit(1);

                if (latest && latest.length > 0) {
                    await supabase.from('electricity_meters')
                        .update({ last_reading: latest[0].closing_reading })
                        .eq('id', newMeter.id);
                }
            }
        }

        return NextResponse.json({ success: true, healedCount, logs });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
