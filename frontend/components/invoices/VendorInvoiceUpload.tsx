'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createClient } from '@/frontend/utils/supabase/client';

/**
 * The vendor's page: /q/invoice/<token>. No login, no account.
 *
 * Shows the company, the PO reference and an upload box, and nothing else: no prices, no
 * internal notes, no other invoices, no verdict. Standalone styling on purpose (it must
 * look right on a vendor's phone with no dashboard theme around it).
 */

interface Info { organization_name: string | null; po_reference: string; expires_at: string; max_file_bytes: number }

const ACCEPT = 'application/pdf,image/jpeg,image/png';

export default function VendorInvoiceUpload({ token }: { token: string }) {
    const [info, setInfo] = useState<Info | null>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'done'>('loading');
    const [file, setFile] = useState<File | null>(null);
    const [number, setNumber] = useState('');
    const [date, setDate] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reference, setReference] = useState<string | null>(null);
    const key = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()));

    useEffect(() => {
        let alive = true;
        fetch(`/api/invoice-upload/${encodeURIComponent(token)}`, { cache: 'no-store', referrerPolicy: 'no-referrer' })
            .then(async (r) => { if (!r.ok) throw new Error('x'); return r.json(); })
            .then((d) => { if (alive) { setInfo(d); setState('ready'); } })
            .catch(() => { if (alive) setState('unavailable'); });
        return () => { alive = false; };
    }, [token]);

    const submit = async () => {
        if (!file || !info) return;
        setBusy(true); setError(null);
        try {
            const v = await fetch(`/api/invoice-upload/${encodeURIComponent(token)}/validate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, referrerPolicy: 'no-referrer',
                body: JSON.stringify({ filename: file.name, content_type: file.type, file_size_bytes: file.size }),
            });
            const slot = await v.json().catch(() => ({}));
            if (!v.ok) throw new Error(slot.error || 'This file cannot be uploaded.');

            const { error: upErr } = await createClient().storage.from(slot.bucket).uploadToSignedUrl(slot.upload_path, slot.upload_token, file, { contentType: file.type });
            if (upErr) throw new Error('The upload did not go through. Please try again.');

            const s = await fetch(`/api/invoice-upload/${encodeURIComponent(token)}/submit`, {
                method: 'POST', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key.current },
                body: JSON.stringify({ upload_id: slot.upload_id, filename: file.name, invoice_number: number || undefined, invoice_date: date || undefined }),
            });
            const done = await s.json().catch(() => ({}));
            if (!s.ok) throw new Error(s.status === 409 ? 'This link has already been used or has expired.' : done.error || 'We could not record your invoice.');
            setReference(done.submission_reference); setState('done');
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };

    const tooBig = !!file && !!info && file.size > info.max_file_bytes;

    return (
        <main className="min-h-screen bg-slate-50 flex items-start sm:items-center justify-center px-4 py-8">
            <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
                {state === 'loading' && <p className="text-center text-slate-500 py-10">Loading…</p>}

                {state === 'unavailable' && (
                    <div className="text-center py-6">
                        <h1 className="text-lg font-bold text-slate-900">This link is not available</h1>
                        <p className="text-sm text-slate-600 mt-2">It may have expired, been used already, or been replaced. Please ask the person who sent it for a new link.</p>
                    </div>
                )}

                {state === 'ready' && info && (
                    <div className="space-y-5">
                        <div>
                            {info.organization_name && <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">{info.organization_name}</p>}
                            <h1 className="text-xl font-bold text-slate-900 mt-1">Upload your invoice</h1>
                            <p className="text-sm text-slate-600 mt-1">Purchase order <b className="text-slate-900">{info.po_reference}</b></p>
                        </div>

                        <div>
                            <label htmlFor="inv-file" className="block text-sm font-bold text-slate-700 mb-1">Invoice file</label>
                            <input id="inv-file" type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                                className="block w-full text-sm text-slate-700 border border-slate-300 rounded-xl p-2 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:px-3 file:py-1.5 file:text-sm file:font-bold" />
                            <p className="text-xs text-slate-500 mt-1">PDF, JPEG or PNG, up to {Math.round(info.max_file_bytes / 1048576)} MB.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="inv-no" className="block text-sm font-bold text-slate-700 mb-1">Invoice no. <span className="font-normal text-slate-400">(optional)</span></label>
                                <input id="inv-no" value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" />
                            </div>
                            <div>
                                <label htmlFor="inv-date" className="block text-sm font-bold text-slate-700 mb-1">Date <span className="font-normal text-slate-400">(optional)</span></label>
                                <input id="inv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" />
                            </div>
                        </div>

                        {tooBig && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">That file is too large.</p>}
                        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

                        <button onClick={submit} disabled={!file || tooBig || busy}
                            className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold text-sm disabled:opacity-40">{busy ? 'Uploading…' : 'Submit invoice'}</button>
                        <p className="text-xs text-slate-500 text-center">This link works once. After you submit it can no longer be used.</p>
                    </div>
                )}

                {state === 'done' && (
                    <div className="text-center py-6 space-y-2">
                        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl" aria-hidden>✓</div>
                        <h1 className="text-lg font-bold text-slate-900">Invoice received</h1>
                        <p className="text-sm text-slate-600">Thank you. We will check it against the purchase order.</p>
                        {reference && <p className="text-xs text-slate-500">Your reference: <b className="text-slate-800">{reference}</b></p>}
                    </div>
                )}
            </div>
        </main>
    );
}
