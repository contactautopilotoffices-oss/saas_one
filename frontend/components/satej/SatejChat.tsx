'use client';

/**
 * Talk to Meera about one requirement — a Teams-style side panel.
 *
 * Meera answers from the requirement's own record. Asked for a change, it
 * proposes one; the proposal card's Apply button is the only thing that acts.
 * The phone button opens a voice call (SatejCall), whose minutes land back here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, Phone, Send, Sparkles, X } from 'lucide-react';
import SatejCall from './SatejCall';
import s from './satej.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Message = {
    id: string; role: 'user' | 'satej'; kind: 'chat' | 'call_minutes'; authorName: string | null; body: string;
    action: { type: string; summary: string } | null;
    actionStatus: 'proposed' | 'applied' | 'dismissed' | 'failed' | null;
    actionResult: string | null; createdAt: string;
};

const SUGGESTIONS: Record<string, string[]> = {
    needs_clarification: ['Why do you need this?', 'What will you search for?'],
    awaiting_call_approval: ['Which of these look strongest?', 'Remove any vendor outside the city', 'What will Meera ask them?'],
    calling: ['How are the calls going?', 'Who has picked up so far?'],
    ranked: ['Why is #1 ranked first?', 'Who should get the BOQ?', 'Any red flags?'],
    notified: ['Why is #1 ranked first?', 'Who should get the BOQ?', 'Find more vendors'],
    failed: ['What went wrong?', 'Search a wider area'],
};

/** Minimal, safe rendering: **bold** and line breaks, nothing else. */
function Rich({ text }: { text: string }) {
    return (
        <>
            {text.split('\n').map((line, i) => (
                <span key={i} style={{ display: 'block' }}>
                    {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
                        part.startsWith('**') && part.endsWith('**') ? <b key={j}>{part.slice(2, -2)}</b> : <Fragment key={j}>{part}</Fragment>,
                    )}
                </span>
            ))}
        </>
    );
}
function Fragment({ children }: { children: React.ReactNode }) { return <>{children}</>; }

export default function SatejChat({ orgId, requirement, onChanged }: {
    orgId: string;
    requirement: any;
    /** The requirement may have changed (a proposal applied, minutes posted). */
    onChanged: () => void;
}) {
    const [messages, setMessages] = useState<Message[] | null>(null);
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [deciding, setDeciding] = useState<string | null>(null);
    const [err, setErr] = useState('');
    const [calling, setCalling] = useState(false);
    const endRef = useRef<HTMLDivElement | null>(null);
    const base = `/api/satej/requirements/${requirement.id}/messages`;

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${base}?organizationId=${orgId}`, { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Could not load the conversation (${res.status})`);
            setMessages(data.messages);
            setErr('');
        } catch (e: any) {
            setErr(e.message);
        }
    }, [base, orgId]);

    useEffect(() => {
        setMessages(null);
        void load();
        const t = setInterval(load, 12000);
        return () => clearInterval(t);
    }, [load]);

    useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages?.length, sending]);

    const send = async (body: string) => {
        const msg = body.trim();
        if (!msg || sending) return;
        setSending(true);
        setErr('');
        setText('');
        // Show the person's message at once; Meera's answer follows.
        setMessages((m) => [...(m ?? []), { id: `tmp-${Date.now()}`, role: 'user', kind: 'chat', authorName: 'You', body: msg, action: null, actionStatus: null, actionResult: null, createdAt: new Date().toISOString() }]);
        try {
            const res = await fetch(base, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId: orgId, text: msg }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Could not send (${res.status})`);
            await load();
        } catch (e: any) {
            setErr(e.message);
            setText(msg);
            await load();
        } finally {
            setSending(false);
        }
    };

    const decide = async (m: Message, decision: 'apply' | 'dismiss') => {
        setDeciding(m.id);
        setErr('');
        try {
            const res = await fetch(`${base}/${m.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId: orgId, decision }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Could not ${decision} (${res.status})`);
            await load();
            onChanged();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setDeciding(null);
        }
    };

    const working = ['submitted', 'structured', 'discovering', 'calling', 'calls_done', 'analyzing'].includes(requirement.status);
    const suggestions = SUGGESTIONS[requirement.status] ?? ['What is happening right now?'];

    return (
        <aside className={s.chat}>
            <header className={s.chatHead}>
                <div className={s.avatar}>S<span className={`${s.presence} ${working ? s.presenceBusy : ''}`} /></div>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <b>Meera</b>
                    <div className={s.muted}>{working ? (requirement.live?.detail ?? 'Working on this requirement') : 'Vendor discovery agent'}</div>
                </div>
                <button className={s.callBtn} onClick={() => setCalling(true)} title="Talk to Meera by voice">
                    <Phone size={15} /> Call
                </button>
            </header>

            <div className={s.thread}>
                {messages === null && !err && <p className={s.muted}>Loading the conversation…</p>}
                {messages?.length === 0 && (
                    <div className={s.emptyChat}>
                        <Sparkles size={18} />
                        <p>Ask Meera anything about this requirement — who it found, why a vendor ranked where it did, or ask it to change the request. It proposes changes; you apply them.</p>
                    </div>
                )}
                <AnimatePresence initial={false}>
                    {(messages ?? []).map((m) => (
                        <motion.div
                            key={m.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`${s.msg} ${m.role === 'user' ? s.msgMine : s.msgTheirs} ${m.kind === 'call_minutes' ? s.msgMinutes : ''}`}
                        >
                            <div className={s.msgMeta}>
                                {m.role === 'user' ? (m.authorName ?? 'You') : m.kind === 'call_minutes' ? 'Meera · call minutes' : 'Meera'}
                                {' · '}
                                {new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div className={s.bubble}><Rich text={m.body} /></div>
                            {m.action && (
                                <div className={`${s.proposal} ${m.actionStatus !== 'proposed' ? s.proposalDone : ''}`}>
                                    <div className={s.proposalTitle}>Proposed change</div>
                                    <div>{m.action.summary}</div>
                                    {m.actionStatus === 'proposed' ? (
                                        <div className={s.proposalBtns}>
                                            <button className={s.primary} disabled={!!deciding} onClick={() => void decide(m, 'apply')}>
                                                {deciding === m.id ? <Loader2 size={13} className={s.spin} /> : <Check size={13} />} Apply
                                            </button>
                                            <button className={s.ghost} disabled={!!deciding} onClick={() => void decide(m, 'dismiss')}><X size={13} /> Dismiss</button>
                                        </div>
                                    ) : (
                                        <div className={m.actionStatus === 'failed' ? s.badText : s.muted}>
                                            {m.actionStatus === 'applied' ? 'Applied' : m.actionStatus === 'failed' ? 'Could not apply' : 'Dismissed'}
                                            {m.actionResult ? ` — ${m.actionResult}` : ''}
                                        </div>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>
                {sending && (
                    <div className={`${s.msg} ${s.msgTheirs}`}>
                        <div className={s.msgMeta}>Meera</div>
                        <div className={`${s.bubble} ${s.typing}`}><span /><span /><span /></div>
                    </div>
                )}
                <div ref={endRef} />
            </div>

            {err && <div className={s.errorBox} style={{ margin: '0 12px' }}>{err}</div>}

            <div className={s.suggestions}>
                {suggestions.map((q) => (
                    <button key={q} className={s.suggestion} disabled={sending} onClick={() => void send(q)}>{q}</button>
                ))}
            </div>
            <form className={s.composer} onSubmit={(e) => { e.preventDefault(); void send(text); }}>
                <textarea
                    rows={1}
                    value={text}
                    placeholder="Message Meera…"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
                />
                <button className={s.sendBtn} disabled={!text.trim() || sending} aria-label="Send"><Send size={15} /></button>
            </form>

            {calling && (
                <SatejCall
                    orgId={orgId}
                    requirementId={requirement.id}
                    title={requirement.input.title}
                    onClose={() => setCalling(false)}
                    onMinutes={() => { void load(); onChanged(); }}
                />
            )}
        </aside>
    );
}
