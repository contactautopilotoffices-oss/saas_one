const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data: qData, error: qError } = await supabase.from('material_requests').select('*, users!target_approver_id(full_name)').limit(1);
    console.log("Query test target_approver_id:", qError || "Success");
    
    const { data: qData2, error: qError2 } = await supabase.from('material_requests').select('*, users!assignee_uid(full_name)').limit(1);
    console.log("Query test assignee_uid:", qError2 || "Success");

    const { data: qData3, error: qError3 } = await supabase.from('material_requests').select('*, users!requested_by(full_name)').limit(1);
    console.log("Query test requested_by:", qError3 || "Success");
}
check();
