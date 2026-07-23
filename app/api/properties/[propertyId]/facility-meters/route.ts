import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { propertyId } = await params;

        // Fetch categories (tabs)
        const { data: categories, error: catError } = await supabase
            .from('facility_meter_categories')
            .select('*')
            .eq('property_id', propertyId)
            .order('order_index');

        if (catError) throw catError;

        if (!categories || categories.length === 0) {
            return NextResponse.json([]);
        }

        const categoryIds = categories.map(c => c.id);

        // Fetch groups
        const { data: groups, error: grpError } = await supabase
            .from('facility_meter_groups')
            .select('*')
            .in('category_id', categoryIds)
            .order('order_index');

        if (grpError) throw grpError;

        const groupIds = groups?.map(g => g.id) || [];

        // Fetch meters
        let meters: any[] = [];
        if (groupIds.length > 0) {
            const { data: mData, error: mError } = await supabase
                .from('facility_meters')
                .select('*')
                .in('group_id', groupIds)
                .order('order_index');
                
            if (mError) throw mError;
            meters = mData || [];
        }

        // Assemble hierarchy
        const hierarchy = categories.map(cat => ({
            ...cat,
            groups: (groups || []).filter(g => g.category_id === cat.id).map(grp => ({
                ...grp,
                meters: meters.filter(m => m.group_id === grp.id)
            }))
        }));

        return NextResponse.json(hierarchy);

    } catch (error: any) {
        console.error('[Facility Meters GET Error]:', error);
        return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        
        const body = await request.json();
        const { action, targetId, newName, meterId, meterConstant } = body;
        
        // Handle Renaming
        if (action === 'rename_sheet') {
            if (!targetId || !newName) return NextResponse.json({ error: 'Missing targetId or newName' }, { status: 400 });
            const { error } = await supabase.from('facility_meter_categories').update({ name: newName }).eq('id', targetId);
            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        if (action === 'rename_group') {
            if (!targetId || !newName) return NextResponse.json({ error: 'Missing targetId or newName' }, { status: 400 });
            const { error } = await supabase.from('facility_meter_groups').update({ name: newName }).eq('id', targetId);
            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        if (action === 'rename_meter') {
            if (!targetId || !newName) return NextResponse.json({ error: 'Missing targetId or newName' }, { status: 400 });
            
            // Update Spreadsheet UI name
            const { error: fmError } = await supabase.from('facility_meters').update({ name: newName }).eq('id', targetId);
            if (fmError) throw fmError;
            
            // Dual-Write: Update core Cards UI name
            const { error: emError } = await supabase.from('electricity_meters').update({ name: newName }).eq('id', targetId);
            if (emError) console.warn("Could not update core electricity meter name:", emError); // Warn but don't fail

            return NextResponse.json({ success: true });
        }

        // Handle Meter Constant Update (Legacy default behavior)
        if (!meterId || meterConstant === undefined) {
            return NextResponse.json({ error: 'Missing meterId or meterConstant' }, { status: 400 });
        }

        const { error } = await supabase
            .from('facility_meters')
            .update({ meter_constant: meterConstant })
            .eq('id', meterId);

        if (error) throw error;

        // --- TWO WAY SYNC: Update Legacy Meter Multipliers ---
        // This ensures the Cards UI and Mobile Apps see the updated constant instantly
        const { data: existingMultiplier } = await supabase
            .from('meter_multipliers')
            .select('id')
            .eq('meter_id', meterId)
            .limit(1)
            .maybeSingle();

        if (existingMultiplier) {
            await supabase
                .from('meter_multipliers')
                .update({ meter_constant: meterConstant })
                .eq('id', existingMultiplier.id);
        } else {
            await supabase
                .from('meter_multipliers')
                .insert({
                    meter_id: meterId,
                    ct_ratio_primary: 200,
                    ct_ratio_secondary: 5,
                    pt_ratio_primary: 11000,
                    pt_ratio_secondary: 110,
                    meter_constant: meterConstant,
                    effective_from: new Date().toISOString().split('T')[0]
                });
        }
        // -----------------------------------------------------

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        
        const { propertyId } = await params;
        const body = await request.json();
        const { action, groupId, meterName, meterConstant, sheetName, categoryId, locationName } = body;
        
        if (action === 'add_sheet') {
            if (!sheetName) return NextResponse.json({ error: 'Missing sheetName' }, { status: 400 });
            const { error } = await supabase.from('facility_meter_categories').insert({ property_id: propertyId, name: sheetName, order_index: 999 });
            if (error) throw error;
            return NextResponse.json({ success: true });
        }
        
        if (action === 'add_location') {
            if (!categoryId || !locationName) return NextResponse.json({ error: 'Missing categoryId or locationName' }, { status: 400 });
            const { error } = await supabase.from('facility_meter_groups').insert({ category_id: categoryId, name: locationName, order_index: 999 });
            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        // Default action: add_meter
        if (!groupId || !meterName) {
            return NextResponse.json({ error: 'Missing groupId or meterName' }, { status: 400 });
        }

        const { data: assignedMeters } = await supabase.from('facility_meters').select('id');
        const assignedMeterIds = new Set(assignedMeters?.map(m => m.id) || []);

        // 1. Dual Write: Check if legacy electricity_meter already exists
        let { data: legacyMeters } = await supabase
            .from('electricity_meters')
            .select('id')
            .eq('property_id', propertyId)
            .ilike('name', meterName) // Case-insensitive match
            .order('created_at', { ascending: true });

        let legacyMeter = null;
        if (legacyMeters && legacyMeters.length > 0) {
            legacyMeter = legacyMeters.find(m => !assignedMeterIds.has(m.id)) || null;
        }

        if (!legacyMeter) {
            const { data: newLegacy, error: legacyError } = await supabase
                .from('electricity_meters')
                .insert({
                    property_id: propertyId,
                    name: meterName,
                    status: 'active'
                })
                .select('id')
                .single();
                
            if (legacyError) throw legacyError;
            legacyMeter = newLegacy;

            // 2. Add legacy meter multiplier ONLY for new meters
            const { error: multError } = await supabase
                .from('meter_multipliers')
                .insert({
                    meter_id: legacyMeter.id,
                    ct_ratio_primary: 1,
                    ct_ratio_secondary: 1,
                    pt_ratio_primary: 1,
                    pt_ratio_secondary: 1,
                    meter_constant: meterConstant || 1.0,
                    effective_from: new Date().toISOString().split('T')[0]
                });
                
            if (multError) throw multError;
        }

        // 3. Write to the new facility_meters for the Spreadsheet UI (UPSERT)
        // We explicitly use the EXACT same ID so they are perfectly linked in the database
        const { error } = await supabase
            .from('facility_meters')
            .upsert({
                id: legacyMeter.id, // Keep IDs identical!
                group_id: groupId,
                name: meterName,
                meter_constant: meterConstant || 1.0,
                order_index: 999
            });

        if (error) throw error;

        // --- SELF-HEALING: Backfill Historical Readings ---
        const { data: legacyData } = await supabase.from('electricity_readings').select('*').eq('meter_id', legacyMeter.id);
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
        // --------------------------------------------------

        return NextResponse.json({ success: true, id: legacyMeter.id });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const url = new URL(request.url);
        const action = url.searchParams.get('action');
        const targetId = url.searchParams.get('id');

        if (!action || !targetId) {
            return NextResponse.json({ error: 'Missing action or id' }, { status: 400 });
        }

        if (action === 'delete_meter') {
            // Delete from spreadsheet only. The legacy meter stays in the database to protect historical data.
            await supabase.from('facility_meters').delete().eq('id', targetId);
            // Mark the legacy meter as deleted and inactive
            await supabase.from('electricity_meters').update({ status: 'inactive', deleted_at: new Date().toISOString() }).eq('id', targetId);
            return NextResponse.json({ success: true });
        }

        if (action === 'delete_location') {
            // Delete the group (which cascades and deletes facility_meters, leaving legacy meters safe)
            await supabase.from('facility_meter_groups').delete().eq('id', targetId);
            return NextResponse.json({ success: true });
        }

        if (action === 'delete_sheet') {
            // Delete the sheet (which cascades and destroys everything else in the spreadsheet tables, leaving legacy safe)
            await supabase.from('facility_meter_categories').delete().eq('id', targetId);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
