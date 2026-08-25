const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const sqlPath = path.join(__dirname, '../supabase/migrations/20260824000001_property_monthly_requisition_budgets.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Trying execute_sql RPC with migration...');
    const { data, error } = await supabase.rpc('execute_sql', { sql_query: sql });
    console.log('Result with sql_query parameter:', { data, error });

    if (error) {
        const { data: d2, error: e2 } = await supabase.rpc('execute_sql', { sql });
        console.log('Result with sql parameter:', { data: d2, error: e2 });
    }

    if (error) {
        const { data: d3, error: e3 } = await supabase.rpc('execute_sql', { query: sql });
        console.log('Result with query parameter:', { data: d3, error: e3 });
    }
}

run();
