
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function check27() {
    const { data: results } = await supabase
        .from('sop_completions')
        .select('id, completion_date, status, template:sop_templates(title)')
        .eq('property_id', '716a5035-7188-46ec-95d0-7a062f6b412e')
        .eq('completion_date', '2026-04-27');
    console.table(results);
}

check27();
