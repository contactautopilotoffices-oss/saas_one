'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDataCache } from '@/frontend/context/DataCacheContext';
import { 
    Calendar, Clock, User, CheckCircle2, XCircle, Search, Filter, 
    Loader2, ChevronLeft, ChevronRight, LayoutGrid, ListFilter, 
    Plus, Users, MapPin, Info, X, AlertCircle, Phone, Mail
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';

interface Room {
    id: string;
    name: string;
    photo_url: string;
    location: string;
    capacity: number;
    amenities?: string[];
    status?: string;
}

interface Booking {
    id: string;
    meeting_room_id: string;
    property_id?: string;
    user_id: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: 'confirmed' | 'cancelled' | 'completed';
    created_at: string;
    comment?: string;
    attendee_email?: string;
    meeting_room: {
        name: string;
        photo_url: string;
        location: string;
    };
    tenant: {
        full_name: string;
        email: string;
        phone?: string;
    };
}

interface AdminBookingListProps {
    propertyId: string;
}

const DAY_START_HOUR = 8; // 08:00 AM
const DAY_END_HOUR = 20;   // 08:00 PM
const TOTAL_DAY_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60; // 720 minutes

const AdminBookingList: React.FC<AdminBookingListProps> = ({ propertyId }) => {
    const { getCachedData, setCachedData, invalidateCache } = useDataCache();
    const bookingsCacheKey = `admin-bookings-${propertyId}`;
    const roomsCacheKey = `rooms-${propertyId}`;

    const [bookings, setBookings] = useState<Booking[]>(() => getCachedData(bookingsCacheKey) || []);
    const [rooms, setRooms] = useState<Room[]>(() => getCachedData(roomsCacheKey) || []);
    const [isLoading, setIsLoading] = useState(!getCachedData(bookingsCacheKey));
    
    // View mode: 'timeline' (Option 1) vs 'list'
    const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');

    // Date state
    const todayStr = useMemo(() => {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }, []);

    const [selectedDate, setSelectedDate] = useState<string>(todayStr);

    // Filters
    const [selectedRoomId, setSelectedRoomId] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    // Permissions & User
    const [userRole, setUserRole] = useState<string | null>(null);
    const [isTechnical, setIsTechnical] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    // Modals
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const [activeBookingDetail, setActiveBookingDetail] = useState<Booking | null>(null);
    const [quickBookTarget, setQuickBookTarget] = useState<{ room: Room; start: string; end: string } | null>(null);
    const [quickBookComment, setQuickBookComment] = useState('');
    const [quickBookGuestEmail, setQuickBookGuestEmail] = useState('');
    const [isSubmittingQuickBook, setIsSubmittingQuickBook] = useState(false);
    const [quickBookError, setQuickBookError] = useState('');
    const [expandedMobileRoomId, setExpandedMobileRoomId] = useState<string | null>(null);

    const supabase = createClient();

    // 1. Fetch user permissions
    useEffect(() => {
        const fetchUserInfo = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setCurrentUserId(user.id);

            const { data: profile } = await supabase.from('users').select('is_master_admin').eq('id', user.id).maybeSingle();
            if (profile?.is_master_admin) {
                setUserRole('master_admin');
                return;
            }

            const { data: membership } = await supabase
                .from('property_memberships')
                .select('role')
                .eq('user_id', user.id)
                .eq('property_id', propertyId)
                .eq('is_active', true)
                .maybeSingle();

            if (membership) {
                setUserRole(membership.role.toLowerCase());
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

        fetchUserInfo();
    }, [propertyId]);

    // 2. Fetch Rooms & Bookings
    const fetchData = useCallback(async () => {
        if (!propertyId) return;
        setIsLoading(true);
        try {
            const [bookingsRes, roomsRes] = await Promise.all([
                fetch(`/api/meeting-room-bookings?propertyId=${propertyId}`),
                fetch(`/api/meeting-rooms?propertyId=${propertyId}`)
            ]);

            const bookingsData = await bookingsRes.json();
            const roomsData = await roomsRes.json();

            if (bookingsRes.ok && bookingsData.bookings) {
                setBookings(bookingsData.bookings);
                setCachedData(bookingsCacheKey, bookingsData.bookings);
            }

            if (roomsRes.ok && roomsData.rooms) {
                setRooms(roomsData.rooms);
                setCachedData(roomsCacheKey, roomsData.rooms);
            }
        } catch (error) {
            console.error('Error fetching meeting room data:', error);
        } finally {
            setIsLoading(false);
        }
    }, [propertyId, bookingsCacheKey, roomsCacheKey, setCachedData]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Helpers
    const timeToMins = (t: string): number => {
        if (!t) return 0;
        const [h, m] = t.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };

    const minsToTime = (mins: number): string => {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    };

    const formatTime12h = (t: string): string => {
        if (!t) return '';
        const [hStr, mStr] = t.split(':');
        let h = parseInt(hStr, 10);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${String(h).padStart(2, '0')}:${mStr} ${ampm}`;
    };

    const formatDisplayDate = (dateStr: string): string => {
        if (!dateStr) return '';
        if (dateStr === todayStr) {
            const d = new Date(dateStr + 'T00:00:00');
            return `Today, ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        }
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    };

    const handlePrevDay = () => {
        const d = new Date(selectedDate + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        setSelectedDate(`${y}-${m}-${day}`);
    };

    const handleNextDay = () => {
        const d = new Date(selectedDate + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        setSelectedDate(`${y}-${m}-${day}`);
    };

    const isBookingPast = (bookingDate: string, startTime: string) => {
        if (!bookingDate || !startTime) return false;
        const cleanDate = bookingDate.split('T')[0];
        const [y, m, d] = cleanDate.split('-').map(Number);
        const [h, min] = startTime.split(':').map(Number);
        const utc = Date.UTC(y, m - 1, d, h - 5, min - 30);
        return !isNaN(utc) && utc <= Date.now();
    };

    const canCancel = (booking: Booking) => {
        if (booking.status !== 'confirmed') return false;
        if (isBookingPast(booking.booking_date, booking.start_time)) return false;
        if (userRole === 'master_admin') return true;
        if (currentUserId === booking.user_id) return true;
        if (userRole === 'property_admin' || userRole === 'org_super_admin' || userRole === 'org_admin') return true;
        if ((userRole === 'staff' || userRole === 'mst') && isTechnical) return true;
        return false;
    };

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
                setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'cancelled' } : b));
                if (activeBookingDetail?.id === id) {
                    setActiveBookingDetail(prev => prev ? { ...prev, status: 'cancelled' } : null);
                }
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

    const handleQuickBookSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!quickBookTarget) return;
        setIsSubmittingQuickBook(true);
        setQuickBookError('');
        try {
            const res = await fetch('/api/meeting-room-bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    meetingRoomId: quickBookTarget.room.id,
                    propertyId,
                    date: selectedDate,
                    startTime: quickBookTarget.start,
                    endTime: quickBookTarget.end,
                    comment: quickBookComment.trim() || undefined,
                    attendeeEmail: quickBookGuestEmail.trim() || undefined
                })
            });
            const data = await res.json();
            if (res.ok) {
                invalidateCache('admin-bookings-');
                invalidateCache('tenant-bookings-');
                invalidateCache('rooms-avail-');
                await fetchData();
                setQuickBookTarget(null);
                setQuickBookComment('');
                setQuickBookGuestEmail('');
            } else {
                setQuickBookError(data.error || 'Failed to create booking');
            }
        } catch (err: any) {
            setQuickBookError(err.message || 'An unexpected error occurred');
        } finally {
            setIsSubmittingQuickBook(false);
        }
    };

    // Filtered rooms for timeline
    const activeRooms = useMemo(() => {
        const list = rooms.filter(r => r.status !== 'inactive');
        if (selectedRoomId === 'all') return list;
        return list.filter(r => r.id === selectedRoomId);
    }, [rooms, selectedRoomId]);

    // Bookings filtered for List View
    const filteredListBookings = useMemo(() => {
        return bookings.filter(b => {
            const matchesRoom = selectedRoomId === 'all' || b.meeting_room_id === selectedRoomId;
            const matchesDate = !selectedDate || b.booking_date === selectedDate;
            const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
            const matchesSearch = !searchTerm ||
                b.tenant?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                b.meeting_room?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (b.attendee_email && b.attendee_email.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (b.comment && b.comment.toLowerCase().includes(searchTerm.toLowerCase()));
            return matchesRoom && matchesDate && matchesStatus && matchesSearch;
        });
    }, [bookings, selectedRoomId, selectedDate, statusFilter, searchTerm]);

    // Calculate room live occupancy for current day
    const getRoomLiveStatus = (roomBookings: Booking[]) => {
        const isToday = selectedDate === todayStr;
        if (!isToday) {
            const confirmedCount = roomBookings.filter(b => b.status === 'confirmed').length;
            return {
                isOccupied: false,
                label: confirmedCount > 0 ? `${confirmedCount} Bookings` : 'No Bookings',
                badgeClass: confirmedCount > 0 ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-50 text-slate-400 border-slate-200'
            };
        }

        const now = new Date();
        const curMins = now.getHours() * 60 + now.getMinutes();

        const activeNow = roomBookings.find(b => {
            if (b.status !== 'confirmed') return false;
            const sM = timeToMins(b.start_time);
            const eM = timeToMins(b.end_time);
            return curMins >= sM && curMins < eM;
        });

        if (activeNow) {
            return {
                isOccupied: true,
                label: 'LIVE OCCUPIED',
                sublabel: `Until ${formatTime12h(activeNow.end_time)}`,
                badgeClass: 'bg-amber-500/15 text-amber-700 border-amber-300 font-black'
            };
        }

        return {
            isOccupied: false,
            label: 'AVAILABLE',
            sublabel: 'Free now',
            badgeClass: 'bg-emerald-500/15 text-emerald-700 border-emerald-300 font-black'
        };
    };

    // Calculate time intervals (hour markers) for desktop timeline
    const hours = useMemo(() => {
        const list = [];
        for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) {
            const timeStr = `${String(h).padStart(2, '0')}:00:00`;
            list.push({ hour: h, label: formatTime12h(timeStr) });
        }
        return list;
    }, []);

    // Current time indicator line position
    const currentTimePercent = useMemo(() => {
        if (selectedDate !== todayStr) return null;
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        if (currentMins < DAY_START_HOUR * 60 || currentMins > DAY_END_HOUR * 60) return null;
        return ((currentMins - DAY_START_HOUR * 60) / TOTAL_DAY_MINUTES) * 100;
    }, [selectedDate, todayStr]);

    // Calculate free intervals for a room on selectedDate
    const getRoomIntervals = (roomBookings: Booking[]) => {
        const confirmed = roomBookings
            .filter(b => b.status === 'confirmed')
            .map(b => ({
                id: b.id,
                startMins: timeToMins(b.start_time),
                endMins: timeToMins(b.end_time),
                booking: b
            }))
            .sort((a, b) => a.startMins - b.startMins);

        const intervals: Array<{
            type: 'free' | 'booked';
            startMins: number;
            endMins: number;
            start: string;
            end: string;
            booking?: Booking;
        }> = [];

        let pointer = DAY_START_HOUR * 60;

        for (const b of confirmed) {
            if (b.startMins > pointer) {
                // Free interval before booking
                intervals.push({
                    type: 'free',
                    startMins: pointer,
                    endMins: b.startMins,
                    start: minsToTime(pointer),
                    end: minsToTime(b.startMins)
                });
            }
            // Booked interval
            intervals.push({
                type: 'booked',
                startMins: b.startMins,
                endMins: b.endMins,
                start: b.booking.start_time,
                end: b.booking.end_time,
                booking: b.booking
            });
            pointer = Math.max(pointer, b.endMins);
        }

        if (pointer < DAY_END_HOUR * 60) {
            intervals.push({
                type: 'free',
                startMins: pointer,
                endMins: DAY_END_HOUR * 60,
                start: minsToTime(pointer),
                end: minsToTime(DAY_END_HOUR * 60)
            });
        }

        return intervals;
    };

    return (
        <div className="space-y-5 w-full">
            {/* Top Navigation & Controls Bar */}
            <div className="flex flex-col gap-3.5 bg-white p-3.5 md:p-5 rounded-2xl border border-slate-200/90 shadow-xs">
                {/* Row 1: Date Navigator + View Switcher */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    {/* Date Navigator */}
                    <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                        <button
                            type="button"
                            onClick={handlePrevDay}
                            className="p-1.5 hover:bg-white rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                            title="Previous Day"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        <div className="relative flex items-center px-2">
                            <Calendar className="w-4 h-4 text-primary mr-2" />
                            <span className="text-xs md:text-sm font-black text-slate-900 tracking-tight select-none">
                                {formatDisplayDate(selectedDate)}
                            </span>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={handleNextDay}
                            className="p-1.5 hover:bg-white rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
                            title="Next Day"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>

                        {selectedDate !== todayStr && (
                            <button
                                type="button"
                                onClick={() => setSelectedDate(todayStr)}
                                className="ml-1 px-2.5 py-1 bg-white hover:bg-primary hover:text-white border border-slate-200 text-slate-700 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shadow-2xs"
                            >
                                Today
                            </button>
                        )}
                    </div>

                    {/* View Switcher: List vs Timeline */}
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/80 self-end sm:self-auto">
                        <button
                            type="button"
                            onClick={() => setViewMode('list')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                                viewMode === 'list'
                                    ? 'bg-white text-slate-900 shadow-xs'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            <ListFilter className="w-3.5 h-3.5 text-primary" />
                            <span>List View</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('timeline')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                                viewMode === 'timeline'
                                    ? 'bg-[#4a7c7d] text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                            <span>Visual Timeline</span>
                        </button>
                    </div>
                </div>

                {/* Row 2: Room Filter Chips + Status Filter */}
                <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2 border-t border-slate-100">
                    {/* Room Chips */}
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                        <button
                            type="button"
                            onClick={() => setSelectedRoomId('all')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shrink-0 cursor-pointer ${
                                selectedRoomId === 'all'
                                    ? 'bg-[#4a7c7d] text-white shadow-xs'
                                    : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200'
                            }`}
                        >
                            All Rooms ({rooms.length})
                        </button>

                        {rooms.map(room => {
                            const isSelected = selectedRoomId === room.id;
                            return (
                                <button
                                    key={room.id}
                                    type="button"
                                    onClick={() => setSelectedRoomId(room.id)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                        isSelected
                                            ? 'bg-[#4a7c7d] text-white shadow-xs'
                                            : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                                    }`}
                                >
                                    <span>{room.name}</span>
                                    <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${
                                        isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                        {room.capacity}p
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Status & Search Filters */}
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1 md:w-56">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search client or room..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary transition-all"
                            />
                        </div>

                        <div className="flex items-center gap-1 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200 shrink-0">
                            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="bg-transparent text-[11px] font-black text-slate-700 focus:outline-none cursor-pointer uppercase tracking-wider outline-none"
                            >
                                <option value="all">ALL STATUS</option>
                                <option value="confirmed">CONFIRMED</option>
                                <option value="cancelled">CANCELLED</option>
                                <option value="completed">COMPLETED</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* CONTENT AREA */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-slate-200/90 shadow-xs">
                    <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Loading schedule...</p>
                </div>
            ) : viewMode === 'timeline' ? (
                /* OPTION 1: VISUAL TIMELINE / GANTT SCHEDULE GRID */
                <div className="space-y-4">
                    {/* DESKTOP TIMELINE GRID (Hidden on small mobile) */}
                    <div className="hidden md:block bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                        <div className="overflow-x-auto">
                            <div className="min-w-[1000px]">
                                {/* Timeline Grid Header Row */}
                                <div className="flex items-center border-b border-slate-200 bg-slate-50/80 sticky top-0 z-20">
                                    {/* Left header column */}
                                    <div className="w-64 p-3.5 shrink-0 border-r border-slate-200">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                            Meeting Room Resource
                                        </span>
                                    </div>

                                    {/* Hour Header Columns */}
                                    <div className="flex-1 flex relative">
                                        {hours.map((h, i) => (
                                            <div 
                                                key={h.hour}
                                                className="flex-1 text-center py-3 text-[11px] font-black text-slate-700 border-r border-slate-200/80 last:border-r-0 select-none"
                                            >
                                                {h.label}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Room Timeline Rows */}
                                <div className="divide-y divide-slate-100">
                                    {activeRooms.length === 0 ? (
                                        <div className="py-16 text-center text-xs font-bold text-slate-400">
                                            No active meeting rooms found for this property.
                                        </div>
                                    ) : (
                                        activeRooms.map((room) => {
                                            // Get confirmed/cancelled bookings for this room on selectedDate
                                            const roomBookings = bookings.filter(b => 
                                                b.meeting_room_id === room.id && 
                                                b.booking_date === selectedDate &&
                                                (statusFilter === 'all' || b.status === statusFilter) &&
                                                (!searchTerm || 
                                                    b.tenant?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                                    b.comment?.toLowerCase().includes(searchTerm.toLowerCase())
                                                )
                                            );

                                            const liveStatus = getRoomLiveStatus(roomBookings);
                                            const intervals = getRoomIntervals(roomBookings);

                                            return (
                                                <div key={room.id} className="flex items-stretch hover:bg-slate-50/40 transition-colors group/row">
                                                    {/* Sticky Left Room Card */}
                                                    <div className="w-64 p-4 shrink-0 border-r border-slate-200 bg-white flex items-center gap-3.5 z-10">
                                                        <div className="w-13 h-13 rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 shrink-0">
                                                            {room.photo_url ? (
                                                                <img src={room.photo_url} alt={room.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                                    <LayoutGrid className="w-5 h-5" />
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="min-w-0 flex-1">
                                                            <h4 className="text-sm font-black text-slate-900 truncate tracking-tight">{room.name}</h4>
                                                            <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
                                                                Capacity: {room.capacity} People
                                                            </p>
                                                            <div className="mt-1.5 flex items-center gap-1.5">
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${liveStatus.badgeClass}`}>
                                                                    {liveStatus.label}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Right Timeline Lane Grid */}
                                                    <div className="flex-1 relative min-h-[96px] flex items-center">
                                                        {/* Background Hour Columns Divider */}
                                                        <div className="absolute inset-0 flex pointer-events-none">
                                                            {hours.map((h, i) => (
                                                                <div 
                                                                    key={h.hour}
                                                                    className="flex-1 border-r border-slate-100 last:border-r-0 bg-transparent"
                                                                />
                                                            ))}
                                                        </div>

                                                        {/* Red/Teal "NOW" Current Time Line */}
                                                        {currentTimePercent !== null && (
                                                            <div 
                                                                className="absolute top-0 bottom-0 z-15 pointer-events-none"
                                                                style={{ left: `${currentTimePercent}%` }}
                                                            >
                                                                <div className="w-0.5 h-full bg-rose-500 shadow-sm" />
                                                                <span className="absolute -top-1 -translate-x-1/2 px-1 py-0.2 rounded-sm bg-rose-500 text-white text-[8px] font-black tracking-widest">
                                                                    NOW
                                                                </span>
                                                            </div>
                                                        )}

                                                        {/* Intervals & Booking Blocks Layer */}
                                                        <div className="absolute inset-0 p-2 flex items-center">
                                                            {/* Render Free Available Slots */}
                                                            {intervals
                                                                .filter(int => int.type === 'free' && int.endMins - int.startMins >= 30)
                                                                .map((freeInt, idx) => {
                                                                    const left = ((freeInt.startMins - DAY_START_HOUR * 60) / TOTAL_DAY_MINUTES) * 100;
                                                                    const width = ((freeInt.endMins - freeInt.startMins) / TOTAL_DAY_MINUTES) * 100;
                                                                    if (left < 0 || width <= 0) return null;

                                                                    return (
                                                                        <button
                                                                            key={`free-${idx}`}
                                                                            type="button"
                                                                            onClick={() => setQuickBookTarget({
                                                                                room,
                                                                                start: freeInt.start,
                                                                                end: freeInt.end
                                                                            })}
                                                                            style={{ left: `${left}%`, width: `${width}%` }}
                                                                            className="absolute top-2 bottom-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 hover:bg-emerald-100/80 transition-all flex items-center justify-center group/free cursor-pointer overflow-hidden px-1"
                                                                            title={`Available: ${formatTime12h(freeInt.start)} - ${formatTime12h(freeInt.end)}. Click to book.`}
                                                                        >
                                                                            <span className="opacity-0 group-hover/free:opacity-100 transition-opacity flex items-center gap-1 text-[10px] font-black text-emerald-800 uppercase tracking-wider bg-white/90 px-2 py-1 rounded-md shadow-2xs">
                                                                                <Plus className="w-3 h-3 text-emerald-600" />
                                                                                <span>Book</span>
                                                                            </span>
                                                                        </button>
                                                                    );
                                                                })
                                                            }

                                                            {/* Render Booked Blocks */}
                                                            {roomBookings.map((b) => {
                                                                const startM = Math.max(DAY_START_HOUR * 60, timeToMins(b.start_time));
                                                                const endM = Math.min(DAY_END_HOUR * 60, timeToMins(b.end_time));
                                                                if (endM <= startM) return null;

                                                                const left = ((startM - DAY_START_HOUR * 60) / TOTAL_DAY_MINUTES) * 100;
                                                                const width = ((endM - startM) / TOTAL_DAY_MINUTES) * 100;
                                                                const isPast = isBookingPast(b.booking_date, b.start_time);
                                                                const isCancelled = b.status === 'cancelled';

                                                                return (
                                                                    <div
                                                                        key={b.id}
                                                                        onClick={() => setActiveBookingDetail(b)}
                                                                        style={{ left: `${left}%`, width: `${width}%` }}
                                                                        className={`absolute top-2 bottom-2 rounded-xl p-2.5 transition-all shadow-xs flex flex-col justify-center cursor-pointer overflow-hidden z-10 group/block border ${
                                                                            isCancelled
                                                                                ? 'bg-rose-50 text-rose-700 border-rose-200 line-through opacity-70'
                                                                                : isPast
                                                                                ? 'bg-slate-100 text-slate-700 border-slate-200 hover:border-slate-300'
                                                                                : 'bg-[#4a7c7d] hover:bg-[#3f6b6c] text-white border-[#3d6768] shadow-sm hover:shadow-md'
                                                                        }`}
                                                                        title={`${b.tenant?.full_name} (${formatTime12h(b.start_time)} - ${formatTime12h(b.end_time)})`}
                                                                    >
                                                                        <div className="flex items-center justify-between gap-1 leading-none">
                                                                            <span className="text-xs font-black truncate">
                                                                                {b.tenant?.full_name || 'Booked Slot'}
                                                                            </span>
                                                                            {isCancelled && (
                                                                                <span className="text-[8px] font-black uppercase tracking-widest bg-rose-200 text-rose-900 px-1 py-0.2 rounded-xs">
                                                                                    Cancelled
                                                                                </span>
                                                                            )}
                                                                        </div>

                                                                        <div className="flex items-center gap-1.5 text-[10px] opacity-90 font-medium truncate mt-0.5">
                                                                            <Clock className="w-3 h-3 shrink-0" />
                                                                            <span>{formatTime12h(b.start_time)} - {formatTime12h(b.end_time)}</span>
                                                                        </div>

                                                                        {b.comment && (
                                                                            <p className="text-[9px] font-semibold italic opacity-85 truncate mt-0.5">
                                                                                "{b.comment}"
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* MOBILE TIMELINE VIEW (Optimized for small screens) */}
                    <div className="md:hidden space-y-3.5">
                        {activeRooms.map((room) => {
                            const roomBookings = bookings.filter(b => 
                                b.meeting_room_id === room.id && 
                                b.booking_date === selectedDate &&
                                (statusFilter === 'all' || b.status === statusFilter) &&
                                (!searchTerm || 
                                    b.tenant?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                    b.comment?.toLowerCase().includes(searchTerm.toLowerCase())
                                )
                            );

                            const liveStatus = getRoomLiveStatus(roomBookings);
                            const intervals = getRoomIntervals(roomBookings);
                            const isExpanded = expandedMobileRoomId === room.id;

                            return (
                                <div key={room.id} className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3.5">
                                    {/* Mobile Room Header */}
                                    <div className="flex items-center gap-3">
                                        <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                                            {room.photo_url ? (
                                                <img src={room.photo_url} alt={room.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                    <LayoutGrid className="w-6 h-6" />
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-1">
                                                <h4 className="text-sm font-black text-slate-900 truncate">{room.name}</h4>
                                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border shrink-0 ${liveStatus.badgeClass}`}>
                                                    {liveStatus.label}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500 font-medium mt-0.5">
                                                {room.capacity} People • {room.location || 'Meeting Space'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Horizontal Mini Timeline Bar */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase tracking-widest px-0.5">
                                            <span>09:00 AM</span>
                                            <span>01:00 PM</span>
                                            <span>06:00 PM</span>
                                        </div>

                                        <div className="relative h-10 w-full rounded-xl bg-slate-100 overflow-hidden border border-slate-200 flex items-center">
                                            {/* Background Hour Markers */}
                                            <div className="absolute inset-0 flex pointer-events-none">
                                                {Array.from({ length: 9 }).map((_, i) => (
                                                    <div key={i} className="flex-1 border-r border-slate-200/50 last:border-r-0" />
                                                ))}
                                            </div>

                                            {/* Colored Booking Blocks inside strip */}
                                            {roomBookings.map((b) => {
                                                const startM = Math.max(9 * 60, timeToMins(b.start_time));
                                                const endM = Math.min(18 * 60, timeToMins(b.end_time));
                                                if (endM <= startM) return null;
                                                const left = ((startM - 9 * 60) / (9 * 60)) * 100;
                                                const width = ((endM - startM) / (9 * 60)) * 100;

                                                return (
                                                    <div
                                                        key={b.id}
                                                        onClick={() => setActiveBookingDetail(b)}
                                                        style={{ left: `${left}%`, width: `${width}%` }}
                                                        className={`absolute top-1 bottom-1 rounded-lg px-1.5 flex items-center text-[10px] font-bold text-white shadow-2xs truncate cursor-pointer ${
                                                            b.status === 'cancelled'
                                                                ? 'bg-rose-400 line-through'
                                                                : 'bg-[#4a7c7d]'
                                                        }`}
                                                    >
                                                        <span className="truncate">{b.tenant?.full_name?.split(' ')[0]}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Toggle Breakdown Schedule */}
                                    <div className="pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setExpandedMobileRoomId(isExpanded ? null : room.id)}
                                            className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-black text-slate-700 uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                                        >
                                            <span>{isExpanded ? 'Hide Schedule' : `View Day Schedule (${roomBookings.length} Bookings)`}</span>
                                        </button>

                                        {isExpanded && (
                                            <div className="mt-3 space-y-2 pt-2 border-t border-slate-100">
                                                {intervals.length === 0 ? (
                                                    <div className="text-xs text-slate-400 italic py-2 text-center">No schedule available.</div>
                                                ) : (
                                                    intervals.map((int, i) => (
                                                        <div 
                                                            key={i} 
                                                            className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                                                                int.type === 'booked'
                                                                    ? int.booking?.status === 'cancelled'
                                                                        ? 'bg-rose-50/60 border-rose-100 text-rose-800'
                                                                        : 'bg-slate-50 border-slate-200 text-slate-800'
                                                                    : 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                                                            }`}
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-1.5 text-xs font-black">
                                                                    <Clock className="w-3.5 h-3.5" />
                                                                    <span>{formatTime12h(int.start)} - {formatTime12h(int.end)}</span>
                                                                </div>
                                                                <p className="text-[11px] font-medium opacity-85 truncate mt-0.5">
                                                                    {int.type === 'booked' 
                                                                        ? `Booked by ${int.booking?.tenant?.full_name || 'Member'} ${int.booking?.comment ? `• "${int.booking.comment}"` : ''}`
                                                                        : 'Available for reservation'
                                                                    }
                                                                </p>
                                                            </div>

                                                            {int.type === 'free' ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setQuickBookTarget({ room, start: int.start, end: int.end })}
                                                                    className="px-3 py-1.5 bg-[#4a7c7d] text-white rounded-lg text-xs font-black uppercase tracking-wider shadow-2xs shrink-0"
                                                                >
                                                                    + Book
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => int.booking && setActiveBookingDetail(int.booking)}
                                                                    className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 shrink-0"
                                                                >
                                                                    Details
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                /* OPTION: ROW LIST VIEW (Fallback list) */
                <div className="grid gap-3.5">
                    {filteredListBookings.length === 0 ? (
                        <div className="bg-white border border-slate-200/90 rounded-2xl p-12 text-center shadow-xs">
                            <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">No bookings found for selected criteria</p>
                        </div>
                    ) : (
                        <AnimatePresence mode="popLayout">
                            {filteredListBookings.map((booking) => {
                                const isPast = isBookingPast(booking.booking_date, booking.start_time);
                                const isCancelled = booking.status === 'cancelled';

                                return (
                                    <motion.div
                                        key={booking.id}
                                        layout
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className="bg-white p-4 md:p-5 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition-all"
                                    >
                                        <div className="flex items-center gap-4 flex-1 min-w-0">
                                            <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200 shadow-2xs">
                                                {booking.meeting_room?.photo_url ? (
                                                    <img src={booking.meeting_room.photo_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                        <Calendar className="w-6 h-6" />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <h4 className="text-base font-black text-slate-900 truncate tracking-tight">{booking.meeting_room?.name || 'Meeting Room'}</h4>
                                                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-slate-500 text-xs font-medium">
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="w-3.5 h-3.5 text-primary" />
                                                        {new Date(booking.booking_date + 'T00:00:00').toLocaleDateString('en-GB')}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="w-3.5 h-3.5 text-primary" />
                                                        {formatTime12h(booking.start_time)} - {formatTime12h(booking.end_time)}
                                                    </span>
                                                    <span className="text-slate-400 text-[10px] uppercase font-bold">
                                                        Booked: {new Date(booking.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>

                                                {booking.attendee_email && (
                                                    <p className="mt-1 text-xs text-primary font-bold">
                                                        Guest Email: <span className="underline">{booking.attendee_email}</span>
                                                    </p>
                                                )}

                                                {booking.comment && (
                                                    <p className="mt-1 text-xs text-slate-600 font-bold uppercase tracking-wider italic">
                                                        "{booking.comment}"
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between md:justify-end gap-4 shrink-0">
                                            <div className="flex flex-col md:items-end gap-1">
                                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                                                    <User className="w-3.5 h-3.5 text-slate-400" />
                                                    <span>{booking.tenant?.full_name || 'Member'}</span>
                                                </div>
                                                <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                                                    isCancelled
                                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                        : isPast
                                                        ? 'bg-slate-100 text-slate-600 border-slate-200'
                                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                }`}>
                                                    {isCancelled ? 'CANCELLED' : isPast ? 'PAST' : 'CONFIRMED'}
                                                </span>
                                            </div>

                                            {canCancel(booking) && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleCancelBooking(booking.id)}
                                                    disabled={cancellingId === booking.id}
                                                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs font-black uppercase tracking-wider border border-rose-200 transition-all cursor-pointer"
                                                >
                                                    {cancellingId === booking.id ? 'Cancelling...' : 'Cancel'}
                                                </button>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    )}
                </div>
            )}

            {/* DETAIL MODAL: When a booking block in timeline is clicked */}
            {activeBookingDetail && (
                <div 
                    className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => setActiveBookingDetail(null)}
                >
                    <div 
                        className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden p-6 space-y-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-start justify-between">
                            <div>
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reservation Details</span>
                                <h3 className="text-xl font-black text-slate-900 mt-0.5">
                                    {activeBookingDetail.meeting_room?.name}
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveBookingDetail(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Details Stack */}
                        <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80 text-xs">
                            <div className="flex items-center justify-between">
                                <span className="text-slate-500 font-bold">Status:</span>
                                <span className={`px-2 py-0.5 rounded-md font-black uppercase tracking-wider text-[10px] border ${
                                    activeBookingDetail.status === 'cancelled'
                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                }`}>
                                    {activeBookingDetail.status}
                                </span>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-slate-500 font-bold">Time:</span>
                                <span className="font-black text-slate-900">
                                    {formatTime12h(activeBookingDetail.start_time)} - {formatTime12h(activeBookingDetail.end_time)}
                                </span>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-slate-500 font-bold">Date:</span>
                                <span className="font-bold text-slate-900">
                                    {new Date(activeBookingDetail.booking_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                                </span>
                            </div>

                            <div className="flex items-center justify-between">
                                <span className="text-slate-500 font-bold">Reserved By:</span>
                                <span className="font-black text-slate-900">
                                    {activeBookingDetail.tenant?.full_name || 'Member'}
                                </span>
                            </div>

                            {activeBookingDetail.tenant?.email && (
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-500 font-bold">Email:</span>
                                    <span className="font-medium text-slate-700">{activeBookingDetail.tenant.email}</span>
                                </div>
                            )}

                            {activeBookingDetail.attendee_email && (
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-500 font-bold">Invited Guest:</span>
                                    <span className="font-medium text-primary">{activeBookingDetail.attendee_email}</span>
                                </div>
                            )}

                            {activeBookingDetail.comment && (
                                <div className="pt-2 border-t border-slate-200">
                                    <span className="text-slate-400 font-bold block mb-1 uppercase tracking-wider text-[10px]">Purpose:</span>
                                    <p className="text-slate-800 font-medium italic">"{activeBookingDetail.comment}"</p>
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3">
                            {canCancel(activeBookingDetail) && (
                                <button
                                    type="button"
                                    onClick={() => handleCancelBooking(activeBookingDetail.id)}
                                    disabled={cancellingId === activeBookingDetail.id}
                                    className="flex-1 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs font-black uppercase tracking-wider border border-rose-200 transition-all cursor-pointer"
                                >
                                    {cancellingId === activeBookingDetail.id ? 'Cancelling...' : 'Cancel Booking'}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setActiveBookingDetail(null)}
                                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* QUICK BOOK MODAL: When a free interval on timeline is clicked */}
            {quickBookTarget && (
                <div 
                    className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => !isSubmittingQuickBook && setQuickBookTarget(null)}
                >
                    <div 
                        className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                <span className="text-[10px] font-black uppercase tracking-widest text-primary">Quick Reservation</span>
                                <h3 className="text-lg font-black text-slate-900">{quickBookTarget.room.name}</h3>
                                <p className="text-xs text-slate-500 font-medium">
                                    {formatDisplayDate(selectedDate)} • {formatTime12h(quickBookTarget.start)} to {formatTime12h(quickBookTarget.end)}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setQuickBookTarget(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {quickBookError && (
                            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold">
                                {quickBookError}
                            </div>
                        )}

                        <form onSubmit={handleQuickBookSubmit} className="space-y-3.5">
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1 block">
                                    Meeting Purpose / Notes
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Legal Team Discussion, Client Pitch"
                                    value={quickBookComment}
                                    onChange={(e) => setQuickBookComment(e.target.value)}
                                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1 block">
                                    Guest Email (Optional)
                                </label>
                                <input
                                    type="email"
                                    placeholder="guest@company.com"
                                    value={quickBookGuestEmail}
                                    onChange={(e) => setQuickBookGuestEmail(e.target.value)}
                                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary"
                                />
                            </div>

                            <div className="pt-2 flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setQuickBookTarget(null)}
                                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmittingQuickBook}
                                    className="flex-1 py-2.5 bg-[#4a7c7d] hover:bg-[#3f6b6c] text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2"
                                >
                                    {isSubmittingQuickBook && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    <span>Confirm Booking</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminBookingList;
