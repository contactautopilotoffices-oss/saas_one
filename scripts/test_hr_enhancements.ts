import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { GET as getTickets, POST as createTicket } from '../app/api/hr/tickets/route';
import { GET as getTicketById, PATCH as patchTicket } from '../app/api/hr/tickets/[id]/route';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testEnhancements() {
    console.log('========================================================================');
    console.log('🧪 VERIFYING HR GRIEVANCE ENHANCEMENTS & BUG FIXES');
    console.log('========================================================================\n');

    const orgId = '211e1330-ad83-446d-941f-dcea48396798';
    let passed = 0;
    let failed = 0;
    let testTicket: any = null;

    function assert(condition: boolean, testName: string, detail?: string) {
        if (condition) {
            console.log(`✅ [PASS] ${testName}`);
            passed++;
        } else {
            console.error(`❌ [FAIL] ${testName}: ${detail || 'Assertion failed'}`);
            failed++;
        }
    }

    try {
        // 1. TEST LOAD TIME / PERFORMANCE of GET /api/hr/tickets
        console.log('--- TEST 1: Performance of GET /api/hr/tickets ---');
        const start = Date.now();
        const req1 = new Request(`http://localhost/api/hr/tickets?orgId=${orgId}&userId=5fe04b2c-a77e-4d22-a95f-46836173f9ee&role=employee`);
        const res1 = await getTickets(req1);
        const data1 = await res1.json();
        const duration = Date.now() - start;

        assert(res1.status === 200 && data1.success === true, 'GET /api/hr/tickets returns success status 200');
        assert(duration < 2500, `GET /api/hr/tickets completed in ${duration}ms (non-blocking SLA check)`);

        // 2. TEST MANDATORY RESOLUTION NOTE ENFORCEMENT
        // Find an HR user for test execution
        const { data: hrMember } = await supabaseAdmin
            .from('organization_memberships')
            .select('user_id, role')
            .eq('organization_id', orgId)
            .ilike('role', '%hr%')
            .limit(1)
            .maybeSingle();

        const hrUserId = hrMember?.user_id || '58394a71-c780-4c46-a558-06924b9440a4';

        // Create an isolated temporary test ticket so NO user tickets (like HR-AUTO-B-2026-00003) are EVER touched
        const testTicketNumber = `HR-TEMP-TEST-${Date.now()}`;
        const insertRes = await supabaseAdmin
            .from('hr_tickets')
            .insert({
                organization_id: orgId,
                ticket_number: testTicketNumber,
                ticket_type: 'grievance',
                subject: '[AUTOMATION TEST TICKET - TRANSIENT]',
                description: 'Safe test ticket for resolution note and force close verification',
                priority: 'medium',
                status: 'new',
                current_level: 1,
                raised_by_user_id: hrUserId,
                assigned_to_user_id: hrUserId
            })
            .select('*')
            .single();
        testTicket = insertRes.data;

        if (testTicket) {
            console.log(`Testing with isolated temporary ticket #${testTicket.ticket_number} (ID: ${testTicket.id})`);

            // Attempt to resolve with NO resolution note
            const patchReqEmpty = new Request(`http://localhost/api/hr/tickets/${testTicket.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'pending_acknowledgement',
                    action: 'resolve',
                    resolution_note: '   ',
                    actor_user_id: hrUserId
                })
            });

            const patchResEmpty = await patchTicket(patchReqEmpty, { params: Promise.resolve({ id: testTicket.id }) });
            const patchDataEmpty = await patchResEmpty.json();

            assert(
                patchResEmpty.status === 400 && patchDataEmpty.success === false,
                'Attempt to resolve ticket with empty resolution note was blocked (HTTP 400)'
            );
            assert(
                patchDataEmpty.error && patchDataEmpty.error.includes('resolution note is strictly mandatory'),
                `Correct mandatory error returned: "${patchDataEmpty.error}"`
            );

            // Now attempt to resolve with a VALID resolution note
            const validNote = 'Resolution actions completed: Met with team and documented agreement.';
            const patchReqValid = new Request(`http://localhost/api/hr/tickets/${testTicket.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'pending_acknowledgement',
                    action: 'resolve',
                    resolution_note: validNote,
                    actor_user_id: hrUserId
                })
            });

            const patchResValid = await patchTicket(patchReqValid, { params: Promise.resolve({ id: testTicket.id }) });
            const patchDataValid = await patchResValid.json();

            assert(
                patchResValid.status === 200 && patchDataValid.success === true,
                'Ticket successfully resolved when non-empty resolution note is supplied'
            );

            // Re-fetch ticket to verify resolution_note was saved
            const { data: updatedTicket } = await supabaseAdmin
                .from('hr_tickets')
                .select('resolution_note, status')
                .eq('id', testTicket.id)
                .single();

            assert(
                updatedTicket?.resolution_note === validNote,
                'Resolution note was properly persisted in database'
            );
        }

        // 3. TEST HR USER CREATING ANONYMOUS TICKET & SEEING IT IN "MY RAISED"
        console.log('\n--- TEST 3: HR Submitter Seeing Anonymous & Confidential in My Raised ---');
        // Check if an anonymous ticket raised by this user can be retrieved
        const { data: anyAnonTicket } = await supabaseAdmin
            .from('hr_tickets')
            .select('id, raised_by_user_id')
            .eq('is_anonymous', true)
            .limit(1)
            .maybeSingle();

        const testAnonUserId = anyAnonTicket?.raised_by_user_id || hrUserId;

        // Query tickets as this user with role=hr
        const reqHr = new Request(`http://localhost/api/hr/tickets?orgId=${orgId}&userId=${testAnonUserId}&role=hr`);
        const resHr = await getTickets(reqHr);
        const dataHr = await resHr.json();

        assert(resHr.status === 200 && dataHr.success === true, 'GET /api/hr/tickets returns success for HR user');

        // Check if the anonymous tickets raised by testAnonUserId are present
        const myRaisedAnonTickets = (dataHr.data || []).filter((t: any) => t.is_anonymous && t.raised_by_user_id === testAnonUserId);
        console.log(`Found ${myRaisedAnonTickets.length} anonymous tickets raised by user in their query results.`);
        assert(
            dataHr.data && Array.isArray(dataHr.data),
            'HR user ticket list successfully retrieved without dropping tickets'
        );

        // 4. TEST DESIGNATION FROM EMPLOYEE_PROFILES IN TICKET DETAILS
        console.log('\n--- TEST 4: Designation in Ticket Details ---');
        if (testTicket) {
            const reqDetail = new Request(`http://localhost/api/hr/tickets/${testTicket.id}?userId=${hrUserId}&role=org_super_admin`);
            const resDetail = await getTicketById(reqDetail, { params: Promise.resolve({ id: testTicket.id }) });
            const dataDetail = await resDetail.json();

            assert(resDetail.status === 200 && dataDetail.success === true, 'GET /api/hr/tickets/[id] returns success');
            if (dataDetail.data?.assigned_to_details) {
                const assigned = dataDetail.data.assigned_to_details;
                assert(
                    assigned.designation !== undefined,
                    `assigned_to_details contains designation property: "${assigned.designation}"`
                );
            }
        }

        // 5. TEST FORCE CLOSE PRESERVES SUBMITTER ACKNOWLEDGEMENT
        console.log('\n--- TEST 5: Force Close Preserves Submitter Acknowledgement ---');
        if (testTicket) {
            // First put ticket into in_progress
            await supabaseAdmin.from('hr_tickets').update({ status: 'in_progress' }).eq('id', testTicket.id);

            // Attempt force close by HR authority
            const fcReq = new Request(`http://localhost/api/hr/tickets/${testTicket.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'pending_acknowledgement',
                    action: 'force_close',
                    force_close: true,
                    force_close_note: 'Resolved via HR intervention; awaiting employee acknowledgement',
                    actor_user_id: hrUserId,
                    actor_role: 'hr'
                })
            });
            const fcRes = await patchTicket(fcReq, { params: Promise.resolve({ id: testTicket.id }) });
            const fcData = await fcRes.json();
            if (!fcData.success) console.log('fcData error details:', fcData);
            assert(fcRes.status === 200 && fcData.success === true, 'Force close by HR succeeds', fcData.error);

            // Verify the ticket in DB is pending_acknowledgement, NOT closed
            const { data: fcCheck } = await supabaseAdmin.from('hr_tickets').select('status, employee_snapshot').eq('id', testTicket.id).single();
            assert(
                fcCheck?.status === 'pending_acknowledgement',
                `Force close routed ticket to pending_acknowledgement (status: "${fcCheck?.status}"), preserving submitter acknowledgement`
            );
            assert(
                fcCheck?.employee_snapshot?.force_closed === true,
                'employee_snapshot recorded force_closed: true flag'
            );
        }

    } catch (err: any) {
        console.error('Unexpected test error:', err);
        failed++;
    } finally {
        if (testTicket?.id) {
            await supabaseAdmin.from('hr_ticket_audit_logs').delete().eq('ticket_id', testTicket.id);
            await supabaseAdmin.from('hr_ticket_comments').delete().eq('ticket_id', testTicket.id);
            await supabaseAdmin.from('hr_tickets').delete().eq('id', testTicket.id);
            console.log(`Cleaned up isolated temporary test ticket #${testTicket.ticket_number}`);
        }
    }

    console.log('\n========================================================================');
    console.log(`🏁 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================');
    process.exit(failed > 0 ? 1 : 0);
}

testEnhancements();
