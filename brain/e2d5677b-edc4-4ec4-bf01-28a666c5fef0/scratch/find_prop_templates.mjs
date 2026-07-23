
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function findProp() {
    const { data: props } = await supabase.from('properties').select('id, name').ilike('name', '%SS Plaza%');
    console.log('Properties found:', props);
    if (props && props.length > 0) {
        const { data: templates } = await supabase
            .from('sop_templates')
            .select('title, frequency, is_running, start_time, end_time')
            .eq('property_id', props[0].id)
            .eq('is_active', true);
        console.table(templates);
    }
}

findProp();
