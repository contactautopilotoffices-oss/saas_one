const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const sql = `
        ALTER TABLE hr_ticket_categories ALTER COLUMN l1_sla_days TYPE NUMERIC(10,4);
        ALTER TABLE hr_ticket_categories ALTER COLUMN l2_sla_days TYPE NUMERIC(10,4);
        ALTER TABLE hr_ticket_categories ALTER COLUMN l3_sla_days TYPE NUMERIC(10,4);
        ALTER TABLE hr_ticket_categories ALTER COLUMN l4_sla_days TYPE NUMERIC(10,4);
    `;

    console.log('Running SQL to change SLA columns to NUMERIC...');
    const { data, error } = await supabase.rpc('execute_sql', { query: sql });
    console.log('RPC execute_sql result:', { data, error });
}

run();
