import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveElectricityAccess, isElectricityAccessError } from '@/backend/lib/electricity/access';
import { isMissingRelation } from '@/backend/lib/aop/access';
import { markDisputeResponded } from '@/backend/lib/electricity/disputes';

/**
 * POST /api/electricity/disputes/[id]/respond — multipart/form-data
 *
 * The property admin's free-form answer to a dispute: a text body plus any number of
 * supporting files. Files land in the private `electricity-bills` bucket (the same one
 * bill PDFs use, provisioned in Phase 1); the response row stores only their metadata
 * ([{storage_path, file_name, mime_type}]) so the thread stays portable.
 *
 * Who may respond: the dispute's assigned property admin, or anyone with electricity
 * tracker access to the org (checker adding context). Resolving (accept/reject) is NOT
 * here — that is a checker action on the disputes route.
 *
 * Fields: `body` (required text), `files` (0..n File entries).
 */

export const dynamic = 'force-dynamic';

const BUCKET = 'electricity-bills';

interface DisputeRow {
    id: string;
    organization_id: string;
    status: string;
    assigned_property_admin: string | null;
}

async function authenticate(request: NextRequest): Promise<{ id: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { id: user.id };

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const { data: { user: tokenUser } } = await supabaseAdmin.auth.getUser(token);
        if (tokenUser) return { id: tokenUser.id };
    }
    return null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: dispute, error: dErr } = await supabaseAdmin
        .from('electricity_disputes')
        .select('id, organization_id, status, assigned_property_admin')
        .eq('id', id)
        .maybeSingle();

    if (dErr) {
        if (isMissingRelation(dErr)) return NextResponse.json({ provisioned: false });
        console.error('[electricity dispute respond]', dErr.message);
        return NextResponse.json({ error: 'Could not load dispute' }, { status: 500 });
    }
    if (!dispute) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    const row = dispute as DisputeRow;

    if (row.status !== 'open' && row.status !== 'responded') {
        return NextResponse.json({ error: `Dispute is already ${row.status}` }, { status: 409 });
    }

    // Assigned property admin always may; anyone else needs tracker access to the org.
    if (row.assigned_property_admin !== user.id) {
        const access = await resolveElectricityAccess(request, row.organization_id);
        if (isElectricityAccessError(access)) return access;
    }

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const body = String(form.get('body') || '').trim();
    if (!body) return NextResponse.json({ error: 'body is required' }, { status: 400 });

    const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

    const attachments: { storage_path: string; file_name: string; mime_type: string }[] = [];
    for (const file of files) {
        const safeName = file.name.replace(/[^\w.\-]+/g, '_');
        const path = `${row.organization_id}/disputes/${row.id}/${Date.now()}_${safeName}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const { data: up, error: upErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, buffer, { upsert: false, contentType: file.type });
        if (upErr) {
            console.error('[electricity dispute respond] upload:', upErr.message);
            return NextResponse.json({ error: `Upload failed for ${file.name}` }, { status: 500 });
        }
        attachments.push({ storage_path: up.path, file_name: file.name, mime_type: file.type });
    }

    const { data: response, error: rErr } = await supabaseAdmin
        .from('electricity_dispute_responses')
        .insert({
            dispute_id: row.id,
            author_id: user.id,
            body,
            attachments,
        })
        .select('*')
        .single();

    if (rErr) {
        if (isMissingRelation(rErr)) return NextResponse.json({ provisioned: false });
        console.error('[electricity dispute respond] insert:', rErr.message);
        return NextResponse.json({ error: 'Could not save response' }, { status: 500 });
    }

    // open -> responded; on an already-responded dispute this is a no-op by design
    // (follow-up messages in the same thread don't move the status backwards).
    const statusResult = await markDisputeResponded(row.id);
    if (!statusResult.ok && statusResult.provisioned !== false) {
        console.error('[electricity dispute respond] status flip:', statusResult.error);
    }

    return NextResponse.json({ response }, { status: 201 });
}
