'use client';

/**
 * The FAQ tab: the answers Meera may give vendors on a call (/api/satej/faq).
 *
 * Seeded from her real calls and the Zoho history. Anyone on the procurement
 * team can add or edit a draft; approving an answer and publishing the FAQ into
 * her live script is for org super admins and master admins, the same people
 * who can publish the Caller script. Every publish is versioned there.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Send, X } from 'lucide-react';
import s from './satej.module.css';


const TOPIC_LABEL: Record<string, string> = {
    about_us: 'About us',
    this_requirement: 'This requirement',
    process: 'How we work',
    payment: 'Payment',
    gst: 'GST',
    rates: 'Rates',
    objections: 'Objections',
    identity: 'Who is calling',
    general: 'General',
};
const SOURCE_LABEL: Record<string, string> = { calls: 'from real calls', zoho: 'from Zoho', team: 'team' };

type Entry = {
    id: string; topic: string; question: string; answer: string; status: 'draft' | 'approved' | 'archived';
    source: string; evidence: string | null; sortOrder: number; updatedBy: string | null; updatedAt: string;
};

export default function SatejFaq({ orgId }: { orgId: string }) {
    const [entries, setEntries] = useState<Entry[] | null>(null);
    const [canPublish, setCanPublish] = useState(false);
    const [section, setSection] = useState('');
    const [err, setErr] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [busy, setBusy] = useState('');
    const [editing, setEditing] = useState<string | null>(null); // entry id, or 'new'

    const load = useCallback(async () => {
        try {
            const r = await fetch(`/api/satej/faq?organizationId=${orgId}`);
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setEntries(j.entries); setCanPublish(j.canPublish); setSection(j.section); setErr(null);
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        }
    }, [orgId]);
    useEffect(() => { void load(); }, [load]);

    async function post(body: object, key: string) {
        setBusy(key); setErr(null); setNote(null);
        try {
            const r = await fetch('/api/satej/faq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, ...body }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            await load();
            return j;
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            return null;
        } finally {
            setBusy('');
        }
    }

    const grouped = useMemo(() => {
        const m = new Map<string, Entry[]>();
        for (const e of entries ?? []) (m.get(e.topic) ?? m.set(e.topic, []).get(e.topic)!).push(e);
        return [...m];
    }, [entries]);
    const approved = (entries ?? []).filter((e) => e.status === 'approved').length;
    const drafts = (entries ?? []).filter((e) => e.status === 'draft').length;

    return (
        <div>
            <section className={s.card}>
                <div className={s.boardHead}>
                    <div>
                        <h3>What Meera can answer</h3>
                        <p className={s.muted}>
                            {entries === null ? 'Loading…' : `${approved} approved · ${drafts} draft${drafts === 1 ? '' : 's'}.`} Only approved answers go into Meera&apos;s script, and only when published.
                            Write answers the way you would say them on the phone: one or two short sentences.
                        </p>
                    </div>
                    <div className={s.actions}>
                        <button className={s.ghost} disabled={!!busy || entries === null} onClick={() => setEditing('new')}><Plus size={14} /> Add a question</button>
                        {canPublish && (
                            <button className={s.primary} disabled={!!busy || !approved} onClick={async () => {
                                const j = await post({ action: 'publish' }, 'publish');
                                if (j) setNote(`Published to Meera. The Caller script tab keeps the version before this one.`);
                            }}>
                                {busy === 'publish' ? <Loader2 size={14} className={s.spin} /> : <Send size={14} />} Publish to Meera
                            </button>
                        )}
                    </div>
                </div>
                {!canPublish && entries !== null && <p className={s.muted}>You can add and edit drafts. An org super admin or master admin approves them and publishes to Meera.</p>}
                {note && <div className={s.infoBox}>{note}</div>}
                {err && <div className={s.errorBox}>{err}</div>}
            </section>

            {editing === 'new' && (
                <section className={s.card}>
                    <FaqEditor busy={busy === 'new'} onCancel={() => setEditing(null)} onSave={async (entry) => {
                        if (await post({ action: 'create', entry }, 'new')) setEditing(null);
                    }} />
                </section>
            )}

            {grouped.map(([topic, list]) => (
                <section key={topic} className={s.card}>
                    <h3>{TOPIC_LABEL[topic] ?? topic}</h3>
                    <ul className={s.faqList}>
                        {list.map((e) => (
                            <li key={e.id} className={`${s.faqItem} ${e.status === 'draft' ? s.faqDraft : ''}`}>
                                {editing === e.id ? (
                                    <FaqEditor initial={e} busy={busy === e.id} onCancel={() => setEditing(null)} onSave={async (entry) => {
                                        if (await post({ action: 'update', id: e.id, entry }, e.id)) setEditing(null);
                                    }} />
                                ) : (
                                    <>
                                        <div className={s.faqQ}>
                                            <b>“{e.question}”</b>
                                            <span className={`${s.chip} ${e.status === 'approved' ? s.good : s.warn}`}>{e.status === 'approved' ? 'Approved' : 'Draft'}</span>
                                        </div>
                                        <div className={s.faqA}>{e.answer}</div>
                                        <div className={s.faqMeta}>
                                            <span className={s.muted}>{SOURCE_LABEL[e.source] ?? e.source}{e.evidence ? ` · ${e.evidence}` : ''}{e.updatedBy ? ` · edited by ${e.updatedBy}` : ''}</span>
                                            <span className={s.actions}>
                                                <button className={s.link} onClick={() => setEditing(e.id)}><Pencil size={12} /> Edit</button>
                                                {canPublish && e.status === 'draft' && (
                                                    <button className={s.link} disabled={!!busy} onClick={() => post({ action: 'update', id: e.id, entry: { status: 'approved' } }, e.id)}><Check size={12} /> Approve</button>
                                                )}
                                                {canPublish && e.status === 'approved' && (
                                                    <button className={s.link} disabled={!!busy} onClick={() => post({ action: 'update', id: e.id, entry: { status: 'draft' } }, e.id)}>Back to draft</button>
                                                )}
                                                {canPublish && (
                                                    <button className={s.link} disabled={!!busy} onClick={() => post({ action: 'update', id: e.id, entry: { status: 'archived' } }, e.id)}><X size={12} /> Remove</button>
                                                )}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            ))}

            {section && (
                <details className={s.card}>
                    <summary className={s.detailsSummary}>Exactly what Meera reads (approved answers only)</summary>
                    <pre className={s.promptView}>{section}</pre>
                </details>
            )}
        </div>
    );
}

function FaqEditor({ initial, busy, onSave, onCancel }: {
    initial?: Entry; busy: boolean; onSave: (e: { topic: string; question: string; answer: string }) => void; onCancel: () => void;
}) {
    const [topic, setTopic] = useState(initial?.topic ?? 'general');
    const [question, setQuestion] = useState(initial?.question ?? '');
    const [answer, setAnswer] = useState(initial?.answer ?? '');
    return (
        <form onSubmit={(e) => { e.preventDefault(); onSave({ topic, question, answer }); }}>
            <div className={s.grid}>
                <label>Topic
                    <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                        {Object.entries(TOPIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                </label>
                <span />
                <label className={s.full}>The question, the way vendors ask it
                    <input required value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Payment kab milega?" />
                </label>
                <label className={s.full}>What Meera says (one or two short sentences)
                    <textarea required rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Payment terms PO में लिखे होते हैं, team quotation के बाद बताएगी।" />
                </label>
            </div>
            <p className={s.muted}>You may use {'{location_text}'} or {'{quantity_text}'}; Meera fills them from the requirement. Saved as a draft until approved.</p>
            <div className={s.actions}>
                <button type="button" className={s.ghost} onClick={onCancel}>Cancel</button>
                <button className={s.primary} disabled={busy}>{busy && <Loader2 size={14} className={s.spin} />} Save</button>
            </div>
        </form>
    );
}
