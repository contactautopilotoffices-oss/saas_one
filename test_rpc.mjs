import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) acc[match[1].trim()] = match[2].trim().replace(/['"]/g, '');
    return acc;
}, {});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log("Fetching credit...");
    const { data: credit } = await supabaseAdmin
        .from('meeting_room_credits')
        .select('*')
        .limit(1)
        .single();
    
    console.log('Credit:', credit);

    console.log("Fetching user...");
    const { data: user } = await supabaseAdmin.auth.admin.listUsers();
    const userId = user.users[0].id;

    console.log("Fetching booking...");
    const { data: booking } = await supabaseAdmin
        .from('meeting_room_bookings')
        .select('id')
        .limit(1)
        .single();
    
    console.log('Booking:', booking);

    if (!credit) return console.error('No credit found');

    console.log("Running RPC...");
    const { data, error } = await supabaseAdmin.rpc('deduct_meeting_room_credit', {
        p_credit_id: credit.id,
        p_hours: 1,
        p_booking_id: booking?.id || null,
        p_user_id: userId,
        p_notes: 'Test deduction'
    });

    console.log('Result:', data);
    console.log('Error:', error);
}

test();
