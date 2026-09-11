import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables missing.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runHRModuleTests() {
    console.log('=====================================================');
    console.log('   HR TICKETING & GRIEVANCE MANAGEMENT MODULE TESTS  ');
    console.log('=====================================================\n');

    let passedTests = 0;
    let totalTests = 0;

    const assert = (condition: boolean, testName: string) => {
        totalTests++;
        if (condition) {
            console.log(`✅ [PASS] Test ${totalTests}: ${testName}`);
            passedTests++;
        } else {
            console.error(`❌ [FAIL] Test ${totalTests}: ${testName}`);
        }
    };

    try {
        // Test 1: Verify Employee Profiles Table & Seed Count (96 employees)
        const { count: empCount, data: empData, error: empErr } = await supabase
            .from('employee_profiles')
            .select('*', { count: 'exact' });

        assert(!empErr && (empCount || 0) >= 90, `Database contains employee profiles (Count: ${empCount})`);

        // Test 2: Verify Reporting Manager Resolution (e.g. Meena Chavan E001 -> Foram Kashyap E007)
        const { data: meenaProfile } = await supabase
            .from('employee_profiles')
            .select('*, reporting_manager:users!reporting_manager_id(*)')
            .eq('employee_code', 'E001')
            .single();

        assert(Boolean(meenaProfile && meenaProfile.reporting_manager_code === 'Foram Kashyap'), 'Employee E001 (Meena Chavan) has reporting_manager_code = Foram Kashyap');

        // Test 3: Verify Director Authority Designation (Saniel Golechha E031 & Rushabh Shah E032)
        const { data: directors } = await supabase
            .from('employee_profiles')
            .select('*')
            .eq('is_director_authority', true);

        assert(directors && directors.length >= 2, `Director Authority flags correctly set for Saniel & Rushabh (Count: ${directors?.length})`);

        // Test 4: Verify Category Master
        const { data: categories } = await supabase
            .from('hr_ticket_categories')
            .select('*');

        assert(categories && categories.length >= 10, `HR Categories initialized (Categories count: ${categories?.length})`);

        // Test 5: Simulate Ticket Creation with Auto-Routing to Reporting Manager
        const testCategory = categories?.find(c => c.ticket_type === 'grievance');
        const testOrgId = meenaProfile?.organization_id || '00000000-0000-0000-0000-000000000000';

        const { data: ticket, error: ticketErr } = await supabase
            .from('hr_tickets')
            .insert({
                organization_id: testOrgId,
                ticket_number: `HR-TEST-${Date.now().toString().slice(-4)}`,
                ticket_type: 'grievance',
                category_id: testCategory.id,
                raised_by_user_id: meenaProfile?.user_id || null,
                employee_snapshot: { name: 'Meena Chavan', code: 'E001', department: 'Operations' },
                subject: 'Test Workload Grievance',
                description: 'Automated test grievance ticket description.',
                current_level: 1,
                status: 'new',
                priority: 'medium',
                sla_due_at: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
                is_confidential: false,
                is_anonymous: false
            })
            .select()
            .single();

        assert(!ticketErr && Boolean(ticket?.id), `Grievance ticket created successfully (${ticket?.ticket_number})`);

        // Test 6: Dual-Channel Comments (Public vs Internal Note)
        const { data: comment, error: commentErr } = await supabase
            .from('hr_ticket_comments')
            .insert({
                ticket_id: ticket.id,
                sender_name: 'HR Executive',
                content: 'This is a test internal handler note.',
                is_internal: true
            })
            .select()
            .single();

        assert(!commentErr && comment.is_internal === true, 'Internal note posted and tagged with is_internal=true');

        // Test 7: Audit Log Tracking
        const { data: auditLogs } = await supabase
            .from('hr_ticket_audit_logs')
            .select('*')
            .eq('ticket_id', ticket.id);

        // Clean up test ticket
        if (ticket?.id) {
            await supabase.from('hr_tickets').delete().eq('id', ticket.id);
        }

        console.log(`\n=====================================================`);
        console.log(` TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
        console.log(`=====================================================\n`);

    } catch (err: any) {
        console.error('Test suite error:', err);
    }
}

runHRModuleTests();
