const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function findRpc() {
    const fnNames = [
        'execute_sql', 'exec_sql', 'run_sql', 'exec_ddl', 'run_migration', 
        'execute_query', 'exec_query', 'pg_execute', 'custom_sql', 'db_exec'
    ];

    for (const name of fnNames) {
        const res = await supabase.rpc(name, { query: 'SELECT 1;' });
        if (!res.error || res.error.code !== 'PGRST202') {
            console.log(`Found RPC: ${name}`, res);
        }
    }
}

findRpc();
