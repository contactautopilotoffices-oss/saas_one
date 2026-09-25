'use client';

import { useRef, useState } from 'react';
import { X, Upload, FileSpreadsheet, CheckCircle, AlertCircle, Download, ArrowLeft, Loader2, QrCode } from 'lucide-react';
import AssetQRLabelsModal, { type LabelAsset } from './AssetQRLabelsModal';

interface Props {
    organizationId: string;
    propertyId: string;
    propertyName?: string;
    onClose: () => void;
    onSuccess: () => void;
}

interface ImportError { row: number; field: string; message: string }
interface PreviewRow { row: number; name?: string; category?: string; asset_code?: string; floor?: string; location?: string }

type Step = 'upload' | 'preview' | 'importing' | 'result';

export default function BulkImportAssetsModal({ organizationId, propertyId, propertyName, onClose, onSuccess }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [step, setStep] = useState<Step>('upload');
    const [file, setFile] = useState<File | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [isValidating, setIsValidating] = useState(false);

    const [preview, setPreview] = useState<PreviewRow[]>([]);
    const [validCount, setValidCount] = useState(0);
    const [invalidCount, setInvalidCount] = useState(0);
    const [errors, setErrors] = useState<ImportError[]>([]);
    const [unmapped, setUnmapped] = useState<string[]>([]);

    const [result, setResult] = useState<{ imported: number; skipped: number; total: number; errors: ImportError[]; created: LabelAsset[] } | null>(null);
    const [showLabels, setShowLabels] = useState(false);
    const [topError, setTopError] = useState('');

    const handleDownloadTemplate = async () => {
        try {
            const res = await fetch('/api/assets/template');
            if (!res.ok) throw new Error('Failed to download template');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'asset_import_template.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch {
            setTopError('Failed to download the template');
        }
    };

    const handleFile = async (f: File) => {
        setFile(f);
        setIsValidating(true);
        setTopError('');
        try {
            const form = new FormData();
            form.append('file', f);
            form.append('property_id', propertyId);
            form.append('organization_id', organizationId);
            form.append('mode', 'validate');
            const res = await fetch('/api/assets/bulk-import', { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not read this file');
            setPreview(data.preview || []);
            setValidCount(data.valid || 0);
            setInvalidCount(data.invalid || 0);
            setErrors(data.errors || []);
            setUnmapped(data.unmapped_columns || []);
            setStep('preview');
        } catch (err: any) {
            setTopError(err.message || 'Could not read this file');
        } finally {
            setIsValidating(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
    };

    const handleImport = async () => {
        if (!file) return;
        setStep('importing');
        try {
            const form = new FormData();
            form.append('file', file);
            form.append('property_id', propertyId);
            form.append('organization_id', organizationId);
            form.append('mode', 'import');
            const res = await fetch('/api/assets/bulk-import', { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Import failed');
            setResult(data);
            setStep('result');
            onSuccess();
        } catch (err: any) {
            setTopError(err.message || 'Import failed');
            setStep('preview');
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={step === 'importing' ? undefined : onClose}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        {step === 'preview' && (
                            <button onClick={() => setStep('upload')} className="p-2 hover:bg-slate-100 rounded-xl -ml-2">
                                <ArrowLeft size={18} className="text-slate-500" />
                            </button>
                        )}
                        <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
                            <FileSpreadsheet size={20} className="text-primary" />
                        </div>
                        <h2 className="text-lg font-extrabold text-slate-900">Bulk Import Assets</h2>
                    </div>
                    {step !== 'importing' && (
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl">
                            <X size={20} className="text-slate-400" />
                        </button>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {step === 'upload' && (
                        <div className="space-y-4">
                            <button
                                type="button"
                                onClick={handleDownloadTemplate}
                                className="w-full flex items-center justify-between p-4 rounded-2xl border border-dashed border-primary/30 bg-primary/5 text-sm font-bold text-primary hover:bg-primary/10 transition-colors"
                            >
                                <span className="flex items-center gap-2"><Download size={16} /> Download the import template (.xlsx)</span>
                                <span className="text-xs font-normal text-primary/70">Includes your categories</span>
                            </button>

                            <div
                                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                                onDragLeave={() => setDragActive(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={`flex flex-col items-center justify-center gap-3 p-10 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${dragActive ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300'}`}
                            >
                                {isValidating ? (
                                    <Loader2 size={28} className="text-primary animate-spin" />
                                ) : (
                                    <Upload size={28} className="text-slate-400" />
                                )}
                                <p className="text-sm font-bold text-slate-700">
                                    {isValidating ? 'Reading file...' : 'Drop your .xlsx or .csv here, or click to browse'}
                                </p>
                                <p className="text-xs text-slate-400">Category, Asset Name and the rest of the fields from the template</p>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    className="hidden"
                                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                                />
                            </div>
                            {topError && (
                                <p className="flex items-center gap-2 text-sm text-red-600 font-semibold"><AlertCircle size={16} /> {topError}</p>
                            )}
                        </div>
                    )}

                    {step === 'preview' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                                    <p className="text-2xl font-black text-emerald-700">{validCount}</p>
                                    <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide">Ready to import</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100">
                                    <p className="text-2xl font-black text-rose-700">{invalidCount}</p>
                                    <p className="text-xs font-bold text-rose-600 uppercase tracking-wide">Rows with issues</p>
                                </div>
                            </div>

                            {unmapped.length > 0 && (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">
                                    Columns not recognized (ignored): {unmapped.join(', ')}
                                </p>
                            )}

                            {errors.length > 0 && (
                                <div className="rounded-2xl border border-rose-100 overflow-hidden">
                                    <div className="max-h-40 overflow-y-auto divide-y divide-rose-50">
                                        {errors.slice(0, 30).map((e, i) => (
                                            <div key={i} className="p-3 text-xs bg-rose-50/50">
                                                <span className="font-bold text-rose-700">Row {e.row}</span>
                                                <span className="text-rose-500"> · {e.field}: {e.message}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {preview.length > 0 && (
                                <div className="rounded-2xl border border-slate-100 overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide">
                                            <tr>
                                                <th className="text-left p-2 font-bold">Name</th>
                                                <th className="text-left p-2 font-bold">Category</th>
                                                <th className="text-left p-2 font-bold">Floor / Location</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {preview.slice(0, 15).map((r, i) => (
                                                <tr key={i}>
                                                    <td className="p-2 font-semibold text-slate-700">{r.name}</td>
                                                    <td className="p-2 text-slate-500">{r.category}</td>
                                                    <td className="p-2 text-slate-500">{[r.floor, r.location].filter(Boolean).join(' · ') || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {preview.length > 15 && <p className="text-xs text-slate-400 p-2 text-center">+{preview.length - 15} more rows</p>}
                                </div>
                            )}
                            {topError && <p className="flex items-center gap-2 text-sm text-red-600 font-semibold"><AlertCircle size={16} /> {topError}</p>}
                        </div>
                    )}

                    {step === 'importing' && (
                        <div className="flex flex-col items-center justify-center gap-4 py-16">
                            <Loader2 size={32} className="text-primary animate-spin" />
                            <p className="text-sm font-bold text-slate-600">Importing assets...</p>
                        </div>
                    )}

                    {step === 'result' && result && (
                        <div className="flex flex-col items-center text-center gap-4 py-8">
                            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center">
                                <CheckCircle size={32} className="text-emerald-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-black text-slate-900">{result.imported} of {result.total} imported</p>
                                {result.skipped > 0 && <p className="text-sm text-slate-500 mt-1">{result.skipped} row{result.skipped === 1 ? '' : 's'} skipped — see below</p>}
                            </div>
                            {result.created.length > 0 && (
                                <button
                                    onClick={() => setShowLabels(true)}
                                    className="flex items-center gap-2 px-5 py-3 bg-primary text-white rounded-2xl text-sm font-black uppercase tracking-widest"
                                >
                                    <QrCode size={16} /> Print QR Labels for These
                                </button>
                            )}
                            {result.errors.length > 0 && (
                                <div className="w-full text-left rounded-2xl border border-rose-100 overflow-hidden mt-2">
                                    <div className="max-h-40 overflow-y-auto divide-y divide-rose-50">
                                        {result.errors.slice(0, 30).map((e, i) => (
                                            <div key={i} className="p-3 text-xs bg-rose-50/50">
                                                <span className="font-bold text-rose-700">Row {e.row}</span>
                                                <span className="text-rose-500"> · {e.field}: {e.message}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {step === 'preview' && (
                    <div className="p-6 pt-0 flex gap-3 flex-shrink-0">
                        <button onClick={() => setStep('upload')} className="px-5 py-3 bg-slate-100 text-slate-600 rounded-2xl text-sm font-bold">Choose Different File</button>
                        <button
                            onClick={handleImport}
                            disabled={validCount === 0}
                            className="flex-1 py-3 bg-primary text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-40"
                        >
                            Import {validCount} Asset{validCount === 1 ? '' : 's'}
                        </button>
                    </div>
                )}
                {step === 'result' && (
                    <div className="p-6 pt-0 flex-shrink-0">
                        <button onClick={onClose} className="w-full py-3 bg-slate-100 text-slate-700 rounded-2xl text-sm font-bold">Done</button>
                    </div>
                )}
            </div>

            {showLabels && result && (
                <AssetQRLabelsModal assets={result.created} propertyName={propertyName} onClose={() => setShowLabels(false)} />
            )}
        </div>
    );
}
