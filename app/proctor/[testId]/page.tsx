'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Camera, CheckCircle2, Clock, Lock, ShieldAlert, XCircle } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import Loader from '@/frontend/components/ui/Loader';

/**
 * The locked test page: /proctor/<testId>.
 *
 * Camera on → fullscreen → questions appear. From then on, any of these ends
 * the attempt immediately and the server records why:
 *   tab switch / minimise (visibilitychange), switching to another app (blur),
 *   leaving fullscreen incl. Esc (fullscreenchange), close / refresh / navigate
 *   away (pagehide → sendBeacon), camera turned off (track ended).
 *
 * Every ~20s a small webcam frame goes to the vision model. Its verdict only
 * warns the taker and flags the attempt for the reviewer — it never ends the test.
 */

type Phase = 'loading' | 'blocked' | 'setup' | 'ready' | 'running' | 'terminated' | 'submitted';
type Question = { id: string; text: string; options: string[] };
type TestInfo = { id: string; title: string; instructions: string | null; duration_minutes: number; ai_monitoring: boolean; question_count: number };

const SNAPSHOT_EVERY_MS = 20_000;

const REASON_LABEL: Record<string, string> = {
    tab_hidden: 'You switched tabs or minimised the browser.',
    window_blur: 'You switched to another window or app.',
    fullscreen_exit: 'You left fullscreen.',
    page_unload: 'The page was closed or refreshed.',
    camera_lost: 'Your camera was turned off.',
};

export default function ProctoredTestPage({ params }: { params: Promise<{ testId: string }> }) {
    const { testId } = use(params);
    const { user, isLoading: authLoading } = useAuth();

    const [phase, setPhase] = useState<Phase>('loading');
    const [test, setTest] = useState<TestInfo | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const [questions, setQuestions] = useState<Question[]>([]);
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [remaining, setRemaining] = useState(0);
    const [aiWarning, setAiWarning] = useState<string | null>(null);
    const [endReason, setEndReason] = useState<string | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const attemptIdRef = useRef<string | null>(null);
    const deadlineRef = useRef(0);
    const endedRef = useRef(false);
    const answersRef = useRef(answers);
    useEffect(() => { answersRef.current = answers; }, [answers]);
    // Native confirm() can drop some browsers out of fullscreen, which would end the test — confirm on the page instead.
    const [confirmPending, setConfirmPending] = useState(false);

    // ── Load the test ────────────────────────────────────────────────────────
    useEffect(() => {
        if (authLoading || !user) return;
        (async () => {
            try {
                const res = await fetch(`/api/proctor/tests/${testId}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not load this test');
                setTest(data.test);
                if (data.my_attempt) {
                    const a = data.my_attempt;
                    setMessage(a.status === 'terminated'
                        ? `You have already attempted this test. It was closed because: ${REASON_LABEL[a.termination_reason] || 'you left the test window.'}`
                        : 'You have already taken this test.');
                    setPhase('blocked');
                } else if (typeof document !== 'undefined' && !document.documentElement.requestFullscreen) {
                    setMessage('This browser cannot lock the screen. Open the link on a laptop or desktop in Chrome, Edge or Firefox.');
                    setPhase('blocked');
                } else {
                    setPhase('setup');
                }
            } catch (err) {
                setMessage(errMsg(err));
                setPhase('blocked');
            }
        })();
    }, [testId, user, authLoading]);

    // Attach the stream to the one <video> element whenever either changes.
    useEffect(() => {
        if (videoRef.current && stream) videoRef.current.srcObject = stream;
    }, [stream, phase]);

    const stopCamera = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setStream(null);
    }, []);

    // Release the camera if the component goes away.
    useEffect(() => stopCamera, [stopCamera]);

    // ── End the attempt because the taker left ───────────────────────────────
    const terminate = useCallback((kind: string) => {
        if (endedRef.current || !attemptIdRef.current) return;
        endedRef.current = true;
        const url = `/api/proctor/attempts/${attemptIdRef.current}/event`;
        const body = JSON.stringify({ kind, detail: { at: new Date().toISOString() } });
        if (kind === 'page_unload' && navigator.sendBeacon) {
            navigator.sendBeacon(url, body);
        } else {
            fetch(url, { method: 'POST', body, keepalive: true }).catch(() => { /* recorded on best effort */ });
        }
        setEndReason(kind);
        setPhase('terminated');
        stopCamera();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }, [stopCamera]);

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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers: answersRef.current }),
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
            stopCamera();
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        } catch (err) {
            endedRef.current = false; // still locked; let them retry
            setError(`${errMsg(err)}. Stay on this page and press Submit again.`);
        } finally {
            setBusy(false);
        }
    }, [questions.length, confirmPending, stopCamera]);

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
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image }),
                });
                const data = await res.json().catch(() => ({}));
                if (data.ok) setAiWarning(data.flagged ? data.reason || 'Stay in front of the camera' : null);
            } catch { /* a missed check is fine; the next one runs in 20s */ }
            finally { inFlight = false; }
        };

        const first = setTimeout(snap, 3000);
        const loop = setInterval(snap, SNAPSHOT_EVERY_MS);
        return () => { clearTimeout(first); clearInterval(loop); };
    }, [phase, test?.ai_monitoring]);

    // ── Setup steps ──────────────────────────────────────────────────────────
    const enableCamera = async () => {
        setError(null);
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
            streamRef.current = s;
            setStream(s);
            setPhase('ready');
        } catch {
            setError('Camera access was blocked. Allow the camera for this site in your browser, then try again.');
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
            const res = await fetch(`/api/proctor/tests/${testId}/start`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not start the test');
            attemptIdRef.current = data.attempt_id;
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

    const cameraView = stream && (phase === 'ready' || phase === 'running') ? (
        <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={phase === 'running'
                ? 'fixed bottom-4 right-4 z-40 w-40 h-30 rounded-xl border-2 border-white shadow-lg object-cover bg-black -scale-x-100'
                : 'w-full max-w-sm aspect-4/3 rounded-2xl object-cover bg-black -scale-x-100'}
        />
    ) : null;

    if (authLoading || phase === 'loading') {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader size="lg" text="Loading test..." /></div>;
    }

    if (phase === 'blocked') {
        return (
            <Centered>
                <AlertTriangle className="w-10 h-10 text-amber-500" />
                <h1 className="text-lg font-black text-slate-900">{test?.title || 'Test unavailable'}</h1>
                <p className="text-sm text-slate-600 max-w-md">{message}</p>
                <Link href="/proctor" className="text-sm font-bold text-slate-900 underline">Back to tests</Link>
            </Centered>
        );
    }

    if (phase === 'terminated') {
        return (
            <Centered>
                <XCircle className="w-12 h-12 text-rose-500" />
                <h1 className="text-xl font-black text-slate-900">Test closed</h1>
                <p className="text-sm text-slate-600 max-w-md">
                    {endReason ? REASON_LABEL[endReason] : 'This attempt had already ended.'} Leaving the test window ends the test.
                    Your attempt and the reason have been recorded for your reviewer.
                </p>
                <Link href="/proctor" className="text-sm font-bold text-slate-900 underline">Back to tests</Link>
            </Centered>
        );
    }

    if (phase === 'submitted') {
        return (
            <Centered>
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                <h1 className="text-xl font-black text-slate-900">Submitted</h1>
                <p className="text-sm text-slate-600 max-w-md">Your answers have been recorded. You can close this page.</p>
                <Link href="/proctor" className="text-sm font-bold text-slate-900 underline">Back to tests</Link>
            </Centered>
        );
    }

    if (phase === 'setup' || phase === 'ready') {
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
                    </div>

                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                        <p className="flex items-center gap-2 text-sm font-black text-rose-900"><Lock className="w-4 h-4" /> Once you start, the test is locked to this screen</p>
                        <ul className="mt-2 list-disc pl-5 text-sm text-rose-900/80 space-y-1">
                            <li>Switching tabs, switching apps, pressing <b>Esc</b>, leaving fullscreen, or closing/refreshing the page <b>ends the test immediately</b>.</li>
                            <li>You get one attempt. It cannot be restarted.</li>
                            <li>Keep your face in view of the camera. Checks are recorded for your reviewer.</li>
                            <li>Close other apps and turn off notifications before you begin.</li>
                        </ul>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                        <div className="flex items-center gap-3">
                            <Step n={1} done={phase === 'ready'} />
                            <p className="flex-1 text-sm font-bold text-slate-900">Turn on your camera</p>
                            {phase === 'setup' && (
                                <button onClick={enableCamera} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
                                    <Camera className="w-4 h-4" /> Enable camera
                                </button>
                            )}
                        </div>
                        {cameraView && <div className="flex justify-center">{cameraView}</div>}
                        <div className="flex items-center gap-3">
                            <Step n={2} done={false} />
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
                <p className="flex-1 truncate text-sm font-black text-slate-900">{test?.title}</p>
                <span className="text-xs font-bold text-slate-500">{answeredCount}/{questions.length} answered</span>
                <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-black tabular-nums ${remaining < 60 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-900'}`}>
                    <Clock className="w-4 h-4" /> {mm}:{ss}
                </span>
            </header>

            {aiWarning && (
                <div className="sticky top-[53px] z-30 flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900">
                    <ShieldAlert className="w-4 h-4" /> {aiWarning} — this has been noted for your reviewer.
                </div>
            )}

            <main className="mx-auto max-w-2xl space-y-6 px-4 py-6 pb-40">
                {questions.map((q, i) => (
                    <fieldset key={q.id} className="rounded-2xl border border-slate-200 p-4">
                        <legend className="px-1 text-sm font-black text-slate-900">Q{i + 1}. {q.text}</legend>
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
