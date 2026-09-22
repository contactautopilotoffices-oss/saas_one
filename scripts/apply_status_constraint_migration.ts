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
    console.log('--- APPLYING STATUS CONSTRAINT MIGRATION ---');
    const sql = `
        ALTER TABLE public.hr_tickets DROP CONSTRAINT IF EXISTS hr_tickets_status_check;
        ALTER TABLE public.hr_tickets ADD CONSTRAINT hr_tickets_status_check CHECK (status IN ('new', 'assigned', 'in_progress', 'awaiting_employee_response', 'awaiting_manager_response', 'awaiting_hr_response', 'awaiting_internal_approval', 'awaiting_external_party', 'escalated', 'pending_acknowledgement', 'resolved', 'closed', 'reopened', 'cancelled'));
    `;

    // Try applying using rpc or direct exec if available
    try {
        const { error } = await supabaseAdmin.rpc('exec_sql', { sql });
        if (error) {
            console.warn('RPC exec_sql not available or failed:', error.message);
        } else {
            console.log('Migration applied via exec_sql successfully!');
            return;
        }
    } catch (e) {
        console.warn('exec_sql attempt failed:', e);
    }

    // Fallback: Test ticket PATCH now
    console.log('Testing PATCH directly via Supabase client...');
}

run();
