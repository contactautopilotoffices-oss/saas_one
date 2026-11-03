'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, PencilLine, Plus, RotateCcw, Search, Trash2, Users, X } from 'lucide-react';
import {
    RECORD_STATUSES, STATUS_LABELS,
    type BulkResponse, type CandidateListResponse, type CandidateRecord, type RecordStatus, type SheetsResponse,
} from '@/backend/lib/candidates/types';
import ConfirmModal from '@/frontend/components/ui/ConfirmModal';
import ModalPortal from '@/frontend/components/ui/ModalPortal';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api, qs } from './api';
import { PERMANENT_PHRASE, TypedConfirmDialog } from './DangerDialogs';
import { formatCount, formatDate, formatInr, formatMonths, formatNotice } from './format';
import RecordForm from './RecordForm';
import {
    BTN_DANGER_GHOST, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, EmptyState, INPUT, LABEL, NUM_SM, StatusBadge, Toggle, useUi, WELL,
} from './ui';

const PAGE_SIZE = 50;

type Loaded<T> = { key: string; data: T | null; error: string };

function SourceCell({ r }: { r: CandidateRecord }) {
    return <span className={r.sheetName ? 'text-text-primary' : 'italic text-text-tertiary'}>{r.sheetName ?? 'Added by hand'}</span>;
}

export default function RecordsView({ orgId, dataVersion, onDataChanged }: { orgId: string; dataVersion: number; onDataChanged: () => void }) {
    const { notify, reportError } = useUi();
    const [qInput, setQInput] = useState('');
    const [q, setQ] = useState('');
    const [status, setStatus] = useState<RecordStatus | ''>('');
    const [sheetId, setSheetId] = useState('');
    const [deleted, setDeleted] = useState(false);
    const [page, setPage] = useState(1);
    const [nonce, setNonce] = useState(0);
    const [list, setList] = useState<Loaded<CandidateListResponse> | null>(null);
    const [sheets, setSheets] = useState<SheetsResponse['sheets']>([]);
    const [editor, setEditor] = useState<{ record: CandidateRecord | null; key: number } | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<CandidateRecord | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    // Ticked rows belong to one view (filters + page): a different view starts with nothing ticked.
    const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
    // Bulk delete (owner 2026-11-03): ticked rows or all matching -> deleted (restorable); purge -> erased for good.
    const [bulk, setBulk] = useState<{ kind: 'selected' | 'matching' | 'purge'; ids: string[]; count: number; open: boolean; key: number } | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);

    // Debounced text search (300 ms); a new term starts again from page 1.
    useEffect(() => {
        if (qInput === q) return;
        const t = setTimeout(() => { setQ(qInput); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [qInput, q]);

    const listKey = JSON.stringify([orgId, q, status, sheetId, deleted, page, dataVersion, nonce]);
    useEffect(() => {
        const ctrl = new AbortController();
        const path = `/api/candidates${qs({ orgId, q: q.trim(), status, sheetId, deleted, page, pageSize: PAGE_SIZE })}`;
        void api<CandidateListResponse>(path, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); setList({ key: listKey, data: null, error: res.error }); return; }
            setList({ key: listKey, data: res.data, error: '' });
        });
        return () => ctrl.abort();
    }, [listKey, orgId, q, status, sheetId, deleted, page, reportError]);

    // Live sheets, for the sheet filter.
    useEffect(() => {
        const ctrl = new AbortController();
        void api<SheetsResponse>(`/api/candidates/sheets${qs({ orgId })}`, { signal: ctrl.signal }).then(res => {
            if (!ctrl.signal.aborted && res.ok) setSheets(res.data.sheets);
        });
        return () => ctrl.abort();
    }, [orgId, dataVersion]);

    const loading = list?.key !== listKey;
    const data = list?.data ?? null;
    const records = data?.records ?? [];
    const total = data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / (data?.pageSize || PAGE_SIZE)));
    const from = total === 0 ? 0 : (page - 1) * (data?.pageSize || PAGE_SIZE) + 1;
    const to = Math.min(total, page * (data?.pageSize || PAGE_SIZE));
    const filtering = !!(q || status || sheetId);

    const reload = () => setNonce(n => n + 1);

    const selectionKey = JSON.stringify([orgId, q, status, sheetId, deleted, page]);
    const selected = selection.key === selectionKey ? selection.ids : [];
    const allOnPage = records.length > 0 && records.every(r => selected.includes(r.id));
    const toggleRow = (id: string) => setSelection(sel => {
        const ids = sel.key === selectionKey ? sel.ids : [];
        return { key: selectionKey, ids: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] };
    });
    const togglePage = () => setSelection({ key: selectionKey, ids: allOnPage ? [] : records.map(r => r.id) });
    const openBulk = (kind: 'selected' | 'matching' | 'purge', ids: string[], count: number) =>
        setBulk(b => ({ kind, ids, count, open: true, key: (b?.key ?? 0) + 1 }));

    const doBulk = async () => {
        if (!bulk) return;
        setBulkBusy(true);
        const json = bulk.kind === 'matching'
            ? { orgId, action: 'delete', filter: { q: q.trim(), status, sheetId } }
            : { orgId, action: bulk.kind === 'purge' ? 'purge' : 'delete', ids: bulk.ids };
        const res = await api<BulkResponse>('/api/candidates/bulk', { json });
        setBulkBusy(false);
        if (!res.ok) { reportError(res); return; }
        setBulk(b => (b ? { ...b, open: false } : b));
        setSelection({ key: '', ids: [] });
        const n = res.data.records;
        notify(bulk.kind === 'purge'
            ? `${formatCount(n)} ${n === 1 ? 'record' : 'records'} deleted permanently`
            : `${formatCount(n)} ${n === 1 ? 'record' : 'records'} moved to deleted`, 'success');
        setPage(1);
        reload(); onDataChanged();
    };
    const openEditor = (record: CandidateRecord | null) => { setEditor(e => ({ record, key: (e?.key ?? 0) + 1 })); setEditorOpen(true); };

    const doDelete = async () => {
        const r = confirmDelete;
        if (!r) return;
        setBusyId(r.id);
        const res = await api<{ ok: true }>(`/api/candidates/${encodeURIComponent(r.id)}${qs({ orgId })}`, { method: 'DELETE' });
        setBusyId(null);
        setConfirmDelete(null);
        if (!res.ok) { reportError(res); return; }
        notify(`${r.fullName} deleted`, 'success');
        reload(); onDataChanged();
    };

    const doRestore = async (r: CandidateRecord) => {
        setBusyId(r.id);
        const res = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(r.id)}/restore`, { json: { orgId } });
        setBusyId(null);
        if (!res.ok) { reportError(res); return; }
        notify(`${r.fullName} restored`, 'success');
        reload(); onDataChanged();
    };

    const rowActions = (r: CandidateRecord, compact = false) => deleted ? (
        <>
            <button type="button" onClick={() => void doRestore(r)} disabled={busyId === r.id} className={BTN_GHOST}>
                <RotateCcw className="h-4 w-4" />Restore
            </button>
            <button type="button" onClick={() => openBulk('purge', [r.id], 1)} disabled={busyId === r.id} className={BTN_DANGER_GHOST} aria-label={`Delete ${r.fullName} permanently`}>
                <Trash2 className="h-4 w-4" />{compact ? 'Delete' : <span className="sr-only">Delete permanently</span>}
            </button>
        </>
    ) : (
        <>
            <button type="button" onClick={() => openEditor(r)} className={BTN_GHOST} aria-label={`Edit ${r.fullName}`}>
                <PencilLine className="h-4 w-4" />{compact ? 'Edit' : <span className="sr-only">Edit</span>}
            </button>
            <button type="button" onClick={() => setConfirmDelete(r)} disabled={busyId === r.id} className={BTN_DANGER_GHOST} aria-label={`Delete ${r.fullName}`}>
                <Trash2 className="h-4 w-4" />{compact ? 'Delete' : <span className="sr-only">Delete</span>}
            </button>
        </>
    );

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <label className="relative flex min-w-0 flex-1 items-center">
                    <span className="sr-only">Search candidates</span>
                    <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text-tertiary" aria-hidden />
                    <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Search name, email, phone, role, location…" className={`${INPUT} pl-9 pr-9`} />
                    {qInput && (
                        <button type="button" onClick={() => setQInput('')} aria-label="Clear search" className="absolute right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-muted">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </label>
                <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
                    <select aria-label="Filter by status" value={status} onChange={e => { setStatus(e.target.value as RecordStatus | ''); setPage(1); }} className={`${INPUT} sm:w-40`}>
                        <option value="">All statuses</option>
                        {RECORD_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                    <select aria-label="Filter by sheet" value={sheetId} onChange={e => { setSheetId(e.target.value); setPage(1); }} className={`${INPUT} sm:w-48`}>
                        <option value="">All sheets</option>
                        <option value="manual">Added by hand</option>
                        {sheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <Toggle checked={deleted} onChange={v => { setDeleted(v); setPage(1); }} label="Show deleted" />
                    <button type="button" onClick={() => openEditor(null)} className={`${BTN_PRIMARY} col-span-2 sm:col-span-1`}>
                        <Plus className="h-4 w-4" />Add candidate
                    </button>
                </div>
            </div>

            {deleted && <p className="text-sm text-text-secondary">Showing deleted records. Restore a record to bring it back into search, or delete it permanently.</p>}

            {selected.length > 0 && (
                <div className={`${WELL} flex flex-wrap items-center gap-2 px-4 py-2`} aria-live="polite">
                    <p className="text-sm text-text-primary"><span className="font-semibold tabular-nums">{formatCount(selected.length)}</span> selected</p>
                    <button type="button" onClick={() => setSelection({ key: '', ids: [] })} className={BTN_GHOST}>Clear</button>
                    <span className="flex-1" />
                    {deleted ? (
                        <button type="button" onClick={() => openBulk('purge', selected, selected.length)} className={BTN_DANGER_GHOST}>
                            <Trash2 className="h-4 w-4" />Delete permanently
                        </button>
                    ) : (
                        <button type="button" onClick={() => openBulk('selected', selected, selected.length)} className={BTN_DANGER_GHOST}>
                            <Trash2 className="h-4 w-4" />Delete selected
                        </button>
                    )}
                </div>
            )}

            <div className={`${CARD} overflow-hidden`}>
                {list?.error && !loading ? (
                    <div role="alert" className="flex flex-col items-center px-4 py-12 text-center">
                        <CircleAlert className="mb-3 h-8 w-8 text-error" aria-hidden />
                        <p className="max-w-md text-sm text-text-primary">{list.error}</p>
                        <button type="button" onClick={reload} className={`${BTN_SECONDARY} mt-4`}>Try again</button>
                    </div>
                ) : !data && loading ? (
                    <div className="space-y-3 p-4 sm:p-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
                ) : records.length === 0 ? (
                    <EmptyState icon={Users} title={deleted ? 'No deleted records' : filtering ? 'No matching candidates' : 'No candidates yet'}>
                        {deleted ? 'Deleted records show up here so you can restore them.'
                            : filtering ? 'Try a different search or clear the filters.'
                            : 'Upload a sourcing sheet from the Sheets view, or add a candidate by hand.'}
                    </EmptyState>
                ) : (
                    <div className={`transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                        {/* Phone: cards */}
                        <ul className="divide-y divide-border-subtle md:hidden">
                            {records.map(r => (
                                <li key={r.id} className="space-y-2 px-4 py-3">
                                    <div className="flex items-start gap-2">
                                        <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleRow(r.id)} aria-label={`Select ${r.fullName}`} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
                                        <div className="min-w-0 flex-1">
                                            <p className="break-words font-semibold text-text-primary">{r.fullName}</p>
                                            {r.role && <p className="text-sm text-primary-dark">For {r.role}</p>}
                                            <p className="break-words text-xs text-text-secondary">{[r.currentDesignation, r.location].filter(Boolean).join(' · ') || '—'}</p>
                                        </div>
                                        <StatusBadge status={r.status} />
                                    </div>
                                    <dl className="grid grid-cols-3 gap-2">
                                        <div><dt className={LABEL}>Relevant</dt><dd className={`${NUM_SM} text-text-primary`}>{formatMonths(r.relevantExpMonths)}</dd></div>
                                        <div><dt className={LABEL}>Notice</dt><dd className={`${NUM_SM} text-text-primary`}>{formatNotice(r.noticePeriodDays)}</dd></div>
                                        <div><dt className={LABEL}>Expects</dt><dd className={`${NUM_SM} text-text-primary`}>{formatInr(r.expectedInhand)}</dd></div>
                                    </dl>
                                    <div className="flex items-center gap-1">
                                        <p className="min-w-0 flex-1 truncate text-xs text-text-tertiary"><SourceCell r={r} /> · {formatDate(r.updatedAt)}</p>
                                        {rowActions(r, true)}
                                    </div>
                                </li>
                            ))}
                        </ul>

                        {/* md and up: table, scrolling inside its own container */}
                        <div className="hidden overflow-x-auto md:block">
                            <table className="w-full min-w-[1080px] border-collapse text-sm">
                                <thead className="bg-surface-elevated">
                                    <tr className={`${LABEL} text-left`}>
                                        <th scope="col" className="w-10 py-3 pl-4">
                                            <input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Select every record on this page" className="h-4 w-4 accent-primary" />
                                        </th>
                                        <th scope="col" className="px-3 py-3 font-semibold">Name</th>
                                        <th scope="col" className="px-3 py-3 font-semibold">Role sourced for</th>
                                        <th scope="col" className="px-3 py-3 font-semibold">Designation</th>
                                        <th scope="col" className="px-3 py-3 font-semibold">Location</th>
                                        <th scope="col" className="px-3 py-3 text-right font-semibold">Relevant exp</th>
                                        <th scope="col" className="px-3 py-3 text-right font-semibold">Notice</th>
                                        <th scope="col" className="px-3 py-3 text-right font-semibold">Expected</th>
                                        <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                                        <th scope="col" className="px-3 py-3 font-semibold">Sheet</th>
                                        <th scope="col" className="px-3 py-3 font-semibold">Updated</th>
                                        <th scope="col" className="sticky right-0 bg-surface-elevated px-4 py-3 shadow-[-1px_0_0_var(--border-subtle)]"><span className="sr-only">Actions</span></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border-subtle">
                                    {records.map(r => (
                                        <tr key={r.id} className="group align-middle hover:bg-surface-elevated">
                                            <td className="w-10 py-3 pl-4">
                                                <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleRow(r.id)} aria-label={`Select ${r.fullName}`} className="h-4 w-4 accent-primary" />
                                            </td>
                                            <td className="max-w-[220px] px-3 py-3">
                                                <p className="truncate font-semibold text-text-primary" title={r.fullName}>{r.fullName}</p>
                                                {(r.email || r.phone) && <p className="truncate text-xs tabular-nums text-text-tertiary">{r.email || r.phone}</p>}
                                            </td>
                                            <td className="max-w-[180px] truncate px-3 py-3 text-text-primary" title={r.role ?? ''}>{r.role || '—'}</td>
                                            <td className="max-w-[180px] truncate px-3 py-3 text-text-secondary" title={r.currentDesignation ?? ''}>{r.currentDesignation || '—'}</td>
                                            <td className="max-w-[140px] truncate px-3 py-3 text-text-secondary" title={r.location ?? ''}>{r.location || '—'}</td>
                                            <td className={`${NUM_SM} whitespace-nowrap px-3 py-3 text-right text-text-primary`}>{formatMonths(r.relevantExpMonths)}</td>
                                            <td className={`${NUM_SM} whitespace-nowrap px-3 py-3 text-right text-text-primary`}>{formatNotice(r.noticePeriodDays)}</td>
                                            <td className={`${NUM_SM} whitespace-nowrap px-3 py-3 text-right text-text-primary`}>{formatInr(r.expectedInhand)}</td>
                                            <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                                            <td className="max-w-[160px] truncate px-3 py-3" title={r.sheetName ?? 'Added by hand'}><SourceCell r={r} /></td>
                                            <td className="whitespace-nowrap px-3 py-3 tabular-nums text-text-secondary">{formatDate(deleted ? r.deletedAt : r.updatedAt)}</td>
                                            <td className="sticky right-0 whitespace-nowrap bg-surface px-4 py-3 shadow-[-1px_0_0_var(--border-subtle)] group-hover:bg-surface-elevated">
                                                <div className="flex justify-end gap-0.5">{rowActions(r)}</div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {total > 0 && (
                    <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="text-xs text-text-secondary">
                                <span className="tabular-nums">{formatCount(from)}–{formatCount(to)}</span> of <span className="font-semibold tabular-nums text-text-primary">{formatCount(total)}</span>
                            </p>
                            {!deleted && (
                                <button type="button" onClick={() => openBulk('matching', [], total)} disabled={loading} className={`${BTN_DANGER_GHOST} -ml-2.5 h-8 text-xs`}>
                                    <Trash2 className="h-3.5 w-3.5" />Delete all {formatCount(total)}{filtering ? ' matching' : ''}
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className={BTN_GHOST} aria-label="Previous page">
                                <ChevronLeft className="h-4 w-4" /><span className="hidden sm:inline">Previous</span>
                            </button>
                            <span className="px-1 text-xs tabular-nums text-text-tertiary">{page} / {pages}</span>
                            <button type="button" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages || loading} className={BTN_GHOST} aria-label="Next page">
                                <span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {editor && (
                <RecordForm
                    key={editor.key}
                    orgId={orgId}
                    record={editor.record}
                    open={editorOpen}
                    onClose={() => setEditorOpen(false)}
                    onSaved={() => { setEditorOpen(false); reload(); onDataChanged(); }}
                />
            )}

            <ModalPortal>
                <ConfirmModal
                    isOpen={!!confirmDelete}
                    onClose={() => { if (!busyId) setConfirmDelete(null); }}
                    onConfirm={() => void doDelete()}
                    isLoading={!!busyId}
                    title={confirmDelete ? `Delete ${confirmDelete.fullName}?` : 'Delete record?'}
                    message="This record is hidden from search and the table. You can restore it from Show deleted."
                    confirmText="Delete"
                />
                <ConfirmModal
                    isOpen={!!bulk?.open && bulk.kind !== 'purge'}
                    onClose={() => { if (!bulkBusy) setBulk(b => (b ? { ...b, open: false } : b)); }}
                    onConfirm={() => void doBulk()}
                    isLoading={bulkBusy}
                    title={bulk?.kind === 'matching'
                        ? `Delete all ${formatCount(bulk.count)}${filtering ? ' matching' : ''} records?`
                        : `Delete ${formatCount(bulk?.count ?? 0)} selected ${bulk?.count === 1 ? 'record' : 'records'}?`}
                    message="They are hidden from search and the table. You can restore them from Show deleted, or delete them permanently there."
                    confirmText="Move to deleted"
                />
            </ModalPortal>

            <TypedConfirmDialog
                key={bulk?.key ?? 0}
                open={!!bulk?.open && bulk.kind === 'purge'}
                labelId="purge-records-title"
                title={`Delete ${formatCount(bulk?.count ?? 0)} ${bulk?.count === 1 ? 'record' : 'records'} permanently?`}
                phrase={PERMANENT_PHRASE}
                confirmText="Delete permanently"
                busy={bulkBusy}
                onClose={() => setBulk(b => (b ? { ...b, open: false } : b))}
                onConfirm={() => void doBulk()}
            >
                The {bulk?.count === 1 ? 'record is' : 'records are'} erased for good. A candidate with no other record left is erased too. This cannot be undone.
            </TypedConfirmDialog>
        </div>
    );
}
