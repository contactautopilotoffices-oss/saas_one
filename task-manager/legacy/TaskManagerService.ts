import { supabaseAdmin } from '@/backend/lib/supabase/admin';

export interface TaskItem {
    id: string;
    organization_id: string | null;
    employee_id: string;
    assigned_by: string | null;
    department: string | null;
    title: string;
    description: string | null;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    progress_percentage: number;
    due_date: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TaskProgressUpdate {
    id: string;
    task_id: string;
    user_id: string;
    update_text: string;
    progress_percentage: number | null;
    status: string | null;
    created_at: string;
}

export interface DailyReport {
    id: string;
    organization_id: string | null;
    user_id: string;
    report_date: string;
    summary: string;
    tasks_completed: any;
    blockers: string | null;
    created_at: string;
    updated_at: string;
}

export class TaskManagerService {
    /**
     * Resolves the primary organization and department for a given user.
     */
    static async getUserOrgAndDepartment(userId: string): Promise<{ orgId: string | null; department: string | null }> {
        const [empRes, orgRes] = await Promise.all([
            supabaseAdmin
                .from('employee_profiles')
                .select('organization_id, department')
                .eq('user_id', userId)
                .maybeSingle(),
            supabaseAdmin
                .from('organization_memberships')
                .select('organization_id')
                .eq('user_id', userId)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle()
        ]);

        const orgId = empRes.data?.organization_id || orgRes.data?.organization_id || process.env.NEXT_PUBLIC_AUTOPILOT_ORG_ID || null;
        const department = empRes.data?.department || 'General';

        return { orgId, department };
    }

    /**
     * Create a new task.
     */
    static async createTask(params: {
        userId: string;
        title: string;
        description?: string;
        priority?: 'low' | 'medium' | 'high' | 'urgent';
        assignedBy?: string;
        department?: string;
        dueDate?: string;
        orgId?: string;
    }): Promise<TaskItem> {
        const { orgId, department } = await this.getUserOrgAndDepartment(params.userId);

        const { data: task, error } = await supabaseAdmin
            .from('tm_tasks')
            .insert({
                organization_id: params.orgId || orgId,
                employee_id: params.userId,
                assigned_by: params.assignedBy || params.userId,
                department: params.department || department,
                title: params.title.trim(),
                description: params.description?.trim() || null,
                priority: params.priority || 'medium',
                status: 'pending',
                progress_percentage: 0,
                due_date: params.dueDate || null,
            })
            .select('*')
            .single();

        if (error || !task) {
            console.error('[TaskManagerService] Failed to create task:', error);
            throw new Error(error?.message || 'Failed to create task');
        }

        // Add initial history update
        await supabaseAdmin
            .from('tm_task_updates')
            .insert({
                task_id: task.id,
                user_id: params.userId,
                update_text: 'Task created',
                progress_percentage: 0,
                status: 'pending'
            });

        return task as TaskItem;
    }

    /**
     * List tasks assigned to a specific user.
     */
    static async listTasks(params: {
        userId: string;
        statusFilter?: 'pending' | 'in_progress' | 'completed' | 'all' | 'active';
        limit?: number;
    }): Promise<TaskItem[]> {
        let query = supabaseAdmin
            .from('tm_tasks')
            .select('*')
            .eq('employee_id', params.userId);

        const filter = params.statusFilter || 'active';
        if (filter === 'active') {
            query = query.in('status', ['pending', 'in_progress', 'blocked']);
        } else if (filter === 'pending') {
            query = query.eq('status', 'pending');
        } else if (filter === 'in_progress') {
            query = query.eq('status', 'in_progress');
        } else if (filter === 'completed') {
            query = query.eq('status', 'completed');
        }

        query = query.order('created_at', { ascending: false }).limit(params.limit || 15);

        const { data, error } = await query;
        if (error) {
            console.error('[TaskManagerService] Failed to list tasks:', error);
            throw error;
        }

        return (data || []) as TaskItem[];
    }

    /**
     * Find a task by its UUID or friendly 1-based index from the active list.
     */
    static async resolveTask(userId: string, taskRef: string): Promise<TaskItem | null> {
        const trimmed = taskRef.replace(/^#/, '').trim();

        // 1. If it's a numeric index (e.g. "1", "2"), look up in the user's active tasks list
        if (/^\d+$/.test(trimmed)) {
            const index = parseInt(trimmed, 10);
            if (index > 0) {
                const activeTasks = await this.listTasks({ userId, statusFilter: 'all', limit: 30 });
                if (index <= activeTasks.length) {
                    return activeTasks[index - 1];
                }
            }
        }

        // 2. If it's a valid UUID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
        if (isUuid) {
            const { data } = await supabaseAdmin
                .from('tm_tasks')
                .select('*')
                .eq('employee_id', userId)
                .eq('id', trimmed)
                .maybeSingle();

            if (data) return data as TaskItem;
        }

        // 3. Fallback: match by title keyword (strip leading articles)
        const cleanKeyword = trimmed.replace(/^(the|my|task|task on)\s+/i, '').trim();
        const { data: matched } = await supabaseAdmin
            .from('tm_tasks')
            .select('*')
            .eq('employee_id', userId)
            .ilike('title', `%${cleanKeyword}%`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (matched) return matched as TaskItem;

        // 4. Try matching individual significant words (> 3 chars)
        const words = cleanKeyword.split(/\s+/).filter(w => w.length > 3);
        for (const word of words) {
            const { data: wordMatch } = await supabaseAdmin
                .from('tm_tasks')
                .select('*')
                .eq('employee_id', userId)
                .ilike('title', `%${word}%`)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (wordMatch) return wordMatch as TaskItem;
        }

        return null;
    }

    /**
     * Update progress of a task.
     */
    static async updateTaskProgress(params: {
        taskId: string;
        userId: string;
        progress: number;
        remark?: string;
    }): Promise<TaskItem> {
        const clampedProgress = Math.max(0, Math.min(100, Math.round(params.progress)));
        const newStatus = clampedProgress >= 100 ? 'completed' : clampedProgress > 0 ? 'in_progress' : 'pending';
        const completedAt = clampedProgress >= 100 ? new Date().toISOString() : null;

        const { data: updated, error } = await supabaseAdmin
            .from('tm_tasks')
            .update({
                progress_percentage: clampedProgress,
                status: newStatus,
                completed_at: completedAt,
            })
            .eq('id', params.taskId)
            .select('*')
            .single();

        if (error || !updated) {
            console.error('[TaskManagerService] Failed to update task progress:', error);
            throw new Error(error?.message || 'Failed to update task');
        }

        // Record history update
        await supabaseAdmin
            .from('tm_task_updates')
            .insert({
                task_id: params.taskId,
                user_id: params.userId,
                update_text: params.remark?.trim() || `Progress updated to ${clampedProgress}%`,
                progress_percentage: clampedProgress,
                status: newStatus
            });

        return updated as TaskItem;
    }

    /**
     * Mark a task as completed (100%).
     */
    static async completeTask(params: {
        taskId: string;
        userId: string;
        remark?: string;
    }): Promise<TaskItem> {
        return this.updateTaskProgress({
            taskId: params.taskId,
            userId: params.userId,
            progress: 100,
            remark: params.remark || 'Marked task as completed'
        });
    }

    /**
     * Submit an End-of-Day Daily Work Report.
     */
    static async submitDailyReport(params: {
        userId: string;
        summary: string;
        blockers?: string;
        tasksCompleted?: string[];
        orgId?: string;
    }): Promise<DailyReport> {
        const { orgId } = await this.getUserOrgAndDepartment(params.userId);
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        const { data: report, error } = await supabaseAdmin
            .from('tm_daily_reports')
            .upsert({
                organization_id: params.orgId || orgId,
                user_id: params.userId,
                report_date: today,
                summary: params.summary.trim(),
                blockers: params.blockers?.trim() || null,
                tasks_completed: params.tasksCompleted || [],
            }, {
                onConflict: 'user_id,report_date'
            })
            .select('*')
            .single();

        if (error || !report) {
            console.error('[TaskManagerService] Failed to submit daily report:', error);
            throw new Error(error?.message || 'Failed to submit daily report');
        }

        return report as DailyReport;
    }

    /**
     * Get enrolled Task Manager member by phone number.
     */
    static async getMemberByPhone(phone: string): Promise<{
        id: string;
        user_id: string;
        phone: string;
        full_name: string;
        department: string;
        is_superuser: boolean;
        is_active: boolean;
    } | null> {
        const last10 = phone.replace(/\D/g, '').slice(-10);

        try {
            const { data, error } = await supabaseAdmin
                .from('tm_members')
                .select('*')
                .or(`phone.eq.${phone},phone.ilike.%${last10}`)
                .eq('is_active', true)
                .maybeSingle();

            if (!error && data) {
                return data;
            }
        } catch (err) {
            console.warn('[TaskManagerService] tm_members table check:', err);
        }

        return null;
    }

    /**
     * Co-Founder / Superuser: Get department progress summary.
     */
    static async getDepartmentProgress(department: string): Promise<{
        department: string;
        totalTasks: number;
        completedTasks: number;
        inProgressTasks: number;
        pendingTasks: number;
        tasks: TaskItem[];
        dailyReports: DailyReport[];
    }> {
        const cleanDept = department.trim();

        // 1. Fetch tasks for this department
        const { data: tasks } = await supabaseAdmin
            .from('tm_tasks')
            .select('*')
            .ilike('department', `%${cleanDept}%`)
            .order('updated_at', { ascending: false })
            .limit(20);

        const allTasks = (tasks || []) as TaskItem[];
        const completed = allTasks.filter(t => t.status === 'completed').length;
        const inProgress = allTasks.filter(t => t.status === 'in_progress').length;
        const pending = allTasks.filter(t => t.status === 'pending').length;

        // 2. Fetch today's daily reports
        const today = new Date().toISOString().slice(0, 10);
        const { data: reports } = await supabaseAdmin
            .from('tm_daily_reports')
            .select('*')
            .eq('report_date', today)
            .limit(10);

        return {
            department: cleanDept,
            totalTasks: allTasks.length,
            completedTasks: completed,
            inProgressTasks: inProgress,
            pendingTasks: pending,
            tasks: allTasks,
            dailyReports: (reports || []) as DailyReport[],
        };
    }

    /**
     * Co-Founder / Superuser: Get employee progress and active deliverables.
     */
    static async getEmployeeProgress(employeeQuery: string): Promise<{
        employeeName: string;
        userId: string;
        department: string;
        activeTasks: TaskItem[];
        latestReport: DailyReport | null;
    } | null> {
        const cleanQuery = employeeQuery.trim();

        // Lookup in tm_members or users
        const { data: member } = await supabaseAdmin
            .from('tm_members')
            .select('user_id, full_name, department')
            .ilike('full_name', `%${cleanQuery}%`)
            .limit(1)
            .maybeSingle();

        let userId = member?.user_id;
        let fullName = member?.full_name;
        let department = member?.department || 'General';

        if (!userId) {
            const { data: user } = await supabaseAdmin
                .from('users')
                .select('id, full_name')
                .ilike('full_name', `%${cleanQuery}%`)
                .limit(1)
                .maybeSingle();

            if (!user) return null;
            userId = user.id;
            fullName = user.full_name;
        }

        const [tasksRes, reportRes] = await Promise.all([
            supabaseAdmin
                .from('tm_tasks')
                .select('*')
                .eq('employee_id', userId)
                .in('status', ['pending', 'in_progress', 'blocked'])
                .order('created_at', { ascending: false }),
            supabaseAdmin
                .from('tm_daily_reports')
                .select('*')
                .eq('user_id', userId)
                .order('report_date', { ascending: false })
                .limit(1)
                .maybeSingle()
        ]);

        return {
            employeeName: fullName || cleanQuery,
            userId,
            department,
            activeTasks: (tasksRes.data || []) as TaskItem[],
            latestReport: (reportRes.data || null) as DailyReport | null
        };
    }

    /**
     * Co-Founder / Superuser: Find who has not submitted their daily report today.
     */
    static async getMissingDailyReports(): Promise<Array<{
        name: string;
        department: string;
        phone: string;
    }>> {
        const today = new Date().toISOString().slice(0, 10);

        // Fetch active members
        const { data: members } = await supabaseAdmin
            .from('tm_members')
            .select('user_id, full_name, department, phone')
            .eq('is_active', true);

        if (!members || members.length === 0) return [];

        // Fetch today's reports
        const { data: todayReports } = await supabaseAdmin
            .from('tm_daily_reports')
            .select('user_id')
            .eq('report_date', today);

        const reportedUserIds = new Set((todayReports || []).map(r => r.user_id));

        return members
            .filter(m => !reportedUserIds.has(m.user_id))
            .map(m => ({
                name: m.full_name,
                department: m.department,
                phone: m.phone
            }));
    }
}
