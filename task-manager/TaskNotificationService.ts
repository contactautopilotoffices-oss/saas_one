import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskMessagingService } from './TaskMessagingService';
import { TaskDailyGeneratorService } from './TaskDailyGeneratorService';
import { TaskAccessService } from './TaskAccessService';
import { Employee, TaskAssignment, NotificationRule } from './types';

export interface MorningNotificationOptions {
    date?: string; // YYYY-MM-DD
    departmentId?: string;
    employeeId?: string;
    dryRun?: boolean; // If true, builds digests without sending network requests
    skipAudit?: boolean; // Step 6: previews write no history rows
    rule?: NotificationRule; // Phase 2: rule containing task selection filters & conditions
}

export interface MorningNotificationResult {
    success: boolean;
    date: string;
    totalEmployeesChecked: number;
    notificationsSent: number;
    skippedNoTasks: number;
    skippedNoPhone: number;
    skippedLocked?: number;  // Step 3: people whose department is OFF or whose kickoff is not recorded
    failed: number;
    pretend?: boolean;       // true when Pretend Mode simulated the run (nothing was sent)
    blockedReason?: string;  // set when a kill switch / safety failure stopped the run
    details: Array<{
        employeeId: string;
        employeeName: string;
        phone: string;
        taskCount: number;
        status: 'sent' | 'skipped_no_tasks' | 'skipped_no_phone' | 'skipped_locked' | 'failed';
        error?: string;
        digestPreview?: string;
    }>;
}

export class TaskNotificationService {
    /**
     * Formats the morning task digest message with numbering and quick-reply instructions.
     */
    static buildMorningDigest(employeeName: string, tasks: Array<TaskAssignment & { isCarriedForward?: boolean }>): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';

        if (tasks.length === 0) {
            return `Good morning ${firstName}! 📋\n\nYou have no tasks assigned for today. Have a productive day!`;
        }

        const taskLines = tasks.map((task, index) => {
            const statusIcon = task.status === 'completed' ? '✅' : '⏳';
            const statusText = task.status === 'completed' ? 'Completed' : 'Pending';
            const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
            return `${index + 1}. ${carryPrefix}${task.title} [${statusText} ${statusIcon}]`;
        }).join('\n');

        return [
            `Good morning ${firstName}! 📋`,
            '',
            `Here are your tasks for today:`,
            taskLines,
            '',
            `💡 You can reply:`,
            `• "done 1" to complete a task`,
            `• "done all" to complete all tasks`,
            `• "tasks" to check your latest list`
        ].join('\n');
    }

    /**
     * Formats the midday progress check-in message focusing on remaining uncompleted tasks.
     */
    static buildMiddayReminder(employeeName: string, tasks: Array<TaskAssignment & { isCarriedForward?: boolean }>): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';
        const pendingTasks = tasks.filter(t => t.status !== 'completed');

        if (pendingTasks.length === 0) {
            return `Hi ${firstName}! 🌟 Great job! You have completed all your tasks for today. Keep up the great work!`;
        }

        const taskLines = pendingTasks.map((task, index) => {
            const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
            return `${index + 1}. ${carryPrefix}${task.title} [Pending ⏳]`;
        }).join('\n');

        return [
            `Hi ${firstName}! ⏳ Midday Progress Check-in 📋`,
            '',
            `You have ${pendingTasks.length} pending task${pendingTasks.length === 1 ? '' : 's'} remaining:`,
            taskLines,
            '',
            `💡 You can reply:`,
            `• "done 1" to complete a task`,
            `• "done all" to complete all remaining tasks`,
            `• "tasks" to view your full status`
        ].join('\n');
    }

    /**
     * Formats the end-of-day summary message showing accomplishments and uncompleted items.
     */
    static buildEODSummary(employeeName: string, tasks: Array<TaskAssignment & { isCarriedForward?: boolean }>): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';
        const completed = tasks.filter(t => t.status === 'completed');
        const pending = tasks.filter(t => t.status !== 'completed');

        const taskLines = tasks.map((task, index) => {
            const statusIcon = task.status === 'completed' ? '✅' : '⏳';
            const statusText = task.status === 'completed' ? 'Completed' : 'Pending';
            const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
            return `${index + 1}. ${carryPrefix}${task.title} [${statusText} ${statusIcon}]`;
        }).join('\n');

        return [
            `Good evening ${firstName}! 🏁 End-of-Day Task Summary 📊`,
            '',
            `• Completed today: ${completed.length} ✅`,
            `• Outstanding / Pending: ${pending.length} ⏳`,
            '',
            `Detailed list:`,
            taskLines,
            '',
            pending.length > 0
                ? `💡 Unfinished tasks will be carried forward to tomorrow. You can still reply "done <number>" to log completions.`
                : `🎉 Amazing work today! All scheduled tasks are complete.`
        ].join('\n');
    }

    /**
     * Phase 3: Variable substitution helper for custom templates.
     * Supports: {{firstName}}, {{fullName}}, {{totalTasks}}, {{pendingTasks}}, {{completedTasks}}, {{date}}
     */
    static applyTemplateVariables(
        text: string,
        variables: {
            firstName: string;
            fullName: string;
            totalTasks: number;
            pendingTasks: number;
            completedTasks: number;
            date: string;
        }
    ): string {
        return text
            .replace(/\{\{firstName\}\}/gi, variables.firstName)
            .replace(/\{\{fullName\}\}/gi, variables.fullName)
            .replace(/\{\{totalTasks\}\}/gi, String(variables.totalTasks))
            .replace(/\{\{pendingTasks\}\}/gi, String(variables.pendingTasks))
            .replace(/\{\{completedTasks\}\}/gi, String(variables.completedTasks))
            .replace(/\{\{date\}\}/gi, variables.date);
    }

    /**
     * Formats an urgent alert highlighting past due uncompleted tasks.
     */
    static buildOverdueAlert(
        employeeName: string,
        tasks: Array<TaskAssignment & { isCarriedForward?: boolean }>,
        targetDate: string
    ): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';
        const overdue = tasks.filter(t => t.status !== 'completed' && t.assigned_date < targetDate);

        if (overdue.length === 0) {
            return `Hi ${firstName}! ✅ You have no overdue tasks. All past tasks are up to date!`;
        }

        const taskLines = overdue.map((task, index) => {
            const daysOverdue = Math.max(1, Math.round((new Date(targetDate).getTime() - new Date(task.assigned_date).getTime()) / (1000 * 60 * 60 * 24)));
            return `${index + 1}. ${task.title} [⚠️ ${daysOverdue}d overdue]`;
        }).join('\n');

        return [
            `⚠️ ATTENTION ${firstName}! Overdue Task Alert 🚨`,
            '',
            `You have ${overdue.length} overdue task${overdue.length === 1 ? '' : 's'} requiring your immediate attention:`,
            taskLines,
            '',
            `💡 Please resolve these tasks today. Reply "done <number>" to mark completed.`
        ].join('\n');
    }

    /**
     * Phase 3: Master formatter that applies custom rule templates or routes to standard formatters.
     */
    static buildFormattedDigest(
        rule: NotificationRule | undefined,
        employeeName: string,
        tasks: Array<TaskAssignment & { isCarriedForward?: boolean }>,
        targetDate: string
    ): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';
        const completed = tasks.filter(t => t.status === 'completed');
        const pending = tasks.filter(t => t.status !== 'completed');

        // If custom template is configured on the rule:
        if (rule?.customTemplate) {
            const variables = {
                firstName,
                fullName: employeeName,
                totalTasks: tasks.length,
                pendingTasks: pending.length,
                completedTasks: completed.length,
                date: targetDate
            };

            const header = rule.customTemplate.headerGreeting
                ? this.applyTemplateVariables(rule.customTemplate.headerGreeting, variables)
                : `Hello ${firstName}! 📋`;

            const customMsg = rule.customTemplate.customMessage
                ? this.applyTemplateVariables(rule.customTemplate.customMessage, variables)
                : '';

            const taskLines = tasks.map((task, index) => {
                const statusIcon = task.status === 'completed' ? '✅' : '⏳';
                const statusText = task.status === 'completed' ? 'Completed' : 'Pending';
                const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
                return `${index + 1}. ${carryPrefix}${task.title} [${statusText} ${statusIcon}]`;
            }).join('\n');

            const footer = rule.customTemplate.footerInstruction
                ? this.applyTemplateVariables(rule.customTemplate.footerInstruction, variables)
                : '';

            const quickReplies = rule.customTemplate.includeQuickReplies !== false
                ? ['💡 You can reply:', '• "done 1" to complete a task', '• "done all" to complete all tasks', '• "tasks" to check your latest list'].join('\n')
                : '';

            return [header, customMsg, '', 'Here is your task list:', taskLines, '', footer, quickReplies]
                .filter(Boolean)
                .join('\n');
        }

        // Standard formatters by ruleType
        if (rule?.ruleType === 'pending_reminder') {
            return this.buildMiddayReminder(employeeName, tasks);
        } else if (rule?.ruleType === 'overdue_alert') {
            return this.buildOverdueAlert(employeeName, tasks, targetDate);
        } else if (rule?.ruleType === 'eod_summary') {
            return this.buildEODSummary(employeeName, tasks);
        } else {
            return this.buildMorningDigest(employeeName, tasks);
        }
    }

    /**
     * Formats task items into a clean list for Meta-approved templates (fills {{1}}).
     * Since the Meta templates already have fixed headers (e.g. "☀️ Good Morning! Here is your daily task kickoff:")
     * and footers, {{1}} receives just the formatted task items list.
     */
    static buildTemplateTaskParam(ruleType: string | undefined, tasks: Array<TaskAssignment & { isCarriedForward?: boolean }>): string {
        if (tasks.length === 0) {
            return 'No tasks assigned for today.';
        }

        if (ruleType === 'eod_summary') {
            const completed = tasks.filter(t => t.status === 'completed');
            const summaryLine = `Completed today: ${completed.length}/${tasks.length} tasks`;
            const lines = tasks.map((task, idx) => {
                const status = task.status === 'completed' ? 'Completed ✅' : 'Pending ⏳';
                const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
                return `${idx + 1}. ${carryPrefix}${task.title} [${status}]`;
            }).join('\n');
            return `${summaryLine}\n${lines}`;
        }

        if (ruleType === 'pending_reminder') {
            const pending = tasks.filter(t => t.status !== 'completed');
            const targetTasks = pending.length > 0 ? pending : tasks;
            return targetTasks.map((task, idx) => {
                const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
                return `${idx + 1}. ${carryPrefix}${task.title} [Pending ⏳]`;
            }).join('\n');
        }

        // Default / morning_digest:
        return tasks.map((task, idx) => {
            const status = task.status === 'completed' ? 'Completed ✅' : 'Pending ⏳';
            const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
            return `${idx + 1}. ${carryPrefix}${task.title} [${status}]`;
        }).join('\n');
    }


    /**
     * Executes the morning notification pipeline:
     * 1. Optionally ensures fixed tasks are generated.
     * 2. Formats task digests for each targeted employee.
     * 3. Sends notifications via AiSensy WhatsApp dispatch.
     * 4. Logs audit records.
     */
    static async sendMorningNotifications(options: MorningNotificationOptions = {}): Promise<MorningNotificationResult> {
        const targetDate = options.date || new Date().toISOString().slice(0, 10);
        const details: MorningNotificationResult['details'] = [];

        // 1. Fetch targeted active employees
        let employees: Employee[] = [];
        if (options.rule?.ownerUserId) {
            // A personal rule only ever reaches its owner, whatever department or list the caller named.
            const owner = await TaskDatabaseService.getEmployeeById(options.rule.ownerUserId);
            employees = owner && owner.active ? [owner] : [];
        } else if (options.employeeId) {
            const emp = await TaskDatabaseService.getEmployeeById(options.employeeId);
            if (emp && emp.active) employees = [emp];
        } else if (options.departmentId) {
            employees = await TaskDatabaseService.getEmployeesByDepartment(options.departmentId);
        } else {
            employees = await TaskDatabaseService.getAllEmployees();
        }

        // Apply testing whitelist if enabled (Testing phase safeguard)
        if (!options.employeeId) {
            const testingConfig = await TaskDatabaseService.getTestingConfig();
            if (testingConfig?.enabled) {
                const whitelistedPhones = new Set<string>();
                (testingConfig.employees || []).forEach(e => {
                    const d = e.phone?.replace(/\D/g, '').slice(-10);
                    if (d) whitelistedPhones.add(d);
                });
                if (testingConfig.notifyManager && testingConfig.manager?.phone) {
                    const md = testingConfig.manager.phone.replace(/\D/g, '').slice(-10);
                    if (md) whitelistedPhones.add(md);
                }
                employees = employees.filter(emp => {
                    const digits = emp.phone_number?.replace(/\D/g, '').slice(-10);
                    return digits && whitelistedPhones.has(digits);
                });
            }
        }

        // Step 3 access gate: only people whose department is ON and whose kickoff is recorded may be notified.
        // Applies to real runs AND simulations, so a dry-run shows the true audience.
        const accessSplit = await TaskAccessService.partition(employees);
        employees = accessSplit.allowed;
        const lockedCount = accessSplit.locked.length;
        for (const { employee: lockedEmp, decision } of accessSplit.locked) {
            details.push({
                employeeId: lockedEmp.id,
                employeeName: lockedEmp.name,
                phone: lockedEmp.phone_number || '',
                taskCount: 0,
                status: 'skipped_locked',
                error: decision.message
            });
        }

        // Safety gate (fails closed): kill switches first, then Pretend Mode.
        // Pretend Mode behaves exactly like a dry-run: previews are built and logged, nothing is sent.
        let pretend = false;
        if (!options.dryRun) {
            const gate = await TaskMessagingService.resolveSendMode({
                departmentId: options.departmentId,
                ruleType: options.rule?.ruleType,
            });

            if (gate.mode === 'blocked') {
                console.warn(`[TaskNotificationService] 🛑 Dispatch halted by Kill Switch: ${gate.reason}`);
                return {
                    success: false,
                    date: targetDate,
                    totalEmployeesChecked: employees.length,
                    notificationsSent: 0,
                    skippedNoTasks: 0,
                    skippedNoPhone: 0,
                    skippedLocked: lockedCount,
                    failed: 0,
                    blockedReason: gate.reason,
                    details: [{
                        employeeId: 'all',
                        employeeName: 'System Gatekeeper',
                        phone: '',
                        taskCount: 0,
                        status: 'failed',
                        digestPreview: `[BLOCKED BY KILL SWITCH] ${gate.reason}`
                    }]
                };
            }
            pretend = gate.mode === 'pretend';
        }
        const simulate = Boolean(options.dryRun) || pretend;

        let sentCount = 0;
        let skippedNoTasksCount = 0;
        let skippedNoPhoneCount = 0;
        let failedCount = 0;

        for (const emp of employees) {
            // Check valid phone
            const phone = emp.phone_number?.trim();
            if (!phone || phone.length < 10) {
                skippedNoPhoneCount++;
                details.push({
                    employeeId: emp.id,
                    employeeName: emp.name,
                    phone: phone || '',
                    taskCount: 0,
                    status: 'skipped_no_phone',
                    error: 'Missing or invalid phone number'
                });
                continue;
            }

            // Fetch tasks using filter rules if provided, or default daily assignments
            const tasks = options.rule?.taskFilters
                ? await TaskDatabaseService.getFilteredAssignments({
                    employeeId: emp.id,
                    date: targetDate,
                    filters: options.rule.taskFilters
                })
                : await TaskDatabaseService.getDailyAssignments({
                    employeeId: emp.id,
                    date: targetDate
                });

            // Condition 1: skip if 0 tasks (or if skipIfZeroTasks is configured)
            if (tasks.length === 0) {
                skippedNoTasksCount++;
                details.push({
                    employeeId: emp.id,
                    employeeName: emp.name,
                    phone,
                    taskCount: 0,
                    status: 'skipped_no_tasks'
                });
                continue;
            }

            // Condition 2: requirePendingOnly - if rule requires pending and all tasks are completed, skip!
            if (options.rule?.conditions?.requirePendingOnly && tasks.every(t => t.status === 'completed')) {
                skippedNoTasksCount++;
                details.push({
                    employeeId: emp.id,
                    employeeName: emp.name,
                    phone,
                    taskCount: tasks.length,
                    status: 'skipped_no_tasks',
                    error: 'All tasks completed'
                });
                continue;
            }

            // Format message based on rule and customTemplate
            const digest = this.buildFormattedDigest(options.rule, emp.name, tasks, targetDate);

            if (simulate) {
                sentCount++;
                details.push({
                    employeeId: emp.id,
                    employeeName: emp.name,
                    phone,
                    taskCount: tasks.length,
                    status: 'sent',
                    digestPreview: digest
                });

                // Log audit event for simulated dispatch (previews write nothing)
                if (!options.skipAudit) await TaskDatabaseService.logAudit({
                    eventType: 'whatsapp_sent',
                    actorId: emp.id,
                    targetEmployeeId: emp.id,
                    details: {
                        type: options.rule?.ruleType || 'morning_digest',
                        ruleId: options.rule?.id || 'rule_morning_digest',
                        ruleName: options.rule?.name || 'Morning Kickoff',
                        employeeName: emp.name,
                        phone,
                        taskCount: tasks.length,
                        date: targetDate,
                        dryRun: true,
                        status: 'simulated',
                        pretend,
                        preview: digest
                    }
                });
                continue;
            }

            // Dispatch message via TaskMessagingService with rule-specific campaign, departmentId, and clean {{1}} parameter
            try {
                const templateTaskParam = this.buildTemplateTaskParam(options.rule?.ruleType, tasks);
                const sent = await TaskMessagingService.sendMessage(phone, digest, {
                    departmentId: options.departmentId,
                    ruleType: options.rule?.ruleType,
                    templateParams: [templateTaskParam],
                });

                if (sent) {
                    sentCount++;
                    details.push({
                        employeeId: emp.id,
                        employeeName: emp.name,
                        phone,
                        taskCount: tasks.length,
                        status: 'sent',
                        digestPreview: digest
                    });

                    // Log audit event
                    await TaskDatabaseService.logAudit({
                        eventType: 'whatsapp_sent',
                        actorId: emp.id,
                        targetEmployeeId: emp.id,
                        details: {
                            type: options.rule?.ruleType || 'morning_digest',
                            ruleId: options.rule?.id || 'rule_morning_digest',
                            ruleName: options.rule?.name || 'Morning Kickoff',
                            employeeName: emp.name,
                            phone,
                            taskCount: tasks.length,
                            date: targetDate,
                            dryRun: false,
                            status: 'sent',
                            preview: digest
                        }
                    });

                } else {
                    failedCount++;
                    details.push({
                        employeeId: emp.id,
                        employeeName: emp.name,
                        phone,
                        taskCount: tasks.length,
                        status: 'failed',
                        error: 'Messaging gateway returned false or timeout'
                    });

                    await TaskDatabaseService.logAudit({
                        eventType: 'whatsapp_sent',
                        actorId: emp.id,
                        targetEmployeeId: emp.id,
                        details: {
                            type: options.rule?.ruleType || 'morning_digest',
                            ruleId: options.rule?.id || 'rule_morning_digest',
                            ruleName: options.rule?.name || 'Morning Kickoff',
                            employeeName: emp.name,
                            phone,
                            taskCount: tasks.length,
                            date: targetDate,
                            dryRun: false,
                            status: 'failed',
                            error: 'Messaging gateway returned false or timeout'
                        }
                    });
                }
            } catch (err: any) {
                failedCount++;
                console.error(`[TaskNotificationService] Error notifying ${emp.name} (${phone}):`, err);
                details.push({
                    employeeId: emp.id,
                    employeeName: emp.name,
                    phone,
                    taskCount: tasks.length,
                    status: 'failed',
                    error: err.message || 'Notification dispatch error'
                });
            }
        }

        return {
            success: failedCount === 0,
            date: targetDate,
            totalEmployeesChecked: employees.length,
            notificationsSent: sentCount,
            skippedNoTasks: skippedNoTasksCount,
            skippedNoPhone: skippedNoPhoneCount,
            skippedLocked: lockedCount,
            failed: failedCount,
            pretend,
            details
        };
    }
}
