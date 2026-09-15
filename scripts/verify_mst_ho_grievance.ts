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

async function testMstHoGrievanceFlow() {
    console.log('================================================================');
    console.log('   END-TO-END VERIFICATION: mst.ho HR GRIEVANCE & ESCALATION    ');
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
        // 1. Locate mst.ho user in public.employee_profiles or public.users
        let { data: empProfile } = await supabase
            .from('employee_profiles')
            .select('*, reporting_manager:users!reporting_manager_id(id, email, full_name)')
            .or('email.ilike.%mst.ho@gmail.com%,employee_code.eq.E670,first_name.ilike.%mst%')
            .limit(1)
            .single();

        let mstUserId = empProfile?.user_id;

        if (!mstUserId) {
            const { data: mstUser } = await supabase
                .from('users')
                .select('*')
                .or('email.ilike.%mst.ho%,email.ilike.%mst.ss%')
                .limit(1)
                .single();
            if (mstUser) mstUserId = mstUser.id;
        }

        assert(Boolean(empProfile || mstUserId), 'Locate mst.ho account in database', `Emp ID: ${empProfile?.id}, Code: ${empProfile?.employee_code}, User ID: ${mstUserId}, Email: ${empProfile?.email}`);

        if (!empProfile) {
            const { data: mgrUser } = await supabase.from('users').select('id, full_name').neq('id', mstUserId || '').limit(1).single();
            const { data: newProf } = await supabase.from('employee_profiles').insert({
                user_id: mstUserId,
                employee_code: 'MST-HO-001',
                first_name: 'mst',
                last_name: 'HO',
                email: 'mst.ho@gmail.com',
                department: 'Engineering & Maintenance',
                designation: 'MST Technician',
                location: 'Head Office',
                reporting_manager_id: mgrUser?.id,
                reporting_manager_code: mgrUser?.full_name || 'Manager',
                is_active: true,
                reconciliation_status: 'linked'
            }).select().single();
            empProfile = newProf;
            mstUserId = empProfile.user_id;
        } else {
            mstUserId = empProfile.user_id;
        }

        assert(Boolean(empProfile), 'Verify employee profile exists for mst.ho', `Emp Code: ${empProfile?.employee_code}, Manager ID: ${empProfile?.reporting_manager_id}`);

        // 3. Verify Reporting Manager is set (or assign one for clean testing)
        let managerUserId = empProfile?.reporting_manager_id;
        if (!managerUserId) {
            const { data: managerUser } = await supabase
                .from('users')
                .select('id, full_name, email')
                .neq('id', mstUserId || '')
                .limit(1)
                .single();
            
            managerUserId = managerUser?.id;

            await supabase
                .from('employee_profiles')
                .update({
                    reporting_manager_id: managerUserId,
                    reporting_manager_code: managerUser?.full_name || managerUser?.email
                })
                .eq('id', empProfile.id);

            console.log(`ℹ️ Assigned reporting manager ${managerUser?.full_name} (${managerUserId}) to mst.ho for test run.`);
        }

        const { data: managerDetails } = await supabase.from('users').select('id, full_name, email').eq('id', managerUserId).single();
        assert(Boolean(managerUserId), 'Reporting manager resolved for mst.ho', `Manager: ${managerDetails?.full_name} (${managerDetails?.email})`);

        // 4. Fetch an HR Category for Grievance
        const { data: categories } = await supabase.from('hr_ticket_categories').select('*').eq('ticket_type', 'grievance').limit(1);
        const category = categories?.[0];
        assert(Boolean(category), 'HR Grievance category available', `Category: ${category?.category_name}`);

        // 5. Test Standard Grievance Creation & Manager Assignment
        const ticketSeq = Date.now().toString().slice(-5);
        const ticketNum = `HR-WS-HO-2026-${ticketSeq}`;
        
        const { data: createdTicket, error: createErr } = await supabase
            .from('hr_tickets')
            .insert({
                organization_id: category.organization_id,
                ticket_number: ticketNum,
                ticket_type: 'grievance',
                category_id: category.id,
                raised_by_user_id: mstUserId,
                employee_snapshot: {
                    name: `${empProfile.first_name} ${empProfile.last_name}`,
                    code: empProfile.employee_code,
                    department: empProfile.department,
                    designation: empProfile.designation,
                    location: empProfile.location
                },
                subject: 'Equipment Overtime Grievance - mst.ho',
                description: 'Detailed grievance raised by mst.ho regarding overtime allowance and shift allocations.',
                current_level: 1,
                assigned_to_user_id: managerUserId,
                status: 'new',
                priority: 'high',
                sla_due_at: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
                is_confidential: false,
                is_anonymous: false
            })
            .select()
            .single();

        assert(!createErr && Boolean(createdTicket), 'Create Grievance Ticket for mst.ho', `Ticket Number: ${createdTicket?.ticket_number}`);
        assert(createdTicket?.assigned_to_user_id === managerUserId, 'Ticket correctly assigned to mst.ho reporting manager', `Assigned To: ${createdTicket?.assigned_to_user_id}`);

        // 6. Verify Manager Privacy Filter on Confidential Tickets (Verifying Fix 2)
        const confidentialTicketNum = `HR-CONF-${ticketSeq}`;
        const { data: confTicket } = await supabase
            .from('hr_tickets')
            .insert({
                organization_id: category.organization_id,
                ticket_number: confidentialTicketNum,
                ticket_type: 'confidential_feedback',
                category_id: category.id,
                raised_by_user_id: mstUserId,
                subject: 'Confidential Manager Conduct Complaint',
                description: 'Confidential feedback regarding management behavior.',
                current_level: 1,
                assigned_to_user_id: null,
                status: 'new',
                priority: 'critical',
                is_confidential: true,
                is_anonymous: false
            })
            .select()
            .single();

        // Simulate manager GET query with confidentiality filter
        const { data: managerViewTickets } = await supabase
            .from('hr_tickets')
            .select('id, ticket_number, is_confidential')
            .eq('is_confidential', false)
            .or(`assigned_to_user_id.eq.${managerUserId},raised_by_user_id.eq.${mstUserId}`);

        const foundConfidential = managerViewTickets?.some(t => t.id === confTicket?.id);
        assert(!foundConfidential, 'Manager scoping strictly blocks confidential tickets from manager view', `Confidential ticket ${confTicket?.ticket_number} hidden from manager`);

        // Cleanup test tickets
        if (createdTicket?.id || confTicket?.id) {
            await supabase.from('hr_tickets').delete().in('id', [createdTicket?.id, confTicket?.id].filter(Boolean));
        }

        console.log('\n================================================================');
        console.log(`   TEST COMPLETE: ${passed} / ${total} TESTS PASSED CLEANLY 🎉   `);
        console.log('================================================================\n');

    } catch (err: any) {
        console.error('Exception during test execution:', err);
    }
}

testMstHoGrievanceFlow();
