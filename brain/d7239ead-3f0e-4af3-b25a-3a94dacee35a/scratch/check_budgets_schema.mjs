import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: 'd:/Projects/saas_one/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    try {
        const { data: sample, error: sampleError } = await supabase.from('procurement_budgets').select('*').limit(1);
        if (sampleError) {
            console.error('Error fetching sample:', sampleError.message);
        } else {
            console.log('Budgets columns:', Object.keys(sample[0] || {}));
        }
    } catch (e) {
        console.error('Crash:', e);
    }
}

checkSchema();
