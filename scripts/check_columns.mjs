import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkColumns() {
    // Check with select on various column candidates
    const candidates = [
        'id', 'organization_id', 'property_id', 'requisition_month', 'requisition_year',
        'file_url', 'file_name', 'file_size_bytes', 'notes', 'status', 'created_at',
        'updated_at', 'uploaded_by', 'acknowledged_at', 'acknowledged_by',
        'floor_tag', 'total_estimated_amount', 'is_over_budget', 'budget_limit', 'over_budget_amount'
    ];

    for (const col of candidates) {
        const { data, error } = await supabase.from('property_monthly_requisitions').select(col).limit(1);
        if (error) {
            console.log(`Column '${col}': MISSING (${error.message})`);
        } else {
            console.log(`Column '${col}': EXISTS`);
        }
    }
}

checkColumns();
