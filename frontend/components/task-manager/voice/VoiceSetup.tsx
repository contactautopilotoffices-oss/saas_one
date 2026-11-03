'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Mic, Play, RotateCcw, ShieldCheck, Square, Trash2 } from 'lucide-react';
import VoiceServerStatus from './VoiceServerStatus';
import { CLIP_PROBLEM_TEXT, VOICE_URL, useVoiceInfo, type ClipProblem } from './voiceApi';

/**
 * LiveVoice ID (owner 2026-11-02): "My voice" in Settings, for EVERY signed-in person.
 * Read three short sentences → the voice server turns them into a voiceprint → only the voiceprint is saved.
 * The recordings stay in this browser tab until Save, are sent once, and are never stored. Plan: docs/LIVEVOICE_ID_PLAN.md
 */

const SENTENCES = [
    "Good morning everyone, let us review today's tasks and the pending purchase orders.",
    'Kal tak teen quotes le aao, aur vendor se delivery date confirm kar lena.',
    'The meeting room on the fifth floor needs a new projector before Friday.',
];
const MAX_CLIP_MS = 9_000;
const MIN_CLIP_MS = 2_500;

interface Clip { blob: Blob; url: string; ms: number }

function pickMime(): string | undefined {
    if (typeof MediaRecorder === 'undefined') return undefined;
    return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m));
}

function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

export default function VoiceSetup() {
    const { info, setInfo, loading, error, refresh } = useVoiceInfo();
    const [editing, setEditing] = useState(false);
    const [consent, setConsent] = useState(false);
    const [clips, setClips] = useState<Array<Clip | null>>([null, null, null]);
    const [problems, setProblems] = useState<ClipProblem[]>([null, null, null]);
    const [recordingIdx, setRecordingIdx] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [level, setLevel] = useState(0);
    const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
    const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);

    const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext | null; raf: number; timer: number; started: number } | null>(null);

    const stopAll = useCallback(() => {
        const r = rec.current;
        if (!r) return;
        cancelAnimationFrame(r.raf);
        clearTimeout(r.timer);
        if (r.recorder.state !== 'inactive') r.recorder.stop();
        r.stream.getTracks().forEach(t => t.stop());
        void r.ctx?.close().catch(() => undefined);
        rec.current = null;
        setLevel(0);
    }, []);

    // Free the microphone and the playback links when leaving the page (a replaced clip frees its own link)
    const latestClips = useRef(clips);
    latestClips.current = clips;
    useEffect(() => () => {
        stopAll();
        latestClips.current.forEach(c => c && URL.revokeObjectURL(c.url));
    }, [stopAll]);
    const resetClips = () => {
        clips.forEach(c => c && URL.revokeObjectURL(c.url));
        setClips([null, null, null]);
        setProblems([null, null, null]);
    };

    const record = async (idx: number) => {
        if (recordingIdx !== null) return;
        setMessage(null);
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            setMessage({ tone: 'error', text: 'This browser cannot record audio. Use Chrome or Safari.' });
            return;
        }
        let stream: MediaStream;
        try {
            // Same microphone settings as the meeting recorder, so the voiceprint matches how meetings sound
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        } catch {
            setMessage({ tone: 'error', text: 'Microphone access was blocked. Allow the microphone for this site and try again.' });
            return;
        }
        let started = 0;
        const mime = pickMime();
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined);
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
        recorder.onstop = () => {
            const ms = performance.now() - started;
            const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
            setRecordingIdx(null);
            setElapsed(0);
            if (ms < MIN_CLIP_MS || blob.size < 1_000) {
                setProblems(p => p.map((x, i) => (i === idx ? 'too_short' : x)));
                return;
            }
            setClips(prev => prev.map((c, i) => {
                if (i !== idx) return c;
                if (c) URL.revokeObjectURL(c.url);
                return { blob, url: URL.createObjectURL(blob), ms };
            }));
            setProblems(p => p.map((x, i) => (i === idx ? null : x)));
        };

        // Live level bar so people can see the phone hears them
        let ctx: AudioContext | null = null;
        let raf = 0;
        try {
            const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (Ctx) {
                ctx = new Ctx();
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 1024;
                ctx.createMediaStreamSource(stream).connect(analyser);
                const buf = new Float32Array(analyser.fftSize);
                let last = 0;
                const loop = (now: number) => {
                    raf = requestAnimationFrame(loop);
                    if (rec.current) rec.current.raf = raf;
                    if (now - last < 90) return;
                    last = now;
                    analyser.getFloatTimeDomainData(buf);
                    let sum = 0;
                    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
                    setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
                    setElapsed(now - started);
                };
                raf = requestAnimationFrame(loop);
            }
        } catch { /* the bar is a nice-to-have */ }

        started = performance.now();
        recorder.start();
        const timer = window.setTimeout(() => stopAll(), MAX_CLIP_MS);
        rec.current = { recorder, stream, ctx, raf, timer, started };
        setRecordingIdx(idx);
    };

    const save = async () => {
        if (!info || clips.some(c => !c) || !consent) return;
        setBusy('save');
        setMessage(null);
        try {
            const encoded = await Promise.all(clips.map(c => toBase64(c!.blob)));
            const res = await fetch(VOICE_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clips: encoded, consent: true, consentVersion: info.consentVersion }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                if (Array.isArray(data.clips)) setProblems((data.clips as Array<{ problem: ClipProblem }>).map(c => c?.problem ?? null));
                setMessage({ tone: res.status === 503 ? 'warn' : 'error', text: data.error || 'Your voice could not be set up. Please try again.' });
                if (res.status === 503) void refresh();
                return;
            }
            setInfo({ ...info, me: data.me });
            setEditing(false);
            resetClips();
            setMessage({ tone: 'ok', text: 'Voice profile saved. Your recordings were not kept.' });
        } catch {
            setMessage({ tone: 'error', text: 'Could not reach the server. Please check the connection and try again.' });
        } finally {
            setBusy(null);
        }
    };

    const remove = async () => {
        if (!info || !window.confirm('Delete your voice profile?\n\nMeetings will show you as "Speaker N" again until you set it up again.')) return;
        setBusy('delete');
        setMessage(null);
        try {
            const res = await fetch(VOICE_URL, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) { setMessage({ tone: 'error', text: data.error || 'Could not delete. Please try again.' }); return; }
            setInfo({ ...info, me: { enrolled: false } });
            setMessage({ tone: 'ok', text: 'Your voice profile was deleted.' });
        } finally {
            setBusy(null);
        }
    };

    if (loading && !info) return <div className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
    if (error && !info) return <p className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
    if (!info) return null;

    const recording = recordingIdx !== null;
    const allRecorded = clips.every(Boolean);
    const showForm = editing || !info.me.enrolled;
    const updated = info.me.updatedAt ? new Date(info.me.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

    return (
        <div className="space-y-5">
            <div>
                <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-zinc-100"><Mic className="h-5 w-5 text-primary" /> My voice</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Set up your voice once, and the Meeting Assistant can show your name next to what you said, instead of &ldquo;Speaker 2&rdquo;.
                </p>
            </div>

            <div className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
                <VoiceServerStatus state={info.server.state} loading={loading} onRefresh={() => void refresh()} />
            </div>

            {info.setupMissing && (
                <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Voice setup is not ready yet: the admin needs to apply the latest database update.
                </p>
            )}

            {info.me.enrolled && !editing && (
                <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center dark:border-emerald-900 dark:bg-emerald-950/30">
                    <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">Your voice is set up</p>
                        <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                            {updated ? `Saved on ${updated}. ` : ''}{info.meetingVoiceOn ? 'Meetings started by your department use it.' : 'Your department has not switched voice recognition on yet; it will be used once they do.'}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => { setEditing(true); setMessage(null); }} className="flex items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                            <RotateCcw className="h-3.5 w-3.5" /> Record again
                        </button>
                        <button type="button" onClick={() => void remove()} disabled={busy !== null} className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-300">
                            {busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                        </button>
                    </div>
                </div>
            )}

            {showForm && !info.setupMissing && (
                <>
                    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                        <span className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                            <span className="flex items-center gap-1.5 text-sm font-bold text-zinc-800 dark:text-zinc-200"><ShieldCheck className="h-4 w-4 text-indigo-600" /> How your voice is used</span>
                            <span className="block">Your three recordings are turned into a <b>voiceprint</b>: a list of numbers that describes how your voice sounds. The recordings themselves are <b>not kept</b>, and the voiceprint cannot be played back.</span>
                            <span className="block">It is used only to show your name next to what you said in Meeting Assistant meetings you are picked for, when your department has this switched on. To compare voices, meeting audio is sent to our own voice server and then deleted, as it is today.</span>
                            <span className="block">You can delete your voiceprint here at any time. <b>I agree</b> to my voice being used this way.</span>
                        </span>
                    </label>

                    <ol className="space-y-3">
                        {SENTENCES.map((sentence, i) => {
                            const clip = clips[i];
                            const problem = problems[i];
                            const isRec = recordingIdx === i;
                            return (
                                <li key={i} className={`rounded-2xl border p-4 ${isRec ? 'border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20' : 'border-zinc-200 dark:border-zinc-800'}`}>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sentence {i + 1} of 3</p>
                                    <p className="mt-1 text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-100">&ldquo;{sentence}&rdquo;</p>
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        {isRec ? (
                                            <button type="button" onClick={stopAll} className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-black text-white hover:bg-red-700">
                                                <Square className="h-3.5 w-3.5" /> Stop ({Math.max(0, Math.ceil((MAX_CLIP_MS - elapsed) / 1000))}s)
                                            </button>
                                        ) : (
                                            <button type="button" onClick={() => void record(i)} disabled={!consent || recording || busy !== null}
                                                className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3.5 py-2 text-xs font-black text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
                                                <Mic className="h-3.5 w-3.5" /> {clip ? 'Record again' : 'Record'}
                                            </button>
                                        )}
                                        {clip && !isRec && (
                                            <button type="button" onClick={() => void new Audio(clip.url).play().catch(() => undefined)}
                                                className="flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                                                <Play className="h-3.5 w-3.5" /> Listen
                                            </button>
                                        )}
                                        {clip && !isRec && !problem && <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Recorded</span>}
                                        {isRec && (
                                            <span className="h-2 w-28 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-label="Microphone level">
                                                <span className="block h-full rounded-full bg-red-500 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
                                            </span>
                                        )}
                                    </div>
                                    {problem && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400">{CLIP_PROBLEM_TEXT[problem]} Please record it again.</p>}
                                </li>
                            );
                        })}
                    </ol>

                    <p className="text-xs text-zinc-500">Record in a quiet place, in your normal speaking voice, with the phone or laptop where it usually is in meetings.</p>

                    <div className="flex flex-col gap-2 sm:flex-row">
                        <button type="button" onClick={() => void save()} disabled={!consent || !allRecorded || recording || busy !== null}
                            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-40">
                            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save my voice
                        </button>
                        {info.me.enrolled && (
                            <button type="button" onClick={() => { stopAll(); setEditing(false); resetClips(); }}
                                className="rounded-2xl border border-zinc-300 px-5 py-3 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                                Cancel
                            </button>
                        )}
                    </div>
                </>
            )}

            {message && (
                <p className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : message.tone === 'warn' ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>
                    {message.text}
                </p>
            )}
        </div>
    );
}
