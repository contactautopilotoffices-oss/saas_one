
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/'/g, '');
const supabase = createClient(url, key);

async function checkDetailed() {
    const { data: properties } = await supabase.from('properties').select('id').ilike('name', '%SS Plaza%');
    const propId = properties[0].id;
    
    console.log('--- Detailed Log for April 27 & 28 (SS Plaza) ---');
    const { data: completions } = await supabase
        .from('sop_completions')
        .select('*')
        .eq('property_id', propId)
        .gte('completion_date', '2026-04-26')
        .lte('completion_date', '2026-04-28')
        .order('completion_date', { ascending: true });
        
    completions.forEach(c => {
        console.log(`[${c.completion_date}] Template: ${c.template_id.slice(0,8)} | Status: ${c.status} | Created: ${c.created_at} | Completed: ${c.completed_at}`);
    });
}

checkDetailed();
