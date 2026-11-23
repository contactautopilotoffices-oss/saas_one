import { NextRequest, NextResponse } from 'next/server';
import { dailyRulesStep } from '@/backend/lib/ticketing/sortRulesStore';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Owner 2026-11-19: ticket sorting rules are drafted "daily automatic as well as on button click". Once a day
 * (vercel.json, 02:45 India time) every organisation with learning examples and "Draft new rules every day" on gets one
 * run: only when there are new corrections since its last run; the draft is tested and, if it passes, offered in
 * Brain → Review → Tickets. Nothing becomes live here: a person approves. A run cut short is carried on by the 15-minute
 * housekeeping (task-manager/NeverSilentWatchdog.ts).
 */
export async function GET(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const out = await dailyRulesStep(new Date(), 270_000, { startNew: true });
        return NextResponse.json({ started: out.started.length, continued: out.continued.map(c => ({ status: c.status, done: c.done, total: c.total })), skipped: out.skipped });
    } catch (err) {
        console.error('[TicketRulesCron] failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ status: 'error' }, { status: 500 });
    }
}
