import { NextRequest, NextResponse } from 'next/server';
import { TaskDailyGeneratorService } from '@/task-manager/TaskDailyGeneratorService';
import { TaskNotificationService } from '@/task-manager/TaskNotificationService';
import { requireCronOrAdmin } from '../../_shared/adminGuard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    return handleTrigger(request);
}

export async function POST(request: NextRequest) {
    return handleTrigger(request);
}

async function handleTrigger(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        // Only the scheduler's secret or a signed-in admin may trigger this (no actorId / confirm shortcuts)
        const auth = await requireCronOrAdmin(request);
        if (!auth.ok) return auth.response;

        const date = searchParams.get('date') || undefined;
        const departmentId = searchParams.get('departmentId') || undefined;
        const employeeId = searchParams.get('employeeId') || undefined;
        const dryRun = searchParams.get('dryRun') === 'true';

        // 1. Ensure daily fixed tasks are generated first
        const generatorResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
            date,
            departmentId,
            employeeId
        });

        // 2. Dispatch morning WhatsApp notifications
        const notificationResult = await TaskNotificationService.sendMorningNotifications({
            date,
            departmentId,
            employeeId,
            dryRun
        });

        return NextResponse.json({
            success: notificationResult.success,
            data: {
                generator: generatorResult,
                notifications: notificationResult
            }
        });
    } catch (err: any) {
        console.error('[CronMorningNotifications] Error:', err);
        return NextResponse.json(
            { success: false, error: err.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
