'use client';

import React, { use, useEffect, useState } from 'react';
import type { PublicForm } from '@/backend/lib/candidates/applications';
import type { ApplicationField } from '@/backend/lib/candidates/outreach-settings';

/**
 * The job application form: /apply/<token> (owner 2026-11-24). No sign-in; the link is the key. The questions are the
 * ones HR set in Recruitment → Outreach → Application form. Listed in proxy.ts as a public route.
 */

const INPUT = 'mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-50';

export default function ApplyPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
    const [form, setForm] = useState<PublicForm | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [file, setFile] = useState<File | null>(null);
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ text: string; field: string | null } | null>(null);
    const [thanks, setThanks] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/public/apply/${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async res => {
            const data = await res.json().catch(() => null);
            if (cancelled) return;
            if (!res.ok || !data?.form) { setLoadError(data?.error ?? 'This application link is no longer open.'); return; }
            setForm(data as PublicForm);
        }).catch(() => { if (!cancelled) setLoadError('The form could not be opened. Check your connection and try again.'); });
        return () => { cancelled = true; };
    }, [token]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form || busy) return;
        if (!consent) { setError({ text: 'Please agree to the consent statement to apply.', field: 'consent' }); return; }
        setBusy(true);
        setError(null);
        const body = new FormData();
        body.set('answers', JSON.stringify(answers));
        body.set('consent', 'true');
        if (file) body.set('resume', file);
        try {
            const res = await fetch(`/api/public/apply/${encodeURIComponent(token)}`, { method: 'POST', body });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setError({ text: data?.error ?? 'Your application could not be sent. Please try again.', field: data?.field ?? null });
                if (data?.field) document.getElementById(`f-${data.field}`)?.focus();
                return;
            }
            setThanks(data?.thanks ?? 'Thank you. Your application has been received.');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
            setError({ text: 'Your application could not be sent. Check your connection and try again.', field: null });
        } finally {
            setBusy(false);
        }
    };

    const field = (f: ApplicationField) => {
        const id = `f-${f.id}`;
        const value = answers[f.id] ?? '';
        const set = (v: string) => setAnswers(a => ({ ...a, [f.id]: v }));
        const invalid = error?.field === f.id;
        const common = { id, name: f.id, required: f.required, disabled: busy, 'aria-invalid': invalid || undefined, className: `${INPUT} ${invalid ? 'border-rose-500' : ''}` };
        let input: React.ReactNode;
        if (f.type === 'textarea') input = <textarea {...common} rows={4} value={value} onChange={e => set(e.target.value)} maxLength={3000} />;
        else if (f.type === 'select') input = (
            <select {...common} value={value} onChange={e => set(e.target.value)}>
                <option value="">Choose…</option>
                {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
        );
        else if (f.type === 'file') input = <input {...common} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => setFile(e.target.files?.[0] ?? null)} className={`${common.className} file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white`} />;
        else input = (
            <input {...common} value={value} onChange={e => set(e.target.value)}
                type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'date' ? 'date' : 'text'}
                inputMode={f.type === 'number' ? 'decimal' : f.type === 'phone' ? 'tel' : undefined} min={f.type === 'number' ? 0 : undefined} step={f.type === 'number' ? 'any' : undefined}
                autoComplete={f.target === 'fullName' ? 'name' : f.target === 'email' ? 'email' : f.target === 'phone' ? 'tel' : undefined} maxLength={f.type === 'number' ? undefined : 500} />
        );
        return (
            <div key={f.id}>
                <label htmlFor={id} className="text-sm font-semibold text-slate-800">{f.label}{f.required ? <span className="text-rose-600"> *</span> : <span className="font-normal text-slate-400"> (optional)</span>}</label>
                {f.help && <p className="text-xs text-slate-500">{f.help}</p>}
                {input}
                {invalid && <p className="mt-1 text-sm text-rose-700">{error?.text}</p>}
            </div>
        );
    };

    return (
        <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:py-12">
            <div className="mx-auto max-w-xl">
                {!form && !loadError && <p className="text-center text-sm text-slate-500">Loading the form…</p>}
                {loadError && (
                    <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
                        <h1 className="text-lg font-bold">This link is not open</h1>
                        <p className="mt-1 text-sm text-slate-600">{loadError}</p>
                    </div>
                )}
                {form && thanks && (
                    <div className="rounded-2xl bg-white p-6 text-center shadow-sm" role="status">
                        <h1 className="text-xl font-bold">Application sent</h1>
                        <p className="mt-2 text-[15px] text-slate-700">{thanks}</p>
                    </div>
                )}
                {form && !thanks && (
                    <form onSubmit={submit} noValidate className="space-y-5 rounded-2xl bg-white p-5 shadow-sm sm:p-7">
                        <header>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{form.companyName}</p>
                            <h1 className="mt-1 text-2xl font-bold leading-tight">{form.role ? `${form.form.title}: ${form.role}` : form.form.title}</h1>
                            {form.location && <p className="text-sm text-slate-600">{form.location}</p>}
                            <p className="mt-3 text-[15px] text-slate-700">{form.firstName ? `Hello ${form.firstName}. ` : ''}{form.form.intro}</p>
                        </header>
                        {form.form.fields.map(field)}
                        <label className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${error?.field === 'consent' ? 'border-rose-500' : 'border-slate-200'}`}>
                            <input id="f-consent" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 accent-slate-900" />
                            <span className="text-slate-700">{form.form.consentText}</span>
                        </label>
                        {error && !form.form.fields.some(f => f.id === error.field) && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error.text}</p>}
                        <button type="submit" disabled={busy} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-[15px] font-bold text-white disabled:opacity-60">{busy ? 'Sending…' : 'Submit application'}</button>
                        <p className="text-center text-xs text-slate-400">Fields marked * are required.</p>
                    </form>
                )}
            </div>
        </main>
    );
}
