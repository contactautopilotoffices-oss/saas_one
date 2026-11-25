import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { buildMetaLine, isUuid } from '@/backend/lib/meetingRooms/roomDisplay';

/**
 * Owner 2026-11-25: the room list a door panel picks from on first boot.
 *
 * Panels are provisioned with a PROPERTY id rather than a room id, so every panel in a building
 * takes the same firmware image. On first boot the screen lists this property's rooms, someone
 * taps the one the panel is mounted outside, and that choice is kept (NVS on the device,
 * localStorage in the browser). After that the panel goes straight to its room.
 *
 * SECURITY NOTE: this is a listing endpoint, so anyone holding a property id can see that
 * property's room names. That is a deliberate widening over the per-room feed, and it matches
 * the posture of /kiosk/[propertyId], which is already public and keyed on a property id.
 * It returns room identity only -- never bookings, and never who booked. The schedule still
 * comes from the per-room feed.
 */

export interface PropertyDisplayRoom {
    id: string;
    name: string;
    location: string | null;
    capacity: number | null;
    /** "Floor 3 · Seats 12 · Display + VC", pre-joined so the panel does no string work. */
    meta_line: string;
}

export interface PropertyDisplayState {
    property: { id: string; name: string };
    rooms: PropertyDisplayRoom[];
}

/**
 * Lists the active meeting rooms of one property, or null when the id is unknown.
 *
 * Read-only.
 */
export async function getPropertyDisplayState(
    propertyId: string
): Promise<PropertyDisplayState | null> {
    if (!isUuid(propertyId)) return null;

    const { data: property, error: propertyError } = await supabaseAdmin
        .from('properties')
        .select('id, name')
        .eq('id', propertyId)
        .maybeSingle();

    if (propertyError) {
        console.error('[property-display] property lookup failed:', propertyError);
        return null;
    }
    if (!property) return null;

    const { data: rows, error: roomsError } = await supabaseAdmin
        .from('meeting_rooms')
        .select('id, name, location, capacity, amenities')
        .eq('property_id', propertyId)
        .eq('status', 'active')
        .order('name', { ascending: true });

    if (roomsError) {
        // A property whose rooms will not load is still worth naming on screen; the panel shows
        // an empty picker and a retry rather than going blank.
        console.error('[property-display] room lookup failed:', roomsError);
    }

    const rooms: PropertyDisplayRoom[] = (rows || []).map(r => {
        const amenities: string[] = Array.isArray(r.amenities)
            ? r.amenities.filter((a): a is string => typeof a === 'string')
            : [];
        return {
            id: r.id,
            name: r.name,
            location: r.location ?? null,
            capacity: r.capacity ?? null,
            meta_line: buildMetaLine(r.location ?? null, r.capacity ?? null, amenities),
        };
    });

    return { property: { id: property.id, name: property.name }, rooms };
}
