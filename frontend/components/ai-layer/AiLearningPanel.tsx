'use client';

/**
 * AI Assistant learning (org super admin): review the messages the AI probably got wrong, teach the right answer,
 * see / remove what it learned, and write instruction versions that go live only after a test run.
 * Modelled on the Task Manager's "Review mistakes" + "Prompt versions" (frontend/components/task-manager/BotLearningPanel.tsx).
 */
import { useCallback, useEffect, useState } from 'react';

interface Entry { id: string; kind: string; label: string }
interface ReviewItem { id: string; created_at: string; user_name: string | null; channel: string; message_text: string; follow_up_text: string | null; bot_reply: string | null; entry_id: string | null; triggers: string[] }
interface ExampleRow { id: string; created_at: string; message_text: string; entry_id: string; fields: Record<string, unknown> }
interface Version { id: string; created_at: string; instructions: string; status: 'draft' | 'active' | 'retired'; pass_rate: number | null; tested_count: number | null; tested_at: string | null }
interface Report { total: number; passed: number; passRate: number; failures: Array<{ message: string; expected: string; got: string }> }

const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_7_days', 'Last 7 days'], ['this_month', 'This month'], ['last_month', 'Last month']] as const;
/** Which details each answer takes, so the teach form only shows what matters. */
const FIELDS: Record<string, Array<'period' | 'status' | 'day' | 'property_name' | 'urgent'>> = {
    'tickets.count': ['period', 'status', 'property_name'],
    'tickets.list': ['period', 'status', 'property_name'],
    'electricity.readings_status': ['day', 'property_name'],
    'electricity.consumption': ['period', 'property_name'],
    'ticket.create': ['urgent'],
};
const TRIGGER_LABEL: Record<string, string> = {
    unknown: "Didn't understand", correction: 'Person said "no / I meant"', rephrase: 'Person asked again',
    repeated_clarify: 'Kept asking the same question', too_many_questions: 'Gave up after too many questions',
};

const card = 'bg-white rounded-2xl border border-slate-200 p-4 md:p-6';
const h = 'text-sm font-black text-slate-900';
const sub = 'text-xs text-slate-500 mt-1';
const btn = 'rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold hover:bg-slate-50 disabled:opacity-50';
const primary = 'rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50';

/** The "what should it have done" picker: an answer + its details. */
function AnswerPicker({ entries, value, onChange }: { entries: Entry[]; value: { entryId: string; fields: Record<string, unknown> }; onChange: (v: { entryId: string; fields: Record<string, unknown> }) => void }) {
    const want = FIELDS[value.entryId] || [];
    const setField = (k: string, v: unknown) => onChange({ ...value, fields: { ...value.fields, [k]: v === '' ? undefined : v } });
    const sel = 'rounded-lg border border-slate-200 px-2 py-1 text-xs';
    return (
        <div className="flex flex-wrap items-center gap-2">
            <select className={sel} value={value.entryId} onChange={e => onChange({ entryId: e.target.value, fields: {} })}>
                <option value="">Choose the right answer…</option>
                {entries.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            {want.includes('period') && <select className={sel} value={String(value.fields.period ?? 'today')} onChange={e => setField('period', e.target.value)}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
            {want.includes('day') && <select className={sel} value={String(value.fields.day ?? 'today')} onChange={e => setField('day', e.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option></select>}
            {want.includes('status') && <select className={sel} value={String(value.fields.status ?? 'all')} onChange={e => setField('status', e.target.value)}><option value="all">All</option><option value="open">Open</option><option value="closed">Closed</option></select>}
            {want.includes('property_name') && <input className={sel} placeholder="Property (optional)" value={String(value.fields.property_name ?? '')} onChange={e => setField('property_name', e.target.value)} />}
            {want.includes('urgent') && <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={value.fields.urgent === true} onChange={e => setField('urgent', e.target.checked)} /> urgent</label>}
        </div>
    );
}

export default function AiLearningPanel({ organizationId }: { organizationId: string }) {
    const [data, setData] = useState<{ tableMissing: boolean; review: ReviewItem[]; examples: ExampleRow[]; versions: Version[]; entries: Entry[] } | null>(null);
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState('');
    const [teach, setTeach] = useState<Record<string, { entryId: string; fields: Record<string, unknown> }>>({});
    const [newExample, setNewExample] = useState({ message: '', answer: { entryId: '', fields: {} as Record<string, unknown> } });
    const [draft, setDraft] = useState('');
    const [reports, setReports] = useState<Record<string, Report>>({});

    const load = useCallback(async () => {
        try {
            const r = await fetch(`/api/ai-layer/learning?organizationId=${encodeURIComponent(organizationId)}`, { cache: 'no-store' });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Could not load');
            setData(d);
        } catch (err) { setStatus(err instanceof Error ? err.message : 'Could not load'); }
    }, [organizationId]);
    useEffect(() => { load(); }, [load]);

    async function act(key: string, payload: Record<string, unknown>, okMsg: string) {
        setBusy(key); setStatus('');
        try {
            const r = await fetch('/api/ai-layer/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId, ...payload }) });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Failed');
            if (d.report) setReports(x => ({ ...x, [String(payload.id)]: d.report }));
            setStatus(okMsg);
            await load();
            return true;
        } catch (err) { setStatus(err instanceof Error ? err.message : 'Failed'); return false; }
        finally { setBusy(''); }
    }

    if (!data) return <div className={card}><p className="text-sm text-slate-500">{status || 'Loading learning…'}</p></div>;
    if (data.tableMissing) return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Learning is not set up yet. Your team needs to run the migration <code>20261104000003_ai_learning.sql</code>.
        </div>
    );
    const entryLabel = (id: string | null) => data.entries.find(e => e.id === id)?.label ?? id ?? '·';
    const live = data.versions.find(v => v.status === 'active');

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-black text-slate-900">Learning</h2>
                <p className="text-sm text-slate-500">Teach the AI assistant what people mean. Turn on <b>Learning loop</b> above so it flags its likely mistakes here.</p>
                {status && <p className="mt-2 text-sm text-slate-700">{status}</p>}
            </div>

            <section className={card}>
                <p className={h}>Review mistakes <span className="text-xs font-normal text-slate-500">({data.review.length})</span></p>
                <p className={sub}>Messages the AI probably got wrong. Pick what it should have done and click Teach: it learns it, and it becomes a test.</p>
                {data.review.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nothing to review.</p> : (
                    <ul className="mt-3 space-y-3">
                        {data.review.map(item => {
                            const t = teach[item.id] ?? { entryId: '', fields: {} };
                            return (
                                <li key={item.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                                    <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                                        <span>{new Date(item.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                        <span>{item.user_name ?? ''}</span><span>{item.channel === 'whatsapp' ? 'WhatsApp' : 'In-app'}</span>
                                        {item.triggers.map(tr => <span key={tr} className="rounded-full bg-rose-100 px-2 text-rose-800 font-bold">{TRIGGER_LABEL[tr] ?? tr}</span>)}
                                    </div>
                                    <p className="mt-2"><span className="text-slate-500">They said:</span> <b>{item.message_text}</b></p>
                                    {item.bot_reply && <p className="mt-1 text-slate-600"><span className="text-slate-500">AI replied:</span> {item.bot_reply}</p>}
                                    {item.follow_up_text && <p className="mt-1"><span className="text-slate-500">Then they said:</span> {item.follow_up_text}</p>}
                                    {item.entry_id && <p className="mt-1 text-xs text-slate-500">AI chose: {entryLabel(item.entry_id)}</p>}
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <AnswerPicker entries={data.entries} value={t} onChange={v => setTeach(x => ({ ...x, [item.id]: v }))} />
                                        <button className={primary} disabled={!t.entryId || !!busy} onClick={() => act(item.id, { action: 'teach', reviewId: item.id, entryId: t.entryId, fields: t.fields }, 'Taught. The AI uses it within a minute.')}>Teach</button>
                                        <button className={btn} disabled={!!busy} onClick={() => act(item.id, { action: 'ignore', reviewId: item.id }, 'Ignored.')}>Ignore</button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <section className={card}>
                <p className={h}>Taught examples <span className="text-xs font-normal text-slate-500">({data.examples.length})</span></p>
                <p className={sub}>What the AI has learned for this organization. They guide it on similar messages and are the tests for new instructions.</p>
                <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-3">
                    <p className="text-xs font-bold text-slate-700">Teach a new example</p>
                    <input className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder='What people say, e.g. "what is missing"' value={newExample.message} maxLength={600}
                        onChange={e => setNewExample(x => ({ ...x, message: e.target.value }))} />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <AnswerPicker entries={data.entries} value={newExample.answer} onChange={v => setNewExample(x => ({ ...x, answer: v }))} />
                        <button className={primary} disabled={!newExample.message.trim() || !newExample.answer.entryId || !!busy}
                            onClick={async () => { if (await act('new', { action: 'add_example', message: newExample.message, entryId: newExample.answer.entryId, fields: newExample.answer.fields }, 'Example added.')) setNewExample({ message: '', answer: { entryId: '', fields: {} } }); }}>Add example</button>
                    </div>
                </div>
                {data.examples.length > 0 && (
                    <ul className="mt-3 divide-y divide-slate-100">
                        {data.examples.map(e => (
                            <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <span><b>&ldquo;{e.message_text}&rdquo;</b> <span className="text-slate-500">→ {entryLabel(e.entry_id)} {Object.keys(e.fields || {}).length ? JSON.stringify(e.fields) : ''}</span></span>
                                <button className={btn} disabled={!!busy} onClick={() => act(e.id, { action: 'delete_example', id: e.id }, 'Example removed.')}>Remove</button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className={card}>
                <p className={h}>Instructions</p>
                <p className={sub}>Extra guidance for how the AI understands your people (e.g. &ldquo;&lsquo;DG&rsquo; means the diesel generator meter&rdquo;). A version goes live only after <b>Test</b> and only if it scores at least as well as the live one. Safety rules and who-sees-what can&apos;t be changed here.</p>
                <textarea className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={4} maxLength={4000} placeholder="Write instructions…" value={draft} onChange={e => setDraft(e.target.value)} />
                <div className="mt-2 flex gap-2">
                    <button className={primary} disabled={!draft.trim() || !!busy} onClick={async () => { if (await act('save', { action: 'save_version', instructions: draft }, 'Saved as a draft. Click Test, then Activate.')) setDraft(''); }}>Save as draft</button>
                    {live && <button className={btn} disabled={!!busy} onClick={() => act('off', { action: 'deactivate_versions' }, 'Instructions turned off.')}>Turn off live instructions</button>}
                </div>
                {data.versions.length > 0 && (
                    <ul className="mt-3 space-y-2">
                        {data.versions.map(v => {
                            const rep = reports[v.id];
                            return (
                                <li key={v.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-xs text-slate-500">
                                            {new Date(v.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                                            <b className={v.status === 'active' ? 'text-emerald-700' : ''}>{v.status === 'active' ? 'LIVE' : v.status}</b>
                                            {v.tested_at ? ` · tested: ${Math.round(Number(v.pass_rate ?? 0) * 100)}% of ${v.tested_count}` : ' · not tested'}
                                        </span>
                                        {v.status !== 'active' && (
                                            <span className="flex gap-2">
                                                <button className={btn} disabled={!!busy} onClick={() => act(v.id, { action: 'test_version', id: v.id }, 'Test finished.')}>{busy === v.id ? 'Testing…' : 'Test'}</button>
                                                <button className={primary} disabled={!!busy || !v.tested_at} onClick={() => act(v.id, { action: 'activate_version', id: v.id }, 'Activated. The AI uses it within a minute.')}>Activate</button>
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-2 whitespace-pre-wrap text-slate-700">{v.instructions}</p>
                                    {rep && (
                                        <div className="mt-2 text-xs">
                                            <p className="font-bold">{rep.passed} of {rep.total} taught examples answered correctly.</p>
                                            {rep.failures.slice(0, 10).map((f, i) => <p key={i} className="text-rose-700">✗ &ldquo;{f.message}&rdquo;: expected {f.expected}, got {f.got}</p>)}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}
