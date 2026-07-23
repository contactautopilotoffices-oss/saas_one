
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function checkCols() {
    const { data: results } = await supabase.from('organization_memberships').select('*').limit(1);
    if (results && results.length > 0) {
        console.log('Columns in organization_memberships:', Object.keys(results[0]));
    } else {
        console.log('No data in organization_memberships');
    }
}

checkCols();
