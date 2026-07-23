
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function checkRunning() {
    const { data: templates } = await supabase
        .from('sop_templates')
        .select('title, frequency, is_running, start_time, end_time')
        .eq('property_id', '716a5035-7188-46ec-95d0-7a062f6b412e')
        .eq('is_active', true);
        
    console.table(templates);
}

checkRunning();
