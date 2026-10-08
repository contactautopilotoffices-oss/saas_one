import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskProgressService } from './TaskProgressService';
import { PermissionService, PermissionDeniedError } from './PermissionService';
import { Employee, TaskAssignment } from './types';

export class ControlledTaskTools {
    /**
     * Resolves department by name or ID.
     */
    private static async resolveDepartment(nameOrId: string) {
        // Try by ID first
        let dept = await TaskDatabaseService.getDepartmentById(nameOrId);
        if (!dept) {
            dept = await TaskDatabaseService.getDepartmentByName(nameOrId);
        }
        return dept;
    }

    /**
     * Tool 1: get_organisation_progress
     * Scoped strictly to superusers.
     */
    static async get_organisation_progress(actor: Employee, params: { date?: string } = {}) {
        if (actor.role !== 'superuser') {
            throw new PermissionDeniedError('AI_TOOL_ACCESS', actor.id, 'Only superusers can query organisation progress');
        }
        const data = await TaskProgressService.getOrganisationProgress(params.date);
        return {
            totalDepartments: data.totalDepartments,
            totalEmployees: data.totalEmployees,
            totalTasks: data.total,
            completedTasks: data.completed,
            pendingTasks: data.pending,
            overallCompletionPercentage: `${data.percentage}%`,
            departments: data.departmentProgress.map(d => ({
                name: d.departmentName,
                total: d.total,
                completed: d.completed,
                pending: d.pending,
                percentage: `${d.percentage}%`
            }))
        };
    }

    /**
     * Tool 2: get_department_progress
     * Scoped to superusers and the department's reporting manager.
     */
    static async get_department_progress(actor: Employee, params: { departmentNameOrId: string; date?: string }) {
        const dept = await this.resolveDepartment(params.departmentNameOrId);
        if (!dept) {
            return { error: `Department "${params.departmentNameOrId}" not found.` };
        }

        if (actor.role !== 'superuser' && (actor.role !== 'reporting_manager' || actor.department_id !== dept.id)) {
            throw new PermissionDeniedError('AI_TOOL_ACCESS', actor.id, `Not authorized to view ${dept.name} department progress`);
        }

        const data = await TaskProgressService.getDepartmentProgress(dept.id, params.date);
        return {
            departmentName: data.departmentName,
            activeEmployees: data.activeEmployeeCount,
            totalTasks: data.total,
            completedTasks: data.completed,
            pendingTasks: data.pending,
            completionPercentage: `${data.percentage}%`,
            employeeBreakdown: data.employeeProgress.map(e => ({
                name: e.employeeName,
                total: e.total,
                completed: e.completed,
                pending: e.pending,
                percentage: `${e.percentage}%`
            }))
        };
    }

    /**
     * Tool 3: get_department_tasks
     */
    static async get_department_tasks(actor: Employee, params: { departmentNameOrId: string; date?: string; status?: string }) {
        const dept = await this.resolveDepartment(params.departmentNameOrId);
        if (!dept) {
            return { error: `Department "${params.departmentNameOrId}" not found.` };
        }

        if (actor.role !== 'superuser' && (actor.role !== 'reporting_manager' || actor.department_id !== dept.id)) {
            throw new PermissionDeniedError('AI_TOOL_ACCESS', actor.id, `Not authorized to view ${dept.name} tasks`);
        }

        const date = params.date || new Date().toISOString().slice(0, 10);
        const emps = await TaskDatabaseService.getEmployeesByDepartment(dept.id);
        const empIds = emps.map(e => e.id);

        if (empIds.length === 0) {
            return { department: dept.name, tasks: [] };
        }

        let query = supabaseAdmin
            .from('task_assignments')
            .select(`
                *,
                employee:users!task_assignments_employee_id_fkey(full_name)
            `)
            .eq('assigned_date', date)
            .in('employee_id', empIds);

        if (params.status) {
            query = query.eq('status', params.status);
        }

        const { data: rawTasks, error } = await query;
        if (error) throw error;

        return {
            department: dept.name,
            date,
            total: (rawTasks || []).length,
            tasks: (rawTasks || []).map((t: any) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                assignedTo: t.employee?.full_name || 'Staff'
            }))
        };
    }

    /**
     * Tool 4: get_pending_tasks
     * Returns pending tasks across the organisation (superuser) or department (manager).
     */
    static async get_pending_tasks(actor: Employee, params: { departmentNameOrId?: string; date?: string }) {
        const date = params.date || new Date().toISOString().slice(0, 10);

        let targetDeptId: string | undefined = undefined;
        if (params.departmentNameOrId) {
            const dept = await this.resolveDepartment(params.departmentNameOrId);
            if (dept) targetDeptId = dept.id;
        } else if (actor.role === 'reporting_manager') {
            targetDeptId = actor.department_id || undefined;
        }

        let employees: Employee[] = [];
        if (targetDeptId) {
            employees = await TaskDatabaseService.getEmployeesByDepartment(targetDeptId);
        } else if (actor.role === 'superuser') {
            employees = await TaskDatabaseService.getAllEmployees();
        } else {
            employees = [actor];
        }

        const empIds = employees.map(e => e.id);
        if (empIds.length === 0) {
            return { pendingTasks: [] };
        }

        const { data: rawTasks, error } = await supabaseAdmin
            .from('task_assignments')
            .select(`
                *,
                employee:users!task_assignments_employee_id_fkey(full_name)
            `)
            .eq('assigned_date', date)
            .neq('status', 'completed')
            .in('employee_id', empIds);

        if (error) throw error;

        const tasks = (rawTasks || []).map((t: any) => ({
            id: t.id,
            title: t.title,
            assignedTo: t.employee?.full_name || 'Staff',
            status: t.status
        }));

        return {
            date,
            pendingCount: tasks.length,
            pendingTasks: tasks
        };
    }

    /**
     * Tool 5: get_employee_tasks
     */
    static async get_employee_tasks(actor: Employee, params: { nameOrPhone: string; date?: string }) {
        const allEmployees = await TaskDatabaseService.getAllEmployees();
        const search = params.nameOrPhone.trim().toLowerCase();

        const target = allEmployees.find(e =>
            e.name.toLowerCase().includes(search) ||
            e.phone_number.includes(search) ||
            e.id === params.nameOrPhone
        );

        if (!target) {
            return { error: `Employee "${params.nameOrPhone}" not found.` };
        }

        // Check access
        if (actor.role === 'employee' && actor.id !== target.id) {
            throw new PermissionDeniedError('AI_TOOL_ACCESS', actor.id, 'Cannot view other employee tasks');
        }
        if (actor.role === 'reporting_manager' && actor.department_id !== target.department_id) {
            throw new PermissionDeniedError('AI_TOOL_ACCESS', actor.id, 'Cannot view employee outside managed department');
        }

        const date = params.date || new Date().toISOString().slice(0, 10);
        const tasks = await TaskDatabaseService.getDailyAssignments({
            employeeId: target.id,
            date
        });

        return {
            employee: target.name,
            department: target.department_name,
            date,
            total: tasks.length,
            completed: tasks.filter(t => t.status === 'completed').length,
            pending: tasks.filter(t => t.status !== 'completed').length,
            tasks: tasks.map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                completedAt: t.completed_at
            }))
        };
    }
}
