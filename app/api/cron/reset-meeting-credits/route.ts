import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/cron/reset-meeting-credits
 * Called by a cron job monthly. Resets remaining_hours to monthly_hours
 * for all tenants whose next_reset_at <= now.
 * Secured by CRON_SECRET header.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const now = new Date().toISOString();

        // Fetch credits due for reset (needed for logging)
        const { data: dueCredits, error: fetchErr } = await supabaseAdmin
            .from('meeting_room_credits')
            .select('id, user_id, company_id, organization_id, monthly_hours, remaining_hours')
            .lte('next_reset_at', now);

        if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
        if (!dueCredits || dueCredits.length === 0) {
            return NextResponse.json({ message: 'No credits due for reset', count: 0 });
        }

        const nextReset = new Date();
        nextReset.setMonth(nextReset.getMonth() + 1);
        nextReset.setDate(1);
        nextReset.setHours(0, 0, 0, 0);
        const nextResetIso = nextReset.toISOString();

        // Batch update all due credits atomically via RPC (fixes N+1)
        const { error: batchUpdateErr } = await supabaseAdmin.rpc('batch_reset_meeting_room_credits', {
            p_next_reset_at: nextResetIso,
            p_now: now,
        });

        if (batchUpdateErr) {
            console.error('[Credit Reset] Batch update failed:', batchUpdateErr);
            return NextResponse.json({ error: batchUpdateErr.message }, { status: 500 });
        }

        // Batch insert logs
        const logs = dueCredits.map((credit) => ({
            credit_id: credit.id,
            user_id: credit.user_id || null,
            company_id: credit.company_id || null,
            organization_id: credit.organization_id || null,
            action: 'monthly_reset',
            hours_changed: credit.monthly_hours - credit.remaining_hours,
            hours_after: credit.monthly_hours,
            performed_by: null,
            notes: 'Monthly credit reset',
        }));

        const { error: logErr } = await supabaseAdmin
            .from('meeting_room_credit_log')
            .insert(logs);

        if (logErr) {
            console.error('[Credit Reset] Log insert failed:', logErr);
        }

        console.log(`[Credit Reset] Reset ${dueCredits.length} records`);
        return NextResponse.json({ success: true, reset: dueCredits.length, total: dueCredits.length });
    } catch (err) {
        console.error('[Credit Reset] Error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
