import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

// GET readings for a specific month and meter group
export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { searchParams } = new URL(request.url);
        const month = searchParams.get('month'); // e.g. '2026-06'
        const categoryId = searchParams.get('categoryId');
        const { propertyId } = await params;

        if (!month || !categoryId) {
            return NextResponse.json({ error: 'Missing month or categoryId' }, { status: 400 });
        }

        const startDate = `${month}-01`;
        const nextMonthDate = new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + 1));
        const endDate = nextMonthDate.toISOString().split('T')[0];



        // 1.5 Get Category Type
        const { data: categoryData } = await supabase.from('facility_meter_categories').select('meter_type').eq('id', categoryId).single();
        const isElectricity = categoryData?.meter_type === 'electricity';

        // 1. Get all meters in this category
        const { data: groups } = await supabase.from('facility_meter_groups').select('id').eq('category_id', categoryId);
        const groupIds = groups?.map(g => g.id) || [];
        
        if (groupIds.length === 0) return NextResponse.json([]);

        const { data: meters } = await supabase.from('facility_meters').select('id').in('group_id', groupIds);
        const meterIds = meters?.map(m => m.id) || [];

        if (meterIds.length === 0) return NextResponse.json([]);

        let combinedReadings: any[] = [];

        // Standard generic facility_meter_readings
        const { data: readings, error } = await supabase
            .from('facility_meter_readings')
            .select('*')
            .in('meter_id', meterIds)
            .gte('reading_date', startDate)
            .lt('reading_date', endDate)
            .limit(10000);

        if (error) throw error;

        const { data: prevReadings, error: prevError } = await supabase
            .from('facility_meter_readings')
            .select('*')
            .in('meter_id', meterIds)
            .lt('reading_date', startDate)
            .order('reading_date', { ascending: false })
            .limit(10000);
            
        if (prevError) throw prevError;
        
        let mergedReadings = readings || [];
        let mergedPrevReadings = prevReadings || [];

        if (isElectricity) {
            const { data: legacyReadings } = await supabase
                .from('electricity_readings')
                .select('*')
                .in('meter_id', meterIds)
                .gte('reading_date', startDate)
                .lt('reading_date', endDate)
                .limit(10000);
                
            if (legacyReadings && legacyReadings.length > 0) {
                const existingKeys = new Set(mergedReadings.map(r => `${r.meter_id}_${r.reading_date}`));
                for (const lr of legacyReadings) {
                    if (!existingKeys.has(`${lr.meter_id}_${lr.reading_date}`)) {
                        mergedReadings.push({
                            meter_id: lr.meter_id,
                            reading_date: lr.reading_date,
                            initial_reading: lr.opening_reading,
                            final_reading: lr.closing_reading,
                            consumption: lr.final_units,
                            meter_constant_used: lr.multiplier_value_used,
                            is_rollover: false
                        });
                    }
                }
            }
            
            const { data: legacyPrev } = await supabase
                .from('electricity_readings')
                .select('*')
                .in('meter_id', meterIds)
                .lt('reading_date', startDate)
                .order('reading_date', { ascending: false })
                .limit(10000);
                
            if (legacyPrev && legacyPrev.length > 0) {
                const existingKeys = new Set(mergedPrevReadings.map(r => `${r.meter_id}_${r.reading_date}`));
                for (const lr of legacyPrev) {
                    if (!existingKeys.has(`${lr.meter_id}_${lr.reading_date}`)) {
                        mergedPrevReadings.push({
                            meter_id: lr.meter_id,
                            reading_date: lr.reading_date,
                            initial_reading: lr.opening_reading,
                            final_reading: lr.closing_reading,
                            consumption: lr.final_units,
                            meter_constant_used: lr.multiplier_value_used,
                            is_rollover: false
                        });
                    }
                }
                mergedPrevReadings.sort((a, b) => new Date(b.reading_date).getTime() - new Date(a.reading_date).getTime());
            }
        }
        
        const latestPrevMap = new Map();
        for (const pr of mergedPrevReadings) {
            if (!latestPrevMap.has(pr.meter_id)) {
                latestPrevMap.set(pr.meter_id, pr);
            }
        }

        combinedReadings = [...mergedReadings, ...Array.from(latestPrevMap.values())];

        return NextResponse.json(combinedReadings);

    } catch (error: any) {
        console.error('[Facility Readings GET Error]:', error);
        return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
}

// BULK UPSERT readings
export async function POST(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { propertyId } = await params;
        const body = await request.json();
        const { readings } = body; // Array of { meter_id, reading_date, initial_reading, final_reading, consumption, meter_constant_used, is_rollover }

        if (!readings || !Array.isArray(readings)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }



        // Check if any of these meters belong to an electricity category
        let isElectricity = false;
        if (readings.length > 0) {
            const meterId = readings[0].meter_id;
            const { data: meterData } = await supabase
                .from('facility_meters')
                .select('group_id, group:facility_meter_groups(category:facility_meter_categories(meter_type))')
                .eq('id', meterId)
                .single();
            // @ts-ignore
            if (meterData?.group?.category?.meter_type === 'electricity') {
                isElectricity = true;
            }
        }

        // Standard facility writing
        const payload = readings.map((r: any) => ({
            meter_id: r.meter_id,
            reading_date: r.reading_date,
            initial_reading: r.initial_reading,
            final_reading: r.final_reading,
            consumption: r.consumption,
            meter_constant_used: r.meter_constant_used || 1.0,
            is_rollover: r.is_rollover || false,
            created_by: user.id,
            updated_at: new Date().toISOString()
        }));

        const { error } = await supabase
            .from('facility_meter_readings')
            .upsert(payload, { 
                onConflict: 'meter_id,reading_date',
                ignoreDuplicates: false
            });

        if (error) throw error;

        if (isElectricity) {
            // --- DUAL WRITE TO LEGACY TABLE ---
            const legacyPayload = await Promise.all(readings.map(async (r: any) => {
                let tariffRate = 0;
                let tariffId = null;
                
                try {
                    const { data: tariffData } = await supabase.rpc('get_active_grid_tariff', {
                        p_property_id: propertyId,
                        p_date: r.reading_date
                    });
                    if (tariffData && tariffData.length > 0) {
                        tariffId = tariffData[0].id;
                        tariffRate = tariffData[0].rate_per_unit || 0;
                    }
                } catch (e) {
                    console.warn('Tariff lookup failed', e);
                }

                return {
                    property_id: propertyId,
                    meter_id: r.meter_id,
                    reading_date: r.reading_date,
                    opening_reading: r.initial_reading,
                    closing_reading: r.final_reading,
                    final_units: r.consumption,
                    multiplier_value_used: r.meter_constant_used || 1.0,
                    tariff_id: tariffId,
                    tariff_rate_used: tariffRate,
                    computed_cost: (r.consumption || 0) * tariffRate,
                    created_by: user.id,
                    updated_at: new Date().toISOString()
                };
            }));

            for (const reading of legacyPayload) {
                const { data: existingReading } = await supabase
                    .from('electricity_readings')
                    .select('id')
                    .eq('meter_id', reading.meter_id)
                    .eq('reading_date', reading.reading_date)
                    .maybeSingle();

                if (existingReading) {
                    const { error: updateError } = await supabase
                        .from('electricity_readings')
                        .update(reading)
                        .eq('id', existingReading.id);
                    if (updateError) throw updateError;
                } else {
                    const { error: insertError } = await supabase
                        .from('electricity_readings')
                        .insert(reading);
                    if (insertError) throw insertError;
                }
            }

            // Update last_reading on electricity_meters
            for (const r of readings) {
                if (r.final_reading !== null && r.final_reading !== undefined) {
                    await supabase
                        .from('electricity_meters')
                        .update({ last_reading: r.final_reading, updated_at: new Date().toISOString() })
                        .eq('id', r.meter_id);
                }
            }
        }

        return NextResponse.json({ success: true, count: payload.length });

    } catch (error: any) {
        console.error('[Facility Readings POST Error]:', error);
        return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
}
