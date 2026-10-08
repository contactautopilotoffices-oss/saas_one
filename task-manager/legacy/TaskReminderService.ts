import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppService } from '@/backend/services/WhatsAppService';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { TaskManagerService } from './TaskManagerService';

export class TaskReminderService {
    /**
     * Get current date in Indian Standard Time (YYYY-MM-DD).
     */
    static getTodayIST(): string {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    }

    /**
     * Helper to send WhatsApp text / template to an enrolled employee via AiSensy.
     */
    private static async sendWhatsApp(phone: string, text: string, name?: string): Promise<{ success: boolean; error?: string }> {
        const campaignName = process.env.AISENSY_TASK_CAMPAIGN_NAME || 'tm_daily_report_nudge_v1';
        try {
            const res = await AiSensyService.sendTemplate({
                phone,
                campaignName,
                userName: name || 'User',
                templateParams: [name || 'Team Member'],
            });

            if (!res.success) {
                console.warn(`[TaskReminderService] AiSensy delivery note for ${phone} (${campaignName}):`, res.error);
            }
            return res;
        } catch (err: any) {
            console.warn(`[TaskReminderService] Failed to send WhatsApp to ${phone}:`, err);
            return { success: false, error: err?.message || 'Delivery failed' };
        }
    }

    /**
     * Send an EOD reminder to an individual team member.
     */
    static async sendSingleMemberNudge(params: {
        phone: string;
        name?: string;
        dryRun?: boolean;
    }): Promise<{ success: boolean; error?: string; message?: string }> {
        const { phone, name = 'Team Member', dryRun = false } = params;
        if (!phone) {
            return { success: false, error: 'Phone number is required' };
        }

        if (dryRun) {
            return { success: true, message: `[Dry Run] Simulated WhatsApp reminder to ${name} (${phone})` };
        }

        const res = await this.sendWhatsApp(phone, `Hi ${name}, please share your daily EOD report update.`, name);
        return {
            success: res.success,
            error: res.error,
            message: res.success
                ? `Sent WhatsApp reminder to ${name} via Autopilot Offices Bot.`
                : (res.error || 'Failed to send WhatsApp message'),
        };
    }

    /**
     * 1. Evening EOD Report Nudges:
     * Finds active employees who have NOT submitted their daily report for today and sends a targeted reminder.
     */
    static async sendDailyReportNudges(options: { dryRun?: boolean } = {}): Promise<{
        date: string;
        totalMembers: number;
        submittedCount: number;
        missingCount: number;
        nudgedMembers: Array<{ name: string; phone: string; department: string }>;
    }> {
        const todayStr = this.getTodayIST();

        // 1. Fetch active members
        let members: any[] = [];
        try {
            const { data } = await supabaseAdmin
                .from('tm_members')
                .select('*')
                .eq('is_active', true);
            members = data || [];
        } catch (err) {
            console.warn('[TaskReminderService] tm_members query error:', err);
        }



        // 2. Fetch reports submitted today
        const { data: reports } = await supabaseAdmin
            .from('tm_daily_reports')
            .select('user_id')
            .eq('report_date', todayStr);

        const submittedUserIds = new Set((reports || []).map(r => r.user_id));

        const missingMembers = members.filter(m => !submittedUserIds.has(m.user_id));
        const nudgedMembers: Array<{ name: string; phone: string; department: string }> = [];

        for (const member of missingMembers) {
            const message = [
                `⏰ *Evening Check-in: Daily Work Report*`,
                ``,
                `Hi *${member.full_name}*! Please remember to share your work summary for today.`,
                ``,
                `👉 Simply reply:`,
                `*daily report: <summary of what you accomplished today>*`,
                ``,
                `_Example: daily report: Finished tech architecture review and resolved 2 blocking PRs._`,
                ``,
                `Logging your daily report keeps the team synchronized and co-founders updated. Have a great evening! ✨`,
            ].join('\n');

            if (!options.dryRun && member.phone) {
                await this.sendWhatsApp(member.phone, message, member.full_name);
            }

            nudgedMembers.push({
                name: member.full_name,
                phone: member.phone,
                department: member.department,
            });
        }

        return {
            date: todayStr,
            totalMembers: members.length,
            submittedCount: members.length - missingMembers.length,
            missingCount: missingMembers.length,
            nudgedMembers,
        };
    }

    /**
     * 2. Morning Pending Deliverables Digest:
     * Sends employees a morning snapshot of their active tasks to align daily priorities.
     */
    static async sendMorningTaskDigest(options: { dryRun?: boolean } = {}): Promise<{
        date: string;
        sentCount: number;
        recipients: string[];
    }> {
        const todayStr = this.getTodayIST();

        let members: any[] = [];
        try {
            const { data } = await supabaseAdmin
                .from('tm_members')
                .select('*')
                .eq('is_active', true);
            members = data || [];
        } catch (err) {
            console.warn('[TaskReminderService] tm_members query error:', err);
        }



        const recipients: string[] = [];

        for (const member of members) {
            const tasks = await TaskManagerService.listTasks({
                userId: member.user_id,
                statusFilter: 'active',
            });

            if (tasks.length === 0) continue; // Skip employees with no active tasks

            const taskLines = tasks.slice(0, 5).map((t, idx) => {
                return `• *#${idx + 1}. ${t.title}*`;
            });

            const dateFormatted = new Date().toLocaleDateString('en-IN', {
                timeZone: 'Asia/Kolkata',
                weekday: 'short',
                day: 'numeric',
                month: 'short',
            });

            const message = [
                `🌅 *Good Morning, ${member.full_name}!*`,
                `📅 *${dateFormatted}*`,
                ``,
                `Here are your planned tasks for today:`,
                ``,
                taskLines.join('\n'),
                ``,
                `💡 *Actions:*`,
                `• Reply *done #1* when completed`,
                `• Reply *create task: <title>* to add another`,
                `• Reply *daily report: <summary>* at end of day`,
                ``,
                `Have a productive day! 🚀`,
            ].join('\n');

            if (!options.dryRun && member.phone) {
                await this.sendWhatsApp(member.phone, message);
            }

            recipients.push(member.full_name);
        }

        return {
            date: todayStr,
            sentCount: recipients.length,
            recipients,
        };
    }

    /**
     * 3. Superuser Leadership Evening Rollup:
     * Compiles an executive summary of tasks, completions, and missing reports for leadership.
     */
    static async sendSuperuserEveningRollup(options: { dryRun?: boolean } = {}): Promise<{
        date: string;
        superusersNotified: string[];
        summary: {
            activeTasks: number;
            completedToday: number;
            missingReportsCount: number;
            missingEmployeeNames: string[];
        };
    }> {
        const todayStr = this.getTodayIST();

        // 1. Fetch superusers
        let superusers: any[] = [];
        try {
            const { data } = await supabaseAdmin
                .from('tm_members')
                .select('*')
                .eq('is_superuser', true)
                .eq('is_active', true);
            superusers = data || [];
        } catch (err) {
            console.warn('[TaskReminderService] tm_members superusers query error:', err);
        }



        // 2. Fetch stats
        const { count: activeTasksCount } = await supabaseAdmin
            .from('tm_tasks')
            .select('*', { count: 'exact', head: true })
            .in('status', ['pending', 'in_progress']);

        const { count: completedTodayCount } = await supabaseAdmin
            .from('tm_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'completed')
            .gte('updated_at', `${todayStr}T00:00:00Z`);

        const missingMembers = await TaskManagerService.getMissingDailyReports();

        // 3. Format message
        const missingLines = missingMembers.length === 0
            ? '🎉 _All team members submitted their reports today!_'
            : missingMembers.map(m => `• ${m.name} (${m.department})`).join('\n');

        const dateFormatted = new Date().toLocaleDateString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });

        const rollupMessage = [
            `👑 *Daily Executive Task Rollup*`,
            `📅 *Date:* ${dateFormatted}`,
            ``,
            `📊 *High-Level Deliverables:*`,
            `• Active Deliverables: *${activeTasksCount || 0}*`,
            `• Completed Today: *${completedTodayCount || 0}* ✅`,
            ``,
            `⚠️ *Missing Daily Reports (${missingMembers.length}):*`,
            missingLines,
            ``,
            `💡 *Leadership Actions:*`,
            `• Reply *"What did <Department> work on today?"* for team deep-dives`,
            `• Reply *"Show pending tasks for <Name>"* for employee details`,
            `• Open Web Console → *System & Personal → Task Manager*`,
        ].join('\n');

        const superusersNotified: string[] = [];

        for (const su of superusers) {
            if (!options.dryRun && su.phone) {
                await this.sendWhatsApp(su.phone, rollupMessage);
            }
            superusersNotified.push(su.full_name);
        }

        return {
            date: todayStr,
            superusersNotified,
            summary: {
                activeTasks: activeTasksCount || 0,
                completedToday: completedTodayCount || 0,
                missingReportsCount: missingMembers.length,
                missingEmployeeNames: missingMembers.map(m => m.name),
            },
        };
    }
}
