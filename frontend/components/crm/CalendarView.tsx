'use client';

import React, { useState, useEffect } from 'react';
import {
    ChevronLeft, ChevronRight, Calendar as CalendarIcon,
    Phone, Video, Map, Bell, Plus, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CRMEvent, EventType } from '@/frontend/types/crm';

interface CalendarViewProps {
    onEventClick?: (event: CRMEvent) => void;
    onCreateEvent?: () => void;
}

const EVENT_COLORS: Record<EventType, string> = {
    call: 'bg-blue-100 border-blue-300 text-blue-700',
    meeting: 'bg-purple-100 border-purple-300 text-purple-700',
    site_visit: 'bg-orange-100 border-orange-300 text-orange-700',
    followup: 'bg-teal-100 border-teal-300 text-teal-700'
};

const EVENT_ICONS: Record<EventType, any> = {
    call: Phone,
    meeting: Video,
    site_visit: Map,
    followup: Bell
};

export default function CalendarView({ onEventClick, onCreateEvent }: CalendarViewProps) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [view, setView] = useState<'month' | 'week' | 'day'>('month');
    const [events, setEvents] = useState<CRMEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    useEffect(() => {
        fetchEvents();
    }, [currentDate, view]);

    const fetchEvents = async () => {
        setIsLoading(true);
        try {
            const startDate = getStartDate();
            const endDate = getEndDate();

            const res = await fetch(`/api/crm/events?start_date=${startDate}&end_date=${endDate}`);
            if (res.ok) {
                const data = await res.json();
                setEvents(data.events || []);
            }
        } catch (error) {
            console.error('Failed to fetch events:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const getStartDate = () => {
        const date = new Date(currentDate);
        if (view === 'month') {
            date.setDate(1);
            date.setDate(date.getDate() - date.getDay());
        } else if (view === 'week') {
            date.setDate(date.getDate() - date.getDay());
        }
        return date.toISOString().split('T')[0];
    };

    const getEndDate = () => {
        const date = new Date(currentDate);
        if (view === 'month') {
            date.setMonth(date.getMonth() + 1);
            date.setDate(0);
            date.setDate(date.getDate() + (6 - date.getDay()));
        } else if (view === 'week') {
            date.setDate(date.getDate() + (6 - date.getDay()));
        }
        return date.toISOString().split('T')[0];
    };

    const getDaysInMonth = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const days: Date[] = [];

        // Add days from previous month
        const startDay = firstDay.getDay();
        for (let i = startDay - 1; i >= 0; i--) {
            const d = new Date(year, month, -i);
            days.push(d);
        }

        // Add days of current month
        for (let i = 1; i <= lastDay.getDate(); i++) {
            days.push(new Date(year, month, i));
        }

        // Add days from next month
        const remaining = 42 - days.length;
        for (let i = 1; i <= remaining; i++) {
            days.push(new Date(year, month + 1, i));
        }

        return days;
    };

    const getEventsForDate = (date: Date) => {
        const dateStr = date.toISOString().split('T')[0];
        return events.filter(e => e.start_datetime.startsWith(dateStr));
    };

    const isToday = (date: Date) => {
        const today = new Date();
        return date.toDateString() === today.toDateString();
    };

    const isCurrentMonth = (date: Date) => {
        return date.getMonth() === currentDate.getMonth();
    };

    const formatTime = (datetime: string) => {
        return new Date(datetime).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const navigateMonth = (direction: number) => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(newDate.getMonth() + direction);
            return newDate;
        });
    };

    const days = getDaysInMonth();
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold text-text-primary">
                        {currentDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                    </h2>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => navigateMonth(-1)}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5 text-text-secondary" />
                        </button>
                        <button
                            onClick={() => setCurrentDate(new Date())}
                            className="px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
                        >
                            Today
                        </button>
                        <button
                            onClick={() => navigateMonth(1)}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <ChevronRight className="w-5 h-5 text-text-secondary" />
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex bg-slate-100 rounded-lg p-1" data-tour="calendar-view-toggle">
                        {(['month', 'week', 'day'] as const).map(v => (
                            <button
                                key={v}
                                onClick={() => setView(v)}
                                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                    view === v
                                        ? 'bg-white text-text-primary shadow-sm'
                                        : 'text-text-secondary hover:text-text-primary'
                                }`}
                            >
                                {v.charAt(0).toUpperCase() + v.slice(1)}
                            </button>
                        ))}
                    </div>
                    {onCreateEvent && (
                        <button
                            onClick={onCreateEvent}
                            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Add Event
                        </button>
                    )}
                </div>
            </div>

            {/* Calendar Grid — scrolls horizontally on small screens so day cells stay usable */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden" data-tour="calendar-grid">
              <div className="overflow-x-auto touch-scroll">
                <div className="min-w-[560px]">
                {/* Week Days Header */}
                <div className="grid grid-cols-7 border-b border-slate-200">
                    {weekDays.map(day => (
                        <div key={day} className="px-4 py-3 text-center text-xs font-medium text-text-secondary bg-slate-50">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Days Grid */}
                <div className="grid grid-cols-7">
                    {days.map((date, index) => {
                        const dayEvents = getEventsForDate(date);
                        const isSelected = selectedDate?.toDateString() === date.toDateString();

                        return (
                            <div
                                key={index}
                                onClick={() => setSelectedDate(date)}
                                className={`min-h-[100px] p-2 border-b border-r border-slate-100 cursor-pointer transition-colors ${
                                    !isCurrentMonth(date) ? 'bg-slate-50' : 'bg-white'
                                } ${isSelected ? 'bg-primary/5' : 'hover:bg-slate-50'}`}
                            >
                                <div className={`flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium mb-1 ${
                                    isToday(date)
                                        ? 'bg-primary text-white'
                                        : isCurrentMonth(date)
                                            ? 'text-text-primary'
                                            : 'text-text-tertiary'
                                }`}>
                                    {date.getDate()}
                                </div>
                                <div className="space-y-1">
                                    {dayEvents.slice(0, 3).map(event => {
                                        const Icon = EVENT_ICONS[event.event_type] || Bell;
                                        return (
                                            <div
                                                key={event.id}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onEventClick?.(event);
                                                }}
                                                className={`px-2 py-1 rounded text-xs font-medium border truncate flex items-center gap-1 ${EVENT_COLORS[event.event_type]}`}
                                            >
                                                <Icon className="w-3 h-3 shrink-0" />
                                                <span className="truncate">{event.title}</span>
                                            </div>
                                        );
                                    })}
                                    {dayEvents.length > 3 && (
                                        <div className="text-xs text-text-tertiary text-center">
                                            +{dayEvents.length - 3} more
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                </div>
              </div>
            </div>

            {/* Selected Day Events */}
            <AnimatePresence>
                {selectedDate && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="bg-white rounded-2xl border border-slate-200 p-6"
                    >
                        <h3 className="text-lg font-semibold text-text-primary mb-4">
                            {selectedDate.toLocaleDateString('en-IN', {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long'
                            })}
                        </h3>
                        {getEventsForDate(selectedDate).length === 0 ? (
                            <div className="text-center py-8 text-text-secondary">
                                <Clock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                                <p>No events scheduled</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {getEventsForDate(selectedDate).map(event => {
                                    const Icon = EVENT_ICONS[event.event_type] || Bell;
                                    return (
                                        <div
                                            key={event.id}
                                            onClick={() => onEventClick?.(event)}
                                            className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors"
                                        >
                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                                                EVENT_COLORS[event.event_type].split(' ')[0]
                                            }`}>
                                                <Icon className={`w-6 h-6 ${EVENT_COLORS[event.event_type].split(' ')[2]}`} />
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-medium text-text-primary">{event.title}</p>
                                                <p className="text-sm text-text-secondary mt-1">
                                                    {formatTime(event.start_datetime)}
                                                    {event.end_datetime && ` - ${formatTime(event.end_datetime)}`}
                                                </p>
                                                {event.lead_info && (
                                                    <p className="text-xs text-text-tertiary mt-1">
                                                        {event.lead_info.company_name}
                                                    </p>
                                                )}
                                            </div>
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                event.status === 'completed'
                                                    ? 'bg-green-100 text-green-700'
                                                    : event.status === 'cancelled'
                                                        ? 'bg-red-100 text-red-700'
                                                        : 'bg-blue-100 text-blue-700'
                                            }`}>
                                                {event.status}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}