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

export class TaskDailyGeneratorService {
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
                .eq('is_active', true);

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
