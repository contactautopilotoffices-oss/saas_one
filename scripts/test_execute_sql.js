const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log('Testing create table via execute_sql...');
    const res = await supabase.rpc('execute_sql', {
        query: 'CREATE TABLE IF NOT EXISTS public.test_dummy (id uuid primary key default gen_random_uuid(), name text);'
    });
    console.log('Result:', JSON.stringify(res, null, 2));

    const check = await supabase.from('test_dummy').select('*');
    console.log('Check test_dummy table:', check);
}

run();
