import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
    const { data, error } = await supabaseAdmin.rpc('execute_sql', {
        query: `SELECT proname, prosrc FROM pg_proc WHERE proname = 'fn_hr_ticket_event_outbox'`
    });

    if (error) {
        console.error('RPC error:', error);
        // Try fallback query via pg if pg is available or other rpc
    } else {
        console.log('Triggers on hr_tickets:', data);
    }
}

main().catch(console.error);
