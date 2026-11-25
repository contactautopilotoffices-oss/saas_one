import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import PropertyDisplayShell from '@/frontend/components/meeting-rooms/PropertyDisplayShell';
import { getPropertyDisplayState } from '@/backend/lib/meetingRooms/propertyDisplay';

/**
 * Owner 2026-11-25: /display/property/<propertyId> — the URL every door panel in a building
 * loads.
 *
 * Panels are provisioned per property rather than per room, so one firmware image and one URL
 * serve the whole site. The panel asks which room it is outside the first time it runs, keeps
 * the answer, and goes straight to that room's schedule afterwards.
 *
 * Public by necessity — a wall panel has no session — so '/display' is listed in proxy.ts.
 * Read-only: nothing on this route writes.
 */

interface Props {
    params: Promise<{ propertyId: string }>;
}

export const viewport: Viewport = {
    width: 1024,
    initialScale: 1,
    userScalable: false,
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { propertyId } = await params;
    const state = await getPropertyDisplayState(propertyId);

    return {
        title: state ? `${state.property.name} | Room display` : 'Room display',
        // A door panel should never be indexed.
        robots: { index: false, follow: false },
    };
}

export default async function PropertyDisplayPage({ params }: Props) {
    const { propertyId } = await params;
    const state = await getPropertyDisplayState(propertyId);

    if (!state) {
        notFound();
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-black">
            <PropertyDisplayShell property={state} />
        </main>
    );
}
