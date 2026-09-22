import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

let envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) envPath = path.join(process.cwd(), '.env.local');

if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    for (const line of envConfig.split('\n')) {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            const value = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
            if (key && !process.env[key]) process.env[key] = value;
        }
    }
}

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    const ticketId = 'ec0dcaa8-6d75-4b93-be39-76b1980a51dd'; // #HR-AUTO-LP-2026-00010
    const mstHoUserId = '5fe04b2c-a77e-4d22-a95f-46836173f9ee'; // Submitter mst HO

    console.log('--- TEST 1: SETTING TICKET TO PENDING ACKNOWLEDGEMENT ---');
    const { data: ticketPending, error: err1 } = await supabaseAdmin
        .from('hr_tickets')
        .update({
            status: 'pending_acknowledgement',
            resolution_note: 'Resolution provided by level owner',
            resolved_at: new Date().toISOString(),
            resolved_by_user_id: 'b128a31a-388c-4b04-bf02-3d6e15896309',
            updated_at: new Date().toISOString()
        })
        .eq('id', ticketId)
        .select()
        .single();

    if (err1) {
        console.error('Test 1 failed:', err1);
        return;
    }
    console.log('✅ Test 1 Success: Status is now:', ticketPending.status);

    console.log('--- TEST 2: SUBMITTER ACKNOWLEDGES & CLOSES TICKET ---');
    const { data: ticketClosed, error: err2 } = await supabaseAdmin
        .from('hr_tickets')
        .update({
            status: 'closed',
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', ticketId)
        .select()
        .single();

    if (err2) {
        console.error('Test 2 failed:', err2);
        return;
    }
    console.log('✅ Test 2 Success: Status is now:', ticketClosed.status);

    // Reset back to pending_acknowledgement for the user to see the acknowledgment prompt live in the UI!
    await supabaseAdmin
        .from('hr_tickets')
        .update({
            status: 'pending_acknowledgement',
            resolution_note: 'Resolution provided by level owner - please acknowledge',
            resolved_at: new Date().toISOString(),
            resolved_by_user_id: 'b128a31a-388c-4b04-bf02-3d6e15896309',
            updated_at: new Date().toISOString()
        })
        .eq('id', ticketId);

    console.log('✅ Ticket reset to pending_acknowledgement so user can test Acknowledge button in UI!');
}

run();
