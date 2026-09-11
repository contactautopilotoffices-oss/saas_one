'use client';

import React, { useState, useEffect, useRef, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import {
    Ticket, Users, Settings, Kanban, Plus, RefreshCw, UserCheck, ShieldCheck,
    FileText, CheckCircle2, AlertTriangle, HelpCircle, Lock, Building2,
    Filter, LayoutGrid, Table, Search, ArrowUpRight, Clock, User, BarChart3,
    ChevronDown, Check, X
} from 'lucide-react';

import TicketCreateModal from '@/frontend/components/hr/TicketCreateModal';
import HRTicketDetailModal from '@/frontend/components/hr/HRTicketDetailModal';
import HRKanbanBoard from '@/frontend/components/hr/HRKanbanBoard';
import HREmployeeDirectory from '@/frontend/components/hr/HREmployeeDirectory';
import HRReconciliationDashboard from '@/frontend/components/hr/HRReconciliationDashboard';
import HRAdminConfigPanel from '@/frontend/components/hr/HRAdminConfigPanel';
import HRAnalyticsDashboard from '@/frontend/components/hr/HRAnalyticsDashboard';
import SLALiveTimer from '@/frontend/components/hr/SLALiveTimer';

export default function HRTicketsPage({ params }: { params: Promise<{ orgId: string }> }) {
    const { orgId } = use(params);
    const { user, membership } = useAuth();
    const searchParams = useSearchParams();

    const [activeTab, setActiveTab] = useState<'tickets' | 'directory' | 'reconciliation' | 'config' | 'analytics'>('tickets');
    const [viewMode, setViewMode] = useState<'kanban' | 'table' | 'properties'>('kanban');

    const [tickets, setTickets] = useState<any[]>([]);
    const [properties, setProperties] = useState<any[]>([]);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string>('all');
    const [scopeFilter, setScopeFilter] = useState<'all' | 'my_raised' | 'assigned_to_me'>('all');
    const [ticketTypeFilter, setTicketTypeFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [loading, setLoading] = useState(true);

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

    // Searchable Property Dropdown state
    const [isPropertyDropdownOpen, setIsPropertyDropdownOpen] = useState(false);
    const [propertySearchQuery, setPropertySearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsPropertyDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const userRole = user?.user_metadata?.role || membership?.org_role || 'employee';
    const isHrAdmin = userRole === 'hr' || userRole === 'hr_head' || userRole === 'org_super_admin' || userRole === 'director';
    const isManager = userRole === 'manager' || userRole === 'soft_service_manager';

    // Handle URL search params on mount & propertyId sync from top header
    useEffect(() => {
        const tabParam = searchParams.get('tab');
        const actionParam = searchParams.get('action');
        const propertyParam = searchParams.get('propertyId');
        const filterParam = searchParams.get('filter');

        if (tabParam && ['tickets', 'directory', 'reconciliation', 'config', 'analytics'].includes(tabParam)) {
            setActiveTab(tabParam as any);
        }
        if (actionParam === 'create') {
            setIsCreateOpen(true);
        }
        if (filterParam && ['all', 'my_raised', 'assigned_to_me'].includes(filterParam)) {
            setScopeFilter(filterParam as any);
        }
        setSelectedPropertyId(propertyParam || 'all');
    }, [searchParams]);

    useEffect(() => {
        fetchProperties();
    }, [orgId]);

    useEffect(() => {
        fetchTickets();
    }, [orgId, user?.id, selectedPropertyId]);

    // Real-time automatic background data refresh (every 10s & on window focus)
    useEffect(() => {
        const interval = setInterval(() => {
            fetchTickets();
        }, 10000);

        const handleFocus = () => fetchTickets();
        window.addEventListener('focus', handleFocus);

        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
        };
    }, [orgId, user?.id, selectedPropertyId]);

    const fetchProperties = async () => {
        try {
            let res = await fetch(`/api/properties?organizationId=${orgId}`);
            let text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            let propsList: any[] = [];

            if (Array.isArray(data)) {
                propsList = data;
            } else if (Array.isArray(data?.data)) {
                propsList = data.data;
            } else if (Array.isArray(data?.properties)) {
                propsList = data.properties;
            }

            // Defensive fallback to organization admin properties route if primary list is empty
            if (propsList.length === 0) {
                const adminRes = await fetch(`/api/admin/organizations/${orgId}/properties`);
                if (adminRes.ok) {
                    const adminText = await adminRes.text();
                    let adminData: any = {};
                    try { adminData = adminText ? JSON.parse(adminText) : {}; } catch {}
                    if (Array.isArray(adminData)) {
                        propsList = adminData;
                    } else if (Array.isArray(adminData?.properties)) {
                        propsList = adminData.properties;
                    }
                }
            }

            setProperties(propsList);
        } catch (err) {
            console.error('Error fetching properties:', err);
        }
    };

    const fetchTickets = async () => {
        setLoading(true);
        try {
            const url = new URL('/api/hr/tickets', window.location.origin);
            url.searchParams.append('orgId', orgId);
            if (user?.id) url.searchParams.append('userId', user.id);
            url.searchParams.append('role', userRole);
            if (selectedPropertyId !== 'all') {
                url.searchParams.append('propertyId', selectedPropertyId);
            }

            const res = await fetch(url.toString());
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                setTickets(data.data || []);
            }
        } catch (err) {
            console.error('Error fetching tickets:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateStatus = async (ticketId: string, newStatus: string) => {
        try {
            const res = await fetch(`/api/hr/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: newStatus,
                    actor_user_id: user?.id
                })
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}
            if (data.success) {
                fetchTickets();
            }
        } catch (err) {
            console.error('Error updating status:', err);
        }
    };

    // Filter tickets based on UI search, scope, type, and status filters
    const filteredTickets = tickets.filter(t => {
        if (scopeFilter === 'my_raised' && t.raised_by_user_id !== user?.id) return false;
        if (scopeFilter === 'assigned_to_me' && t.assigned_to_user_id !== user?.id) return false;
        if (ticketTypeFilter !== 'all' && t.ticket_type !== ticketTypeFilter) return false;
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const subjectMatch = (t.subject || '').toLowerCase().includes(q);
            const numMatch = (t.ticket_number || '').toLowerCase().includes(q);
            const nameMatch = (t.employee_snapshot?.name || '').toLowerCase().includes(q);
            if (!subjectMatch && !numMatch && !nameMatch) return false;
        }
        return true;
    });

    const filteredPropertiesList = properties.filter(p =>
        (p.name || '').toLowerCase().includes(propertySearchQuery.toLowerCase())
    );

    // KPI Counters calculation
    const totalCount = tickets.length;
    const openGrievancesCount = tickets.filter(t => t.ticket_type === 'grievance' && ['new', 'assigned', 'in_progress', 'awaiting_manager_response'].includes(t.status)).length;
    const hrQueriesCount = tickets.filter(t => t.ticket_type === 'hr_query').length;
    const confidentialCount = tickets.filter(t => t.is_confidential || t.is_anonymous).length;
    const overdueCount = tickets.filter(t => t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status)).length;

    return (
        <div className="space-y-6 pb-12">
            {/* Header Action Toolbar (Compact with Searchable Property Selector) */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-1">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
                            <ShieldCheck className="w-5 h-5" />
                        </div>
                        <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                            {isHrAdmin ? 'HR Helpdesk & Grievances' : isManager ? 'Team Grievance Requests' : 'My Requests & Grievances'}
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-2.5">
                    <button
                        onClick={() => setIsCreateOpen(true)}
                        className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#587e85] hover:bg-[#48686e] text-white rounded-2xl text-xs font-bold shadow-md shadow-[#587e85]/20 transition-all active:scale-95"
                    >
                        <Plus className="w-4 h-4" />
                        Raise HR Request / Grievance
                    </button>
                </div>
            </div>

            {/* Dashboard Counts (KPI Stat Cards shown ONLY for Tickets tab) */}
            {activeTab === 'tickets' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                    {/* Total HR Requests */}
                    <div
                        onClick={() => { setActiveTab('tickets'); setScopeFilter('all'); setTicketTypeFilter('all'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Requests</span>
                            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                                <Ticket className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="text-2xl font-black text-slate-900 dark:text-white mt-2">{totalCount}</div>
                        <div className="text-[10px] text-slate-400 font-medium mt-0.5">Across selected properties</div>
                    </div>

                    {/* Workplace Grievances */}
                    <div
                        onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('grievance'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-amber-200/80 dark:border-amber-900/40 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Grievances</span>
                            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform">
                                <ShieldCheck className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-2">{openGrievancesCount}</div>
                        <div className="text-[10px] text-amber-500/80 font-semibold mt-0.5">Assigned L1 Manager / L2 HR</div>
                    </div>

                    {/* HR Queries */}
                    <div
                        onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('hr_query'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-blue-200/80 dark:border-blue-900/40 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">HR Queries</span>
                            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                                <HelpCircle className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-2">{hrQueriesCount}</div>
                        <div className="text-[10px] text-blue-500/80 font-medium mt-0.5">Direct HR Support</div>
                    </div>

                    {/* Confidential & Anonymous */}
                    <div
                        onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('confidential_feedback'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-purple-200/80 dark:border-purple-900/40 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Confidential</span>
                            <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
                                <Lock className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-2">{confidentialCount}</div>
                        <div className="text-[10px] text-purple-500/80 font-medium mt-0.5">Director / Masked</div>
                    </div>

                    {/* Overdue SLA */}
                    <div
                        onClick={() => { setActiveTab('tickets'); setTicketTypeFilter('all'); setStatusFilter('all'); }}
                        className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-red-200/80 dark:border-red-900/40 shadow-sm hover:shadow-md transition-all cursor-pointer group col-span-2 sm:col-span-1"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">Overdue SLA</span>
                            <div className="p-2 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 group-hover:scale-110 transition-transform">
                                <AlertTriangle className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="text-2xl font-black text-red-600 dark:text-red-400 mt-2">{overdueCount}</div>
                        <div className="text-[10px] text-red-500/80 font-medium mt-0.5">Requires Escalation</div>
                    </div>
                </div>
            )}

            {/* Content Area */}
            <div>
                {activeTab === 'tickets' && (
                    <div className="space-y-4">
                        {/* Scope Filter Bar (All / My Raised / Assigned to Me) */}
                        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                                <button
                                    type="button"
                                    onClick={() => setScopeFilter('all')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                        scopeFilter === 'all'
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                >
                                    <Ticket className="w-3.5 h-3.5" />
                                    <span>All Viewable Requests ({tickets.length})</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setScopeFilter('my_raised')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                        scopeFilter === 'my_raised'
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                >
                                    <User className="w-3.5 h-3.5" />
                                    <span>My Raised Requests ({tickets.filter(t => t.raised_by_user_id === user?.id).length})</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setScopeFilter('assigned_to_me')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                        scopeFilter === 'assigned_to_me'
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                >
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    <span>Assigned to Me / Actionables ({tickets.filter(t => t.assigned_to_user_id === user?.id).length})</span>
                                </button>
                            </div>

                            {/* View Mode Toggles (Kanban / Table / Property) */}
                            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/80 shrink-0">
                                <button
                                    onClick={() => setViewMode('kanban')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                        viewMode === 'kanban'
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                    title="Kanban Board View"
                                >
                                    <Kanban className="w-3.5 h-3.5" />
                                    <span>Kanban</span>
                                </button>

                                <button
                                    onClick={() => setViewMode('table')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                        viewMode === 'table'
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                    title="Table View"
                                >
                                    <FileText className="w-3.5 h-3.5" />
                                    <span>Table View</span>
                                </button>

                                <button
                                    onClick={() => setViewMode('properties')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                        viewMode === 'properties'
                                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                    title="Property Breakdown View"
                                >
                                    <Building2 className="w-3.5 h-3.5" />
                                    <span>Property Wise</span>
                                </button>
                            </div>
                        </div>

                        {/* Search & Filter Bar */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-white dark:bg-slate-900 p-3 sm:p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                            <div className="relative flex-1">
                                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by ticket #, employee, subject..."
                                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>

                            <select
                                value={ticketTypeFilter}
                                onChange={(e) => setTicketTypeFilter(e.target.value)}
                                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                            >
                                <option value="all">All Request Types</option>
                                <option value="grievance">Employee Grievance (L1 Manager)</option>
                                <option value="hr_query">HR-Related Query (Direct HR)</option>
                                <option value="confidential_feedback">Confidential Feedback (Director)</option>
                                <option value="anonymous_feedback">Anonymous Feedback (Identity Masked)</option>
                            </select>

                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                            >
                                <option value="all">All Statuses</option>
                                <option value="new">New</option>
                                <option value="assigned">Assigned</option>
                                <option value="in_progress">In Progress</option>
                                <option value="awaiting_employee_response">Awaiting Employee Response</option>
                                <option value="awaiting_manager_response">Awaiting Manager Response</option>
                                <option value="awaiting_hr_response">Awaiting HR Response</option>
                                <option value="awaiting_internal_approval">Awaiting Internal Approval</option>
                                <option value="awaiting_external_party">Awaiting External Party</option>
                                <option value="escalated">Escalated</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                                <option value="reopened">Reopened</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                        </div>

                        {/* View 1: Kanban Board */}
                        {viewMode === 'kanban' && (
                            <HRKanbanBoard
                                tickets={filteredTickets}
                                onSelectTicket={(id) => setSelectedTicketId(id)}
                                onUpdateStatus={handleUpdateStatus}
                            />
                        )}

                        {/* View 2: Table View */}
                        {viewMode === 'table' && (
                            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                                                <th className="p-3.5 pl-4">Request ID</th>
                                                <th className="p-3.5">Submitted By</th>
                                                <th className="p-3.5">Category</th>
                                                <th className="p-3.5">Subject</th>
                                                <th className="p-3.5">Current Level & Owner</th>
                                                <th className="p-3.5">Expected Resolution</th>
                                                <th className="p-3.5">Status</th>
                                                <th className="p-3.5 pr-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                                            {filteredTickets.length === 0 ? (
                                                <tr>
                                                    <td colSpan={8} className="p-8 text-center text-slate-400 text-xs">
                                                        No HR requests or grievances match your filters.
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredTickets.map((t) => {
                                                    const isOverdue = t.sla_due_at && new Date(t.sla_due_at) < new Date() && !['resolved', 'closed'].includes(t.status);
                                                    return (
                                                        <tr key={t.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                                            <td className="p-3.5 pl-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                                                {t.ticket_number}
                                                            </td>
                                                            <td className="p-3.5">
                                                                {t.is_anonymous ? (
                                                                    <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-600 text-[11px] font-bold">
                                                                        Anonymous
                                                                    </span>
                                                                ) : (
                                                                    <div>
                                                                        <div className="font-bold text-slate-900 dark:text-white">
                                                                            {t.employee_snapshot?.name || t.raised_by?.raw_user_meta_data?.full_name || 'Staff Employee'}
                                                                        </div>
                                                                        <div className="text-[10px] text-slate-400">
                                                                            {t.employee_snapshot?.department || 'Operations'} ({t.employee_snapshot?.location || 'Main Site'})
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="p-3.5">
                                                                <span className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px]">
                                                                    {t.category?.category_name || t.ticket_type}
                                                                </span>
                                                            </td>
                                                            <td className="p-3.5 max-w-xs truncate text-slate-800 dark:text-slate-200">
                                                                {t.subject}
                                                            </td>
                                                            <td className="p-3.5">
                                                                <span className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-bold text-[10px]">
                                                                    Level {t.current_level || 1}: {t.assigned_to?.raw_user_meta_data?.full_name || t.assigned_to?.email || 'Assigned Owner'}
                                                                </span>
                                                            </td>
                                                            <td className="p-3.5">
                                                                <SLALiveTimer slaDueAt={t.sla_due_at} status={t.status} />
                                                            </td>
                                                            <td className="p-3.5">
                                                                <select
                                                                    value={t.status}
                                                                    onChange={(e) => handleUpdateStatus(t.id, e.target.value)}
                                                                    className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px] font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer"
                                                                >
                                                                    <option value="new">New</option>
                                                                    <option value="assigned">Assigned</option>
                                                                    <option value="in_progress">In Progress</option>
                                                                    <option value="awaiting_employee_response">Awaiting Employee Response</option>
                                                                    <option value="awaiting_manager_response">Awaiting Manager Response</option>
                                                                    <option value="awaiting_hr_response">Awaiting HR Response</option>
                                                                    <option value="awaiting_internal_approval">Awaiting Internal Approval</option>
                                                                    <option value="awaiting_external_party">Awaiting External Party</option>
                                                                    <option value="escalated">Escalated</option>
                                                                    <option value="resolved">Resolved</option>
                                                                    <option value="closed">Closed</option>
                                                                    <option value="reopened">Reopened</option>
                                                                    <option value="cancelled">Cancelled</option>
                                                                </select>
                                                            </td>
                                                            <td className="p-3.5 pr-4 text-right">
                                                                <button
                                                                    onClick={() => setSelectedTicketId(t.id)}
                                                                    className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-600 dark:text-indigo-400 rounded-xl font-bold text-[11px] inline-flex items-center gap-1"
                                                                >
                                                                    View Details
                                                                    <ArrowUpRight className="w-3.5 h-3.5" />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* View 3: Property Wise Breakdown Cards */}
                        {viewMode === 'properties' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {properties.map((p) => {
                                    const propTickets = tickets.filter(t => t.employee_snapshot?.location === p.name || t.employee_snapshot?.property_id === p.id);
                                    const openGriev = propTickets.filter(t => t.ticket_type === 'grievance' && t.status !== 'resolved' && t.status !== 'closed').length;
                                    const openQuery = propTickets.filter(t => t.ticket_type === 'hr_query' && t.status !== 'resolved' && t.status !== 'closed').length;

                                    return (
                                        <div key={p.id} className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                                                <div className="flex items-center gap-2">
                                                    <Building2 className="w-5 h-5 text-indigo-600" />
                                                    <h3 className="font-bold text-slate-900 dark:text-white text-sm">{p.name}</h3>
                                                </div>
                                                <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full text-xs font-bold">
                                                    {propTickets.length} Total
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200/60 dark:border-amber-900/40">
                                                    <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400">Open Grievances</div>
                                                    <div className="text-xl font-black text-amber-700 dark:text-amber-300 mt-1">{openGriev}</div>
                                                </div>

                                                <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200/60 dark:border-blue-900/40">
                                                    <div className="text-[10px] font-bold text-blue-700 dark:text-blue-400">Pending Queries</div>
                                                    <div className="text-xl font-black text-blue-700 dark:text-blue-300 mt-1">{openQuery}</div>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => { setSelectedPropertyId(p.id); setViewMode('table'); }}
                                                className="w-full py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold text-xs transition-colors"
                                            >
                                                Filter Property Tickets
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Tab 2: Directory */}
                {isHrAdmin && activeTab === 'directory' && (
                    <HREmployeeDirectory onRefresh={fetchTickets} />
                )}

                {/* Tab 3: Identity Reconciliation */}
                {isHrAdmin && activeTab === 'reconciliation' && (
                    <HRReconciliationDashboard onRefresh={fetchTickets} />
                )}

                {/* Tab 4: Admin Config & SLAs */}
                {isHrAdmin && activeTab === 'config' && (
                    <HRAdminConfigPanel orgId={orgId} />
                )}

                {/* Tab 5: MIS & Analytics */}
                {isHrAdmin && activeTab === 'analytics' && (
                    <HRAnalyticsDashboard orgId={orgId} tickets={tickets} />
                )}
            </div>

            {/* Modals */}
            <TicketCreateModal
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                onSuccess={fetchTickets}
                orgId={orgId}
                userId={user?.id || ''}
            />

            <HRTicketDetailModal
                isOpen={Boolean(selectedTicketId)}
                ticketId={selectedTicketId}
                onClose={() => setSelectedTicketId(null)}
                onRefresh={fetchTickets}
                currentUserId={user?.id || ''}
                currentUserRole={userRole}
            />
        </div>
    );
}
