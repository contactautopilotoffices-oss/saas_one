import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/cron/check-diesel
 * Checks if diesel readings have been logged for today.
 * Notifications for diesel are intentionally disabled per product decision.
 * This cron now only logs the status for monitoring purposes.
 */
export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const today = new Date().toISOString().split('T')[0];

        const { data: logs, error: logError } = await supabaseAdmin
            .from('diesel_readings')
            .select('id, property_id')
            .gte('reading_date', today);

        if (logError && logError.code !== '42P01') throw logError;

        const hasLogsToday = logs && logs.length > 0;

        // Diesel notifications are disabled — no push or WhatsApp sent.
        return NextResponse.json({
            success: true,
            has_logs_today: hasLogsToday,
            log_count: logs?.length || 0,
            notifications_sent: 0,
            note: 'Diesel notifications disabled per product decision.',
        });

    } catch (error) {
        console.error('[Diesel Cron] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
