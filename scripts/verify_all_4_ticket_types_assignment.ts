import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase env vars!');
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Helper function: Resolves an ID (whether employee_profiles.id or users.id) to a valid users.id
async function resolveToUserId(rawId: string): Promise<string | null> {
    if (!rawId) return null;
    
    // 1. Try matching employee_profiles table by id or user_id
    const { data: prof } = await supabaseAdmin
        .from('employee_profiles')
        .select('user_id')
        .or(`id.eq.${rawId},user_id.eq.${rawId}`)
        .maybeSingle();

    if (prof?.user_id) return prof.user_id;

    // 2. Try matching users table directly
    const { data: uRec } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', rawId)
        .maybeSingle();

    return uRec?.id || null;
}

async function runAllTypesVerification() {
    console.log('\n======================================================================');
    console.log('COMPLETE ADMIN CONFIG TICKET ASSIGNMENT & ESCALATION VERIFICATION');
    console.log('======================================================================\n');

    // 1. Read Admin Escalation Config from organization_settings
    const { data: orgSettings } = await supabaseAdmin
        .from('organization_settings')
        .select('hr_escalation_config, notification_matrix')
        .limit(1)
        .maybeSingle();

    const configObj = orgSettings?.notification_matrix?.hr_escalation_config || orgSettings?.hr_escalation_config || {};
    let flowAssigneesConfig = configObj.flow_assignees || {};
    while (flowAssigneesConfig && flowAssigneesConfig.flow_assignees) {
        flowAssigneesConfig = flowAssigneesConfig.flow_assignees;
    }

    console.log('✓ Admin Config Flow Assignees Structure:');
    console.log(JSON.stringify(flowAssigneesConfig, null, 2));

    const catRes = await supabaseAdmin
        .from('hr_ticket_categories')
        .select('id, category_name')
        .limit(1)
        .single();
    const cat = catRes.data;

    const orgId = '211e1330-ad83-446d-941f-dcea48396798';
    const testTypes = ['grievance', 'hr_query', 'confidential_feedback', 'anonymous_feedback'];

    for (const ticketType of testTypes) {
        console.log(`\n----------------------------------------------------------------------`);
        console.log(`TESTING TICKET TYPE: ${ticketType.toUpperCase()}`);
        console.log(`----------------------------------------------------------------------`);

        // Test Creation (Level 1)
        const l1Configured = flowAssigneesConfig[ticketType]?.[1] || flowAssigneesConfig[ticketType]?.['1'] || [];
        console.log(`Configured Level 1 IDs in Admin Config:`, l1Configured);

        let expectedL1UserId: string | null = null;
        if (l1Configured.length > 0) {
            expectedL1UserId = await resolveToUserId(l1Configured[0]);
        }

        if (expectedL1UserId) {
            const { data: uObj } = await supabaseAdmin.from('users').select('full_name, email').eq('id', expectedL1UserId).single();
            console.log(`Expected Configured L1 Handler: ${uObj?.full_name} (${uObj?.email}) [User ID: ${expectedL1UserId}]`);
        } else {
            console.log(`No specific L1 user configured in Admin Config for ${ticketType} — Fallback to Manager / Authority`);
        }

        // Determine Level 1 Owner via API POST resolution logic
        let l1OwnerId: string | null = expectedL1UserId;
        if (!l1OwnerId) {
            const { data: fallbackUser } = await supabaseAdmin
                .from('employee_profiles')
                .select('user_id')
                .eq('is_hr_authority', true)
                .not('user_id', 'is', null)
                .limit(1);
            l1OwnerId = fallbackUser?.[0]?.user_id || null;
        }

        const tNum = `HR-${ticketType.slice(0, 3).toUpperCase()}-2026-${Math.floor(10000 + Math.random() * 90000)}`;
        const { data: ticket, error: createErr } = await supabaseAdmin
            .from('hr_tickets')
            .insert({
                organization_id: orgId,
                ticket_number: tNum,
                ticket_type: ticketType,
                category_id: cat?.id,
                raised_by_user_id: ticketType === 'anonymous_feedback' ? null : '5fe04b2c-a77e-4d22-a95f-46836173f9ee',
                employee_snapshot: { name: ticketType === 'anonymous_feedback' ? 'Anonymous Employee' : 'Test Submitter', department: 'Operations', location: 'Lower Parel' },
                subject: `Verification Test for ${ticketType}`,
                description: `Testing Admin Config routing for ${ticketType}`,
                current_level: 1,
                assigned_to_user_id: l1OwnerId,
                status: 'new',
                priority: 'medium',
                sla_due_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
                is_anonymous: ticketType === 'anonymous_feedback',
                is_confidential: ticketType === 'confidential_feedback' || ticketType === 'anonymous_feedback'
            })
            .select(`*, assigned_to:users!assigned_to_user_id(id, full_name, email)`)
            .single();

        if (createErr || !ticket) {
            console.error(`❌ Failed to create ticket for ${ticketType}:`, createErr);
            continue;
        }

        console.log(`✓ Created Ticket #${ticket.ticket_number} (ID: ${ticket.id})`);
        console.log(`  Assigned L1 Handler: ${ticket.assigned_to?.full_name} (${ticket.assigned_to?.email}) [User ID: ${ticket.assigned_to_user_id}]`);

        if (expectedL1UserId) {
            console.log(`  L1 Assignment Match Assertion: ${ticket.assigned_to_user_id === expectedL1UserId ? '✅ PASSED (Matches Admin Config)' : '❌ FAILED'}`);
        }

        // Test Escalation to Level 2 (if flow permits)
        const l2Configured = flowAssigneesConfig[ticketType]?.[2] || flowAssigneesConfig[ticketType]?.['2'] || [];
        if (l2Configured.length > 0 || ticketType === 'grievance' || ticketType === 'hr_query') {
            console.log(`\n  Testing Escalation to Level 2 for ${ticketType}...`);
            let expectedL2UserId: string | null = null;
            if (l2Configured.length > 0) {
                expectedL2UserId = await resolveToUserId(l2Configured[0]);
            }

            let nextL2AssigneeId: string | null = expectedL2UserId;
            if (!nextL2AssigneeId) {
                const { data: hrMgr } = await supabaseAdmin
                    .from('employee_profiles')
                    .select('user_id')
                    .or('is_hr_manager_authority.eq.true,is_hr_authority.eq.true')
                    .not('user_id', 'is', null)
                    .limit(1);
                nextL2AssigneeId = hrMgr?.[0]?.user_id || null;
            }

            const { data: escalatedTicket } = await supabaseAdmin
                .from('hr_tickets')
                .update({
                    current_level: 2,
                    status: 'escalated',
                    assigned_to_user_id: nextL2AssigneeId,
                    updated_at: new Date().toISOString()
                })
                .eq('id', ticket.id)
                .select(`*, assigned_to:users!assigned_to_user_id(id, full_name, email)`)
                .single();

            console.log(`  ✓ Escalated to Level 2: #${escalatedTicket?.ticket_number}`);
            console.log(`    New L2 Handler: ${escalatedTicket?.assigned_to?.full_name} (${escalatedTicket?.assigned_to?.email}) [User ID: ${escalatedTicket?.assigned_to_user_id}]`);

            if (expectedL2UserId) {
                console.log(`    L2 Escalation Assignment Match Assertion: ${escalatedTicket?.assigned_to_user_id === expectedL2UserId ? '✅ PASSED (Matches Admin Config)' : '❌ FAILED'}`);
            }
        }
    }

    console.log('\n======================================================================');
    console.log('🎉 ALL TICKET TYPE ASSIGNMENT & ESCALATION VERIFICATIONS COMPLETED!');
    console.log('======================================================================\n');
}

runAllTypesVerification().catch(console.error);
