import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EventProcessor } from '@/backend/services/EventProcessor';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
    try {
        const signature = request.headers.get('x-webhook-secret');
        if (WEBHOOK_SECRET && signature !== WEBHOOK_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const payload = await request.json();
        
        // Supabase Webhook payload format: { type: 'INSERT', record: { id: '...', ... } }
        const eventId = payload.record?.id; 
        
        if (!eventId) {
            return NextResponse.json({ error: 'Invalid payload, missing record.id' }, { status: 400 });
        }

        // 1. Atomic Claim (Locking)
        // We only claim events that are pending or have been marked for retry.
        const { data: claimData, error: claimError } = await supabaseAdmin
            .from('event_outbox')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .in('status', ['pending', 'retry'])
            .eq('id', eventId)
            .select()
            .maybeSingle();

        if (claimError || !claimData) {
            console.log(`[EventProcessor] Event ${eventId} not found, already processed, or locked. Skipping.`);
            return NextResponse.json({ message: 'Event already processed or unavailable' });
        }

        const event = claimData;
        console.log(`[EventProcessor] Processing event ${event.id}: ${event.event_type}`);

        try {
            await EventProcessor.processEvent(event);
            
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
