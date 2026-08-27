'use client';

/**
 * AgentCall — a 1:1 full-duplex voice call with a council member.
 *
 * Teams-shaped: dial → live call (portrait with a breathing voice halo, live
 * captions, mute, screen share, timer) → end call → minutes.
 *
 * Transport is OpenAI Realtime over WebRTC. The server (/api/council/call)
 * mints an ephemeral secret whose session already carries the member's
 * persona and a live slice of FMS data — the browser never sees an API key,
 * and the member walks onto the call already briefed.
 *
 * Screen share: the realtime model reads images, not video, so "sharing"
 * shows a local preview and sends the member a frame on demand (and every
 * 15 s while sharing). That is honest about what the model actually sees.
 *
 * The captions the caller sees are the SAME transcript the minutes are
 * written from — no hidden channel, nothing in the minutes the call didn't
 * say out loud.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Mic,
  MicOff,
  MonitorUp,
  MonitorOff,
  Captions,
  PhoneOff,
  Copy,
  Download,
  X,
  ImageUp,
} from 'lucide-react';
import type { CouncilAgent } from './fixtures';

type CallState = 'dialing' | 'live' | 'summarising' | 'ended' | 'error';

interface CaptionLine {
  id: number;
  role: 'you' | 'agent';
  text: string;
  final: boolean;
}

const EASE = [0.19, 1, 0.22, 1] as const;

function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/* Round control button in the call bar. */
function CallButton({
  onClick,
  active,
  danger,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 46,
        height: 46,
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: danger ? '#fff' : active ? 'var(--council-ink-1)' : 'var(--council-ink-2)',
        background: danger
          ? 'var(--error, #EF4444)'
          : active
            ? 'color-mix(in srgb, var(--primary) 22%, transparent)'
            : 'rgba(30, 42, 48, 0.07)',
        boxShadow: danger
          ? '0 6px 16px -6px rgba(239, 68, 68, 0.55)'
          : 'inset 0 0 0 1px rgba(30, 42, 48, 0.10)',
        transition: 'all 300ms cubic-bezier(0.19, 1, 0.22, 1)',
      }}
    >
      {children}
    </button>
  );
}

export default function AgentCall({ agent, onClose }: { agent: CouncilAgent; onClose: () => void }) {
  const reduceMotion = useReducedMotion();

  const [state, setState] = useState<CallState>('dialing');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [level, setLevel] = useState(0); // 0..1 remote voice level for the halo
  const [summary, setSummary] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const shareRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shareVideoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startedAtRef = useRef<number>(0);
  const nextIdRef = useRef(1);
  const shareTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captionsEndRef = useRef<HTMLDivElement | null>(null);
  const endedRef = useRef(false);
  const ringRef = useRef<HTMLAudioElement | null>(null);
  const connectRef = useRef<HTMLAudioElement | null>(null);

  /* Ringback while dialing; one soft chime when the member picks up. The
     play() is allowed because the overlay only exists after a user click. */
  useEffect(() => {
    const ring = ringRef.current;
    if (state === 'dialing') {
      if (ring) { ring.volume = 0.45; ring.play().catch(() => {}); }
    } else {
      ring?.pause();
      if (ring) ring.currentTime = 0;
      if (state === 'live' && connectRef.current) {
        connectRef.current.volume = 0.5;
        connectRef.current.play().catch(() => {});
      }
    }
  }, [state]);

  /* -------------------------------------------------------- caption plumbing */

  const upsertAgentLine = useCallback((delta: string, done: boolean, doneText?: string) => {
    setCaptions((cur) => {
      const last = cur[cur.length - 1];
      if (last && last.role === 'agent' && !last.final) {
        const text = done ? (doneText ?? last.text + delta) : last.text + delta;
        return [...cur.slice(0, -1), { ...last, text, final: done }];
      }
      return [...cur, { id: nextIdRef.current++, role: 'agent', text: done ? (doneText ?? delta) : delta, final: done }];
    });
  }, []);

  const pushUserLine = useCallback((text: string) => {
    if (!text.trim()) return;
    setCaptions((cur) => [...cur, { id: nextIdRef.current++, role: 'you', text: text.trim(), final: true }]);
  }, []);

  useEffect(() => {
    captionsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [captions]);

  /* --------------------------------------------------------------- teardown */

  const hangupTransport = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (shareTimerRef.current) clearInterval(shareTimerRef.current);
    shareTimerRef.current = null;
    shareRef.current?.getTracks().forEach((t) => t.stop());
    shareRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    try { dcRef.current?.close(); } catch { /* already closed */ }
    try { pcRef.current?.close(); } catch { /* already closed */ }
    dcRef.current = null;
    pcRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  useEffect(() => () => hangupTransport(), [hangupTransport]);

  /* ------------------------------------------------------------------- dial */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/council/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_key: agent.key }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Line unavailable (${res.status})`);
        }
        const { client_secret, model } = await res.json();
        if (cancelled) return;

        // Echo cancellation is load-bearing on a full-duplex call: without it,
        // the member's own voice re-enters through laptop speakers and the VAD
        // reads it as the caller interrupting — audio then cuts mid-sentence.
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) { mic.getTracks().forEach((t) => t.stop()); return; }
        micRef.current = mic;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        mic.getTracks().forEach((t) => pc.addTrack(t, mic));

        pc.ontrack = (e) => {
          const stream = e.streams[0];
          if (audioRef.current) {
            audioRef.current.srcObject = stream;
            audioRef.current.play().catch(() => {});
          }
          // Voice halo: sample the remote track's level.
          const ctx = new AudioContext();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          const buf = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteFrequencyData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i];
            setLevel(Math.min(1, sum / buf.length / 90));
            rafRef.current = requestAnimationFrame(tick);
          };
          tick();
        };

        const dc = pc.createDataChannel('oai-events');
        dcRef.current = dc;
        dc.onmessage = (msg) => {
          let e: any;
          try { e = JSON.parse(msg.data); } catch { return; }
          switch (e.type) {
            case 'conversation.item.input_audio_transcription.completed':
              pushUserLine(String(e.transcript ?? ''));
              break;
            case 'response.output_audio_transcript.delta':
            case 'response.audio_transcript.delta':
              upsertAgentLine(String(e.delta ?? ''), false);
              break;
            case 'response.output_audio_transcript.done':
            case 'response.audio_transcript.done':
              upsertAgentLine('', true, String(e.transcript ?? ''));
              break;
            case 'error':
              console.error('[call] realtime error:', e);
              break;
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${client_secret}`, 'Content-Type': 'application/sdp' },
          body: offer.sdp,
        });
        if (!sdpRes.ok) throw new Error(`The line dropped while connecting (${sdpRes.status})`);
        await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
        if (cancelled) return;

        startedAtRef.current = Date.now();
        setState('live');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not reach the member');
        setState('error');
        hangupTransport();
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.key]);

  /* ------------------------------------------------------------------ timer */

  useEffect(() => {
    if (state !== 'live') return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [state]);

  /* --------------------------------------------------------------- controls */

  const toggleMute = () => {
    const next = !muted;
    micRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
  };

  const sendFrame = useCallback(() => {
    const video = shareVideoRef.current;
    const dc = dcRef.current;
    if (!video || !dc || dc.readyState !== 'open' || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1024 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: dataUrl }] },
    }));
    dc.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  const stopShare = useCallback(() => {
    if (shareTimerRef.current) clearInterval(shareTimerRef.current);
    shareTimerRef.current = null;
    shareRef.current?.getTracks().forEach((t) => t.stop());
    shareRef.current = null;
    if (shareVideoRef.current) shareVideoRef.current.srcObject = null;
    setSharing(false);
  }, []);

  const startShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      shareRef.current = stream;
      if (shareVideoRef.current) {
        shareVideoRef.current.srcObject = stream;
        await shareVideoRef.current.play().catch(() => {});
      }
      stream.getVideoTracks()[0].addEventListener('ended', stopShare);
      setSharing(true);
      // First frame after the preview has real pixels, then a slow heartbeat —
      // the model sees stills, so 15 s keeps it current without flooding it.
      setTimeout(sendFrame, 800);
      shareTimerRef.current = setInterval(sendFrame, 15_000);
    } catch {
      /* user cancelled the picker — nothing to do */
    }
  };

  const endCall = async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    const durationS = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;
    hangupTransport();

    const transcript = captions.filter((c) => c.final || c.role === 'agent').map((c) => ({ role: c.role, text: c.text }));
    if (transcript.length === 0) { setState('ended'); return; }

    setState('summarising');
    try {
      const res = await fetch('/api/council/call/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_key: agent.key, transcript, duration_s: durationS }),
      });
      const data = await res.json().catch(() => ({}));
      setSummary(res.ok ? String(data.summary ?? '') : null);
    } catch {
      setSummary(null);
    }
    setState('ended');
  };

  const copySummary = async () => {
    if (!summary) return;
    await navigator.clipboard.writeText(summary).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const downloadSummary = () => {
    if (!summary) return;
    const blob = new Blob([summary], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `call-minutes-${agent.key}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ----------------------------------------------------------------- render */

  const live = state === 'live';
  const haloScale = reduceMotion ? 1 : 1 + level * 0.16;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Call with ${agent.name}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(20, 28, 32, 0.62)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      <audio ref={audioRef} autoPlay />
      {/* ringback + connect chime (ElevenLabs-generated, local assets) */}
      <audio ref={ringRef} src="/council/ring.mp3" loop preload="auto" />
      <audio ref={connectRef} src="/council/connect.mp3" preload="auto" />
      {/* hidden sink for the share stream; frames are canvas-grabbed from it */}
      <video ref={shareVideoRef} muted playsInline style={{ display: sharing ? undefined : 'none', position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        /* NOT .council-page: that class carries min-height:100vh (it styles the
           full council canvas) and stretched this card into a giant white void. */
        style={{
          fontFamily: 'var(--font-body)',
          color: 'var(--council-ink-1)',
          width: 'min(680px, 100%)',
          maxHeight: '92vh',
          overflow: 'auto',
          borderRadius: 20,
          background: 'var(--council-surface-1, #fff)',
          boxShadow: '0 30px 80px -20px rgba(20, 28, 32, 0.5)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ------------------------------------------------------ header bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderBottom: '1px solid rgba(30, 42, 48, 0.08)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              flex: 'none',
              background: live ? 'var(--success, #10B981)' : state === 'error' ? 'var(--error, #EF4444)' : 'var(--warning, #F59E0B)',
              boxShadow: live ? '0 0 0 3px color-mix(in srgb, var(--success, #10B981) 20%, transparent)' : 'none',
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--council-ink-1)' }}>
            1:1 with {agent.name}
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--council-ink-2)' }}>
            {agent.title}
          </span>
          <span style={{ flex: 1 }} />
          {live && (
            <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--council-ink-2)' }}>
              {fmtClock(elapsed)}
            </span>
          )}
          {(state === 'ended' || state === 'error') && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--council-ink-2)', display: 'flex' }}
            >
              <X size={17} />
            </button>
          )}
        </div>

        {/* ---------------------------------------------------------- stage */}
        {state !== 'ended' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '34px 24px 10px', gap: 14 }}>
            <div style={{ position: 'relative', width: 148, height: 148, flex: 'none' }}>
              {/* dialing pulse — rings expanding from the portrait until pickup */}
              {state === 'dialing' && !reduceMotion && (
                <motion.span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: -6,
                    borderRadius: '30%',
                    border: `2px solid color-mix(in srgb, ${agent.color} 55%, transparent)`,
                    pointerEvents: 'none',
                  }}
                  animate={{ scale: [1, 1.22], opacity: [0.7, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              {/* voice halo */}
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: -10,
                  borderRadius: '28%',
                  transform: `scale(${haloScale})`,
                  transition: 'transform 90ms linear',
                  background: `radial-gradient(closest-side, color-mix(in srgb, ${agent.color} ${Math.round(14 + level * 30)}%, transparent), transparent 72%)`,
                }}
              />
              <img
                src={`/council/${agent.key}.png`}
                alt={agent.name}
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  borderRadius: '26%',
                  objectFit: 'cover',
                  objectPosition: 'top',
                  background: `color-mix(in srgb, ${agent.color} 16%, transparent)`,
                  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${agent.color} 45%, transparent), 0 18px 40px -18px color-mix(in srgb, ${agent.color} 60%, transparent)`,
                }}
              />
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--council-ink-1)' }}>
                {agent.name}
              </div>
              <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 500, color: 'var(--council-ink-2)' }}>
                {state === 'dialing' && 'Dialing — pulling live data so they pick up briefed…'}
                {state === 'live' && (sharing ? 'Live · full duplex · seeing your screen' : 'Live · full duplex')}
                {state === 'summarising' && 'Call ended — writing the minutes…'}
                {state === 'error' && (error ?? 'The line failed')}
              </div>
            </div>

            {/* live captions */}
            {live && showCaptions && (
              <div
                style={{
                  width: '100%',
                  maxWidth: 560,
                  height: 150,
                  overflowY: 'auto',
                  borderRadius: 12,
                  padding: '10px 14px',
                  background: 'rgba(30, 42, 48, 0.04)',
                  boxShadow: 'inset 0 0 0 1px rgba(30, 42, 48, 0.07)',
                }}
              >
                {captions.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--council-ink-3, var(--council-ink-2))', fontStyle: 'italic' }}>
                    Say hello — captions appear here and become the minutes.
                  </div>
                )}
                {captions.map((c) => (
                  <div key={c.id} style={{ margin: '5px 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--council-ink-1)' }}>
                    <span style={{ fontWeight: 700, color: c.role === 'agent' ? agent.color : 'var(--council-ink-2)' }}>
                      {c.role === 'agent' ? agent.name : 'You'}:
                    </span>{' '}
                    {c.text}
                  </div>
                ))}
                <div ref={captionsEndRef} />
              </div>
            )}

            {/* ------------------------------------------------- control bar */}
            {(live || state === 'dialing') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0 26px' }}>
                <CallButton onClick={toggleMute} active={!muted} title={muted ? 'Unmute microphone' : 'Mute microphone'}>
                  {muted ? <MicOff size={19} /> : <Mic size={19} />}
                </CallButton>
                <CallButton onClick={sharing ? stopShare : startShare} active={sharing} title={sharing ? 'Stop sharing screen' : 'Share screen'}>
                  {sharing ? <MonitorOff size={19} /> : <MonitorUp size={19} />}
                </CallButton>
                {sharing && (
                  <CallButton onClick={sendFrame} title={`Send this exact frame to ${agent.name} now`}>
                    <ImageUp size={19} />
                  </CallButton>
                )}
                <CallButton onClick={() => setShowCaptions((v) => !v)} active={showCaptions} title={showCaptions ? 'Hide captions' : 'Show captions'}>
                  <Captions size={19} />
                </CallButton>
                <CallButton onClick={endCall} danger title="End call">
                  <PhoneOff size={19} />
                </CallButton>
              </div>
            )}

            {state === 'error' && (
              <div style={{ padding: '4px 0 28px' }}>
                <button type="button" className="cc-btn" onClick={onClose} style={{ height: 36, padding: '0 22px', fontSize: 12 }}>
                  Close
                </button>
              </div>
            )}
            {state === 'summarising' && <div style={{ height: 26 }} />}
          </div>
        )}

        {/* -------------------------------------------------------- minutes */}
        {state === 'ended' && (
          <div style={{ padding: '22px 26px 26px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <img
                src={`/council/${agent.key}.png`}
                alt=""
                style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'cover', objectPosition: 'top', boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${agent.color} 45%, transparent)` }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--council-ink-1)' }}>
                  Call ended — {fmtClock(elapsed)}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--council-ink-2)' }}>
                  Minutes are written only from what was actually said.
                </div>
              </div>
              <span style={{ flex: 1 }} />
              {summary && (
                <>
                  <button type="button" onClick={copySummary} className="cc-btn" style={{ height: 32, padding: '0 14px', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button type="button" onClick={downloadSummary} className="cc-btn" style={{ height: 32, padding: '0 14px', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Download size={13} /> .md
                  </button>
                </>
              )}
            </div>

            <div
              style={{
                borderRadius: 12,
                padding: '14px 18px',
                background: 'rgba(30, 42, 48, 0.035)',
                boxShadow: 'inset 0 0 0 1px rgba(30, 42, 48, 0.07)',
                maxHeight: '48vh',
                overflowY: 'auto',
              }}
            >
              {summary ? (
                summary.split('\n').map((line, i) => {
                  if (line.startsWith('# ')) return <div key={i} style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--council-ink-1)', margin: '2px 0 4px' }}>{line.slice(2)}</div>;
                  if (line.startsWith('## ')) return <div key={i} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--council-ink-2)', margin: '14px 0 4px' }}>{line.slice(3)}</div>;
                  if (line.startsWith('- ')) return <div key={i} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--council-ink-1)', padding: '2px 0 2px 14px', position: 'relative' }}><span style={{ position: 'absolute', left: 2 }}>•</span>{line.slice(2).replace(/\*\*/g, '')}</div>;
                  if (line.startsWith('_')) return <div key={i} style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--council-ink-2)' }}>{line.replace(/_/g, '')}</div>;
                  return line.trim() ? <div key={i} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--council-ink-1)' }}>{line}</div> : null;
                })
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--council-ink-2)' }}>
                  {captions.length === 0
                    ? 'Nothing was said on this call, so there are no minutes.'
                    : 'The minutes writer was unreachable — the captions above were the record of this call.'}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="cc-btn" onClick={onClose} style={{ height: 36, padding: '0 22px', fontSize: 12 }}>
                Done
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
