'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useDataCache } from '@/frontend/context/DataCacheContext';
import { Calendar, Clock, User, CheckCircle2, XCircle, Search, Filter, Loader2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';

interface Booking {
    id: string;
    meeting_room_id: string;
    user_id: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: 'confirmed' | 'cancelled' | 'completed';
    created_at: string;
    comment?: string;
    meeting_room: {
        name: string;
        photo_url: string;
        location: string;
    };
    tenant: {
        full_name: string;
        email: string;
    };
}

interface AdminBookingListProps {
    propertyId: string;
}

const AdminBookingList: React.FC<AdminBookingListProps> = ({ propertyId }) => {
    const { getCachedData, setCachedData, invalidateCache } = useDataCache();
    const cacheKey = `admin-bookings-${propertyId}`;
    const [bookings, setBookings] = useState<Booking[]>(() => getCachedData(cacheKey) || []);
    const [isLoading, setIsLoading] = useState(!getCachedData(cacheKey));
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [dateFilter, setDateFilter] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [isTechnical, setIsTechnical] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    const supabase = createClient();

    useEffect(() => {
        fetchUserInfo();
        fetchBookings();
    }, [propertyId]);

    const fetchUserInfo = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setCurrentUserId(user.id);

        // Check master admin
        const { data: profile } = await supabase.from('users').select('is_master_admin').eq('id', user.id).maybeSingle();
        if (profile?.is_master_admin) {
            setUserRole('master_admin');
            return;
        }

        // Check property role
        const { data: membership } = await supabase
            .from('property_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('property_id', propertyId)
            .eq('is_active', true)
            .maybeSingle();

        if (membership) {
            setUserRole(membership.role.toLowerCase());

            // Check technical skill if staff/mst
            if (membership.role.toLowerCase() === 'staff' || membership.role.toLowerCase() === 'mst') {
                const { data: skill } = await supabase
                    .from('mst_skills')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('skill_code', 'technical')
                    .maybeSingle();
                setIsTechnical(!!skill);
            }
        }
    };

    const fetchBookings = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/meeting-room-bookings?propertyId=${propertyId}`);
            const data = await res.json();
            if (res.ok) {
                const fetchedBookings = data.bookings || [];
                setBookings(fetchedBookings);
                setCachedData(cacheKey, fetchedBookings);
            }
        } catch (error) {
            console.error('Error fetching bookings:', error);
        } finally {
            setIsLoading(false);
        }
    }, [propertyId, cacheKey, setCachedData]);

    useEffect(() => {
        fetchBookings();
    }, [fetchBookings]);

    const [cancellingId, setCancellingId] = useState<string | null>(null);

    const handleCancelBooking = async (id: string) => {
        if (!confirm('Are you sure you want to cancel this booking? Credits will be refunded and the slot will be released.')) return;

        setCancellingId(id);
        try {
            const res = await fetch(`/api/meeting-room-bookings/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'cancelled' })
            });
            if (res.ok) {
                invalidateCache('admin-bookings-');
                invalidateCache('tenant-bookings-');
                invalidateCache('rooms-avail-');
                // Update status in place to keep the cancellation history
                setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'cancelled' } : b));
            } else {
                const error = await res.json();
                alert(error.error || 'Failed to cancel booking');
            }
        } catch (error) {
            console.error('Error cancelling booking:', error);
            alert('An unexpected error occurred');
        } finally {
            setCancellingId(null);
        }
    };

    const canCancel = (bookingUserId: string, bookingStatus: string) => {
        if (bookingStatus !== 'confirmed') return false;
        if (userRole === 'master_admin') return true;
        if (currentUserId === bookingUserId) return true;
        if (userRole === 'property_admin' || userRole === 'org_super_admin' || userRole === 'org_admin') return true;
        if ((userRole === 'staff' || userRole === 'mst') && isTechnical) return true;
        return false;
    };

    const filteredBookings = bookings.filter(booking => {
        const matchesSearch =
            booking.tenant.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            booking.meeting_room.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' || booking.status === statusFilter;
        const matchesDate = !dateFilter || booking.booking_date === dateFilter;
        return matchesSearch && matchesStatus && matchesDate;
    });

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'confirmed': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
            case 'cancelled': return 'bg-rose-50 text-rose-700 border-rose-100';
            case 'completed': return 'bg-slate-50 text-slate-700 border-slate-100';
            default: return 'bg-slate-50 text-slate-700 border-slate-100';
        }
    };

    const formatTime = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    return (
        <div className="space-y-6">
            {/* Search & Filter Bar */}
            <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch md:items-center">
                <div className="flex-1 relative group">
                    <Search className="absolute left-4 md:left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                    <input
                        type="text"
                        placeholder="Search by client or room..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 md:pl-14 pr-4 md:pr-6 py-3.5 md:py-4 bg-white border border-slate-200 rounded-2xl text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-sm outline-none"
                    />
                </div>
                <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                    <div className="flex items-center gap-2 bg-white px-4 py-3.5 md:py-4 rounded-2xl border border-slate-200 shadow-sm shrink-0">
                        <input
                            type="date"
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                            className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer outline-none uppercase tracking-wider"
                        />
                    </div>
                    <div className="flex items-center gap-2 bg-white px-5 py-3.5 md:py-4 rounded-2xl border border-slate-200 shadow-sm overflow-hidden shrink-0">
                        <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-transparent text-xs font-black text-slate-700 focus:outline-none cursor-pointer uppercase tracking-widest w-full appearance-none outline-none pr-2"
                        >
                            <option value="all">ALL STATUS</option>
                            <option value="confirmed">CONFIRMED</option>
                            <option value="cancelled">CANCELLED</option>
                            <option value="completed">COMPLETED</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* List */}
            {isLoading ? (
                <div className="flex flex-col gap-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-24 bg-slate-50 rounded-2xl animate-pulse" />
                    ))}
                </div>
            ) : filteredBookings.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-[2rem] p-12 text-center shadow-sm">
                    <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">No bookings found</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    <AnimatePresence mode="popLayout">
                        {filteredBookings.map((booking) => (
                            <motion.div
                                key={booking.id}
                                layout
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 hover:shadow-md transition-all group/card"
                            >
                                <div className="flex items-center gap-4 md:gap-5 flex-1 min-w-0">
                                    <div className="w-14 h-14 md:w-16 md:h-16 rounded-full overflow-hidden bg-slate-100 shrink-0 border border-slate-200 shadow-sm flex items-center justify-center">
                                        {booking.meeting_room?.photo_url ? (
                                            <img src={booking.meeting_room.photo_url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <Calendar className="w-6 h-6 text-slate-400" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h4 className="text-base md:text-lg font-bold text-slate-900 truncate tracking-tight">{booking.meeting_room?.name || 'Meeting Room'}</h4>
                                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-slate-400 text-[11px] md:text-xs">
                                            <div className="flex items-center gap-1.5 font-medium">
                                                <Calendar className="w-3.5 h-3.5" />
                                                <span>{new Date(booking.booking_date + 'T00:00:00').toLocaleDateString('en-GB')}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 font-medium">
                                                <Clock className="w-3.5 h-3.5" />
                                                <span>{formatTime(booking.start_time)} - {formatTime(booking.end_time)}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-slate-400">
                                                <span className="text-slate-300">•</span>
                                                <span className="font-bold text-[10px] uppercase tracking-wider">
                                                    BOOKED: {new Date(booking.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        </div>
                                        {booking.comment && (
                                            <div className="mt-1.5 text-xs text-slate-500 font-semibold italic uppercase tracking-wide">
                                                {booking.comment}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between md:justify-end gap-6">
                                    <div className="flex flex-col md:items-end gap-1.5">
                                        <div className="flex items-center gap-2">
                                            <User className="w-3.5 h-3.5 text-slate-400" />
                                            <span className="text-xs md:text-sm font-bold text-slate-800">{booking.tenant?.full_name || booking.tenant?.email || 'User'}</span>
                                        </div>
                                        <span className={`px-3.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${getStatusColor(booking.status)}`}>
                                            {booking.status}
                                        </span>
                                    </div>

                                    {canCancel(booking.user_id, booking.status) && (
                                        <button
                                            type="button"
                                            onClick={() => handleCancelBooking(booking.id)}
                                            disabled={cancellingId === booking.id}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs font-bold transition-all border border-rose-100 hover:border-rose-200 cursor-pointer shadow-2xs shrink-0"
                                            title="Cancel Booking"
                                        >
                                            {cancellingId === booking.id ? (
                                                <>
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    <span>Cancelling...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <XCircle className="w-3.5 h-3.5 text-rose-500" />
                                                    <span>Cancel</span>
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
};

export default AdminBookingList;
