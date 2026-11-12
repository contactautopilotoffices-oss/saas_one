import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { WorkspaceError } from '@/task-manager/WorkspaceService';
import { MAX_ATTACHMENT_BYTES, TaskAttachmentService } from '@/task-manager/TaskAttachmentService';
import { PermissionDeniedError } from '@/task-manager/PermissionService';

export const dynamic = 'force-dynamic';

/**
 * Owner 2026-10-26: files on a task.
 *   GET  /api/task-manager/attachments?taskId=…            the task's files, each with a link that works for 10 minutes
 *   POST /api/task-manager/attachments  (form: file, taskId — repeat taskId to list one file on several tasks)
 *   GET  ?requestId=… / POST (form: file, requestId)   owner 2026-10-26: files sent with a support request
 *   DELETE ?id=…                                        owner 2026-10-27: remove a file attached by mistake (whoever attached it, or a superuser)
 *
 * WHO is acting always comes from the signed-in session; the service checks that they may see each task.
 */
async function sessionUserId(): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
}

function fail(err: unknown) {
    if (err instanceof WorkspaceError) return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: err.status });
    if (err instanceof PermissionDeniedError) return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 403 });
    console.error('[TaskAttachmentsAPI] error:', err);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
}

export async function GET(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        const requestId = request.nextUrl.searchParams.get('requestId');
        const attachments = requestId
            ? await TaskAttachmentService.listForRequest(userId, requestId)
            : await TaskAttachmentService.list(userId, request.nextUrl.searchParams.get('taskId') || undefined);
        return NextResponse.json({ success: true, attachments });
    } catch (err) {
        return fail(err);
    }
}

export async function POST(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        // Refuse an oversized upload before reading it (the form adds a little on top of the file itself)
        const declared = Number(request.headers.get('content-length') || 0);
        if (declared > MAX_ATTACHMENT_BYTES + 64 * 1024) return NextResponse.json({ success: false, error: 'Choose a file up to 10 MB.' }, { status: 413 });
        const form = await request.formData().catch(() => null);
        const file = form?.get('file');
        if (!(file instanceof File) || !file.size || file.size > MAX_ATTACHMENT_BYTES) {
            return NextResponse.json({ success: false, error: 'Choose a file up to 10 MB.' }, { status: 400 });
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const requestId = form?.get('requestId');
        if (typeof requestId === 'string' && requestId) {
            const result = await TaskAttachmentService.uploadToRequest(userId, { requestId, fileName: file.name, bytes });
            return NextResponse.json({ success: true, ...result });
        }
        const taskIds = (form?.getAll('taskId') || []).filter((x): x is string => typeof x === 'string');
        const result = await TaskAttachmentService.upload(userId, { taskIds, fileName: file.name, bytes });
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return fail(err);
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        const result = await TaskAttachmentService.remove(userId, request.nextUrl.searchParams.get('id') || undefined);
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return fail(err);
    }
}
