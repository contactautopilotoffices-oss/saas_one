import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: 'd:/Projects/saas_one/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing env vars');
    console.log('URL:', supabaseUrl);
    console.log('Key:', supabaseKey ? 'PRESENT' : 'MISSING');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    try {
        const { data: sample, error: sampleError } = await supabase.from('material_requests').select('*').limit(1);
        if (sampleError) {
            console.error('Error fetching sample:', sampleError.message);
        } else {
            console.log('Sample row columns:', Object.keys(sample[0] || {}));
        }
    } catch (e) {
        console.error('Crash:', e);
    }
}

checkSchema();
