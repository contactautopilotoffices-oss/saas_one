'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock, Lock, Mic, ShieldAlert, Video, XCircle } from 'lucide-react';
import { createDeviceDetector, type DeviceDetector, type DeviceObservation } from '@/frontend/lib/proctor/deviceDetector';

/**
 * The locked test page, used two ways:
 *   · mode="authed" — a signed-in member opening /proctor/<testId>.
 *   · mode="public" — anyone with the link at /t/<token>. No account: they type
 *     their name and email, and the attempt is identified from then on by the
 *     attempt_token the server issues at start.
 *
 * Answers are saved as they are picked, with a heartbeat every 20s. If the page
 * dies without reporting (crash, power, network), opening the link again within
 * 5 minutes continues the same attempt: same questions, saved answers, and the
 * time it had left.
 *
 * Camera and microphone on → fullscreen → questions appear. From then on, any
 * of these ends the attempt and the server records why: tab switch, switching
 * app (blur), leaving fullscreen incl. Esc, close/refresh (pagehide → beacon),
 * camera off.
 *
 * A detector in the browser (MediaPipe, frontend/lib/proctor/deviceDetector.ts)
 * watches the camera several times a second; a problem held for 1.5s — head or
 * eyes off the screen, no face, a second face, a phone — is reported, so the
 * warning pops up within about two seconds. Every ~10s a frame also goes to the
 * server's vision model, as the backstop and for evidence frames. Either way at
 * most one warning every 20s counts as a strike, so the taker has time to put
 * it right; after the test's limit the attempt closes. For a phone or
 * a second face the frame is also kept for the reviewer.
 * The microphone is watched for a voice nearby; that is recorded and the taker
 * is warned, but it does not count as a strike (loudness alone is too crude).
 */

type Phase = 'loading' | 'blocked' | 'identify' | 'setup' | 'ready' | 'running' | 'terminated' | 'submitted';
type Question = { id: string; section?: string; text: string; options: string[]; multi?: boolean };
/** One option index, or for a "select all that apply" question, the options ticked. */
type Answer = number | number[];

const isPicked = (a: Answer | undefined, oi: number) => (Array.isArray(a) ? a.includes(oi) : a === oi);
/** Answered = something picked (an emptied multiple-answer question counts as not answered). */
const isAnswered = (a: Answer | undefined) => (Array.isArray(a) ? a.length > 0 : a !== undefined);
type Section = { key: string; title: string; description?: string; question_count: number };
type TestInfo = {
    title: string; instructions: string | null; duration_minutes: number; ai_monitoring: boolean;
    max_attempts: number; look_away_strikes: number; question_count: number; sections: Section[];
};
type MyAttempt = { attempt_no: number; status: string; termination_reason: string | null };

const SNAPSHOT_EVERY_MS = 10_000;
/** Switching tab/app or leaving fullscreen: this many warnings, then the test closes (matches the event route). */
const LEAVE_WARNINGS = 2;
/** On-device detector: look this often, warn once a problem has lasted this long, and repeat while it lasts. */
const DEVICE_TICK_MS = 250;
const DEVICE_HOLD_MS = 1_500;
const DEVICE_REPEAT_MS = 20_000;
/** Rough loudness that counts as a voice in the room. Logged with the event so it can be tuned. */
const VOICE_RMS_THRESHOLD = 0.035;
const VOICE_SUSTAIN_SAMPLES = 3;   // ~1.5s above the threshold
const VOICE_REPORT_GAP_MS = 30_000;
const VOICE_WARNING_MS = 10_000;   // how long the "keep the room quiet" notice stays up
const WARNING_POPUP_MS = 4_000;    // how long each camera warning pop-up stays up
/** Autosave: soon after an answer changes, and a heartbeat this often regardless (it keeps a crashed attempt resumable). */
const SAVE_DEBOUNCE_MS = 800;
const HEARTBEAT_MS = 20_000;
const RESUMABLE_NOTE = 'Your last attempt was interrupted. When you start, you will continue where you left off with your saved answers. The timer kept running while you were away.';

const REASON_LABEL: Record<string, string> = {
    tab_hidden: 'You switched tabs or minimised the browser.',
    window_blur: 'You switched to another window or app.',
    fullscreen_exit: 'You left fullscreen.',
    page_unload: 'The page was closed or refreshed.',
    camera_lost: 'Your camera was turned off.',
    reopened: 'The test was opened again before it was finished.',
    looking_away: 'You received too many camera warnings.',
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
    const [answers, setAnswers] = useState<Record<string, Answer>>({});
    const [remaining, setRemaining] = useState(0);
    const [cameraWarning, setCameraWarning] = useState<string | null>(null);
    /** A pop-up for each new camera warning, so the 2nd and 3rd don't look like the 1st still showing. */
    const [warningPopup, setWarningPopup] = useState<{ text: string; strikes: number; allowed: number; id: number } | null>(null);
    // Stable, so the pop-up's timer isn't restarted by the countdown's re-render every second.
    const closeWarningPopup = useCallback(() => setWarningPopup(null), []);
    /** The warning that closed the test, shown on the closed screen. */
    const [finalWarning, setFinalWarning] = useState<string | null>(null);
    const [voiceWarning, setVoiceWarning] = useState(false);
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
                    if (data.resumable) {
                        setPreviousNote(RESUMABLE_NOTE);
                    } else if (last) {
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
        // The answers so far go with it, so they are graded as a partial score.
        const body = JSON.stringify({ kind, detail: { at: new Date().toISOString() }, attempt_token: attemptTokenRef.current, answers: answersRef.current });
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

    // ── Left the test (tab/app switch, fullscreen exit): warnings first, then it closes ─
    /** Set while the "you left the test" screen is up. warnings = 0 until the server answers. */
    const [away, setAway] = useState<{ warnings: number; allowed: number } | null>(null);
    /** One switch fires hidden + blur + fullscreen exit together; report only the first. */
    const leavingRef = useRef(false);

    const leave = useCallback(async (kind: string) => {
        if (endedRef.current || !attemptIdRef.current || leavingRef.current) return;
        leavingRef.current = true;
        setAway((a) => a || { warnings: 0, allowed: LEAVE_WARNINGS });
        try {
            const res = await fetch(`/api/proctor/attempts/${attemptIdRef.current}/event`, {
                method: 'POST',
                headers: authHeaders(),
                keepalive: true,
                body: JSON.stringify({ kind, detail: { at: new Date().toISOString() }, attempt_token: attemptTokenRef.current, answers: answersRef.current }),
            });
            const data = await res.json().catch(() => ({}));
            if (data.status === 'warned') {
                setAway({ warnings: data.warnings, allowed: data.allowed });
            } else if (data.status === 'terminated' || (data.status && data.status !== 'in_progress')) {
                setAway(null);
                acceptServerTermination(kind);
                return;
            }
        } catch { /* offline: the screen stays up; the server hears about it on the next call */ }
        // Back on the page already (e.g. only Esc was pressed): the next departure is a new one.
        if (document.visibilityState === 'visible' && document.hasFocus()) leavingRef.current = false;
    }, [authHeaders, acceptServerTermination]);

    const returnToTest = async () => {
        try {
            await document.documentElement.requestFullscreen();
        } catch {
            setError('Fullscreen was blocked. Allow fullscreen for this site, then press Return to the test.');
            return;
        }
        leavingRef.current = false;
        setAway(null);
        setError(null);
    };

    // ── Submit ───────────────────────────────────────────────────────────────
    const submit = useCallback(async (auto = false) => {
        if (endedRef.current || !attemptIdRef.current) return;
        if (!auto && !confirmPending && Object.values(answersRef.current).filter(isAnswered).length < questions.length) {
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

        // Switching away gets warnings (leave); closing the page or losing the camera ends it at once.
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') leave('tab_hidden');
            else leavingRef.current = false; // back: the next departure counts again
        };
        const onBlur = () => leave('window_blur');
        const onFocus = () => { leavingRef.current = false; };
        const onFullscreen = () => { if (!document.fullscreenElement) leave('fullscreen_exit'); };
        const onPageHide = () => terminate('page_unload');
        const block = (e: Event) => e.preventDefault();
        const track = streamRef.current?.getVideoTracks()[0];
        const onTrackEnded = () => terminate('camera_lost');

        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        document.addEventListener('fullscreenchange', onFullscreen);
        window.addEventListener('pagehide', onPageHide);
        ['contextmenu', 'copy', 'cut', 'paste'].forEach((ev) => document.addEventListener(ev, block));
        track?.addEventListener('ended', onTrackEnded);

        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('fullscreenchange', onFullscreen);
            window.removeEventListener('pagehide', onPageHide);
            ['contextmenu', 'copy', 'cut', 'paste'].forEach((ev) => document.removeEventListener(ev, block));
            track?.removeEventListener('ended', onTrackEnded);
        };
    }, [phase, terminate, leave]);

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

    // The questions replace a long start page; without this the browser keeps that scroll
    // position and the test opens part-way down (around question 3) instead of at Q1.
    useEffect(() => {
        if (phase === 'running') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, [phase]);

    // ── Autosave + heartbeat: answers survive a crash, and the attempt stays resumable ─
    const saveProgress = useCallback(() => {
        if (endedRef.current || !attemptIdRef.current) return;
        fetch(`/api/proctor/attempts/${attemptIdRef.current}/progress`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ answers: answersRef.current, attempt_token: attemptTokenRef.current }),
        }).catch(() => { /* the next save or heartbeat tries again */ });
    }, [authHeaders]);

    useEffect(() => {
        if (phase !== 'running') return;
        const t = setTimeout(saveProgress, SAVE_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [phase, answers, saveProgress]);

    useEffect(() => {
        if (phase !== 'running') return;
        const t = setInterval(saveProgress, HEARTBEAT_MS);
        return () => clearInterval(t);
    }, [phase, saveProgress]);

    // ── Warnings: one handler for the server's camera check and the on-device detector ─
    /** What the device detector sees right now; a clean camera check doesn't clear a live problem. */
    const deviceProblemRef = useRef<string | null>(null);
    /** The MediaPipe detector, started during setup so it's ready (and warmed up) when the test starts. */
    const detectorPromiseRef = useRef<Promise<DeviceDetector | null> | null>(null);

    const applyFlagResult = useCallback((data: {
        ok?: boolean; warn?: boolean; status?: string; counted?: boolean; message?: string; strikes?: number; strikes_allowed?: number;
    }) => {
        if (data.status === 'terminated') {
            if (data.message) setFinalWarning(`${data.message} (warning ${data.strikes} of ${data.strikes_allowed})`);
            acceptServerTermination('looking_away');
        } else if (data.ok && data.warn && data.message) {
            setCameraWarning(`${data.message} (warning ${data.strikes} of ${data.strikes_allowed})`);
            // Only a warning that counted gets a pop-up; one inside the 20s gap just keeps the banner up.
            if (data.counted !== false) setWarningPopup({ text: data.message, strikes: data.strikes || 0, allowed: data.strikes_allowed || 0, id: Date.now() });
        } else if (data.ok && !deviceProblemRef.current) {
            setCameraWarning(null);
        }
    }, [acceptServerTermination]);

    /** A 320×240 JPEG of the current camera frame. */
    const grabFrame = useCallback((canvas: HTMLCanvasElement) => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return null;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.6);
    }, []);

    // ── AI frame checks (server, every ~10s): the backstop, and the evidence frames ─
    useEffect(() => {
        if (phase !== 'running' || !test?.ai_monitoring) return;
        let inFlight = false;
        const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });

        const snap = async () => {
            if (inFlight || endedRef.current) return;
            const image = grabFrame(canvas);
            if (!image) return;
            inFlight = true;
            try {
                const res = await fetch(`/api/proctor/attempts/${attemptIdRef.current}/snapshot`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ image, attempt_token: attemptTokenRef.current }),
                });
                applyFlagResult(await res.json().catch(() => ({})));
            } catch { /* a missed check is fine; the next one runs in 10s */ }
            finally { inFlight = false; }
        };

        const first = setTimeout(snap, 3000);
        const loop = setInterval(snap, SNAPSHOT_EVERY_MS);
        return () => { clearTimeout(first); clearInterval(loop); };
    }, [phase, test?.ai_monitoring, authHeaders, applyFlagResult, grabFrame]);

    // ── On-device detector (MediaPipe, several times a second): the ~2-second warnings ─
    useEffect(() => {
        if (phase !== 'running' || !test?.ai_monitoring) return;
        let stopped = false;
        let detector: DeviceDetector | null = null;
        let timer: ReturnType<typeof setInterval> | undefined;
        const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });

        // The problem being held right now, since when, and when it was last reported.
        let held: { category: string; since: number; reportedAt: number } | null = null;
        let tick = 0;

        const report = async (obs: DeviceObservation, heldMs: number) => {
            try {
                const res = await fetch(`/api/proctor/attempts/${attemptIdRef.current}/flag`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({
                        category: obs.category,
                        detail: { observation: obs.observation, yaw: obs.yaw, pitch: obs.pitch, score: obs.score, faces: obs.faces, held_ms: heldMs },
                        // The frame goes with every warning, for the reviewer's report.
                        image: grabFrame(canvas),
                        attempt_token: attemptTokenRef.current,
                    }),
                });
                applyFlagResult(await res.json().catch(() => ({})));
            } catch { /* the camera check every 10s still runs */ }
        };

        (async () => {
            // Usually already loaded and warmed up during the camera step (see the preload below).
            detector = await (detectorPromiseRef.current ??= createDeviceDetector());
            if (stopped) { detector?.close(); detectorPromiseRef.current = null; return; }
            if (!detector) {
                // This browser can't run it: say so in the log; the 10s camera check carries on alone.
                fetch(`/api/proctor/attempts/${attemptIdRef.current}/event`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ kind: 'detector_unavailable', detail: { at: new Date().toISOString() }, attempt_token: attemptTokenRef.current }),
                }).catch(() => {});
                return;
            }
            timer = setInterval(() => {
                const video = videoRef.current;
                if (endedRef.current || !detector || !video || video.readyState < 2) return;
                let obs: DeviceObservation;
                try {
                    obs = detector.analyse(video, tick++ % 2 === 0); // phone model every other tick
                } catch { return; }

                const now = Date.now();
                if (!obs.category) {
                    if (deviceProblemRef.current) setCameraWarning(null);
                    deviceProblemRef.current = null;
                    held = null;
                    return;
                }
                if (!held || held.category !== obs.category) held = { category: obs.category, since: now, reportedAt: 0 };
                const heldMs = now - held.since;
                // Held long enough to be real; while it lasts, report again every 20s (the next strike).
                if (heldMs >= DEVICE_HOLD_MS && now - held.reportedAt >= DEVICE_REPEAT_MS) {
                    held.reportedAt = now;
                    deviceProblemRef.current = obs.category;
                    report(obs, heldMs);
                }
            }, DEVICE_TICK_MS);
        })();

        return () => {
            stopped = true;
            clearInterval(timer);
            detector?.close();
            if (detector) detectorPromiseRef.current = null;
            deviceProblemRef.current = null;
        };
    }, [phase, test?.ai_monitoring, authHeaders, applyFlagResult, grabFrame]);

    // Load MediaPipe while the candidate is still on the setup screen (from the moment the camera
    // is on), and run it once on the preview so its one-time compile happens here. Otherwise that
    // ~1-2s freeze lands right after pressing Start.
    useEffect(() => {
        if (phase !== 'ready' || !test?.ai_monitoring || detectorPromiseRef.current) return;
        const loading = createDeviceDetector();
        detectorPromiseRef.current = loading;
        loading.then((d) => {
            const video = videoRef.current;
            if (d && video && detectorPromiseRef.current === loading) d.warmUp(video);
        });
    }, [phase, test?.ai_monitoring]);

    // Leaving the page before the test started: release the preloaded models.
    useEffect(() => () => { detectorPromiseRef.current?.then((d) => d?.close()); }, []);

    // ── Microphone: a voice in the room is recorded and warned about, no strike ─
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
        let hideWarning: ReturnType<typeof setTimeout> | undefined;

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
                setVoiceWarning(true);
                clearTimeout(hideWarning);
                hideWarning = setTimeout(() => setVoiceWarning(false), VOICE_WARNING_MS);
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
        return () => { clearInterval(timer); clearTimeout(hideWarning); ctx.close().catch(() => {}); };
    }, [phase, authHeaders]);

    // ── Setup steps ──────────────────────────────────────────────────────────
    const noChancesLeftMessage = (completed: boolean, lastReason: string | null) =>
        (completed
            ? 'You have already completed this test.'
            : `You have used both your attempts at this test.${lastReason ? ` The last one was closed: ${REASON_LABEL[lastReason] || 'you left the test window.'}` : ''}`)
        + ' Ask your administrator to send you a new link if you need another attempt.';

    const enableMedia = async () => {
        setError(null);
        // A candidate from the public link is only known once they type their email,
        // so their chances are checked here — before the camera, not after fullscreen.
        if (mode === 'public') {
            try {
                const res = await fetch(`/api/public/proctor/${token}/check`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email.trim() }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not check this link');
                if (data.completed || data.chances_left === 0) {
                    setMessage(noChancesLeftMessage(data.completed, data.last_reason));
                    setPhase('blocked');
                    return;
                }
                setChancesLeft(data.chances_left);
                if (data.resumable) {
                    setPreviousNote(RESUMABLE_NOTE);
                } else if (data.attempts_used > 0 && !previousNote) {
                    setPreviousNote(`This is attempt ${data.attempts_used + 1} of ${data.max_attempts}.` +
                        (data.last_reason ? ` Your previous one was closed: ${REASON_LABEL[data.last_reason] || 'you left the test window.'}` : ''));
                }
            } catch (err) {
                setError(errMsg(err));
                return;
            }
        }
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
            setError('Camera and microphone access was blocked. Click the icon at the left of the address bar, set Camera and Microphone to Allow, reload the page, and try again.');
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
            // The server's clock: a resumed attempt keeps the time it had left.
            deadlineRef.current = Date.now() + (data.remaining_seconds ?? data.duration_minutes * 60) * 1000;
            setQuestions(data.questions || []);
            setAnswers(data.answers || {});
            endedRef.current = false;
            setPhase('running');
        } catch (err) {
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            const text = errMsg(err);
            if (/already completed|used all|used your only/i.test(text)) {
                setMessage(`${text}. Ask your administrator to send you a new link if you need another attempt.`);
                setPhase('blocked');
            } else {
                setError(text);
            }
        } finally {
            setBusy(false);
        }
    };

    // ── Render ───────────────────────────────────────────────────────────────
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    const answeredCount = Object.values(answers).filter(isAnswered).length;
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
                {finalWarning && endReason === 'looking_away' && (
                    <p className="flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900 max-w-md">
                        <ShieldAlert className="w-4 h-4 shrink-0" /> Last warning: {finalWarning}
                    </p>
                )}
                <p className="text-sm text-slate-600 max-w-md">
                    {endReason ? REASON_LABEL[endReason] : 'This attempt had already ended.'} The reason has been recorded for your reviewer.
                    {' '}The answers you gave before it closed are saved.
                </p>
                <p className="text-sm font-bold text-slate-900 max-w-md">
                    {chancesLeft > 0
                        ? `You have ${plural(chancesLeft, 'chance')} left. Open the test link again when you are ready.`
                        : 'That was your last chance at this test. Ask your administrator to send you a new link if you need another attempt.'}
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
        const nameOk = name.trim().length >= 2;
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
        const identified = nameOk && emailOk;
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
                                {sections.map((s, si) => (
                                    <li key={s.key} className="text-sm">
                                        <span className="font-bold text-slate-900">Section {si + 1} · {s.title}</span>
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
                            <li>Switching tabs, switching apps, pressing <b>Esc</b> or leaving fullscreen gives you a warning. You get {plural(LEAVE_WARNINGS, 'warning')}; the next time <b>ends the test</b>.</li>
                            <li>Closing or refreshing the page, or turning off the camera, <b>ends the test immediately</b>.</li>
                            <li>You have {plural(chancesLeft, 'chance')}. Leaving the page uses one up; once you submit, the test is finished.</li>
                            <li>Your <b>camera and microphone stay on</b> for the whole test. What they record is sent to your reviewer.</li>
                            <li>Stay alone, facing the screen, with phones and other devices put away. The camera warns you if it sees otherwise; after {plural(test?.look_away_strikes || 3, 'warning')}, the test closes.</li>
                            <li>Keep the room quiet. Voices or noise nearby also show a warning, but these do not count towards the limit.</li>
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
                                <div className="grid gap-3 pl-10 sm:grid-cols-2">
                                    <label className="block">
                                        <span className="mb-1 block text-xs font-bold text-slate-600">Your full name</span>
                                        <input
                                            className={`w-full rounded-xl border px-3 py-2 text-sm ${nameOk || !name ? 'border-slate-200' : 'border-rose-300'}`}
                                            placeholder="e.g. Lohitaksha Rajpurohit"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            disabled={phase !== 'identify'}
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-1 block text-xs font-bold text-slate-600">Your email address</span>
                                        <input
                                            className={`w-full rounded-xl border px-3 py-2 text-sm ${emailOk || !email ? 'border-slate-200' : 'border-rose-300'}`}
                                            placeholder="e.g. name@company.com"
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            disabled={phase !== 'identify'}
                                        />
                                        {email && !emailOk && <span className="mt-1 block text-xs font-bold text-rose-600">That is not an email address yet</span>}
                                    </label>
                                </div>
                                {phase === 'identify' && !identified && (
                                    <p className="pl-10 text-xs text-slate-500">
                                        Fill both in to switch on the camera. Your reviewer needs them to know whose attempt this is.
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="flex items-center gap-3">
                            <Step n={mode === 'public' ? 2 : 1} done={phase === 'ready'} />
                            <p className="flex-1 text-sm font-bold text-slate-900">Turn on your camera and microphone</p>
                            {phase !== 'ready' && (
                                <button
                                    onClick={enableMedia}
                                    disabled={!canEnableMedia}
                                    title={canEnableMedia ? 'Your browser will ask for camera and microphone' : 'Enter your name and email first'}
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

            {(cameraWarning || voiceWarning) && (
                <div className="sticky top-[53px] z-30 divide-y divide-amber-200 bg-amber-100 text-sm font-bold text-amber-900">
                    {cameraWarning && (
                        <p className="flex items-center gap-2 px-4 py-2"><ShieldAlert className="w-4 h-4" /> {cameraWarning}</p>
                    )}
                    {voiceWarning && (
                        <p className="flex items-center gap-2 px-4 py-2"><Mic className="w-4 h-4" /> Voices or noise picked up nearby — please keep the room quiet</p>
                    )}
                </div>
            )}

            {warningPopup && <WarningPopup key={warningPopup.id} {...warningPopup} onDone={closeWarningPopup} />}

            {/* Left the test: the questions stay hidden until they come back to fullscreen. */}
            {away && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/95 px-6" role="alertdialog" aria-labelledby="left-title">
                    <div className="max-w-md space-y-4 text-center text-white">
                        <AlertTriangle className="mx-auto w-12 h-12 text-amber-400" />
                        <h2 id="left-title" className="text-2xl font-black">You left the test</h2>
                        {away.warnings > 0 && (
                            <p className="text-sm font-black uppercase tracking-wider text-amber-300">Warning {away.warnings} of {away.allowed}</p>
                        )}
                        <p className="text-sm text-white/80">
                            Switching tabs or apps, pressing Esc or leaving fullscreen is recorded for your reviewer.
                            {away.warnings >= away.allowed
                                ? ' This was your last warning: the next time, the test closes.'
                                : ` After ${plural(away.allowed, 'warning')} the test closes.`}
                            {' '}The timer is still running.
                        </p>
                        {error && <p className="text-sm font-bold text-rose-300">{error}</p>}
                        <button onClick={returnToTest} className="rounded-2xl bg-white px-6 py-3 text-sm font-black text-slate-900">
                            Return to the test
                        </button>
                    </div>
                </div>
            )}

            <main className="mx-auto max-w-2xl space-y-6 px-4 py-6 pb-40">
                {sections.map((section, si) => {
                    const inSection = questions.filter((q) => (q.section || 'general') === section.key);
                    if (!inSection.length) return null;
                    return (
                        <section key={section.key} className="space-y-4">
                            {sections.length > 1 && (
                                <div className="border-b border-slate-200 pb-1">
                                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">Section {si + 1} of {sections.length}</p>
                                    <h2 className="text-base font-black text-slate-900">{section.title}</h2>
                                    {section.description && <p className="text-xs text-slate-500">{section.description}</p>}
                                </div>
                            )}
                            {inSection.map((q) => (
                                <div key={q.id} role="group" aria-labelledby={`label-${q.id}`} className="rounded-2xl border border-slate-200 p-4">
                                    <p id={`label-${q.id}`} className="text-sm font-black text-slate-900">Q{questions.indexOf(q) + 1}. {q.text}</p>
                                    {q.multi && <p className="mt-0.5 text-xs font-bold text-slate-500">Select all that apply</p>}
                                    <div className="mt-3 space-y-2">
                                        {q.options.map((opt, oi) => (
                                            <label key={oi} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${isPicked(answers[q.id], oi) ? 'border-slate-900 bg-slate-50 font-bold' : 'border-slate-200'}`}>
                                                <input
                                                    type={q.multi ? 'checkbox' : 'radio'}
                                                    name={q.id}
                                                    checked={isPicked(answers[q.id], oi)}
                                                    onChange={() => setAnswers((a) => {
                                                        if (!q.multi) return { ...a, [q.id]: oi };
                                                        const now = Array.isArray(a[q.id]) ? a[q.id] as number[] : [];
                                                        return { ...a, [q.id]: now.includes(oi) ? now.filter((x) => x !== oi) : [...now, oi] };
                                                    })}
                                                />
                                                {opt}
                                            </label>
                                        ))}
                                    </div>
                                </div>
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

/** Centre-screen notice for one camera warning; it fades after a few seconds and doesn't block the test. */
function WarningPopup({ text, strikes, allowed, onDone }: { text: string; strikes: number; allowed: number; onDone: () => void }) {
    useEffect(() => {
        const t = setTimeout(onDone, WARNING_POPUP_MS);
        return () => clearTimeout(t);
    }, [onDone]);
    const last = strikes >= allowed - 1;
    return (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-6" role="alert">
            <div className={`max-w-sm rounded-2xl border-2 p-5 text-center shadow-2xl ${last ? 'border-rose-400 bg-rose-50' : 'border-amber-400 bg-amber-50'}`}>
                <ShieldAlert className={`mx-auto mb-2 w-8 h-8 ${last ? 'text-rose-600' : 'text-amber-600'}`} />
                <p className={`text-xs font-black uppercase tracking-wider ${last ? 'text-rose-700' : 'text-amber-700'}`}>Warning {strikes} of {allowed}</p>
                <p className="mt-1 text-base font-black text-slate-900">{text}</p>
                {last && <p className="mt-2 text-sm font-bold text-rose-700">One more warning and the test closes.</p>}
            </div>
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
