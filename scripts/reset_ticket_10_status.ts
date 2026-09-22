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
    console.log('Resetting ticket #HR-AUTO-LP-2026-00010 status to new for UI testing...');
    const { data: updated, error } = await supabaseAdmin
        .from('hr_tickets')
        .update({
            status: 'new',
            resolution_note: null,
            resolved_at: null,
            resolved_by_user_id: null,
            updated_at: new Date().toISOString()
        })
        .eq('ticket_number', 'HR-AUTO-LP-2026-00010')
        .select()
        .single();

    if (error) {
        console.error('Error resetting ticket:', error);
    } else {
        console.log('✅ Ticket #HR-AUTO-LP-2026-00010 successfully reset to new for live testing!');
    }
}

run();
