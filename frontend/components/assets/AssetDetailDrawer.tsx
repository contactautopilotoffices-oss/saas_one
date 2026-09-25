'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Loader2, Pencil, Trash2, QrCode } from 'lucide-react';
import AssetLifecycleView, { type LifecycleAsset, type LifecycleEvent } from './AssetLifecycleView';

interface Props {
    assetId: string;
    canManage: boolean;
    onClose: () => void;
    onEdit: () => void;
    onDeleted: () => void;
    onShowQr: () => void;
}

export default function AssetDetailDrawer({ assetId, canManage, onClose, onEdit, onDeleted, onShowQr }: Props) {
    const [asset, setAsset] = useState<LifecycleAsset | null>(null);
    const [events, setEvents] = useState<LifecycleEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/assets/${assetId}`);
            const data = await res.json();
            if (res.ok) { setAsset(data.asset); setEvents(data.events || []); }
        } finally {
            setLoading(false);
        }
    }, [assetId]);

    useEffect(() => { load(); }, [load]);

    const handleLogCost = async ({ amount, description }: { amount: number; description: string }) => {
        await fetch(`/api/assets/${assetId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_type: 'cost', title: 'Cost logged', description, amount, cost_head: 'rnm' }),
        });
        await load();
    };

    const handleDelete = async () => {
        if (!confirm('Remove this asset from the register? Its history is kept.')) return;
        setDeleting(true);
        try {
            const res = await fetch(`/api/assets/${assetId}`, { method: 'DELETE' });
            if (res.ok) onDeleted();
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[55] flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 bg-white/95 backdrop-blur z-10 flex items-center justify-between p-5 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        {canManage && (
                            <>
                                <button onClick={onShowQr} title="Print QR label" className="p-2 hover:bg-slate-100 rounded-xl"><QrCode size={17} className="text-slate-500" /></button>
                                <button onClick={onEdit} title="Edit" className="p-2 hover:bg-slate-100 rounded-xl"><Pencil size={17} className="text-slate-500" /></button>
                                <button onClick={handleDelete} disabled={deleting} title="Remove" className="p-2 hover:bg-rose-50 rounded-xl">
                                    {deleting ? <Loader2 size={17} className="animate-spin text-rose-500" /> : <Trash2 size={17} className="text-rose-500" />}
                                </button>
                            </>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl"><X size={20} className="text-slate-400" /></button>
                </div>

                <div className="p-6">
                    {loading && (
                        <div className="flex items-center justify-center py-20"><Loader2 size={28} className="text-primary animate-spin" /></div>
                    )}
                    {!loading && asset && (
                        <AssetLifecycleView asset={asset} events={events} canLogCost={canManage} onLogCost={handleLogCost} />
                    )}
                    {!loading && !asset && (
                        <p className="text-center text-sm text-slate-400 py-20">Asset not found</p>
                    )}
                </div>
            </div>
        </div>
    );
}
