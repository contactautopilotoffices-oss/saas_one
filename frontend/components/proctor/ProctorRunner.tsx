'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock, Lock, Mic, ShieldAlert, Video, XCircle } from 'lucide-react';

/**
 * The locked test page, used two ways:
 *   · mode="authed" — a signed-in member opening /proctor/<testId>.
 *   · mode="public" — anyone with the link at /t/<token>. No account: they type
 *     their name and email, and the attempt is identified from then on by the
 *     attempt_token the server issues at start.
 *
 * Camera and microphone on → fullscreen → questions appear. From then on, any
 * of these ends the attempt and the server records why: tab switch, switching
 * app (blur), leaving fullscreen incl. Esc, close/refresh (pagehide → beacon),
 * camera off.
 *
 * Every ~20s a webcam frame goes to the vision model:
 *   · not looking at the screen → the taker is asked to look at the camera, and
 *     it counts as a strike; after the test's limit the attempt closes.
 *   · a phone, or a second face → nothing is shown. The frame is kept for the
 *     reviewer instead, so nobody learns what the camera catches.
 * The microphone is watched for a voice nearby; that is recorded, never shown.
 */

type Phase = 'loading' | 'blocked' | 'identify' | 'setup' | 'ready' | 'running' | 'terminated' | 'submitted';
type Question = { id: string; section?: string; text: string; options: string[] };
type Section = { key: string; title: string; description?: string; question_count: number };
type TestInfo = {
    title: string; instructions: string | null; duration_minutes: number; ai_monitoring: boolean;
    max_attempts: number; look_away_strikes: number; question_count: number; sections: Section[];
};
type MyAttempt = { attempt_no: number; status: string; termination_reason: string | null };

const SNAPSHOT_EVERY_MS = 20_000;
/** Rough loudness that counts as a voice in the room. Logged with the event so it can be tuned. */
const VOICE_RMS_THRESHOLD = 0.035;
const VOICE_SUSTAIN_SAMPLES = 3;   // ~1.5s above the threshold
const VOICE_REPORT_GAP_MS = 30_000;

const REASON_LABEL: Record<string, string> = {
    tab_hidden: 'You switched tabs or minimised the browser.',
    window_blur: 'You switched to another window or app.',
    fullscreen_exit: 'You left fullscreen.',
    page_unload: 'The page was closed or refreshed.',
    camera_lost: 'Your camera was turned off.',
    reopened: 'The test was opened again before it was finished.',
    looking_away: 'You were asked to look at the camera too many times.',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function ProctorRunner({ mode, testId, token }: { mode: 'authed' | 'public'; testId?: string; token?: string }) {
    const [phase, setPhase] = useState<Phase>('loading');
    const [test, setTest] = useState<TestInfo | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');

    const [questions, setQuestions] = useState<Question[]>([]);
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [remaining, setRemaining] = useState(0);
    const [cameraWarning, setCameraWarning] = useState<string | null>(null);
    const [endReason, setEndReason] = useState<string | null>(null);
    const [previousNote, setPreviousNote] = useState<string | null>(null);
    const [chancesLeft, setChancesLeft] = useState(0);
    const [attemptNo, setAttemptNo] = useState(0);
    const [confirmPending, setConfirmPending] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const attemptIdRef = useRef<string | null>(null);
    const attemptTokenRef = useRef<string | null>(null);
    const deadlineRef = useRef(0);
    const endedRef = useRef(false);
    const answersRef = useRef(answers);
    useEffect(() => { answersRef.current = answers; }, [answers]);

    /** Every call after start carries the attempt's own secret, since a public taker has no session. */
    const authHeaders = useCallback((): HeadersInit => ({
        'Content-Type': 'application/json',
        ...(attemptTokenRef.current ? { 'x-attempt-token': attemptTokenRef.current } : {}),
    }), []);

    // ── Load the test ────────────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const url = mode === 'public' ? `/api/public/proctor/${token}` : `/api/proctor/tests/${testId}`;
                const res = await fetch(url);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not load this test');
                setTest(data.test);

                if (mode === 'public') {
                    setChancesLeft(data.test.max_attempts);
                    setPhase('identify');
                    return;
                }

                const mine: MyAttempt[] = data.my_attempts || [];
                const last = mine[mine.length - 1];
                const lastReason = last?.termination_reason ? REASON_LABEL[last.termination_reason] || 'You left the test window.' : null;
                setChancesLeft(data.chances_left ?? 0);
                if (data.completed) {
                    setMessage('You have already completed this test. Your answers are with your reviewer.');
                    setPhase('blocked');
                } else if ((data.chances_left ?? 0) === 0) {
                    setMessage(`You have used all your chances at this test.${lastReason ? ` Your last attempt was closed: ${lastReason}` : ''}`);
                    setPhase('blocked');
                } else {
                    if (last) {
                        setPreviousNote(`Your previous attempt was closed: ${lastReason || 'it was not finished.'} ` +
                            (data.chances_left === 1 ? 'This is your last chance.' : `You have ${plural(data.chances_left, 'chance')} left.`));
                    }
                    setPhase('setup');
                }
            } catch (err) {
                setMessage(errMsg(err));
                setPhase('blocked');
            }
        })();
    }, [mode, testId, token]);

    // This browser cannot lock the screen (iPhone/iPad Safari) — say so before they start.
    useEffect(() => {
        if ((phase === 'setup' || phase === 'identify') && typeof document !== 'undefined' && !document.documentElement.requestFullscreen) {
            setMessage('This browser cannot lock the screen. Open the link on a laptop or desktop in Chrome, Edge or Firefox.');
            setPhase('blocked');
        }
    }, [phase]);

    useEffect(() => {
        if (videoRef.current && stream) videoRef.current.srcObject = stream;
    }, [stream, phase]);

    const stopMedia = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setStream(null);
    }, []);

    useEffect(() => stopMedia, [stopMedia]);

    // ── End the attempt because the taker left ───────────────────────────────
    const terminate = useCallback((kind: string) => {
        if (endedRef.current || !attemptIdRef.current) return;
        endedRef.current = true;
        const url = `/api/proctor/attempts/${attemptIdRef.current}/event`;
        const body = JSON.stringify({ kind, detail: { at: new Date().toISOString() }, attempt_token: attemptTokenRef.current });
        if (kind === 'page_unload' && navigator.sendBeacon) {
            navigator.sendBeacon(url, body);
        } else {
            fetch(url, { method: 'POST', headers: authHeaders(), body, keepalive: true }).catch(() => { /* best effort */ });
        }
        setEndReason(kind);
        setPhase('terminated');
        stopMedia();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }, [authHeaders, stopMedia]);

    /** The server ended it (too many camera warnings) — stop without reporting a new event. */
    const acceptServerTermination = useCallback((reason: string) => {
        if (endedRef.current) return;
        endedRef.current = true;
        setEndReason(reason);
        setPhase('terminated');
        stopMedia();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }, [stopMedia]);

    // ── Submit ───────────────────────────────────────────────────────────────
    const submit = useCallback(async (auto = false) => {
        if (endedRef.current || !attemptIdRef.current) return;
        if (!auto && !confirmPending && Object.keys(answersRef.current).length < questions.length) {
            setConfirmPending(true);
            return;
        }
        endedRef.current = true; // disarm before we leave fullscreen ourselves
        setBusy(true);
        try {
            const res = await fetch(`/api/proctor/attempts/${attemptIdRef.current}/submit`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ answers: answersRef.current, attempt_token: attemptTokenRef.current }),
            });
            const data = await res.json();
            if (res.status === 409) {
                setEndReason(null);
                setPhase('terminated');
            } else if (!res.ok) {
                throw new Error(data.error || 'Could not submit');
            } else {
                setPhase('submitted');
            }
            stopMedia();
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        } catch (err) {
            endedRef.current = false; // still locked; let them retry
            setError(`${errMsg(err)}. Stay on this page and press Submit again.`);
        } finally {
            setBusy(false);
        }
    }, [questions.length, confirmPending, authHeaders, stopMedia]);

    // ── The lock: armed only while running ───────────────────────────────────
    useEffect(() => {
        if (phase !== 'running') return;

        const onVisibility = () => { if (document.visibilityState === 'hidden') terminate('tab_hidden'); };
        const onBlur = () => terminate('window_blur');
        const onFullscreen = () => { if (!document.fullscreenElement) terminate('fullscreen_exit'); };
        const onPageHide = () => terminate('page_unload');
        const block = (e: Event) => e.preventDefault();
        const track = streamRef.current?.getVideoTracks()[0];
        const onTrackEnded = () => terminate('camera_lost');

        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('blur', onBlur);
        document.addEventListener('fullscreenchange', onFullscreen);
        window.addEventListener('pagehide', onPageHide);
        ['contextmenu', 'copy', 'cut', 'paste'].forEach((ev) => document.addEventListener(ev, block));
        track?.addEventListener('ended', onTrackEnded);

        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('fullscreenchange', onFullscreen);
            window.removeEventListener('pagehide', onPageHide);
            ['contextmenu', 'copy', 'cut', 'paste'].forEach((ev) => document.removeEventListener(ev, block));
            track?.removeEventListener('ended', onTrackEnded);
        };
    }, [phase, terminate]);

    // ── Countdown ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (phase !== 'running') return;
        const tick = () => {
            const left = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
            setRemaining(left);
            if (left === 0) submit(true);
        };
        tick();
        const t = setInterval(tick, 1000);
        return () => clearInterval(t);
    }, [phase, submit]);

    // ── AI frame checks ──────────────────────────────────────────────────────
    useEffect(() => {
        if (phase !== 'running' || !test?.ai_monitoring) return;
        let inFlight = false;
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;

        const snap = async () => {
            const video = videoRef.current;
            if (inFlight || endedRef.current || !video || video.readyState < 2) return;
            inFlight = true;
            try {
                canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
                const image = canvas.toDataURL('image/jpeg', 0.6);
                const res = await fetch(`/api/proctor/attempts/${attemptIdRef.current}/snapshot`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ image, attempt_token: attemptTokenRef.current }),
                });
                const data = await res.json().catch(() => ({}));
                if (data.status === 'terminated') {
                    acceptServerTermination('looking_away');
                } else if (data.ok && data.warn) {
                    setCameraWarning(`${data.message} (warning ${data.strikes} of ${data.strikes_allowed})`);
                } else if (data.ok) {
                    setCameraWarning(null);
                }
            } catch { /* a missed check is fine; the next one runs in 20s */ }
            finally { inFlight = false; }
        };

        const first = setTimeout(snap, 3000);
        const loop = setInterval(snap, SNAPSHOT_EVERY_MS);
        return () => { clearTimeout(first); clearInterval(loop); };
    }, [phase, test?.ai_monitoring, authHeaders, acceptServerTermination]);

    // ── Microphone: a voice in the room is recorded, never shown ─────────────
    useEffect(() => {
        if (phase !== 'running' || !streamRef.current) return;
        const audioTrack = streamRef.current.getAudioTracks()[0];
        if (!audioTrack) return;

        type WindowWithAudio = Window & { webkitAudioContext?: typeof AudioContext };
        const Ctor = window.AudioContext || (window as WindowWithAudio).webkitAudioContext;
        if (!Ctor) return;

        const ctx = new Ctor();
        const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);

        let loudSamples = 0;
        let lastReported = 0;

        const sample = () => {
            if (endedRef.current) return;
            analyser.getFloatTimeDomainData(buffer);
            let sum = 0;
            for (const v of buffer) sum += v * v;
            const rms = Math.sqrt(sum / buffer.length);

            if (rms >= VOICE_RMS_THRESHOLD) loudSamples++; else loudSamples = 0;

            if (loudSamples >= VOICE_SUSTAIN_SAMPLES && Date.now() - lastReported > VOICE_REPORT_GAP_MS) {
                lastReported = Date.now();
                loudSamples = 0;
                fetch(`/api/proctor/attempts/${attemptIdRef.current}/event`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({
                        kind: 'voice_detected',
                        detail: { level: Number(rms.toFixed(3)), at: new Date().toISOString() },
                        attempt_token: attemptTokenRef.current,
                    }),
                }).catch(() => { /* recorded on best effort */ });
            }
        };

        const timer = setInterval(sample, 500);
        return () => { clearInterval(timer); ctx.close().catch(() => {}); };
    }, [phase, authHeaders]);

    // ── Setup steps ──────────────────────────────────────────────────────────
    const enableMedia = async () => {
        setError(null);
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
            if (!s.getAudioTracks().length) {
                s.getTracks().forEach((t) => t.stop());
                setError('No microphone was found. This test needs both a camera and a microphone.');
                return;
            }
            streamRef.current = s;
            setStream(s);
            setPhase('ready');
        } catch {
            setError('Camera and microphone access was blocked. Allow both for this site in your browser, then try again.');
        }
    };

    const start = async () => {
        setError(null);
        if ((window.screen as Screen & { isExtended?: boolean }).isExtended === true) {
            setError('A second monitor is connected. Disconnect it (or switch to a single display) and try again.');
            return;
        }
        setBusy(true);
        try {
            // Must run inside the click, before any await that could lose the user gesture.
            await document.documentElement.requestFullscreen();
        } catch {
            setBusy(false);
            setError('Fullscreen was blocked. Allow fullscreen for this site and try again.');
            return;
        }
        try {
            const res = mode === 'public'
                ? await fetch(`/api/public/proctor/${token}/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email }),
                })
                : await fetch(`/api/proctor/tests/${testId}/start`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not start the test');
            attemptIdRef.current = data.attempt_id;
            attemptTokenRef.current = data.attempt_token;
            setAttemptNo(data.attempt_no);
            setChancesLeft(Math.max(0, data.max_attempts - data.attempt_no));
            deadlineRef.current = Date.now() + data.duration_minutes * 60_000;
            setQuestions(data.questions || []);
            endedRef.current = false;
            setPhase('running');
        } catch (err) {
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            setError(errMsg(err));
        } finally {
            setBusy(false);
        }
    };

    // ── Render ───────────────────────────────────────────────────────────────
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    const answeredCount = Object.keys(answers).length;
    const sections = test?.sections || [];

    const cameraView = stream && (phase === 'ready' || phase === 'running') ? (
        <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={phase === 'running'
                ? 'fixed bottom-4 right-4 z-40 w-40 rounded-xl border-2 border-white shadow-lg object-cover bg-black -scale-x-100'
                : 'w-full max-w-sm aspect-4/3 rounded-2xl object-cover bg-black -scale-x-100'}
        />
    ) : null;

    if (phase === 'loading') {
        return <Centered><p className="text-sm text-slate-500">Loading test…</p></Centered>;
    }

    if (phase === 'blocked') {
        return (
            <Centered>
                <AlertTriangle className="w-10 h-10 text-amber-500" />
                <h1 className="text-lg font-black text-slate-900">{test?.title || 'Test unavailable'}</h1>
                <p className="text-sm text-slate-600 max-w-md">{message}</p>
            </Centered>
        );
    }

    if (phase === 'terminated') {
        return (
            <Centered>
                <XCircle className="w-12 h-12 text-rose-500" />
                <h1 className="text-xl font-black text-slate-900">Test closed</h1>
                <p className="text-sm text-slate-600 max-w-md">
                    {endReason ? REASON_LABEL[endReason] : 'This attempt had already ended.'} The reason has been recorded for your reviewer.
                </p>
                <p className="text-sm font-bold text-slate-900 max-w-md">
                    {chancesLeft > 0
                        ? `You have ${plural(chancesLeft, 'chance')} left. Open the test link again when you are ready.`
                        : 'That was your last chance at this test.'}
                </p>
            </Centered>
        );
    }

    if (phase === 'submitted') {
        return (
            <Centered>
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                <h1 className="text-xl font-black text-slate-900">Submitted</h1>
                <p className="text-sm text-slate-600 max-w-md">Your answers have been recorded. You can close this page.</p>
            </Centered>
        );
    }

    if (phase === 'identify' || phase === 'setup' || phase === 'ready') {
        const identified = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
        const canEnableMedia = mode === 'authed' || identified;
        return (
            <div className="min-h-screen bg-slate-50 px-4 py-10">
                <div className="mx-auto max-w-xl space-y-6">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Proctored test</p>
                        <h1 className="text-2xl font-black text-slate-900">{test?.title}</h1>
                        <p className="mt-1 text-sm text-slate-500">
                            {test?.question_count} questions · {test?.duration_minutes} minutes{test?.ai_monitoring ? ' · AI camera monitoring' : ''}
                        </p>
                        {test?.instructions && <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{test.instructions}</p>}
                        {previousNote && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{previousNote}</p>}
                    </div>

                    {sections.length > 1 && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">What the test covers</p>
                            <ul className="mt-2 space-y-2">
                                {sections.map((s) => (
                                    <li key={s.key} className="text-sm">
                                        <span className="font-bold text-slate-900">{s.title}</span>
                                        <span className="text-slate-400"> · {plural(s.question_count, 'question')}</span>
                                        {s.description && <p className="text-slate-600">{s.description}</p>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                        <p className="flex items-center gap-2 text-sm font-black text-rose-900"><Lock className="w-4 h-4" /> Once you start, the test is locked to this screen</p>
                        <ul className="mt-2 list-disc pl-5 text-sm text-rose-900/80 space-y-1">
                            <li>Switching tabs, switching apps, pressing <b>Esc</b>, leaving fullscreen, or closing/refreshing the page <b>ends the test immediately</b>.</li>
                            <li>You have {plural(chancesLeft, 'chance')}. Leaving the page uses one up; once you submit, the test is finished.</li>
                            <li>Your <b>camera and microphone stay on</b> for the whole test. What they record is sent to your reviewer.</li>
                            <li>Look at the screen. After {plural(test?.look_away_strikes || 3, 'warning')} about looking away, the test closes.</li>
                            <li>Close other apps and turn off notifications before you begin.</li>
                        </ul>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                        {mode === 'public' && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <Step n={1} done={identified} />
                                    <p className="flex-1 text-sm font-bold text-slate-900">Who is taking this test?</p>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2 pl-10">
                                    <input
                                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                        placeholder="Full name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        disabled={phase !== 'identify'}
                                    />
                                    <input
                                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                        placeholder="Email address"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        disabled={phase !== 'identify'}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="flex items-center gap-3">
                            <Step n={mode === 'public' ? 2 : 1} done={phase === 'ready'} />
                            <p className="flex-1 text-sm font-bold text-slate-900">Turn on your camera and microphone</p>
                            {phase !== 'ready' && (
                                <button
                                    onClick={enableMedia}
                                    disabled={!canEnableMedia}
                                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                                >
                                    <Camera className="w-4 h-4" /> <Mic className="w-4 h-4" /> Enable
                                </button>
                            )}
                        </div>
                        {cameraView && <div className="flex justify-center">{cameraView}</div>}

                        <div className="flex items-center gap-3">
                            <Step n={mode === 'public' ? 3 : 2} done={false} />
                            <p className="flex-1 text-sm font-bold text-slate-900">Go fullscreen and start</p>
                            <button
                                onClick={start}
                                disabled={phase !== 'ready' || busy}
                                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                            >
                                {busy ? 'Starting…' : 'Start test'}
                            </button>
                        </div>
                        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
                    </div>
                </div>
            </div>
        );
    }

    // running
    return (
        <div className="min-h-screen bg-white select-none">
            <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                <Lock className="w-4 h-4 text-rose-600" />
                <p className="flex-1 truncate text-sm font-black text-slate-900">
                    {test?.title}
                    {test && test.max_attempts > 1 && <span className="ml-2 text-xs font-bold text-slate-400">Attempt {attemptNo} of {test.max_attempts}</span>}
                </p>
                <span className="text-xs font-bold text-slate-500">{answeredCount}/{questions.length} answered</span>
                <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-black tabular-nums ${remaining < 60 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-900'}`}>
                    <Clock className="w-4 h-4" /> {mm}:{ss}
                </span>
            </header>

            {/* Standing notice: they are told once, at the top, what is being sent to the reviewer. */}
            <div className="flex items-center justify-center gap-2 bg-slate-900 px-4 py-1.5 text-xs font-bold text-white">
                <Video className="w-3.5 h-3.5" />
                Recording: camera, microphone and screen activity are sent to your reviewer
            </div>

            {cameraWarning && (
                <div className="sticky top-[53px] z-30 flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900">
                    <ShieldAlert className="w-4 h-4" /> {cameraWarning}
                </div>
            )}

            <main className="mx-auto max-w-2xl space-y-6 px-4 py-6 pb-40">
                {sections.map((section) => {
                    const inSection = questions.filter((q) => (q.section || 'general') === section.key);
                    if (!inSection.length) return null;
                    return (
                        <section key={section.key} className="space-y-4">
                            {sections.length > 1 && (
                                <div className="border-b border-slate-200 pb-1">
                                    <h2 className="text-base font-black text-slate-900">{section.title}</h2>
                                    {section.description && <p className="text-xs text-slate-500">{section.description}</p>}
                                </div>
                            )}
                            {inSection.map((q) => (
                                <fieldset key={q.id} className="rounded-2xl border border-slate-200 p-4">
                                    <legend className="px-1 text-sm font-black text-slate-900">Q{questions.indexOf(q) + 1}. {q.text}</legend>
                                    <div className="mt-2 space-y-2">
                                        {q.options.map((opt, oi) => (
                                            <label key={oi} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${answers[q.id] === oi ? 'border-slate-900 bg-slate-50 font-bold' : 'border-slate-200'}`}>
                                                <input
                                                    type="radio"
                                                    name={q.id}
                                                    checked={answers[q.id] === oi}
                                                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                                                />
                                                {opt}
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            ))}
                        </section>
                    );
                })}

                {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
                {confirmPending && answeredCount < questions.length && (
                    <p className="text-sm font-bold text-amber-700">
                        {questions.length - answeredCount} question(s) unanswered. Press Submit again to submit anyway.
                    </p>
                )}
                <button
                    onClick={() => submit(false)}
                    disabled={busy}
                    className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-40"
                >
                    {busy ? 'Submitting…' : 'Submit test'}
                </button>
            </main>

            {cameraView}
        </div>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">{children}</div>;
}

function Step({ n, done }: { n: number; done: boolean }) {
    return (
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {done ? '✓' : n}
        </span>
    );
}

function errMsg(err: unknown) {
    return err instanceof Error ? err.message : 'Something went wrong';
}
