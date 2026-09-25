'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { X, QrCode, Loader2, CheckCircle2, Wrench } from 'lucide-react';
import type { QRScanResult } from '@/frontend/components/shared/UniversalQRScannerModal';

const UniversalQRScannerModal = dynamic(() => import('@/frontend/components/shared/UniversalQRScannerModal'), { ssr: false });

interface Props {
    ticketId: string;
    onClose: () => void;
    onLogged: (asset: { id: string; asset_code: string; name: string }) => void;
}

type Step = 'scan' | 'note' | 'saving' | 'done';

/**
 * MST flow: scan the asset's QR, write 1-2 lines on what was fixed. Posts to
 * /api/tickets/[id]/assets, which records the note on the asset's lifecycle
 * and appends a ticket_activity_log entry.
 */
export default function LogAssetWorkModal({ ticketId, onClose, onLogged }: Props) {
    const [step, setStep] = useState<Step>('scan');
    const [scannedToken, setScannedToken] = useState<string | null>(null);
    const [assetPreview, setAssetPreview] = useState<{ id: string; asset_code: string; name: string } | null>(null);
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleScanResult = async (result: QRScanResult) => {
        if (result.type !== 'asset') {
            setError('That QR code is not an asset tag. Scan the asset label near the equipment.');
            return;
        }
        setScannedToken(result.token);
        setStep('note');
        setError(null);
        // Best-effort preview of the asset name so the MST can confirm before writing the note.
        try {
            const res = await fetch(`/api/assets/scan/${encodeURIComponent(result.token)}`);
            if (res.ok) {
                const data = await res.json();
                setAssetPreview({ id: data.asset.id, asset_code: data.asset.asset_code, name: data.asset.name });
            }
        } catch { /* preview is optional */ }
    };

    const handleSubmit = async () => {
        if (!scannedToken || !note.trim()) return;
        setStep('saving');
        setError(null);
        try {
            const res = await fetch(`/api/tickets/${ticketId}/assets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qr_token: scannedToken, note: note.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to log asset work');
            setAssetPreview(data.asset);
            setStep('done');
            onLogged(data.asset);
        } catch (err: any) {
            setError(err.message || 'Failed to log asset work');
            setStep('note');
        }
    };

    if (step === 'scan') {
        return (
            <UniversalQRScannerModal
                title="Scan Asset QR"
                onClose={onClose}
                onResult={handleScanResult}
            />
        );
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-lg" onClick={onClose}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
                            {step === 'done' ? <CheckCircle2 size={20} className="text-emerald-500" /> : <Wrench size={20} className="text-primary" />}
                        </div>
                        <h2 className="text-xl font-extrabold text-gray-900 tracking-tight">
                            {step === 'done' ? 'Logged' : 'What was fixed?'}
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2.5 hover:bg-gray-100 rounded-2xl transition-all">
                        <X size={22} className="text-gray-400" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {assetPreview && (
                        <div className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-2xl p-3">
                            <QrCode size={18} className="text-slate-400 flex-shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-900 truncate">{assetPreview.name}</p>
                                <p className="text-xs text-slate-500 font-mono">{assetPreview.asset_code}</p>
                            </div>
                        </div>
                    )}

                    {step === 'done' ? (
                        <p className="text-sm text-slate-600">
                            Added to this asset&apos;s lifecycle. Anyone who scans it will now see this note.
                        </p>
                    ) : (
                        <>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                                    1-2 lines on what was fixed
                                </label>
                                <textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    rows={3}
                                    maxLength={400}
                                    autoFocus
                                    placeholder="e.g. Replaced capacitor, cleared drain line, tested — cooling normal"
                                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                                />
                            </div>
                            {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
                        </>
                    )}
                </div>

                <div className="p-6 pt-0 flex gap-3">
                    {step === 'done' ? (
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 bg-primary text-white rounded-2xl text-sm font-black uppercase tracking-widest"
                        >
                            Done
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={() => { setStep('scan'); setScannedToken(null); setAssetPreview(null); setError(null); }}
                                className="px-4 py-3 bg-slate-100 text-slate-600 rounded-2xl text-sm font-bold"
                            >
                                Rescan
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={!note.trim() || step === 'saving'}
                                className="flex-1 py-3 bg-primary text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                                {step === 'saving' ? <Loader2 size={16} className="animate-spin" /> : null}
                                {step === 'saving' ? 'Saving...' : 'Save to Asset'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
