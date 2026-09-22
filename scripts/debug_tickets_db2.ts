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
    const { data: tickets, error: tErr } = await supabaseAdmin.from('hr_tickets').select('*');
    console.log('Total tickets count in DB:', tickets?.length, tErr);
    if (tickets) {
        tickets.forEach(t => console.log(`Ticket: ${t.ticket_number} | RaisedBy: ${t.raised_by_user_id} | AssignedTo: ${t.assigned_to_user_id} | Status: ${t.status} | Confidential: ${t.is_confidential}`));
    }

    const { data: hrhead } = await supabaseAdmin.from('users').select('*').eq('email', 'hrhead@gmail.com').single();
    console.log('HR Head User:', hrhead);

    const { data: mstho } = await supabaseAdmin.from('users').select('*').eq('email', 'mst.ho@gmail.com').single();
    console.log('MST HO User:', mstho);

    const { data: hrheadEmp } = await supabaseAdmin.from('employee_profiles').select('*').eq('email', 'hrhead@gmail.com');
    console.log('HR Head Employee Profile:', hrheadEmp);
}

run();
