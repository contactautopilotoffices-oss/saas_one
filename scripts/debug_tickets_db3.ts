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
    const { data: tickets } = await supabaseAdmin.from('hr_tickets').select('*');
    console.log('TICKETS:');
    tickets?.forEach(t => console.log(t.ticket_number, 'org_id:', t.organization_id, 'assigned:', t.assigned_to_user_id));

    const { data: mems } = await supabaseAdmin.from('organization_memberships').select('*').eq('user_id', '990965fe-039a-4144-8880-9e7a9f5f175b');
    console.log('HR HEAD MEMBERSHIPS:', mems);
}

run();
