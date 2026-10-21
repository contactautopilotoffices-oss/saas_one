'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { api, inr, shortDate, label, Pill, matchTone, reviewTone, inputCls, btnGhost, ErrorLine, Empty, Pager } from './invoiceUi';

export type QueueView = 'review' | 'ready' | 'accepted' | 'all';

interface Item {
    id: string; invoice_number: string | null; invoice_date: string | null; invoice_total: number | null; match_status: string; review_status: string;
    extraction_status: string; extraction_error: string | null; submitted_via: string; submitted_at: string; blocking_issues: number;
    po: { po_number: string; vendor_name: string | null; po_amount: number | null } | null;
}

const EMPTY: Record<QueueView, string> = {
    review: 'Nothing waiting for review. Mismatches and unreadable invoices land here.',
    ready: 'No matched invoices waiting for Accounts.',
    accepted: 'No accepted invoices yet.',
    all: 'No invoices yet.',
};

export default function InvoiceQueue({ orgId, view, refreshKey, onOpen }: { orgId: string; view: QueueView; refreshKey: number; onOpen: (id: string) => void }) {
    const [items, setItems] = useState<Item[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const d = await api<{ items: Item[]; pagination: { total_pages: number } }>(`/api/invoices/queue?${new URLSearchParams({ org_id: orgId, view, page: String(page), page_size: '25', search })}`);
            setItems(d.items); setTotalPages(d.pagination.total_pages || 1);
        } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    }, [orgId, view, page, search]);

    useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search, refreshKey]);
    useEffect(() => { setPage(1); }, [view, search]);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                    <input className={`${inputCls} pl-9`} placeholder="Invoice number" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <button className={btnGhost} onClick={load} aria-label="Refresh"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
            <ErrorLine message={error} />
            <div className="border border-border rounded-2xl overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-surface-elevated text-xs text-text-tertiary">
                        <tr><th className="text-left px-3 py-2.5 font-bold">Invoice</th><th className="text-left px-3 py-2.5 font-bold">PO / Vendor</th><th className="text-right px-3 py-2.5 font-bold">Total</th><th className="text-left px-3 py-2.5 font-bold">Status</th><th className="text-left px-3 py-2.5 font-bold">Received</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {items.map((i) => (
                            <tr key={i.id} className="hover:bg-surface-elevated/50 cursor-pointer" onClick={() => onOpen(i.id)}>
                                <td className="px-3 py-3"><div className="font-bold text-text-primary">{i.invoice_number ?? '(no number)'}</div><div className="text-[11px] text-text-tertiary">{shortDate(i.invoice_date)}</div></td>
                                <td className="px-3 py-3"><div className="text-text-primary">{i.po?.po_number}</div><div className="text-[11px] text-text-tertiary truncate max-w-[220px]">{i.po?.vendor_name}</div></td>
                                <td className="px-3 py-3 text-right tabular-nums">{inr(i.invoice_total)}<div className="text-[11px] text-text-tertiary">PO {inr(i.po?.po_amount)}</div></td>
                                <td className="px-3 py-3">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <Pill tone={matchTone(i.match_status)}>{['pending', 'processing'].includes(i.extraction_status) ? 'Reading…' : label(i.match_status)}</Pill>
                                        {i.review_status !== 'pending' && <Pill tone={reviewTone(i.review_status)}>{label(i.review_status)}</Pill>}
                                        {i.blocking_issues > 0 && <span className="text-[11px] font-bold text-red-600">{i.blocking_issues} blocking</span>}
                                    </div>
                                    {i.extraction_status === 'failed' && <div className="text-[11px] text-red-600 mt-1">Could not read the file</div>}
                                </td>
                                <td className="px-3 py-3 text-xs text-text-secondary">{shortDate(i.submitted_at)}<div className="text-text-tertiary">{i.submitted_via === 'vendor_link' ? 'Vendor link' : 'Internal'}</div></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!loading && !items.length && <Empty>{EMPTY[view]}</Empty>}
            </div>
            <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </div>
    );
}
