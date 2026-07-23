import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function checkTickets() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    
    const { data, error } = await supabase
        .from('tickets')
        .select('id, title, status, sla_deadline, sla_breached')
        .limit(10);
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Sample tickets:');
    console.table(data);
    
    const { count } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('sla_breached', true);
    
    console.log('Count of sla_breached=true:', count);

    const { count: countPastDeadline } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .lt('sla_deadline', new Date().toISOString())
        .not('status', 'in', '("resolved","closed","completed")');
    
    console.log('Count of active tickets past deadline:', countPastDeadline);
}

checkTickets();
