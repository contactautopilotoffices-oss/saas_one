'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutList } from 'lucide-react';
import type { RoomDisplayState, AgendaRow } from '@/backend/lib/meetingRooms/roomDisplay';

/**
 * Owner 2026-11-24: the meeting-room door panel, drawn at exactly 1024x600 -- the native
 * resolution of the ESP32-S3-Touch-LCD-7B screens going on the room doors.
 *
 * Read at 1-2 metres in a corridor, so: no scrolling, nothing below 13px, and the room's state
 * carried by a colour a passer-by resolves before reading a word.
 *
 * Layout is fixed and pixel-addressed on purpose -- this file is also the spec the LVGL firmware
 * in firmware/room-display/ mirrors, so a change here should be mirrored there.
 *
 * Display-only by design. There is no write path on this screen; booking from the panel is
 * designed in docs/MEETING_ROOM_DISPLAY_PLAN.md.
 */

interface Props {
    initialState: RoomDisplayState;
}

const PANEL_W = 1024;
const PANEL_H = 600;
const TOPBAR_H = 62;
const LEFT_W = 320;

/* Mock-up palette. Orange rather than red for "in use": at 2 metres it separates from the green
   far more cleanly than red does, and it sits closer to the brand sand than red would. */
const C = {
    bgLeft: '#141A20',
    bgRight: '#0B0F12',
    topbar: '#0E1318',
    hairline: 'rgba(255,255,255,0.07)',
    text: '#FFFFFF',
    dim: '#8A949C',
    faint: '#5A646C',
    busy: '#F7861D',
    busySoft: 'rgba(247,134,29,0.13)',
    free: '#3DD68C',
    next: '#3B82F6',
    sand: '#AA895F',
};

const MAX_ROWS = 8;

/**
 * A panel left showing someone else's room is worse than one with no menu at all — everyone
 * walking past reads the wrong schedule. So after this long on a room other than the one this
 * panel is mounted outside, it returns home on its own. Set to 0 to disable.
 */
const AUTO_RETURN_SECONDS = 60;


const RoomDisplayScreen: React.FC<Props> = ({ initialState }) => {
    const [state, setState] = useState<RoomDisplayState>(initialState);
    const [online, setOnline] = useState(true);
    const [clock, setClock] = useState('');

    /** The room this panel is mounted outside. The menu can wander; this never changes. */
    const homeRoomId = initialState.room.id;
    const [roomId, setRoomId] = useState(homeRoomId);
    const [menuOpen, setMenuOpen] = useState(false);

    const pollMs = (state.poll_after_sec || 30) * 1000;

    // The panel's own clock ticks locally so the time never looks frozen between polls.
    useEffect(() => {
        const tick = () =>
            setClock(
                new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                }).format(new Date())
            );
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    const refresh = useCallback(
        async (id: string = roomId) => {
            try {
                const res = await fetch(`/api/public/room-display/${id}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                setState((await res.json()) as RoomDisplayState);
                setOnline(true);
            } catch {
                // Keep showing the last good schedule and flag it, rather than blanking the wall.
                setOnline(false);
            }
        },
        [roomId]
    );

    useEffect(() => {
        const id = setInterval(() => refresh(), pollMs);
        return () => clearInterval(id);
    }, [refresh, pollMs]);

    const selectRoom = useCallback(
        (id: string) => {
            setMenuOpen(false);
            if (id === roomId) return;
            setRoomId(id);
            refresh(id);
        },
        [roomId, refresh]
    );

    // Wander back to this panel's own room once nobody is looking.
    useEffect(() => {
        if (AUTO_RETURN_SECONDS <= 0) return;
        if (roomId === homeRoomId || menuOpen) return;
        const timer = setTimeout(() => {
            setRoomId(homeRoomId);
            refresh(homeRoomId);
        }, AUTO_RETURN_SECONDS * 1000);
        return () => clearTimeout(timer);
    }, [roomId, homeRoomId, menuOpen, refresh]);

    const { room, current, agenda, free_for_min } = state;
    const isBusy = state.state === 'busy';

    /* More rows than fit: drop finished ones from the top first, so "now" and what follows
       always survive. */
    const visibleRows = useMemo(() => {
        if (agenda.length <= MAX_ROWS) return agenda;
        const rows = [...agenda];
        while (rows.length > MAX_ROWS) {
            const leadIsDone =
                rows[0].kind === 'booking' ? rows[0].state === 'done' : rows[0].end_min <= state.now_min;
            if (!leadIsDone) break;
            rows.shift();
        }
        return rows.slice(0, MAX_ROWS);
    }, [agenda, state.now_min]);

    return (
        <div
            className="relative overflow-hidden font-sans select-none"
            style={{ width: PANEL_W, height: PANEL_H, background: C.bgRight, color: C.text }}
        >
            {/* ---------------- Top bar: brand + property ---------------- */}
            <header
                className="flex items-center justify-between px-7"
                style={{ height: TOPBAR_H, background: C.topbar, borderBottom: `1px solid ${C.hairline}` }}
            >
                <div className="flex items-center gap-3 min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/autopilot-logo-white.svg" alt="Autopilot" style={{ height: 26 }} />
                    <span className="text-[17px] font-bold tracking-[0.2em]">AUTOPILOT</span>
                    {room.property_name && (
                        <>
                            <span style={{ color: C.faint }}>|</span>
                            <span className="truncate text-[15px]" style={{ color: C.dim }}>
                                {room.property_name}
                            </span>
                        </>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-4">
                    {/* Room menu. Only offered when the property actually has another room. */}
                    {state.property_rooms.length > 1 && (
                        <button
                            onClick={() => setMenuOpen(o => !o)}
                            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] transition-colors"
                            style={{
                                background: menuOpen ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
                                color: C.dim,
                            }}
                        >
                            <LayoutList size={15} />
                            Rooms
                        </button>
                    )}
                    <div className="flex items-center gap-2">
                        <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: online ? C.free : C.busy }}
                        />
                        <span className="text-[13px]" style={{ color: C.faint }}>
                            {online ? 'Live' : 'Reconnecting'}
                        </span>
                    </div>
                </div>
            </header>

            {/* Room picker. Sits over the screen so nothing below has to reflow. */}
            {menuOpen && (
                <>
                    <div
                        className="absolute inset-0 z-10"
                        style={{ background: 'rgba(0,0,0,0.5)', top: TOPBAR_H }}
                        onClick={() => setMenuOpen(false)}
                    />
                    <div
                        className="absolute z-20 overflow-hidden rounded-xl"
                        style={{
                            top: TOPBAR_H + 8,
                            right: 28,
                            width: 320,
                            maxHeight: 460,
                            overflowY: 'auto',
                            background: '#1A2026',
                            border: '1px solid rgba(255,255,255,0.1)',
                        }}
                    >
                        {state.property_rooms.map(r => {
                            const isCurrent = r.id === roomId;
                            const isHome = r.id === homeRoomId;
                            return (
                                <button
                                    key={r.id}
                                    onClick={() => selectRoom(r.id)}
                                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
                                    style={{
                                        background: isCurrent ? 'rgba(255,255,255,0.08)' : 'transparent',
                                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                                    }}
                                >
                                    <span
                                        className="truncate text-[16px]"
                                        style={{ color: isCurrent ? C.text : C.dim }}
                                    >
                                        {r.name}
                                    </span>
                                    {isHome && (
                                        <span
                                            className="ml-2 shrink-0 text-[11px] uppercase tracking-wider"
                                            style={{ color: C.faint }}
                                        >
                                            This door
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}

            <div className="flex" style={{ height: PANEL_H - TOPBAR_H }}>
                {/* ---------------- Left: this room, right now ---------------- */}
                <section
                    className="flex flex-col px-6 py-6"
                    style={{ width: LEFT_W, background: C.bgLeft, borderRight: `1px solid ${C.hairline}` }}
                >
                    {/* Says plainly that this is not the room the panel is mounted outside. */}
                    {roomId !== homeRoomId && (
                        <button
                            onClick={() => selectRoom(homeRoomId)}
                            className="mb-2 flex w-full items-center justify-center rounded-lg py-1.5 text-[12px] font-semibold uppercase tracking-wider"
                            style={{ background: 'rgba(59,130,246,0.15)', color: C.next }}
                        >
                            Viewing another room — tap to return
                        </button>
                    )}
                    <h1 className="truncate text-[30px] font-bold leading-tight">{room.name}</h1>
                    {room.meta_line && (
                        <p className="mt-1 truncate text-[13px]" style={{ color: C.faint }}>
                            {room.meta_line}
                        </p>
                    )}

                    {/* State pill */}
                    <div
                        className="mt-6 flex items-center justify-between rounded-xl px-4 py-3"
                        style={{ background: isBusy ? C.busy : 'rgba(61,214,140,0.14)' }}
                    >
                        <span className="flex items-center gap-2">
                            <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ background: isBusy ? '#1A1206' : C.free }}
                            />
                            <span
                                className="text-[17px] font-bold tracking-wide"
                                style={{ color: isBusy ? '#1A1206' : C.free }}
                            >
                                {isBusy ? 'IN USE' : 'AVAILABLE'}
                            </span>
                        </span>
                        <span
                            className="text-[12px] font-semibold"
                            style={{ color: isBusy ? 'rgba(26,18,6,0.75)' : C.free }}
                        >
                            {isBusy && current
                                ? `${current.ends_in_min} min left`
                                : free_for_min != null
                                  ? `${free_for_min} min free`
                                  : 'rest of day'}
                        </span>
                    </div>

                    {/* Who has it */}
                    {isBusy && current ? (
                        <div className="mt-5">
                            <p
                                className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                                style={{ color: C.faint }}
                            >
                                Booked by
                            </p>
                            <p className="mt-1.5 truncate text-[24px] font-bold leading-tight">
                                {current.booked_by}
                            </p>

                            {/* Company only when the booking actually has one. */}
                            {current.company && (
                                <p className="mt-1 truncate text-[15px]" style={{ color: C.dim }}>
                                    {current.company}
                                </p>
                            )}

                            {/* The booker's own note, e.g. "Booked for XYZ". */}
                            {current.comment && (
                                <p
                                    className="mt-2.5 rounded-lg px-3 py-2 text-[14px] leading-snug"
                                    style={{
                                        background: 'rgba(255,255,255,0.05)',
                                        color: C.dim,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                    }}
                                >
                                    {current.comment}
                                </p>
                            )}

                            <p className="mt-3 text-[14px]" style={{ color: C.dim }}>
                                {current.start} to {current.end}
                            </p>

                            {/* Progress through the meeting */}
                            <div
                                className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full"
                                style={{ background: 'rgba(255,255,255,0.08)' }}
                            >
                                <div
                                    className="h-full rounded-full"
                                    style={{ width: `${current.elapsed_pct}%`, background: C.busy }}
                                />
                            </div>
                            <div
                                className="mt-1.5 flex justify-between text-[11px]"
                                style={{ color: C.faint }}
                            >
                                <span>{current.start}</span>
                                <span>{current.end}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-5">
                            <p
                                className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                                style={{ color: C.faint }}
                            >
                                Free until
                            </p>
                            <p className="mt-1.5 text-[26px] font-bold leading-tight">
                                {state.next ? state.next.start : 'End of day'}
                            </p>
                            {state.next && (
                                <>
                                    <p className="mt-1.5 truncate text-[15px]" style={{ color: C.dim }}>
                                        Then {state.next.booked_by}
                                    </p>
                                    {state.next.company && (
                                        <p className="truncate text-[14px]" style={{ color: C.faint }}>
                                            {state.next.company}
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    <div className="mt-auto">
                        <p className="text-[12px] leading-snug" style={{ color: C.faint }}>
                            Book this room in the Autopilot app
                        </p>
                    </div>
                </section>

                {/* ---------------- Right: the whole day ---------------- */}
                <section className="flex flex-1 flex-col px-7 py-5">
                    <div className="flex items-start justify-between">
                        <div>
                            <p
                                className="text-[11px] font-semibold uppercase tracking-[0.2em]"
                                style={{ color: C.faint }}
                            >
                                Today
                            </p>
                            <p className="mt-1 text-[22px] font-bold">{state.date_label}</p>
                        </div>
                        <p className="text-[40px] font-bold leading-none tabular-nums">{clock}</p>
                    </div>

                    <div className="mt-4 flex flex-col gap-1.5">
                        {visibleRows.length === 0 ? (
                            <p className="mt-10 text-center text-[18px]" style={{ color: C.faint }}>
                                Nothing booked today — the room is free all day
                            </p>
                        ) : (
                            visibleRows.map((row, i) => <AgendaLine key={`${row.start}-${i}`} row={row} />)
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};

/** One agenda line: a booking, or a bookable gap between bookings. */
const AgendaLine: React.FC<{ row: AgendaRow }> = ({ row }) => {
    const isFree = row.kind === 'free';
    const isNow = row.kind === 'booking' && row.state === 'now';
    const isDone = row.kind === 'booking' && row.state === 'done';
    const isNext = row.kind === 'booking' && row.state === 'next';

    return (
        <div
            className="flex items-center gap-4 rounded-lg px-3.5 py-2.5"
            style={{
                background: isNow ? C.busySoft : 'rgba(255,255,255,0.028)',
                borderLeft: `3px solid ${isNow ? C.busy : 'transparent'}`,
                opacity: isDone ? 0.45 : 1,
            }}
        >
            {/* Time, stacked like the mock-up so long room names get the width */}
            <div
                className="shrink-0 text-[13px] font-semibold leading-tight tabular-nums"
                style={{ width: 62, color: isNow ? C.busy : isFree ? C.free : C.dim }}
            >
                <div>{row.start} to</div>
                <div>{row.end}</div>
            </div>

            <div className="min-w-0 flex-1">
                {row.kind === 'free' ? (
                    <p className="truncate text-[17px] font-semibold" style={{ color: C.free }}>
                        {row.label}
                    </p>
                ) : (
                    <>
                        <p className="truncate text-[17px] font-bold leading-tight">
                            {row.booked_by}
                            {row.company && (
                                <span className="font-medium" style={{ color: C.faint }}>
                                    {' · '}
                                    {row.company}
                                </span>
                            )}
                        </p>
                        {/* The booker's note, when there is one — often who the room is really for. */}
                        {row.comment && (
                            <p className="truncate text-[13px] leading-tight" style={{ color: C.dim }}>
                                {row.comment}
                            </p>
                        )}
                    </>
                )}
            </div>

            <div className="shrink-0">
                {isNow && <Badge bg={C.busy} fg="#1A1206" label="NOW" />}
                {isNext && <Badge bg={C.next} fg="#FFFFFF" label="UP NEXT" />}
                {isDone && (
                    <span className="text-[12px] font-medium" style={{ color: C.faint }}>
                        Done
                    </span>
                )}
            </div>
        </div>
    );
};

const Badge: React.FC<{ bg: string; fg: string; label: string }> = ({ bg, fg, label }) => (
    <span
        className="rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide"
        style={{ background: bg, color: fg }}
    >
        {label}
    </span>
);

export default RoomDisplayScreen;
