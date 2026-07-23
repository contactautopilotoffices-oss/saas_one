
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function fetchSample() {
    const { data } = await supabase.from('sop_templates').select('id, property_id, organization_id').limit(1);
    console.log(JSON.stringify(data?.[0]));
}

fetchSample();
