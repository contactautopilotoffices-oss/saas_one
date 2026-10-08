import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 5 Morning WhatsApp Task Notification Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskNotificationService } = await import('../TaskNotificationService');
    const typeModule = await import('../types');

    // ── Test 1: Unit Test Digest Formatter ────────────────────────────────────
    console.log('--- Test 1: buildMorningDigest Formatting ---');
    const mockTasks: any[] = [
        { id: '1', title: 'Inspect Electrical Panels', status: 'pending' },
        { id: '2', title: 'Clean Conference Room B', status: 'completed' },
        { id: '3', title: 'Restock Stationery', status: 'pending' },
    ];

    const digest = TaskNotificationService.buildMorningDigest('Rahul Sharma', mockTasks);
    console.log('Generated Digest:\n' + digest + '\n');

    if (!digest.includes('Good morning Rahul! 📋')) {
        throw new Error('Digest greeting missing expected employee name');
    }
    if (!digest.includes('1. Inspect Electrical Panels [Pending ⏳]')) {
        throw new Error('Task #1 formatted incorrectly');
    }
    if (!digest.includes('2. Clean Conference Room B [Completed ✅]')) {
        throw new Error('Task #2 formatted incorrectly');
    }
    if (!digest.includes('"done 1"') || !digest.includes('"done all"') || !digest.includes('"tasks"')) {
        throw new Error('Digest missing reply instructions');
    }
    console.log('✓ buildMorningDigest output verified successfully.');

    // ── Test 2: Notification Pipeline Integration ────────────────────────────
    console.log('\n--- Test 2: Notification Pipeline with dryRun ---');
    const employees = await TaskDatabaseService.getAllEmployees();
    if (employees.length === 0) {
        throw new Error('No active employees found to test with in database.');
    }
    const testEmployee = employees[0];
    const testDate = '2026-10-05';

    // Create a temporary task assignment for testing
    const testTask = await TaskDatabaseService.createTaskAssignment({
        employeeId: testEmployee.id,
        title: '[TEST-PHASE5] Morning Notification Test Task',
        description: 'Verify morning digest dispatch',
        assignedDate: testDate,
        assignedBy: testEmployee.id
    });
    console.log(`✓ Created test assignment ID: ${testTask.id} for employee ${testEmployee.name}`);

    try {
        const result = await TaskNotificationService.sendMorningNotifications({
            date: testDate,
            employeeId: testEmployee.id,
            dryRun: true // Safe test run
        });

        console.log('Notification Pipeline Result:', {
            success: result.success,
            totalChecked: result.totalEmployeesChecked,
            notificationsSent: result.notificationsSent,
            skippedNoTasks: result.skippedNoTasks
        });

        if (!result.success) {
            throw new Error('sendMorningNotifications returned failure');
        }
        if (result.notificationsSent !== 1) {
            throw new Error(`Expected 1 notification sent, got ${result.notificationsSent}`);
        }

        const employeeDetail = result.details[0];
        if (!employeeDetail.digestPreview?.includes('[TEST-PHASE5] Morning Notification Test Task')) {
            throw new Error('Digest preview did not contain the test task title');
        }
        console.log('✓ Pipeline successfully composed and prepared digest for test employee.');

    } finally {
        // ── Cleanup ──────────────────────────────────────────────────────────
        console.log('\n--- Cleanup ---');
        await supabaseAdmin
            .from('task_assignments')
            .delete()
            .eq('id', testTask.id);
        console.log('✓ Cleaned up test assignment.');
    }

    console.log('\n🎉 ALL PHASE 5 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phase 5 Test Failed:', err);
    process.exit(1);
});
