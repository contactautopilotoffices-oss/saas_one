'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Truck, Loader2, Upload, FileText, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import ModalPortal from '../ui/ModalPortal';

interface ChallanLine {
    catalog_item_id: string;
    item_name: string;
    unit: string;
    category: string;
    ordered_qty: number;
    received_qty: number;
    pending_qty: number;
}

interface PastChallan {
    id: string;
    challan_number: string | null;
    challan_date: string | null;
    file_url: string;
    file_name: string | null;
    total_items: number;
    total_qty: number;
    confirmed_at: string;
    confirmed_by: string | null;
}

interface Props {
    requisitionId: string;
    title: string;
    onClose: () => void;
    onConfirmed: (message: string) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Delivery challan for an approved monthly requisition. The property admin
 * uploads the challan, checks what actually arrived against what was ordered,
 * and confirms. Confirmed quantities are added to the property's stock.
 * Anything short stays pending for the next challan.
 */
export default function DeliveryChallanModal({ requisitionId, title, onClose, onConfirmed }: Props) {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [lines, setLines] = useState<ChallanLine[]>([]);
    const [pastChallans, setPastChallans] = useState<PastChallan[]>([]);
    const [canUpload, setCanUpload] = useState(false);
    const [blockedReason, setBlockedReason] = useState<string | null>(null);

    const [file, setFile] = useState<File | null>(null);
    const [challanNumber, setChallanNumber] = useState('');
    const [challanDate, setChallanDate] = useState(today());
    const [received, setReceived] = useState<Record<string, string>>({});
    const [remarks, setRemarks] = useState<Record<string, string>>({});
    const [step, setStep] = useState<'entry' | 'confirm'>('entry');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    // One key per challan being entered, so a double click or retry cannot add stock twice.
    const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch(`/api/procurement/requisitions/${requisitionId}/deliveries`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not load the delivery details');
            const nextLines: ChallanLine[] = data.lines || [];
            setLines(nextLines);
            setPastChallans(data.deliveries || []);
            setCanUpload(Boolean(data.can_upload));
            setBlockedReason(data.blocked_reason || null);
            setReceived(Object.fromEntries(nextLines.map(l => [l.catalog_item_id, l.pending_qty > 0 ? fmt(l.pending_qty) : '0'])));
            setRemarks({});
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Could not load the delivery details');
        } finally {
            setLoading(false);
        }
    }, [requisitionId]);

    useEffect(() => { load(); }, [load]);

    const pendingLines = useMemo(() => lines.filter(l => l.pending_qty > 0), [lines]);
    const fullyReceived = lines.length > 0 && pendingLines.length === 0;

    const entered = useMemo(() => pendingLines
        .map(l => ({ line: l, qty: Number(received[l.catalog_item_id]) }))
        .filter(e => Number.isFinite(e.qty) && e.qty > 0), [pendingLines, received]);
    const invalidLine = pendingLines.find(l => {
        const raw = received[l.catalog_item_id];
        if (raw === undefined || raw === '') return false;
        const qty = Number(raw);
        return !Number.isFinite(qty) || qty < 0 || qty > l.pending_qty + 1e-9;
    });
    const totalUnits = entered.reduce((sum, e) => sum + e.qty, 0);

    const formError = !file ? 'Attach the delivery challan.'
        : !challanNumber.trim() ? 'Enter the challan number.'
        : !challanDate ? 'Enter the challan date.'
        : invalidLine ? `Received quantity for ${invalidLine.item_name} must be between 0 and ${fmt(invalidLine.pending_qty)}.`
        : entered.length === 0 ? 'Enter the received quantity for at least one item.'
        : null;

    const handleConfirm = async () => {
        if (formError || !file) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const form = new FormData();
            form.append('file', file);
            form.append('challan_number', challanNumber.trim());
            form.append('challan_date', challanDate);
            form.append('idempotency_key', idempotencyKey);
            form.append('lines', JSON.stringify(entered.map(e => ({
                catalog_item_id: e.line.catalog_item_id,
                received_qty: e.qty,
                remarks: remarks[e.line.catalog_item_id] || '',
            }))));

            const res = await fetch(`/api/procurement/requisitions/${requisitionId}/deliveries`, { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not save the challan');

            onConfirmed(`Challan ${challanNumber.trim()} saved. ${entered.length} item(s) added to stock.`);
            setFile(null);
            setChallanNumber('');
            setChallanDate(today());
            setStep('entry');
            setIdempotencyKey(crypto.randomUUID());
            await load();
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Could not save the challan');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ModalPortal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs" onClick={onClose}>
                <div
                    className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                                <Truck size={20} className="text-primary" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Delivery Challan</h2>
                                <p className="text-xs text-slate-500 truncate">{title}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl" aria-label="Close">
                            <X size={20} className="text-slate-400" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 space-y-5">
                        {loading ? (
                            <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-300" /></div>
                        ) : loadError ? (
                            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                                <AlertCircle size={16} className="mt-0.5 shrink-0" /> {loadError}
                            </div>
                        ) : (
                            <>
                                {pastChallans.length > 0 && (
                                    <div>
                                        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Challans already received</h3>
                                        <div className="divide-y divide-slate-100 dark:divide-slate-700 border border-slate-100 dark:border-slate-700 rounded-2xl">
                                            {pastChallans.map(c => (
                                                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                                                    <FileText size={16} className="text-slate-400 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                                                            {c.challan_number || 'Challan'}{c.challan_date ? ` - ${new Date(c.challan_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
                                                        </p>
                                                        <p className="text-xs text-slate-400 truncate">
                                                            {c.total_items} item(s), {fmt(Number(c.total_qty) || 0)} units{c.confirmed_by ? ` by ${c.confirmed_by}` : ''}
                                                        </p>
                                                    </div>
                                                    <a href={c.file_url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline shrink-0">View</a>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {fullyReceived && (
                                    <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
                                        <CheckCircle2 size={16} /> Everything on this requisition has been received.
                                    </div>
                                )}

                                {!canUpload && blockedReason && !fullyReceived && (
                                    <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                                        <AlertCircle size={16} className="mt-0.5 shrink-0" /> {blockedReason}
                                    </div>
                                )}

                                {canUpload && !fullyReceived && step === 'entry' && (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <label className="block sm:col-span-1">
                                                <span className="text-xs font-semibold text-slate-500">Challan file (PDF or photo)</span>
                                                <span className="mt-1 flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 dark:border-slate-600 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 text-sm text-slate-600 dark:text-slate-300">
                                                    <Upload size={15} className="shrink-0" />
                                                    <span className="truncate">{file ? file.name : 'Choose file'}</span>
                                                    <input
                                                        type="file"
                                                        accept="application/pdf,image/*"
                                                        className="hidden"
                                                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                                                    />
                                                </span>
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-semibold text-slate-500">Challan number</span>
                                                <input
                                                    value={challanNumber}
                                                    onChange={(e) => setChallanNumber(e.target.value)}
                                                    className="mt-1 w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:border-blue-400"
                                                    placeholder="e.g. DC-1042"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-semibold text-slate-500">Challan date</span>
                                                <input
                                                    type="date"
                                                    value={challanDate}
                                                    max={today()}
                                                    onChange={(e) => setChallanDate(e.target.value)}
                                                    className="mt-1 w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:border-blue-400"
                                                />
                                            </label>
                                        </div>

                                        <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-700">
                                            <table className="w-full text-sm" style={{ minWidth: 620 }}>
                                                <thead>
                                                    <tr className="bg-slate-50 dark:bg-slate-900/60 text-left text-[11px] uppercase tracking-wide text-slate-500">
                                                        <th className="px-3 py-2.5 font-semibold">Item</th>
                                                        <th className="px-3 py-2.5 font-semibold text-right">Ordered</th>
                                                        <th className="px-3 py-2.5 font-semibold text-right">Already received</th>
                                                        <th className="px-3 py-2.5 font-semibold text-right">Received now</th>
                                                        <th className="px-3 py-2.5 font-semibold">Remarks</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                                    {lines.map(l => {
                                                        const done = l.pending_qty <= 0;
                                                        return (
                                                            <tr key={l.catalog_item_id} className={done ? 'opacity-50' : ''}>
                                                                <td className="px-3 py-2">
                                                                    <span className="block font-medium text-slate-900 dark:text-white">{l.item_name}</span>
                                                                    <span className="block text-[11px] text-slate-400">{l.unit}{l.category ? ` - ${l.category}` : ''}</span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right tabular-nums">{fmt(l.ordered_qty)}</td>
                                                                <td className="px-3 py-2 text-right tabular-nums">{fmt(l.received_qty)}</td>
                                                                <td className="px-3 py-2 text-right">
                                                                    {done ? (
                                                                        <span className="text-xs font-bold text-emerald-600">Done</span>
                                                                    ) : (
                                                                        <input
                                                                            type="number"
                                                                            inputMode="decimal"
                                                                            min={0}
                                                                            max={l.pending_qty}
                                                                            step="any"
                                                                            value={received[l.catalog_item_id] ?? ''}
                                                                            onChange={(e) => setReceived(prev => ({ ...prev, [l.catalog_item_id]: e.target.value }))}
                                                                            onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                                                            className="w-20 px-2 py-1.5 text-right bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                                                                            aria-label={`Received quantity of ${l.item_name}`}
                                                                        />
                                                                    )}
                                                                </td>
                                                                <td className="px-3 py-2">
                                                                    {!done && (
                                                                        <input
                                                                            value={remarks[l.catalog_item_id] || ''}
                                                                            onChange={(e) => setRemarks(prev => ({ ...prev, [l.catalog_item_id]: e.target.value }))}
                                                                            className="w-full min-w-[120px] px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:border-blue-400"
                                                                            placeholder="Short, damaged..."
                                                                        />
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        <p className="text-xs text-slate-400">Set an item to 0 if it did not come. Whatever is not received stays pending for the next challan.</p>
                                    </>
                                )}

                                {canUpload && !fullyReceived && step === 'confirm' && (
                                    <div className="space-y-3">
                                        <div className="text-sm text-slate-700 dark:text-slate-200 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 rounded-2xl px-4 py-3">
                                            <b>{entered.length} item(s), {fmt(totalUnits)} units</b> will be added to this property&apos;s stock from challan <b>{challanNumber.trim()}</b>. This cannot be undone from here.
                                        </div>
                                        <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-700 border border-slate-100 dark:border-slate-700 rounded-2xl">
                                            {entered.map(e => (
                                                <li key={e.line.catalog_item_id} className="flex justify-between gap-3 px-4 py-2">
                                                    <span className="truncate">{e.line.item_name}</span>
                                                    <span className="font-bold tabular-nums shrink-0">+{fmt(e.qty)} {e.line.unit}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {canUpload && !fullyReceived && !loading && !loadError && (
                        <div className="p-5 border-t border-slate-100 dark:border-slate-700 space-y-2">
                            {submitError && <p className="text-sm text-red-600">{submitError}</p>}
                            {step === 'entry' && formError && <p className="text-xs text-slate-500">{formError}</p>}
                            <div className="flex gap-2">
                                {step === 'confirm' && (
                                    <button
                                        onClick={() => setStep('entry')}
                                        disabled={submitting}
                                        className="px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5"
                                    >
                                        <ArrowLeft size={15} /> Back
                                    </button>
                                )}
                                <button
                                    onClick={() => (step === 'entry' ? setStep('confirm') : handleConfirm())}
                                    disabled={Boolean(formError) || submitting}
                                    className="flex-1 py-3 bg-primary text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                    {step === 'entry' ? 'Review' : submitting ? 'Saving' : 'Confirm and add to stock'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </ModalPortal>
    );
}
