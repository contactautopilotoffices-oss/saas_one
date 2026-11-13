import { NextRequest, NextResponse } from 'next/server';
import { MeetingService } from '@/task-manager/meetings/MeetingService';

export const dynamic = 'force-dynamic';
// One processing step (uploading an hour of audio to the speech service, Whisper, or the AI notes) can take minutes
export const maxDuration = 300;

/**
 * GET /api/cron/meeting-assistant — owner 2026-11-13, every minute (vercel.json).
 * Keeps the Meeting Assistant moving when nobody has the page open: a few processing meetings get one step each
 * (uploaded → transcribing → identifying → extracting → ready), abandoned recordings with audio are processed, and old
 * audio is removed. Before this, notes were only written while someone kept the meeting's page open.
 * Secured by the CRON_SECRET bearer header, like the other cron routes.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const result = await MeetingService.tick();
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        console.error('[MeetingAssistantCron] error:', err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
    }
}
