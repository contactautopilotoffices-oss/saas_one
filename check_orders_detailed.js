import { createAdminClient } from './frontend/utils/supabase/admin.js';

async function checkOrdersDetailed() {
    const supabase = createAdminClient();
    const { data: orders, error } = await supabase
        .from('material_requests')
        .select(`
            *,
            property:properties(name)
        `);
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Orders in DB:', JSON.stringify(orders, null, 2));
}

checkOrdersDetailed();
