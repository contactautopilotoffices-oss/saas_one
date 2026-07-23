'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import TicketCard from '@/frontend/components/shared/TicketCard';
import { Loader2, MapPin, Smartphone, Clock, Filter, X, Download, Search, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/frontend/components/ui/button';
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

export default function GuestRequestsPage(props: any = {}) {
    const { propertyId: propPropertyId } = props;
    const params = useParams();
    const propertyId = propPropertyId || (params?.propertyId as string);
    const supabase = createClient();
    
    const [requests, setRequests] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('ALL');
    const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportStartDate, setExportStartDate] = useState('');
    const [exportEndDate, setExportEndDate] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStartDate, setFilterStartDate] = useState('');
    const [filterEndDate, setFilterEndDate] = useState('');
    const [userRole, setUserRole] = useState<string>('');

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
        let query = supabase
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

    const updateStatus = async (id: string, newStatus: string) => {
        const { data: { user } } = await supabase.auth.getUser();
        const oldStatus = requests.find(r => r.id === id)?.status;

        const { error } = await supabase
            .from('guest_requests')
            .update({ status: newStatus })
            .eq('id', id);
            
        if (!error) {
            if (user && oldStatus !== newStatus) {
                const { data: eventData } = await supabase.from('guest_request_events').insert({
                    guest_request_id: id,
                    user_id: user.id,
                    action: 'STATUS_UPDATE',
                    from_status: oldStatus,
                    to_status: newStatus
                }).select(`
                    id, action, from_status, to_status, created_at,
                    users ( full_name, user_photo_url, email )
                `).single();

                const updatedRequests = requests.map(req => {
                    if (req.id === id) {
                        return {
                            ...req,
                            status: newStatus,
                            guest_request_events: eventData ? [...(req.guest_request_events || []), eventData] : req.guest_request_events
                        };
                    }
                    return req;
                });
                
                setRequests(updatedRequests);
                if (selectedRequest?.id === id) {
                    setSelectedRequest(updatedRequests.find(r => r.id === id));
                }
            } else {
                setRequests(requests.map(req => req.id === id ? { ...req, status: newStatus } : req));
                if (selectedRequest?.id === id) {
                    setSelectedRequest({ ...selectedRequest, status: newStatus });
                }
            }
        } else {
            console.error('Failed to update status', error);
            alert('Failed to update status. Please try again.');
        }
    };

    const getStatusForTicketCard = (status: string) => {
        switch(status) {
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
        ];

        // Header styling
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE2E8F0' }
        };

        filtered.forEach(req => {
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
                ai_category: req.ai_category || ''
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

    const displayRequests = requests.filter(req => {
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
    });

    const isStaffOrMst = userRole === 'STAFF_SOFTSERVICES' || userRole === 'MST';

    return (
        <div className="p-2 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto h-full flex flex-col w-full">
            <div className="flex flex-col gap-3 sm:gap-4 w-full">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">Client Support</h1>
                        <p className="text-sm sm:text-base text-gray-500 mt-1">View and manage issues reported by clients via QR Code.</p>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto overflow-x-auto pb-1 sm:pb-0">
                        {!isStaffOrMst && (
                            <Button 
                                variant="outline" 
                                className="bg-white shrink-0 h-10 w-full sm:w-auto"
                                onClick={() => setShowExportModal(true)}
                            >
                                <Download className="w-4 h-4 mr-2" />
                                Export
                            </Button>
                        )}
                        <div className="flex items-center gap-2 bg-white rounded-lg border p-1 shadow-sm overflow-x-auto no-scrollbar whitespace-nowrap w-full sm:w-auto h-10">
                            <Filter className="w-4 h-4 text-gray-400 ml-2 shrink-0" />
                        {['ALL', 'PENDING', 'IN_PROGRESS', 'RESOLVED'].map((status) => {
                            const count = status === 'ALL' 
                                ? requests.length 
                                : requests.filter(r => r.status === status).length;
                                
                            return (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center gap-2 ${
                                        filterStatus === status 
                                        ? 'bg-blue-50 text-blue-700' 
                                        : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    {status.replace('_', ' ')}
                                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                        filterStatus === status
                                        ? 'bg-blue-200 text-blue-800'
                                        : 'bg-gray-200 text-gray-600'
                                    }`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                        </div>
                    </div>
                </div>

                {/* Filters Row */}
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 w-full">
                    <div className="flex items-center bg-white rounded-lg border border-slate-200 px-3 shadow-sm h-10 flex-1 w-full lg:max-w-md">
                        <Search className="w-4 h-4 text-slate-400 shrink-0" />
                        <input 
                            type="text" 
                            placeholder="Search ticket, name, description..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full text-sm outline-none bg-transparent ml-2 placeholder:text-slate-400"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2 w-full lg:w-auto">
                        <div className="flex items-center bg-white rounded-lg border border-slate-200 px-3 shadow-sm h-10 flex-1 lg:flex-none">
                            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                            <input 
                                type="date" 
                                value={filterStartDate}
                                onChange={(e) => setFilterStartDate(e.target.value)}
                                className="text-sm outline-none bg-transparent ml-2 text-slate-600 w-full lg:w-auto"
                            />
                        </div>
                        <span className="text-slate-400 text-sm font-medium shrink-0">to</span>
                        <div className="flex items-center bg-white rounded-lg border border-slate-200 px-3 shadow-sm h-10 flex-1 lg:flex-none">
                            <input 
                                type="date" 
                                value={filterEndDate}
                                onChange={(e) => setFilterEndDate(e.target.value)}
                                className="text-sm outline-none bg-transparent text-slate-600 w-full lg:w-auto"
                            />
                            {(filterStartDate || filterEndDate) && (
                                <button onClick={() => { setFilterStartDate(''); setFilterEndDate(''); }} className="text-slate-400 hover:text-slate-600 ml-2 shrink-0">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-20 flex-1">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                </div>
            ) : displayRequests.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-xl border border-dashed flex-1 flex flex-col items-center justify-center">
                    <p className="text-gray-500 font-medium">No guest requests found matching your filters.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-6 flex-1 content-start">
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
                            photoUrl={req.photo_urls?.[0] ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/guest-photos/${req.photo_urls[0]}` : undefined}
                            onClick={() => setSelectedRequest(req)}
                        />
                    ))}
                </div>
            )}

            {/* Side Panel for Request Details */}
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
                            initial={{ x: '100%', opacity: 0.5 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: '100%', opacity: 0.5 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="fixed inset-y-0 right-0 w-full md:w-[480px] bg-white shadow-2xl z-[101] flex flex-col border-l border-slate-200"
                        >
                            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white/50 backdrop-blur-md sticky top-0 z-10">
                                <div>
                                    <h2 className="text-lg font-black text-slate-800 tracking-tight">Guest Request Details</h2>
                                    <p className="text-xs font-semibold text-slate-500 font-mono mt-0.5">{selectedRequest.ticket_number || `GR-${selectedRequest.id.substring(0, 6).toUpperCase()}`}</p>
                                </div>
                                <button 
                                    onClick={() => setSelectedRequest(null)}
                                    className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-900"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
                                {/* Header Info */}
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase border ${
                                            selectedRequest.status === 'PENDING' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                            selectedRequest.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                            'bg-emerald-50 text-emerald-600 border-emerald-200'
                                        }`}>
                                            {selectedRequest.status.replace('_', ' ')}
                                        </span>
                                        {selectedRequest.ai_category && (
                                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase bg-purple-50 text-purple-600 border border-purple-200">
                                                AI: {selectedRequest.ai_category}
                                            </span>
                                        )}
                                    </div>
                                    <h3 className="text-2xl font-bold text-slate-900">
                                        {selectedRequest.qr_facility_zones?.zone_name}
                                        {selectedRequest.qr_facility_zones?.floor && <span className="text-slate-400 font-medium ml-2">({selectedRequest.qr_facility_zones.floor})</span>}
                                    </h3>
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mt-2">
                                        <Clock className="w-3.5 h-3.5" />
                                        {format(new Date(selectedRequest.created_at), 'MMM d, yyyy h:mm a')}
                                    </div>
                                </div>

                                {/* Description */}
                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Description</h4>
                                    <p className="text-slate-800 whitespace-pre-wrap text-sm font-medium">
                                        {selectedRequest.description}
                                    </p>
                                </div>

                                {/* Photos */}
                                {selectedRequest.photo_urls && selectedRequest.photo_urls.length > 0 && (
                                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Attached Photos</h4>
                                        <div className="flex flex-wrap gap-3">
                                            {selectedRequest.photo_urls.map((url: string, idx: number) => {
                                                const fullUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/guest-photos/${url}`;
                                                return (
                                                    <a href={fullUrl} target="_blank" rel="noreferrer" key={idx} className="block shrink-0">
                                                        <div className="w-24 h-24 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden hover:ring-2 hover:ring-primary transition-all">
                                                            <img src={fullUrl} alt="Guest attached" className="w-full h-full object-cover" />
                                                        </div>
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Context & Guest Info */}
                                <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                                    <div className="p-4 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
                                        <div>
                                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Guest Info</h4>
                                            <p className="text-sm font-bold text-slate-900">{selectedRequest.guest_name}</p>
                                        </div>
                                        <div className="flex flex-col sm:items-end">
                                            {selectedRequest.guest_phone && <p className="text-sm font-medium text-slate-600">{selectedRequest.guest_phone}</p>}
                                            {selectedRequest.guest_email && <p className="text-xs font-medium text-slate-400">{selectedRequest.guest_email}</p>}
                                        </div>
                                    </div>
                                    
                                    <div className="p-4 flex flex-col sm:flex-row gap-4 sm:items-center justify-between bg-slate-50/50 rounded-b-xl">
                                        <div>
                                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Device</h4>
                                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700" title={selectedRequest.device_info?.userAgent}>
                                                <Smartphone className="w-4 h-4 text-slate-400" />
                                                <span>{getDeviceName(selectedRequest.device_info?.userAgent, selectedRequest.device_info?.platform)}</span>
                                            </div>
                                        </div>
                                        {selectedRequest.location_data?.lat && (
                                            <div>
                                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 sm:text-right">Location</h4>
                                                <div className="flex items-center gap-2 text-sm font-semibold text-primary hover:underline cursor-pointer"
                                                     onClick={() => window.open(`https://maps.google.com/?q=${selectedRequest.location_data.lat},${selectedRequest.location_data.lng}`)}>
                                                    <MapPin className="w-4 h-4 text-primary" />
                                                    <span>View on Map</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Timeline */}
                                {selectedRequest.guest_request_events && selectedRequest.guest_request_events.length > 0 && (
                                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm mt-8">
                                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-6">Request Timeline</h4>
                                        <div className="space-y-0">
                                            {[...selectedRequest.guest_request_events]
                                                .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                                                .map((event: any, idx: number, arr: any[]) => (
                                                <div key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
                                                    {/* Line connecting items */}
                                                    {idx !== arr.length - 1 && (
                                                        <div className="absolute left-4 top-8 bottom-[-16px] w-[2px] bg-slate-100"></div>
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
                                                    <div className="flex-1">
                                                        <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl">
                                                            <p className="text-sm text-slate-700 font-medium">
                                                                <span className="font-bold text-slate-900">{event.users?.full_name || 'A team member'}</span>
                                                                {' '}changed status to{' '}
                                                                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                                                                    event.to_status === 'PENDING' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                                                    event.to_status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                                                                    'bg-emerald-50 text-emerald-600 border-emerald-200'
                                                                }`}>
                                                                    {event.to_status?.replace('_', ' ') || 'UNKNOWN'}
                                                                </span>
                                                            </p>
                                                            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-2 flex items-center gap-1.5">
                                                                <Clock className="w-3 h-3" />
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
                                <div className="p-4 border-t border-slate-100 bg-white flex gap-3">
                                    {selectedRequest.status === 'PENDING' && (
                                        <Button className="w-full font-bold" onClick={() => updateStatus(selectedRequest.id, 'IN_PROGRESS')}>
                                            Mark In Progress
                                        </Button>
                                    )}
                                    {selectedRequest.status === 'IN_PROGRESS' && (
                                        <Button className="w-full font-bold bg-emerald-600 hover:bg-emerald-700" onClick={() => updateStatus(selectedRequest.id, 'RESOLVED')}>
                                            Resolve Issue
                                        </Button>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Export Modal */}
            <AnimatePresence>
                {showExportModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
                        >
                            <div className="flex items-center justify-between p-6 border-b border-slate-100">
                                <h3 className="text-lg font-bold text-slate-800">Export Guest Requests</h3>
                                <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 space-y-5">
                                <p className="text-sm text-slate-500">
                                    Select a date range to export guest requests to an Excel file with all details. Leave blank to export all time.
                                </p>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Start Date</label>
                                    <input 
                                        type="date" 
                                        value={exportStartDate}
                                        onChange={(e) => setExportStartDate(e.target.value)}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-slate-50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">End Date</label>
                                    <input 
                                        type="date" 
                                        value={exportEndDate}
                                        onChange={(e) => setExportEndDate(e.target.value)}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-slate-50"
                                    />
                                </div>
                            </div>
                            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                                <Button variant="outline" className="bg-white" onClick={() => setShowExportModal(false)}>Cancel</Button>
                                <Button onClick={handleExport} className="bg-primary hover:opacity-90 font-bold">
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
