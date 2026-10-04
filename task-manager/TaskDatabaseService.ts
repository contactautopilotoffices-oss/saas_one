import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    Department,
    Employee,
    EmployeeProfile,
    TaskTemplate,
    TaskAssignment,
    ConversationContext,
    ContextSystem,
    TaskStatus,
    TaskType,
    EmployeeRole,
} from './types';

function mapProfileToEmployee(profile: any): Employee {
    const fullName = profile.first_name && profile.last_name
        ? `${profile.first_name} ${profile.last_name}`.trim()
        : profile.user?.full_name || profile.first_name || 'Employee';

    return {
        id: profile.user_id,
        profile_id: profile.id,
        name: fullName,
        phone_number: profile.phone || profile.user?.phone || '',
        department_id: profile.department_id || profile.department_ref?.id || null,
        department_name: profile.department || profile.department_ref?.name || null,
        role: (profile.task_role || 'employee') as EmployeeRole,
        reporting_manager_id: profile.reporting_manager_id || null,
        active: profile.is_active ?? true,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
    };
}

export class TaskDatabaseService {
    // ── Departments ───────────────────────────────────────────────────────────
    static async getDepartments(): Promise<Department[]> {
        const { data, error } = await supabaseAdmin
            .from('departments')
            .select('*')
            .eq('is_active', true)
            .order('name', { ascending: true });

        if (error) {
            console.error('[TaskDatabaseService] Error fetching departments:', error);
            throw error;
        }
        return (data || []) as Department[];
    }

    static async getDepartmentById(id: string): Promise<Department | null> {
        const { data, error } = await supabaseAdmin
            .from('departments')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            console.error('[TaskDatabaseService] Error fetching department by id:', error);
            return null;
        }
        return data as Department | null;
    }

    static async getDepartmentByName(name: string): Promise<Department | null> {
        const { data, error } = await supabaseAdmin
            .from('departments')
            .select('*')
            .ilike('name', name.trim())
            .maybeSingle();

        if (error) {
            console.error('[TaskDatabaseService] Error fetching department by name:', error);
            return null;
        }
        return data as Department | null;
    }

    // ── Employees (Using employee_profiles directly) ───────────────────────────
    static async getEmployeeById(userId: string): Promise<Employee | null> {
        const { data, error } = await supabaseAdmin
            .from('employee_profiles')
            .select(`
                *,
                user:users!employee_profiles_user_id_fkey(id, full_name, phone, is_master_admin),
                department_ref:departments(*)
            `)
            .or(`user_id.eq.${userId},id.eq.${userId}`)
            .maybeSingle();

        if (error) {
            console.error('[TaskDatabaseService] Error fetching employee by id:', error);
            return null;
        }
        if (!data) return null;
        return mapProfileToEmployee(data);
    }

    static async getEmployeeByPhone(phone: string): Promise<Employee | null> {
        const digits = phone.replace(/\D/g, '');
        const last10 = digits.slice(-10);

        const { data, error } = await supabaseAdmin
            .from('employee_profiles')
            .select(`
                *,
                user:users!employee_profiles_user_id_fkey(id, full_name, phone, is_master_admin),
                department_ref:departments(*)
            `)
            .or(`phone.eq.${digits},phone.ilike.%${last10}`)
            .eq('is_active', true)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (error) {
            console.error('[TaskDatabaseService] Error fetching employee by phone:', error);
            return null;
        }
        if (!data || data.length === 0) return null;
        return mapProfileToEmployee(data[0]);
    }

    static async getEmployeesByDepartment(departmentId: string): Promise<Employee[]> {
        const { data, error } = await supabaseAdmin
            .from('employee_profiles')
            .select(`
                *,
                user:users!employee_profiles_user_id_fkey(id, full_name, phone, is_master_admin),
                department_ref:departments(*)
            `)
            .eq('department_id', departmentId)
            .eq('is_active', true)
            .not('user_id', 'is', null)
            .order('first_name', { ascending: true });

        if (error) {
            console.error('[TaskDatabaseService] Error fetching department employees:', error);
            throw error;
        }

        const seen = new Set<string>();
        const uniqueEmployees: Employee[] = [];
        for (const item of data || []) {
            const emp = mapProfileToEmployee(item);
            if (emp.id && !seen.has(emp.id)) {
                seen.add(emp.id);
                uniqueEmployees.push(emp);
            }
        }
        return uniqueEmployees;
    }

    static async getAllEmployees(): Promise<Employee[]> {
        const { data, error } = await supabaseAdmin
            .from('employee_profiles')
            .select(`
                *,
                user:users!employee_profiles_user_id_fkey(id, full_name, phone, is_master_admin),
                department_ref:departments(*)
            `)
            .eq('is_active', true)
            .not('user_id', 'is', null)
            .order('first_name', { ascending: true });

        if (error) {
            console.error('[TaskDatabaseService] Error fetching all employees:', error);
            throw error;
        }

        const seen = new Set<string>();
        const uniqueEmployees: Employee[] = [];
        for (const item of data || []) {
            const emp = mapProfileToEmployee(item);
            if (emp.id && !seen.has(emp.id)) {
                seen.add(emp.id);
                uniqueEmployees.push(emp);
            }
        }
        return uniqueEmployees;
    }

    // ── Task Templates ────────────────────────────────────────────────────────
    static async createTaskTemplate(params: {
        title: string;
        description?: string;
        departmentId?: string;
        createdBy?: string;
        taskType?: TaskType;
    }): Promise<TaskTemplate> {
        const { data, error } = await supabaseAdmin
            .from('task_templates')
            .insert({
                title: params.title.trim(),
                description: params.description?.trim() || null,
                department_id: params.departmentId || null,
                created_by: params.createdBy || null,
                task_type: params.taskType || 'fixed',
                is_active: true
            })
            .select('*')
            .single();

        if (error || !data) {
            console.error('[TaskDatabaseService] Error creating task template:', error);
            throw error || new Error('Failed to create task template');
        }
        return data as TaskTemplate;
    }

    static async listTaskTemplates(params?: {
        departmentId?: string;
        taskType?: TaskType;
    }): Promise<TaskTemplate[]> {
        let query = supabaseAdmin
            .from('task_templates')
            .select(`
                *,
                department:departments(*)
            `)
            .eq('is_active', true);

        if (params?.departmentId) {
            query = query.eq('department_id', params.departmentId);
        }
        if (params?.taskType) {
            query = query.eq('task_type', params.taskType);
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) {
            console.error('[TaskDatabaseService] Error listing task templates:', error);
            throw error;
        }
        return (data || []) as TaskTemplate[];
    }

    // ── Task Assignments ──────────────────────────────────────────────────────
    static async createTaskAssignment(params: {
        employeeId: string;
        title: string;
        description?: string;
        taskTemplateId?: string;
        assignedDate?: string; // YYYY-MM-DD
        assignedBy?: string;
    }): Promise<TaskAssignment> {
        const assignedDate = params.assignedDate || new Date().toISOString().slice(0, 10);

        // Idempotency: Check if an assignment already exists for this template, employee, and date
        if (params.taskTemplateId) {
            const { data: existing } = await supabaseAdmin
                .from('task_assignments')
                .select('*')
                .eq('employee_id', params.employeeId)
                .eq('task_template_id', params.taskTemplateId)
                .eq('assigned_date', assignedDate)
                .maybeSingle();

            if (existing) {
                return existing as TaskAssignment;
            }
        }

        const { data, error } = await supabaseAdmin
            .from('task_assignments')
            .insert({
                employee_id: params.employeeId,
                title: params.title.trim(),
                description: params.description?.trim() || null,
                task_template_id: params.taskTemplateId || null,
                assigned_date: assignedDate,
                status: 'pending',
                assigned_by: params.assignedBy || null
            })
            .select('*')
            .single();

        if (error || !data) {
            // If duplicate key error occurs due to concurrent execution, fetch existing
            if (error?.code === '23505' && params.taskTemplateId) {
                const { data: existing } = await supabaseAdmin
                    .from('task_assignments')
                    .select('*')
                    .eq('employee_id', params.employeeId)
                    .eq('task_template_id', params.taskTemplateId)
                    .eq('assigned_date', assignedDate)
                    .maybeSingle();

                if (existing) return existing as TaskAssignment;
            }

            console.error('[TaskDatabaseService] Error creating task assignment:', error);
            throw error || new Error('Failed to create task assignment');
        }
        return data as TaskAssignment;
    }

    static async getDailyAssignments(params: {
        employeeId: string;
        date?: string; // YYYY-MM-DD
        status?: TaskStatus;
    }): Promise<TaskAssignment[]> {
        const date = params.date || new Date().toISOString().slice(0, 10);

        let query = supabaseAdmin
            .from('task_assignments')
            .select(`
                *,
                template:task_templates(*)
            `)
            .eq('employee_id', params.employeeId)
            .eq('assigned_date', date);

        if (params.status) {
            query = query.eq('status', params.status);
        }

        const { data, error } = await query.order('created_at', { ascending: true });
        if (error) {
            console.error('[TaskDatabaseService] Error fetching daily assignments:', error);
            throw error;
        }
        return (data || []) as TaskAssignment[];
    }

    static async updateAssignmentStatus(params: {
        assignmentId: string;
        status: TaskStatus;
    }): Promise<TaskAssignment> {
        const completedAt = params.status === 'completed' ? new Date().toISOString() : null;

        const { data, error } = await supabaseAdmin
            .from('task_assignments')
            .update({
                status: params.status,
                completed_at: completedAt,
                updated_at: new Date().toISOString()
            })
            .eq('id', params.assignmentId)
            .select('*')
            .single();

        if (error || !data) {
            console.error('[TaskDatabaseService] Error updating assignment status:', error);
            throw error || new Error('Failed to update task assignment');
        }
        return data as TaskAssignment;
    }

    // ── Conversation Context (Dual-System Isolation) ──────────────────────────
    static async getConversationContext(phone: string, system: ContextSystem): Promise<ConversationContext | null> {
        const cleanPhone = phone.replace(/\D/g, '');
        const now = new Date().toISOString();

        const { data, error } = await supabaseAdmin
            .from('conversation_context')
            .select('*')
            .eq('phone_number', cleanPhone)
            .eq('system', system)
            .gt('expires_at', now)
            .maybeSingle();

        if (error) {
            console.error('[TaskDatabaseService] Error getting conversation context:', error);
            return null;
        }
        return data as ConversationContext | null;
    }

    static async setConversationContext(params: {
        phone: string;
        system: ContextSystem;
        contextType?: string;
        contextData?: Record<string, any>;
        ttlMinutes?: number;
    }): Promise<ConversationContext> {
        const cleanPhone = params.phone.replace(/\D/g, '');
        const ttlMinutes = params.ttlMinutes || 30;
        const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

        const { data, error } = await supabaseAdmin
            .from('conversation_context')
            .upsert({
                phone_number: cleanPhone,
                system: params.system,
                context_type: params.contextType || 'ACTIVE',
                context_data: params.contextData || {},
                expires_at: expiresAt,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'phone_number,system'
            })
            .select('*')
            .single();

        if (error || !data) {
            console.error('[TaskDatabaseService] Error setting conversation context:', error);
            throw error || new Error('Failed to set conversation context');
        }
        return data as ConversationContext;
    }

    static async clearConversationContext(phone: string, system?: ContextSystem): Promise<void> {
        const cleanPhone = phone.replace(/\D/g, '');
        let query = supabaseAdmin.from('conversation_context').delete().eq('phone_number', cleanPhone);
        if (system) {
            query = query.eq('system', system);
        }
        await query;
    }

    // ── Audit Logging (Phase 17 Foundation) ──────────────────────────────────
    static async logAudit(params: {
        eventType: string;
        actorId?: string;
        targetEmployeeId?: string;
        taskId?: string;
        details?: Record<string, any>;
    }): Promise<void> {
        try {
            await supabaseAdmin.from('task_audit_logs').insert({
                event_type: params.eventType,
                actor_id: params.actorId || null,
                target_employee_id: params.targetEmployeeId || null,
                task_id: params.taskId || null,
                details: params.details || {}
            });
        } catch (err) {
            console.warn('[TaskDatabaseService] Non-blocking audit log failure:', err);
        }
    }

    // ── Testing Whitelist Config ──────────────────────────────────────────────
    static async getTestingConfig(): Promise<{
        enabled: boolean;
        manager?: { name: string; phone: string };
        notifyManager?: boolean;
        employees?: Array<{ name: string; phone: string }>;
    }> {
        const { data } = await supabaseAdmin
            .from('conversation_context')
            .select('context_data')
            .eq('phone_number', 'TEST_CONFIG')
            .eq('system', 'TASK_MANAGER')
            .maybeSingle();

        return (data?.context_data as any) || { enabled: false, employees: [] };
    }

    static async saveTestingConfig(config: {
        enabled: boolean;
        manager?: { name: string; phone: string };
        notifyManager?: boolean;
        employees?: Array<{ name: string; phone: string }>;
    }): Promise<void> {
        const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        await supabaseAdmin
            .from('conversation_context')
            .upsert({
                phone_number: 'TEST_CONFIG',
                system: 'TASK_MANAGER',
                context_type: 'TEST_WHITELIST',
                context_data: config,
                expires_at: expiresAt,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'phone_number,system'
            });
    }
}
