import { NextRequest, NextResponse } from 'next/server';
import { requireMeetingSpace } from '../_shared/meetingGuard';
import { meetingFail } from '../_shared/meetingFail';
import { MeetingService } from '@/task-manager/meetings/MeetingService';

export const dynamic = 'force-dynamic';

/**
 * Owner 2026-10-29: the Meeting Assistant. `?space=` = which dashboard (one of MEETING_SPACES); each
 * has its own meetings and only its own roles get in (requireMeetingSpace).
 *   GET                                   meetings in this space I can see + everyone in the Task Manager (for "who was present")
 *   POST { title, attendeeIds, extraNames, confidential }   start a new meeting in this space → { id }
 *        + { kind: 'online', scheduledFor? }   owner 2026-11-18: an online meeting (video call) → { id, joinPath }
 *   POST { action: 'bulk', ids }           owner 2026-11-13: the notes of up to 50 ready meetings I can see, for the
 *                                          bulk download (one combined PDF / Word file made on the phone) → { items }
 * WHO is acting always comes from the signed-in session. Plan: docs/MEETING_TASKS_SPEC.md
 */

export async function GET(request: NextRequest) {
    const guard = await requireMeetingSpace(request);
    if (!guard.ok) return guard.response;
    try {
        // LiveVoice ID: each person carries `voiceReady` (they set up their voice) for the New meeting picker
        const [meetings, people] = await Promise.all([MeetingService.list(guard.userId, guard.space), MeetingService.peopleWithVoice()]);
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
        if (body.action === 'bulk') return NextResponse.json({ success: true, ...(await MeetingService.bulk(guard.userId, guard.space, body.ids)) });
        const result = await MeetingService.create(guard.userId, {
            title: body.title, attendeeIds: body.attendeeIds, extraNames: body.extraNames, extraContacts: body.extraContacts, confidential: body.confidential,
            // Owner 2026-11-18: kind 'online' = a video call with its own link, optionally at a set time
            kind: body.kind, scheduledFor: body.scheduledFor,
            // Owner 2026-11-19: false = do not pull tasks out of this meeting (ticked by default)
            findTasks: body.findTasks,
        }, guard.space);
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return meetingFail(err, 'MeetingsAPI');
    }
}
