import { NextRequest, NextResponse } from 'next/server';
import { health } from '@/task-manager/voice/VoiceIdClient';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/voice-id-keepalive — LiveVoice ID (owner 2026-11-02).
 *
 * The free Hugging Face Space that runs the voice server sleeps after 48 hours without a request. Vercel calls this
 * twice a day (vercel.json), so there is never a 48-hour gap and the server stays awake. One /health call, nothing
 * else: no data is read or written. A sleeping server is woken by the call itself; "waking" is a normal answer.
 *
 * Auth: Vercel's scheduler sends `Authorization: Bearer <CRON_SECRET>`. A deployment with no CRON_SECRET refuses
 * everyone (never compares against "Bearer undefined"), same as app/api/cron/agent-heartbeat.
 */
export async function GET(request: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.error('[voice-id-keepalive] CRON_SECRET is not set on this deployment. Refusing every request.');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await health();
    if (result.state === 'online') console.log('[voice-id-keepalive] voice server online');
    else console.warn(`[voice-id-keepalive] voice server ${result.state}${result.detail ? `: ${result.detail}` : ''}`);
    return NextResponse.json({ ok: true, state: result.state, detail: result.state === 'online' ? null : result.detail ?? null });
}
