import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

/**
 * Meter Multipliers API
 * PRD: Time-versioned multipliers for CT/PT ratios
 * All roles can edit (per PRD: "Multiplier editing open to all roles")
 */

// GET: Fetch multipliers for a meter
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const meterId = searchParams.get('meterId');
    const date = searchParams.get('date'); // For fetching active multiplier on specific date
    const includeHistory = searchParams.get('includeHistory') === 'true';

    console.log('[MeterMultipliers] GET request for property:', propertyId, { meterId, date, includeHistory });

    // If meterId provided, get multipliers for that meter
    if (meterId) {
        if (date && !includeHistory) {
            // Get active multiplier for specific date using helper function
            const { data, error } = await supabase
                .rpc('get_active_multiplier', {
                    p_meter_id: meterId,
                    p_date: date
                });

            if (error) {
                console.error('[MeterMultipliers] Error fetching active multiplier:', error.message);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            return NextResponse.json(data?.[0] || null);
        }

        // Get all multipliers for this meter (with history)
        const { data, error } = await supabase
            .from('meter_multipliers')
            .select('*')
            .eq('meter_id', meterId)
            .order('effective_from', { ascending: false });

        if (error) {
            console.error('[MeterMultipliers] Error fetching multipliers:', error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json(data);
    }

    // Get all multipliers for all meters in this property
    const { data: meters } = await supabase
        .from('electricity_meters')
        .select('id')
        .eq('property_id', propertyId);

    if (!meters || meters.length === 0) {
        return NextResponse.json([]);
    }

    const meterIds = meters.map(m => m.id);

    const { data, error } = await supabase
        .from('meter_multipliers')
        .select(`
            *,
            meter:electricity_meters(id, name, meter_number)
        `)
        .in('meter_id', meterIds)
        .order('effective_from', { ascending: false });

    if (error) {
        console.error('[MeterMultipliers] Error fetching all multipliers:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}

// POST: Create a new multiplier version (never overwrite existing)
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const body = await request.json();

    console.log('[MeterMultipliers] POST request for property:', propertyId, body);

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate required fields
    if (!body.meter_id || !body.effective_from) {
        return NextResponse.json({
            error: 'meter_id and effective_from are required'
        }, { status: 400 });
    }

    // Parse and validate numeric fields
    const ct_ratio_primary = Number(body.ct_ratio_primary) || 200;
    const ct_ratio_secondary = Number(body.ct_ratio_secondary) || 5;
    const pt_ratio_primary = Number(body.pt_ratio_primary) || 11000;
    const pt_ratio_secondary = Number(body.pt_ratio_secondary) || 110;
    const meter_constant = Number(body.meter_constant) || 1;

    // Verify meter belongs to this property
    const { data: meter } = await supabase
        .from('electricity_meters')
        .select('id, property_id')
        .eq('id', body.meter_id)
        .eq('property_id', propertyId)
        .single();

    if (!meter) {
        return NextResponse.json({
            error: 'Meter not found in this property'
        }, { status: 404 });
    }

    const effectiveFromDate = body.effective_from;
    const effectiveToDate = body.effective_to || null;
    const updateExistingId = body.updateExistingId; // If provided, update this specific multiplier

    // Calculate the new multiplier value
    const computedMultiplierValue = (ct_ratio_primary / (ct_ratio_secondary || 1)) *
        (pt_ratio_primary / (pt_ratio_secondary || 1)) * meter_constant;

    // If updating a specific existing multiplier by ID
    if (updateExistingId) {
        console.log('[MeterMultipliers] Updating specific multiplier:', updateExistingId);

        const { data, error } = await supabase
            .from('meter_multipliers')
            .update({
                ct_ratio_primary,
                ct_ratio_secondary,
                pt_ratio_primary,
                pt_ratio_secondary,
                meter_constant,
                reason: body.reason || null,
            })
            .eq('id', updateExistingId)
            .eq('meter_id', body.meter_id) // Security check
            .select()
            .single();

        if (error) {
            console.error('[MeterMultipliers] Error updating multiplier:', error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (body.retroactivelyUpdate) {
            await updateReadingsWithNewMultiplier(supabase, propertyId, body.meter_id, effectiveFromDate, computedMultiplierValue);
        }

        // Sync the new computed multiplier to the facility_meters table for the spreadsheet view
        const { error: syncError } = await supabase
            .from('facility_meters')
            .update({ meter_constant: computedMultiplierValue })
            .eq('id', body.meter_id);
        
        if (syncError) {
            console.warn('[MeterMultipliers] Could not sync facility_meters:', syncError);
        }

        return NextResponse.json(data);
    }

    // Helper to check if two date ranges overlap
    const rangesOverlap = (start1: string, end1: string | null, start2: string, end2: string | null) => {
        const s1 = start1, e1 = end1 || '9999-12-31';
        const s2 = start2, e2 = end2 || '9999-12-31';
        return s1 <= e2 && e1 >= s2;
    };

    // Fetch all multipliers for this meter
    const { data: allMultipliers, error: fetchError } = await supabase
        .from('meter_multipliers')
        .select('*')
        .eq('meter_id', body.meter_id)
        .order('effective_from', { ascending: true });

    if (fetchError) {
        console.error('[MeterMultipliers] Error fetching multipliers:', fetchError);
        return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    // Find ALL multipliers that overlap with the new date range
    const overlapping = allMultipliers?.filter(m =>
        m.id !== updateExistingId &&
        rangesOverlap(effectiveFromDate, effectiveToDate, m.effective_from, m.effective_to)
    ) || [];

    console.log('[MeterMultipliers] Found', overlapping.length, 'overlapping multipliers');

    // Delete all overlapping multipliers
    if (overlapping.length > 0) {
        const overlappingIds = overlapping.map(m => m.id);
        await supabase
            .from('meter_multipliers')
            .delete()
            .in('id', overlappingIds);
        console.log('[MeterMultipliers] Deleted overlapping multipliers');
    }

    // Find the multiplier that ends right before our new start (to potentially connect)
    const precedingMultiplier = allMultipliers?.find(m =>
        m.effective_to === null || m.effective_to < effectiveFromDate
    );

    // Find the multiplier that starts right after our new end (to potentially connect)
    const followingMultiplier = allMultipliers?.find(m =>
        effectiveToDate !== null &&
        m.effective_from > effectiveToDate
    );

    // Determine effective_to for our new multiplier
    let newEffectiveTo = effectiveToDate;
    // If following multiplier exists and starts exactly the day after our end, connect them
    if (followingMultiplier && newEffectiveTo) {
        const dayAfterNewEnd = new Date(newEffectiveTo);
        dayAfterNewEnd.setDate(dayAfterNewEnd.getDate() + 1);
        const dayAfterNewEndStr = dayAfterNewEnd.toISOString().split('T')[0];
        if (followingMultiplier.effective_from === dayAfterNewEndStr) {
            newEffectiveTo = followingMultiplier.effective_to;
        }
    }

    // Insert the new multiplier (overlapping ones are already deleted)
    const { data, error } = await supabase
        .from('meter_multipliers')
        .insert({
            meter_id: body.meter_id,
            ct_ratio_primary,
            ct_ratio_secondary,
            pt_ratio_primary,
            pt_ratio_secondary,
            meter_constant,
            effective_from: effectiveFromDate,
            effective_to: newEffectiveTo,
            reason: body.reason || null,
            created_by: user.id
        })
        .select()
        .single();

    if (error) {
        console.error('[MeterMultipliers] Error creating multiplier:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[MeterMultipliers] Created new multiplier:', data.id);

    // Optionally retroactively update existing readings
    if (body.retroactivelyUpdate) {
        await updateReadingsWithNewMultiplier(supabase, propertyId, body.meter_id, effectiveFromDate, computedMultiplierValue);
    }

    // Sync the new computed multiplier to the facility_meters table for the spreadsheet view
    const { error: syncError } = await supabase
        .from('facility_meters')
        .update({ meter_constant: computedMultiplierValue })
        .eq('id', body.meter_id);
    
    if (syncError) {
        console.warn('[MeterMultipliers] Could not sync facility_meters:', syncError);
    }

    return NextResponse.json(data, { status: 201 });
}

// Helper function to retroactively update readings with new multiplier
async function updateReadingsWithNewMultiplier(supabase: any, propertyId: string, meterId: string, effectiveFrom: string, newMultiplierValue: number) {
    try {
        // Get all readings for this meter that are on or after the effective date
        // We update multiplier_value_used and recalculate final_units
        const { data: readingsToUpdate, error: fetchError } = await supabase
            .from('electricity_readings')
            .select('id, reading_date, opening_reading, closing_reading, computed_units')
            .eq('meter_id', meterId)
            .gte('reading_date', effectiveFrom);

        if (fetchError) {
            console.error('[MeterMultipliers] Error fetching readings to update:', fetchError);
            return;
        }

        if (!readingsToUpdate || readingsToUpdate.length === 0) {
            console.log('[MeterMultipliers] No readings to update retroactively');
            return;
        }

        console.log(`[MeterMultipliers] Found ${readingsToUpdate.length} readings to update with new multiplier ${newMultiplierValue}`);

        // Update each reading with the new multiplier value
        // final_units = computed_units * multiplier_value_used
        // computed_units is a GENERATED column = closing_reading - opening_reading
        for (const reading of readingsToUpdate) {
            // computed_units is generated by DB: closing_reading - opening_reading
            // Fallback to manual calculation if computed_units is null
            const computedUnits = reading.computed_units ?? (reading.closing_reading - reading.opening_reading);

            // Calculate final units: raw units * new multiplier
            // This is the corrected formula: final_units = computed_units * multiplier
            const newFinalUnits = parseFloat((computedUnits * newMultiplierValue).toFixed(4));

            console.log(`[MeterMultipliers] Reading ${reading.id}: computed=${computedUnits}, new_multiplier=${newMultiplierValue}, new_final=${newFinalUnits}`);

            // Fetch active tariff for this date to recalculate computed_cost
            let tariffId = null;
            let tariffRate = 0;
            try {
                const { data: tData } = await supabase.rpc('get_active_grid_tariff', {
                    p_property_id: propertyId,
                    p_date: reading.reading_date
                });
                if (tData && tData.length > 0) {
                    tariffId = tData[0].id;
                    tariffRate = tData[0].rate_per_unit || 0;
                }
            } catch (e) {
                console.warn('[MeterMultipliers] Tariff lookup failed for retroactive update:', e);
            }

            const computedCost = newFinalUnits * tariffRate;

            const { error: updateError } = await supabase
                .from('electricity_readings')
                .update({
                    multiplier_value_used: newMultiplierValue,
                    final_units: newFinalUnits,
                    computed_cost: computedCost,
                    tariff_id: tariffId,
                    tariff_rate_used: tariffRate > 0 ? tariffRate : null
                })
                .eq('id', reading.id);

            if (updateError) {
                console.error(`[MeterMultipliers] Error updating reading ${reading.id}:`, updateError);
            }

            // Dual-Write sync for facility_meter_readings
            const { error: syncError } = await supabase
                .from('facility_meter_readings')
                .update({
                    consumption: newFinalUnits,
                    meter_constant_used: newMultiplierValue
                })
                .eq('meter_id', meterId)
                .eq('reading_date', reading.reading_date);
            
            if (syncError) {
                console.warn(`[MeterMultipliers] Error syncing facility reading for ${reading.id}:`, syncError);
            }
        }

        console.log(`[MeterMultipliers] Successfully updated ${readingsToUpdate.length} readings`);
    } catch (err) {
        console.error('[MeterMultipliers] Error in retroactive update:', err);
    }
}

// DELETE: Delete a multiplier
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const multiplierId = searchParams.get('id');

    if (!multiplierId) {
        return NextResponse.json({ error: 'Multiplier ID is required' }, { status: 400 });
    }

    // Verify the multiplier belongs to a meter in this property
    const { data: multiplier, error: fetchError } = await supabase
        .from('meter_multipliers')
        .select(`
            *,
            meter:electricity_meters(id, property_id)
        `)
        .eq('id', multiplierId)
        .single();

    if (fetchError || !multiplier) {
        return NextResponse.json({ error: 'Multiplier not found' }, { status: 404 });
    }

    if (multiplier.meter?.property_id !== propertyId) {
        return NextResponse.json({ error: 'Multiplier not found in this property' }, { status: 404 });
    }

    const { error: deleteError } = await supabase
        .from('meter_multipliers')
        .delete()
        .eq('id', multiplierId);

    if (deleteError) {
        console.error('[MeterMultipliers] Error deleting multiplier:', deleteError);
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
