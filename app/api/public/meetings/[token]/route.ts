import { NextRequest, NextResponse } from 'next/server';
import { TaskManagerAuth } from '@/app/api/task-manager/_shared/adminGuard';
import { meetingFail } from '@/app/api/task-manager/_shared/meetingFail';
import { meetingSpacesFor } from '@/app/api/task-manager/_shared/meetingGuard';
import { OnlineMeetingService } from '@/task-manager/meetings/OnlineMeetingService';

export const dynamic = 'force-dynamic';

/**
 * Stage 2 (owner 2026-11-18): the Meeting Assistant's guest link, for people without a login (candidates, vendors,
 * clients). PUBLIC by design: the link's secret is the only key, and each guest gets their own `key` when they ask to
 * join, so only they can see their answer or get a call token. Nobody gets into the call until someone from the
 * team lets them in. Rules: task-manager/meetings/online.ts. Plan: docs/MEETING_TASKS_SPEC.md
 * Owner 2026-11-18: this is now the meeting's ONE link for everyone. A signed-in team member who may join gets
 * `staffMeetingId` and the page sends them to the team's join screen; everyone else asks to join and waits.
 * The page shows "This call will be recorded" before anyone joins and sends `consent: true` with the request.
 *   GET                                         the meeting's name, host, time, whether it is open and ready, staffMeetingId
 *   POST { action: 'ask', name, consent: true } ask to join (agreeing to the recording) → { guestId, key }
 *   POST { action: 'status', guestId, key }     waiting / admitted / denied / removed, and whether it is still open
 *   POST { action: 'token', guestId, key }      a call token, once let in
 *   POST { action: 'connected', guestId, key }  in the call: the meeting goes live and recording starts if needed
 */

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
    try {
        const { token } = await params;
        const info = await OnlineMeetingService.guestInfo(token);
        // Signed in? Only then is the team's screen offered (a signed-out visitor is simply a guest)
        const user = await TaskManagerAuth.currentUser().catch(() => null);
        const staffMeetingId = user ? await OnlineMeetingService.staffMeetingFor(token, user.id, await meetingSpacesFor(user.id)) : null;
        return NextResponse.json({ success: true, ...info, staffMeetingId });
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
