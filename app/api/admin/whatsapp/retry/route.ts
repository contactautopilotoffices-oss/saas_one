import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { AiSensyService } from '@/backend/services/AiSensyService';
import { WhatsAppService } from '@/backend/services/WhatsAppService';

/**
 * POST /api/admin/whatsapp/retry
 * Retries sending a failed or pending WhatsApp message from whatsapp_queue.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { queueId } = body;

        if (!queueId) {
            return NextResponse.json({ error: 'Missing queueId' }, { status: 400 });
        }

        const { data: row, error: fetchErr } = await supabaseAdmin
            .from('whatsapp_queue')
            .select('*')
            .eq('id', queueId)
            .maybeSingle();

        if (fetchErr || !row) {
            return NextResponse.json({ error: 'Queue record not found' }, { status: 404 });
        }

        // Set status to processing
        await supabaseAdmin
            .from('whatsapp_queue')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('id', queueId);

        let sent = false;
        let sendError: string | undefined;

        if (row.template_name) {
            const res = await AiSensyService.sendTemplate({
                phone: row.phone,
                campaignName: row.template_name,
                templateParams: Array.isArray(row.template_params) ? row.template_params : [],
                mediaUrl: row.media_url || undefined
            });
            sent = res.success;
            sendError = res.error;
        } else {
            sent = await WhatsAppService.sendAsync(row.phone, {
                message: row.message,
                mediaUrl: row.media_url || undefined,
                mediaType: row.media_type || undefined
            });
        }

        const newStatus = sent ? 'sent' : 'failed';
        const { data: updated, error: updateErr } = await supabaseAdmin
            .from('whatsapp_queue')
            .update({
                status: newStatus,
                sent_at: sent ? new Date().toISOString() : null,
                error_message: sendError || null,
                retry_count: (row.retry_count || 0) + 1,
                updated_at: new Date().toISOString()
            })
            .eq('id', queueId)
            .select()
            .maybeSingle();

        if (updateErr) throw updateErr;

        return NextResponse.json({
            success: sent,
            status: newStatus,
            error: sendError,
            record: updated
        });
    } catch (err: any) {
        console.error('[WhatsApp Retry API] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
