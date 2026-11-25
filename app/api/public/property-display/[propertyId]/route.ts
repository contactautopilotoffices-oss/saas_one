import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIP } from '@/frontend/utils/rate-limiter';
import { isUuid, DISPLAY_POLL_SECONDS } from '@/backend/lib/meetingRooms/roomDisplay';
import { getPropertyDisplayState } from '@/backend/lib/meetingRooms/propertyDisplay';

/**
 * GET /api/public/property-display/[propertyId]
 *
 * The room list a door panel picks from on first boot. Panels carry a property id rather than a
 * room id, so one firmware image serves a whole building.
 *
 * Unauthenticated, like the per-room feed and like /kiosk/[propertyId] before it. Returns room
 * identity only -- names, location, capacity. Never bookings, never who booked; the schedule
 * comes from /api/public/room-display/[roomId].
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string }> }
) {
    try {
        const { propertyId } = await params;

        if (!isUuid(propertyId)) {
            return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
        }

        // Panels hit this once at setup, not on a poll loop, so it can be tighter than the
        // per-room feed.
        const limit = checkRateLimit(getClientIP(request), { maxRequests: 30, windowMs: 60 * 1000 });
        if (!limit.allowed) {
            return NextResponse.json(
                { error: 'Too many requests' },
                { status: 429, headers: { 'Retry-After': String(DISPLAY_POLL_SECONDS) } }
            );
        }

        const state = await getPropertyDisplayState(propertyId);

        if (!state) {
            return NextResponse.json({ error: 'Property not found' }, { status: 404 });
        }

        return NextResponse.json(state, {
            headers: { 'Cache-Control': 'no-store, max-age=0' },
        });
    } catch (error) {
        console.error('[property-display] GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
