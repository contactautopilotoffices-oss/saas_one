import { NextRequest, NextResponse } from 'next/server';
import { runBotHousekeeping } from '@/task-manager/NeverSilentWatchdog';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * OPTIONAL faster schedule for the WhatsApp bot housekeeping (docs/WHATSAPP_BOT_PRODUCTION_PLAN.md).
 * NOT scheduled right now, to save credits: the same work already runs with the 15-minute Task Manager cron
 * (/api/cron/task-manager?action=auto). To get apologies within ~2 minutes instead of ~15, add this path to vercel.json
 * with "* * * * *". Each part checks its own switch in the Task Access panel and does nothing while it is OFF.
 */
export async function GET(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(await runBotHousekeeping());   // never throws
}
