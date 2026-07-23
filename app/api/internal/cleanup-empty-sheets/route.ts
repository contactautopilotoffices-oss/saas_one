import { NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function GET() {
    try {
        const supabase = await createClient();
        
        // 1. Get all categories
        const { data: categories } = await supabase.from('facility_meter_categories').select('id, name');
        if (!categories) return NextResponse.json({ msg: "No categories" });

        let deleted = 0;
        for (const cat of categories) {
            // 2. Count meters in this category
            const { data: groups } = await supabase.from('facility_meter_groups').select('id').eq('category_id', cat.id);
            let meterCount = 0;
            
            if (groups && groups.length > 0) {
                const groupIds = groups.map((g: any) => g.id);
                const { count } = await supabase
                    .from('facility_meters')
                    .select('*', { count: 'exact', head: true })
                    .in('group_id', groupIds);
                meterCount = count || 0;
            }

            // 3. Delete category if it has 0 meters
            if (meterCount === 0) {
                await supabase.from('facility_meter_categories').delete().eq('id', cat.id);
                deleted++;
            }
        }
        
        return NextResponse.json({ success: true, deleted });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
