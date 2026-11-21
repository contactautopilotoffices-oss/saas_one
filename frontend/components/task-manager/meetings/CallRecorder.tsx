'use client';

/**
 * Owner 2026-11-19 — records an online call's sound in THIS browser, so we stay on LiveKit's free plan (its own
 * recording is capped at 60 minutes a month). No UI; it sits inside the team's call (VideoCall.tsx).
 *
 * Every few seconds the page checks in with the server ('recorder'). The server picks ONE team member's browser to
 * record; the others only watch, and one of them takes over if the recorder leaves (rules: task-manager/meetings/
 * online.ts `recorderDecision`). The recording browser:
 *   - mixes its own microphone with every other person's sound (browser audio mixer, no library) — exactly what the
 *     call sounds like, so the room's laptop and the people online are all in it;
 *   - records 15-second pieces with the phone recorder's settings, keeps a safety copy on the device (pieceStore) and
 *     uploads them with the phone recorder's uploader into the same folders (sNN/cNNNNN), so the notes steps are the
 *     same as for an in-room meeting;
 *   - when it stops (left the call, lost the job, the call ended) uploads what is left and says so ('recorder_done').
 * A browser that cannot record says so too, and the job goes to someone else.
 */

import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type Room } from 'livekit-client';
import { RECORDER_BEAT_MS } from '@/task-manager/meetings/online';
import { call } from './api';
import { BITS_PER_SECOND, PIECE_MS, pickMime } from './MeetingRecorder';
import { pieceKey, savePiece, type StoredPiece } from './pieceStore';
import { getUploader } from './uploader';

/** checking: not known yet · here: this browser records · elsewhere: someone else's does · off: nobody's does */
export type CallRecordingState = 'checking' | 'here' | 'elsewhere' | 'off';

type Beat = { role: 'record'; segment: number } | { role: 'watch'; recording: boolean };

interface Active {
    segment: number;
    pieces: number;
    stop: () => Promise<void>;
}

const CALL_TIMEOUT_MS = 15_000;
const SYNC_EVENTS = [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished] as const;

export default function CallRecorder({ meetingId, endpoint, onState }: {
    meetingId: string;
    /** The call's join API (it takes 'recorder', 'recorder_done' and 'upload_urls') */
    endpoint: string;
    onState: (s: CallRecordingState) => void;
}) {
    const room = useRoomContext();
    const report = useRef(onState);
    useEffect(() => { report.current = onState; }, [onState]);

    useEffect(() => {
        let mounted = true;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let active: Active | null = null;
        const uploader = getUploader(meetingId, null, endpoint);

        const done = (a: Active, cannot = false) => call(endpoint, { action: 'recorder_done', segment: a.segment, pieces: a.pieces, cannot }, { timeoutMs: CALL_TIMEOUT_MS });

        /** Stops this browser's recording: last piece saved, everything uploaded, then the server is told. */
        const finish = async (a: Active) => {
            await a.stop();
            await uploader.wait();
            await done(a);
        };

        const beat = async () => {
            const r = await call<Beat>(endpoint, { action: 'recorder', segment: active?.segment ?? null, pieces: active?.pieces ?? 0 }, { timeoutMs: CALL_TIMEOUT_MS });
            if (!mounted) return;
            if (r.ok) {
                if (r.role === 'record') {
                    if (!active || active.segment !== r.segment) {
                        if (active) void finish(active);
                        active = startRecording(room, meetingId, r.segment, uploader.add.bind(uploader));
                        if (!active) {
                            // This browser cannot record: hand the job on
                            void done({ segment: r.segment, pieces: 0, stop: async () => undefined }, true);
                            report.current('off');
                        }
                    }
                    if (active) report.current('here');
                } else {
                    if (active) { void finish(active); active = null; }
                    report.current(r.recording ? 'elsewhere' : 'off');
                }
            }
            // A failed check-in keeps things as they are and tries again
            timer = setTimeout(() => void beat(), RECORDER_BEAT_MS);
        };
        void beat();

        return () => {
            mounted = false;
            if (timer) clearTimeout(timer);
            // Left the call (or the page is closing): the recording ends, its last pieces still go up
            if (active) void finish(active);
            active = null;
        };
    }, [room, meetingId, endpoint]);

    return null;
}

/**
 * Starts recording the call's mixed sound as recording number `segment`. Returns null when this browser cannot
 * (no MediaRecorder or no audio mixer).
 */
function startRecording(room: Room, meetingId: string, segment: number, upload: (p: StoredPiece) => void): Active | null {
    type AudioCtx = typeof AudioContext;
    const Ctx: AudioCtx | undefined = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtx }).webkitAudioContext) : undefined;
    if (!Ctx || typeof MediaRecorder === 'undefined') return null;

    let ctx: AudioContext | null = null;
    let recorder: MediaRecorder;
    const sources = new Map<string, { trackId: string; node: MediaStreamAudioSourceNode }>();
    try {
        const audio = new Ctx();
        ctx = audio;
        void audio.resume().catch(() => undefined);
        const mix = audio.createMediaStreamDestination();

        /** Puts every current audio track of the call (own microphone, everyone else) into the mix, and only those. */
        const sync = () => {
            const want = new Map<string, MediaStreamTrack>();
            for (const pub of room.localParticipant.audioTrackPublications.values()) {
                if (pub.track?.mediaStreamTrack) want.set(`local:${pub.trackSid}`, pub.track.mediaStreamTrack);
            }
            for (const p of room.remoteParticipants.values()) {
                for (const pub of p.audioTrackPublications.values()) {
                    if (pub.track?.mediaStreamTrack) want.set(`${p.identity}:${pub.trackSid}`, pub.track.mediaStreamTrack);
                }
            }
            for (const [key, s] of sources) {
                const t = want.get(key);
                if (!t || t.id !== s.trackId) { s.node.disconnect(); sources.delete(key); }
            }
            for (const [key, t] of want) {
                if (sources.has(key) || t.readyState === 'ended') continue;
                try {
                    const node = audio.createMediaStreamSource(new MediaStream([t]));
                    node.connect(mix);
                    sources.set(key, { trackId: t.id, node });
                } catch { /* a track that cannot be mixed is left out */ }
            }
        };
        sync();
        for (const ev of SYNC_EVENTS) room.on(ev, sync);
        // Also every few seconds: a microphone that was switched gives a new track without an event we listen to
        const resync = setInterval(sync, 5_000);

        const wanted = pickMime();
        recorder = new MediaRecorder(mix.stream, wanted ? { mimeType: wanted, audioBitsPerSecond: BITS_PER_SECOND } : { audioBitsPerSecond: BITS_PER_SECOND });
        const mime = recorder.mimeType || wanted || 'audio/webm';
        let seq = 0;
        const saves: Promise<unknown>[] = [];
        const active: Active = {
            segment,
            pieces: 0,
            stop: async () => {
                clearInterval(resync);
                for (const ev of SYNC_EVENTS) room.off(ev, sync);
                if (recorder.state !== 'inactive') {
                    await new Promise<void>(resolve => {
                        recorder.addEventListener('stop', () => resolve(), { once: true });
                        try { recorder.stop(); } catch { resolve(); }
                    });
                }
                await Promise.all(saves);
                for (const s of sources.values()) s.node.disconnect();
                sources.clear();
                await audio.close().catch(() => undefined);
            },
        };
        recorder.ondataavailable = e => {
            if (!e.data || !e.data.size) return;
            const n = seq++;
            active.pieces++;
            const piece: StoredPiece = { key: pieceKey(meetingId, segment, n), meetingId, segment, seq: n, mime, blob: e.data, bytes: e.data.size, createdAt: Date.now() };
            // Safety copy on this device first, then up (the uploader also works without the copy)
            saves.push(savePiece(piece).catch(() => false).then(() => upload(piece)));
        };
        recorder.start(PIECE_MS);
        return active;
    } catch {
        for (const s of sources.values()) s.node.disconnect();
        void (ctx as AudioContext | null)?.close().catch(() => undefined);
        return null;
    }
}
