import { createAdminClient } from './frontend/utils/supabase/admin.js';

async function checkOrders() {
    const supabase = createAdminClient();
    const { data: orders, error } = await supabase
        .from('material_requests')
        .select('id, status, ticket_id, property_id, organization_id');
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Total Orders in DB:', orders.length);
    const statusCounts = orders.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
    }, {});
    console.log('Status Counts:', JSON.stringify(statusCounts, null, 2));
}

checkOrders();
