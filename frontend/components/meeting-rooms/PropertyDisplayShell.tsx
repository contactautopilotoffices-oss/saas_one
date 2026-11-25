'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Users, MapPin, Loader2 } from 'lucide-react';
import RoomDisplayScreen from '@/frontend/components/meeting-rooms/RoomDisplayScreen';
import type { PropertyDisplayState } from '@/backend/lib/meetingRooms/propertyDisplay';
import type { RoomDisplayState } from '@/backend/lib/meetingRooms/roomDisplay';

/**
 * Owner 2026-11-25: /display/property/<propertyId> — what a door panel loads.
 *
 * Panels are provisioned per PROPERTY, so every panel in a building takes the same firmware
 * image and the same URL. On first boot this lists the property's rooms; whoever mounts the
 * panel taps the room it hangs outside, and that choice sticks. After that it goes straight to
 * the schedule, and the room can be reassigned from the Rooms menu.
 *
 * The browser keeps the choice in localStorage; the firmware keeps the same choice in NVS.
 * Same flow either way, so this page is both a usable panel and the spec for the device.
 */

interface Props {
    property: PropertyDisplayState;
}

const PANEL_W = 1024;
const PANEL_H = 600;

const C = {
    bg: '#0B0F12',
    card: '#141A20',
    cardHover: '#1A2128',
    topbar: '#0E1318',
    text: '#FFFFFF',
    dim: '#8A949C',
    faint: '#5A646C',
    sand: '#AA895F',
    accent: '#3DD68C',
};

function storageKey(propertyId: string) {
    return `autopilot.doorPanel.room.${propertyId}`;
}

const PropertyDisplayShell: React.FC<Props> = ({ property }) => {
    const [roomId, setRoomId] = useState<string | null>(null);
    const [roomState, setRoomState] = useState<RoomDisplayState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const propertyId = property.property.id;

    /** Load whatever room this panel was assigned to, if any. */
    useEffect(() => {
        let saved: string | null = null;
        try {
            saved = window.localStorage.getItem(storageKey(propertyId));
        } catch {
            // Private windows and blocked site data throw here. The picker still works; the
            // choice just will not survive a reload.
        }
        // A room removed from the property since it was chosen must not strand the panel.
        if (saved && property.rooms.some(r => r.id === saved)) {
            setRoomId(saved);
        } else {
            setLoading(false);
        }
    }, [propertyId, property.rooms]);

    /** Fetch the assigned room's schedule. */
    useEffect(() => {
        if (!roomId) return;
        let cancelled = false;

        (async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/public/room-display/${roomId}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = (await res.json()) as RoomDisplayState;
                if (!cancelled) setRoomState(data);
            } catch {
                if (!cancelled) setError('Could not load this room. Check the connection.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [roomId]);

    const chooseRoom = useCallback(
        (id: string) => {
            try {
                window.localStorage.setItem(storageKey(propertyId), id);
            } catch {
                // Not fatal — the panel still works for this session.
            }
            setRoomId(id);
        },
        [propertyId]
    );

    /** Back to the picker, e.g. when a panel is moved to a different door. */
    const reassign = useCallback(() => {
        try {
            window.localStorage.removeItem(storageKey(propertyId));
        } catch {
            /* ignore */
        }
        setRoomState(null);
        setRoomId(null);
        setLoading(false);
    }, [propertyId]);

    // Assigned and loaded: hand over to the schedule screen.
    if (roomId && roomState) {
        return <RoomDisplayScreen initialState={roomState} onReassign={reassign} />;
    }

    return (
        <div
            className="relative overflow-hidden font-sans select-none"
            style={{ width: PANEL_W, height: PANEL_H, background: C.bg, color: C.text }}
        >
            <header
                className="flex items-center gap-3 px-7"
                style={{ height: 62, background: C.topbar, borderBottom: '1px solid rgba(255,255,255,0.07)' }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/autopilot-logo-white.svg" alt="Autopilot" style={{ height: 26 }} />
                <span className="text-[17px] font-bold tracking-[0.2em]">AUTOPILOT</span>
                <span style={{ color: C.faint }}>|</span>
                <span className="truncate text-[15px]" style={{ color: C.dim }}>
                    {property.property.name}
                </span>
            </header>

            {roomId && loading ? (
                <div className="flex h-[538px] flex-col items-center justify-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin" style={{ color: C.faint }} />
                    <p className="text-[18px]" style={{ color: C.dim }}>
                        Loading schedule…
                    </p>
                </div>
            ) : (
                <div className="px-10 py-7" style={{ height: 538 }}>
                    <h1 className="text-[30px] font-bold leading-tight">Which room is this panel outside?</h1>
                    <p className="mt-1.5 text-[16px]" style={{ color: C.faint }}>
                        {error ?? 'Tap once. This panel remembers, and goes straight to the schedule from now on.'}
                    </p>

                    {property.rooms.length === 0 ? (
                        <p className="mt-16 text-center text-[20px]" style={{ color: C.faint }}>
                            No active meeting rooms in this property
                        </p>
                    ) : (
                        <div
                            className="mt-6 grid gap-3 overflow-y-auto"
                            style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', maxHeight: 400 }}
                        >
                            {property.rooms.map(r => (
                                <button
                                    key={r.id}
                                    onClick={() => chooseRoom(r.id)}
                                    className="rounded-xl px-5 py-4 text-left transition-colors"
                                    style={{ background: C.card, border: '1px solid rgba(255,255,255,0.07)' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = C.cardHover)}
                                    onMouseLeave={e => (e.currentTarget.style.background = C.card)}
                                >
                                    <p className="truncate text-[21px] font-bold">{r.name}</p>
                                    <div
                                        className="mt-1.5 flex items-center gap-3 text-[14px]"
                                        style={{ color: C.faint }}
                                    >
                                        {r.location && (
                                            <span className="flex items-center gap-1 truncate">
                                                <MapPin size={14} />
                                                {r.location}
                                            </span>
                                        )}
                                        {r.capacity != null && (
                                            <span className="flex items-center gap-1">
                                                <Users size={14} />
                                                {r.capacity}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default PropertyDisplayShell;
