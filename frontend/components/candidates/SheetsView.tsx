'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, CircleCheck, FileSpreadsheet, ListChecks, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import type {
    CandidateSheet, ImportSummary, PurgeResponse, ReindexResponse, SheetsResponse, UploadConflict, UploadMode,
} from '@/backend/lib/candidates/types';
import Skeleton from '@/frontend/components/ui/Skeleton';
import { api, apiUpload, qs } from './api';
import { DeleteSheetDialog, TypedConfirmDialog } from './DangerDialogs';
import { formatCount, formatDate } from './format';
import IssuesModal from './IssuesModal';
import UploadConflictModal from './UploadConflictModal';
import {
    BTN_DANGER_GHOST, BTN_GHOST, BTN_SECONDARY, CARD, EASE_PATIENT, EmptyState, LABEL, NUM_LG, NUM_SM, Spinner, Toggle, useUi, WELL,
} from './ui';

const MAX_BYTES = 4 * 1024 * 1024;
/** Must match CLEAR_ALL_CONFIRMATION in backend/lib/candidates/config.ts (the server checks it too). */
const CLEAR_ALL_PHRASE = 'DELETE ALL';
const ACCEPT = '.xlsx,.xls,.csv';
const EXT_OK = /\.(xlsx|xls|csv)$/i;
/**
 * Owner 2026-11-03: HR uploads and watches a progress bar; preparing records for search happens in the background and
 * never shows an error. While a sheet is being prepared the list refreshes quietly every POLL_MS, and every NUDGE_MS
 * the page asks the server to keep going (the every-minute cron finishes the job when nobody has the page open).
 */
const POLL_MS = 4000;
const NUDGE_MS = 20_000;

type Loaded = { key: string; data: SheetsResponse | null; error: string };
/** The upload in progress: sending the file (with the share sent), then the server saving the rows. */
type UploadProgress = { phase: 'sending' | 'saving'; fraction: number; name: string };

function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
    const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    return (
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span className="block h-full rounded-full bg-primary transition-[width] duration-500 ease-[var(--w-ease-patient)]" style={{ width: `${pct}%` }} />
        </span>
    );
}

/** Share of a sheet's records ready for search (0-1). */
function preparedShare(sheet: CandidateSheet): number {
    return sheet.liveRecordCount > 0 ? (sheet.liveRecordCount - sheet.pendingIndexCount) / sheet.liveRecordCount : 1;
}

const MODE_LABEL: Record<UploadMode, string> = {
    new: 'Imported as a new sheet',
    replace: 'Replaced the old sheet',
    merge: 'Merged into the existing sheet',
};

/** The numbers under an import. "With resume" (phase 2) only once the resume update is applied. */
function summaryTiles(s: ImportSummary): [string, number][] {
    const tiles: [string, number][] = [
        ['Rows read', s.rowsRead],
        ['Records added', s.recordsAdded],
        ['Records updated', s.recordsUpdated],
        ['Rows flagged', s.rowsFlagged],
        ['Rows skipped', s.rowsSkipped],
        ['New candidates', s.newCandidates],
        ['Matched existing', s.matchedCandidates],
    ];
    if (s.candidatesWithResume !== null) tiles.push(['With resume', s.candidatesWithResume]);
    return tiles;
}

/** `inlineError={false}`: the caller shows the failure text itself (phone cards put it on its own line). */
function SheetStatus({ sheet, inlineError = true, preparing = false }: { sheet: CandidateSheet; inlineError?: boolean; preparing?: boolean }) {
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
    if (preparing && sheet.pendingIndexCount > 0) {
        const share = preparedShare(sheet);
        return (
            <span className="inline-flex w-36 flex-col gap-x-1 gap-y-1">
                <span className="flex items-center justify-between gap-x-2 gap-y-2 text-xs font-semibold text-text-secondary">
                    <span className="inline-flex items-center gap-1.5"><Spinner className="h-3 w-3" />Preparing</span>
                    <span className="tabular-nums">{Math.floor(share * 100)}%</span>
                </span>
                <ProgressBar fraction={share} label={`${sheet.name}: preparing for search`} />
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
    const [progress, setProgress] = useState<UploadProgress | null>(null);
    const uploading = progress !== null;
    const [uploadError, setUploadError] = useState('');
    const [summary, setSummary] = useState<ImportSummary | null>(null);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [conflict, setConflict] = useState<UploadConflict['conflict'] | null>(null);
    const [conflictOpen, setConflictOpen] = useState(false);
    const [busyMode, setBusyMode] = useState<'replace' | 'merge' | null>(null);

    const [issues, setIssues] = useState<{ sheet: CandidateSheet; key: number } | null>(null);
    const [issuesOpen, setIssuesOpen] = useState(false);
    // `key` remounts the dialog so its choice and typed confirmation start empty each time.
    const [deleteTarget, setDeleteTarget] = useState<{ sheet: CandidateSheet; key: number } | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteBusy, setDeleteBusy] = useState<'soft' | 'permanent' | null>(null);
    const [clearState, setClearState] = useState<{ open: boolean; key: number; busy: boolean }>({ open: false, key: 0, busy: false });
    const [busyId, setBusyId] = useState<string | null>(null);

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
    const anyImporting = sheets.some(s => s.status === 'importing');
    const preparing = !deleted && sheets.some(s => s.status === 'ready' && s.pendingIndexCount > 0);

    // A sheet importing (e.g. another person's upload) or being prepared for search: refresh the list quietly, keeping
    // the same key so the table does not dim. A failed refresh is ignored (the next one tries again).
    useEffect(() => {
        if ((!anyImporting && !preparing) || loading) return;
        const ctrl = new AbortController();
        const t = setTimeout(() => {
            void api<SheetsResponse>(`/api/candidates/sheets${qs({ orgId, deleted })}`, { signal: ctrl.signal }).then(res => {
                if (!ctrl.signal.aborted && res.ok) setLoaded({ key, data: res.data, error: '' });
            });
        }, POLL_MS);
        return () => { clearTimeout(t); ctrl.abort(); };
    }, [anyImporting, preparing, loading, loaded, key, orgId, deleted]);

    // While preparing, ask the server to keep going. Its answer is not shown: progress comes from the list above.
    useEffect(() => {
        if (!preparing) return;
        let stopped = false;
        let running = false;
        const nudge = () => {
            if (running || stopped) return;
            running = true;
            void api<ReindexResponse>('/api/candidates/reindex', { json: { orgId } }).finally(() => { running = false; });
        };
        const t = setInterval(nudge, NUDGE_MS);
        return () => { stopped = true; clearInterval(t); };
    }, [preparing, orgId]);

    const reload = () => setNonce(n => n + 1);

    const upload = async (file: File, mode?: UploadMode) => {
        setUploadError('');
        if (!EXT_OK.test(file.name)) { setUploadError('Choose an Excel (.xlsx, .xls) or CSV file.'); return; }
        if (file.size > MAX_BYTES) { setUploadError(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 4 MB.`); return; }
        if (!mode) setSummary(null);
        if (mode === 'replace' || mode === 'merge') setBusyMode(mode);
        setProgress({ phase: 'sending', fraction: 0, name: file.name });

        const form = new FormData();
        form.set('orgId', orgId);
        form.set('file', file);
        if (mode) form.set('mode', mode);
        const res = await apiUpload<ImportSummary>(
            '/api/candidates/sheets', form,
            fraction => { if (mounted.current) setProgress(p => (p && p.phase === 'sending' ? { ...p, fraction } : p)); },
            () => { if (mounted.current) setProgress(p => (p ? { ...p, phase: 'saving', fraction: 1 } : p)); },
        );
        if (!mounted.current) return;
        setProgress(null);
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
            // Shown inline under the drop zone. 4xx answers are things HR can fix (file type, size, no header row) and
            // carry a plain message; anything else gets one calm sentence (details are in the server logs).
            setUploadError(res.status === 0 || res.status >= 500
                ? 'The upload could not be finished. Please check the connection and try again in a minute.'
                : res.error);
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

    const askDelete = (sheet: CandidateSheet) => {
        setDeleteTarget(t => ({ sheet, key: (t?.key ?? 0) + 1 }));
        setDeleteOpen(true);
    };

    const doDelete = async (permanent: boolean) => {
        const s = deleteTarget?.sheet;
        if (!s) return;
        setDeleteBusy(permanent ? 'permanent' : 'soft');
        const res = await api<PurgeResponse | { ok: true }>(
            `/api/candidates/sheets/${encodeURIComponent(s.id)}${qs({ orgId, permanent })}`, { method: 'DELETE' },
        );
        if (!mounted.current) return;
        setDeleteBusy(null);
        if (!res.ok) { reportError(res); return; }
        setDeleteOpen(false);
        if (summary?.sheet.id === s.id) setSummary(null);
        if (permanent && 'records' in res.data) {
            const { records, people } = res.data;
            notify(`${s.name} deleted permanently: ${formatCount(records)} ${records === 1 ? 'record' : 'records'}, ${formatCount(people)} ${people === 1 ? 'candidate' : 'candidates'}`, 'success');
        } else notify(`${s.name} moved to deleted`, 'success');
        reload(); onDataChanged();
    };

    const doClearAll = async () => {
        setClearState(c => ({ ...c, busy: true }));
        const res = await api<PurgeResponse>('/api/candidates/clear', { json: { orgId, confirm: CLEAR_ALL_PHRASE } });
        if (!mounted.current) return;
        setClearState(c => ({ ...c, busy: false, open: res.ok ? false : c.open }));
        if (!res.ok) { reportError(res); return; }
        setSummary(null);
        const { sheets: n, records, people } = res.data;
        notify(`Cleared ${formatCount(n)} ${n === 1 ? 'sheet' : 'sheets'}, ${formatCount(records)} records and ${formatCount(people)} candidates`, 'success');
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

    const actions = (s: CandidateSheet, compact = false) => deleted ? (
        <>
            <button type="button" onClick={() => void doRestore(s)} disabled={busyId === s.id} className={BTN_GHOST}>
                {busyId === s.id ? <Spinner /> : <RotateCcw className="h-4 w-4" />}Restore
            </button>
            <button type="button" onClick={() => askDelete(s)} disabled={busyId === s.id || s.status === 'importing'} className={BTN_DANGER_GHOST} aria-label={`Delete ${s.name} permanently`}>
                <Trash2 className="h-4 w-4" />{compact ? 'Delete' : <span className="sr-only">Delete permanently</span>}
            </button>
        </>
    ) : (
        <>
            <button type="button" onClick={() => { setIssues(x => ({ sheet: s, key: (x?.key ?? 0) + 1 })); setIssuesOpen(true); }} disabled={s.status !== 'ready'}
                className={BTN_GHOST} title={s.flaggedCount ? `${formatCount(s.flaggedCount)} rows need review` : 'Rows fixed automatically or skipped'}>
                <ListChecks className="h-4 w-4" />{compact ? 'Issues' : 'View issues'}
            </button>
            <button type="button" onClick={() => askDelete(s)} disabled={busyId === s.id || s.status === 'importing'} className={BTN_DANGER_GHOST} aria-label={`Delete ${s.name}`}>
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
                {progress ? (
                    <div aria-live="polite" className="flex w-full max-w-sm flex-col items-center">
                        <Spinner className="h-7 w-7 text-primary" />
                        <p className="mt-3 max-w-full truncate font-display text-sm font-semibold text-text-primary" title={progress.name}>{progress.name}</p>
                        <p className="mt-1 text-sm text-text-secondary">
                            {progress.phase === 'sending'
                                ? <>Uploading… <span className="tabular-nums">{Math.round(progress.fraction * 100)}%</span></>
                                : 'Saving candidates… this takes a few seconds'}
                        </p>
                        <div className="mt-3 w-full">
                            <ProgressBar fraction={progress.phase === 'sending' ? progress.fraction * 0.5 : 0.75} label="Upload progress" />
                        </div>
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
                        className={`${CARD} px-4 py-4 sm:p-6`} aria-label="Import summary"
                    >
                        <div className="flex items-start gap-x-3 gap-y-3">
                            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                            <div className="min-w-0 flex-1">
                                <p className="break-words font-display text-base font-semibold text-text-primary">{summary.sheet.name}</p>
                                <p className="text-sm text-text-secondary">{MODE_LABEL[summary.mode]}</p>
                            </div>
                            <button type="button" onClick={() => setSummary(null)} aria-label="Dismiss summary" className="-mr-1 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-muted">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
                            {summaryTiles(summary).map(([label, n]) => (
                                <div key={label} className="min-w-0">
                                    <dt className={LABEL}>{label}</dt>
                                    <dd className={`${NUM_LG} mt-1 text-text-primary`}>{formatCount(n)}</dd>
                                </div>
                            ))}
                        </dl>
                        <p className="mt-4 text-sm text-text-secondary">
                            The candidates are searchable now. Smart matching finishes on its own in the background; the progress shows in the list below.
                        </p>
                        {summary.candidatesWithResume !== null && (
                            <p className="mt-2 text-sm text-text-secondary">
                                <span className="font-semibold tabular-nums text-text-primary">{formatCount(summary.candidatesWithResume)}</span> of the sheet&rsquo;s candidates
                                {summary.candidatesWithResume === 1 ? ' has' : ' have'} a resume on file (matched by email or phone). The rest show &ldquo;No resume&rdquo; in Search,
                                where the <em>Resume on file</em> filter lists them.
                            </p>
                        )}
                        {summary.rowsAutoFixed > 0 && (
                            <p className="mt-2 text-sm text-text-secondary">
                                <span className="font-semibold tabular-nums text-text-primary">{formatCount(summary.rowsAutoFixed)}</span> more {summary.rowsAutoFixed === 1 ? 'row was' : 'rows were'} fixed automatically (e.g. &ldquo;30 in hand&rdquo; read as ₹30,000; &ldquo;Negotiable&rdquo; kept in the remark).
                            </p>
                        )}
                        {(summary.rowsFlagged > 0 || summary.rowsSkipped > 0 || summary.rowsAutoFixed > 0) && (
                            <button type="button" onClick={() => { setIssues(x => ({ sheet: summary.sheet, key: (x?.key ?? 0) + 1 })); setIssuesOpen(true); }} className={`${BTN_GHOST} -ml-2.5 mt-2`}>
                                <ListChecks className="h-4 w-4" />{summary.rowsFlagged > 0 ? 'Review flagged rows (AI fix available)' : 'See what was fixed'}
                            </button>
                        )}
                    </motion.section>
                )}
            </AnimatePresence>

            {/* Sheets list */}
            <section className="space-y-3" aria-labelledby="sheets-heading">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
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
                        <div className="space-y-3 px-4 py-4 sm:p-6">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
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
                                        <div className="flex items-start gap-x-2 gap-y-2">
                                            <p className="min-w-0 flex-1 break-words font-semibold text-text-primary">{s.name}</p>
                                            <SheetStatus sheet={s} inlineError={false} preparing={!deleted} />
                                        </div>
                                        {s.status === 'failed' && s.error && <p className="break-words text-xs text-text-secondary">{s.error}</p>}
                                        <dl className="grid grid-cols-4 gap-x-2 gap-y-2">
                                            <div><dt className={LABEL}>Live</dt><dd className={`${NUM_SM} text-text-primary`}>{formatCount(s.liveRecordCount)}</dd></div>
                                            <div><dt className={LABEL}>Flagged</dt><dd className={`${NUM_SM} text-text-primary`}>{formatCount(s.flaggedCount)}</dd></div>
                                            <div><dt className={LABEL}>Skipped</dt><dd className={`${NUM_SM} text-text-primary`}>{formatCount(s.skippedCount)}</dd></div>
                                            <div><dt className={LABEL}>Uploads</dt><dd className={`${NUM_SM} text-text-primary`}><Uploads n={s.uploadCount} /></dd></div>
                                        </dl>
                                        <p className="break-words text-xs text-text-tertiary">
                                            {s.uploadedByEmail ?? 'Unknown'} · <span className="tabular-nums">{formatDate(deleted ? s.deletedAt : s.updatedAt)}</span>
                                        </p>
                                        <div className="flex justify-end gap-x-1 gap-y-1">{actions(s, true)}</div>
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
                                                <td className="px-3 py-3"><SheetStatus sheet={s} preparing={!deleted} /></td>
                                                <td className={`${NUM_SM} px-3 py-3 text-right text-text-primary`}>{formatCount(s.liveRecordCount)}</td>
                                                <td className={`${NUM_SM} px-3 py-3 text-right ${s.flaggedCount ? 'text-text-primary' : 'text-text-tertiary'}`}>{formatCount(s.flaggedCount)}</td>
                                                <td className={`${NUM_SM} px-3 py-3 text-right ${s.skippedCount ? 'text-text-primary' : 'text-text-tertiary'}`}>{formatCount(s.skippedCount)}</td>
                                                <td className={`${NUM_SM} whitespace-nowrap px-3 py-3 text-right text-text-primary`}><Uploads n={s.uploadCount} /></td>
                                                <td className="max-w-[200px] truncate px-3 py-3 text-text-secondary" title={s.uploadedByEmail ?? ''}>{s.uploadedByEmail ?? '—'}</td>
                                                <td className="whitespace-nowrap px-3 py-3 tabular-nums text-text-secondary">{formatDate(deleted ? s.deletedAt : s.updatedAt)}</td>
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

            {/* Danger zone */}
            <section aria-labelledby="danger-heading" className={`${WELL} flex flex-col gap-x-3 gap-y-3 px-4 py-4 sm:flex-row sm:items-center sm:px-6`}>
                <div className="min-w-0 flex-1">
                    <h2 id="danger-heading" className="font-display text-sm font-semibold text-text-primary">Clear all candidate data</h2>
                    <p className="mt-0.5 text-sm text-text-secondary">Permanently erase every sheet, record and candidate, including deleted ones. Search history is kept.</p>
                </div>
                <button type="button" onClick={() => setClearState(c => ({ open: true, key: c.key + 1, busy: false }))} className={`${BTN_DANGER_GHOST} self-start sm:self-auto`}>
                    <Trash2 className="h-4 w-4" />Clear all data
                </button>
            </section>

            <IssuesModal orgId={orgId} request={issues} open={issuesOpen} onClose={() => setIssuesOpen(false)} onChanged={onDataChanged} />

            <DeleteSheetDialog
                key={deleteTarget?.key ?? 0}
                sheet={deleteTarget?.sheet ?? null}
                open={deleteOpen}
                alreadyDeleted={!!deleteTarget?.sheet.deletedAt}
                busy={deleteBusy}
                onClose={() => setDeleteOpen(false)}
                onMoveToDeleted={() => void doDelete(false)}
                onDeletePermanently={() => void doDelete(true)}
            />

            <TypedConfirmDialog
                key={clearState.key}
                open={clearState.open}
                labelId="clear-all-title"
                title="Clear all candidate data?"
                phrase={CLEAR_ALL_PHRASE}
                confirmText="Erase everything"
                busy={clearState.busy}
                onClose={() => setClearState(c => ({ ...c, open: false }))}
                onConfirm={() => void doClearAll()}
            >
                Every sheet, record and candidate in this organisation is erased for good, including deleted ones you could
                otherwise restore, and anything still waiting to be indexed. This cannot be undone.
            </TypedConfirmDialog>
        </div>
    );
}
