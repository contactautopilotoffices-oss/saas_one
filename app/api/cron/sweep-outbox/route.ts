import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { EventProcessor } from '@/backend/services/EventProcessor';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Vercel Cron secures the endpoint via a header
        const authHeader = request.headers.get('authorization');
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        console.log('[SweepOutbox] Starting outbox sweeper cron...');

        // We need to find events that are:
        // 1. 'pending' and older than 5 minutes (stuck/stale)
        // 2. 'processing' and older than 15 minutes (crashed worker)
        // 3. 'failed' with retry_count < 3
        
        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

        // 1. Fetch pending
        const { data: pendingEvents } = await supabaseAdmin
            .from('event_outbox')
            .select('*')
            .eq('status', 'pending')
            .lt('created_at', fiveMinsAgo)
            .limit(10);

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

        console.log(`[SweepOutbox] Found ${eventsToRetry.length} events to retry.`);

        let retriedCount = 0;

        for (const event of eventsToRetry) {
            // Atomically claim the event for retry
            const { data: claimData, error: claimError } = await supabaseAdmin
                .from('event_outbox')
                .update({ status: 'processing', updated_at: new Date().toISOString() })
                .eq('id', event.id)
                // Ensure it hasn't been picked up by a concurrent process
                .eq('status', event.status) 
                .select()
                .maybeSingle();

            if (claimError || !claimData) {
                console.log(`[SweepOutbox] Failed to claim event ${event.id} for retry, skipping.`);
                continue;
            }

            console.log(`[SweepOutbox] Retrying event ${event.id}: ${event.event_type}`);

            try {
                await EventProcessor.processEvent(claimData);
                
                await supabaseAdmin
                    .from('event_outbox')
                    .update({ status: 'completed', updated_at: new Date().toISOString() })
                    .eq('id', event.id);

                retriedCount++;
            } catch (err: any) {
                console.error(`[SweepOutbox] Retry failed for event ${event.id}:`, err);
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
