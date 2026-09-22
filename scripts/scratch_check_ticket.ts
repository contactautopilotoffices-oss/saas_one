import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
    console.log('Searching for ticket HR-AUTO-LP-2026-00035...');
    const { data: ticket } = await supabaseAdmin
        .from('hr_tickets')
        .select('*')
        .ilike('ticket_number', '%35%')
        .maybeSingle();

    console.log('Ticket:', ticket);

    if (ticket) {
        const { data: audits } = await supabaseAdmin
            .from('hr_ticket_audit_logs')
            .select('*')
            .eq('ticket_id', ticket.id)
            .order('created_at', { ascending: true });
        console.log('Audit logs:', audits);

        const { data: notifs } = await supabaseAdmin
            .from('notifications')
            .select('*')
            .eq('ticket_id', ticket.id);
        console.log('Notifications (by ticket_id):', notifs);

        const { data: outbox } = await supabaseAdmin
            .from('event_outbox')
            .select('*')
            .eq('entity_id', ticket.id);
        console.log('event_outbox rows:', outbox);

        const { data: omni } = await supabaseAdmin
            .from('omnichannel_events')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);
        console.log('Recent omnichannel_events:', omni);
    }
}

main().catch(console.error);
