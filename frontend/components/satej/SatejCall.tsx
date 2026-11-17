'use client';

/**
 * A voice call with Meera about one requirement — the Agent Council's
 * Teams-shaped call (dial → live call with captions → minutes), on ElevenLabs
 * Conversational AI instead of OpenAI Realtime.
 *
 * The server (/api/satej/call) hands back a short-lived signed URL plus the
 * requirement's live record as the call's prompt; the browser talks to
 * ElevenLabs directly over a websocket. Audio worklets are self-hosted from
 * /public/elevenlabs so the CSP needs no blob: or CDN script sources.
 *
 * Hanging up posts the transcript to /api/satej/call/summary, which writes the
 * minutes into the chat — with any change asked for on the call attached as a
 * proposal to Apply. Nothing said on a call changes the requirement by itself.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Mic, MicOff, PhoneOff, X } from 'lucide-react';
import type { VoiceConversation } from '@elevenlabs/client';
import s from './satej.module.css';

type Line = { id: number; role: 'you' | 'satej'; text: string };
type State = 'dialing' | 'live' | 'summarising' | 'ended' | 'error';

export default function SatejCall({ orgId, requirementId, title, onClose, onMinutes }: {
    orgId: string;
    requirementId: string;
    title: string;
    onClose: () => void;
    /** Called once the minutes are in the chat, so the panel can refresh. */
    onMinutes?: () => void;
}) {
    const reduce = useReducedMotion();
    const [state, setState] = useState<State>('dialing');
    const [error, setError] = useState<string | null>(null);
    const [lines, setLines] = useState<Line[]>([]);
    const [muted, setMuted] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [level, setLevel] = useState(0);
    const [elapsed, setElapsed] = useState(0);

    const convRef = useRef<VoiceConversation | null>(null);
    const linesRef = useRef<Line[]>([]);
    const startedAt = useRef(0);
    const nextId = useRef(1);
    const ended = useRef(false);
    const raf = useRef(0);
    const endRef = useRef<HTMLDivElement | null>(null);

    const push = (role: Line['role'], text: string) => {
        if (!text.trim()) return;
        const line = { id: nextId.current++, role, text: text.trim() };
        linesRef.current = [...linesRef.current, line];
        setLines(linesRef.current);
    };

    // Dial.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/satej/call', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ organizationId: orgId, requirementId }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || `The line is unavailable (${res.status})`);
                if (cancelled) return;
                const { Conversation } = await import('@elevenlabs/client');
                const conv = await Conversation.startSession({
                    signedUrl: data.signedUrl,
                    connectionType: 'websocket',
                    textOnly: false,
                    overrides: { agent: { prompt: { prompt: data.prompt }, firstMessage: data.firstMessage } },
                    workletPaths: {
                        rawAudioProcessor: '/elevenlabs/rawAudioProcessor.js',
                        audioConcatProcessor: '/elevenlabs/audioConcatProcessor.js',
                    },
                    libsampleratePath: '/elevenlabs/libsamplerate.worklet.js',
                    onConnect: () => {
                        startedAt.current = Date.now();
                        setState('live');
                    },
                    onMessage: ({ message, source }) => push(source === 'user' ? 'you' : 'satej', message),
                    onModeChange: ({ mode }) => setSpeaking(mode === 'speaking'),
                    onError: (message) => {
                        if (!ended.current) {
                            setError(message || 'The call dropped');
                            setState('error');
                        }
                    },
                    onDisconnect: () => {
                        if (!ended.current) void finish();
                    },
                });
                if (cancelled) {
                    await conv.endSession();
                    return;
                }
                convRef.current = conv;
            } catch (e) {
                if (cancelled) return;
                const msg = (e as Error).message || String(e);
                setError(/permission|denied|notallowed/i.test(msg) ? 'Microphone access was refused. Allow it in the browser and call again.' : msg);
                setState('error');
            }
        })();
        return () => {
            cancelled = true;
            ended.current = true;
            cancelAnimationFrame(raf.current);
            void convRef.current?.endSession().catch(() => undefined);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, requirementId]);

    // Timer and voice halo.
    useEffect(() => {
        if (state !== 'live') return;
        const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
        const tick = () => {
            const v = convRef.current?.getOutputVolume?.() ?? 0;
            setLevel((l) => l * 0.7 + Math.min(1, v * 2.2) * 0.3);
            raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
        return () => {
            clearInterval(t);
            cancelAnimationFrame(raf.current);
        };
    }, [state]);

    useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [lines]);

    // Esc closes only once the call is over; mid-call it must be a deliberate hang-up.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && (state === 'ended' || state === 'error')) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [state, onClose]);

    const finish = useCallback(async () => {
        if (ended.current) return;
        ended.current = true;
        cancelAnimationFrame(raf.current);
        const duration = startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
        await convRef.current?.endSession().catch(() => undefined);
        convRef.current = null;
        if (!linesRef.current.length) {
            setState('ended');
            return;
        }
        setState('summarising');
        try {
            const res = await fetch('/api/satej/call/summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organizationId: orgId,
                    requirementId,
                    duration_s: duration,
                    transcript: linesRef.current.map((l) => ({ role: l.role, text: l.text })),
                }),
            });
            if (res.ok) onMinutes?.();
        } finally {
            setState('ended');
        }
    }, [orgId, requirementId, onMinutes]);

    const toggleMute = () => {
        const next = !muted;
        convRef.current?.setMicMuted(next);
        setMuted(next);
    };

    const mm = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    const statusText = state === 'dialing' ? 'Connecting…' : state === 'live' ? (speaking ? 'Meera is speaking' : 'Listening') : state === 'summarising' ? 'Writing the minutes…' : state === 'error' ? 'Call failed' : 'Call ended';

    const view = (
        <div className={s.callBack} role="dialog" aria-modal aria-label={`Call with Meera about ${title}`}>
            <motion.div
                className={s.callCard}
                initial={reduce ? false : { opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.32, ease: [0.19, 1, 0.22, 1] }}
            >
                <header className={s.callHead}>
                    <span className={`${s.dot} ${state === 'live' ? s.dotLive : state === 'error' ? s.dotBad : s.dotWait}`} />
                    <div style={{ minWidth: 0 }}>
                        <b>1:1 with Meera</b>
                        <div className={s.muted} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                    </div>
                    <span className={s.callTimer}>{state === 'live' ? mm : ''}</span>
                    {(state === 'ended' || state === 'error') && (
                        <button className={s.iconBtn} onClick={onClose} aria-label="Close"><X size={16} /></button>
                    )}
                </header>

                <div className={s.callStage}>
                    <div className={s.portraitWrap}>
                        <span className={s.halo} style={{ transform: `scale(${1 + level * 0.35})`, opacity: state === 'live' ? 0.35 + level * 0.6 : 0.15 }} />
                        {state === 'dialing' && !reduce && <span className={s.ring} />}
                        <div className={s.portrait}>S</div>
                    </div>
                    <div className={s.callStatus}>{statusText}</div>
                    {error && <div className={s.errorBox}>{error}</div>}

                    <div className={s.captions} aria-live="polite">
                        {lines.length === 0 && <span className={s.muted}>Captions appear here as you talk.</span>}
                        {lines.map((l) => (
                            <p key={l.id}><b className={l.role === 'satej' ? s.capSatej : s.capYou}>{l.role === 'satej' ? 'Meera' : 'You'}:</b> {l.text}</p>
                        ))}
                        <div ref={endRef} />
                    </div>

                    {state === 'live' && (
                        <div className={s.callBar}>
                            <button className={`${s.roundBtn} ${muted ? s.roundBtnOn : ''}`} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                                {muted ? <MicOff size={18} /> : <Mic size={18} />}
                            </button>
                            <button className={`${s.roundBtn} ${s.roundBtnDanger}`} onClick={() => void finish()} aria-label="End call">
                                <PhoneOff size={18} />
                            </button>
                        </div>
                    )}
                    {state === 'ended' && (
                        <p className={s.muted} style={{ textAlign: 'center' }}>
                            {lines.length ? 'The minutes are in the chat. Anything you asked to change is there as a proposal to apply.' : 'Nothing was said, so there are no minutes.'}
                        </p>
                    )}
                </div>
            </motion.div>
        </div>
    );
    return typeof document === 'undefined' ? null : createPortal(view, document.body);
}
