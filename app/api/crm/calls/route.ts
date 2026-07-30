import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    resolveCrmAccess,
    isCrmAccessError,
    readOrgId,
    canAccessLead,
} from '@/backend/lib/crm/access';
import { runAnalysisPipeline } from '@/backend/lib/coaching/pipeline';

const BUCKET = 'crm-call-recordings';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB — matches bucket limit
const ALLOWED_MIME = new Set([
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
    'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/ogg', 'audio/webm',
]);

/**
 * POST /api/crm/calls
 * Multipart form: file=<audio>, lead_id=<uuid>, called_at?<iso>
 * Uploads to Supabase Storage, inserts a crm_calls row, and runs the
 * Whisper + Groq pipeline inline. For the MVP we run synchronously because
 * the longest calls stay under 60s. If we ever exceed that, switch to
 * returning { call_id, status: 'processing' } and polling.
 */
export async function POST(request: NextRequest) {
    // 1. Auth + access
    const body = await readFormSafely(request);
    const orgIdHint = readOrgId(request, body?.asObject ?? null);
    const access = await resolveCrmAccess(request, orgIdHint);
    if (isCrmAccessError(access)) return access;

    // 2. Parse form
    if (!body || !body.file || !body.leadId) {
        return NextResponse.json(
            { error: 'file and lead_id are required' },
            { status: 400 }
        );
    }

    const { file, leadId, calledAt } = body;

    if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
            { error: `File too large (max ${MAX_FILE_SIZE / (1024 * 1024)} MB)` },
            { status: 413 }
        );
    }
    if (file.type && !ALLOWED_MIME.has(file.type)) {
        return NextResponse.json(
            { error: `Unsupported mime type: ${file.type}` },
            { status: 415 }
        );
    }

    // 3. Verify the rep can act on the lead
    const { data: lead, error: leadErr } = await supabaseAdmin
        .from('crm_leads')
        .select('id, organization_id, created_by, assigned_to, city, location, campaign, company_name, contact_person')
        .eq('id', leadId)
        .maybeSingle();

    if (leadErr || !lead) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    if (!canAccessLead(lead, access)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Upload to Supabase Storage
    const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
    const safeExt = ['mp3', 'wav', 'm4a', 'ogg', 'webm'].includes(ext) ? ext : 'mp3';
    const storagePath = `${access.organizationId}/${leadId}/${Date.now()}_${access.user.id}.${safeExt}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
            contentType: file.type || `audio/${safeExt}`,
            upsert: false,
        });

    if (uploadErr) {
        console.error('[crm/calls] upload error:', uploadErr);
        return NextResponse.json(
            { error: `Storage upload failed: ${uploadErr.message}` },
            { status: 500 }
        );
    }

    // 5. Insert crm_calls row
    const { data: callRow, error: insertErr } = await supabaseAdmin
        .from('crm_calls')
        .insert({
            organization_id: access.organizationId,
            lead_id: leadId,
            bd_rep_id: access.user.id,
            status: 'uploaded',
            recording_url: storagePath,
            file_size_bytes: file.size,
            mime_type: file.type || `audio/${safeExt}`,
            lead_company_name_snapshot: lead.company_name,
            lead_contact_person_snapshot: lead.contact_person,
            uploaded_at: calledAt ?? new Date().toISOString(),
        })
        .select('id, status, uploaded_at')
        .single();

    if (insertErr || !callRow) {
        console.error('[crm/calls] insert error:', insertErr);
        // Try to roll back the storage upload
        await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
        return NextResponse.json(
            { error: insertErr?.message ?? 'Failed to create call row' },
            { status: 500 }
        );
    }

    // 6. Run the analysis pipeline. We do this inline so the UI can render
    //    the report on the next request without polling. For very long files
    //    we will hit the route's max duration — at that point we should
    //    return 202 + the call_id and let the client poll.
    try {
        const result = await runAnalysisPipeline(callRow.id);
        if (!result.ok) {
            return NextResponse.json(
                { call_id: callRow.id, status: 'failed', error: result.error },
                { status: 200 } // the row exists, even if analysis failed
            );
        }
        return NextResponse.json({
            call_id: callRow.id,
            status: 'completed',
            overall_score: result.report.overall_score,
        });
    } catch (err) {
        console.error('[crm/calls] pipeline crash:', err);
        return NextResponse.json(
            {
                call_id: callRow.id,
                status: 'failed',
                error: err instanceof Error ? err.message : 'Unknown error',
            },
            { status: 200 }
        );
    }
}

/**
 * GET /api/crm/calls?lead_id=...
 * List calls for the current lead. Lightweight projection — full transcripts
 * are fetched via /api/crm/calls/[id].
 */
export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const leadId = url.searchParams.get('lead_id');
    const orgIdHint = readOrgId(request);
    const access = await resolveCrmAccess(request, orgIdHint);
    if (isCrmAccessError(access)) return access;

    if (!leadId) {
        return NextResponse.json({ error: 'lead_id is required' }, { status: 400 });
    }

    const { data: lead } = await supabaseAdmin
        .from('crm_leads')
        .select('id, organization_id, created_by, assigned_to, city, location, campaign')
        .eq('id', leadId)
        .maybeSingle();

    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    if (!canAccessLead(lead, access)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
        .from('crm_calls')
        .select(
            'id, status, uploaded_at, analyzed_at, duration_seconds, overall_score, rep_talk_ratio, summary, error_message'
        )
        .eq('lead_id', leadId)
        .eq('is_archived', false)
        .order('uploaded_at', { ascending: false })
        .limit(20);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ calls: data || [] });
}

async function readFormSafely(request: NextRequest): Promise<{
    file: File | null;
    leadId: string | null;
    calledAt: string | null;
    asObject: Record<string, any>;
} | null> {
    try {
        const form = await request.formData();
        const file = form.get('file');
        const leadId = form.get('lead_id');
        const calledAt = form.get('called_at');
        return {
            file: file instanceof File ? file : null,
            leadId: typeof leadId === 'string' ? leadId : null,
            calledAt: typeof calledAt === 'string' ? calledAt : null,
            asObject: { lead_id: leadId, called_at: calledAt },
        };
    } catch {
        return null;
    }
}
