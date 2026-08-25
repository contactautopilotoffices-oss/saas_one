import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testFullSubmission() {
    // Find Mafatlal Chambers property (id: 4f0f44eb-5169-4c67-9d09-325016125a8d from screenshot)
    const propertyId = '4f0f44eb-5169-4c67-9d09-325016125a8d';
    const { data: prop } = await supabase.from('properties').select('id, name, organization_id').eq('id', propertyId).single();
    const { data: user } = await supabase.from('users').select('id, full_name, email').limit(1).single();

    console.log('Testing with property:', prop);
    console.log('Testing with user:', user);

    if (!prop || !user) {
        console.error('Property or user not found');
        return;
    }

    const payload = {
        organization_id: prop.organization_id,
        property_id: prop.id,
        floor_tag: 'All Floors',
        requisition_month: 8,
        requisition_year: 2026,
        user_id: user.id,
        site_notes: 'Test requisition',
        items: [
            {
                name: 'Floor Cleaner (Lizol)',
                category: 'HK',
                brand: 'Lizol',
                details: 'Floral 5L',
                unit: 'Can',
                requested_qty: 2,
                available_stock_qty: 1,
                unit_price: 450
            }
        ]
    };

    // We can directly call the handler logic or test Supabase insert directly
    console.log('Testing storage upload & record insert directly...');
    
    // Test storage bucket
    const filePath = `${payload.organization_id}/${payload.property_id}/${payload.requisition_year}_${payload.requisition_month}_${Date.now()}_test.xlsx`;
    const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('procurement_requisitions')
        .upload(filePath, Buffer.from('test excel content'), {
            upsert: true,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
    console.log('Upload result:', { uploadData, uploadErr });

    const publicUrl = supabase.storage.from('procurement_requisitions').getPublicUrl(filePath).data.publicUrl;

    const insertPayload = {
        organization_id: payload.organization_id,
        property_id: payload.property_id,
        requisition_month: payload.requisition_month,
        requisition_year: payload.requisition_year,
        floor_tag: payload.floor_tag,
        file_url: publicUrl,
        file_name: 'test.xlsx',
        file_size_bytes: 18,
        notes: JSON.stringify({
            floor_tag: payload.floor_tag,
            site_notes: payload.site_notes,
            total_estimated_amount: 900,
            total_items_count: 1,
            items: payload.items
        }),
        status: 'submitted',
        uploaded_by: payload.user_id,
        updated_at: new Date().toISOString(),
        is_over_budget: false,
        budget_limit: 73492,
        over_budget_amount: 0
    };

    const { data: insertedRecord, error: insertErr } = await supabase
        .from('property_monthly_requisitions')
        .insert(insertPayload)
        .select(`
            *,
            property:properties!property_id(id, name),
            uploader:users!uploaded_by(id, full_name, email, phone)
        `)
        .single();

    console.log('Inserted record result:', { id: insertedRecord?.id, error: insertErr });

    if (insertedRecord?.id) {
        await supabase.from('property_monthly_requisitions').delete().eq('id', insertedRecord.id);
        console.log('Cleaned up test requisition successfully!');
    }
}

testFullSubmission();
