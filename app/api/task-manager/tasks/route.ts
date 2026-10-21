import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { PermissionService, PermissionDeniedError } from '@/task-manager/PermissionService';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';
import { personLabel, sendTaskAssigned } from '@/task-manager/taskAlerts';
import { notifyGiversOfCompletion } from '@/task-manager/completionNotice';
import { TaskAccessService } from '@/task-manager/TaskAccessService';
import { requireActor } from '../_shared/adminGuard';
import { TaskAssignment } from '@/task-manager/types';
import { MAX_CARRY_DAYS, carryDaysOf } from '@/task-manager/TaskDatabaseService';
import { addDaysIso, parseRange } from '@/task-manager/dateRange';

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
        // Owner 2026-10-15: a date RANGE (from / to, at most 31 days); the old single `date` still works.
        const range = parseRange(searchParams);
        if (!range.ok) return NextResponse.json({ success: false, error: range.error }, { status: 400 });
        const { from, to } = range;
        const date = from;

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

        // 4. Query Task Assignments with filters (the same people for the range and for carry-forward)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase query builder type is not exported
        const scoped = (q: any) => {
            if (actor.role === 'employee') return q.eq('employee_id', actor.id);
            if (employeeId) return q.eq('employee_id', employeeId);
            if (actor.role === 'reporting_manager') {
                const allowedUserIds = employees.map(e => e.id);
                return allowedUserIds.length > 0 ? q.in('employee_id', allowedUserIds) : q.eq('employee_id', actor.id); // fallback
            }
            if (targetDepartmentId) {
                const deptUserIds = employees.map(e => e.id);
                return deptUserIds.length > 0 ? q.in('employee_id', deptUserIds) : q.eq('employee_id', '00000000-0000-0000-0000-000000000000');
            }
            return q;
        };
        const select = `
                *,
                template:task_templates(*),
                employee:users!task_assignments_employee_id_fkey(id, full_name, phone)
            `;
        let taskQuery = scoped(supabaseAdmin.from('task_assignments').select(select).gte('assigned_date', from).lte('assigned_date', to))
            .order('assigned_date', { ascending: false }).order('created_at', { ascending: false });
        if (status && ['pending', 'in_progress', 'completed'].includes(status)) {
            taskQuery = taskQuery.eq('status', status);
        }

        // Owner 2026-10-15: unfinished tasks from BEFORE the range are shown too ("carry forward"), as far back as each
        // person's department setting allows (Notifications tab, 1–30 days, or off). Never for the "Done" filter.
        const carryQuery = status === 'completed' ? null
            : scoped(supabaseAdmin.from('task_assignments').select(select).gte('assigned_date', addDaysIso(from, -MAX_CARRY_DAYS)).lt('assigned_date', from).neq('status', 'completed'))
                .order('assigned_date', { ascending: true }).limit(300);

        const [{ data: rawTasks, error: taskErr }, carried] = await Promise.all([taskQuery.limit(500), carryQuery ?? Promise.resolve({ data: [], error: null })]);
        if (taskErr) throw taskErr;
        if (carried.error) throw carried.error;
        const deptOf = new Map((await TaskDatabaseService.getAllEmployees()).map(e => [e.id, e.department_id ?? null]));
        const daysByDept = new Map<string | null, number>();
        const carryDays = async (dept: string | null) => {
            if (!daysByDept.has(dept)) daysByDept.set(dept, carryDaysOf(await TaskDatabaseService.getCarryForward(dept)));
            return daysByDept.get(dept)!;
        };
        const carriedTasks: Array<TaskAssignment & { is_carried_forward: true }> = [];
        for (const t of (carried.data || []) as TaskAssignment[]) {
            const days = await carryDays(deptOf.get(t.employee_id) ?? null);
            if (days > 0 && t.assigned_date >= addDaysIso(from, -days)) carriedTasks.push({ ...t, is_carried_forward: true });
        }

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
            tasks: [...carriedTasks, ...(rawTasks || [])],
            // Owner 2026-10-15: everyone the actor may assign to (a superuser: every department), for the Assign window's
            // department filter. The list above stays filtered to the chosen department.
            assignableEmployees: actor.role === 'superuser' ? await TaskDatabaseService.getAllEmployees() : employees,
            templates,
            date,
            from,
            to,
            // "All time" or a busy range: only the newest 500 are listed (the screen says so).
            truncated: (rawTasks || []).length >= 500
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
            // Same approved template as the Tasks tab (task_assigned_v1), so it also reaches people outside the 24-hour window.
            if (target.id !== actor.id) {
                void import('@/task-manager/taskBell').then(({ taskBell }) => taskBell({ userId: target.id, kind: 'TASK_ASSIGNED', title: `New task from ${actor.name}`, message: `${actor.name} gave you: ${newTask.title}`, departmentName: target.department_name }));
            }
            void sendTaskAssigned(target.phone_number, {
                titles: [newTask.title], fromLabel: personLabel(actor.name, actor.department_name),
                date: newTask.assigned_date || new Date().toISOString().slice(0, 10), departmentId: target.department_id || undefined,
            });

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

            // Tell whoever gave the task (approved template, every completion; never fails the request).
            if (status === 'completed' && (taskRow as TaskAssignment).status !== 'completed') void notifyGiversOfCompletion([taskRow as TaskAssignment]);

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
