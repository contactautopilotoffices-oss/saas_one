
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function checkNullOrgs() {
    const { data: results } = await supabase.from('properties').select('id').is('organization_id', null);
    console.log('Null org IDs in properties:', results?.length || 0);
}

checkNullOrgs();
