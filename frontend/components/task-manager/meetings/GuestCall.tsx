'use client';

/**
 * Stage 2 (owner 2026-11-18) — the meeting's link /guest/<secret>. Owner 2026-11-18: this is now the ONE link for
 * everyone, like Google Meet: a signed-in team member who may join is shown the team's join screen (VideoCall, their
 * own name, no waiting); anyone else asks to join here and waits to be let in.
 *
 *   form     the meeting's name, host and time; their name; camera and microphone; "This call will be recorded"
 *            (a notice, no tick box; asking to join is sent to the server as the agreement it requires)
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
import VideoCall, { CallScreen } from './VideoCall';

interface Info { meeting: { title: string; hostName: string; scheduledFor: string | null; open: boolean }; ready: boolean; staffMeetingId: string | null }
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
            setInfo({ meeting: r.meeting, ready: r.ready, staffMeetingId: r.staffMeetingId ?? null });
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
        if (busy) return;
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

    // One link for everyone: a signed-in team member who may join gets the team's screen (own name, no waiting)
    if (info?.staffMeetingId && !mine) return <VideoCall meetingId={info.staffMeetingId} />;

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
        <main className="rf flex min-h-screen items-center justify-center px-4 py-10">
            <link rel="stylesheet" href="/apply/assets/recruitment-forms.css" precedence="recruitment" />
            <div className="rf-card rf-hero w-full max-w-lg space-y-5">
                {stage === 'gone' ? (
                    <End icon={XCircle} title="This link does not work" text="The link is not valid. Please ask the person who invited you for a new one." />
                ) : !info && !error ? (
                    <p className="flex items-center gap-2 text-sm text-stone-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading the meeting…</p>
                ) : !info ? (
                    <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>
                ) : (
                    <>
                        <div>
                            <p className="rf-kicker">Online meeting</p>
                            <h1 className="mt-1 text-xl font-black">{info.meeting.title}</h1>
                            <p className="mt-1 text-sm text-stone-600">With {info.meeting.hostName}{info.meeting.scheduledFor ? ` · ${niceDateTime(info.meeting.scheduledFor)}` : ''}</p>
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
                                    <button type="button" onClick={() => void enter(mine)} className="rf-primary">
                                        <RotateCcw className="h-4 w-4" /> Rejoin
                                    </button>
                                )}
                            </div>
                        ) : stage === 'waiting' ? (
                            <div className="space-y-3 rounded-xl bg-stone-100 p-4 text-center">
                                <Clock className="mx-auto h-7 w-7 animate-pulse text-[var(--accent)]" />
                                <p className="text-sm font-bold">Please wait, someone will let you in.</p>
                                <p className="text-xs text-stone-600">You asked to join as {mine?.name ?? name}. Keep this page open.</p>
                                {error && <p className="text-xs font-semibold text-red-800">{error}</p>}
                            </div>
                        ) : !info.ready ? (
                            <p className="rounded-xl bg-amber-500/10 px-3 py-3 text-sm text-amber-900">Video calls are not ready yet. Please tell the person who invited you.</p>
                        ) : (
                            <>
                                <label className="block">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-stone-600">Your name</span>
                                    <input value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="name" placeholder="As others should see it"
                                        className="mt-1.5 w-full rounded-xl border border-stone-300 px-3.5 py-2.5" />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <Toggle on={micOn} onClick={() => setMicOn(v => !v)} on_={<Mic className="h-4 w-4" />} off_={<MicOff className="h-4 w-4" />} label={micOn ? 'Microphone on' : 'Microphone off'} />
                                    <Toggle on={camOn} onClick={() => setCamOn(v => !v)} on_={<Video className="h-4 w-4" />} off_={<VideoOff className="h-4 w-4" />} label={camOn ? 'Camera on' : 'Camera off'} />
                                </div>
                                {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>}
                                <button type="button" onClick={() => void ask()} disabled={busy || name.trim().length < 2}
                                    className="rf-primary w-full">
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />} Ask to join
                                </button>
                                {/* Owner 2026-11-18: a notice, no tick box */}
                                <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-stone-600"><ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)]" /> This call will be recorded</p>
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
            <p className="text-xs text-stone-600">{text}</p>
        </div>
    );
}

function Toggle({ on, onClick, on_, off_, label }: { on: boolean; onClick: () => void; on_: ReactNode; off_: ReactNode; label: string }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={on}
            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold ${on ? 'border-[var(--accent)] bg-[var(--selection)] text-[var(--accent-dark)]' : 'border-stone-300 bg-white text-stone-600'}`}>
            {on ? on_ : off_} {label}
        </button>
    );
}
