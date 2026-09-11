const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const file1 = path.join(__dirname, '..', 'supabase', 'migrations', '20260910000001_hr_ticketing_module.sql');
    const file2 = path.join(__dirname, '..', 'supabase', 'migrations', '20260910000002_seed_employee_master.sql');

    const sql1 = fs.readFileSync(file1, 'utf8');
    const sql2 = fs.readFileSync(file2, 'utf8');

    console.log('Executing 20260910000001_hr_ticketing_module.sql via execute_sql RPC...');
    let res1 = await supabase.rpc('execute_sql', { sql_query: sql1 });
    if (res1.error) {
        console.log('rpc execute_sql res1 error, trying sql parameter:', res1.error);
        res1 = await supabase.rpc('execute_sql', { sql: sql1 });
        if (res1.error) {
            console.log('rpc execute_sql res1 second error, trying query parameter:', res1.error);
            res1 = await supabase.rpc('execute_sql', { query: sql1 });
        }
    }
    console.log('Migration 1 result:', res1);

    console.log('Executing 20260910000002_seed_employee_master.sql via execute_sql RPC...');
    let res2 = await supabase.rpc('execute_sql', { sql_query: sql2 });
    if (res2.error) {
        res2 = await supabase.rpc('execute_sql', { sql: sql2 });
        if (res2.error) {
            res2 = await supabase.rpc('execute_sql', { query: sql2 });
        }
    }
    console.log('Migration 2 result:', res2);
}

run();
