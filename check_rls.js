const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkPolicies() {
  const { data, error } = await supabase.rpc('query_pg_policies_custom', {});
  if (error) {
    console.log("RPC query failed. Trying direct query if possible, or print error:", error);
  } else {
    console.log("Policies:", data.filter(p => p.tablename === 'generators'));
  }
}

checkPolicies();
