import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function run() {
    console.log('🧪 Starting Phases 11 & 12 Manager & Superuser Dashboard Tests...\n');

    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { PermissionService } = await import('../PermissionService');
    const { TaskProgressService } = await import('../TaskProgressService');

    const superuserId = '284eaccc-2c10-48f4-a524-2b448e40e012';
    const testDate = new Date().toISOString().slice(0, 10);

    // ── Phase 12: Superuser Dashboard Verification ───────────────────────────
    console.log('--- Phase 12: Superuser Dashboard Data Layer ---');
    const superuser = await PermissionService.getActor(superuserId);
    console.log(`✓ Superuser verified: ${superuser.name} (Role: ${superuser.role})`);

    if (superuser.role !== 'superuser') {
        throw new Error(`Expected role 'superuser', got '${superuser.role}'`);
    }

    const orgProgress = await TaskProgressService.getOrganisationProgress(testDate);
    console.log('Organisation Progress (Level 3):', {
        totalDepartments: orgProgress.totalDepartments,
        totalEmployees: orgProgress.totalEmployees,
        totalTasks: orgProgress.total,
        completed: orgProgress.completed,
        percentage: orgProgress.percentage
    });

    if (orgProgress.totalDepartments !== 14) {
        throw new Error(`Expected 14 departments, got ${orgProgress.totalDepartments}`);
    }
    if (!Array.isArray(orgProgress.departmentProgress) || orgProgress.departmentProgress.length !== 14) {
        throw new Error(`Expected 14 department breakdown items, got ${orgProgress.departmentProgress?.length}`);
    }
    console.log('✓ Phase 12: Superuser Level 3 & Level 2 matrix verified successfully.');

    // ── Phase 11: Manager Dashboard Verification ─────────────────────────────
    console.log('\n--- Phase 11: Reporting Manager Dashboard Data Layer ---');
    const employees = await TaskDatabaseService.getAllEmployees();
    const manager = employees.find(e => e.role === 'reporting_manager' && e.department_id) || employees[0];
    console.log(`✓ Using manager: ${manager.name} (${manager.role}, Dept: ${manager.department_name})`);

    const deptProgress = await TaskProgressService.getDepartmentProgress(manager.department_id!, testDate);
    console.log('Department Progress (Level 2):', {
        departmentName: deptProgress.departmentName,
        activeEmployeeCount: deptProgress.activeEmployeeCount,
        total: deptProgress.total,
        completed: deptProgress.completed,
        percentage: deptProgress.percentage,
        employeeDrilldownCount: deptProgress.employeeProgress.length
    });

    if (!deptProgress.departmentName) {
        throw new Error('Department name missing from department progress');
    }
    if (deptProgress.employeeProgress.length !== deptProgress.activeEmployeeCount) {
        throw new Error(`Mismatch between employee progress list (${deptProgress.employeeProgress.length}) and employee count (${deptProgress.activeEmployeeCount})`);
    }
    console.log('✓ Phase 11: Manager Level 2 & Level 1 employee drill-down verified successfully.');

    console.log('\n🎉 ALL PHASES 11 & 12 TESTS PASSED SUCCESSFULLY!\n');
}

run().catch((err) => {
    console.error('❌ Phases 11 & 12 Test Failed:', err);
    process.exit(1);
});
