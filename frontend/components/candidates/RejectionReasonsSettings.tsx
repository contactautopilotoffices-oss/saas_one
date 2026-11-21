'use client';

import React, { useEffect, useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api, qs } from './api';
import { setRejectionReasons } from './stage-ui';
import { BTN_GHOST, BTN_PRIMARY, CARD, FIELD, Spinner, useUi } from './ui';

/*
 * Recruitment -> Configurations: the rejection reasons (owner 2026-11-21; spec: "reason required to reject … a fixed
 * list keeps the reports usable"). Moving someone to a Rejected stage asks for one of these; anyone in HR edits them.
 */
export default function RejectionReasonsSettings({ orgId }: { orgId: string }) {
    const { notify } = useUi();
    const [saved, setSaved] = useState<string[] | null>(null);
    const [list, setList] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ reasons: string[] }>(`/api/candidates/rejection-reasons${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted || !res.ok) return;
            setSaved(res.data.reasons);
            setList(res.data.reasons);
        });
        return () => ctrl.abort();
    }, [orgId]);

    const clean = list.map(r => r.trim()).filter(Boolean);
    const dirty = !!saved && JSON.stringify(clean) !== JSON.stringify(saved);
    const save = async () => {
        setBusy(true);
        const res = await api<{ reasons: string[] }>('/api/candidates/rejection-reasons', { method: 'PUT', json: { orgId, reasons: clean } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        setSaved(res.data.reasons);
        setList(res.data.reasons);
        setRejectionReasons(orgId, res.data.reasons);
        notify('Rejection reasons saved', 'success');
    };

    return (
        <section className={`${CARD} px-5 py-4`} aria-label="Rejection reasons">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                    <h2 className="font-display text-lg font-semibold text-text-primary">Rejection reasons</h2>
                    <p className="mt-1 max-w-[70ch] text-sm text-text-secondary">Moving someone to a Rejected stage asks for one of these, so the reports can count why people drop. Moving someone back a round asks for a remark.</p>
                </div>
                <div className="flex items-center gap-x-2">
                    <button type="button" onClick={() => saved && setList(saved)} disabled={!dirty || busy} className={BTN_GHOST}><RotateCcw className="h-4 w-4" />Discard</button>
                    <button type="button" onClick={() => void save()} disabled={!dirty || busy || !clean.length} className={BTN_PRIMARY}>{busy && <Spinner />}Save reasons</button>
                </div>
            </div>
            {!saved ? <p className="mt-3 flex items-center gap-x-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Loading</p> : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {list.map((r, i) => (
                        <li key={i} className="flex items-center gap-x-2">
                            <label className="sr-only" htmlFor={`reason-${i}`}>Reason {i + 1}</label>
                            <input id={`reason-${i}`} value={r} maxLength={60} onChange={e => setList(l => l.map((x, j) => (j === i ? e.target.value : x)))} className={`${FIELD} h-9 min-w-0 flex-1`} />
                            <button type="button" onClick={() => setList(l => l.filter((_, j) => j !== i))} aria-label={`Remove ${r || 'this reason'}`} className={`${BTN_GHOST} h-9 w-9 px-0 text-error`}><Trash2 className="h-4 w-4" /></button>
                        </li>
                    ))}
                    <li><button type="button" onClick={() => setList(l => [...l, ''])} disabled={list.length >= 30} className={BTN_GHOST}><Plus className="h-4 w-4" />Add a reason</button></li>
                </ul>
            )}
        </section>
    );
}
