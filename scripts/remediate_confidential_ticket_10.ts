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
    console.log('--- FINDING HARSH PATIL HO (ADMIN.HO) USER ---');
    const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, email, full_name')
        .or('email.ilike.%admin.ho@gmail.com%,full_name.ilike.%harsh patil HO%');

    const harshHoUser = users?.[0];

    if (!harshHoUser) {
        console.error('Harsh Patil HO user (admin.ho@gmail.com) not found in DB!');
        return;
    }

    console.log('Target User for Level 1 Confidential/Anonymous Feedback:', harshHoUser);

    // 1. Update organization_settings to save flow_assignees
    console.log('--- UPDATING ORGANIZATION SETTINGS ---');
    const { data: settingsData } = await supabaseAdmin.from('organization_settings').select('*').limit(1).maybeSingle();
    const orgId = settingsData?.organization_id || '211e1330-ad83-446d-941f-dcea48396798';

    const currentMatrix = settingsData?.notification_matrix || {};
    const currentEscalationConfig = currentMatrix.hr_escalation_config || {};
    const flowAssignees = currentEscalationConfig.flow_assignees || {};

    if (!flowAssignees.confidential_feedback) flowAssignees.confidential_feedback = {};
    if (!flowAssignees.anonymous_feedback) flowAssignees.anonymous_feedback = {};

    flowAssignees.confidential_feedback['1'] = [harshHoUser.id];
    flowAssignees.anonymous_feedback['1'] = [harshHoUser.id];

    const updatedConfig = {
        ...currentEscalationConfig,
        flow_assignees: flowAssignees
    };

    const updatedMatrix = {
        ...currentMatrix,
        hr_escalation_config: updatedConfig
    };

    await supabaseAdmin
        .from('organization_settings')
        .upsert({
            organization_id: orgId,
            notification_matrix: updatedMatrix,
            hr_escalation_config: updatedConfig,
            updated_at: new Date().toISOString()
        }, { onConflict: 'organization_id' });

    console.log('Successfully updated Admin Config flow_assignees in organization_settings to harsh patil HO!');

    // 2. Remediate Ticket HR-AUTO-LP-2026-00010
    console.log('--- REMEDIATING TICKET HR-AUTO-LP-2026-00010 ---');
    const { data: existingTicket } = await supabaseAdmin
        .from('hr_tickets')
        .select('*')
        .eq('ticket_number', 'HR-AUTO-LP-2026-00010')
        .maybeSingle();

    if (existingTicket) {
        const currentSnapshot = existingTicket.employee_snapshot || {};
        currentSnapshot.manager_name = harshHoUser.full_name || 'harsh patil HO';
        currentSnapshot.routing_mode = 'custom_admin_config';
        currentSnapshot.assigned_history = [harshHoUser.id];

        const { error: updateErr } = await supabaseAdmin
            .from('hr_tickets')
            .update({
                assigned_to_user_id: harshHoUser.id,
                assigned_history: [harshHoUser.id],
                employee_snapshot: currentSnapshot,
                updated_at: new Date().toISOString()
            })
            .eq('id', existingTicket.id);

        if (updateErr) {
            console.error('Error updating ticket 10:', updateErr);
        } else {
            console.log('Successfully remediated ticket #HR-AUTO-LP-2026-00010! Re-assigned to:', harshHoUser.full_name, `(${harshHoUser.id})`);
        }
    } else {
        console.warn('Ticket #HR-AUTO-LP-2026-00010 not found in database.');
    }
}

run();
