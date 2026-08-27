'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Search, Wallet, RefreshCw } from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { createClient } from '@/frontend/utils/supabase/client';
import { pettyCashCaps, PC_STATUS_META, PettyCashRequest, inr } from '@/frontend/lib/pettyCash/roles';
import NewRequestModal from './NewRequestModal';
import RequestDetailDrawer from './RequestDetailDrawer';

type Tab = 'mine' | 'approvals' | 'disbursements' | 'all';

function StatusBadge({ status }: { status: string }) {
    const m = PC_STATUS_META[status] || { label: status, color: '#6B7280' };
    return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border"
            style={{ backgroundColor: `${m.color}1A`, color: m.color, borderColor: `${m.color}44` }}>
            {m.label}
        </span>
    );
}

export default function PettyCashDashboard() {
    const { membership } = useAuth();
    const params = useParams();
    const orgId = params?.orgId as string | undefined;
    const caps = useMemo(() => pettyCashCaps(membership), [membership]);
    const [supabase] = useState(() => createClient());

    const tabs = useMemo(() => {
        const t: { key: Tab; label: string }[] = [{ key: 'mine', label: 'My Requests' }];
        if (caps.canApprove) t.push({ key: 'approvals', label: 'Approvals' });
        if (caps.canDisburse) t.push({ key: 'disbursements', label: 'Disbursements' });
        if (caps.isAdmin || caps.canDisburse) t.push({ key: 'all', label: 'All / Ledger' });
        return t;
    }, [caps]);

    const [tab, setTab] = useState<Tab>('mine');
    const [requests, setRequests] = useState<PettyCashRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState('');
    const [propertyFilter, setPropertyFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [selected, setSelected] = useState<PettyCashRequest | null>(null);

    const buildQuery = useCallback(() => {
        const p = new URLSearchParams({ tab, page_size: '50' });
        if (search) p.set('search', search);
        if (propertyFilter) p.set('property_id', propertyFilter);
        if (statusFilter) p.append('status', statusFilter);
        return p.toString();
    }, [tab, search, propertyFilter, statusFilter]);

    const fetchRequests = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/petty-cash?${buildQuery()}`);
            if (res.ok) {
                const d = await res.json();
                setRequests(d.requests || []);
                setTotal(d.pagination?.total || 0);
            } else {
                setRequests([]);
                setTotal(0);
            }
        } catch { setRequests([]); }
        finally { setLoading(false); }
    }, [buildQuery]);

    useEffect(() => { fetchRequests(); }, [fetchRequests]);

    // Live updates — refetch on any change to this org's petty cash.
    const fetchRef = useRef(fetchRequests);
    useEffect(() => { fetchRef.current = fetchRequests; });
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!orgId) return;
        const channel = supabase
            .channel(`petty_cash_${orgId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'petty_cash_requests', filter: `organization_id=eq.${orgId}` },
                () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => fetchRef.current(), 400); })
            .subscribe();
        return () => { if (timer.current) clearTimeout(timer.current); supabase.removeChannel(channel); };
    }, [orgId, supabase]);

    const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    if (!caps.canSee) {
        return <div className="text-center py-20 text-text-secondary">Petty Cash isn’t available for your role.</div>;
    }

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                        <Wallet className="w-6 h-6 text-primary" /> Petty Cash
                    </h1>
                    <p className="text-sm text-text-secondary mt-0.5">Request, approve, disburse and settle petty cash — end to end.</p>
                </div>
                <button onClick={() => setShowNew(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors">
                    <Plus className="w-4 h-4" /> New Request
                </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
                {tabs.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                        className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${
                            tab === t.key ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                        {t.label}
                    </button>
                ))}
                <button onClick={fetchRequests} title="Refresh" className="ml-auto p-2 text-text-tertiary hover:text-text-primary">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PC# / purpose / vendor…"
                        className="w-full pl-9 pr-4 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>
                {caps.properties.length > 1 && (
                    <select value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}
                        className="px-3 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                        <option value="">All properties</option>
                        {caps.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                )}
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    className="px-3 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">All statuses</option>
                    {Object.entries(PC_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <span className="text-xs text-text-tertiary ml-auto">{total} request{total === 1 ? '' : 's'}</span>
            </div>

            {/* Table */}
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-surface-elevated border-b border-border text-left">
                                {['Request', 'Requester', 'Property', 'Category', 'Amount', 'Status', 'Raised', ''].map((h, i) => (
                                    <th key={i} className="px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                [...Array(5)].map((_, i) => (
                                    <tr key={i}><td colSpan={8} className="px-4 py-4"><div className="h-8 bg-muted rounded animate-pulse" /></td></tr>
                                ))
                            ) : requests.length === 0 ? (
                                <tr><td colSpan={8} className="px-4 py-16 text-center text-text-secondary">
                                    <Wallet className="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                                    <p className="font-medium">No requests here</p>
                                    <p className="text-sm mt-1">{tab === 'mine' ? 'Raise your first petty cash request.' : 'Nothing pending in this queue.'}</p>
                                </td></tr>
                            ) : (
                                requests.map(r => (
                                    <tr key={r.id} onClick={() => setSelected(r)} className="hover:bg-surface-elevated cursor-pointer transition-colors">
                                        <td className="px-4 py-3">
                                            <p className="font-bold text-text-primary text-sm">{r.request_no}</p>
                                            <p className="text-xs text-text-secondary truncate max-w-[220px]">{r.purpose}</p>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-text-primary">{r.requester?.full_name || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary">{r.property?.name || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-text-secondary">{r.category || '—'}</td>
                                        <td className="px-4 py-3 text-sm font-bold text-text-primary">{inr(r.amount_requested)}</td>
                                        <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                                        <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap">{formatDate(r.created_at)}</td>
                                        <td className="px-4 py-3 text-right"><span className="text-xs font-bold text-primary">Open →</span></td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <NewRequestModal
                open={showNew}
                properties={caps.properties}
                onClose={() => setShowNew(false)}
                onCreated={() => { setShowNew(false); fetchRequests(); }}
            />

            <RequestDetailDrawer
                request={selected}
                caps={caps}
                onClose={() => setSelected(null)}
                onChanged={(updated) => { setSelected(updated); fetchRequests(); }}
            />
        </div>
    );
}
