'use client';
import { useState } from 'react';
import { pcFetch, type Upload } from './workflowTypes';
import type { PettyCashOcrData } from '@/app/api/petty-cash/ocr/route';
import { Sparkles, Loader2, X, FileText } from 'lucide-react';

export default function ProofUpload({
    org,
    value,
    onChange,
    disabled = false,
    requestId,
    onBusyChange,
    onOcrExtracted,
    label = 'Proofs'
}: {
    org: string;
    value: Upload[];
    onChange: (files: Upload[]) => void;
    disabled?: boolean;
    requestId?: string;
    onBusyChange?: (busy: boolean) => void;
    onOcrExtracted?: (data: PettyCashOcrData) => void;
    label?: string;
}) {
    const [busy, setBusy] = useState(false);
    const [ocrBusy, setOcrBusy] = useState(false);
    const [error, setError] = useState('');

    return (
        <div className="pc-upload space-y-2">
            <label className="block text-sm font-semibold">
                {label} (PDF, JPEG, PNG or WebP; up to 15MB each)
                <input
                    type="file"
                    multiple
                    disabled={busy || disabled}
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    className="block mt-2 w-full text-xs"
                    onChange={async event => {
                        const files = Array.from(event.target.files || []);
                        event.target.value = '';
                        if (!files.length) return;
                        setBusy(true);
                        onBusyChange?.(true);
                        setError('');
                        const uploaded = [...value];
                        try {
                            for (const file of files) {
                                const form = new FormData();
                                form.append('file', file);
                                const up = await pcFetch<Upload>(`/api/petty-cash/upload?org_id=${org}`, {
                                    method: 'POST',
                                    body: form
                                });
                                uploaded.push(up);

                                // Trigger Vision OCR for payment screenshots or receipts
                                if (onOcrExtracted && file.type.startsWith('image/')) {
                                    setOcrBusy(true);
                                    try {
                                        const ocrForm = new FormData();
                                        ocrForm.append('file', file);
                                        if (requestId) ocrForm.append('request_id', requestId);
                                        const ocrRes = await pcFetch<{ ok: boolean; data: PettyCashOcrData }>(
                                            `/api/petty-cash/ocr?org_id=${org}${requestId ? `&request_id=${requestId}` : ''}`,
                                            { method: 'POST', body: ocrForm }
                                        );
                                        if (ocrRes.ok && ocrRes.data) {
                                            onOcrExtracted(ocrRes.data);
                                        }
                                    } catch (ocrErr) {
                                        console.warn('OCR extraction warning:', ocrErr);
                                    } finally {
                                        setOcrBusy(false);
                                    }
                                }
                            }
                            onChange([...uploaded]);
                        } catch (e) {
                            setError(e instanceof Error ? e.message : 'Upload failed');
                        } finally {
                            setBusy(false);
                            onBusyChange?.(false);
                        }
                    }}
                />
            </label>
            {busy && (
                <p role="status" className="text-xs text-text-secondary flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin text-primary" />
                    Uploading document…
                </p>
            )}
            {ocrBusy && (
                <p role="status" className="text-xs text-primary font-medium flex items-center gap-1.5">
                    <Sparkles size={14} className="animate-pulse" />
                    Analyzing receipt with Vision AI…
                </p>
            )}
            {error && <p role="alert" className="text-red-600 text-xs">{error}</p>}

            {value.length > 0 && (
                <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Attached receipts ({value.length}):</span>
                        <button
                            type="button"
                            onClick={() => onChange([])}
                            className="text-[11px] font-bold text-rose-500 hover:text-rose-700 hover:underline"
                        >
                            Clear all
                        </button>
                    </div>
                    {value.map(file => (
                        <div
                            key={file.upload_id}
                            className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 text-xs"
                        >
                            <div className="flex items-center gap-2 truncate">
                                <FileText size={14} className="text-primary shrink-0" />
                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                                    {file.file_name}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    const next = value.filter(f => f.upload_id !== file.upload_id);
                                    onChange(next);
                                }}
                                disabled={busy || disabled}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
                                title="Remove attachment"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
