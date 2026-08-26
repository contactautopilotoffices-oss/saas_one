import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * POST /api/voice/webhook
 * Receives Bolna AI webhook events upon call completion (duration, transcript, recording URL).
 */
export async function POST(request: NextRequest) {
    try {
        const payload = await request.json();
        const callId = payload.call_id || payload.id;
        const status = payload.status || 'completed';
        const duration = payload.duration || payload.conversation_duration || 0;
        const recordingUrl = payload.recording_url || payload.audio_url || null;
        const transcript = payload.transcript || payload.conversation_summary || null;

        if (callId) {
            await supabaseAdmin
                .from('omnichannel_call_logs')
                .update({
                    call_status: status,
                    duration_seconds: Math.round(duration),
                    recording_url: recordingUrl,
                    summary: transcript
                })
                .eq('bolna_call_id', callId);
        }

        return NextResponse.json({ success: true, received: true });
    } catch (err: any) {
        console.error('[Voice Webhook] Error processing event:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
