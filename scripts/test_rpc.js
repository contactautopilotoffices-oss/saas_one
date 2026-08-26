const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    // Try calling exec_sql or similar if exists
    const { data, error } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
    console.log('rpc exec_sql result:', { data, error });
}
test();
