'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, CopyPlus, Eye, FileText, Lock, Mic, MoreVertical, Pencil, Plus, RotateCcw, ShieldAlert, Shuffle, Sparkles, Trash2, X } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import Loader from '@/frontend/components/ui/Loader';
import { DEFAULT_SECTIONS } from '@/frontend/lib/proctor/sections';
import { PROCTOR_TEMPLATES, type ProctorTemplate } from '@/frontend/lib/proctor/templates';
import TestBuilder, { emptyQuestion, newUid, orderedQuestions, type Draft, type SectionDraft } from '@/frontend/components/proctor/TestBuilder';

/**
 * Proctored tests — the HR "Assessments" tab, and the standalone /proctor page.
 *   Authors (org admins, property admins, HR): write a test by hand, from a
 *   template, or with AI; edit it (or duplicate and edit once people have
 *   taken it); preview it; copy the link that needs no sign-in; read results,
 *   including the frames the camera kept; give a candidate another chance or
 *   reset their attempts.
 *   Everyone else: the tests open to them, and how many chances they have left.
 */

type TestRow = {
    id: string; title: string; duration_minutes: number; ai_monitoring: boolean; is_active: boolean;
    max_attempts: number; look_away_strikes: number; question_count: number; created_at: string;
    my_chances: number; my_attempts_used: number; my_completed: boolean;
    shuffle?: boolean;
    public_token?: string; people?: number; attempts?: number; terminated?: number;
};
type ProctorEvent = {
    kind: string;
    detail: { reason?: string; observation?: string; error?: string; category?: string; level?: number; strikes?: number; gap_seconds?: number; note?: string | null; by?: string; source?: string; counted?: boolean; n?: number; allowed?: number } | null;
    created_at: string;
    evidence_url?: string | null;
};
type Attempt = {
    id: string; user_id: string | null; name: string; email: string | null; from_public_link: boolean; attempt_no: number; status: string;
    started_at: string; ended_at: string | null; termination_reason: string | null; score: number | null; total: number | null;
    section_scores: Record<string, { score: number; total: number }> | null;
    ai_checks: number; ai_flags: number; events: ProctorEvent[];
    standing: { allowed: number; used: number; left: number; completed: boolean };
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
    looking_away: 'Too many camera warnings',
};
const CATEGORY_LABEL: Record<string, string> = {
    no_face: 'No face in frame',
    looking_away: 'Looking away',
    phone: 'Phone or device',
    multiple_faces: 'Another person in frame',
};

const RESULTS_REFRESH_MS = 15_000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function ProctorHub({ orgId: orgIdProp, embedded = false }: { orgId?: string; embedded?: boolean }) {
    const { user, membership, isLoading: authLoading, isMembershipLoading } = useAuth();
    const orgId = orgIdProp || membership?.org_id || '';

    const [tests, setTests] = useState<TestRow[]>([]);
    const [canAuthor, setCanAuthor] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editor, setEditor] = useState<EditorSource | null>(null);
    const [resultsFor, setResultsFor] = useState<TestRow | null>(null);
    /** Which test's ⋮ menu (Edit / Duplicate and edit / Delete) is open. */
    const [menuFor, setMenuFor] = useState<string | null>(null);
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

    const copyLink = async (t: TestRow) => {
        if (!t.public_token) return;
        await navigator.clipboard.writeText(`${window.location.origin}/t/${t.public_token}`);
        setCopied(t.id);
        setTimeout(() => setCopied(null), 1500);
    };

    const deleteTest = async (t: TestRow) => {
        const results = t.attempts || 0;
        const warning = results > 0
            ? `"${t.title}" has ${results} result${results === 1 ? '' : 's'} from ${t.people || 0} ${t.people === 1 ? 'person' : 'people'}.\n\nDeleting it permanently removes the test and ALL its results, reports and camera frames. This cannot be undone.\n\nDelete it anyway?`
            : `Delete "${t.title}"? This cannot be undone.`;
        if (!window.confirm(warning)) return;
        const res = await fetch(`/api/proctor/tests/${t.id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) setError(data.error || 'Could not delete the test');
        load();
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
                    <p className="text-sm text-slate-500">Proctored tests: locked to one screen, camera and microphone on. The link works without a login.</p>
                </div>
                {canAuthor && !editor && (
                    <button onClick={() => setEditor({ mode: 'create' })} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
                        <Plus className="w-4 h-4" /> New test
                    </button>
                )}
            </div>

            {error && <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p>}

            {editor && (
                <TestEditor
                    key={editor.mode === 'create' ? 'create' : `${editor.mode}-${editor.testId}`}
                    orgId={orgId}
                    source={editor}
                    onDone={() => { setEditor(null); load(); }}
                    onCancel={() => setEditor(null)}
                />
            )}

            {tests.length === 0 && !editor ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                    {canAuthor ? 'No tests yet. Click New test — describe what you want and let AI draft it, or start from the Ops Manager template.' : 'No tests are open for you right now.'}
                </div>
            ) : (
                <div className="space-y-3">
                    {tests.map((t) => {
                        const left = Math.max(0, (t.my_chances ?? t.max_attempts) - t.my_attempts_used);
                        return (
                            <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="min-w-0 flex-1">
                                    <p className="flex items-center gap-2 font-black text-slate-900">
                                        <Lock className="w-4 h-4 text-rose-600" /> {t.title}
                                        {!t.is_active && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">Closed</span>}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        {t.question_count} questions · {t.duration_minutes} min · {t.max_attempts} {t.max_attempts === 1 ? 'chance' : 'chances'}{t.ai_monitoring ? ` · camera, ${t.look_away_strikes} warnings` : ''}
                                        {canAuthor && ` · ${t.people || 0} people · ${t.terminated || 0} attempts closed for leaving`}
                                        {canAuthor && (t.shuffle ? ' · shuffled' : '')}
                                    </p>
                                </div>
                                {canAuthor ? (
                                    <>
                                        <Link href={`/proctor/preview/${t.id}`} target="_blank" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700">
                                            <Eye className="w-4 h-4" /> Preview
                                        </Link>
                                        <button onClick={() => copyLink(t)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700">
                                            {copied === t.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {copied === t.id ? 'Copied' : 'Copy link'}
                                        </button>
                                        <button onClick={() => setResultsFor(t)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700">Results</button>
                                        <button onClick={() => toggleActive(t)} className="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-500 hover:bg-slate-100">
                                            {t.is_active ? 'Close' : 'Reopen'}
                                        </button>
                                        <div className="relative">
                                            <button
                                                onClick={() => setMenuFor(menuFor === t.id ? null : t.id)}
                                                disabled={!!editor}
                                                aria-haspopup="menu"
                                                aria-expanded={menuFor === t.id}
                                                aria-label={`More actions for ${t.title}`}
                                                className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                                            >
                                                <MoreVertical className="w-4 h-4" />
                                            </button>
                                            {menuFor === t.id && (
                                                <>
                                                    {/* Click anywhere else to close. */}
                                                    <div className="fixed inset-0 z-20" onClick={() => setMenuFor(null)} />
                                                    <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                                                        <button role="menuitem" onClick={() => { setMenuFor(null); setEditor({ mode: 'edit', testId: t.id }); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-50">
                                                            <Pencil className="w-4 h-4" /> Edit
                                                        </button>
                                                        <button role="menuitem" onClick={() => { setMenuFor(null); setEditor({ mode: 'duplicate', testId: t.id }); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-50" title="Make a new test from this one, to change its questions">
                                                            <CopyPlus className="w-4 h-4" /> Duplicate and edit
                                                        </button>
                                                        <div className="my-1 border-t border-slate-100" />
                                                        <button role="menuitem" onClick={() => { setMenuFor(null); deleteTest(t); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-rose-600 hover:bg-rose-50">
                                                            <Trash2 className="w-4 h-4" /> Delete
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
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

// ── Create / edit ────────────────────────────────────────────────────────────
type EditorSource = { mode: 'create' } | { mode: 'edit' | 'duplicate'; testId: string };

/** "Title" → "Title (v2)", "Title (v2)" → "Title (v3)". */
function nextVersionTitle(title: string) {
    const m = title.match(/^(.*)\(v(\d+)\)\s*$/);
    return m ? `${m[1]}(v${Number(m[2]) + 1})` : `${title} (v2)`;
}

const padOptions = (options: string[]) => [...options, '', '', '', ''].slice(0, Math.max(4, options.length));

/** Every question needs a section card to sit in; add one for any key that has none (e.g. "general"). */
function withMissingSections(sections: SectionDraft[], questions: { section: string }[], titles: Record<string, string> = {}) {
    const missing = [...new Set(questions.map((q) => q.section))].filter((k) => !sections.some((s) => s.key === k));
    return [...sections, ...missing.map((key) => ({ key, title: titles[key] || (key === 'general' ? 'General' : 'Questions'), description: '' }))];
}

function TestEditor({ orgId, source, onDone, onCancel }: { orgId: string; source: EditorSource; onDone: () => void; onCancel: () => void }) {
    const [title, setTitle] = useState('');
    const [instructions, setInstructions] = useState('');
    const [duration, setDuration] = useState(30);
    const [maxAttempts, setMaxAttempts] = useState(2);
    const [strikes, setStrikes] = useState(3);
    const [aiMonitoring, setAiMonitoring] = useState(true);
    const [shuffle, setShuffle] = useState(true);
    const [sections, setSections] = useState<SectionDraft[]>(DEFAULT_SECTIONS.map((s) => ({ ...s })));
    const [questions, setQuestions] = useState<Draft[]>([emptyQuestion(DEFAULT_SECTIONS[0].key)]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingSource, setLoadingSource] = useState(source.mode !== 'create');
    const [attemptCount, setAttemptCount] = useState(0);

    const [brief, setBrief] = useState('');
    const [role, setRole] = useState('');
    const [perSection, setPerSection] = useState(5);
    const [drafting, setDrafting] = useState(false);
    const [draftNote, setDraftNote] = useState<string | null>(null);

    // Someone has started: questions, time limit and camera checks stay as they were.
    const locked = source.mode === 'edit' && attemptCount > 0;
    const sourceId = source.mode === 'create' ? null : source.testId;

    useEffect(() => {
        if (!sourceId) return;
        (async () => {
            try {
                const res = await fetch(`/api/proctor/tests/${sourceId}?view=preview`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not load this test');
                const t = data.test;
                setTitle(source.mode === 'duplicate' ? nextVersionTitle(t.title) : t.title);
                setInstructions(t.instructions || '');
                setDuration(t.duration_minutes);
                setMaxAttempts(t.max_attempts);
                setStrikes(t.look_away_strikes);
                setAiMonitoring(t.ai_monitoring);
                setShuffle(t.shuffle !== false);
                const loaded: Draft[] = (t.questions || []).map((q: { section?: string; text: string; options: string[]; answer_index: number }) => ({
                    uid: newUid(), section: q.section || 'general', text: q.text, options: padOptions(q.options), answer_index: q.answer_index,
                }));
                const stored = ((t.stored_sections || []) as SectionDraft[]).map((s) => ({ key: s.key, title: s.title || '', description: s.description || '' }));
                const titles = Object.fromEntries(((t.sections || []) as { key: string; title: string }[]).map((s) => [s.key, s.title]));
                setSections(withMissingSections(stored, loaded, titles));
                setQuestions(loaded);
                if (source.mode === 'edit') setAttemptCount(data.attempt_count || 0);
            } catch (err) {
                setError(errMsg(err));
            } finally {
                setLoadingSource(false);
            }
        })();
    }, [sourceId, source.mode]);

    const loadTemplate = (tpl: ProctorTemplate) => {
        setTitle(tpl.title);
        setInstructions(tpl.instructions);
        setDuration(tpl.duration_minutes);
        setMaxAttempts(tpl.max_attempts);
        const loaded = tpl.questions.map((q) => ({ uid: newUid(), section: q.section, text: q.text, options: padOptions(q.options), answer_index: q.answer_index }));
        setSections(withMissingSections(tpl.sections.map((s) => ({ ...s })), loaded));
        setQuestions(loaded);
        setDraftNote(null);
    };

    const draftWithAi = async () => {
        setDrafting(true);
        setError(null);
        setDraftNote(null);
        try {
            const res = await fetch('/api/proctor/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    org_id: orgId || undefined,
                    brief,
                    role,
                    sections: sections.map((s) => ({ key: s.key, title: s.title, count: perSection })),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not draft the test');

            if (data.title && !title) setTitle(data.title);
            if (data.instructions && !instructions) setInstructions(data.instructions);
            const drafted: Draft[] = (data.questions as Omit<Draft, 'uid'>[]).map((q) => ({
                uid: newUid(), section: q.section, text: q.text, options: padOptions(q.options), answer_index: q.answer_index,
            }));
            setSections((ss) => withMissingSections(
                Array.isArray(data.sections) && data.sections.length
                    ? ss.map((s) => {
                        const fromAi = (data.sections as SectionDraft[]).find((x) => x.key === s.key);
                        return fromAi ? { ...s, title: fromAi.title || s.title, description: fromAi.description || s.description } : s;
                    })
                    : ss,
                drafted,
            ));
            setQuestions(drafted);
            setDraftNote(`${data.questions.length} questions drafted${data.asked_for && data.questions.length !== data.asked_for ? ` (asked for ${data.asked_for})` : ''}. Read every one before saving — the AI can be wrong.`);
        } catch (err) {
            setError(errMsg(err));
        } finally {
            setDrafting(false);
        }
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(source.mode === 'edit' ? `/api/proctor/tests/${source.testId}` : '/api/proctor/tests', {
                method: source.mode === 'edit' ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    org_id: orgId || undefined,
                    title,
                    instructions,
                    duration_minutes: duration,
                    max_attempts: maxAttempts,
                    look_away_strikes: strikes,
                    ai_monitoring: aiMonitoring,
                    shuffle,
                    sections,
                    // In section order, as laid out. Blank options are dropped server-side; remap the marked answer to match.
                    questions: orderedQuestions(sections, questions).map((q) => {
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
    const heading = source.mode === 'edit' ? 'Edit test' : source.mode === 'duplicate' ? 'Duplicate and edit' : 'New test';

    if (loadingSource) {
        return <div className="rounded-2xl border border-slate-200 bg-white p-5"><Loader size="md" text="Loading test..." /></div>;
    }

    return (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-slate-900">{heading}</h2>
                <button onClick={onCancel} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            {source.mode === 'duplicate' && (
                <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">
                    This makes a <b>new test</b> with its own link, starting with no candidates. The original keeps its results. Change anything, then save.
                </p>
            )}
            {locked && (
                <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    <Lock className="mt-0.5 w-4 h-4 shrink-0" />
                    <span>
                        {plural(attemptCount, 'attempt')} already made, so the questions, time limit and camera checks are locked — everyone must sit the same test.
                        You can still change the title, instructions, chances, warnings, shuffle and section wording.
                        To change questions, close this and use <b>Duplicate and edit</b>.
                    </span>
                </p>
            )}

            {!locked && (
                <>
                    <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                        <p className="flex items-center gap-2 text-sm font-black text-indigo-900"><Sparkles className="w-4 h-4" /> Describe the test and let AI draft it</p>
                        <textarea
                            className={input}
                            rows={2}
                            placeholder="e.g. Screening test for a facility ops manager at a coworking site — reasoning, site arithmetic, and how they handle an angry client"
                            value={brief}
                            onChange={(e) => setBrief(e.target.value)}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                            <input className="flex-1 min-w-[10rem] rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Role (optional), e.g. Ops Manager" value={role} onChange={(e) => setRole(e.target.value)} />
                            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                                Questions per section
                                <input type="number" min={1} max={15} className="w-16 rounded-xl border border-slate-200 px-2 py-1.5" value={perSection} onChange={(e) => setPerSection(Number(e.target.value))} />
                            </label>
                            <button
                                onClick={draftWithAi}
                                disabled={drafting || brief.trim().length < 8}
                                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                            >
                                {drafting ? 'Drafting…' : 'Draft with AI'}
                            </button>
                        </div>
                        <p className="text-xs text-indigo-900/70">It fills the form below and replaces the questions. Nothing is saved until you press Save.</p>
                        {draftNote && <p className="rounded-lg bg-white p-2 text-xs font-bold text-indigo-900">{draftNote}</p>}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                        <FileText className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-bold text-slate-700">Or start from a template:</span>
                        {PROCTOR_TEMPLATES.map((tpl) => (
                            <button key={tpl.key} onClick={() => loadTemplate(tpl)} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-bold text-slate-800 hover:border-slate-900">
                                {tpl.label} ({tpl.questions.length} questions)
                            </button>
                        ))}
                    </div>
                </>
            )}

            <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Test name</span>
                <input className={input} placeholder="e.g. Property Manager — screening assessment" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Instructions for candidates <span className="font-medium text-slate-400">(shown before the test starts, optional)</span></span>
                <textarea className={input} rows={2} placeholder="e.g. 20 questions in four sections. Pick the one best answer for each." value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </label>
            <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2 font-bold text-slate-700">
                    Time limit
                    <input type="number" min={1} max={180} disabled={locked} className="w-20 rounded-xl border border-slate-200 px-2 py-1.5 disabled:bg-slate-50" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                    min
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-700">
                    Chances
                    <input type="number" min={1} max={5} className="w-16 rounded-xl border border-slate-200 px-2 py-1.5" value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))} />
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-700">
                    Camera warnings before closing
                    <input type="number" min={1} max={20} className="w-16 rounded-xl border border-slate-200 px-2 py-1.5" value={strikes} onChange={(e) => setStrikes(Number(e.target.value))} />
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-700">
                    <input type="checkbox" checked={aiMonitoring} disabled={locked} onChange={(e) => setAiMonitoring(e.target.checked)} />
                    Camera + mic checks every 10s
                </label>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2 font-bold text-slate-700" title="Sections stay in your order; questions inside each section, and their options, are shuffled for every candidate.">
                    <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
                    <Shuffle className="w-4 h-4 text-slate-500" /> Shuffle questions and options for each candidate
                </label>
            </div>

            <TestBuilder sections={sections} setSections={setSections} questions={questions} setQuestions={setQuestions} locked={locked} />

            <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1" />
                {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
                <button onClick={save} disabled={saving} className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
                    {saving ? 'Saving…' : source.mode === 'edit' ? 'Save changes' : 'Save test'}
                </button>
            </div>
            <p className="text-xs text-slate-400">After saving, use Preview to read it as the candidate will, then Copy link to send it.</p>
        </div>
    );
}

// ── HR: another chance / reset ───────────────────────────────────────────────
type Standing = { allowed: number; used: number; left: number; completed: boolean };

function GrantControl({ testId, who, standing, onDone }: {
    testId: string;
    who: { user_id?: string | null; candidate_email?: string | null };
    standing: Standing;
    onDone: () => void;
}) {
    const [kind, setKind] = useState<'extra_chance' | 'reset' | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const confirm = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/proctor/tests/${testId}/grants`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, note, ...(who.user_id ? { user_id: who.user_id } : { candidate_email: who.candidate_email }) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not save');
            setKind(null);
            setNote('');
            onDone();
        } catch (err) {
            setError(errMsg(err));
        } finally {
            setBusy(false);
        }
    };

    if (!kind) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-500">
                    {standing.completed ? 'Completed' : `${standing.used} of ${plural(standing.allowed, 'chance')} used`}
                </span>
                {!standing.completed && (
                    <button onClick={() => setKind('extra_chance')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:border-slate-900">
                        <Plus className="w-3.5 h-3.5" /> Give another chance
                    </button>
                )}
                <button onClick={() => setKind('reset')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:border-slate-900">
                    <RotateCcw className="w-3.5 h-3.5" /> Reset attempts
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-slate-900">
                {kind === 'reset'
                    ? 'Reset: earlier attempts stop counting and they start again with every chance. The earlier attempts stay in the results.'
                    : 'Give one more chance at this test.'}
            </p>
            <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">Reason (optional)</span>
                <textarea
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    rows={2}
                    maxLength={1000}
                    placeholder="e.g. Candidate's internet dropped at Q14 — called me, confirmed."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
            </label>
            <p className="text-xs text-slate-400">Saved with your name and the time, and shown in their results and report.</p>
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            <div className="flex gap-2">
                <button onClick={confirm} disabled={busy} className="rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Confirm'}</button>
                <button onClick={() => { setKind(null); setError(null); }} className="rounded-xl px-3 py-1.5 text-sm font-bold text-slate-500 hover:bg-slate-100">Cancel</button>
            </div>
        </div>
    );
}

// ── Results ──────────────────────────────────────────────────────────────────
function Results({ test, onBack }: { test: TestRow; onBack: () => void }) {
    const [attempts, setAttempts] = useState<Attempt[] | null>(null);
    const [sections, setSections] = useState<{ key: string; title: string }[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/proctor/tests/${test.id}?view=results`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not load results');
            setAttempts(data.attempts || []);
            setSections(data.test?.sections || []);
        } catch (err) {
            setError(errMsg(err));
        }
    }, [test.id]);

    // Keep up with tests being taken right now: refresh every 15s, and when HR comes back to the tab.
    useEffect(() => {
        load();
        const t = setInterval(load, RESULTS_REFRESH_MS);
        window.addEventListener('focus', load);
        return () => { clearInterval(t); window.removeEventListener('focus', load); };
    }, [load]);

    // Deleting a result gives that chance back (chances are counted from attempts).
    const deleteResult = async (a: Attempt) => {
        if (!window.confirm(`Delete ${a.name}'s attempt ${a.attempt_no}?\n\nThis permanently removes the score, answers, proctoring log and camera frames, and gives that chance back to them. This cannot be undone.`)) return;
        const res = await fetch(`/api/proctor/attempts/${a.id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) setError(data.error || 'Could not delete the result');
        load();
    };

    const minutes = (a: Attempt) =>
        a.ended_at ? Math.max(1, Math.round((new Date(a.ended_at).getTime() - new Date(a.started_at).getTime()) / 60000)) : null;

    return (
        <>
            <div className="flex items-center gap-3">
                <button onClick={onBack} className="rounded-lg p-2 text-slate-500 hover:bg-white"><ArrowLeft className="w-5 h-5" /></button>
                <div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">{test.title}</h2>
                    <p className="text-sm text-slate-500">Results · click a row for the log, the frames kept, any voice picked up, and to give another chance.</p>
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
                                <th className="px-4 py-3">Flags</th>
                                <th className="px-4 py-3">Started</th>
                            </tr>
                        </thead>
                        <tbody>
                            {attempts.map((a) => {
                                const evidence = a.events.filter((e) => e.evidence_url);
                                const voices = a.events.filter((e) => e.kind === 'voice_detected');
                                return (
                                    <Fragment key={a.id}>
                                        <tr onClick={() => setOpen(open === a.id ? null : a.id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                                            <td className="px-4 py-3">
                                                <p className="font-bold text-slate-900">{a.name}</p>
                                                <p className="text-xs text-slate-400">
                                                    Attempt {a.attempt_no} of {a.standing?.allowed ?? test.max_attempts}{a.email ? ` · ${a.email}` : ''}{a.from_public_link ? ' · no sign-in link' : ''}
                                                </p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[a.status] || ''}`}>{a.status.replace('_', ' ')}</span>
                                                {a.termination_reason && <p className="mt-1 text-xs text-rose-700">{REASON[a.termination_reason] || a.termination_reason}</p>}
                                            </td>
                                            <td className="px-4 py-3 font-bold tabular-nums">
                                                {a.score !== null ? `${a.score}/${a.total}` : '—'}
                                                {a.score !== null && a.status === 'terminated' && (
                                                    <p className="text-[11px] font-bold text-rose-700" title="Graded on the answers given before the test closed">partial — closed early</p>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {a.section_scores && Object.keys(a.section_scores).length > 0 ? (
                                                    <div className="flex flex-wrap gap-1">
                                                        {Object.entries(a.section_scores).map(([key, v]) => (
                                                            <span key={key} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-700" title={sections.find((s) => s.key === key)?.title || key}>
                                                                {(sections.find((s) => s.key === key)?.title || key).split(' ')[0]} {v.score}/{v.total}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : <span className="text-slate-400">—</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1 font-bold ${a.ai_flags > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                                                    {a.ai_flags > 0 && <ShieldAlert className="w-4 h-4" />} {a.ai_flags}/{a.ai_checks}
                                                </span>
                                                {(evidence.length > 0 || voices.length > 0) && (
                                                    <span className="ml-2 inline-flex items-center gap-2 text-xs font-bold text-slate-500">
                                                        {evidence.length > 0 && <span>{evidence.length} frame{evidence.length === 1 ? '' : 's'}</span>}
                                                        {voices.length > 0 && <span className="inline-flex items-center gap-1"><Mic className="w-3.5 h-3.5" />{voices.length}</span>}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500">
                                                {new Date(a.started_at).toLocaleString()}
                                                {minutes(a) && <p>{minutes(a)} min</p>}
                                                <Link
                                                    href={`/proctor/report/${a.id}`}
                                                    target="_blank"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="mt-1 inline-flex items-center gap-1 font-bold text-slate-700 underline"
                                                >
                                                    <FileText className="w-3.5 h-3.5" /> Report
                                                </Link>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteResult(a); }}
                                                    className="mt-1 ml-3 inline-flex items-center gap-1 font-bold text-rose-600 hover:underline"
                                                    title="Delete this result"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" /> Delete
                                                </button>
                                            </td>
                                        </tr>
                                        {open === a.id && (
                                            <tr className="bg-slate-50">
                                                <td colSpan={6} className="px-4 py-3">
                                                    <div className="mb-3">
                                                        <GrantControl
                                                            testId={test.id}
                                                            who={{ user_id: a.user_id, candidate_email: a.email }}
                                                            standing={a.standing}
                                                            onDone={load}
                                                        />
                                                    </div>
                                                    {evidence.length > 0 && (
                                                        <div className="mb-3">
                                                            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Frames kept for review</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                {evidence.map((e, i) => (
                                                                    <a key={i} href={e.evidence_url || '#'} target="_blank" rel="noreferrer" className="block">
                                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                        <img src={e.evidence_url || ''} alt={CATEGORY_LABEL[e.detail?.category || ''] || 'Flagged frame'} className="h-24 rounded-lg border border-slate-300 object-cover" />
                                                                        <span className="block text-[11px] font-bold text-slate-600">
                                                                            {CATEGORY_LABEL[e.detail?.category || ''] || 'Flagged'} · {new Date(e.created_at).toLocaleTimeString()}
                                                                        </span>
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {a.events.length === 0 ? (
                                                        <p className="text-xs text-slate-500">No flags or violations recorded.</p>
                                                    ) : (
                                                        <ul className="space-y-1 text-xs">
                                                            {a.events.map((e, i) => (
                                                                <li key={i} className="flex gap-3">
                                                                    <span className="tabular-nums text-slate-400">{new Date(e.created_at).toLocaleTimeString()}</span>
                                                                    <span className={eventTone(e.kind)}>{describeEvent(e)}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

function eventTone(kind: string) {
    if (kind === 'ai_flag' || kind === 'left_warning') return 'text-amber-800';
    if (['resumed', 'hr_extra_chance', 'hr_reset'].includes(kind)) return 'font-bold text-sky-800';
    if (kind === 'voice_detected') return 'text-indigo-800';
    if (kind === 'ai_error') return 'text-slate-500';
    return 'font-bold text-rose-700';
}

function describeEvent(e: ProctorEvent) {
    if (e.kind === 'ai_flag') {
        const label = CATEGORY_LABEL[e.detail?.category || ''] || e.detail?.reason || 'flagged';
        return `${e.detail?.source === 'device' ? 'Live check' : 'Camera'}: ${label}${e.detail?.observation ? ` — ${e.detail.observation}` : ''}${e.detail?.counted === false ? ' (reminder, not counted)' : ''}`;
    }
    if (e.kind === 'left_warning') {
        return `Left the test: ${REASON[e.detail?.reason || ''] || 'left the window'} — warning ${e.detail?.n} of ${e.detail?.allowed}`;
    }
    if (e.kind === 'detector_unavailable') {
        return "Live check couldn't run in this browser — only the 10-second camera check was used";
    }
    if (e.kind === 'voice_detected') return `Microphone: a voice was picked up${e.detail?.level ? ` (level ${e.detail.level})` : ''}`;
    if (e.kind === 'ai_error') return `Camera check failed: ${e.detail?.error || ''}`;
    if (e.kind === 'looking_away') return `Test closed: ${e.detail?.strikes} camera warnings`;
    if (e.kind === 'resumed') {
        const gap = e.detail?.gap_seconds || 0;
        return `Resumed after the page went silent for ${gap < 60 ? `${gap}s` : `${Math.floor(gap / 60)}m ${gap % 60}s`} (crash or lost connection)`;
    }
    if (e.kind === 'hr_extra_chance' || e.kind === 'hr_reset') {
        return `${e.kind === 'hr_reset' ? 'HR reset the attempts' : 'HR gave another chance'} — ${e.detail?.by || 'HR'}${e.detail?.note ? `: “${e.detail.note}”` : ' (no reason given)'}`;
    }
    return `Test closed: ${REASON[e.kind] || e.kind}`;
}

function errMsg(err: unknown) {
    return err instanceof Error ? err.message : 'Something went wrong';
}
