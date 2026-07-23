'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

interface CalendarEvent {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    type: 'call' | 'meeting' | 'site_visit' | 'followup' | 'internal' | 'demo';
    location?: string;
    user?: any;
}

interface Day {
    label: string;
    date: number;
    fullDate: Date;
    isToday: boolean;
    events: CalendarEvent[];
}

const EVENT_COLORS: Record<string, string> = {
    call: 'bg-blue-50 border-l-4 border-blue-400 text-blue-900',
    meeting: 'bg-pink-50 border-l-4 border-pink-400 text-pink-900',
    site_visit: 'bg-green-50 border-l-4 border-green-400 text-green-900',
    followup: 'bg-orange-50 border-l-4 border-orange-400 text-orange-900',
    internal: 'bg-amber-50 border-l-4 border-amber-400 text-amber-900',
    demo: 'bg-purple-50 border-l-4 border-purple-400 text-purple-900',
};

const EVENT_ICONS: Record<string, string> = {
    call: '☎️',
    meeting: '👥',
    site_visit: '📍',
    followup: '↩️',
    internal: '⚙️',
    demo: '🎬',
};

const TIME_SLOTS = [
    '8 AM', '9 AM', '10 AM', '11 AM', '12 PM',
    '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM'
];

export default function RepTimeGridCalendar({
    events = [],
    reps = [],
    orgId = '',
}: {
    events: any[];
    reps: any[];
    orgId: string;
}) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
    const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(['call', 'meeting', 'site_visit', 'followup', 'internal', 'demo']));
    const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

    // Build week starting from Monday
    const weekDays = useMemo(() => {
        const now = new Date(currentDate);
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        const monday = new Date(now.setDate(diff));

        const days: Day[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(d.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];

            const dayEvents = (events || []).filter((e: any) => {
                if (!e.start_datetime) return false;
                const eventDate = new Date(e.start_datetime).toISOString().split('T')[0];
                const eventType = (e.event_type || 'internal').toLowerCase();
                return eventDate === dateStr && activeFilters.has(eventType);
            }).map((e: any) => ({
                id: e.id,
                title: e.title || e.event_type || 'Event',
                startTime: new Date(e.start_datetime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                endTime: e.end_datetime ? new Date(e.end_datetime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
                type: e.event_type || 'internal',
                location: e.lead_info?.[0]?.company_name || '',
                user: e.user_info,
            }));

            const today = new Date();
            const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();

            days.push({
                label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
                date: d.getDate(),
                fullDate: new Date(d),
                isToday,
                events: dayEvents,
            });
        }
        return days;
    }, [events, currentDate, activeFilters]);

    const activeReps = useMemo(() => {
        const repIds = new Set<string>();
        for (const e of events || []) {
            if (e.user_id) repIds.add(e.user_id);
        }
        return reps.filter((r: any) => repIds.has(r.id)).slice(0, 10);
    }, [events, reps]);

    const toggleFilter = (type: string) => {
        const newFilters = new Set(activeFilters);
        if (newFilters.has(type)) {
            newFilters.delete(type);
        } else {
            newFilters.add(type);
        }
        setActiveFilters(newFilters);
    };

    const handleTimeSlotClick = (day: Day, timeIndex: number) => {
        const hour = 8 + timeIndex;
        const date = day.fullDate.toISOString().split('T')[0];
        const time = `${hour < 12 ? hour : hour - 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
        window.location.href = `/${orgId}/crm/calendar?date=${date}&time=${time}`;
    };

    const handleEventClick = (event: CalendarEvent) => {
        setSelectedEvent(event);
    };

    const getEventPosition = (time: string) => {
        const [hour, period] = time.split(' ');
        const h = parseInt(hour);
        const adjustedHour = period === 'PM' && h !== 12 ? h + 12 : h === 12 && period === 'AM' ? 0 : h;
        return (adjustedHour - 8) * 60; // Offset from 8 AM
    };

    return (
        <div className="crm-card flex flex-col h-full bg-white rounded-2xl border border-border overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-gradient-to-r from-surface to-surface-elevated">
                <div>
                    <h2 className="text-lg font-black text-text-primary">Rep Calendar</h2>
                    <p className="text-xs text-text-tertiary">Track update and collaborate on rep activities.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={() => setCurrentDate(new Date())} className="text-xs font-bold text-primary hover:underline">Today</button>
                    <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-0.5">
                        <button onClick={() => setCurrentDate(d => new Date(d.setDate(d.getDate() - 7)))} className="p-1.5 hover:bg-surface-elevated rounded"><ChevronLeft className="w-4 h-4" /></button>
                        <span className="text-xs font-bold text-text-secondary px-3 min-w-[140px] text-center">
                            {weekDays[0].fullDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – {weekDays[6].fullDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        <button onClick={() => setCurrentDate(d => new Date(d.setDate(d.getDate() + 7)))} className="p-1.5 hover:bg-surface-elevated rounded"><ChevronRight className="w-4 h-4" /></button>
                    </div>
                    <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-0.5">
                        <button onClick={() => setViewMode('week')} className={`px-2.5 py-1 text-xs font-bold rounded transition-colors ${viewMode === 'week' ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'}`}>Week</button>
                        <button onClick={() => setViewMode('month')} className={`px-2.5 py-1 text-xs font-bold rounded transition-colors ${viewMode === 'month' ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'}`}>Month</button>
                    </div>
                </div>
            </div>

            {/* Rep Avatars */}
            {activeReps.length > 0 && (
                <div className="px-6 py-4 border-b border-border flex items-center gap-3 overflow-x-auto">
                    {activeReps.map((rep: any) => (
                        <div key={rep.id} className="flex flex-col items-center gap-1 flex-shrink-0 group cursor-pointer">
                            <div className="relative">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center border-2 border-primary/20 group-hover:border-primary group-hover:shadow-lg transition-all">
                                    {rep.avatar ? (
                                        <img src={rep.avatar} alt={rep.name} className="w-full h-full rounded-full object-cover" />
                                    ) : (
                                        <span className="text-sm font-black text-primary">{(rep.name || '?').charAt(0)}</span>
                                    )}
                                </div>
                            </div>
                            <p className="text-[11px] font-bold text-text-primary text-center">{rep.name.split(' ')[0]}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Calendar Grid */}
            <div className="flex-1 overflow-auto max-h-[380px]">
                <div className="flex min-w-full">
                    {/* Time Column */}
                    <div className="w-16 border-r border-border bg-surface-elevated flex-shrink-0">
                        <div className="h-16 border-b border-border"></div>
                        {TIME_SLOTS.map((time) => (
                            <div key={time} className="h-16 border-b border-border flex items-start justify-end pr-1.5 pt-0.5 text-[9px] font-bold text-text-tertiary">
                                {time}
                            </div>
                        ))}
                    </div>

                    {/* Days */}
                    <div className="flex flex-1">
                        {weekDays.map((day) => (
                            <div key={day.label} className="flex-1 border-r border-border min-w-[140px]">
                                {/* Day Header */}
                                <div className={`h-16 border-b border-border p-2 flex flex-col items-center justify-center ${day.isToday ? 'bg-primary/5' : 'bg-surface'}`}>
                                    <p className="text-[11px] font-medium text-text-tertiary uppercase">{day.label}</p>
                                    <p className={`text-xl font-black ${day.isToday ? 'w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center' : 'text-text-primary'}`}>
                                        {day.date}
                                    </p>
                                </div>

                                {/* Time Slots */}
                                <div className="relative">
                                    {TIME_SLOTS.map((time, idx) => (
                                        <div
                                            key={time}
                                            onClick={() => handleTimeSlotClick(day, idx)}
                                            className={`h-16 border-b border-border p-1 relative cursor-pointer hover:bg-primary/5 transition-colors ${day.isToday && idx === Math.floor((new Date().getHours() - 8)) ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
                                            title="Click to add event"
                                        >
                                            {day.events.map((event) => {
                                                const startHour = parseInt(event.startTime.split(':')[0]);
                                                const startMinute = parseInt(event.startTime.split(':')[1]);
                                                const timeIndex = (startHour > 12 ? startHour : startHour + 12) - 8;

                                                if (timeIndex === idx) {
                                                    return (
                                                        <div
                                                            key={event.id}
                                                            onClick={() => handleEventClick(event)}
                                                            className={`absolute left-1 right-1 p-2 rounded text-[10px] font-bold cursor-pointer hover:shadow-md hover:scale-105 transition-all ${EVENT_COLORS[event.type] || EVENT_COLORS.internal}`}
                                                            title={`${event.title} - Click for details`}
                                                        >
                                                            <div className="flex items-start gap-1">
                                                                <span className="text-base flex-shrink-0">{EVENT_ICONS[event.type]}</span>
                                                                <div className="min-w-0">
                                                                    <p className="font-bold truncate">{event.title}</p>
                                                                    <p className="opacity-75">{event.startTime} – {event.endTime || '...'}</p>
                                                                    {event.location && <p className="opacity-75 truncate">{event.location}</p>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="border-t border-border p-4 flex items-center justify-between bg-surface">
                <div className="flex items-center gap-3 text-xs flex-wrap">
                    {Object.entries(EVENT_ICONS).map(([type, icon]) => (
                        <button
                            key={type}
                            onClick={() => toggleFilter(type)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all ${
                                activeFilters.has(type)
                                    ? 'bg-primary/10 text-primary font-semibold border border-primary/30'
                                    : 'bg-surface-elevated text-text-secondary opacity-50 hover:opacity-75'
                            }`}
                            title={`Click to toggle ${type.replace('_', ' ')}`}
                        >
                            <span className="text-base">{icon}</span>
                            <span className="font-medium capitalize">{type.replace('_', ' ')}</span>
                        </button>
                    ))}
                </div>
                <Link href={`/${orgId}/crm/calendar`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-colors">
                    <Plus className="w-3 h-3" /> Add Activity
                </Link>
            </div>

            {/* Event Details Modal */}
            {selectedEvent && (
                <div
                    className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                    onClick={() => setSelectedEvent(null)}
                >
                    <div
                        className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-black text-text-primary flex items-center gap-2">
                                    <span className="text-2xl">{EVENT_ICONS[selectedEvent.type]}</span>
                                    {selectedEvent.title}
                                </h3>
                                <p className="text-sm text-text-secondary capitalize mt-1">{selectedEvent.type.replace('_', ' ')}</p>
                            </div>
                            <button
                                onClick={() => setSelectedEvent(null)}
                                className="text-text-tertiary hover:text-text-primary text-2xl leading-none"
                            >
                                ×
                            </button>
                        </div>
                        <div className="space-y-3 bg-surface rounded-lg p-4 mb-4">
                            <div>
                                <p className="text-xs font-bold text-text-tertiary uppercase">Time</p>
                                <p className="text-sm font-bold text-text-primary">{selectedEvent.startTime} – {selectedEvent.endTime || '...'}</p>
                            </div>
                            {selectedEvent.location && (
                                <div>
                                    <p className="text-xs font-bold text-text-tertiary uppercase">Location</p>
                                    <p className="text-sm font-bold text-text-primary">{selectedEvent.location}</p>
                                </div>
                            )}
                            {selectedEvent.user && (
                                <div>
                                    <p className="text-xs font-bold text-text-tertiary uppercase">Organizer</p>
                                    <p className="text-sm font-bold text-text-primary flex items-center gap-2">
                                        {selectedEvent.user?.user_photo_url || selectedEvent.user?.avatar_url ? (
                                            <img src={selectedEvent.user.user_photo_url || selectedEvent.user.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                                        ) : null}
                                        {selectedEvent.user?.full_name || 'Unknown'}
                                    </p>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={() => {
                                setSelectedEvent(null);
                                window.location.href = `/${orgId}/crm/calendar`;
                            }}
                            className="w-full px-4 py-2 bg-primary text-white font-bold rounded-lg hover:bg-primary-dark transition-colors text-sm"
                        >
                            Edit Event
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
