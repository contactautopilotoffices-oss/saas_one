import { createAdminClient } from './frontend/utils/supabase/admin.js';

async function checkTicket() {
    const supabase = createAdminClient();
    const { data: ticket, error } = await supabase
        .from('tickets')
        .select(`
            id,
            ticket_number,
            property_id,
            properties(name),
            material_requests(*)
        `)
        .eq('ticket_number', '1777351125480')
        .single();
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Ticket Info:', JSON.stringify(ticket, null, 2));
}

checkTicket();
