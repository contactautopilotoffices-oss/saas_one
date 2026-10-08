import { GoogleGenerativeAI } from '@google/generative-ai';
import { TaskDatabaseService } from './TaskDatabaseService';
import { ControlledTaskTools } from './ControlledTaskTools';
import { PermissionService, PermissionDeniedError } from './PermissionService';
import { Employee } from './types';

export interface AIQueryResult {
    success: boolean;
    toolUsed: string;
    toolOutput: any;
    replyText: string;
    error?: string;
}

export class SuperuserAIAssistant {
    /**
     * Executive answer generator for Superusers & Leadership.
     */
    static async handleQuery(params: {
        phone: string;
        question: string;
        date?: string;
    }): Promise<AIQueryResult> {
        const actor = await TaskDatabaseService.getEmployeeByPhone(params.phone);
        if (!actor) {
            return {
                success: false,
                toolUsed: 'none',
                toolOutput: null,
                replyText: 'Sorry, this phone number is not registered in the system.'
            };
        }

        // Only superuser and reporting managers can ask leadership AI questions
        if (actor.role !== 'superuser' && actor.role !== 'reporting_manager') {
            await TaskDatabaseService.logAudit({
                eventType: 'permission_denied',
                actorId: actor.id,
                details: { action: 'AI_ASSISTANT_QUERY', reason: 'Non-management user attempted AI query' }
            });
            return {
                success: false,
                toolUsed: 'none',
                toolOutput: null,
                replyText: 'Permission Denied: Only Managers and Superusers can query organizational task analytics.'
            };
        }

        const clean = params.question.trim();
        const lower = clean.toLowerCase();
        const targetDate = params.date || new Date().toISOString().slice(0, 10);

        let toolUsed = 'get_organisation_progress';
        let toolOutput: any = null;

        try {
            // ── Intent 1: "What tasks are assigned to <Name>?" ──────────────────
            const nameMatch = lower.match(/(?:tasks?\s+(?:for|to|of)\s+|assigned\s+to\s+)([a-zA-Z]+)/i);
            if (nameMatch) {
                const targetName = nameMatch[1];
                toolUsed = 'get_employee_tasks';
                toolOutput = await ControlledTaskTools.get_employee_tasks(actor, {
                    nameOrPhone: targetName,
                    date: targetDate
                });
            }
            // ── Intent 2: "What is the <Dept> team working on?" ────────────────
            else if (lower.includes('working on') || lower.includes('department tasks') || lower.includes('tasks in')) {
                toolUsed = 'get_department_tasks';
                const depts = await TaskDatabaseService.getDepartments();
                const matchedDept = [...depts].sort((a, b) => b.name.length - a.name.length).find(d => lower.includes(d.name.toLowerCase())) || depts[0];
                toolOutput = await ControlledTaskTools.get_department_tasks(actor, {
                    departmentNameOrId: matchedDept.id,
                    date: targetDate
                });
            }
            // ── Intent 3: "How is <Dept> doing today?" ────────────────────────
            else if (lower.includes('how is') || lower.includes('progress of') || lower.includes('doing today')) {
                toolUsed = 'get_department_progress';
                const depts = await TaskDatabaseService.getDepartments();
                const matchedDept = [...depts].sort((a, b) => b.name.length - a.name.length).find(d => lower.includes(d.name.toLowerCase())) || depts[0];
                toolOutput = await ControlledTaskTools.get_department_progress(actor, {
                    departmentNameOrId: matchedDept.id,
                    date: targetDate
                });
            }
            // ── Intent 4: "Who has not completed?" / "Pending tasks" ──────────
            else if (lower.includes('not completed') || lower.includes('pending tasks') || lower.includes('unfinished')) {
                toolUsed = 'get_pending_tasks';
                toolOutput = await ControlledTaskTools.get_pending_tasks(actor, {
                    date: targetDate
                });
            }
            // ── Intent 5: Organisation-wide Progress & Stats ────────────────────
            else {
                toolUsed = 'get_organisation_progress';
                toolOutput = await ControlledTaskTools.get_organisation_progress(actor, {
                    date: targetDate
                });
            }

            // Log tool execution audit
            await TaskDatabaseService.logAudit({
                eventType: 'ai_tool_call',
                actorId: actor.id,
                details: {
                    query: clean,
                    toolUsed,
                    date: targetDate
                }
            });

            // ── Format Executive Reply ────────────────────────────────────────
            const replyText = await this.formatReply({
                question: clean,
                toolUsed,
                data: toolOutput,
                date: targetDate
            });

            return {
                success: true,
                toolUsed,
                toolOutput,
                replyText
            };

        } catch (err: any) {
            console.error('[SuperuserAIAssistant] Error executing tool:', err);
            return {
                success: false,
                toolUsed,
                toolOutput: null,
                replyText: `Error processing request: ${err.message || 'Tool execution failed'}`
            };
        }
    }

    /**
     * Formats clean, executive WhatsApp replies from structured tool output.
     */
    static async formatReply(params: {
        question: string;
        toolUsed: string;
        data: any;
        date: string;
    }): Promise<string> {
        const { toolUsed, data, date } = params;

        if (data.error) {
            return `⚠️ ${data.error}`;
        }

        if (toolUsed === 'get_employee_tasks') {
            const taskLines = data.tasks.length > 0
                ? data.tasks.map((t: any, i: number) => `${i + 1}. ${t.title} [${t.status === 'completed' ? 'Done ✅' : 'Pending ⏳'}]`).join('\n')
                : 'No tasks assigned today.';

            return [
                `👤 *Tasks for ${data.employee}* (${data.department})`,
                `Date: ${date}`,
                `Total: ${data.total} | Completed: ${data.completed} | Pending: ${data.pending}`,
                '',
                taskLines
            ].join('\n');
        }

        if (toolUsed === 'get_department_tasks') {
            const taskList = data.tasks.length > 0
                ? data.tasks.map((t: any, i: number) => `• ${t.title} (${t.assignedTo}) - ${t.status === 'completed' ? '✅' : '⏳'}`).join('\n')
                : 'No tasks currently active for this department today.';

            return [
                `🏢 *${data.department} Department Tasks* (${date})`,
                `Total Active Tasks: ${data.total}`,
                '',
                taskList
            ].join('\n');
        }

        if (toolUsed === 'get_department_progress') {
            const empList = data.employeeBreakdown.map((e: any) => `• ${e.name}: ${e.completed}/${e.total} (${e.percentage})`).join('\n');

            return [
                `📊 *${data.departmentName} Department Progress*`,
                `Overall Completion: *${data.completionPercentage}*`,
                `Tasks: ${data.completedTasks}/${data.totalTasks} completed (${data.pendingTasks} pending)`,
                `Active Staff: ${data.activeEmployees}`,
                '',
                `*Staff Breakdown:*`,
                empList || 'No staff assignments today.'
            ].join('\n');
        }

        if (toolUsed === 'get_pending_tasks') {
            const list = data.pendingTasks.length > 0
                ? data.pendingTasks.slice(0, 10).map((t: any, i: number) => `${i + 1}. ${t.title} — ${t.assignedTo}`).join('\n')
                : 'No pending tasks! All work is completed. 🎉';

            const moreCount = data.pendingCount > 10 ? `\n...and ${data.pendingCount - 10} more pending tasks.` : '';

            return [
                `⏳ *Today's Pending Tasks (${data.pendingCount})*`,
                `Date: ${date}`,
                '',
                list,
                moreCount
            ].join('\n');
        }

        // Organisation progress fallback
        const topDepts = (data.departments || []).slice(0, 5)
            .map((d: any) => `• ${d.name}: ${d.percentage} (${d.completed}/${d.total})`)
            .join('\n');

        return [
            `🏢 *Organisation Task Progress Overview*`,
            `Overall Completion: *${data.overallCompletionPercentage}*`,
            `Total Tasks: ${data.totalTasks} | Done: ${data.completedTasks} | Pending: ${data.pendingTasks}`,
            `Departments: ${data.totalDepartments} | Employees: ${data.totalEmployees}`,
            '',
            `*Department Snapshot:*`,
            topDepts
        ].join('\n');
    }
}
