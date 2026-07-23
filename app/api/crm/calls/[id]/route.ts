import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveCrmAccess, isCrmAccessError, canAccessCall } from '@/backend/lib/crm/access';

const BUCKET = 'crm-call-recordings';
const SIGNED_URL_TTL = 60 * 60; // 1 hour

/**
 * GET /api/crm/calls/[id]
 * Returns the full call row (transcript + coaching report + signed playback URL).
 * The signed URL is regenerated on every request so a leaked URL expires fast.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const { data: call, error } = await supabaseAdmin
        .from('crm_calls')
        .select(
            `
            id, organization_id, lead_id, bd_rep_id, status, error_message,
            recording_url, duration_seconds, file_size_bytes, mime_type,
            transcript, summary, coaching, overall_score, rep_talk_ratio,
            lead_company_name_snapshot, lead_contact_person_snapshot,
            uploaded_at, analyzed_at,
            rep:users!crm_calls_bd_rep_id_fkey(id, full_name, email)
        `
        )
        .eq('id', id)
        .maybeSingle();

    if (error || !call) {
        return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    const access = await resolveCrmAccess(request, call.organization_id);
    if (isCrmAccessError(access)) return access;
    if (!canAccessCall(call, access)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Mint a short-lived signed URL for playback
    let playbackUrl: string | null = null;
    if (call.recording_url) {
        const { data: signed, error: signErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(call.recording_url, SIGNED_URL_TTL);
        if (!signErr) playbackUrl = signed?.signedUrl ?? null;
    }

    return NextResponse.json({
        call: {
            id: call.id,
            leadId: call.lead_id,
            bdRepId: call.bd_rep_id,
            rep: call.rep,
            status: call.status,
            errorMessage: call.error_message,
            durationSeconds: call.duration_seconds,
            fileSizeBytes: call.file_size_bytes,
            mimeType: call.mime_type,
            transcript: call.transcript,
            summary: call.summary,
            coaching: call.coaching,
            overallScore: call.overall_score,
            repTalkRatio: call.rep_talk_ratio,
            leadCompanyName: call.lead_company_name_snapshot,
            leadContactPerson: call.lead_contact_person_snapshot,
            uploadedAt: call.uploaded_at,
            analyzedAt: call.analyzed_at,
            playbackUrl,
        },
    });
}

/**
 * DELETE /api/crm/calls/[id]
 * Soft-archive (admins or the owning rep). Hard-delete is not exposed —
 * we keep call history for trend analysis.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const { data: call } = await supabaseAdmin
        .from('crm_calls')
        .select('id, organization_id, bd_rep_id')
        .eq('id', id)
        .maybeSingle();

    if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 });

    const access = await resolveCrmAccess(request, call.organization_id);
    if (isCrmAccessError(access)) return access;
    if (!canAccessCall(call, access)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
        .from('crm_calls')
        .update({ is_archived: true, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
