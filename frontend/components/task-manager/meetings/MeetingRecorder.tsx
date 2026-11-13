'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CloudUpload, Loader2, Mic, MicOff, Pause, Play, RotateCcw, Square, Trash2, Upload, UserPlus, WifiOff, X } from 'lucide-react';
import { call, clock, meetingUrl, type MeetingPerson, type MeetingSpace } from './api';
import { forgetMeeting, pendingPieces, pieceKey, rememberMeeting, requestPersistence, savePiece, storeAvailable, type StoredPiece } from './pieceStore';
import { getUploader, type UploadProgress } from './uploader';
import AttendeesEditor, { type Attendees } from './AttendeesEditor';

/**
 * Owner 2026-10-29: records an in-room meeting on ONE phone, or uploads a recording made with another app.
 *
 * Owner 2026-11-13 — robust recording (after the FMS Review meeting of 12 Nov was lost to a signal drop + reload):
 *   - The browser records in 15-second pieces. Each piece is written to the PHONE first (pieceStore.ts, IndexedDB) and
 *     only then uploaded (uploader.ts). A reload, a tab iOS throws away, or an hour offline loses nothing: the pieces
 *     wait on the phone and go up the next time the Meeting Assistant is opened.
 *   - Every request has a time limit and retries the moment the connection is back.
 *   - Every half minute the phone tells the server how many pieces it recorded ("heartbeat"), so Finish can tell when
 *     audio is missing instead of making notes from a recording with holes.
 *   - If the microphone is taken away (a phone call, Siri, a headset unplugged, iOS pausing the page), the screen says
 *     so and recording continues in a new segment as soon as it can, instead of showing "Recording" over silence.
 *   - The screen shows real numbers (recorded / uploaded) and never a spinner that cannot end: "Finish later" leaves
 *     the pieces on the phone and the recovery banner finishes the upload.
 * The screen is kept awake while recording. The audio is deleted on the server once it has been turned into text.
 */

export const PIECE_MS = 15_000;
/** Low bit rate for speech: an hour is ~11 MB. */
const BITS_PER_SECOND = 24_000;
/** Sarvam takes up to 2 hours per recording; stop a little before. */
const MAX_RECORD_MS = 115 * 60 * 1000;
// Owner 2026-10-29: 100 MB (Supabase Pro; the bucket limit is set to match)
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const HEARTBEAT_MS = 30_000;
const CALL_TIMEOUT_MS = 20_000;
/** While finishing: after this long with nothing getting through, offer "Finish later". */
const OFFER_LATER_AFTER_MS = 20_000;

/**
 * Owner 2026-10-29: the live sound display and the "move closer" hint. The volume is read from the SAME microphone stream
 * (browser audio analyser, no library); it only drives the screen and never changes what is recorded.
 * Levels are the RMS of the signal (0–1). Starting values — tune after a test in the meeting room.
 */
const BARS = 32;
const SOUND_LEVEL = 0.004;     // below this: nothing is being picked up
const GOOD_LEVEL = 0.025;      // at or above this: voices are coming through well
const FAINT_AFTER_MS = 10_000; // sound but no good level for this long → "faint"
const SILENT_AFTER_MS = 30_000;
const FAINT_MESSAGE = 'Voices sound faint, move closer to the mic';
const SILENT_MESSAGE = 'No sound is being picked up — check that the microphone is not blocked or muted.';
type Hint = 'faint' | 'silent' | null;

/**
 * 'mic_lost'  = the microphone stopped on its own (call, other app, iOS paused the page); recording resumes when it can
 * 'missing'   = the server is still missing pieces that are not on this phone either: finish anyway, or wait
 * 'resetting' = the recording is being thrown away ("Start over" or "Delete meeting")
 */
type Phase = 'starting' | 'recording' | 'paused' | 'mic_lost' | 'stopping' | 'finishing' | 'missing' | 'resetting' | 'error';
/** Which step the "Try again" button on the error screen repeats */
type Retry = { kind: 'finish'; force: boolean } | { kind: 'mic' } | { kind: 'file' } | null;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function pickMime(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
        if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
}

/** Some phones give no type for a picked file: take it from the file name. */
function fileMime(file: File): string {
    if (file.type) return file.type;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ({ m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac', flac: 'audio/flac' } as Record<string, string>)[ext] || '';
}

const minutesSince = (t: number | null) => (t ? Math.max(1, Math.round((Date.now() - t) / 60_000)) : 0);

export default function MeetingRecorder({ space, meetingId, title, file, people, onDone, onBack, onDiscarded }: {
    space: MeetingSpace;
    meetingId: string;
    title: string;
    /** Upload this file instead of recording */
    file?: File | null;
    /** Everyone in the Task Manager, for "+ Add person" */
    people: MeetingPerson[];
    onDone: () => void;
    onBack: () => void;
    /** The meeting was deleted from the recorder ("Delete meeting") */
    onDiscarded: () => void;
}) {
    const url = useMemo(() => meetingUrl(meetingId, space), [meetingId, space]);
    const uploader = useMemo(() => getUploader(meetingId, space), [meetingId, space]);
    const [phase, setPhase] = useState<Phase>('starting');
    const [error, setError] = useState<string | null>(null);
    /** The last step that failed for lack of signal can be tried again from the error screen */
    const [retry, setRetry] = useState<Retry>(null);
    const [elapsed, setElapsed] = useState(0);
    const [recorded, setRecorded] = useState(0);
    const [up, setUp] = useState<UploadProgress>(() => uploader.progress());
    const [storeOk, setStoreOk] = useState<boolean | null>(null);
    const [missing, setMissing] = useState<{ missing: number; missingSeconds: number } | null>(null);
    const [offerLater, setOfferLater] = useState(false);
    const [attendees, setAttendees] = useState<Attendees | null>(null);
    /** Owner 2026-11-13: "Continue recording" — how much of this meeting was recorded before this page (clock + note) */
    const [earlier, setEarlier] = useState<{ seconds: number; segments: number } | null>(null);
    const [editPeople, setEditPeople] = useState(false);
    const [peopleNote, setPeopleNote] = useState<string | null>(null);

    const recorder = useRef<MediaRecorder | null>(null);
    const stream = useRef<MediaStream | null>(null);
    const segment = useRef(0);
    const nextSeq = useRef(0);
    /** Pieces recorded per continuous recording (segment number → count), for the heartbeat */
    const recordedBySeg = useRef(new Map<number, number>());
    /** Pieces still being written to the phone (Finish waits for them before asking the server) */
    const pendingSaves = useRef(0);
    const mime = useRef('audio/webm');
    const runStart = useRef<number | null>(null);
    const banked = useRef(0);
    const wake = useRef<{ release: () => Promise<void> } | null>(null);
    const started = useRef(false);
    /** The highest recording number this page has used (the next one must be above it) */
    const lastSegment = useRef(-1);
    /** Set once the earlier part's time was added to the clock, so it is added only once */
    const earlierAdded = useRef(false);
    const bars = useRef<Array<HTMLSpanElement | null>>([]);
    const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
    const [hint, setHint] = useState<Hint>(null);
    /** Owner 2026-10-30: the "throw this recording away?" box, and whether it was recording when the box opened */
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const wasRecording = useRef(false);
    /** While true, new audio pieces are dropped and uploads stop (the recording is being thrown away) */
    const discarding = useRef(false);
    /** Set while WE stop the recorder, so a stop is not mistaken for the microphone being taken away */
    const stoppingOnPurpose = useRef(false);
    /** "Finish later" was pressed: leave the page, the pieces stay on the phone */
    const leaving = useRef(false);
    /** The phase as seen from timers and microphone callbacks (kept in step by the effect below) */
    const phaseRef = useRef<Phase>('starting');
    useEffect(() => { phaseRef.current = phase; }, [phase]);

    // ── the uploader (shared with the recovery banner) ──
    useEffect(() => {
        void storeAvailable().then(ok => { setStoreOk(ok); if (ok) void requestPersistence(); });
        void rememberMeeting({ meetingId, space, title });
        const off = uploader.subscribe(setUp);
        uploader.kick(); // pieces an earlier page left on the phone go first
        return off;
    }, [meetingId, space, title, uploader]);

    // ── who is present (for the chips and "+ Add person") and, after "Continue recording", how much was recorded before.
    // Not needed to record, so a failure here is quiet. ──
    useEffect(() => {
        let live = true;
        void call<{ meeting: Attendees & { recording?: { elapsedSeconds: number; segments: number } | null } }>(url, undefined, { timeoutMs: CALL_TIMEOUT_MS }).then(r => {
            if (!live || !r.ok) return;
            setAttendees({ attendees: r.meeting.attendees, extraNames: r.meeting.extraNames });
            const before = r.meeting.recording;
            if (before && before.elapsedSeconds > 0 && !earlierAdded.current && !file) {
                // The clock carries on from where the earlier part stopped: one meeting, one running time
                earlierAdded.current = true;
                banked.current += before.elapsedSeconds * 1000;
                setEarlier({ seconds: before.elapsedSeconds, segments: before.segments });
            }
        });
        return () => { live = false; };
    }, [file, url]);

    /** Live bars + faint/silent hint, ~14 updates a second. Bars are moved directly (no re-render per frame). */
    const startMeter = useCallback((media: MediaStream) => {
        try {
            const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            void ctx.resume().catch(() => undefined);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            ctx.createMediaStreamSource(media).connect(analyser);
            const samples = new Float32Array(analyser.fftSize);
            const history: number[] = new Array(BARS).fill(0);
            let smooth = 0, lastTick = 0, shown: Hint = null;
            let lastGood = performance.now(), lastSound = performance.now();
            const loop = (now: number) => {
                if (meter.current) meter.current.raf = requestAnimationFrame(loop);
                if (now - lastTick < 70) return;
                lastTick = now;
                const live = recorder.current?.state === 'recording';
                let level = 0;
                if (live) {
                    analyser.getFloatTimeDomainData(samples);
                    let sum = 0;
                    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
                    level = Math.sqrt(sum / samples.length);
                } else {
                    // Paused: no warnings, and the clock for them starts again on resume
                    lastGood = now; lastSound = now;
                }
                smooth = smooth * 0.5 + level * 0.5;
                history.shift();
                history.push(smooth);
                bars.current.forEach((el, i) => {
                    if (el) el.style.transform = `scaleY(${live ? Math.max(0.08, Math.min(1, Math.sqrt(history[i] * 12))) : 0.08})`;
                });
                if (smooth >= GOOD_LEVEL) lastGood = now;
                if (smooth >= SOUND_LEVEL) lastSound = now;
                const next: Hint = !live ? null
                    : now - lastSound > SILENT_AFTER_MS ? 'silent'
                        : now - lastGood > FAINT_AFTER_MS && now - lastSound < 2_000 ? 'faint' : null;
                if (next !== shown) { shown = next; setHint(next); }
            };
            meter.current = { ctx, raf: requestAnimationFrame(loop) };
        } catch { /* no analyser in this browser: recording still works, just without the bars */ }
    }, []);

    const stopMeter = useCallback(() => {
        if (!meter.current) return;
        cancelAnimationFrame(meter.current.raf);
        void meter.current.ctx.close().catch(() => undefined);
        meter.current = null;
        setHint(null);
    }, []);

    const keepAwake = useCallback(async () => {
        try {
            const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
            if (nav.wakeLock && document.visibilityState === 'visible') wake.current = await nav.wakeLock.request('screen');
        } catch { /* not supported or refused: recording still works */ }
    }, []);

    const releaseAll = useCallback(() => {
        stopMeter();
        stream.current?.getTracks().forEach(t => t.stop());
        stream.current = null;
        void wake.current?.release().catch(() => undefined);
        wake.current = null;
    }, [stopMeter]);

    const elapsedMs = () => banked.current + (runStart.current ? Date.now() - runStart.current : 0);
    const bankTime = () => { if (runStart.current) { banked.current += Date.now() - runStart.current; runStart.current = null; } };

    /** The phone's report: pieces recorded per recording and the time on the clock. Quick, with a time limit; never blocks. */
    const heartbeat = useCallback(async () => {
        if (discarding.current) return;
        const segments: Record<string, { recorded: number }> = {};
        for (const [seg, n] of recordedBySeg.current) segments[String(seg)] = { recorded: n };
        await call(url, { action: 'heartbeat', segments, elapsedSeconds: Math.floor(elapsedMs() / 1000), pieceSeconds: PIECE_MS / 1000 }, { timeoutMs: CALL_TIMEOUT_MS });
    }, [url]);

    /** One piece from the microphone (or the whole picked file): saved on the phone, then handed to the uploader. */
    const keepPiece = useCallback((blob: Blob, seg: number, seq: number) => {
        recordedBySeg.current.set(seg, (recordedBySeg.current.get(seg) ?? 0) + 1);
        setRecorded(n => n + 1);
        const piece: StoredPiece = { key: pieceKey(meetingId, seg, seq), meetingId, segment: seg, seq, mime: mime.current, blob, bytes: blob.size, createdAt: Date.now() };
        pendingSaves.current++;
        void savePiece(piece).then(saved => {
            if (!saved) setStoreOk(false);
            if (!discarding.current) uploader.add(piece);
        }).finally(() => { pendingSaves.current--; });
    }, [meetingId, uploader]);

    const failed = useCallback((message: string, tryAgain: Retry = null) => {
        setError(message);
        setRetry(tryAgain);
        setPhase('error');
    }, []);

    /**
     * Recording done: wait for the pieces to go up, then tell the server. A server that is still missing pieces (not on
     * this phone either) asks whether to finish anyway. "Finish later" leaves instead of waiting for ever.
     */
    const finish = useCallback(async (force = false) => {
        setPhase('finishing');
        setOfferLater(false);
        leaving.current = false;
        // The last piece from the microphone may still be on its way into the phone's store
        while (pendingSaves.current > 0) await sleep(50);
        await heartbeat();
        uploader.kick();
        await uploader.wait();
        if (leaving.current || discarding.current) return;
        const r = await call(url, { action: 'finish', ...(force ? { force: true } : {}) }, { timeoutMs: CALL_TIMEOUT_MS });
        if (!r.ok) {
            if (r.code === 'PIECES_MISSING') {
                setMissing({ missing: Number(r.details?.missing ?? 0), missingSeconds: Number(r.details?.missingSeconds ?? 0) });
                setPhase('missing');
                return;
            }
            if (r.code === 'FINISHED') { void forgetMeeting(meetingId); onDone(); return; }
            failed(r.error, r.code === 'OFFLINE' ? { kind: 'finish', force } : null);
            return;
        }
        void forgetMeeting(meetingId);
        onDone();
    }, [failed, heartbeat, meetingId, onDone, uploader, url]);

    const stop = useCallback(() => {
        const rec = recorder.current;
        if (!rec || rec.state === 'inactive') { void finish(); return; }
        setPhase('stopping');
        bankTime();
        stoppingOnPurpose.current = true;
        rec.onstop = () => { stoppingOnPurpose.current = false; releaseAll(); void finish(); };
        rec.stop();
    }, [finish, releaseAll]);

    /** The microphone stopped without us asking (call, other app, iOS paused the page). Keep what we have; resume when we can. */
    const micLost = useCallback(() => {
        if (discarding.current || stoppingOnPurpose.current) return;
        if (!['recording', 'paused', 'starting'].includes(phaseRef.current)) return;
        bankTime();
        const rec = recorder.current;
        if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* already stopped */ } }
        recorder.current = null;
        releaseAll();
        setPhase('mic_lost');
    }, [releaseAll]);

    /** A new continuous recording: asks the server for its number, opens the microphone, starts recording in pieces. */
    const openMic = useCallback(async () => {
        setPhase('starting');
        // Owner 2026-11-13: never reuse a recording number this phone still holds audio for (the server may not have
        // heard of it yet: closed before the first report, or still uploading) — the new pieces would write over it.
        const onPhone = await pendingPieces(meetingId);
        const minSegment = Math.max(lastSegment.current, ...onPhone.map(p => p.segment)) + 1;
        const seg = await call<{ segment: number }>(url, { action: 'start_segment', minSegment }, { timeoutMs: CALL_TIMEOUT_MS });
        if (!seg.ok) {
            if (seg.code === 'FINISHED') { onDone(); return; }
            failed(seg.error, seg.code === 'OFFLINE' ? { kind: 'mic' } : null);
            return;
        }
        segment.current = Math.max(seg.segment, minSegment);
        lastSegment.current = segment.current;
        nextSeq.current = 0; // pieces are numbered from 0 inside each recording (the first one carries the file header)
        // Tell the server about this recording now, not at the first half-minute report
        if (!recordedBySeg.current.has(segment.current)) recordedBySeg.current.set(segment.current, 0);
        void heartbeat();
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            failed('This browser cannot record audio. Use Chrome or Safari on the phone, or upload a recording instead.');
            return;
        }
        try {
            stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        } catch {
            failed('Microphone access was blocked. Allow the microphone for this site and try again.', { kind: 'mic' });
            return;
        }
        const wanted = pickMime();
        const rec = new MediaRecorder(stream.current, wanted ? { mimeType: wanted, audioBitsPerSecond: BITS_PER_SECOND } : { audioBitsPerSecond: BITS_PER_SECOND });
        mime.current = rec.mimeType || wanted || 'audio/webm';
        rec.ondataavailable = e => {
            if (!e.data || e.data.size === 0 || discarding.current) return;
            keepPiece(e.data, segment.current, nextSeq.current++);
        };
        // A stop we did not ask for = the microphone was taken away
        rec.onstop = () => micLost();
        rec.onerror = () => micLost();
        for (const track of stream.current.getAudioTracks()) track.onended = () => micLost();
        recorder.current = rec;
        rec.start(PIECE_MS);
        runStart.current = Date.now();
        setPhase('recording');
        startMeter(stream.current);
        void keepAwake();
    }, [failed, heartbeat, keepAwake, keepPiece, meetingId, micLost, onDone, startMeter, url]);

    /** The picked file is one piece: saved on the phone like a recorded piece, then uploaded and finished. */
    const beginFile = useCallback(async (f: File, type: string) => {
        setPhase('starting');
        const seg = await call<{ segment: number }>(url, { action: 'start_segment' }, { timeoutMs: CALL_TIMEOUT_MS });
        if (!seg.ok) { failed(seg.error, seg.code === 'OFFLINE' ? { kind: 'file' } : null); return; }
        segment.current = seg.segment;
        mime.current = type;
        setPhase('finishing');
        keepPiece(f, seg.segment, 0);
        await finish();
    }, [failed, finish, keepPiece, url]);

    /** "Try again" on the error screen */
    const tryAgain = () => {
        if (!retry) return;
        if (retry.kind === 'finish') void finish(retry.force);
        else if (retry.kind === 'mic') void openMic();
        else if (retry.kind === 'file' && file) void beginFile(file, fileMime(file));
    };

    // ── start (once) ──
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        (async () => {
            if (!file) { await openMic(); return; }
            const type = fileMime(file);
            if (!type.startsWith('audio/') && !type.startsWith('video/')) { failed('Please choose an audio file (MP3, M4A, WAV, OGG or WEBM).'); return; }
            if (file.size > MAX_UPLOAD_BYTES) { failed('This file is larger than 100 MB. Record at "standard" quality in the phone\'s recorder app, or trim it.'); return; }
            await beginFile(file, type);
        })();
    }, [beginFile, failed, file, openMic]);

    // ── heartbeat every half minute while the meeting is live or being finished ──
    useEffect(() => {
        const t = setInterval(() => {
            if (['recording', 'paused', 'mic_lost', 'stopping', 'finishing', 'missing'].includes(phaseRef.current)) void heartbeat();
        }, HEARTBEAT_MS);
        return () => clearInterval(t);
    }, [heartbeat]);

    // ── while finishing: if nothing gets through for a while, offer to leave (the pieces stay on the phone) ──
    useEffect(() => {
        if (phase !== 'finishing') return; // (finish() clears the offer when it starts; it is only shown while finishing)
        const t = setInterval(() => {
            const p = uploader.progress();
            setOfferLater(p.pending > 0 && (p.state === 'offline' || (p.failingSince !== null && Date.now() - p.failingSince > OFFER_LATER_AFTER_MS)));
        }, 1000);
        return () => clearInterval(t);
    }, [phase, uploader]);

    /**
     * Owner 2026-10-30: throw the recording away. Stops the microphone WITHOUT keeping the last piece, drops anything not
     * yet uploaded (on the phone too), and waits for an upload already on its way to finish — so nothing arrives after
     * the server deleted the audio.
     */
    const halt = useCallback(async () => {
        discarding.current = true;
        stoppingOnPurpose.current = true;
        const rec = recorder.current;
        if (rec && rec.state !== 'inactive') {
            await new Promise<void>(resolve => { rec.onstop = () => resolve(); rec.stop(); });
        }
        recorder.current = null;
        stoppingOnPurpose.current = false;
        releaseAll();
        await uploader.clear();
        recordedBySeg.current = new Map();
        setRecorded(0);
        runStart.current = null;
        banked.current = 0;
    }, [releaseAll, uploader]);

    /** "Start over": same meeting (name, people, confidential), the audio so far deleted, a fresh recording. */
    const startOver = useCallback(async () => {
        setConfirmDiscard(false);
        setPhase('resetting');
        await halt();
        const r = await call(url, { action: 'reset_recording' }, { timeoutMs: CALL_TIMEOUT_MS });
        if (!r.ok) { failed(r.error); return; }
        discarding.current = false;
        nextSeq.current = 0;
        lastSegment.current = -1;
        setEarlier(null);
        setElapsed(0);
        await rememberMeeting({ meetingId, space, title });
        await openMic();
    }, [failed, halt, meetingId, openMic, space, title, url]);

    /** "Delete meeting": the audio and the meeting are deleted, back to the list. */
    const deleteMeeting = useCallback(async () => {
        setConfirmDiscard(false);
        setPhase('resetting');
        await halt();
        const r = await call(url, { action: 'discard' }, { timeoutMs: CALL_TIMEOUT_MS });
        if (!r.ok) { failed(r.error); return; }
        onDiscarded();
    }, [failed, halt, onDiscarded, url]);

    // ── timer, auto-stop, wake lock after the screen comes back, flush + resume around the page being hidden ──
    useEffect(() => {
        const t = setInterval(() => {
            setElapsed(Math.floor(elapsedMs() / 1000));
            if (elapsedMs() >= MAX_RECORD_MS && recorder.current?.state === 'recording') stop();
        }, 1000);
        const onVisible = () => {
            if (document.visibilityState === 'hidden') {
                // Going to the background: hand over the piece in progress now, so it is on the phone before iOS pauses us
                if (recorder.current?.state === 'recording') { try { recorder.current.requestData(); } catch { /* not recording */ } }
                return;
            }
            if (recorder.current?.state === 'recording') void keepAwake();
            // The microphone was taken away while we were in the background: pick up again
            else if (phaseRef.current === 'mic_lost') void openMic();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
    }, [keepAwake, openMic, stop]);

    // ── warn before leaving while recording or uploading; release the mic on unmount (the uploader carries on) ──
    useEffect(() => {
        const onLeave = (e: BeforeUnloadEvent) => {
            if (recorder.current?.state === 'recording' || recorder.current?.state === 'paused' || uploader.progress().pending) { e.preventDefault(); e.returnValue = ''; }
        };
        window.addEventListener('beforeunload', onLeave);
        return () => { window.removeEventListener('beforeunload', onLeave); releaseAll(); };
    }, [releaseAll, uploader]);

    const pause = () => {
        const rec = recorder.current;
        if (!rec) return;
        if (rec.state === 'recording') {
            try { rec.requestData(); } catch { /* fine */ }
            rec.pause();
            bankTime();
            setPhase('paused');
        } else if (rec.state === 'paused') {
            rec.resume();
            runStart.current = Date.now();
            setPhase('recording');
        }
    };

    /** 🗑: pause first (nothing more is captured while deciding), then ask */
    const openDiscard = () => {
        wasRecording.current = recorder.current?.state === 'recording';
        if (wasRecording.current) pause();
        setConfirmDiscard(true);
    };
    /** "Keep recording": back to where it was — recording again if it was recording */
    const cancelDiscard = () => {
        setConfirmDiscard(false);
        if (wasRecording.current && recorder.current?.state === 'paused') pause();
    };

    /** "Finish later": leave the page; the pieces stay on the phone and the recovery banner finishes the upload. */
    const finishLater = () => {
        leaving.current = true;
        onBack();
    };

    const live = phase === 'recording' || phase === 'paused';
    const btn = 'flex h-12 items-center justify-center gap-2 rounded-2xl text-sm transition-colors';
    const uploaded = Math.max(0, recorded - up.pending);
    const trouble = up.state === 'offline' || up.state === 'retrying';

    return (
        <div className="mx-auto max-w-xl space-y-4 sm:space-y-5">
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 text-center shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="truncate text-xs font-bold uppercase tracking-widest text-zinc-500">{title}</p>

                {phase === 'recording' && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-white" role="status">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Recording
                    </div>
                )}
                {phase === 'paused' && <div className="mt-4 inline-flex rounded-full bg-amber-500 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-white">Paused</div>}
                {phase === 'mic_lost' && <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-white"><MicOff className="h-3.5 w-3.5" /> Microphone stopped</div>}

                {(live || phase === 'stopping' || phase === 'mic_lost') && (
                    <p className="mt-5 font-mono text-5xl font-black tabular-nums text-zinc-900 sm:text-6xl dark:text-zinc-100">{clock(elapsed)}</p>
                )}

                {/* Owner 2026-10-29: live sound bars — they move when someone is speaking */}
                {live && (
                    <div className="mt-5 flex h-14 items-center justify-center gap-[3px] sm:h-16" aria-hidden="true">
                        {Array.from({ length: BARS }, (_, i) => (
                            <span key={i} ref={el => { bars.current[i] = el; }}
                                className={`h-full w-1 origin-center rounded-full sm:w-1.5 transition-transform duration-75 ${phase === 'paused' ? 'bg-zinc-300 dark:bg-zinc-700' : 'bg-sky-500'}`} />
                        ))}
                    </div>
                )}
                {live && hint && (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" role="status">
                        {hint === 'faint' ? FAINT_MESSAGE : SILENT_MESSAGE}
                    </p>
                )}

                {/* Owner 2026-11-13: the microphone was taken away (call, Siri, another app, iOS paused the page) */}
                {phase === 'mic_lost' && (
                    <div className="mt-4 space-y-3">
                        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" role="status">
                            The phone stopped the microphone (a call, another app, or the screen was locked). Everything up to {clock(elapsed)} is kept. Recording picks up again as soon as you come back to this page.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => void openMic()} className={`${btn} bg-red-600 font-black text-white hover:bg-red-700`}><Mic className="h-4 w-4" /> Resume now</button>
                            <button type="button" onClick={stop} className={`${btn} border border-zinc-300 font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800`}><Square className="h-4 w-4" /> Stop and make notes</button>
                        </div>
                    </div>
                )}

                {phase === 'starting' && <p className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> {file ? 'Preparing the upload…' : 'Starting the microphone…'}</p>}
                {phase === 'resetting' && (
                    <p className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300" role="status">
                        <Loader2 className="h-4 w-4 animate-spin" /> Deleting the recording…
                    </p>
                )}
                {(phase === 'stopping' || phase === 'finishing') && (
                    <div className="mt-6 space-y-3">
                        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                            {file ? <Upload className="h-4 w-4" /> : <CloudUpload className="h-4 w-4" />}
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {up.pending > 0
                                ? (file ? 'Uploading the recording…' : `Uploading the last pieces… ${up.pending} left`)
                                : 'Finishing…'}
                        </p>
                        {trouble && (
                            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" role="status">
                                {up.state === 'offline' ? 'No connection right now.' : `The upload is having trouble (${minutesSince(up.failingSince)} min).`} The pieces are saved on this phone and will go up as soon as they can.
                            </p>
                        )}
                        {offerLater && (
                            <div className="space-y-1.5">
                                <button type="button" onClick={finishLater} className={`${btn} mx-auto w-full border border-zinc-300 px-5 font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800`}>
                                    Finish later
                                </button>
                                <p className="text-[11px] text-zinc-500">You can leave this page. The audio stays on this phone and uploads the next time you open the Meeting Assistant; then press &ldquo;Finish and make notes&rdquo;.</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Owner 2026-11-13: the server is missing pieces that are not on this phone either */}
                {phase === 'missing' && missing && (
                    <div className="mt-5 space-y-3 text-left">
                        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>About {clock(missing.missingSeconds)} of the recording ({missing.missing} piece{missing.missing === 1 ? '' : 's'}) never reached the server, and it is not on this phone either. The notes can still be made from the rest.</span>
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <button type="button" onClick={() => void finish(true)} className={`${btn} bg-zinc-900 px-5 font-black text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200`}>Finish anyway</button>
                            <button type="button" onClick={() => void finish(false)} className={`${btn} border border-zinc-300 px-5 font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800`}>Check again</button>
                        </div>
                    </div>
                )}

                {live && (
                    <>
                        {earlier && (
                            <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
                                Earlier part of this meeting: {clock(earlier.seconds)} already recorded and saved. The clock continues from there, and everything is joined into one set of notes at the end.
                            </p>
                        )}
                        {/* Owner 2026-11-13: real numbers instead of "everything is saved" */}
                        <p className="mt-3 text-xs font-semibold text-zinc-500">
                            Keep the phone in the middle of the table, screen on.
                        </p>
                        <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-semibold" role="status">
                            <span className="text-zinc-600 dark:text-zinc-300">Uploaded {uploaded} of {recorded} piece{recorded === 1 ? '' : 's'}</span>
                            {up.state === 'offline' && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"><WifiOff className="h-3 w-3" /> Offline — saved on the phone</span>}
                            {up.state === 'retrying' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Upload trouble for {minutesSince(up.failingSince)} min — saved on the phone, retrying</span>}
                            {!trouble && up.pending > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">Uploading…</span>}
                            {!trouble && up.pending === 0 && recorded > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">All uploaded</span>}
                        </p>
                        {storeOk === false && (
                            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                This browser cannot keep a safety copy on the phone. Keep this page open until every piece has uploaded.
                            </p>
                        )}
                        {/* Phone: 🗑 + Pause on one row, Stop full width below (large tap targets). Wider screens: one row. */}
                        <div className="mt-6 grid grid-cols-[auto_1fr] gap-2 sm:flex sm:justify-center sm:gap-3">
                            <button type="button" onClick={openDiscard} aria-label="Delete or restart the recording" title="Delete or restart"
                                className={`${btn} w-12 shrink-0 border border-zinc-300 text-zinc-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:hover:bg-red-950/40`}>
                                <Trash2 className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={pause} className={`${btn} border border-zinc-300 px-5 font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800`}>
                                {phase === 'paused' ? <><Play className="h-4 w-4" /> Resume</> : <><Pause className="h-4 w-4" /> Pause</>}
                            </button>
                            <button type="button" onClick={stop} className={`${btn} col-span-2 bg-zinc-900 px-6 font-black text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200`}>
                                <Square className="h-4 w-4" /> Stop and make notes
                            </button>
                        </div>
                    </>
                )}

                {phase === 'error' && (
                    <div className="mt-5 space-y-4">
                        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>
                        {recorded > 0 && up.pending > 0 && <p className="text-xs font-semibold text-zinc-500">{up.pending} piece{up.pending === 1 ? '' : 's'} of audio {up.pending === 1 ? 'is' : 'are'} saved on this phone and will upload when the connection is back.</p>}
                        <div className="flex justify-center gap-2">
                            {retry && <button type="button" onClick={tryAgain} className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-black text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"><RotateCcw className="h-4 w-4" /> Try again</button>}
                            <button type="button" onClick={onBack} className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Back</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Owner 2026-11-13: who is present, changeable while the meeting runs (someone joined late) */}
            {(live || phase === 'mic_lost' || phase === 'starting') && attendees && (
                <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {attendees.attendees.map(a => <span key={a.id} className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{a.name}</span>)}
                        {attendees.extraNames.map(n => <span key={n} className="rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-[11px] font-bold text-zinc-500 dark:border-zinc-700">{n}</span>)}
                        {attendees.attendees.length + attendees.extraNames.length === 0 && <span className="text-xs font-semibold text-zinc-500">Nobody marked as present yet.</span>}
                        <button type="button" onClick={() => setEditPeople(true)}
                            className="ml-auto flex items-center gap-1.5 rounded-full border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                            <UserPlus className="h-3.5 w-3.5" /> Add person
                        </button>
                    </div>
                    {peopleNote && <p className="mt-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400" role="status">{peopleNote}</p>}
                </div>
            )}
            {editPeople && attendees && (
                <AttendeesEditor space={space} meetingId={meetingId} people={people} current={attendees}
                    onClose={() => setEditPeople(false)}
                    onSaved={next => { setAttendees({ attendees: next.attendees, extraNames: next.extraNames }); setEditPeople(false); setPeopleNote('Saved. The new names will be used for the transcript and the notes.'); }} />
            )}

            {live && (
                <p className="flex items-start gap-2 px-2 text-xs text-zinc-500">
                    <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Tip: say actions clearly (&ldquo;Action for Ramesh: three quotes by Friday&rdquo;) and recap the tasks in the last two minutes.
                </p>
            )}

            {/* Owner 2026-10-30: throw the recording away — a sheet from the bottom on a phone, a box in the middle on wider screens */}
            {confirmDiscard && (
                <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4"
                    onKeyDown={e => { if (e.key === 'Escape') cancelDiscard(); }}>
                    <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-[2px]" onClick={cancelDiscard} aria-hidden="true" />
                    <div role="dialog" aria-modal="true" aria-labelledby="discard-title"
                        className="relative w-full space-y-4 rounded-t-3xl border border-zinc-200 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/50"><Trash2 className="h-5 w-5" /></span>
                            <div className="min-w-0 flex-1">
                                <h3 id="discard-title" className="text-lg font-black text-zinc-900 dark:text-zinc-100">Throw this recording away?</h3>
                                <p className="text-sm text-zinc-500">{clock(elapsed)} recorded so far. It is paused. Deleted audio cannot be brought back.</p>
                            </div>
                            <button type="button" onClick={cancelDiscard} aria-label="Close" className="-mr-1 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
                        </div>
                        <div className="space-y-2">
                            <button type="button" onClick={() => void startOver()}
                                className={`${btn} w-full bg-zinc-900 font-black text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200`}>
                                <RotateCcw className="h-4 w-4" /> Start over
                            </button>
                            <p className="px-1 text-center text-[11px] text-zinc-500">Deletes the audio and starts a fresh recording. The meeting name and people are kept.</p>
                            <button type="button" onClick={() => void deleteMeeting()}
                                className={`${btn} w-full border border-red-200 font-bold text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40`}>
                                <Trash2 className="h-4 w-4" /> Delete meeting
                            </button>
                            <button type="button" autoFocus onClick={cancelDiscard}
                                className={`${btn} w-full font-bold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800`}>
                                Keep recording
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
