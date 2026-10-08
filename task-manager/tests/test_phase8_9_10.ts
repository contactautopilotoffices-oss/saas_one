import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phases 8, 9, 10 Progress Service Tests...\n');

    const { supabaseAdmin } = await import('../../backend/lib/supabase/admin');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { TaskProgressService } = await import('../TaskProgressService');

    // 1. Pick test employee and department
    const employees = await TaskDatabaseService.getAllEmployees();
    if (employees.length === 0) {
        throw new Error('No active employees found to test with.');
    }
    const testEmployee = employees.find(e => e.department_id) || employees[0];
    const deptId = testEmployee.department_id!;
    const testDate = '2026-10-07';

    console.log(`✓ Using employee: ${testEmployee.name} (${testEmployee.id}), Dept: ${testEmployee.department_name} (${deptId})`);

    // 2. Seed 2 tasks for this employee: 1 completed, 1 pending
    const t1 = await TaskDatabaseService.createTaskAssignment({
        employeeId: testEmployee.id,
        title: '[PHASE8] Check Network Router',
        assignedDate: testDate,
        assignedBy: testEmployee.id
    });
    // Mark t1 completed
    await TaskDatabaseService.updateAssignmentStatus({
        assignmentId: t1.id,
        status: 'completed'
    });

    const t2 = await TaskDatabaseService.createTaskAssignment({
        employeeId: testEmployee.id,
        title: '[PHASE8] Clean Server Rack',
        assignedDate: testDate,
        assignedBy: testEmployee.id
    });

    console.log(`✓ Seeded 2 tasks (1 completed, 1 pending) on ${testDate}`);

    try {
        // ── Phase 8: Level 1 — Employee Progress ──────────────────────────────
        console.log('\n--- Phase 8: LEVEL 1 — Employee Progress ---');
        const empProgress = await TaskProgressService.getEmployeeProgress(testEmployee.id, testDate);
        console.log('Employee Progress:', empProgress);

        if (empProgress.total < 2 || empProgress.completed < 1) {
            throw new Error(`Expected at least 2 tasks with 1 completed, got ${JSON.stringify(empProgress)}`);
        }
        if (empProgress.percentage !== 50) {
            throw new Error(`Expected exactly 50% completion, got ${empProgress.percentage}%`);
        }

        const bar = TaskProgressService.formatProgressBar(empProgress.percentage);
        console.log(`Progress Bar: [${bar}]`);
        if (!bar.includes('50%')) {
            throw new Error('Progress bar formatting mismatch');
        }
        console.log('✓ Phase 8: Level 1 Employee Progress verified successfully.');

        // ── Phase 9: Level 2 — Department Progress ────────────────────────────
        console.log('\n--- Phase 9: LEVEL 2 — Department Progress ---');
        const deptProgress = await TaskProgressService.getDepartmentProgress(deptId, testDate);
        console.log('Department Progress:', {
            departmentName: deptProgress.departmentName,
            activeEmployeeCount: deptProgress.activeEmployeeCount,
            total: deptProgress.total,
            completed: deptProgress.completed,
            percentage: deptProgress.percentage
        });

        if (deptProgress.total < 2) {
            throw new Error(`Expected at least 2 tasks in department, got ${deptProgress.total}`);
        }
        const foundEmp = deptProgress.employeeProgress.find(e => e.employeeId === testEmployee.id);
        if (!foundEmp || foundEmp.percentage !== 50) {
            throw new Error(`Test employee not found in department drill-down or progress mismatch: ${JSON.stringify(foundEmp)}`);
        }
        console.log('✓ Phase 9: Level 2 Department Progress verified successfully.');

        // ── Phase 10: Level 3 — Organisation Progress ─────────────────────────
        console.log('\n--- Phase 10: LEVEL 3 — Organisation Progress ---');
        const orgProgress = await TaskProgressService.getOrganisationProgress(testDate);
        console.log('Organisation Progress:', {
            totalDepartments: orgProgress.totalDepartments,
            totalEmployees: orgProgress.totalEmployees,
            totalTasks: orgProgress.total,
            completedTasks: orgProgress.completed,
            percentage: orgProgress.percentage
        });

        if (orgProgress.totalDepartments < 1) {
            throw new Error('Organisation progress returned 0 departments');
        }
        if (orgProgress.total < 2) {
            throw new Error(`Organisation total tasks expected >= 2, got ${orgProgress.total}`);
        }
        const foundDept = orgProgress.departmentProgress.find(d => d.departmentId === deptId);
        if (!foundDept) {
            throw new Error(`Target department ${deptId} missing from organisation report`);
        }
        console.log('✓ Phase 10: Level 3 Organisation Progress verified successfully.');

    } finally {
        // ── Cleanup ──────────────────────────────────────────────────────────
        console.log('\n--- Cleanup ---');
        await supabaseAdmin
            .from('task_assignments')
            .delete()
            .in('id', [t1.id, t2.id]);
        console.log('✓ Cleaned up test task assignments.');
    }

    console.log('\n🎉 ALL PHASES 8, 9, 10 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phases 8, 9, 10 Test Failed:', err);
    process.exit(1);
});
