import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
    const { data: readings } = await supabase
        .from('electricity_readings')
        .select('id, final_units, tariff_rate_used, computed_cost')
        .not('computed_cost', 'is', null);

    if (readings) {
        for (const r of readings) {
            const expectedCost = (r.final_units || 0) * (r.tariff_rate_used || 0);
            if (r.computed_cost !== expectedCost) {
                console.log(`Fixing ${r.id}: cost ${r.computed_cost} -> ${expectedCost}`);
                await supabase.from('electricity_readings').update({ computed_cost: expectedCost }).eq('id', r.id);
            }
        }
    }
    console.log("Done");
}

run();
