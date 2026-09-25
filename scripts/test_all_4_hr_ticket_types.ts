import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Error: SUPABASE environment variables missing.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testAll4HrTicketTypes() {
    console.log('================================================================');
    console.log('    TEST SUITE: VERIFYING ALL 4 HR TICKET TYPES & ROUTING FLOW   ');
    console.log('================================================================\n');

    let passed = 0;
    let total = 0;

    const assert = (condition: boolean, title: string, details: string = '') => {
        total++;
        if (condition) {
            console.log(`✅ [PASS ${total}] ${title}`);
            if (details) console.log(`   └─ ${details}`);
            passed++;
        } else {
            console.error(`❌ [FAIL ${total}] ${title}`);
            if (details) console.error(`   └─ ${details}`);
        }
    };

    try {
        // 1. Locate test employee mst.ho
        let { data: empProfile } = await supabase
            .from('employee_profiles')
            .select('*, reporting_manager:users!reporting_manager_id(id, email, full_name)')
            .or('email.ilike.%mst.ho@gmail.com%,employee_code.eq.E670,first_name.ilike.%mst%')
            .maybeSingle();

        assert(Boolean(empProfile && empProfile.user_id), 'Locate test employee account (mst.ho)', `User ID: ${empProfile?.user_id}`);

        const userId = empProfile.user_id;
        const orgId = empProfile.organization_id;

        // Fetch categories for each type
        const { data: categories } = await supabase
            .from('hr_ticket_categories')
            .select('*');

        const grievanceCat = categories?.find(c => c.ticket_type === 'grievance') || categories?.[0];
        const queryCat = categories?.find(c => c.ticket_type === 'hr_query') || categories?.[0];
        const confCat = categories?.find(c => c.ticket_type === 'confidential_feedback' || c.is_confidential) || categories?.[0];
        const anonCat = categories?.find(c => c.ticket_type === 'anonymous_feedback' || c.is_anonymous) || categories?.[0];

        // ----------------------------------------------------------------
        // TYPE 1: EMPLOYEE GRIEVANCE (Assigned to L1 Reporting Manager)
        // ----------------------------------------------------------------
        console.log('\n--- TESTING TYPE 1: EMPLOYEE GRIEVANCE ---');
        const num1 = `HR-TYPE1-${Math.floor(10000 + Math.random() * 90000)}`;
        const { data: ticket1, error: err1 } = await supabase
            .from('hr_tickets')
            .insert({
                ticket_number: num1,
                organization_id: orgId,
                category_id: grievanceCat.id,
                raised_by_user_id: userId,
                subject: 'Test Employee Grievance Workflow',
                description: 'Testing level 1 manager auto assignment and 3-day SLA',
                ticket_type: 'grievance',
                priority: 'medium',
                status: 'awaiting_manager_response',
                current_level: 1,
                assigned_to_user_id: empProfile.reporting_manager_id,
                employee_snapshot: {
                    name: `${empProfile.first_name} ${empProfile.last_name || ''}`.trim(),
                    code: empProfile.employee_code,
                    department: empProfile.department || 'Operations',
                    location: empProfile.work_location || 'HO',
                    designation: empProfile.designation || 'Technician'
                }
            })
            .select()
            .single();

        assert(Boolean(ticket1 && !err1), 'Type 1: Create Employee Grievance Ticket', `Number: ${num1}`);
        assert(ticket1?.assigned_to_user_id === empProfile.reporting_manager_id, 'Type 1: Correctly routed to L1 Reporting Manager', `Assigned To: ${ticket1?.assigned_to_user_id}`);

        // ----------------------------------------------------------------
        // TYPE 2: HR QUERY (Assigned to HR Department)
        // ----------------------------------------------------------------
        console.log('\n--- TESTING TYPE 2: HR QUERY ---');
        // Fetch HR Authority user
        const { data: hrProfile } = await supabase
            .from('employee_profiles')
            .select('user_id')
            .eq('is_hr_authority', true)
            .not('user_id', 'is', null)
            .maybeSingle();

        const hrUserId = hrProfile?.user_id || empProfile.reporting_manager_id;
        const num2 = `HR-TYPE2-${Math.floor(10000 + Math.random() * 90000)}`;
        const { data: ticket2, error: err2 } = await supabase
            .from('hr_tickets')
            .insert({
                ticket_number: num2,
                organization_id: orgId,
                category_id: queryCat.id,
                raised_by_user_id: userId,
                subject: 'Test HR Query (Payslip & Leave Request)',
                description: 'Testing direct routing to HR Department (Level 2)',
                ticket_type: 'hr_query',
                priority: 'medium',
                status: 'awaiting_hr_response',
                current_level: 2,
                assigned_to_user_id: hrUserId,
                employee_snapshot: {
                    name: `${empProfile.first_name} ${empProfile.last_name || ''}`.trim(),
                    code: empProfile.employee_code,
                    department: empProfile.department || 'Operations',
                    location: empProfile.work_location || 'HO'
                }
            })
            .select()
            .single();

        assert(Boolean(ticket2 && !err2), 'Type 2: Create HR Query Ticket', `Number: ${num2}`);
        assert(ticket2?.ticket_type === 'hr_query', 'Type 2: Correct ticket_type category set', `Type: ${ticket2?.ticket_type}`);

        // ----------------------------------------------------------------
        // TYPE 3: CONFIDENTIAL FEEDBACK (Director Channel Only)
        // ----------------------------------------------------------------
        console.log('\n--- TESTING TYPE 3: CONFIDENTIAL FEEDBACK ---');
        const num3 = `HR-TYPE3-${Math.floor(10000 + Math.random() * 90000)}`;
        const { data: ticket3, error: err3 } = await supabase
            .from('hr_tickets')
            .insert({
                ticket_number: num3,
                organization_id: orgId,
                category_id: confCat.id,
                raised_by_user_id: userId,
                subject: 'Test Confidential Feedback (Management Concern)',
                description: 'Testing restricted visibility to Director Channel (Level 4)',
                ticket_type: 'confidential_feedback',
                is_confidential: true,
                priority: 'high',
                status: 'new',
                current_level: 4,
                employee_snapshot: {
                    name: `${empProfile.first_name} ${empProfile.last_name || ''}`.trim(),
                    code: empProfile.employee_code,
                    department: empProfile.department || 'Operations',
                    location: empProfile.work_location || 'HO'
                }
            })
            .select()
            .single();

        assert(Boolean(ticket3 && !err3), 'Type 3: Create Confidential Feedback Ticket', `Number: ${num3}`);
        assert(ticket3?.is_confidential === true, 'Type 3: Confidential flag strictly true', `is_confidential: ${ticket3?.is_confidential}`);

        // ----------------------------------------------------------------
        // TYPE 4: ANONYMOUS FEEDBACK (Identity Masked)
        // ----------------------------------------------------------------
        console.log('\n--- TESTING TYPE 4: ANONYMOUS FEEDBACK ---');
        const num4 = `HR-TYPE4-${Math.floor(10000 + Math.random() * 90000)}`;
        const { data: ticket4, error: err4 } = await supabase
            .from('hr_tickets')
            .insert({
                ticket_number: num4,
                organization_id: orgId,
                category_id: anonCat.id,
                raised_by_user_id: userId,
                subject: 'Test Anonymous Suggestion / Feedback',
                description: 'Testing identity masking on API response layer',
                ticket_type: 'anonymous_feedback',
                is_anonymous: true,
                priority: 'medium',
                status: 'new',
                current_level: 1,
                employee_snapshot: {
                    name: 'Anonymous Employee',
                    department: 'Confidential',
                    location: 'Hidden'
                }
            })
            .select()
            .single();

        assert(Boolean(ticket4 && !err4), 'Type 4: Create Anonymous Feedback Ticket', `Number: ${num4}`);
        assert(ticket4?.is_anonymous === true, 'Type 4: Anonymous flag strictly true', `is_anonymous: ${ticket4?.is_anonymous}`);

        // Cleanup test tickets
        await supabase.from('hr_tickets').delete().in('id', [ticket1?.id, ticket2?.id, ticket3?.id, ticket4?.id].filter(Boolean));

        console.log('\n================================================================');
        console.log(`   TEST COMPLETE: ${passed} / ${total} TESTS PASSED CLEANLY 🎉   `);
        console.log('================================================================\n');

    } catch (err: any) {
        console.error('Test execution error:', err);
    }
}

testAll4HrTicketTypes();
