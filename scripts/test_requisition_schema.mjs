import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
    const { data: props } = await supabase.from('properties').select('id, organization_id').limit(1);
    const { data: users } = await supabase.from('users').select('id').limit(1);

    if (props?.[0] && users?.[0]) {
        console.log('Testing insert without total_estimated_amount column...');
        const testPayload = {
            organization_id: props[0].organization_id,
            property_id: props[0].id,
            requisition_month: 8,
            requisition_year: 2026,
            floor_tag: 'All Floors',
            file_url: 'https://test.com/test.xlsx',
            file_name: 'test.xlsx',
            file_size_bytes: 100,
            notes: JSON.stringify({
                floor_tag: 'All Floors',
                total_estimated_amount: 100,
                items: []
            }),
            status: 'submitted',
            uploaded_by: users[0].id,
            updated_at: new Date().toISOString(),
            is_over_budget: false,
            budget_limit: 1000,
            over_budget_amount: 0
        };

        const { data: insData, error: insErr } = await supabase
            .from('property_monthly_requisitions')
            .insert(testPayload)
            .select(`
                *,
                property:properties!property_id(id, name),
                uploader:users!uploaded_by(id, full_name, email, phone)
            `)
            .single();

        console.log('Insert test result:', { insData: insData?.id, error: insErr });

        if (insData?.id) {
            await supabase.from('property_monthly_requisitions').delete().eq('id', insData.id);
            console.log('Cleaned up test row successfully!');
        }
    }
}

test();
