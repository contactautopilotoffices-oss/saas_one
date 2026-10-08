import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 7 Employee Task Commands Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskCommandHandler } = await import('../TaskCommandHandler');

    // 1. Pick test employee
    const employees = await TaskDatabaseService.getAllEmployees();
    if (employees.length === 0) {
        throw new Error('No active employees found to test with.');
    }
    const testEmployee = employees.find(e => e.phone_number && e.phone_number.length >= 10) || employees[0];
    const testDate = '2026-10-06';
    const phone = testEmployee.phone_number;

    console.log(`✓ Testing with employee: ${testEmployee.name}, Phone: ${phone}`);

    // 2. Create 3 test tasks
    const taskIds: string[] = [];
    const titles = ['[PHASE7] Inspect HVAC Unit', '[PHASE7] Clean Cafeteria', '[PHASE7] Update Security Log'];

    for (const title of titles) {
        const task = await TaskDatabaseService.createTaskAssignment({
            employeeId: testEmployee.id,
            title,
            assignedDate: testDate,
            assignedBy: testEmployee.id
        });
        taskIds.push(task.id);
    }
    console.log(`✓ Seeded 3 test tasks for date ${testDate}:`, taskIds);

    try {
        // ── Test 1: "tasks" command ──────────────────────────────────────────
        console.log('\n--- Test 1: Command "tasks" ---');
        const resTasks = await TaskCommandHandler.handleCommand({
            phone,
            text: 'tasks',
            date: testDate,
            sendReply: false // local verification without dispatching live WhatsApp network call
        });

        console.log('Reply:\n' + resTasks.replyText);
        if (!resTasks.success || resTasks.command !== 'tasks') {
            throw new Error(`Expected successful 'tasks' command, got ${JSON.stringify(resTasks)}`);
        }
        if (resTasks.progress?.total !== 3 || resTasks.progress?.completed !== 0) {
            throw new Error(`Expected 0/3 progress, got ${resTasks.progress?.completed}/${resTasks.progress?.total}`);
        }
        console.log('✓ "tasks" command returned expected list and 0% progress.');

        // ── Test 2: "done 2" command (single complete) ────────────────────────
        console.log('\n--- Test 2: Command "done 2" ---');
        const resDone2 = await TaskCommandHandler.handleCommand({
            phone,
            text: 'done 2',
            date: testDate,
            sendReply: false
        });

        console.log('Reply:\n' + resDone2.replyText);
        if (!resDone2.success || resDone2.taskNumber !== 2) {
            throw new Error(`Expected successful 'done 2', got ${JSON.stringify(resDone2)}`);
        }
        if (resDone2.progress?.completed !== 1) {
            throw new Error(`Expected 1/3 completed, got ${resDone2.progress?.completed}`);
        }

        // Verify in Supabase
        const { data: dbTask2 } = await supabaseAdmin
            .from('task_assignments')
            .select('*')
            .eq('id', taskIds[1])
            .single();

        if (dbTask2.status !== 'completed' || !dbTask2.completed_at) {
            throw new Error(`Task #2 in DB not marked completed or missing completed_at: ${JSON.stringify(dbTask2)}`);
        }
        console.log('✓ Task #2 successfully marked completed in database with completed_at timestamp.');

        // ── Test 3: "done 2" repeated (already completed) ─────────────────────
        console.log('\n--- Test 3: Command "done 2" (Already Completed) ---');
        const resDone2Repeat = await TaskCommandHandler.handleCommand({
            phone,
            text: 'done 2',
            date: testDate,
            sendReply: false
        });

        console.log('Reply:\n' + resDone2Repeat.replyText);
        if (!resDone2Repeat.replyText.includes('already marked as completed')) {
            throw new Error(`Expected already completed notification, got: ${resDone2Repeat.replyText}`);
        }
        console.log('✓ Repeated "done 2" recognized as already completed.');

        // ── Test 4: "done 99" (out of bounds) ─────────────────────────────────
        console.log('\n--- Test 4: Command "done 99" (Out of Bounds) ---');
        const resDone99 = await TaskCommandHandler.handleCommand({
            phone,
            text: 'done 99',
            date: testDate,
            sendReply: false
        });

        console.log('Reply:\n' + resDone99.replyText);
        if (!resDone99.replyText.includes("couldn't find task #99")) {
            throw new Error(`Expected out-of-range error, got: ${resDone99.replyText}`);
        }
        console.log('✓ Invalid task number handled gracefully.');

        // ── Test 5: "done all" command ────────────────────────────────────────
        console.log('\n--- Test 5: Command "done all" ---');
        const resDoneAll = await TaskCommandHandler.handleCommand({
            phone,
            text: 'done all',
            date: testDate,
            sendReply: false
        });

        console.log('Reply:\n' + resDoneAll.replyText);
        if (!resDoneAll.success || resDoneAll.progress?.percent !== 100) {
            throw new Error(`Expected 100% completion after 'done all', got ${resDoneAll.progress?.percent}%`);
        }

        // Verify all 3 tasks in DB
        const { data: dbAll } = await supabaseAdmin
            .from('task_assignments')
            .select('id, status')
            .in('id', taskIds);

        const allCompleted = dbAll?.every(t => t.status === 'completed');
        if (!allCompleted) {
            throw new Error(`Not all tasks completed in DB: ${JSON.stringify(dbAll)}`);
        }
        console.log('✓ All 3 tasks verified as completed in database.');

        // ── Test 6: "done all" repeated ───────────────────────────────────────
        console.log('\n--- Test 6: Command "done all" (Already All Completed) ---');
        const resDoneAllRepeat = await TaskCommandHandler.handleCommand({
            phone,
            text: 'done all',
            date: testDate,
            sendReply: false
        });

        console.log('Reply:\n' + resDoneAllRepeat.replyText);
        if (!resDoneAllRepeat.replyText.includes('already completed')) {
            throw new Error(`Expected already completed notice, got: ${resDoneAllRepeat.replyText}`);
        }
        console.log('✓ Repeated "done all" handled gracefully without errors.');

        // ── Test 7: "cancel" command ──────────────────────────────────────────
        console.log('\n--- Test 7: Command "cancel" ---');
        const resCancel = await TaskCommandHandler.handleCommand({
            phone,
            text: 'cancel',
            date: testDate,
            sendReply: false
        });

        console.log('Reply:\n' + resCancel.replyText);
        const ctx = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
        if (ctx) {
            throw new Error('Task Manager conversation context was not cleared by cancel command');
        }
        console.log('✓ "cancel" command cleared active session context.');

    } finally {
        // ── Cleanup ──────────────────────────────────────────────────────────
        console.log('\n--- Cleanup ---');
        await supabaseAdmin
            .from('task_assignments')
            .delete()
            .in('id', taskIds);
        await TaskDatabaseService.clearConversationContext(phone);
        console.log('✓ Cleaned up test tasks and conversation context.');
    }

    console.log('\n🎉 ALL PHASE 7 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phase 7 Test Failed:', err);
    process.exit(1);
});
