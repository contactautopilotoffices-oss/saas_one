'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileCheck2, AlertTriangle } from 'lucide-react';
import { api, inr, ErrorLine } from './invoiceUi';
import PoInvoiceStatus from './PoInvoiceStatus';
import InvoiceQueue, { type QueueView } from './InvoiceQueue';
import InvoiceReview from './InvoiceReview';
import FastTrack, { type FastTrackView } from './FastTrack';
import InvoicePolicy from './InvoicePolicy';
import MilestonesDue from './MilestonesDue';

/**
 * Invoice Control, one component mounted in two places:
 *   mode='procurement'  Procurement tab  — Purchase chases and reviews
 *   mode='accounts'     Accounts page    — Accounts reconciles and aligns
 * The same screens appear for super admins in either; what each person can DO comes from
 * /api/invoices/summary (and is enforced again by every action route).
 */

interface Summary {
    caps: { can_generate_link: boolean; can_raise_fast_track: boolean; can_resolve_soft: boolean; can_resolve_blocking: boolean; can_accept: boolean; can_decide: boolean; can_decide_above_limit: boolean; can_align: boolean; can_configure: boolean };
    policy: { approval_limit: number };
    invoices: { needs_review: number; mismatched: number; matched_awaiting_accounts: number; processing: number };
    fast_track: { pending_approval: { count: number; value: number }; approved_to_align: { count: number; value: number }; aligned_invoice_pending: { count: number; value: number }; overdue_documents: number };
}

type TabKey = 'milestones' | 'po-status' | 'review' | 'ready' | 'fast-track' | 'to-align' | 'outstanding' | 'exceptions' | 'all-invoices' | 'policy';

function Tile({ title, n, sub, warn }: { title: string; n: React.ReactNode; sub?: string; warn?: boolean }) {
    return (
        <div className={`rounded-2xl border px-4 py-3 ${warn ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-surface'}`}>
            <div className="text-[11px] font-bold text-text-tertiary">{title}</div>
            <div className={`text-xl font-bold tabular-nums ${warn ? 'text-red-600' : 'text-text-primary'}`}>{n}</div>
            {sub && <div className="text-[11px] text-text-tertiary">{sub}</div>}
        </div>
    );
}

export default function InvoiceControl({ orgId, mode }: { orgId: string; mode: 'procurement' | 'accounts' }) {
    const [sum, setSum] = useState<Summary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<TabKey>(mode === 'accounts' ? 'ready' : 'po-status');
    const [openInvoice, setOpenInvoice] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        let alive = true;
        api<Summary>(`/api/invoices/summary?org_id=${orgId}`)
            .then((d) => { if (alive) { setSum(d); setError(null); } })
            .catch((e: Error) => { if (alive) setError(e.message); });
        return () => { alive = false; };
    }, [orgId, refreshKey]);

    // Anything that changes data bumps the key: the tiles and the open list both reload from it.
    const changed = useCallback(() => setRefreshKey((k) => k + 1), []);

    const tabs = useMemo(() => {
        if (!sum) return [];
        const c = sum.caps, i = sum.invoices, f = sum.fast_track;
        const list: { key: TabKey; label: string; badge?: number }[] = mode === 'accounts' ? [
            { key: 'ready', label: 'Ready to reconcile', badge: i.matched_awaiting_accounts },
            { key: 'milestones', label: 'Milestones due' },
            { key: 'to-align', label: 'Exceptions to align', badge: f.approved_to_align.count },
            { key: 'outstanding', label: 'Invoice pending', badge: f.aligned_invoice_pending.count },
            { key: 'review', label: 'Needs review', badge: i.needs_review + i.mismatched },
            { key: 'all-invoices', label: 'All invoices' },
        ] : [
            { key: 'po-status', label: 'PO invoice status' },
            { key: 'review', label: 'Review queue', badge: i.needs_review + i.mismatched },
            { key: 'milestones', label: 'Milestones due' },
            { key: 'fast-track', label: 'Fast-track requests' },
            { key: 'outstanding', label: 'Outstanding documents', badge: f.aligned_invoice_pending.count },
        ];
        if (c.can_decide) list.push({ key: 'exceptions', label: 'Exception review', badge: f.pending_approval.count });
        if (mode === 'accounts' && !c.can_decide) list.push({ key: 'fast-track', label: 'All fast-track' });
        if (c.can_configure) list.push({ key: 'policy', label: 'Policy' });
        return list;
    }, [sum, mode]);

    if (error) return <div className="p-6"><ErrorLine message={error} /></div>;
    if (!sum) return <div className="py-16 text-center text-sm text-text-tertiary">Loading Invoice Control…</div>;

    const c = sum.caps, f = sum.fast_track;
    const caps = { can_raise_fast_track: c.can_raise_fast_track, can_decide: c.can_decide, can_decide_above_limit: c.can_decide_above_limit, can_align: c.can_align, can_accept: c.can_accept };
    const queueView: Record<string, QueueView> = { review: 'review', ready: 'ready', 'all-invoices': 'all' };
    const ftView: Record<string, FastTrackView> = { 'fast-track': 'all', 'to-align': 'to_align', outstanding: 'invoice_pending', exceptions: 'pending' };

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-xl font-bold text-text-primary flex items-center gap-2"><FileCheck2 className="w-5 h-5 text-primary" /> Invoice Control</h2>
                <p className="text-sm text-text-secondary mt-0.5">Collect each vendor invoice once, check it against the PO, and keep payment approval separate from invoice verification.</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {mode === 'accounts' ? (
                    <>
                        <Tile title="Ready to reconcile" n={sum.invoices.matched_awaiting_accounts} sub="matched, awaiting Accounts" />
                        <Tile title="Exceptions to align" n={f.approved_to_align.count} sub={inr(f.approved_to_align.value)} />
                        <Tile title="Paid, invoice pending" n={f.aligned_invoice_pending.count} sub={inr(f.aligned_invoice_pending.value)} />
                        <Tile title="Invoices overdue" n={f.overdue_documents} warn={f.overdue_documents > 0} />
                    </>
                ) : (
                    <>
                        <Tile title="Needs review" n={sum.invoices.needs_review + sum.invoices.mismatched} sub={sum.invoices.processing ? `${sum.invoices.processing} being read` : 'mismatches and unreadable'} />
                        <Tile title="Waiting for approval" n={f.pending_approval.count} sub={inr(f.pending_approval.value)} />
                        <Tile title="Paid, invoice pending" n={f.aligned_invoice_pending.count} sub={inr(f.aligned_invoice_pending.value)} />
                        <Tile title="Invoices overdue" n={f.overdue_documents} warn={f.overdue_documents > 0} />
                    </>
                )}
            </div>

            <div className="flex items-center gap-1 border-b border-border overflow-x-auto" role="tablist">
                {tabs.map((t) => (
                    <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                        {t.label}
                        {!!t.badge && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-[11px] flex items-center justify-center tabular-nums">{t.badge}</span>}
                    </button>
                ))}
            </div>

            {tab === 'po-status' && <PoInvoiceStatus orgId={orgId} canGenerate={c.can_generate_link} canUploadInternal={c.can_resolve_soft} onOpenInvoice={setOpenInvoice} onChanged={changed} />}
            {queueView[tab] && <InvoiceQueue orgId={orgId} view={queueView[tab]} refreshKey={refreshKey} onOpen={setOpenInvoice} />}
            {ftView[tab] && <FastTrack orgId={orgId} view={ftView[tab]} caps={caps} approvalLimit={sum.policy.approval_limit} refreshKey={refreshKey} onChanged={changed} />}
            {tab === 'milestones' && <MilestonesDue orgId={orgId} refreshKey={refreshKey} />}
            {tab === 'policy' && <InvoicePolicy orgId={orgId} canEdit={c.can_configure} onSaved={changed} />}

            {tab === 'outstanding' && f.overdue_documents > 0 && (
                <p className="flex items-center gap-2 text-xs text-red-600"><AlertTriangle className="w-4 h-4" /> {f.overdue_documents} payment{f.overdue_documents > 1 ? 's were' : ' was'} aligned with the invoice still missing past the deadline.</p>
            )}

            {openInvoice && <InvoiceReview orgId={orgId} invoiceId={openInvoice} onClose={() => setOpenInvoice(null)} onChanged={changed} />}
        </div>
    );
}
