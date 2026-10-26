import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { GET as getTickets, POST as createTicket } from '../app/api/hr/tickets/route';
import { GET as getTicketById, PATCH as patchTicket } from '../app/api/hr/tickets/[id]/route';
import { GET as getComments, POST as postComment } from '../app/api/hr/tickets/[id]/comments/route';
import { GET as getPendingActions } from '../app/api/hr/tickets/pending-actions/route';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TestResult {
    suite: string;
    testcase: string;
    passed: boolean;
    error?: string;
    details?: any;
}

const results: TestResult[] = [];

function assert(condition: boolean, suite: string, testcase: string, message?: string) {
    if (!condition) {
        results.push({ suite, testcase, passed: false, error: message || 'Assertion failed' });
        console.error(`❌ [FAIL] ${suite} -> ${testcase}: ${message || 'Assertion failed'}`);
    } else {
        results.push({ suite, testcase, passed: true });
        console.log(`✅ [PASS] ${suite} -> ${testcase}`);
    }
}

async function runRegression() {
    console.log('========================================================================');
    console.log('🚀 STARTING COMPREHENSIVE HR GRIEVANCE REGRESSION TEST SUITE');
    console.log('========================================================================\n');

    const orgId = '211e1330-ad83-446d-941f-dcea48396798';

    // Key Users in test dataset:
    // 1. Submitter: mst.ho@gmail.com ('5fe04b2c-a77e-4d22-a95f-46836173f9ee')
    // 2. Direct Manager of Submitter: harshrp2309@gmail.com ('b076390b-e13e-4b28-967c-450433192805')
    // 3. Unrelated Property Admin: admin.ho@gmail.com ('b128a31a-388c-4b04-bf02-3d6e15896309')
    // 4. Assigned Director / Confidential & Anonymous L1: Lohit ('5973fcab-7b2c-4a00-bf8b-034053e35f34')
    // 5. Assigned HR Executive for hr_query: ('58394a71-c780-4c46-a558-06924b9440a4')

    const submitterId = '5fe04b2c-a77e-4d22-a95f-46836173f9ee';
    const managerId = 'b076390b-e13e-4b28-967c-450433192805';
    const unrelatedUserId = 'b128a31a-388c-4b04-bf02-3d6e15896309';
    const directorId = '5973fcab-7b2c-4a00-bf8b-034053e35f34';
    const hrExecId = '58394a71-c780-4c46-a558-06924b9440a4';

    // Fetch category IDs for each ticket type
    const { data: categories } = await supabaseAdmin
        .from('hr_ticket_categories')
        .select('id, category_name, ticket_type, is_anonymous, is_confidential')
        .or(`organization_id.eq.${orgId},organization_id.is.null`);

    const grievanceCat = categories?.find(c => c.ticket_type === 'grievance') || categories?.[0];
    const hrQueryCat = categories?.find(c => c.ticket_type === 'hr_query') || categories?.find(c => c.category_name?.toLowerCase().includes('query'));
    const confidentialCat = categories?.find(c => c.ticket_type === 'confidential_feedback' || c.is_confidential) || categories?.find(c => c.category_name?.toLowerCase().includes('confidential'));
    const anonymousCat = categories?.find(c => c.ticket_type === 'anonymous_feedback' || c.is_anonymous) || categories?.find(c => c.category_name?.toLowerCase().includes('anonymous'));

    console.log('Categories identified:');
    console.log('  Grievance:', grievanceCat?.id, grievanceCat?.category_name);
    console.log('  HR Query:', hrQueryCat?.id, hrQueryCat?.category_name);
    console.log('  Confidential:', confidentialCat?.id, confidentialCat?.category_name);
    console.log('  Anonymous:', anonymousCat?.id, anonymousCat?.category_name);
    console.log('\n------------------------------------------------------------------------\n');

    let createdTicketIds: string[] = [];

    // =========================================================================
    // SUITE 1: STANDARD GRIEVANCE
    // =========================================================================
    console.log('▶ SUITE 1: STANDARD GRIEVANCE FLOW');
    try {
        // 1.1 Create Grievance Ticket
        const createReq = new Request('http://localhost:3000/api/hr/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                organization_id: orgId,
                category_id: grievanceCat?.id,
                ticket_type: 'grievance',
                subject: 'Regression Test - Grievance Issue',
                description: 'Testing standard grievance routing to direct manager',
                priority: 'medium',
                raised_by_user_id: submitterId
            })
        });
        const createRes = await createTicket(createReq);
        const createData = await createRes.json();
        assert(createData.success === true, 'Standard Grievance', '1.1 Ticket creation succeeds', createData.error);
        const ticketId = createData.data?.id;
        if (ticketId) createdTicketIds.push(ticketId);

        // 1.2 Verify Routing: Assigned to direct manager (harshrp2309@gmail.com)
        assert(createData.data?.assigned_to_user_id === managerId, 'Standard Grievance', '1.2 Assigned to direct reporting manager', `Expected ${managerId}, got ${createData.data?.assigned_to_user_id}`);
        assert(createData.data?.manager_user_id === managerId, 'Standard Grievance', '1.3 manager_user_id tracked correctly');

        // 1.4 Visibility in Ticket List:
        // Submitter list
        const subListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${submitterId}&role=employee`));
        const subListData = await subListRes.json();
        assert((subListData.data || []).some((t: any) => t.id === ticketId), 'Standard Grievance', '1.4 Submitter sees grievance in list');

        // Manager list
        const mgrListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${managerId}&role=ops_super_admin`));
        const mgrListData = await mgrListRes.json();
        assert((mgrListData.data || []).some((t: any) => t.id === ticketId), 'Standard Grievance', '1.5 Manager sees grievance in list');

        // Unrelated user list (admin.ho)
        const unrelListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${unrelatedUserId}&role=property_admin`));
        const unrelListData = await unrelListRes.json();
        assert(!(unrelListData.data || []).some((t: any) => t.id === ticketId), 'Standard Grievance', '1.6 Unrelated user CANNOT see grievance in list');

        // 1.7 Add Public Reply & Internal Note from Manager
        const replyReq = new Request(`http://localhost:3000/api/hr/tickets/${ticketId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender_user_id: managerId,
                content: 'Public message from manager to employee',
                is_internal: false
            })
        });
        const replyRes = await postComment(replyReq, { params: Promise.resolve({ id: ticketId }) });
        const replyData = await replyRes.json();
        assert(replyData.success === true, 'Standard Grievance', '1.7 Public reply posted successfully');

        const noteReq = new Request(`http://localhost:3000/api/hr/tickets/${ticketId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender_user_id: managerId,
                content: 'TOP SECRET INTERNAL NOTE FOR HR ONLY',
                is_internal: true
            })
        });
        const noteRes = await postComment(noteReq, { params: Promise.resolve({ id: ticketId }) });
        const noteData = await noteRes.json();
        assert(noteData.success === true, 'Standard Grievance', '1.8 Internal note posted successfully');

        // 1.9 Submitter checks ticket details: must NOT see internal note comment or audit log!
        const subDetailRes = await getTicketById(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}?userId=${submitterId}&role=employee`), { params: Promise.resolve({ id: ticketId }) });
        const subDetail = await subDetailRes.json();
        const subComments = subDetail.data?.comments || [];
        const subAuditLogs = subDetail.data?.audit_logs || [];
        assert(!subComments.some((c: any) => c.is_internal || c.content?.includes('TOP SECRET')), 'Standard Grievance', '1.9 Submitter CANNOT see internal note in comments thread');
        assert(!subAuditLogs.some((a: any) => a.action === 'INTERNAL_NOTE_ADDED' || a.new_values?.is_internal === true), 'Standard Grievance', '1.10 Submitter CANNOT see internal note in audit logs');

        // 1.11 Manager checks ticket details: MUST see internal note comment and audit log
        const mgrDetailRes = await getTicketById(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}?userId=${managerId}&role=ops_super_admin`), { params: Promise.resolve({ id: ticketId }) });
        const mgrDetail = await mgrDetailRes.json();
        const mgrComments = mgrDetail.data?.comments || [];
        const mgrAuditLogs = mgrDetail.data?.audit_logs || [];
        assert(mgrComments.some((c: any) => c.is_internal), 'Standard Grievance', '1.11 Manager CAN see internal note in comments thread');
        assert(mgrAuditLogs.some((a: any) => a.action === 'INTERNAL_NOTE_ADDED'), 'Standard Grievance', '1.12 Manager CAN see internal note in audit logs');

        // 1.13 Submitter tries to resolve ticket (Must be forbidden)
        const subResolveReq = new Request(`http://localhost:3000/api/hr/tickets/${ticketId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'resolved',
                actor_user_id: submitterId,
                resolution_note: 'Attempting self-resolution'
            })
        });
        const subResolveRes = await patchTicket(subResolveReq, { params: Promise.resolve({ id: ticketId }) });
        const subResolveData = await subResolveRes.json();
        assert(subResolveRes.status === 403 || subResolveData.success === false, 'Standard Grievance', '1.13 Submitter CANNOT resolve their own ticket');

        // 1.14 Manager resolves ticket
        const mgrResolveReq = new Request(`http://localhost:3000/api/hr/tickets/${ticketId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'resolved',
                actor_user_id: managerId,
                resolution_note: 'Resolved by manager after discussion'
            })
        });
        const mgrResolveRes = await patchTicket(mgrResolveReq, { params: Promise.resolve({ id: ticketId }) });
        const mgrResolveData = await mgrResolveRes.json();
        assert(mgrResolveData.success === true, 'Standard Grievance', '1.14 Manager successfully resolves ticket');

    } catch (e: any) {
        assert(false, 'Standard Grievance', 'Execution Exception', e.message);
    }

    console.log('\n------------------------------------------------------------------------\n');

    // =========================================================================
    // SUITE 2: HR QUERY FLOW
    // =========================================================================
    console.log('▶ SUITE 2: HR QUERY FLOW');
    try {
        // 2.1 Create HR Query Ticket
        const createReq = new Request('http://localhost:3000/api/hr/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                organization_id: orgId,
                category_id: hrQueryCat?.id,
                ticket_type: 'hr_query',
                subject: 'Regression Test - PF & ESIC Query',
                description: 'Need clarification on tax deduction calculation',
                priority: 'medium',
                raised_by_user_id: submitterId
            })
        });
        const createRes = await createTicket(createReq);
        const createData = await createRes.json();
        assert(createData.success === true, 'HR Query', '2.1 Ticket creation succeeds', createData.error);
        const ticketId = createData.data?.id;
        if (ticketId) createdTicketIds.push(ticketId);

        // 2.2 Verify Routing: Routed to configured HR Executive (not reporting manager)
        assert(createData.data?.assigned_to_user_id === hrExecId, 'HR Query', '2.2 Assigned to Admin Config Level 1 HR Executive', `Expected ${hrExecId}, got ${createData.data?.assigned_to_user_id}`);

        // 2.3 Visibility:
        // Submitter list
        const subListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${submitterId}&role=employee`));
        const subListData = await subListRes.json();
        assert((subListData.data || []).some((t: any) => t.id === ticketId), 'HR Query', '2.3 Submitter sees HR query in list');

        // HR Exec list
        const hrListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${hrExecId}&role=hr`));
        const hrListData = await hrListRes.json();
        assert((hrListData.data || []).some((t: any) => t.id === ticketId), 'HR Query', '2.4 Assigned HR Executive sees HR query in list');

        // Unrelated user list (admin.ho)
        const unrelListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${unrelatedUserId}&role=property_admin`));
        const unrelListData = await unrelListRes.json();
        assert(!(unrelListData.data || []).some((t: any) => t.id === ticketId), 'HR Query', '2.5 Unrelated user CANNOT see HR query');

    } catch (e: any) {
        assert(false, 'HR Query', 'Execution Exception', e.message);
    }

    console.log('\n------------------------------------------------------------------------\n');

    // =========================================================================
    // SUITE 3: CONFIDENTIAL FEEDBACK FLOW
    // =========================================================================
    console.log('▶ SUITE 3: CONFIDENTIAL FEEDBACK FLOW');
    try {
        // 3.1 Create Confidential Ticket
        const createReq = new Request('http://localhost:3000/api/hr/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                organization_id: orgId,
                category_id: confidentialCat?.id,
                ticket_type: 'confidential_feedback',
                is_confidential: true,
                subject: 'Regression Test - Sensitive Misconduct Report',
                description: 'Confidential report that must bypass manager completely',
                priority: 'high',
                raised_by_user_id: submitterId
            })
        });
        const createRes = await createTicket(createReq);
        const createData = await createRes.json();
        assert(createData.success === true, 'Confidential Feedback', '3.1 Ticket creation succeeds', createData.error);
        const ticketId = createData.data?.id;
        if (ticketId) createdTicketIds.push(ticketId);

        // 3.2 Verify Routing: Assigned directly to Director, manager_user_id is NULL
        assert(createData.data?.assigned_to_user_id === directorId, 'Confidential Feedback', '3.2 Assigned directly to Director as per Admin Config');
        assert(createData.data?.manager_user_id === null || createData.data?.manager_user_id === undefined, 'Confidential Feedback', '3.3 manager_user_id is NULL');
        assert(!createData.data?.assigned_history?.includes(managerId), 'Confidential Feedback', '3.4 Manager NOT in assigned_history');

        // 3.5 Visibility: Manager MUST NOT see it
        const mgrListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${managerId}&role=ops_super_admin`));
        const mgrListData = await mgrListRes.json();
        assert(!(mgrListData.data || []).some((t: any) => t.id === ticketId), 'Confidential Feedback', '3.5 Manager CANNOT see confidential ticket in list');

        // 3.6 Submitter MUST see it
        const subListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${submitterId}&role=employee`));
        const subListData = await subListRes.json();
        assert((subListData.data || []).some((t: any) => t.id === ticketId), 'Confidential Feedback', '3.6 Submitter CAN see confidential ticket in list');

        // 3.7 Assigned Director MUST see it
        const dirListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${directorId}&role=director`));
        const dirListData = await dirListRes.json();
        assert((dirListData.data || []).some((t: any) => t.id === ticketId), 'Confidential Feedback', '3.7 Assigned Director CAN see confidential ticket in list');

        // 3.8 Manager attempts GET details by ID (Must be 403 Forbidden)
        const mgrDetailRes = await getTicketById(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}?userId=${managerId}&role=ops_super_admin`), { params: Promise.resolve({ id: ticketId }) });
        assert(mgrDetailRes.status === 403, 'Confidential Feedback', '3.8 Manager blocked from GET confidential ticket details (403)');

        // 3.9 Manager attempts POST comment (Must be 403 Forbidden)
        const mgrCommentRes = await postComment(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender_user_id: managerId,
                content: 'Manager intrusion attempt'
            })
        }), { params: Promise.resolve({ id: ticketId }) });
        assert(mgrCommentRes.status === 403, 'Confidential Feedback', '3.9 Manager blocked from commenting on confidential ticket (403)');

        // 3.10 Manager attempts PATCH status (Must be 403 Forbidden)
        const mgrPatchRes = await patchTicket(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'resolved',
                actor_user_id: managerId
            })
        }), { params: Promise.resolve({ id: ticketId }) });
        assert(mgrPatchRes.status === 403, 'Confidential Feedback', '3.10 Manager blocked from modifying confidential ticket (403)');

    } catch (e: any) {
        assert(false, 'Confidential Feedback', 'Execution Exception', e.message);
    }

    console.log('\n------------------------------------------------------------------------\n');

    // =========================================================================
    // SUITE 4: ANONYMOUS FEEDBACK FLOW
    // =========================================================================
    console.log('▶ SUITE 4: ANONYMOUS FEEDBACK FLOW');
    try {
        // 4.1 Create Anonymous Ticket
        const createReq = new Request('http://localhost:3000/api/hr/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                organization_id: orgId,
                category_id: anonymousCat?.id,
                ticket_type: 'anonymous_feedback',
                is_anonymous: true,
                subject: 'Regression Test - Anonymous Whistleblowing Alert',
                description: 'Critical ethics violation report with hidden identity',
                priority: 'high',
                raised_by_user_id: submitterId
            })
        });
        const createRes = await createTicket(createReq);
        const createData = await createRes.json();
        assert(createData.success === true, 'Anonymous Feedback', '4.1 Ticket creation succeeds', createData.error);
        const ticketId = createData.data?.id;
        if (ticketId) createdTicketIds.push(ticketId);

        // 4.2 Verify Identity Masking at DB level
        assert(createData.data?.raised_by_user_id === submitterId, 'Anonymous Feedback', '4.2 raised_by_user_id linked to submitter for personal tracking');
        assert(createData.data?.employee_snapshot?.name === 'Anonymous Employee', 'Anonymous Feedback', '4.3 Submitter name masked in snapshot');
        assert(createData.data?.employee_snapshot?.code === 'Hidden', 'Anonymous Feedback', '4.4 Employee code masked in snapshot');
        assert(createData.data?.employee_snapshot?.location === 'Hidden', 'Anonymous Feedback', '4.5 Location masked in snapshot');
        assert(createData.data?.manager_user_id === null || createData.data?.manager_user_id === undefined, 'Anonymous Feedback', '4.6 manager_user_id is NULL');
        assert(!createData.data?.assigned_history?.includes(managerId), 'Anonymous Feedback', '4.7 Manager NOT in assigned_history');

        // 4.8 Manager MUST NOT see it in ticket list
        const mgrListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${managerId}&role=ops_super_admin`));
        const mgrListData = await mgrListRes.json();
        assert(!(mgrListData.data || []).some((t: any) => t.id === ticketId), 'Anonymous Feedback', '4.8 Manager CANNOT see anonymous ticket in list');

        // 4.9 Submitter CAN see their anonymous ticket in their "My Raised" list to track updates
        const subListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${submitterId}&role=employee`));
        const subListData = await subListRes.json();
        assert((subListData.data || []).some((t: any) => t.id === ticketId), 'Anonymous Feedback', '4.9 Submitter CAN see their anonymous ticket in My Raised list to track updates');

        // 4.10 Standard HR MUST NOT see it
        const hrListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${hrExecId}&role=hr`));
        const hrListData = await hrListRes.json();
        assert(!(hrListData.data || []).some((t: any) => t.id === ticketId), 'Anonymous Feedback', '4.10 HR role CANNOT see anonymous ticket');

        // 4.11 Assigned Director MUST see it, but with submitter details strictly masked
        const dirListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${directorId}&role=director`));
        const dirListData = await dirListRes.json();
        assert((dirListData.data || []).some((t: any) => t.id === ticketId), 'Anonymous Feedback', '4.11 Assigned Director CAN see anonymous ticket in list');
        const dirTicketInList = (dirListData.data || []).find((t: any) => t.id === ticketId);
        assert(dirTicketInList?.raised_by_user_id === null, 'Anonymous Feedback', '4.11b Director sees raised_by_user_id as NULL in list');
        assert(dirTicketInList?.employee_snapshot?.name === 'Anonymous Employee', 'Anonymous Feedback', '4.11c Director sees submitter name as Anonymous Employee in list');

        // 4.12 Manager attempts GET details by ID (Must be 403 Forbidden)
        const mgrDetailRes = await getTicketById(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}?userId=${managerId}&role=ops_super_admin`), { params: Promise.resolve({ id: ticketId }) });
        assert(mgrDetailRes.status === 403, 'Anonymous Feedback', '4.12 Manager blocked from GET anonymous ticket details (403)');

        // 4.13 Assigned Director gets details & posts a response
        const dirDetailRes = await getTicketById(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}?userId=${directorId}&role=director`), { params: Promise.resolve({ id: ticketId }) });
        assert(dirDetailRes.status === 200, 'Anonymous Feedback', '4.13 Director CAN access anonymous ticket details (200)');
        const dirDetail = await dirDetailRes.json();
        assert(dirDetail.data?.submitter_details?.is_anonymous === true, 'Anonymous Feedback', '4.14 Submitter details confirmed anonymous');

        const dirCommentRes = await postComment(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender_user_id: directorId,
                content: 'Investigating this matter immediately. Thank you for reporting.'
            })
        }), { params: Promise.resolve({ id: ticketId }) });
        const dirCommentData = await dirCommentRes.json();
        assert(dirCommentData.success === true, 'Anonymous Feedback', '4.15 Assigned Director can comment on anonymous ticket');

        // 4.16 Anonymous Submitter comments on ticket -> identity strictly masked as Anonymous Employee
        const anonCommentRes = await postComment(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender_user_id: submitterId,
                content: 'Here is additional anonymous information regarding the case.'
            })
        }), { params: Promise.resolve({ id: ticketId }) });
        const anonCommentData = await anonCommentRes.json();
        assert(anonCommentData.data?.sender_name === 'Anonymous Employee', 'Anonymous Feedback', '4.16 Submitter comment name masked as Anonymous Employee');
        assert(anonCommentData.data?.sender_user_id === null, 'Anonymous Feedback', '4.17 Submitter sender_user_id is strictly NULL in comments table');

        // 4.18 Fetch Ticket Details -> Audit Logs mask submitter as Anonymous Employee with no photo
        const updatedDetailRes = await getTicketById(new Request(`http://localhost:3000/api/hr/tickets/${ticketId}?userId=${directorId}&role=director`), { params: Promise.resolve({ id: ticketId }) });
        const updatedDetail = await updatedDetailRes.json();
        const createdAuditLog = (updatedDetail.data?.audit_logs || []).find((l: any) => l.action === 'CREATED');
        assert(createdAuditLog?.actor?.full_name === 'Anonymous Employee', 'Anonymous Feedback', '4.18 Creation audit log masks actor as Anonymous Employee');
        assert(createdAuditLog?.actor?.user_photo_url === null, 'Anonymous Feedback', '4.19 Creation audit log has no photo/avatar leak');

        const replyAuditLog = (updatedDetail.data?.audit_logs || []).find((l: any) => l.action === 'PUBLIC_REPLY_ADDED' && l.actor_user_id === null);
        assert(replyAuditLog?.actor?.full_name === 'Anonymous Employee', 'Anonymous Feedback', '4.20 Comment audit log masks submitter actor as Anonymous Employee');

    } catch (e: any) {
        assert(false, 'Anonymous Feedback', 'Execution Exception', e.message);
    }

    console.log('\n------------------------------------------------------------------------\n');

    // =========================================================================
    // SUITE 5: SECURITY & EDGE CASES
    // =========================================================================
    console.log('▶ SUITE 5: SECURITY & EDGE CASES');
    try {
        // 5.1 Invalid Ticket ID
        const invalidRes = await getTicketById(new Request('http://localhost:3000/api/hr/tickets/00000000-0000-0000-0000-000000000000'), { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) });
        assert(invalidRes.status === 404, 'Security & Edge Cases', '5.1 Non-existent ticket returns 404');

        // 5.2 Empty comment body rejected
        if (createdTicketIds[0]) {
            const emptyCommentRes = await postComment(new Request(`http://localhost:3000/api/hr/tickets/${createdTicketIds[0]}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_user_id: managerId,
                    content: ''
                })
            }), { params: Promise.resolve({ id: createdTicketIds[0] }) });
            assert(emptyCommentRes.status === 400, 'Security & Edge Cases', '5.2 Empty comment content rejected with 400');
        }

        // 5.3 Name collision test (Harsh Patil vs harsh patil HO)
        // Ensure admin.ho does NOT have any tickets from reportees of harshrp2309
        const adminHoListRes = await getTickets(new Request(`http://localhost:3000/api/hr/tickets?orgId=${orgId}&userId=${unrelatedUserId}&role=property_admin`));
        const adminHoData = await adminHoListRes.json();
        const hasReporteeTickets = (adminHoData.data || []).some((t: any) => t.raised_by_user_id === submitterId);
        assert(!hasReporteeTickets, 'Security & Edge Cases', '5.3 Name collision prevented: admin.ho cannot see tickets of Harsh Patil reportees');

    } catch (e: any) {
        assert(false, 'Security & Edge Cases', 'Execution Exception', e.message);
    }

    // =========================================================================
    // CLEANUP TEST TICKETS
    // =========================================================================
    console.log('\nCleaning up created regression test tickets...');
    if (createdTicketIds.length > 0) {
        await supabaseAdmin.from('hr_ticket_comments').delete().in('ticket_id', createdTicketIds);
        await supabaseAdmin.from('hr_ticket_audit_logs').delete().in('ticket_id', createdTicketIds);
        await supabaseAdmin.from('hr_tickets').delete().in('id', createdTicketIds);
        console.log(`Cleaned up ${createdTicketIds.length} test tickets.`);
    }

    console.log('\n========================================================================');
    console.log('📊 REGRESSION SUITE RESULTS SUMMARY');
    console.log('========================================================================');
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
    if (failed > 0) {
        console.log('\nFailed Tests:');
        results.filter(r => !r.passed).forEach(r => console.log(` - [${r.suite}] ${r.testcase}: ${r.error}`));
    }
}

runRegression().catch(console.error);
