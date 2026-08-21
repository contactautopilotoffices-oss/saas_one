'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Check, Info, Edit3, Camera, Paperclip, MapPin, Image as ImageIcon, Loader2, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';
import { Toast } from '@/frontend/components/ui/Toast';
import SOPCADConfigModal from '@/frontend/components/sop/SOPCADConfigModal';

interface SOPTemplateFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
    template?: any;
    initialData?: {
        title?: string;
        description?: string;
        category?: string;
        frequency?: string;
        items?: { title: string; type?: string }[];
    };
    onSuccess?: () => void;
}

const SOPTemplateFormModal: React.FC<SOPTemplateFormModalProps> = ({ isOpen, onClose, propertyId, template, initialData, onSuccess }) => {
    const [mounted, setMounted] = useState(false);
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        category: 'general',
        frequency: 'daily',
        assigned_to: [] as string[],
        start_time: '09:00',
        end_time: '17:00',
    });



    const [items, setItems] = useState<any[]>([]);
    const [newItem, setNewItem] = useState({
        title: '',
        description: '',
        requires_photo: false,
        requires_comment: false,
        type: 'checkbox' as 'checkbox' | 'text' | 'number' | 'yes_no',
        is_optional: false,
        start_time: '',
        end_time: '',
    });
    const [showStepTimeSlot, setShowStepTimeSlot] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMembers, setIsLoadingMembers] = useState(false);
    const [propertyMembers, setPropertyMembers] = useState<any[]>([]);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [currentPropertyId, setCurrentPropertyId] = useState<string | null>(null);
    const [showCADModal, setShowCADModal] = useState(false);
    const [createdTemplateId, setCreatedTemplateId] = useState<string | null>(null);
    const activeTemplateId = template?.id || createdTemplateId;
    const [referencePhotoUploads, setReferencePhotoUploads] = useState<Record<number, { uploading: boolean; url?: string }>>({});
    const [templateCADStatus, setTemplateCADStatus] = useState<{ hasCAD: boolean; imageUrl?: string } | null>(null);


    const supabase = React.useMemo(() => createClient(), []);

    useEffect(() => {
        const fetchMembers = async () => {
            if (!propertyId) {
                console.warn('No propertyId provided for member fetch');
                setPropertyMembers([]);
                setIsLoadingMembers(false);
                setCurrentPropertyId(null);
                return;
            }

            setIsLoadingMembers(true);
            setCurrentPropertyId(propertyId);

            try {
                const response = await fetch(`/api/users/list?propertyId=${propertyId}`);
                const data = await response.json();

                if (!response.ok) {
                    console.error('API error:', data.error);
                    setToast({ message: data.error || 'Error loading property members', type: 'error' });
                    setPropertyMembers([]);
                    return;
                }

                console.log('Fetched members:', data.users?.length, 'members for propertyId:', propertyId);
                setPropertyMembers(data.users || []);
            } catch (err) {
                console.error('Error fetching property members:', err);
                setToast({ message: 'Error loading property members', type: 'error' });
                setPropertyMembers([]);
            } finally {
                setIsLoadingMembers(false);
            }
        };

        if (isOpen && propertyId) {
            fetchMembers();
        } else if (isOpen && !propertyId) {
            setPropertyMembers([]);
            setCurrentPropertyId(null);
        }
    }, [supabase, propertyId, isOpen]);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (template) {
            setCreatedTemplateId(null);
            setFormData({
                title: template.title,
                description: template.description || '',
                category: template.category || 'general',
                frequency: template.frequency || 'daily',
                assigned_to: template.assigned_to || [],
                start_time: template.start_time ? template.start_time.slice(0, 5) : '',
                end_time: template.end_time ? template.end_time.slice(0, 5) : '',
            });

            setItems(template.items || []);
        } else if (initialData) {
            setCreatedTemplateId(null);
            setFormData({
                title: initialData.title || '',
                description: initialData.description || '',
                category: initialData.category || 'general',
                frequency: initialData.frequency || 'daily',
                assigned_to: [],
                start_time: '09:00',
                end_time: '17:00',
            });
            setItems(
                (initialData.items || []).map((item: any, idx: number) => ({
                    id: item.id || `ai-${idx}`,
                    title: item.title,
                    description: item.description || '',
                    type: item.type || 'checkbox',
                    requires_photo: false,
                    requires_comment: false,
                    is_optional: false,
                    order_index: idx,
                }))
            );
        } else {
            setCreatedTemplateId(null);
            setFormData({
                title: '',
                description: '',
                category: 'general',
                frequency: 'daily',
                assigned_to: [],
                start_time: '',
                end_time: '',
            });

            setItems([]);
        }
    }, [template, initialData, isOpen]);

    const handleAddItem = () => {
        if (!newItem.title) {
            setToast({ message: 'Item title is required', type: 'error' });
            return;
        }

        if (editingIndex !== null) {
            // Update existing item
            const updatedItems = [...items];
            updatedItems[editingIndex] = {
                ...newItem,
                order_index: editingIndex,
                is_optional: false    // Force mandatory
            };
            setItems(updatedItems);
            setEditingIndex(null);
        } else {
            // Add new item
            setItems([...items, {
                ...newItem,
                order_index: items.length,
                is_optional: false    // Force mandatory
            }]);
        }


        setNewItem({
            title: '',
            description: '',
            requires_photo: false,
            requires_comment: false,
            type: 'checkbox',
            is_optional: false,
            start_time: '',
            end_time: '',
        });
        setShowStepTimeSlot(false);
    };

    const handleRemoveItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    // Fetch CAD status for existing template
    useEffect(() => {
        if (!isOpen || !template?.id || !propertyId) {
            setTemplateCADStatus(null);
            return;
        }
        const fetchCADStatus = async () => {
            try {
                const res = await fetch(`/api/properties/${propertyId}/sop/templates/${template.id}/cad/areas`);
                const data = await res.json();
                if (res.ok && data.cadConvertedImageUrl) {
                    setTemplateCADStatus({ hasCAD: true, imageUrl: data.cadConvertedImageUrl });
                } else {
                    setTemplateCADStatus({ hasCAD: false });
                }
            } catch (err) {
                console.error('Failed to fetch CAD status:', err);
                setTemplateCADStatus({ hasCAD: false });
            }
        };
        fetchCADStatus();
    }, [isOpen, template?.id, propertyId]);

    const handleReferencePhotoUpload = async (index: number, file: File) => {
        const item = items[index];
        if (!item?.id || item.id.startsWith('ai-')) {
            setToast({ message: 'Please save the template first before uploading reference photos', type: 'error' });
            return;
        }

        setReferencePhotoUploads(prev => ({ ...prev, [index]: { uploading: true } }));
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`/api/properties/${propertyId}/sop/checklist-items/${item.id}/reference-photo`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');

            setItems(prev => prev.map((it, i) => i === index ? { ...it, reference_photo_url: data.referencePhotoUrl, reference_photo_source: 'uploaded' } : it));
            setReferencePhotoUploads(prev => ({ ...prev, [index]: { uploading: false, url: data.referencePhotoUrl } }));
            setToast({ message: 'Reference photo uploaded', type: 'success' });
        } catch (err: any) {
            setReferencePhotoUploads(prev => ({ ...prev, [index]: { uploading: false } }));
            setToast({ message: err.message || 'Failed to upload reference photo', type: 'error' });
        }
    };

    const handleRemoveReferencePhoto = async (index: number) => {
        const item = items[index];
        if (!item?.id || item.id.startsWith('ai-')) return;

        try {
            const res = await fetch(`/api/properties/${propertyId}/sop/checklist-items/${item.id}/reference-photo`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Delete failed');

            setItems(prev => prev.map((it, i) => i === index ? { ...it, reference_photo_url: undefined, reference_photo_source: undefined } : it));
            setReferencePhotoUploads(prev => ({ ...prev, [index]: { uploading: false } }));
            setToast({ message: 'Reference photo removed', type: 'success' });
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to remove reference photo', type: 'error' });
        }
    };

    const handleOpenCAD = async () => {
        if (activeTemplateId) {
            setShowCADModal(true);
            return;
        }

        if (!formData.title.trim()) {
            setToast({ message: 'Please enter a Template Title first before uploading CAD', type: 'error' });
            return;
        }

        setIsLoading(true);
        try {
            const payload = {
                ...formData,
                items: items.map((it, idx) => ({
                    title: it.title,
                    description: it.description || '',
                    type: it.type || 'checkbox',
                    requires_photo: it.requires_photo || false,
                    requires_comment: it.requires_comment || false,
                    is_optional: false,
                    order_index: idx,
                    start_time: it.start_time || null,
                    end_time: it.end_time || null,
                })),
            };

            const response = await fetch(`/api/properties/${propertyId}/sop/templates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to create template');

            const newId = data.template?.id || data.id;
            if (newId) {
                setCreatedTemplateId(newId);
                if (data.template?.items && data.template.items.length > 0) {
                    setItems(data.template.items);
                }
                setShowCADModal(true);
                setToast({ message: 'Template saved! Upload your CAD floor plan now.', type: 'success' });
            }
        } catch (err: any) {
            setToast({ message: err.message || 'Error creating template', type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.title) {
            setToast({ message: 'Title is required', type: 'error' });
            return;
        }

        setIsLoading(true);

        try {
            const payload = {
                ...formData,
                items: items.map((it, idx) => ({
                    id: it.id && !it.id.startsWith('ai-') ? it.id : undefined,
                    title: it.title,
                    description: it.description || '',
                    type: it.type || 'checkbox',
                    requires_photo: it.requires_photo || false,
                    requires_comment: it.requires_comment || false,
                    is_optional: false,
                    order_index: idx,
                    start_time: it.start_time || null,
                    end_time: it.end_time || null,
                })),
            };

            const targetTemplateId = template?.id || createdTemplateId;

            if (targetTemplateId) {
                // Update existing template
                const response = await fetch(`/api/properties/${propertyId}/sop/templates/${targetTemplateId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to update template');
            } else {
                // Create template
                const response = await fetch(`/api/properties/${propertyId}/sop/templates`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to create template');
            }

            onSuccess?.();
            onClose();
        } catch (err) {
            setToast({ message: err instanceof Error ? err.message : 'Error saving template', type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };

    const inputCls = "w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-primary/40 focus:bg-white transition-all font-medium text-slate-900 text-sm placeholder:text-slate-400";
    const labelCls = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 px-1";

    // ── 12-hour helpers ──────────────────────────────────────────────────────
    /** "HH:MM" → { h12, minute, ampm } */
    const to12 = (val: string) => {
        if (!val) return { h12: '12', minute: '00', ampm: 'AM' };
        const [h24, m] = val.split(':').map(Number);
        const ampm = h24 >= 12 ? 'PM' : 'AM';
        const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
        return { h12: String(h12), minute: String(m).padStart(2, '0'), ampm };
    };
    /** { h12, minute, ampm } → "HH:MM" */
    const to24 = (h12: string, minute: string, ampm: string) => {
        let h = parseInt(h12);
        if (ampm === 'AM' && h === 12) h = 0;
        if (ampm === 'PM' && h !== 12) h += 12;
        return `${String(h).padStart(2, '0')}:${minute}`;
    };
    /** "HH:MM" → "H:MM AM/PM" */
    const fmt12 = (val: string) => {
        const { h12, minute, ampm } = to12(val);
        return `${h12}:${minute} ${ampm}`;
    };

    const TimeSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
        const { h12, minute, ampm } = to12(value);
        const hours = Array.from({ length: 12 }, (_, i) => String(i + 1));
        const minutes = ['00', '15', '30', '45'];
        const stepBtn = "w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-primary hover:text-white text-slate-500 transition-all text-[10px] font-black select-none";
        const valBox = "w-8 text-center font-black text-sm text-slate-900 leading-none";

        const cycleHour = (dir: 1 | -1) => {
            const idx = hours.indexOf(h12);
            const next = hours[(idx + dir + 12) % 12];
            onChange(to24(next, minute, ampm));
        };
        const cycleMinute = (dir: 1 | -1) => {
            const idx = minutes.indexOf(minute);
            const next = minutes[(idx + dir + 4) % 4];
            onChange(to24(h12, next, ampm));
        };
        const toggleAmpm = () => onChange(to24(h12, minute, ampm === 'AM' ? 'PM' : 'AM'));

        return (
            <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-2xl">
                {/* Hour stepper */}
                <div className="flex flex-col items-center gap-0.5">
                    <button type="button" onClick={() => cycleHour(1)} className={stepBtn}>▲</button>
                    <span className={valBox}>{h12.padStart(2, '0')}</span>
                    <button type="button" onClick={() => cycleHour(-1)} className={stepBtn}>▼</button>
                </div>
                <span className="font-black text-slate-300 text-lg leading-none mb-0.5">:</span>
                {/* Minute stepper */}
                <div className="flex flex-col items-center gap-0.5">
                    <button type="button" onClick={() => cycleMinute(1)} className={stepBtn}>▲</button>
                    <span className={valBox}>{minute}</span>
                    <button type="button" onClick={() => cycleMinute(-1)} className={stepBtn}>▼</button>
                </div>
                {/* AM/PM toggle */}
                <button type="button" onClick={toggleAmpm}
                    className="ml-1 px-2.5 py-1 rounded-xl bg-primary/10 text-primary font-black text-xs uppercase tracking-widest hover:bg-primary hover:text-white transition-all">
                    {ampm}
                </button>
            </div>
        );
    };

    // Compute scheduled run times preview
    const isHourly = /^every_\d+_hours?$/.test(formData.frequency);
    const scheduledTimes: string[] = React.useMemo(() => {
        if (!isHourly || !formData.start_time || !formData.end_time) return [];
        const m = formData.frequency.match(/^every_(\d+)_hours?$/);
        if (!m) return [];
        const intervalH = parseInt(m[1]);
        const [sH, sM] = formData.start_time.split(':').map(Number);
        const [eH, eM] = formData.end_time.split(':').map(Number);
        const startMins = sH * 60 + sM;
        const endMins = eH * 60 + eM;
        if (endMins <= startMins) return [];
        const times: string[] = [];
        for (let t = startMins; t <= endMins; t += intervalH * 60) {
            const h = Math.floor(t / 60);
            const mn = t % 60;
            times.push(`${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`);
        }
        return times;
    }, [formData.frequency, formData.start_time, formData.end_time, isHourly]);

    if (!isOpen || !mounted) return null;

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
                    />

                    {/* Sheet */}
                    <motion.div
                        initial={{ opacity: 0, y: 60 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 60 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                        className="relative bg-white w-full sm:max-w-lg sm:mx-4 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[93vh] sm:max-h-[90vh] overflow-hidden"
                    >
                        {/* Drag handle (mobile) */}
                        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
                            <div className="w-10 h-1 rounded-full bg-slate-200" />
                        </div>

                        {/* Header */}
                        <div className="flex justify-between items-start px-5 pt-3 pb-4 sm:pt-5 flex-shrink-0">
                            <div>
                                <h2 className="text-xl font-black text-slate-900 tracking-tight leading-tight">
                                    {template ? 'Edit Checklist' : 'Create Checklist'}<br className="sm:hidden" />
                                    <span className="sm:inline"> Template</span>
                                </h2>
                                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1">
                                    Define standard procedures
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-full transition-all flex-shrink-0 mt-0.5"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Scrollable body */}
                        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-5">

                            {/* ── GENERAL INFORMATION ── */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="w-7 h-7 rounded-full border-2 border-slate-200 flex items-center justify-center">
                                        <Info size={13} className="text-slate-500" />
                                    </div>
                                    <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">General Information</span>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <label className={labelCls}>Template Title *</label>
                                        <input
                                            type="text"
                                            placeholder="e.g., Morning Shift Perimeter Check"
                                            value={formData.title}
                                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                            className={inputCls}
                                            required
                                        />
                                    </div>

                                    {/* CAD Configuration */}
                                    <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                                                <MapPin size={14} className="text-primary" />
                                            </div>
                                            <div>
                                                <p className="text-xs font-black text-slate-900">CAD Floor Plan</p>
                                                <p className="text-[9px] text-slate-400 font-medium">
                                                    {templateCADStatus?.hasCAD ? 'Configured — click to edit areas' : 'Upload floor plan & map areas to steps'}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleOpenCAD}
                                            disabled={isLoading}
                                            className="px-3 py-1.5 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary/90 transition-all flex items-center gap-1"
                                        >
                                            {isLoading ? <Loader2 size={10} className="animate-spin" /> : null}
                                            {templateCADStatus?.hasCAD ? 'Edit CAD' : 'Upload CAD'}
                                        </button>
                                    </div>

                                    <div>
                                        <label className={labelCls}>Description</label>
                                        <textarea
                                            placeholder="Briefly describe the purpose of this checklist..."
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            rows={2}
                                            className={`${inputCls} resize-none`}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className={labelCls}>Frequency</label>
                                            <select
                                                value={formData.frequency}
                                                onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                                                className={`${inputCls} appearance-none`}
                                            >
                                                <optgroup label="Hourly">
                                                    <option value="every_1_hour">Every 1 Hour</option>
                                                    <option value="every_2_hours">Every 2 Hours</option>
                                                    <option value="every_3_hours">Every 3 Hours</option>
                                                    <option value="every_4_hours">Every 4 Hours</option>
                                                    <option value="every_6_hours">Every 6 Hours</option>
                                                    <option value="every_8_hours">Every 8 Hours</option>
                                                    <option value="every_12_hours">Every 12 Hours</option>
                                                </optgroup>
                                                <optgroup label="Standard">
                                                    <option value="daily">Daily</option>
                                                    <option value="weekly">Weekly</option>
                                                    <option value="monthly">Monthly</option>
                                                    <option value="on_demand">On Demand</option>
                                                </optgroup>
                                            </select>
                                        </div>
                                        <div>
                                            <label className={labelCls}>Category</label>
                                            <input
                                                type="text"
                                                placeholder="general"
                                                value={formData.category}
                                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                                className={inputCls}
                                            />
                                        </div>
                                    </div>

                                    {/* Time Window — only relevant for hourly frequency */}
                                    <div>
                                        <label className={labelCls}>Active Time Window <span className="normal-case text-[9px] text-slate-400 font-medium">(optional)</span></label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">Start Time</p>
                                                <TimeSelect
                                                    value={formData.start_time || '09:00'}
                                                    onChange={(v) => setFormData({ ...formData, start_time: v })}
                                                />
                                            </div>
                                            <div>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">End Time</p>
                                                <TimeSelect
                                                    value={formData.end_time || '17:00'}
                                                    onChange={(v) => setFormData({ ...formData, end_time: v })}
                                                />
                                            </div>
                                        </div>
                                        {/* Enable / clear toggle */}
                                        {!formData.start_time && !formData.end_time ? (
                                            <button type="button"
                                                onClick={() => setFormData({ ...formData, start_time: '09:00', end_time: '17:00' })}
                                                className="mt-2 text-[9px] font-black text-primary uppercase tracking-widest hover:underline px-1">
                                                + Set time window
                                            </button>
                                        ) : (
                                            <button type="button"
                                                onClick={() => setFormData({ ...formData, start_time: '', end_time: '' })}
                                                className="mt-2 text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-rose-500 px-1">
                                                × Clear (run anytime)
                                            </button>
                                        )}
                                        {scheduledTimes.length > 0 && (
                                            <div className="mt-2 px-3 py-2 bg-primary/5 border border-primary/10 rounded-xl">
                                                <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-1.5">Scheduled runs</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {scheduledTimes.map(t => (
                                                        <span key={t} className="px-2 py-0.5 bg-primary text-white rounded-full text-[9px] font-black">{fmt12(t)}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <label className={labelCls}>Assign To <span className="normal-case text-[9px] text-slate-400 font-medium">(optional)</span></label>
                                            {isLoadingMembers && (
                                                <span className="text-[9px] text-primary font-medium animate-pulse">Loading members...</span>
                                            )}
                                            {!propertyId && (
                                                <span className="text-[9px] text-amber-500 font-medium">Property required</span>
                                            )}
                                            {propertyId && !isLoadingMembers && propertyMembers.length === 0 && (
                                                <span className="text-[9px] text-slate-400 font-medium">No members found</span>
                                            )}
                                        </div>
                                        <div className="relative">
                                            <div
                                                onClick={() => !propertyId ? setToast({ message: 'Please select a property first', type: 'error' }) : setIsUserDropdownOpen(!isUserDropdownOpen)}
                                                className={`flex flex-wrap gap-1.5 px-4 py-2.5 bg-slate-50 border rounded-2xl min-h-[48px] cursor-pointer transition-all ${!propertyId ? 'border-amber-200' : 'border-slate-200 hover:border-primary/40'}`}
                                            >
                                                {formData.assigned_to.length > 0 ? (
                                                    formData.assigned_to.map(userId => {
                                                        const member = propertyMembers.find(m => m.id === userId);
                                                        return (
                                                            <div key={userId} className="flex items-center gap-1 px-2 py-1 bg-primary text-white rounded-lg text-[10px] font-black uppercase tracking-wider">
                                                                <span>{member?.full_name || 'User'}</span>
                                                                <button type="button" onClick={(e) => { e.stopPropagation(); setFormData({ ...formData, assigned_to: formData.assigned_to.filter(id => id !== userId) }); }} className="w-3.5 h-3.5 flex items-center justify-center bg-white/20 rounded-full">
                                                                    <X size={9} />
                                                                </button>
                                                            </div>
                                                        );
                                                    })
                                                ) : (
                                                    <span className="text-slate-400 text-sm font-medium self-center">Select people to assign...</span>
                                                )}
                                                <div className="ml-auto self-center text-slate-400">
                                                    <motion.div animate={{ rotate: isUserDropdownOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                                    </motion.div>
                                                </div>
                                            </div>
                                            <AnimatePresence>
                                                {isUserDropdownOpen && (
                                                    <>
                                                        <div className="fixed inset-0 z-10" onClick={() => setIsUserDropdownOpen(false)} />
                                                        <motion.div
                                                            initial={{ opacity: 0, y: 8 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: 8 }}
                                                            className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl max-h-44 overflow-y-auto p-1 shadow-xl z-20"
                                                        >
                                                            {isLoadingMembers ? (
                                                                <div className="py-4 text-center">
                                                                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                                                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading members...</div>
                                                                </div>
                                                            ) : propertyMembers.filter(m => !formData.assigned_to.includes(m.id)).length > 0 ? (
                                                                propertyMembers.filter(m => !formData.assigned_to.includes(m.id)).map((member: any) => (
                                                                    <button key={member.id} type="button" onClick={() => setFormData({ ...formData, assigned_to: [...formData.assigned_to, member.id] })}
                                                                        className="flex items-center gap-3 w-full p-2.5 hover:bg-slate-50 rounded-xl text-left transition-all">
                                                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-black text-primary">{member.full_name?.[0]}</div>
                                                                        <div>
                                                                            <div className="text-[11px] font-black text-slate-800 uppercase tracking-wide">{member.full_name}</div>
                                                                            <div className="text-[9px] text-slate-400 font-medium uppercase">{member.propertyRole || 'Member'}</div>
                                                                        </div>
                                                                    </button>
                                                                ))
                                                            ) : (
                                                                <div className="py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                                    {!propertyId ? 'Select a property first' : propertyMembers.length === 0 ? 'No members found in this property' : 'All members selected'}
                                                                </div>
                                                            )}
                                                        </motion.div>
                                                    </>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── STEPS & CHECKLIST ── */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="w-7 h-7 rounded-full border-2 border-amber-200 bg-amber-50 flex items-center justify-center">
                                        <Plus size={13} className="text-amber-500" />
                                    </div>
                                    <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Steps & Checklist</span>
                                </div>

                                {/* Existing items */}
                                {items.length > 0 && (
                                    <div className="space-y-2 mb-3">
                                        {items.map((item, idx) => (
                                            <motion.div key={idx} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                                className="bg-slate-50 border border-slate-200 px-3.5 py-3 rounded-2xl hover:border-slate-300 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-6 h-6 bg-white border border-slate-200 rounded-full flex items-center justify-center text-[10px] font-black text-slate-500 flex-shrink-0">{idx + 1}</div>
                                                    
                                                    {/* Reference photo thumbnail */}
                                                    {item.reference_photo_url && (
                                                        <a
                                                            href={item.reference_photo_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="relative group flex-shrink-0 cursor-pointer"
                                                            title="Click to view clean standard reference photo"
                                                        >
                                                            <img
                                                                src={item.reference_photo_url}
                                                                alt="Clean Ref"
                                                                className="w-10 h-10 rounded-xl object-cover border border-emerald-200 shadow-xs group-hover:scale-105 transition-transform"
                                                            />
                                                            <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                <Eye size={12} className="text-white" />
                                                            </div>
                                                        </a>
                                                    )}

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <p className="font-black text-sm text-slate-900 truncate">{item.title}</p>
                                                            {/* Reference photo badge */}
                                                            {item.reference_photo_url && (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[9px] font-black uppercase tracking-wider">
                                                                    <ImageIcon size={9} />
                                                                    Clean Photo Set
                                                                </span>
                                                            )}
                                                            {item.cad_area_id && (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[9px] font-black uppercase tracking-wider">
                                                                    <MapPin size={9} />
                                                                    CAD Area
                                                                </span>
                                                            )}
                                                        </div>
                                                        {item.description && <p className="text-[10px] text-slate-400 font-medium truncate mt-0.5">{item.description}</p>}
                                                        {(item.start_time || item.end_time) && (
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <p className="text-[9px] font-black text-primary/70">
                                                                    {item.start_time ? fmt12(item.start_time) : '—'} – {item.end_time ? fmt12(item.end_time) : '—'}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                        {/* Reference photo upload & view button */}
                                                        <>
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                className="hidden"
                                                                id={`ref-photo-${idx}`}
                                                                onChange={(e) => {
                                                                    const file = e.target.files?.[0];
                                                                    if (file) handleReferencePhotoUpload(idx, file);
                                                                }}
                                                            />
                                                            <label
                                                                htmlFor={`ref-photo-${idx}`}
                                                                className={`p-2 rounded-xl transition-all cursor-pointer ${referencePhotoUploads[idx]?.uploading ? 'text-primary bg-primary/10' : item.reference_photo_url ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 bg-emerald-50/50' : 'text-slate-400 hover:text-primary hover:bg-primary/5 bg-white border border-slate-200'}`}
                                                                title={item.reference_photo_url ? 'Change clean reference photo' : 'Upload clean reference photo'}
                                                            >
                                                                {referencePhotoUploads[idx]?.uploading ? (
                                                                    <Loader2 size={14} className="animate-spin" />
                                                                ) : (
                                                                    <Camera size={14} />
                                                                )}
                                                            </label>
                                                            {item.reference_photo_url && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRemoveReferencePhoto(idx)}
                                                                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                                                                    title="Remove clean reference photo"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            )}
                                                        </>
                                                        <button type="button" onClick={() => { setNewItem(item); setEditingIndex(idx); setShowStepTimeSlot(!!(item.start_time || item.end_time)); }} className="p-2 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-xl transition-all" title="Edit Step"><Edit3 size={14} /></button>
                                                        <button type="button" onClick={() => handleRemoveItem(idx)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all" title="Delete Step"><Trash2 size={14} /></button>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                )}

                                {/* Add step form */}
                                <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-4 space-y-3">
                                    <input
                                        type="text"
                                        placeholder="Step Title"
                                        value={newItem.title}
                                        onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                                        className={inputCls}
                                    />
                                    <textarea
                                        placeholder="Step Description / Instructions..."
                                        value={newItem.description}
                                        onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                                        rows={2}
                                        className={`${inputCls} resize-none`}
                                    />
                                    <div>
                                        <label className={labelCls}>Response Type</label>
                                        <select value={newItem.type} onChange={(e) => setNewItem({ ...newItem, type: e.target.value as any })} className={`${inputCls} appearance-none`}>
                                            <option value="checkbox">Checkbox</option>
                                            <option value="text">Text Input</option>
                                            <option value="number">Number Input</option>
                                            <option value="yes_no">Yes / No Toggle</option>
                                        </select>
                                    </div>

                                    {/* Verification Requirements Removed - Optional for all steps per user request */}

                                    {/* Step-level time slot */}
                                    {!showStepTimeSlot ? (
                                        <button type="button"
                                            onClick={() => { setShowStepTimeSlot(true); setNewItem({ ...newItem, start_time: '09:00', end_time: '17:00' }); }}
                                            className="text-[9px] font-black text-primary uppercase tracking-widest hover:underline px-1">
                                            + Set Step Time Slot
                                        </button>
                                    ) : (
                                        <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Step Time Slot</p>
                                                <button type="button"
                                                    onClick={() => { setShowStepTimeSlot(false); setNewItem({ ...newItem, start_time: '', end_time: '' }); }}
                                                    className="text-[9px] font-black text-slate-400 hover:text-rose-500 uppercase tracking-widest">
                                                    × Remove
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 px-1">From</p>
                                                    <TimeSelect value={newItem.start_time || '09:00'} onChange={(v) => setNewItem({ ...newItem, start_time: v })} />
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 px-1">To</p>
                                                    <TimeSelect value={newItem.end_time || '17:00'} onChange={(v) => setNewItem({ ...newItem, end_time: v })} />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <button type="button" onClick={handleAddItem}
                                        className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:opacity-90 transition-all">
                                        {editingIndex !== null ? <><Check size={14} /> Update Step</> : <><Plus size={14} /> Add Step</>}
                                    </button>
                                    {editingIndex !== null && (
                                        <button type="button" onClick={() => { setEditingIndex(null); setShowStepTimeSlot(false); setNewItem({ title: '', description: '', requires_photo: true, requires_comment: false, type: 'checkbox', is_optional: false, start_time: '', end_time: '' }); }}
                                            className="w-full text-[10px] font-black text-slate-400 py-1.5 hover:text-slate-600 uppercase tracking-widest transition-all">
                                            Cancel Editing
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* bottom spacing */}
                            <div className="h-2" />
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 bg-white flex-shrink-0">
                            <button type="button" onClick={onClose}
                                className="text-slate-500 font-black uppercase tracking-widest text-[10px] hover:text-slate-800 transition-all px-2 py-2">
                                Cancel
                            </button>
                            <button onClick={handleSubmit} disabled={isLoading}
                                className="flex-1 ml-4 py-3 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-800 transition-all shadow-lg disabled:opacity-50">
                                {isLoading ? 'Saving...' : template ? 'Save Changes' : 'Create Template'}
                            </button>
                        </div>
                    </motion.div>

                    {toast && (
                        <Toast message={toast.message} type={toast.type} visible={true} onClose={() => setToast(null)} duration={3000} />
                    )}

                    {activeTemplateId && (
                        <SOPCADConfigModal
                            isOpen={showCADModal}
                            onClose={() => setShowCADModal(false)}
                            propertyId={propertyId}
                            templateId={activeTemplateId}
                            templateTitle={formData.title || template?.title}
                            items={items.map((it: any) => ({ id: it.id, title: it.title, order_index: it.order_index, reference_photo_url: it.reference_photo_url }))}
                            onItemsUpdate={(updated) => {
                                setItems(prev => prev.map(p => {
                                    const match = updated.find(u => u.id === p.id);
                                    return match ? { ...p, reference_photo_url: match.reference_photo_url } : p;
                                }));
                            }}
                            onSuccess={() => {
                                setToast({ message: 'CAD areas updated', type: 'success' });
                                onSuccess?.();
                            }}
                        />
                    )}
                </div>
            )}
        </AnimatePresence>
    );

    return createPortal(modalContent, document.body);
};

export default SOPTemplateFormModal;
