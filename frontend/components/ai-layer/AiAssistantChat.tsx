'use client';

/**
 * In-app AI assistant chat. Sends each message with the conversation state the server returned last time; the server
 * re-checks everything in that state, so the browser holds nothing that grants access.
 */
import { useRef, useState } from 'react';

interface Message { from: 'me' | 'ai'; text: string; options?: string[] }

const EXAMPLES = ['aaj kitne tickets bane?', "What's the electricity meter readings status?", 'AC not working in my cabin'];

export default function AiAssistantChat({ organizationId }: { organizationId: string }) {
    const [messages, setMessages] = useState<Message[]>([{ from: 'ai', text: 'Hi! Ask me about tickets or meter readings, or tell me about a problem and I will raise a ticket. English, Hindi or Hinglish.' }]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const state = useRef<unknown>(null);
    const end = useRef<HTMLDivElement>(null);

    async function send(text: string) {
        const message = text.trim();
        if (!message || busy) return;
        setInput('');
        setMessages(m => [...m, { from: 'me', text: message }]);
        setBusy(true);
        try {
            const r = await fetch('/api/ai-layer/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, message, state: state.current }) });
            const d = await r.json();
            state.current = d.state ?? null;
            setMessages(m => [...m, { from: 'ai', text: d.reply?.text || d.error || 'Something went wrong.', options: d.reply?.options }]);
        } catch {
            setMessages(m => [...m, { from: 'ai', text: 'Could not reach the assistant. Please try again.' }]);
        } finally {
            setBusy(false);
            setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        }
    }

    const last = messages[messages.length - 1];
    return (
        <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
                <h1 className="text-base font-black text-slate-900">AI Assistant</h1>
                <p className="text-xs text-slate-500">Answers only cover the buildings and records you can already see in the app.</p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.map((m, i) => (
                    <div key={i} className={m.from === 'me' ? 'flex justify-end' : 'flex justify-start'}>
                        <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${m.from === 'me' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-800'}`}>{m.text}</div>
                    </div>
                ))}
                {busy && <div className="text-xs text-slate-400">Thinking…</div>}
                <div ref={end} />
            </div>
            {last.from === 'ai' && last.options && last.options.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pb-2">
                    {last.options.map((o, i) => <button key={o} type="button" onClick={() => send(/^(Yes|Change|Cancel|हाँ|बदलें|रद्द करें)$/.test(o) ? o : String(i + 1))} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold hover:bg-slate-50">{o}</button>)}
                </div>
            )}
            {messages.length === 1 && (
                <div className="flex flex-wrap gap-2 px-4 pb-2">
                    {EXAMPLES.map(e => <button key={e} type="button" onClick={() => send(e)} className="rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">{e}</button>)}
                </div>
            )}
            <form onSubmit={e => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-100 p-3">
                <input value={input} onChange={e => setInput(e.target.value)} maxLength={1500} placeholder="Type a message…" className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <button type="submit" disabled={busy || !input.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Send</button>
            </form>
        </div>
    );
}
