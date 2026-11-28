'use client';

import React, { use, useEffect, useState } from 'react';
import type { PublicForm } from '@/backend/lib/candidates/applications';
import type { ApplicationField } from '@/backend/lib/candidates/outreach-settings';
import { MapPin } from 'lucide-react';
import { FormDocument, PublicFormPage } from '@/frontend/components/recruitment/PublicFormPage';

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
    // Owner 2026-11-24: the assignment and documents pages take one file per question.
    const [files, setFiles] = useState<Record<string, File>>({});
    const [fileReset, setFileReset] = useState(0);
    const multi = form?.kind === 'assignment' || form?.kind === 'documents';
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
        if (form.kind === 'documents' && Object.values(files).reduce((total, item) => total + item.size, 0) > 4 * 1024 * 1024) {
            setError({ text: 'Upload up to 4 MB at a time. You can send the remaining documents from this same link.', field: null });
            return;
        }
        if (!consent) { setError({ text: 'Please agree to the consent statement to apply.', field: 'consent' }); return; }
        setBusy(true);
        setError(null);
        if (form.kind === 'documents') setThanks(null);
        const body = new FormData();
        body.set('answers', JSON.stringify(answers));
        body.set('consent', 'true');
        if (multi) for (const [id, f] of Object.entries(files)) body.set(`file_${id}`, f);
        else if (file) body.set('resume', file);
        try {
            const res = await fetch(`/api/public/apply/${encodeURIComponent(token)}`, { method: 'POST', body });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setError({ text: data?.error ?? 'Your application could not be sent. Please try again.', field: data?.field ?? null });
                if (data?.field) document.getElementById(`f-${data.field}`)?.focus();
                return;
            }
            setThanks(data?.thanks ?? 'Thank you. Your application has been received.');
            if (form.kind === 'documents') {
                setFileReset(n => n + 1);
                setFiles({});
                const latest = await fetch(`/api/public/apply/${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async r => r.ok ? await r.json() as PublicForm : null).catch(() => null);
                if (latest?.form) setForm(latest);
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
            setError({ text: 'Your application could not be sent. Check your connection and try again.', field: null });
        } finally {
            setBusy(false);
        }
    };

    const field = (f: ApplicationField) => {
        const id = `f-${f.id}`;
        const uploaded = form?.documents?.[f.id];
        const value = answers[f.id] ?? '';
        const set = (v: string) => setAnswers(a => ({ ...a, [f.id]: v }));
        const invalid = error?.field === f.id;
        const common = { id, name: f.id, required: f.required, disabled: busy, 'aria-invalid': invalid || undefined,
            'aria-describedby': [f.help && id + '-help', invalid && id + '-error'].filter(Boolean).join(' ') || undefined,
            className: `${INPUT} ${invalid ? 'border-rose-500' : ''}` };
        let input: React.ReactNode;
        if (f.type === 'textarea') input = <textarea {...common} rows={4} value={value} onChange={e => set(e.target.value)} maxLength={3000} />;
        else if (f.type === 'select') input = (
            <select {...common} value={value} onChange={e => set(e.target.value)}>
                <option value="">Choose…</option>
                {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
        );
        else if (f.type === 'file') input = uploaded?.status === 'verified' ? null : <input key={fileReset} {...common} type="file"
            accept={form?.kind === 'documents' ? '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp' : form?.kind === 'assignment' ? '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.zip' : '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
            onChange={e => { const picked = e.target.files?.[0] ?? null; if (multi) setFiles(all => { const next = { ...all }; if (picked) next[f.id] = picked; else delete next[f.id]; return next; }); else setFile(picked); }} className={`${common.className} file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white`} />;
        else input = (
            <input {...common} value={value} onChange={e => set(e.target.value)}
                type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'date' ? 'date' : 'text'}
                inputMode={f.type === 'number' ? 'decimal' : f.type === 'phone' ? 'tel' : undefined} min={f.type === 'number' ? 0 : undefined} step={f.type === 'number' ? 'any' : undefined}
                autoComplete={f.target === 'fullName' ? 'name' : f.target === 'email' ? 'email' : f.target === 'phone' ? 'tel' : undefined} maxLength={f.type === 'number' ? undefined : 500} />
        );
        return (
            <div key={f.id} className={['textarea', 'file'].includes(f.type) ? 'rf-field rf-wide' : 'rf-field'}>
                <label htmlFor={id} className="text-sm font-semibold text-slate-800">{f.label}{f.required ? <span className="text-rose-600"> *</span> : <span className="font-normal text-slate-400"> (optional)</span>}</label>
                {uploaded && <div className={`mt-1 rounded-lg px-3 py-2 text-sm ${uploaded.status === 'rejected' ? 'bg-amber-50 text-amber-950' : 'bg-slate-50 text-slate-800'}`}>
                    <p className="break-words"><strong>{uploaded.status === 'rejected' ? 'Changes requested' : uploaded.status === 'verified' ? 'Verified' : 'Waiting for review'}</strong>{uploaded.fileName ? ` · ${uploaded.fileName}` : ''}</p>
                    {uploaded.reviewNote && <p className="mt-1 whitespace-pre-wrap break-words">{uploaded.reviewNote}</p>}
                    {uploaded.status !== 'verified' && <p className="mt-1">Choose a replacement file below.</p>}
                </div>}
                {f.help && uploaded?.status !== 'verified' && <p id={id + '-help'} className="rf-sub text-sm">{f.help}</p>}
                {input}
                {invalid && <p id={id + '-error'} role="alert" className="mt-1 text-sm text-rose-700">{error?.text}</p>}
            </div>
        );
    };

    return (
        <PublicFormPage company={form?.companyName} title="Candidate portal">
            <div className="rf-stack">
                {!form && !loadError && <p role="status" className="rf-status">Loading the form…</p>}
                {loadError && (
                    <div className="rf-status" role="alert">
                        <h1 className="text-lg font-bold">This link is not open</h1>
                        <p className="mt-1 text-sm text-slate-600">{loadError}</p>
                    </div>
                )}
                {form && thanks && (
                    <div className="rf-status" role="status">
                        <h1 className="text-xl font-bold">{form.kind === 'assignment' ? 'Assignment submitted' : form.kind === 'documents' ? 'Documents received' : form.kind === 'screening' ? 'Answers sent' : 'Application sent'}</h1>
                        <p className="mt-2 text-[15px] text-slate-700">{thanks}</p>
                    </div>
                )}
                {form && (!thanks || form.kind === 'documents') && (
                    <form onSubmit={submit} noValidate className="rf-column">
                        <header className="rf-card rf-hero">
                            {form.role && <p className="rf-kicker">{form.form.title}</p>}
                            <h1>{form.role || form.form.title}</h1>
                            {form.location && <p className="rf-sub flex items-center gap-1.5 text-sm"><MapPin size={15} aria-hidden />{form.location}</p>}
                            <FormDocument text={`${form.firstName ? `Hello ${form.firstName}. ` : ''}${form.form.intro}`} />
                            {form.companyProfileUrl && form.kind !== 'documents' && <a href={form.companyProfileUrl} target="_blank" rel="noopener noreferrer" className="rf-link mt-3 inline-block text-sm">About {form.companyName}</a>}
                        </header>
                        {form.assignment && (
                            <section className="rf-card">
                                <h2 className="font-bold">{form.assignment.title}</h2>
                                {form.assignment.due && <p className="text-sm font-semibold text-amber-800">Submit by {form.assignment.due}</p>}
                                <FormDocument text={form.assignment.brief} />
                                {form.assignment.guidelines && <><h3>Guidelines</h3><FormDocument text={form.assignment.guidelines} /></>}
                                {form.assignment.attachmentName && <a href={`/api/public/apply/${encodeURIComponent(token)}?download=brief`} className="rf-secondary mt-3 max-w-full break-all">Download brief · {form.assignment.attachmentName}</a>}
                                {form.assignment.driveLink && <a href={form.assignment.driveLink} target="_blank" rel="noopener noreferrer" className="rf-secondary mt-3">Open the assignment files</a>}
                            </section>
                        )}
                        <section className="rf-card">
                            <h2>{form.kind === 'assignment' ? 'Your submission' : form.kind === 'documents' ? 'Requested files' : form.kind === 'screening' ? 'Your responses' : 'Application details'}</h2>
                            {form.kind !== 'documents' && <p className="mb-5 text-sm text-stone-600">Fields marked * are required.</p>}
                            <div className="rf-fields">{form.form.fields.map(field)}</div>
                        </section>
                        <section className="rf-card space-y-4">
                            <h2>Consent and submission</h2>
                            <label className="rf-consent flex items-start gap-3 text-sm">
                                <input id="f-consent" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 accent-slate-900" />
                                <span className="text-slate-700">{form.form.consentText}</span>
                            </label>
                            {error && !form.form.fields.some(f => f.id === error.field) && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error.text}</p>}
                            <button type="submit" disabled={busy || (form.kind === 'documents' && !Object.keys(files).length)} className="rf-primary">{busy ? 'Sending…' : form.kind === 'assignment' ? 'Submit assignment' : form.kind === 'documents' ? 'Upload documents' : form.kind === 'screening' ? 'Send answers' : 'Submit application'}</button>
                        </section>
                    </form>
                )}
            </div>
        </PublicFormPage>
    );
}
