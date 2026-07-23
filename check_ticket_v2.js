import { createAdminClient } from './frontend/utils/supabase/admin.js';

async function checkTicket() {
    const supabase = createAdminClient();
    const { data: tickets, error } = await supabase
        .from('tickets')
        .select(`
            id,
            ticket_number,
            property_id,
            properties(name),
            material_requests(*)
        `)
        .ilike('ticket_number', '%1777351125480%');
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Found Tickets:', JSON.stringify(tickets, null, 2));
}

checkTicket();
