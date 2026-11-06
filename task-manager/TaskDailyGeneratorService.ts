import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskAccessService } from './TaskAccessService';
import { Employee, TaskAssignment, TaskTemplate } from './types';

export interface DailyTaskGenerationOptions {
    date?: string; // YYYY-MM-DD (defaults to current date)
    departmentId?: string; // Optional: filter to single department
    employeeId?: string; // Optional: filter to single employee
}

export interface DailyTaskGenerationResult {
    success: boolean;
    date: string;
    templatesProcessed: number;
    employeesTargeted: number;
    tasksGenerated: number;
    tasksAlreadyExisting: number;
    assignments: TaskAssignment[];
    errors?: string[];
}

export interface PersonalFixedResult {
    date: string;
    templatesProcessed: number;
    tasksGenerated: number;
    skipped: number;
    errors: string[];
}

const PERSONAL_CARRY_DAYS = 14;

export class TaskDailyGeneratorService {
    /**
     * Personal fixed ("locked") tasks: each one comes back for ITS OWNER on its days (Monday to Saturday by default).
     * Idempotent, and never throws. Skips a task when the owner already has it today, or still has an unfinished copy from
     * a recent day (that one is carried forward already, so a second card would be a duplicate).
     */
    static async generatePersonalFixedTasks(options: { date?: string; employeeId?: string } = {}): Promise<PersonalFixedResult> {
        const date = options.date || new Date().toISOString().slice(0, 10);
        const result: PersonalFixedResult = { date, templatesProcessed: 0, tasksGenerated: 0, skipped: 0, errors: [] };
        try {
            let query = supabaseAdmin.from('task_templates').select('*').eq('task_type', 'fixed').eq('is_active', true).not('owner_id', 'is', null);
            if (options.employeeId) query = query.eq('owner_id', options.employeeId);
            const { data, error } = await query;
            if (error) throw error;

            const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday ... 6 = Saturday
            const templates = ((data || []) as TaskTemplate[]).filter(t => (t.days_of_week && t.days_of_week.length ? t.days_of_week : [1, 2, 3, 4, 5, 6]).includes(weekday));
            result.templatesProcessed = templates.length;
            if (templates.length === 0) return result;

            const owners: Employee[] = [];
            for (const id of Array.from(new Set(templates.map(t => t.owner_id as string)))) {
                const emp = await TaskDatabaseService.getEmployeeById(id);
                if (emp && emp.active) owners.push(emp);
            }
            const allowed = new Set((await TaskAccessService.partition(owners)).allowed.map(e => e.id));

            const since = new Date(`${date}T12:00:00Z`);
            since.setUTCDate(since.getUTCDate() - PERSONAL_CARRY_DAYS);
            const ids = templates.map(t => t.id);
            const [today, open] = await Promise.all([
                supabaseAdmin.from('task_assignments').select('employee_id, task_template_id').eq('assigned_date', date).in('task_template_id', ids),
                supabaseAdmin.from('task_assignments').select('employee_id, task_template_id').in('task_template_id', ids)
                    .lt('assigned_date', date).gte('assigned_date', since.toISOString().slice(0, 10)).neq('status', 'completed'),
            ]);
            if (today.error) throw today.error;
            if (open.error) throw open.error;
            const haveToday = new Set((today.data || []).map(r => `${r.employee_id}:${r.task_template_id}`));
            const haveOpen = new Set((open.data || []).map(r => `${r.employee_id}:${r.task_template_id}`));

            for (const tpl of templates) {
                const key = `${tpl.owner_id}:${tpl.id}`;
                if (!allowed.has(tpl.owner_id as string) || haveToday.has(key) || haveOpen.has(key)) { result.skipped++; continue; }
                const { error: insError } = await supabaseAdmin.from('task_assignments').insert({
                    task_template_id: tpl.id,
                    title: tpl.title.trim(),
                    description: tpl.description?.trim() || null,
                    employee_id: tpl.owner_id,
                    assigned_date: date,
                    status: 'pending',
                    assigned_by: tpl.owner_id,
                });
                if (!insError) result.tasksGenerated++;
                else if (insError.code === '23505') result.skipped++; // a parallel run got there first
                else result.errors.push(insError.message);
            }
        } catch (err: any) {
            console.error('[TaskDailyGenerator] Personal fixed generation error:', err);
            result.errors.push(err?.message || 'Personal fixed generation failed');
        }
        return result;
    }

    /**
     * Generates daily fixed tasks for active employees in an idempotent manner.
     * Guaranteed to never create duplicate assignments for the same template, employee, and date.
     */
    static async generateDailyFixedTasks(options: DailyTaskGenerationOptions = {}): Promise<DailyTaskGenerationResult> {
        const targetDate = options.date || new Date().toISOString().slice(0, 10);
        const errors: string[] = [];

        try {
            // 1. Fetch active fixed templates
            const templateQuery = supabaseAdmin
                .from('task_templates')
                .select('*')
                .eq('task_type', 'fixed')
                .eq('is_active', true)
                .is('owner_id', null); // personal fixed tasks are created by generatePersonalFixedTasks, only for their owner

            if (options.departmentId) {
                // Fixed tasks for this specific department OR org-wide (department_id IS NULL)
                templateQuery.or(`department_id.eq.${options.departmentId},department_id.is.null`);
            }

            const { data: rawTemplates, error: tplError } = await templateQuery;
            if (tplError) {
                console.error('[TaskDailyGenerator] Error fetching templates:', tplError);
                throw tplError;
            }

            const templates = (rawTemplates || []) as TaskTemplate[];
            if (templates.length === 0) {
                return {
                    success: true,
                    date: targetDate,
                    templatesProcessed: 0,
                    employeesTargeted: 0,
                    tasksGenerated: 0,
                    tasksAlreadyExisting: 0,
                    assignments: []
                };
            }

            // 2. Fetch targeted active employees
            let employees: Employee[] = [];
            if (options.employeeId) {
                const emp = await TaskDatabaseService.getEmployeeById(options.employeeId);
                if (emp && emp.active) {
                    employees = [emp];
                }
            } else if (options.departmentId) {
                employees = await TaskDatabaseService.getEmployeesByDepartment(options.departmentId);
            } else {
                employees = await TaskDatabaseService.getAllEmployees();
            }

            // Step 6: nobody who is locked out of the Task Manager gets tasks generated for them
            employees = (await TaskAccessService.partition(employees)).allowed;

            if (employees.length === 0) {
                return {
                    success: true,
                    date: targetDate,
                    templatesProcessed: templates.length,
                    employeesTargeted: 0,
                    tasksGenerated: 0,
                    tasksAlreadyExisting: 0,
                    assignments: []
                };
            }

            // 3. Query existing assignments for this date to ensure idempotency
            const empIds = employees.map(e => e.id);
            const { data: existingRows, error: existError } = await supabaseAdmin
                .from('task_assignments')
                .select('id, employee_id, task_template_id')
                .eq('assigned_date', targetDate)
                .in('employee_id', empIds);

            if (existError) {
                console.error('[TaskDailyGenerator] Error querying existing assignments:', existError);
                throw existError;
            }

            const existingAssignmentKeys = new Set(
                (existingRows || []).map(r => `${r.employee_id}:${r.task_template_id}`)
            );

            // 4. Build assignments that need to be generated
            const newAssignmentsPayload: Array<{
                task_template_id: string;
                title: string;
                description: string | null;
                employee_id: string;
                assigned_date: string;
                status: 'pending';
                assigned_by: string | null;
            }> = [];

            let alreadyExistingCount = 0;

            for (const emp of employees) {
                for (const tpl of templates) {
                    // Match department: null applies to all; otherwise must match employee department
                    if (tpl.department_id && tpl.department_id !== emp.department_id) {
                        continue;
                    }

                    const key = `${emp.id}:${tpl.id}`;
                    if (existingAssignmentKeys.has(key)) {
                        alreadyExistingCount++;
                        continue;
                    }

                    newAssignmentsPayload.push({
                        task_template_id: tpl.id,
                        title: tpl.title.trim(),
                        description: tpl.description?.trim() || null,
                        employee_id: emp.id,
                        assigned_date: targetDate,
                        status: 'pending',
                        assigned_by: tpl.created_by || null
                    });
                }
            }

            // 5. Batch insert newly created assignments
            const createdAssignments: TaskAssignment[] = [];

            if (newAssignmentsPayload.length > 0) {
                // Insert in chunks of 50 to avoid potential payload size limits
                const CHUNK_SIZE = 50;
                for (let i = 0; i < newAssignmentsPayload.length; i += CHUNK_SIZE) {
                    const chunk = newAssignmentsPayload.slice(i, i + CHUNK_SIZE);
                    const { data: inserted, error: insError } = await supabaseAdmin
                        .from('task_assignments')
                        .insert(chunk)
                        .select('*');

                    if (insError) {
                        // In case of parallel execution conflict (unique key 23505), handle gracefully
                        if (insError.code === '23505') {
                            console.warn('[TaskDailyGenerator] Duplicate key hit during insert, handled gracefully.');
                            alreadyExistingCount += chunk.length;
                        } else {
                            console.error('[TaskDailyGenerator] Insert error:', insError);
                            errors.push(insError.message);
                        }
                    } else if (inserted) {
                        createdAssignments.push(...(inserted as TaskAssignment[]));
                    }
                }
            }

            return {
                success: errors.length === 0,
                date: targetDate,
                templatesProcessed: templates.length,
                employeesTargeted: employees.length,
                tasksGenerated: createdAssignments.length,
                tasksAlreadyExisting: alreadyExistingCount,
                assignments: createdAssignments,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (err: any) {
            console.error('[TaskDailyGenerator] Fatal generation error:', err);
            return {
                success: false,
                date: targetDate,
                templatesProcessed: 0,
                employeesTargeted: 0,
                tasksGenerated: 0,
                tasksAlreadyExisting: 0,
                assignments: [],
                errors: [err.message || 'Fatal generation error']
            };
        }
    }
}
