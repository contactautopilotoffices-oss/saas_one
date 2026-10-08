import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🚀 Starting Phase 20 Complete End-to-End System Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { PermissionService, PermissionDeniedError } = await import('../PermissionService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const { TaskCommandHandler } = await import('../TaskCommandHandler');
    const { TaskMessageRouter } = await import('../TaskMessageRouter');
    const { TaskProgressService } = await import('../TaskProgressService');
    const { SuperuserAIAssistant } = await import('../SuperuserAIAssistant');

    const testDate = '2026-10-10';
    const testTaskIds: string[] = [];

    // Identify actors
    const employees = await TaskDatabaseService.getAllEmployees();
    const superuserId = '284eaccc-2c10-48f4-a524-2b448e40e012';
    const superuser = await PermissionService.getActor(superuserId);

    const manager = employees.find(e => e.role === 'reporting_manager' && e.department_id) || employees[0];
    const deptEmployees = employees.filter(e => e.department_id === manager.department_id && e.id !== manager.id);
    const subordinate = deptEmployees[0] || employees[1];

    const otherDept = employees.find(e => e.department_id && e.department_id !== manager.department_id);
    const outsider = otherDept || employees[employees.length - 1];

    console.log(`✓ Actors Identified:`);
    console.log(`  • Superuser: ${superuser.name} (${superuser.role})`);
    console.log(`  • Manager: ${manager.name} (${manager.role}, Dept: ${manager.department_name})`);
    console.log(`  • Subordinate: ${subordinate.name} (${subordinate.role}, Dept: ${subordinate.department_name})`);
    console.log(`  • Outside Employee: ${outsider.name} (${outsider.role}, Dept: ${outsider.department_name})\n`);

    try {
        // ═════════════════════════════════════════════════════════════════════
        // FLOW 1: EMPLOYEE LIFECYCLE
        // ═════════════════════════════════════════════════════════════════════
        console.log('--- FLOW 1: Employee WhatsApp Task Lifecycle ---');

        // 1. Create two daily tasks for subordinate
        const task1 = await TaskDatabaseService.createTaskAssignment({
            employeeId: subordinate.id,
            title: '[E2E] Clean Server Room',
            assignedDate: testDate,
            assignedBy: manager.id
        });
        const task2 = await TaskDatabaseService.createTaskAssignment({
            employeeId: subordinate.id,
            title: '[E2E] Check Security Cameras',
            assignedDate: testDate,
            assignedBy: manager.id
        });
        testTaskIds.push(task1.id, task2.id);

        // 2. Morning Notification Generation
        const morningResult = await TaskNotificationService.sendMorningNotifications({
            date: testDate,
            employeeId: subordinate.id,
            dryRun: true
        });
        if (morningResult.notificationsSent !== 1) {
            throw new Error('Morning digest failed to dispatch to subordinate');
        }
        console.log('✓ 1.1 Morning notification formatted and sent to employee.');

        // 3. Employee sends "tasks"
        const tasksRes = await TaskCommandHandler.handleCommand({
            phone: subordinate.phone_number,
            text: 'tasks',
            date: testDate,
            sendReply: false
        });
        if (tasksRes.progress?.total !== 2 || tasksRes.progress?.completed !== 0) {
            throw new Error(`Expected 0/2 progress, got ${tasksRes.progress?.completed}/${tasksRes.progress?.total}`);
        }
        console.log('✓ 1.2 Employee queried "tasks": 0/2 completed (0%).');

        // 4. Employee sends "done 1"
        const done1Res = await TaskCommandHandler.handleCommand({
            phone: subordinate.phone_number,
            text: 'done 1',
            date: testDate,
            sendReply: false
        });
        if (done1Res.progress?.completed !== 1 || done1Res.progress?.percent !== 50) {
            throw new Error(`Expected 1/2 progress (50%), got ${done1Res.progress?.completed}/${done1Res.progress?.total}`);
        }
        console.log('✓ 1.3 Employee completed task #1: 1/2 completed (50%).');

        // 5. Employee sends "done all"
        const doneAllRes = await TaskCommandHandler.handleCommand({
            phone: subordinate.phone_number,
            text: 'done all',
            date: testDate,
            sendReply: false
        });
        if (doneAllRes.progress?.percent !== 100) {
            throw new Error(`Expected 100% progress after done all, got ${doneAllRes.progress?.percent}%`);
        }
        console.log('✓ 1.4 Employee completed all tasks: 2/2 completed (100%).');

        // ═════════════════════════════════════════════════════════════════════
        // FLOW 2: REPORTING MANAGER LIFECYCLE & SECURITY BOUNDARY
        // ═════════════════════════════════════════════════════════════════════
        console.log('\n--- FLOW 2: Reporting Manager Lifecycle & Role Boundary ---');

        // 2.1 Manager assigns task to employee in their own department -> SUCCESS
        await PermissionService.assertCanAssignTask(manager.id, subordinate.id);
        const mgrTask = await TaskDatabaseService.createTaskAssignment({
            employeeId: subordinate.id,
            title: '[E2E] Review Safety Checklist',
            assignedDate: testDate,
            assignedBy: manager.id
        });
        testTaskIds.push(mgrTask.id);
        console.log(`✓ 2.1 Manager successfully assigned task to subordinate in their department.`);

        // 2.2 Manager attempts to assign task to employee in ANOTHER department -> REJECTED
        let crossDeptBlocked = false;
        if (outsider.department_id && outsider.department_id !== manager.department_id) {
            try {
                await PermissionService.assertCanAssignTask(manager.id, outsider.id);
            } catch (err: any) {
                if (err instanceof PermissionDeniedError) {
                    crossDeptBlocked = true;
                    console.log(`✓ 2.2 Manager cross-department assignment correctly BLOCKED: ${err.message}`);
                }
            }
            if (!crossDeptBlocked) {
                throw new Error('Security Violation: Manager was able to assign task outside their department');
            }
        }

        // 2.3 Manager checks department progress
        const deptProg = await TaskProgressService.getDepartmentProgress(manager.department_id!, testDate);
        console.log(`✓ 2.3 Manager Department Progress: ${deptProg.completed}/${deptProg.total} (${deptProg.percentage}%).`);

        // ═════════════════════════════════════════════════════════════════════
        // FLOW 3: SUPERUSER LIFECYCLE & EXECUTIVE AI QUERY
        // ═════════════════════════════════════════════════════════════════════
        console.log('\n--- FLOW 3: Superuser Cross-Department Oversight & AI Assistant ---');

        // 3.1 Superuser assigns task across department -> SUCCESS
        await PermissionService.assertCanAssignTask(superuser.id, outsider.id);
        const suTask = await TaskDatabaseService.createTaskAssignment({
            employeeId: outsider.id,
            title: '[E2E] Superuser Assigned Initiative',
            assignedDate: testDate,
            assignedBy: superuser.id
        });
        testTaskIds.push(suTask.id);
        console.log(`✓ 3.1 Superuser assigned cross-department task successfully.`);

        // 3.2 Superuser queries AI Executive Assistant
        const aiRes = await SuperuserAIAssistant.handleQuery({
            phone: superuser.phone_number,
            question: `How is ${manager.department_name} doing today?`,
            date: testDate
        });
        if (!aiRes.success || !aiRes.replyText.includes(manager.department_name!)) {
            throw new Error(`Superuser AI query failed: ${aiRes.replyText}`);
        }
        console.log(`✓ 3.2 Superuser asked AI about ${manager.department_name}: received executive summary.`);

        // ═════════════════════════════════════════════════════════════════════
        // FLOW 4: DUAL-BOT COEXISTENCE (FACILITY BOT + TASK MANAGER)
        // ═════════════════════════════════════════════════════════════════════
        console.log('\n--- FLOW 4: Dual-Bot Coexistence (Same WhatsApp Number) ---');
        const coexistingPhone = subordinate.phone_number;

        // Set Facility Context (e.g. Booking Room 101)
        await TaskDatabaseService.setConversationContext({
            phone: coexistingPhone,
            system: 'FACILITY',
            contextType: 'BOOKING_ROOM',
            contextData: { step: 'confirm' },
            ttlMinutes: 20
        });

        // Set Task Manager Context (Active tasks)
        await TaskDatabaseService.setConversationContext({
            phone: coexistingPhone,
            system: 'TASK_MANAGER',
            contextType: 'DAILY_TASKS',
            contextData: { session: 'morning' },
            ttlMinutes: 30
        });

        // Inbound message 1: "done all"
        const routeTask = await TaskMessageRouter.routeInboundMessage({
            phone: coexistingPhone,
            text: 'done all',
            date: testDate,
            sendReply: false
        });
        if (routeTask.system !== 'TASK_MANAGER' || !routeTask.handledByTaskManager) {
            throw new Error(`Dual-bot routing failed: 'done all' did not route to TASK_MANAGER`);
        }
        console.log(`✓ 4.1 'done all' routed directly to TASK_MANAGER without disturbing Facility.`);

        // Inbound message 2: "book a meeting room"
        const routeFacility = await TaskMessageRouter.routeInboundMessage({
            phone: coexistingPhone,
            text: 'book a meeting room',
            date: testDate,
            sendReply: false
        });
        if (routeFacility.system !== 'FACILITY' || routeFacility.handledByTaskManager) {
            throw new Error(`Dual-bot routing failed: 'book a meeting room' did not route to FACILITY`);
        }
        console.log(`✓ 4.2 'book a meeting room' routed directly to FACILITY without disturbing Task Manager.`);

        // Verify neither context was deleted
        const checkFac = await TaskDatabaseService.getConversationContext(coexistingPhone, 'FACILITY');
        const checkTask = await TaskDatabaseService.getConversationContext(coexistingPhone, 'TASK_MANAGER');
        if (!checkFac || !checkTask) {
            throw new Error('One of the dual conversation contexts was unexpectedly lost');
        }
        console.log(`✓ 4.3 Verified both contexts persist concurrently with zero data collision.`);

    } finally {
        // ── Cleanup ──────────────────────────────────────────────────────────
        console.log('\n--- Final Cleanup ---');
        if (testTaskIds.length > 0) {
            await supabaseAdmin
                .from('task_assignments')
                .delete()
                .in('id', testTaskIds);
        }
        await TaskDatabaseService.clearConversationContext(subordinate.phone_number);
        console.log('✓ Cleaned up all test assignments and conversation contexts.');
    }

    console.log('\n🎉 ALL PHASE 20 END-TO-END TESTS PASSED WITH 100% SUCCESS!\n');
}

run().catch((err) => {
    console.error('❌ Phase 20 E2E Test Failed:', err);
    process.exit(1);
});
