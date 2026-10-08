import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 6 Task Manager WhatsApp Routing Tests...\n');

    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskMessageRouter } = await import('../TaskMessageRouter');

    const testPhone = '919999988888';

    // ── Test 1: Deterministic Pattern Routing ─────────────────────────────────
    console.log('--- Test 1: Deterministic Command Routing ---');

    const testCases: Array<{ text: string; expected: string }> = [
        { text: 'done 1', expected: 'TASK_MANAGER' },
        { text: 'done 15', expected: 'TASK_MANAGER' },
        { text: 'complete 2', expected: 'TASK_MANAGER' },
        { text: 'done all', expected: 'TASK_MANAGER' },
        { text: 'all done', expected: 'TASK_MANAGER' },
        { text: 'tasks', expected: 'TASK_MANAGER' },
        { text: 'status', expected: 'TASK_MANAGER' },
        { text: 'book a meeting room', expected: 'FACILITY' },
        { text: 'raise a ticket AC not working', expected: 'FACILITY' },
        { text: 'facility', expected: 'FACILITY' },
    ];

    for (const tc of testCases) {
        const result = await TaskMessageRouter.classifyMessage(testPhone, tc.text);
        console.log(`  "${tc.text}" -> ${result.system} (${result.reason}, conf: ${result.confidence})`);
        if (result.system !== tc.expected) {
            throw new Error(`Routing mismatch for "${tc.text}": expected ${tc.expected}, got ${result.system}`);
        }
    }
    console.log('✓ All deterministic patterns classified correctly.');

    // ── Test 2: Dual-Context Isolation (Coexistence) ──────────────────────────
    console.log('\n--- Test 2: Dual-Context Coexistence (TASK_MANAGER & FACILITY) ---');

    // Clear any leftover test context
    await TaskDatabaseService.clearConversationContext(testPhone);

    // Set Facility Context (e.g. employee in the middle of room booking)
    await TaskDatabaseService.setConversationContext({
        phone: testPhone,
        system: 'FACILITY',
        contextType: 'BOOKING_MEETING_ROOM',
        contextData: { step: 'select_time' },
        ttlMinutes: 15
    });

    // Set Task Manager Context (e.g. daily task digest session)
    await TaskDatabaseService.setConversationContext({
        phone: testPhone,
        system: 'TASK_MANAGER',
        contextType: 'DAILY_TASKS',
        contextData: { last_notified: new Date().toISOString() },
        ttlMinutes: 30
    });

    // Verify both contexts exist independently
    const facilityCtx = await TaskDatabaseService.getConversationContext(testPhone, 'FACILITY');
    const taskCtx = await TaskDatabaseService.getConversationContext(testPhone, 'TASK_MANAGER');

    if (!facilityCtx || facilityCtx.system !== 'FACILITY' || facilityCtx.context_type !== 'BOOKING_MEETING_ROOM') {
        throw new Error('Facility context missing or corrupted');
    }
    if (!taskCtx || taskCtx.system !== 'TASK_MANAGER' || taskCtx.context_type !== 'DAILY_TASKS') {
        throw new Error('Task Manager context missing or corrupted');
    }
    console.log('✓ Verified: Both TASK_MANAGER and FACILITY contexts coexist independently for the same phone number.');

    // Verify commands still route accurately despite active dual contexts
    const taskCommandRoute = await TaskMessageRouter.classifyMessage(testPhone, 'done all');
    if (taskCommandRoute.system !== 'TASK_MANAGER') {
        throw new Error(`Expected 'done all' to route to TASK_MANAGER, got ${taskCommandRoute.system}`);
    }

    const facilityCommandRoute = await TaskMessageRouter.classifyMessage(testPhone, 'book room 201');
    if (facilityCommandRoute.system !== 'FACILITY') {
        throw new Error(`Expected 'book room 201' to route to FACILITY, got ${facilityCommandRoute.system}`);
    }
    console.log('✓ Verified: Commands route cleanly to their respective systems even when both contexts are active.');

    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log('\n--- Cleanup ---');
    await TaskDatabaseService.clearConversationContext(testPhone);
    console.log('✓ Cleaned up test conversation contexts.');

    console.log('\n🎉 ALL PHASE 6 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phase 6 Test Failed:', err);
    process.exit(1);
});
