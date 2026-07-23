
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function checkAll27() {
    const { data: results } = await supabase
        .from('sop_completions')
        .select('id, property_id, status, template:sop_templates(title)')
        .eq('completion_date', '2026-04-27');
    console.table(results);
}

checkAll27();
