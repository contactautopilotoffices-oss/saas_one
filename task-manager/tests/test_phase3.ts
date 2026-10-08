import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import type { Employee, TaskAssignment } from '../types';

async function run() {
    console.log('🧪 Starting Phase 3 Task Assignment Dashboard Backend Tests...\n');

    const { TaskDatabaseService } = await import('../TaskDatabaseService');
    const { PermissionService, PermissionDeniedError } = await import('../PermissionService');

    // 1. Setup mock employees across roles and departments
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

    // In-memory mock task assignments table
    const assignmentsStore: TaskAssignment[] = [];
    const auditLogsStore: any[] = [];

    // Monkey-patch TaskDatabaseService methods for deterministic local testing
    const originalGetEmp = TaskDatabaseService.getEmployeeById;
    const originalGetAllEmps = TaskDatabaseService.getAllEmployees;
    const originalCreateTask = TaskDatabaseService.createTaskAssignment;
    const originalUpdateTask = TaskDatabaseService.updateAssignmentStatus;
    const originalAudit = TaskDatabaseService.logAudit;

    TaskDatabaseService.getEmployeeById = async (id: string) => employeeMap.get(id) || null;
    TaskDatabaseService.getAllEmployees = async () => Array.from(employeeMap.values());
    TaskDatabaseService.logAudit = async (entry: any) => { auditLogsStore.push(entry); };

    TaskDatabaseService.createTaskAssignment = async (params) => {
        const item: TaskAssignment = {
            id: `task-${assignmentsStore.length + 1}`,
            task_template_id: params.taskTemplateId || null,
            title: params.title,
            description: params.description || null,
            employee_id: params.employeeId,
            assigned_date: params.assignedDate || new Date().toISOString().slice(0, 10),
            status: 'pending',
            assigned_by: params.assignedBy || null,
            completed_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        assignmentsStore.push(item);
        return item;
    };

    TaskDatabaseService.updateAssignmentStatus = async (params) => {
        const item = assignmentsStore.find(t => t.id === params.assignmentId);
        if (!item) throw new Error('Task not found');
        item.status = params.status;
        item.completed_at = params.status === 'completed' ? new Date().toISOString() : null;
        item.updated_at = new Date().toISOString();
        return item;
    };

    try {
        // ── Test 1: Reporting Manager assigns to employee in own department ───
        console.log('--- Test 1: Reporting Manager assigns task in own department ---');
        const validation1 = await PermissionService.assertCanAssignTask(mockManagerTech.id, mockEmployeeTech.id);
        const task1 = await TaskDatabaseService.createTaskAssignment({
            employeeId: validation1.target.id,
            title: 'Deploy Staging Auth Fix',
            description: 'Verify token expiration edge cases',
            assignedBy: validation1.actor.id
        });

        if (task1.employee_id === mockEmployeeTech.id && task1.status === 'pending') {
            console.log(`✅ Success: Task #${task1.id} assigned to ${mockEmployeeTech.name}`);
        } else {
            throw new Error('Task creation verification failed');
        }

        // ── Test 2: Reporting Manager tries to assign to another department ───
        console.log('\n--- Test 2: Reporting Manager blocked from assigning outside department ---');
        let errorCaught = false;
        try {
            await PermissionService.assertCanAssignTask(mockManagerTech.id, mockEmployeeOps.id);
            await TaskDatabaseService.createTaskAssignment({
                employeeId: mockEmployeeOps.id,
                title: 'Clean Server Room',
                assignedBy: mockManagerTech.id
            });
        } catch (err: any) {
            errorCaught = true;
            if (err instanceof PermissionDeniedError) {
                console.log(`✅ Security Guard Passed: ${err.message}`);
            } else {
                throw err;
            }
        }
        if (!errorCaught) throw new Error('Security Violation: Manager assigned outside their department!');

        // ── Test 3: Superuser assigns across departments ─────────────────────
        console.log('\n--- Test 3: Superuser assigns tasks across any department ---');
        const validation3a = await PermissionService.assertCanAssignTask(mockSuperuser.id, mockEmployeeTech.id);
        const taskTech = await TaskDatabaseService.createTaskAssignment({
            employeeId: validation3a.target.id,
            title: 'Prepare ISO Security Audit Report',
            assignedBy: validation3a.actor.id
        });

        const validation3b = await PermissionService.assertCanAssignTask(mockSuperuser.id, mockEmployeeOps.id);
        const taskOps = await TaskDatabaseService.createTaskAssignment({
            employeeId: validation3b.target.id,
            title: 'Audit Electricity Consumption Logs',
            assignedBy: validation3b.actor.id
        });

        if (taskTech && taskOps) {
            console.log(`✅ Success: Superuser assigned tasks to both Tech (${taskTech.id}) and Ops (${taskOps.id})`);
        }

        // ── Test 4: Task Completion by Assignee ──────────────────────────────
        console.log('\n--- Test 4: Assignee completes their assigned task ---');
        await PermissionService.assertCanCompleteTask(mockEmployeeTech.id, task1);
        const completedTask = await TaskDatabaseService.updateAssignmentStatus({
            assignmentId: task1.id,
            status: 'completed'
        });

        if (completedTask.status === 'completed' && completedTask.completed_at) {
            console.log(`✅ Success: Task #${task1.id} marked as COMPLETED at ${completedTask.completed_at}`);
        } else {
            throw new Error('Task completion status not updated');
        }

        // ── Test 5: Unauthorized User Cannot Complete Task ────────────────────
        console.log('\n--- Test 5: Unauthorized user blocked from completing task ---');
        errorCaught = false;
        try {
            await PermissionService.assertCanCompleteTask(mockEmployeeOps.id, taskTech);
            await TaskDatabaseService.updateAssignmentStatus({
                assignmentId: taskTech.id,
                status: 'completed'
            });
        } catch (err: any) {
            errorCaught = true;
            if (err instanceof PermissionDeniedError) {
                console.log(`✅ Security Guard Passed: ${err.message}`);
            } else {
                throw err;
            }
        }
        if (!errorCaught) throw new Error('Security Violation: Unauthorized user completed someone else\'s task!');

        console.log('\n🎉 ALL Phase 3 Task Assignment backend functionality verified successfully!\n');
    } finally {
        TaskDatabaseService.getEmployeeById = originalGetEmp;
        TaskDatabaseService.getAllEmployees = originalGetAllEmps;
        TaskDatabaseService.createTaskAssignment = originalCreateTask;
        TaskDatabaseService.updateAssignmentStatus = originalUpdateTask;
        TaskDatabaseService.logAudit = originalAudit;
    }
}

run().catch(err => {
    console.error('❌ Phase 3 test failed:', err);
    process.exit(1);
});
