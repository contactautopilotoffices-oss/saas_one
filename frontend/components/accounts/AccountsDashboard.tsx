'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Search, RefreshCw, Plus, RefreshCcwDot, FileText, IndianRupee, Settings2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { createClient } from '@/frontend/utils/supabase/client';
import {
    accountsCaps, payStatusMeta, statusPillStyle, CRITICAL_META, inr,
    PurchaseOrder, PoPayment, PoWorkflowState,
} from '@/frontend/lib/accounts/roles';
import AlignPaymentModal from './AlignPaymentModal';
import MarkPaidModal from './MarkPaidModal';
import AddPoModal from './AddPoModal';
import ZohoConfigModal from './ZohoConfigModal';
import ElectricityPaymentQueue from './ElectricityPaymentQueue';
import PaymentTrackerTable from './PaymentTrackerTable';

type Tab = 'to_align' | 'aligned' | 'completed' | 'electricity-payments' | 'live_sheet';

const PAGE_SIZE = 50;

export default function AccountsDashboard() {
    const { membership } = useAuth();
    const params = useParams();
    const orgId = params?.orgId as string | undefined;
    const caps = useMemo(() => accountsCaps(membership), [membership]);
    const [supabase] = useState(() => createClient());

    const [tab, setTab] = useState<Tab>('to_align');
    const [pos, setPos] = useState<PurchaseOrder[]>([]);
    const [payments, setPayments] = useState<PoPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState('');
    const [dept, setDept] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);
    const [criticalOnly, setCriticalOnly] = useState(false);
    const [flagMsg, setFlagMsg] = useState<string | null>(null);
    const [page, setPage] = useState(1);

    // Per-PO workflow state (critical flag / SPOC), keyed by po_id. Loaded over the
    // service-role API and kept live by the realtime channel below.
    const [workflow, setWorkflow] = useState<Record<string, PoWorkflowState>>({});
    const [flagBusy, setFlagBusy] = useState<Record<string, boolean>>({});

    const [alignPo, setAlignPo] = useState<PurchaseOrder | null>(null);
    const [payPayment, setPayPayment] = useState<PoPayment | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [showZoho, setShowZoho] = useState(false);

    const fetchData = useCallback(async () => {
        // The electricity queue and the live sheet each own their own fetch cycle; the
        // PO/payment endpoints below know nothing about either.
        if (tab === 'electricity-payments' || tab === 'live_sheet') { setLoading(false); return; }
        setLoading(true);
        try {
            if (tab === 'to_align') {
                const p = new URLSearchParams({ tab: 'to_align', page: String(page), page_size: String(PAGE_SIZE) });
                if (search) p.set('search', search);
                if (dept) p.set('department', dept);
                // Criticality is filtered and ranked in SQL. Doing it client-side only ever
                // reordered the page already in hand, so a PO flagged critical at position
                // ~300 of a 5k queue was unreachable — which defeats the flag entirely.
                if (criticalOnly) p.set('critical_only', 'true');
                const res = await fetch(`/api/accounts/pos?${p}`);
                const d = res.ok ? await res.json() : { pos: [], pagination: {} };
                setPos(d.pos || []); setTotal(d.pagination?.total || 0);
            } else {
                const p = new URLSearchParams({ status: tab, page: String(page), page_size: String(PAGE_SIZE) });
                if (search) p.set('search', search);
                const res = await fetch(`/api/accounts/payments?${p}`);
                const d = res.ok ? await res.json() : { payments: [], pagination: {} };
                setPayments(d.payments || []); setTotal(d.pagination?.total || 0);
            }
        } catch { setPos([]); setPayments([]); }
        finally { setLoading(false); }
    }, [tab, search, dept, criticalOnly, page]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Any filter change invalidates the current page number.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setPage(1); }, [tab, search, dept, criticalOnly]);

    // Workflow flags come from the service role, NOT from a browser read of
    // po_workflow_state. RLS and resolveAccountsAccess do not grant the same set — a
    // master_admin needs no membership row (access.ts:91) and accounts roles may live on
    // property_memberships (access.ts:82,85) — so the direct read returned an empty map
    // with no error for exactly those users.
    const loadWorkflow = useCallback(async () => {
        try {
            const p = new URLSearchParams();
            if (orgId) p.set('org_id', orgId);
            const res = await fetch(`/api/accounts/pos/workflow?${p}`);
            if (!res.ok) { setFlagMsg('Could not load critical flags for this organisation.'); return; }
            const d = await res.json();
            setWorkflow(Object.fromEntries(((d.workflow || []) as PoWorkflowState[]).map(r => [r.po_id, r])));
            setFlagMsg(null);
        } catch {
            setFlagMsg('Could not load critical flags for this organisation.');
        }
    }, [orgId]);

    useEffect(() => { loadWorkflow(); }, [loadWorkflow]);

    // The Finance overview above deep-links into a specific tab, both as a shareable
    // ?tab=&focus= URL (which survives a reload) and as an event (which is instant).
    const searchParams = useSearchParams();
    useEffect(() => {
        const t = searchParams.get('tab');
        if (t === 'to_align' || t === 'aligned' || t === 'completed' || t === 'electricity-payments' || t === 'live_sheet') setTab(t);
        const f = searchParams.get('focus');
        if (f) setSearch(f);
    }, [searchParams]);

    useEffect(() => {
        const onSetTab = (e: Event) => {
            const detail = (e as CustomEvent).detail || {};
            const next = detail.tab;
            if (next === 'to_align' || next === 'aligned' || next === 'completed') setTab(next);
            if (detail.focus) setSearch(String(detail.focus));
        };
        window.addEventListener('accounts:set-tab', onSetTab);
        return () => window.removeEventListener('accounts:set-tab', onSetTab);
    }, []);

    // Realtime — refetch on any PO / payment change in this org; workflow rows are small
    // enough to merge straight from the payload so a critical flip lands instantly.
    const fetchRef = useRef(fetchData);
    useEffect(() => { fetchRef.current = fetchData; });
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!orgId) return;
        const bump = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => fetchRef.current(), 400); };
        const mergeWorkflow = (payload: { eventType: string; new: Record<string, any>; old: Record<string, any> }) => {
            const raw = payload.eventType === 'DELETE' ? payload.old : payload.new;
            const row = raw as unknown as PoWorkflowState | undefined;
            if (!row?.po_id) return;
            setWorkflow(w => {
                const next = { ...w };
                if (payload.eventType === 'DELETE') delete next[row.po_id];
                else next[row.po_id] = row;
                return next;
            });
        };
        // Deliberately NOT subscribed to zoho_purchase_orders: the 2-hourly Zoho sync
        // upserts all ~5k rows and that table is REPLICA IDENTITY FULL, so every open tab
        // would receive ~5k multi-KB payloads (each carrying the whole `raw` Zoho object)
        // in one burst — enough to rate-limit the socket and take the critical-flag feed
        // down with it. New POs already arrive via the Sync and Add/Import handlers, which
        // both call fetchData(). FinanceOverview.tsx:120 avoids the same subscription.
        const channel = supabase
            .channel(`accounts_${orgId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'po_payments', filter: `organization_id=eq.${orgId}` }, bump)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'po_workflow_state', filter: `organization_id=eq.${orgId}` }, mergeWorkflow)
            .subscribe();
        return () => { if (timer.current) clearTimeout(timer.current); supabase.removeChannel(channel); };
    }, [orgId, supabase]);

    const canFlag = caps.canAlign || caps.isAdmin;

    // Optimistic flip, then reconcile with the row the API returns (it owns raised_by/at).
    const toggleCritical = async (poId: string, next: boolean) => {
        if (flagBusy[poId]) return;
        const prev = workflow[poId];
        setFlagBusy(b => ({ ...b, [poId]: true }));
        setWorkflow(w => ({ ...w, [poId]: { ...(prev || { po_id: poId }), po_id: poId, is_critical: next } }));
        try {
            const res = await fetch(`/api/accounts/pos/${poId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_critical: next, ...(orgId ? { organization_id: orgId } : {}) }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'Failed');
            setWorkflow(w => ({ ...w, [poId]: d.workflow as PoWorkflowState }));
            setFlagMsg(null);
        } catch (e) {
            setWorkflow(w => {
                const revert = { ...w };
                if (prev) revert[poId] = prev; else delete revert[poId];
                return revert;
            });
            setFlagMsg(e instanceof Error ? e.message : 'Could not update the critical flag');
        } finally {
            setFlagBusy(b => ({ ...b, [poId]: false }));
        }
    };

    // The workflow map is the live source (realtime merges into it); the row's own
    // is_critical, computed by the po_alignment_queue view, covers the window before
    // loadWorkflow resolves.
    const isCritical = (poId?: string | null, row?: { is_critical?: boolean }) =>
        poId && workflow[poId] ? !!workflow[poId].is_critical : !!row?.is_critical;

    // Filtering and critical-first ordering are done in SQL by the queue view, so the
    // page the server returned is already the right page — do not re-slice it here.
    const visiblePos = pos;

    const runSync = async () => {
        setSyncing(true); setSyncMsg(null);
        try {
            const res = await fetch('/api/accounts/pos/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            const d = await res.json();
            setSyncMsg(d.error ? `Sync: ${d.error}` : `Synced ${d.synced} POs from Zoho.`);
            fetchData();
        } catch { setSyncMsg('Sync failed'); }
        finally { setSyncing(false); }
    };

    const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

    if (!caps.canSee) return <div className="text-center py-20 text-text-secondary">The Payment Tracker isn’t available for your role.</div>;

    const tabs: { key: Tab; label: string }[] = [
        { key: 'live_sheet', label: 'Live Sheet · All POs' },
        { key: 'to_align', label: 'To Align · Procurement' },
        { key: 'aligned', label: 'Aligned · With Accounts' },
        { key: 'completed', label: 'Completed' },
        { key: 'electricity-payments', label: 'Electricity' },
    ];

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                        <IndianRupee className="w-6 h-6 text-primary" /> Payment Tracker
                    </h1>
                    <p className="text-sm text-text-secondary mt-0.5">Align PO payments, disburse, and track UTRs — live.</p>
                </div>
                {caps.canAlign && (
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowZoho(true)} title="Zoho Books connection"
                            className="flex items-center gap-2 px-3 py-2.5 border border-border rounded-xl text-sm font-bold text-text-secondary hover:bg-surface-elevated">
                            <Settings2 className="w-4 h-4" /> Zoho
                        </button>
                        <button onClick={runSync} disabled={syncing}
                            className="flex items-center gap-2 px-3.5 py-2.5 border border-border rounded-xl text-sm font-bold text-text-secondary hover:bg-surface-elevated disabled:opacity-50">
                            <RefreshCcwDot className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> Sync Zoho
                        </button>
                        <button onClick={() => setShowAdd(true)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90">
                            <Plus className="w-4 h-4" /> Add / Import PO
                        </button>
                    </div>
                )}
            </div>
            {syncMsg && <p className="text-xs text-text-tertiary -mt-3">{syncMsg}</p>}
            {flagMsg && <p className="text-xs -mt-3" style={{ color: CRITICAL_META.color }}>{flagMsg}</p>}

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
                {tabs.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${
                            tab === t.key ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: payStatusMeta(t.key).color }} />
                        {t.label}
                    </button>
                ))}
                <button onClick={fetchData} title="Refresh" className="ml-auto p-2 text-text-tertiary hover:text-text-primary">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Filters — the live sheet has its own filter row (status/vendor/date range). */}
            {tab !== 'electricity-payments' && tab !== 'live_sheet' && (
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[220px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO# / vendor / UTR…"
                        className="w-full pl-9 pr-4 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>
                {tab === 'to_align' && (
                    <select value={dept} onChange={e => setDept(e.target.value)}
                        className="px-3 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                        <option value="">All departments</option>
                        <option value="Capex">Capex</option>
                        <option value="Opex">Opex</option>
                    </select>
                )}
                {tab === 'to_align' && (
                    <button onClick={() => setCriticalOnly(v => !v)}
                        className={`flex items-center gap-1.5 px-3 py-2.5 border rounded-xl text-sm font-bold transition-colors ${
                            criticalOnly ? '' : 'border-border text-text-secondary hover:bg-surface-elevated'}`}
                        style={criticalOnly ? statusPillStyle(CRITICAL_META) : undefined}>
                        <AlertTriangle className="w-4 h-4" /> Critical only
                    </button>
                )}
                <span className="text-xs text-text-tertiary ml-auto">
                    {total > 0
                        ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}${criticalOnly && tab === 'to_align' ? ' critical' : ''}`
                        : '0 rows'}
                </span>
            </div>
            )}

            {/* The live shared sheet — every PO's payment status, identical for procurement,
                accounts and super admin, updating in place as anyone touches a row. */}
            {tab === 'live_sheet' && <PaymentTrackerTable orgId={orgId} />}

            {/* Electricity payment queue (deep-linkable via ?tab=electricity-payments) */}
            {tab === 'electricity-payments' && (
                <ElectricityPaymentQueue orgId={orgId} canMarkPaid={caps.canComplete} />
            )}

            {/* Table */}
            {tab !== 'electricity-payments' && tab !== 'live_sheet' && (
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-surface-elevated border-b border-border text-left">
                                {(tab === 'to_align'
                                    ? ['PO #', 'Vendor', 'Site', 'Dept', 'PO Amount', 'Pending', 'Status', '']
                                    : tab === 'aligned'
                                    ? ['PO #', 'Vendor', 'Tranche', 'Req. Amount', 'GST Hold', 'Term', 'Aligned by', 'Status', '']
                                    : ['PO #', 'Vendor', 'Paid', 'Payment Date', 'UTR', 'Proof', 'Status']
                                ).map((h, i) => <th key={i} className="px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">{h}</th>)}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                [...Array(5)].map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-4"><div className="h-8 bg-muted rounded animate-pulse" /></td></tr>)
                            ) : tab === 'to_align' ? (
                                visiblePos.length === 0 ? <EmptyRow msg={criticalOnly ? 'No critical POs right now.' : 'No POs pending alignment.'} /> : visiblePos.map(po => (
                                    <tr key={po.id} className="hover:bg-surface-elevated transition-colors" style={criticalRowStyle(isCritical(po.id, po as any))}>
                                        <td className="px-4 py-3 font-bold text-text-primary text-sm">{po.po_number}</td>
                                        <td className="px-4 py-3 text-sm text-text-primary">{po.vendor_name || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary">{po.project_name || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary">{po.department || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-text-primary">{inr(po.po_amount)}</td>
                                        <td className="px-4 py-3 text-sm font-bold text-amber-600">{inr(po.pending_amount)}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <StatusBadge status="to_align" />
                                                {isCritical(po.id, po as any) && <CriticalBadge state={workflow[po.id]} />}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                {canFlag && (
                                                    <CriticalToggle
                                                        active={isCritical(po.id, po as any)} busy={!!flagBusy[po.id]} state={workflow[po.id]}
                                                        onToggle={() => toggleCritical(po.id, !isCritical(po.id, po as any))}
                                                    />
                                                )}
                                                {caps.canAlign && <button onClick={() => setAlignPo(po)} className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90">Align ▸</button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : tab === 'aligned' ? (
                                payments.length === 0 ? <EmptyRow msg="Nothing awaiting payment." /> : payments.map(p => (
                                    <tr key={p.id} className="hover:bg-surface-elevated transition-colors" style={criticalRowStyle(isCritical(p.po_id))}>
                                        <td className="px-4 py-3 font-bold text-text-primary text-sm">{p.po_number}</td>
                                        <td className="px-4 py-3 text-sm text-text-primary">{p.vendor_name || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary">#{p.tranche_no}</td>
                                        <td className="px-4 py-3 text-sm font-bold text-text-primary">{inr(p.requested_amount)}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary">{inr(p.gst_hold)}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary">{p.payment_term || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary">{p.aligner?.full_name || '—'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <StatusBadge status={p.status} />
                                                {isCritical(p.po_id) && <CriticalBadge state={workflow[p.po_id]} />}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {caps.canComplete && <button onClick={() => setPayPayment(p)} className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90">Mark paid ▸</button>}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                payments.length === 0 ? <EmptyRow msg="No completed payments yet." /> : payments.map(p => (
                                    <tr key={p.id} className="hover:bg-surface-elevated transition-colors">
                                        <td className="px-4 py-3 font-bold text-text-primary text-sm">{p.po_number}</td>
                                        <td className="px-4 py-3 text-sm text-text-primary">{p.vendor_name || '—'}</td>
                                        <td className="px-4 py-3 text-sm font-bold text-text-primary">{inr(p.paid_amount)}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap">{fmtDate(p.payment_date)}</td>
                                        <td className="px-4 py-3 text-xs font-mono text-text-secondary">{p.utr_no || '—'}</td>
                                        <td className="px-4 py-3">
                                            {p.payment_proof_url
                                                ? <a href={p.payment_proof_url} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 text-xs font-bold"><FileText className="w-3.5 h-3.5" /> View</a>
                                                : <span className="text-xs text-text-tertiary">—</span>}
                                        </td>
                                        <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* A 5k-row queue needs real paging: without it a critical PO deep in the
                    backlog is reachable only through the Critical-only filter. */}
                {!loading && total > PAGE_SIZE && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-surface-elevated">
                        <span className="text-xs text-text-tertiary tabular-nums">
                            Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                        </span>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                                className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg text-xs font-bold text-text-secondary hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed">
                                <ChevronLeft className="w-3.5 h-3.5" /> Prev
                            </button>
                            <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / PAGE_SIZE)}
                                className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg text-xs font-bold text-text-secondary hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed">
                                Next <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
            )}

            {alignPo && <AlignPaymentModal po={alignPo} onClose={() => setAlignPo(null)} onDone={() => { setAlignPo(null); fetchData(); }} />}
            {payPayment && <MarkPaidModal payment={payPayment} onClose={() => setPayPayment(null)} onDone={() => { setPayPayment(null); fetchData(); }} />}
            {showAdd && <AddPoModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); fetchData(); }} />}
            {showZoho && <ZohoConfigModal orgId={orgId} onClose={() => setShowZoho(false)} onSynced={fetchData} />}
        </div>
    );
}

// Colour-coded status pill — To Align orange, Aligned yellow, Completed green.
// Tinted background with a solid dot so the state reads at a glance without relying
// on colour alone. Palette lives in frontend/lib/accounts/roles.ts.
function StatusBadge({ status }: { status?: string | null }) {
    const meta = payStatusMeta(status);
    const { color, backgroundColor } = statusPillStyle(meta);
    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap"
            style={{ color, backgroundColor }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
            {meta.label}
        </span>
    );
}

// Criticality is a separate axis from status: red, triangle icon, never a dot — so it
// can never be confused with the orange/yellow/green status pill sitting next to it.
function CriticalBadge({ state }: { state?: PoWorkflowState }) {
    return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap"
            style={statusPillStyle(CRITICAL_META)}
            title={state?.critical_reason ? `Critical — ${state.critical_reason}` : 'Marked critical — needs alignment ASAP'}>
            <AlertTriangle className="w-3 h-3" /> {CRITICAL_META.label}
        </span>
    );
}

function CriticalToggle({ active, busy, state, onToggle }: { active: boolean; busy: boolean; state?: PoWorkflowState; onToggle: () => void }) {
    return (
        <button onClick={onToggle} disabled={busy} aria-pressed={active}
            title={active
                ? `Critical${state?.critical_reason ? ` — ${state.critical_reason}` : ''} · click to clear`
                : 'Mark critical — needs alignment ASAP'}
            className={`p-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                active ? '' : 'border-border text-text-tertiary hover:text-text-primary hover:bg-surface-elevated'}`}
            style={active ? statusPillStyle(CRITICAL_META) : undefined}>
            <AlertTriangle className="w-3.5 h-3.5" />
        </button>
    );
}

// Inset left bar — a shape cue for critical rows that survives the hover background.
function criticalRowStyle(critical: boolean): React.CSSProperties | undefined {
    return critical ? { boxShadow: `inset 3px 0 0 0 ${CRITICAL_META.color}` } : undefined;
}

function EmptyRow({ msg }: { msg: string }) {
    return <tr><td colSpan={9} className="px-4 py-16 text-center text-text-secondary">
        <IndianRupee className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
        <p className="font-medium">{msg}</p>
    </td></tr>;
}
