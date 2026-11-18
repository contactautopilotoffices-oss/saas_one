'use client';

/**
 * Owner 2026-11-18 — the Meeting Assistant's online meeting: the page behind the link /meet/<id>.
 *
 *   lobby  the meeting's name, host and time; camera and microphone choice; the recording notice, which must be
 *          agreed to before joining (the server refuses a join token without it). Only the sound is recorded.
 *   call   a grid of everyone's camera (a name tile when the camera is off); a shared screen takes the stage with
 *          the cameras in a strip beside it. Controls: microphone, camera, share screen, leave, and for the host
 *          "End for everyone". A "Recording" mark shows the call is being recorded, or a warning when it is not.
 *   left   what happens next: the notes are made by themselves after the call
 *
 * Stage 2 (owner 2026-11-18): inside the call the team sees the guest link and the people waiting to be let in
 * (GuestPanel), checked every few seconds. Guests have their own page (GuestCall.tsx) and reuse CallScreen below.
 *
 * Video runs through hosted LiveKit. The page only gets a token from FMS (/api/task-manager/meetings/<id>/join);
 * the recording is started by the server once someone is connected. Built from @livekit/components-react hooks with
 * our own styling (the LiveKit style sheet package is not installed).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { LiveKitRoom, RoomAudioRenderer, StartAudio, VideoTrack, isTrackReference, useIsSpeaking, useLocalParticipant, useParticipants, useRoomContext, useTracks, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Track, type Participant } from 'livekit-client';
import { AlertTriangle, ChevronDown, Loader2, Mic, MicOff, MonitorUp, PhoneOff, RotateCcw, ShieldCheck, UserPlus, Users, Video, VideoOff } from 'lucide-react';
import { call, niceDateTime, type GuestsView } from './api';
import GuestPanel from './GuestPanel';

interface Info {
    meeting: {
        id: string; title: string; status: string; scheduledFor: string | null; confidential: boolean; hostName: string;
        isHost: boolean; open: boolean; startedAt: string | null; problem: string | null;
    };
    setup: string[];
    /** Stage 2: the guest link and the people who asked to join through it */
    guests?: GuestsView;
}
type Conn = { url: string; token: string };
type Stage = 'lobby' | 'connecting' | 'call' | 'left';

const joinUrl = (id: string) => `/api/task-manager/meetings/${encodeURIComponent(id)}/join`;

export default function VideoCall({ meetingId }: { meetingId: string }) {
    const [info, setInfo] = useState<Info | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [stage, setStage] = useState<Stage>('lobby');
    const [conn, setConn] = useState<Conn | null>(null);
    const [consent, setConsent] = useState(false);
    const [camOn, setCamOn] = useState(true);
    const [micOn, setMicOn] = useState(true);
    const [busy, setBusy] = useState(false);
    /** null = recording (or not known yet); a sentence = the call is NOT being recorded */
    const [recordingProblem, setRecordingProblem] = useState<string | null>(null);
    const [endedByHost, setEndedByHost] = useState(false);

    /** The meeting's name, host, time and whether it is open. `reloads` goes up to ask again (after leaving). */
    const [reloads, setReloads] = useState(0);
    const loadInfo = () => setReloads(n => n + 1);
    useEffect(() => {
        let live = true;
        void call<Info>(joinUrl(meetingId)).then(r => {
            if (!live) return;
            if (!r.ok) { setError(r.error); return; }
            setError(null);
            setInfo({ meeting: r.meeting, setup: r.setup });
        });
        return () => { live = false; };
    }, [meetingId, reloads]);

    const join = async () => {
        if (!consent || busy) return;
        setBusy(true);
        setError(null);
        const r = await call<Conn>(joinUrl(meetingId), { action: 'token', consent: true });
        setBusy(false);
        if (!r.ok) { setError(r.error); return; }
        setConn({ url: r.url, token: r.token });
        setStage('connecting');
    };

    /** Connected: tell the server, which marks the meeting live and starts (or restarts) the recording. */
    const announce = useCallback(async () => {
        const r = await call<{ recording: boolean; problem: string | null }>(joinUrl(meetingId), { action: 'joined' }, { timeoutMs: 45_000 });
        if (!r.ok) { setRecordingProblem(r.error); return; }
        setRecordingProblem(r.problem);
    }, [meetingId]);

    const endForEveryone = async () => {
        if (!window.confirm('End the call for everyone? The notes are made from the recording.')) return;
        const r = await call(joinUrl(meetingId), { action: 'end' });
        if (!r.ok) { window.alert(r.error); return; }
        setEndedByHost(true);
        setStage('left');
        setConn(null);
    };

    if (stage === 'call' || stage === 'connecting') {
        return (
            <LiveKitRoom serverUrl={conn?.url} token={conn?.token} connect audio={micOn} video={camOn}
                options={{ adaptiveStream: true, dynacast: true }}
                onConnected={() => { setStage('call'); void announce(); }}
                onDisconnected={() => { setStage('left'); setConn(null); }}
                onError={e => setError(e.message)}
                className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white">
                <CallScreen title={info?.meeting.title ?? 'Meeting'} connecting={stage === 'connecting'} isHost={!!info?.meeting.isHost}
                    recordingProblem={recordingProblem} onRetryRecording={() => void announce()} onEnd={() => void endForEveryone()}
                    extra={<StaffGuests meetingId={meetingId} />} />
                <RoomAudioRenderer />
            </LiveKitRoom>
        );
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10 text-white">
            <div className="w-full max-w-md space-y-5 rounded-3xl border border-white/10 bg-zinc-900 p-6 shadow-xl">
                {!info && !error && <p className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading the meeting…</p>}
                {!info && error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{error}</p>}

                {info && stage === 'left' && (
                    <div className="space-y-3 text-center">
                        <PhoneOff className="mx-auto h-8 w-8 text-zinc-500" />
                        <h1 className="text-lg font-black">{endedByHost ? 'You ended the call' : 'You left the call'}</h1>
                        <p className="text-sm text-zinc-400">The notes and the task list are made from the recording after the call. You will find them in the Meeting Assistant.</p>
                        <div className="flex flex-wrap justify-center gap-2 pt-2">
                            {!endedByHost && (
                                <button type="button" onClick={() => { setStage('lobby'); void loadInfo(); }} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black hover:bg-indigo-500">
                                    <RotateCcw className="h-4 w-4" /> Rejoin
                                </button>
                            )}
                            <Link href="/" className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-zinc-200 hover:bg-white/5">Go to the app</Link>
                        </div>
                    </div>
                )}

                {info && stage === 'lobby' && (
                    <>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Online meeting</p>
                            <h1 className="mt-1 text-xl font-black">{info.meeting.title}</h1>
                            <p className="mt-1 text-sm text-zinc-400">
                                Set up by {info.meeting.hostName}{info.meeting.scheduledFor ? ` · ${niceDateTime(info.meeting.scheduledFor)}` : ''}
                            </p>
                        </div>

                        {!info.meeting.open ? (
                            <p className="rounded-xl bg-white/5 px-3 py-3 text-sm font-semibold text-zinc-300">This meeting has ended. Its notes are in the Meeting Assistant.</p>
                        ) : info.setup.length > 0 ? (
                            <div className="space-y-1 rounded-xl bg-amber-500/10 px-3 py-3 text-sm text-amber-200">
                                <p className="font-bold">Video calls are not set up yet.</p>
                                {info.setup.map(g => <p key={g} className="text-xs">{g}</p>)}
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-2">
                                    <Toggle on={micOn} onClick={() => setMicOn(v => !v)} onIcon={Mic} offIcon={MicOff} label={micOn ? 'Microphone on' : 'Microphone off'} />
                                    <Toggle on={camOn} onClick={() => setCamOn(v => !v)} onIcon={Video} offIcon={VideoOff} label={camOn ? 'Camera on' : 'Camera off'} />
                                </div>
                                {/* Owner 2026-11-18: everyone agrees to the recording before joining (the server checks it too) */}
                                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                                    <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-500" />
                                    <span className="text-sm text-zinc-200">
                                        <span className="flex items-center gap-1.5 font-bold"><ShieldCheck className="h-4 w-4 text-indigo-300" /> This call is recorded</span>
                                        <span className="mt-0.5 block text-xs text-zinc-400">The sound is recorded and turned into notes and tasks, then deleted. The video is not recorded. By joining you agree to this.</span>
                                    </span>
                                </label>
                                {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{error}</p>}
                                <button type="button" onClick={() => void join()} disabled={!consent || busy}
                                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black hover:bg-indigo-500 disabled:opacity-40">
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />} Join now
                                </button>
                            </>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}

function Toggle({ on, onClick, onIcon: OnIcon, offIcon: OffIcon, label }: { on: boolean; onClick: () => void; onIcon: typeof Mic; offIcon: typeof Mic; label: string }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={on}
            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold ${on ? 'border-white/15 bg-white/10 text-white' : 'border-red-400/30 bg-red-500/10 text-red-200'}`}>
            {on ? <OnIcon className="h-4 w-4" /> : <OffIcon className="h-4 w-4" />} {label}
        </button>
    );
}

// ── inside the call ─────────────────────────────────────────────────────────

/**
 * Stage 2: the guest link and the waiting list inside the call, for the team. Asks the server every few seconds;
 * opens by itself when someone is waiting.
 */
function StaffGuests({ meetingId }: { meetingId: string }) {
    const [guests, setGuests] = useState<GuestsView | null>(null);
    const [open, setOpen] = useState(false);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let live = true;
        void call<Info>(joinUrl(meetingId)).then(r => { if (live && r.ok && r.guests) setGuests(r.guests); });
        const t = setTimeout(() => setTick(n => n + 1), 4_000);
        return () => { live = false; clearTimeout(t); };
    }, [meetingId, tick]);
    if (!guests) return null;
    const waiting = guests.list.filter(g => g.state === 'waiting').length;
    if (!guests.path && !guests.canManageLink && !waiting) return null;
    const shown = open || waiting > 0;
    return (
        <div className="px-4 pt-2">
            <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={shown}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-black ${waiting ? 'bg-amber-500/20 text-amber-100' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}>
                <UserPlus className="h-3.5 w-3.5" /> {waiting ? `${waiting} waiting to join` : 'Guests'}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${shown ? 'rotate-180' : ''}`} />
            </button>
            {shown && (
                <div className="mt-2 max-w-xl">
                    <GuestPanel dark guests={guests} onAction={async body => {
                        const r = await call(joinUrl(meetingId), body);
                        if (!r.ok) return r.error;
                        setTick(n => n + 1);
                        return null;
                    }} />
                </div>
            )}
        </div>
    );
}

/**
 * The call itself, shared by the team's page and (stage 2) the guest page. `extra` is shown under the header (the
 * team's guest panel); the retry and End buttons appear only when their handlers are given.
 */
export function CallScreen({ title, connecting, isHost, recordingProblem, onRetryRecording, onEnd, extra }: {
    title: string; connecting: boolean; isHost: boolean; recordingProblem: string | null;
    onRetryRecording?: () => void; onEnd?: () => void; extra?: ReactNode;
}) {
    const room = useRoomContext();
    const participants = useParticipants();
    const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
    const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false });
    const screens = tracks.filter(t => t.source === Track.Source.ScreenShare && isTrackReference(t));
    const cameras = tracks.filter(t => t.source === Track.Source.Camera);
    const [deviceError, setDeviceError] = useState<string | null>(null);
    const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;

    const toggle = async (what: 'mic' | 'cam' | 'screen') => {
        setDeviceError(null);
        try {
            if (what === 'mic') await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
            else if (what === 'cam') await localParticipant.setCameraEnabled(!isCameraEnabled);
            else await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
        } catch (e) {
            const name = e instanceof Error ? e.name : '';
            if (what === 'screen' && name === 'NotAllowedError') return; // the person closed the share picker
            setDeviceError(name === 'NotAllowedError' ? 'The browser blocked the camera or microphone. Allow it in the address bar, then try again.' : 'That did not work. Please try again.');
        }
    };

    return (
        <>
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-sm font-black">{title}</h1>
                    <p className="flex items-center gap-1.5 text-xs text-zinc-400"><Users className="h-3 w-3" /> {participants.length} in the call</p>
                </div>
                {connecting ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…</span>
                ) : recordingProblem ? (
                    <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-black text-amber-200"><AlertTriangle className="h-3.5 w-3.5" /> Not recorded</span>
                ) : (
                    <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-black text-red-200"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden /> Recording</span>
                )}
            </header>

            {recordingProblem && !connecting && (
                <div className="flex flex-wrap items-center gap-2 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200">
                    <span className="min-w-0 flex-1">{recordingProblem}</span>
                    {onRetryRecording && <button type="button" onClick={onRetryRecording} className="flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 font-black hover:bg-amber-500/30"><RotateCcw className="h-3 w-3" /> Try again</button>}
                </div>
            )}
            {!connecting && extra}

            <section className="min-h-0 flex-1 p-3">
                {screens.length > 0 ? (
                    <div className="flex h-full flex-col gap-3 lg:flex-row">
                        <div className="min-h-0 flex-1"><Tile trackRef={screens[0]} contain /></div>
                        <div className="flex shrink-0 gap-3 overflow-x-auto lg:w-60 lg:flex-col lg:overflow-y-auto">
                            {cameras.map(t => <div key={tileKey(t)} className="aspect-video w-44 shrink-0 lg:w-full"><Tile trackRef={t} /></div>)}
                        </div>
                    </div>
                ) : (
                    <div className={`grid h-full auto-rows-fr gap-3 ${gridCols(cameras.length)}`}>
                        {cameras.map(t => <Tile key={tileKey(t)} trackRef={t} />)}
                    </div>
                )}
            </section>

            {deviceError && <p className="px-4 pb-2 text-center text-xs font-semibold text-amber-200">{deviceError}</p>}
            <StartAudio label="Tap to turn on sound" className="mx-auto mb-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black" />

            <footer className="flex items-center justify-center gap-2 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <RoundButton active={isMicrophoneEnabled} onClick={() => void toggle('mic')} label={isMicrophoneEnabled ? 'Mute' : 'Unmute'}>
                    {isMicrophoneEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                </RoundButton>
                <RoundButton active={isCameraEnabled} onClick={() => void toggle('cam')} label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}>
                    {isCameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                </RoundButton>
                {canShare && (
                    <RoundButton active={!isScreenShareEnabled} highlight={isScreenShareEnabled} onClick={() => void toggle('screen')} label={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}>
                        <MonitorUp className="h-5 w-5" />
                    </RoundButton>
                )}
                <button type="button" onClick={() => void room.disconnect()} aria-label="Leave the call" title="Leave"
                    className="flex h-12 items-center gap-2 rounded-full bg-red-600 px-5 text-sm font-black hover:bg-red-500">
                    <PhoneOff className="h-5 w-5" /> Leave
                </button>
                {isHost && onEnd && (
                    <button type="button" onClick={onEnd} className="hidden h-12 rounded-full border border-red-400/40 px-4 text-xs font-black text-red-200 hover:bg-red-500/10 sm:block">
                        End for everyone
                    </button>
                )}
            </footer>
            {isHost && onEnd && (
                <button type="button" onClick={onEnd} className="mx-auto mb-3 rounded-full border border-red-400/40 px-4 py-2 text-xs font-black text-red-200 hover:bg-red-500/10 sm:hidden">
                    End for everyone
                </button>
            )}
        </>
    );
}

const tileKey = (t: TrackReferenceOrPlaceholder) => `${t.participant.identity}:${t.source}`;

/** Columns for n camera tiles: one big, then two side by side, then a grid. */
function gridCols(n: number) {
    if (n <= 1) return 'grid-cols-1';
    if (n <= 4) return 'grid-cols-1 sm:grid-cols-2';
    if (n <= 9) return 'grid-cols-2 lg:grid-cols-3';
    return 'grid-cols-3 lg:grid-cols-4';
}

function Tile({ trackRef, contain = false }: { trackRef: TrackReferenceOrPlaceholder; contain?: boolean }) {
    const p = trackRef.participant;
    const speaking = useIsSpeaking(p);
    const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
    const name = displayName(p);
    return (
        <div className={`relative h-full min-h-[120px] w-full overflow-hidden rounded-2xl bg-zinc-900 ring-2 transition-shadow ${speaking ? 'ring-emerald-400' : 'ring-transparent'}`}>
            {showVideo ? (
                <VideoTrack trackRef={trackRef} className={`h-full w-full ${contain ? 'object-contain' : 'object-cover'}`} />
            ) : (
                <div className="flex h-full w-full items-center justify-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600/30 text-xl font-black text-indigo-100">{initials(name)}</span>
                </div>
            )}
            <span className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1 truncate rounded-lg bg-black/60 px-2 py-0.5 text-xs font-bold">
                {!p.isMicrophoneEnabled && <MicOff className="h-3 w-3 shrink-0 text-red-300" aria-label="Muted" />}
                <span className="truncate">{name}{p.isLocal ? ' (you)' : ''}{trackRef.source === Track.Source.ScreenShare ? ' is sharing' : ''}</span>
            </span>
        </div>
    );
}

const displayName = (p: Participant) => p.name || p.identity || 'Someone';
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';

function RoundButton({ active, highlight = false, onClick, label, children }: { active: boolean; highlight?: boolean; onClick: () => void; label: string; children: ReactNode }) {
    const style = highlight ? 'bg-indigo-600 hover:bg-indigo-500' : active ? 'bg-white/10 hover:bg-white/20' : 'bg-red-500/20 text-red-200 hover:bg-red-500/30';
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label} className={`flex h-12 w-12 items-center justify-center rounded-full ${style}`}>
            {children}
        </button>
    );
}
