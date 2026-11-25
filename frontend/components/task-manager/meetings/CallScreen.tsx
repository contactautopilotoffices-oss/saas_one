'use client';

/**
 * Owner 2026-11-24 — the call itself, shaped like Google Meet. Shared by the team's page (VideoCall.tsx) and the
 * guest page (GuestCall.tsx); must be rendered inside <LiveKitRoom>.
 *
 *   stage    a grid of everyone. A shared screen, or any tile someone pins, takes the big view with the others in a
 *            strip beside it (the strip can be hidden). Every tile has Pin and Full screen; double-click = full screen.
 *   bar      left: the time and the meeting's name. Middle: microphone, camera, raise hand, reactions, share screen,
 *            more (full screen for the whole call, hide the strip, end for everyone), leave. Right: details, people, chat.
 *   panels   one side panel at a time: meeting details (with the link to copy), people (hands first), chat.
 *
 * Chat, raised hands and reactions go over LiveKit's data channel to the people in the call only. Nothing of it is
 * saved, and someone who joins later does not see earlier messages (as in Meet). Raised hands are sent again when
 * someone joins, so they see who is waiting to speak.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    StartAudio, VideoTrack, isTrackReference, useChat, useDataChannel, useIsSpeaking, useLocalParticipant,
    useParticipants, useRoomContext, useTracks, type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Track, type Participant } from 'livekit-client';
import {
    AlertTriangle, Check, Copy, Expand, Hand, Info, Loader2, Maximize, MessageSquare, Mic, MicOff, Minimize,
    MonitorUp, MoreVertical, PanelRightClose, PanelRightOpen, PhoneOff, Pin, PinOff, RotateCcw, Send, SmilePlus, Users,
    Video, VideoOff, X,
} from 'lucide-react';

type Panel = 'details' | 'people' | 'chat' | null;
type Reaction = { id: number; emoji: string; name: string };

const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉'];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function CallScreen({ title, connecting, isHost, recordingProblem, onRetryRecording, onEnd, extra, link }: {
    title: string; connecting: boolean; isHost: boolean; recordingProblem: string | null;
    onRetryRecording?: () => void; onEnd?: () => void; extra?: ReactNode;
    /** The meeting's link, shown in Details to copy (the team's page only) */
    link?: string;
}) {
    const room = useRoomContext();
    const participants = useParticipants();
    const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
    const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false });
    const [deviceError, setDeviceError] = useState<string | null>(null);
    const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;
    const rootRef = useRef<HTMLDivElement>(null);
    const isFull = useFullscreenElement();

    const [panel, setPanel] = useState<Panel>(null);
    const [pinned, setPinned] = useState<string | null>(null);
    const [stripHidden, setStripHidden] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [reactOpen, setReactOpen] = useState(false);

    // ── chat (kept here so messages arrive while the panel is closed) ──
    const { chatMessages, send: sendChat, isSending } = useChat();
    /** Messages read so far: updated when the chat panel opens or closes (while open, nothing is unread) */
    const [seenChat, setSeenChat] = useState(0);
    const unread = panel === 'chat' ? 0 : Math.max(0, chatMessages.length - seenChat);

    // ── raised hands ──
    const [hands, setHands] = useState<Record<string, boolean>>({});
    const myHand = !!hands[localParticipant.identity];
    const { send: sendHand } = useDataChannel('hand', msg => {
        const who = msg.from?.identity;
        if (!who) return;
        try { const { up } = JSON.parse(decoder.decode(msg.payload)) as { up: boolean }; setHands(h => ({ ...h, [who]: !!up })); } catch { /* not ours */ }
    });
    const shareHand = useCallback((up: boolean) => {
        void sendHand(encoder.encode(JSON.stringify({ up })), { reliable: true, topic: 'hand' }).catch(() => undefined);
    }, [sendHand]);
    const toggleHand = () => {
        const up = !myHand;
        setHands(h => ({ ...h, [localParticipant.identity]: up }));
        shareHand(up);
    };
    // Someone joined: tell them my hand is up
    const count = participants.length;
    const lastCount = useRef(count);
    useEffect(() => {
        if (count > lastCount.current && myHand) shareHand(true);
        lastCount.current = count;
    }, [count, myHand, shareHand]);

    // ── reactions ──
    const [reactions, setReactions] = useState<Reaction[]>([]);
    const nextReaction = useRef(0);
    const showReaction = useCallback((emoji: string, name: string) => {
        const id = nextReaction.current++;
        setReactions(r => [...r.slice(-11), { id, emoji, name }]);
        setTimeout(() => setReactions(r => r.filter(x => x.id !== id)), 3_500);
    }, []);
    const { send: sendReaction } = useDataChannel('reaction', msg => {
        try {
            const { emoji } = JSON.parse(decoder.decode(msg.payload)) as { emoji: string };
            if (REACTIONS.includes(emoji)) showReaction(emoji, msg.from ? displayName(msg.from) : 'Someone');
        } catch { /* not ours */ }
    });
    const react = (emoji: string) => {
        setReactOpen(false);
        showReaction(emoji, 'You');
        void sendReaction(encoder.encode(JSON.stringify({ emoji })), { reliable: false, topic: 'reaction' }).catch(() => undefined);
    };

    // ── what is on the big view ──
    const present = useMemo(() => new Set(participants.map(p => p.identity)), [participants]);
    const screens = tracks.filter(t => t.source === Track.Source.ScreenShare && isTrackReference(t));
    const pinnedRef = pinned ? tracks.find(t => tileKey(t) === pinned) : undefined;
    const focus = pinnedRef ?? screens[0];
    const others = focus ? tracks.filter(t => tileKey(t) !== tileKey(focus)) : tracks;
    const raised = (p: Participant) => !!hands[p.identity] && present.has(p.identity);
    const handCount = participants.filter(raised).length;

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
    const changePanel = (next: Panel) => {
        if (panel === 'chat' || next === 'chat') setSeenChat(chatMessages.length);
        setPanel(next);
    };
    const openPanel = (p: Exclude<Panel, null>) => changePanel(panel === p ? null : p);
    const tileProps = (t: TrackReferenceOrPlaceholder) => ({
        trackRef: t, hand: raised(t.participant), pinned: pinned === tileKey(t),
        onPin: () => setPinned(cur => (cur === tileKey(t) ? null : tileKey(t))),
    });

    return (
        <div ref={rootRef} className="flex h-full min-h-0 flex-1 flex-col bg-zinc-950 text-white">
            {/* top: the recording mark (and the name on phones) */}
            <header className="flex items-center gap-3 px-4 pt-3">
                <p className="min-w-0 flex-1 truncate text-sm font-bold text-white md:hidden">{title}</p>
                <span className="hidden flex-1 md:block" />
                {connecting ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…</span>
                ) : recordingProblem ? (
                    <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-black text-amber-200"><AlertTriangle className="h-3.5 w-3.5" /> Not recorded</span>
                ) : (
                    <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-black text-red-200"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden /> Recording</span>
                )}
            </header>

            {recordingProblem && !connecting && (
                <div className="mx-4 mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
                    <span className="min-w-0 flex-1">{recordingProblem}</span>
                    {onRetryRecording && <button type="button" onClick={onRetryRecording} className="flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 font-black hover:bg-amber-500/30"><RotateCcw className="h-3 w-3" /> Try again</button>}
                </div>
            )}
            {!connecting && extra}

            <div className="relative flex min-h-0 flex-1 gap-3 p-3">
                {/* the stage */}
                <section className="relative min-h-0 min-w-0 flex-1">
                    {focus ? (
                        <div className="flex h-full flex-col gap-3 lg:flex-row">
                            <div className="min-h-0 flex-1"><Tile {...tileProps(focus)} contain={focus.source === Track.Source.ScreenShare} big /></div>
                            {!stripHidden && others.length > 0 && (
                                <div className="flex shrink-0 gap-3 overflow-x-auto lg:w-60 lg:flex-col lg:overflow-y-auto">
                                    {others.map(t => <div key={tileKey(t)} className="aspect-video w-44 shrink-0 lg:w-full"><Tile {...tileProps(t)} /></div>)}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className={`grid h-full auto-rows-fr gap-3 ${gridCols(tracks.length)}`}>
                            {tracks.map(t => <Tile key={tileKey(t)} {...tileProps(t)} />)}
                        </div>
                    )}

                    {/* reactions float up from the bottom left */}
                    <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col-reverse gap-1" aria-live="polite">
                        <AnimatePresence>
                            {reactions.map(r => (
                                <motion.div key={r.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -40 }} transition={{ duration: 0.35 }}
                                    className="flex items-center gap-1.5 rounded-full bg-black/60 py-1 pl-1.5 pr-3 text-xs font-bold">
                                    <span className="text-2xl leading-none" aria-hidden>{r.emoji}</span> {r.name}
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </section>

                {/* the side panel (over the stage on phones) */}
                {panel && (
                    <aside className="absolute inset-3 z-10 flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-2xl md:static md:inset-auto md:w-[340px] md:shrink-0">
                        <div className="flex items-center justify-between px-4 pb-2 pt-4">
                            <h2 className="text-base font-black text-zinc-900">{panel === 'details' ? 'Meeting details' : panel === 'people' ? 'People' : 'In-call messages'}</h2>
                            <button type="button" onClick={() => changePanel(null)} aria-label="Close panel" className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
                        </div>
                        {panel === 'details' && <DetailsPanel title={title} link={link} />}
                        {panel === 'people' && <PeoplePanel participants={participants} raised={raised} />}
                        {panel === 'chat' && <ChatPanel messages={chatMessages} send={sendChat} isSending={isSending} />}
                    </aside>
                )}
            </div>

            {deviceError && <p className="px-4 pb-2 text-center text-xs font-semibold text-amber-200">{deviceError}</p>}
            <StartAudio label="Tap to turn on sound" className="mx-auto mb-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black" />

            {/* the bar */}
            <footer className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:grid-cols-[1fr_auto_1fr] md:px-5">
                <Clock title={title} />
                <div className="relative flex items-center justify-center gap-2">
                    <RoundButton active={isMicrophoneEnabled} onClick={() => void toggle('mic')} label={isMicrophoneEnabled ? 'Turn off microphone' : 'Turn on microphone'}>
                        {isMicrophoneEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                    </RoundButton>
                    <RoundButton active={isCameraEnabled} onClick={() => void toggle('cam')} label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}>
                        {isCameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                    </RoundButton>
                    <RoundButton active highlight={myHand} onClick={toggleHand} label={myHand ? 'Lower hand' : 'Raise hand'} className="hidden sm:flex">
                        <Hand className="h-5 w-5" />
                    </RoundButton>
                    <div className="relative hidden sm:block">
                        <RoundButton active highlight={reactOpen} onClick={() => { setReactOpen(v => !v); setMoreOpen(false); }} label="Send a reaction">
                            <SmilePlus className="h-5 w-5" />
                        </RoundButton>
                        {reactOpen && <ReactionPicker onPick={react} />}
                    </div>
                    {canShare && (
                        <RoundButton active highlight={isScreenShareEnabled} onClick={() => void toggle('screen')} label={isScreenShareEnabled ? 'Stop presenting' : 'Present now'} className="hidden sm:flex">
                            <MonitorUp className="h-5 w-5" />
                        </RoundButton>
                    )}
                    <div className="relative">
                        <RoundButton active highlight={moreOpen} onClick={() => { setMoreOpen(v => !v); setReactOpen(false); }} label="More options">
                            <MoreVertical className="h-5 w-5" />
                        </RoundButton>
                        {moreOpen && (
                            <Menu onClose={() => setMoreOpen(false)}>
                                <MenuItem className="sm:hidden" onClick={toggleHand} icon={Hand}>{myHand ? 'Lower hand' : 'Raise hand'}</MenuItem>
                                {canShare && <MenuItem className="sm:hidden" onClick={() => void toggle('screen')} icon={MonitorUp}>{isScreenShareEnabled ? 'Stop presenting' : 'Present now'}</MenuItem>}
                                <div className="flex justify-between gap-1 px-3 py-2 sm:hidden">
                                    {REACTIONS.map(e => <button key={e} type="button" onClick={() => { setMoreOpen(false); react(e); }} aria-label={`React ${e}`} className="rounded-full p-1 text-xl hover:bg-zinc-100">{e}</button>)}
                                </div>
                                <MenuItem onClick={() => toggleFullscreen(rootRef.current)} icon={isFull ? Minimize : Maximize}>{isFull ? 'Exit full screen' : 'Full screen'}</MenuItem>
                                {focus && <MenuItem onClick={() => setStripHidden(v => !v)} icon={stripHidden ? PanelRightOpen : PanelRightClose}>{stripHidden ? 'Show people beside' : 'Hide people beside'}</MenuItem>}
                                <MenuItem className="md:hidden" onClick={() => openPanel('details')} icon={Info}>Meeting details</MenuItem>
                                {isHost && onEnd && <MenuItem danger onClick={onEnd} icon={PhoneOff}>End call for everyone</MenuItem>}
                            </Menu>
                        )}
                    </div>
                    <button type="button" onClick={() => void room.disconnect()} aria-label="Leave call" title="Leave call"
                        className="flex h-12 w-16 items-center justify-center rounded-full bg-red-600 hover:bg-red-500">
                        <PhoneOff className="h-5 w-5" />
                    </button>
                </div>
                <div className="col-span-2 flex items-center justify-center gap-1 md:col-span-1 md:justify-end">
                    <PanelButton label="Meeting details" active={panel === 'details'} onClick={() => openPanel('details')} className="hidden md:flex"><Info className="h-5 w-5" /></PanelButton>
                    <PanelButton label="People" active={panel === 'people'} onClick={() => openPanel('people')} badge={handCount > 0 ? `✋${handCount}` : String(participants.length)}><Users className="h-5 w-5" /></PanelButton>
                    <PanelButton label="Chat with everyone" active={panel === 'chat'} onClick={() => openPanel('chat')} dot={unread > 0}><MessageSquare className="h-5 w-5" /></PanelButton>
                    {isHost && onEnd && (
                        <button type="button" onClick={onEnd} className="ml-1 hidden h-10 rounded-full border border-red-400/40 px-3 text-xs font-black text-red-200 hover:bg-red-500/10 lg:block">
                            End for everyone
                        </button>
                    )}
                </div>
            </footer>
        </div>
    );
}

// ── the bar ─────────────────────────────────────────────────────────────────

/** The time and the meeting's name, like Meet's bottom left */
function Clock({ title }: { title: string }) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
    return (
        <p className="hidden min-w-0 items-center gap-3 text-sm font-semibold text-white md:flex">
            <span className="tabular-nums">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="h-4 w-px bg-white/30" aria-hidden />
            <span className="truncate">{title}</span>
        </p>
    );
}

function RoundButton({ active, highlight = false, onClick, label, children, className = '' }: {
    active: boolean; highlight?: boolean; onClick: () => void; label: string; children: ReactNode; className?: string;
}) {
    const style = highlight ? 'bg-indigo-300 text-zinc-900 hover:bg-indigo-200' : active ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-red-600 hover:bg-red-500';
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={highlight || undefined}
            className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${style} ${className}`}>
            {children}
        </button>
    );
}

function PanelButton({ label, active, onClick, children, badge, dot, className = '' }: {
    label: string; active: boolean; onClick: () => void; children: ReactNode; badge?: string; dot?: boolean; className?: string;
}) {
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active}
            className={`relative flex h-11 w-11 items-center justify-center rounded-full transition-colors ${active ? 'bg-indigo-300 text-zinc-900' : 'text-white hover:bg-white/10'} ${className}`}>
            {children}
            {badge && <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-zinc-600 px-1 text-[10px] font-black leading-[18px] text-white">{badge}</span>}
            {dot && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-indigo-400 ring-2 ring-zinc-950" aria-label="New messages" />}
        </button>
    );
}

function Menu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        // Wait a tick so the click that opened the menu does not close it
        const t = setTimeout(() => document.addEventListener('mousedown', away));
        document.addEventListener('keydown', esc);
        return () => { clearTimeout(t); document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
    }, [onClose]);
    return (
        <div ref={ref} role="menu" className="absolute bottom-14 left-1/2 z-20 w-60 -translate-x-1/2 overflow-hidden rounded-xl bg-white py-1 text-zinc-900 shadow-2xl">
            {children}
        </div>
    );
}

function MenuItem({ onClick, icon: Icon, children, danger = false, className = '' }: {
    onClick: () => void; icon: typeof Mic; children: ReactNode; danger?: boolean; className?: string;
}) {
    return (
        <button type="button" role="menuitem" onClick={onClick}
            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold hover:bg-zinc-100 ${danger ? 'text-red-600' : 'text-zinc-800'} ${className}`}>
            <Icon className="h-4 w-4 shrink-0" /> {children}
        </button>
    );
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
    return (
        <div className="absolute bottom-14 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-full bg-zinc-800 px-2 py-1.5 shadow-2xl">
            {REACTIONS.map(e => (
                <button key={e} type="button" onClick={() => onPick(e)} aria-label={`React ${e}`} className="rounded-full p-1.5 text-2xl leading-none transition-transform hover:scale-125 hover:bg-white/10">{e}</button>
            ))}
        </div>
    );
}

// ── panels ──────────────────────────────────────────────────────────────────

function DetailsPanel({ title, link }: { title: string; link?: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        if (!link) return;
        try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2_000); } catch { /* the link stays selectable */ }
    };
    return (
        <div className="space-y-4 overflow-y-auto px-4 pb-4 text-sm">
            <p className="font-bold text-zinc-900">{title}</p>
            {link && (
                <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Joining info</p>
                    <p className="break-all rounded-lg bg-zinc-100 px-3 py-2 text-zinc-700 select-all">{link}</p>
                    <button type="button" onClick={() => void copy()} className="flex items-center gap-2 rounded-lg px-2 py-1.5 font-bold text-indigo-700 hover:bg-indigo-50">
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy joining info'}
                    </button>
                    <p className="text-xs text-zinc-500">Team members open this link. People without a login use the guest link instead.</p>
                </div>
            )}
            <p className="text-xs text-zinc-500">Only the sound is recorded. The notes are made from it after the call.</p>
        </div>
    );
}

function PeoplePanel({ participants, raised }: { participants: Participant[]; raised: (p: Participant) => boolean }) {
    const sorted = [...participants].sort((a, b) => Number(raised(b)) - Number(raised(a)) || Number(b.isLocal) - Number(a.isLocal));
    const hands = sorted.filter(raised).length;
    return (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            <p className="px-2 pb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">In the call · {participants.length}{hands ? ` · ${hands} raised hand${hands === 1 ? '' : 's'}` : ''}</p>
            <ul>
                {sorted.map(p => (
                    <li key={p.identity} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-zinc-50">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-black text-white">{initials(displayName(p))}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">{displayName(p)}{p.isLocal ? ' (You)' : ''}</span>
                        {raised(p) && <Hand className="h-4 w-4 text-amber-500" aria-label="Hand raised" />}
                        {p.isCameraEnabled ? <Video className="h-4 w-4 text-zinc-400" aria-label="Camera on" /> : <VideoOff className="h-4 w-4 text-zinc-400" aria-label="Camera off" />}
                        {p.isMicrophoneEnabled ? <Mic className="h-4 w-4 text-zinc-400" aria-label="Microphone on" /> : <MicOff className="h-4 w-4 text-red-500" aria-label="Muted" />}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function ChatPanel({ messages, send, isSending }: {
    messages: ReturnType<typeof useChat>['chatMessages']; send: (text: string) => Promise<unknown>; isSending: boolean;
}) {
    const [draft, setDraft] = useState('');
    const [failed, setFailed] = useState(false);
    const end = useRef<HTMLDivElement>(null);
    useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const text = draft.trim();
        if (!text || isSending) return;
        setFailed(false);
        try { await send(text); setDraft(''); } catch { setFailed(true); }
    };
    return (
        <>
            <p className="mx-4 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600">Messages are seen only by people in the call and are deleted when the call ends.</p>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {messages.length === 0 && <p className="pt-6 text-center text-sm text-zinc-400">No messages yet</p>}
                {messages.map(m => (
                    <div key={m.id ?? m.timestamp}>
                        <p className="text-xs"><span className="font-black text-zinc-900">{m.from ? (m.from.isLocal ? 'You' : displayName(m.from)) : 'Someone'}</span> <span className="text-zinc-400">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></p>
                        <p className="whitespace-pre-wrap break-words text-sm text-zinc-800">{m.message}</p>
                    </div>
                ))}
                <div ref={end} />
            </div>
            {failed && <p className="px-4 text-xs font-semibold text-red-600">The message was not sent. Please try again.</p>}
            <form onSubmit={e => void submit(e)} className="m-3 flex items-center gap-2 rounded-full bg-zinc-100 py-1 pl-4 pr-1">
                <label htmlFor="call-chat-input" className="sr-only">Send a message</label>
                <input id="call-chat-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Send a message" maxLength={1000}
                    className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400" />
                <button type="submit" disabled={!draft.trim() || isSending} aria-label="Send message" className="flex h-9 w-9 items-center justify-center rounded-full text-indigo-700 hover:bg-indigo-100 disabled:text-zinc-300 disabled:hover:bg-transparent">
                    <Send className="h-4 w-4" />
                </button>
            </form>
        </>
    );
}

// ── tiles ───────────────────────────────────────────────────────────────────

const tileKey = (t: TrackReferenceOrPlaceholder) => `${t.participant.identity}:${t.source}`;

/** Columns for n tiles: one big, then two side by side, then a grid. */
function gridCols(n: number) {
    if (n <= 1) return 'grid-cols-1';
    if (n <= 4) return 'grid-cols-1 sm:grid-cols-2';
    if (n <= 9) return 'grid-cols-2 lg:grid-cols-3';
    return 'grid-cols-3 lg:grid-cols-4';
}

function Tile({ trackRef, contain = false, big = false, hand, pinned, onPin }: {
    trackRef: TrackReferenceOrPlaceholder; contain?: boolean; big?: boolean; hand: boolean; pinned: boolean; onPin: () => void;
}) {
    const p = trackRef.participant;
    const speaking = useIsSpeaking(p);
    // The tile element as state (not a ref), so it can be compared with the full-screen element while drawing
    const [node, setNode] = useState<HTMLDivElement | null>(null);
    const fullEl = useFullscreenElement();
    const isFull = node !== null && fullEl === node;
    const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
    const sharing = trackRef.source === Track.Source.ScreenShare;
    const name = displayName(p);
    return (
        <div ref={setNode} onDoubleClick={() => toggleFullscreen(node)}
            className={`group relative h-full min-h-[120px] w-full overflow-hidden rounded-2xl bg-zinc-800 ring-2 transition-shadow ${speaking && !sharing ? 'ring-indigo-400' : 'ring-transparent'}`}>
            {showVideo ? (
                <VideoTrack trackRef={trackRef} className={`h-full w-full ${contain || isFull ? 'object-contain' : 'object-cover'} ${p.isLocal && !sharing ? '-scale-x-100' : ''}`} />
            ) : (
                <div className="flex h-full w-full items-center justify-center">
                    <span className={`flex items-center justify-center rounded-full bg-indigo-600 font-black text-white ${big ? 'h-28 w-28 text-4xl' : 'h-16 w-16 text-xl'}`}>{initials(name)}</span>
                </div>
            )}
            {hand && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-xs font-black text-zinc-900"><Hand className="h-3.5 w-3.5" /> Hand raised</span>}
            {/* Pin and full screen, shown on hover (always on touch screens) */}
            <div className="absolute right-2 top-2 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                <TileButton label={pinned ? 'Unpin' : 'Pin to the big view'} onClick={onPin}>{pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</TileButton>
                <TileButton label={isFull ? 'Exit full screen' : 'Full screen'} onClick={() => toggleFullscreen(node)}>{isFull ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}</TileButton>
            </div>
            <span className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1 truncate rounded-lg bg-black/60 px-2 py-0.5 text-xs font-bold text-white">
                {!p.isMicrophoneEnabled && !sharing && <MicOff className="h-3 w-3 shrink-0 text-red-300" aria-label="Muted" />}
                {pinned && <Pin className="h-3 w-3 shrink-0" aria-label="Pinned" />}
                <span className="truncate">{sharing ? `${name}${p.isLocal ? ' (You)' : ''} is presenting` : `${name}${p.isLocal ? ' (You)' : ''}`}</span>
            </span>
        </div>
    );
}

function TileButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" onClick={e => { e.stopPropagation(); onClick(); }} onDoubleClick={e => e.stopPropagation()} aria-label={label} title={label}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
            {children}
        </button>
    );
}

// ── full screen ─────────────────────────────────────────────────────────────

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };

/** The element shown full screen now (re-renders when it changes) */
function useFullscreenElement(): Element | null {
    const [el, setEl] = useState<Element | null>(null);
    useEffect(() => {
        const d = document as FsDocument;
        const on = () => setEl(d.fullscreenElement ?? d.webkitFullscreenElement ?? null);
        document.addEventListener('fullscreenchange', on);
        document.addEventListener('webkitfullscreenchange', on);
        return () => { document.removeEventListener('fullscreenchange', on); document.removeEventListener('webkitfullscreenchange', on); };
    }, []);
    return el;
}

/** Full screen for this element, or back out of it. iPhones can only show a video full screen, so they get that. */
function toggleFullscreen(el: HTMLElement | null) {
    if (!el) return;
    const d = document as FsDocument;
    const current = d.fullscreenElement ?? d.webkitFullscreenElement;
    if (current === el) {
        if (d.exitFullscreen) void d.exitFullscreen().catch(() => undefined); else d.webkitExitFullscreen?.();
        return;
    }
    // Another element is full screen: asking for this one switches straight to it
    const target = el as FsElement;
    if (target.requestFullscreen) { void target.requestFullscreen().catch(() => undefined); return; }
    if (target.webkitRequestFullscreen) { target.webkitRequestFullscreen(); return; }
    const video = el.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    video?.webkitEnterFullscreen?.();
}

const displayName = (p: Participant) => p.name || p.identity || 'Someone';
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';
