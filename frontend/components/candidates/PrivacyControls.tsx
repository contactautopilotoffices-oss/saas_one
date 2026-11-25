'use client';

import React, { useEffect, useState } from 'react';
import { Bookmark, Trash2 } from 'lucide-react';
import type { AuditEntry } from '@/backend/lib/candidates/audit';
import type { MessageEntry } from '@/backend/lib/candidates/messages';
import type { SearchFilters } from '@/backend/lib/candidates/filters';
import type { SavedSearch } from '@/backend/lib/candidates/privacy';
import type { CandidateRecord } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { formatDate } from './format';
import { BTN_DANGER_FILLED } from './Remarks';
import { BTN_GHOST, CARD, Dialog, INPUT, LABEL, Spinner, useUi } from './ui';

/*
 * Product safety (owner 2026-11-24): saved searches, "remove this person's data" on a request, and the audit log.
 */

/** A recruiter's own named searches: save the current filters, or load one. */
export function SavedSearches({ orgId, filters, onLoad }: { orgId: string; filters: SearchFilters; onLoad: (f: SearchFilters) => void }) {
    const { notify } = useUi();
    const [list, setList] = useState<SavedSearch[]>([]);
    const [nonce, setNonce] = useState(0);
    const [naming, setNaming] = useState<string | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ searches: SavedSearch[] }>(`/api/candidates/saved-searches${qs({ orgId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setList(res.data.searches); });
        return () => ctrl.abort();
    }, [orgId, nonce]);
    const save = async () => {
        if (!naming?.trim()) return;
        const res = await api<{ search: SavedSearch }>('/api/candidates/saved-searches', { json: { orgId, name: naming, filters } });
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify(`Saved "${res.data.search.name}"`, 'success');
        setNaming(null);
        setNonce(n => n + 1);
    };
    const remove = async (id: string) => {
        const res = await api<{ ok: true }>('/api/candidates/saved-searches', { method: 'DELETE', json: { orgId, id } });
        if (!res.ok) { notify(res.error, 'error'); return; }
        setNonce(n => n + 1);
    };
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Bookmark className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
            {list.map(s => (
                <span key={s.id} className="inline-flex items-center rounded-lg bg-surface-elevated pl-2.5 ring-1 ring-inset ring-border-subtle">
                    <button type="button" onClick={() => onLoad(s.filters)} className="h-7 text-[13px] font-medium text-text-primary">{s.name}</button>
                    <button type="button" aria-label={`Remove ${s.name}`} onClick={() => void remove(s.id)} className="h-7 w-7 text-text-tertiary hover:text-error"><Trash2 className="mx-auto h-3 w-3" /></button>
                </span>
            ))}
            {naming === null ? (
                <button type="button" onClick={() => setNaming('')} className={`${BTN_GHOST} h-7 px-2 text-[13px]`}>Save this search</button>
            ) : (
                <span className="inline-flex items-center gap-1">
                    <input aria-label="Name of the search" autoFocus value={naming} onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setNaming(null); }} maxLength={80} placeholder="Name" className={`${INPUT} h-7 w-40 text-[13px]`} />
                    <button type="button" onClick={() => void save()} disabled={!naming.trim()} className={`${BTN_GHOST} h-7 px-2 text-[13px]`}>Save</button>
                    <button type="button" onClick={() => setNaming(null)} className={`${BTN_GHOST} h-7 px-2 text-[13px]`}>Cancel</button>
                </span>
            )}
        </div>
    );
}

/** "Remove this person's data", on their request. */
export function RemoveDataButton({ orgId, record, onRemoved }: { orgId: string; record: CandidateRecord; onRemoved: () => void }) {
    const { notify } = useUi();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const remove = async () => {
        setBusy(true);
        const res = await api<{ records: number }>('/api/candidates/remove-data', { json: { orgId, candidateId: record.candidateId, reason } });
        setBusy(false);
        if (!res.ok) { notify(res.error, 'error'); return; }
        notify('Their details are removed and nothing will be sent to them again', 'success');
        setOpen(false);
        onRemoved();
    };
    return (
        <>
            <button type="button" onClick={() => { setReason(''); setOpen(true); }} className="inline-flex h-9 items-center rounded-xl px-3 text-[13px] font-semibold text-text-secondary hover:bg-error/[.08] hover:text-error">Remove data…</button>
            <Dialog open={open} onClose={() => setOpen(false)} title={`Remove ${record.fullName}'s data`} labelId={`remove-${record.id}`} size="sm"
                description="For a person who asked us to delete their details. Their name, email, phone, company and location are wiped from every record of theirs, their links stop working, and nothing is ever sent to them again. This cannot be undone. Their resume files stay until you delete the records permanently."
                footer={<button type="button" onClick={() => void remove()} disabled={busy || !reason.trim()} className={BTN_DANGER_FILLED}>{busy && <Spinner />}Remove their data</button>}>
                <label className={LABEL} htmlFor={`remove-reason-${record.id}`}>How the request came in</label>
                <input id={`remove-reason-${record.id}`} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="e.g. Email from the person, 24 Nov" className={`${INPUT} mt-1`} />
            </Dialog>
        </>
    );
}

const ACTION_LABELS: Record<string, string> = {
    export: 'Export', ctc_edit: 'Salary changed', offer_edit: 'Offer CTC changed', breakup_edit: 'Breakup changed', merge: 'Merge', removal: 'Data removed',
    delete: 'Record deleted', hard_delete: 'Deleted permanently', document_view: 'Document opened', assignment_view: 'Assignment file opened',
};

/** The audit log: who exported, changed a salary or an offer, removed data, opened a document. */
export function AuditLog({ orgId }: { orgId: string }) {
    const [data, setData] = useState<{ entries: AuditEntry[]; total: number } | null>(null);
    const [page, setPage] = useState(1);
    const [action, setAction] = useState('');
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ entries: AuditEntry[]; total: number }>(`/api/candidates/audit${qs({ orgId, page, action: action || undefined })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted) setData(res.ok ? res.data : { entries: [], total: 0 }); });
        return () => ctrl.abort();
    }, [orgId, page, action]);
    const show = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : String(x)}`).join(', ') : String(v));
    return (
        <section className={`${CARD} space-y-2 px-4 py-3`} aria-label="Audit log">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-semibold text-text-primary">Audit log</h2>
                <select aria-label="Which actions" value={action} onChange={e => { setAction(e.target.value); setPage(1); }} className={`${INPUT} ml-auto h-8 w-auto text-sm`}>
                    <option value="">Everything</option>{Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
            </div>
            {!data ? <Spinner /> : !data.entries.length ? <p className="text-sm text-text-secondary">Nothing logged yet.</p> : (
                <ol className="space-y-1 text-sm">
                    {data.entries.map(e => (
                        <li key={e.id} className="flex flex-wrap gap-x-2">
                            <span className="tabular-nums text-text-tertiary">{formatDate(e.at)}</span>
                            <span className="font-medium text-text-primary">{e.user ?? 'Someone'}</span>
                            <span className="text-text-secondary">{ACTION_LABELS[e.action] ?? e.action}{e.detail ? `: ${e.detail}` : ''}</span>
                            {(e.before !== null || e.after !== null) && e.action !== 'export' && <span className="text-xs text-text-tertiary">{e.before !== null ? `was ${show(e.before)}` : ''}{e.after !== null ? ` · now ${show(e.after)}` : ''}</span>}
                        </li>
                    ))}
                </ol>
            )}
            {data && data.total > 50 && (
                <div className="flex gap-2">
                    <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className={`${BTN_GHOST} h-8`}>Newer</button>
                    <button type="button" disabled={page * 50 >= data.total} onClick={() => setPage(p => p + 1)} className={`${BTN_GHOST} h-8`}>Older</button>
                </div>
            )}
        </section>
    );
}

/** Owner 2026-11-24: every message to or from the candidate, in one list (WhatsApp and email). */
export function MessageLog({ orgId, record }: { orgId: string; record: CandidateRecord }) {
    const [data, setData] = useState<{ id: string; messages: MessageEntry[] } | null>(null);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<{ messages: MessageEntry[] }>(`/api/candidates/messages${qs({ orgId, candidateId: record.candidateId })}`, { signal: ctrl.signal }).then(res => { if (!ctrl.signal.aborted && res.ok) setData({ id: record.candidateId, messages: res.data.messages }); });
        return () => ctrl.abort();
    }, [orgId, record.candidateId]);
    const list = data?.id === record.candidateId ? data.messages : null;
    if (!list?.length) return null;
    return (
        <details className="mt-4 rounded-xl bg-surface-elevated px-4 py-3" open>
            <summary className="cursor-pointer text-sm font-semibold text-text-primary">Messages ({list.length})</summary>
            <ol className="mt-2 space-y-1.5 text-sm">
                {list.map(m => (
                    <li key={m.id} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="tabular-nums text-xs text-text-tertiary">{formatDate(m.at)}</span>
                        <span className="text-xs font-semibold text-text-secondary">{m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} {m.direction === 'in' ? '←' : '→'}</span>
                        <span className="text-text-primary">{m.what}</span>
                        {m.status === 'failed' && <span className="text-xs text-error">not sent{m.error ? `: ${m.error}` : ''}</span>}
                        {m.by && <span className="text-xs text-text-tertiary">by {m.by}</span>}
                    </li>
                ))}
            </ol>
        </details>
    );
}
