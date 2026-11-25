import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIP } from '@/frontend/utils/rate-limiter';
import { getRoomDisplayState, isUuid, DISPLAY_POLL_SECONDS } from '@/backend/lib/meetingRooms/roomDisplay';

/**
 * GET /api/public/room-display/[roomId]
 *
 * The feed for a meeting-room door panel (ESP32-S3 7" screen). Unauthenticated by necessity:
 * the panel is screwed to a wall and has no session. Read-only, and the payload is shaped in
 * backend/lib/meetingRooms/roomDisplay.ts, which deliberately withholds e-mails, phone numbers
 * and the private booking comment.
 *
 * The room id is the only credential. That matches the posture of /kiosk/[propertyId], which
 * already exposes a property's public identity on an unauthenticated route. Before this panel
 * is ever allowed to WRITE a booking it needs a real per-device token -- see
 * docs/MEETING_ROOM_DISPLAY_PLAN.md.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ roomId: string }> }
) {
    try {
        const { roomId } = await params;

        if (!isUuid(roomId)) {
            return NextResponse.json({ error: 'Invalid room id' }, { status: 400 });
        }

        // A panel polls every 30s; 60/min per IP leaves room for a handful of panels behind one
        // office NAT without letting a broken firmware loop hammer the database.
        const limit = checkRateLimit(getClientIP(request), { maxRequests: 60, windowMs: 60 * 1000 });
        if (!limit.allowed) {
            return NextResponse.json(
                { error: 'Too many requests' },
                { status: 429, headers: { 'Retry-After': String(DISPLAY_POLL_SECONDS) } }
            );
        }

        const state = await getRoomDisplayState(roomId);

        if (!state) {
            return NextResponse.json({ error: 'Room not found' }, { status: 404 });
        }

        return NextResponse.json(state, {
            headers: {
                // The panel must never be served a cached day. It polls on its own clock.
                'Cache-Control': 'no-store, max-age=0',
            },
        });
    } catch (error) {
        console.error('[room-display] GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
