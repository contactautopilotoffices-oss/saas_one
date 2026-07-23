const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    'https://xvucakstcmtfoanmgcql.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2dWNha3N0Y210Zm9hbm1nY3FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzMyMjQ2NSwiZXhwIjoyMDgyODk4NDY1fQ.7WFGFGxTkSurehfwGNVPS2qzNf9toM3bO1GLaLClEwg'
);

async function checkTickets() {
    const { data, error } = await supabase
        .from('tickets')
        .select('id, ticket_number, title, floor_number')
        .in('ticket_number', ['TKT-1778571401127', 'TKT-1778569026701', 'TKT-1778500879538']);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Tickets Found:', JSON.stringify(data, null, 2));
}

checkTickets();
