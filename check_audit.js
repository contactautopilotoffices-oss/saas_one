const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    db: {
      schema: 'auth'
    }
  }
);

async function run() {
  console.log("Checking auth.audit_log_entries...");
  const { data: audit, error } = await supabase.from('audit_log_entries').select('*').limit(20).order('created_at', { ascending: false });
  if (error) {
    console.error("Error fetching audit logs:", error);
  } else {
    console.log("Audit logs:", audit);
    const deletedLogs = audit.filter(log => log.payload && log.payload.action === 'user_deleted' || log.payload && log.payload.actor_email === 'lohitexplores@gmail.com' || JSON.stringify(log).includes('lohit'));
    console.log("Filtered logs:", deletedLogs);
  }
}

run();
