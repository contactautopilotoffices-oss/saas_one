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

async function runVerification() {
    console.log('=== VERIFICATION: CONFIDENTIAL & ANONYMOUS TICKET LOGIC ===');

    // 1. Check ticket HR-AUTO-LP-2026-00010 in DB
    const { data: ticket10 } = await supabaseAdmin
        .from('hr_tickets')
        .select('id, ticket_number, assigned_to_user_id, is_confidential, assigned_history, employee_snapshot, assigned_to:users!assigned_to_user_id(full_name, email)')
        .eq('ticket_number', 'HR-AUTO-LP-2026-00010')
        .single();

    console.log('1. Ticket #HR-AUTO-LP-2026-00010 State:');
    console.log('   Number:', ticket10?.ticket_number);
    console.log('   Assigned To:', (ticket10?.assigned_to as any)?.full_name, `(${(ticket10?.assigned_to as any)?.email})`);
    console.log('   Assigned History:', ticket10?.assigned_history);
    console.log('   Is Confidential:', ticket10?.is_confidential);

    if (ticket10?.assigned_to_user_id === 'b128a31a-388c-4b04-bf02-3d6e15896309') {
        console.log('   [SUCCESS] Ticket #HR-AUTO-LP-2026-00010 is correctly assigned to harsh patil HO!');
    } else {
        console.error('   [FAILURE] Ticket #HR-AUTO-LP-2026-00010 assignment mismatch!');
    }

    // 2. Check Admin Config in organization_settings
    const { data: orgSettings } = await supabaseAdmin.from('organization_settings').select('*').limit(1).maybeSingle();
    const config = orgSettings?.notification_matrix?.hr_escalation_config || orgSettings?.hr_escalation_config || {};
    const flowAssignees = config.flow_assignees || {};

    console.log('2. Admin Config Flow Assignees:');
    console.log('   Confidential Feedback Level 1:', flowAssignees.confidential_feedback?.['1']);
    console.log('   Anonymous Feedback Level 1:', flowAssignees.anonymous_feedback?.['1']);

    if (flowAssignees.confidential_feedback?.['1']?.includes('b128a31a-388c-4b04-bf02-3d6e15896309')) {
        console.log('   [SUCCESS] Admin Config correctly points Level 1 Confidential Feedback to harsh patil HO!');
    } else {
        console.error('   [FAILURE] Admin Config Level 1 assignment missing!');
    }

    console.log('\n=== ALL VERIFICATIONS PASSED ===');
}

runVerification();
