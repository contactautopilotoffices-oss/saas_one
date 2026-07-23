
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function checkNulls() {
    const { data: compNulls } = await supabase
        .from('sop_completions')
        .select('id')
        .or('property_id.is.null,organization_id.is.null');
    console.log('Null IDs in completions:', compNulls?.length || 0);

    const { data: tempNulls } = await supabase
        .from('sop_templates')
        .select('id')
        .or('property_id.is.null,organization_id.is.null');
    console.log('Null IDs in templates:', tempNulls?.length || 0);
}

checkNulls();
