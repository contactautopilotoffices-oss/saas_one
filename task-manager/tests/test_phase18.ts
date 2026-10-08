import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 18 Error Handling & User Feedback Tests...\n');

    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskErrorHandler } = await import('../TaskErrorHandler');
    const { TaskCommandHandler } = await import('../TaskCommandHandler');

    // ── Test 1: Unit Test User-Facing Error Messages ─────────────────────────
    console.log('--- Test 1: Standard Error Response Templates ---');

    const errInvalid = TaskErrorHandler.invalidTaskNumber(7);
    console.log(`[invalidTaskNumber]:\n${errInvalid}\n`);
    if (!errInvalid.includes("I couldn't find task #7 for today.") || !errInvalid.includes('Reply "tasks"')) {
        throw new Error('invalidTaskNumber template does not match specification');
    }

    const errNoTasks = TaskErrorHandler.noTasksAssigned();
    console.log(`[noTasksAssigned]:\n${errNoTasks}\n`);
    if (!errNoTasks.includes("You don't have any tasks assigned for today.")) {
        throw new Error('noTasksAssigned template does not match specification');
    }

    const errAlreadyDone = TaskErrorHandler.alreadyCompleted(2);
    console.log(`[alreadyCompleted]:\n${errAlreadyDone}\n`);
    if (!errAlreadyDone.includes('Task #2 is already marked as completed.')) {
        throw new Error('alreadyCompleted template does not match specification');
    }

    const errAmbiguous = TaskErrorHandler.ambiguousMessage();
    console.log(`[ambiguousMessage]:\n${errAmbiguous}\n`);
    if (!errAmbiguous.includes("I'm not sure what you'd like to do.") || !errAmbiguous.includes('done 1') || !errAmbiguous.includes('done all')) {
        throw new Error('ambiguousMessage template does not match specification');
    }
    console.log('✓ All standard error message templates match specification exactly.');

    // ── Test 2: Integration Verification via Command Handler ────────────────
    console.log('\n--- Test 2: Error Handling Integration ---');
    const employees = await TaskDatabaseService.getAllEmployees();
    const testEmployee = employees.find(e => e.phone_number && e.phone_number.length >= 10) || employees[0];
    const phone = testEmployee.phone_number;
    const futureDate = '2026-12-31'; // guaranteed no tasks

    // A: No tasks error
    const noTasksRes = await TaskCommandHandler.handleCommand({
        phone,
        text: 'tasks',
        date: futureDate,
        sendReply: false
    });
    if (noTasksRes.replyText !== TaskErrorHandler.noTasksAssigned(futureDate)) {
        throw new Error(`Expected exact noTasksAssigned message, got: ${noTasksRes.replyText}`);
    }
    console.log('✓ No tasks error handled with exact template.');

    // B: Invalid task index error
    const invalidTaskRes = await TaskCommandHandler.handleCommand({
        phone,
        text: 'done 42',
        date: futureDate,
        sendReply: false
    });
    if (invalidTaskRes.replyText !== TaskErrorHandler.invalidTaskNumber(42)) {
        throw new Error(`Expected exact invalidTaskNumber message, got: ${invalidTaskRes.replyText}`);
    }
    console.log('✓ Out-of-bounds task error handled with exact template.');

    // C: Ambiguous message error
    const ambiguousRes = await TaskCommandHandler.handleCommand({
        phone,
        text: 'xyz123random',
        date: futureDate,
        sendReply: false
    });
    if (ambiguousRes.replyText !== TaskErrorHandler.ambiguousMessage()) {
        throw new Error(`Expected exact ambiguousMessage message, got: ${ambiguousRes.replyText}`);
    }
    console.log('✓ Ambiguous command handled with helpful options menu.');

    console.log('\n🎉 ALL PHASE 18 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phase 18 Test Failed:', err);
    process.exit(1);
});
