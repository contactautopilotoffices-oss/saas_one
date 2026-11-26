'use client';

import React, { use, useEffect, useState } from 'react';
import type { PublicOffer } from '@/backend/lib/candidates/hiring';

/**
 * A candidate's letter of intent: /offer/<token> (owner 2026-11-24). No sign-in; the link is the key. The letter, the
 * salary breakup, and Accept / Decline (a reason to decline). Listed in proxy.ts as a public route.
 */

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

export default function OfferPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
    const [page, setPage] = useState<PublicOffer | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [declining, setDeclining] = useState(false);
    const [reason, setReason] = useState('');
    const [agree, setAgree] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/public/offer/${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async res => {
            const data = await res.json().catch(() => null);
            if (cancelled) return;
            if (!res.ok || !data?.status) { setLoadError(data?.error ?? 'This letter is not open.'); return; }
            setPage(data as PublicOffer);
        }).catch(() => { if (!cancelled) setLoadError('The page could not be opened. Check your connection and try again.'); });
        return () => { cancelled = true; };
    }, [token]);

    const answer = async (response: 'accepted' | 'declined') => {
        if (!page || busy) return;
        if (response === 'declined' && !reason.trim()) { setError('Please tell us why, in a line.'); return; }
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/public/offer/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response, reason: response === 'declined' ? reason : undefined }) });
            const data = await res.json().catch(() => null);
            if (!res.ok) { setError(data?.error ?? 'Your answer could not be saved. Please try again.'); return; }
            setPage(p => p && { ...p, status: data.status, answeredAt: new Date().toISOString() });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
            setError('Your answer could not be saved. Check your connection and try again.');
        } finally {
            setBusy(false);
        }
    };

    const group = (title: string, rows: [string, number][], total?: [string, number]) => rows.length ? (
        <tbody>
            <tr><th colSpan={2} className="pt-3 text-left text-sm font-semibold text-slate-900">{title}</th></tr>
            {rows.map(([k, v]) => <tr key={k}><td className="py-1 pr-4 text-slate-600">{k}</td><td className="py-1 text-right tabular-nums">{inr(v)}</td></tr>)}
            {total && <tr className="border-t border-slate-200"><td className="py-1 pr-4 font-semibold">{total[0]}</td><td className="py-1 text-right font-semibold tabular-nums">{inr(total[1])}</td></tr>}
        </tbody>
    ) : null;

    return (
        <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:py-12">
            <div className="mx-auto max-w-xl space-y-4">
                {!page && !loadError && <p className="text-center text-sm text-slate-500">Loading your letter…</p>}
                {loadError && (
                    <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
                        <h1 className="text-lg font-bold">This letter is not open</h1>
                        <p className="mt-1 text-sm text-slate-600">{loadError}</p>
                    </div>
                )}
                {page && (
                    <>
                        {page.status !== 'open' && (
                            <div role="status" className={`rounded-2xl p-5 text-center shadow-sm ${page.status === 'accepted' ? 'bg-emerald-50 text-emerald-900' : 'bg-white'}`}>
                                <h1 className="text-lg font-bold">{page.status === 'accepted' ? 'You accepted this offer' : page.status === 'declined' ? 'You declined this offer' : 'This offer is closed'}</h1>
                                <p className="mt-1 text-sm">{page.status === 'accepted' ? `Welcome to ${page.companyName}. Our HR team will be in touch about your joining${page.joiningDate ? ` on ${page.joiningDate}` : ''}.` : 'Thank you for letting us know.'}</p>
                            </div>
                        )}
                        <article className="space-y-4 rounded-2xl bg-white p-5 shadow-sm sm:p-7">
                            <header>
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{page.companyName}</p>
                                <h1 className="mt-1 text-2xl font-bold leading-tight">Letter of intent{page.role ? `: ${page.role}` : ''}</h1>
                                <p className="text-sm text-slate-600">{[page.location, `CTC ${page.ctc}`, page.joiningDate ? `Joining ${page.joiningDate}` : null].filter(Boolean).join(' · ')}</p>
                            </header>
                            <div className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-slate-800">{page.letter}</div>
                            {(page.breakup.earnings.length > 0 || page.breakup.deductions.length > 0 || page.breakup.benefits.length > 0 || page.breakup.other.length > 0) && (
                                <section>
                                    <h2 className="text-base font-bold">Salary breakup</h2>
                                    <table className="mt-1 w-full text-sm">
                                        {group('Earnings (per month)', page.breakup.earnings, ['Gross per month', page.breakup.gross])}
                                        {group('Deductions (per month)', page.breakup.deductions, ['Net per month (estimated)', page.breakup.net])}
                                        {group('Benefits (per year)', page.breakup.benefits)}
                                        {group('Other', page.breakup.other)}
                                    </table>
                                </section>
                            )}
                        </article>
                        {page.status === 'open' && (
                            <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm sm:p-7" aria-label="Your answer">
                                {!declining ? (
                                    <>
                                        <label className="flex items-start gap-3 text-sm text-slate-700">
                                            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 accent-slate-900" />
                                            <span>I have read the letter and the salary breakup, and I accept this offer.</span>
                                        </label>
                                        <button type="button" disabled={busy || !agree} onClick={() => void answer('accepted')} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-[15px] font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Accept the offer'}</button>
                                        <button type="button" disabled={busy} onClick={() => { setDeclining(true); setError(null); }} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-[15px] font-semibold text-slate-700">Decline</button>
                                    </>
                                ) : (
                                    <>
                                        <label htmlFor="reason" className="text-sm font-semibold">Please tell us why</label>
                                        <textarea id="reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} disabled={busy} className="block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-[15px] outline-none focus:border-slate-900" />
                                        <button type="button" disabled={busy} onClick={() => void answer('declined')} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-[15px] font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Decline the offer'}</button>
                                        <button type="button" disabled={busy} onClick={() => setDeclining(false)} className="w-full text-sm text-slate-600 underline">Back</button>
                                    </>
                                )}
                                {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
                                <p className="text-center text-xs text-slate-400">Questions? Reply to the email this letter came with.</p>
                            </section>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
