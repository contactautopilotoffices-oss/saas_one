'use client';

import { Segmented } from './page-kit';
import React, { useEffect, useState } from 'react';
import { Ban, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleDot, Download, FileSpreadsheet, FileText, PanelRightOpen, PencilLine, Plus, RotateCcw, Search, Trash2, Users, X } from 'lucide-react';
import {
    originLabel, RECORD_STATUSES, recordOrigin, STATUS_LABELS,
    type BulkResponse, type CandidateListResponse, type CandidateRecord, type RecordStatus, type SheetsResponse,
} from '@/backend/lib/candidates/types';
import ConfirmModal from '@/frontend/components/ui/ConfirmModal';
import ModalPortal from '@/frontend/components/ui/ModalPortal';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api, qs } from './api';
import CandidateDetails from './CandidateDetails';
import { PERMANENT_PHRASE, TypedConfirmDialog } from './DangerDialogs';
import { downloadCsv, recordsToCsv } from './export-csv';
import { formatCount, formatDate, formatDateShort, formatInr, formatMonths, formatNotice } from './format';
import RecordForm from './RecordForm';
import { BlacklistedTag, RemarkDialog, statusNeedsRemark } from './Remarks';
import { EmptyState, initials, LABEL, NUM_SM, Spinner, Toggle, useUi } from './ui';

type BlacklistFilter = 'hide' | 'only' | 'all';

const PAGE_SIZE = 50;

type Loaded<T> = { key: string; data: T | null; error: string };

/** Status changes sent at the same time by "Set status" on the ticked records. */
const BULK_PARALLEL = 4;

/*
 * Recruitment workspace skin (owner 2026-11-25): a page header, a toolbar of bordered pill filters, and the list as a
 * clean table in a white card (light grey header row, 52px rows). Neutral white/grey with teal as the action colour;
 * tokens only, and every hardcoded tint has a dark: pair.
 */
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PANEL = 'rounded-xl border border-border bg-surface';
const BTN_PRIMARY = `inline-flex h-9 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const BTN_SECONDARY = `inline-flex h-9 shrink-0 items-center justify-center gap-x-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-semibold text-text-primary transition-colors hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const BTN_GHOST = `inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const BTN_DANGER_GHOST = `inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-error transition-colors hover:bg-error/[.08] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const CHECKBOX = `h-4 w-4 cursor-pointer rounded accent-primary ${FOCUS}`;

/** A coloured rounded pill per status: a light tint with dark text of the same family (light and dark pairs). */
const STATUS_PILL: Record<RecordStatus, string> = {
    new: 'bg-stone-50 text-stone-800 ring-stone-200 dark:bg-stone-950/50 dark:text-stone-300 dark:ring-stone-900',
    in_process: 'bg-stone-50 text-stone-800 ring-stone-200 dark:bg-stone-950/50 dark:text-stone-300 dark:ring-stone-900',
    shortlisted: 'bg-green-50 text-green-800 ring-green-200 dark:bg-green-950/50 dark:text-green-300 dark:ring-green-900',
    interview: 'bg-stone-50 text-stone-800 ring-stone-200 dark:bg-stone-950/50 dark:text-stone-300 dark:ring-stone-900',
    on_hold: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900',
    not_responding: 'bg-muted text-text-secondary ring-border',
    rejected: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900',
    joined: 'bg-green-50 text-green-800 ring-green-200 dark:bg-green-950/50 dark:text-green-300 dark:ring-green-900',
    others: 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-stone-800/60 dark:text-stone-300 dark:ring-stone-700',
};

function StatusPill({ status }: { status: RecordStatus }) {
    return (
        <span className={`inline-flex h-6 max-w-full items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${STATUS_PILL[status]}`}>
            {STATUS_LABELS[status]}
        </span>
    );
}

/** 32px round initials, teal on a light teal tint. */
function RowAvatar({ name, size = 'h-8 w-8 text-xs' }: { name: string; size?: string }) {
    return (
        <span aria-hidden className={`${size} inline-flex shrink-0 select-none items-center justify-center rounded-full bg-primary/10 font-semibold text-primary-dark dark:text-primary-light`}>
            {initials(name)}
        </span>
    );
}

/** A native select dressed as a white bordered pill, with a leading icon and a caret. */
function PillSelect({ icon: Icon, label, value, onChange, children, active }: {
    icon: React.ComponentType<{ className?: string }>; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; active: boolean;
}) {
    return (
        <label className={`relative inline-flex h-9 min-w-0 items-center rounded-full border bg-surface transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${active ? 'border-primary/50' : 'border-border hover:border-text-tertiary'}`}>
            <span className="sr-only">{label}</span>
            <Icon className={`pointer-events-none absolute left-3 h-4 w-4 ${active ? 'text-primary' : 'text-text-tertiary'}`} aria-hidden />
            <select value={value} onChange={e => onChange(e.target.value)} className="h-full w-full min-w-0 cursor-pointer appearance-none truncate rounded-full bg-transparent py-0 pl-9 pr-8 text-sm font-medium text-text-primary outline-none">
                {children}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-text-tertiary" aria-hidden />
        </label>
    );
}

/** The sheet's name, "From resume" or "Added manually" (owner 2026-11-11); only a sheet's name is in the full text colour. */
function SourceCell({ r }: { r: CandidateRecord }) {
    return <span className={recordOrigin(r) === 'sheet' ? 'text-text-primary' : 'text-text-secondary'}>{originLabel(r)}</span>;
}

export default function RecordsView({ orgId, dataVersion, onDataChanged }: { orgId: string; dataVersion: number; onDataChanged: () => void }) {
    const { notify, reportError } = useUi();
    const [qInput, setQInput] = useState('');
    const [layout, setLayout] = useState<'table' | 'cards'>('table');
    const [q, setQ] = useState('');
    const [status, setStatus] = useState<RecordStatus | ''>('');
    const [sheetId, setSheetId] = useState('');
    const [deleted, setDeleted] = useState(false);
    // Owner 2026-11-15: blacklisted people are hidden unless asked for.
    const [blacklisted, setBlacklisted] = useState<BlacklistFilter>('hide');
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
    // Redesign (owner 2026-11-11): a name opens the candidate's workspace (resume beside the details), as in Search.
    const [details, setDetails] = useState<{ record: CandidateRecord; open: boolean } | null>(null);
    const [statusBusy, setStatusBusy] = useState(false);

    // Debounced text search (300 ms); a new term starts again from page 1.
    useEffect(() => {
        if (qInput === q) return;
        const t = setTimeout(() => { setQ(qInput); setPage(1); }, 300);
        return () => clearTimeout(t);
    }, [qInput, q]);

    const listKey = JSON.stringify([orgId, q, status, sheetId, deleted, blacklisted, page, dataVersion, nonce]);
    useEffect(() => {
        const ctrl = new AbortController();
        const path = `/api/candidates${qs({ orgId, q: q.trim(), status, sheetId, deleted, blacklisted: blacklisted === 'hide' ? '' : blacklisted, page, pageSize: PAGE_SIZE })}`;
        void api<CandidateListResponse>(path, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); setList({ key: listKey, data: null, error: res.error }); return; }
            setList({ key: listKey, data: res.data, error: '' });
        });
        return () => ctrl.abort();
    }, [listKey, orgId, q, status, sheetId, deleted, blacklisted, page, reportError]);

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

    const selectionKey = JSON.stringify([orgId, q, status, sheetId, deleted, blacklisted, page]);
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

    const selectedRecords = records.filter(r => selected.includes(r.id));
    const exportSelected = () => {
        if (!selectedRecords.length) return;
        downloadCsv(`candidates-${new Date().toISOString().slice(0, 10)}.csv`, recordsToCsv(selectedRecords));
        // Owner 2026-11-24: every export is kept in the audit log.
        void api('/api/candidates/audit', { json: { orgId, action: 'export', count: selectedRecords.length, what: 'candidate records' } });
        notify(`${formatCount(selectedRecords.length)} ${selectedRecords.length === 1 ? 'candidate' : 'candidates'} exported`, 'success');
    };
    // Owner 2026-11-15: "Others" needs a remark; one remark covers every ticked record.
    const [bulkRemark, setBulkRemark] = useState<RecordStatus | null>(null);
    const setStatusOfSelected = async (next: RecordStatus, remark: string | null = null) => {
        const targets = selectedRecords.filter(r => r.status !== next);
        if (!targets.length || statusBusy) return;
        if (statusNeedsRemark(next) && !remark) { setBulkRemark(next); return; }
        setBulkRemark(null);
        setStatusBusy(true);
        let done = 0;
        let failed = 0;
        let at = 0;
        const lane = async () => {
            while (at < targets.length) {
                const record = targets[at];
                at += 1;
                const res = await api<{ record: CandidateRecord }>(`/api/candidates/${encodeURIComponent(record.id)}`, { method: 'PATCH', json: { orgId, status: next, ...(remark ? { actionRemark: remark } : {}) } });
                if (res.ok) done += 1; else { failed += 1; if (res.noAccess) reportError(res); }
            }
        };
        await Promise.all(Array.from({ length: Math.min(BULK_PARALLEL, targets.length) }, lane));
        setStatusBusy(false);
        if (done) {
            notify(`${formatCount(done)} ${done === 1 ? 'candidate' : 'candidates'} set to ${STATUS_LABELS[next]}${failed ? `; ${formatCount(failed)} could not be changed` : ''}`, failed ? 'info' : 'success');
            setSelection({ key: '', ids: [] });
            reload(); onDataChanged();
        } else if (failed) notify('The status could not be changed. Please try again.', 'error');
    };

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
            <button type="button" onClick={() => setDetails({ record: r, open: true })} className={BTN_GHOST} aria-label={`Open ${r.fullName}`} title="Open the profile and resume">
                <PanelRightOpen className="h-4 w-4" />{compact ? 'Open' : <span className="sr-only">Open</span>}
            </button>
            <button type="button" onClick={() => openEditor(r)} className={BTN_GHOST} aria-label={`Edit ${r.fullName}`} title="Edit">
                <PencilLine className="h-4 w-4" />{compact ? 'Edit' : <span className="sr-only">Edit</span>}
            </button>
            <button type="button" onClick={() => setConfirmDelete(r)} disabled={busyId === r.id} className={BTN_DANGER_GHOST} aria-label={`Delete ${r.fullName}`}>
                <Trash2 className="h-4 w-4" />{compact ? 'Delete' : <span className="sr-only">Delete</span>}
            </button>
        </>
    );

    return (
        <div className="space-y-4">
            {/* Page header (workspace skin): the screen's name, the live count under it, the actions on the right. */}
            <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
                <div className="min-w-0">
                    <h2 className="text-xl font-semibold tracking-tight text-text-primary">Talent directory</h2>
                    <p role="status" className="mt-0.5 flex items-center gap-2 text-sm text-text-secondary">
                        <span className="tabular-nums">{!data ? 'Loading…' : `${formatCount(total)} ${deleted ? 'deleted ' : ''}${total === 1 ? 'candidate' : 'candidates'}${filtering ? ' match' : ''}`}</span>
                        {loading && data && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Segmented label="Candidate layout" value={layout} onChange={setLayout} options={[{value:'table',label:'Table'}, {value:'cards',label:'Cards'}]} />
                    <Toggle checked={deleted} onChange={v => { setDeleted(v); setPage(1); }} label="Show deleted" />
                    <button type="button" onClick={() => openEditor(null)} className={BTN_PRIMARY}>
                        <Plus className="h-4 w-4" aria-hidden />Add candidate
                    </button>
                </div>
            </header>

            {/* Toolbar: the search box, then the filters as bordered pill dropdowns */}
            <div className="flex flex-col gap-x-3 gap-y-3 lg:flex-row lg:items-center">
                <label className="relative flex min-w-0 flex-1 items-center lg:max-w-md">
                    <span className="sr-only">Search candidates</span>
                    <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text-tertiary" aria-hidden />
                    <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Search name, email, phone, role, location…"
                        className="h-9 w-full min-w-0 rounded-lg border border-border bg-surface pl-9 pr-9 text-base text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary sm:text-sm" />
                    {qInput && (
                        <button type="button" onClick={() => setQInput('')} aria-label="Clear search" className={`absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-muted hover:text-text-primary ${FOCUS}`}>
                            <X className="h-4 w-4" aria-hidden />
                        </button>
                    )}
                </label>
                <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 sm:flex sm:flex-wrap sm:items-center">
                    <PillSelect icon={CircleDot} label="Filter by status" value={status} active={!!status} onChange={v => { setStatus(v as RecordStatus | ''); setPage(1); }}>
                        <option value="">All statuses</option>
                        {RECORD_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </PillSelect>
                    <PillSelect icon={FileSpreadsheet} label="Filter by where the record came from" value={sheetId} active={!!sheetId} onChange={v => { setSheetId(v); setPage(1); }}>
                        <option value="">All sources</option>
                        <option value="manual">Added manually</option>
                        <option value="resume">From resume</option>
                        {sheets.length > 0 && (
                            <optgroup label="Sheets">
                                {sheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </optgroup>
                        )}
                    </PillSelect>
                    <PillSelect icon={Ban} label="Blacklisted people" value={blacklisted} active={blacklisted !== 'hide'} onChange={v => { setBlacklisted(v as BlacklistFilter); setPage(1); }}>
                        <option value="hide">Hide blacklisted</option>
                        <option value="only">Only blacklisted</option>
                        <option value="all">Everyone</option>
                    </PillSelect>
                </div>
            </div>

            {deleted && <p className="text-sm text-text-secondary">Showing deleted records. Restore a record to bring it back into search, or delete it permanently.</p>}

            {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-primary/30 bg-primary/[.05] px-3 py-2" aria-live="polite">
                    <p className="pl-1 text-sm text-text-primary"><span className="font-semibold tabular-nums">{formatCount(selected.length)}</span> selected</p>
                    <button type="button" onClick={() => setSelection({ key: '', ids: [] })} className={BTN_GHOST}>Clear</button>
                    <span className="flex-1" />
                    {!deleted && (
                        <>
                            {statusBusy && <Spinner className="h-3.5 w-3.5 text-text-tertiary" />}
                            <select
                                aria-label="Set the status of the selected candidates"
                                value=""
                                disabled={statusBusy}
                                onChange={e => { if (e.target.value) void setStatusOfSelected(e.target.value as RecordStatus); }}
                                className={`h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-sm font-semibold text-text-primary disabled:opacity-60 ${FOCUS}`}
                            >
                                <option value="">Set status…</option>
                                {RECORD_STATUSES.map(st => <option key={st} value={st}>{STATUS_LABELS[st]}</option>)}
                            </select>
                            <button type="button" onClick={exportSelected} className={`${BTN_SECONDARY} h-8 px-3`}><Download className="h-4 w-4" aria-hidden />Export to Excel</button>
                        </>
                    )}
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

            <div className={`${PANEL} overflow-hidden`}>
                {list?.error && !loading ? (
                    <div role="alert" className="flex flex-col items-center px-4 py-12 text-center">
                        <CircleAlert className="mb-3 h-8 w-8 text-error" aria-hidden />
                        <p className="max-w-md text-sm text-text-primary">{list.error}</p>
                        <button type="button" onClick={reload} className={`${BTN_SECONDARY} mt-4`}>Try again</button>
                    </div>
                ) : !data && loading ? (
                    <div className="space-y-3 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
                ) : records.length === 0 ? (
                    <EmptyState icon={Users} title={deleted ? 'No deleted records' : filtering ? 'No matching candidates' : 'No candidates yet'}>
                        {deleted ? 'Deleted records show up here so you can restore them.'
                            : filtering ? 'Try a different search or clear the filters.'
                            : 'Upload a sourcing sheet from the Sheets view, upload resumes from the Resumes view, or add a candidate here.'}
                    </EmptyState>
                ) : (
                    <div className={`transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                        {/* Phone: cards */}
                        <ul className={layout === 'cards' ? "grid gap-x-4 gap-y-4 px-4 py-4 lg:grid-cols-2 xl:grid-cols-3" : "divide-y divide-border-subtle md:hidden"}>
                            {records.map(r => (
                                <li key={r.id} className={`space-y-2 px-4 py-3 ${layout === 'cards' ? 'rounded-2xl border border-border bg-surface' : ''}`}>
                                    <div className="flex items-start gap-x-2 gap-y-2">
                                        <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleRow(r.id)} aria-label={`Select ${r.fullName}`} className={`mt-2.5 shrink-0 ${CHECKBOX}`} />
                                        <RowAvatar name={r.fullName} size="h-9 w-9 text-xs" />
                                        <div className="min-w-0 flex-1">
                                            <button type="button" onClick={() => setDetails({ record: r, open: true })} className={`break-words rounded text-left font-semibold text-text-primary underline-offset-2 hover:underline ${FOCUS}`}>{r.fullName}</button>
                                            {r.role && <p className="text-sm text-text-secondary">For {r.role}</p>}
                                            <p className="break-words text-xs text-text-secondary">{[r.currentDesignation, r.location].filter(Boolean).join(' · ') || '—'}</p>
                                        </div>
                                        <span className="flex flex-col items-end gap-1">
                                            <StatusPill status={r.status} />
                                            {r.blacklisted && <BlacklistedTag />}
                                        </span>
                                    </div>
                                    <dl className="grid grid-cols-3 gap-x-2 gap-y-2">
                                        <div><dt className={LABEL}>Relevant</dt><dd className={`${NUM_SM} text-text-primary`}>{formatMonths(r.relevantExpMonths)}</dd></div>
                                        <div><dt className={LABEL}>Notice</dt><dd className={`${NUM_SM} text-text-primary`}>{formatNotice(r.noticePeriodDays)}</dd></div>
                                        <div><dt className={LABEL}>Expects</dt><dd className={`${NUM_SM} text-text-primary`}>{formatInr(r.expectedInhand)}</dd></div>
                                    </dl>
                                    <div className="flex items-center gap-x-1 gap-y-1">
                                        <p className="min-w-0 flex-1 truncate text-xs text-text-tertiary"><SourceCell r={r} />{r.hasResume ? ' · Resume' : ''} · {formatDate(r.updatedAt)}</p>
                                        {rowActions(r, true)}
                                    </div>
                                </li>
                            ))}
                        </ul>

                        {/* md and up: table, scrolling inside its own container */}
                        <div className={layout === 'cards' ? "hidden" : "hidden overflow-x-auto md:block"}>
                            <table className="w-full min-w-[1120px] border-collapse text-sm">
                                <thead className="border-b border-border bg-surface-elevated">
                                    <tr className="text-left text-xs font-semibold text-text-secondary">
                                        <th scope="col" className="w-10 py-2.5 pl-4">
                                            <input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Select every record on this page" className={CHECKBOX} />
                                        </th>
                                        <th scope="col" className="px-3 py-2 font-semibold">Candidate</th>
                                        <th scope="col" className="px-3 py-2 font-semibold">Current role</th>
                                        <th scope="col" className="px-3 py-2 font-semibold">Sourced for</th>
                                        <th scope="col" className="px-3 py-2 text-right font-semibold">Relevant exp</th>
                                        <th scope="col" className="px-3 py-2 text-right font-semibold">Notice</th>
                                        <th scope="col" className="px-3 py-2 text-right font-semibold">Expected</th>
                                        <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                                        <th scope="col" className="px-3 py-2 font-semibold">Came from</th>
                                        <th scope="col" className="px-3 py-2 font-semibold">{deleted ? 'Deleted' : 'Updated'}</th>
                                        <th scope="col" className="sticky right-0 bg-surface-elevated px-3 py-2 shadow-[-1px_0_0_var(--border-subtle)]"><span className="sr-only">Actions</span></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border-subtle">
                                    {records.map(r => (
                                        <tr key={r.id} className={`group h-[52px] align-middle transition-colors hover:bg-surface-elevated ${selected.includes(r.id) ? 'bg-primary/[.04]' : ''}`}>
                                            <td className="w-10 py-2 pl-4">
                                                <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleRow(r.id)} aria-label={`Select ${r.fullName}`} className={CHECKBOX} />
                                            </td>
                                            <td className="max-w-[240px] px-3 py-2">
                                                <div className="flex min-w-0 items-center gap-2.5">
                                                    <RowAvatar name={r.fullName} />
                                                    <div className="min-w-0">
                                                        <button type="button" onClick={() => setDetails({ record: r, open: true })} className={`block max-w-full truncate rounded text-left font-semibold text-text-primary underline-offset-2 hover:underline ${FOCUS}`} title={`Open ${r.fullName}`}>{r.fullName}</button>
                                                        {(r.email || r.phone) && <p className="truncate text-xs tabular-nums text-text-secondary" title={[r.email, r.phone].filter(Boolean).join(' · ')}>{r.email || r.phone}</p>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="max-w-[180px] px-3 py-2">
                                                <p className="truncate text-text-primary" title={r.currentDesignation ?? ''}>{r.currentDesignation || '—'}</p>
                                                {(r.currentOrganization || r.location) && <p className="truncate text-xs text-text-secondary" title={[r.currentOrganization, r.location].filter(Boolean).join(' · ')}>{[r.currentOrganization, r.location].filter(Boolean).join(' · ')}</p>}
                                            </td>
                                            <td className="max-w-[140px] truncate px-3 py-2 text-text-primary" title={r.role ?? ''}>{r.role || '—'}</td>
                                            <td className={`${NUM_SM} whitespace-nowrap px-3 py-2 text-right text-text-primary`}>{formatMonths(r.relevantExpMonths)}</td>
                                            <td className={`${NUM_SM} whitespace-nowrap px-3 py-2 text-right text-text-primary`}>{formatNotice(r.noticePeriodDays)}</td>
                                            <td className={`${NUM_SM} whitespace-nowrap px-3 py-2 text-right text-text-primary`}>{formatInr(r.expectedInhand)}</td>
                                            <td className="px-3 py-2"><span className="flex flex-wrap items-center gap-1"><StatusPill status={r.status} />{r.blacklisted && <BlacklistedTag />}</span></td>
                                            <td className="max-w-[170px] px-3 py-2">
                                                <p className="truncate" title={originLabel(r)}><SourceCell r={r} /></p>
                                                {r.hasResume !== undefined && (
                                                    <p className={`flex items-center gap-x-1 text-xs ${r.hasResume ? 'font-medium text-green-800 dark:text-green-300' : 'text-text-tertiary'}`}>
                                                        {r.hasResume && <FileText className="h-3 w-3 shrink-0" aria-hidden />}{r.hasResume ? 'Resume on file' : 'No resume'}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-text-secondary" title={formatDate(deleted ? r.deletedAt : r.updatedAt)}>{formatDateShort(deleted ? r.deletedAt : r.updatedAt)}</td>
                                            <td className="sticky right-0 whitespace-nowrap bg-surface px-3 py-2 shadow-[-1px_0_0_var(--border-subtle)] group-hover:bg-surface-elevated">
                                                <div className="flex justify-end gap-x-0.5">{rowActions(r)}</div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {total > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-4 py-2.5">
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
                        <div className="flex items-center gap-x-1 gap-y-1">
                            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className={`${BTN_SECONDARY} h-8 px-2.5`} aria-label="Previous page">
                                <ChevronLeft className="h-4 w-4" /><span className="hidden sm:inline">Previous</span>
                            </button>
                            <span className="px-1 text-xs tabular-nums text-text-secondary">Page {page} of {pages}</span>
                            <button type="button" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages || loading} className={`${BTN_SECONDARY} h-8 px-2.5`} aria-label="Next page">
                                <span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {details && (
                <CandidateDetails
                    orgId={orgId}
                    onChanged={() => { reload(); onDataChanged(); }}
                    record={details.record}
                    open={details.open}
                    onClose={() => setDetails(d => (d ? { ...d, open: false } : d))}
                    onEdit={() => {
                        setDetails(d => (d ? { ...d, open: false } : d));
                        openEditor(details.record);
                    }}
                />
            )}
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

            <RemarkDialog
                open={bulkRemark !== null}
                required
                busy={statusBusy}
                title={bulkRemark ? `${formatCount(selectedRecords.length)} ${selectedRecords.length === 1 ? 'candidate' : 'candidates'}: ${STATUS_LABELS[bulkRemark]}` : ''}
                description={bulkRemark ? `"${STATUS_LABELS[bulkRemark]}" needs a remark; this one is kept on each of them.` : undefined}
                placeholder="e.g. Moved to the Bengaluru requirement"
                onClose={() => setBulkRemark(null)}
                onSubmit={remark => { if (bulkRemark) void setStatusOfSelected(bulkRemark, remark); }}
            />
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
