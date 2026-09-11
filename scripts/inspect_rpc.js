const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const res = await supabase.rpc('execute_sql', {
        query: "SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = 'execute_sql'"
    });
    console.log('execute_sql definition:', res.data?.[0]);
}

run();
