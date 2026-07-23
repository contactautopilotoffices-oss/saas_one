/**
 * Pipeline: given a crm_calls row that already has a recording uploaded,
 * run Whisper transcription + Groq scoring and persist the result back.
 *
 * Designed to be called inline from the upload route for the MVP. If call
 * volume grows, this can be moved to a background worker (Supabase Edge,
 * Inngest, or a cron'd Node process) — the function is pure and idempotent.
 */

import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { transcribeWithWhisper } from './whisper';
import { scoreCallWithGroq } from './groqCoach';
import type { CoachingReport, TranscriptSegment } from './schema';

export type PipelineResult =
    | { ok: true; callId: string; report: CoachingReport; transcript: TranscriptSegment[] }
    | { ok: false; callId: string; error: string };

export async function runAnalysisPipeline(callId: string): Promise<PipelineResult> {
    // 1. Load the call row.
    const { data: call, error: loadErr } = await supabaseAdmin
        .from('crm_calls')
        .select('id, organization_id, lead_id, bd_rep_id, recording_url, status')
        .eq('id', callId)
        .maybeSingle();

    if (loadErr || !call) {
        return { ok: false, callId, error: loadErr?.message ?? 'Call row not found' };
    }

    if (!call.recording_url) {
        return { ok: false, callId, error: 'No recording URL on call row' };
    }

    if (call.status === 'completed') {
        return { ok: false, callId, error: 'Call already analyzed' };
    }

    // 2. Flip to 'transcribing'.
    await supabaseAdmin
        .from('crm_calls')
        .update({ status: 'transcribing', error_message: null, updated_at: new Date().toISOString() })
        .eq('id', callId);

    // 3. Download the file from Supabase Storage using the service-role client.
    //    recording_url is the storage path inside the bucket.
    const { data: fileBlob, error: downloadErr } = await supabaseAdmin.storage
        .from('crm-call-recordings')
        .download(call.recording_url);

    if (downloadErr || !fileBlob) {
        const errMsg = downloadErr?.message ?? 'Failed to download recording from storage';
        await markFailed(callId, errMsg);
        return { ok: false, callId, error: errMsg };
    }

    const arrayBuffer = await fileBlob.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);

    // 4. Whisper
    const fileName = call.recording_url.split('/').pop() || 'recording.mp3';
    const mimeType = fileBlob.type || 'audio/mpeg';
    const whisperResult = await transcribeWithWhisper({ fileBuffer, fileName, mimeType });

    if (!whisperResult.success) {
        await markFailed(callId, `Whisper: ${whisperResult.error}`);
        return { ok: false, callId, error: `Whisper failed: ${whisperResult.error}` };
    }

    // 5. Look up context (lead company + rep name) for the prompt header.
    const [{ data: lead }, { data: rep }] = await Promise.all([
        supabaseAdmin
            .from('crm_leads')
            .select('company_name, contact_person')
            .eq('id', call.lead_id)
            .maybeSingle(),
        supabaseAdmin
            .from('users')
            .select('full_name, email')
            .eq('id', call.bd_rep_id)
            .maybeSingle(),
    ]);

    const leadCompany = lead?.company_name ?? lead?.contact_person ?? null;
    const repName = (rep?.full_name as string | undefined) ?? (rep?.email as string | undefined) ?? null;

    // 6. Flip to 'scoring'.
    await supabaseAdmin
        .from('crm_calls')
        .update({
            status: 'scoring',
            transcript: whisperResult.segments,
            duration_seconds: whisperResult.durationSeconds,
            updated_at: new Date().toISOString(),
        })
        .eq('id', callId);

    // 7. Groq scoring.
    const scoreResult = await scoreCallWithGroq({
        transcriptText: whisperResult.fullText,
        leadCompanyName: leadCompany,
        bdRepName: repName,
        durationSeconds: whisperResult.durationSeconds,
    });

    if (!scoreResult.success) {
        await markFailed(callId, `Groq: ${scoreResult.error}`);
        return { ok: false, callId, error: `Scoring failed: ${scoreResult.error}` };
    }

    // 8. Persist final report.
    const report = scoreResult.report;
    const { error: updateErr } = await supabaseAdmin
        .from('crm_calls')
        .update({
            status: 'completed',
            coaching: report,
            summary: report.summary,
            overall_score: report.overall_score,
            rep_talk_ratio: report.rep_talk_ratio,
            duration_seconds_cached: whisperResult.durationSeconds,
            lead_company_name_snapshot: leadCompany,
            lead_contact_person_snapshot: lead?.contact_person ?? null,
            analyzed_at: new Date().toISOString(),
            error_message: null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', callId);

    if (updateErr) {
        await markFailed(callId, `Persist: ${updateErr.message}`);
        return { ok: false, callId, error: `Persist failed: ${updateErr.message}` };
    }

    // 9. Bump lead.last_contacted (mirrors the existing activity-log behavior).
    await supabaseAdmin
        .from('crm_leads')
        .update({ last_contacted: new Date().toISOString() })
        .eq('id', call.lead_id);

    // 10. Drop a crm_activity_log entry so the lead's existing timeline waterfall
    //     (LeadDetailDrawer.tsx:219-268) automatically surfaces the call.
    await supabaseAdmin.from('crm_activity_log').insert({
        lead_id: call.lead_id,
        user_id: call.bd_rep_id,
        activity_type: 'call',
        description: `Call analyzed — score ${report.overall_score.toFixed(1)}/10`,
        metadata: {
            call_id: callId,
            overall_score: report.overall_score,
            rep_talk_ratio: report.rep_talk_ratio,
            duration_seconds: whisperResult.durationSeconds,
        },
    });

    return {
        ok: true,
        callId,
        report,
        transcript: whisperResult.segments,
    };
}

async function markFailed(callId: string, errorMessage: string) {
    await supabaseAdmin
        .from('crm_calls')
        .update({
            status: 'failed',
            error_message: errorMessage.slice(0, 500),
            updated_at: new Date().toISOString(),
        })
        .eq('id', callId);
}
