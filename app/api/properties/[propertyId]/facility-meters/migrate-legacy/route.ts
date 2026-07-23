import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function POST(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { propertyId } = await params;

        // 1. Fetch Legacy Meters
        const { data: legacyMeters, error: meterErr } = await supabase
            .from('electricity_meters')
            .select('*')
            .eq('property_id', propertyId)
            .is('deleted_at', null);

        if (meterErr) throw meterErr;
        if (!legacyMeters || legacyMeters.length === 0) {
            return NextResponse.json({ success: true, message: 'No legacy meters found to migrate.' });
        }

        // 2. Fetch Multipliers to preserve constants
        const { data: multipliers } = await supabase
            .from('meter_multipliers')
            .select('*')
            .in('meter_id', legacyMeters.map(m => m.id));

        // 3. Create the Default Hierarchy
        const { data: category, error: catErr } = await supabase
            .from('facility_meter_categories')
            .insert({ property_id: propertyId, name: 'Legacy Electricity', meter_type: 'electricity' })
            .select('id')
            .single();
        if (catErr) throw catErr;

        const { data: group, error: grpErr } = await supabase
            .from('facility_meter_groups')
            .insert({ category_id: category.id, name: 'Main Location' })
            .select('id')
            .single();
        if (grpErr) throw grpErr;

        // 4. Migrate Meters
        const meterIdMap: Record<string, string> = {}; // maps legacy ID to new ID
        
        for (const lm of legacyMeters) {
            // Find the most recent multiplier, or default to 1
            const mults = (multipliers || []).filter(m => m.meter_id === lm.id).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const constant = mults.length > 0 ? mults[0].multiplier_value : 1.0;

            const { data: newMeter, error: newMeterErr } = await supabase
                .from('facility_meters')
                .insert({
                    id: lm.id, // CRITICAL FIX: Ensure identical ID
                    group_id: group.id,
                    name: lm.name,
                    meter_constant: constant
                })
                .select('id')
                .single();
            
            if (newMeterErr) throw newMeterErr;
            meterIdMap[lm.id] = newMeter.id;
        }

        // 5. Migrate Historical Readings
        const { data: legacyReadings } = await supabase
            .from('electricity_readings')
            .select('*')
            .in('meter_id', legacyMeters.map(m => m.id));

        if (legacyReadings && legacyReadings.length > 0) {
            const readingsPayload = legacyReadings.map(lr => {
                const mults = (multipliers || []).filter(m => m.meter_id === lr.meter_id).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                const constant = mults.length > 0 ? mults[0].multiplier_value : 1.0;

                return {
                    meter_id: meterIdMap[lr.meter_id],
                    reading_date: lr.reading_date,
                    initial_reading: lr.opening_reading,
                    final_reading: lr.closing_reading,
                    consumption: lr.final_units !== null && lr.final_units !== undefined ? lr.final_units : lr.computed_units,
                    meter_constant_used: constant,
                    is_rollover: false
                };
            });

            // Upsert readings in batches of 500 to avoid request size limits
            const chunkSize = 500;
            for (let i = 0; i < readingsPayload.length; i += chunkSize) {
                const chunk = readingsPayload.slice(i, i + chunkSize);
                const { error: readErr } = await supabase
                    .from('facility_meter_readings')
                    .upsert(chunk, { onConflict: 'meter_id,reading_date' });
                if (readErr) throw readErr;
            }
        }

        return NextResponse.json({ success: true, count: legacyMeters.length, readingCount: legacyReadings?.length || 0 });

    } catch (error: any) {
        console.error('[Migrate Legacy API Error]:', error);
        return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
}
