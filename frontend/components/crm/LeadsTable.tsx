'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Filter, Download, Plus, ChevronDown, MoreHorizontal, Phone, Mail, MapPin, Building, User, Users, Calendar, ArrowUpDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/frontend/context/AuthContext';
import { CRMLead, LeadStatusConfig, LeadSource } from '@/frontend/types/crm';
import { getStageVisual } from '@/frontend/lib/crm/stages';
import { getSourceVisual } from '@/frontend/lib/crm/sourceIcons';
import SourceBadge from '@/frontend/components/crm/SourceBadge';

interface LeadsTableProps {
    onLeadSelect?: (lead: CRMLead) => void;
    onCreateLead?: () => void;
    updatedLead?: CRMLead | null;
    refreshTrigger?: number;
    filters?: {
        status?: string[];
        assigned_to?: string[];
        property_interest?: string[];
    };
}

// Resolve seat count from the real `seats` column, or fall back to the
// [seats=N] token the Meta sync embeds in `requirement` before the column exists.
function seatInfo(lead: any): { count: number | null; bucket: string | null; cleanReq: string | null } {
    let count: number | null = typeof lead.seats === 'number' ? lead.seats : null;
    let cleanReq: string | null = lead.requirement || null;
    if (count == null && lead.requirement) {
        const m = lead.requirement.match(/\[seats=(\d+)/);
        if (m) count = parseInt(m[1]);
    }
    if (cleanReq) cleanReq = cleanReq.replace(/^\[seats=\d+;bucket=[^\]]*\]\s*/, '').trim() || null;
    const bucket = count == null ? null : count < 25 ? '<25' : count <= 50 ? '25–50' : count <= 100 ? '50–100' : '100+';
    return { count, bucket, cleanReq };
}

export default function LeadsTable({ onLeadSelect, onCreateLead, updatedLead, refreshTrigger, filters }: LeadsTableProps) {
    const { user, membership } = useAuth();
    const isBdRep = membership?.org_role === 'bd_rep';
    const [leads, setLeads] = useState<CRMLead[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Sync updated lead from detail drawer in real-time without full table refresh
    useEffect(() => {
        if (!updatedLead) return;
        setLeads(prev => prev.map(l => l.id === updatedLead.id ? { ...l, ...updatedLead } : l));
    }, [updatedLead]);

    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [showFilters, setShowFilters] = useState(false);
    // My Leads (only assigned to me) vs All Leads (everything I can see — my whole
    // market, incl. teammates' leads in the same city). 'all' is the default view.
    const [scope, setScope] = useState<'mine' | 'all'>('all');

    // Staged filters (user picks, then clicks Apply)
    const [stagedFilters, setStagedFilters] = useState<{
        status?: string[];
        campaign?: string[];
        city?: string[];
        lead_source?: string[];
        date_from?: string;
        date_to?: string;
        week?: 'this_week' | 'last_week';
        month?: string;
        seats_range?: string;
    }>({});
    // Applied filters (actually sent to API)
    const [appliedFilters, setAppliedFilters] = useState<typeof stagedFilters>({});

    const [statuses, setStatuses] = useState<LeadStatusConfig[]>([]);
    const [sources, setSources] = useState<LeadSource[]>([]);
    const [campaigns, setCampaigns] = useState<string[]>([]);
    const [reps, setReps] = useState<{ id: string; full_name?: string; name?: string }[]>([]);
    // Bulk reassign (admins only)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [reassigning, setReassigning] = useState(false);
    const [reassignTo, setReassignTo] = useState('');
    const [sortBy, setSortBy] = useState('created_at');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    useEffect(() => {
        fetchLeads();
    }, [page, search, appliedFilters, sortBy, sortOrder, scope, refreshTrigger]);

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchLeads = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                page_size: '20',
                sort_by: sortBy,
                sort_order: sortOrder
            });

            if (search) params.set('search', search);
            // "My Leads" → only leads assigned to me. "All Leads" → my full scope
            // (server-side scopeLeadsQuery already limits this to my market).
            if (scope === 'mine' && user?.id) params.set('assigned_to', user.id);
            if (appliedFilters.status?.length) {
                appliedFilters.status.forEach(s => params.append('status', s));
            }
            if (appliedFilters.campaign?.length) {
                appliedFilters.campaign.forEach(c => params.append('campaign', c));
            }
            if (appliedFilters.city?.length) {
                appliedFilters.city.forEach(c => params.append('city', c));
            }
            if (appliedFilters.lead_source?.length) {
                appliedFilters.lead_source.forEach(s => params.append('lead_source', s));
            }
            if (appliedFilters.date_from) params.set('date_from', appliedFilters.date_from);
            if (appliedFilters.date_to) params.set('date_to', appliedFilters.date_to);
            if (appliedFilters.seats_range) params.set('seats_range', appliedFilters.seats_range);

            // Month filter
            if (appliedFilters.month) {
                const [y, m] = appliedFilters.month.split('-').map(Number);
                const firstDay = new Date(y, m - 1, 1);
                const lastDay = new Date(y, m, 0);
                const yyyy = firstDay.getFullYear();
                const mm = String(firstDay.getMonth() + 1).padStart(2, '0');
                const ddLast = String(lastDay.getDate()).padStart(2, '0');
                params.set('date_from', `${yyyy}-${mm}-01`);
                params.set('date_to', `${yyyy}-${mm}-${ddLast}`);
            }

            // Week quick filter
            if (appliedFilters.week) {
                const now = new Date();
                const dayOfWeek = now.getDay();
                const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
                const monday = new Date(now);
                monday.setDate(now.getDate() + mondayOffset);
                monday.setHours(0, 0, 0, 0);
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6);

                if (appliedFilters.week === 'last_week') {
                    const lastMonday = new Date(monday);
                    lastMonday.setDate(monday.getDate() - 7);
                    const lastSunday = new Date(monday);
                    lastSunday.setDate(monday.getDate() - 1);
                    params.set('date_from', lastMonday.toISOString().split('T')[0]);
                    params.set('date_to', lastSunday.toISOString().split('T')[0]);
                } else {
                    params.set('date_from', monday.toISOString().split('T')[0]);
                    params.set('date_to', sunday.toISOString().split('T')[0]);
                }
            }

            const res = await fetch(`/api/crm/leads?${params}`);
            if (res.ok) {
                const data = await res.json();
                setLeads(data.leads || []);
                setTotalPages(data.pagination?.total_pages || 1);
                setTotalCount(data.pagination?.total || 0);
            }
        } catch (error) {
            console.error('Failed to fetch leads:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchConfigs = async () => {
        try {
            const [settingsRes, campaignsRes] = await Promise.all([
                fetch('/api/crm/settings?type=all&scope=bd'),
                fetch('/api/crm/campaigns'),
            ]);
            if (settingsRes.ok) {
                const data = await settingsRes.json();
                setStatuses(data.statuses || []);
                setSources(data.sources || []);
                setReps(data.users || []);
            }
            if (campaignsRes.ok) {
                const data = await campaignsRes.json();
                setCampaigns((data.campaigns || []).map((c: any) => c.name).filter(Boolean));
            }
        } catch (error) {
            console.error('Failed to fetch configs:', error);
        }
    };

    const handleApplyFilters = () => {
        setAppliedFilters({ ...stagedFilters });
        setPage(1);
    };

    // --- Bulk reassign (admins) ---------------------------------------------
    const toggleSelect = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };
    const toggleSelectAll = () => {
        setSelectedIds(prev => prev.size === leads.length ? new Set() : new Set(leads.map(l => l.id)));
    };
    const handleBulkReassign = async () => {
        if (!selectedIds.size) return;
        const assignee = reassignTo === '__unassign__' ? null : reassignTo || null;
        setReassigning(true);
        try {
            const ids = Array.from(selectedIds);
            await Promise.all(ids.map(id =>
                fetch(`/api/crm/leads/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ assigned_to: assignee }),
                })
            ));
            setSelectedIds(new Set());
            setReassignTo('');
            await fetchLeads();
        } catch (err) {
            console.error('Bulk reassign failed:', err);
        } finally {
            setReassigning(false);
        }
    };

    const handleClearFilters = () => {
        setStagedFilters({});
        setAppliedFilters({});
        setPage(1);
    };

    const hasUnappliedChanges = JSON.stringify(stagedFilters) !== JSON.stringify(appliedFilters);

    const handleSort = (column: string) => {
        if (sortBy === column) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(column);
            setSortOrder('desc');
        }
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0
        }).format(value);
    };

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    const getStatusBadge = (lead: CRMLead) => {
        const statusName = lead.status_info?.name || 'Unknown';
        const v = getStageVisual(statusName);
        const color = lead.status_info?.color || v.color;
        const Icon = v.icon;
        return (
            <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border"
                style={{ backgroundColor: `${color}1A`, color, borderColor: `${color}44` }}
            >
                <Icon className="w-3 h-3" />
                {statusName}
            </span>
        );
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
                {/* Search */}
                <div className="relative flex-1 max-w-sm" data-tour="leads-search">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                        placeholder="Search leads..."
                        className="w-full pl-9 pr-4 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                </div>
                <div className="flex items-center gap-3">
                    {/* My Leads / All Leads scope toggle */}
                    <div className="flex items-center gap-0.5 bg-surface-elevated rounded-xl p-1 border border-border shrink-0">
                        {([['mine', 'My Leads'], ['all', 'All Leads']] as const).map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => { setScope(key); setPage(1); }}
                                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                    scope === key ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
                                }`}
                                title={key === 'mine' ? 'Only leads assigned to me' : 'All leads in my market (incl. teammates’)'}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <button
                        data-tour="leads-filters"
                        onClick={() => setShowFilters(!showFilters)}
                        className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-bold transition-colors ${
                            showFilters ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary hover:bg-surface-elevated'
                        }`}
                    >
                        <Filter className="w-4 h-4" />
                        Filters
                        {Object.values(appliedFilters).some(v => v && (Array.isArray(v) ? v.length > 0 : !!v)) && (
                            <span className="w-2 h-2 bg-primary rounded-full" />
                        )}
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-xl text-sm font-bold text-text-secondary hover:bg-surface-elevated transition-colors opacity-50 cursor-not-allowed" disabled title="Coming soon">
                        <Download className="w-4 h-4" />
                        Export
                    </button>
                    {onCreateLead && (
                        <button
                            data-tour="leads-add"
                            onClick={onCreateLead}
                            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Add Lead
                        </button>
                    )}
                </div>
            </div>

            {/* Filters Panel */}
            <AnimatePresence>
                {showFilters && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="bg-surface-elevated rounded-xl p-4 border border-border space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {/* Status Dropdown */}
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">Status</label>
                                    <select
                                        value={stagedFilters.status?.[0] || ''}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setStagedFilters({ ...stagedFilters, status: val ? [val] : undefined });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="">All Statuses</option>
                                        {statuses.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Source Dropdown */}
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">Source</label>
                                    <select
                                        value={stagedFilters.lead_source?.[0] || ''}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setStagedFilters({ ...stagedFilters, lead_source: val ? [val] : undefined });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="">All Sources</option>
                                        {sources.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Campaign Dropdown */}
                                {campaigns.length > 0 && (
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">Campaign</label>
                                    <select
                                        value={stagedFilters.campaign?.[0] || ''}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setStagedFilters({ ...stagedFilters, campaign: val ? [val] : undefined });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="">All Campaigns</option>
                                        {campaigns.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                                )}

                                {/* City Dropdown */}
                                {!isBdRep && (
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">City</label>
                                    <select
                                        value={stagedFilters.city?.[0] || ''}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setStagedFilters({ ...stagedFilters, city: val ? [val] : undefined });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="">All Cities</option>
                                        {['Mumbai', 'Bangalore', 'Noida'].map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                                )}

                                {/* Seat Count Dropdown */}
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">Seat Count</label>
                                    <select
                                        value={stagedFilters.seats_range || ''}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setStagedFilters({ ...stagedFilters, seats_range: val || undefined });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="">All Seat Ranges</option>
                                        <option value="lt25">&lt; 25</option>
                                        <option value="25to50">25–50</option>
                                        <option value="50to100">50–100</option>
                                        <option value="gt100">100+</option>
                                    </select>
                                </div>

                                {/* Active (Ring) Dropdown */}
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">Active (Ring)</label>
                                    <select
                                        value={(() => {
                                            for (let r = 1; r <= 10; r++) {
                                                const ringStatusIds = statuses.filter(s => s.name.toLowerCase() === `ring ${r}`).map(s => s.id);
                                                if (ringStatusIds.some(id => stagedFilters.status?.includes(id))) return String(r);
                                            }
                                            return '';
                                        })()}
                                        onChange={(e) => {
                                            const r = e.target.value;
                                            if (!r) {
                                                setStagedFilters({ ...stagedFilters, status: undefined });
                                                return;
                                            }
                                            const ringStatusIds = statuses.filter(s => s.name.toLowerCase() === `ring ${r}`).map(s => s.id);
                                            setStagedFilters({ ...stagedFilters, status: ringStatusIds });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="">All Rings</option>
                                        {Array.from({ length: 10 }, (_, i) => i + 1).map(r => (
                                            <option key={r} value={r}>Ring {r}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Week Quick Filter Dropdown */}
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">Timeframe</label>
                                    <select
                                        value={stagedFilters.week || ''}
                                        onChange={(e) => {
                                            const val = e.target.value as 'this_week' | 'last_week' | '';
                                            setStagedFilters({
                                                ...stagedFilters,
                                                week: val || undefined,
                                                date_from: undefined,
                                                date_to: undefined,
                                            });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="">All Time</option>
                                        <option value="this_week">This Week</option>
                                        <option value="last_week">Last Week</option>
                                    </select>
                                </div>

                                {/* Proper Month & Year Selector */}
                                <div>
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide mb-1.5">Month & Year</label>
                                    <input
                                        type="month"
                                        value={stagedFilters.month || ''}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setStagedFilters({
                                                ...stagedFilters,
                                                month: val || undefined,
                                                week: undefined,
                                                date_from: undefined,
                                                date_to: undefined,
                                            });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    />
                                </div>
                                {/* Apply / Clear buttons */}
                                <div className="flex justify-end gap-3 pt-2 border-t border-border">
                                    <button
                                        onClick={handleClearFilters}
                                        className="px-4 py-2 text-xs font-bold text-text-secondary hover:text-text-primary transition-colors"
                                    >
                                        Clear All
                                    </button>
                                    <button
                                        onClick={handleApplyFilters}
                                        className={`flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold transition-colors ${
                                            hasUnappliedChanges
                                                ? 'bg-primary text-white hover:bg-primary/90 shadow-sm'
                                                : 'bg-primary/60 text-white cursor-default'
                                        }`}
                                    >
                                        <Check className="w-3.5 h-3.5" />
                                        Apply Filters
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Bulk reassign bar (admins only) */}
            {!isBdRep && selectedIds.size > 0 && (
                <div className="flex items-center gap-3 mb-3 px-4 py-3 bg-primary/5 border border-primary/20 rounded-xl">
                    <span className="text-sm font-bold text-primary">{selectedIds.size} selected</span>
                    <select
                        value={reassignTo}
                        onChange={(e) => setReassignTo(e.target.value)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    >
                        <option value="">Reassign to…</option>
                        {reps.map((r) => <option key={r.id} value={r.id}>{r.full_name || r.name}</option>)}
                        <option value="__unassign__">— Unassign —</option>
                    </select>
                    <button
                        onClick={handleBulkReassign}
                        disabled={!reassignTo || reassigning}
                        className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-bold disabled:opacity-40 hover:bg-primary/90"
                    >{reassigning ? 'Reassigning…' : 'Apply'}</button>
                    <button onClick={() => setSelectedIds(new Set())} className="text-sm text-text-secondary hover:text-text-primary ml-auto">Clear</button>
                </div>
            )}

            {/* Table */}
            <div className="bg-surface rounded-xl border border-border overflow-hidden" data-tour="leads-table">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-surface-elevated border-b border-border">
                                {!isBdRep && (
                                    <th className="px-3 py-3 w-10">
                                        <input type="checkbox" aria-label="Select all"
                                            checked={leads.length > 0 && selectedIds.size === leads.length}
                                            onChange={toggleSelectAll}
                                            className="rounded border-slate-300" />
                                    </th>
                                )}
                                <th className="text-left px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">Lead</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">Contact</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">Location</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">Assigned To</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">Status</th>
                                <th className="text-center px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">Seats</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">Follow-up</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wide">Created</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {isLoading ? (
                                [...Array(5)].map((_, i) => (
                                    <tr key={i}>
                                        <td colSpan={isBdRep ? 8 : 9} className="px-4 py-4">
                                            <div className="h-8 bg-muted rounded animate-pulse" />
                                        </td>
                                    </tr>
                                ))
                            ) : leads.length === 0 ? (
                                <tr>
                                    <td colSpan={isBdRep ? 8 : 9} className="px-4 py-12 text-center text-text-secondary">
                                        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                                            <Search className="w-8 h-8 text-text-tertiary" />
                                        </div>
                                        <p className="font-medium">No leads found</p>
                                        <p className="text-sm mt-1">Try adjusting your search or filters</p>
                                    </td>
                                </tr>
                            ) : (
                                leads.map((lead) => (
                                    <tr
                                        key={lead.id}
                                        onClick={() => onLeadSelect?.(lead)}
                                        className={`hover:bg-surface-elevated cursor-pointer transition-colors ${selectedIds.has(lead.id) ? 'bg-primary/5' : ''}`}
                                    >
                                        {!isBdRep && (
                                            <td className="px-3 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                                                <input type="checkbox" aria-label="Select lead"
                                                    checked={selectedIds.has(lead.id)}
                                                    onChange={() => {}}
                                                    onClick={(e) => toggleSelect(lead.id, e)}
                                                    className="rounded border-slate-300" />
                                            </td>
                                        )}
                                        <td className="px-4 py-3">
                                            <div>
                                                <p className="font-medium text-text-primary text-sm">
                                                    {lead.company_name || lead.contact_person || 'Unnamed Lead'}
                                                </p>
                                                {lead.company_name && lead.contact_person && (
                                                    <p className="text-xs text-text-secondary">{lead.contact_person}</p>
                                                )}
                                                <SourceBadge
                                                    source={
                                                        (lead as any).source_info?.name
                                                        || ((lead as any).linkedin_lead_id ? 'LinkedIn' : (lead as any).meta_lead_id ? 'Meta' : null)
                                                    }
                                                    className="mt-0.5"
                                                />
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="space-y-1">
                                                {lead.contact_number && (
                                                    <p className="text-sm text-text-primary flex items-center gap-1.5">
                                                        <Phone className="w-3 h-3 text-text-tertiary" />
                                                        {lead.contact_number}
                                                    </p>
                                                )}
                                                {lead.email && (
                                                    <p className="text-xs text-text-secondary flex items-center gap-1.5">
                                                        <Mail className="w-3 h-3 text-text-tertiary" />
                                                        {lead.email}
                                                    </p>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {(lead.location || lead.city) ? (
                                                <p className="text-sm text-text-primary flex items-center gap-1.5">
                                                    <MapPin className="w-3 h-3 text-text-tertiary shrink-0" />
                                                    <span className="truncate">{lead.location || lead.city}</span>
                                                </p>
                                            ) : (
                                                <span className="text-xs text-text-tertiary">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            {lead.assigned_user ? (
                                                <p className="text-sm text-text-primary">{lead.assigned_user.full_name}</p>
                                            ) : (
                                                <span className="text-xs text-text-tertiary">Unassigned</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            {getStatusBadge(lead)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {(() => { const si = seatInfo(lead); return (
                                            <div className="relative group inline-flex items-center gap-1.5 cursor-default">
                                                <Users className="w-4 h-4 text-text-tertiary" />
                                                {si.count != null ? (
                                                    <span className="inline-flex items-center gap-1">
                                                        <span className="font-bold text-text-primary text-sm">{si.count}</span>
                                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{si.bucket}</span>
                                                    </span>
                                                ) : (
                                                    <span className="font-medium text-text-tertiary text-sm">-</span>
                                                )}
                                                {si.cleanReq && (
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 max-w-xs truncate">
                                                        {si.cleanReq}
                                                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                                                    </div>
                                                )}
                                            </div>
                                            ); })()}
                                        </td>
                                        <td className="px-4 py-3">
                                            {lead.next_followup_date ? (
                                                <p className={`text-sm ${
                                                    new Date(lead.next_followup_date) < new Date()
                                                        ? 'text-red-600 font-medium'
                                                        : 'text-text-primary'
                                                }`}>
                                                    {formatDate(lead.next_followup_date)}
                                                </p>
                                            ) : (
                                                <span className="text-xs text-text-tertiary">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="text-sm text-text-secondary">{formatDate(lead.created_at)}</p>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <p className="text-sm text-text-secondary">
                            Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, totalCount)} of {totalCount} leads
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-elevated"
                            >
                                Previous
                            </button>
                            <span className="text-sm text-text-secondary">
                                Page {page} of {totalPages}
                            </span>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-elevated"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
