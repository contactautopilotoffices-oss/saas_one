
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function checkTemplates2() {
    const { data: templates } = await supabase
        .from('sop_templates')
        .select('id, title, is_active')
        .eq('property_id', '79ba1aa5-bf91-4956-9dbe-ce9986790b53');
    console.table(templates);
}

checkTemplates2();
