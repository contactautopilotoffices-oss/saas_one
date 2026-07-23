const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrate() {
  console.log('Starting migration for material_requests with missing organization_id or property_id...');

  // 1. Fetch all requests where org or property is null
  const { data: requests, error } = await supabase
    .from('material_requests')
    .select('id, ticket_id, organization_id, property_id')
    .or('organization_id.is.null,property_id.is.null');

  if (error) {
    console.error('Error fetching requests:', error);
    return;
  }

  console.log(`Found ${requests.length} requests to fix.`);

  for (const req of requests) {
    // 2. Fetch ticket data
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('organization_id, property_id')
      .eq('id', req.ticket_id)
      .single();

    if (ticketError) {
      console.error(`Error fetching ticket ${req.ticket_id} for request ${req.id}:`, ticketError);
      continue;
    }

    // 3. Update request
    const updateData = {
      organization_id: req.organization_id || ticket.organization_id,
      property_id: req.property_id || ticket.property_id
    };

    const { error: updateError } = await supabase
      .from('material_requests')
      .update(updateData)
      .eq('id', req.id);

    if (updateError) {
      console.error(`Error updating request ${req.id}:`, updateError);
    } else {
      console.log(`Successfully fixed request ${req.id} (Ticket: ${req.ticket_id})`);
    }
  }

  console.log('Migration completed.');
}

migrate();
