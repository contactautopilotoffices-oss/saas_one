import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { WorkspaceService, WorkspaceError } from '@/task-manager/WorkspaceService';
import { PermissionDeniedError } from '@/task-manager/PermissionService';

export const dynamic = 'force-dynamic';

/**
 * Step 5 — the Procurement "Tasks" tab.
 *   GET  /api/task-manager/workspace?date=YYYY-MM-DD[&department=Procurement]
 *   GET  /api/task-manager/workspace?scope=console   (superusers: my tasks + tasks I gave, all departments)
 *   GET  /api/task-manager/workspace?scope=assigned&from=&to=   ("Assigned by me")
 *   POST /api/task-manager/workspace   { action: 'assign' | 'set_status' | 'hand_over' | 'delete_task' | 'set_locked' | 'edit_task' | 'flag_dependency' | 'remind_tasks' | 'add_note', ... }
 *
 * WHO is acting always comes from the signed-in session. The request body can never name the actor,
 * so nobody can act as someone else (unlike the older /tasks route that trusts an actorId).
 */
async function sessionUserId(): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
}

function fail(err: unknown) {
    if (err instanceof WorkspaceError) {
        return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof PermissionDeniedError) {
        return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 403 });
    }
    console.error('[WorkspaceAPI] error:', err);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Something went wrong' }, { status: 500 });
}

export async function GET(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        // The superuser's cross-department view (the console "My tasks" sub-tab). Superusers only; the service checks.
        if (request.nextUrl.searchParams.get('scope') === 'console') {
            const from = request.nextUrl.searchParams.get('from'), to = request.nextUrl.searchParams.get('to');
            const consoleView = await WorkspaceService.loadConsole(userId, from && to ? { from, to } : undefined);
            return NextResponse.json({ success: true, console: consoleView });
        }

        // Owner 2026-10-19: "Assigned by me" (tasks I gave; tasks given by people below me, view only).
        if (request.nextUrl.searchParams.get('scope') === 'assigned') {
            const result = await WorkspaceService.loadAssigned(userId, {
                from: request.nextUrl.searchParams.get('from') || undefined,
                to: request.nextUrl.searchParams.get('to') || undefined,
            });
            return NextResponse.json({ success: true, assigned: result.tasks });
        }

        const workspace = await WorkspaceService.load(userId, {
            // Owner 2026-10-15: a date range (from / to); the old single `date` still works.
            date: request.nextUrl.searchParams.get('from') || request.nextUrl.searchParams.get('date') || undefined,
            to: request.nextUrl.searchParams.get('to') || undefined,
            departmentName: request.nextUrl.searchParams.get('department') || undefined,
        });
        return NextResponse.json({ success: true, workspace });
    } catch (err) {
        return fail(err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        const body = await request.json().catch(() => ({}));

        if (body.action === 'assign') {
            const task = await WorkspaceService.assign(userId, {
                targetUserId: body.targetUserId,
                title: body.title,
                description: body.description,
                date: body.date,
                note: body.note,
            });
            return NextResponse.json({ success: true, task });
        }

        if (body.action === 'hand_over') {
            const result = await WorkspaceService.handOver(userId, { taskId: body.taskId, targetUserId: body.targetUserId, note: body.note });
            return NextResponse.json({ success: true, task: result.task, toName: result.toName });
        }

        if (body.action === 'set_locked') {
            const result = await WorkspaceService.setLocked(userId, { taskId: body.taskId, locked: body.locked });
            return NextResponse.json({ success: true, locked: result.locked });
        }

        if (body.action === 'delete_task') {
            const result = await WorkspaceService.deleteTask(userId, { taskId: body.taskId });
            return NextResponse.json({ success: true, id: result.id });
        }

        if (body.action === 'edit_task') {
            const result = await WorkspaceService.editTask(userId, { taskId: body.taskId, title: body.title, description: body.description });
            return NextResponse.json({ success: true, id: result.id });
        }

        if (body.action === 'flag_dependency') {
            const result = await WorkspaceService.flagDependency(userId, { taskId: body.taskId, targetUserId: body.targetUserId });
            return NextResponse.json({ success: true, toName: result.toName });
        }

        if (body.action === 'add_note') {
            const result = await WorkspaceService.addNote(userId, { taskId: body.taskId, note: body.note });
            return NextResponse.json({ success: true, id: result.id });
        }

        if (body.action === 'remind_tasks') {
            const result = await WorkspaceService.remindTasks(userId, { taskIds: body.taskIds });
            return NextResponse.json({ success: true, ...result });
        }

        if (body.action === 'set_status') {
            const task = await WorkspaceService.setStatus(userId, { taskId: body.taskId, status: body.status });
            return NextResponse.json({ success: true, task });
        }

        return NextResponse.json({ success: false, error: `Invalid action: ${body.action}` }, { status: 400 });
    } catch (err) {
        return fail(err);
    }
}
