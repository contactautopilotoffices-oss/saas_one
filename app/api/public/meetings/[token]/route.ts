import { NextRequest, NextResponse } from 'next/server';
import { meetingFail } from '@/app/api/task-manager/_shared/meetingFail';
import { OnlineMeetingService } from '@/task-manager/meetings/OnlineMeetingService';

export const dynamic = 'force-dynamic';

/**
 * Stage 2 (owner 2026-11-18): the Meeting Assistant's guest link, for people without a login (candidates, vendors,
 * clients). PUBLIC by design: the link's secret is the only key, and each guest gets their own `key` when they ask to
 * join, so only they can see their answer or get a call token. Nobody gets into the call until someone from the
 * team lets them in. Rules: task-manager/meetings/online.ts. Plan: docs/MEETING_TASKS_SPEC.md
 *   GET                                         the meeting's name, host, time, whether it is open and ready
 *   POST { action: 'ask', name, consent: true } ask to join (agreeing to the recording) → { guestId, key }
 *   POST { action: 'status', guestId, key }     waiting / admitted / denied / removed, and whether it is still open
 *   POST { action: 'token', guestId, key }      a call token, once let in
 *   POST { action: 'connected', guestId, key }  in the call: the meeting goes live and recording starts if needed
 */

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
    try {
        const { token } = await params;
        return NextResponse.json({ success: true, ...(await OnlineMeetingService.guestInfo(token)) });
    } catch (err) {
        return meetingFail(err, 'MeetingGuestAPI');
    }
}

export async function POST(request: NextRequest, { params }: Ctx) {
    try {
        const { token } = await params;
        const body = (await request.json().catch(() => null)) ?? {};
        switch (body.action) {
            case 'ask': return NextResponse.json({ success: true, ...(await OnlineMeetingService.guestAsk(token, { name: body.name, consent: body.consent })) });
            case 'status': return NextResponse.json({ success: true, ...(await OnlineMeetingService.guestStatus(token, body.guestId, body.key)) });
            case 'token': return NextResponse.json({ success: true, ...(await OnlineMeetingService.guestCallToken(token, body.guestId, body.key)) });
            case 'connected': return NextResponse.json({ success: true, ...(await OnlineMeetingService.guestConnected(token, body.guestId, body.key)) });
            default: return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err) {
        return meetingFail(err, 'MeetingGuestAPI');
    }
}
