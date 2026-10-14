import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskMessagingService } from './TaskMessagingService';
import { TaskDailyGeneratorService } from './TaskDailyGeneratorService';
import { TaskAccessService } from './TaskAccessService';
import { Employee, TaskAssignment, NotificationRule } from './types';
import { firstName, formatDate, oneLine, sendTeamDigest } from './taskAlerts';

/** A task as messages show it. `listNumber` comes from the person's numbered list (getNumberedList); old callers without it
 *  fall back to the position in the message. */
type ListTask = TaskAssignment & { isCarriedForward?: boolean; listNumber?: number };

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
    static buildMorningDigest(employeeName: string, tasks: Array<ListTask>): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';

        if (tasks.length === 0) {
            return `Good morning ${firstName}! 📋\n\nYou have no tasks assigned for today. Have a productive day!`;
        }

        const taskLines = tasks.map((task, index) => {
            const statusIcon = task.status === 'completed' ? '✅' : '⏳';
            const statusText = task.status === 'completed' ? 'Completed' : 'Pending';
            const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
            return `${task.listNumber ?? index + 1}. ${carryPrefix}${task.title} [${statusText} ${statusIcon}]`;
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
    static buildMiddayReminder(employeeName: string, tasks: Array<ListTask>): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';
        const pendingTasks = tasks.filter(t => t.status !== 'completed');

        if (pendingTasks.length === 0) {
            return `Hi ${firstName}! 🌟 Great job! You have completed all your tasks for today. Keep up the great work!`;
        }

        const taskLines = pendingTasks.map((task, index) => {
            const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
            return `${task.listNumber ?? index + 1}. ${carryPrefix}${task.title} [Pending ⏳]`;
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
    static buildEODSummary(employeeName: string, tasks: Array<ListTask>): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';
        const completed = tasks.filter(t => t.status === 'completed');
        const pending = tasks.filter(t => t.status !== 'completed');

        const taskLines = tasks.map((task, index) => {
            const statusIcon = task.status === 'completed' ? '✅' : '⏳';
            const statusText = task.status === 'completed' ? 'Completed' : 'Pending';
            const carryPrefix = task.isCarriedForward ? '🔄 [Carried Forward] ' : '';
            return `${task.listNumber ?? index + 1}. ${carryPrefix}${task.title} [${statusText} ${statusIcon}]`;
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
        tasks: Array<ListTask>,
        targetDate: string
    ): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';
        const overdue = tasks.filter(t => t.status !== 'completed' && t.assigned_date < targetDate);

        if (overdue.length === 0) {
            return `Hi ${firstName}! ✅ You have no overdue tasks. All past tasks are up to date!`;
        }

        const taskLines = overdue.map((task, index) => {
            const daysOverdue = Math.max(1, Math.round((new Date(targetDate).getTime() - new Date(task.assigned_date).getTime()) / (1000 * 60 * 60 * 24)));
            return `${task.listNumber ?? index + 1}. ${task.title} [⚠️ ${daysOverdue}d overdue]`;
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
        tasks: Array<ListTask>,
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
                return `${task.listNumber ?? index + 1}. ${carryPrefix}${task.title} [${statusText} ${statusIcon}]`;
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
     * task_manager_team_digest_v1: a reporting manager gets their department (one line per person), a superuser gets every
     * department (one line per department).
     *   • 'evening' — with the Evening summary rule, always.
     *   • 'midday'  — with the Midday reminder rule, ONLY when something in that scope is still pending (owner 2026-10-12).
     * Once per person per day per kind (audit `team_digest_sent` with details.kind), so two rules of the same kind never
     * repeat it and midday never blocks evening. Goes through the normal safety gate (kill switches, Pretend Mode).
     */
    static async sendTeamDigests(employees: Employee[], date: string, kind: 'evening' | 'midday' = 'evening'): Promise<number> {
        const managers = employees.filter(e => (e.role === 'reporting_manager' || e.role === 'superuser') && e.phone_number && e.phone_number.trim().length >= 10);
        if (!managers.length) return 0;
        const already = new Set(((await TaskDatabaseService.getAuditLogs({ eventType: 'team_digest_sent', limit: 500 })) || [])
            .filter((r: { details?: { date?: string; kind?: string } }) => r?.details?.date === date && (r?.details?.kind ?? 'evening') === kind).map((r: { target_employee_id?: string }) => r.target_employee_id as string));
        const { TaskProgressService } = await import('./TaskProgressService');
        let org: Awaited<ReturnType<typeof TaskProgressService.getOrganisationProgress>> | null = null;
        let active: Set<string> | null = null;
        const depts = new Map<string, Awaited<ReturnType<typeof TaskProgressService.getDepartmentProgress>>>();
        let sent = 0;
        for (const m of managers) {
            if (already.has(m.id)) continue;
            let input: Parameters<typeof sendTeamDigest>[1];
            if (m.role === 'superuser') {
                // Only departments where the Task Manager is switched ON (owner 2026-10-12).
                org = org ?? await TaskProgressService.getOrganisationProgress(date);
                active = active ?? await TaskAccessService.activeDepartmentIds();
                const live = org.departmentProgress.filter(d => active!.has(d.departmentId));
                const sum = (f: (d: typeof live[number]) => number) => live.reduce((a, d) => a + f(d), 0);
                input = { recipientName: m.name, scope: 'All Active Departments', date, members: sum(d => d.activeEmployeeCount), completed: sum(d => d.completed), pending: Math.max(0, sum(d => d.total) - sum(d => d.completed)),
                    rows: live.map(d => ({ label: d.departmentName, done: d.completed, total: d.total })) };
            } else {
                if (!m.department_id) continue;
                const d = depts.get(m.department_id) ?? await TaskProgressService.getDepartmentProgress(m.department_id, date);
                depts.set(m.department_id, d);
                input = { recipientName: m.name, scope: `${d.departmentName} Department`, date, members: d.activeEmployeeCount, completed: d.completed, pending: Math.max(0, d.total - d.completed),
                    rows: d.employeeProgress.map(p => ({ label: p.employeeName, done: p.completed, total: p.total })) };
            }
            // Midday: only when something in that scope is still pending (owner decision 2026-10-12).
            if (kind === 'midday' && input.pending <= 0) continue;
            if (await sendTeamDigest(m.phone_number, { ...input, departmentId: m.department_id || undefined })) {
                sent++;
                await TaskDatabaseService.logAudit({ eventType: 'team_digest_sent', actorId: m.id, targetEmployeeId: m.id, details: { date, kind, scope: input.scope } });
            }
        }
        return sent;
    }

    /**
     * Active superusers who may receive Task Manager messages — the SAME filters as any rule: sandbox numbers only while the
     * sandbox is ON, and the Task Manager access check (department ON + kickoff recorded).
     */
    static async eligibleSuperusers(): Promise<Employee[]> {
        let supers = (await TaskDatabaseService.getAllEmployees()).filter(e => e.role === 'superuser' && e.active !== false);
        const cfg = await TaskDatabaseService.getTestingConfig();
        if (cfg?.enabled) {
            const allowed = new Set([...(cfg.employees || []).map(e => e.phone), ...(cfg.notifyManager && cfg.manager?.phone ? [cfg.manager.phone] : [])]
                .map(p => String(p || '').replace(/\D/g, '').slice(-10)).filter(Boolean));
            supers = supers.filter(s => allowed.has(String(s.phone_number || '').replace(/\D/g, '').slice(-10)));
        }
        return supers.length ? (await TaskAccessService.partition(supers)).allowed : [];
    }

    /** task_morning_kickoff_v2 has three blanks; v1 (still selectable by env) has one. Decided by the template NAME in use. */
    static usesMorningV2(ruleType: string | undefined): boolean {
        return (!ruleType || ruleType === 'morning_digest') && TaskMessagingService.getCampaignForRuleType(ruleType) !== 'task_morning_kickoff_v1';
    }

    static readonly MORNING_NO_TASKS = 'You have no tasks logged yet. Speak or type your priorities for today to add them to your board.';

    /**
     * task_morning_kickoff_v2 ("Daily Task Standup"): [first name, "12 Oct 2026", one-line summary]. The summary is the
     * task list on ONE line ("You have 3 tasks today: 1. X ⏳ | 2. Y 🔄 | 3. Z ✅") or, with no tasks, a nudge to add them.
     */
    static buildMorningV2Params(employeeName: string, tasks: Array<ListTask>, targetDate: string): [string, string, string] {
        if (!tasks.length) return [firstName(employeeName), formatDate(targetDate), this.MORNING_NO_TASKS];
        const mark = (s: string) => (s === 'completed' ? '✅' : s === 'in_progress' ? '🔄' : '⏳');
        const items = tasks.map((t, i) => `${t.listNumber ?? i + 1}. ${t.isCarriedForward ? '🔄 ' : ''}${oneLine(t.title, 120)} ${mark(t.status)}`);
        let list = '';
        for (let i = 0; i < items.length; i++) {
            const next = list ? `${list} | ${items[i]}` : items[i];
            if (next.length > 650) { list = `${list} | …and ${items.length - i} more`; break; }
            list = next;
        }
        return [firstName(employeeName), formatDate(targetDate), `You have ${tasks.length} task${tasks.length === 1 ? '' : 's'} today: ${list}`];
    }

    static morningV2Preview(p: [string, string, string]): string {
        return `Daily Task Standup 📋\n\nGood morning ${p[0]}!\nYour Task Manager workspace is open for today (${p[1]}).\n${p[2]}\n💡 Quick Guide:\n• 🎙️ Send a voice note or text to add or assign tasks\n• Ask "how is my team doing" to check team progress\n• Reply "tasks" to view your board, or "done 1" when finished`;
    }

    /** Open tasks from an earlier day than `targetDate`. */
    static overdueTasks(tasks: Array<ListTask>, targetDate: string) {
        return tasks.filter(t => t.status !== 'completed' && t.assigned_date < targetDate);
    }

    /**
     * task_overdue_alert_v1: [first name, how many, "1. DG Meter Log (Due: 10 Oct) | 2. Chiller Filter Check (Due: 9 Oct)"].
     * One line only — Meta rejects line breaks inside a template blank. Oldest first; long lists end with "…and N more".
     */
    static buildOverdueTemplateParams(employeeName: string, tasks: Array<ListTask>, targetDate: string): [string, string, string] {
        const overdue = this.overdueTasks(tasks, targetDate).sort((a, b) => a.assigned_date.localeCompare(b.assigned_date));
        const short = (d: string) => formatDate(d).replace(/ \d{4}$/, '');   // "10 Oct"
        const items = overdue.map((t, i) => `${t.listNumber ?? i + 1}. ${oneLine(t.title, 120)} (Due: ${short(t.assigned_date)})`);
        let list = '';
        for (let i = 0; i < items.length; i++) {
            const next = list ? `${list} | ${items[i]}` : items[i];
            if (next.length > 700) { list = `${list} | …and ${items.length - i} more`; break; }
            list = next;
        }
        return [firstName(employeeName), String(overdue.length), list || 'No overdue tasks.'];
    }

    /**
     * Formats task items into a clean list for Meta-approved templates (fills {{1}}).
     * Since the Meta templates already have fixed headers (e.g. "☀️ Good Morning! Here is your daily task kickoff:")
     * and footers, {{1}} receives just the formatted task items list.
     */
    static buildTemplateTaskParam(ruleType: string | undefined, tasks: Array<ListTask>): string {
        if (tasks.length === 0) {
            return 'No tasks assigned for today.';
        }

        // ONE line: Meta rejects line breaks, tabs and long runs of spaces inside a template variable.
        const clean = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();
        const item = (task: ListTask, idx: number, status: string) =>
            `${task.listNumber ?? idx + 1}. ${task.isCarriedForward ? '🔄 ' : ''}${clean(task.title).slice(0, 120)} ${status}`;
        // Keep the whole message well under WhatsApp's 1,024-character body limit.
        const join = (items: string[], max = 700) => {
            let out = '';
            for (let i = 0; i < items.length; i++) {
                const next = out ? `${out} | ${items[i]}` : items[i];
                if (next.length > max) return `${out} | …and ${items.length - i} more`;
                out = next;
            }
            return out;
        };

        if (ruleType === 'eod_summary') {
            const completed = tasks.filter(t => t.status === 'completed');
            const items = tasks.map((task, idx) => item(task, idx, task.status === 'completed' ? '✅' : '⏳'));
            return `Completed ${completed.length}/${tasks.length} — ${join(items)}`;
        }

        if (ruleType === 'pending_reminder') {
            const pending = tasks.filter(t => t.status !== 'completed');
            const targetTasks = pending.length > 0 ? pending : tasks;
            return join(targetTasks.map((task, idx) => item(task, idx, '⏳')));
        }

        // Default / morning_digest:
        return join(tasks.map((task, idx) => item(task, idx, task.status === 'completed' ? '✅' : '⏳')));
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
                : await TaskDatabaseService.getFilteredAssignments({
                    employeeId: emp.id,
                    date: targetDate
                });

            // Condition 1: skip if 0 tasks — EXCEPT the morning standup (task_morning_kickoff_v2) on a rule that says
            // "don't skip": it greets people with no tasks and nudges them to add some (owner request 2026-10-12).
            const greetEmpty = this.usesMorningV2(options.rule?.ruleType) && options.rule?.conditions?.skipIfZeroTasks === false;
            if (tasks.length === 0 && !greetEmpty) {
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

            // Condition 3: an Overdue alert only goes to people who really have something overdue (open, from an earlier day).
            if (options.rule?.ruleType === 'overdue_alert' && !this.overdueTasks(tasks, targetDate).length) {
                skippedNoTasksCount++;
                details.push({ employeeId: emp.id, employeeName: emp.name, phone, taskCount: tasks.length, status: 'skipped_no_tasks', error: 'Nothing overdue' });
                continue;
            }

            // Format message based on rule and customTemplate
            // The morning standup (v2) preview is the template itself filled in, so Pretend Mode / history show what is sent.
            const digest = this.usesMorningV2(options.rule?.ruleType)
                ? this.morningV2Preview(this.buildMorningV2Params(emp.name, tasks, targetDate))
                : this.buildFormattedDigest(options.rule, emp.name, tasks, targetDate);

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
                // task_overdue_alert_v1 has three blanks (name, count, list); the other rule templates have one (the list).
                const templateParams = options.rule?.ruleType === 'overdue_alert'
                    ? this.buildOverdueTemplateParams(emp.name, tasks, targetDate)
                    : this.usesMorningV2(options.rule?.ruleType)
                        ? this.buildMorningV2Params(emp.name, tasks, targetDate)
                        : [this.buildTemplateTaskParam(options.rule?.ruleType, tasks)];
                // Scheduled rules use the approved template directly (set TASK_RULES_TEMPLATE_ONLY=false to go back to free text first).
                const sent = await TaskMessagingService.sendMessage(phone, digest, {
                    departmentId: options.departmentId,
                    ruleType: options.rule?.ruleType,
                    templateParams,
                    templateOnly: process.env.TASK_RULES_TEMPLATE_ONLY !== 'false',
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

        // Evening summary: managers also get the team digest (owner decision 2026-10-12). Never fails the rule itself.
        // Midday reminder: managers / superusers also get their team's progress — only when something is still pending.
        // Superusers get the all-company progress whenever ANY team or company midday rule runs, even when the rule is for
        // another department (owner decision 2026-10-12); once a day. A personal reminder never triggers it.
        if (options.rule?.ruleType === 'pending_reminder' && !options.dryRun) {
            try {
                const extra = options.rule.ownerUserId ? [] : await this.eligibleSuperusers();
                const audience = [...employees, ...extra.filter(s => !employees.some(e => e.id === s.id))];
                await this.sendTeamDigests(audience, targetDate, 'midday');
            }
            catch (err) { console.error('[TaskNotificationService] midday team digest skipped:', err instanceof Error ? err.message : err); }
        }
        // Evening: superusers also get the all-company summary from ANY team or company evening rule, like midday (owner
        // 2026-10-12), so they get it even with no personal tasks. Once a day (audit dedupe in sendTeamDigests).
        if (options.rule?.ruleType === 'eod_summary' && !options.dryRun) {
            try {
                const extra = options.rule.ownerUserId ? [] : await this.eligibleSuperusers();
                await this.sendTeamDigests([...employees, ...extra.filter(s => !employees.some(e => e.id === s.id))], targetDate, 'evening');
            }
            catch (err) { console.error('[TaskNotificationService] team digest skipped:', err instanceof Error ? err.message : err); }
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
