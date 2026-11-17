'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, inr, shortDate, Pill, btnGhost, ErrorLine, Empty } from './invoiceUi';
import { TRIGGER_LABEL, type MilestoneTrigger } from '@/backend/lib/accounts/paymentSchedule';
import PoPaymentPlan from './PoPaymentPlan';

interface Item {
    id: string; po_id: string; seq: number; label: string; percent: number; amount: number; trigger: MilestoneTrigger; due_marked_at: string | null;
    due_note: string | null; due_early: boolean; po: { po_number: string; vendor_name: string | null; project_name: string | null } | null; marker: { full_name: string | null } | null;
}

/** Accounts' list of payments Purchase has marked due. Read-only here: tranches are raised in the Payment Tracker. */
export default function MilestonesDue({ orgId, refreshKey }: { orgId: string; refreshKey: number }) {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<Item | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try { setItems((await api<{ items: Item[] }>(`/api/po-schedule/due?org_id=${orgId}`)).items); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    }, [orgId]);
    useEffect(() => { load(); }, [load, refreshKey]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-text-tertiary max-w-2xl">Payments Purchase has marked due against each PO&apos;s agreed milestones. Raise and align each one in the Payment Tracker. Nothing is created from here.</p>
                <button className={btnGhost} onClick={load} aria-label="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
            <ErrorLine message={error} />
            <div className="border border-border rounded-2xl overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-surface-elevated text-xs text-text-tertiary"><tr><th className="text-left px-3 py-2.5 font-bold">PO</th><th className="text-left px-3 py-2.5 font-bold">Milestone</th><th className="text-right px-3 py-2.5 font-bold">Amount</th><th className="text-left px-3 py-2.5 font-bold">Marked due</th></tr></thead>
                    <tbody className="divide-y divide-border">
                        {items.map((m) => (
                            <tr key={m.id} className="hover:bg-surface-elevated/50 cursor-pointer align-top" onClick={() => setOpen(m)}>
                                <td className="px-3 py-3"><div className="font-bold text-text-primary">{m.po?.po_number}</div><div className="text-[11px] text-text-tertiary truncate max-w-[200px]">{m.po?.vendor_name} · {m.po?.project_name}</div></td>
                                <td className="px-3 py-3"><div className="text-text-primary">{m.percent}% · {m.label}</div><div className="flex gap-1.5 mt-1"><Pill>{TRIGGER_LABEL[m.trigger]}</Pill>{m.due_early && <Pill tone="amber">Marked early</Pill>}</div>{m.due_note && <div className="text-[11px] text-text-tertiary mt-1">{m.due_note}</div>}</td>
                                <td className="px-3 py-3 text-right tabular-nums font-bold">{inr(m.amount)}</td>
                                <td className="px-3 py-3 text-xs text-text-secondary">{shortDate(m.due_marked_at)}<div className="text-text-tertiary">{m.marker?.full_name ?? '—'}</div></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!loading && !items.length && <Empty>No milestones are marked due.</Empty>}
            </div>
            {open && <PoPaymentPlan orgId={orgId} poId={open.po_id} poNumber={open.po?.po_number ?? ''} onClose={() => setOpen(null)} onChanged={load} />}
        </div>
    );
}
