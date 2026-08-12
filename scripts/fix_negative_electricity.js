const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load Environment Variables from .env
const envPath = path.join(__dirname, '..', '.env');
const envStr = fs.readFileSync(envPath, 'utf-8');
const env = {};
envStr.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        let val = parts.slice(1).join('=').trim();
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        env[parts[0]] = val;
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Specific IDs identified for Rabale, Indore, and SS Plaza
const targetIds = [
    '6b92e2ac-1ff5-496f-aafd-0195d5ec4949', // Indore MPEB (2026-08-04)
    '5f3c570f-7358-4ef2-92e1-119717867039', // Indore MPEB (2026-07-31)
    '9c885f56-97e1-448c-809e-7bbccecb85a9', // Rabale 701/702 (2026-08-03)
    '9c21ee8a-adf3-467b-9f5b-5ceae3ffc48b', // SS Plaza Utility Panel (2026-08-01)
    '452a10cb-f26f-4a47-898c-7ce94ae82f25', // SS Plaza UPS Panel (2026-07-15)
    '8c0c204f-eea2-47d1-a1f6-38f70a331603'  // SS Plaza UPS Panel (2026-07-11)
];

async function cleanupBadReadings() {
    console.log('===============================================================');
    console.log('🛠️ REMEDIATION: DELETING CORRUPTED NEGATIVE READINGS');
    console.log('===============================================================\n');

    for (const id of targetIds) {
        const { data: r, error: fetchErr } = await supabase
            .from('electricity_readings')
            .select('id, property_id, meter_id, reading_date, opening_reading, closing_reading, final_units, computed_units, properties(name, code), meter:electricity_meters(name)')
            .eq('id', id)
            .maybeSingle();

        if (fetchErr || !r) {
            console.log(`⚠️ Reading ID ${id} not found or already deleted.`);
            continue;
        }

        console.log(`Deleting ID: ${r.id} | Date: ${r.reading_date} | Property: ${r.properties?.name} (${r.properties?.code}) | Meter: ${r.meter?.name}`);
        console.log(`   Values: Opening ${r.opening_reading} -> Closing ${r.closing_reading} | FinalUnits: ${r.final_units} | ComputedUnits: ${r.computed_units}`);

        // 1. Delete from electricity_readings
        const { error: delErr } = await supabase
            .from('electricity_readings')
            .delete()
            .eq('id', r.id);

        if (delErr) {
            console.error(`   ❌ Failed to delete from electricity_readings:`, delErr.message);
        } else {
            console.log(`   ✅ Deleted from electricity_readings`);
        }

        // 2. Delete dual-written entry from facility_meter_readings
        await supabase
            .from('facility_meter_readings')
            .delete()
            .eq('meter_id', r.meter_id)
            .eq('reading_date', r.reading_date);
        console.log(`   ✅ Synced deletion from facility_meter_readings`);

        // 3. Recalibrate meter last_reading
        const { data: latest } = await supabase
            .from('electricity_readings')
            .select('closing_reading')
            .eq('meter_id', r.meter_id)
            .order('reading_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1);

        const newLast = latest && latest.length > 0 ? latest[0].closing_reading : 0;
        await supabase
            .from('electricity_meters')
            .update({ last_reading: newLast, updated_at: new Date().toISOString() })
            .eq('id', r.meter_id);
        console.log(`   ✅ Recalibrated meter last_reading to ${newLast}`);
    }

    console.log('\n===============================================================');
    console.log('🎉 CLEANUP COMPLETED SUCCESSFULLY!');
    console.log('===============================================================');
}

cleanupBadReadings();
