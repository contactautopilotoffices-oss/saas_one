'use client';

// The "live Google Sheet" — every PO's payment status, visible identically to procurement,
// accounts and super admin at once. Row geometry follows the dense-row convention (12px row
// padding, hairline dividers) and status is signalled with colour on TEXT, not as a card
// fill — docs/design-references/awesome-design-md/binance/DESIGN.md, "price-up-cell /
// price-down-cell ... Never as a card surface."
//
// Realtime: postgres_changes on po_payments + po_activity_log, copied verbatim from the
// pattern in TenantTicketingDashboard.tsx / AccountsDashboard.tsx — a single debounced
// refetch timer so a burst of changes collapses into one request, not a storm.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RefreshCw, IndianRupee, ChevronRight, ShieldAlert, ShieldCheck, ShieldQuestion, Wrench } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { inr, liveStatusMeta } from '@/frontend/lib/accounts/roles';
import { TrackerRow, TrackerResponse, ComplianceStatus } from '@/frontend/lib/accounts/trackerTypes';

const COMPLIANCE_META: Record<ComplianceStatus, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
    verified: { label: 'Verified', cls: 'text-success bg-success/10', Icon: ShieldCheck },
    in_review: { label: 'In review', cls: 'text-info bg-info/10', Icon: ShieldQuestion },
    unverified: { label: 'Unverified', cls: 'text-warning bg-warning/10', Icon: ShieldAlert },
    rejected: { label: 'Rejected', cls: 'text-error bg-error/10', Icon: ShieldAlert },
    expired: { label: 'Expired', cls: 'text-error bg-error/10', Icon: ShieldAlert },
};

interface Props { orgId?: string; }

export default function PaymentTrackerTable({ orgId }: Props) {
    const router = useRouter();
    const [supabase] = useState(() => createClient());

    const [rows, setRows] = useState<TrackerRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [setup, setSetup] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [status, setStatus] = useState('');
    const [vendor, setVendor] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    // po_id -> who just touched it, so a change reads as "Priya aligned this" rather than
    // merely "a row changed". Cleared 5s after arrival.
    const [highlight, setHighlight] = useState<Record<string, { actor: string | null; at: number }>>({});

    const fetchTracker = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            const p = new URLSearchParams({ org_id: orgId });
            if (status) p.set('status', status);
            if (vendor) p.set('vendor', vendor);
            if (dateFrom) p.set('date_from', dateFrom);
            if (dateTo) p.set('date_to', dateTo);
            const res = await fetch(`/api/accounts/tracker?${p}`);
            if (res.status === 404) { setSetup(true); setRows([]); setError(null); return; }
            if (!res.ok) { setError('Could not load the payment tracker.'); setRows([]); return; }
            const d: TrackerResponse = await res.json();
            if (d.provisioned === false) { setSetup(true); setRows([]); setError(null); return; }
            setSetup(false); setError(null);
            setRows(d.rows || []);
        } catch {
            setError('Could not reach the payment tracker service.');
        } finally {
            setLoading(false);
        }
    }, [orgId, status, vendor, dateFrom, dateTo]);

    useEffect(() => { fetchTracker(); }, [fetchTracker]);

    // Realtime — one debounced refetch timer shared across every event, so ten changes in a
    // burst collapse into a single request instead of ten (the anti-storm guard).
    const fetchRef = useRef(fetchTracker);
    useEffect(() => { fetchRef.current = fetchTracker; });
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const markHighlight = useCallback((poId?: string | null, actor?: string | null) => {
        if (!poId) return;
        setHighlight(h => ({ ...h, [poId]: { actor: actor || null, at: Date.now() } }));
        setTimeout(() => setHighlight(h => {
            if (!h[poId]) return h;
            const next = { ...h };
            delete next[poId];
            return next;
        }), 5000);
    }, []);

    useEffect(() => {
        if (!orgId) return;
        const bump = () => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => fetchRef.current(), 400);
        };
        const channel = supabase
            .channel(`po_tracker_${orgId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'po_payments', filter: `organization_id=eq.${orgId}` },
                (payload) => { const row = (payload.new || payload.old) as { po_id?: string } | null; markHighlight(row?.po_id, null); bump(); })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'po_activity_log', filter: `organization_id=eq.${orgId}` },
                (payload) => { const row = payload.new as { po_id?: string; actor_name?: string } | null; markHighlight(row?.po_id, row?.actor_name); bump(); })
            .subscribe();
        return () => { if (timer.current) clearTimeout(timer.current); supabase.removeChannel(channel); };
    }, [orgId, supabase, markHighlight]);

    const visibleRows = useMemo(() => rows, [rows]);

    if (setup) {
        return (
            <div className="bg-surface rounded-xl border border-border p-10 text-center">
                <Wrench className="w-9 h-9 mx-auto mb-3 text-text-tertiary" />
                <p className="font-bold text-text-primary">The live payment sheet isn’t set up yet</p>
                <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">
                    This organisation hasn’t had the payment-tracker compliance migration applied. Once it is, PO, vendor and
                    document status will appear here for everyone at once.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                    <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor / PO#…"
                        className="w-full pl-9 pr-3 py-2 border border-border rounded-xl text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>
                <select value={status} onChange={e => setStatus(e.target.value)}
                    className="px-3 py-2 border border-border rounded-xl text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">All statuses</option>
                    <option value="to_align">To Align</option>
                    <option value="aligned">Aligned</option>
                    <option value="completed">Completed</option>
                </select>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="px-3 py-2 border border-border rounded-xl text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                <span className="text-xs text-text-tertiary">to</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="px-3 py-2 border border-border rounded-xl text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
                <button onClick={fetchTracker} title="Refresh" className="ml-auto p-2 text-text-tertiary hover:text-text-primary">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {error && <p className="text-xs text-error">{error}</p>}

            {/* Sheet. Vertical + horizontal scroll are both contained in this one box — the
                page body itself never scrolls sideways (COMPONENT_CONTRACT Law #1). */}
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
                <div className="overflow-auto max-h-[70vh]">
                    <table className="w-full min-w-[960px]">
                        <thead className="sticky top-0 z-10 bg-surface-elevated">
                            <tr className="border-b border-border text-left">
                                {['PO #', 'Vendor', 'PO Amount', 'Tranches', 'Paid', 'Outstanding', 'Status', 'UTR', 'Compliance', ''].map((h, i) => (
                                    <th key={i} className="px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                [...Array(6)].map((_, i) => <tr key={i}><td colSpan={10} className="px-4 py-3"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>)
                            ) : visibleRows.length === 0 ? (
                                <tr><td colSpan={10} className="px-4 py-16 text-center text-text-secondary">
                                    <IndianRupee className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                                    <p className="font-medium">No purchase orders match this filter.</p>
                                </td></tr>
                            ) : visibleRows.map(row => {
                                const meta = liveStatusMeta(row.status);
                                const cmeta = row.compliance_status ? COMPLIANCE_META[row.compliance_status] : null;
                                const hl = highlight[row.po_id];
                                return (
                                    <tr key={row.po_id} onClick={() => orgId && router.push(`/${orgId}/accounts/po/${row.po_id}`)}
                                        className={`cursor-pointer hover:bg-surface-elevated transition-colors duration-700 ${hl ? 'bg-primary/5' : ''}`}>
                                        <td className="px-4 py-3 text-sm font-bold text-text-primary whitespace-nowrap">
                                            {row.po_number}
                                            {hl && (
                                                <span className="block text-[10px] font-medium text-primary normal-case">
                                                    {hl.actor ? `${hl.actor} just updated this` : 'Just updated'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-text-primary">{row.vendor_name || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-text-primary tabular-nums">{inr(row.po_amount)}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary tabular-nums">{row.tranche_count ?? 0}</td>
                                        <td className="px-4 py-3 text-sm text-text-primary tabular-nums">{inr(row.paid_total)}</td>
                                        <td className="px-4 py-3 text-sm font-bold text-text-primary tabular-nums">{inr(row.outstanding)}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1.5 text-xs font-bold whitespace-nowrap ${meta.text}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs font-mono text-text-secondary whitespace-nowrap">{row.utr_no || '—'}</td>
                                        <td className="px-4 py-3">
                                            {cmeta ? (
                                                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold whitespace-nowrap ${cmeta.cls}`}>
                                                    <cmeta.Icon className="w-3 h-3" /> {cmeta.label}
                                                    {!!row.documents_missing && ` · ${row.documents_missing} missing`}
                                                </span>
                                            ) : <span className="text-xs text-text-tertiary">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right"><ChevronRight className="w-4 h-4 text-text-tertiary" /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
