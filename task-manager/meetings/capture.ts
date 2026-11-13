/**
 * Owner 2026-11-13: the phone's account of a recording ("heartbeat") and the check against what reached storage.
 * Pure functions, so they can be tested without a database (task-manager/tests/test_meetings.ts).
 *
 *   capture.segments["0"].recorded = how many pieces the phone recorded for continuous recording s00
 *   storage: s00/c00000.webm, c00001.webm, …  (the FIRST piece carries the file header)
 */

/** Sarvam takes at most this many files per job (one per continuous recording). Mirrors MeetingTranscriber. */
const MAX_SEGMENTS = 20;
const MAX_PIECES = 100_000;
const DEFAULT_PIECE_SECONDS = 30;

export interface Capture {
    segments?: Record<string, { recorded: number }>;
    elapsedSeconds?: number;
    pieceSeconds?: number;
    at?: string;
    /** Set by finish(): how many pieces were missing, and whether the person chose to finish without them */
    finishedWith?: { missing: number; forced: boolean };
    /** Set by the sweep: nobody pressed Finish, the audio that arrived was processed anyway */
    autoFinished?: boolean;
}

/**
 * Folds one heartbeat into the stored record. Counts never go down (an older page cannot "un-record" a piece), and
 * recordings reported earlier stay. Anything malformed in the input is ignored, never thrown.
 */
export function mergeCapture(prev: Capture | null | undefined, input: { segments?: unknown; elapsedSeconds?: unknown; pieceSeconds?: unknown }, now = new Date()): Capture {
    const base = prev ?? {};
    const segments: Record<string, { recorded: number }> = { ...(base.segments ?? {}) };
    if (input.segments && typeof input.segments === 'object') {
        for (const [k, v] of Object.entries(input.segments as Record<string, unknown>)) {
            const seg = Number(k);
            const recorded = Number((v as { recorded?: unknown } | null)?.recorded ?? v);
            if (!Number.isInteger(seg) || seg < 0 || seg >= MAX_SEGMENTS) continue;
            if (!Number.isInteger(recorded) || recorded < 0 || recorded > MAX_PIECES) continue;
            segments[String(seg)] = { recorded: Math.max(recorded, segments[String(seg)]?.recorded ?? 0) };
        }
    }
    const elapsed = Number(input.elapsedSeconds);
    const pieceSeconds = Number(input.pieceSeconds);
    return {
        ...base, segments, at: now.toISOString(),
        elapsedSeconds: Number.isFinite(elapsed) && elapsed >= 0 ? Math.max(Math.round(elapsed), base.elapsedSeconds ?? 0) : base.elapsedSeconds,
        pieceSeconds: Number.isFinite(pieceSeconds) && pieceSeconds > 0 ? pieceSeconds : base.pieceSeconds,
    };
}

export interface Gap {
    /** Pieces the phone reported that storage does not have */
    missing: number;
    missingSeconds: number;
    /** Pieces in storage for the recordings the phone reported */
    arrived: number;
    /** Recordings with pieces but WITHOUT their first piece (the header) — unreadable by the speech service */
    brokenSegments: number[];
    /** Is there any audio at all (reported or not)? */
    anyStored: boolean;
}

/**
 * What the phone said it recorded against what storage has. `stored` maps the recording number to the piece file
 * names in it (e.g. 0 → ['c00000.webm', 'c00001.webm']). A recording in storage the phone never reported (an old
 * page without heartbeats) counts as fine.
 */
export function missingFromCapture(capture: Capture | null | undefined, stored: Map<number, string[]>): Gap {
    let missing = 0, arrived = 0;
    const brokenSegments: number[] = [];
    for (const [k, v] of Object.entries(capture?.segments ?? {})) {
        const names = stored.get(Number(k)) ?? [];
        arrived += names.length;
        missing += Math.max(0, (v?.recorded ?? 0) - names.length);
        if (names.length && !names.some(n => n.startsWith('c00000.'))) brokenSegments.push(Number(k));
    }
    const pieceSeconds = capture?.pieceSeconds ?? DEFAULT_PIECE_SECONDS;
    return { missing, arrived, brokenSegments, missingSeconds: missing * pieceSeconds, anyStored: [...stored.values()].some(n => n.length > 0) };
}

/** The recording numbers the phone has reported, for picking the next free one. */
export function reportedSegments(capture: Capture | null | undefined): number[] {
    return Object.keys(capture?.segments ?? {}).map(Number).filter(n => Number.isInteger(n) && n >= 0);
}
