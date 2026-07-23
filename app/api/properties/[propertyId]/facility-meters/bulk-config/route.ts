import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function POST(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { propertyId } = await params;
        const body = await request.json();
        const { hierarchy } = body;

        if (!hierarchy || !Array.isArray(hierarchy)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }



        // Transaction simulation: Since Supabase JS doesn't support complex transactions easily,
        // we will do it sequentially. If it fails midway, some data might be orphaned, but we can clean it up.
        // Or we use an RPC, but doing it in Node is fine for bootstrapping.

        const { data: assignedMeters } = await supabase.from('facility_meters').select('id');
        const assignedMeterIds = new Set(assignedMeters?.map(m => m.id) || []);

        let totalMetersCreated = 0;

        for (let i = 0; i < hierarchy.length; i++) {
            const sheet = hierarchy[i];
            
            // Insert Category
            const { data: catData, error: catErr } = await supabase
                .from('facility_meter_categories')
                .insert({
                    property_id: propertyId,
                    name: sheet.sheetName,
                    order_index: i
                })
                .select('id')
                .single();

            if (catErr) throw catErr;

            for (let j = 0; j < sheet.groups.length; j++) {
                const group = sheet.groups[j];
                
                // Insert Group
                const { data: grpData, error: grpErr } = await supabase
                    .from('facility_meter_groups')
                    .insert({
                        category_id: catData.id,
                        name: group.locationName,
                        order_index: j
                    })
                    .select('id')
                    .single();

                if (grpErr) throw grpErr;

                // Prepare Meters (Dual-Write to legacy architecture for Card UI)
                for (let k = 0; k < group.meters.length; k++) {
                    const meter = group.meters[k];
                    
                    // 1. Dual Write: Check if legacy electricity_meter already exists
                    let { data: legacyMeters } = await supabase
                        .from('electricity_meters')
                        .select('id')
                        .eq('property_id', propertyId)
                        .ilike('name', meter.name) // Case-insensitive match
                        .order('created_at', { ascending: true }); // Get the oldest original one
                        
                    let legacyMeter = null;
                    if (legacyMeters && legacyMeters.length > 0) {
                        legacyMeter = legacyMeters.find(m => !assignedMeterIds.has(m.id)) || null;
                    }

                    // If it doesn't exist, create it
                    if (!legacyMeter) {
                        const { data: newLegacy, error: legacyErr } = await supabase
                            .from('electricity_meters')
                            .insert({
                                property_id: propertyId,
                                name: meter.name,
                                status: 'active'
                            })
                            .select('id')
                            .single();
                        
                        if (legacyErr) throw legacyErr;
                        legacyMeter = newLegacy;

                        // 2. Add legacy meter multiplier ONLY for new meters
                        const { error: multErr } = await supabase
                            .from('meter_multipliers')
                            .insert({
                                meter_id: legacyMeter.id,
                                ct_ratio_primary: 1,
                                ct_ratio_secondary: 1,
                                pt_ratio_primary: 1,
                                pt_ratio_secondary: 1,
                                meter_constant: meter.meterConstant || 1.0,
                                effective_from: new Date().toISOString().split('T')[0]
                            });
                            
                        if (multErr) throw multErr;
                        assignedMeterIds.add(legacyMeter.id);
                    } else {
                        assignedMeterIds.add(legacyMeter.id);
                    }

                    // 3. Write to the new facility_meters using EXACT SAME ID (UPSERT for idempotency)
                    const { error: meterErr } = await supabase
                        .from('facility_meters')
                        .upsert({
                            id: legacyMeter.id,
                            group_id: grpData.id,
                            name: meter.name,
                            unit: meter.unit || 'kWh',
                            meter_constant: meter.meterConstant || 1.0,
                            order_index: k
                        });
                        
                    if (meterErr) throw meterErr;
                    totalMetersCreated++;
                }

                // --- SELF-HEALING: Backfill Historical Readings ---
                // If the user had legacy data in the Cards UI from before the spreadsheet existed,
                // we will seamlessly copy all of it into the new spreadsheet right now!
                const { data: latestMeters } = await supabase.from('facility_meters').select('id').eq('group_id', grpData.id);
                if (latestMeters && latestMeters.length > 0) {
                    const ids = latestMeters.map(m => m.id);
                    const { data: legacyData } = await supabase.from('electricity_readings').select('*').in('meter_id', ids);
                    if (legacyData && legacyData.length > 0) {
                        const readPayload = legacyData.map(r => ({
                            meter_id: r.meter_id,
                            reading_date: r.reading_date,
                            initial_reading: r.opening_reading,
                            final_reading: r.closing_reading,
                            consumption: r.final_units || 0,
                            meter_constant_used: r.multiplier_value_used || 1.0,
                            is_rollover: false,
                            created_by: r.created_by,
                            updated_at: new Date().toISOString()
                        }));
                        await supabase.from('facility_meter_readings').upsert(readPayload, { onConflict: 'meter_id,reading_date' });
                    }
                }
                // --------------------------------------------------
            }
        }

        return NextResponse.json({ success: true, message: `Created ${totalMetersCreated} meters successfully.` });

    } catch (error: any) {
        console.error('[Bulk Config POST Error]:', error);
        return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
}
