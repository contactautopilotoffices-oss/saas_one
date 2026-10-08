import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskMessagingService } from './TaskMessagingService';
import { TaskErrorHandler } from './TaskErrorHandler';
import { TaskAccessService } from './TaskAccessService';
import { PermissionService } from './PermissionService';
import { Employee, TaskAssignment } from './types';

export interface CommandExecutionResult {
    success: boolean;
    command: 'tasks' | 'status' | 'done_single' | 'done_all' | 'cancel' | 'unknown' | 'unregistered' | 'team_status' | 'assign_task' | 'locked' | 'confirm_pending' | 'confirm_cancelled' | 'insight' | 'pick_pending';
    taskNumber?: number;
    affectedTaskId?: string;
    employee?: Employee;
    replyText: string;
    progress?: {
        total: number;
        completed: number;
        percent: number;
    };
}

export class TaskCommandHandler {
    /**
     * Executes deterministic employee WhatsApp commands.
     */
    static async handleCommand(params: {
        phone: string;
        text: string;
        sendReply?: boolean;
        date?: string;
    }): Promise<CommandExecutionResult> {
        const cleanText = params.text.trim();
        const lower = cleanText.toLowerCase();
        const targetDate = params.date || new Date().toISOString().slice(0, 10);
        const shouldSend = params.sendReply ?? true;

        // 1. Identify employee
        const employee = await TaskDatabaseService.getEmployeeByPhone(params.phone);
        if (!employee) {
            const reply = TaskErrorHandler.unregisteredPhone();
            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
            return {
                success: false,
                command: 'unregistered',
                replyText: reply
            };
        }

        // 1b. Access gate (Step 3): the department must be switched ON and the person's kickoff recorded.
        const access = await TaskAccessService.check({ userId: employee.id, departmentId: employee.department_id });
        if (!access.allowed) {
            const reply = TaskErrorHandler.taskManagerLocked(access.message);
            await TaskDatabaseService.logAudit({
                eventType: 'task_access_blocked',
                actorId: employee.id,
                targetEmployeeId: employee.id,
                details: { reason: access.reason, channel: 'whatsapp' }
            });
            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
            return {
                success: false,
                command: 'locked',
                employee,
                replyText: reply
            };
        }

        // Set or renew active Task Manager conversation context (30 min TTL)
        await TaskDatabaseService.setConversationContext({
            phone: params.phone,
            system: 'TASK_MANAGER',
            contextType: 'ACTIVE_SESSION',
            ttlMinutes: 30
        });

        // 2. Fetch today's tasks
        const tasks = await TaskDatabaseService.getDailyAssignments({
            employeeId: employee.id,
            date: targetDate
        });

        // ── Command 1: Cancel ─────────────────────────────────────────────────
        if (lower === 'cancel') {
            await TaskDatabaseService.clearConversationContext(params.phone, 'TASK_MANAGER');
            const reply = "Task Manager session cleared. You can reply 'tasks' anytime to restart.";
            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
            return {
                success: true,
                command: 'cancel',
                employee,
                replyText: reply
            };
        }

        // ── Command: Team Status / Department Overview ───────────────────────────
        const isTeamQuery = lower === 'team' || lower === 'team status' || lower === 'view team tasks' || lower === 'dept' || lower === 'department';
        const isManagerQueryingGeneralTasks = (employee.role === 'reporting_manager' || employee.role === 'superuser') && (lower === 'team' || lower === 'view team tasks' || (tasks.length === 0 && (lower === 'tasks' || lower === 'view tasks' || lower === 'status')));

        if (isTeamQuery || isManagerQueryingGeneralTasks) {
            if (!employee.department_id && employee.role !== 'superuser') {
                const reply = `⚠️ You are marked as a Reporting Manager, but no department is assigned to your profile.`;
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: false,
                    command: 'team_status',
                    employee,
                    replyText: reply
                };
            }

            const teamPool = employee.department_id
                ? await TaskDatabaseService.getEmployeesByDepartment(employee.department_id)
                : await TaskDatabaseService.getAllEmployees();
            // Step 5: same rule as the web Tasks tab: yourself, your reports, and colleagues when team sharing is ON
            const deptEmployees = await PermissionService.visibleAndAssignable(employee, teamPool);

            const deptName = employee.department_name || 'Department';

            if (deptEmployees.length === 0) {
                const reply = `📊 *${deptName} Department*\n\nNo employees found in this department.`;
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: true,
                    command: 'team_status',
                    employee,
                    replyText: reply
                };
            }

            let totalDeptTasks = 0;
            let totalDeptCompleted = 0;
            const memberSections: string[] = [];

            for (const member of deptEmployees) {
                const memberTasks = await TaskDatabaseService.getDailyAssignments({
                    employeeId: member.id,
                    date: targetDate
                });

                const completed = memberTasks.filter(t => t.status === 'completed').length;
                totalDeptTasks += memberTasks.length;
                totalDeptCompleted += completed;

                const roleBadge = member.role === 'reporting_manager' ? ' 👑 (Manager)' : '';
                const taskLines = memberTasks.length === 0
                    ? '   _No tasks assigned today_'
                    : memberTasks.map((t, idx) => {
                        const icon = t.status === 'completed' ? '✅' : '⏳';
                        return `   ${idx + 1}. [${icon}] ${t.title}`;
                    }).join('\n');

                memberSections.push(`👤 *${member.name}*${roleBadge} (${completed}/${memberTasks.length} Completed)\n${taskLines}`);
            }

            const overallPercent = totalDeptTasks > 0 ? Math.round((totalDeptCompleted / totalDeptTasks) * 100) : 100;

            const reply = [
                `📊 *${deptName} Department — Today's Tasks*`,
                `📅 ${targetDate}`,
                ``,
                memberSections.join('\n\n'),
                ``,
                `📈 *Department Progress:* ${totalDeptCompleted}/${totalDeptTasks} Tasks (${overallPercent}%)`,
                ``,
                `💡 *To assign a task:*`,
                `Reply: *assign <name> <task title>*`,
                `_Example: assign Harsh Test login flow_`
            ].join('\n');

            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
            return {
                success: true,
                command: 'team_status',
                employee,
                replyText: reply,
                progress: { total: totalDeptTasks, completed: totalDeptCompleted, percent: overallPercent }
            };
        }

        // ── Command: Assign Task Guide ──────────────────────────────────────────
        if (lower === 'assign' || lower === 'assign task') {
            const deptEmployees = employee.department_id
                ? await TaskDatabaseService.getEmployeesByDepartment(employee.department_id)
                : [];
            const availableNames = deptEmployees.map(e => e.name.split(' ')[0]).join(', ');
            const reply = [
                `📝 *How to Assign a Task via WhatsApp:*`,
                ``,
                `Reply in this format:`,
                `*assign <name> <task title>*`,
                ``,
                availableNames ? `👥 Your team members: *${availableNames}*` : '',
                ``,
                `_Examples:_`,
                `• *assign Harsh Test WhatsApp integration*`,
                `• *assign Sahil Review deployment checklist*`
            ].filter(Boolean).join('\n');

            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
            return {
                success: true,
                command: 'assign_task',
                employee,
                replyText: reply
            };
        }

        // ── Command: Assign <Name> <Task Title> ──────────────────────────────────
        const assignMatch = cleanText.match(/^assign\s+([a-zA-Z0-9_\.\-]+)\s+(.+)$/i);
        if (assignMatch) {
            const targetNameQuery = assignMatch[1].trim();
            const taskTitle = assignMatch[2].trim();

            // People this person may assign to (the shared rule, same as the web Tasks tab):
            // themselves, everyone below them in the reporting chain, colleagues when team sharing is ON;
            // superusers may assign to anyone.
            const allEmployees = await TaskDatabaseService.getAllEmployees();
            const deptEmployees = await PermissionService.visibleAndAssignable(employee, allEmployees);

            // Match by self ('me' / 'myself'), or search available assignees
            const isSelf = targetNameQuery.toLowerCase() === 'me' || targetNameQuery.toLowerCase() === 'myself';
            const targetEmployee = isSelf ? employee : (
                deptEmployees.find(e => {
                    const firstName = e.name.split(' ')[0].toLowerCase();
                    const query = targetNameQuery.toLowerCase();
                    // Prefer self if the name query matches the sender's own first name
                    return query === firstName && e.id === employee.id;
                }) || deptEmployees.find(e => {
                    const fullName = e.name.toLowerCase();
                    const firstName = e.name.split(' ')[0].toLowerCase();
                    const query = targetNameQuery.toLowerCase();
                    return firstName === query || fullName.includes(query) || e.id === targetNameQuery;
                })
            );

            if (!targetEmployee) {
                const availableNames = deptEmployees.map(e => e.name.split(' ')[0]).join(', ');
                const reply = `❌ *Employee Not Found*\n\nCould not find "${targetNameQuery}" among the people who report to you.\n\nAvailable team members: *${availableNames}*\n\n_Example: assign ${deptEmployees[0]?.name.split(' ')[0] || 'Name'} ${taskTitle}_`;
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: false,
                    command: 'assign_task',
                    employee,
                    replyText: reply
                };
            }

            // Access gate (Step 3): the person being assigned must be unlocked too.
            const targetAccess = await TaskAccessService.check({ userId: targetEmployee.id, departmentId: targetEmployee.department_id });
            if (!targetAccess.allowed) {
                const reply = TaskErrorHandler.assigneeLocked(targetEmployee.name, targetAccess.message);
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: false,
                    command: 'assign_task',
                    employee,
                    replyText: reply
                };
            }

            // Create task in database
            const newTask = await TaskDatabaseService.createTaskAssignment({
                employeeId: targetEmployee.id,
                title: taskTitle,
                assignedDate: targetDate,
                assignedBy: employee.id
            });

            // Log audit
            await TaskDatabaseService.logAudit({
                eventType: 'task_assigned_whatsapp',
                actorId: employee.id,
                targetEmployeeId: targetEmployee.id,
                taskId: newTask.id,
                details: { title: taskTitle, channel: 'whatsapp', date: targetDate }
            });

            // Notify assigned employee via WhatsApp if they have a phone number
            if (targetEmployee.phone_number && targetEmployee.phone_number.trim().length >= 10) {
                const managerDept = employee.department_name ? ` (${employee.department_name})` : '';
                const empAlert = [
                    `🔔 *New Task Assigned!*`,
                    ``,
                    `*Task:* ${taskTitle}`,
                    `*Assigned By:* ${employee.name}${managerDept}`,
                    `*Date:* ${targetDate}`,
                    ``,
                    `Reply *tasks* to view your full list, or *done <number>* once completed!`
                ].join('\n');

                TaskMessagingService.sendMessage(targetEmployee.phone_number, empAlert).catch(err => {
                    console.error('[WhatsAppAssign] Failed to notify target employee:', err);
                });
            }

            // Confirm back to the Manager
            const managerReply = [
                `✅ *Task Assigned Successfully!*`,
                ``,
                `*Assigned To:* ${targetEmployee.name}`,
                `*Task:* ${taskTitle}`,
                `*Date:* ${targetDate}`,
                ``,
                `📲 ${targetEmployee.name} has been notified on WhatsApp.`
            ].join('\n');

            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, managerReply);
            return {
                success: true,
                command: 'assign_task',
                affectedTaskId: newTask.id,
                employee,
                replyText: managerReply
            };
        }

        // ── Command 2: List Tasks / Status ────────────────────────────────────
        if (lower === 'tasks' || lower === 'status' || lower === 'my tasks' || lower === 'view tasks' || lower === 'today tasks' || lower === "today's tasks") {
            if (tasks.length === 0) {
                const reply = TaskErrorHandler.noTasksAssigned(targetDate);
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: true,
                    command: 'tasks',
                    employee,
                    replyText: reply,
                    progress: { total: 0, completed: 0, percent: 100 }
                };
            }

            const completedCount = tasks.filter(t => t.status === 'completed').length;
            const percent = Math.round((completedCount / tasks.length) * 100);

            const taskLines = tasks.map((t, idx) => {
                const icon = t.status === 'completed' ? '✅' : '⏳';
                const statusStr = t.status === 'completed' ? 'Completed' : 'Pending';
                return `${idx + 1}. ${t.title} [${statusStr} ${icon}]`;
            }).join('\n');

            const reply = [
                `📋 Tasks for today (${targetDate}):`,
                '',
                taskLines,
                '',
                `Progress: ${completedCount}/${tasks.length} (${percent}%)`,
                '',
                `💡 Reply "done 1" to complete a task, or "done all" to finish all.`
            ].join('\n');

            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
            return {
                success: true,
                command: 'tasks',
                employee,
                replyText: reply,
                progress: { total: tasks.length, completed: completedCount, percent }
            };
        }

        // ── Command 3: Done All ───────────────────────────────────────────────
        if (lower === 'done all' || lower === 'done-all' || lower === 'complete all' || lower === 'finished all' || lower === 'all done') {
            if (tasks.length === 0) {
                const reply = "You don't have any tasks assigned for today.";
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: true,
                    command: 'done_all',
                    employee,
                    replyText: reply
                };
            }

            const pendingTasks = tasks.filter(t => t.status !== 'completed');
            if (pendingTasks.length === 0) {
                const reply = `All your tasks for today are already completed! Great job! 🎉 (Progress: 100%)`;
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: true,
                    command: 'done_all',
                    employee,
                    replyText: reply,
                    progress: { total: tasks.length, completed: tasks.length, percent: 100 }
                };
            }

            // Mark all pending tasks as completed
            for (const task of pendingTasks) {
                await TaskDatabaseService.updateAssignmentStatus({
                    assignmentId: task.id,
                    status: 'completed'
                });
            }

            // Log bulk audit
            await TaskDatabaseService.logAudit({
                eventType: 'task_bulk_completed',
                actorId: employee.id,
                targetEmployeeId: employee.id,
                details: {
                    date: targetDate,
                    completedTaskIds: pendingTasks.map(t => t.id),
                    totalCount: tasks.length
                }
            });

            const reply = `🎉 All your tasks for today have been completed (${tasks.length}/${tasks.length} - 100%)!\n\nHave a great rest of your day!`;
            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);

            return {
                success: true,
                command: 'done_all',
                employee,
                replyText: reply,
                progress: { total: tasks.length, completed: tasks.length, percent: 100 }
            };
        }

        // ── Command 4: Done <Number> (e.g., done 1, done 2) ───────────────────
        const singleDoneMatch = lower.match(/^(?:done|complete|finish)\s+(\d+)$/i);
        if (singleDoneMatch) {
            const taskNum = parseInt(singleDoneMatch[1], 10);
            const taskIndex = taskNum - 1;

            if (taskIndex < 0 || taskIndex >= tasks.length) {
                const reply = TaskErrorHandler.invalidTaskNumber(taskNum);
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: false,
                    command: 'done_single',
                    taskNumber: taskNum,
                    employee,
                    replyText: reply
                };
            }

            const targetTask = tasks[taskIndex];
            if (targetTask.status === 'completed') {
                const reply = TaskErrorHandler.alreadyCompleted(taskNum, targetTask.title);
                if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
                return {
                    success: true,
                    command: 'done_single',
                    taskNumber: taskNum,
                    affectedTaskId: targetTask.id,
                    employee,
                    replyText: reply
                };
            }

            // Update status to completed
            await TaskDatabaseService.updateAssignmentStatus({
                assignmentId: targetTask.id,
                status: 'completed'
            });

            // Log audit
            await TaskDatabaseService.logAudit({
                eventType: 'task_completed',
                actorId: employee.id,
                targetEmployeeId: employee.id,
                taskId: targetTask.id,
                details: { taskNumber: taskNum, title: targetTask.title, date: targetDate }
            });

            // Recalculate progress
            const newCompletedCount = tasks.filter(t => t.id === targetTask.id || t.status === 'completed').length;
            const percent = Math.round((newCompletedCount / tasks.length) * 100);

            const allDoneCelebration = newCompletedCount === tasks.length ? '\n\n🎉 Fantastic! You have completed all tasks for today!' : '';
            const reply = `✅ Marked task #${taskNum} ("${targetTask.title}") as completed!\n\nProgress: ${newCompletedCount}/${tasks.length} (${percent}%)${allDoneCelebration}`;

            if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);

            return {
                success: true,
                command: 'done_single',
                taskNumber: taskNum,
                affectedTaskId: targetTask.id,
                employee,
                replyText: reply,
                progress: { total: tasks.length, completed: newCompletedCount, percent }
            };
        }

        // ── Command 5: Fallback / Help ────────────────────────────────────────
        const reply = TaskErrorHandler.ambiguousMessage();

        if (shouldSend) await TaskMessagingService.sendMessage(params.phone, reply);
        return {
            success: false,
            command: 'unknown',
            employee,
            replyText: reply
        };
    }
}
