const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function applySOPFixMigration() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Supabase environment variables missing');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const file = '20260912000001_fix_sop_runs_outbox_template_title.sql';
    const filePath = path.join(__dirname, '..', 'supabase', 'migrations', file);
    console.log(`Executing migration via RPC: ${file}...`);
    const sql = fs.readFileSync(filePath, 'utf8');

    const { data, error } = await supabase.rpc('execute_sql', { query: sql });
    if (error) {
        console.error('RPC Error:', error);
    } else {
        console.log('✅ Migration result:', data);
    }
}

applySOPFixMigration();
