import { TaskManagerService, TaskItem } from './TaskManagerService';
import { WhatsAppService } from '@/backend/services/WhatsAppService';
import { detectTaskIntent } from './intentDetector';

function getStatusLabel(status: string): string {
    switch (status) {
        case 'completed': return '✅ Completed';
        case 'blocked': return '⛔ Blocked';
        case 'cancelled': return '❌ Cancelled';
        default: return '📋 Pending';
    }
}

function formatHelpMessage(fullName?: string, isSuperuser?: boolean): string {
    const lines = [
        `📋 *Head Office Task Manager*`,
        ``,
        `Hello *${fullName || 'there'}*! You can chat with me here naturally—no complex commands required:`,
        ``,
        `🌅 *Morning — Tell Me What You're Working On:*`,
        `• Just message naturally throughout your day:`,
        `  _e.g. "Today I will be working on project deployment"_`,
        `  _e.g. "Working on vendor NDA and accounts reconciliation"_`,
        `• Reply *"tasks"* anytime to view your active list.`,
        ``,
        `🌆 *Evening — Completion & Daily Wrap-Up:*`,
        `• Let me know when something is finished:`,
        `  _e.g. "Finished project deployment" or "done #1"_`,
        `• Flag any roadblock:`,
        `  _e.g. "Blocked on deployment: Waiting for AWS credentials"_`,
        `• Share your daily summary:`,
        `  _e.g. "Wrapped up deployment, resolved 3 tickets, and planned sprint"_`,
    ];

    if (isSuperuser) {
        lines.push(
            ``,
            `👑 *Leadership / Superuser Queries:*`,
            `• _"What did Tech work on today?"_ — View department progress`,
            `• _"Show pending tasks for Rohan"_ — View employee deliverables`,
            `• _"Who hasn't submitted their daily report today?"_ — Check missing EOD reports`
        );
    }

    return lines.join('\n');
}

function formatTaskListMessage(tasks: TaskItem[], filter: string): string {
    if (tasks.length === 0) {
        return [
            `📋 *Your Tasks*`,
            ``,
            filter === 'completed'
                ? `You don't have any completed tasks yet.`
                : `🎉 You have no active tasks right now!`,
            ``,
            `To log what you're working on today, simply message:`,
            `👉 _"Today I will be working on <your deliverable>"_`,
        ].join('\n');
    }

    const taskLines = tasks.map((task: TaskItem, index: number) => {
        const statusLabel = getStatusLabel(task.status);
        return [
            `*#${index + 1}. ${task.title}*`,
            `   Status: ${statusLabel} | 🏢 ${task.department || 'General'}`,
        ].join('\n');
    });

    const pendingCount = tasks.filter(t => t.status !== 'completed').length;
    return [
        `📋 *Your Tasks (${pendingCount} pending):*`,
        ``,
        taskLines.join('\n\n'),
        ``,
        `💡 *Actions:*`,
        `• Reply _"Finished [task name]"_ or _"done #1"_ when completed`,
        `• Message what you're working on to add another deliverable`,
        `• Send your end-of-day summary before logging off`,
    ].join('\n');
}

function formatTaskCreatedMessage(newTask: TaskItem): string {
    return [
        `✅ *Task Added to Your Day!*`,
        ``,
        `📋 *Task:* ${newTask.title}`,
        `🏢 *Department:* ${newTask.department || 'General'}`,
        `Status: 📋 Pending`,
        ``,
        `_When completed, simply message "Finished ${newTask.title}" or "done"._`,
    ].join('\n');
}

function formatTaskUpdatedMessage(updated: TaskItem, taskRef: string, remark?: string): string {
    return [
        updated.status === 'completed' ? `🎉 *Task Completed!*` : `📝 *Task Updated!*`,
        ``,
        `📋 *Task:* ${updated.title}`,
        `Status: ${getStatusLabel(updated.status)}`,
        remark ? `📝 *Note:* ${remark}` : '',
        ``,
        updated.status === 'completed'
            ? `Great job! This deliverable is marked as completed.`
            : `_When completed, message "Finished ${updated.title}" or "done"._`,
    ].filter(Boolean).join('\n');
}

function formatTaskCompletedMessage(completed: TaskItem, remark?: string): string {
    return [
        `🎉 *Task Completed!*`,
        ``,
        `📋 *Task:* ${completed.title}`,
        `Status: ✅ Completed`,
        remark ? `📝 *Remark:* ${remark}` : '',
        ``,
        `_Reply "tasks" to see your remaining tasks for today._`,
    ].filter(Boolean).join('\n');
}

function formatDailyReportMessage(report: { report_date: string; summary: string }, fullName?: string): string {
    const dateStr = new Date(report.report_date).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
    return [
        `📝 *Daily Work Report Submitted!*`,
        ``,
        `📅 *Date:* ${dateStr}`,
        `👤 *Employee:* ${fullName || 'Employee'}`,
        `📋 *Summary:*`,
        `${report.summary}`,
        ``,
        `_Your report has been logged and shared with management. Great work today!_`,
    ].join('\n');
}

export async function handleTaskManagerMessage(params: {
    senderPhone: string;
    messageText: string;
    user: { id: string; full_name?: string };
}): Promise<boolean> {
    const { senderPhone, messageText, user } = params;
    const rawText = messageText.trim();
    const lowerText = rawText.toLowerCase();

    // ── 1. Enrollment & Access Control Gate ────────────────────────────────────
    // Only enrolled members in `tm_members` (or test phone fallback) enter Task Manager.
    // Everyone else immediately returns false so standard FMS services continue untouched.
    const member = await TaskManagerService.getMemberByPhone(senderPhone);
    if (!member || !member.is_active) {
        return false;
    }

    const sendReply = async (text: string) => {
        try {
            await WhatsAppService.sendAsync(senderPhone, {
                message: text,
                templateName: process.env.AISENSY_TASK_CAMPAIGN_NAME || undefined,
                templateParams: process.env.AISENSY_TASK_CAMPAIGN_NAME ? [text] : undefined,
            });
        } catch (err) {
            console.warn('[TaskManagerRouter] Outbound send note:', err);
        }
    };

    // ── 2. Help Command ────────────────────────────────────────────────────────
    if (/^(task help|tasks help|task menu|help task)$/i.test(lowerText) || lowerText === 'tasks help') {
        await sendReply(formatHelpMessage(member.full_name || user.full_name, member.is_superuser));
        return true;
    }

    // ── 3. List Tasks Command ──────────────────────────────────────────────────
    if (/^(tasks|my tasks|list tasks|show tasks|pending tasks|completed tasks|all tasks)$/i.test(lowerText)) {
        let filter: 'active' | 'pending' | 'completed' | 'all' = 'active';
        if (lowerText.includes('pending')) filter = 'pending';
        else if (lowerText.includes('completed')) filter = 'completed';
        else if (lowerText.includes('all')) filter = 'all';

        const tasks = await TaskManagerService.listTasks({
            userId: user.id,
            statusFilter: filter,
        });

        await sendReply(formatTaskListMessage(tasks, filter));
        return true;
    }

    // ── 4. Create Task Command ─────────────────────────────────────────────────
    const createMatch = rawText.match(/^(?:create task|add task|new task)[:\s]+(.+)/i);
    if (createMatch) {
        const taskTitle = createMatch[1].trim();
        if (!taskTitle) {
            await sendReply(`❌ Please provide a task title.\nExample: *create task: Review Q3 accounts audit*`);
            return true;
        }

        const newTask = await TaskManagerService.createTask({
            userId: user.id,
            title: taskTitle,
            department: member.department,
        });

        await sendReply(formatTaskCreatedMessage(newTask));
        return true;
    }

    // ── 5. Update Task Command ─────────────────────────────────────────────────
    const updateMatch = rawText.match(/^(?:update task|update)\s*#?([a-zA-Z0-9-]+)(?:\s*[:\-]\s*(.*))?/i);
    if (updateMatch && !rawText.toLowerCase().startsWith('done') && !rawText.toLowerCase().startsWith('blocked')) {
        const taskRef = updateMatch[1];
        const remark = updateMatch[2]?.trim();

        const task = await TaskManagerService.resolveTask(user.id, taskRef);
        if (!task) {
            await sendReply(`❌ Could not find task *#${taskRef}*. Reply *tasks* to view your active deliverables.`);
            return true;
        }

        const updated = await TaskManagerService.updateTaskProgress({
            taskId: task.id,
            userId: user.id,
            progress: task.progress_percentage || 0,
            remark,
        });

        await sendReply(formatTaskUpdatedMessage(updated, taskRef, remark));
        return true;
    }

    // ── 6. Complete Task Command ───────────────────────────────────────────────
    const doneMatch = rawText.match(/^(?:done|complete task|complete)\s*#?([a-zA-Z0-9-]+)(?:\s*[:\-]\s*(.*))?/i);
    if (doneMatch) {
        const taskRef = doneMatch[1];
        const remark = doneMatch[2]?.trim();

        const task = await TaskManagerService.resolveTask(user.id, taskRef);
        if (!task) {
            await sendReply(`❌ Could not find task *#${taskRef}*. Reply *tasks* to view your active deliverables.`);
            return true;
        }

        const completed = await TaskManagerService.completeTask({
            taskId: task.id,
            userId: user.id,
            remark,
        });

        await sendReply(formatTaskCompletedMessage(completed, remark));
        return true;
    }

    // ── 7. Blocked Task Command ────────────────────────────────────────────────
    const blockedMatch = rawText.match(/^(?:blocked|block)\s*#?([a-zA-Z0-9-]+)(?:\s*[:\-]\s*(.*))?/i);
    if (blockedMatch) {
        const taskRef = blockedMatch[1];
        const reason = blockedMatch[2]?.trim();

        const task = await TaskManagerService.resolveTask(user.id, taskRef);
        if (!task) {
            await sendReply(`❌ Could not find task *#${taskRef}*. Reply *tasks* to view your active deliverables.`);
            return true;
        }

        const updated = await TaskManagerService.updateTaskProgress({
            taskId: task.id,
            userId: user.id,
            progress: task.progress_percentage || 0,
            remark: reason || 'Blocked',
        });

        await sendReply(`⛔ *Task Marked as Blocked!*\n\n📋 *Task:* ${task.title}\nStatus: ⛔ Blocked\n${reason ? `📝 Reason: ${reason}\n\n` : ''}_Leadership has been notified on the dashboard._`);
        return true;
    }

    // ── 7. Daily Work Report Command ───────────────────────────────────────────
    const reportMatch = rawText.match(/^(?:daily report|daily update|eod)[:\s]+(.+)/i);
    if (reportMatch) {
        const reportContent = reportMatch[1].trim();
        if (!reportContent) {
            await sendReply(`❌ Please provide your daily work summary.\nExample: *daily report: Completed 3 candidate interviews and closed vendor reconciliation.*`);
            return true;
        }

        const report = await TaskManagerService.submitDailyReport({
            userId: user.id,
            summary: reportContent,
        });

        await sendReply(formatDailyReportMessage(report, member.full_name || user.full_name));
        return true;
    }

    // ── 8. Conversational AI Intent Detection ──────────────────────────────────
    try {
        const activeTasks = await TaskManagerService.listTasks({
            userId: user.id,
            statusFilter: 'active',
            limit: 10
        });

        const activeTaskContext = activeTasks.map((t, idx) => ({
            id: t.id,
            title: t.title,
            index: idx + 1
        }));

        const intent = await detectTaskIntent(rawText, {
            activeTasks: activeTaskContext,
            isSuperuser: member.is_superuser
        });

        // If classified as facility maintenance, ticket, or unrelated -> PASS THROUGH to standard FMS flow!
        if (
            intent.action === 'ticket_or_maintenance' ||
            intent.action === 'unrelated' ||
            intent.confidence < 0.6
        ) {
            return false;
        }

        // ── Superuser Query: Department Progress ──
        if (intent.action === 'query_department_progress') {
            if (!member.is_superuser) {
                await sendReply(`🔒 Department oversight queries are restricted to leadership and superusers.`);
                return true;
            }

            const dept = intent.target_department || 'Tech';
            const progress = await TaskManagerService.getDepartmentProgress(dept);

            const reportLines = [
                `🏢 *${progress.department} Department Progress*`,
                ``,
                `📊 *Summary:*`,
                `• Total Tasks: ${progress.totalTasks}`,
                `• Completed: ${progress.completedTasks} ✅`,
                `• In Progress: ${progress.inProgressTasks} ⏳`,
                `• Pending: ${progress.pendingTasks} 📋`,
            ];

            if (progress.tasks.length > 0) {
                reportLines.push(``, `📌 *Active Deliverables:*`);
                progress.tasks.slice(0, 5).forEach((t, i) => {
                    reportLines.push(`• ${t.title} (${getStatusLabel(t.status)})`);
                });
            }

            if (progress.dailyReports.length > 0) {
                reportLines.push(``, `📝 *Today's EOD Reports (${progress.dailyReports.length}):*`);
                progress.dailyReports.slice(0, 3).forEach((r) => {
                    reportLines.push(`• ${r.summary.slice(0, 100)}...`);
                });
            } else {
                reportLines.push(``, `_No EOD reports submitted yet today for ${progress.department}._`);
            }

            await sendReply(reportLines.join('\n'));
            return true;
        }

        // ── Superuser Query: Employee Progress ──
        if (intent.action === 'query_employee_progress') {
            if (!member.is_superuser) {
                await sendReply(`🔒 Employee progress queries are restricted to leadership and superusers.`);
                return true;
            }

            const empName = intent.target_employee || '';
            const empProgress = await TaskManagerService.getEmployeeProgress(empName);

            if (!empProgress) {
                await sendReply(`❌ Could not find employee matching *"${empName}"*. Please verify the name.`);
                return true;
            }

            const lines = [
                `👤 *Progress Report: ${empProgress.employeeName}*`,
                `🏢 Department: ${empProgress.department}`,
                ``,
                `📋 *Active Tasks (${empProgress.activeTasks.length}):*`
            ];

            if (empProgress.activeTasks.length === 0) {
                lines.push(`• No active tasks right now.`);
            } else {
                empProgress.activeTasks.forEach((t, i) => {
                    lines.push(`*#${i + 1}. ${t.title}* (${getStatusLabel(t.status)})`);
                });
            }

            if (empProgress.latestReport) {
                lines.push(``, `📝 *Latest EOD Report (${empProgress.latestReport.report_date}):*`);
                lines.push(`${empProgress.latestReport.summary}`);
            }

            await sendReply(lines.join('\n'));
            return true;
        }

        // ── Superuser Query: Missing Daily Reports ──
        if (intent.action === 'query_missing_reports') {
            if (!member.is_superuser) {
                await sendReply(`🔒 Accountability queries are restricted to leadership and superusers.`);
                return true;
            }

            const missing = await TaskManagerService.getMissingDailyReports();
            if (missing.length === 0) {
                await sendReply(`🎉 All active team members have submitted their daily report today!`);
                return true;
            }

            const lines = [
                `⚠️ *Missing Daily EOD Reports (${missing.length})*`,
                `The following employees haven't submitted their daily update today:`,
                ``
            ];

            missing.forEach((m, idx) => {
                lines.push(`${idx + 1}. *${m.name}* (${m.department})`);
            });

            await sendReply(lines.join('\n'));
            return true;
        }

        if (intent.action === 'task_help') {
            await sendReply(formatHelpMessage(member.full_name || user.full_name, member.is_superuser));
            return true;
        }

        if (intent.action === 'list_tasks') {
            const filter = lowerText.includes('completed') ? 'completed' : 'active';
            const tasks = await TaskManagerService.listTasks({
                userId: user.id,
                statusFilter: filter,
            });
            await sendReply(formatTaskListMessage(tasks, filter));
            return true;
        }

        if (intent.action === 'create_task') {
            const titles: string[] = [];
            if (intent.task_titles && Array.isArray(intent.task_titles) && intent.task_titles.length > 0) {
                titles.push(...intent.task_titles.map(t => t.trim()).filter(Boolean));
            } else if (intent.task_title && intent.task_title.trim().length > 0) {
                titles.push(intent.task_title.trim());
            } else {
                const cleaned = rawText
                    .replace(/^(?:today\s+)?(?:i|he|she|we)?\s*(?:will\s+be\s+working\s+on|am\s+working\s+on|is\s+working\s+on|will\s+work\s+on|working\s+on|planning\s+to\s+work\s+on|planning\s+to|focusing\s+on)\s+/i, '')
                    .replace(/^(?:please\s+)?(?:create|add|schedule|new)\s+(?:a\s+)?task\s*(?:to|for|:)?\s*/i, '')
                    .trim();
                if (cleaned) {
                    titles.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
                }
            }

            if (titles.length === 0) {
                await sendReply(`❌ What would you like to log for today?\n_e.g. "Today I will be working on project deployment"_`);
                return true;
            }

            const createdTasks = [];
            for (const t of titles) {
                const newTask = await TaskManagerService.createTask({
                    userId: user.id,
                    title: t,
                    department: member.department,
                    priority: intent.priority || 'medium'
                });
                createdTasks.push(newTask);
            }

            if (createdTasks.length === 1) {
                await sendReply(formatTaskCreatedMessage(createdTasks[0]));
            } else {
                const taskItems = createdTasks.map((t, idx) => `*#${idx + 1}. ${t.title}* (📋 Pending)`).join('\n');
                await sendReply(
                    `✅ *Added ${createdTasks.length} Tasks for Today!*\n\n${taskItems}\n\n🏢 *Department:* ${member.department || 'General'}\n\n_When completed with any task, simply message "Finished [task name]" or "done"._`
                );
            }
            return true;
        }

        if (intent.action === 'complete_task') {
            const targetRef = intent.task_ref || intent.task_title;
            let targetTask: TaskItem | null = null;

            if (targetRef) {
                targetTask = await TaskManagerService.resolveTask(user.id, targetRef);
            }
            if (!targetTask) {
                for (const t of activeTasks) {
                    const words = t.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                    if (words.some(w => lowerText.includes(w))) {
                        targetTask = t;
                        break;
                    }
                }
            }
            if (!targetTask && activeTasks.length === 1) {
                targetTask = activeTasks[0];
            }

            if (targetTask) {
                const completed = await TaskManagerService.completeTask({
                    taskId: targetTask.id,
                    userId: user.id,
                    remark: intent.remark || rawText
                });
                await sendReply(formatTaskCompletedMessage(completed, intent.remark || rawText));
                return true;
            } else {
                await sendReply(`Which task did you complete? Reply *done #1* or *tasks* to see your active list.`);
                return true;
            }
        }

        if (intent.action === 'update_progress') {
            const targetRef = intent.task_ref || intent.task_title;
            const progress = intent.progress_percentage ?? 50;
            let targetTask: TaskItem | null = null;

            if (targetRef) {
                targetTask = await TaskManagerService.resolveTask(user.id, targetRef);
            }
            if (!targetTask) {
                for (const t of activeTasks) {
                    const words = t.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                    if (words.some(w => lowerText.includes(w))) {
                        targetTask = t;
                        break;
                    }
                }
            }
            if (!targetTask && activeTasks.length === 1) {
                targetTask = activeTasks[0];
            }

            if (targetTask) {
                const updated = await TaskManagerService.updateTaskProgress({
                    taskId: targetTask.id,
                    userId: user.id,
                    progress,
                    remark: intent.remark || rawText
                });
                await sendReply(formatTaskUpdatedMessage(updated, targetTask.title, intent.remark || rawText));
                return true;
            } else {
                await sendReply(`Which task are you updating? Reply *update #1 ${progress}%* or *tasks* to see your list.`);
                return true;
            }
        }

        if (intent.action === 'daily_report') {
            const summary = intent.summary || rawText;
            const report = await TaskManagerService.submitDailyReport({
                userId: user.id,
                summary
            });
            await sendReply(formatDailyReportMessage(report, member.full_name || user.full_name));
            return true;
        }
    } catch (err) {
        console.warn('[TaskManagerRouter] AI intent handling error:', err);
    }

    // ── 9. Fallback for unrecognized "task" messages ───────────────────────────
    if (lowerText.startsWith('task') || lowerText.startsWith('tasks')) {
        await sendReply(
            `❓ I didn't quite catch that.\nReply *"tasks"* to view your active deliverables, or tell me what you're working on (e.g. _"Today I will be working on project deployment"_).`
        );
        return true;
    }

    // Message is NOT a task command — let it fall through to standard ticketing!
    return false;
}
