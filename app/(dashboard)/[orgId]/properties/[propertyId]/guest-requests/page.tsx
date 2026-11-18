'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import TicketCard, { TICKET_GRID_CLASS } from '@/frontend/components/shared/TicketCard';
import {
    Loader2, MapPin, Smartphone, Clock, Filter, X, Download, Search, Calendar,
    SlidersHorizontal, Settings2, AlertCircle, RefreshCw, Inbox,
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/frontend/components/ui/button';
import { useIsDesktop } from '@/frontend/components/task-manager/assign/Sheet';
import TicketFormConfigModal from '@/frontend/components/guest-experience/TicketFormConfigModal';
import { BUILTIN_FIELDS, isBuiltinFieldKey } from '@/frontend/lib/guestTicketForm';
import ExcelJS from 'exceljs';

const getDeviceName = (userAgent?: string, platform?: string) => {
    if (!userAgent && !platform) return 'Mobile Device';
    const ua = userAgent || '';

    // Check for Android device model
    const androidMatch = ua.match(/Android\s+[\d\.]+(?:-[a-zA-Z]+)?;\s+([^)]+)/);
    if (androidMatch && androidMatch[1]) {
        const model = androidMatch[1].split(' Build/')[0];
        return `Android (${model})`;
    }

    // Check for iPhone/iPad OS version
    if (ua.includes('iPhone')) {
        const osMatch = ua.match(/OS\s+(\d+_\d+)/);
        return osMatch ? `iPhone (iOS ${osMatch[1].replace('_', '.')})` : 'iPhone';
    }
    if (ua.includes('iPad')) return 'iPad';

    // Check for Desktop OS
    const winMatch = ua.match(/Windows NT (\d+\.\d+)/);
    if (winMatch) {
        return `Windows PC (Win ${winMatch[1] === '10.0' ? '10/11' : winMatch[1]})`;
    }
    if (ua.includes('Macintosh') || ua.includes('Mac OS X')) return 'Mac OS Device';

    return platform || 'Mobile Device';
};

/** Label for an extra answer stored in `form_data`. */
const extraAnswerLabel = (key: string) =>
    isBuiltinFieldKey(key)
        ? BUILTIN_FIELDS[key].defaultLabel
        : key.replace(/^custom_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const STATUS_PILL: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-600 border-amber-200',
    IN_PROGRESS: 'bg-blue-50 text-blue-600 border-blue-200',
    RESOLVED: 'bg-emerald-50 text-emerald-600 border-emerald-200',
};

export default function GuestRequestsPage(props: any = {}) {
    const { propertyId: propPropertyId } = props;
    const params = useParams();
    const propertyId = propPropertyId || (params?.propertyId as string);
    const supabase = createClient();
    const isDesktop = useIsDesktop();

    const [requests, setRequests] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('ALL');
    const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
    const [showExportModal, setShowExportModal] = useState(false);
    const [showFormConfig, setShowFormConfig] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [exportStartDate, setExportStartDate] = useState('');
    const [exportEndDate, setExportEndDate] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStartDate, setFilterStartDate] = useState('');
    const [filterEndDate, setFilterEndDate] = useState('');
    const [userRole, setUserRole] = useState<string>('');
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    useEffect(() => {
        const fetchRole = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data } = await supabase.from('users').select('system_role').eq('id', user.id).single();
                if (data) setUserRole(data.system_role);
            }
        };
        fetchRole();
    }, []);

    useEffect(() => {
        fetchRequests();
    }, [propertyId]);

    const fetchRequests = async () => {
        setLoading(true);
        const query = supabase
            .from('guest_requests')
            .select(`
                *,
                qr_facility_zones (
                    zone_name,
                    floor
                ),
                guest_request_events (
                    id,
                    action,
                    from_status,
                    to_status,
                    created_at,
                    users (
                        full_name,
                        user_photo_url,
                        email
                    )
                )
            `)
            .eq('property_id', propertyId)
            .order('created_at', { ascending: false });

        const { data, error } = await query;

        if (!error && data) {
            setRequests(data);
        } else {
            console.error('Error fetching guest requests', error);
        }
        setLoading(false);
    };

    /**
     * Move a request between PENDING / IN_PROGRESS / RESOLVED.
     *
     * This goes through the API rather than writing to Supabase from the browser. Production has no
     * INSERT policy on `guest_request_events`, so the timeline write was always rejected, and a
     * PostgREST update that RLS filters out reports no error at all — so a failed "Mark In Progress"
     * looked like it had worked until the page was reloaded. The route uses the service role behind
     * a property guard, and a genuine failure now surfaces here.
     */
    const updateStatus = async (id: string, newStatus: string) => {
        setUpdatingId(id);
        setActionError(null);
        try {
            const res = await fetch(`/api/properties/${propertyId}/guest-requests/${id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Could not update the status. Please try again.');
            }

            const applied = (req: any) => ({
                ...req,
                status: data.status ?? newStatus,
                guest_request_events: data.event
                    ? [...(req.guest_request_events || []), data.event]
                    : req.guest_request_events,
            });

            setRequests(prev => prev.map(req => (req.id === id ? applied(req) : req)));
            setSelectedRequest((prev: any) => (prev?.id === id ? applied(prev) : prev));

            if (data.timelineWarning) setActionError(data.timelineWarning);
        } catch (err: any) {
            console.error('Failed to update status', err);
            setActionError(err.message || 'Could not update the status. Please try again.');
        } finally {
            setUpdatingId(null);
        }
    };

    const getStatusForTicketCard = (status: string) => {
        switch (status) {
            case 'PENDING': return 'OPEN';
            case 'IN_PROGRESS': return 'IN_PROGRESS';
            case 'RESOLVED': return 'COMPLETED';
            default: return 'OPEN';
        }
    };

    const handleExport = async () => {
        // filter requests by date range
        const filtered = requests.filter(req => {
            const reqDate = new Date(req.created_at);
            const start = exportStartDate ? new Date(exportStartDate) : new Date(0);
            const end = exportEndDate ? new Date(exportEndDate) : new Date();
            end.setHours(23, 59, 59, 999);
            return reqDate >= start && reqDate <= end;
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Guest Requests');

        worksheet.columns = [
            { header: 'Ticket Number', key: 'ticket_number', width: 15 },
            { header: 'Date', key: 'date', width: 20 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Zone', key: 'zone', width: 20 },
            { header: 'Floor', key: 'floor', width: 10 },
            { header: 'Guest Name', key: 'guest_name', width: 20 },
            { header: 'Guest Phone', key: 'guest_phone', width: 15 },
            { header: 'Guest Email', key: 'guest_email', width: 25 },
            { header: 'Description', key: 'description', width: 40 },
            { header: 'AI Category', key: 'ai_category', width: 15 },
            { header: 'Other Answers', key: 'form_data', width: 30 },
        ];

        // Header styling
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE2E8F0' }
        };

        filtered.forEach(req => {
            const extras = req.form_data && typeof req.form_data === 'object'
                ? Object.entries(req.form_data).map(([k, v]) => `${extraAnswerLabel(k)}: ${v}`).join('; ')
                : '';
            worksheet.addRow({
                ticket_number: req.ticket_number || `GR-${req.id.substring(0, 6).toUpperCase()}`,
                date: format(new Date(req.created_at), 'yyyy-MM-dd HH:mm'),
                status: req.status,
                zone: req.qr_facility_zones?.zone_name || '',
                floor: req.qr_facility_zones?.floor || '',
                guest_name: req.guest_name || '',
                guest_phone: req.guest_phone || '',
                guest_email: req.guest_email || '',
                description: req.description || '',
                ai_category: req.ai_category || '',
                form_data: extras,
            });
        });

        // Generate Excel file
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Guest_Requests_${format(new Date(), 'yyyyMMdd')}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
        setShowExportModal(false);
    };

    const displayRequests = useMemo(() => requests.filter(req => {
        let matches = true;
        if (filterStatus !== 'ALL' && req.status !== filterStatus) {
            matches = false;
        }
        if (matches && searchQuery) {
            const q = searchQuery.toLowerCase();
            const ticket = req.ticket_number?.toLowerCase() || `gr-${req.id.substring(0, 6).toLowerCase()}`;
            const desc = req.description?.toLowerCase() || '';
            const guestName = req.guest_name?.toLowerCase() || '';
            matches = ticket.includes(q) || desc.includes(q) || guestName.includes(q);
        }
        if (matches && filterStartDate) {
            const reqDate = new Date(req.created_at);
            const start = new Date(filterStartDate);
            start.setHours(0, 0, 0, 0);
            matches = reqDate >= start;
        }
        if (matches && filterEndDate) {
            const reqDate = new Date(req.created_at);
            const end = new Date(filterEndDate);
            end.setHours(23, 59, 59, 999);
            matches = reqDate <= end;
        }
        return matches;
    }), [requests, filterStatus, searchQuery, filterStartDate, filterEndDate]);

    const isStaffOrMst = userRole === 'STAFF_SOFTSERVICES' || userRole === 'MST';
    const activeFilterCount = (searchQuery ? 1 : 0) + (filterStartDate ? 1 : 0) + (filterEndDate ? 1 : 0);

    const clearFilters = () => {
        setSearchQuery('');
        setFilterStartDate('');
        setFilterEndDate('');
    };

    const extraAnswers: [string, string][] = selectedRequest?.form_data && typeof selectedRequest.form_data === 'object'
        ? Object.entries(selectedRequest.form_data as Record<string, string>).filter(([, v]) => !!v)
        : [];

    return (
        <div className="flex flex-col h-full w-full max-w-7xl mx-auto">
            {/* ---------- Header: compact and sticky on phones ---------- */}
            <div className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-md border-b border-slate-200/70 sm:border-0 sm:bg-transparent sm:backdrop-blur-none sm:static px-3 pt-3 pb-2 sm:px-6 sm:pt-6 sm:pb-0 space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-gray-900 truncate">Client Support</h1>
                        <p className="hidden sm:block text-sm sm:text-base text-gray-500 mt-1">
                            View and manage issues reported by clients via QR Code.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {/* Filters toggle — phones only */}
                        <button
                            onClick={() => setShowFilters(v => !v)}
                            className={`sm:hidden relative h-10 w-10 flex items-center justify-center rounded-xl border transition-colors ${
                                showFilters || activeFilterCount > 0
                                    ? 'bg-primary/10 border-primary/30 text-primary'
                                    : 'bg-white border-slate-200 text-slate-500'
                            }`}
                            aria-label="Filters"
                        >
                            <SlidersHorizontal className="w-4 h-4" />
                            {activeFilterCount > 0 && (
                                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-white text-[9px] font-black flex items-center justify-center">
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>

                        {!isStaffOrMst && (
                            <>
                                <Button
                                    variant="outline"
                                    className="bg-white h-10 w-10 p-0 sm:w-auto sm:px-3"
                                    onClick={() => setShowFormConfig(true)}
                                    title="Configure which fields the QR form asks for"
                                >
                                    <Settings2 className="w-4 h-4 sm:mr-2" />
                                    <span className="hidden sm:inline">Form Setup</span>
                                </Button>
                                <Button
                                    variant="outline"
                                    className="bg-white h-10 w-10 p-0 sm:w-auto sm:px-3"
                                    onClick={() => setShowExportModal(true)}
                                    title="Export to Excel"
                                >
                                    <Download className="w-4 h-4 sm:mr-2" />
                                    <span className="hidden sm:inline">Export</span>
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Status tabs — one scrollable row, comfortable tap targets */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0 pb-0.5">
                    <Filter className="hidden sm:block w-4 h-4 text-gray-400 shrink-0 mr-1" />
                    {['ALL', 'PENDING', 'IN_PROGRESS', 'RESOLVED'].map((status) => {
                        const count = status === 'ALL'
                            ? requests.length
                            : requests.filter(r => r.status === status).length;

                        return (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`shrink-0 px-3.5 h-10 text-xs sm:text-sm rounded-xl font-bold transition-colors flex items-center gap-2 border ${
                                    filterStatus === status
                                        ? 'bg-primary/10 border-primary/30 text-primary'
                                        : 'bg-white border-slate-200 text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                {status.replace('_', ' ')}
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                                    filterStatus === status ? 'bg-primary/20 text-primary' : 'bg-gray-100 text-gray-600'
                                }`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Search + date filters: always visible from sm, collapsible on phones */}
                <div className={`${showFilters ? 'grid' : 'hidden'} sm:grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] pb-1`}>
                    <div className="flex items-center bg-white rounded-xl border border-slate-200 px-3 shadow-sm h-11 sm:h-10 min-w-0 sm:max-w-md">
                        <Search className="w-4 h-4 text-slate-400 shrink-0" />
                        <input
                            type="text"
                            placeholder="Search ticket, name, description..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full min-w-0 text-sm outline-none bg-transparent ml-2 placeholder:text-slate-400"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600 p-1 -mr-1">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="flex items-center bg-white rounded-xl border border-slate-200 px-3 shadow-sm h-11 sm:h-10 flex-1 min-w-0">
                            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                            <input
                                type="date"
                                value={filterStartDate}
                                onChange={(e) => setFilterStartDate(e.target.value)}
                                className="text-sm outline-none bg-transparent ml-2 text-slate-600 w-full min-w-0"
                            />
                        </div>
                        <span className="text-slate-400 text-xs font-bold shrink-0">to</span>
                        <div className="flex items-center bg-white rounded-xl border border-slate-200 px-3 shadow-sm h-11 sm:h-10 flex-1 min-w-0">
                            <input
                                type="date"
                                value={filterEndDate}
                                onChange={(e) => setFilterEndDate(e.target.value)}
                                className="text-sm outline-none bg-transparent text-slate-600 w-full min-w-0"
                            />
                        </div>
                        {activeFilterCount > 0 && (
                            <button
                                onClick={clearFilters}
                                className="shrink-0 h-11 sm:h-10 px-3 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-600"
                                aria-label="Clear filters"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ---------- List ---------- */}
            <div className="flex-1 px-3 pt-3 pb-6 sm:px-6 sm:pt-4 min-h-0">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                    </div>
                ) : displayRequests.length === 0 ? (
                    <div className="text-center py-16 sm:py-20 px-6 bg-white rounded-2xl border border-dashed border-slate-200 flex flex-col items-center justify-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400">
                            <Inbox className="w-6 h-6" />
                        </div>
                        <p className="text-gray-500 font-medium text-sm">
                            {requests.length === 0
                                ? 'No client requests have come in for this property yet.'
                                : 'No requests match your filters.'}
                        </p>
                        {requests.length > 0 && activeFilterCount > 0 && (
                            <Button variant="outline" className="bg-white h-10" onClick={clearFilters}>
                                <RefreshCw className="w-4 h-4 mr-2" /> Clear filters
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className={`${TICKET_GRID_CLASS} gap-3 sm:gap-6 content-start`}>
                        {displayRequests.map((req) => (
                            <TicketCard
                                key={req.id}
                                id={req.id}
                                title={req.description || 'No description provided'}
                                description={`${req.qr_facility_zones?.zone_name || 'Unknown Zone'} ${req.qr_facility_zones?.floor ? `(${req.qr_facility_zones.floor})` : ''}`}
                                priority="MEDIUM"
                                status={getStatusForTicketCard(req.status)}
                                ticketNumber={req.ticket_number || `GR-${req.id.substring(0, 6).toUpperCase()}`}
                                createdAt={req.created_at}
                                raisedBy={req.guest_name || 'Guest'}
                                photoUrl={req.photo_urls?.[0] ? `/api/storage/guest-photos/${req.photo_urls[0]}` : undefined}
                                onClick={() => { setActionError(null); setSelectedRequest(req); }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* ---------- Detail: bottom sheet on phones, right drawer from sm ---------- */}
            <AnimatePresence>
                {selectedRequest && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedRequest(null)}
                            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100]"
                        />
                        <motion.div
                            initial={isDesktop ? { x: '100%', opacity: 0.5 } : { y: '100%', opacity: 0.6 }}
                            animate={isDesktop ? { x: 0, opacity: 1 } : { y: 0, opacity: 1 }}
                            exit={isDesktop ? { x: '100%', opacity: 0.5 } : { y: '100%', opacity: 0.6 }}
                            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
                            className="fixed z-[101] bg-white flex flex-col shadow-2xl
                                       inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl
                                       sm:inset-y-0 sm:left-auto sm:right-0 sm:bottom-auto sm:max-h-none sm:h-full
                                       sm:w-[480px] sm:rounded-none sm:border-l sm:border-slate-200"
                        >
                            {/* Sheet header */}
                            <div className="shrink-0 px-5 sm:px-6 pt-3 sm:pt-4 pb-3.5 border-b border-slate-100 bg-white">
                                <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h2 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">Request Details</h2>
                                        <p className="text-xs font-semibold text-slate-500 font-mono mt-0.5 truncate">
                                            {selectedRequest.ticket_number || `GR-${selectedRequest.id.substring(0, 6).toUpperCase()}`}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setSelectedRequest(null)}
                                        className="p-2 -mr-1 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-900 shrink-0"
                                        aria-label="Close"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-4 bg-slate-50">
                                {/* Header Info */}
                                <div>
                                    <div className="flex flex-wrap items-center gap-2 mb-3">
                                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase border ${
                                            STATUS_PILL[selectedRequest.status] || STATUS_PILL.PENDING
                                        }`}>
                                            {selectedRequest.status.replace('_', ' ')}
                                        </span>
                                        {selectedRequest.ai_category && (
                                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase bg-purple-50 text-purple-600 border border-purple-200">
                                                {selectedRequest.ai_category}
                                            </span>
                                        )}
                                    </div>
                                    <h3 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight">
                                        {selectedRequest.qr_facility_zones?.zone_name || 'Unknown Zone'}
                                        {selectedRequest.qr_facility_zones?.floor && (
                                            <span className="text-slate-400 font-medium ml-2">({selectedRequest.qr_facility_zones.floor})</span>
                                        )}
                                    </h3>
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mt-2">
                                        <Clock className="w-3.5 h-3.5 shrink-0" />
                                        {format(new Date(selectedRequest.created_at), 'MMM d, yyyy h:mm a')}
                                    </div>
                                </div>

                                {/* Description */}
                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Description</h4>
                                    <p className="text-slate-800 whitespace-pre-wrap text-sm font-medium break-words">
                                        {selectedRequest.description}
                                    </p>
                                </div>

                                {/* Photos */}
                                {selectedRequest.photo_urls && selectedRequest.photo_urls.length > 0 && (
                                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Attached Photos</h4>
                                        <div className="grid grid-cols-3 gap-2.5">
                                            {selectedRequest.photo_urls.map((url: string, idx: number) => {
                                                const fullUrl = url.startsWith('/api/storage/') ? url : `/api/storage/guest-photos/${url}`;
                                                return (
                                                    <a href={fullUrl} target="_blank" rel="noreferrer" key={idx} className="block">
                                                        <div className="aspect-square rounded-lg bg-slate-100 border border-slate-200 overflow-hidden hover:ring-2 hover:ring-primary transition-all">
                                                            <img src={fullUrl} alt="Guest attached" className="w-full h-full object-cover" />
                                                        </div>
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Answers to the property's own configured fields */}
                                {extraAnswers.length > 0 && (
                                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Form Answers</h4>
                                        <dl className="space-y-2.5">
                                            {extraAnswers.map(([key, value]) => (
                                                <div key={key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                                                    <dt className="text-xs font-bold text-slate-500">{extraAnswerLabel(key)}</dt>
                                                    <dd className="text-sm font-bold text-slate-900 break-words">{value}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </div>
                                )}

                                {/* Context & Guest Info */}
                                <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                                    <div className="p-4 flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center justify-between">
                                        <div className="min-w-0">
                                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Reported By</h4>
                                            <p className="text-sm font-bold text-slate-900 break-words">{selectedRequest.guest_name}</p>
                                        </div>
                                        <div className="flex flex-col sm:items-end min-w-0">
                                            {selectedRequest.guest_phone && <p className="text-sm font-medium text-slate-600 break-words">{selectedRequest.guest_phone}</p>}
                                            {selectedRequest.guest_email && <p className="text-xs font-medium text-slate-400 break-all">{selectedRequest.guest_email}</p>}
                                        </div>
                                    </div>

                                    <div className="p-4 flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center justify-between bg-slate-50/50 rounded-b-xl">
                                        <div className="min-w-0">
                                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Device</h4>
                                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700" title={selectedRequest.device_info?.userAgent}>
                                                <Smartphone className="w-4 h-4 text-slate-400 shrink-0" />
                                                <span className="truncate">{getDeviceName(selectedRequest.device_info?.userAgent, selectedRequest.device_info?.platform)}</span>
                                            </div>
                                        </div>
                                        {selectedRequest.location_data?.lat && (
                                            <div>
                                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 sm:text-right">Location</h4>
                                                <button
                                                    type="button"
                                                    className="flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                                                    onClick={() => window.open(`https://maps.google.com/?q=${selectedRequest.location_data.lat},${selectedRequest.location_data.lng}`)}
                                                >
                                                    <MapPin className="w-4 h-4 text-primary shrink-0" />
                                                    <span>View on Map</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Timeline */}
                                {selectedRequest.guest_request_events && selectedRequest.guest_request_events.length > 0 && (
                                    <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-5">Request Timeline</h4>
                                        <div className="space-y-0">
                                            {[...selectedRequest.guest_request_events]
                                                .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                                                .map((event: any, idx: number, arr: any[]) => (
                                                    <div key={event.id} className="relative flex gap-3 sm:gap-4 pb-5 last:pb-0">
                                                        {/* Line connecting items */}
                                                        {idx !== arr.length - 1 && (
                                                            <div className="absolute left-4 top-8 bottom-[-12px] w-[2px] bg-slate-100"></div>
                                                        )}

                                                        {/* Avatar */}
                                                        <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex-shrink-0 flex items-center justify-center overflow-hidden z-10 relative mt-1 shadow-sm">
                                                            {event.users?.user_photo_url ? (
                                                                <img src={event.users.user_photo_url} alt={event.users.full_name || 'User'} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <span className="text-[10px] font-black text-slate-400 uppercase">{event.users?.full_name?.[0] || 'U'}</span>
                                                            )}
                                                        </div>

                                                        {/* Content */}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl">
                                                                <p className="text-sm text-slate-700 font-medium">
                                                                    <span className="font-bold text-slate-900">{event.users?.full_name || 'A team member'}</span>
                                                                    {' '}changed status to{' '}
                                                                    <span className={`inline-block text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                                                                        STATUS_PILL[event.to_status] || 'bg-slate-50 text-slate-600 border-slate-200'
                                                                    }`}>
                                                                        {event.to_status?.replace('_', ' ') || 'UNKNOWN'}
                                                                    </span>
                                                                </p>
                                                                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-2 flex items-center gap-1.5">
                                                                    <Clock className="w-3 h-3 shrink-0" />
                                                                    {format(new Date(event.created_at), 'MMM d, yyyy h:mm a')}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Action Footer */}
                            {(selectedRequest.status === 'PENDING' || selectedRequest.status === 'IN_PROGRESS') && (
                                <div className="shrink-0 px-4 sm:px-5 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] border-t border-slate-100 bg-white space-y-2.5">
                                    {actionError && (
                                        <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2.5 rounded-xl flex gap-2 items-start text-xs font-bold">
                                            <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                                            <span>{actionError}</span>
                                        </div>
                                    )}
                                    {selectedRequest.status === 'PENDING' && (
                                        <Button
                                            className="w-full h-12 font-bold text-sm"
                                            disabled={updatingId === selectedRequest.id}
                                            onClick={() => updateStatus(selectedRequest.id, 'IN_PROGRESS')}
                                        >
                                            {updatingId === selectedRequest.id
                                                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating...</>
                                                : 'Mark In Progress'}
                                        </Button>
                                    )}
                                    {selectedRequest.status === 'IN_PROGRESS' && (
                                        <Button
                                            className="w-full h-12 font-bold text-sm bg-emerald-600 hover:bg-emerald-700"
                                            disabled={updatingId === selectedRequest.id}
                                            onClick={() => updateStatus(selectedRequest.id, 'RESOLVED')}
                                        >
                                            {updatingId === selectedRequest.id
                                                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating...</>
                                                : 'Resolve Issue'}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* ---------- Form Setup ---------- */}
            <AnimatePresence>
                {showFormConfig && (
                    <TicketFormConfigModal
                        propertyId={propertyId}
                        onClose={() => setShowFormConfig(false)}
                    />
                )}
            </AnimatePresence>

            {/* ---------- Export Modal ---------- */}
            <AnimatePresence>
                {showExportModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-end sm:items-center sm:justify-center sm:p-4"
                        onClick={() => setShowExportModal(false)}
                    >
                        <motion.div
                            initial={{ y: '100%', opacity: 0.6 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: '100%', opacity: 0.6 }}
                            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden"
                        >
                            <div className="px-5 sm:px-6 pt-3 sm:pt-5 pb-4 border-b border-slate-100">
                                <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-lg font-bold text-slate-800">Export Requests</h3>
                                    <button
                                        onClick={() => setShowExportModal(false)}
                                        className="text-slate-400 hover:text-slate-600 p-2 -mr-1 rounded-full hover:bg-slate-100 transition-colors"
                                        aria-label="Close"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                            <div className="px-5 sm:px-6 py-5 space-y-4">
                                <p className="text-sm text-slate-500">
                                    Select a date range to export to Excel. Leave blank to export all time.
                                </p>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Start Date</label>
                                    <input
                                        type="date"
                                        value={exportStartDate}
                                        onChange={(e) => setExportStartDate(e.target.value)}
                                        className="w-full px-4 h-11 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-slate-50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">End Date</label>
                                    <input
                                        type="date"
                                        value={exportEndDate}
                                        onChange={(e) => setExportEndDate(e.target.value)}
                                        className="w-full px-4 h-11 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-slate-50"
                                    />
                                </div>
                            </div>
                            <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-2.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
                                <Button variant="outline" className="bg-white h-11 flex-1 sm:flex-none" onClick={() => setShowExportModal(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={handleExport} className="h-11 flex-1 font-bold">
                                    <Download className="w-4 h-4 mr-2" />
                                    Download Excel
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
