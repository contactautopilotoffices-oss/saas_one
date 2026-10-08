import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 16 WhatsApp Conversation Switching & Disambiguation Tests...\n');

    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskMessageRouter } = await import('../TaskMessageRouter');

    // 1. Pick test employee with phone
    const employees = await TaskDatabaseService.getAllEmployees();
    const testEmployee = employees.find(e => e.phone_number && e.phone_number.length >= 10) || employees[0];
    const phone = testEmployee.phone_number;

    console.log(`✓ Testing with employee: ${testEmployee.name} (${phone})`);

    // Clean previous contexts
    await TaskDatabaseService.clearConversationContext(phone);

    try {
        // ── Test 1: Ambiguous Message Triggers Disambiguation Prompt ──────────
        console.log('\n--- Test 1: Ambiguous Greeting Triggers 1/2 Disambiguation Prompt ---');
        const resAmbiguous = await TaskMessageRouter.routeInboundMessage({
            phone,
            text: 'help',
            sendReply: false
        });

        console.log('Ambiguous Route Result:', {
            system: resAmbiguous.system,
            reason: resAmbiguous.classification.reason,
            reply: resAmbiguous.replySent
        });

        if (resAmbiguous.system !== 'AMBIGUOUS') {
            throw new Error(`Expected AMBIGUOUS system routing, got ${resAmbiguous.system}`);
        }
        if (!resAmbiguous.replySent?.includes('1. Manage tasks') || !resAmbiguous.replySent?.includes('2. Facility services')) {
            throw new Error('Disambiguation prompt missing required 1. Manage tasks / 2. Facility options');
        }
        console.log('✓ Disambiguation menu presented with options 1 & 2.');

        // Verify context persisted in database
        const ctx = await TaskDatabaseService.getConversationContext(phone, 'TASK_MANAGER');
        if (ctx?.context_data?.state !== 'AWAITING_SYSTEM_CHOICE') {
            throw new Error(`Expected context state 'AWAITING_SYSTEM_CHOICE', got ${JSON.stringify(ctx?.context_data)}`);
        }
        console.log('✓ Context state successfully set to AWAITING_SYSTEM_CHOICE in database.');

        // ── Test 2: User Chooses Option "1" (Tasks) ───────────────────────────
        console.log('\n--- Test 2: User Chooses Option "1" ---');
        const resChoice1 = await TaskMessageRouter.routeInboundMessage({
            phone,
            text: '1',
            sendReply: false
        });

        console.log('Choice 1 Result:', {
            system: resChoice1.system,
            reason: resChoice1.classification.reason,
            handled: resChoice1.handledByTaskManager,
            taskCommand: resChoice1.taskResult?.command
        });

        if (resChoice1.system !== 'TASK_MANAGER' || !resChoice1.handledByTaskManager) {
            throw new Error('Choice 1 failed to route to TASK_MANAGER');
        }
        console.log('✓ Option 1 successfully switched to TASK_MANAGER and executed task listing.');

        // ── Test 3: Explicit Switch to "facility" ──────────────────────────────
        console.log('\n--- Test 3: Explicit Switch Command "facility" ---');
        const resFacility = await TaskMessageRouter.routeInboundMessage({
            phone,
            text: 'facility',
            sendReply: false
        });

        console.log('Facility Switch Result:', {
            system: resFacility.system,
            reason: resFacility.classification.reason,
            reply: resFacility.replySent
        });

        if (resFacility.system !== 'FACILITY') {
            throw new Error(`Expected FACILITY switch, got ${resFacility.system}`);
        }
        if (!resFacility.replySent?.includes('Switched to Facility Bot')) {
            throw new Error('Facility switch confirmation text missing');
        }

        // Verify Facility context active
        const facCtx = await TaskDatabaseService.getConversationContext(phone, 'FACILITY');
        if (!facCtx) {
            throw new Error('Facility conversation context not created after switch');
        }
        console.log('✓ Verified: Explicit switch activated FACILITY context.');

    } finally {
        // ── Cleanup ──────────────────────────────────────────────────────────
        console.log('\n--- Cleanup ---');
        await TaskDatabaseService.clearConversationContext(phone);
        console.log('✓ Cleaned up conversation context.');
    }

    console.log('\n🎉 ALL PHASE 16 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phase 16 Test Failed:', err);
    process.exit(1);
});
