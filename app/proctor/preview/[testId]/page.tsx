'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Clock, Lock } from 'lucide-react';

/**
 * /proctor/preview/<testId> — the test exactly as the candidate will read it,
 * with the correct answers marked, so HR can check it before sending the link.
 * Nothing is recorded here: no camera, no lock, no attempt.
 * Authors only (the API refuses everyone else).
 */

type Question = { id: string; section?: string; text: string; options: string[]; answer_index: number };
type Section = { key: string; title: string; description?: string; question_count: number };
type Test = {
    title: string; instructions: string | null; duration_minutes: number; max_attempts: number;
    look_away_strikes: number; ai_monitoring: boolean; is_active: boolean;
    public_token: string; questions: Question[]; sections: Section[];
};

export default function ProctorPreviewPage({ params }: { params: Promise<{ testId: string }> }) {
    const { testId } = use(params);
    const [test, setTest] = useState<Test | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`/api/proctor/tests/${testId}?view=preview`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not load this test');
                setTest(data.test);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not load this test');
            }
        })();
    }, [testId]);

    const copyPublicLink = async () => {
        if (!test) return;
        await navigator.clipboard.writeText(`${window.location.origin}/t/${test.public_token}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    if (error) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 text-center text-sm text-rose-700">{error}</div>;
    }
    if (!test) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">Loading preview…</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 px-4 py-8">
            <div className="mx-auto max-w-2xl space-y-6">
                <div className="flex items-start gap-3">
                    <Link href="/proctor" className="rounded-lg p-2 text-slate-500 hover:bg-white"><ArrowLeft className="w-5 h-5" /></Link>
                    <div className="flex-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Preview · not recorded</p>
                        <h1 className="text-2xl font-black text-slate-900">{test.title}</h1>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
                            <Clock className="w-4 h-4" /> {test.duration_minutes} min · {test.questions.length} questions ·
                            {' '}{test.max_attempts} {test.max_attempts === 1 ? 'chance' : 'chances'} ·
                            {' '}{test.ai_monitoring ? `camera on, ${test.look_away_strikes} warnings` : 'no camera checks'}
                            {!test.is_active && <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">Closed</span>}
                        </p>
                    </div>
                    <button onClick={copyPublicLink} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                        {copied ? <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-600" /> Copied</span> : 'Copy test link'}
                    </button>
                </div>

                {test.instructions && (
                    <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm whitespace-pre-wrap text-slate-700">{test.instructions}</p>
                )}

                <p className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">
                    <Lock className="w-3.5 h-3.5" /> The candidate sees this locked to one screen, with camera and microphone on. Correct answers below are visible to you only.
                </p>

                {test.sections.map((section, si) => {
                    const inSection = test.questions.filter((q) => (q.section || 'general') === section.key);
                    if (!inSection.length) return null;
                    return (
                        <section key={section.key} className="space-y-3">
                            <div className="border-b border-slate-200 pb-1">
                                <p className="text-xs font-black uppercase tracking-wider text-slate-400">Section {si + 1} of {test.sections.length}</p>
                                <h2 className="text-base font-black text-slate-900">{section.title}</h2>
                                {section.description && <p className="text-xs text-slate-500">{section.description}</p>}
                            </div>
                            {inSection.map((q) => (
                                <div key={q.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                                    <p className="text-sm font-black text-slate-900">Q{test.questions.indexOf(q) + 1}. {q.text}</p>
                                    <ul className="mt-2 space-y-1.5">
                                        {q.options.map((opt, oi) => (
                                            <li
                                                key={oi}
                                                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                                                    oi === q.answer_index ? 'border-emerald-400 bg-emerald-50 font-bold text-emerald-900' : 'border-slate-200 text-slate-700'
                                                }`}
                                            >
                                                {oi === q.answer_index ? <Check className="w-4 h-4 shrink-0" /> : <span className="w-4 shrink-0 text-center text-xs text-slate-400">{'ABCD'[oi] || oi + 1}</span>}
                                                {opt}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
