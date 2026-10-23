'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { api, ErrorLine } from './invoiceUi';
import PoInvoiceStatus from './PoInvoiceStatus';
import InvoiceQueue, { type QueueView } from './InvoiceQueue';
import InvoiceReview from './InvoiceReview';
import FastTrack, { type FastTrackView } from './FastTrack';
import InvoicePolicy from './InvoicePolicy';
import MilestonesDue from './MilestonesDue';
import PoDrawer from '../accounts/PoDrawer';

/**
 * Invoice Control: one screen, the same for Procurement, Accounts and super admins.
 * Tabs that need a capability (accept, decide, configure) appear only for those who have it;
 * what each person can DO comes from /api/invoices/summary and is enforced again by every route.
 */

interface Summary {
    caps: { can_generate_link: boolean; can_raise_fast_track: boolean; can_resolve_soft: boolean; can_resolve_blocking: boolean; can_accept: boolean; can_decide: boolean; can_decide_above_limit: boolean; can_align: boolean; can_configure: boolean };
    policy: { approval_limit: number; link_expiry_hours?: number };
    invoices: { needs_review: number; mismatched: number; matched_awaiting_accounts: number; processing: number };
    fast_track: { pending_approval: { count: number; value: number }; approved_to_align: { count: number; value: number }; aligned_invoice_pending: { count: number; value: number }; overdue_documents: number };
}

type TabKey = 'milestones' | 'po-status' | 'review' | 'ready' | 'fast-track' | 'to-align' | 'outstanding' | 'exceptions' | 'all-invoices' | 'policy';

export default function InvoiceControl({ orgId }: { orgId: string; mode?: 'procurement' | 'accounts' }) {
    const [sum, setSum] = useState<Summary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<TabKey>('po-status');
    // A bell notification links here with ?invoice=<id>: open that invoice straight away.
    const searchParams = useSearchParams();
    const linkedInvoice = searchParams?.get('invoice') ?? null;
    const [openInvoice, setOpenInvoice] = useState<string | null>(() => (linkedInvoice && /^[0-9a-f-]{36}$/i.test(linkedInvoice) ? linkedInvoice : null));
    const [openPo, setOpenPo] = useState<string | null>(null);
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
        const list: { key: TabKey; label: string; badge?: number }[] = [
            { key: 'po-status', label: 'PO invoice status' },
            { key: 'review', label: 'Review queue', badge: i.needs_review + i.mismatched },
        ];
        if (c.can_accept) list.push({ key: 'ready', label: 'Ready to reconcile', badge: i.matched_awaiting_accounts });
        list.push(
            { key: 'milestones', label: 'Milestones due' },
            { key: 'fast-track', label: 'Fast-track requests' },
            { key: 'outstanding', label: 'Outstanding documents', badge: f.aligned_invoice_pending.count },
        );
        if (c.can_align && f.approved_to_align.count > 0) list.push({ key: 'to-align', label: 'To align', badge: f.approved_to_align.count });
        list.push({ key: 'all-invoices', label: 'All invoices' });
        if (c.can_decide) list.push({ key: 'exceptions', label: 'Exception review', badge: f.pending_approval.count });
        if (c.can_configure) list.push({ key: 'policy', label: 'Policy' });
        return list;
    }, [sum]);

    if (error) return <div className="p-6"><ErrorLine message={error} /></div>;
    if (!sum) return <div className="py-16 text-center text-sm text-text-tertiary">Loading Invoice Control…</div>;

    const c = sum.caps;
    const caps = { can_raise_fast_track: c.can_raise_fast_track, can_decide: c.can_decide, can_decide_above_limit: c.can_decide_above_limit, can_align: c.can_align, can_accept: c.can_accept };
    const queueView: Record<string, QueueView> = { review: 'review', ready: 'ready', 'all-invoices': 'all' };
    const ftView: Record<string, FastTrackView> = { 'fast-track': 'all', 'to-align': 'to_align', outstanding: 'invoice_pending', exceptions: 'pending' };

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-xl font-bold text-text-primary flex items-center gap-2"><FileCheck2 className="w-5 h-5 text-primary" /> Invoice Control</h2>
                <p className="text-sm text-text-secondary mt-0.5">Collect each vendor invoice once, check it against the PO, and keep payment approval separate from invoice verification.</p>
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

            {tab === 'po-status' && <PoInvoiceStatus orgId={orgId} canGenerate={c.can_generate_link} canUploadInternal={c.can_resolve_soft} canSimulate={c.can_configure} canResend={c.can_configure || c.can_generate_link} onOpenInvoice={setOpenInvoice} onOpenPo={setOpenPo} onChanged={changed} refreshKey={refreshKey} linkExpiryHours={sum.policy.link_expiry_hours ?? 72} />}
            {queueView[tab] && <InvoiceQueue key={tab} orgId={orgId} view={queueView[tab]} refreshKey={refreshKey} onOpen={setOpenInvoice} />}
            {ftView[tab] && <FastTrack key={tab} orgId={orgId} view={ftView[tab]} caps={caps} approvalLimit={sum.policy.approval_limit} refreshKey={refreshKey} onChanged={changed} />}
            {tab === 'milestones' && <MilestonesDue orgId={orgId} refreshKey={refreshKey} />}
            {tab === 'policy' && <InvoicePolicy orgId={orgId} canEdit={c.can_configure} onSaved={changed} />}


            {openInvoice && <InvoiceReview orgId={orgId} invoiceId={openInvoice} onClose={() => setOpenInvoice(null)} onChanged={changed} />}
            {openPo && <PoDrawer orgId={orgId} poId={openPo} onClose={() => { setOpenPo(null); changed(); }} />}
        </div>
    );
}
