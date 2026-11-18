'use client';

/**
 * Stage 2 (owner 2026-11-18) — the guest link /guest/<secret>: an online meeting for someone without a login.
 *
 *   form     the meeting's name, host and time; their name; camera and microphone; the recording notice to agree to
 *   waiting  "Someone will let you in" — asks the server every few seconds
 *   call     the same call screen as the team (CallScreen), without the team's controls
 *   end      let in and left / refused / removed / the meeting ended / the link was turned off
 *
 * The guest's own id and key are kept in this browser tab (sessionStorage), so a reload keeps their place in the
 * waiting list. The server decides everything: /api/public/meetings/<secret>.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { Clock, Loader2, Mic, MicOff, PhoneOff, RotateCcw, ShieldCheck, Video, VideoOff, XCircle } from 'lucide-react';
import { call, niceDateTime } from './api';
import { CallScreen } from './VideoCall';

interface Info { meeting: { title: string; hostName: string; scheduledFor: string | null; open: boolean }; ready: boolean }
type Mine = { guestId: string; key: string; name: string };
type GuestState = 'waiting' | 'admitted' | 'denied' | 'removed';
type Stage = 'form' | 'waiting' | 'connecting' | 'call' | 'left' | 'refused' | 'removed' | 'ended' | 'gone';

const POLL_MS = 3_000;
const apiUrl = (token: string) => `/api/public/meetings/${encodeURIComponent(token)}`;
const storeKey = (token: string) => `meeting-guest:${token}`;

function readMine(token: string): Mine | null {
    try {
        const raw = sessionStorage.getItem(storeKey(token));
        const v = raw ? JSON.parse(raw) : null;
        return v && typeof v.guestId === 'string' && typeof v.key === 'string' ? v : null;
    } catch { return null; }
}
function saveMine(token: string, mine: Mine | null) {
    try {
        if (mine) sessionStorage.setItem(storeKey(token), JSON.stringify(mine));
        else sessionStorage.removeItem(storeKey(token));
    } catch { /* private mode: the place in the queue is only lost on reload */ }
}

export default function GuestCall({ token }: { token: string }) {
    const [info, setInfo] = useState<Info | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [stage, setStage] = useState<Stage>('form');
    const [mine, setMine] = useState<Mine | null>(null);
    const [name, setName] = useState('');
    const [consent, setConsent] = useState(false);
    const [camOn, setCamOn] = useState(true);
    const [micOn, setMicOn] = useState(true);
    const [busy, setBusy] = useState(false);
    const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
    const [recorded, setRecorded] = useState(true);

    // The meeting, and a request this tab already made (a reload while waiting keeps the place)
    useEffect(() => {
        let live = true;
        void call<Info>(apiUrl(token)).then(r => {
            if (!live) return;
            if (!r.ok) { setError(r.error); setStage(r.code === 'LINK_OFF' ? 'gone' : 'form'); return; }
            setInfo({ meeting: r.meeting, ready: r.ready });
            const saved = readMine(token);
            if (saved) { setMine(saved); setName(saved.name); setStage('waiting'); }
        });
        return () => { live = false; };
    }, [token]);

    /** Ask for a call token and go into the call. */
    const enter = useCallback(async (m: Mine) => {
        const r = await call<{ url: string; token: string }>(apiUrl(token), { action: 'token', guestId: m.guestId, key: m.key });
        if (!r.ok) { setError(r.error); setStage(r.code === 'ENDED' ? 'ended' : 'waiting'); return; }
        setConn({ url: r.url, token: r.token });
        setStage('connecting');
    }, [token]);

    // While waiting: ask every few seconds whether someone let us in
    useEffect(() => {
        if (stage !== 'waiting' || !mine) return;
        let live = true;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const tick = async () => {
            const r = await call<{ state: GuestState; open: boolean }>(apiUrl(token), { action: 'status', guestId: mine.guestId, key: mine.key });
            if (!live) return;
            if (!r.ok) {
                if (r.code === 'NO_REQUEST') { saveMine(token, null); setMine(null); setStage('form'); return; }
                if (r.code === 'LINK_OFF') { saveMine(token, null); setStage('gone'); return; }
                timer = setTimeout(tick, POLL_MS * 2); // a dropped connection: keep waiting
                return;
            }
            if (!r.open) { saveMine(token, null); setStage('ended'); return; }
            if (r.state === 'denied') { saveMine(token, null); setStage('refused'); return; }
            if (r.state === 'removed') { saveMine(token, null); setStage('removed'); return; }
            if (r.state === 'admitted') { void enter(mine); return; }
            timer = setTimeout(tick, POLL_MS);
        };
        void tick();
        return () => { live = false; if (timer) clearTimeout(timer); };
    }, [stage, mine, token, enter]);

    const ask = async () => {
        if (busy || !consent) return;
        setBusy(true);
        setError(null);
        const r = await call<{ guestId: string; key: string }>(apiUrl(token), { action: 'ask', name, consent: true });
        setBusy(false);
        if (!r.ok) { setError(r.error); if (r.code === 'ENDED') setStage('ended'); if (r.code === 'LINK_OFF') setStage('gone'); return; }
        const m = { guestId: r.guestId, key: r.key, name: name.trim() };
        saveMine(token, m);
        setMine(m);
        setStage('waiting');
    };

    /** After leaving: were we removed, or did we just leave (and may come back)? */
    const afterCall = useCallback(async () => {
        setConn(null);
        if (!mine) { setStage('left'); return; }
        const r = await call<{ state: GuestState; open: boolean }>(apiUrl(token), { action: 'status', guestId: mine.guestId, key: mine.key });
        if (r.ok && r.state === 'removed') { saveMine(token, null); setStage('removed'); return; }
        if (r.ok && !r.open) { saveMine(token, null); setStage('ended'); return; }
        setStage('left');
    }, [mine, token]);

    if ((stage === 'connecting' || stage === 'call') && conn) {
        return (
            <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio={micOn} video={camOn}
                options={{ adaptiveStream: true, dynacast: true }}
                onConnected={() => {
                    setStage('call');
                    if (mine) void call<{ recording: boolean }>(apiUrl(token), { action: 'connected', guestId: mine.guestId, key: mine.key }, { timeoutMs: 45_000 })
                        .then(r => setRecorded(!r.ok || r.recording));
                }}
                onDisconnected={() => void afterCall()}
                onError={e => setError(e.message)}
                className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white">
                <CallScreen title={info?.meeting.title ?? 'Meeting'} connecting={stage === 'connecting'} isHost={false}
                    recordingProblem={recorded ? null : 'This call is not being recorded right now.'} />
                <RoomAudioRenderer />
            </LiveKitRoom>
        );
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10 text-white">
            <div className="w-full max-w-md space-y-5 rounded-3xl border border-white/10 bg-zinc-900 p-6 shadow-xl">
                {stage === 'gone' ? (
                    <End icon={XCircle} title="This link does not work" text="The link is not valid, or the host has turned it off. Please ask them for a new one." />
                ) : !info && !error ? (
                    <p className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading the meeting…</p>
                ) : !info ? (
                    <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{error}</p>
                ) : (
                    <>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Online meeting</p>
                            <h1 className="mt-1 text-xl font-black">{info.meeting.title}</h1>
                            <p className="mt-1 text-sm text-zinc-400">With {info.meeting.hostName}{info.meeting.scheduledFor ? ` · ${niceDateTime(info.meeting.scheduledFor)}` : ''}</p>
                        </div>

                        {stage === 'ended' || !info.meeting.open ? (
                            <End icon={PhoneOff} title="This meeting has ended" text="Thank you for joining." />
                        ) : stage === 'refused' ? (
                            <End icon={XCircle} title="You were not let in" text="The host did not let you into this meeting. If you think this is a mistake, please contact them." />
                        ) : stage === 'removed' ? (
                            <End icon={XCircle} title="You were removed from the meeting" text="If you think this is a mistake, please contact the host." />
                        ) : stage === 'left' ? (
                            <div className="space-y-3 text-center">
                                <PhoneOff className="mx-auto h-8 w-8 text-zinc-500" />
                                <p className="text-sm font-bold">You left the call.</p>
                                {mine && (
                                    <button type="button" onClick={() => void enter(mine)} className="mx-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black hover:bg-indigo-500">
                                        <RotateCcw className="h-4 w-4" /> Rejoin
                                    </button>
                                )}
                            </div>
                        ) : stage === 'waiting' ? (
                            <div className="space-y-3 rounded-xl bg-white/5 p-4 text-center">
                                <Clock className="mx-auto h-7 w-7 animate-pulse text-indigo-300" />
                                <p className="text-sm font-bold">Please wait, someone will let you in.</p>
                                <p className="text-xs text-zinc-400">You asked to join as {mine?.name ?? name}. Keep this page open.</p>
                                {error && <p className="text-xs font-semibold text-red-300">{error}</p>}
                            </div>
                        ) : !info.ready ? (
                            <p className="rounded-xl bg-amber-500/10 px-3 py-3 text-sm text-amber-200">Video calls are not ready yet. Please tell the person who invited you.</p>
                        ) : (
                            <>
                                <label className="block">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Your name</span>
                                    <input value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="name" placeholder="As others should see it"
                                        className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-indigo-400" />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <Toggle on={micOn} onClick={() => setMicOn(v => !v)} on_={<Mic className="h-4 w-4" />} off_={<MicOff className="h-4 w-4" />} label={micOn ? 'Microphone on' : 'Microphone off'} />
                                    <Toggle on={camOn} onClick={() => setCamOn(v => !v)} on_={<Video className="h-4 w-4" />} off_={<VideoOff className="h-4 w-4" />} label={camOn ? 'Camera on' : 'Camera off'} />
                                </div>
                                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                                    <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-500" />
                                    <span className="text-sm text-zinc-200">
                                        <span className="flex items-center gap-1.5 font-bold"><ShieldCheck className="h-4 w-4 text-indigo-300" /> This call is recorded</span>
                                        <span className="mt-0.5 block text-xs text-zinc-400">The sound is recorded and turned into meeting notes, then deleted. The video is not recorded. By asking to join you agree to this.</span>
                                    </span>
                                </label>
                                {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{error}</p>}
                                <button type="button" onClick={() => void ask()} disabled={!consent || busy || name.trim().length < 2}
                                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black hover:bg-indigo-500 disabled:opacity-40">
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />} Ask to join
                                </button>
                            </>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}

function End({ icon: Icon, title, text }: { icon: typeof Clock; title: string; text: string }) {
    return (
        <div className="space-y-2 text-center">
            <Icon className="mx-auto h-8 w-8 text-zinc-500" />
            <p className="text-sm font-bold">{title}</p>
            <p className="text-xs text-zinc-400">{text}</p>
        </div>
    );
}

function Toggle({ on, onClick, on_, off_, label }: { on: boolean; onClick: () => void; on_: ReactNode; off_: ReactNode; label: string }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={on}
            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold ${on ? 'border-white/15 bg-white/10 text-white' : 'border-red-400/30 bg-red-500/10 text-red-200'}`}>
            {on ? on_ : off_} {label}
        </button>
    );
}
