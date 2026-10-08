import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { PermissionService, PermissionDeniedError } from '@/task-manager/PermissionService';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';
import { TaskMessagingService } from '@/task-manager/TaskMessagingService';
import { TaskAccessService } from '@/task-manager/TaskAccessService';
import { requireActor } from '../_shared/adminGuard';
import { TaskAssignment } from '@/task-manager/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const auth = await requireActor(searchParams.get('actorId'));
        if (!auth.ok) return auth.response;
        const actorId = auth.userId; // always the logged-in person
        const departmentId = searchParams.get('departmentId') || '';
        const employeeId = searchParams.get('employeeId') || '';
        const status = searchParams.get('status') || '';
        const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);

        if (!actorId) {
            return NextResponse.json({ success: false, error: 'Missing actorId parameter' }, { status: 400 });
        }

        // 1. Resolve and validate actor
        const actor = await PermissionService.getActor(actorId);

        // 2. Resolve accessible departments
        let accessibleDepartments = await TaskDatabaseService.getDepartments();
        let targetDepartmentId = departmentId;

        if (actor.role === 'reporting_manager') {
            if (!actor.department_id) {
                return NextResponse.json({
                    success: false,
                    error: 'Reporting manager is not assigned to a department'
                }, { status: 403 });
            }
            // Force manager to their own department
            accessibleDepartments = accessibleDepartments.filter(d => d.id === actor.department_id);
            targetDepartmentId = actor.department_id;
        } else if (actor.role === 'employee') {
            // Employee only sees their own assigned tasks
            accessibleDepartments = accessibleDepartments.filter(d => d.id === actor.department_id);
        }

        // 3. Resolve accessible employees
        let employees = await TaskDatabaseService.getAllEmployees();

        if (actor.role === 'reporting_manager') {
            employees = employees.filter(e => e.department_id === actor.department_id);
        } else if (actor.role === 'employee') {
            employees = employees.filter(e => e.id === actor.id);
        } else if (targetDepartmentId) {
            employees = employees.filter(e => e.department_id === targetDepartmentId);
        }

        // 4. Query Task Assignments with filters
        let taskQuery = supabaseAdmin
            .from('task_assignments')
            .select(`
                *,
                template:task_templates(*),
                employee:users!task_assignments_employee_id_fkey(id, full_name, phone)
            `)
            .eq('assigned_date', date)
            .order('created_at', { ascending: false });

        if (actor.role === 'employee') {
            taskQuery = taskQuery.eq('employee_id', actor.id);
        } else if (employeeId) {
            taskQuery = taskQuery.eq('employee_id', employeeId);
        } else if (actor.role === 'reporting_manager') {
            const allowedUserIds = employees.map(e => e.id);
            if (allowedUserIds.length > 0) {
                taskQuery = taskQuery.in('employee_id', allowedUserIds);
            } else {
                taskQuery = taskQuery.eq('employee_id', actor.id); // fallback
            }
        } else if (targetDepartmentId) {
            const deptUserIds = employees.map(e => e.id);
            if (deptUserIds.length > 0) {
                taskQuery = taskQuery.in('employee_id', deptUserIds);
            } else {
                taskQuery = taskQuery.eq('employee_id', '00000000-0000-0000-0000-000000000000');
            }
        }

        if (status && ['pending', 'in_progress', 'completed'].includes(status)) {
            taskQuery = taskQuery.eq('status', status);
        }

        const { data: rawTasks, error: taskErr } = await taskQuery.limit(100);
        if (taskErr) throw taskErr;

        // 5. Query Templates for accessible department
        const templateDeptId = actor.role === 'reporting_manager' ? actor.department_id : targetDepartmentId || undefined;
        const templates = await TaskDatabaseService.listTaskTemplates({
            departmentId: templateDeptId || undefined
        });

        return NextResponse.json({
            success: true,
            actor,
            departments: accessibleDepartments,
            employees,
            tasks: rawTasks || [],
            templates,
            date
        });
    } catch (err: any) {
        if (err instanceof PermissionDeniedError) {
            return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 403 });
        }
        console.error('[TaskManagerAPI] GET tasks error:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const auth = await requireActor(body.actorId);
        if (!auth.ok) return auth.response;
        const { action } = body;
        const actorId = auth.userId; // always the logged-in person

        if (!actorId) {
            return NextResponse.json({ success: false, error: 'Missing actorId in request body' }, { status: 400 });
        }

        // ── Action 1: Create and Assign Task ──────────────────────────────────
        if (action === 'assign_task') {
            const { targetEmployeeId, title, description, assignedDate, templateId } = body;

            if (!targetEmployeeId || !title) {
                return NextResponse.json({
                    success: false,
                    error: 'Missing targetEmployeeId or title'
                }, { status: 400 });
            }

            // Enforce RBAC: Manager can only assign in own department, Superuser anywhere, Employee blocked
            const { actor, target } = await PermissionService.assertCanAssignTask(actorId, targetEmployeeId);

            // Access gate (Step 3): the person being assigned must be unlocked (department ON + kickoff sent).
            const targetAccess = await TaskAccessService.check({ userId: target.id, departmentId: target.department_id });
            if (!targetAccess.allowed) {
                return NextResponse.json({
                    success: false,
                    code: 'TASK_MANAGER_LOCKED',
                    reason: targetAccess.reason,
                    error: `Cannot assign a task to ${target.name}: ${targetAccess.message}`
                }, { status: 409 });
            }

            const newTask = await TaskDatabaseService.createTaskAssignment({
                employeeId: target.id,
                title: title.trim(),
                description: description?.trim() || null,
                taskTemplateId: templateId || undefined,
                assignedDate: assignedDate || new Date().toISOString().slice(0, 10),
                assignedBy: actor.id
            });

            await TaskDatabaseService.logAudit({
                eventType: 'task_assigned',
                actorId: actor.id,
                targetEmployeeId: target.id,
                taskId: newTask.id,
                details: { title: newTask.title, assignedDate: newTask.assigned_date }
            });

            // Send instant WhatsApp notification to the assigned employee (non-blocking)
            if (target.phone_number && target.phone_number.trim().length >= 10) {
                const managerDept = actor.department_name ? ` (${actor.department_name})` : '';
                const lines = [
                    `🔔 *New Task Assigned!*`,
                    ``,
                    `*Task:* ${newTask.title}`,
                ];
                if (newTask.description) {
                    lines.push(`*Details:* ${newTask.description}`);
                }
                lines.push(`*Assigned By:* ${actor.name}${managerDept}`);
                if (newTask.assigned_date) {
                    lines.push(`*Date:* ${newTask.assigned_date}`);
                }
                lines.push(``);
                lines.push(`Reply *tasks* to view your full list, or *done <number>* once completed!`);

                const messageText = lines.join('\n');
                TaskMessagingService.sendMessage(target.phone_number, messageText).catch(err => {
                    console.error('[AssignTask] Failed to send instant WhatsApp alert:', err);
                });
            }

            return NextResponse.json({ success: true, task: newTask });
        }

        // ── Action 2: Create Reusable Task Template ───────────────────────────
        if (action === 'create_template') {
            const { title, description, departmentId, taskType } = body;

            if (!title) {
                return NextResponse.json({ success: false, error: 'Template title is required' }, { status: 400 });
            }

            const actor = await PermissionService.getActor(actorId);
            let targetDeptId = departmentId;

            if (actor.role === 'reporting_manager') {
                targetDeptId = actor.department_id; // locked to own dept
            } else if (actor.role === 'employee') {
                throw new PermissionDeniedError('CREATE_TEMPLATE', actorId, 'Employees cannot create task templates.');
            }

            const template = await TaskDatabaseService.createTaskTemplate({
                title: title.trim(),
                description: description?.trim() || null,
                departmentId: targetDeptId || undefined,
                createdBy: actor.id,
                taskType: taskType || 'fixed'
            });

            await TaskDatabaseService.logAudit({
                eventType: 'template_created',
                actorId: actor.id,
                details: { title: template.title, departmentId: template.department_id, taskType: template.task_type }
            });

            return NextResponse.json({ success: true, template });
        }

        // ── Action 3: Update Task Status (e.g. Complete) ──────────────────────
        if (action === 'update_status') {
            const { taskId, status } = body;

            if (!taskId || !status) {
                return NextResponse.json({ success: false, error: 'Missing taskId or status' }, { status: 400 });
            }

            // Retrieve assignment
            const { data: taskRow, error: fetchErr } = await supabaseAdmin
                .from('task_assignments')
                .select('*')
                .eq('id', taskId)
                .maybeSingle();

            if (fetchErr || !taskRow) {
                return NextResponse.json({ success: false, error: 'Task assignment not found' }, { status: 404 });
            }

            // Enforce RBAC
            await PermissionService.assertCanCompleteTask(actorId, taskRow as TaskAssignment);

            const updated = await TaskDatabaseService.updateAssignmentStatus({
                assignmentId: taskId,
                status
            });

            await TaskDatabaseService.logAudit({
                eventType: status === 'completed' ? 'task_completed' : 'task_status_updated',
                actorId,
                targetEmployeeId: updated.employee_id,
                taskId: updated.id,
                details: { newStatus: status }
            });

            return NextResponse.json({ success: true, task: updated });
        }

        // ── Action 4: Delete Task Assignment ──────────────────────────────────
        if (action === 'delete_task') {
            const { taskId } = body;

            if (!taskId) {
                return NextResponse.json({ success: false, error: 'Missing taskId' }, { status: 400 });
            }

            // Retrieve assignment
            const { data: taskRow, error: fetchErr } = await supabaseAdmin
                .from('task_assignments')
                .select('*')
                .eq('id', taskId)
                .maybeSingle();

            if (fetchErr || !taskRow) {
                return NextResponse.json({ success: false, error: 'Task assignment not found' }, { status: 404 });
            }

            // Enforce RBAC: Manager can only delete in own dept or tasks assigned by them, Superuser anywhere
            const actor = await PermissionService.getActor(actorId);
            if (actor.role !== 'superuser') {
                if (actor.role === 'reporting_manager') {
                    const isAssigner = taskRow.assigned_by === actorId;
                    const targetEmp = await TaskDatabaseService.getEmployeeById(taskRow.employee_id);
                    const isSameDept = Boolean(actor.department_id && targetEmp?.department_id === actor.department_id);
                    if (!isAssigner && !isSameDept) {
                        return NextResponse.json({ success: false, error: 'Cannot delete tasks outside your department' }, { status: 403 });
                    }
                } else {
                    return NextResponse.json({ success: false, error: 'Only reporting managers and admins can delete tasks' }, { status: 403 });
                }
            }

            const { error: delErr } = await supabaseAdmin
                .from('task_assignments')
                .delete()
                .eq('id', taskId);

            if (delErr) throw delErr;

            await TaskDatabaseService.logAudit({
                eventType: 'task_deleted',
                actorId,
                targetEmployeeId: taskRow.employee_id,
                taskId,
                details: { title: taskRow.title }
            });

            return NextResponse.json({ success: true, message: 'Task deleted successfully' });
        }

        return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    } catch (err: any) {
        if (err instanceof PermissionDeniedError) {
            return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 403 });
        }
        console.error('[TaskManagerAPI] POST error:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
