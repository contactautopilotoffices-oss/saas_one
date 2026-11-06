'use client';

/**
 * MEETING ROOM — presentational parts (tiles, dock, panel lists, transcript).
 *
 * All data logic lives in MeetingRoom.tsx; nothing here fetches.
 *
 * Visual language is the Agent Council's, reused rather than re-derived:
 *   - tokens: --council-ink-1/2/3, --council-surface-1/2/3, --council-hairline,
 *     --council-elev-2/3/4, --council-p0-fill, --council-p1-ink, --council-p2-ink,
 *     --council-danger-ink, --cc-ease/--cc-dur (app/globals.css [council:begin]).
 *     Those surfaces are white in every theme and the ink follows --cc-ink, so
 *     the room stays legible under .dark the same way the council does.
 *   - control button, caption well, LIVE dot: AgentCall.tsx verbatim.
 *   - speaking halo (inset 1px hue + inset 26px glow, opacity 0.3→1→0.3 over
 *     2.6s): AgentPresence.tsx verbatim — the ONLY looping animation on screen
 *     (glass-ambient.md: "exactly one element ... may loop"; calm-tech).
 *   - avatar chrome (18% hue wash + 40% inset ring, monogram fallback):
 *     AgentAvatar.tsx.
 *   - radii: vercel rounded.md 8 / lg 12 / xl 16; linear.app rounded.lg 12 for
 *     cards. Stacked elevation: vercel Level 2-5 (via --council-elev-*).
 *   - numbers: tabular-nums everywhere a count or amount sits in a column
 *     (binance number-sm 14/500/1.4 for amounts).
 *
 * Ira is LISTEN-ONLY: she never speaks, so her tile never shows a speaking
 * halo — it shows a static "Listening · taking notes" state instead.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import { useIsSpeaking } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { Check, Loader2, MicOff, NotebookPen, X } from 'lucide-react';

/* ------------------------------------------------------------------ types */

export interface Facts {
    vendor?: string; property?: string | null; amount_spoken?: string; days_waiting?: number; po_date?: string;
}
export interface Item { id: string; position: number; label: string; facts: Facts; status: 'pending' | 'current' | 'discussed' | 'parked'; parked_reason: string | null }
export interface Decision {
    id: string; item_id: string | null; kind: 'item' | 'rule'; decision: string | null; owner_name: string | null;
    due_text: string | null; note: string | null; said_by: string | null;
    state: 'proposed' | 'confirmed' | 'rejected' | 'superseded'; created_at: string;
}
export interface Line { id: number; speaker_name: string | null; is_agent: boolean; text: string; spoken_at: string }

export const DECISION_LABEL: Record<string, string> = {
    approve: 'Approve', cancel: 'Cancel', needs_info: 'Needs info', hold: 'Hold', reassign: 'Reassign',
};

/* ----------------------------------------------------------------- tokens */

export const INK1 = 'var(--council-ink-1)';
export const INK2 = 'var(--council-ink-2)';
export const INK3 = 'var(--council-ink-3)';
/** Ira's hue. --secondary is the app's "AI" colour (--cc-purple, the AI Brief chip). */
export const IRA_HUE = 'var(--secondary)';
/** Hue driven to an AA-safe text ink — same construction as --council-agent-ink. */
export const IRA_INK = 'color-mix(in srgb, var(--secondary) 58%, var(--cc-ink))';
const PEOPLE_HUE = 'var(--primary)';
const EASE = [0.19, 1, 0.22, 1] as const;
/** AgentCall caption well: 4% ink tint + 7% inset hairline, radius 12. */
export const WELL: CSSProperties = {
    borderRadius: 12,
    background: 'rgba(30, 42, 48, 0.04)',
    boxShadow: 'inset 0 0 0 1px rgba(30, 42, 48, 0.07)',
};
/** Vercel Level 5 (modal) — sheets and the floating dock. */
export const ELEV_5 = 'var(--council-ring), 0 1px 1px rgba(30, 42, 48, 0.02), 0 8px 16px -4px rgba(30, 42, 48, 0.10), 0 24px 32px -8px rgba(30, 42, 48, 0.14)';

export const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';

export function fmtClock(totalS: number): string {
    const s = Math.max(0, Math.floor(totalS));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(r).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* --------------------------------------------------------- small elements */

/** Elapsed since an ISO timestamp, ticking once a second. Blank until the first tick. */
export function Elapsed({ since }: { since: string | null }) {
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);
    if (!since || now === null) return null;
    return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtClock((now - new Date(since).getTime()) / 1000)}</span>;
}

/** AgentCall header dot: 8px, 3px 20% halo when live. Static — never pulses. */
export function LiveDot({ tone }: { tone: 'live' | 'waiting' | 'ended' }) {
    const c = tone === 'live' ? 'var(--success, #10B981)' : tone === 'waiting' ? 'var(--warning, #F59E0B)' : 'var(--council-ink-4)';
    return (
        <span aria-hidden style={{
            width: 8, height: 8, borderRadius: 999, flex: 'none', background: c,
            boxShadow: tone === 'live' ? `0 0 0 3px color-mix(in srgb, ${c} 20%, transparent)` : 'none',
        }} />
    );
}

/** Round dock button — AgentCall `CallButton`, same 46px / colours / 300ms cc-ease. */
export function CallButton({ onClick, active, danger, title, children }: {
    onClick: () => void; active?: boolean; danger?: boolean; title: string; children: ReactNode;
}) {
    return (
        <button type="button" onClick={onClick} title={title} aria-label={title} aria-pressed={danger ? undefined : !!active}
            style={{
                width: 46, height: 46, borderRadius: 999, border: 'none', cursor: 'pointer', flex: 'none',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: danger ? '#fff' : active ? INK1 : INK2,
                background: danger ? 'var(--error, #EF4444)' : active ? 'color-mix(in srgb, var(--primary) 22%, transparent)' : 'rgba(30, 42, 48, 0.07)',
                boxShadow: danger ? '0 6px 16px -6px rgba(239, 68, 68, 0.55)' : 'inset 0 0 0 1px rgba(30, 42, 48, 0.10)',
                transition: 'all var(--cc-dur) var(--cc-ease)',
            }}>
            {children}
        </button>
    );
}

export function StateTag({ state }: { state: Decision['state'] }) {
    const color = state === 'confirmed' ? '#047857' /* emerald-700 */ : state === 'rejected' ? 'var(--council-danger-ink)' : INK3;
    return (
        <span className="council-eyebrow" style={{ color, letterSpacing: '0.08em' }}>
            {state === 'proposed' ? 'to confirm' : state}
        </span>
    );
}

export function ReviewButtons({ busy, onConfirm, onReject }: { busy: boolean; onConfirm: () => void; onReject: () => void }) {
    const base: CSSProperties = {
        height: 28, padding: '0 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600,
        transition: 'background var(--cc-dur) var(--cc-ease), color var(--cc-dur) var(--cc-ease)',
    };
    return (
        <div className="mt-2 flex gap-[8px]">
            <button type="button" onClick={onConfirm} disabled={busy} className="disabled:opacity-50 hover:bg-emerald-500/10"
                style={{ ...base, color: '#047857', background: 'transparent', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--success) 45%, transparent)' }}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Confirm
            </button>
            <button type="button" onClick={onReject} disabled={busy} className="disabled:opacity-50 hover:text-red-700"
                style={{ ...base, color: INK2, background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--council-hairline)' }}>
                <X className="h-3 w-3" /> Reject
            </button>
        </div>
    );
}

/** Setup warnings / errors. Error = council-row-p0 recipe; setup = P1 tint. */
export function Banner({ tone, children }: { tone: 'error' | 'setup'; children: ReactNode }) {
    const style: CSSProperties = tone === 'error'
        ? { background: 'color-mix(in srgb, var(--error) 5%, var(--council-surface-1))', boxShadow: 'inset 2px 0 0 var(--council-p0-fill), inset 0 0 0 1px color-mix(in srgb, var(--error) 22%, transparent)', color: 'var(--council-danger-ink)' }
        : { background: 'color-mix(in srgb, var(--warning) 8%, var(--council-surface-1))', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--warning) 40%, transparent)', color: 'var(--council-p1-ink)' };
    return <div role={tone === 'error' ? 'alert' : undefined} className="rounded-[12px] px-3.5 py-2.5 text-[12px] leading-relaxed [overflow-wrap:anywhere]" style={style}>{children}</div>;
}

/* ---------------------------------------------------------------- avatars */

/** Ira's portrait with the council monogram as a guaranteed fallback (AgentAvatar pattern). */
export function IraAvatar({ size }: { size: number }) {
    const [failed, setFailed] = useState(false);
    const chrome: CSSProperties = {
        width: size, height: size, borderRadius: '26%', flex: 'none',
        background: `color-mix(in srgb, ${IRA_HUE} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${IRA_HUE} 40%, transparent)`,
    };
    if (failed) {
        return <span className="council-mono" style={{ ...chrome, fontSize: Math.round(size * 0.36) }}>IR</span>;
    }
    return (
        <Image src="/agents/ira.png" alt="Ira" width={size} height={size} onError={() => setFailed(true)}
            style={{ ...chrome, objectFit: 'cover', objectPosition: 'top' }} />
    );
}

function PersonAvatar({ name, size, speaking }: { name: string; size: number; speaking: boolean }) {
    return (
        <span className="council-mono" style={{
            width: size, height: size, borderRadius: '26%', fontSize: Math.round(size * 0.36),
            background: `color-mix(in srgb, ${PEOPLE_HUE} 18%, transparent)`,
            // Speaking: a static 3px ring around the face; the tile halo carries the pulse.
            boxShadow: speaking
                ? `inset 0 0 0 1px color-mix(in srgb, ${PEOPLE_HUE} 60%, transparent), 0 0 0 3px color-mix(in srgb, ${PEOPLE_HUE} 35%, transparent)`
                : `inset 0 0 0 1px color-mix(in srgb, ${PEOPLE_HUE} 40%, transparent)`,
            transition: 'box-shadow var(--cc-dur) var(--cc-ease)',
        }}>
            {initials(name)}
        </span>
    );
}

/* ------------------------------------------------------------------ tiles */

const TILE: CSSProperties = {
    position: 'relative', overflow: 'hidden', borderRadius: 12, minWidth: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: '14px 12px 40px',
    transition: 'background 900ms var(--cc-ease), box-shadow 900ms var(--cc-ease)',
};

/** Name plate, bottom-left (Teams position). vercel rounded.sm 6px. */
function NamePlate({ children }: { children: ReactNode }) {
    return (
        <span style={{
            position: 'absolute', left: 8, bottom: 8, maxWidth: 'calc(100% - 16px)',
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.88)', boxShadow: 'var(--council-ring)',
            fontSize: 11.5, fontWeight: 600, lineHeight: 1.4, color: INK1,
        }}>
            {children}
        </span>
    );
}

/** The speaking halo — AgentPresence verbatim; static under reduced motion. */
function SpeakingHalo({ hue }: { hue: string }) {
    const reduceMotion = useReducedMotion();
    const style: CSSProperties = {
        position: 'absolute', inset: 0, borderRadius: 12, pointerEvents: 'none',
        boxShadow: `inset 0 0 0 1px ${hue}, inset 0 0 26px -6px ${hue}`,
    };
    if (reduceMotion) return <span aria-hidden style={style} />;
    return (
        <motion.span aria-hidden style={style}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }} />
    );
}

export function PersonTile({ p, avatar }: { p: Participant; avatar: number }) {
    const speaking = useIsSpeaking(p);
    const name = p.name || p.identity;
    const muted = !p.isMicrophoneEnabled;
    return (
        <div style={{
            ...TILE,
            background: speaking ? 'var(--council-surface-3)' : 'var(--council-surface-2)',
            boxShadow: 'var(--council-elev-3)',
        }}>
            {/* council-tile::before top-edge light, lit only while speaking */}
            <span aria-hidden style={{
                position: 'absolute', inset: '0 0 auto 0', height: 2, opacity: speaking ? 0.9 : 0,
                background: `linear-gradient(90deg, transparent, ${PEOPLE_HUE} 22%, ${PEOPLE_HUE} 78%, transparent)`,
                transition: 'opacity 900ms var(--cc-ease)',
            }} />
            {speaking && <SpeakingHalo hue={PEOPLE_HUE} />}
            <PersonAvatar name={name} size={avatar} speaking={speaking} />
            <NamePlate>
                {muted && <MicOff aria-label="Microphone off" className="h-3 w-3 shrink-0" style={{ color: 'var(--council-danger-ink)' }} />}
                <span className="truncate">{name}{p.isLocal && <span style={{ color: INK3, fontWeight: 500 }}> (you)</span>}</span>
            </NamePlate>
            <span className="sr-only">{speaking ? `${name} is speaking` : ''}</span>
        </div>
    );
}

/** Ira's tile. She is listen-only: no halo, no mic state — a static notetaker status. */
export function IraTile({ avatar, pending }: { avatar: number; pending?: boolean }) {
    return (
        <div style={{
            ...TILE,
            background: pending ? 'transparent' : 'var(--council-surface-2)',
            boxShadow: pending ? 'none' : 'var(--council-elev-3)',
            border: pending ? '1px dashed var(--council-hairline-strong)' : undefined,
        }}>
            <IraAvatar size={avatar} />
            <span className="flex max-w-full items-start justify-center gap-1.5 px-2 text-center" style={{ fontSize: 11.5, lineHeight: 1.4, fontWeight: 500, color: pending ? INK3 : IRA_INK }}>
                <NotebookPen className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{pending ? "Ira hasn't joined yet" : 'Listening · taking notes'}</span>
            </span>
            <NamePlate>
                <span className="truncate">Ira</span>
                <span className="council-eyebrow" style={{ fontSize: 9, color: IRA_INK }}>AI notes</span>
            </NamePlate>
        </div>
    );
}

/* --------------------------------------------------------------- captions */

export function CaptionStrip({ lines, iraPending }: { lines: Line[]; iraPending: boolean }) {
    const last = lines.slice(-2);
    return (
        <div aria-live="polite" className="min-h-[58px] px-3.5 py-2.5" style={WELL}>
            {last.length === 0 ? (
                <p style={{ fontSize: 12, fontStyle: 'italic', color: INK3 }}>
                    {iraPending ? 'Captions start once Ira joins — she writes the transcript.' : 'Captions appear here as people speak.'}
                </p>
            ) : last.map((l) => (
                <p key={l.id} className="line-clamp-2 [overflow-wrap:anywhere]" style={{ margin: '2px 0', fontSize: 12.5, lineHeight: 1.5, color: INK1 }}>
                    <span style={{ fontWeight: 700, color: l.is_agent ? IRA_INK : INK2 }}>{l.speaker_name ?? 'Someone'}:</span>{' '}{l.text}
                </p>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------- transcript */

export function Transcript({ lines, className = '' }: { lines: Line[]; className?: string }) {
    const box = useRef<HTMLDivElement>(null);
    // Open at the newest line (the panel tab remounts this).
    useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, []);
    useEffect(() => {
        const el = box.current;
        // Follow the conversation, unless someone scrolled up to read.
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
    }, [lines.length]);
    return (
        <div ref={box} className={`space-y-2.5 overflow-y-auto pr-1 ${className}`}>
            {lines.map((l) => (
                <p key={l.id} className="[overflow-wrap:anywhere]" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                    <span style={{ marginRight: 6, fontWeight: 700, color: l.is_agent ? IRA_INK : INK1 }}>{l.speaker_name ?? 'Someone'}:</span>
                    <span style={{ color: INK2 }}>{l.text}</span>
                </p>
            ))}
            {!lines.length && <p style={{ fontSize: 12, color: INK3 }}>Nothing said yet.</p>}
        </div>
    );
}

/* ----------------------------------------------------------------- agenda */

const STATUS_CHIP: Record<Item['status'], { label: string; style: CSSProperties }> = {
    current: { label: 'Now', style: { color: 'var(--council-p2-ink)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--primary) 45%, transparent)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)' } },
    discussed: { label: 'Decided', style: { color: '#047857', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--success) 40%, transparent)' } },
    parked: { label: 'Parked', style: { color: 'var(--council-p1-ink)', background: 'color-mix(in srgb, var(--warning) 15%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--warning) 55%, transparent)' } },
    pending: { label: 'Pending', style: { color: INK3, boxShadow: 'inset 0 0 0 1px var(--council-hairline)' } },
};

function StatusChip({ status }: { status: Item['status'] }) {
    const s = STATUS_CHIP[status];
    return <span className="council-sev" style={{ ...s.style, textTransform: 'uppercase' }}>{s.label}</span>;
}

export function AgendaList({ items }: { items: Item[] }) {
    const reduceMotion = useReducedMotion();
    const current = useRef<HTMLLIElement>(null);
    const currentId = items.find((i) => i.status === 'current')?.id;
    useEffect(() => {
        current.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    }, [currentId, reduceMotion]);
    if (!items.length) return <p style={{ fontSize: 12, color: INK3 }}>No items on the agenda.</p>;
    return (
        <ol>
            {items.map((i, idx) => {
                const isCurrent = i.status === 'current';
                return (
                    <li key={i.id} ref={isCurrent ? current : undefined} className="council-frow"
                        style={{
                            display: 'block',
                            borderTop: idx === 0 ? '0' : undefined,
                            ...(isCurrent ? { background: 'color-mix(in srgb, var(--primary) 6%, transparent)', boxShadow: 'inset 2px 0 0 var(--primary)' } : null),
                        }}>
                        <div className="flex items-start gap-[8px]">
                            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]" style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, color: INK1 }}>
                                <span style={{ color: INK3, fontVariantNumeric: 'tabular-nums' }}>{i.position}.</span> {i.label}
                            </span>
                            <StatusChip status={i.status} />
                        </div>
                        <div className="mt-1 [overflow-wrap:anywhere]" style={{ fontSize: 11.5, lineHeight: 1.5, color: INK2 }}>
                            {i.facts.vendor} · {i.facts.property ?? 'property not recorded'} ·{' '}
                            <b style={{ color: INK1, fontVariantNumeric: 'tabular-nums' }}>{i.facts.amount_spoken}</b> ·{' '}
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{i.facts.days_waiting}</span> days waiting
                        </div>
                        {i.status === 'parked' && i.parked_reason && (
                            <div className="mt-1" style={{ fontSize: 11.5, color: 'var(--council-p1-ink)' }}>Parked: {i.parked_reason}</div>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

/* ------------------------------------------------------------------ notes */

export function DecisionCard({ label, d, canHost, busy, onReview }: {
    label: string; d: Decision; canHost: boolean; busy: boolean; onReview: (action: 'confirm' | 'reject') => void;
}) {
    return (
        <li className="rounded-[12px] px-3 py-2.5" style={{ background: 'var(--council-surface-2)', boxShadow: 'var(--council-elev-2)' }}>
            <div className="flex flex-wrap items-center gap-[8px]">
                <span className="min-w-0 [overflow-wrap:anywhere]" style={{ fontSize: 12.5, fontWeight: 600, color: INK1 }}>{label}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: INK1, padding: '1px 8px', borderRadius: 999, boxShadow: 'inset 0 0 0 1px var(--council-hairline-strong)' }}>
                    {DECISION_LABEL[d.decision ?? ''] ?? d.decision}
                </span>
                <StateTag state={d.state} />
            </div>
            <div className="mt-1 [overflow-wrap:anywhere]" style={{ fontSize: 11.5, lineHeight: 1.5, color: INK2 }}>
                {d.owner_name && <>Owner <b style={{ color: INK1 }}>{d.owner_name}</b></>}{d.due_text && <> · by {d.due_text}</>}
                {d.note && <div>{d.note}</div>}
                {d.said_by && <div style={{ color: INK3 }}>Said by {d.said_by}</div>}
            </div>
            {canHost && d.state === 'proposed' && (
                <ReviewButtons busy={busy} onConfirm={() => onReview('confirm')} onReject={() => onReview('reject')} />
            )}
        </li>
    );
}

export function RuleCard({ r, canHost, busy, onReview }: {
    r: Decision; canHost: boolean; busy: boolean; onReview: (action: 'confirm' | 'reject') => void;
}) {
    return (
        <li className="rounded-[12px] px-3 py-2.5" style={{ background: 'var(--council-surface-2)', boxShadow: 'var(--council-elev-2)', fontSize: 11.5, lineHeight: 1.5, color: INK2 }}>
            <div className="flex flex-wrap items-center gap-[8px]">
                <span className="min-w-0 [overflow-wrap:anywhere]" style={{ color: INK1 }}>{r.note}</span>
                <StateTag state={r.state} />
            </div>
            {r.said_by && <div style={{ color: INK3 }}>Said by {r.said_by}</div>}
            {canHost && r.state === 'proposed' && (
                <ReviewButtons busy={busy} onConfirm={() => onReview('confirm')} onReject={() => onReview('reject')} />
            )}
        </li>
    );
}

/** Ira's proposed decisions per item, then the rules she heard. */
export function NotesList({ items, byItem, rules, canHost, busy, onReview }: {
    items: Item[]; byItem: Map<string, Decision>; rules: Decision[]; canHost: boolean; busy: string | null;
    onReview: (action: 'confirm' | 'reject', id: string) => void;
}) {
    const decided = items.filter((i) => byItem.has(i.id));
    return (
        <div>
            <ul className="space-y-2">
                {decided.map((i) => {
                    const d = byItem.get(i.id)!;
                    return <DecisionCard key={d.id} label={i.label} d={d} canHost={canHost} busy={busy === d.id} onReview={(a) => onReview(a, d.id)} />;
                })}
                {decided.length === 0 && <li style={{ fontSize: 12, color: INK3 }}>No decisions yet.</li>}
            </ul>
            {rules.length > 0 && (
                <>
                    <div role="heading" aria-level={3} className="council-eyebrow mb-2 mt-5">Rules heard</div>
                    <ul className="space-y-2">
                        {rules.map((r) => <RuleCard key={r.id} r={r} canHost={canHost} busy={busy === r.id} onReview={(a) => onReview(a, r.id)} />)}
                    </ul>
                </>
            )}
        </div>
    );
}

/** Segmented tabs: 5% ink track, active segment on white with Level 2 elevation. */
export function Tabs<T extends string>({ value, onChange, tabs }: {
    value: T; onChange: (v: T) => void; tabs: { id: T; label: string; count?: number }[];
}) {
    return (
        <div role="tablist" className="flex gap-[4px] rounded-full p-[4px]" style={{ background: 'rgba(30, 42, 48, 0.05)' }}>
            {tabs.map((t) => {
                const on = t.id === value;
                return (
                    <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5"
                        style={{
                            fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                            color: on ? INK1 : INK2,
                            background: on ? 'var(--council-surface-1)' : 'transparent',
                            boxShadow: on ? 'var(--council-elev-2)' : 'none',
                            transition: 'background var(--cc-dur) var(--cc-ease), color var(--cc-dur) var(--cc-ease)',
                        }}>
                        {t.label}
                        {typeof t.count === 'number' && <span style={{ fontSize: 10.5, color: INK3, fontVariantNumeric: 'tabular-nums' }}>{t.count}</span>}
                    </button>
                );
            })}
        </div>
    );
}

/** Slide-up entrance for the mobile sheet — AgentCall's 0.5s cc-ease, off under reduced motion. */
export function SheetMotion({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
    const reduceMotion = useReducedMotion();
    return (
        <motion.div className={className} style={style}
            initial={reduceMotion ? false : { y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, ease: EASE }}>
            {children}
        </motion.div>
    );
}
