'use client';

/**
 * Training chat (org super admin): chat with the AI assistant like ChatGPT and teach it on the spot.
 * Under every AI reply: what it understood, ✓ Correct (saves it as an example) or ✗ Wrong (pick the right answer,
 * then it asks again with what it just learned). Answers use the admin's own access; nothing real is created
 * (raising a ticket always runs in test mode here).
 */
import { useEffect, useRef, useState } from 'react';
import AnswerPicker, { PERIODS, type Answer, type Entry } from './AnswerPicker';

interface Understood { entryId: string | null; fields: Record<string, unknown> | null }
interface Msg {
    id: number;
    from: 'me' | 'ai';
    text: string;
    /** For AI messages: the person's message it answered, and what it understood. */
    question?: string;
    understood?: Understood;
    feedback?: 'correct' | 'taught';
}

const SPECIAL: Record<string, string> = {
    tasks: 'about tasks (sent to the Task Manager)', none: "didn't understand", forbidden: 'not allowed in chat', hr: 'an HR matter (sent to HR Tickets)',
};
const EXAMPLES = ['aaj kitne tickets bane?', 'meter reading status', 'what is missing', 'AC not working in cabin 304', 'show my tasks'];

/** "count tickets · Today · open · SS Plaza" */
function describe(u: Understood | undefined, entries: Entry[]): string {
    if (!u?.entryId) return '·';
    if (SPECIAL[u.entryId]) return SPECIAL[u.entryId];
    const label = entries.find(e => e.id === u.entryId)?.label ?? u.entryId;
    const f = u.fields ?? {};
    const bits = [
        f.period ? PERIODS.find(([v]) => v === f.period)?.[1] : null,
        f.day ? (f.day === 'yesterday' ? 'Yesterday' : 'Today') : null,
        f.status && f.status !== 'all' ? String(f.status) : null,
        f.property_name ? String(f.property_name) : null,
    ].filter(Boolean);
    return [label, ...bits].join(' · ');
}

export default function AiTrainingChat({ organizationId }: { organizationId: string }) {
    const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, from: 'ai', text: "Hi! This is the training chat. Ask me anything your team would ask. Under each answer you'll see what I understood: mark it ✓ Correct, or ✗ Wrong and show me the right answer, and I'll learn it. Nothing real is created here." }]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [entries, setEntries] = useState<Entry[]>([]);
    const [tableMissing, setTableMissing] = useState(false);
    const [teaching, setTeaching] = useState<{ msgId: number; answer: Answer } | null>(null);
    const [note, setNote] = useState('');
    const state = useRef<unknown>(null);
    const nextId = useRef(1);
    const end = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetch(`/api/ai-layer/learning?organizationId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' })
            .then(r => r.json()).then(d => { setEntries(d.entries || []); setTableMissing(!!d.tableMissing); }).catch(() => undefined);
    }, [organizationId]);
    useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy, teaching]);

    async function send(text: string, opts: { fresh?: boolean } = {}) {
        const message = text.trim();
        if (!message || busy) return;
        setInput(''); setNote('');
        setMsgs(m => [...m, { id: nextId.current++, from: 'me', text: message }]);
        setBusy(true);
        try {
            // "Ask again" after teaching starts clean, so the answer shows what it learned, not the last conversation.
            const r = await fetch('/api/ai-layer/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, message, state: opts.fresh ? null : state.current, training: true }) });
            const d = await r.json();
            if (d.state) state.current = d.state;
            setMsgs(m => [...m, { id: nextId.current++, from: 'ai', text: d.reply?.text || d.error || 'Something went wrong.', question: message, understood: d.understood }]);
        } catch {
            setMsgs(m => [...m, { id: nextId.current++, from: 'ai', text: 'Could not reach the assistant. Please try again.' }]);
        } finally { setBusy(false); }
    }

    async function saveExample(msg: Msg, answer: Answer, kind: 'correct' | 'taught') {
        setNote('');
        const r = await fetch('/api/ai-layer/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizationId, action: 'add_example', message: msg.question, entryId: answer.entryId, fields: answer.fields }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setNote(d.error || 'Could not save'); return false; }
        setMsgs(m => m.map(x => (x.id === msg.id ? { ...x, feedback: kind } : x)));
        return true;
    }

    return (
        <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div>
                    <h1 className="text-base font-black text-slate-900">AI training chat</h1>
                    <p className="text-xs text-slate-500">Answers use your own access. Raising a ticket runs in test mode: nothing real is created.</p>
                </div>
                <a href={`/${organizationId}/settings`} className="text-xs font-bold text-primary hover:underline">AI settings</a>
            </div>
            {tableMissing && <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Teaching is not set up yet: your team needs to run the migration <code>20261104000003_ai_learning.sql</code>. You can still chat.</div>}

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {msgs.map(m => (
                    <div key={m.id} className={m.from === 'me' ? 'flex justify-end' : 'flex flex-col items-start'}>
                        <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${m.from === 'me' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-800'}`}>{m.text}</div>
                        {m.from === 'ai' && m.question && (
                            <div className="mt-1 max-w-[85%] text-[11px] text-slate-500">
                                <span>Understood as: <b className="text-slate-700">{describe(m.understood, entries)}</b></span>
                                {m.feedback === 'correct' && <span className="ml-2 font-bold text-emerald-700">✓ Saved as a correct example</span>}
                                {m.feedback === 'taught' && <span className="ml-2 font-bold text-emerald-700">✓ Taught</span>}
                                {!m.feedback && !tableMissing && (
                                    <span className="ml-2 inline-flex gap-2">
                                        {m.understood?.entryId && m.understood.entryId !== 'hr' && m.understood.entryId !== 'forbidden' && (
                                            <button type="button" className="font-bold text-emerald-700 hover:underline"
                                                onClick={() => saveExample(m, { entryId: m.understood!.entryId!, fields: m.understood!.fields ?? {} }, 'correct')}>✓ Correct</button>
                                        )}
                                        <button type="button" className="font-bold text-rose-700 hover:underline" onClick={() => setTeaching({ msgId: m.id, answer: { entryId: '', fields: {} } })}>✗ Wrong, teach it</button>
                                    </span>
                                )}
                                {teaching?.msgId === m.id && (
                                    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
                                        <p className="mb-2 text-xs font-bold text-slate-700">&ldquo;{m.question}&rdquo; should mean:</p>
                                        <AnswerPicker entries={entries} value={teaching.answer} onChange={a => setTeaching({ msgId: m.id, answer: a })} />
                                        <div className="mt-2 flex gap-2">
                                            <button type="button" disabled={!teaching.answer.entryId || busy} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                                                onClick={async () => { if (await saveExample(m, teaching.answer, 'taught')) { setTeaching(null); send(m.question!, { fresh: true }); } }}>Teach &amp; ask again</button>
                                            <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold" onClick={() => setTeaching(null)}>Cancel</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
                {busy && <div className="text-xs text-slate-400">Thinking…</div>}
                <div ref={end} />
            </div>

            {msgs.length === 1 && (
                <div className="flex flex-wrap gap-2 px-4 pb-2">
                    {EXAMPLES.map(e => <button key={e} type="button" onClick={() => send(e)} className="rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">{e}</button>)}
                </div>
            )}
            {note && <p className="px-4 pb-1 text-xs text-rose-700">{note}</p>}
            <form onSubmit={e => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-100 p-3">
                <input value={input} onChange={e => setInput(e.target.value)} maxLength={1500} placeholder="Ask like your team would…" className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <button type="submit" disabled={busy || !input.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Send</button>
                <button type="button" title="Start a new conversation" onClick={() => { state.current = null; setMsgs(m => m.slice(0, 1)); }} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold">New chat</button>
            </form>
        </div>
    );
}
