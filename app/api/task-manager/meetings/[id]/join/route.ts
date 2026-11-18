import { NextRequest, NextResponse } from 'next/server';
import { TaskManagerAuth } from '../../../_shared/adminGuard';
import { meetingSpacesFor } from '../../../_shared/meetingGuard';
import { meetingFail } from '../../../_shared/meetingFail';
import { OnlineMeetingService } from '@/task-manager/meetings/OnlineMeetingService';

export const dynamic = 'force-dynamic';

/**
 * Owner 2026-11-18: the online meeting link (/meet/<id>). Opened without a dashboard, so there is no `?space=`: the
 * person must be signed in and be the meeting's creator, someone picked as attending, or (for a meeting that is not
 * confidential) someone who has that Meeting Assistant. Anyone else is told the meeting does not exist.
 * Rules: task-manager/meetings/online.ts (canJoin). Plan: docs/MEETING_TASKS_SPEC.md
 *   GET                        the meeting's name, host, time and whether it is open, plus what is not set up yet
 *   POST { action: 'token', consent: true }   a LiveKit token to join (only after agreeing to the recording)
 *   POST { action: 'joined' }  connected: the meeting goes live and the recordings start (again, if they stopped)
 *   POST { action: 'end' }     the creator ends the call for everyone
 *   POST { action: 'guest_link', on }                       stage 2: the creator turns the guest link on or off
 *   POST { action: 'guest_decide', guestId, decision }      stage 2: 'admit' | 'deny' a waiting guest, or 'remove' one
 */

type Ctx = { params: Promise<{ id: string }> };

async function who() {
    const user = await TaskManagerAuth.currentUser();
    if (!user) return null;
    return { userId: user.id, spaces: await meetingSpacesFor(user.id) };
}

export async function GET(_request: NextRequest, { params }: Ctx) {
    const me = await who();
    if (!me) return NextResponse.json({ success: false, error: 'Please sign in to join this meeting.' }, { status: 401 });
    try {
        const { id } = await params;
        return NextResponse.json({ success: true, ...(await OnlineMeetingService.joinInfo(me.userId, id, me.spaces)) });
    } catch (err) {
        return meetingFail(err, 'MeetingJoinAPI');
    }
}

export async function POST(request: NextRequest, { params }: Ctx) {
    const me = await who();
    if (!me) return NextResponse.json({ success: false, error: 'Please sign in to join this meeting.' }, { status: 401 });
    try {
        const { id } = await params;
        const body = (await request.json().catch(() => null)) ?? {};
        switch (body.action) {
            case 'token': return NextResponse.json({ success: true, ...(await OnlineMeetingService.token(me.userId, id, me.spaces, { consent: body.consent })) });
            case 'joined': return NextResponse.json({ success: true, ...(await OnlineMeetingService.joined(me.userId, id, me.spaces)) });
            case 'end': return NextResponse.json({ success: true, ...(await OnlineMeetingService.end(me.userId, id, me.spaces)) });
            case 'guest_link': return NextResponse.json({ success: true, ...(await OnlineMeetingService.setGuestLink(me.userId, id, me.spaces, body.on === true)) });
            case 'guest_decide': return NextResponse.json({ success: true, ...(await OnlineMeetingService.decideGuestRequest(me.userId, id, me.spaces, body.guestId, body.decision)) });
            default: return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err) {
        return meetingFail(err, 'MeetingJoinAPI');
    }
}
