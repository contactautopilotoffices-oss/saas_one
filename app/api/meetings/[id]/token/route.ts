/**
 * POST — a LiveKit token for the signed-in person to join this meeting's room.
 *
 * The person's FMS user id is their identity in the room and their full name is
 * what Ira hears them as ("Vidya Pawar: …"), so attribution comes from the
 * login, never from a voice guess. The first join marks the meeting live.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { meetingViewer, isViewerError } from '@/backend/lib/meetings/access';
import { joinToken, liveKitConfig } from '@/backend/lib/meetings/livekit';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    const { data: meeting } = await supabaseAdmin
        .from('meetings').select('id, organization_id, status, room_name').eq('id', id).maybeSingle();
    if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    const viewer = await meetingViewer(meeting.organization_id);
    if (isViewerError(viewer)) return viewer;
    if (meeting.status === 'ended') return NextResponse.json({ error: 'This meeting has ended.' }, { status: 409 });
    if (!liveKitConfig()) {
        return NextResponse.json({ error: 'The meeting service is not set up yet (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).' }, { status: 503 });
    }

    const out = await joinToken({ room: meeting.room_name, identity: viewer.userId, name: viewer.name, meetingId: meeting.id });

    if (meeting.status === 'scheduled') {
        const { error } = await supabaseAdmin.from('meetings')
            .update({ status: 'live', started_at: new Date().toISOString() })
            .eq('id', id).eq('status', 'scheduled');
        if (error) return NextResponse.json({ error: `Could not start the meeting: ${error.message}` }, { status: 500 });
    }
    return NextResponse.json(out);
}
