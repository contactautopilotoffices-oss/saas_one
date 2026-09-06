const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const has = async () => {
  const { error } = await sb.from('oem_agent_findings').select('refs, stats').limit(1);
  return !error;
};

(async () => {
  console.log('before:', await has() ? 'columns EXIST' : 'columns MISSING');
  const sql = "ALTER TABLE public.oem_agent_findings ADD COLUMN IF NOT EXISTS refs jsonb NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN IF NOT EXISTS stats jsonb NOT NULL DEFAULT '[]'::jsonb;";
  for (const fn of ['execute_sql','exec_sql','run_sql','sql']) {
    for (const param of ['sql_query','sql','query','statement']) {
      const { error } = await sb.rpc(fn, { [param]: sql });
      const ok = await has();
      console.log(`  rpc ${fn}(${param}):`, error ? 'err: ' + error.message.slice(0,70) : 'no error', '| columns now', ok ? 'EXIST ✅' : 'still missing');
      if (ok) { console.log('\nAPPLIED via', fn, param); return; }
    }
  }
  console.log('\nNo RPC on this database can run DDL.');
})();
