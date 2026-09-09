const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigration() {
  const sqlPath = path.join(__dirname, '../supabase/migrations/20260908000002_monthly_requisition_feedback.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Running migration...');
  
  // Try executing via rpc
  for (const fn of ['execute_sql', 'exec_sql', 'run_sql', 'sql']) {
    for (const param of ['sql_query', 'sql', 'query', 'statement']) {
      const { data, error } = await supabase.rpc(fn, { [param]: sql });
      if (!error) {
        console.log(`Successfully applied migration via ${fn}(${param})`);
        return;
      }
    }
  }

  // If RPC is not present, test if table already exists or test table creation via REST
  const { error: testErr } = await supabase.from('monthly_requisition_feedback').select('id').limit(1);
  if (!testErr) {
    console.log('Table monthly_requisition_feedback exists!');
  } else {
    console.log('RPC execution unavailable. Error checking table:', testErr.message);
  }
}

runMigration();
