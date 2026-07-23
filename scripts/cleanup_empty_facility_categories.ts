import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
    // 1. Get all categories
    const { data: categories } = await supabase.from('facility_meter_categories').select('id, name');
    if (!categories) return;

    for (const cat of categories) {
        // 2. Count meters in this category
        const { data: groups } = await supabase.from('facility_meter_groups').select('id').eq('category_id', cat.id);
        let meterCount = 0;
        
        if (groups && groups.length > 0) {
            const groupIds = groups.map(g => g.id);
            const { count } = await supabase
                .from('facility_meters')
                .select('*', { count: 'exact', head: true })
                .in('group_id', groupIds);
            meterCount = count || 0;
        }

        // 3. Delete category if it has 0 meters
        if (meterCount === 0) {
            console.log(`Deleting empty category: ${cat.name} (${cat.id})`);
            await supabase.from('facility_meter_categories').delete().eq('id', cat.id);
        }
    }
    console.log("Cleanup complete!");
}

run();
