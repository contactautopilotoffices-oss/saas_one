const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    // Test settings FK
    const { data: s1, error: e1 } = await supabase.from('procurement_settings')
        .select('*, users!procurement_settings_low_approver_id_fkey(full_name)').limit(1);
    console.log("settings low_approver_id FK:", e1 ? `ERROR: ${e1.message}` : "OK");

    const { data: s2, error: e2 } = await supabase.from('procurement_settings')
        .select('*, users!procurement_settings_high_approver_id_fkey(full_name)').limit(1);
    console.log("settings high_approver_id FK:", e2 ? `ERROR: ${e2.message}` : "OK");

    // Test if low_approver_id column exists
    const { data: s3, error: e3 } = await supabase.from('procurement_settings')
        .select('low_approver_id, high_approver_id').limit(1);
    console.log("settings columns:", e3 ? `ERROR: ${e3.message}` : JSON.stringify(s3));

    // Test procurement_activity_log table structure
    const { data: s4, error: e4 } = await supabase.from('procurement_activity_log').select('*').limit(1);
    console.log("activity_log columns:", e4 ? `ERROR: ${e4.message}` : (s4?.length ? Object.keys(s4[0]).join(', ') : "empty table"));
}
check();
