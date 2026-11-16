import { NextRequest, NextResponse } from 'next/server';
import { requireMeetingSpace } from '../../_shared/meetingGuard';
import { meetingFail } from '../../_shared/meetingFail';
import { MeetingService, PROCESSING } from '@/task-manager/meetings/MeetingService';

export const dynamic = 'force-dynamic';
// One processing step (uploading to the speech service, Whisper on an hour of audio, or the AI notes) can take minutes
export const maxDuration = 300;

/**
 * Owner 2026-10-29: one meeting of the Meeting Assistant. `?space=` (one of MEETING_SPACES): the person needs that space's role, and
 * the meeting must belong to that space. A confidential meeting is only for the person who started it.
 *   GET                       the meeting, its transcript, notes and task list. While it is processing, each GET also
 *                             moves it forward one step (the review screen polls this).
 *   POST { action, ... }
 *     start_segment { minSegment? }         a new continuous recording → { segment } (never below the phone's own floor)
 *     upload_url  { segment, seq, mimeType } a one-time private upload link for one audio piece
 *     upload_urls { segment, from, count, mimeType }  links for up to 20 pieces in a row (owner 2026-11-13)
 *     heartbeat   { segments, elapsedSeconds, pieceSeconds }  the phone's half-minute report while recording (2026-11-13)
 *     finish      { force? }                 recording done → processing starts; 409 PIECES_MISSING (with `details`)
 *                                            while pieces the phone reported have not arrived, unless force is true
 *     update_attendees { attendeeIds, extraNames }  change who is present, at any time (owner 2026-11-13)
 *     rewrite_notes                          a ready meeting: write the notes and draft tasks again from the kept
 *                                            transcript (after people were added); sent tasks stay
 *     discard                                delete the meeting (and any audio)
 *     reset_recording                        "Start over": delete the audio so far, keep the meeting open for recording
 *     retry                                  try a failed meeting again
 *     rename      { title }                  change the meeting's name
 *     send_notes                             summary + decisions + each person's tasks on WhatsApp to those present
 *     update_task { taskId, title?, note?, ownerUserIds?, dueDate?, dueTime? }
 *     add_task    { title, note?, ownerUserIds?, dueDate?, dueTime? }
 *     delete_task { taskId }
 *     send        { taskIds, sendAs }        sendAs 'autopilot' (default) or 'me' (the sender's name + department);
 *                                            no Task Manager assignment rules either way
 */

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
    const guard = await requireMeetingSpace(request);
    if (!guard.ok) return guard.response;
    try {
        const { id } = await params;
        await MeetingService.assertSpace(id, guard.space);
        let result = await MeetingService.get(guard.userId, id);
        if (PROCESSING.includes(result.meeting.status)) {
            await MeetingService.advance(id);
            result = await MeetingService.get(guard.userId, id);
        }
        return NextResponse.json({ success: true, ...result });
    } catch (err) {
        return meetingFail(err, 'MeetingAPI');
    }
}

export async function POST(request: NextRequest, { params }: Ctx) {
    const guard = await requireMeetingSpace(request);
    if (!guard.ok) return guard.response;
    try {
        const { id } = await params;
        await MeetingService.assertSpace(id, guard.space);
        const body = (await request.json().catch(() => null)) ?? {};
        const userId = guard.userId;
        switch (body.action) {
            case 'start_segment': return NextResponse.json({ success: true, ...(await MeetingService.startSegment(userId, id, { minSegment: body.minSegment })) });
            case 'upload_url': return NextResponse.json({ success: true, ...(await MeetingService.uploadUrl(userId, id, { segment: body.segment, seq: body.seq, mimeType: body.mimeType })) });
            case 'upload_urls': return NextResponse.json({ success: true, ...(await MeetingService.uploadUrls(userId, id, { segment: body.segment, from: body.from, count: body.count, mimeType: body.mimeType })) });
            case 'heartbeat': return NextResponse.json({ success: true, ...(await MeetingService.heartbeat(userId, id, { segments: body.segments, elapsedSeconds: body.elapsedSeconds, pieceSeconds: body.pieceSeconds })) });
            case 'finish': return NextResponse.json({ success: true, ...(await MeetingService.finish(userId, id, { force: body.force })) });
            case 'update_attendees': return NextResponse.json({ success: true, ...(await MeetingService.updateAttendees(userId, id, { attendeeIds: body.attendeeIds, extraNames: body.extraNames })) });
            case 'rewrite_notes': return NextResponse.json({ success: true, ...(await MeetingService.rewriteNotes(userId, id)) });
            case 'discard': return NextResponse.json({ success: true, ...(await MeetingService.discard(userId, id)) });
            case 'reset_recording': return NextResponse.json({ success: true, ...(await MeetingService.resetRecording(userId, id)) });
            case 'retry': return NextResponse.json({ success: true, ...(await MeetingService.retry(userId, id)) });
            case 'rename': return NextResponse.json({ success: true, ...(await MeetingService.rename(userId, id, { title: body.title })) });
            case 'send_notes': return NextResponse.json({ success: true, ...(await MeetingService.sendNotes(userId, id)) });
            case 'update_task': return NextResponse.json({ success: true, ...(await MeetingService.updateTask(userId, id, pickTask(body, true))) });
            case 'add_task': return NextResponse.json({ success: true, ...(await MeetingService.addTask(userId, id, pickTask(body, false))) });
            case 'delete_task': return NextResponse.json({ success: true, ...(await MeetingService.deleteTask(userId, id, body.taskId)) });
            case 'send': return NextResponse.json({ success: true, ...(await MeetingService.send(userId, id, body.taskIds, body.sendAs ?? 'autopilot')) });
            default: return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
        }
    } catch (err) {
        return meetingFail(err, 'MeetingAPI');
    }
}

/** Only the editable fields that were actually sent (an absent field is left unchanged). */
function pickTask(body: Record<string, unknown>, withId: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of ['title', 'note', 'ownerUserIds', 'dueDate', 'dueTime']) if (k in body) out[k] = body[k];
    if (withId) out.taskId = body.taskId;
    return out;
}
