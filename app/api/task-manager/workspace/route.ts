import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { WorkspaceService, WorkspaceError } from '@/task-manager/WorkspaceService';
import { PermissionDeniedError } from '@/task-manager/PermissionService';

export const dynamic = 'force-dynamic';

/**
 * Step 5 — the Procurement "Tasks" tab.
 *   GET  /api/task-manager/workspace?date=YYYY-MM-DD[&department=Procurement]
 *   POST /api/task-manager/workspace   { action: 'assign' | 'set_status', ... }
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

        const workspace = await WorkspaceService.load(userId, {
            date: request.nextUrl.searchParams.get('date') || undefined,
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
            });
            return NextResponse.json({ success: true, task });
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
