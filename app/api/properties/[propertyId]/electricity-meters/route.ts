import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

// GET: Fetch all electricity meters for a property
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();

    console.log('[ElectricityMeters] GET request for property:', propertyId);

    const { data, error } = await supabase
        .from('electricity_meters')
        .select('*')
        .eq('property_id', propertyId)
        .is('deleted_at', null)
        .order('name', { ascending: true });

    if (error) {
        console.error('[ElectricityMeters] Error fetching meters:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[ElectricityMeters] Fetched', data?.length || 0, 'meters');
    return NextResponse.json(data);
}

// POST: Create a new electricity meter
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const body = await request.json();

    console.log('[ElectricityMeters] POST request for property:', propertyId, 'body:', body);

    // Get current user for audit
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Create the meter
    const { data: meter, error: meterError } = await supabase
        .from('electricity_meters')
        .insert({
            property_id: propertyId,
            name: body.name,
            meter_number: body.meter_number || null,
            meter_type: body.meter_type || 'main',
            max_load_kw: body.max_load_kw || null,
            status: body.status || 'active',
            last_reading: body.last_reading || 0,
        })
        .select()
        .single();

    if (meterError) {
        console.error('[ElectricityMeters] Error creating meter:', meterError.message);
        return NextResponse.json({ error: meterError.message }, { status: 500 });
    }

    console.log('[ElectricityMeters] Created meter:', meter.id);

    // 2. If initial multiplier data is provided, save it
    let multiplierValue = 1;
    let multiplierId = null;

    if (body.initial_multiplier && meter.id) {
        console.log('[ElectricityMeters] Creating initial multiplier for meter:', meter.id);

        // Remove multiplier_value from insert as it is likely a GENERATED column in DB
        // If it's NOT a generated column, the SELECT below will still return it if calculated by default or something
        const { multiplier_value, ...multData } = body.initial_multiplier;

        const { data: mult, error: multError } = await supabase
            .from('meter_multipliers')
            .insert({
                meter_id: meter.id,
                ...multData,
                reason: 'Initial configuration',
                created_by: user?.id
            })
            .select()
            .single();

        if (multError) {
            console.error('[ElectricityMeters] Multiplier Insert Failed:', multError.message, multError.details);
        } else if (mult) {
            multiplierId = mult.id;
            multiplierValue = mult.multiplier_value || 1;
            console.log('[ElectricityMeters] Multiplier link successful:', multiplierId, 'Value:', multiplierValue);
        }
    }

    // 3. If an initial reading is provided, record it in history
    if (body.last_reading > 0) {
        console.log('[ElectricityMeters] Recording initial reading for meter:', meter.id, 'Value:', body.last_reading);

        // Lookup active tariff
        let tariffId = null;
        let tariffRate = 0;
        try {
            const { data: tData } = await supabase.rpc('get_active_grid_tariff', {
                p_property_id: propertyId,
                p_date: new Date().toISOString().split('T')[0]
            });
            if (tData && tData.length > 0) {
                tariffId = tData[0].id;
                tariffRate = tData[0].rate_per_unit || 0;
            }
        } catch (e) { console.warn('Tariff lookup failed:', e); }

        // Calculate final values
        const finalUnits = body.last_reading * multiplierValue;
        const computedCost = finalUnits * tariffRate;

        const { error: readingError } = await supabase
            .from('electricity_readings')
            .insert({
                property_id: propertyId,
                meter_id: meter.id,
                reading_date: new Date().toISOString().split('T')[0],
                opening_reading: 0,
                closing_reading: body.last_reading,
                final_units: finalUnits,
                // Link the multiplier and tariff used
                multiplier_id: multiplierId,
                multiplier_value_used: multiplierValue,
                tariff_id: tariffId,
                tariff_rate_used: tariffRate,
                computed_cost: computedCost,
                notes: 'Initial setup reading',
                created_by: user?.id
            });

        if (readingError) {
            console.error('[ElectricityMeters] Initial Reading Insert Failed:', readingError.message);
        } else {
            console.log('[ElectricityMeters] Initial reading recorded successfully');
        }
    }

    // 4. Dual-Write to facility_meters for the Spreadsheet view
    try {
        // Ensure "Uncategorized" category exists
        const { data: categories } = await supabase
            .from('facility_meter_categories')
            .select('id')
            .eq('property_id', propertyId)
            .ilike('name', 'Uncategorized')
            .limit(1);

        let categoryId = categories?.[0]?.id;
        if (!categoryId) {
            const { data: newCat } = await supabase
                .from('facility_meter_categories')
                .insert({ property_id: propertyId, name: 'Uncategorized', order_index: 999 })
                .select('id')
                .single();
            categoryId = newCat?.id;
        }

        // Ensure "Default Group" exists under this category
        const { data: groups } = await supabase
            .from('facility_meter_groups')
            .select('id')
            .eq('category_id', categoryId)
            .ilike('name', 'Default')
            .limit(1);

        let groupId = groups?.[0]?.id;
        if (!groupId) {
            const { data: newGrp } = await supabase
                .from('facility_meter_groups')
                .insert({ category_id: categoryId, name: 'Default', order_index: 999 })
                .select('id')
                .single();
            groupId = newGrp?.id;
        }

        // Write to facility_meters
        const { error: fmError } = await supabase
            .from('facility_meters')
            .upsert({
                id: meter.id, // Keep IDs identical!
                group_id: groupId,
                name: meter.name,
                meter_constant: multiplierValue,
                order_index: 999
            });

        if (fmError) {
            console.warn('[ElectricityMeters] Could not sync facility_meters:', fmError);
        }
    } catch (err) {
        console.warn('[ElectricityMeters] Error during facility_meters dual-write:', err);
    }

    return NextResponse.json(meter, { status: 201 });
}

// DELETE: Remove an electricity meter
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const meterId = searchParams.get('id');

    console.log('[ElectricityMeters] DELETE request for meter:', meterId);

    if (!meterId) {
        return NextResponse.json({ error: 'Meter ID required' }, { status: 400 });
    }

    const { error } = await supabase
        .from('electricity_meters')
        .update({ status: 'inactive', deleted_at: new Date().toISOString() })
        .eq('id', meterId)
        .eq('property_id', propertyId);

    if (error) {
        console.error('[ElectricityMeters] Error deleting meter:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[ElectricityMeters] Deleted meter:', meterId);
    return NextResponse.json({ success: true });
}

// PUT: Update an existing electricity meter
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    const { propertyId } = await params;
    const supabase = await createClient();
    const body = await request.json();

    console.log('[ElectricityMeters] PUT request for property:', propertyId, 'body:', body);

    if (!body.id) {
        return NextResponse.json({ error: 'Meter ID required for update' }, { status: 400 });
    }

    const { data: meter, error } = await supabase
        .from('electricity_meters')
        .update({
            name: body.name,
            meter_number: body.meter_number || null,
            meter_type: body.meter_type,
            updated_at: new Date().toISOString()
        })
        .eq('id', body.id)
        .eq('property_id', propertyId)
        .select()
        .single();

    if (error) {
        console.error('[ElectricityMeters] Error updating meter:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[ElectricityMeters] Updated meter:', meter.id);
    return NextResponse.json(meter);
}
