'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Edit2, Trash2, X, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Slot {
    id: string;
    start_time: string;
    end_time: string;
}

export default function AdminSlotManager() {
    const [slots, setSlots] = useState<Slot[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
    const [formData, setFormData] = useState({ start_time: '09:00', end_time: '10:00' });
    const [isSaving, setIsSaving] = useState(false);

    const fetchSlots = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/meeting-room-slots');
            const data = await res.json();
            if (res.ok) setSlots(data.slots || []);
        } catch (error) {
            console.error('Failed to fetch slots:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchSlots();
    }, []);

    const formatTimeForInput = (timeString: string) => {
        if (!timeString) return '09:00';
        return timeString.substring(0, 5); // HH:mm:ss -> HH:mm
    };

    const formatTimeForDisplay = (timeString: string) => {
        if (!timeString) return '';
        const [h, m] = timeString.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    const handleAdd = () => {
        setEditingSlot(null);
        setFormData({ start_time: '09:00', end_time: '10:00' });
        setIsModalOpen(true);
    };

    const handleEdit = (slot: Slot) => {
        setEditingSlot(slot);
        setFormData({
            start_time: formatTimeForInput(slot.start_time),
            end_time: formatTimeForInput(slot.end_time)
        });
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this time slot?')) return;
        try {
            const res = await fetch(`/api/meeting-room-slots/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setSlots(prev => prev.filter(s => s.id !== id));
            }
        } catch (error) {
            console.error('Failed to delete slot:', error);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const url = editingSlot ? `/api/meeting-room-slots/${editingSlot.id}` : '/api/meeting-room-slots';
            const method = editingSlot ? 'PUT' : 'POST';
            
            // Append seconds for DB compatibility
            const payload = {
                start_time: `${formData.start_time}:00`,
                end_time: `${formData.end_time}:00`
            };

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                fetchSlots();
                setIsModalOpen(false);
            } else {
                alert('Failed to save slot. Please ensure times are valid.');
            }
        } catch (error) {
            console.error('Failed to save slot:', error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div>
                    <h3 className="text-lg font-bold text-slate-900">Predefined Time Slots</h3>
                    <p className="text-sm text-slate-500">Manage the quick-pick time slots available to tenants.</p>
                </div>
                <button
                    onClick={handleAdd}
                    className="px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl uppercase tracking-wider hover:opacity-90 transition-opacity flex items-center gap-2"
                >
                    <Plus className="w-4 h-4" /> Add Slot
                </button>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
            ) : slots.length === 0 ? (
                <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                    <Clock className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-900 font-bold">No slots defined</p>
                    <p className="text-slate-500 text-sm mt-1">Add slots to make it easier for tenants to book standard times.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {slots.map(slot => (
                        <div key={slot.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between group hover:border-primary/30 transition-all">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                    <Clock className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="font-bold text-slate-900 text-sm">
                                        {formatTimeForDisplay(slot.start_time)} - {formatTimeForDisplay(slot.end_time)}
                                    </p>
                                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-0.5">Duration: {
                                        (() => {
                                            const [sh, sm] = slot.start_time.split(':').map(Number);
                                            const [eh, em] = slot.end_time.split(':').map(Number);
                                            const diffMins = (eh * 60 + em) - (sh * 60 + sm);
                                            return diffMins >= 60 ? `${(diffMins/60).toFixed(1)} hrs` : `${diffMins} mins`;
                                        })()
                                    }</p>
                                </div>
                            </div>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleEdit(slot)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-primary transition-colors">
                                    <Edit2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleDelete(slot.id)} className="p-2 hover:bg-rose-50 rounded-lg text-slate-500 hover:text-rose-500 transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AnimatePresence>
                {isModalOpen && (
                    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden"
                        >
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                                <h3 className="font-bold text-slate-900">{editingSlot ? 'Edit Slot' : 'Add Time Slot'}</h3>
                                <button onClick={() => setIsModalOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Start Time</label>
                                    <input 
                                        type="time" 
                                        value={formData.start_time}
                                        onChange={e => setFormData({ ...formData, start_time: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">End Time</label>
                                    <input 
                                        type="time" 
                                        value={formData.end_time}
                                        onChange={e => setFormData({ ...formData, end_time: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    />
                                </div>
                            </div>
                            <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                                <button 
                                    onClick={() => setIsModalOpen(false)}
                                    className="flex-1 py-2.5 border border-slate-200 rounded-xl text-slate-600 font-bold text-sm hover:bg-slate-100 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:opacity-90 transition-opacity flex justify-center items-center gap-2 disabled:opacity-70"
                                >
                                    {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {isSaving ? 'Saving...' : 'Save Slot'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
