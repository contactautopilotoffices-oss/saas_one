'use client';

/**
 * MEETING ROOM — a Teams-shaped call screen: lobby → call → decision sheet.
 *
 * Audio runs through LiveKit; everything else on this page (agenda progress,
 * the transcript, Ira's notes) is read from FMS every few seconds, so what
 * people see is exactly what was saved. Ira is LISTEN-ONLY: she never speaks,
 * she transcribes everyone and writes down proposed decisions. After the
 * meeting the same page is the decision sheet: an approver confirms or rejects
 * each proposal. Confirming records agreement; acting on it in Zoho stays a
 * person's job.
 *
 * Visual language is the Agent Council call (AgentCall / AgentPresence) — see
 * MeetingRoomParts.tsx for the token provenance.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useParticipants } from '@livekit/components-react';
import {
    AlertTriangle, ArrowLeft, Captions, Loader2, Mic, MicOff, PanelRight, PhoneOff, ShieldAlert, X,
} from 'lucide-react';
import {
    AgendaList, Banner, CallButton, CaptionStrip, DecisionCard, ELEV_5, Elapsed, INK1, INK2, INK3, IRA_INK,
    IraAvatar, IraTile, LiveDot, NotesList, PersonTile, RuleCard, SheetMotion, Tabs, Transcript, WELL,
    type Decision, type Item, type Line,
} from './MeetingRoomParts';

interface Meeting {
    id: string; title: string; status: 'scheduled' | 'live' | 'ended'; agent_slug: string;
    host_name: string | null; started_at: string | null; ended_at: string | null; agent_joined_at: string | null;
}
interface Payload {
    meeting: Meeting; items: Item[]; decisions: Decision[]; lines: Line[];
    viewer: { can_host: boolean; name: string }; livekit_ready: boolean; setup: string[];
}

type PanelTab = 'agenda' | 'notes' | 'transcript';

/* The dashboard layout wraps pages in: a 56px mobile header (below lg) or a
   56px ContextBar (lg+), and <main> py-4 / lg:py-6. The room fills the rest. */
const FILL_H = 'h-[calc(100dvh-88px)] lg:h-[calc(100dvh-104px)] min-h-[540px]';
const FILL_MIN_H = 'min-h-[calc(100dvh-88px)] lg:min-h-[calc(100dvh-104px)]';

/* .council-page canvas recipe (primary 10% top-left, secondary 7% bottom-right),
   on the locked #FAFBFC canvas so the room is light in every theme, like the
   council's own surfaces. Shell radius: vercel rounded.xl 16. */
const SHELL: CSSProperties = {
    fontFamily: 'var(--font-body)',
    color: INK1,
    borderRadius: 16,
    boxShadow: 'var(--council-elev-2)',
    background:
        'radial-gradient(1100px 720px at 12% -12%, color-mix(in srgb, var(--primary) 10%, transparent), transparent 62%),' +
        'radial-gradient(900px 640px at 94% 106%, color-mix(in srgb, var(--secondary) 7%, transparent), transparent 58%),' +
        '#FAFBFC',
};

/** Red action with text on it: --council-p0-fill (white on it 5.21:1; raw --error is 3.76:1). */
const END_BTN: CSSProperties = {
    height: 34, borderRadius: 999, border: 'none', cursor: 'pointer', flex: 'none',
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
    color: '#fff', background: 'var(--council-p0-fill)',
    boxShadow: '0 6px 16px -6px rgba(239, 68, 68, 0.55)',
};

export default function MeetingRoom({ orgId, meetingId }: { orgId: string; meetingId: string }) {
    const [data, setData] = useState<Payload | null>(null);
    const [lines, setLines] = useState<Line[]>([]);
    const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const after = useRef(0);

    const load = useCallback(async () => {
        const res = await fetch(`/api/meetings/${meetingId}?after=${after.current}`, { cache: 'no-store' });
        const j = await res.json().catch(() => null);
        if (!res.ok) { setError(j?.error ?? `Could not load the meeting (HTTP ${res.status}).`); return; }
        const fresh: Line[] = j.lines ?? [];
        if (fresh.length) {
            after.current = fresh[fresh.length - 1].id;
            setLines((prev) => [...prev, ...fresh]);
        }
        setData(j);
    }, [meetingId]);

    useEffect(() => { void load(); }, [load]);
    const ended = data?.meeting.status === 'ended';
    useEffect(() => {
        if (ended) return;
        const t = setInterval(() => { void load(); }, 2500);
        return () => clearInterval(t);
    }, [load, ended]);

    const join = async () => {
        setBusy('join'); setError(null);
        try {
            const res = await fetch(`/api/meetings/${meetingId}/token`, { method: 'POST' });
            const j = await res.json().catch(() => null);
            if (!res.ok || !j?.token) { setError(j?.error ?? `Could not join (HTTP ${res.status}).`); return; }
            setConn({ url: j.url, token: j.token });
        } finally { setBusy(null); }
    };

    const patch = async (body: Record<string, string>, key: string) => {
        setBusy(key); setError(null);
        try {
            const res = await fetch(`/api/meetings/${meetingId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            const j = await res.json().catch(() => null);
            if (!res.ok) setError(j?.error ?? `That did not work (HTTP ${res.status}).`);
            if (body.action === 'end') setConn(null);
            await load();
        } finally { setBusy(null); }
    };

    // The newest decision per item that is still standing; corrections replace older ones.
    const byItem = useMemo(() => {
        const m = new Map<string, Decision>();
        for (const d of data?.decisions ?? []) {
            if (d.kind === 'item' && d.item_id && d.state !== 'superseded') m.set(d.item_id, d);
        }
        return m;
    }, [data?.decisions]);
    const rules = (data?.decisions ?? []).filter((d) => d.kind === 'rule' && d.state !== 'superseded');

    if (!data) {
        return (
            <div className={`flex items-center justify-center p-[24px] ${FILL_MIN_H}`} style={SHELL}>
                {error
                    ? <div className="max-w-md"><Banner tone="error">{error}</Banner></div>
                    : <div className="flex items-center gap-[8px] text-sm" style={{ color: INK2 }}><Loader2 className="h-4 w-4 animate-spin" /> Loading the meeting…</div>}
            </div>
        );
    }
    const { meeting, items, viewer } = data;
    const decided = items.filter((i) => i.status === 'discussed').length;
    const parked = items.filter((i) => i.status === 'parked').length;
    const iraPending = meeting.status === 'live' && !meeting.agent_joined_at;
    const review = (action: 'confirm' | 'reject', id: string) => void patch({ action, decision_id: id }, id);
    const endForAll = () => void patch({ action: 'end' }, 'end');

    const banners = (
        <>
            {error && <Banner tone="error">{error}</Banner>}
            {data.setup.length > 0 && !ended && (
                <Banner tone="setup">
                    <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" /><b>The meeting service is not set up yet.</b>
                    <ul className="mt-1 space-y-1">{data.setup.map((s) => <li key={s}>· {s}</li>)}</ul>
                </Banner>
            )}
        </>
    );

    /* ------------------------------------------------------------- ended */
    if (ended) {
        return (
            <DecisionSheet orgId={orgId} meeting={meeting} items={items} lines={lines} byItem={byItem} rules={rules}
                decided={decided} parked={parked} canHost={viewer.can_host} busy={busy} onReview={review} banners={banners} />
        );
    }

    /* ----------------------------------------------------------- in call */
    if (conn) {
        return (
            <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio video={false}
                onDisconnected={() => setConn(null)}
                onError={(e) => setError(`Meeting connection: ${e.message}`)}>
                <RoomAudioRenderer />
                <InCall orgId={orgId} meeting={meeting} items={items} lines={lines} byItem={byItem} rules={rules}
                    decided={decided} parked={parked} canHost={viewer.can_host} busy={busy} iraPending={iraPending}
                    onReview={review} onEnd={endForAll} onLeave={() => setConn(null)} banners={banners} />
            </LiveKitRoom>
        );
    }

    /* ------------------------------------------------------------- lobby */
    const statusLabel = meeting.status === 'live' ? 'Live now' : 'Not started';
    return (
        <div className={`flex items-center justify-center px-4 py-8 ${FILL_MIN_H}`} style={SHELL}>
            <div className="w-full max-w-[460px] p-[20px] sm:p-[24px]" style={{ borderRadius: 16, background: 'var(--council-surface-1)', boxShadow: 'var(--council-elev-4)' }}>
                <div className="flex items-center gap-[8px]">
                    <Link href={`/${orgId}/meetings`} aria-label="All meetings"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full"
                        style={{ color: INK2, boxShadow: 'var(--council-ring)' }}>
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <span className="flex items-center gap-1.5">
                        <LiveDot tone={meeting.status === 'live' ? 'live' : 'waiting'} />
                        <span className="council-eyebrow">{statusLabel}</span>
                    </span>
                </div>

                <div role="heading" aria-level={1} className="mt-4 [overflow-wrap:anywhere]" style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em', color: INK1 }}>
                    {meeting.title}
                </div>
                <p className="mt-1" style={{ fontSize: 12.5, color: INK2, fontVariantNumeric: 'tabular-nums' }}>
                    {meeting.host_name && <>Host {meeting.host_name} · </>}
                    {items.length} {items.length === 1 ? 'item' : 'items'} on the agenda
                    {meeting.status === 'live' && <> · {decided} decided · {parked} parked</>}
                </p>

                <div className="mt-4 flex items-center gap-[12px] rounded-[12px] px-3 py-2.5" style={WELL}>
                    <IraAvatar size={36} />
                    <div className="min-w-0">
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: INK1 }}>Ira · AI notetaker</div>
                        <div style={{ fontSize: 11.5, color: iraPending ? 'var(--council-p1-ink)' : IRA_INK }}>
                            {iraPending ? "Ira hasn't joined yet" : 'Listens and takes notes — never speaks'}
                        </div>
                    </div>
                </div>

                <p className="mt-3 flex items-start gap-[8px]" style={{ fontSize: 12.5, lineHeight: 1.55, color: INK2 }}>
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--council-p1-ink)' }} />
                    <span>
                        This meeting is <b style={{ color: INK1 }}>transcribed</b>. Ira listens and takes notes — she doesn&apos;t
                        speak. Decisions she writes down are only proposals until an approver confirms them.
                    </span>
                </p>

                {(error || data.setup.length > 0) && <div className="mt-3 space-y-2">{banners}</div>}

                <button type="button" onClick={() => void join()} disabled={busy === 'join' || !data.livekit_ready}
                    className="cc-btn mt-5 w-full disabled:pointer-events-none disabled:opacity-50"
                    style={{ height: 44, fontSize: 13 }}>
                    {busy === 'join' ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <Mic style={{ width: 15, height: 15 }} />}
                    Join meeting
                </button>
                <p className="mt-2 text-center" style={{ fontSize: 11.5, color: INK3 }}>
                    {data.livekit_ready ? 'Join from one device per room to avoid echo.' : 'Audio is not set up yet, so joining is off.'}
                </p>

                {viewer.can_host && (
                    <div className="mt-4 flex justify-center pt-3" style={{ borderTop: '1px solid var(--council-hairline)' }}>
                        <button type="button" onClick={endForAll} disabled={busy === 'end'}
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-red-500/8 disabled:opacity-50"
                            style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--council-danger-ink)', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                            {busy === 'end' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />} End for everyone
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ====================================================================== */
/* In call                                                                */
/* ====================================================================== */

interface RoomProps {
    orgId: string; meeting: Meeting; items: Item[]; lines: Line[]; byItem: Map<string, Decision>; rules: Decision[];
    decided: number; parked: number; canHost: boolean; busy: string | null;
    onReview: (action: 'confirm' | 'reject', id: string) => void; banners: ReactNode;
}

/** Tile grid columns by head-count, against the STAGE width (container query), not the viewport. */
function gridCols(n: number): string {
    if (n <= 1) return 'grid-cols-1';
    if (n === 2) return 'grid-cols-1 @md:grid-cols-2';
    if (n <= 4) return 'grid-cols-2';
    if (n <= 6) return 'grid-cols-2 @2xl:grid-cols-3';
    return 'grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4';
}
const avatarFor = (n: number) => (n <= 2 ? 84 : n <= 4 ? 68 : 52);

function InCall(props: RoomProps & { iraPending: boolean; onEnd: () => void; onLeave: () => void }) {
    const { orgId, meeting, items, lines, byItem, rules, decided, parked, canHost, busy, iraPending, onReview, onEnd, onLeave, banners } = props;
    const participants = useParticipants();
    const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
    const [captions, setCaptions] = useState(true);
    // Mounted only after Join (client-side), so reading the viewport here is safe.
    const [panel, setPanel] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
    const [tab, setTab] = useState<PanelTab>('agenda');

    const people = participants.filter((p) => !p.isAgent);
    const agents = participants.filter((p) => p.isAgent);
    const showIraPending = iraPending && agents.length === 0;
    const tileCount = participants.length + (showIraPending ? 1 : 0);
    const avatar = avatarFor(tileCount);
    const toConfirm = [...byItem.values(), ...rules].filter((d) => d.state === 'proposed').length;

    const tabs: { id: PanelTab; label: string; count?: number }[] = [
        { id: 'agenda', label: 'Agenda', count: items.length },
        { id: 'notes', label: 'Notes', count: byItem.size + rules.length },
        { id: 'transcript', label: 'Transcript' },
    ];

    const panelBody = (
        <>
            <Tabs value={tab} onChange={setTab} tabs={tabs} />
            {tab === 'notes' && (
                <p className="mt-3" style={{ fontSize: 11.5, lineHeight: 1.5, color: INK3 }}>
                    Ira writes these down as she hears them. Each is a proposal until an approver confirms it
                    {toConfirm > 0 && <> · <b style={{ color: INK2, fontVariantNumeric: 'tabular-nums' }}>{toConfirm} to confirm</b></>}.
                </p>
            )}
            {tab === 'transcript'
                ? <Transcript lines={lines} className="mt-3 min-h-0 flex-1" />
                : (
                    <div className={`mt-3 min-h-0 flex-1 overflow-y-auto ${tab === 'agenda' ? 'px-3' : 'px-1 pb-1'}`}>
                        {tab === 'agenda' && <AgendaList items={items} />}
                        {tab === 'notes' && <NotesList items={items} byItem={byItem} rules={rules} canHost={canHost} busy={busy} onReview={onReview} />}
                    </div>
                )}
        </>
    );

    return (
        <div className={`flex flex-col overflow-hidden ${FILL_H}`} style={SHELL}>
            {/* ------------------------------------------------------ top bar */}
            <header className="flex items-center gap-2.5 px-3 py-2.5 sm:gap-[12px] sm:px-4"
                style={{ background: 'var(--council-surface-1)', borderBottom: '1px solid var(--council-hairline)' }}>
                <Link href={`/${orgId}/meetings`} aria-label="All meetings"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ color: INK2, boxShadow: 'var(--council-ring)' }}>
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="min-w-0 flex-1">
                    <div role="heading" aria-level={1} className="truncate" style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: INK1 }}>
                        {meeting.title}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ fontSize: 11.5, fontWeight: 500, color: INK2, fontVariantNumeric: 'tabular-nums' }}>
                        <span className="inline-flex items-center gap-1.5">
                            <LiveDot tone={meeting.status === 'live' ? 'live' : 'waiting'} />
                            <span className="council-eyebrow" style={{ color: INK1 }}>{meeting.status === 'live' ? 'Live' : 'Waiting to start'}</span>
                            {meeting.status === 'live' && <span style={{ fontWeight: 700 }}><Elapsed since={meeting.started_at} /></span>}
                        </span>
                        <span aria-hidden style={{ color: 'var(--council-ink-4)' }}>·</span>
                        <span>{decided} of {items.length} decided{parked > 0 && <> · {parked} parked</>}</span>
                        {iraPending && (
                            <span className="council-sev" style={{ color: 'var(--council-p1-ink)', background: 'color-mix(in srgb, var(--warning) 15%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--warning) 55%, transparent)' }}>
                                Ira hasn&apos;t joined yet
                            </span>
                        )}
                    </div>
                </div>
                {canHost && (
                    <button type="button" onClick={onEnd} disabled={busy === 'end'} aria-label="End for everyone" title="End for everyone"
                        className="w-[34px] justify-center disabled:opacity-50 sm:w-auto sm:px-3.5" style={END_BTN}>
                        {busy === 'end' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
                        <span className="hidden sm:inline">End for everyone</span>
                    </button>
                )}
            </header>

            <div className="space-y-2 px-3 pt-3 empty:hidden sm:px-4">{banners}</div>

            {/* -------------------------------------------- stage + panel */}
            <div className="flex min-h-0 flex-1 gap-[12px] p-[12px] sm:p-[16px]">
                <section aria-label="Participants" className="flex min-w-0 flex-1 flex-col gap-[12px]">
                    <div className="@container min-h-0 flex-1 overflow-y-auto">
                        <div className={`grid h-full gap-2.5 ${gridCols(tileCount)}`} style={{ gridAutoRows: 'minmax(132px, 1fr)' }}>
                            {people.map((p) => <PersonTile key={p.identity} p={p} avatar={avatar} />)}
                            {agents.map((p) => <IraTile key={p.identity} avatar={avatar} />)}
                            {showIraPending && <IraTile avatar={avatar} pending />}
                        </div>
                    </div>

                    {captions && <CaptionStrip lines={lines} iraPending={iraPending} />}

                    {/* control dock — floating pill, vercel Level 5 */}
                    <div className="flex justify-center">
                        <div className="inline-flex items-center gap-2.5 rounded-full p-[8px]" style={{ background: 'var(--council-surface-1)', boxShadow: ELEV_5 }}>
                            <CallButton onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)} active={isMicrophoneEnabled}
                                title={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}>
                                {isMicrophoneEnabled ? <Mic size={19} /> : <MicOff size={19} style={{ color: 'var(--council-danger-ink)' }} />}
                            </CallButton>
                            <CallButton onClick={() => setCaptions((v) => !v)} active={captions} title={captions ? 'Hide captions' : 'Show captions'}>
                                <Captions size={19} />
                            </CallButton>
                            <CallButton onClick={() => setPanel((v) => !v)} active={panel} title={panel ? 'Hide agenda and notes' : 'Show agenda and notes'}>
                                <PanelRight size={19} />
                            </CallButton>
                            <CallButton onClick={onLeave} danger title="Leave meeting">
                                <PhoneOff size={19} />
                            </CallButton>
                        </div>
                    </div>
                </section>

                {/* side panel — desktop column */}
                {panel && (
                    <aside aria-label="Agenda and notes" className="hidden w-[340px] shrink-0 flex-col p-[12px] lg:flex xl:w-[380px]"
                        style={{ borderRadius: 12, background: 'var(--council-surface-1)', boxShadow: 'var(--council-elev-3)' }}>
                        {panelBody}
                    </aside>
                )}
            </div>

            {/* side panel — bottom sheet below lg */}
            {panel && (
                <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Agenda and notes">
                    <button type="button" aria-label="Close panel" onClick={() => setPanel(false)}
                        className="absolute inset-0 h-full w-full" style={{ background: 'rgba(20, 28, 32, 0.42)', border: 'none' }} />
                    <SheetMotion className="absolute inset-x-0 bottom-0 flex max-h-[78dvh] flex-col px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2"
                        style={{ borderRadius: '16px 16px 0 0', background: 'var(--council-surface-1)', boxShadow: ELEV_5, fontFamily: 'var(--font-body)', color: INK1, height: '78dvh' }}>
                        <div className="mb-2 flex items-center">
                            <span aria-hidden className="mx-auto h-1 w-10 rounded-full" style={{ background: 'var(--council-hairline-strong)' }} />
                        </div>
                        <div className="mb-2 flex items-center justify-between">
                            <span className="council-eyebrow">{meeting.title}</span>
                            <button type="button" onClick={() => setPanel(false)} aria-label="Close panel"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ color: INK2, boxShadow: 'var(--council-ring)', border: 'none', background: 'transparent' }}>
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        {panelBody}
                    </SheetMotion>
                </div>
            )}
        </div>
    );
}

/* ====================================================================== */
/* Ended — the decision sheet                                             */
/* ====================================================================== */

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
    return (
        <div className="rounded-[12px] px-3.5 py-3" style={{ background: 'var(--council-surface-2)', boxShadow: 'var(--council-elev-2)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, lineHeight: 1.2, color: tone ?? INK1, fontVariantNumeric: 'tabular-nums' }}>
                {value.toLocaleString('en-IN')}
            </div>
            <div className="council-eyebrow mt-1">{label}</div>
        </div>
    );
}

function DecisionSheet(props: RoomProps) {
    const { orgId, meeting, items, lines, byItem, rules, decided, parked, canHost, busy, onReview, banners } = props;
    const withDecision = items.filter((i) => byItem.has(i.id));
    const parkedItems = items.filter((i) => i.status === 'parked');
    const toConfirm = [...byItem.values(), ...rules].filter((d) => d.state === 'proposed').length;
    const ranFor = meeting.started_at && meeting.ended_at
        ? Math.round((new Date(meeting.ended_at).getTime() - new Date(meeting.started_at).getTime()) / 60000)
        : null;
    const endedOn = meeting.ended_at
        ? new Date(meeting.ended_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : null;
    const card: CSSProperties = { borderRadius: 12, background: 'var(--council-surface-1)', boxShadow: 'var(--council-elev-3)' };

    return (
        <div className={`px-3 py-4 sm:px-6 sm:py-6 ${FILL_MIN_H}`} style={SHELL}>
            <div className="mx-auto flex max-w-4xl flex-col gap-[16px]">
                <header className="flex items-start gap-[12px]">
                    <Link href={`/${orgId}/meetings`} aria-label="All meetings"
                        className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                        style={{ color: INK2, boxShadow: 'var(--council-ring)', background: 'var(--council-surface-1)' }}>
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <div className="council-eyebrow">Decision sheet</div>
                        <div role="heading" aria-level={1} className="[overflow-wrap:anywhere]" style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em', color: INK1 }}>
                            {meeting.title}
                        </div>
                        <p style={{ fontSize: 12, color: INK2, fontVariantNumeric: 'tabular-nums' }}>
                            Ended{endedOn && <> {endedOn}</>}
                            {ranFor !== null && <> · ran {ranFor} min</>}
                            {meeting.host_name && <> · host {meeting.host_name}</>}
                        </p>
                    </div>
                </header>

                {banners}

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Stat label="Decided" value={decided} />
                    <Stat label="Parked" value={parked} tone={parked ? 'var(--council-p1-ink)' : undefined} />
                    <Stat label="Not reached" value={items.length - decided - parked} />
                    <Stat label="To confirm" value={toConfirm} />
                </div>

                <section className="p-[16px]" style={card}>
                    <div role="heading" aria-level={2} className="council-eyebrow">Ira&apos;s notes</div>
                    <p className="mb-3 mt-1" style={{ fontSize: 11.5, lineHeight: 1.5, color: INK3 }}>
                        Ira listened and wrote these down. Each is a proposal until an approver confirms it; acting on it in Zoho stays a person&apos;s job.
                    </p>
                    <ul className="space-y-2">
                        {withDecision.map((i) => {
                            const d = byItem.get(i.id)!;
                            return <DecisionCard key={d.id} label={i.label} d={d} canHost={canHost} busy={busy === d.id} onReview={(a) => onReview(a, d.id)} />;
                        })}
                        {withDecision.length === 0 && <li style={{ fontSize: 12, color: INK3 }}>No decisions were written down.</li>}
                    </ul>

                    {parkedItems.length > 0 && (
                        <>
                            <div role="heading" aria-level={3} className="council-eyebrow mb-2 mt-5">Parked</div>
                            <ul className="space-y-1.5">
                                {parkedItems.map((i) => (
                                    <li key={i.id} className="[overflow-wrap:anywhere]" style={{ fontSize: 12, lineHeight: 1.5, color: INK2 }}>
                                        <b style={{ color: INK1 }}>{i.label}</b>{i.parked_reason && <> — <span style={{ color: 'var(--council-p1-ink)' }}>{i.parked_reason}</span></>}
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    {rules.length > 0 && (
                        <>
                            <div role="heading" aria-level={3} className="council-eyebrow mb-2 mt-5">Rules heard</div>
                            <ul className="space-y-2">
                                {rules.map((r) => <RuleCard key={r.id} r={r} canHost={canHost} busy={busy === r.id} onReview={(a) => onReview(a, r.id)} />)}
                            </ul>
                        </>
                    )}
                </section>

                <details className="group p-[16px]" style={card}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-[8px]">
                        <span className="council-eyebrow">Full transcript</span>
                        <span style={{ fontSize: 11.5, color: INK3, fontVariantNumeric: 'tabular-nums' }}>
                            {lines.length.toLocaleString('en-IN')} lines · <span className="group-open:hidden">show</span><span className="hidden group-open:inline">hide</span>
                        </span>
                    </summary>
                    <Transcript lines={lines} className="mt-3 max-h-[60vh]" />
                </details>
            </div>
        </div>
    );
}
