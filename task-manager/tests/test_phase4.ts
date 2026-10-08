import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phase 4 Daily Fixed Tasks Generator Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskDailyGeneratorService } = await import('../TaskDailyGeneratorService');

    // 1. Find an active employee to test with
    const employees = await TaskDatabaseService.getAllEmployees();
    if (employees.length === 0) {
        throw new Error('No active employees found to test with in database.');
    }
    const testEmployee = employees[0];
    console.log(`✓ Using test employee: ${testEmployee.name} (${testEmployee.id}), Dept: ${testEmployee.department_name}`);

    // 2. Create a test fixed task template
    const testDate = '2026-10-04';
    const testTemplateTitle = `[TEST-PHASE4] Daily Routine - ${Date.now()}`;

    const template = await TaskDatabaseService.createTaskTemplate({
        title: testTemplateTitle,
        description: 'Automated test routine task for Phase 4',
        departmentId: testEmployee.department_id || undefined,
        taskType: 'fixed',
        createdBy: testEmployee.id
    });
    console.log(`✓ Created test fixed task template: "${template.title}" (ID: ${template.id})`);

    try {
        // 3. First execution of daily generator
        console.log('\n--- Test 1: First Run of TaskDailyGeneratorService ---');
        const run1 = await TaskDailyGeneratorService.generateDailyFixedTasks({
            date: testDate,
            employeeId: testEmployee.id
        });

        console.log(`Run 1 Result:`, {
            success: run1.success,
            tasksGenerated: run1.tasksGenerated,
            tasksAlreadyExisting: run1.tasksAlreadyExisting,
            employeesTargeted: run1.employeesTargeted
        });

        if (!run1.success) {
            throw new Error(`Run 1 failed with errors: ${JSON.stringify(run1.errors)}`);
        }
        if (run1.tasksGenerated < 1) {
            throw new Error(`Expected at least 1 task generated, got ${run1.tasksGenerated}`);
        }
        console.log('✓ First run successfully generated new daily assignment.');

        // 4. Verify in Supabase
        const { data: dbAssignments, error: dbErr } = await supabaseAdmin
            .from('task_assignments')
            .select('*')
            .eq('task_template_id', template.id)
            .eq('employee_id', testEmployee.id)
            .eq('assigned_date', testDate);

        if (dbErr || !dbAssignments || dbAssignments.length !== 1) {
            throw new Error(`Database check failed: expected 1 row, got ${dbAssignments?.length}, err: ${dbErr?.message}`);
        }

        const assignment = dbAssignments[0];
        if (assignment.status !== 'pending') {
            throw new Error(`Expected status 'pending', got '${assignment.status}'`);
        }
        console.log(`✓ Verified assignment in database: ID=${assignment.id}, Status=${assignment.status}`);

        // 5. Test Idempotency: Second execution for the same date & employee
        console.log('\n--- Test 2: Idempotency (Second Run for Same Date) ---');
        const run2 = await TaskDailyGeneratorService.generateDailyFixedTasks({
            date: testDate,
            employeeId: testEmployee.id
        });

        console.log(`Run 2 Result:`, {
            success: run2.success,
            tasksGenerated: run2.tasksGenerated,
            tasksAlreadyExisting: run2.tasksAlreadyExisting
        });

        if (run2.tasksGenerated !== 0) {
            throw new Error(`Idempotency violated! Expected 0 new tasks generated, got ${run2.tasksGenerated}`);
        }
        if (run2.tasksAlreadyExisting < 1) {
            throw new Error(`Expected at least 1 task recognized as already existing, got ${run2.tasksAlreadyExisting}`);
        }
        console.log('✓ Idempotency verified: 0 duplicate tasks created on second run.');

        // 6. Test Querying Daily Assignments via TaskDatabaseService
        console.log('\n--- Test 3: Query Daily Assignments ---');
        const dailyTasks = await TaskDatabaseService.getDailyAssignments({
            employeeId: testEmployee.id,
            date: testDate
        });

        const found = dailyTasks.find(t => t.task_template_id === template.id);
        if (!found) {
            throw new Error('Created assignment not found in getDailyAssignments query');
        }
        console.log(`✓ Daily assignment successfully retrieved via TaskDatabaseService: "${found.title}"`);

    } finally {
        // 7. Cleanup test data
        console.log('\n--- Cleanup ---');
        await supabaseAdmin
            .from('task_assignments')
            .delete()
            .eq('task_template_id', template.id);

        await supabaseAdmin
            .from('task_templates')
            .delete()
            .eq('id', template.id);

        console.log('✓ Cleaned up test assignments and template.');
    }

    console.log('\n🎉 ALL PHASE 4 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phase 4 Test Failed:', err);
    process.exit(1);
});
