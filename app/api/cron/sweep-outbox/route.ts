import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EventProcessor } from '@/backend/services/EventProcessor';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Vercel Cron secures the endpoint via a header. Allow localhost testing.
        const authHeader = request.headers.get('authorization');
        const isLocal = request.headers.get('host')?.includes('localhost');
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isLocal) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        console.log('[SweepOutbox] Starting outbox sweeper cron...');

        // We need to find events that are:
        // 1. 'pending' and older than 5 minutes (stuck/stale)
        // 2. 'processing' and older than 15 minutes (crashed worker)
        // 3. 'failed' with retry_count < 3
        
        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

        // 1. Fetch pending outbox events (e.g. inserted via mobile/database trigger)
        const { data: pendingEvents } = await supabaseAdmin
            .from('event_outbox')
            .select('*')
            .eq('status', 'pending')
            .limit(20);

        // 2. Fetch crashed processing
        const { data: processingEvents } = await supabaseAdmin
            .from('event_outbox')
            .select('*')
            .eq('status', 'processing')
            .lt('updated_at', fifteenMinsAgo)
            .limit(10);

        // 3. Fetch retryable failed
        const { data: failedEvents } = await supabaseAdmin
            .from('event_outbox')
            .select('*')
            .eq('status', 'failed')
            .lt('retry_count', 3)
            .limit(10);

        const eventsToRetry = [
            ...(pendingEvents || []),
            ...(processingEvents || []),
            ...(failedEvents || [])
        ];

        if (eventsToRetry.length === 0) {
            console.log('[SweepOutbox] No events to retry.');
            return NextResponse.json({ success: true, retriedCount: 0 });
        }

        console.log(`[SweepOutbox] Found ${eventsToRetry.length} events to process/retry.`);

        let retriedCount = 0;

        for (const event of eventsToRetry) {
            // Atomically claim the event for processing
            const { data: claimData, error: claimError } = await supabaseAdmin
                .from('event_outbox')
                .update({ status: 'processing', updated_at: new Date().toISOString() })
                .eq('id', event.id)
                .eq('status', event.status) 
                .select()
                .maybeSingle();

            if (claimError || !claimData) {
                console.log(`[SweepOutbox] Failed to claim event ${event.id}, skipping.`);
                continue;
            }

            console.log(`[SweepOutbox] Processing outbox event ${event.id}: ${event.event_type}`);

            try {
                // Run email & notification pipeline
                await EventProcessor.processEvent(claimData);

                // Run WhatsApp pipeline
                try {
                    const { WhatsAppEventProcessor } = await import('@/backend/services/WhatsAppEventProcessor');
                    await WhatsAppEventProcessor.processEvent(claimData);
                } catch (waErr) {
                    console.error(`[SweepOutbox] WhatsAppEventProcessor error for event ${event.id}:`, waErr);
                }
                
                await supabaseAdmin
                    .from('event_outbox')
                    .update({ status: 'completed', updated_at: new Date().toISOString() })
                    .eq('id', event.id);

                retriedCount++;
            } catch (err: any) {
                console.error(`[SweepOutbox] Processing failed for event ${event.id}:`, err);
                const newRetryCount = (claimData.retry_count || 0) + 1;
                const newStatus = newRetryCount >= 3 ? 'dead' : 'failed';
                
                await supabaseAdmin
                    .from('event_outbox')
                    .update({ 
                        status: newStatus, 
                        error_message: err.message || 'Unknown error during retry',
                        retry_count: newRetryCount,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', event.id);
            }
        }

        return NextResponse.json({ success: true, retriedCount });

    } catch (error: any) {
        console.error('[SweepOutbox] Fatal error:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
