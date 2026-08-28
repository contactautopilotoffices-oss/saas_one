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
            .update({ status: 'processing' })
            .eq('id', queueId);

        let sent = false;
        let sendError: string | undefined;

        if (row.template_name) {
            let campaignName = row.template_name;
            let templateParams = Array.isArray(row.template_params) ? [...row.template_params] : [];

            // Auto-heal legacy unapproved campaign names or parameter counts
            if (campaignName === 'checklist_started') campaignName = 'checklist_started_v1';
            if (campaignName === 'checklist_completed') campaignName = 'checklist_completed_v1';
            if (campaignName === 'checklist_overdue_alert') campaignName = 'checklist_overdue_alert_v2';
            if (campaignName === 'material_request_created') campaignName = 'material_request_created_v3';
            if (campaignName === 'material_request_created_v3' && templateParams.length > 6) templateParams = templateParams.slice(0, 6);
            if (campaignName === 'comparative_approval_requested_v1' && templateParams.length > 7) templateParams = templateParams.slice(0, 7);
            if (campaignName === 'comparative_uploaded_info_v1' && templateParams.length > 8) templateParams = templateParams.slice(0, 8);
            if (campaignName === 'comparative_approved_v1' && templateParams.length > 7) templateParams = templateParams.slice(0, 7);
            if (campaignName === 'comparative_rejected_v1' && templateParams.length > 7) templateParams = templateParams.slice(0, 7);
            if (campaignName === 'ticket_assigned_v1' && templateParams.length > 7) templateParams = templateParams.slice(0, 7);
            if (campaignName === 'ticket_completed_v1' && templateParams.length > 5) templateParams = templateParams.slice(0, 5);
            if (campaignName === 'ticket_completed_v1_media' && templateParams.length > 5) templateParams = templateParams.slice(0, 5);
            if (campaignName === 'ticket_created_v3' && templateParams.length > 9) templateParams = templateParams.slice(0, 9);
            if (campaignName === 'ticket_created_v3_media' && templateParams.length > 9) templateParams = templateParams.slice(0, 9);

            const res = await AiSensyService.sendTemplate({
                phone: row.phone,
                campaignName,
                templateParams,
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
                retry_count: (row.retry_count || 0) + 1
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
