import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function test() {
    // 1. Get a credit ID
    const { data: credit } = await supabaseAdmin
        .from('meeting_room_credits')
        .select('*')
        .limit(1)
        .single();
    
    console.log('Credit:', credit);

    // 2. Get a user ID
    const { data: user } = await supabaseAdmin.auth.admin.listUsers();
    const userId = user.users[0].id;

    // 3. Get a booking ID (optional, can be null or valid)
    const { data: booking } = await supabaseAdmin
        .from('meeting_room_bookings')
        .select('id')
        .limit(1)
        .single();
    
    console.log('Booking:', booking);

    if (!credit) return console.error('No credit found');

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
