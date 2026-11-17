import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { MAX_CARRY_DAYS, TaskDatabaseService, buildNumberedList, carryDaysOf } from './TaskDatabaseService';
import { addDaysIso } from './dateRange';

/** Owner 2026-10-15: progress for a date RANGE (to), optionally counting unfinished tasks carried in from before it
 *  (each department's carry-forward setting). Without options: exactly the old single-day numbers. */
export interface ProgressOptions { to?: string; includeCarried?: boolean }
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

/** Carried-forward tasks of one person on one day: finished that day, and still open. */
export interface CarriedSplit { done: number; pending: number }

export class TaskProgressService {
    /**
     * Owner 2026-10-16 (team summaries): per person, the carried-forward tasks on their numbered list for `date` — the SAME
     * list (and carry-forward window) as their morning message — split into finished that day and still open. Separate from
     * the progress numbers below, which stay "tasks given today" exactly as before. People with none are left out.
     */
    static async getCarriedForwardSplit(employeeIds: string[], date: string, departmentId: string | null): Promise<Map<string, CarriedSplit>> {
        const out = new Map<string, CarriedSplit>();
        if (!employeeIds.length) return out;
        const days = carryDaysOf(await TaskDatabaseService.getCarryForward(departmentId));
        if (days <= 0) return out;
        const dayStart = new Date(`${date}T00:00:00+05:30`).toISOString();
        const [today, earlier] = await Promise.all([
            supabaseAdmin.from('task_assignments').select('*').eq('assigned_date', date).in('employee_id', employeeIds),
            supabaseAdmin.from('task_assignments').select('*').gte('assigned_date', addDaysIso(date, -days)).lt('assigned_date', date)
                .in('employee_id', employeeIds).or(`status.neq.completed,completed_at.gte.${dayStart}`),
        ]);
        if (today.error || earlier.error) {
            console.error('[TaskProgressService] Error fetching carried-forward tasks:', today.error || earlier.error);
            throw today.error || earlier.error;
        }
        const byEmp = (rows: TaskAssignment[]) => {
            const m = new Map<string, TaskAssignment[]>();
            for (const r of rows) m.set(r.employee_id, [...(m.get(r.employee_id) || []), r]);
            return m;
        };
        const todayBy = byEmp((today.data || []) as TaskAssignment[]);
        const earlierBy = byEmp((earlier.data || []) as TaskAssignment[]);
        for (const id of employeeIds) {
            const carried = buildNumberedList(todayBy.get(id) || [], earlierBy.get(id) || [], date).filter(t => t.isCarriedForward);
            if (!carried.length) continue;
            const done = carried.filter(t => t.status === 'completed').length;
            out.set(id, { done, pending: carried.length - done });
        }
        return out;
    }

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
    static async getEmployeeProgress(employeeId: string, date?: string, opts: ProgressOptions = {}): Promise<EmployeeProgress> {
        const targetDate = date || new Date().toISOString().slice(0, 10);
        const emp = await TaskDatabaseService.getEmployeeById(employeeId);

        const tasks = (opts.to && opts.to !== targetDate) || opts.includeCarried
            ? await this.rangeAssignments([employeeId], targetDate, opts, emp?.department_id ?? null)
            : await TaskDatabaseService.getDailyAssignments({
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
    /** Tasks given in [date, opts.to], plus (includeCarried) unfinished ones from the department's carry-forward days before it. */
    private static async rangeAssignments(empIds: string[], date: string, opts: ProgressOptions, departmentId: string | null): Promise<TaskAssignment[]> {
        const to = opts.to || date;
        const days = opts.includeCarried ? carryDaysOf(await TaskDatabaseService.getCarryForward(departmentId)) : 0;
        // Read in pages of 1,000 (the database returns at most that many at once), so "All time" totals stay exact.
        const allInRange = async () => {
            const rows: TaskAssignment[] = [];
            for (let page = 0; page < 50; page++) {
                const { data, error } = await supabaseAdmin.from('task_assignments').select('*').gte('assigned_date', date).lte('assigned_date', to).in('employee_id', empIds)
                    .order('id').range(page * 1000, page * 1000 + 999);
                if (error) return { data: null, error };
                rows.push(...((data || []) as TaskAssignment[]));
                if (!data || data.length < 1000) break;
            }
            return { data: rows, error: null };
        };
        const [inRange, carried] = await Promise.all([
            allInRange(),
            days > 0
                ? supabaseAdmin.from('task_assignments').select('*').gte('assigned_date', addDaysIso(date, -Math.min(days, MAX_CARRY_DAYS))).lt('assigned_date', date).neq('status', 'completed').in('employee_id', empIds)
                : Promise.resolve({ data: [], error: null }),
        ]);
        if (inRange.error || carried.error) {
            console.error('[TaskProgressService] Error fetching range assignments:', inRange.error || carried.error);
            throw inRange.error || carried.error;
        }
        return [...((carried.data || []) as TaskAssignment[]), ...((inRange.data || []) as TaskAssignment[])];
    }

    static async getDepartmentProgress(departmentId: string, date?: string, opts: ProgressOptions = {}): Promise<DepartmentProgress> {
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
        let assignments: TaskAssignment[];
        if ((opts.to && opts.to !== targetDate) || opts.includeCarried) {
            assignments = await this.rangeAssignments(empIds, targetDate, opts, departmentId);
        } else {
            const { data: rawAssignments, error } = await supabaseAdmin
                .from('task_assignments')
                .select('*')
                .eq('assigned_date', targetDate)
                .in('employee_id', empIds);

            if (error) {
                console.error('[TaskProgressService] Error fetching department assignments:', error);
                throw error;
            }
            assignments = (rawAssignments || []) as TaskAssignment[];
        }

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
    static async getOrganisationProgress(date?: string, opts: ProgressOptions = {}): Promise<OrganisationProgress> {
        const targetDate = date || new Date().toISOString().slice(0, 10);
        const departments = await TaskDatabaseService.getDepartments();

        let orgTotal = 0;
        let orgCompleted = 0;
        let orgPending = 0;
        let orgInProgress = 0;
        let totalEmployees = 0;

        // Fetch all department progress in parallel (was N sequential round trips)
        const deptProgressList = await Promise.all(
            departments.map(dept => this.getDepartmentProgress(dept.id, targetDate, opts))
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
