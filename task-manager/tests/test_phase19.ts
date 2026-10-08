import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 19 Idempotency and Reliability Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskIdempotencyService } = await import('../TaskIdempotencyService');

    // ── Test 1: Webhook Message Deduplication ────────────────────────────────
    console.log('--- Test 1: Webhook Message Deduplication ---');
    const msgId = `msg_test_${Date.now()}`;

    // Initially not duplicate
    const isDup1 = await TaskIdempotencyService.isDuplicateWebhook(msgId);
    console.log(`  Initial check for "${msgId}": duplicate = ${isDup1}`);
    if (isDup1) {
        throw new Error('MessageId should not be flagged as duplicate before processing');
    }

    // Record as processed
    TaskIdempotencyService.recordProcessedWebhook(msgId);

    // Second check must be duplicate
    const isDup2 = await TaskIdempotencyService.isDuplicateWebhook(msgId);
    console.log(`  Second check for "${msgId}": duplicate = ${isDup2}`);
    if (!isDup2) {
        throw new Error('MessageId was NOT recognized as duplicate on retry');
    }
    console.log('✓ Webhook retry deduplication verified.');

    // ── Test 2: Task Assignment Idempotency ──────────────────────────────────
    console.log('\n--- Test 2: Repeated Task Assignment Idempotency ---');
    const employees = await TaskDatabaseService.getAllEmployees();
    const testEmployee = employees[0];
    const testDate = '2026-10-09';

    // Create a template
    const template = await TaskDatabaseService.createTaskTemplate({
        title: `[PHASE19] Idempotent Routine - ${Date.now()}`,
        departmentId: testEmployee.department_id || undefined,
        taskType: 'fixed',
        createdBy: testEmployee.id
    });
    console.log(`✓ Created test template: "${template.title}" (ID: ${template.id})`);

    try {
        // First assignment
        const assign1 = await TaskDatabaseService.createTaskAssignment({
            employeeId: testEmployee.id,
            taskTemplateId: template.id,
            title: template.title,
            assignedDate: testDate,
            assignedBy: testEmployee.id
        });
        console.log(`✓ Assignment 1 created: ID=${assign1.id}`);

        // Second assignment (exact duplicate call)
        const assign2 = await TaskDatabaseService.createTaskAssignment({
            employeeId: testEmployee.id,
            taskTemplateId: template.id,
            title: template.title,
            assignedDate: testDate,
            assignedBy: testEmployee.id
        });
        console.log(`✓ Assignment 2 returned: ID=${assign2.id}`);

        if (assign1.id !== assign2.id) {
            throw new Error(`Idempotency violated: Assignment IDs differ (${assign1.id} vs ${assign2.id})`);
        }

        // Verify count in database
        const { data: dbRows } = await supabaseAdmin
            .from('task_assignments')
            .select('id')
            .eq('task_template_id', template.id)
            .eq('employee_id', testEmployee.id)
            .eq('assigned_date', testDate);

        if (!dbRows || dbRows.length !== 1) {
            throw new Error(`Expected exactly 1 assignment in database, found ${dbRows?.length}`);
        }
        console.log(`✓ Verified exactly 1 database row exists for (employee, template, date).`);

    } finally {
        // ── Cleanup ──────────────────────────────────────────────────────────
        console.log('\n--- Cleanup ---');
        await supabaseAdmin
            .from('task_assignments')
            .delete()
            .eq('task_template_id', template.id);
        await supabaseAdmin
            .from('task_templates')
            .delete()
            .eq('id', template.id);
        console.log('✓ Cleaned up test template and assignments.');
    }

    console.log('\n🎉 ALL PHASE 19 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phase 19 Test Failed:', err);
    process.exit(1);
});
