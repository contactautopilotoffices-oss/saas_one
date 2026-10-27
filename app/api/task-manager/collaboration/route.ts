import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { WorkspaceError } from '@/task-manager/WorkspaceService';
import { CollaborationService } from '@/task-manager/CollaborationService';
import { PermissionDeniedError } from '@/task-manager/PermissionService';

export const dynamic = 'force-dynamic';

/**
 * Owner 2026-10-26: cross-department collaboration (the Send tab's "Other departments").
 *   GET  /api/task-manager/collaboration                    people in other departments + what I sent + what was asked of me
 *   POST { action: 'send' | 'respond' | 'remind' | 'check_duplicate', ... }
 *
 * WHO is acting always comes from the signed-in session; the request body can never name the actor.
 */
async function sessionUserId(): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
}

function fail(err: unknown) {
    if (err instanceof WorkspaceError) return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.status });
    if (err instanceof PermissionDeniedError) return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 403 });
    console.error('[CollaborationAPI] error:', err);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
}

export async function GET() {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        const [people, overview] = await Promise.all([CollaborationService.people(userId), CollaborationService.overview(userId)]);
        return NextResponse.json({ success: true, people, ...overview });
    } catch (err) {
        return fail(err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        const body = (await request.json().catch(() => null)) ?? {};

        if (body.action === 'send') {
            const result = await CollaborationService.send(userId, {
                targetUserId: body.targetUserId, kind: body.kind, title: body.title, description: body.description, neededBy: body.neededBy || undefined, dueTime: body.dueTime || undefined,
            });
            return NextResponse.json({ success: true, ...result });
        }
        if (body.action === 'respond') {
            const result = await CollaborationService.respond(userId, { requestId: body.requestId, accept: body.accept, reason: body.reason });
            return NextResponse.json({ success: true, ...result });
        }
        if (body.action === 'remind') {
            const result = await CollaborationService.remind(userId, body.taskIds);
            return NextResponse.json({ success: true, ...result });
        }
        if (body.action === 'check_duplicate') {
            const result = await CollaborationService.checkDuplicate(userId, { targetUserId: body.targetUserId, title: body.title });
            return NextResponse.json({ success: true, ...result });
        }
        return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    } catch (err) {
        return fail(err);
    }
}
