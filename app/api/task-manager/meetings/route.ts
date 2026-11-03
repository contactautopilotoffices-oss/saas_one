import { NextRequest, NextResponse } from 'next/server';
import { requireMeetingSpace } from '../_shared/meetingGuard';
import { meetingFail } from '../_shared/meetingFail';
import { MeetingService } from '@/task-manager/meetings/MeetingService';

export const dynamic = 'force-dynamic';

/**
 * Owner 2026-10-29: the Meeting Assistant. `?space=tech|hr|admin` = which dashboard (Tech / HR / Super Admin); each
 * has its own meetings and only its own roles get in (requireMeetingSpace).
 *   GET                                   meetings in this space I can see + everyone in the Task Manager (for "who was present")
 *   POST { title, attendeeIds, extraNames, confidential }   start a new meeting in this space → { id }
 * WHO is acting always comes from the signed-in session. Plan: docs/MEETING_TASKS_SPEC.md
 */

export async function GET(request: NextRequest) {
    const guard = await requireMeetingSpace(request);
    if (!guard.ok) return guard.response;
    try {
        const [meetings, people] = await Promise.all([MeetingService.list(guard.userId, guard.space), MeetingService.people()]);
        return NextResponse.json({ success: true, meetings, people });
    } catch (err) {
        return meetingFail(err, 'MeetingsAPI');
    }
}

export async function POST(request: NextRequest) {
    const guard = await requireMeetingSpace(request);
    if (!guard.ok) return guard.response;
    try {
        const body = (await request.json().catch(() => null)) ?? {};
        const result = await MeetingService.create(guard.userId, {
            title: body.title, attendeeIds: body.attendeeIds, extraNames: body.extraNames, confidential: body.confidential,
        }, guard.space);
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return meetingFail(err, 'MeetingsAPI');
    }
}
