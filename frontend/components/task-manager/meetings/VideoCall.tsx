'use client';

/**
 * Owner 2026-11-18 — the Meeting Assistant's online meeting: the page behind the link /meet/<id>.
 *
 *   lobby  the meeting's name, host and time; a live camera preview with microphone and camera buttons (owner
 *          2026-11-24: like Google Meet's "Ready to join?"); "This call will be recorded" under the Join button
 *          (owner 2026-11-18: a notice, no tick box). Only the sound is recorded. Joining after seeing the notice is
 *          sent to the server as the agreement it requires.
 *   call   CallScreen.tsx (owner 2026-11-24: shaped like Google Meet — pin, full screen, people, chat, raised hands,
 *          reactions). For the host also "End for everyone". A "Recording" mark shows the call is being recorded, or
 *          a warning when it is not.
 *   left   owner 2026-11-24: "You left the meeting", then the meeting's notes open by themselves (/meet/<id>/notes,
 *          the Meeting Assistant's notes screen) unless the person rejoins. Someone who cannot see that Meeting
 *          Assistant stays on this screen.
 *
 * Stage 2 (owner 2026-11-18): inside the call the team sees the guest link and the people waiting to be let in
 * (GuestPanel), checked every few seconds. Guests have their own page (GuestCall.tsx) and reuse CallScreen.
 *
 * Video runs through hosted LiveKit. The page only gets a token from FMS (/api/task-manager/meetings/<id>/join).
 * Owner 2026-11-19 (free LiveKit plan): the sound is recorded in a team member's browser (CallRecorder.tsx); the
 * server picks one, and another takes over if that person leaves. Built from @livekit/components-react hooks with
 * our own styling (the LiveKit style sheet package is not installed).
 *
 * Owner 2026-11-19: Recruitment opens the same call inside its own page (an interview's "Join call"); `onClose` then
 * gives the lobby and the "left" screen a way back, and `notesWhere` says where the notes will show. Then the notes
 * do not open by themselves.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { ArrowLeft, ChevronDown, FileText, Loader2, Mic, MicOff, PhoneOff, RotateCcw, ShieldCheck, UserPlus, Video, VideoOff } from 'lucide-react';
import { call, niceDateTime, type GuestsView, type MeetingSpace } from './api';
import GuestPanel from './GuestPanel';
import CallRecorder, { type CallRecordingState } from './CallRecorder';
import { CallScreen } from './CallScreen';

export { CallScreen };

interface Info {
    meeting: {
        id: string; title: string; status: string; scheduledFor: string | null; confidential: boolean; hostName: string;
        isHost: boolean; open: boolean; startedAt: string | null; problem: string | null;
        purpose?: 'interview' | null;
        space?: MeetingSpace;
        canSeeNotes?: boolean;
    };
    setup: string[];
    /** Stage 2: the guest link and the people who asked to join through it */
    guests?: GuestsView;
}
type Conn = { url: string; token: string };
type Stage = 'lobby' | 'connecting' | 'call' | 'left';

const joinUrl = (id: string) => `/api/task-manager/meetings/${encodeURIComponent(id)}/join`;
const notesPath = (id: string) => `/meet/${encodeURIComponent(id)}/notes`;
/** Seconds on "You left the meeting" before the notes open */
const NOTES_AFTER_S = 5;

type VideoCallProps = {
    meetingId: string;
    /** Opened inside another page (Recruitment): the way back to it. */
    onClose?: () => void;
    /** Where the notes will show, when not in the Meeting Assistant. */
    notesWhere?: string;
};

export default function VideoCall(props: VideoCallProps) {
    return <div data-meeting-surface><VideoCallContent {...props} /></div>;
}

function VideoCallContent({ meetingId, onClose, notesWhere }: VideoCallProps) {
    const router = useRouter();
    const [info, setInfo] = useState<Info | null>(null);
    const notesDestination = notesWhere ?? (info?.meeting.purpose === 'interview' ? 'in the candidate’s Interviews tab in Recruitment' : 'in the Meeting Assistant');
    const [error, setError] = useState<string | null>(null);
    const [stage, setStage] = useState<Stage>('lobby');
    const [conn, setConn] = useState<Conn | null>(null);
    const [camOn, setCamOn] = useState(true);
    const [micOn, setMicOn] = useState(true);
    const [busy, setBusy] = useState(false);
    /** Set when telling the server we joined did not work (then nothing records from this page) */
    const [joinProblem, setJoinProblem] = useState<string | null>(null);
    /** Owner 2026-11-19: the server knows we are in the call, so this page may record */
    const [announced, setAnnounced] = useState(false);
    const [recState, setRecState] = useState<CallRecordingState>('checking');
    const recordingProblem = joinProblem ?? (recState === 'off' ? 'This call is not being recorded right now, so this part will not be in the notes.' : null);
    const [endedByHost, setEndedByHost] = useState(false);
    /** Owner 2026-11-24: seconds left before the notes open after leaving (null = not counting) */
    const [notesIn, setNotesIn] = useState<number | null>(null);
    const notesOpen = !onClose && info?.meeting.canSeeNotes === true;

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

    // ── after leaving: count down, then open the notes ──
    const leaveCall = () => {
        setStage('left');
        setConn(null);
        setAnnounced(false);
        setNotesIn(notesOpen ? NOTES_AFTER_S : null);
    };
    useEffect(() => {
        if (notesIn === null) return;
        if (notesIn <= 0) { router.push(notesPath(meetingId)); return; }
        const t = setTimeout(() => setNotesIn(n => (n === null ? null : n - 1)), 1_000);
        return () => clearTimeout(t);
    }, [notesIn, meetingId, router]);

    const join = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        const r = await call<Conn>(joinUrl(meetingId), { action: 'token', consent: true });
        setBusy(false);
        if (!r.ok) { setError(r.error); return; }
        setConn({ url: r.url, token: r.token });
        setStage('connecting');
    };

    /** Connected: tell the server, which marks the meeting live. Then this page takes part in recording. */
    const announce = useCallback(async () => {
        const r = await call(joinUrl(meetingId), { action: 'joined' }, { timeoutMs: 45_000 });
        if (!r.ok) { setJoinProblem(r.error); return; }
        setJoinProblem(null);
        setAnnounced(true);
    }, [meetingId]);

    const endForEveryone = async () => {
        if (!window.confirm('End the call for everyone? The notes are made from the recording.')) return;
        const r = await call(joinUrl(meetingId), { action: 'end' });
        if (!r.ok) { window.alert(r.error); return; }
        setEndedByHost(true);
        leaveCall();
    };

    if (stage === 'call' || stage === 'connecting') {
        return (
            <LiveKitRoom serverUrl={conn?.url} token={conn?.token} connect audio={micOn} video={camOn}
                options={{ adaptiveStream: true, dynacast: true }}
                onConnected={() => { setStage('call'); void announce(); }}
                onDisconnected={() => { leaveCall(); setRecState('checking'); }}
                onError={e => setError(e.message)}
                className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white">
                <CallScreen title={info?.meeting.title ?? 'Meeting'} connecting={stage === 'connecting'} isHost={!!info?.meeting.isHost}
                    recordingProblem={recordingProblem} onRetryRecording={joinProblem ? () => void announce() : undefined} onEnd={() => void endForEveryone()}
                    extra={<StaffGuests meetingId={meetingId} />}
                    link={typeof window !== 'undefined' ? `${window.location.origin}/meet/${encodeURIComponent(meetingId)}` : undefined} />
                <RoomAudioRenderer />
                {announced && <CallRecorder meetingId={meetingId} endpoint={joinUrl(meetingId)} onState={setRecState} />}
            </LiveKitRoom>
        );
    }

    const ready = !!info && stage === 'lobby' && info.meeting.open && info.setup.length === 0;

    return (
        <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10 text-white">
            <div className={`w-full space-y-5 ${ready ? 'max-w-5xl' : 'max-w-md rounded-3xl border border-white/10 bg-zinc-900 p-6 shadow-xl'}`}>
                {onClose && stage !== 'left' && (
                    <button type="button" onClick={onClose} className="-mt-1 flex items-center gap-1.5 text-sm font-bold text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back</button>
                )}
                {!info && !error && <p className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading the meeting…</p>}
                {!info && error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{error}</p>}

                {info && stage === 'left' && (
                    <div className="space-y-3 text-center">
                        <PhoneOff className="mx-auto h-8 w-8 text-zinc-500" />
                        <h1 className="text-lg font-black text-white">{endedByHost ? 'You ended the call' : 'You left the meeting'}</h1>
                        <p className="text-sm text-zinc-400">
                            {notesIn !== null
                                ? `The notes are made from the recording. Opening the meeting's notes in ${notesIn}…`
                                : `The notes are made from the recording after the call. You will find them ${notesDestination}.`}
                        </p>
                        <div className="flex flex-wrap justify-center gap-2 pt-2">
                            {!endedByHost && (
                                <button type="button" onClick={() => { setNotesIn(null); setStage('lobby'); void loadInfo(); }} className="flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-black text-white hover:bg-white/5">
                                    <RotateCcw className="h-4 w-4" /> Rejoin
                                </button>
                            )}
                            {notesOpen && (
                                <Link href={notesPath(meetingId)} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-500">
                                    <FileText className="h-4 w-4" /> Open the notes
                                </Link>
                            )}
                            {onClose
                                ? <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-zinc-200 hover:bg-white/5">Back</button>
                                : !notesOpen && <Link href="/" className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-zinc-200 hover:bg-white/5">Go to the app</Link>}
                        </div>
                    </div>
                )}

                {info && stage === 'lobby' && !ready && (
                    <>
                        <LobbyHeading info={info} />
                        {!info.meeting.open ? (
                            <p className="rounded-xl bg-white/5 px-3 py-3 text-sm font-semibold text-zinc-300">This meeting has ended. Its notes are {notesDestination}.</p>
                        ) : (
                            <div className="space-y-1 rounded-xl bg-amber-500/10 px-3 py-3 text-sm text-amber-200">
                                <p className="font-bold">Video calls are not set up yet.</p>
                                {info.setup.map(g => <p key={g} className="text-xs">{g}</p>)}
                            </div>
                        )}
                        {!info.meeting.open && notesOpen && (
                            <Link href={notesPath(meetingId)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-500"><FileText className="h-4 w-4" /> Open the notes</Link>
                        )}
                    </>
                )}

                {ready && info && (
                    <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                        <Preview camOn={camOn} micOn={micOn} onMic={() => setMicOn(v => !v)} onCam={() => setCamOn(v => !v)} />
                        <div className="space-y-5 text-center md:text-left">
                            <LobbyHeading info={info} />
                            <p className="text-lg font-bold text-white">Ready to join?</p>
                            {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">{error}</p>}
                            <button type="button" onClick={() => void join()} disabled={busy}
                                className="flex w-full items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-500 disabled:opacity-40 md:w-auto md:px-8">
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />} Join now
                            </button>
                            {/* Owner 2026-11-18: a notice, no tick box */}
                            <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-zinc-400 md:justify-start"><ShieldCheck className="h-3.5 w-3.5 text-indigo-300" /> This call will be recorded</p>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}

function LobbyHeading({ info }: { info: Info }) {
    return (
        <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Online meeting</p>
            <h1 className="mt-1 text-2xl font-black text-white">{info.meeting.title}</h1>
            <p className="mt-1 text-sm text-zinc-400">
                Set up by {info.meeting.hostName}{info.meeting.scheduledFor ? ` · ${niceDateTime(info.meeting.scheduledFor)}` : ''}
            </p>
        </div>
    );
}

/**
 * Owner 2026-11-24: the lobby's camera preview, like Meet. Only a preview: the camera is let go before joining, and
 * the call opens it again. A blocked camera shows a note; joining still works.
 */
function Preview({ camOn, micOn, onMic, onCam }: { camOn: boolean; micOn: boolean; onMic: () => void; onCam: () => void }) {
    const video = useRef<HTMLVideoElement>(null);
    const [blocked, setBlocked] = useState(false);
    useEffect(() => {
        if (!camOn || !navigator.mediaDevices?.getUserMedia) return;
        let stream: MediaStream | null = null;
        let live = true;
        navigator.mediaDevices.getUserMedia({ video: true }).then(s => {
            if (!live) { s.getTracks().forEach(t => t.stop()); return; }
            stream = s;
            if (video.current) video.current.srcObject = s;
        }).catch(() => { if (live) setBlocked(true); });
        return () => { live = false; stream?.getTracks().forEach(t => t.stop()); };
    }, [camOn]);
    return (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-zinc-800">
            {camOn && !blocked && <video ref={video} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />}
            {(!camOn || blocked) && (
                <div className="flex h-full w-full items-center justify-center px-6 text-center">
                    <p className="text-lg font-semibold text-zinc-300">{blocked ? 'The camera is blocked. Allow it in the address bar to be seen.' : 'Camera is off'}</p>
                </div>
            )}
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
                <PreviewButton on={micOn} onClick={onMic} label={micOn ? 'Turn off microphone' : 'Turn on microphone'}>{micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}</PreviewButton>
                <PreviewButton on={camOn} onClick={() => { setBlocked(false); onCam(); }} label={camOn ? 'Turn off camera' : 'Turn on camera'}>{camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</PreviewButton>
            </div>
        </div>
    );
}

function PreviewButton({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={on}
            className={`flex h-12 w-12 items-center justify-center rounded-full border text-white transition-colors ${on ? 'border-white/60 bg-black/20 hover:bg-white/10' : 'border-transparent bg-red-600 hover:bg-red-500'}`}>
            {children}
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
    const inCall = guests.list.filter(g => g.state === 'admitted').length;
    if (!waiting && !inCall) return null;
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
