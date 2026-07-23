'use client';

import React, { useState } from 'react';
import { Monitor, Trash2, Edit2, X, Clock, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface RoomCardProps {
    room: any;
    slots?: any[];
    selectedDate?: string;
    onBook?: (room: any, slot: any) => void;
    isAdmin?: boolean;
    onEdit?: (room: any) => void;
    onDelete?: (id: string) => void;
}

const RoomCard: React.FC<RoomCardProps> = ({ room, slots = [], selectedDate: _selectedDate, onBook, isAdmin, onEdit, onDelete }) => {
    const [showPhoto, setShowPhoto] = useState(false);
    const [isCustomTime, setIsCustomTime] = useState(false);
    const [customStart, setCustomStart] = useState('09:00');
    const [customEnd, setCustomEnd] = useState('10:00');
    const [customError, setCustomError] = useState('');
    const [partialConfirm, setPartialConfirm] = useState<any>(null);

    const timeToMins = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    const minsToTime = (mins: number) => {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`;
    };

    const getSlotAvailability = (start: string, end: string) => {
        const sMins = timeToMins(start);
        const eMins = timeToMins(end);
        let freeSegments = [{ start: sMins, end: eMins }];

        if (room.bookings) {
            const overlaps = room.bookings.map((b: any) => ({
                start: timeToMins(b.start_time),
                end: timeToMins(b.end_time)
            })).filter((b: any) => b.start < eMins && b.end > sMins);

            for (const b of overlaps) {
                let newFree: {start: number, end: number}[] = [];
                for (const seg of freeSegments) {
                    if (b.end <= seg.start || b.start >= seg.end) {
                        newFree.push(seg);
                    } else {
                        if (b.start > seg.start) newFree.push({ start: seg.start, end: b.start });
                        if (b.end < seg.end) newFree.push({ start: b.end, end: seg.end });
                    }
                }
                freeSegments = newFree;
            }
        }

        freeSegments = freeSegments.filter(seg => (seg.end - seg.start) >= 30);

        if (freeSegments.length === 0) return { type: 'BOOKED' };
        
        if (freeSegments.length === 1 && freeSegments[0].start === sMins && freeSegments[0].end === eMins) {
            return { type: 'AVAILABLE', availableTime: { start, end } };
        }

        freeSegments.sort((a, b) => (b.end - b.start) - (a.end - a.start));
        const bestSeg = freeSegments[0];
        
        return {
            type: 'PARTIAL',
            position: bestSeg.start > sMins ? 'right' : 'left',
            availableTime: { start: minsToTime(bestSeg.start), end: minsToTime(bestSeg.end) }
        };
    };

    const checkIsBooked = (start: string, end: string) => {
        return getSlotAvailability(start, end).type === 'BOOKED';
    };

    const formatTimeForDisplay = (timeString: string) => {
        if (!timeString) return '';
        const [h, m] = timeString.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    const handleCustomBook = () => {
        setCustomError('');
        const [sH, sM] = customStart.split(':').map(Number);
        const [eH, eM] = customEnd.split(':').map(Number);
        const startMins = sH * 60 + sM;
        const endMins = eH * 60 + eM;

        if (endMins <= startMins) {
            setCustomError('End time must be after start time.');
            return;
        }
        if (endMins - startMins < 30) {
            setCustomError('Minimum booking duration is 30 minutes.');
            return;
        }

        const formattedStart = `${customStart}:00`;
        const formattedEnd = `${customEnd}:00`;

        if (checkIsBooked(formattedStart, formattedEnd)) {
            setCustomError('This custom time overlaps with an existing booking.');
            return;
        }

        onBook?.(room, {
            time: formatTimeForDisplay(formattedStart),
            start: formattedStart,
            end: formattedEnd,
            endLabel: formatTimeForDisplay(formattedEnd)
        });
    };

    return (
        <>
            <div className="w-full h-full">
                <div className="w-full max-w-full rounded-xl bg-card border border-border p-3 md:p-6 shadow-sm hover:shadow-md transition-all relative flex flex-col h-full">
                    <span className="absolute top-4 right-4 text-[9px] font-bold text-muted-foreground uppercase tracking-widest hidden md:block">Available</span>

                    <div className="flex gap-4 md:gap-6 mb-4 md:mb-6">
                        <div
                            className={`w-[64px] h-[64px] md:w-24 md:h-24 rounded-2xl bg-muted flex-shrink-0 overflow-hidden border border-border ${room.photo_url ? 'cursor-pointer active:scale-95 transition-transform' : ''}`}
                            onClick={() => room.photo_url && setShowPhoto(true)}
                        >
                            {room.photo_url ? (
                                <img src={room.photo_url} alt={room.name} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                    <Monitor className="w-8 h-8" />
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            <h3 className="text-base md:text-[18px] font-bold text-foreground truncate mb-1">{room.name}</h3>
                            <p className="text-[12px] md:text-[14px] font-medium text-muted-foreground break-words">
                                {room.capacity} People • {room.location}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-x-2 text-[12px] md:text-[13px] font-bold text-muted-foreground mb-4 md:mb-6">
                        {(room.amenities || []).map((amenity: string, i: number) => (
                            <React.Fragment key={amenity}>
                                {i > 0 && <span className="text-muted-foreground">•</span>}
                                <span>{amenity}</span>
                            </React.Fragment>
                        ))}
                    </div>

                    <div className="mt-auto min-w-0 w-full">
                        {isAdmin ? (
                            <div className="flex items-center gap-3 pt-4 border-t border-border">
                                <button
                                    onClick={() => onEdit?.(room)}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-muted hover:bg-muted/80 text-muted-foreground rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                                >
                                    <Edit2 className="w-3.5 h-3.5" />
                                    Edit Room
                                </button>
                                <button
                                    onClick={() => onDelete?.(room.id)}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Delete
                                </button>
                            </div>
                        ) : (
                            <div>
                                <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Select Time</span>
                                    <button 
                                        onClick={() => setIsCustomTime(!isCustomTime)}
                                        className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline flex items-center gap-1"
                                    >
                                        <Clock className="w-3 h-3" />
                                        {isCustomTime ? 'Quick Picks' : 'Custom Time'}
                                    </button>
                                </div>
                                
                                {isCustomTime ? (
                                    <div className="space-y-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                                        <div className="flex gap-3">
                                            <div className="flex-1">
                                                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Start</label>
                                                <input 
                                                    type="time" 
                                                    value={customStart}
                                                    onChange={(e) => setCustomStart(e.target.value)}
                                                    className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-primary"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">End</label>
                                                <input 
                                                    type="time" 
                                                    value={customEnd}
                                                    onChange={(e) => setCustomEnd(e.target.value)}
                                                    className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-primary"
                                                />
                                            </div>
                                        </div>
                                        {customError && <p className="text-[10px] text-rose-500 font-bold">{customError}</p>}
                                        <button 
                                            onClick={handleCustomBook}
                                            className="w-full py-2 bg-primary text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
                                        >
                                            Book Custom Time
                                        </button>
                                    </div>
                                ) : (
                                    <div className="w-full overflow-x-auto no-scrollbar">
                                        <div className="flex gap-2 min-w-max pb-1">
                                            {slots.length === 0 ? (
                                                <div className="text-xs text-muted-foreground italic py-2">No predefined slots available. Use Custom Time.</div>
                                            ) : slots.map((slot, i) => {
                                                const avail = getSlotAvailability(slot.start_time, slot.end_time);
                                                const isBooked = avail.type === 'BOOKED';
                                                const isPartial = avail.type === 'PARTIAL';
                                                const timeDisplay = formatTimeForDisplay(slot.start_time);
                                                
                                                let tooltip = '';
                                                if (isPartial) {
                                                    tooltip = `Partially booked. You can book from ${formatTimeForDisplay(avail.availableTime!.start)} to ${formatTimeForDisplay(avail.availableTime!.end)}`;
                                                } else if (isBooked) {
                                                    tooltip = 'Fully booked';
                                                }

                                                return (
                                                    <button
                                                        key={i}
                                                        disabled={isBooked}
                                                        title={tooltip}
                                                        onClick={() => {
                                                            if (!isBooked && avail.availableTime) {
                                                                if (isPartial) {
                                                                    setPartialConfirm({ room, avail, timeDisplay });
                                                                } else {
                                                                    onBook?.(room, {
                                                                        time: formatTimeForDisplay(avail.availableTime.start),
                                                                        start: avail.availableTime.start,
                                                                        end: avail.availableTime.end,
                                                                        endLabel: formatTimeForDisplay(avail.availableTime.end)
                                                                    });
                                                                }
                                                            }
                                                        }}
                                                        className={`group shrink-0 relative overflow-hidden rounded-xl border-2 transition-all ${isBooked ? 'border-slate-200 cursor-not-allowed opacity-70' : isPartial ? 'border-amber-200 hover:border-amber-400 shadow-sm' : 'border-emerald-100 hover:border-emerald-400 shadow-sm'}`}
                                                    >
                                                        {/* Background layers */}
                                                        <div className="absolute inset-0 flex w-full h-full z-0 pointer-events-none">
                                                            {isBooked ? (
                                                                <div className="w-full h-full bg-slate-100" />
                                                            ) : isPartial ? (
                                                                <>
                                                                    <div className={`w-1/2 h-full ${avail.position === 'right' ? 'bg-slate-200 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(0,0,0,0.04)_2px,rgba(0,0,0,0.04)_4px)] border-r border-slate-300/50' : 'bg-emerald-50 group-hover:bg-emerald-100 border-r border-emerald-200/50 transition-colors'}`} />
                                                                    <div className={`w-1/2 h-full ${avail.position === 'left' ? 'bg-slate-200 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(0,0,0,0.04)_2px,rgba(0,0,0,0.04)_4px)]' : 'bg-emerald-50 group-hover:bg-emerald-100 transition-colors'}`} />
                                                                </>
                                                            ) : (
                                                                <div className="w-full h-full bg-emerald-50 group-hover:bg-emerald-100 transition-colors" />
                                                            )}
                                                        </div>

                                                        {/* Content */}
                                                        <div className={`relative z-10 py-2.5 px-4 flex flex-col items-center justify-center gap-0.5 ${isBooked ? 'text-slate-400' : 'text-slate-700'}`}>
                                                            <span className={`text-[13px] font-black leading-none`}>
                                                                {timeDisplay.split(' ')[0]}
                                                            </span>
                                                            <span className={`text-[9px] font-black tracking-widest uppercase ${isBooked ? 'text-slate-400' : isPartial ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                                {timeDisplay.split(' ')[1]}
                                                            </span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showPhoto && room.photo_url && (
                <div
                    className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setShowPhoto(false)}
                >
                    <button
                        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        onClick={() => setShowPhoto(false)}
                    >
                        <X className="w-5 h-5 text-white" />
                    </button>
                    <p className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium">{room.name}</p>
                    <img
                        src={room.photo_url}
                        alt={room.name}
                        className="max-w-full max-h-[90vh] object-contain rounded-xl"
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            )}

            <AnimatePresence>
                {partialConfirm && (
                    <div className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPartialConfirm(null)}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            onClick={e => e.stopPropagation()}
                            className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
                        >
                            <div className="p-6 md:p-8 text-center relative">
                                <button
                                    className="absolute top-4 right-4 p-2 rounded-full bg-slate-50 hover:bg-slate-100 transition-colors"
                                    onClick={() => setPartialConfirm(null)}
                                >
                                    <X className="w-4 h-4 text-slate-400" />
                                </button>
                                <div className="w-16 h-16 bg-amber-50 border-4 border-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
                                    <Clock className="w-8 h-8 text-amber-500" />
                                </div>
                                <h3 className="text-xl font-black text-slate-900 mb-2 tracking-tight">Partial Availability</h3>
                                <p className="text-sm text-slate-500 font-medium mb-6">
                                    A portion of this slot is already booked. You can book the remaining time for <span className="font-bold text-slate-700">{room.name}</span>:
                                </p>
                                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 mb-8">
                                    <p className="text-2xl font-black text-emerald-600 tracking-tight">
                                        {formatTimeForDisplay(partialConfirm.avail.availableTime.start)}
                                    </p>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest my-1.5">to</p>
                                    <p className="text-2xl font-black text-emerald-600 tracking-tight">
                                        {formatTimeForDisplay(partialConfirm.avail.availableTime.end)}
                                    </p>
                                </div>
                                
                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => setPartialConfirm(null)}
                                        className="flex-1 py-3.5 rounded-xl border-2 border-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors uppercase tracking-widest"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={() => {
                                            onBook?.(room, {
                                                time: formatTimeForDisplay(partialConfirm.avail.availableTime.start),
                                                start: partialConfirm.avail.availableTime.start,
                                                end: partialConfirm.avail.availableTime.end,
                                                endLabel: formatTimeForDisplay(partialConfirm.avail.availableTime.end)
                                            });
                                            setPartialConfirm(null);
                                        }}
                                        className="flex-1 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-sm transition-colors uppercase tracking-widest shadow-lg shadow-amber-500/20"
                                    >
                                        Continue
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
};

export default RoomCard;
