'use client';

/**
 * CALLER SCRIPT — what Meera says to vendors, and how her calls actually went.
 *
 * Left: her live greeting (and how one vendor would hear it), her full system
 * prompt, a feedback box that returns a revision to review, and Publish, which
 * pushes the script to Bolna (admins only; the old version is saved first).
 * Right: her calls from the last 7 days — each recording playable as MP3, its
 * transcript, and "Use as feedback" to quote a call when asking for a change.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, History, Loader2, Pencil, Send, Sparkles, Undo2, Upload, Wand2 } from 'lucide-react';
import s from './satej.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Payload = {
    script: { name: string; welcome: string; prompt: string; voice: string | null; voiceModel: string | null; llm: string | null; updatedAt: string | null };
    problems: string[];
    variables: string[];
    preview: { vendor: string; text: string; requirement: string; title: string } | null;
    calls: { id: string; createdAt: string; status: string; durationSec: number | null; toNumber: string; hasRecording: boolean; transcript: string; variables: Record<string, string> }[] | null;
    versions: { id: string; kind: string; welcome: string; prompt: string; note: string | null; by: string | null; createdAt: string }[];
    versionsTableMissing: boolean;
    canPublish: boolean;
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

async function api(path: string, init?: RequestInit) {
    const res = await fetch(path, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

/** Variables highlighted so it is obvious what each call fills in. */
function Highlighted({ text }: { text: string }) {
    return (
        <>
            {text.split(/(\{\{?\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}?\})/g).map((part, i) =>
                /^\{/.test(part) ? <mark key={i} className={s.varMark}>{part}</mark> : <span key={i}>{part}</span>,
            )}
        </>
    );
}

export default function SatejVoiceScript({ orgId, seedTranscript }: { orgId: string; seedTranscript?: string | null }) {
    const [d, setD] = useState<Payload | null>(null);
    const [err, setErr] = useState('');
    const [editing, setEditing] = useState(false);
    const [welcome, setWelcome] = useState('');
    const [prompt, setPrompt] = useState('');
    const [feedback, setFeedback] = useState('');
    const [quoted, setQuoted] = useState<string[]>([]);
    const [suggestion, setSuggestion] = useState<{ welcome: string; prompt: string; changes: string[]; problems: string[] } | null>(null);
    const [busy, setBusy] = useState('');
    const [note, setNote] = useState('');
    const [done, setDone] = useState('');

    const load = useCallback(async () => {
        try {
            const data: Payload = await api(`/api/satej/voice?organizationId=${orgId}`);
            setD(data);
            setErr('');
            if (!editing) { setWelcome(data.script.welcome); setPrompt(data.script.prompt); }
        } catch (e: any) {
            setErr(e.message);
        }
    }, [orgId, editing]);

    useEffect(() => { void load(); }, [load]);

    // Arrived from a test call's "Improve the script": quote it and put the cursor in the feedback box.
    useEffect(() => {
        if (!seedTranscript) return;
        setQuoted((q) => [...q.filter((x) => x !== seedTranscript), seedTranscript].slice(-3));
        setTimeout(() => (document.querySelector('textarea[placeholder^="e.g. Introduce"]') as HTMLTextAreaElement | null)?.focus(), 300);
    }, [seedTranscript]);

    const dirty = !!d && (welcome !== d.script.welcome || prompt !== d.script.prompt);
    const draftVars = useMemo(() => {
        const found = new Set<string>();
        for (const m of `${welcome}\n${prompt}`.matchAll(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g)) found.add(m[1]);
        return [...found];
    }, [welcome, prompt]);
    const SYSTEM = ['agent_id', 'execution_id', 'call_sid', 'from_number', 'to_number', 'current_date', 'current_time', 'timezone'];
    const strayVars = d ? draftVars.filter((v) => !d.variables.includes(v) && !SYSTEM.includes(v)) : [];

    const suggest = async () => {
        setBusy('suggest'); setErr(''); setSuggestion(null);
        try {
            const r = await api('/api/satej/voice', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: 'suggest', welcome, prompt, feedback, transcripts: quoted }) });
            setSuggestion(r.suggestion);
        } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
    };

    const publish = async () => {
        if (!confirm('Publish this script to Meera? Every vendor call from now on uses it. The current script is saved first and can be restored.')) return;
        setBusy('publish'); setErr(''); setDone('');
        try {
            await api('/api/satej/voice', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: 'publish', welcome, prompt, note }) });
            setDone('Published. Meera uses this script from the next call.');
            setEditing(false); setNote(''); setSuggestion(null);
            await load();
        } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
    };

    if (!d) return err ? <div className={s.errorBox}>{err}</div> : <div className={s.skeleton} />;

    return (
        <div className={s.voiceLayout}>
            <div style={{ minWidth: 0 }}>
                <section className={s.card}>
                    <div className={s.boardHead}>
                        <div>
                            <h3>What Meera says to vendors</h3>
                            <p className={s.muted}>
                                Live on Bolna · {d.script.name} · voice {d.script.voice ?? '—'} ({d.script.voiceModel ?? '—'}) · thinks with {d.script.llm ?? '—'}
                                {d.script.updatedAt ? ` · last changed ${fmt(d.script.updatedAt)}` : ''}
                            </p>
                        </div>
                        {!editing
                            ? <button className={s.ghost} onClick={() => setEditing(true)}><Pencil size={14} /> Edit script</button>
                            : <button className={s.ghost} onClick={() => { setEditing(false); setWelcome(d.script.welcome); setPrompt(d.script.prompt); setSuggestion(null); }}><Undo2 size={14} /> Discard changes</button>}
                    </div>

                    <h4 className={s.subhead}>Her opening line</h4>
                    {editing
                        ? <textarea className={s.scriptArea} rows={2} value={welcome} onChange={(e) => setWelcome(e.target.value)} />
                        : <div className={s.quote}><Highlighted text={d.script.welcome} /></div>}
                    {d.preview && (
                        <p className={s.muted} style={{ marginTop: 6 }}>
                            How {d.preview.vendor} hears it for {d.preview.requirement}: <i>“{d.preview.text}”</i>
                        </p>
                    )}

                    <h4 className={s.subhead}>How she introduces Autopilot and runs the call</h4>
                    {editing
                        ? <textarea className={s.scriptArea} rows={22} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                        : <pre className={s.promptView}><Highlighted text={d.script.prompt} /></pre>}

                    <p className={s.muted} style={{ marginTop: 8 }}>
                        Filled in for each vendor from Meera&apos;s call list: {d.variables.map((v) => <code key={v} className={s.varChip}>{`{${v}}`}</code>)}
                    </p>
                    {strayVars.length > 0 && (
                        <div className={s.errorBox}>These are not filled by Meera and would be spoken as blanks: {strayVars.join(', ')}</div>
                    )}
                    {d.problems.length > 0 && !editing && <div className={s.noteBox}>{d.problems.join(' · ')}</div>}
                </section>

                <section className={s.card}>
                    <h3><Wand2 size={15} /> Ask for a change</h3>
                    <p className={s.muted}>Say what should be different — tone, the introduction, a question to add or drop. You get a revision to review; nothing goes live until it is published.</p>
                    <textarea className={s.scriptArea} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)}
                        placeholder="e.g. Introduce Autopilot as a managed office operator with 40+ centres before asking anything; ask for the GST number only at the end." />
                    {quoted.length > 0 && (
                        <p className={s.muted}>Including {quoted.length} call transcript{quoted.length > 1 ? 's' : ''} as evidence · <button className={s.link} onClick={() => setQuoted([])}>remove</button></p>
                    )}
                    <div className={s.actions} style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                        <button className={s.primary} disabled={busy === 'suggest' || feedback.trim().length < 5} onClick={() => void suggest()}>
                            {busy === 'suggest' ? <Loader2 size={14} className={s.spin} /> : <Sparkles size={14} />} Suggest a revision
                        </button>
                    </div>
                    {suggestion && (
                        <div className={s.suggestionBox}>
                            <b>What would change</b>
                            <ul>{suggestion.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
                            {suggestion.problems.length > 0 && <div className={s.errorBox}>{suggestion.problems.join(' · ')}</div>}
                            <div className={s.actions} style={{ justifyContent: 'flex-start' }}>
                                <button className={s.primary} onClick={() => { setWelcome(suggestion.welcome); setPrompt(suggestion.prompt); setEditing(true); setSuggestion(null); }}>
                                    <Check size={14} /> Use this revision
                                </button>
                                <button className={s.ghost} onClick={() => setSuggestion(null)}>Discard</button>
                            </div>
                        </div>
                    )}
                </section>

                {(editing || dirty) && (
                    <section className={`${s.card} ${s.cardAttention}`}>
                        <h3><Upload size={15} /> Publish to Meera</h3>
                        {d.versionsTableMissing && <div className={s.noteBox}>Publishing needs supabase/migrations/20261003000002_satej_voice_versions.sql applied first, so the current script can be restored.</div>}
                        {!d.canPublish && <div className={s.infoBox}>Only org super admins and master admins can publish. Your draft stays in this page — share it with one of them.</div>}
                        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why (saved with the version)" style={{ width: '100%', marginBottom: 10 }} />
                        <button className={s.primary} disabled={!dirty || !d.canPublish || !!strayVars.length || busy === 'publish' || d.versionsTableMissing} onClick={() => void publish()}>
                            {busy === 'publish' ? <Loader2 size={14} className={s.spin} /> : <Send size={14} />} Publish to Meera
                        </button>
                    </section>
                )}
                {err && <div className={s.errorBox}>{err}</div>}
                {done && <p className={s.ready}><Check size={13} /> {done}</p>}

                {d.versions.length > 0 && (
                    <details className={s.card}>
                        <summary className={s.detailsSummary}><History size={14} style={{ verticalAlign: -2 }} /> Version history ({d.versions.length})</summary>
                        <ul className={s.timeline} style={{ marginTop: 10 }}>
                            {d.versions.map((v) => (
                                <li key={v.id}>
                                    <span className={s.tlDot} />
                                    <div style={{ flex: 1 }}>
                                        <div>{v.kind === 'published' ? 'Published' : 'Was live before a publish'}{v.by ? ` · ${v.by}` : ''}{v.note ? ` — ${v.note}` : ''}</div>
                                        <div className={s.muted}>{fmt(v.createdAt)} · {v.prompt.length.toLocaleString()} characters</div>
                                    </div>
                                    <button className={s.link} onClick={() => { setWelcome(v.welcome); setPrompt(v.prompt); setEditing(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Load to restore</button>
                                </li>
                            ))}
                        </ul>
                    </details>
                )}
            </div>

            <aside className={s.card} style={{ alignSelf: 'start' }}>
                <h3>Her calls · last 30 days</h3>
                {d.calls === null && <p className={s.muted}>Could not read Meera&apos;s calls from Bolna just now.</p>}
                {d.calls?.length === 0 && <p className={s.muted}>No calls in the last 30 days. Recordings appear here as soon as Meera makes calls.</p>}
                <div className={s.callList}>
                    {(d.calls ?? []).slice(0, 25).map((c) => (
                        <details key={c.id} className={s.callItem}>
                            <summary>
                                <b>{c.variables.vendor_name || c.toNumber || 'Call'}</b>
                                <span className={s.muted}>{fmt(c.createdAt)} · {c.status}{c.durationSec ? ` · ${Math.round(c.durationSec)}s` : ''}</span>
                            </summary>
                            {c.hasRecording && (
                                <>
                                    <audio controls preload="none" className={s.audio} src={`/api/satej/voice/recording?organizationId=${orgId}&executionId=${c.id}`} />
                                    <a className={s.link} href={`/api/satej/voice/recording?organizationId=${orgId}&executionId=${c.id}`} download>Download MP3</a>
                                </>
                            )}
                            {c.transcript && <pre className={s.transcript}>{c.transcript}</pre>}
                            {c.transcript && (
                                <button className={s.ghost} style={{ marginTop: 6 }} onClick={() => { setQuoted((q) => [...q.filter((x) => x !== c.transcript), c.transcript].slice(-3)); document.querySelector('textarea[placeholder^="e.g. Introduce"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                                    Use as feedback
                                </button>
                            )}
                        </details>
                    ))}
                </div>
            </aside>
        </div>
    );
}
