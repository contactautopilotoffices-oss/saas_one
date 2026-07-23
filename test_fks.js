const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase.rpc('get_foreign_keys_for_table', { table_name: 'material_requests' });
    if (error) {
        console.log("RPC failed, trying manual query...");
        const { data: qData, error: qError } = await supabase.from('material_requests').select('*, users!approved_by(full_name)').limit(1);
        console.log("Query test:", qError || "Success");
    } else {
        console.log("FKs:", data);
    }
}
check();
