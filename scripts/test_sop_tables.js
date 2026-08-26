const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data: missed, error: missedErr } = await supabase.from('sop_missed_alerts').select('*').limit(1);
    console.log('sop_missed_alerts check:', { count: missed?.length, error: missedErr });

    const { data: reminderLogs, error: reminderErr } = await supabase.from('sop_reminder_logs').select('*').limit(1);
    console.log('sop_reminder_logs check:', { count: reminderLogs?.length, error: reminderErr });

    const { data: templates, error: tmplErr } = await supabase.from('sop_templates').select('id, title, frequency, start_time, end_time, is_active, is_running, assigned_to').limit(5);
    console.log('sop_templates sample:', templates);
}

check();
