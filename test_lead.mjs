import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xvucakstcmtfoanmgcql.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2dWNha3N0Y210Zm9hbm1nY3FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzMyMjQ2NSwiZXhwIjoyMDgyODk4NDY1fQ.7WFGFGxTkSurehfwGNVPS2qzNf9toM3bO1GLaLClEwg';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const id = 'b4339ec0-e21e-496e-b0a4-7bb2b29ec535';
    
    // Check in crm_leads
    const { data: lead, error: err1 } = await supabase.from('crm_leads').select('*').eq('id', id).single();
    if (lead) {
        console.log('--- FOUND IN crm_leads ---');
        console.log(lead);
    } else {
        console.log('Not found in crm_leads', err1?.message);
    }

    // Check in crm_meta_leads
    const { data: metaLead, error: err2 } = await supabase.from('crm_meta_leads').select('*').eq('id', id).single();
    if (metaLead) {
        console.log('--- FOUND IN crm_meta_leads ---');
        console.log(metaLead);
    } else {
        console.log('Not found in crm_meta_leads', err2?.message);
    }
}

check().catch(console.error);
