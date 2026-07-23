
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function checkTemplates() {
    const { data: properties } = await supabase.from('properties').select('id, name').ilike('name', '%SS Plaza%');
    const propId = properties[0].id;
    
    const { count } = await supabase
        .from('sop_templates')
        .select('*', { count: 'exact', head: true })
        .eq('property_id', propId)
        .eq('is_active', true)
        .neq('frequency', 'on_demand');
        
    console.log('Active scheduled templates for SS Plaza:', count);
}

checkTemplates();
