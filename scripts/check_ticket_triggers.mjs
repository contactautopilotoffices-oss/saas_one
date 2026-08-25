import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xvucakstcmtfoanmgcql.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2dWNha3N0Y210Zm9hbm1nY3FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzMyMjQ2NSwiZXhwIjoyMDgyODk4NDY1fQ.7WFGFGxTkSurehfwGNVPS2qzNf9toM3bO1GLaLClEwg';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRecentOutbox() {
    console.log('--- Checking recent event_outbox entries for TICKETS ---');
    const { data: events, error } = await supabase
        .from('event_outbox')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Error fetching event_outbox:', error);
        return;
    }

    console.log(`Found ${events?.length || 0} recent outbox events:`);
    for (const e of events || []) {
        console.log(`[${e.created_at}] ID: ${e.id} | Type: ${e.event_type} | Entity: ${e.entity_id} | Status: ${e.status}`);
        console.log('   Payload:', JSON.stringify(e.payload));
    }
}

checkRecentOutbox().catch(console.error);
