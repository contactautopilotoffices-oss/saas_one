'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, RefreshCw, AlertCircle, Loader2, FileText, Download, Lock, ArrowLeft } from 'lucide-react';
import ModalPortal from '../ui/ModalPortal';
import { maskStorageUrl } from '@/frontend/utils/storageUrl';
import RequisitionApproverSelect, { type RequisitionApprover } from './RequisitionApproverSelect';

/** One upload procurement can correct: a multi-site batch, or a single-site quote. */
export interface ReplaceableUpload {
    key: string;
    batchId?: string;
    requisitionId?: string;
    label: string;
    fileName: string;
    siteCount: number;
    revision: number;
}

interface SiteRow {
    id: string;
    label: string;
    status: string;
    amount: number;
    revision: number;
    eligible: boolean;
    blocked_reason: string;
}

interface UploadDetails {
    batch_id: string | null;
    revision: number;
    file: { url: string; name: string };
    approver: { id: string; name: string } | null;
    sites: SiteRow[];
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    organizationId: string;
    /** Opened from a row: skip the picker. */
    target: ReplaceableUpload | null;
    uploads: ReplaceableUpload[];
    approvers: RequisitionApprover[];
    approversLoading?: boolean;
    approversError?: string;
    onRetryApprovers?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
    pending_approval: 'Pending Approval', rejected: 'Rejected', approved: 'Approved', ordered: 'PO Issued'
};

export default function ReplaceComparisonFileModal({
    isOpen, onClose, onSuccess, organizationId, target, uploads,
    approvers, approversLoading = false, approversError = '', onRetryApprovers
}: Props) {
    const [chosen, setChosen] = useState<ReplaceableUpload | null>(target);
    const [details, setDetails] = useState<UploadDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [note, setNote] = useState('');
    const [approverId, setApproverId] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setChosen(target); setDetails(null); setFile(null); setNote(''); setApproverId(''); setError(null);
    }, [isOpen, target]);

    useEffect(() => {
        if (!isOpen || !chosen) return;
        let cancelled = false;
        setLoading(true); setError(null); setDetails(null);
        const params = new URLSearchParams({ organization_id: organizationId });
        if (chosen.batchId) params.set('batch_id', chosen.batchId); else params.set('requisition_id', chosen.requisitionId || '');
        fetch('/api/procurement/requisitions/reapproval?' + params.toString())
            .then(async res => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Could not load this upload');
                if (cancelled) return;
                setDetails(data);
                // Same approver by default; procurement may pick another.
                setApproverId(previous => previous || data.approver?.id || '');
            })
            .catch(err => { if (!cancelled) setError(err.message || 'Could not load this upload'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, chosen, organizationId]);

    const eligible = useMemo(() => details?.sites.filter(site => site.eligible) || [], [details]);
    const locked = useMemo(() => details?.sites.filter(site => !site.eligible) || [], [details]);
    const approvedAgain = eligible.filter(site => site.status === 'approved').length;
    const approverKnown = approvers.some(user => user.id === approverId);

    if (!isOpen) return null;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!chosen || !details) return;
        if (!file) { setError('Attach the corrected comparison file.'); return; }
        if (!approverKnown) { setError('Choose an available Org Super Admin or Ops Super Admin approver.'); return; }
        if (approvedAgain > 0 && !window.confirm(`${approvedAgain} site(s) were already approved on the old file. They will go back to Pending Approval and need approval again. Continue?`)) return;

        setSubmitting(true); setError(null);
        try {
            const form = new FormData();
            form.append('organization_id', organizationId);
            if (chosen.batchId) form.append('batch_id', chosen.batchId); else form.append('requisition_id', chosen.requisitionId || '');
            form.append('quote_file', file);
            form.append('note', note.trim());
            form.append('target_approver_id', approverId);
            const res = await fetch('/api/procurement/requisitions/reapproval', { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not replace the comparison file');
            alert(`✅ Comparison file replaced (Rev ${data.revision}). ${data.updated_count} requisition(s) sent for re-approval.` +
                (data.approved_earlier_count ? ` ${data.approved_earlier_count} approved site(s) need approval again.` : '') +
                (data.locked?.length ? ` ${data.locked.length} locked site(s) kept the old file.` : '') +
                (data.failed_ids?.length ? ` ${data.failed_ids.length} could not be updated; refresh and retry.` : '') +
                (data.notification_warning ? ' A notification could not be sent; the approver can still see it in the app.' : ''));
            onSuccess();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not replace the comparison file');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalPortal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
                <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl overflow-hidden my-6 flex flex-col max-h-[92vh]">
                    <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400">
                                <RefreshCw className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-base text-white">Replace Comparison File</h3>
                                <p className="text-xs text-slate-400">Upload the corrected file and send it back to the approver for re-approval.</p>
                            </div>
                        </div>
                        <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer" aria-label="Close">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-5 flex-1">
                        {error && (
                            <div role="alert" className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center gap-3">
                                <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
                                <span>{error}</span>
                            </div>
                        )}

                        {!chosen ? (
                            <div>
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">1. Choose the upload to correct</h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Uploads already sent for approval, newest first.</p>
                                {uploads.length === 0 ? (
                                    <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300">
                                        No uploads can be corrected right now. Only files sent for approval, and not yet turned into a PO, can be replaced.
                                    </div>
                                ) : (
                                    <div className="border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
                                        {uploads.map(upload => (
                                            <button key={upload.key} type="button" onClick={() => setChosen(upload)}
                                                className="w-full text-left p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 flex items-center justify-between gap-3 cursor-pointer">
                                                <div className="min-w-0">
                                                    <div className="font-bold text-sm text-slate-900 dark:text-white truncate">{upload.label}</div>
                                                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                                        {upload.fileName || 'No file attached'} · {upload.siteCount} site{upload.siteCount === 1 ? '' : 's'}
                                                    </div>
                                                </div>
                                                <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">Rev {upload.revision}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : loading || !details ? (
                            <div className="py-10 flex items-center justify-center gap-2 text-sm text-slate-500">
                                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                                <span>{loading ? 'Loading upload…' : 'Upload unavailable.'}</span>
                            </div>
                        ) : (
                            <>
                                {!target && (
                                    <button type="button" onClick={() => setChosen(null)} className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1 cursor-pointer">
                                        <ArrowLeft className="w-3.5 h-3.5" /> Choose another upload
                                    </button>
                                )}

                                <div>
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Sites in this upload</h4>
                                    <div className="border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
                                        {details.sites.map(site => (
                                            <div key={site.id} className={`p-3 flex items-center justify-between gap-3 text-xs ${site.eligible ? '' : 'opacity-60'}`}>
                                                <div className="min-w-0">
                                                    <div className="font-bold text-slate-900 dark:text-white truncate">{site.label}</div>
                                                    <div className="text-slate-500 dark:text-slate-400">₹{Number(site.amount || 0).toLocaleString('en-IN')}</div>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <span className="font-bold text-slate-700 dark:text-slate-300">{STATUS_LABEL[site.status] || site.status}</span>
                                                    <div className={site.eligible ? (site.status === 'approved' ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-emerald-700 dark:text-emerald-400') : 'text-slate-500 inline-flex items-center gap-1'}>
                                                        {site.eligible
                                                            ? (site.status === 'approved' ? 'Will need approval again' : 'Gets the new file')
                                                            : <><Lock className="w-3 h-3" /> Locked: {site.blocked_reason}</>}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="mt-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                                        {eligible.length} site{eligible.length === 1 ? '' : 's'} will get the new file.
                                        {approvedAgain > 0 && ` ${approvedAgain} of them ${approvedAgain === 1 ? 'was' : 'were'} already approved and will need approval again.`}
                                        {locked.length > 0 && ` ${locked.length} site${locked.length === 1 ? ' is' : 's are'} locked (PO issued or delivery received) and will keep the old file.`}
                                    </p>
                                </div>

                                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
                                    <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">Current file (Rev {details.revision}):</span>
                                        {details.file.url ? (
                                            <a href={maskStorageUrl(details.file.url) || details.file.url} target="_blank" rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 font-bold hover:underline">
                                                <Download className="w-3.5 h-3.5" /> {details.file.name || 'View file'}
                                            </a>
                                        ) : <span className="text-slate-400">No file attached</span>}
                                    </div>
                                    <div>
                                        <label htmlFor="replace-comparison-file" className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                            Corrected comparison file * <span className="text-slate-400 font-normal normal-case">(Excel, CSV or PDF, up to 10 MB)</span>
                                        </label>
                                        <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-amber-400 rounded-2xl p-4 transition-colors">
                                            <input id="replace-comparison-file" type="file" required
                                                accept=".xlsx,.xls,.csv,.pdf"
                                                onChange={e => setFile(e.target.files?.[0] || null)}
                                                className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100 cursor-pointer" />
                                            {file && (
                                                <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                                    <FileText className="w-4 h-4" />
                                                    <span>Ready to upload as Rev {details.revision + 1}: {file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <label htmlFor="replace-comparison-note" className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                            What was corrected? <span className="text-slate-400 font-normal normal-case">(optional, shown to the approver)</span>
                                        </label>
                                        <textarea id="replace-comparison-note" rows={2} value={note} maxLength={1000}
                                            onChange={e => setNote(e.target.value)}
                                            placeholder="e.g. Fixed the Noida quantity and the Plaza rate"
                                            className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500" />
                                    </div>
                                </div>

                                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Approver</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                        {details.approver ? `Currently with ${details.approver.name}. Keep them or choose someone else.` : 'Choose who should review the corrected file.'}
                                    </p>
                                    <RequisitionApproverSelect approvers={approvers} value={approverId} onChange={setApproverId}
                                        loading={approversLoading} error={approversError} onRetry={onRetryApprovers} />
                                </div>
                            </>
                        )}
                    </form>

                    <div className="bg-slate-50 dark:bg-slate-950 p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
                        <button type="button" onClick={onClose}
                            className="h-9 px-4 inline-flex items-center justify-center rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                            Cancel
                        </button>
                        <button type="button" onClick={handleSubmit}
                            disabled={submitting || !details || !eligible.length || !file || !approverKnown || approversLoading || !!approversError}
                            className="h-9 px-5 inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50">
                            {submitting
                                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Sending for re-approval…</span></>
                                : <><RefreshCw className="w-3.5 h-3.5" /><span>Replace File & Send for Re-approval{eligible.length ? ` (${eligible.length})` : ''}</span></>}
                        </button>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
}
