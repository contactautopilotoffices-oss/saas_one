import { NextRequest, NextResponse } from 'next/server';
import { runNightlyAutoTune } from '@/task-manager/BotLearningHousekeeping';
import { engyBrainLlm } from '@/task-manager/brain/llm';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Owner 2026-10-20 — the nightly self-improvement gets its OWN slot (it used to share the 60-second housekeeping run, so the
 * AI was always cut off). Once a night (vercel.json, 02:15 India time) it writes ONE new version of the bot's tunable
 * instructions as small edits; the 15-minute housekeeping then tests it in batches as before. Does nothing while the
 * "nightly auto-tune" switch is OFF, when there is nothing new to learn from, or when a version is already being tested.
 */
export async function GET(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        return NextResponse.json(await runNightlyAutoTune(new Date(), engyBrainLlm({ thinking: 'off', timeoutMs: 240_000 }), { draft: true }));
    } catch (err) {
        console.error('[BotAutoTuneCron] failed:', err instanceof Error ? err.message : err);
        return NextResponse.json({ status: 'error' }, { status: 500 });
    }
}
