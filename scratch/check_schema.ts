import { createAdminClient } from './frontend/utils/supabase/admin';

async function checkSchema() {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_column_info', { table_name: 'procurement_catalog' });
    
    if (error) {
        // If RPC doesn't exist, try a direct query to information_schema
        const { data: cols, error: colError } = await supabase
            .from('information_schema.columns')
            .select('column_name, data_type')
            .eq('table_name', 'procurement_catalog');
            
        if (colError) {
            console.error('Error fetching schema:', colError);
        } else {
            console.log('Column Types:', cols);
        }
    } else {
        console.log('Column Types:', data);
    }
}

checkSchema();
