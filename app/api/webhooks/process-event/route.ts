import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EventProcessor } from '@/backend/services/EventProcessor';
import { WhatsAppEventProcessor } from '@/backend/services/WhatsAppEventProcessor';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
    try {
        const signature = request.headers.get('x-webhook-secret');
        if (WEBHOOK_SECRET && signature !== WEBHOOK_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const payload = await request.json();
        
        // Supabase Database Webhook on `event_outbox` table sends: { type: 'INSERT', record: { id, event_type, payload, status } }
        let event = payload.record || payload; 
        const eventId = event?.id || payload.record?.id || payload.id; 

        if (!eventId) {
            return NextResponse.json({ error: 'Invalid payload, missing event id' }, { status: 400 });
        }

        // 1. Atomic Claim (Locking)
        // Only claim if status is 'pending'
        const { data: claimedEvent, error: claimErr } = await supabaseAdmin
            .from('event_outbox')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('id', eventId)
            .eq('status', 'pending')
            .select('*')
            .maybeSingle();

        if (!claimedEvent) {
            console.log(`[EventProcessor] Event ${eventId} already claimed, processing, or completed. Skipping duplicate webhook.`);
            return NextResponse.json({ message: 'Event already claimed or completed' });
        }

        event = claimedEvent;

        // Deduplication Check: if an identical event (same entity_id and event_type) was completed in the last 2 minutes, skip re-execution
        if (event.entity_id && event.event_type) {
            const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
            const { data: duplicateCompleted } = await supabaseAdmin
                .from('event_outbox')
                .select('id')
                .eq('entity_id', event.entity_id)
                .eq('event_type', event.event_type)
                .eq('status', 'completed')
                .gt('updated_at', twoMinsAgo)
                .neq('id', event.id)
                .maybeSingle();

            if (duplicateCompleted) {
                console.log(`[EventProcessor] Duplicate outbox event for entity ${event.entity_id} (${event.event_type}) was already processed recently. Marking completed and skipping.`);
                await supabaseAdmin
                    .from('event_outbox')
                    .update({ status: 'completed', error_message: 'Skipped duplicate event', updated_at: new Date().toISOString() })
                    .eq('id', event.id);
                return NextResponse.json({ message: 'Duplicate event skipped' });
            }
        }

        console.log(`[EventProcessor] Processing event ${event.id}: ${event.event_type}`);

        try {
            await EventProcessor.processEvent(event);

            // Parallel WhatsApp (AiSensy) pipeline — must never affect email processing
            // or the outbox row's status handling, so errors are logged only.
            try {
                await WhatsAppEventProcessor.processEvent(event);
            } catch (waErr) {
                console.error(`[WhatsAppEventProcessor] Failed processing event ${event.id}:`, waErr);
            }

            // Mark completed
            await supabaseAdmin
                .from('event_outbox')
                .update({ status: 'completed', updated_at: new Date().toISOString() })
                .eq('id', event.id);

            return NextResponse.json({ success: true, message: 'Event processed successfully' });
            
        } catch (processErr: any) {
            console.error(`[EventProcessor] Failed processing event ${event.id}:`, processErr);
            
            // Mark failed and increment retry_count
            await supabaseAdmin
                .from('event_outbox')
                .update({ 
                    status: 'failed', 
                    error_message: processErr.message || 'Unknown error',
                    retry_count: event.retry_count + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('id', event.id);

            // We still return 200 so Supabase webhook doesn't keep retrying indiscriminately. 
            // Our sweeper will handle controlled retries.
            return NextResponse.json({ success: false, message: 'Processing failed, scheduled for retry' }, { status: 200 });
        }

    } catch (error) {
        console.error('[EventProcessor] Fatal error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
