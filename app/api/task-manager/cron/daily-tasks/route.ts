import { NextRequest, NextResponse } from 'next/server';
import { TaskDailyGeneratorService } from '@/task-manager/TaskDailyGeneratorService';
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

        const result = await TaskDailyGeneratorService.generateDailyFixedTasks({
            date,
            departmentId,
            employeeId
        });

        return NextResponse.json({
            success: result.success,
            data: result
        });
    } catch (err: any) {
        console.error('[CronDailyTasks] Unhandled exception:', err);
        return NextResponse.json(
            { success: false, error: err.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
