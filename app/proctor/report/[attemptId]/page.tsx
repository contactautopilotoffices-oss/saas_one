'use client';

import { use, useEffect, useState } from 'react';
import { ArrowLeft, Check, Printer, X } from 'lucide-react';
import Link from 'next/link';

/**
 * /proctor/report/<attemptId> — the final report on one attempt, for the
 * reviewer. Score, how every question was answered, and the whole proctoring
 * log with the flagged camera frames embedded in the page (not linked), so
 * printing it or saving it as PDF keeps the evidence with the report.
 * Authors only; the API refuses everyone else.
 */

type Section = { key: string; title: string; description?: string; question_count: number };
type ReviewRow = { number: number; section: string; text: string; options: string[]; multi?: boolean; picked: number[] | null; correct: number[]; is_correct: boolean };

/** Option texts for a list of indexes: "Lock the door; Call security". */
const optionList = (options: string[], indexes: number[]) => indexes.map((i) => options[i]).filter(Boolean).join('; ');
type LogRow = { kind: string; detail: Record<string, unknown> | null; created_at: string; image?: string | null };
type Report = {
    organisation: string | null;
    test: { title: string; duration_minutes: number; max_attempts: number; look_away_strikes: number; ai_monitoring: boolean; sections: Section[] };
    candidate: { name: string; email: string | null; from_public_link: boolean };
    attempt: {
        attempt_no: number; status: string; started_at: string; ended_at: string | null; minutes_taken: number | null;
        termination_reason: string | null; score: number | null; total: number | null;
        section_scores: Record<string, { score: number; total: number }>; ai_checks: number; ai_flags: number;
    };
    review: ReviewRow[];
    log: LogRow[];
    frames_embedded: number;
};

const REASON: Record<string, string> = {
    tab_hidden: 'Switched tab or minimised the browser',
    window_blur: 'Switched to another window or app',
    fullscreen_exit: 'Left fullscreen',
    page_unload: 'Closed or refreshed the page',
    camera_lost: 'Turned the camera off',
    reopened: 'Reopened the test mid-way',
    looking_away: 'Too many camera warnings',
};
const CATEGORY: Record<string, string> = {
    no_face: 'No face in frame',
    looking_away: 'Looking away from the screen',
    phone: 'Phone or device visible',
    multiple_faces: 'Another person in frame',
};
const OUTCOME: Record<string, string> = {
    submitted: 'Completed',
    expired: 'Ran out of time',
    terminated: 'Closed by the proctor',
    in_progress: 'Still in progress',
};

export default function AttemptReportPage({ params }: { params: Promise<{ attemptId: string }> }) {
    const { attemptId } = use(params);
    const [report, setReport] = useState<Report | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`/api/proctor/attempts/${attemptId}/report`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not load this report');
                setReport(data);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not load this report');
            }
        })();
    }, [attemptId]);

    if (error) return <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 text-center text-sm text-rose-700">{error}</div>;
    if (!report) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">Loading report…</div>;

    const { attempt, candidate, test } = report;
    const flags = report.log.filter((l) => l.kind === 'ai_flag');
    const voices = report.log.filter((l) => l.kind === 'voice_detected');
    const frames = report.log.filter((l) => l.image);
    const pct = attempt.total ? Math.round(((attempt.score || 0) / attempt.total) * 100) : null;

    return (
        <div className="min-h-screen bg-slate-100 py-8 print:bg-white print:py-0">
            <div className="mx-auto max-w-3xl space-y-5 bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none">
                <div className="flex items-start gap-3 print:hidden">
                    <Link href="/proctor" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft className="w-5 h-5" /></Link>
                    <div className="flex-1" />
                    <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
                        <Printer className="w-4 h-4" /> Print / Save as PDF
                    </button>
                </div>

                {/* Header */}
                <header className="border-b-2 border-slate-900 pb-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{report.organisation || 'Assessment report'}</p>
                    <h1 className="text-2xl font-black text-slate-900">{test.title}</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        <b>{candidate.name}</b>{candidate.email ? ` · ${candidate.email}` : ''}
                        {candidate.from_public_link ? ' · took it from the public link' : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                        Attempt {attempt.attempt_no} of {test.max_attempts} · started {new Date(attempt.started_at).toLocaleString()}
                        {attempt.minutes_taken ? ` · took ${attempt.minutes_taken} min of ${test.duration_minutes}` : ''}
                    </p>
                </header>

                {/* Verdict line */}
                <section className="grid gap-3 sm:grid-cols-3">
                    <Tile label="Outcome" value={OUTCOME[attempt.status] || attempt.status} sub={attempt.termination_reason ? REASON[attempt.termination_reason] || attempt.termination_reason : undefined} />
                    <Tile
                        label="Score"
                        value={attempt.total ? `${attempt.score}/${attempt.total}` : '—'}
                        sub={pct !== null ? `${pct}%${attempt.status === 'terminated' ? ' · partial, closed early' : ''}` : undefined}
                    />
                    <Tile label="Proctor flags" value={`${attempt.ai_flags} of ${attempt.ai_checks} checks`} sub={voices.length ? `${voices.length} voice note${voices.length === 1 ? '' : 's'}` : 'No voice picked up'} />
                </section>

                {/* By section */}
                {Object.keys(attempt.section_scores).length > 0 && (
                    <section>
                        <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-500">Score by section</h2>
                        <table className="w-full text-sm">
                            <tbody>
                                {test.sections.map((s, si) => {
                                    const sc = attempt.section_scores[s.key];
                                    if (!sc) return null;
                                    const p = sc.total ? Math.round((sc.score / sc.total) * 100) : 0;
                                    return (
                                        <tr key={s.key} className="border-b border-slate-100">
                                            <td className="py-2 font-bold text-slate-900"><span className="mr-1.5 text-slate-400">{si + 1}.</span>{s.title}</td>
                                            <td className="py-2 text-right tabular-nums font-bold">{sc.score}/{sc.total}</td>
                                            <td className="w-1/2 py-2 pl-4">
                                                <div className="h-2 w-full rounded-full bg-slate-100">
                                                    <div className={`h-2 rounded-full ${p >= 70 ? 'bg-emerald-500' : p >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${p}%` }} />
                                                </div>
                                            </td>
                                            <td className="py-2 pl-2 text-right text-xs tabular-nums text-slate-500">{p}%</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </section>
                )}

                {/* Evidence, embedded */}
                {frames.length > 0 && (
                    <section className="break-inside-avoid">
                        <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-500">What the camera kept ({frames.length})</h2>
                        <p className="mb-2 text-xs text-slate-500">Saved when a phone or a second person was seen. The candidate was not told, so behaviour is unchanged.</p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {frames.map((f, i) => (
                                <figure key={i} className="break-inside-avoid">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={f.image || ''} alt={CATEGORY[String(f.detail?.category)] || 'Flagged frame'} className="w-full rounded-lg border border-slate-300" />
                                    <figcaption className="mt-1 text-[11px] font-bold text-slate-700">
                                        {CATEGORY[String(f.detail?.category)] || 'Flagged'} · {new Date(f.created_at).toLocaleTimeString()}
                                    </figcaption>
                                    {typeof f.detail?.observation === 'string' && (
                                        <figcaption className="text-[11px] text-slate-500">{f.detail.observation as string}</figcaption>
                                    )}
                                </figure>
                            ))}
                        </div>
                    </section>
                )}

                {/* Proctoring log */}
                <section className="break-inside-avoid">
                    <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-500">Proctoring log</h2>
                    {report.log.length === 0 ? (
                        <p className="text-sm text-slate-500">Nothing was flagged during this attempt.</p>
                    ) : (
                        <ul className="space-y-1 text-sm">
                            {report.log.map((l, i) => (
                                <li key={i} className="flex gap-3 border-b border-slate-50 py-1">
                                    <span className="w-20 shrink-0 tabular-nums text-xs text-slate-400">{new Date(l.created_at).toLocaleTimeString()}</span>
                                    <span className={l.kind === 'ai_flag' ? 'text-amber-800' : l.kind === 'voice_detected' ? 'text-indigo-800' : l.kind === 'ai_error' ? 'text-slate-400' : ['resumed', 'hr_extra_chance', 'hr_reset'].includes(l.kind) ? 'font-bold text-sky-800' : 'font-bold text-rose-700'}>
                                        {describe(l)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                        {attempt.ai_flags} of {attempt.ai_checks} camera checks were flagged{flags.length ? '' : ' — none'}.
                        {test.ai_monitoring ? ` The test closes after ${test.look_away_strikes} camera warnings (looking away, no face, another person, or a phone or device). Voice warnings are shown to the candidate but do not count.` : ' Camera checks were off for this test.'}
                    </p>
                </section>

                {/* Answers */}
                <section>
                    <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-500">Answers</h2>
                    <div className="space-y-3">
                        {report.review.map((q) => (
                            <div key={q.number} className="break-inside-avoid border-b border-slate-100 pb-2">
                                <p className="text-sm font-bold text-slate-900">
                                    <span className={`mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full align-middle text-white ${q.is_correct ? 'bg-emerald-500' : q.picked === null ? 'bg-slate-300' : 'bg-rose-500'}`}>
                                        {q.is_correct ? <Check className="h-3 w-3" /> : q.picked === null ? null : <X className="h-3 w-3" />}
                                    </span>
                                    Q{q.number}. {q.text}
                                    {q.multi && <span className="ml-1.5 text-[11px] font-bold text-slate-400">(select all that apply)</span>}
                                </p>
                                <p className="pl-6 text-xs text-slate-600">
                                    Answered: <b>{q.picked === null ? 'not answered' : optionList(q.options, q.picked)}</b>
                                    {!q.is_correct && <> · Correct: <b>{optionList(q.options, q.correct)}</b></>}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>

                <footer className="border-t border-slate-200 pt-3 text-[11px] text-slate-400">
                    Generated {new Date().toLocaleString()} · Camera frames are embedded in this report, so it stays complete if saved or printed.
                    Proctoring flags are machine judgements for a human to read, not proof on their own.
                </footer>
            </div>
        </div>
    );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
            <p className="text-lg font-black text-slate-900">{value}</p>
            {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
    );
}

function formatGap(seconds: number) {
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function describe(l: LogRow) {
    const d = l.detail || {};
    if (l.kind === 'ai_flag') {
        const label = CATEGORY[String(d.category)] || String(d.reason || 'flagged');
        return `${d.source === 'device' ? 'Live check' : 'Camera'}: ${label}${d.observation ? ` — ${d.observation}` : ''}${d.counted === false ? ' (reminder, not counted)' : ''}`;
    }
    if (l.kind === 'left_warning') return `Left the test: ${REASON[String(d.reason)] || 'left the window'} — warning ${d.n} of ${d.allowed}`;
    if (l.kind === 'detector_unavailable') return "Live check couldn't run in this browser — only the 10-second camera check was used";
    if (l.kind === 'voice_detected') return `Microphone: a voice was picked up${d.level ? ` (level ${d.level})` : ''}`;
    if (l.kind === 'ai_error') return `Camera check failed: ${d.error || ''}`;
    if (l.kind === 'looking_away') return `Test closed after ${d.strikes} camera warnings`;
    if (l.kind === 'resumed') return `Resumed after the page went silent for ${formatGap(Number(d.gap_seconds) || 0)} (crash or lost connection)`;
    if (l.kind === 'hr_extra_chance' || l.kind === 'hr_reset') {
        return `${l.kind === 'hr_reset' ? 'HR reset the attempts' : 'HR gave another chance'} — ${d.by || 'HR'}${d.note ? `: “${d.note}”` : ' (no reason given)'}`;
    }
    return `Test closed: ${REASON[l.kind] || l.kind}`;
}
