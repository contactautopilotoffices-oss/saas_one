import { TaskDatabaseService } from './TaskDatabaseService';
import { TaskMessagingService } from './TaskMessagingService';
import { TaskDailyGeneratorService } from './TaskDailyGeneratorService';
import { Employee, TaskAssignment } from './types';

export interface MorningNotificationOptions {
    date?: string; // YYYY-MM-DD
    departmentId?: string;
    employeeId?: string;
    dryRun?: boolean; // If true, builds digests without sending network requests
}

export interface MorningNotificationResult {
    success: boolean;
    date: string;
    totalEmployeesChecked: number;
    notificationsSent: number;
    skippedNoTasks: number;
    skippedNoPhone: number;
    failed: number;
    details: Array<{
        employeeId: string;
        employeeName: string;
        phone: string;
        taskCount: number;
        status: 'sent' | 'skipped_no_tasks' | 'skipped_no_phone' | 'failed';
        error?: string;
        digestPreview?: string;
    }>;
}

export class TaskNotificationService {
    /**
     * Formats the morning task digest message with numbering and quick-reply instructions.
     */
    static buildMorningDigest(employeeName: string, tasks: TaskAssignment[]): string {
        const firstName = employeeName.trim().split(' ')[0] || 'there';

        if (tasks.length === 0) {
            return `Good morning ${firstName}! 📋\n\nYou have no tasks assigned for today. Have a productive day!`;
        }

        const taskLines = tasks.map((task, index) => {
            const statusIcon = task.status === 'completed' ? '✅' : '⏳';
            const statusText = task.status === 'completed' ? 'Completed' : 'Pending';
            return `${index + 1}. ${task.title} [${statusText} ${statusIcon}]`;
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
        if (options.employeeId) {
            const emp = await TaskDatabaseService.getEmployeeById(options.employeeId);
            if (emp && emp.active) employees = [emp];
        } else if (options.departmentId) {
            employees = await TaskDatabaseService.getEmployeesByDepartment(options.departmentId);
        } else {
            employees = await TaskDatabaseService.getAllEmployees();
        }


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

            // Fetch today's tasks
            const tasks = await TaskDatabaseService.getDailyAssignments({
                employeeId: emp.id,
                date: targetDate
            });

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

            const digest = this.buildMorningDigest(emp.name, tasks);

            if (options.dryRun) {
                sentCount++;
                details.push({
                    employeeId: emp.id,
                    employeeName: emp.name,
                    phone,
                    taskCount: tasks.length,
                    status: 'sent',
                    digestPreview: digest
                });
                continue;
            }

            // Dispatch message via TaskMessagingService
            try {
                const sent = await TaskMessagingService.sendMessage(phone, digest);

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
                            type: 'morning_task_digest',
                            taskCount: tasks.length,
                            date: targetDate
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
            failed: failedCount,
            details
        };
    }
}
