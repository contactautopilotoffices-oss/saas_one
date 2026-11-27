'use client';

import React, { use, useEffect, useState } from 'react';
import type { PublicInterview } from '@/backend/lib/candidates/interview-page';
import { ChevronDown, FileText, Video } from 'lucide-react';
import { FormDocument, PublicFormPage } from '@/frontend/components/recruitment/PublicFormPage';

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

    const showGuidelines = page && page.guidelines.length > 0 && page.status === 'scheduled';
    const open = page && page.status === 'scheduled' && !page.past;
    return (
        <PublicFormPage company={page?.companyName} title="Interview invitation">
            <div className="rf-column">
                {!page && !loadError && <p className="rf-status" role="status">Loading your invitation…</p>}
                {loadError && <div className="rf-status" role="alert"><h1>Link not valid</h1><p className="rf-sub">{loadError}</p></div>}
                {page && (
                    <>
                        <section className="rf-card rf-hero">
                            <p className="rf-kicker">{page.round ? `${page.round} interview` : 'Interview'}</p>
                            <h1>{page.role || 'Your interview'}</h1>
                            {page.firstName && <p className="rf-sub">Hello {page.firstName}.</p>}
                            {page.status === 'cancelled' && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">This interview was cancelled. The recruiter will be in touch.</p>}
                            <dl className="rf-facts">
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
                            {page.joinUrl && <a href={page.joinUrl} className="rf-primary mt-4"><Video size={17} aria-hidden />Join the video call</a>}
                            {page.joinUrl && <p className="rf-sub text-sm">Open it a few minutes early. You will be let in when the interview starts. The call is recorded.</p>}
                        </section>

                        <div className={(page.jd || page.companyProfileUrl) && (open || showGuidelines) ? 'rf-columns' : 'rf-column'}>
                            {(open || showGuidelines) && <div className="rf-column rf-interview-aside">
                                {open && (
                                    <section className="rf-card" aria-label="Will you attend?">
                                        <h2 className="text-lg font-bold">Will you attend?</h2>
                                        {page.rsvp && <p className="mt-1 text-sm text-slate-600">{page.rsvp === 'yes' ? 'You said yes. Thank you, see you then.' : 'You said you cannot attend. The recruiter will be in touch.'} You can change your answer.</p>}
                                        {!askNo ? (
                                            <div className="mt-3 grid grid-cols-2 gap-2">
                                                <button type="button" onClick={() => void answer('yes')} disabled={busy} aria-pressed={page.rsvp === 'yes'} className="rf-primary">Yes, I will attend</button>
                                                <button type="button" onClick={() => setAskNo(true)} disabled={busy} aria-pressed={page.rsvp === 'no'} className="rf-secondary">No, I cannot</button>
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
                                {showGuidelines && (
                                    <section className="rf-card">
                                        <h2>Before the interview</h2>
                                        <ul className="rf-checklist">{page.guidelines.map((g, i) => <li key={i}>{g}</li>)}</ul>
                                    </section>
                                )}
                            </div>}
                            {(page.jd || page.companyProfileUrl) && (
                                <section className="rf-card">
                                    <h2>About the role</h2>
                                    {page.jd && <details className="rf-disclosure">
                                        <summary><FileText size={18} aria-hidden />Read the job description<ChevronDown size={18} aria-hidden /></summary>
                                        <FormDocument text={page.jd} />
                                    </details>}
                                    {page.companyProfileUrl && <a href={page.companyProfileUrl} target="_blank" rel="noopener noreferrer" className="rf-link mt-3 inline-block text-sm">Our company profile</a>}
                                </section>
                            )}
                        </div>
                    </>
                )}
            </div>
        </PublicFormPage>
    );
}
