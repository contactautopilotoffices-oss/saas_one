'use client';

import React, { use, useEffect, useState } from 'react';
import type { PublicInterview } from '@/backend/lib/candidates/interview-page';

/**
 * A candidate's interview page: /interview/<token> (owner 2026-11-24). No sign-in; the link is the key. The role, when,
 * how to join or where to come, HR's guidelines, the job description, the company profile, and "Will you attend?".
 * Listed in proxy.ts as a public route.
 */
export default function InterviewPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
    const [page, setPage] = useState<PublicInterview | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [askNo, setAskNo] = useState(false);
    const [note, setNote] = useState('');
    const [showJd, setShowJd] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/public/interview/${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async res => {
            const data = await res.json().catch(() => null);
            if (cancelled) return;
            if (!res.ok || !data?.when) { setLoadError(data?.error ?? 'This interview link is not valid.'); return; }
            setPage(data as PublicInterview);
        }).catch(() => { if (!cancelled) setLoadError('The page could not be opened. Check your connection and try again.'); });
        return () => { cancelled = true; };
    }, [token]);

    const agreeToAnalysis = async () => {
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/public/interview/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysisConsent: true }) });
            const data = await res.json();
            if (res.ok && data.analysisConsent) setPage(p => p && { ...p, analysisConsent: true });
            else setError(data.error || 'Your consent could not be saved.');
        } catch { setError('Your consent could not be saved. Please try again.'); }
        finally { setBusy(false); }
    };

    const answer = async (value: 'yes' | 'no') => {
        if (!page || busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/public/interview/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: value, note: value === 'no' ? note : undefined }) });
            const data = await res.json().catch(() => null);
            if (!res.ok) { setError(data?.error ?? 'Your answer could not be saved. Please try again.'); return; }
            setPage(p => p && { ...p, rsvp: data.rsvp });
            setAskNo(false);
        } catch {
            setError('Your answer could not be saved. Check your connection and try again.');
        } finally {
            setBusy(false);
        }
    };

    const open = page && page.status === 'scheduled' && !page.past;
    return (
        <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:py-12">
            <div className="mx-auto max-w-xl space-y-4">
                {!page && !loadError && <p className="text-center text-sm text-slate-500">Loading…</p>}
                {loadError && <div className="rounded-2xl bg-white p-6 text-center shadow-sm"><h1 className="text-lg font-bold">Link not valid</h1><p className="mt-1 text-sm text-slate-600">{loadError}</p></div>}
                {page && (
                    <>
                        <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{page.companyName}</p>
                            <h1 className="mt-1 text-2xl font-bold leading-tight">{page.round ? `${page.round} interview` : 'Interview'}{page.role ? `: ${page.role}` : ''}</h1>
                            {page.firstName && <p className="mt-2 text-[15px] text-slate-700">Hello {page.firstName}.</p>}
                            {page.status === 'cancelled' && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">This interview was cancelled. The recruiter will be in touch.</p>}
                            <dl className="mt-4 space-y-2 text-[15px]">
                                <div><dt className="text-xs font-semibold text-slate-500">When</dt><dd>{page.when}</dd></div>
                                <div><dt className="text-xs font-semibold text-slate-500">How</dt><dd>{page.online ? 'Video call' : 'In person'}</dd></div>
                                {!page.online && page.venue && <div><dt className="text-xs font-semibold text-slate-500">Where</dt><dd className="whitespace-pre-wrap">{page.venue}</dd></div>}
                                {page.location && page.online && <div><dt className="text-xs font-semibold text-slate-500">Role location</dt><dd>{page.location}</dd></div>}
                            </dl>
                            {page.analysisConsent !== undefined && <div className="mt-4 rounded-xl border p-3 text-sm">
                                {page.analysisConsent ? 'You agreed to AI analysis of this recorded interview.' : <>
                                    <p>HR can use AI to review your answers and suggest follow-up questions. You can join the interview either way.</p>
                                    <button type="button" disabled={busy} onClick={() => void agreeToAnalysis()} className="mt-2 font-semibold underline">I agree to AI analysis of this interview</button>
                                </>}
                            </div>}
                            {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
                            {page.joinUrl && <a href={page.joinUrl} className="mt-4 block rounded-xl bg-slate-900 px-4 py-3 text-center text-[15px] font-bold text-white">Join the video call</a>}
                            {page.joinUrl && <p className="mt-1 text-center text-xs text-slate-500">Open it a few minutes early. You will be let in when the interview starts. The call is recorded.</p>}
                        </section>

                        {open && (
                            <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-7" aria-label="Will you attend?">
                                <h2 className="text-lg font-bold">Will you attend?</h2>
                                {page.rsvp && <p className="mt-1 text-sm text-slate-600">{page.rsvp === 'yes' ? 'You said yes. Thank you, see you then.' : 'You said you cannot attend. The recruiter will be in touch.'} You can change your answer.</p>}
                                {!askNo ? (
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                        <button type="button" onClick={() => void answer('yes')} disabled={busy} className={`rounded-xl px-4 py-3 text-[15px] font-bold ${page.rsvp === 'yes' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200'} disabled:opacity-60`}>Yes, I will attend</button>
                                        <button type="button" onClick={() => setAskNo(true)} disabled={busy} className={`rounded-xl px-4 py-3 text-[15px] font-bold ${page.rsvp === 'no' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-900 ring-1 ring-rose-200'} disabled:opacity-60`}>No, I cannot</button>
                                    </div>
                                ) : (
                                    <div className="mt-3 space-y-2">
                                        <label htmlFor="rsvp-note" className="text-sm font-semibold text-slate-800">Tell us why, or a better time (optional)</label>
                                        <textarea id="rsvp-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500} className="block w-full rounded-xl border border-slate-300 px-3 py-2 text-[15px]" />
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => setAskNo(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300">Back</button>
                                            <button type="button" onClick={() => void answer('no')} disabled={busy} className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Sending…' : 'Send: I cannot attend'}</button>
                                        </div>
                                    </div>
                                )}

                            </section>
                        )}

                        {page.guidelines.length > 0 && page.status === 'scheduled' && (
                            <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
                                <h2 className="text-lg font-bold">Before the interview</h2>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-slate-700">{page.guidelines.map(g => <li key={g}>{g}</li>)}</ul>
                            </section>
                        )}

                        {(page.jd || page.companyProfileUrl) && (
                            <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
                                <h2 className="text-lg font-bold">About the role and us</h2>
                                {page.companyProfileUrl && <a href={page.companyProfileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[15px] font-semibold text-slate-900 underline underline-offset-2">Our company profile</a>}
                                {page.jd && (
                                    <div className="mt-3">
                                        <button type="button" onClick={() => setShowJd(s => !s)} className="text-sm font-semibold text-slate-700 underline underline-offset-2">{showJd ? 'Hide the job description' : 'Read the job description'}</button>
                                        {showJd && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{page.jd}</p>}
                                    </div>
                                )}
                            </section>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
