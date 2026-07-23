import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function checkCompletions() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    
    const { data, error } = await supabase
        .from('sop_completions')
        .select('id, status, completed_by, completed_at')
        .eq('status', 'completed')
        .limit(10);
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Sample completions:');
    console.table(data);
}

checkCompletions();
