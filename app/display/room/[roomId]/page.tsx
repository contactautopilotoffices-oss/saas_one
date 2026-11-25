import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import RoomDisplayScreen from '@/frontend/components/meeting-rooms/RoomDisplayScreen';
import { getRoomDisplayState } from '@/backend/lib/meetingRooms/roomDisplay';

/**
 * Owner 2026-11-24: /display/room/<roomId> -- the meeting-room door panel at 1024x600.
 *
 * Two jobs:
 *   1. It is how this screen is reviewed and signed off without flashing hardware.
 *   2. It is the reference rendering the LVGL firmware in firmware/room-display/ mirrors, and it
 *      is what a browser-capable panel (or a spare Android tablet) can be pointed at directly.
 *
 * Public by necessity -- a wall panel has no session -- so '/display' is listed in proxy.ts.
 * The payload is minimised in backend/lib/meetingRooms/roomDisplay.ts. Read-only.
 */

interface Props {
    params: Promise<{ roomId: string }>;
}

export const viewport: Viewport = {
    width: 1024,
    initialScale: 1,
    userScalable: false,
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { roomId } = await params;
    const state = await getRoomDisplayState(roomId);

    return {
        title: state ? `${state.room.name} | Room display` : 'Room display',
        // A door panel should never be indexed.
        robots: { index: false, follow: false },
    };
}

export default async function RoomDisplayPage({ params }: Props) {
    const { roomId } = await params;
    const state = await getRoomDisplayState(roomId);

    if (!state) {
        notFound();
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-black">
            <RoomDisplayScreen initialState={state} />
        </main>
    );
}
