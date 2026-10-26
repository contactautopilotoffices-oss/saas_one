import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    Department,
    Employee,
    EmployeeProfile,
    TaskTemplate,
    TaskAssignment,
    NumberedAssignment,
    ConversationContext,
    ContextSystem,
    TaskStatus,
    TaskType,
    EmployeeRole,
    TestingConfig,
    NotificationRule,
    NotificationTaskFilters,
    WhatsAppKillSwitches,
    CarryForwardSetting,
} from './types';

/** How many days back an unfinished task stays on a person's list. One window for every message and the bot. Since
 *  2026-10-14 each department can turn this off or shorten it (1–7 days, Notifications tab); 7 is the most and the default. */
export const CARRY_LOOKBACK_DAYS = 7;
/** Owner 2026-10-20: a department may type any number of days up to this (7 stays the default). Every query that finds
 *  carried tasks looks back this far, then each department's own setting narrows it. */
export const MAX_CARRY_DAYS = 30;
export const DEFAULT_CARRY_FORWARD: CarryForwardSetting = { enabled: true, days: CARRY_LOOKBACK_DAYS };

/** A stored or submitted setting → a safe one: on/off, and a whole number of days from 1 to MAX_CARRY_DAYS. Anything odd → the default. */
export function normalizeCarryForward(value: unknown): CarryForwardSetting {
    if (!value || typeof value !== 'object') return { ...DEFAULT_CARRY_FORWARD };
    const v = value as Record<string, unknown>;
    const days = Number(v.days);
    return {
        enabled: v.enabled !== false,
        days: Number.isInteger(days) && days >= 1 && days <= MAX_CARRY_DAYS ? days : CARRY_LOOKBACK_DAYS,
    };
}

/** How many days back to look for a department (0 = carry-forward is off). */
export const carryDaysOf = (s: CarryForwardSetting) => (s.enabled ? s.days : 0);

let carryCache: { at: number; map: Record<string, CarryForwardSetting> } | null = null;
export const resetCarryForwardCache = () => { carryCache = null; };

/** Builds the numbered list from raw rows (pure, so it can be tested without the database). See NumberedAssignment. */
/** True when the task was completed during `date` (a day in India time). */
export function isCompletedOn(t: { status?: string; completed_at?: string | null }, date: string): boolean {
    if (t.status !== 'completed' || !t.completed_at) return false;
    const at = new Date(t.completed_at).getTime();
    const start = new Date(`${date}T00:00:00+05:30`).getTime();
    return Number.isFinite(at) && at >= start && at < start + 24 * 60 * 60 * 1000;
}

/**
 * `completedOn` (owner 2026-10-16): a carried-forward task finished on THAT day stays in the list (marked done) instead of
 * dropping out, so it shows under "Completed" and every other task keeps its number for the rest of the day. Tasks
 * finished on an earlier day still drop out. Without `completedOn`: exactly the previous behaviour.
 */
export function buildNumberedList(today: TaskAssignment[], earlierOpen: TaskAssignment[], completedOn?: string): NumberedAssignment[] {
    const key = (t: TaskAssignment) => t.title.trim().toLowerCase();
    const seen = new Set(today.map(key));
    // Newest copy first, so when the same title is open on several days only the latest copy is kept.
    const newestFirst = [...earlierOpen].sort((a, b) => b.assigned_date.localeCompare(a.assigned_date) || a.created_at.localeCompare(b.created_at));
    const carried: TaskAssignment[] = [];
    for (const t of newestFirst) {
        const keepDone = !!completedOn && isCompletedOn(t, completedOn);
        if ((t.status === 'completed' && !keepDone) || seen.has(key(t))) continue;
        seen.add(key(t));
        carried.push(t);
    }
    carried.sort((a, b) => a.assigned_date.localeCompare(b.assigned_date) || a.created_at.localeCompare(b.created_at));
    const todaySorted = [...today].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return [
        ...carried.map(t => ({ ...t, isCarriedForward: true })),
        ...todaySorted.map(t => ({ ...t, isCarriedForward: false })),
    ].map((t, i) => ({ ...t, listNumber: i + 1 }));
}

const isBotAlertAdmin =(value: unknown): value is { name: string; phone: string } => {
    if (!value || typeof value !== 'object') return false;
    const recipient = value as Record<string, unknown>;
    return typeof recipient.name === 'string' && /^\+?\d{10,15}$/.test(String(recipient.phone || '').replace(/[\s()-]/g, ''));
};

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
            .eq('is_active', true)
            .is('owner_id', null); // personal fixed ("locked") tasks are not department templates

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
        status?: TaskStatus; // optional; omitted = 'pending' (unchanged for every existing caller)
    }): Promise<TaskAssignment> {
        const assignedDate = params.assignedDate || new Date().toISOString().slice(0, 10);
        const status: TaskStatus = params.status || 'pending';

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
                status,
                assigned_by: params.assignedBy || null,
                ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {})
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

    /**
     * A person's numbered list for `date`: open tasks from the last CARRY_LOOKBACK_DAYS days first (oldest first), then all of
     * today's tasks. The bot and every scheduled message number tasks from THIS list, so "done 1" means the same task everywhere.
     */
    /**
     * Flexible "look up tasks" (docs/TASK_LOOKUP_PLAN.md, 2026-10-13): ONE read-only, parameterised select — no raw SQL.
     * Every value comes from code-checked filters (people already permission-filtered by the caller); search words are plain
     * letters / digits / spaces / hyphens only. At most 500 rows.
     */
    static async searchAssignments(q: {
        employeeIds: string[]; assignedBy?: string | null; from: string; to: string; dateField: 'assigned' | 'finished';
        statuses?: TaskStatus[] | null; assignedBefore?: string | null; assignedOnOrBefore?: string | null;
        kind?: 'any' | 'fixed' | 'one_off'; words?: string[]; newestFirst?: boolean; limit?: number;
    }): Promise<TaskAssignment[]> {
        if (!q.employeeIds.length) return [];
        let query = supabaseAdmin
            .from('task_assignments')
            .select('id, title, employee_id, assigned_date, status, assigned_by, completed_at, task_template_id, created_at')
            .in('employee_id', q.employeeIds.slice(0, 500));
        if (q.dateField === 'finished') {
            // "finished yesterday" = completed during that India day.
            query = query.gte('completed_at', `${q.from}T00:00:00+05:30`).lte('completed_at', `${q.to}T23:59:59.999+05:30`);
        } else {
            query = query.gte('assigned_date', q.from).lte('assigned_date', q.to);
        }
        if (q.statuses?.length) query = query.in('status', q.statuses);
        if (q.assignedBy) query = query.eq('assigned_by', q.assignedBy);
        if (q.assignedBefore) query = query.lt('assigned_date', q.assignedBefore);
        if (q.assignedOnOrBefore) query = query.lte('assigned_date', q.assignedOnOrBefore);
        if (q.kind === 'fixed') query = query.not('task_template_id', 'is', null);
        if (q.kind === 'one_off') query = query.is('task_template_id', null);
        for (const w of (q.words ?? []).slice(0, 5)) {
            const safe = String(w).toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().slice(0, 30);
            if (safe) query = query.or(`title.ilike."%${safe}%",description.ilike."%${safe}%"`);
        }
        const { data, error } = await query
            .order(q.dateField === 'finished' ? 'completed_at' : 'assigned_date', { ascending: !q.newestFirst })
            .limit(Math.min(q.limit ?? 500, 500));
        if (error) {
            console.error('[TaskDatabaseService] Error searching assignments:', error);
            throw error;
        }
        return (data || []) as TaskAssignment[];
    }

    /** The department's carry-forward setting (cached 30 s). No department or no saved setting → on, 7 days. */
    static async getCarryForward(departmentId: string | null | undefined): Promise<CarryForwardSetting> {
        if (!departmentId) return { ...DEFAULT_CARRY_FORWARD };
        if (!carryCache || Date.now() - carryCache.at > 30_000) {
            try { carryCache = { at: Date.now(), map: (await this.getTestingConfig()).carryForward || {} }; }
            catch { return { ...DEFAULT_CARRY_FORWARD }; }
        }
        return normalizeCarryForward(carryCache.map[departmentId]);
    }

    static async saveCarryForward(departmentId: string, value: unknown): Promise<CarryForwardSetting> {
        const setting = normalizeCarryForward(value);
        const existing = (await this.getTestingConfig()).carryForward || {};
        await this.saveTestingConfig({ carryForward: { ...existing, [departmentId]: setting } });
        carryCache = null;
        return setting;
    }

    static async getNumberedList(params: { employeeId: string; date?: string; departmentId?: string | null }): Promise<NumberedAssignment[]> {
        const targetDate = params.date || new Date().toISOString().slice(0, 10);
        // The person's department decides how far back unfinished tasks are carried (one setting, so every list matches).
        const departmentId = params.departmentId !== undefined ? params.departmentId : (await this.getEmployeeById(params.employeeId))?.department_id ?? null;
        const carryDays = carryDaysOf(await this.getCarryForward(departmentId));
        const start = new Date(`${targetDate}T12:00:00Z`);
        start.setUTCDate(start.getUTCDate() - carryDays);

        const [today, earlier] = await Promise.all([
            supabaseAdmin.from('task_assignments').select('*, template:task_templates(*)')
                .eq('employee_id', params.employeeId).eq('assigned_date', targetDate),
            carryDays > 0
                ? supabaseAdmin.from('task_assignments').select('*, template:task_templates(*)')
                    .eq('employee_id', params.employeeId).gte('assigned_date', start.toISOString().slice(0, 10)).lt('assigned_date', targetDate)
                    // still open, or finished since the start of this day (India time) — those stay listed as done (2026-10-16)
                    .or(`status.neq.completed,completed_at.gte.${new Date(`${targetDate}T00:00:00+05:30`).toISOString()}`)
                : Promise.resolve({ data: [], error: null }),
        ]);
        if (today.error || earlier.error) {
            console.error('[TaskDatabaseService] Error fetching numbered task list:', today.error || earlier.error);
            throw today.error || earlier.error;
        }
        return buildNumberedList((today.data || []) as TaskAssignment[], (earlier.data || []) as TaskAssignment[], targetDate);
    }

    /**
     * What one scheduled message shows: a part of the numbered list (getNumberedList), keeping each task's number.
     * `lookbackDays` is no longer used: every message carries tasks from the same window, so the numbers always match.
     */
    static async getFilteredAssignments(params: {
        employeeId: string;
        date?: string; // YYYY-MM-DD
        filters?: NotificationTaskFilters;
        departmentId?: string | null;
    }): Promise<NumberedAssignment[]> {
        const filters = params.filters || {
            includeTodayFixed: true,
            includeTodayAssigned: true,
            includeYesterdayPending: false
        };
        const list = await this.getNumberedList({ employeeId: params.employeeId, date: params.date, departmentId: params.departmentId });
        return list.filter(t => {
            if (t.isCarriedForward) return Boolean(filters.includeYesterdayPending);
            const isFixed = Boolean(t.task_template_id);
            if (isFixed && filters.includeTodayFixed === false) return false;
            if (!isFixed && filters.includeTodayAssigned === false) return false;
            if (filters.onlyPending && t.status === 'completed') return false;
            return true;
        });
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
        eventType?: string;
        event_type?: string;
        actorId?: string | null;
        actor_id?: string | null;
        targetEmployeeId?: string | null;
        target_employee_id?: string | null;
        taskId?: string | null;
        task_id?: string | null;
        details?: Record<string, any>;
    }): Promise<void> {
        try {
            const eventType = params.eventType || params.event_type || 'unknown';
            const actorId = params.actorId || params.actor_id || null;
            const targetEmployeeId = params.targetEmployeeId || params.target_employee_id || null;
            const taskId = params.taskId || params.task_id || null;
            const { error: insErr } = await supabaseAdmin.from('task_audit_logs').insert({
                event_type: eventType,
                actor_id: actorId,
                target_employee_id: targetEmployeeId,
                task_id: taskId,
                details: params.details || {}
            });

            if (insErr) {
                // Fallback if FK constraint on users(id) failed
                if (insErr.code === '23503' || insErr.message?.includes('foreign key')) {
                    await supabaseAdmin.from('task_audit_logs').insert({
                        event_type: eventType,
                        actor_id: null,
                        target_employee_id: null,
                        task_id: null,
                        details: {
                            ...(params.details || {}),
                            fallbackReason: 'FK constraint bypassed',
                            attemptedActorId: actorId,
                            attemptedTargetEmployeeId: targetEmployeeId,
                        }
                    });
                } else {
                    console.warn('[TaskDatabaseService] Non-blocking audit log insert error:', insErr.message);
                }
            }
        } catch (err) {
            console.warn('[TaskDatabaseService] Non-blocking audit log failure:', err);
        }
    }

    static async getAuditLogs(params: {
        eventType?: string;
        eventTypes?: string[];
        limit?: number;
    } = {}): Promise<any[]> {
        let query = supabaseAdmin
            .from('task_audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(params.limit || 50);

        if (params.eventTypes && params.eventTypes.length > 0) {
            query = query.in('event_type', params.eventTypes);
        } else if (params.eventType && params.eventType !== 'all') {
            if (params.eventType.includes(',')) {
                query = query.in('event_type', params.eventType.split(',').map(s => s.trim()));
            } else {
                query = query.eq('event_type', params.eventType);
            }
        }

        const { data, error } = await query;
        if (error) {
            console.error('[TaskDatabaseService] Error fetching audit logs:', error);
            return [];
        }
        return data || [];
    }

    static async clearAuditLogs(eventType?: string): Promise<void> {
        try {
            let query = supabaseAdmin.from('task_audit_logs').delete();
            if (eventType && eventType !== 'all') {
                query = query.eq('event_type', eventType);
            } else {
                query = query.neq('id', '00000000-0000-0000-0000-000000000000');
            }
            await query;
        } catch (err) {
            console.warn('[TaskDatabaseService] Error clearing audit logs:', err);
        }
    }

    // ── Testing Whitelist & Cron Schedule Config ────────────────────────────
    static getDefaultNotificationRules(legacyTiming?: string): NotificationRule[] {
        return [
            {
                id: 'rule_morning_digest',
                name: 'Morning Task Kickoff',
                enabled: true,
                targetTimeIST: legacyTiming || '09:00',
                daysOfWeek: [1, 2, 3, 4, 5, 6], // Mon-Sat
                ruleType: 'morning_digest',
                taskFilters: {
                    includeTodayFixed: true,
                    includeTodayAssigned: true,
                    includeYesterdayPending: true,
                    lookbackDays: 1,
                    onlyPending: false
                },
                conditions: {
                    skipIfZeroTasks: false,
                    requirePendingOnly: false
                },
                recipients: {
                    target: 'tech_all',
                    notifyReportingManager: true
                },
                lastRunDate: null,
                lastRunSummary: null
            },
            {
                id: 'rule_pending_reminder',
                name: 'Midday Progress Check-in',
                enabled: false, // Paused by default for Phase 1 safety
                targetTimeIST: '14:30',
                daysOfWeek: [1, 2, 3, 4, 5, 6],
                ruleType: 'pending_reminder',
                taskFilters: {
                    includeTodayFixed: true,
                    includeTodayAssigned: true,
                    includeYesterdayPending: true,
                    lookbackDays: 1,
                    onlyPending: true // Focus on incomplete tasks
                },
                conditions: {
                    skipIfZeroTasks: true,
                    requirePendingOnly: true // Skip if all finished
                },
                recipients: {
                    target: 'tech_all',
                    notifyReportingManager: false
                },
                lastRunDate: null,
                lastRunSummary: null
            },
            {
                id: 'rule_eod_summary',
                name: 'Evening Wrap-up & Overdue Alert',
                enabled: false, // Paused by default for Phase 1 safety
                targetTimeIST: '18:30',
                daysOfWeek: [1, 2, 3, 4, 5, 6],
                ruleType: 'eod_summary',
                taskFilters: {
                    includeTodayFixed: true,
                    includeTodayAssigned: true,
                    includeYesterdayPending: true,
                    lookbackDays: 3,
                    onlyPending: false
                },
                conditions: {
                    skipIfZeroTasks: true,
                    requirePendingOnly: false
                },
                recipients: {
                    target: 'tech_all',
                    notifyReportingManager: true
                },
                lastRunDate: null,
                lastRunSummary: null
            }
        ];
    }

    static getDefaultKillSwitches(): WhatsAppKillSwitches {
        return {
            globalHalt: false,
            haltReason: null,
            haltedAt: null,
            haltedBy: null,
            departmentHalt: {},
            messageTypeHalt: {
                morning_digest: false,
                pending_reminder: false,
                eod_summary: false,
                overdue_alert: false,
                manager_kickoff: false,
                employee_kickoff: false,
            },
        };
    }

    static async getTestingConfig(): Promise<TestingConfig> {
        const { data } = await supabaseAdmin
            .from('conversation_context')
            .select('context_data')
            .eq('phone_number', 'TEST_CONFIG')
            .eq('system', 'TASK_MANAGER')
            .maybeSingle();

        const raw = (data?.context_data as any) || {};
        const rules = Array.isArray(raw.rules) && raw.rules.length > 0
            ? raw.rules
            : this.getDefaultNotificationRules(raw.cronTiming);

        const defaultSwitches = this.getDefaultKillSwitches();
        const killSwitches: WhatsAppKillSwitches = {
            ...defaultSwitches,
            ...(raw.killSwitches || {}),
            departmentHalt: {
                ...(defaultSwitches.departmentHalt || {}),
                ...(raw.killSwitches?.departmentHalt || {}),
            },
            messageTypeHalt: {
                ...(defaultSwitches.messageTypeHalt || {}),
                ...(raw.killSwitches?.messageTypeHalt || {}),
            },
        };

        return {
            enabled: Boolean(raw.enabled),
            manager: raw.manager,
            notifyManager: raw.notifyManager,
            employees: (Array.isArray(raw.employees) && raw.employees.length > 0)
                ? raw.employees
                : [{ name: 'Sahil Gorde', phone: '8433649199' }],
            cronTiming: raw.cronTiming || '09:00',
            cronEnabled: raw.cronEnabled !== undefined ? Boolean(raw.cronEnabled) : true,
            cronLastRunDate: raw.cronLastRunDate || null,
            cronLastRunSummary: raw.cronLastRunSummary || null,
            rules,
            killSwitches,
            whatsappPretendMode: raw.whatsappPretendMode !== false,
            nlGatewayEnabled: raw.nlGatewayEnabled === true,
            neverSilentEnabled: raw.neverSilentEnabled === true,
            conversationMemoryEnabled: raw.conversationMemoryEnabled === true,
            frontDoorEnabled: raw.frontDoorEnabled === true,
            teamReportsEnabled: raw.teamReportsEnabled === true,
            learningLoopEnabled: raw.learningLoopEnabled === true,
            promptVersionsEnabled: raw.promptVersionsEnabled === true,
            nightlyAutoTuneEnabled: raw.nightlyAutoTuneEnabled === true,
            voiceNotesEnabled: raw.voiceNotesEnabled === true,
            botAlertAdmins: Array.isArray(raw.botAlertAdmins) ? raw.botAlertAdmins.filter(isBotAlertAdmin).slice(0, 10) : [],
            carryForward: raw.carryForward && typeof raw.carryForward === 'object' && !Array.isArray(raw.carryForward)
                ? Object.fromEntries(Object.entries(raw.carryForward).map(([k, v]) => [k, normalizeCarryForward(v)]))
                : {},
        };
    }

    /**
     * Strict reader used ONLY by the WhatsApp send gate.
     * Unlike getTestingConfig(), a database error is thrown (never swallowed), so the gate can fail closed.
     * Pretend Mode is ON unless it was explicitly switched off.
     */
    static async getSendControls(): Promise<{ killSwitches: WhatsAppKillSwitches; pretendMode: boolean; botFeatures: Record<import('./BotSwitches').BotSwitch, boolean>; botAlertAdmins: Array<{ name: string; phone: string }> }> {
        const { data, error } = await supabaseAdmin
            .from('conversation_context')
            .select('context_data')
            .eq('phone_number', 'TEST_CONFIG')
            .eq('system', 'TASK_MANAGER')
            .maybeSingle();

        if (error) throw error;

        const raw = (data?.context_data as any) || {};
        const defaults = this.getDefaultKillSwitches();
        return {
            killSwitches: {
                ...defaults,
                ...(raw.killSwitches || {}),
                departmentHalt: {
                    ...(defaults.departmentHalt || {}),
                    ...(raw.killSwitches?.departmentHalt || {}),
                },
                messageTypeHalt: {
                    ...(defaults.messageTypeHalt || {}),
                    ...(raw.killSwitches?.messageTypeHalt || {}),
                },
            },
            pretendMode: raw.whatsappPretendMode !== false,
            botFeatures: { neverSilent: raw.neverSilentEnabled === true, conversationMemory: raw.conversationMemoryEnabled === true, frontDoor: raw.frontDoorEnabled === true, teamReports: raw.teamReportsEnabled === true, learningLoop: raw.learningLoopEnabled === true, promptVersions: raw.promptVersionsEnabled === true, nightlyAutoTune: raw.nightlyAutoTuneEnabled === true, voiceNotes: raw.voiceNotesEnabled === true },
            botAlertAdmins: Array.isArray(raw.botAlertAdmins) ? raw.botAlertAdmins.filter(isBotAlertAdmin).slice(0, 10) : [],
        };
    }

    /** WhatsApp bot upgrades (docs/WHATSAPP_BOT_PRODUCTION_PLAN.md): flipped from the Task Access panel, no redeploy needed. */
    static async setBotFeature(feature: import('./BotSwitches').BotSwitch, enabled: boolean, actor?: string): Promise<TestingConfig> {
        const fields: Record<import('./BotSwitches').BotSwitch, keyof TestingConfig> = { neverSilent: 'neverSilentEnabled', conversationMemory: 'conversationMemoryEnabled', frontDoor: 'frontDoorEnabled', teamReports: 'teamReportsEnabled', learningLoop: 'learningLoopEnabled', promptVersions: 'promptVersionsEnabled', nightlyAutoTune: 'nightlyAutoTuneEnabled', voiceNotes: 'voiceNotesEnabled' };
        const updated = await this.saveTestingConfig({ [fields[feature]]: enabled });
        await this.logAudit({
            event_type: 'bot_feature_updated',
            details: { feature, enabled, actor: actor || null },
        });
        return updated;
    }

    static async setNaturalLanguageGateway(enabled: boolean, actor?: string): Promise<TestingConfig> {
        const updated = await this.saveTestingConfig({ nlGatewayEnabled: enabled });
        await this.logAudit({
            event_type: 'nl_gateway_updated',
            details: { nlGatewayEnabled: enabled, actor: actor || null },
        });
        return updated;
    }

    static async setPretendMode(enabled: boolean, actor?: string): Promise<TestingConfig> {
        const updated = await this.saveTestingConfig({ whatsappPretendMode: enabled });
        await this.logAudit({
            event_type: 'pretend_mode_updated',
            actor_id: null,
            target_employee_id: null,
            task_id: null,
            details: { pretendMode: enabled, actor: actor || null },
        });
        return updated;
    }

    static async saveTestingConfig(config: Partial<TestingConfig>): Promise<TestingConfig> {
        const existing = await this.getTestingConfig();
        const merged: TestingConfig = {
            ...existing,
            ...config,
            killSwitches: config.killSwitches !== undefined ? {
                ...existing.killSwitches,
                ...config.killSwitches,
                departmentHalt: {
                    ...(existing.killSwitches?.departmentHalt || {}),
                    ...(config.killSwitches?.departmentHalt || {}),
                },
                messageTypeHalt: {
                    ...(existing.killSwitches?.messageTypeHalt || {}),
                    ...(config.killSwitches?.messageTypeHalt || {}),
                },
            } : existing.killSwitches,
        };

        // Sync legacy cronTiming with rule_morning_digest
        if (config.cronTiming && merged.rules) {
            merged.rules = merged.rules.map(r => {
                if (r.id === 'rule_morning_digest') {
                    return { ...r, targetTimeIST: config.cronTiming! };
                }
                return r;
            });
        }

        // Sync legacy cronLastRunDate reset with rule_morning_digest
        if (config.cronLastRunDate === null && merged.rules) {
            merged.rules = merged.rules.map(r => {
                if (r.id === 'rule_morning_digest') {
                    return { ...r, lastRunDate: null, lastRunSummary: null };
                }
                return r;
            });
        }

        const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        await supabaseAdmin
            .from('conversation_context')
            .upsert({
                phone_number: 'TEST_CONFIG',
                system: 'TASK_MANAGER',
                context_type: 'TEST_WHITELIST',
                context_data: merged,
                expires_at: expiresAt,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'phone_number,system'
            });

        return merged;
    }

    static async updateNotificationRule(ruleId: string, updates: Partial<NotificationRule>): Promise<TestingConfig> {
        const config = await this.getTestingConfig();
        const existingRules = config.rules || this.getDefaultNotificationRules();
        const updatedRules = existingRules.map(rule => {
            if (rule.id === ruleId) {
                return { ...rule, ...updates };
            }
            return rule;
        });

        // If ruleId didn't exist and updates has an id, append it
        if (!existingRules.some(r => r.id === ruleId) && updates.id) {
            updatedRules.push(updates as NotificationRule);
        }

        return this.saveTestingConfig({ rules: updatedRules });
    }

    static async resetNotificationRuleRun(ruleId: string): Promise<TestingConfig> {
        return this.updateNotificationRule(ruleId, {
            lastRunDate: null,
            lastRunSummary: null
        });
    }

    static async deleteNotificationRule(ruleId: string): Promise<TestingConfig> {
        const config = await this.getTestingConfig();
        const existingRules = config.rules || this.getDefaultNotificationRules();
        const updatedRules = existingRules.filter(r => r.id !== ruleId);
        return this.saveTestingConfig({ rules: updatedRules });
    }

    // ── Phase 2: Kill Switch Safety Methods ──────────────────────────────
    static async getKillSwitches(): Promise<WhatsAppKillSwitches> {
        const config = await this.getTestingConfig();
        return config.killSwitches || this.getDefaultKillSwitches();
    }

    static async updateKillSwitches(updates: Partial<WhatsAppKillSwitches>): Promise<WhatsAppKillSwitches> {
        const current = await this.getKillSwitches();
        const merged: WhatsAppKillSwitches = {
            ...current,
            ...updates,
            departmentHalt: {
                ...(current.departmentHalt || {}),
                ...(updates.departmentHalt || {}),
            },
            messageTypeHalt: {
                ...(current.messageTypeHalt || {}),
                ...(updates.messageTypeHalt || {}),
            },
        };

        if (updates.globalHalt !== undefined) {
            merged.globalHalt = Boolean(updates.globalHalt);
            if (merged.globalHalt) {
                merged.haltedAt = new Date().toISOString();
            } else {
                merged.haltedAt = null;
                merged.haltReason = null;
            }
        }

        await this.saveTestingConfig({ killSwitches: merged });

        // Record audit trail event for safety tracking
        await this.logAudit({
            event_type: 'kill_switch_updated',
            actor_id: null,
            target_employee_id: null,
            task_id: null,
            details: {
                globalHalt: merged.globalHalt,
                haltReason: merged.haltReason,
                departmentHalt: merged.departmentHalt,
                messageTypeHalt: merged.messageTypeHalt,
            },
        }).catch(err => {
            console.warn('[TaskDatabaseService] Failed to record kill_switch_updated audit log:', err?.message);
        });

        return merged;
    }

    static async toggleGlobalKillSwitch(halt: boolean, reason?: string, actor?: string): Promise<WhatsAppKillSwitches> {
        return this.updateKillSwitches({
            globalHalt: halt,
            haltReason: reason || (halt ? 'Emergency WhatsApp halt engaged by admin' : null),
            haltedBy: actor || null,
        });
    }

    static async toggleDepartmentKillSwitch(departmentId: string, halt: boolean): Promise<WhatsAppKillSwitches> {
        const current = await this.getKillSwitches();
        const departmentHalt = { ...(current.departmentHalt || {}) };
        departmentHalt[departmentId] = halt;
        return this.updateKillSwitches({ departmentHalt });
    }

    static async toggleMessageTypeKillSwitch(messageType: string, halt: boolean): Promise<WhatsAppKillSwitches> {
        const current = await this.getKillSwitches();
        const messageTypeHalt = { ...(current.messageTypeHalt || {}) };
        (messageTypeHalt as any)[messageType] = halt;
        return this.updateKillSwitches({ messageTypeHalt });
    }

    // ── Phase 4: Employee Department Transfer ────────────────────────────────
    static async transferEmployeeDepartment(params: {
        employeeId: string;
        targetDepartmentId: string;
        actorId?: string;
        keepRole?: boolean;
    }): Promise<{ success: boolean; employee: any }> {
        const { employeeId, targetDepartmentId, actorId, keepRole } = params;

        const { data: targetDept, error: deptErr } = await supabaseAdmin
            .from('departments')
            .select('*')
            .eq('id', targetDepartmentId)
            .single();

        if (deptErr || !targetDept) {
            throw new Error('Target department not found');
        }

        const { data: profile, error: empErr } = await supabaseAdmin
            .from('employee_profiles')
            .select('*')
            .or(`id.eq.${employeeId},user_id.eq.${employeeId}`)
            .single();

        if (empErr || !profile) {
            throw new Error('Employee profile not found');
        }

        const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || profile.email;
        const oldDeptId = profile.department_id;
        const oldDeptName = profile.department;
        const newRole = keepRole ? profile.task_role : 'employee';

        const { data: updatedEmp, error: updateErr } = await supabaseAdmin
            .from('employee_profiles')
            .update({
                department_id: targetDept.id,
                department: targetDept.name,
                task_role: newRole,
                updated_at: new Date().toISOString()
            })
            .eq('id', profile.id)
            .select('*')
            .single();

        if (updateErr) throw updateErr;

        await this.logAudit({
            eventType: 'employee_transferred',
            actorId: actorId || profile.user_id || null,
            targetEmployeeId: profile.user_id || null,
            details: {
                employeeName: fullName,
                fromDepartmentId: oldDeptId,
                fromDepartment: oldDeptName,
                toDepartmentId: targetDept.id,
                toDepartment: targetDept.name,
                previousRole: profile.task_role,
                newRole
            }
        });

        return { success: true, employee: updatedEmp };
    }
}
