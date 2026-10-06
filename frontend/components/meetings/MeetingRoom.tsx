'use client';

/**
 * MEETING ROOM — join, talk, and watch the agenda move.
 *
 * Audio runs through LiveKit; everything else on this page (agenda progress,
 * the transcript, Ira's decisions) is read from FMS every few seconds, so what
 * people see is exactly what was saved. After the meeting the same page is the
 * decision sheet: an approver confirms or rejects each proposed decision.
 * Confirming records agreement; acting on it in Zoho stays a person's job.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { LiveKitRoom, RoomAudioRenderer, useIsSpeaking, useLocalParticipant, useParticipants } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { AlertTriangle, ArrowLeft, Bot, Check, Loader2, LogOut, Mic, MicOff, PhoneOff, ShieldAlert, X } from 'lucide-react';

interface Facts {
    vendor?: string; property?: string | null; amount_spoken?: string; days_waiting?: number; po_date?: string;
}
interface Item { id: string; position: number; label: string; facts: Facts; status: 'pending' | 'current' | 'discussed' | 'parked'; parked_reason: string | null }
interface Decision {
    id: string; item_id: string | null; kind: 'item' | 'rule'; decision: string | null; owner_name: string | null;
    due_text: string | null; note: string | null; said_by: string | null;
    state: 'proposed' | 'confirmed' | 'rejected' | 'superseded'; created_at: string;
}
interface Line { id: number; speaker_name: string | null; is_agent: boolean; text: string; spoken_at: string }
interface Meeting {
    id: string; title: string; status: 'scheduled' | 'live' | 'ended'; agent_slug: string;
    host_name: string | null; started_at: string | null; ended_at: string | null; agent_joined_at: string | null;
}
interface Payload {
    meeting: Meeting; items: Item[]; decisions: Decision[]; lines: Line[];
    viewer: { can_host: boolean; name: string }; livekit_ready: boolean; setup: string[];
}

const DECISION_LABEL: Record<string, string> = {
    approve: 'Approve', cancel: 'Cancel', needs_info: 'Needs info', hold: 'Hold', reassign: 'Reassign',
};
const ITEM_STATE = {
    pending: 'text-text-tertiary',
    current: 'text-primary',
    discussed: 'text-emerald-700',
    parked: 'text-amber-800',
} as const;

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
        return error
            ? <div className="p-6 text-sm text-red-700">{error}</div>
            : <div className="flex items-center gap-2 p-6 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" /> Loading the meeting…</div>;
    }
    const { meeting, items, viewer } = data;
    const decided = items.filter((i) => i.status === 'discussed').length;
    const parked = items.filter((i) => i.status === 'parked').length;

    return (
        <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
            <header className="flex flex-wrap items-start gap-3">
                <Link href={`/${orgId}/meetings`} className="mt-1 text-text-tertiary hover:text-foreground" aria-label="All meetings"><ArrowLeft className="h-4 w-4" /></Link>
                <div className="min-w-0 flex-1">
                    <h1 className="text-lg font-bold text-foreground">{meeting.title}</h1>
                    <p className="text-[12px] text-text-secondary">
                        {meeting.status === 'ended' ? 'Ended' : meeting.status === 'live' ? 'Live' : 'Not started'}
                        {meeting.host_name && <> · host {meeting.host_name}</>}
                        {' · '}{decided} decided · {parked} parked · {items.length - decided - parked} to go
                        {meeting.status === 'live' && !meeting.agent_joined_at && <> · <span className="text-amber-800">Ira has not joined yet</span></>}
                    </p>
                </div>
                {viewer.can_host && !ended && (
                    <button type="button" onClick={() => void patch({ action: 'end' }, 'end')} disabled={busy === 'end'}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-500/8 disabled:opacity-50">
                        {busy === 'end' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />} End for everyone
                    </button>
                )}
            </header>

            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/8 px-3 py-2 text-[12px] text-red-700">{error}</div>}
            {data.setup.length > 0 && !ended && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-3 text-[12px] text-amber-900">
                    <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" /><b>The meeting service is not set up yet.</b>
                    <ul className="mt-1 space-y-1">{data.setup.map((s) => <li key={s}>· {s}</li>)}</ul>
                </div>
            )}

            {!ended && (conn ? (
                <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio video={false}
                    onDisconnected={() => setConn(null)}
                    onError={(e) => setError(`Meeting connection: ${e.message}`)}>
                    <RoomAudioRenderer />
                    <InRoomBar onLeave={() => setConn(null)} />
                </LiveKitRoom>
            ) : (
                <section className="rounded-[14px] border border-border bg-card p-4">
                    <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-text-secondary">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                        <span>
                            This meeting is <b>transcribed</b>. Ira, our procurement agent, is in the room: she reads each
                            purchase order, asks what should happen, and writes the decision down under the name of the
                            person who said it. Nothing is approved or cancelled until an approver confirms it afterwards.
                        </span>
                    </p>
                    <button type="button" onClick={() => void join()} disabled={busy === 'join' || !data.livekit_ready}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50">
                        {busy === 'join' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />} Join with microphone
                    </button>
                    <span className="ml-2 text-[11px] text-text-tertiary">Several people in one room: join from one device only, to avoid echo.</span>
                </section>
            ))}

            <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr_1fr]">
                <section className="rounded-[14px] border border-border bg-card p-4">
                    <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Agenda · largest first</h2>
                    <ol className="space-y-2">
                        {items.map((i) => (
                            <li key={i.id} className={`rounded-xl border px-3 py-2.5 ${i.status === 'current' ? 'border-primary/40 bg-primary/5' : 'border-border bg-card-tint'}`}>
                                <div className="flex items-center gap-2">
                                    <span className="text-[12.5px] font-semibold text-foreground">{i.position}. {i.label}</span>
                                    <span className={`ml-auto text-[10.5px] font-bold uppercase ${ITEM_STATE[i.status]}`}>{i.status === 'discussed' ? 'decided' : i.status}</span>
                                </div>
                                <div className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">
                                    {i.facts.vendor} · {i.facts.property ?? 'property not recorded'} · <b>{i.facts.amount_spoken}</b> · {i.facts.days_waiting} days waiting
                                </div>
                                {i.status === 'parked' && i.parked_reason && <div className="mt-1 text-[11px] text-amber-800">Parked: {i.parked_reason}</div>}
                            </li>
                        ))}
                    </ol>
                </section>

                <Transcript lines={lines} />

                <section className="rounded-[14px] border border-border bg-card p-4">
                    <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                        {ended ? 'Decision sheet' : 'Decisions so far'}
                    </h2>
                    <ul className="space-y-2">
                        {items.filter((i) => byItem.has(i.id)).map((i) => {
                            const d = byItem.get(i.id)!;
                            return (
                                <li key={d.id} className="rounded-xl border border-border bg-card-tint px-3 py-2.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[12.5px] font-semibold text-foreground">{i.label}</span>
                                        <span className="rounded-full border border-border px-2 py-0.5 text-[10.5px] font-bold text-foreground">{DECISION_LABEL[d.decision ?? ''] ?? d.decision}</span>
                                        <StateTag state={d.state} />
                                    </div>
                                    <div className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">
                                        {d.owner_name && <>Owner <b>{d.owner_name}</b></>}{d.due_text && <> · by {d.due_text}</>}
                                        {d.note && <div>{d.note}</div>}
                                        {d.said_by && <div className="text-text-tertiary">Said by {d.said_by}</div>}
                                    </div>
                                    {viewer.can_host && d.state === 'proposed' && (
                                        <ReviewButtons busy={busy === d.id}
                                            onConfirm={() => void patch({ action: 'confirm', decision_id: d.id }, d.id)}
                                            onReject={() => void patch({ action: 'reject', decision_id: d.id }, d.id)} />
                                    )}
                                </li>
                            );
                        })}
                        {byItem.size === 0 && <li className="text-[12px] text-text-tertiary">No decisions yet.</li>}
                    </ul>

                    {rules.length > 0 && (
                        <>
                            <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Rules heard</h3>
                            <ul className="space-y-2">
                                {rules.map((r) => (
                                    <li key={r.id} className="rounded-xl border border-border bg-card-tint px-3 py-2.5 text-[11.5px] text-text-secondary">
                                        <div className="flex items-center gap-2"><span className="text-foreground">{r.note}</span><StateTag state={r.state} /></div>
                                        {r.said_by && <div className="text-text-tertiary">Said by {r.said_by}</div>}
                                        {viewer.can_host && r.state === 'proposed' && (
                                            <ReviewButtons busy={busy === r.id}
                                                onConfirm={() => void patch({ action: 'confirm', decision_id: r.id }, r.id)}
                                                onReject={() => void patch({ action: 'reject', decision_id: r.id }, r.id)} />
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}

function StateTag({ state }: { state: Decision['state'] }) {
    const cls = state === 'confirmed' ? 'text-emerald-700' : state === 'rejected' ? 'text-red-700' : 'text-text-tertiary';
    return <span className={`text-[10.5px] font-bold uppercase ${cls}`}>{state === 'proposed' ? 'to confirm' : state}</span>;
}

function ReviewButtons({ busy, onConfirm, onReject }: { busy: boolean; onConfirm: () => void; onReject: () => void }) {
    return (
        <div className="mt-2 flex gap-2">
            <button type="button" onClick={onConfirm} disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500/8 disabled:opacity-50">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Confirm
            </button>
            <button type="button" onClick={onReject} disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:text-red-700 disabled:opacity-50">
                <X className="h-3 w-3" /> Reject
            </button>
        </div>
    );
}

function Transcript({ lines }: { lines: Line[] }) {
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = box.current;
        // Follow the conversation, unless someone scrolled up to read.
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
    }, [lines.length]);
    return (
        <section className="flex max-h-[70vh] flex-col rounded-[14px] border border-border bg-card p-4">
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Transcript</h2>
            <div ref={box} className="flex-1 space-y-2 overflow-y-auto pr-1">
                {lines.map((l) => (
                    <div key={l.id} className="text-[12.5px] leading-relaxed">
                        <span className={`mr-1.5 font-semibold ${l.is_agent ? 'text-primary' : 'text-foreground'}`}>{l.speaker_name ?? 'Someone'}:</span>
                        <span className="text-text-secondary">{l.text}</span>
                    </div>
                ))}
                {!lines.length && <p className="text-[12px] text-text-tertiary">Nothing said yet.</p>}
            </div>
        </section>
    );
}

function InRoomBar({ onLeave }: { onLeave: () => void }) {
    const participants = useParticipants();
    const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
    return (
        <section className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-card p-3">
            {participants.map((p) => <Person key={p.identity} p={p} />)}
            <div className="ml-auto flex gap-2">
                <button type="button" onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-foreground">
                    {isMicrophoneEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5 text-red-700" />}
                    {isMicrophoneEnabled ? 'Mute' : 'Unmute'}
                </button>
                <button type="button" onClick={onLeave}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-red-700">
                    <LogOut className="h-3.5 w-3.5" /> Leave
                </button>
            </div>
        </section>
    );
}

function Person({ p }: { p: Participant }) {
    const speaking = useIsSpeaking(p);
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${speaking ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-800' : 'border-border text-text-secondary'}`}>
            {p.isAgent ? <Bot className="h-3.5 w-3.5" /> : <Mic className="h-3 w-3" />}
            {p.name || p.identity}{p.isLocal && ' (you)'}
        </span>
    );
}
