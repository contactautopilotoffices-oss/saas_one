'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sparkles, CheckSquare, ShieldCheck, UserCheck, Bell, Save, Loader2, Info, MapPin, Camera, Search, ChevronDown, Check, X, MessageSquare, FlaskConical } from 'lucide-react';
import { Toast } from '@/frontend/components/ui/Toast';
import { SOPVisionTestingModal } from './SOPVisionTestingModal';

interface SOPChecklistSettingsSectionProps {
    propertyId: string;
    isAdmin?: boolean;
    isOrgSuperAdmin?: boolean;
}

interface Member {
    id: string;
    full_name: string;
    email: string;
    role?: string;
}

export const SOPChecklistSettingsSection: React.FC<SOPChecklistSettingsSectionProps> = ({
    propertyId,
    isAdmin = false,
    isOrgSuperAdmin = false,
}) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [members, setMembers] = useState<Member[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    // Settings State
    const [checklistMode, setChecklistMode] = useState<'basic' | 'advanced'>('basic');
    const [aiScoringEnabled, setAiScoringEnabled] = useState(false);
    const [cadEnabled, setCadEnabled] = useState(false);
    const [aiThreshold, setAiThreshold] = useState<number>(70);
    const [approverRequired, setApproverRequired] = useState(false);
    const [approverUserId, setApproverUserId] = useState<string | null>(null);

    // Searchable Approver Selector State
    const [approverSearch, setApproverSearch] = useState('');
    const [isApproverDropdownOpen, setIsApproverDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [reminderEnabled, setReminderEnabled] = useState(true);
    const [reminderLeadTime, setReminderLeadTime] = useState<number>(15);
    const [reminderChannels, setReminderChannels] = useState<string[]>(['push']);
    const [showVisionModal, setShowVisionModal] = useState(false);

    // Fetch initial settings
    useEffect(() => {
        if (!propertyId) return;

        const loadSettings = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/properties/${propertyId}/checklist-settings`);
                const data = await res.json();
                if (res.ok && data.settings) {
                    const s = data.settings;
                    const mode = s.checklist_mode || 'basic';
                    setChecklistMode(mode);
                    setAiScoringEnabled(mode === 'advanced' || !!s.ai_scoring_enabled);
                    setCadEnabled(mode === 'advanced' || !!s.cad_enabled);
                    setAiThreshold(s.ai_scoring_threshold ?? 70);
                    setApproverRequired(!!s.approver_required);
                    setApproverUserId(s.approver_user_id || null);
                    setReminderEnabled(s.reminder_enabled !== false);
                    setReminderLeadTime(s.reminder_lead_time_mins || 15);
                    setReminderChannels(s.reminder_channels || ['push']);
                }
            } catch (err) {
                console.error('Error fetching checklist settings:', err);
                setToast({ message: 'Failed to load checklist settings', type: 'error' });
            } finally {
                setLoading(false);
            }
        };

        const loadMembers = async () => {
            setLoadingMembers(true);
            try {
                const res = await fetch(`/api/users/list?propertyId=${propertyId}`);
                const data = await res.json();
                if (res.ok && data.users) {
                    setMembers(data.users);
                }
            } catch (err) {
                console.error('Error loading members:', err);
            } finally {
                setLoadingMembers(false);
            }
        };

        loadSettings();
        loadMembers();
    }, [propertyId]);

    // Handle outside click for searchable approver dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsApproverDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredMembers = useMemo(() => {
        if (!approverSearch.trim()) return members;
        const q = approverSearch.toLowerCase();
        return members.filter(m =>
            (m.full_name || '').toLowerCase().includes(q) ||
            (m.email || '').toLowerCase().includes(q) ||
            (m.role || '').toLowerCase().includes(q)
        );
    }, [members, approverSearch]);

    const selectedMember = useMemo(() => {
        return members.find(m => m.id === approverUserId);
    }, [members, approverUserId]);

    const handleModeChange = (mode: 'basic' | 'advanced') => {
        setChecklistMode(mode);
        if (mode === 'advanced') {
            setAiScoringEnabled(true);
            setCadEnabled(true);
        } else {
            setAiScoringEnabled(false);
            setCadEnabled(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload = {
                checklist_mode: checklistMode,
                ai_scoring_enabled: checklistMode === 'advanced',
                cad_enabled: checklistMode === 'advanced',
                ai_scoring_threshold: aiThreshold,
                approver_required: approverRequired,
                approver_user_id: approverRequired ? approverUserId : null,
                reminder_enabled: reminderEnabled,
                reminder_lead_time_mins: reminderLeadTime,
                reminder_channels: reminderChannels,
            };

            const res = await fetch(`/api/properties/${propertyId}/checklist-settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to save settings');

            setToast({ message: 'Checklist configuration saved successfully!', type: 'success' });
            // Notify other components if needed
            window.dispatchEvent(new Event('checklist_settings_updated'));
        } catch (err: any) {
            setToast({ message: err.message || 'Failed to update settings', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const toggleChannel = (channel: string) => {
        setReminderChannels(prev =>
            prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel]
        );
    };

    if (loading) {
        return (
            <div className="p-8 flex flex-col items-center justify-center min-h-[300px]">
                <Loader2 size={24} className="text-primary animate-spin mb-3" />
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Loading checklist settings…</p>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 md:p-8 max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-200">
                <div>
                    <h2 className="text-lg md:text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                        <Sparkles size={20} className="text-primary" />
                        Checklist & AI Inspection Settings
                    </h2>
                    <p className="text-xs text-slate-500 font-medium mt-1">
                        Configure AI cleanliness scoring, CAD floor plan verification, and approval workflows for this property.
                    </p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-5 py-2.5 bg-primary text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-primary/90 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 flex-shrink-0"
                >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save Configuration
                </button>
            </div>

            {/* Section 1: Checklist Mode Selection */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Operating Mode</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Advanced / AI Enabled Mode */}
                    <div
                        onClick={() => handleModeChange('advanced')}
                        className={`p-5 rounded-2xl border-2 cursor-pointer transition-all relative ${
                            checklistMode === 'advanced'
                                ? 'border-primary bg-primary/5 shadow-sm'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-primary">
                                <Sparkles size={20} />
                            </div>
                            {checklistMode === 'advanced' && (
                                <span className="px-2.5 py-0.5 rounded-full bg-primary text-white text-[9px] font-black uppercase tracking-wider">
                                    Active
                                </span>
                            )}
                        </div>
                        <h4 className="font-black text-sm text-slate-900 mb-1">AI-Enabled & CAD Mode (Advanced)</h4>
                        <p className="text-xs text-slate-500 leading-relaxed mb-4">
                            Enables 2D CAD floor plan mapping, clean reference benchmark photos, and automated AI vision inspections powered by Qwen 3.8 27B Vision.
                        </p>
                        <div className="space-y-1.5 pt-3 border-t border-slate-100 text-[11px] font-medium text-slate-600">
                            <div className="flex items-center gap-2">
                                <MapPin size={12} className="text-primary flex-shrink-0" />
                                <span>CAD floor plan upload & polygon drawing</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Camera size={12} className="text-primary flex-shrink-0" />
                                <span>Clean standard benchmark comparison</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Sparkles size={12} className="text-primary flex-shrink-0" />
                                <span>Per-parameter AI cleanliness evaluation</span>
                            </div>
                        </div>
                    </div>

                    {/* Basic / Standard Mode */}
                    <div
                        onClick={() => handleModeChange('basic')}
                        className={`p-5 rounded-2xl border-2 cursor-pointer transition-all relative ${
                            checklistMode === 'basic'
                                ? 'border-primary bg-primary/5 shadow-sm'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-600">
                                <CheckSquare size={20} />
                            </div>
                            {checklistMode === 'basic' && (
                                <span className="px-2.5 py-0.5 rounded-full bg-primary text-white text-[9px] font-black uppercase tracking-wider">
                                    Active
                                </span>
                            )}
                        </div>
                        <h4 className="font-black text-sm text-slate-900 mb-1">Standard Operational Mode (Basic)</h4>
                        <p className="text-xs text-slate-500 leading-relaxed mb-4">
                            Standard checklist execution. Staff check off steps, update parameters (Floor, Tables, Dustbin), and capture field photos with zero AI barrier.
                        </p>
                        <div className="space-y-1.5 pt-3 border-t border-slate-100 text-[11px] font-medium text-slate-600">
                            <div className="flex items-center gap-2">
                                <CheckSquare size={12} className="text-emerald-600 flex-shrink-0" />
                                <span>Steps & sub-parameters without CAD requirement</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Camera size={12} className="text-emerald-600 flex-shrink-0" />
                                <span>Direct field photo proof upload</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <ShieldCheck size={12} className="text-emerald-600 flex-shrink-0" />
                                <span>Optional Checker / Approver sign-off</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* AI Threshold Slider (only in advanced mode) */}
                {checklistMode === 'advanced' && (
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-black text-slate-700 uppercase tracking-widest">
                                AI Passing Threshold: <span className="text-primary font-mono">{aiThreshold}/100</span>
                            </label>
                            <span className="text-[10px] text-slate-400 font-medium">Steps scoring below this will be flagged as Needs Attention</span>
                        </div>
                        <input
                            type="range"
                            min="50"
                            max="90"
                            step="5"
                            value={aiThreshold}
                            onChange={(e) => setAiThreshold(parseInt(e.target.value, 10))}
                            className="w-full accent-primary cursor-pointer"
                        />
                    </div>
                )}
                {/* AI Vision Testing Sandbox Launcher - Org Super Admin Only */}
                {isOrgSuperAdmin && (
                    <div className="p-4 bg-gradient-to-r from-violet-50 to-indigo-50/70 rounded-2xl border border-violet-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
                                <FlaskConical size={18} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <p className="text-xs font-black text-violet-950">AI Vision Testing Lab & Sandbox</p>
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-violet-200 text-violet-800">Org Super Admin</span>
                                </div>
                                <p className="text-[11px] text-violet-700/80 font-medium">
                                    Upload clean reference photos against test photos, configure parameters, and test our vision scoring live.
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowVisionModal(true)}
                            className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm transition-all flex-shrink-0"
                        >
                            <Sparkles size={13} />
                            <span>Open Vision Lab</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Section 2: Checker / Approver Configuration */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Checker / Approver Sign-off</h3>
                </div>

                <div className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4 shadow-xs">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-black text-slate-900">Require Checklist Approval</p>
                            <p className="text-[11px] text-slate-500 font-medium">
                                When enabled, completed checklists must be reviewed and approved step-by-step by an assigned Checker.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setApproverRequired(!approverRequired)}
                            className={`w-12 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                                approverRequired ? 'bg-primary' : 'bg-slate-300'
                            }`}
                        >
                            <div
                                className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                                    approverRequired ? 'translate-x-6' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </div>

                    {approverRequired && (
                        <div className="pt-4 border-t border-slate-100 space-y-2">
                            <label className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
                                <UserCheck size={14} className="text-primary" />
                                Assigned Checker / Approver
                            </label>
                            {loadingMembers ? (
                                <p className="text-xs text-slate-400">Loading members…</p>
                            ) : (
                                <div className="relative" ref={dropdownRef}>
                                    {/* Trigger Button */}
                                    <div
                                        onClick={() => setIsApproverDropdownOpen((prev) => !prev)}
                                        className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl flex items-center justify-between cursor-pointer transition-all"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            {selectedMember ? (
                                                <>
                                                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-black uppercase flex-shrink-0">
                                                        {selectedMember.full_name?.charAt(0) || 'U'}
                                                    </div>
                                                    <span className="text-xs font-bold text-slate-800 truncate">
                                                        {selectedMember.full_name}
                                                    </span>
                                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 flex-shrink-0">
                                                        {selectedMember.role || 'Member'}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                                                        ({selectedMember.email})
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="text-xs text-slate-400">
                                                    Select an approver (or any Property Admin / Ops Manager)
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                            {selectedMember && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setApproverUserId(null);
                                                    }}
                                                    className="p-1 hover:bg-slate-200 rounded-md text-slate-400 hover:text-slate-600 transition-colors"
                                                    title="Clear selection"
                                                >
                                                    <X size={12} />
                                                </button>
                                            )}
                                            <ChevronDown
                                                size={14}
                                                className={`text-slate-400 transition-transform ${isApproverDropdownOpen ? 'rotate-180' : ''}`}
                                            />
                                        </div>
                                    </div>

                                    {/* Popover Dropdown with Search */}
                                    {isApproverDropdownOpen && (
                                        <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
                                            {/* Search Input */}
                                            <div className="p-2 border-b border-slate-100 bg-slate-50/70 flex items-center gap-2">
                                                <Search size={14} className="text-slate-400 flex-shrink-0 ml-1" />
                                                <input
                                                    type="text"
                                                    value={approverSearch}
                                                    onChange={(e) => setApproverSearch(e.target.value)}
                                                    placeholder="Search approver by name, email, or role..."
                                                    className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
                                                    autoFocus
                                                />
                                                {approverSearch && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setApproverSearch('')}
                                                        className="text-slate-400 hover:text-slate-600 p-0.5"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                )}
                                            </div>

                                            {/* Members List */}
                                            <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                                                <div
                                                    onClick={() => {
                                                        setApproverUserId(null);
                                                        setIsApproverDropdownOpen(false);
                                                    }}
                                                    className={`px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 flex items-center justify-between transition-colors ${
                                                        !approverUserId ? 'bg-primary/5 text-primary font-bold' : 'text-slate-500'
                                                    }`}
                                                >
                                                    <span>Any Property Admin / Ops Manager (Default)</span>
                                                    {!approverUserId && <Check size={14} className="text-primary" />}
                                                </div>

                                                {filteredMembers.length === 0 ? (
                                                    <div className="px-4 py-3 text-center text-xs text-slate-400">
                                                        No members match "{approverSearch}"
                                                    </div>
                                                ) : (
                                                    filteredMembers.map((m) => {
                                                        const isSelected = approverUserId === m.id;
                                                        return (
                                                            <div
                                                                key={m.id}
                                                                onClick={() => {
                                                                    setApproverUserId(m.id);
                                                                    setIsApproverDropdownOpen(false);
                                                                    setApproverSearch('');
                                                                }}
                                                                className={`px-3 py-2.5 text-xs cursor-pointer hover:bg-slate-50 flex items-center justify-between transition-colors ${
                                                                    isSelected ? 'bg-primary/5 text-primary font-bold' : 'text-slate-800'
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-black uppercase flex-shrink-0">
                                                                        {m.full_name?.charAt(0) || 'U'}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="truncate">{m.full_name}</span>
                                                                            <span className="text-[8px] font-black uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200/60 flex-shrink-0">
                                                                                {m.role || 'Member'}
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-[10px] text-slate-400 truncate">{m.email}</p>
                                                                    </div>
                                                                </div>
                                                                {isSelected && <Check size={14} className="text-primary flex-shrink-0 ml-2" />}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            <p className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                                <Info size={11} />
                                The assigned checker will receive an alert when a checklist is submitted and can approve or reject each step with notes.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Section 3: Omnichannel Reminders */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Reminders & Dispatch Alerts</h3>
                </div>

                <div className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4 shadow-xs">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-black text-slate-900">Pre-Schedule Reminders</p>
                            <p className="text-[11px] text-slate-500 font-medium">
                                Automatically notify assigned staff before their scheduled checklist window begins.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setReminderEnabled(!reminderEnabled)}
                            className={`w-12 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                                reminderEnabled ? 'bg-primary' : 'bg-slate-300'
                            }`}
                        >
                            <div
                                className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                                    reminderEnabled ? 'translate-x-6' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </div>

                    {reminderEnabled && (
                        <div className="pt-4 border-t border-slate-100 space-y-4">
                            <div>
                                <label className="text-[11px] font-black text-slate-700 uppercase tracking-wider block mb-1.5">
                                    Reminder Lead Time
                                </label>
                                <div className="flex gap-2">
                                    {[15, 30, 60].map((mins) => (
                                        <button
                                            key={mins}
                                            type="button"
                                            onClick={() => setReminderLeadTime(mins)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                reminderLeadTime === mins
                                                    ? 'bg-primary text-white shadow-xs'
                                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                            }`}
                                        >
                                            {mins} Minutes Before
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-[11px] font-black text-slate-700 uppercase tracking-wider block mb-1.5">
                                    Alert Channels
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { id: 'push', label: 'In-App / Push' },
                                        { id: 'whatsapp', label: 'WhatsApp' },
                                        { id: 'email', label: 'Email' },
                                    ].map((ch) => (
                                        <button
                                            key={ch.id}
                                            type="button"
                                            onClick={() => toggleChannel(ch.id)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                                reminderChannels.includes(ch.id)
                                                    ? 'bg-emerald-600 text-white shadow-xs'
                                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                            }`}
                                        >
                                            <Bell size={12} />
                                            {ch.label}
                                        </button>
                                    ))}
                                </div>

                                {reminderChannels.includes('whatsapp') && (
                                    <div className="mt-2.5 p-2.5 bg-amber-50/80 border border-amber-200 rounded-xl flex items-start gap-2">
                                        <Info size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                                        <p className="text-[11px] text-amber-900 leading-snug">
                                            <span className="font-bold">Omnichannel Event Outbox:</span> WhatsApp notifications are routed asynchronously via <code className="px-1 py-0.5 bg-amber-100/90 rounded text-[10px] font-mono">public.event_outbox</code> and AiSensy. Outbound WhatsApp messages require an approved Meta template (e.g. <code className="px-1 py-0.5 bg-amber-100/90 rounded text-[10px] font-mono">sop_shift_reminder</code>).
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Save Action */}
            <div className="pt-4 flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-3 bg-primary text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-primary/90 transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
                >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Save Configuration
                </button>
            </div>

            {/* AI Vision Testing Modal - Org Super Admin Only */}
            {isOrgSuperAdmin && (
                <SOPVisionTestingModal
                    isOpen={showVisionModal}
                    onClose={() => setShowVisionModal(false)}
                    propertyId={propertyId}
                />
            )}

            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    visible={true}
                    onClose={() => setToast(null)}
                    duration={3000}
                />
            )}
        </div>
    );
};
