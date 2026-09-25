const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const res = await supabase.rpc('execute_sql', {
        query: `
            SELECT p.proname, pg_get_function_arguments(p.oid) as args
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            ORDER BY p.proname
        `
    });
    console.log('Public functions with args:');
    (res.data?.data || []).forEach(f => {
        if (f.args.includes('text') || f.args.includes('varchar') || f.args.length === 0) {
            console.log(`${f.proname}(${f.args})`);
        }
    });
}

check();
