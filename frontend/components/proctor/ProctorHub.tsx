'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, FileText, Lock, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import Loader from '@/frontend/components/ui/Loader';
import { PROCTOR_SECTIONS } from '@/frontend/lib/proctor/sections';
import { PROCTOR_TEMPLATES, type ProctorTemplate } from '@/frontend/lib/proctor/templates';

/**
 * Proctored tests — the HR "Assessments" tab, and the standalone /proctor page.
 *   Authors (org admins, property admins, HR): write a test (or start from a
 *   template), copy its link, see results.
 *   Everyone else: the tests open to them, and how many chances they have left.
 */

type TestRow = {
    id: string; title: string; duration_minutes: number; ai_monitoring: boolean; is_active: boolean; max_attempts: number;
    question_count: number; created_at: string; my_attempts_used: number; my_completed: boolean;
    people?: number; attempts?: number; terminated?: number;
};
type Draft = { section: string; text: string; options: string[]; answer_index: number };
type ProctorEvent = { kind: string; detail: { reason?: string; observation?: string; error?: string } | null; created_at: string };
type Attempt = {
    id: string; name: string; email: string | null; attempt_no: number; status: string; started_at: string; ended_at: string | null;
    termination_reason: string | null; score: number | null; total: number | null;
    section_scores: Record<string, { score: number; total: number }> | null;
    ai_checks: number; ai_flags: number; events: ProctorEvent[];
};

const STATUS_STYLE: Record<string, string> = {
    submitted: 'bg-emerald-100 text-emerald-800',
    terminated: 'bg-rose-100 text-rose-800',
    expired: 'bg-amber-100 text-amber-800',
    in_progress: 'bg-sky-100 text-sky-800',
    abandoned: 'bg-slate-200 text-slate-700',
};
const REASON: Record<string, string> = {
    tab_hidden: 'Switched tab / minimised',
    window_blur: 'Switched to another app',
    fullscreen_exit: 'Left fullscreen',
    page_unload: 'Closed / refreshed page',
    camera_lost: 'Camera turned off',
    reopened: 'Reopened the test mid-way',
};

const emptyQuestion = (section = 'cognitive'): Draft => ({ section, text: '', options: ['', '', '', ''], answer_index: -1 });

export default function ProctorHub({ orgId: orgIdProp, embedded = false }: { orgId?: string; embedded?: boolean }) {
    const { user, membership, isLoading: authLoading, isMembershipLoading } = useAuth();
    const orgId = orgIdProp || membership?.org_id || '';

    const [tests, setTests] = useState<TestRow[]>([]);
    const [canAuthor, setCanAuthor] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [resultsFor, setResultsFor] = useState<TestRow | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/proctor/tests${orgId ? `?org_id=${orgId}` : ''}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not load tests');
            setTests(data.tests || []);
            setCanAuthor(!!data.can_author);
        } catch (err) {
            setError(errMsg(err));
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => {
        if (authLoading || isMembershipLoading || !user) return;
        load();
    }, [authLoading, isMembershipLoading, user, load]);

    const copyLink = async (id: string) => {
        await navigator.clipboard.writeText(`${window.location.origin}/proctor/${id}`);
        setCopied(id);
        setTimeout(() => setCopied(null), 1500);
    };

    const toggleActive = async (t: TestRow) => {
        await fetch(`/api/proctor/tests/${t.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !t.is_active }),
        });
        load();
    };

    const shell = (children: React.ReactNode) =>
        embedded ? <div className="space-y-6">{children}</div> : (
            <div className="min-h-screen bg-slate-50 px-4 py-8"><div className="mx-auto max-w-4xl space-y-6">{children}</div></div>
        );

    if (authLoading || isMembershipLoading || (loading && tests.length === 0 && !error)) {
        return <div className="flex min-h-[40vh] items-center justify-center"><Loader size="lg" text="Loading tests..." /></div>;
    }

    if (resultsFor) return shell(<Results test={resultsFor} onBack={() => setResultsFor(null)} />);

    return shell(
        <>
            <div className="flex items-center gap-3">
                {!embedded && <Link href="/" className="rounded-lg p-2 text-slate-500 hover:bg-white"><ArrowLeft className="w-5 h-5" /></Link>}
                <div className="flex-1">
                    {!embedded && <h2 className="text-xl font-black text-slate-900 dark:text-white">Assessments</h2>}
                    <p className="text-sm text-slate-500">Proctored tests: locked to one screen, camera on, checked by AI. Leaving the page uses up a chance.</p>
                </div>
                {canAuthor && !creating && (
                    <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
                        <Plus className="w-4 h-4" /> New test
                    </button>
                )}
            </div>

            {error && <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p>}

            {creating && <CreateTest orgId={orgId} onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />}

            {tests.length === 0 && !creating ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                    {canAuthor ? 'No tests yet. Click New test — you can start from the Ops Manager template.' : 'No tests are open for you right now.'}
                </div>
            ) : (
                <div className="space-y-3">
                    {tests.map((t) => {
                        const left = Math.max(0, t.max_attempts - t.my_attempts_used);
                        return (
                            <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="min-w-0 flex-1">
                                    <p className="flex items-center gap-2 font-black text-slate-900">
                                        <Lock className="w-4 h-4 text-rose-600" /> {t.title}
                                        {!t.is_active && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">Closed</span>}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        {t.question_count} questions · {t.duration_minutes} min · {t.max_attempts} {t.max_attempts === 1 ? 'chance' : 'chances'}{t.ai_monitoring ? ' · AI camera' : ''}
                                        {canAuthor && ` · ${t.people || 0} people · ${t.terminated || 0} attempts closed for leaving`}
                                    </p>
                                </div>
                                {canAuthor ? (
                                    <>
                                        <button onClick={() => copyLink(t.id)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700">
                                            {copied === t.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {copied === t.id ? 'Copied' : 'Copy link'}
                                        </button>
                                        <button onClick={() => setResultsFor(t)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700">Results</button>
                                        <button onClick={() => toggleActive(t)} className="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-500 hover:bg-slate-100">
                                            {t.is_active ? 'Close' : 'Reopen'}
                                        </button>
                                    </>
                                ) : t.my_completed ? (
                                    <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${STATUS_STYLE.submitted}`}>Completed</span>
                                ) : left === 0 ? (
                                    <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${STATUS_STYLE.terminated}`}>No chances left</span>
                                ) : (
                                    <Link href={`/proctor/${t.id}`} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white">
                                        {t.my_attempts_used === 0 ? 'Take test' : left === 1 ? 'Try again — last chance' : `Try again — ${left} chances left`}
                                    </Link>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </>,
    );
}

// ── Create ───────────────────────────────────────────────────────────────────
function CreateTest({ orgId, onDone, onCancel }: { orgId: string; onDone: () => void; onCancel: () => void }) {
    const [title, setTitle] = useState('');
    const [instructions, setInstructions] = useState('');
    const [duration, setDuration] = useState(30);
    const [maxAttempts, setMaxAttempts] = useState(2);
    const [aiMonitoring, setAiMonitoring] = useState(true);
    const [questions, setQuestions] = useState<Draft[]>([emptyQuestion()]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const update = (i: number, patch: Partial<Draft>) =>
        setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));

    const loadTemplate = (tpl: ProctorTemplate) => {
        setTitle(tpl.title);
        setInstructions(tpl.instructions);
        setDuration(tpl.duration_minutes);
        setMaxAttempts(tpl.max_attempts);
        setQuestions(tpl.questions.map((q) => ({
            section: q.section,
            text: q.text,
            options: [...q.options, '', '', '', ''].slice(0, Math.max(4, q.options.length)),
            answer_index: q.answer_index,
        })));
    };

    const counts = PROCTOR_SECTIONS
        .map((s) => ({ label: s.label, n: questions.filter((q) => q.section === s.key).length }))
        .filter((c) => c.n > 0);

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/proctor/tests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    org_id: orgId || undefined,
                    title,
                    instructions,
                    duration_minutes: duration,
                    max_attempts: maxAttempts,
                    ai_monitoring: aiMonitoring,
                    // Blank options are dropped server-side; remap the marked answer to match.
                    questions: questions.map((q) => {
                        const kept = q.options.map((o, idx) => ({ o: o.trim(), idx })).filter((x) => x.o);
                        return { section: q.section, text: q.text, options: kept.map((x) => x.o), answer_index: kept.findIndex((x) => x.idx === q.answer_index) };
                    }),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not save');
            onDone();
        } catch (err) {
            setError(errMsg(err));
        } finally {
            setSaving(false);
        }
    };

    const input = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none';

    return (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-slate-900">New test</h2>
                <button onClick={onCancel} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                <FileText className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-bold text-slate-700">Start from a template:</span>
                {PROCTOR_TEMPLATES.map((tpl) => (
                    <button key={tpl.key} onClick={() => loadTemplate(tpl)} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-bold text-slate-800 hover:border-slate-900">
                        {tpl.label} ({tpl.questions.length} questions)
                    </button>
                ))}
                <span className="text-xs text-slate-500">It fills the form below. Edit anything, then save it as your own test.</span>
            </div>

            <input className={input} placeholder="Title, e.g. Property Manager — screening assessment" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className={input} rows={2} placeholder="Instructions shown before the test starts (optional)" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2 font-bold text-slate-700">
                    Time limit
                    <input type="number" min={1} max={180} className="w-20 rounded-xl border border-slate-200 px-2 py-1.5" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                    min
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-700">
                    Chances
                    <input type="number" min={1} max={5} className="w-16 rounded-xl border border-slate-200 px-2 py-1.5" value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))} />
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-700">
                    <input type="checkbox" checked={aiMonitoring} onChange={(e) => setAiMonitoring(e.target.checked)} />
                    AI camera checks every 20s
                </label>
            </div>
            {counts.length > 0 && (
                <p className="text-xs text-slate-500">{questions.length} questions — {counts.map((c) => `${c.label} ${c.n}`).join(' · ')}</p>
            )}

            {questions.map((q, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-400">Q{i + 1}</span>
                        <select
                            value={q.section}
                            onChange={(e) => update(i, { section: e.target.value })}
                            className="rounded-xl border border-slate-200 px-2 py-2 text-sm font-bold text-slate-700"
                            title="Section"
                        >
                            {PROCTOR_SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                        <input className={input} placeholder="Question" value={q.text} onChange={(e) => update(i, { text: e.target.value })} />
                        {questions.length > 1 && (
                            <button onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    {q.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2 pl-7">
                            <input type="radio" name={`answer-${i}`} checked={q.answer_index === oi} onChange={() => update(i, { answer_index: oi })} title="Mark as correct" />
                            <input
                                className={input}
                                placeholder={`Option ${oi + 1}${oi > 1 ? ' (optional)' : ''}`}
                                value={opt}
                                onChange={(e) => update(i, { options: q.options.map((o, idx) => (idx === oi ? e.target.value : o)) })}
                            />
                        </div>
                    ))}
                    <p className="pl-7 text-xs text-slate-400">Select the circle next to the correct (or best) option.</p>
                </div>
            ))}

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={() => setQuestions((qs) => [...qs, emptyQuestion(qs[qs.length - 1]?.section)])}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
                >
                    <Plus className="w-4 h-4" /> Add question
                </button>
                <div className="flex-1" />
                {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
                <button onClick={save} disabled={saving} className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
                    {saving ? 'Saving…' : 'Save test'}
                </button>
            </div>
        </div>
    );
}

// ── Results ──────────────────────────────────────────────────────────────────
function Results({ test, onBack }: { test: TestRow; onBack: () => void }) {
    const [attempts, setAttempts] = useState<Attempt[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`/api/proctor/tests/${test.id}?view=results`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not load results');
                setAttempts(data.attempts || []);
            } catch (err) {
                setError(errMsg(err));
            }
        })();
    }, [test.id]);

    const minutes = (a: Attempt) =>
        a.ended_at ? Math.max(1, Math.round((new Date(a.ended_at).getTime() - new Date(a.started_at).getTime()) / 60000)) : null;

    return (
        <>
            <div className="flex items-center gap-3">
                <button onClick={onBack} className="rounded-lg p-2 text-slate-500 hover:bg-white"><ArrowLeft className="w-5 h-5" /></button>
                <div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">{test.title}</h2>
                    <p className="text-sm text-slate-500">Results · AI flags are for your judgement — they never close a test on their own.</p>
                </div>
            </div>

            {error && <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p>}
            {!attempts && !error && <Loader size="md" text="Loading results..." />}
            {attempts && attempts.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Nobody has taken this test yet.</div>
            )}

            {attempts && attempts.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                            <tr>
                                <th className="px-4 py-3">Person</th>
                                <th className="px-4 py-3">Outcome</th>
                                <th className="px-4 py-3">Score</th>
                                <th className="px-4 py-3">By section</th>
                                <th className="px-4 py-3">AI flags</th>
                                <th className="px-4 py-3">Started</th>
                            </tr>
                        </thead>
                        <tbody>
                            {attempts.map((a) => (
                                <Fragment key={a.id}>
                                    <tr onClick={() => setOpen(open === a.id ? null : a.id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                                        <td className="px-4 py-3">
                                            <p className="font-bold text-slate-900">{a.name}</p>
                                            <p className="text-xs text-slate-400">Attempt {a.attempt_no} of {test.max_attempts}{a.email ? ` · ${a.email}` : ''}</p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[a.status] || ''}`}>{a.status.replace('_', ' ')}</span>
                                            {a.termination_reason && <p className="mt-1 text-xs text-rose-700">{REASON[a.termination_reason] || a.termination_reason}</p>}
                                        </td>
                                        <td className="px-4 py-3 font-bold tabular-nums">{a.score !== null ? `${a.score}/${a.total}` : '—'}</td>
                                        <td className="px-4 py-3">
                                            {a.section_scores && Object.keys(a.section_scores).length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {PROCTOR_SECTIONS.filter((s) => a.section_scores?.[s.key]).map((s) => (
                                                        <span key={s.key} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-700" title={s.label}>
                                                            {s.label.split(' ')[0]} {a.section_scores![s.key].score}/{a.section_scores![s.key].total}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : <span className="text-slate-400">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1 font-bold ${a.ai_flags > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                                                {a.ai_flags > 0 && <ShieldAlert className="w-4 h-4" />} {a.ai_flags} of {a.ai_checks} checks
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500">
                                            {new Date(a.started_at).toLocaleString()}
                                            {minutes(a) && <p>{minutes(a)} min</p>}
                                        </td>
                                    </tr>
                                    {open === a.id && (
                                        <tr className="bg-slate-50">
                                            <td colSpan={6} className="px-4 py-3">
                                                {a.events.length === 0 ? (
                                                    <p className="text-xs text-slate-500">No flags or violations recorded.</p>
                                                ) : (
                                                    <ul className="space-y-1 text-xs">
                                                        {a.events.map((e, i) => (
                                                            <li key={i} className="flex gap-3">
                                                                <span className="tabular-nums text-slate-400">{new Date(e.created_at).toLocaleTimeString()}</span>
                                                                <span className={e.kind === 'ai_flag' ? 'text-amber-800' : e.kind === 'ai_error' ? 'text-slate-500' : 'font-bold text-rose-700'}>
                                                                    {e.kind === 'ai_flag' ? `AI: ${e.detail?.reason || 'flagged'}${e.detail?.observation ? ` — ${e.detail.observation}` : ''}`
                                                                        : e.kind === 'ai_error' ? `AI check failed: ${e.detail?.error || ''}`
                                                                        : `Test closed: ${REASON[e.kind] || e.kind}`}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

function errMsg(err: unknown) {
    return err instanceof Error ? err.message : 'Something went wrong';
}
