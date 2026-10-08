import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import type { Employee, TaskAssignment } from '../types';

async function run() {
    console.log('🧪 Starting Phase 2 Role & Permission Integration Tests...\n');

    const { PermissionService, PermissionDeniedError } = await import('../PermissionService');
    const { TaskDatabaseService } = await import('../TaskDatabaseService');

    // 1. Mock Employees representing each role
    const mockEmployeeTech: Employee = {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Rahul Tech Employee',
        phone_number: '919876543210',
        department_id: 'dept-tech-uuid',
        department_name: 'Tech',
        role: 'employee',
        reporting_manager_id: '22222222-2222-2222-2222-222222222222',
        active: true,
        created_at: new Date().toISOString(),
    };

    const mockManagerTech: Employee = {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Amit Tech Manager',
        phone_number: '919876543211',
        department_id: 'dept-tech-uuid',
        department_name: 'Tech',
        role: 'reporting_manager',
        reporting_manager_id: null,
        active: true,
        created_at: new Date().toISOString(),
    };

    const mockEmployeeOps: Employee = {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Priya Ops Employee',
        phone_number: '919876543212',
        department_id: 'dept-ops-uuid',
        department_name: 'Operations',
        role: 'employee',
        reporting_manager_id: null,
        active: true,
        created_at: new Date().toISOString(),
    };

    const mockSuperuser: Employee = {
        id: '44444444-4444-4444-4444-444444444444',
        name: 'Founder Superuser',
        phone_number: '919876543213',
        department_id: null,
        department_name: null,
        role: 'superuser',
        reporting_manager_id: null,
        active: true,
        created_at: new Date().toISOString(),
    };

    const employeeMap = new Map<string, Employee>([
        [mockEmployeeTech.id, mockEmployeeTech],
        [mockManagerTech.id, mockManagerTech],
        [mockEmployeeOps.id, mockEmployeeOps],
        [mockSuperuser.id, mockSuperuser],
    ]);

    // Monkey-patch TaskDatabaseService.getEmployeeById for deterministic testing
    const originalGetEmp = TaskDatabaseService.getEmployeeById;
    TaskDatabaseService.getEmployeeById = async (id: string) => {
        return employeeMap.get(id) || null;
    };

    // Monkey-patch audit logging to avoid dirtying live DB
    let auditLogCalls: any[] = [];
    TaskDatabaseService.logAudit = async (entry: any) => {
        auditLogCalls.push(entry);
    };

    try {
        // ── Test 1: Standard Employee cannot assign tasks ─────────────────────
        console.log('--- Test 1: Standard employee cannot assign tasks ---');
        let errorCaught = false;
        try {
            await PermissionService.assertCanAssignTask(mockEmployeeTech.id, mockEmployeeOps.id);
        } catch (err: any) {
            errorCaught = true;
            if (err instanceof PermissionDeniedError) {
                console.log(`✅ Caught expected PermissionDeniedError: ${err.message}`);
            } else {
                throw err;
            }
        }
        if (!errorCaught) throw new Error('Security Violation: Employee was allowed to assign a task!');

        // ── Test 2: Reporting Manager CAN assign to own department employee ──
        console.log('\n--- Test 2: Manager assigning to own department employee ---');
        const resOwnDept = await PermissionService.assertCanAssignTask(mockManagerTech.id, mockEmployeeTech.id);
        if (resOwnDept.target.id === mockEmployeeTech.id) {
            console.log('✅ Permitted: Manager successfully assigned task to employee in Tech.');
        } else {
            throw new Error('Manager could not assign to employee in own department');
        }

        // ── Test 3: Reporting Manager CANNOT assign to another department ────
        console.log('\n--- Test 3: Manager assigning across departments (Blocked) ---');
        errorCaught = false;
        try {
            await PermissionService.assertCanAssignTask(mockManagerTech.id, mockEmployeeOps.id);
        } catch (err: any) {
            errorCaught = true;
            if (err instanceof PermissionDeniedError) {
                console.log(`✅ Caught expected cross-dept rejection: ${err.message}`);
            } else {
                throw err;
            }
        }
        if (!errorCaught) throw new Error('Security Violation: Manager was allowed to assign outside their department!');

        // ── Test 4: Superuser CAN assign across any department ────────────────
        console.log('\n--- Test 4: Superuser assigning across any department ---');
        const resSuperuserTech = await PermissionService.assertCanAssignTask(mockSuperuser.id, mockEmployeeTech.id);
        const resSuperuserOps = await PermissionService.assertCanAssignTask(mockSuperuser.id, mockEmployeeOps.id);
        if (resSuperuserTech && resSuperuserOps) {
            console.log('✅ Permitted: Superuser assigned to Tech and Operations employees without restriction.');
        }

        // ── Test 5: Employee completing their own task ────────────────────────
        console.log('\n--- Test 5: Employee completing their own task ---');
        const ownTask: TaskAssignment = {
            id: 'task-1',
            task_template_id: null,
            title: 'Clean Room 101',
            description: null,
            employee_id: mockEmployeeTech.id,
            assigned_date: '2026-10-03',
            status: 'pending',
            assigned_by: mockManagerTech.id,
            completed_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        await PermissionService.assertCanCompleteTask(mockEmployeeTech.id, ownTask);
        console.log('✅ Permitted: Employee successfully completed own task.');

        // ── Test 6: Employee completing someone else\'s task (Blocked) ────────
        console.log('\n--- Test 6: Employee completing another employee task ---');
        errorCaught = false;
        try {
            await PermissionService.assertCanCompleteTask(mockEmployeeOps.id, ownTask);
        } catch (err: any) {
            errorCaught = true;
            if (err instanceof PermissionDeniedError) {
                console.log(`✅ Caught expected task completion denial: ${err.message}`);
            } else {
                throw err;
            }
        }
        if (!errorCaught) throw new Error('Security Violation: Employee was allowed to complete another user task!');

        // ── Test 7: Manager department view restriction ───────────────────────
        console.log('\n--- Test 7: Manager viewing department progress ---');
        await PermissionService.assertCanViewDepartment(mockManagerTech.id, 'dept-tech-uuid');
        console.log('✅ Permitted: Manager can view Tech department.');

        errorCaught = false;
        try {
            await PermissionService.assertCanViewDepartment(mockManagerTech.id, 'dept-ops-uuid');
        } catch (err: any) {
            errorCaught = true;
            if (err instanceof PermissionDeniedError) {
                console.log(`✅ Caught expected view denial for foreign department: ${err.message}`);
            } else {
                throw err;
            }
        }
        if (!errorCaught) throw new Error('Security Violation: Manager viewed outside department!');

        // ── Test 8: Superuser Organization View vs Employee ───────────────────
        console.log('\n--- Test 8: Organization View Permission ---');
        await PermissionService.assertCanViewOrganisation(mockSuperuser.id);
        console.log('✅ Permitted: Superuser can view organization progress.');

        errorCaught = false;
        try {
            await PermissionService.assertCanViewOrganisation(mockEmployeeTech.id);
        } catch (err: any) {
            errorCaught = true;
            if (err instanceof PermissionDeniedError) {
                console.log(`✅ Caught expected organization view denial for employee: ${err.message}`);
            } else {
                throw err;
            }
        }
        if (!errorCaught) throw new Error('Security Violation: Employee viewed organization progress!');

        // ── Test 9: Verify audit logs logged on rejections ────────────────────
        console.log('\n--- Test 9: Audit log verification ---');
        console.log(`✅ ${auditLogCalls.length} security denial events recorded in task_audit_logs.`);
        if (auditLogCalls.length < 4) {
            throw new Error('Not all security rejections were audited!');
        }

        console.log('\n🎉 ALL Phase 2 Role & Permission tests PASSED with 100% compliance!\n');
    } finally {
        TaskDatabaseService.getEmployeeById = originalGetEmp;
    }
}

run().catch(err => {
    console.error('❌ Phase 2 test failed:', err);
    process.exit(1);
});
