const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const res = await supabase.rpc('execute_sql', {
        query: "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public'"
    });
    console.log('Public routines:', JSON.stringify(res.data, null, 2));
}

run();
