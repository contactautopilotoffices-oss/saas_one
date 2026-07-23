import { createAdminClient } from './frontend/utils/supabase/admin.js';

async function checkCatalog() {
    const supabase = createAdminClient();
    const { data: catalog, error } = await supabase
        .from('procurement_catalog')
        .select('*');
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Catalog Items:', JSON.stringify(catalog, null, 2));
}

checkCatalog();
