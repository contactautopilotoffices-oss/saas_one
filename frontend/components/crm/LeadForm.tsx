'use client';

import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CRMLead, LeadStatusConfig, LeadSource, CreateLeadInput } from '@/frontend/types/crm';

import { Toast } from '@/frontend/components/ui/Toast';

interface LeadFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: CreateLeadInput) => Promise<void>;
    initialData?: CRMLead;
    mode: 'create' | 'edit';
}

export default function LeadForm({ isOpen, onClose, onSubmit, initialData, mode }: LeadFormProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [seats, setSeats] = useState<string>('');
    const [statuses, setStatuses] = useState<LeadStatusConfig[]>([]);
    const [sources, setSources] = useState<LeadSource[]>([]);
    const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
    const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; visible: boolean }>({
        message: '',
        type: 'success',
        visible: false
    });
    const [promptModal, setPromptModal] = useState<{
        isOpen: boolean;
        title: string;
        placeholder: string;
        value: string;
        onSubmit: (val: string) => void | Promise<void>;
    }>({
        isOpen: false,
        title: '',
        placeholder: '',
        value: '',
        onSubmit: () => {}
    });
    const [formData, setFormData] = useState<CreateLeadInput>({
        company_name: '',
        contact_person: '',
        contact_number: '',
        secondary_contact_number: '',
        email: '',
        location: '',
        requirement: '',
        property_interest: '',
        lead_source: '',
        deal_value: 0,
        status: '',
        priority: 'Medium',
        next_followup_date: '',
        followup_notes: '',
        remarks: '',
        assigned_to: ''
    });

    useEffect(() => {
        if (isOpen) {
            fetchConfigs();
            if (initialData) {
                // Read seats from the real column (falls back to a legacy token if present).
                const reqRaw = initialData.requirement || '';
                const seatMatch = reqRaw.match(/\[seats=(\d+)/);
                setSeats((initialData as any).seats != null ? String((initialData as any).seats) : (seatMatch ? seatMatch[1] : ''));
                const reqClean = reqRaw.replace(/^\[seats=\d+;bucket=[^\]]*\]\s*/, '');
                const propInterestVal = initialData.property_interest 
                    ? initialData.property_interest 
                    : (initialData.location ? `custom:${initialData.location}` : '');
                setFormData({
                    company_name: initialData.company_name || '',
                    contact_person: initialData.contact_person || '',
                    contact_number: initialData.contact_number || '',
                    secondary_contact_number: initialData.secondary_contact_number || '',
                    email: initialData.email || '',
                    location: initialData.location || '',
                    requirement: reqClean,
                    property_interest: propInterestVal,
                    lead_source: initialData.lead_source || '',
                    deal_value: initialData.deal_value || 0,
                    status: initialData.status || '',
                    priority: initialData.priority || 'Medium',
                    next_followup_date: initialData.next_followup_date?.split('T')[0] || '',
                    followup_notes: (initialData as any).followup_notes || '',
                    remarks: initialData.remarks || '',
                    assigned_to: initialData.assigned_to || ''
                });
            } else {
                setSeats('');
                setFormData({
                    company_name: '',
                    contact_person: '',
                    contact_number: '',
                    email: '',
                    location: '',
                    requirement: '',
                    property_interest: '',
                    lead_source: '',
                    deal_value: 0,
                    status: '',
                    priority: 'Medium',
                    next_followup_date: '',
                    followup_notes: '',
                    remarks: '',
                    assigned_to: ''
                });
            }
        }
    }, [isOpen, initialData]);

    const fetchConfigs = async () => {
        try {
            const res = await fetch('/api/crm/settings?type=all&scope=bd');
            if (res.ok) {
                const data = await res.json();
                setStatuses(data.statuses || []);
                setSources(data.sources || []);
                setUsers(data.users || []);
                setProperties(data.properties || []);
                // Set default status
                if (!initialData) {
                    const defaultStatus = data.statuses?.find((s: any) => s.name === 'New Lead');
                    if (defaultStatus) {
                        setFormData(prev => ({ ...prev, status: defaultStatus.id }));
                    }
                }
            }
        } catch (error) {
            console.error('Failed to fetch configs:', error);
        }
    };

    const handleChange = (field: keyof CreateLeadInput, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const seatNum = parseInt(seats);
            const propInterest = formData.property_interest?.startsWith('custom:')
                ? null
                : (formData.property_interest || null);
            const payload: any = {
                ...formData,
                property_interest: propInterest,
                seats: !isNaN(seatNum) && seatNum > 0 ? seatNum : null,
            };
            await onSubmit(payload);
            onClose();
        } catch (error) {
            console.error('Failed to submit:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="lead-form-modal"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                        onClick={onClose}
                    >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                        <h2 className="text-lg font-bold text-text-primary">
                            {mode === 'create' ? 'Add New Lead' : 'Edit Lead'}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-text-secondary" />
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
                        <div className="space-y-6">
                            {/* Basic Info */}
                            <div>
                                <h3 className="text-sm font-semibold text-text-primary mb-4">Basic Information</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Company Name
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.company_name}
                                            onChange={(e) => handleChange('company_name', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            placeholder="Enter company name"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Contact Person *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.contact_person}
                                            onChange={(e) => handleChange('contact_person', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            placeholder="Enter contact person name"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Contact Number
                                        </label>
                                        <input
                                            type="tel"
                                            value={formData.contact_number}
                                            onChange={(e) => handleChange('contact_number', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            placeholder="+91 98765 43210"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Secondary Contact Number
                                        </label>
                                        <input
                                            type="tel"
                                            value={formData.secondary_contact_number || ''}
                                            onChange={(e) => handleChange('secondary_contact_number', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            placeholder="+91 98765 43210"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Email
                                        </label>
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={(e) => handleChange('email', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            placeholder="contact@company.com"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Location
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.location}
                                            onChange={(e) => handleChange('location', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            placeholder="City, State"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Deal Info */}
                            <div>
                                <h3 className="text-sm font-semibold text-text-primary mb-4">Deal Information</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Deal Value (₹)
                                        </label>
                                        <input
                                            type="number"
                                            value={formData.deal_value}
                                            onChange={(e) => handleChange('deal_value', parseFloat(e.target.value) || 0)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Priority
                                        </label>
                                        <select
                                            value={formData.priority}
                                            onChange={(e) => handleChange('priority', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        >
                                            <option value="Low">Low</option>
                                            <option value="Medium">Medium</option>
                                            <option value="High">High</option>
                                            <option value="Urgent">Urgent</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Property Interest
                                        </label>                                         <select
                                            value={formData.property_interest || ''}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === '_ADD_NEW_') {
                                                    setPromptModal({
                                                        isOpen: true,
                                                        title: 'Add New Location / Property',
                                                        placeholder: 'e.g. Navi Mumbai, Andheri East...',
                                                        value: '',
                                                        onSubmit: (val) => {
                                                            const customId = `custom:${val}`;
                                                            // Dynamically add to property list in dropdown local state so it appears in the select list
                                                            setProperties(prev => {
                                                                if (prev.some(p => p.id === customId || p.name.toLowerCase() === val.toLowerCase())) {
                                                                    return prev;
                                                                }
                                                                return [...prev, { id: customId, name: val }].sort((a, b) => a.name.localeCompare(b.name));
                                                            });
                                                            handleChange('location', val);
                                                            handleChange('property_interest', customId);
                                                            setToast({
                                                                message: `Added "${val}" to Property Interest`,
                                                                type: 'success',
                                                                visible: true
                                                            });
                                                        }
                                                    });
                                                } else {
                                                    handleChange('property_interest', val);
                                                }
                                            }}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background text-text-primary"
                                        >
                                            <option value="">Select property</option>
                                            {properties.map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                            <option value="_ADD_NEW_" className="font-semibold text-primary">+ Add New Location / Unlisted Property</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Lead Source
                                        </label>
                                        <select
                                            value={formData.lead_source || ''}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === '_ADD_NEW_') {
                                                    setPromptModal({
                                                        isOpen: true,
                                                        title: 'Add New Lead Source',
                                                        placeholder: 'e.g. Referral, Newspaper, Banner...',
                                                        value: '',
                                                        onSubmit: async (val) => {
                                                            try {
                                                                const res = await fetch('/api/crm/settings', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ action: 'create_source', data: { name: val } })
                                                                });
                                                                if (res.ok) {
                                                                    const data = await res.json();
                                                                    setSources(prev => [...prev, data.source].sort((a, b) => a.name.localeCompare(b.name)));
                                                                    handleChange('lead_source', data.source.id);
                                                                    setToast({
                                                                        message: `Lead source "${val}" created`,
                                                                        type: 'success',
                                                                        visible: true
                                                                    });
                                                                } else {
                                                                    handleChange('lead_source', '');
                                                                    setToast({ message: 'Failed to create lead source', type: 'error', visible: true });
                                                                }
                                                            } catch (err) {
                                                                console.error('Failed to create source', err);
                                                                handleChange('lead_source', '');
                                                                setToast({ message: 'Error creating lead source', type: 'error', visible: true });
                                                            }
                                                        }
                                                    });
                                                } else {
                                                    handleChange('lead_source', val);
                                                }
                                            }}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background text-text-primary"
                                        >
                                            <option value="">Select source</option>
                                            {sources.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                            <option value="_ADD_NEW_" className="font-semibold text-primary">+ Add New Source</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Status & Assignment */}
                            <div>
                                <h3 className="text-sm font-semibold text-text-primary mb-4">Status & Assignment</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Status
                                        </label>
                                        <select
                                            value={formData.status || ''}
                                            onChange={(e) => handleChange('status', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        >
                                            <option value="">Select status</option>
                                            {statuses.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Assign To
                                        </label>
                                        <select
                                            value={formData.assigned_to || ''}
                                            onChange={(e) => handleChange('assigned_to', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        >
                                            <option value="">Unassigned</option>
                                            {users.map(u => (
                                                <option key={u.id} value={u.id}>{u.full_name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Next Follow-up Date
                                        </label>
                                        <input
                                            type="date"
                                            value={formData.next_followup_date}
                                            onChange={(e) => handleChange('next_followup_date', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        />
                                    </div>
                                </div>
                                {formData.next_followup_date && (
                                    <div className="mt-3">
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Follow-up Notes
                                        </label>
                                        <textarea
                                            value={(formData as any).followup_notes || ''}
                                            onChange={(e) => handleChange('followup_notes' as any, e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            rows={2}
                                            placeholder="What to discuss in the follow-up..."
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Requirement & Remarks */}
                            <div>
                                <h3 className="text-sm font-semibold text-text-primary mb-4">Additional Details</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Seat Requirement
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            value={seats}
                                            onChange={(e) => setSeats(e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            placeholder="e.g. 50"
                                        />
                                        {seats && !isNaN(parseInt(seats)) && parseInt(seats) > 0 && (
                                            <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                                {(() => { const n = parseInt(seats); return n < 25 ? '<25' : n <= 50 ? '25–50' : n <= 100 ? '50–100' : '100+'; })()} seats bucket
                                            </span>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Requirement
                                        </label>
                                        <textarea
                                            value={formData.requirement}
                                            onChange={(e) => handleChange('requirement', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            rows={3}
                                            placeholder="Describe the lead's requirements..."
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                                            Remarks
                                        </label>
                                        <textarea
                                            value={formData.remarks}
                                            onChange={(e) => handleChange('remarks', e.target.value)}
                                            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            rows={2}
                                            placeholder="Internal notes..."
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2.5 border border-border rounded-xl text-sm font-medium text-text-secondary hover:bg-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            {mode === 'create' ? 'Create Lead' : 'Save Changes'}
                        </button>
                    </div>
                </motion.div>
            </motion.div>
                )}
            </AnimatePresence>

            {/* Custom Stylish Prompt Modal */}
            <AnimatePresence>
                {promptModal.isOpen && (
                    <motion.div
                        key="prompt-dialog-modal"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-surface border border-border rounded-2xl p-6 shadow-2xl w-full max-w-md space-y-4"
                        >
                            <div className="flex items-center justify-between">
                                <h3 className="text-base font-semibold text-text-primary">{promptModal.title}</h3>
                                <button
                                    onClick={() => setPromptModal(prev => ({ ...prev, isOpen: false }))}
                                    className="p-1 text-text-tertiary hover:text-text-primary rounded-lg"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <input
                                type="text"
                                autoFocus
                                value={promptModal.value}
                                onChange={(e) => setPromptModal(prev => ({ ...prev, value: e.target.value }))}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (promptModal.value.trim()) {
                                            promptModal.onSubmit(promptModal.value.trim());
                                            setPromptModal(prev => ({ ...prev, isOpen: false }));
                                        }
                                    }
                                }}
                                placeholder={promptModal.placeholder}
                                className="w-full border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background text-text-primary"
                            />
                            <div className="flex items-center justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setPromptModal(prev => ({ ...prev, isOpen: false }))}
                                    className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-elevated rounded-xl transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    disabled={!promptModal.value.trim()}
                                    onClick={() => {
                                        if (promptModal.value.trim()) {
                                            promptModal.onSubmit(promptModal.value.trim());
                                            setPromptModal(prev => ({ ...prev, isOpen: false }));
                                        }
                                    }}
                                    className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50"
                                >
                                    Save
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <Toast
                message={toast.message}
                type={toast.type}
                visible={toast.visible}
                onClose={() => setToast(prev => ({ ...prev, visible: false }))}
            />
        </>
    );
}