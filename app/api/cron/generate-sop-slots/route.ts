import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';

/**
 * GET /api/cron/generate-sop-slots
 * Runs every 5-10 minutes.
 * 1. Generates pending slots for today
 * 2. Marks overdue pending/in_progress checklists as 'missed'
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Use Asia/Kolkata (IST) date string
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());

        // 1. Generate slots for today
        const { error: genError } = await supabaseAdmin.rpc('generate_sop_completions', {
            p_target_date: today
        });

        if (genError) {
            console.error('[SOP Slots Cron] Generation Error:', genError.message);
            return NextResponse.json({ error: genError.message }, { status: 500 });
        }

        // 2. Mark missed checklists
        const { error: missedError } = await supabaseAdmin.rpc('update_missed_sop_completions');

        if (missedError) {
            console.error('[SOP Slots Cron] Missed Update Error:', missedError.message);
            return NextResponse.json({ error: missedError.message }, { status: 500 });
        }

        return NextResponse.json({ 
            success: true, 
            message: 'Slots generated and missed statuses updated' 
        });
    } catch (error) {
        console.error('[SOP Slots Cron] Critical Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
