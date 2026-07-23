const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load env from .env.local or .env
const envStr = fs.readFileSync('.env', 'utf-8');
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

async function main() {
    console.log("Starting alignment process...");

    // 1. Get all facility meters
    const { data: facilityMeters } = await supabase.from('facility_meters').select('*');
    if (!facilityMeters) return console.log("No facility meters found.");

    // 2. Get all electricity meters
    const { data: electricityMeters } = await supabase.from('electricity_meters').select('*');
    if (!electricityMeters) return console.log("No electricity meters found.");

    let healed = 0;

    for (const fm of facilityMeters) {
        // Find matching electricity meter by exact name
        const match = electricityMeters.find(em => em.name === fm.name);
        
        if (match && match.id !== fm.id) {
            console.log(`Mismatch found for '${fm.name}'. FM ID: ${fm.id}, EM ID: ${match.id}`);
            
            // Delete the old mismatched facility meter
            await supabase.from('facility_meters').delete().eq('id', fm.id);
            
            // Re-insert with the correct exact ID
            const { error } = await supabase.from('facility_meters').insert({
                id: match.id,
                group_id: fm.group_id,
                name: fm.name,
                meter_constant: fm.meter_constant,
                order_index: fm.order_index
            });
            
            if (error) {
                console.error("Error inserting healed meter:", error.message);
            } else {
                console.log(`-> Healed '${fm.name}' successfully!`);
                healed++;
            }
        }
    }

    console.log(`Alignment complete. Healed ${healed} meters.`);
}

main();
