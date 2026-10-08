import { NextRequest, NextResponse } from 'next/server';
import { TaskNotificationService } from '@/task-manager/TaskNotificationService';
import { TaskDailyGeneratorService } from '@/task-manager/TaskDailyGeneratorService';
import { TaskMessagingService } from '@/task-manager/TaskMessagingService';
import { requireTaskManagerAdmin } from '../_shared/adminGuard';

export const dynamic = 'force-dynamic';

/**
 * POST /api/task-manager/reminders
 * Trigger reminders manually from the Super Admin Console.
 */
export async function POST(request: NextRequest) {
    try {
        const guard = await requireTaskManagerAdmin();
        if (!guard.ok) return guard.response;

        const body = await request.json().catch(() => ({}));
        const { action = 'morning_digest', dryRun = false, phone, name } = body;

        if (action === 'nudge_member') {
            if (!phone) {
                return NextResponse.json({ ok: false, error: 'Phone number is required' }, { status: 400 });
            }
            const message = `Hello ${name || 'there'}! 👋 This is a quick friendly reminder from your Task Manager. Please review and update your pending tasks for today. Reply "tasks" anytime to see your list.`;
            if (!dryRun) {
                await TaskMessagingService.sendMessage(phone, message);
            }
            return NextResponse.json({
                ok: true,
                message: `Sent WhatsApp nudge to ${name || phone}`,
                details: { phone, dryRun }
            });
        }

        if (action === 'morning_digest') {
            await TaskDailyGeneratorService.generateDailyFixedTasks();
            const result = await TaskNotificationService.sendMorningNotifications({ dryRun });
            return NextResponse.json({
                ok: true,
                message: `Sent morning priority digest to ${result.notificationsSent} team members.`,
                result,
            });
        }

        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    } catch (err: any) {
        console.error('[TaskManagerRemindersAPI] Error:', err);
        return NextResponse.json({ ok: false, error: err?.message || 'Internal server error' }, { status: 500 });
    }
}
