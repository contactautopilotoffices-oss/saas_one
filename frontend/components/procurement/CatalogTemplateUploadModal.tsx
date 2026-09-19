'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    X, Download, Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle,
    ArrowLeft, ImageIcon, Plus, RefreshCw, Minus, Info, Undo2, Package,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    organizationId: string;
    /** Fired after a successful commit or undo so the caller can refresh its catalog list. */
    onCommitted?: () => void;
}

type RowAction = 'create' | 'update' | 'unchanged' | 'error';
type AbsentDecision = 'keep' | 'legacy' | 'retire';
type ScalarValue = string | number | boolean | null;

interface PreviewRow {
    rowNumber: number;
    action: RowAction;
    item_code: string;
    name: string;
    changes: Record<string, { from: ScalarValue; to: ScalarValue }>;
    photo_url: string | null;
    errors: string[];
}

interface AbsentItem {
    id: string;
    item_code: string | null;
    name: string;
    category: string | null;
    lifecycle: 'standard' | 'legacy' | 'retired';
    stock_property_count: number;
    stock_total_qty: number;
}

interface PreviewResponse {
    batch_id: string;
    file_name: string;
    unmatched_headers: string[];
    truncated: boolean;
    counts: {
        row_count: number;
        created_count: number;
        updated_count: number;
        unchanged_count: number;
        error_count: number;
        photo_count: number;
    };
    rows: PreviewRow[];
    rows_returned: number;
    absent_items: AbsentItem[];
}

interface CommitResponse {
    success: boolean;
    batch_id: string;
    created: number;
    updated: number;
    unchanged: number;
    marked_legacy: number;
    retired: number;
    skipped_errors: number;
    failures: Array<{ row: number; message: string }>;
}

interface RollbackResponse {
    success: boolean;
    reverted_updates: number;
    deactivated_new_items: number;
    restored_items: number;
    failures: string[];
}

const ACTION_STYLES: Record<RowAction, { label: string; chip: string; Icon: typeof Plus }> = {
    create: { label: 'New', chip: 'bg-emerald-100 text-emerald-700', Icon: Plus },
    update: { label: 'Update', chip: 'bg-amber-100 text-amber-700', Icon: RefreshCw },
    unchanged: { label: 'No change', chip: 'bg-slate-100 text-slate-400', Icon: Minus },
    error: { label: 'Error', chip: 'bg-rose-100 text-rose-700', Icon: AlertTriangle },
};

const DECISIONS: Array<{ value: AbsentDecision; label: string; hint: string; active: string }> = [
    {
        value: 'keep',
        label: 'Keep',
        hint: 'Nothing changes. The item stays exactly as it is today.',
        active: 'bg-slate-900 text-white',
    },
    {
        value: 'legacy',
        label: 'Legacy',
        hint: 'Still fully usable and requestable, but grouped separately and marked as being phased out.',
        active: 'bg-amber-500 text-white',
    },
    {
        value: 'retire',
        label: 'Retire',
        hint: 'Hidden from new requisitions. Never deleted — past requisitions and stock records keep working.',
        active: 'bg-rose-500 text-white',
    },
];

const FIELD_LABELS: Record<string, string> = {
    name: 'Item Name',
    category: 'Category',
    brand: 'Brand',
    color_size_details: 'Specification',
    unit: 'UOM',
    unit_price: 'Standard Rate',
    sort_order: 'Sort Order',
    description: 'Description',
    photo_url: 'Photo',
    is_active: 'Status',
    lifecycle: 'Lifecycle',
};

export default function CatalogTemplateUploadModal({ isOpen, onClose, organizationId, onCommitted }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [file, setFile] = useState<File | null>(null);
    const [isDownloading, setIsDownloading] = useState<'blank' | 'current' | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isRollingBack, setIsRollingBack] = useState(false);
    const [error, setError] = useState<string>('');
    const [preview, setPreview] = useState<PreviewResponse | null>(null);
    const [result, setResult] = useState<CommitResponse | null>(null);
    const [rollback, setRollback] = useState<RollbackResponse | null>(null);
    const [decisions, setDecisions] = useState<Record<string, AbsentDecision>>({});
    const [showOnlyChanges, setShowOnlyChanges] = useState(true);

    const reset = useCallback(() => {
        setFile(null);
        setPreview(null);
        setResult(null);
        setRollback(null);
        setError('');
        setDecisions({});
        setShowOnlyChanges(true);
    }, []);

    // ─── Template download ────────────────────────────────────────────────────
    const downloadTemplate = async (mode: 'blank' | 'current') => {
        setIsDownloading(mode);
        setError('');
        try {
            const query = new URLSearchParams({ organizationId });
            if (mode === 'current') query.set('include', 'current');

            const res = await fetch(`/api/procurement/catalog/template?${query.toString()}`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Could not generate the template');
                return;
            }

            const blob = await res.blob();
            const disposition = res.headers.get('Content-Disposition') || '';
            const suggested = /filename="([^"]+)"/.exec(disposition)?.[1];

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = suggested || 'Standard-Requisition-Items.xlsx';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch {
            setError('Network error while downloading the template');
        } finally {
            setIsDownloading(null);
        }
    };

    // ─── Upload & preview ─────────────────────────────────────────────────────
    const uploadForPreview = async (selected: File) => {
        setIsUploading(true);
        setError('');
        setPreview(null);
        try {
            const formData = new FormData();
            formData.append('file', selected);
            formData.append('organizationId', organizationId);

            const res = await fetch('/api/procurement/catalog/import/preview', { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Could not read this file');
                return;
            }

            // Everything absent from the template defaults to "keep" — no item
            // disappears unless somebody explicitly says so.
            setDecisions({});
            setPreview(data as PreviewResponse);
        } catch {
            setError('Network error while uploading the file');
        } finally {
            setIsUploading(false);
        }
    };

    const handleFileChosen = (selected: File | null) => {
        if (!selected) return;
        setFile(selected);
        setError('');
        void uploadForPreview(selected);
    };

    // ─── Commit ───────────────────────────────────────────────────────────────
    const commit = async () => {
        if (!preview) return;
        setIsCommitting(true);
        setError('');
        try {
            const res = await fetch('/api/procurement/catalog/import/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    batch_id: preview.batch_id,
                    organizationId,
                    legacy_ids: Object.keys(decisions).filter(id => decisions[id] === 'legacy'),
                    retire_ids: Object.keys(decisions).filter(id => decisions[id] === 'retire'),
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Could not apply this import');
                return;
            }
            setResult(data as CommitResponse);
            onCommitted?.();
        } catch {
            setError('Network error while applying the import');
        } finally {
            setIsCommitting(false);
        }
    };

    // ─── Undo ─────────────────────────────────────────────────────────────────
    const undoImport = async () => {
        if (!result) return;
        setIsRollingBack(true);
        setError('');
        try {
            const res = await fetch('/api/procurement/catalog/import/rollback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batch_id: result.batch_id, organizationId }),
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Could not undo this import');
                return;
            }
            setRollback(data as RollbackResponse);
            onCommitted?.();
        } catch {
            setError('Network error while undoing the import');
        } finally {
            setIsRollingBack(false);
        }
    };

    const setDecision = (id: string, decision: AbsentDecision) => {
        setDecisions(prev => {
            const next = { ...prev };
            if (decision === 'keep') delete next[id];
            else next[id] = decision;
            return next;
        });
    };

    const setAllDecisions = (decision: AbsentDecision) => {
        if (!preview) return;
        if (decision === 'keep') {
            setDecisions({});
            return;
        }
        const next: Record<string, AbsentDecision> = {};
        for (const item of preview.absent_items) next[item.id] = decision;
        setDecisions(next);
    };

    const visibleRows = useMemo(() => {
        if (!preview) return [];
        return showOnlyChanges ? preview.rows.filter(r => r.action !== 'unchanged') : preview.rows;
    }, [preview, showOnlyChanges]);

    const decisionCounts = useMemo(() => {
        const values = Object.values(decisions);
        return {
            legacy: values.filter(v => v === 'legacy').length,
            retire: values.filter(v => v === 'retire').length,
        };
    }, [decisions]);

    const applicableCount = preview
        ? preview.counts.created_count + preview.counts.updated_count + decisionCounts.legacy + decisionCounts.retire
        : 0;

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-100 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, y: 24, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 24, scale: 0.98 }}
                    transition={{ type: 'spring', damping: 26, stiffness: 300 }}
                    onClick={e => e.stopPropagation()}
                    className="w-full max-w-5xl max-h-[92vh] bg-white rounded-[2rem] shadow-2xl overflow-hidden flex flex-col"
                >
                    {/* ── Header ─────────────────────────────────────────────── */}
                    <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 shrink-0">
                        <div className="flex items-center gap-4">
                            {preview && !result && (
                                <button
                                    onClick={reset}
                                    className="p-2.5 rounded-2xl bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all"
                                    aria-label="Start over"
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                </button>
                            )}
                            <div className="w-11 h-11 rounded-2xl bg-violet-500 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
                                <FileSpreadsheet className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="font-black text-slate-900 text-lg tracking-tight leading-none">Standard Items Template</h2>
                                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1.5">
                                    {rollback ? 'Import undone' : result ? 'Import applied' : preview ? `Review · ${preview.file_name}` : 'Download · Fill · Upload'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => { reset(); onClose(); }}
                            className="p-2.5 rounded-2xl bg-slate-50 text-slate-400 hover:bg-slate-100 transition-all"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* ── Body ───────────────────────────────────────────────── */}
                    <div className="flex-1 overflow-y-auto px-6 py-6">
                        {error && (
                            <div className="mb-6 rounded-2xl bg-rose-50 border border-rose-100 p-4 flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-black text-rose-700 text-sm">That didn&apos;t work</p>
                                    <p className="text-xs text-rose-500 mt-1 leading-relaxed">{error}</p>
                                </div>
                            </div>
                        )}

                        {/* ── Result ─────────────────────────────────────────── */}
                        {result ? (
                            <div className="max-w-xl mx-auto py-6 space-y-6">
                                <div className="flex flex-col items-center text-center gap-4">
                                    <div className={`w-16 h-16 rounded-3xl flex items-center justify-center text-white shadow-lg ${rollback ? 'bg-slate-500 shadow-slate-200' : result.success ? 'bg-emerald-500 shadow-emerald-200' : 'bg-amber-500 shadow-amber-200'}`}>
                                        {rollback ? <Undo2 className="w-8 h-8" /> : result.success ? <CheckCircle2 className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
                                    </div>
                                    <div>
                                        <h3 className="font-black text-slate-900 text-2xl tracking-tight">
                                            {rollback ? 'Import undone' : result.success ? 'Catalog updated' : 'Applied with problems'}
                                        </h3>
                                        <p className="text-xs text-slate-400 font-bold mt-2 leading-relaxed">
                                            {rollback
                                                ? `${rollback.reverted_updates} item${rollback.reverted_updates === 1 ? '' : 's'} put back, ${rollback.deactivated_new_items} newly added item${rollback.deactivated_new_items === 1 ? '' : 's'} deactivated, ${rollback.restored_items} restored.`
                                                : 'Every property will now see this list on its monthly requisition.'}
                                        </p>
                                    </div>
                                </div>

                                {!rollback && (
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        {[
                                            { label: 'Added', value: result.created, tone: 'text-emerald-600' },
                                            { label: 'Updated', value: result.updated, tone: 'text-amber-600' },
                                            { label: 'Legacy', value: result.marked_legacy, tone: 'text-amber-500' },
                                            { label: 'Retired', value: result.retired, tone: 'text-rose-500' },
                                        ].map(stat => (
                                            <div key={stat.label} className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-center">
                                                <p className={`text-2xl font-black ${stat.tone}`}>{stat.value}</p>
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{stat.label}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {!rollback && result.skipped_errors > 0 && (
                                    <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 text-xs text-amber-700 font-bold">
                                        {result.skipped_errors} row{result.skipped_errors === 1 ? '' : 's'} had errors and {result.skipped_errors === 1 ? 'was' : 'were'} skipped. Fix them in the file and upload again.
                                    </div>
                                )}

                                {!rollback && result.failures.length > 0 && (
                                    <div className="rounded-2xl bg-rose-50 border border-rose-100 p-4 space-y-1.5">
                                        {result.failures.map((failure, idx) => (
                                            <p key={idx} className="text-xs text-rose-600 font-bold">
                                                {failure.row ? `Row ${failure.row}: ` : ''}{failure.message}
                                            </p>
                                        ))}
                                    </div>
                                )}

                                {rollback && rollback.failures.length > 0 && (
                                    <div className="rounded-2xl bg-rose-50 border border-rose-100 p-4 space-y-1.5">
                                        {rollback.failures.map((failure, idx) => (
                                            <p key={idx} className="text-xs text-rose-600 font-bold">{failure}</p>
                                        ))}
                                    </div>
                                )}

                                {!rollback && (
                                    <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 flex items-start gap-3">
                                        <Undo2 className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                        <div className="flex-1">
                                            <p className="text-xs font-black text-slate-700">Not what you expected?</p>
                                            <p className="text-[11px] text-slate-400 font-bold mt-1 leading-relaxed">
                                                This import can be undone exactly — updated fields go back to their previous values, newly added items are deactivated, and anything marked legacy or retired is restored. Only possible until another import is applied.
                                            </p>
                                            <button
                                                onClick={undoImport}
                                                disabled={isRollingBack}
                                                className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-50"
                                            >
                                                {isRollingBack ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                                                {isRollingBack ? 'Undoing…' : 'Undo this import'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-3">
                                    <button
                                        onClick={reset}
                                        className="flex-1 bg-slate-100 text-slate-700 font-black py-4 rounded-2xl hover:bg-slate-200 transition-all text-sm"
                                    >
                                        Upload another file
                                    </button>
                                    <button
                                        onClick={() => { reset(); onClose(); }}
                                        className="flex-1 bg-slate-900 text-white font-black py-4 rounded-2xl hover:bg-slate-800 transition-all text-sm"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        ) : preview ? (
                            /* ── Preview ────────────────────────────────────── */
                            <div className="space-y-6">
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                    {[
                                        { label: 'New items', value: preview.counts.created_count, tone: 'text-emerald-600' },
                                        { label: 'Updates', value: preview.counts.updated_count, tone: 'text-amber-600' },
                                        { label: 'No change', value: preview.counts.unchanged_count, tone: 'text-slate-400' },
                                        { label: 'Errors', value: preview.counts.error_count, tone: 'text-rose-600' },
                                        { label: 'Photos', value: preview.counts.photo_count, tone: 'text-violet-600' },
                                    ].map(stat => (
                                        <div key={stat.label} className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-center">
                                            <p className={`text-2xl font-black ${stat.tone}`}>{stat.value}</p>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{stat.label}</p>
                                        </div>
                                    ))}
                                </div>

                                <div className="rounded-2xl bg-sky-50 border border-sky-100 p-4 flex items-start gap-3">
                                    <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                                    <p className="text-xs text-sky-700 font-bold leading-relaxed">
                                        Nothing has been saved yet. Review the changes below, then apply.
                                        {preview.truncated && ' Only the first 5,000 rows of this file were read.'}
                                        {preview.unmatched_headers.length > 0 && ` Ignored column${preview.unmatched_headers.length === 1 ? '' : 's'}: ${preview.unmatched_headers.join(', ')}.`}
                                    </p>
                                </div>

                                {/* Row list */}
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                            Rows {preview.rows_returned < preview.counts.row_count && `(showing first ${preview.rows_returned} of ${preview.counts.row_count})`}
                                        </p>
                                        <button
                                            onClick={() => setShowOnlyChanges(v => !v)}
                                            className="text-[10px] font-black uppercase tracking-widest text-violet-600 hover:text-violet-700 transition-colors"
                                        >
                                            {showOnlyChanges ? 'Show all rows' : 'Show only changes'}
                                        </button>
                                    </div>

                                    <div className="rounded-2xl border border-slate-100 divide-y divide-slate-50 max-h-72 overflow-y-auto">
                                        {visibleRows.length === 0 && (
                                            <p className="p-6 text-center text-xs text-slate-400 font-bold">
                                                Nothing to change — this file matches the catalog exactly.
                                            </p>
                                        )}
                                        {visibleRows.map(row => {
                                            const style = ACTION_STYLES[row.action];
                                            return (
                                                <div key={row.rowNumber} className="flex items-start gap-3 px-4 py-3">
                                                    <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${style.chip}`}>
                                                        <style.Icon className="w-3 h-3" />
                                                        {style.label}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="text-xs font-black text-slate-800 truncate">{row.name || '(no name)'}</p>
                                                            {row.item_code && (
                                                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest shrink-0">{row.item_code}</span>
                                                            )}
                                                            {row.photo_url && <ImageIcon className="w-3 h-3 text-violet-400 shrink-0" />}
                                                        </div>
                                                        {row.errors.length > 0 && (
                                                            <p className="text-[11px] text-rose-500 font-bold mt-1">{row.errors.join(' · ')}</p>
                                                        )}
                                                        {Object.keys(row.changes).length > 0 && (
                                                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                                                                {Object.entries(row.changes).map(([field, change]) => (
                                                                    <span key={field} className="text-[11px] text-slate-400 font-bold">
                                                                        {FIELD_LABELS[field] || field}:{' '}
                                                                        <span className="text-slate-300 line-through">{String(change.from ?? '—').slice(0, 28) || '—'}</span>
                                                                        {' → '}
                                                                        <span className="text-slate-700">{String(change.to ?? '—').slice(0, 28)}</span>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] font-black text-slate-300 shrink-0">#{row.rowNumber}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Items absent from the file — the production-safety decision */}
                                {preview.absent_items.length > 0 && (
                                    <div>
                                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                In the catalog but not in this file ({preview.absent_items.length})
                                            </p>
                                            <div className="flex items-center gap-1">
                                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest mr-1">Set all</span>
                                                {DECISIONS.map(d => (
                                                    <button
                                                        key={d.value}
                                                        onClick={() => setAllDecisions(d.value)}
                                                        className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
                                                    >
                                                        {d.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 mb-3">
                                            <p className="text-xs text-amber-800 font-bold leading-relaxed">
                                                These default to <strong>Keep</strong> — nothing happens to them unless you say so.
                                                <br />
                                                <strong>Legacy</strong> is the safe middle step while migrating: the item stays fully
                                                usable and requestable, just grouped separately and marked as being phased out.
                                                <strong> Retire</strong> hides it from new requisitions. Neither ever deletes anything.
                                            </p>
                                        </div>

                                        <div className="rounded-2xl border border-slate-100 divide-y divide-slate-50 max-h-72 overflow-y-auto">
                                            {preview.absent_items.map(item => {
                                                const current = decisions[item.id] || 'keep';
                                                return (
                                                    <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-xs font-black text-slate-800 truncate">{item.name}</p>
                                                                {item.lifecycle === 'legacy' && (
                                                                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[8px] font-black uppercase tracking-widest">
                                                                        already legacy
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-3 mt-1">
                                                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{item.category || '—'}</span>
                                                                {item.stock_property_count > 0 ? (
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-black text-sky-600">
                                                                        <Package className="w-3 h-3" />
                                                                        {item.stock_total_qty} in stock across {item.stock_property_count} {item.stock_property_count === 1 ? 'site' : 'sites'}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[10px] font-bold text-slate-300">no stock on any site</span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="flex shrink-0 rounded-xl bg-slate-100 p-0.5">
                                                            {DECISIONS.map(d => (
                                                                <button
                                                                    key={d.value}
                                                                    onClick={() => setDecision(item.id, d.value)}
                                                                    title={d.hint}
                                                                    className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${current === d.value ? d.active : 'text-slate-400 hover:text-slate-600'}`}
                                                                >
                                                                    {d.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {(decisionCounts.legacy > 0 || decisionCounts.retire > 0) && (
                                            <p className="text-[11px] font-black uppercase tracking-widest mt-2 text-slate-500">
                                                {decisionCounts.legacy > 0 && <span className="text-amber-600">{decisionCounts.legacy} → legacy</span>}
                                                {decisionCounts.legacy > 0 && decisionCounts.retire > 0 && ' · '}
                                                {decisionCounts.retire > 0 && <span className="text-rose-600">{decisionCounts.retire} → retired</span>}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* ── Download + upload ──────────────────────────── */
                            <div className="max-w-2xl mx-auto space-y-8">
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">1</span>
                                        <p className="font-black text-slate-900 text-sm tracking-tight">Get the template</p>
                                    </div>
                                    <p className="text-xs text-slate-400 font-bold mb-4 leading-relaxed">
                                        One fixed format for every upload — item code, name, category, brand, specification, UOM, standard rate, photo, sort order and description.
                                        Paste item pictures straight into the Photo column.
                                    </p>
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        <button
                                            onClick={() => downloadTemplate('blank')}
                                            disabled={isDownloading !== null}
                                            className="flex items-center justify-center gap-2 px-4 py-4 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50"
                                        >
                                            {isDownloading === 'blank' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                            Blank template
                                        </button>
                                        <button
                                            onClick={() => downloadTemplate('current')}
                                            disabled={isDownloading !== null}
                                            className="flex items-center justify-center gap-2 px-4 py-4 rounded-2xl bg-slate-100 text-slate-700 text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all disabled:opacity-50"
                                        >
                                            {isDownloading === 'current' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                            With current items
                                        </button>
                                    </div>
                                    <p className="text-[11px] text-slate-400 font-bold mt-3 leading-relaxed">
                                        Migrating an existing catalog? Start from <strong>With current items</strong> — it already
                                        carries every item and its code, so editing and re-uploading updates them instead of
                                        creating duplicates.
                                    </p>
                                </div>

                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-[10px] font-black flex items-center justify-center">2</span>
                                        <p className="font-black text-slate-900 text-sm tracking-tight">Upload the filled template</p>
                                    </div>

                                    <div
                                        onClick={() => !isUploading && fileInputRef.current?.click()}
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={e => {
                                            e.preventDefault();
                                            if (!isUploading) handleFileChosen(e.dataTransfer.files?.[0] || null);
                                        }}
                                        className={`rounded-[2rem] border-2 border-dashed p-10 flex flex-col items-center justify-center transition-all group
                                            ${isUploading
                                                ? 'border-violet-300 bg-violet-50 cursor-wait'
                                                : 'border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50/50 cursor-pointer'}`}
                                    >
                                        {isUploading ? (
                                            <>
                                                <Loader2 className="w-10 h-10 text-violet-500 animate-spin mb-4" />
                                                <p className="font-black text-violet-700 text-sm">Reading {file?.name}</p>
                                                <p className="text-xs text-violet-400 font-bold mt-1">Extracting rows and photos…</p>
                                            </>
                                        ) : (
                                            <>
                                                <div className="w-14 h-14 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                    <Upload className="w-7 h-7 text-slate-300" />
                                                </div>
                                                <p className="font-black text-slate-900 text-lg tracking-tight">Drop the filled template here</p>
                                                <p className="text-xs text-slate-400 font-bold mt-1">.xlsx · up to 5,000 items · photos included</p>
                                            </>
                                        )}
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                        className="hidden"
                                        onChange={e => handleFileChosen(e.target.files?.[0] || null)}
                                    />

                                    <p className="text-[11px] text-slate-400 font-bold mt-4 leading-relaxed">
                                        You will see exactly what changes before anything is saved, and the whole import can be
                                        undone afterwards. Blank cells leave existing values untouched, and items missing from the
                                        file are never removed automatically.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Footer ─────────────────────────────────────────────── */}
                    {preview && !result && (
                        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-4 shrink-0 bg-white">
                            <p className="text-xs font-bold text-slate-400">
                                {applicableCount === 0
                                    ? 'No changes to apply'
                                    : `${applicableCount} change${applicableCount === 1 ? '' : 's'} ready to apply`}
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={reset}
                                    disabled={isCommitting}
                                    className="px-5 py-3 rounded-2xl bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={commit}
                                    disabled={isCommitting || applicableCount === 0}
                                    className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-black uppercase tracking-widest hover:bg-emerald-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                                >
                                    {isCommitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                    {isCommitting ? 'Applying…' : 'Apply to catalog'}
                                </button>
                            </div>
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
