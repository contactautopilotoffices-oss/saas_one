'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CloudUpload, Loader2, Mic, Pause, Play, Square, Upload } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { call, clock, meetingUrl, type MeetingSpace } from './api';

/**
 * Owner 2026-10-29: records an in-room meeting on ONE phone, or uploads a recording made with another app.
 * The browser records in 30-second pieces; each piece goes straight to private storage through a one-time upload link.
 * A piece that fails to upload waits and is tried again, so a network drop loses nothing while the page stays open.
 * The screen is kept awake while recording. The audio is deleted on the server once it has been turned into text.
 */

const PIECE_MS = 30_000;
/** Low bit rate for speech: an hour is ~11 MB. */
const BITS_PER_SECOND = 24_000;
/** Sarvam takes up to 2 hours per recording; stop a little before. */
const MAX_RECORD_MS = 115 * 60 * 1000;
// Owner 2026-10-29: 100 MB (Supabase Pro; the bucket limit is set to match)
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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

type Piece = { seq: number; blob: Blob };
type Phase = 'starting' | 'recording' | 'paused' | 'stopping' | 'finishing' | 'error';

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

export default function MeetingRecorder({ space, meetingId, title, file, onDone, onBack }: {
    space: MeetingSpace;
    meetingId: string;
    title: string;
    /** Upload this file instead of recording */
    file?: File | null;
    onDone: () => void;
    onBack: () => void;
}) {
    const supabase = useMemo(() => createClient(), []);
    const [phase, setPhase] = useState<Phase>('starting');
    const [error, setError] = useState<string | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [waiting, setWaiting] = useState(0);
    const [uploadNote, setUploadNote] = useState<string | null>(null);

    const recorder = useRef<MediaRecorder | null>(null);
    const stream = useRef<MediaStream | null>(null);
    const queue = useRef<Piece[]>([]);
    const pumping = useRef(false);
    const segment = useRef(0);
    const nextSeq = useRef(0);
    const mime = useRef('audio/webm');
    const runStart = useRef<number | null>(null);
    const banked = useRef(0);
    const wake = useRef<{ release: () => Promise<void> } | null>(null);
    const started = useRef(false);
    const bars = useRef<Array<HTMLSpanElement | null>>([]);
    const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
    const [hint, setHint] = useState<Hint>(null);

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

    const uploadPiece = useCallback(async (p: Piece) => {
        const link = await call<{ bucket: string; path: string; token: string; contentType: string }>(meetingUrl(meetingId, space), { action: 'upload_url', segment: segment.current, seq: p.seq, mimeType: mime.current });
        if (!link.ok) throw new Error(link.error);
        const { error: upErr } = await supabase.storage.from(link.bucket).uploadToSignedUrl(link.path, link.token, p.blob, { contentType: link.contentType });
        if (upErr) throw new Error(upErr.message);
    }, [meetingId, space, supabase]);

    /** Uploads pieces in order; a failure waits and tries the same piece again. */
    const pump = useCallback(async () => {
        if (pumping.current) return;
        pumping.current = true;
        let delay = 2_000;
        while (queue.current.length) {
            try {
                await uploadPiece(queue.current[0]);
                queue.current.shift();
                setWaiting(queue.current.length);
                setUploadNote(null);
                delay = 2_000;
            } catch {
                setUploadNote('Upload paused (no connection?). Keep this page open — it will try again.');
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 30_000);
            }
        }
        pumping.current = false;
    }, [uploadPiece]);

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

    const waitForUploads = useCallback(async () => {
        void pump();
        while (queue.current.length || pumping.current) await new Promise(r => setTimeout(r, 500));
    }, [pump]);

    const finish = useCallback(async () => {
        setPhase('finishing');
        await waitForUploads();
        const r = await call(meetingUrl(meetingId, space), { action: 'finish' });
        if (!r.ok) { setError(r.error); setPhase('error'); return; }
        onDone();
    }, [meetingId, onDone, space, waitForUploads]);

    const stop = useCallback(() => {
        const rec = recorder.current;
        if (!rec || rec.state === 'inactive') { void finish(); return; }
        setPhase('stopping');
        if (runStart.current) { banked.current += Date.now() - runStart.current; runStart.current = null; }
        rec.onstop = () => { releaseAll(); void finish(); };
        rec.stop();
    }, [finish, releaseAll]);

    // ── start (once) ──
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        (async () => {
            const seg = await call<{ segment: number }>(meetingUrl(meetingId, space), { action: 'start_segment' });
            if (!seg.ok) { setError(seg.error); setPhase('error'); return; }
            segment.current = seg.segment;

            if (file) {
                const type = fileMime(file);
                if (!type.startsWith('audio/') && !type.startsWith('video/')) { setError('Please choose an audio file (MP3, M4A, WAV, OGG or WEBM).'); setPhase('error'); return; }
                if (file.size > MAX_UPLOAD_BYTES) { setError('This file is larger than 100 MB. Record at "standard" quality in the phone\'s recorder app, or trim it.'); setPhase('error'); return; }
                mime.current = type;
                setPhase('finishing');
                queue.current.push({ seq: 0, blob: file });
                setWaiting(1);
                await finish();
                return;
            }

            if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
                setError('This browser cannot record audio. Use Chrome or Safari on the phone, or upload a recording instead.');
                setPhase('error');
                return;
            }
            try {
                stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
            } catch {
                setError('Microphone access was blocked. Allow the microphone for this site and try again.');
                setPhase('error');
                return;
            }
            const wanted = pickMime();
            const rec = new MediaRecorder(stream.current, wanted ? { mimeType: wanted, audioBitsPerSecond: BITS_PER_SECOND } : { audioBitsPerSecond: BITS_PER_SECOND });
            mime.current = rec.mimeType || wanted || 'audio/webm';
            rec.ondataavailable = e => {
                if (!e.data || e.data.size === 0) return;
                queue.current.push({ seq: nextSeq.current++, blob: e.data });
                setWaiting(queue.current.length);
                void pump();
            };
            recorder.current = rec;
            rec.start(PIECE_MS);
            runStart.current = Date.now();
            setPhase('recording');
            startMeter(stream.current);
            void keepAwake();
        })();
    }, [file, finish, keepAwake, meetingId, pump, space, startMeter]);

    // ── timer, auto-stop, wake lock after the screen comes back ──
    useEffect(() => {
        const t = setInterval(() => {
            const ms = banked.current + (runStart.current ? Date.now() - runStart.current : 0);
            setElapsed(Math.floor(ms / 1000));
            if (ms >= MAX_RECORD_MS && recorder.current?.state === 'recording') stop();
        }, 1000);
        const onVisible = () => { if (document.visibilityState === 'visible' && recorder.current?.state === 'recording') void keepAwake(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
    }, [keepAwake, stop]);

    // ── warn before leaving while recording or uploading; release the mic on unmount ──
    useEffect(() => {
        const onLeave = (e: BeforeUnloadEvent) => {
            if (recorder.current?.state === 'recording' || recorder.current?.state === 'paused' || queue.current.length) { e.preventDefault(); e.returnValue = ''; }
        };
        window.addEventListener('beforeunload', onLeave);
        return () => { window.removeEventListener('beforeunload', onLeave); releaseAll(); };
    }, [releaseAll]);

    const pause = () => {
        const rec = recorder.current;
        if (!rec) return;
        if (rec.state === 'recording') {
            rec.pause();
            if (runStart.current) { banked.current += Date.now() - runStart.current; runStart.current = null; }
            setPhase('paused');
        } else if (rec.state === 'paused') {
            rec.resume();
            runStart.current = Date.now();
            setPhase('recording');
        }
    };

    const live = phase === 'recording' || phase === 'paused';

    return (
        <div className="mx-auto max-w-xl space-y-5">
            <div className="rounded-3xl border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <p className="truncate text-xs font-bold uppercase tracking-widest text-zinc-500">{title}</p>

                {phase === 'recording' && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-white" role="status">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Recording
                    </div>
                )}
                {phase === 'paused' && <div className="mt-4 inline-flex rounded-full bg-amber-500 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-white">Paused</div>}

                {(live || phase === 'stopping') && (
                    <p className="mt-5 font-mono text-6xl font-black tabular-nums text-zinc-900 dark:text-zinc-100">{clock(elapsed)}</p>
                )}

                {/* Owner 2026-10-29: live sound bars — they move when someone is speaking */}
                {live && (
                    <div className="mt-5 flex h-16 items-center justify-center gap-[3px]" aria-hidden="true">
                        {Array.from({ length: BARS }, (_, i) => (
                            <span key={i} ref={el => { bars.current[i] = el; }}
                                className={`h-full w-1.5 origin-center rounded-full transition-transform duration-75 ${phase === 'paused' ? 'bg-zinc-300 dark:bg-zinc-700' : 'bg-sky-500'}`} />
                        ))}
                    </div>
                )}
                {live && hint && (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" role="status">
                        {hint === 'faint' ? FAINT_MESSAGE : SILENT_MESSAGE}
                    </p>
                )}

                {phase === 'starting' && <p className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> {file ? 'Preparing the upload…' : 'Starting the microphone…'}</p>}
                {(phase === 'stopping' || phase === 'finishing') && (
                    <p className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                        {file ? <Upload className="h-4 w-4" /> : <CloudUpload className="h-4 w-4" />}
                        <Loader2 className="h-4 w-4 animate-spin" /> {file ? 'Uploading the recording…' : 'Saving the last pieces…'}
                    </p>
                )}

                {live && (
                    <>
                        <p className="mt-3 text-xs font-semibold text-zinc-500">
                            Keep the phone in the middle of the table, screen on. {waiting > 1 ? `${waiting} pieces waiting to upload.` : 'Everything so far is saved.'}
                        </p>
                        <div className="mt-6 flex justify-center gap-3">
                            <button type="button" onClick={pause} className="flex items-center gap-2 rounded-2xl border border-zinc-300 px-5 py-3 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                                {phase === 'paused' ? <><Play className="h-4 w-4" /> Resume</> : <><Pause className="h-4 w-4" /> Pause</>}
                            </button>
                            <button type="button" onClick={stop} className="flex items-center gap-2 rounded-2xl bg-zinc-900 px-6 py-3 text-sm font-black text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                                <Square className="h-4 w-4" /> Stop and make notes
                            </button>
                        </div>
                    </>
                )}

                {uploadNote && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{uploadNote}</p>}

                {phase === 'error' && (
                    <div className="mt-5 space-y-4">
                        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>
                        <button type="button" onClick={onBack} className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Back</button>
                    </div>
                )}
            </div>
            {live && (
                <p className="flex items-start gap-2 px-2 text-xs text-zinc-500">
                    <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Tip: say actions clearly (&ldquo;Action for Ramesh: three quotes by Friday&rdquo;) and recap the tasks in the last two minutes.
                </p>
            )}
        </div>
    );
}
