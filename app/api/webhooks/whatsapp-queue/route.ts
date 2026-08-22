import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { WhatsAppService } from '@/backend/services/WhatsAppService';
import { AiSensyService } from '@/backend/services/AiSensyService';

/**
 * POST /api/webhooks/whatsapp-queue
 * Triggered by Supabase DB webhook on INSERT into whatsapp_queue.
 * Sends the WhatsApp message and marks the row as sent or failed.
 */
export async function POST(request: NextRequest) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: any;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Supabase DB webhook payload: { type, table, schema, record, old_record }
    const row = body?.record;

    if (!row?.id) {
        return NextResponse.json({ error: 'No record in payload' }, { status: 400 });
    }

    // Atomic Claim: Only process if status is still 'pending' in the database
    const { data: claimedRow } = await supabaseAdmin
        .from('whatsapp_queue')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();

    if (!claimedRow) {
        console.log(`[WhatsAppQueue] Skipping row ${row.id} — already claimed/processed.`);
        return NextResponse.json({ ok: true, skipped: true });
    }

    console.log(`[WhatsAppQueue] Processing row ${claimedRow.id} for event: ${claimedRow.event_type}, phone: ${claimedRow.phone}`);

    try {
        let sent: boolean;
        let sendError: string | undefined;

        if (claimedRow.template_name) {
            // Config-driven AiSensy template path
            const result = await AiSensyService.sendTemplate({
                phone: claimedRow.phone,
                campaignName: claimedRow.template_name,
                templateParams: Array.isArray(claimedRow.template_params) ? claimedRow.template_params : [],
                mediaUrl: claimedRow.media_url ?? undefined,
            });

            sent = result.success;
            sendError = result.error;
        } else {
            // Legacy WasenderAPI free-text path
            sent = await WhatsAppService.sendAsync(row.phone, {
                message: row.message,
                mediaUrl: row.media_url ?? undefined,
                mediaType: row.media_type ?? undefined,
            });
        }

        if (sent) {
            await supabaseAdmin
                .from('whatsapp_queue')
                .update({ status: 'sent', sent_at: new Date().toISOString() })
                .eq('id', row.id);
            console.log(`[WhatsAppQueue] ✅ Sent and marked row ${row.id}`);
            return NextResponse.json({ ok: true });
        } else {
            await supabaseAdmin
                .from('whatsapp_queue')
                .update({
                    status: 'failed',
                    retry_count: (row.retry_count ?? 0) + 1,
                    error: sendError || 'WasenderAPI returned failure',
                })
                .eq('id', row.id);
            console.error(`[WhatsAppQueue] ❌ Send rejected for row ${row.id}: ${sendError || 'WasenderAPI returned failure'}`);
            return NextResponse.json({ error: 'Send failed' }, { status: 500 });
        }

    } catch (err: any) {
        console.error(`[WhatsAppQueue] ❌ Exception for row ${row.id}:`, err?.message);

        await supabaseAdmin
            .from('whatsapp_queue')
            .update({
                status: 'failed',
                retry_count: (row.retry_count ?? 0) + 1,
                error: err?.message ?? 'Unknown error',
            })
            .eq('id', row.id);

        return NextResponse.json({ error: err?.message }, { status: 500 });
    }
}
