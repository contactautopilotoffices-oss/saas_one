'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Toast } from '@/frontend/components/ui/Toast';
import type { StockItemSource } from '@/frontend/lib/stock/itemSource';

interface PropertyStockRow {
    id: string;
    name: string;
    code?: string | null;
    item_source: StockItemSource;
    switched_at: string | null;
    switched_by: string | null;
    old_item_count: number;
    requisition_item_count: number;
}

interface Props {
    organizationId: string;
}

/**
 * Per-property switch between a property's own old stock list and its monthly
 * requisition items. Nothing is matched or copied between the two lists: the old
 * list stays exactly as it is and comes back if the switch is turned off.
 */
export default function StockSettingsPanel({ organizationId }: Props) {
    const [rows, setRows] = useState<PropertyStockRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [schemaReady, setSchemaReady] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<{ row: PropertyStockRow; to: StockItemSource } | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const load = useCallback(async () => {
        if (!organizationId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/organizations/${organizationId}/stock/settings`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not load stock settings');
            setRows(data.properties || []);
            setSchemaReady(data.schema_ready !== false);
        } catch (err) {
            setToast({ message: err instanceof Error ? err.message : 'Could not load stock settings', type: 'error' });
        } finally {
            setLoading(false);
        }
    }, [organizationId]);

    useEffect(() => { load(); }, [load]);

    const applySwitch = async (row: PropertyStockRow, to: StockItemSource) => {
        setConfirming(null);
        setSavingId(row.id);
        try {
            const res = await fetch(`/api/organizations/${organizationId}/stock/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ property_id: row.id, item_source: to }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not change the stock list');
            setToast({
                message: to === 'catalog'
                    ? `${row.name} now uses requisition items${data.added ? ` (${data.added} added)` : ''}`
                    : `${row.name} is back on its old stock list`,
                type: 'success',
            });
            await load();
        } catch (err) {
            setToast({ message: err instanceof Error ? err.message : 'Could not change the stock list', type: 'error' });
        } finally {
            setSavingId(null);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                        <Boxes size={20} className="text-primary" />
                    </div>
                    <div>
                        <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Stock Settings</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                            Choose which item list each property counts stock against. <b>Requisition items</b> gives the property one stock row for every item it sees in its monthly requisition, starting at 0. Its old list is kept untouched in an Old Stock tab and comes back if you switch back.
                        </p>
                    </div>
                </div>
                <button onClick={load} className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" title="Refresh" aria-label="Refresh">
                    <RefreshCw size={16} className={loading ? 'animate-spin text-slate-400' : 'text-slate-500'} />
                </button>
            </div>

            {!schemaReady && (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    The database has not had the stock migration (20261026100001) yet. Switching will work once it is applied.
                </div>
            )}

            {loading && rows.length === 0 ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-300" /></div>
            ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800">
                    <table className="w-full text-sm" style={{ minWidth: 640 }}>
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs uppercase tracking-wide text-slate-500">
                                <th className="px-4 py-3 font-semibold">Property</th>
                                <th className="px-4 py-3 font-semibold">Stock list</th>
                                <th className="px-4 py-3 font-semibold text-right">Old items</th>
                                <th className="px-4 py-3 font-semibold text-right">Requisition items</th>
                                <th className="px-4 py-3 font-semibold">Last changed</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {rows.map(row => (
                                <tr key={row.id}>
                                    <td className="px-4 py-3">
                                        <span className="font-semibold text-slate-900 dark:text-white">{row.name}</span>
                                        {row.code && <span className="ml-2 text-xs text-slate-400 font-mono">{row.code}</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800">
                                            {(['legacy', 'catalog'] as StockItemSource[]).map(option => (
                                                <button
                                                    key={option}
                                                    disabled={savingId === row.id || !schemaReady}
                                                    onClick={() => option !== row.item_source && setConfirming({ row, to: option })}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${row.item_source === option
                                                        ? 'bg-white dark:bg-slate-900 text-primary shadow-xs'
                                                        : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    {option === 'legacy' ? 'Old list' : 'Requisition items'}
                                                </button>
                                            ))}
                                        </div>
                                        {savingId === row.id && <Loader2 size={14} className="inline ml-2 animate-spin text-slate-400" />}
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{row.old_item_count}</td>
                                    <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{row.requisition_item_count}</td>
                                    <td className="px-4 py-3 text-xs text-slate-500">
                                        {row.switched_at
                                            ? `${new Date(row.switched_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}${row.switched_by ? ` by ${row.switched_by}` : ''}`
                                            : 'Never'}
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No properties.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {confirming && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setConfirming(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                            {confirming.to === 'catalog' ? `Switch ${confirming.row.name} to requisition items?` : `Switch ${confirming.row.name} back to its old list?`}
                        </h3>
                        {confirming.to === 'catalog' ? (
                            <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-disc pl-5">
                                <li>Every item this property sees in its monthly requisition becomes its stock list, starting at quantity 0.</li>
                                {confirming.row.old_item_count > 0 && (
                                    <li>The current {confirming.row.old_item_count} items move to an <b>Old Stock</b> tab. Their quantities, QR codes and history are kept, nothing is deleted.</li>
                                )}
                                <li>Staff should then enter the current stock and print the new QR codes from the Stock tab.</li>
                            </ul>
                        ) : (
                            <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-disc pl-5">
                                <li>The old item list comes back exactly as it was.</li>
                                <li>The requisition items and their quantities are kept, just hidden, until you switch again.</li>
                                <li>Delivery challans cannot be uploaded while the property is on its old list.</li>
                            </ul>
                        )}
                        <div className="flex gap-2 pt-2">
                            <button onClick={() => setConfirming(null)} className="flex-1 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600">
                                Cancel
                            </button>
                            <button onClick={() => applySwitch(confirming.row, confirming.to)} className="flex-1 py-2.5 rounded-2xl bg-primary text-white text-sm font-bold">
                                Switch
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <Toast message={toast.message} type={toast.type} visible={true} onClose={() => setToast(null)} duration={3500} />
            )}
        </div>
    );
}
