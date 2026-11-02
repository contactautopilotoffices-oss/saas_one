'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, CircleCheck, FileSpreadsheet, ListChecks, RotateCcw, Trash2, Upload, X, Zap } from 'lucide-react';
import type {
    CandidateSheet, ImportSummary, ReindexResponse, SheetsResponse, UploadConflict, UploadMode,
} from '@/backend/lib/candidates/types';
import ConfirmModal from '@/frontend/components/ui/ConfirmModal';
import ModalPortal from '@/frontend/components/ui/ModalPortal';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api, qs } from './api';
import { formatCount, formatDate } from './format';
import IssuesModal from './IssuesModal';
import UploadConflictModal from './UploadConflictModal';
import {
    BTN_DANGER_GHOST, BTN_GHOST, BTN_SECONDARY, CARD, EASE_PATIENT, EmptyState, LABEL, NUM_LG, NUM_SM, Spinner, Toggle, useUi, WELL,
} from './ui';

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = '.xlsx,.xls,.csv';
const EXT_OK = /\.(xlsx|xls|csv)$/i;
/** Safety cap on "Index now" rounds; each round is one POST /reindex batch. */
const MAX_INDEX_ROUNDS = 200;

type Loaded = { key: string; data: SheetsResponse | null; error: string };
type Indexing = { running: boolean; indexed: number; remaining: number; error: string };

const MODE_LABEL: Record<UploadMode, string> = {
    new: 'Imported as a new sheet',
    replace: 'Replaced the old sheet',
    merge: 'Merged into the existing sheet',
};

/** `inlineError={false}`: the caller shows the failure text itself (phone cards put it on its own line). */
function SheetStatus({ sheet, inlineError = true }: { sheet: CandidateSheet; inlineError?: boolean }) {
    if (sheet.status === 'importing') {
        return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary"><Spinner className="h-3 w-3" />Importing</span>;
    }
    if (sheet.status === 'failed') {
        return (
            <span className="inline-flex min-w-0 flex-col">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-error"><span className="h-1.5 w-1.5 rounded-full bg-error" aria-hidden />Failed</span>
                {inlineError && sheet.error && <span className="mt-0.5 max-w-[240px] break-words text-xs text-text-secondary">{sheet.error}</span>}
            </span>
        );
    }
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-primary"><span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />Ready</span>;
}

function Uploads({ n }: { n: number }) {
    return n > 1 ? <span className="whitespace-nowrap tabular-nums">merged {n - 1}×</span> : <span className="tabular-nums text-text-tertiary">1</span>;
}

export default function SheetsView({ orgId, dataVersion, onDataChanged }: { orgId: string; dataVersion: number; onDataChanged: () => void }) {
    const { notify, reportError } = useUi();
    const [deleted, setDeleted] = useState(false);
    const [nonce, setNonce] = useState(0);
    const [loaded, setLoaded] = useState<Loaded | null>(null);

    const [dragOver, setDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [summary, setSummary] = useState<ImportSummary | null>(null);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [conflict, setConflict] = useState<UploadConflict['conflict'] | null>(null);
    const [conflictOpen, setConflictOpen] = useState(false);
    const [busyMode, setBusyMode] = useState<'replace' | 'merge' | null>(null);

    const [issues, setIssues] = useState<{ sheet: CandidateSheet; key: number } | null>(null);
    const [issuesOpen, setIssuesOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<CandidateSheet | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [indexing, setIndexing] = useState<Indexing>({ running: false, indexed: 0, remaining: 0, error: '' });

    const inputRef = useRef<HTMLInputElement | null>(null);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    const key = JSON.stringify([orgId, deleted, dataVersion, nonce]);
    useEffect(() => {
        const ctrl = new AbortController();
        void api<SheetsResponse>(`/api/candidates/sheets${qs({ orgId, deleted })}`, { signal: ctrl.signal }).then(res => {
            if (ctrl.signal.aborted) return;
            if (!res.ok) { if (res.noAccess) reportError(res); setLoaded({ key, data: null, error: res.error }); return; }
            setLoaded({ key, data: res.data, error: '' });
        });
        return () => ctrl.abort();
    }, [key, orgId, deleted, reportError]);

    const loading = loaded?.key !== key;
    const sheets = loaded?.data?.sheets ?? [];
    const pendingTotal = loaded?.data?.pendingIndexTotal ?? 0;
    const anyImporting = sheets.some(s => s.status === 'importing');

    // A sheet still importing (e.g. another person's upload): check again in 5 s.
    useEffect(() => {
        if (!anyImporting || loading) return;
        const t = setTimeout(() => setNonce(n => n + 1), 5000);
        return () => clearTimeout(t);
    }, [anyImporting, loading]);

    const reload = () => setNonce(n => n + 1);

    const upload = async (file: File, mode?: UploadMode) => {
        setUploadError('');
        if (!EXT_OK.test(file.name)) { setUploadError('Choose an Excel (.xlsx, .xls) or CSV file.'); return; }
        if (file.size > MAX_BYTES) { setUploadError(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 4 MB.`); return; }
        if (!mode) setSummary(null);
        if (mode === 'replace' || mode === 'merge') setBusyMode(mode); else setUploading(true);

        const form = new FormData();
        form.set('orgId', orgId);
        form.set('file', file);
        if (mode) form.set('mode', mode);
        const res = await api<ImportSummary>('/api/candidates/sheets', { form });
        if (!mounted.current) return;
        setUploading(false);
        setBusyMode(null);

        if (!res.ok) {
            const body = res.body as Partial<UploadConflict> | null;
            if (res.status === 409 && body?.conflict) {
                setPendingFile(file);
                setConflict(body.conflict);
                setConflictOpen(true);
                return;
            }
            setConflictOpen(false);
            setUploadError(res.error); // shown inline under the drop zone
            if (res.noAccess) reportError(res);
            return;
        }
        setConflictOpen(false);
        setPendingFile(null);
        setSummary(res.data);
        if (deleted) setDeleted(false);
        notify(`${res.data.sheet.name} imported`, 'success');
        reload();
        onDataChanged();
    };

    const pickFile = (files: FileList | null) => {
        const f = files?.[0];
        if (f) void upload(f);
        if (inputRef.current) inputRef.current.value = '';
    };

    const doDelete = async () => {
        const s = confirmDelete;
        if (!s) return;
        setBusyId(s.id);
        const res = await api<{ ok: true }>(`/api/candidates/sheets/${encodeURIComponent(s.id)}${qs({ orgId })}`, { method: 'DELETE' });
        setBusyId(null);
        setConfirmDelete(null);
        if (!res.ok) { reportError(res); return; }
        notify(`${s.name} deleted`, 'success');
        reload(); onDataChanged();
    };

    const doRestore = async (s: CandidateSheet) => {
        setBusyId(s.id);
        const res = await api<{ sheet: CandidateSheet }>(`/api/candidates/sheets/${encodeURIComponent(s.id)}/restore`, { json: { orgId } });
        setBusyId(null);
        // 409 here carries a plain { error } (a newer sheet with the same name exists): reportError shows it verbatim.
        if (!res.ok) { reportError(res); return; }
        notify(`${s.name} restored`, 'success');
        reload(); onDataChanged();
    };

    const runIndex = async () => {
        let indexed = 0;
        let remaining = pendingTotal;
        setIndexing({ running: true, indexed: 0, remaining, error: '' });
        for (let round = 0; round < MAX_INDEX_ROUNDS; round++) {
            const res = await api<ReindexResponse>('/api/candidates/reindex', { json: { orgId } });
            if (!mounted.current) return;
            if (!res.ok) {
                reportError(res);
                setIndexing({ running: false, indexed, remaining, error: res.error });
                break;
            }
            indexed += res.data.indexed;
            remaining = res.data.remaining;
            setIndexing({ running: true, indexed, remaining, error: '' });
            if (remaining <= 0) break;
            if (res.data.indexed === 0) {
                // No progress in a round: stop instead of spinning; the button stays available to try again.
                setIndexing({ running: false, indexed, remaining, error: 'Indexing made no progress. Please try again in a few minutes.' });
                break;
            }
        }
        if (!mounted.current) return;
        setIndexing(i => ({ ...i, running: false }));
        if (remaining <= 0) notify('All records are ready for meaning search', 'success');
        reload();
    };

    const shownPending = indexing.running ? indexing.remaining : pendingTotal;

    const actions = (s: CandidateSheet, compact = false) => deleted ? (
        <button type="button" onClick={() => void doRestore(s)} disabled={busyId === s.id} className={BTN_GHOST}>
            {busyId === s.id ? <Spinner /> : <RotateCcw className="h-4 w-4" />}Restore
        </button>
    ) : (
        <>
            <button type="button" onClick={() => { setIssues(x => ({ sheet: s, key: (x?.key ?? 0) + 1 })); setIssuesOpen(true); }} disabled={s.flaggedCount + s.skippedCount === 0}
                className={BTN_GHOST} title={s.flaggedCount + s.skippedCount === 0 ? 'No flagged or skipped rows' : undefined}>
                <ListChecks className="h-4 w-4" />{compact ? 'Issues' : 'View issues'}
            </button>
            <button type="button" onClick={() => setConfirmDelete(s)} disabled={busyId === s.id} className={BTN_DANGER_GHOST} aria-label={`Delete ${s.name}`}>
                <Trash2 className="h-4 w-4" />{compact ? 'Delete' : <span className="sr-only">Delete</span>}
            </button>
        </>
    );

    return (
        <div className="space-y-6">
            {/* Upload */}
            <div
                onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }}
                onDrop={e => { e.preventDefault(); setDragOver(false); if (!uploading) pickFile(e.dataTransfer.files); }}
                className={`relative flex flex-col items-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-200 sm:py-10 ${dragOver ? 'border-primary bg-primary/[.06]' : 'border-border bg-surface-elevated'}`}
            >
                {uploading ? (
                    <div aria-live="polite" className="flex flex-col items-center">
                        <Spinner className="h-7 w-7 text-primary" />
                        <p className="mt-3 font-display text-sm font-semibold text-text-primary">Importing…</p>
                        <p className="mt-1 text-sm text-text-secondary">Cleaning and de-duplicating rows</p>
                    </div>
                ) : (
                    <>
                        <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-surface text-primary-dark shadow-[var(--w-shadow)]">
                            <FileSpreadsheet className="h-6 w-6" />
                        </span>
                        <p className="mt-3 font-display text-sm font-semibold text-text-primary">Drop a sourcing sheet here</p>
                        <p className="mt-1 text-sm text-text-secondary">Excel (.xlsx, .xls) or CSV, up to 4 MB</p>
                        <button type="button" onClick={() => inputRef.current?.click()} className={`${BTN_SECONDARY} mt-4`}>
                            <Upload className="h-4 w-4" />Choose file
                        </button>
                    </>
                )}
                <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={e => pickFile(e.target.files)} />
            </div>

            {uploadError && (
                <p role="alert" className={`${WELL} flex gap-2.5 border-l-2 border-error px-4 py-3 text-sm text-text-primary`}>
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden />{uploadError}
                </p>
            )}

            {/* Import summary */}
            <AnimatePresence>
                {summary && (
                    <motion.section
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.22, ease: EASE_PATIENT }}
                        className={`${CARD} p-4 sm:p-6`} aria-label="Import summary"
                    >
                        <div className="flex items-start gap-3">
                            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                            <div className="min-w-0 flex-1">
                                <p className="break-words font-display text-base font-semibold text-text-primary">{summary.sheet.name}</p>
                                <p className="text-sm text-text-secondary">{MODE_LABEL[summary.mode]}</p>
                            </div>
                            <button type="button" onClick={() => setSummary(null)} aria-label="Dismiss summary" className="-mr-1 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-muted">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-7">
                            {([
                                ['Rows read', summary.rowsRead],
                                ['Records added', summary.recordsAdded],
                                ['Records updated', summary.recordsUpdated],
                                ['Rows flagged', summary.rowsFlagged],
                                ['Rows skipped', summary.rowsSkipped],
                                ['New candidates', summary.newCandidates],
                                ['Matched existing', summary.matchedCandidates],
                            ] as const).map(([label, n]) => (
                                <div key={label} className="min-w-0">
                                    <dt className={LABEL}>{label}</dt>
                                    <dd className={`${NUM_LG} mt-1 text-text-primary`}>{formatCount(n)}</dd>
                                </div>
                            ))}
                        </dl>
                        {(summary.rowsFlagged > 0 || summary.rowsSkipped > 0) && (
                            <button type="button" onClick={() => { setIssues(x => ({ sheet: summary.sheet, key: (x?.key ?? 0) + 1 })); setIssuesOpen(true); }} className={`${BTN_GHOST} -ml-2.5 mt-4`}>
                                <ListChecks className="h-4 w-4" />See flagged and skipped rows
                            </button>
                        )}
                    </motion.section>
                )}
            </AnimatePresence>

            {/* Meaning-search index banner */}
            {(shownPending > 0 || indexing.running) && !deleted && (
                <div className={`${WELL} flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center`} aria-live="polite">
                    <Zap className="hidden h-4 w-4 shrink-0 text-secondary sm:block" aria-hidden />
                    <div className="min-w-0 flex-1 text-sm text-text-primary">
                        <p>
                            <span className="font-semibold tabular-nums">{formatCount(shownPending)}</span> {shownPending === 1 ? 'record is' : 'records are'} still being prepared for meaning search. Filters and keyword search already work.
                        </p>
                        {indexing.running && <p className="mt-0.5 text-xs text-text-secondary">Indexed <span className="tabular-nums">{formatCount(indexing.indexed)}</span> so far…</p>}
                        {!indexing.running && indexing.error && <p className="mt-0.5 text-xs font-medium text-error">{indexing.error}</p>}
                    </div>
                    <button type="button" onClick={() => void runIndex()} disabled={indexing.running} className={`${BTN_SECONDARY} h-9`}>
                        {indexing.running ? <Spinner /> : <Zap className="h-4 w-4" />}{indexing.running ? 'Indexing…' : 'Index now'}
                    </button>
                </div>
            )}

            {/* Sheets list */}
            <section className="space-y-3" aria-labelledby="sheets-heading">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id="sheets-heading" className="font-display text-base font-semibold text-text-primary">{deleted ? 'Deleted sheets' : 'Sheets'}</h2>
                    <Toggle checked={deleted} onChange={setDeleted} label="Show deleted" />
                </div>

                <div className={`${CARD} overflow-hidden`}>
                    {loaded?.error && !loading ? (
                        <div role="alert" className="flex flex-col items-center px-4 py-12 text-center">
                            <CircleAlert className="mb-3 h-8 w-8 text-error" aria-hidden />
                            <p className="max-w-md text-sm text-text-primary">{loaded.error}</p>
                            <button type="button" onClick={reload} className={`${BTN_SECONDARY} mt-4`}>Try again</button>
                        </div>
                    ) : !loaded?.data && loading ? (
                        <div className="space-y-3 p-4 sm:p-6">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
                    ) : sheets.length === 0 ? (
                        <EmptyState icon={FileSpreadsheet} title={deleted ? 'No deleted sheets' : 'No sheets yet'}>
                            {deleted ? 'Deleted sheets show up here so you can restore them.' : 'Upload your first sourcing sheet above.'}
                        </EmptyState>
                    ) : (
                        <div className={`transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                            {/* Phone: cards */}
                            <ul className="divide-y divide-border-subtle md:hidden">
                                {sheets.map(s => (
                                    <li key={s.id} className="space-y-2 px-4 py-3">
                                        <div className="flex items-start gap-2">
                                            <p className="min-w-0 flex-1 break-words font-semibold text-text-primary">{s.name}</p>
                                            <SheetStatus sheet={s} inlineError={false} />
                                        </div>
                                        {s.status === 'failed' && s.error && <p className="break-words text-xs text-text-secondary">{s.error}</p>}
                                        <dl className="grid grid-cols-4 gap-2">
                                            <div><dt className={LABEL}>Live</dt><dd className={`${NUM_SM} text-text-primary`}>{formatCount(s.liveRecordCount)}</dd></div>
                                            <div><dt className={LABEL}>Flagged</dt><dd className={`${NUM_SM} text-text-primary`}>{formatCount(s.flaggedCount)}</dd></div>
                                            <div><dt className={LABEL}>Skipped</dt><dd className={`${NUM_SM} text-text-primary`}>{formatCount(s.skippedCount)}</dd></div>
                                            <div><dt className={LABEL}>Uploads</dt><dd className={`${NUM_SM} text-text-primary`}><Uploads n={s.uploadCount} /></dd></div>
                                        </dl>
                                        <p className="break-words text-xs text-text-tertiary">
                                            {s.uploadedByEmail ?? 'Unknown'} · <span className="tabular-nums">{formatDate(deleted ? s.deletedAt : s.updatedAt)}</span>
                                            {s.pendingIndexCount > 0 && <> · <span className="tabular-nums">{formatCount(s.pendingIndexCount)}</span> to index</>}
                                        </p>
                                        <div className="flex justify-end gap-1">{actions(s, true)}</div>
                                    </li>
                                ))}
                            </ul>

                            {/* md and up: table */}
                            <div className="hidden overflow-x-auto md:block">
                                <table className="w-full min-w-[980px] border-collapse text-sm">
                                    <thead className="bg-surface-elevated">
                                        <tr className={`${LABEL} text-left`}>
                                            <th scope="col" className="px-4 py-3 font-semibold">Sheet</th>
                                            <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                                            <th scope="col" className="px-3 py-3 text-right font-semibold">Live records</th>
                                            <th scope="col" className="px-3 py-3 text-right font-semibold">Flagged</th>
                                            <th scope="col" className="px-3 py-3 text-right font-semibold">Skipped</th>
                                            <th scope="col" className="px-3 py-3 text-right font-semibold">Uploads</th>
                                            <th scope="col" className="px-3 py-3 font-semibold">Uploaded by</th>
                                            <th scope="col" className="px-3 py-3 font-semibold">{deleted ? 'Deleted' : 'Date'}</th>
                                            <th scope="col" className="px-3 py-3 text-right font-semibold">To index</th>
                                            <th scope="col" className="sticky right-0 bg-surface-elevated px-4 py-3 shadow-[-1px_0_0_var(--border-subtle)]"><span className="sr-only">Actions</span></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border-subtle">
                                        {sheets.map(s => (
                                            <tr key={s.id} className="align-middle group hover:bg-surface-elevated">
                                                <td className="max-w-[260px] px-4 py-3">
                                                    <p className="truncate font-semibold text-text-primary" title={s.name}>{s.name}</p>
                                                    <p className="text-xs tabular-nums text-text-tertiary">{formatCount(s.rowCount)} rows in last upload</p>
                                                </td>
                                                <td className="px-3 py-3"><SheetStatus sheet={s} /></td>
                                                <td className={`${NUM_SM} px-3 py-3 text-right text-text-primary`}>{formatCount(s.liveRecordCount)}</td>
                                                <td className={`${NUM_SM} px-3 py-3 text-right ${s.flaggedCount ? 'text-text-primary' : 'text-text-tertiary'}`}>{formatCount(s.flaggedCount)}</td>
                                                <td className={`${NUM_SM} px-3 py-3 text-right ${s.skippedCount ? 'text-text-primary' : 'text-text-tertiary'}`}>{formatCount(s.skippedCount)}</td>
                                                <td className={`${NUM_SM} whitespace-nowrap px-3 py-3 text-right text-text-primary`}><Uploads n={s.uploadCount} /></td>
                                                <td className="max-w-[200px] truncate px-3 py-3 text-text-secondary" title={s.uploadedByEmail ?? ''}>{s.uploadedByEmail ?? '—'}</td>
                                                <td className="whitespace-nowrap px-3 py-3 tabular-nums text-text-secondary">{formatDate(deleted ? s.deletedAt : s.updatedAt)}</td>
                                                <td className={`${NUM_SM} px-3 py-3 text-right ${s.pendingIndexCount ? 'text-text-primary' : 'text-text-tertiary'}`}>{formatCount(s.pendingIndexCount)}</td>
                                                <td className="sticky right-0 whitespace-nowrap bg-surface px-4 py-3 shadow-[-1px_0_0_var(--border-subtle)] group-hover:bg-surface-elevated"><div className="flex justify-end gap-0.5">{actions(s)}</div></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            <UploadConflictModal
                open={conflictOpen}
                conflict={conflict}
                fileName={pendingFile?.name ?? ''}
                busyMode={busyMode}
                onChoose={mode => { if (pendingFile) void upload(pendingFile, mode); }}
                onCancel={() => { setConflictOpen(false); setPendingFile(null); }}
            />

            <IssuesModal orgId={orgId} request={issues} open={issuesOpen} onClose={() => setIssuesOpen(false)} />

            <ModalPortal>
                <ConfirmModal
                    isOpen={!!confirmDelete}
                    onClose={() => { if (!busyId) setConfirmDelete(null); }}
                    onConfirm={() => void doDelete()}
                    isLoading={!!busyId}
                    title={confirmDelete ? `Delete ${confirmDelete.name}?` : 'Delete sheet?'}
                    message="Its records are hidden from search and the table, and you can restore the sheet from Show deleted. Candidates who also appear in another sheet or were added by hand stay."
                    confirmText="Delete sheet"
                />
            </ModalPortal>
        </div>
    );
}
