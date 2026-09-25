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
    console.log('--- ORGANIZATION SETTINGS ---');
    const { data: settings } = await supabaseAdmin
        .from('organization_settings')
        .select('*');
    console.log(JSON.stringify(settings, null, 2));

    console.log('--- TICKET HR-AUTO-LP-2026-00010 ---');
    const { data: ticket10 } = await supabaseAdmin
        .from('hr_tickets')
        .select('*')
        .eq('ticket_number', 'HR-AUTO-LP-2026-00010');
    console.log(JSON.stringify(ticket10, null, 2));
}

run();
