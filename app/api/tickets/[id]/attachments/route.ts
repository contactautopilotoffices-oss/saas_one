import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import {
    MAX_TICKET_ATTACHMENT_BYTES,
    TicketAttachmentError,
    listTicketAttachments,
    removeTicketAttachment,
    uploadTicketAttachment,
} from '@/backend/lib/ticketing/attachments';

export const dynamic = 'force-dynamic';

/**
 * Owner 2026-11-03: files on a request (ticket).
 *   GET    /api/tickets/[id]/attachments                 the request's files, each with a link that works for 10 minutes
 *   POST   /api/tickets/[id]/attachments  (form: file)   attach one file (PDF, Word, Excel, PNG/JPG/WEBP; 10 MB; 5 per request)
 *   DELETE /api/tickets/[id]/attachments?attachmentId=…  remove a file (only whoever attached it)
 *
 * WHO is acting always comes from the signed-in session; access to the request is checked with that session's own
 * row level security, the same way GET /api/tickets/[id] opens the request.
 */

function fail(err: unknown) {
    if (err instanceof TicketAttachmentError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    console.error('[TicketAttachmentsAPI] error:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const attachments = await listTicketAttachments(supabase, user.id, id);
        return NextResponse.json({ attachments });
    } catch (err) {
        return fail(err);
    }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        // Refuse an oversized upload before reading it (the form adds a little on top of the file itself)
        const declared = Number(request.headers.get('content-length') || 0);
        if (declared > MAX_TICKET_ATTACHMENT_BYTES + 64 * 1024) return NextResponse.json({ error: 'Choose a file up to 10 MB.' }, { status: 413 });
        const form = await request.formData().catch(() => null);
        const file = form?.get('file');
        if (!(file instanceof File) || !file.size || file.size > MAX_TICKET_ATTACHMENT_BYTES) {
            return NextResponse.json({ error: 'Choose a file up to 10 MB.' }, { status: 400 });
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await uploadTicketAttachment(supabase, user.id, { ticketId: id, fileName: file.name, bytes });
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return fail(err);
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const result = await removeTicketAttachment(supabase, user.id, id, request.nextUrl.searchParams.get('attachmentId'));
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return fail(err);
    }
}
