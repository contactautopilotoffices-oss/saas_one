const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 1. Load Environment Variables from .env
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

async function inspectNegativeReadings() {
    console.log('===============================================================');
    console.log('⚡ CHECKING ELECTRICITY READINGS FOR NEGATIVE / CORRUPTED DATA ⚡');
    console.log('===============================================================\n');

    const { data: readings, error } = await supabase
        .from('electricity_readings')
        .select(`
            id,
            property_id,
            meter_id,
            reading_date,
            opening_reading,
            closing_reading,
            final_units,
            computed_units,
            multiplier_value_used,
            computed_cost,
            created_at,
            properties(name, code),
            meter:electricity_meters(name, meter_type)
        `)
        .order('reading_date', { ascending: false });

    if (error) {
        console.error('❌ Error fetching electricity readings:', error.message);
        return;
    }

    const negativeRows = [];

    readings.forEach(r => {
        const units = r.final_units !== null && r.final_units !== undefined ? Number(r.final_units) : Number(r.computed_units || 0);
        const rawDiff = Number(r.closing_reading || 0) - Number(r.opening_reading || 0);

        if (units < 0 || rawDiff < 0) {
            negativeRows.push({
                Reading_ID: r.id,
                Property: `${r.properties?.name || 'Unknown'} (${r.properties?.code || 'N/A'})`,
                Meter_Name: r.meter?.name || 'Unknown',
                Meter_Type: r.meter?.meter_type || 'Unknown',
                Reading_Date: r.reading_date,
                Opening_Reading: r.opening_reading,
                Closing_Reading: r.closing_reading,
                Raw_Diff: rawDiff,
                Multiplier: r.multiplier_value_used || 1,
                Final_Units_kWh: r.final_units,
                Computed_Units_kWh: r.computed_units,
                Created_At: r.created_at
            });
        }
    });

    if (negativeRows.length === 0) {
        console.log('✅ No negative electricity readings found in the database!');
        return;
    }

    console.log(`🚨 Found ${negativeRows.length} negative/corrupted reading(s) in database:\n`);
    console.table(negativeRows);

    console.log('\n--- Property-wise Impact Summary ---');
    const propertySummary = {};
    negativeRows.forEach(r => {
        if (!propertySummary[r.Property]) {
            propertySummary[r.Property] = { count: 0, totalNegativeUnits: 0 };
        }
        propertySummary[r.Property].count += 1;
        const units = r.Final_Units_kWh !== null && r.Final_Units_kWh !== undefined ? r.Final_Units_kWh : r.Computed_Units_kWh;
        propertySummary[r.Property].totalNegativeUnits += Number(units || 0);
    });

    console.table(propertySummary);
    console.log('\n===============================================================');
}

inspectNegativeReadings();
