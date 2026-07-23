const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data, error } = await supabase.from('issue_logs').select('*');
  console.log('Error:', error);
  console.log('Count:', data?.length);
  console.log('Data:', data?.slice(0, 2));

  // Also check relations
  const { data: d2, error: e2 } = await supabase.from('issue_logs').select(`
        *,
        user:users!user_id(id, full_name, email),
        property:properties!property_id(id, name, code),
        organization:organizations!organization_id(id, name, code),
        assignee:users!assigned_to(id, full_name, email)
      `).limit(1);
  console.log('Rel Error:', e2);
}
check();
