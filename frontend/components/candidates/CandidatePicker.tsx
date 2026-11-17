'use client';

import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { CandidateListResponse, CandidateRecord } from '@/backend/lib/candidates/types';
import { api, qs } from './api';
import { Avatar, INPUT, OVERLAY, Spinner } from './ui';

/**
 * A small "which candidate?" box (owner 2026-11-15): type a name, phone or email, pick a record. Used to attach a
 * file that could not be read to its candidate without leaving the Resumes tab. Reads the Candidates list API.
 */
export default function CandidatePicker({ orgId, label, busy, onPick, onCancel, autoFocus = true }: {
    orgId: string; label: string; busy?: boolean; onPick: (record: CandidateRecord) => void; onCancel: () => void; autoFocus?: boolean;
}) {
    const [q, setQ] = useState('');
    const [found, setFound] = useState<{ key: string; records: CandidateRecord[] } | null>(null);
    const typed = q.trim();
    useEffect(() => {
        if (typed.length < 2) return;
        const ctrl = new AbortController();
        const t = setTimeout(() => {
            void api<CandidateListResponse>(`/api/candidates${qs({ orgId, q: typed, pageSize: 6 })}`, { signal: ctrl.signal }).then(res => {
                if (ctrl.signal.aborted) return;
                setFound({ key: typed, records: res.ok ? res.data.records : [] });
            });
        }, 200);
        return () => { clearTimeout(t); ctrl.abort(); };
    }, [orgId, typed]);
    const records = typed.length >= 2 && found?.key === typed ? found.records : null;
    return (
        <div className="relative w-full min-w-0 sm:w-80">
            <label className="relative flex items-center">
                <span className="sr-only">{label}</span>
                <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text-tertiary" aria-hidden />
                <input value={q} onChange={e => setQ(e.target.value)} autoFocus={autoFocus} placeholder="Type a name, phone or email" disabled={busy}
                    onKeyDown={e => { if (e.key === 'Escape') { setQ(''); onCancel(); } }}
                    className={`${INPUT} h-10 pl-9 pr-9 text-sm`} />
                {q && <button type="button" onClick={() => { setQ(''); onCancel(); }} aria-label="Clear" className="absolute right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-muted"><X className="h-4 w-4" /></button>}
            </label>
            {typed.length >= 2 && (
                <ul className={`${OVERLAY} absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-xl px-1 py-1`} aria-label="Matching candidates">
                    {records === null ? (
                        <li className="flex items-center gap-x-2 px-2.5 py-2 text-sm text-text-tertiary"><Spinner className="h-3.5 w-3.5" />Searching</li>
                    ) : records.length === 0 ? (
                        <li className="px-2.5 py-2 text-sm text-text-tertiary">No candidate matches that.</li>
                    ) : records.map(r => (
                        <li key={r.id}>
                            <button type="button" disabled={busy} onMouseDown={e => { e.preventDefault(); onPick(r); }} className="flex w-full items-center gap-x-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
                                <Avatar name={r.fullName} size="sm" />
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-semibold text-text-primary">{r.fullName}</span>
                                    <span className="block truncate text-xs text-text-secondary">{[r.currentDesignation, r.location, r.phone].filter(Boolean).join(' · ') || r.email || '—'}</span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
