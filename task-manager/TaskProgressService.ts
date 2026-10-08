import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from './TaskDatabaseService';
import { Employee, TaskAssignment } from './types';

export interface ProgressStats {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    percentage: number;
}

export interface EmployeeProgress extends ProgressStats {
    level: 1;
    employeeId: string;
    employeeName: string;
    phone: string;
    departmentId: string | null;
    departmentName: string | null;
    date: string;
}

export interface DepartmentProgress extends ProgressStats {
    level: 2;
    departmentId: string;
    departmentName: string;
    activeEmployeeCount: number;
    employeeProgress: EmployeeProgress[];
    date: string;
}

export interface OrganisationProgress extends ProgressStats {
    level: 3;
    totalDepartments: number;
    totalEmployees: number;
    departmentProgress: DepartmentProgress[];
    date: string;
}

export class TaskProgressService {
    /**
     * Renders a text progress bar (e.g. ████████░░ 80%)
     */
    static formatProgressBar(percentage: number, length = 10): string {
        const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
        const filled = Math.round((clamped / 100) * length);
        const empty = length - filled;
        return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${clamped}%`;
    }

    /**
     * LEVEL 1 — Employee Progress
     * completed tasks / total assigned tasks
     */
    static async getEmployeeProgress(employeeId: string, date?: string): Promise<EmployeeProgress> {
        const targetDate = date || new Date().toISOString().slice(0, 10);
        const emp = await TaskDatabaseService.getEmployeeById(employeeId);

        const tasks = await TaskDatabaseService.getDailyAssignments({
            employeeId,
            date: targetDate
        });

        const completed = tasks.filter(t => t.status === 'completed').length;
        const inProgress = tasks.filter(t => t.status === 'in_progress').length;
        const pending = tasks.filter(t => t.status === 'pending').length;
        const total = tasks.length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 100;

        return {
            level: 1,
            employeeId,
            employeeName: emp?.name || 'Employee',
            phone: emp?.phone_number || '',
            departmentId: emp?.department_id || null,
            departmentName: emp?.department_name || null,
            date: targetDate,
            total,
            completed,
            pending,
            inProgress,
            percentage
        };
    }

    /**
     * LEVEL 2 — Department Progress
     * Aggregates all employees within a single department.
     */
    static async getDepartmentProgress(departmentId: string, date?: string): Promise<DepartmentProgress> {
        const targetDate = date || new Date().toISOString().slice(0, 10);

        // Fetch dept metadata and employees in parallel (was 2 sequential round trips)
        const [dept, employees] = await Promise.all([
            TaskDatabaseService.getDepartmentById(departmentId),
            TaskDatabaseService.getEmployeesByDepartment(departmentId)
        ]);

        if (employees.length === 0) {
            return {
                level: 2,
                departmentId,
                departmentName: dept?.name || 'Department',
                activeEmployeeCount: 0,
                employeeProgress: [],
                date: targetDate,
                total: 0,
                completed: 0,
                pending: 0,
                inProgress: 0,
                percentage: 100
            };
        }

        const empIds = employees.map(e => e.id);
        const { data: rawAssignments, error } = await supabaseAdmin
            .from('task_assignments')
            .select('*')
            .eq('assigned_date', targetDate)
            .in('employee_id', empIds);

        if (error) {
            console.error('[TaskProgressService] Error fetching department assignments:', error);
            throw error;
        }

        const assignments = (rawAssignments || []) as TaskAssignment[];

        // Group tasks by employee
        const tasksByEmp = new Map<string, TaskAssignment[]>();
        for (const a of assignments) {
            const list = tasksByEmp.get(a.employee_id) || [];
            list.push(a);
            tasksByEmp.set(a.employee_id, list);
        }

        const employeeProgressList: EmployeeProgress[] = [];
        let deptTotal = 0;
        let deptCompleted = 0;
        let deptPending = 0;
        let deptInProgress = 0;

        for (const emp of employees) {
            const empTasks = tasksByEmp.get(emp.id) || [];
            const empCompleted = empTasks.filter(t => t.status === 'completed').length;
            const empInProgress = empTasks.filter(t => t.status === 'in_progress').length;
            const empPending = empTasks.filter(t => t.status === 'pending').length;
            const empTotal = empTasks.length;
            const empPercentage = empTotal > 0 ? Math.round((empCompleted / empTotal) * 100) : 100;

            employeeProgressList.push({
                level: 1,
                employeeId: emp.id,
                employeeName: emp.name,
                phone: emp.phone_number,
                departmentId: emp.department_id,
                departmentName: emp.department_name,
                date: targetDate,
                total: empTotal,
                completed: empCompleted,
                pending: empPending,
                inProgress: empInProgress,
                percentage: empPercentage
            });

            deptTotal += empTotal;
            deptCompleted += empCompleted;
            deptPending += empPending;
            deptInProgress += empInProgress;
        }

        const deptPercentage = deptTotal > 0 ? Math.round((deptCompleted / deptTotal) * 100) : 100;

        return {
            level: 2,
            departmentId,
            departmentName: dept?.name || 'Department',
            activeEmployeeCount: employees.length,
            employeeProgress: employeeProgressList,
            date: targetDate,
            total: deptTotal,
            completed: deptCompleted,
            pending: deptPending,
            inProgress: deptInProgress,
            percentage: deptPercentage
        };
    }

    /**
     * LEVEL 3 — Organisation Progress
     * Aggregates all departments across the organisation.
     */
    static async getOrganisationProgress(date?: string): Promise<OrganisationProgress> {
        const targetDate = date || new Date().toISOString().slice(0, 10);
        const departments = await TaskDatabaseService.getDepartments();

        let orgTotal = 0;
        let orgCompleted = 0;
        let orgPending = 0;
        let orgInProgress = 0;
        let totalEmployees = 0;

        // Fetch all department progress in parallel (was N sequential round trips)
        const deptProgressList = await Promise.all(
            departments.map(dept => this.getDepartmentProgress(dept.id, targetDate))
        );

        for (const deptProg of deptProgressList) {
            orgTotal += deptProg.total;
            orgCompleted += deptProg.completed;
            orgPending += deptProg.pending;
            orgInProgress += deptProg.inProgress;
            totalEmployees += deptProg.activeEmployeeCount;
        }

        // Sort departments with highest pending tasks or lowest completion first
        deptProgressList.sort((a, b) => b.total - a.total);

        const orgPercentage = orgTotal > 0 ? Math.round((orgCompleted / orgTotal) * 100) : 100;

        return {
            level: 3,
            totalDepartments: departments.length,
            totalEmployees,
            departmentProgress: deptProgressList,
            date: targetDate,
            total: orgTotal,
            completed: orgCompleted,
            pending: orgPending,
            inProgress: orgInProgress,
            percentage: orgPercentage
        };
    }
}
