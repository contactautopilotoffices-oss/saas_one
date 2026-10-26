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

interface TestResult {
    name: string;
    passed: boolean;
    details?: string;
}

async function runRegressionSuite() {
    console.log('========================================================================');
    console.log('🚀 COMPREHENSIVE HR GRIEVANCE REGRESSION TEST SUITE');
    console.log('========================================================================\n');

    const orgId = '211e1330-ad83-446d-941f-dcea48396798';
    const results: TestResult[] = [];

    function record(name: string, passed: boolean, details?: string) {
        if (passed) {
            console.log(`✅ [PASS] ${name}`);
        } else {
            console.error(`❌ [FAIL] ${name}: ${details || ''}`);
        }
        results.push({ name, passed, details });
    }

    // 1. Fetch Categories for testing
    const { data: categories, error: catErr } = await supabaseAdmin
        .from('hr_ticket_categories')
        .select('*');

    if (catErr || !categories || categories.length === 0) {
        console.error('Could not fetch hr_ticket_categories:', catErr);
        process.exit(1);
    }

    const catName = (c: any) => c.category_name || c.name || c.ticket_type;
    const grievanceCat = categories.find(c => c.ticket_type === 'grievance') || categories[0];
    const hrQueryCat = categories.find(c => c.ticket_type === 'hr_query') || categories[0];
    const feedbackCat = categories.find(c => c.ticket_type === 'feedback') || categories[0];

    console.log(`Found ${categories.length} ticket categories.`);
    console.log(`- Grievance Category: "${catName(grievanceCat)}" (${grievanceCat.id})`);
    console.log(`- HR Query Category: "${catName(hrQueryCat)}" (${hrQueryCat.id})`);
    console.log(`- Feedback Category: "${catName(feedbackCat)}" (${feedbackCat.id})`);

    const userMst = {
        email: 'mst.ho@gmail.com',
        userId: '5fe04b2c-a77e-4d22-a95f-46836173f9ee',
        role: 'mst'
    };

    const userHrHead = {
        email: 'hrhead@gmail.com',
        userId: '990965fe-039a-4144-8880-9e7a9f5f175b',
        role: 'hr_head'
    };

    const createdTicketIds: string[] = [];

    // Helper to create ticket via POST API
    async function createTicketViaAPI(user: typeof userMst, payload: any) {
        const req = new Request('http://localhost/api/hr/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                org_id: orgId,
                raised_by_user_id: user.userId,
                ...payload
            })
        });
        const res = await createTicket(req);
        const data = await res.json();
        return { res, data };
    }

    // Helper to query tickets via GET API
    async function getTicketsViaAPI(user: typeof userMst) {
        const req = new Request(`http://localhost/api/hr/tickets?orgId=${orgId}&userId=${user.userId}&role=${user.role}`);
        const res = await getTickets(req);
        const data = await res.json();
        return { res, data };
    }

    // Helper to get ticket details via GET API
    async function getTicketDetailsViaAPI(ticketId: string, viewer?: { userId: string; role: string }) {
        const url = viewer 
            ? `http://localhost/api/hr/tickets/${ticketId}?userId=${viewer.userId}&role=${viewer.role}`
            : `http://localhost/api/hr/tickets/${ticketId}`;
        const req = new Request(url);
        const res = await getTicketById(req, { params: Promise.resolve({ id: ticketId }) });
        const data = await res.json();
        return { res, data };
    }

    // =========================================================================
    // PART 1: TEST FROM mst.ho@gmail.com (STAFF / MST ROLE)
    // =========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log(`🧑‍🔧 PART 1: Testing Tickets Created by ${userMst.email} (Role: ${userMst.role})`);
    console.log('------------------------------------------------------------------------');

    // 1.1 Employee Grievance
    console.log('\n[1.1] Creating Employee Grievance ticket...');
    const { res: resGrievance, data: dataGrievance } = await createTicketViaAPI(userMst, {
        category_id: grievanceCat.id,
        subject: 'REGRESSION-TEST: mst.ho Employee Grievance',
        description: 'Test Employee Grievance regarding workplace maintenance schedule.',
        priority: 'high',
        is_confidential: false,
        is_anonymous: false
    });

    const tGrievance = dataGrievance?.data;
    record('1.1.1 mst.ho creates Grievance ticket', resGrievance.status === 200 && !!tGrievance?.id, dataGrievance?.error);
    if (tGrievance?.id) {
        createdTicketIds.push(tGrievance.id);
        console.log(`    Ticket #${tGrievance.ticket_number} created (Assigned to: ${tGrievance.assigned_to_user_id || 'unassigned'})`);

        // Check mst.ho can see it in their ticket list (My Raised)
        const { data: mstTickets } = await getTicketsViaAPI(userMst);
        const foundInMst = (mstTickets?.data || []).some((t: any) => t.id === tGrievance.id);
        record('1.1.2 mst.ho can see Grievance in ticket list (My Raised)', foundInMst);

        // Check assigned handler can see it
        if (tGrievance.assigned_to_user_id) {
            const { data: handlerTickets } = await getTicketsViaAPI({
                email: 'handler',
                userId: tGrievance.assigned_to_user_id,
                role: 'employee'
            });
            const foundInHandler = (handlerTickets?.data || []).some((t: any) => t.id === tGrievance.id);
            record('1.1.3 Assigned handler can see Grievance in their tickets list', foundInHandler);
        }

        // Check HR Head can see it (HR Head views standard grievances across org)
        const { data: hrTickets } = await getTicketsViaAPI(userHrHead);
        const foundInHr = (hrTickets?.data || []).some((t: any) => t.id === tGrievance.id);
        record('1.1.4 HR Head can see Grievance ticket', foundInHr);
    }

    // 1.2 HR Query
    console.log('\n[1.2] Creating HR Query ticket...');
    const { res: resHrQuery, data: dataHrQuery } = await createTicketViaAPI(userMst, {
        category_id: hrQueryCat.id,
        subject: 'REGRESSION-TEST: mst.ho HR Query - Leave Balance',
        description: 'Test HR Query asking about annual leave policy.',
        priority: 'medium',
        is_confidential: false,
        is_anonymous: false
    });

    const tHrQuery = dataHrQuery?.data;
    record('1.2.1 mst.ho creates HR Query ticket', resHrQuery.status === 200 && !!tHrQuery?.id, dataHrQuery?.error);
    if (tHrQuery?.id) {
        createdTicketIds.push(tHrQuery.id);
        console.log(`    Ticket #${tHrQuery.ticket_number} created (Assigned to: ${tHrQuery.assigned_to_user_id || 'unassigned'})`);

        // Check mst.ho sees it
        const { data: mstTickets } = await getTicketsViaAPI(userMst);
        const foundInMst = (mstTickets?.data || []).some((t: any) => t.id === tHrQuery.id);
        record('1.2.2 mst.ho can see HR Query in ticket list (My Raised)', foundInMst);

        // Check HR Head sees it
        const { data: hrTickets } = await getTicketsViaAPI(userHrHead);
        const foundInHr = (hrTickets?.data || []).some((t: any) => t.id === tHrQuery.id);
        record('1.2.3 HR Head can see HR Query ticket', foundInHr);
    }

    // 1.3 Confidential Feedback
    console.log('\n[1.3] Creating Confidential Feedback ticket...');
    const { res: resConf, data: dataConf } = await createTicketViaAPI(userMst, {
        category_id: feedbackCat.id,
        subject: 'REGRESSION-TEST: mst.ho Confidential Feedback',
        description: 'Test Confidential feedback regarding internal workplace dynamics.',
        priority: 'high',
        is_confidential: true,
        is_anonymous: false
    });

    const tConf = dataConf?.data;
    record('1.3.1 mst.ho creates Confidential Feedback ticket', resConf.status === 200 && !!tConf?.id, dataConf?.error);
    if (tConf?.id) {
        createdTicketIds.push(tConf.id);
        console.log(`    Ticket #${tConf.ticket_number} created (Type: ${tConf.ticket_type}, Assigned: ${tConf.assigned_to_user_id})`);

        // Check mst.ho sees it in their ticket list / My Raised
        const { data: mstTickets } = await getTicketsViaAPI(userMst);
        const foundInMst = (mstTickets?.data || []).some((t: any) => t.id === tConf.id);
        record('1.3.2 mst.ho can see Confidential Feedback in My Raised', foundInMst);

        // Check assigned handler sees it
        if (tConf.assigned_to_user_id) {
            const { data: handlerTickets } = await getTicketsViaAPI({
                email: 'confidential_handler',
                userId: tConf.assigned_to_user_id,
                role: 'director'
            });
            const foundInHandler = (handlerTickets?.data || []).some((t: any) => t.id === tConf.id);
            record('1.3.3 Assigned recipient can see Confidential Feedback ticket', foundInHandler);
        }

        // Submitter details are visible to submitter in detail view
        const { data: details } = await getTicketDetailsViaAPI(tConf.id, userMst);
        record('1.3.4 Confidential ticket details accessible to submitter', details?.data?.is_confidential === true && details?.data?.raised_by_user_id === userMst.userId);
    }

    // 1.4 Anonymous Feedback
    console.log('\n[1.4] Creating Anonymous Feedback ticket...');
    const { res: resAnon, data: dataAnon } = await createTicketViaAPI(userMst, {
        category_id: feedbackCat.id,
        subject: 'REGRESSION-TEST: mst.ho Anonymous Feedback',
        description: 'Test Anonymous feedback regarding suggestions for office cafeteria.',
        priority: 'low',
        is_confidential: false,
        is_anonymous: true
    });

    const tAnon = dataAnon?.data;
    record('1.4.1 mst.ho creates Anonymous Feedback ticket', resAnon.status === 200 && !!tAnon?.id, dataAnon?.error);
    if (tAnon?.id) {
        createdTicketIds.push(tAnon.id);
        console.log(`    Ticket #${tAnon.ticket_number} created (Type: ${tAnon.ticket_type}, Assigned: ${tAnon.assigned_to_user_id})`);

        // Check mst.ho sees it in their ticket list / My Raised
        const { data: mstTickets } = await getTicketsViaAPI(userMst);
        const foundInMst = (mstTickets?.data || []).some((t: any) => t.id === tAnon.id);
        record('1.4.2 mst.ho can see their own Anonymous ticket in My Raised', foundInMst);

        // Check assigned handler can see it
        if (tAnon.assigned_to_user_id) {
            const { data: handlerTickets } = await getTicketsViaAPI({
                email: 'anon_handler',
                userId: tAnon.assigned_to_user_id,
                role: 'director'
            });
            const foundInHandler = (handlerTickets?.data || []).some((t: any) => t.id === tAnon.id);
            record('1.4.3 Assigned recipient can see Anonymous ticket', foundInHandler);
        }

        // Submitter details masking verification for assigned recipient vs submitter
        const { data: detailsAsHandler } = await getTicketDetailsViaAPI(tAnon.id, {
            userId: tAnon.assigned_to_user_id,
            role: 'director'
        });
        const isAnonMaskedForHandler = detailsAsHandler?.data?.submitter_details?.full_name === 'Anonymous Employee' && detailsAsHandler?.data?.submitter_details?.email === 'hidden';
        record('1.4.4 Submitter identity is strictly masked for recipient as Anonymous Employee', isAnonMaskedForHandler);
    }

    // =========================================================================
    // PART 2: TEST FROM hrhead@gmail.com (HR HEAD ROLE)
    // =========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log(`👩‍💼 PART 2: Testing Tickets Created by ${userHrHead.email} (Role: ${userHrHead.role})`);
    console.log('------------------------------------------------------------------------');

    // 2.1 HR Head creates Employee Grievance
    console.log('\n[2.1] HR Head creating Employee Grievance...');
    const { res: resHrGrievance, data: dataHrGrievance } = await createTicketViaAPI(userHrHead, {
        category_id: grievanceCat.id,
        subject: 'REGRESSION-TEST: hrhead Grievance - Escalated Department Matter',
        description: 'Test grievance raised by HR Head regarding cross-department resource issue.',
        priority: 'high',
        is_confidential: false,
        is_anonymous: false
    });

    const tHrGrievance = dataHrGrievance?.data;
    record('2.1.1 hrhead creates Grievance ticket', resHrGrievance.status === 200 && !!tHrGrievance?.id, dataHrGrievance?.error);
    if (tHrGrievance?.id) {
        createdTicketIds.push(tHrGrievance.id);
        console.log(`    Ticket #${tHrGrievance.ticket_number} created (Assigned to: ${tHrGrievance.assigned_to_user_id})`);

        // Check hrhead sees it in ticket list / My Raised
        const { data: hrTickets } = await getTicketsViaAPI(userHrHead);
        const foundInHr = (hrTickets?.data || []).some((t: any) => t.id === tHrGrievance.id);
        record('2.1.2 hrhead sees Grievance ticket in their list / My Raised', foundInHr);

        // Check assigned handler sees it
        if (tHrGrievance.assigned_to_user_id && tHrGrievance.assigned_to_user_id !== userHrHead.userId) {
            const { data: handlerTickets } = await getTicketsViaAPI({
                email: 'hr_assigned',
                userId: tHrGrievance.assigned_to_user_id,
                role: 'employee'
            });
            const foundInHandler = (handlerTickets?.data || []).some((t: any) => t.id === tHrGrievance.id);
            record('2.1.3 Assigned recipient sees Grievance ticket', foundInHandler);
        }
    }

    // 2.2 HR Head creates HR Query
    console.log('\n[2.2] HR Head creating HR Query...');
    const { res: resHrHrQuery, data: dataHrHrQuery } = await createTicketViaAPI(userHrHead, {
        category_id: hrQueryCat.id,
        subject: 'REGRESSION-TEST: hrhead HR Query - Policy Verification',
        description: 'Test HR Query raised by HR Head for statutory compliance clarification.',
        priority: 'medium',
        is_confidential: false,
        is_anonymous: false
    });

    const tHrHrQuery = dataHrHrQuery?.data;
    record('2.2.1 hrhead creates HR Query ticket', resHrHrQuery.status === 200 && !!tHrHrQuery?.id, dataHrHrQuery?.error);
    if (tHrHrQuery?.id) {
        createdTicketIds.push(tHrHrQuery.id);
        console.log(`    Ticket #${tHrHrQuery.ticket_number} created (Assigned to: ${tHrHrQuery.assigned_to_user_id})`);

        // Check hrhead sees it
        const { data: hrTickets } = await getTicketsViaAPI(userHrHead);
        const foundInHr = (hrTickets?.data || []).some((t: any) => t.id === tHrHrQuery.id);
        record('2.2.2 hrhead sees HR Query ticket in their list / My Raised', foundInHr);
    }

    // 2.3 HR Head creates Confidential Feedback
    console.log('\n[2.3] HR Head creating Confidential Feedback...');
    const { res: resHrConf, data: dataHrConf } = await createTicketViaAPI(userHrHead, {
        category_id: feedbackCat.id,
        subject: 'REGRESSION-TEST: hrhead Confidential Feedback',
        description: 'Test Confidential Feedback raised by HR Head for leadership review.',
        priority: 'high',
        is_confidential: true,
        is_anonymous: false
    });

    const tHrConf = dataHrConf?.data;
    record('2.3.1 hrhead creates Confidential Feedback ticket', resHrConf.status === 200 && !!tHrConf?.id, dataHrConf?.error);
    if (tHrConf?.id) {
        createdTicketIds.push(tHrConf.id);
        console.log(`    Ticket #${tHrConf.ticket_number} created (Assigned: ${tHrConf.assigned_to_user_id})`);

        // CRITICAL CHECK: HR Head must see their own confidential ticket in My Raised!
        const { data: hrTickets } = await getTicketsViaAPI(userHrHead);
        const foundInHr = (hrTickets?.data || []).some((t: any) => t.id === tHrConf.id);
        record('2.3.2 hrhead can see their own Confidential Feedback in My Raised', foundInHr);

        // Check assigned handler sees it
        if (tHrConf.assigned_to_user_id && tHrConf.assigned_to_user_id !== userHrHead.userId) {
            const { data: handlerTickets } = await getTicketsViaAPI({
                email: 'dir_handler',
                userId: tHrConf.assigned_to_user_id,
                role: 'director'
            });
            const foundInHandler = (handlerTickets?.data || []).some((t: any) => t.id === tHrConf.id);
            record('2.3.3 Assigned recipient sees Confidential ticket', foundInHandler);
        }
    }

    // 2.4 HR Head creates Anonymous Feedback
    console.log('\n[2.4] HR Head creating Anonymous Feedback...');
    const { res: resHrAnon, data: dataHrAnon } = await createTicketViaAPI(userHrHead, {
        category_id: feedbackCat.id,
        subject: 'REGRESSION-TEST: hrhead Anonymous Feedback',
        description: 'Test Anonymous Feedback submitted by HR Head testing employee survey tool.',
        priority: 'low',
        is_confidential: false,
        is_anonymous: true
    });

    const tHrAnon = dataHrAnon?.data;
    record('2.4.1 hrhead creates Anonymous Feedback ticket', resHrAnon.status === 200 && !!tHrAnon?.id, dataHrAnon?.error);
    if (tHrAnon?.id) {
        createdTicketIds.push(tHrAnon.id);
        console.log(`    Ticket #${tHrAnon.ticket_number} created (Assigned: ${tHrAnon.assigned_to_user_id})`);

        // CRITICAL CHECK: HR Head must see their own anonymous ticket in My Raised!
        const { data: hrTickets } = await getTicketsViaAPI(userHrHead);
        const foundInHr = (hrTickets?.data || []).some((t: any) => t.id === tHrAnon.id);
        record('2.4.2 hrhead can see their own Anonymous ticket in My Raised', foundInHr);

        // Check assigned handler sees it
        if (tHrAnon.assigned_to_user_id && tHrAnon.assigned_to_user_id !== userHrHead.userId) {
            const { data: handlerTickets } = await getTicketsViaAPI({
                email: 'dir_handler_anon',
                userId: tHrAnon.assigned_to_user_id,
                role: 'director'
            });
            const foundInHandler = (handlerTickets?.data || []).some((t: any) => t.id === tHrAnon.id);
            record('2.4.3 Assigned recipient sees Anonymous ticket', foundInHandler);
        }
    }

    // =========================================================================
    // PART 3: TEST RESOLUTION FLOW & MANDATORY NOTES
    // =========================================================================
    console.log('\n------------------------------------------------------------------------');
    console.log('📝 PART 3: Testing Resolution Flow on Created Ticket');
    console.log('------------------------------------------------------------------------');

    if (tGrievance?.id) {
        // 3.1 Attempt resolving without note -> must fail 400
        const reqResolveNoNote = new Request(`http://localhost/api/hr/tickets/${tGrievance.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'resolved',
                actor_user_id: userHrHead.userId,
                resolved_by_user_id: userHrHead.userId,
                resolution_note: '   '
            })
        });
        const resFail = await patchTicket(reqResolveNoNote, { params: Promise.resolve({ id: tGrievance.id }) });
        const failData = await resFail.json();
        record('3.1 Reject resolution with blank note (HTTP 400)', resFail.status === 400 && failData.error.includes('strictly mandatory'), failData.error);

        // 3.2 Resolve with mandatory note -> must succeed 200
        const reqResolveWithNote = new Request(`http://localhost/api/hr/tickets/${tGrievance.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'resolved',
                actor_user_id: userHrHead.userId,
                resolved_by_user_id: userHrHead.userId,
                resolution_note: 'Resolved by HR head after meeting with department lead.'
            })
        });
        const resPass = await patchTicket(reqResolveWithNote, { params: Promise.resolve({ id: tGrievance.id }) });
        const dataPass = await resPass.json();
        record('3.2 Resolve ticket with valid resolution note', resPass.status === 200 && dataPass?.success === true, dataPass?.error);

        // 3.3 Verify resolution note saved in ticket details
        const { data: updatedDetails } = await getTicketDetailsViaAPI(tGrievance.id, userHrHead);
        record('3.3 Resolution note correctly saved in database', updatedDetails?.data?.resolution_note === 'Resolved by HR head after meeting with department lead.');
    }

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n========================================================================');
    console.log('📊 REGRESSION SUITE RESULTS');
    console.log('========================================================================');
    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.filter(r => !r.passed).length;
    console.log(`Total Tests Run: ${results.length}`);
    console.log(`Passed: ${passedCount}`);
    console.log(`Failed: ${failedCount}`);

    if (failedCount === 0) {
        console.log('\n🎉 ALL REGRESSION TESTS PASSED 100%!');
    } else {
        console.error(`\n⚠️ ${failedCount} TESTS FAILED! Review details above.`);
    }

    return { total: results.length, passed: passedCount, failed: failedCount, createdTicketIds };
}

runRegressionSuite().catch(console.error);
