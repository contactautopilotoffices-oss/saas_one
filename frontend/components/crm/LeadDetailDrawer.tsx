'use client';

import React, { useState, useEffect } from 'react';
import {
    X, Phone, Mail, MapPin, Building, Calendar, User, Users, DollarSign,
    Edit, Trash2, PhoneCall, Video, Map, FileText, MessageSquare,
    Clock, ChevronRight, Plus, CheckCircle, CalendarPlus, Pencil, Save,
    FileSignature, LayoutGrid, MapPin as MapPinIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CRMLead, CRMActivity, CRMNote, CRMEvent, TimelineItem, LeadStatusConfig, LeadSource, EventType } from '@/frontend/types/crm';
import StagePipeline from '@/frontend/components/crm/StagePipeline';
import AddEventModal from '@/frontend/components/crm/AddEventModal';
import CallCoachPanel from '@/frontend/components/crm/CallCoachPanel';
import { getStageVisual, COMMENT_REQUIRED_STAGES } from '@/frontend/lib/crm/stages';
import { getSourceVisual } from '@/frontend/lib/crm/sourceIcons';
import { TextShimmer } from '@/frontend/components/ui/text-shimmer';
import { Toast } from '@/frontend/components/ui/Toast';

interface LeadDetailDrawerProps {
    leadId: string | null;
    isOpen: boolean;
    onClose: () => void;
    onLeadUpdate?: (lead: CRMLead) => void;
}

const EVENT_TYPE_META: Record<string, { title: string; activityType: string }> = {
    call: { title: 'Call', activityType: 'call' },
    meeting: { title: 'Meeting', activityType: 'meeting' },
    site_visit: { title: 'Site Visit', activityType: 'site_visit' },
    followup: { title: 'Follow-up', activityType: 'followup_scheduled' },
};

const ACTIVITY_ICONS: Record<string, any> = {
    created: Plus,
    updated: Edit,
    call: PhoneCall,
    meeting: Video,
    site_visit: Map,
    proposal_sent: FileText,
    followup_scheduled: Calendar,
    status_changed: CheckCircle,
    assigned: User,
    note_added: MessageSquare,
    email_sent: Mail,
    archived: Trash2,
    restored: CheckCircle
};

// Semantic dot colors for the tickets-style waterfall timeline.
const ACTIVITY_DOT_COLORS: Record<string, string> = {
    created: '#6B7280',          // gray
    updated: '#6B7280',
    call: '#06B6D4',             // cyan
    meeting: '#8B5CF6',          // violet
    site_visit: '#F59E0B',       // amber
    proposal_sent: '#3B82F6',    // blue
    followup_scheduled: '#F97316', // orange
    status_changed: '#22C55E',   // green
    assigned: '#0EA5E9',         // sky
    note_added: '#64748B',       // slate
    email_sent: '#A855F7',       // purple
    archived: '#EF4444',         // red
    restored: '#22C55E',
};

export default function LeadDetailDrawer({ leadId, isOpen, onClose, onLeadUpdate }: LeadDetailDrawerProps) {
    const [lead, setLead] = useState<CRMLead | null>(null);
    const [activities, setActivities] = useState<CRMActivity[]>([]);
    const [notes, setNotes] = useState<CRMNote[]>([]);
    const [events, setEvents] = useState<CRMEvent[]>([]);
    const [statuses, setStatuses] = useState<LeadStatusConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'calls' | 'notes'>('overview');
    const [newNote, setNewNote] = useState('');
    const [isAddingNote, setIsAddingNote] = useState(false);
    const [isChangingStatus, setIsChangingStatus] = useState(false);
    const [popupStage, setPopupStage] = useState<string | null>(null);
    const [addEvent, setAddEvent] = useState<{ open: boolean; type: EventType; title?: string; requireFuture?: boolean }>(
        { open: false, type: 'meeting' }
    );
    const [editingRequirement, setEditingRequirement] = useState(false);
    const [editingRemarks, setEditingRemarks] = useState(false);
    const [requirementDraft, setRequirementDraft] = useState('');
    const [remarksDraft, setRemarksDraft] = useState('');
    const [savingRequirement, setSavingRequirement] = useState(false);
    const [savingRemarks, setSavingRemarks] = useState(false);
    const [stageComment, setStageComment] = useState<{ open: boolean; statusId: string; statusName: string; comment: string }>({ open: false, statusId: '', statusName: '', comment: '' });
    const [savingStageComment, setSavingStageComment] = useState(false);
    const [editingActivity, setEditingActivity] = useState<{ id: string; description: string } | null>(null);
    const [savingActivity, setSavingActivity] = useState(false);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [fieldDraft, setFieldDraft] = useState('');
    const [savingField, setSavingField] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; visible: boolean }>({
        message: '',
        type: 'success',
        visible: false
    });

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToast({ message, type, visible: true });
    };

    const saveField = async (field: keyof CRMLead) => {
        if (!lead) {
            setEditingField(null);
            return;
        }
        const valToSend = field === 'seats'
            ? (fieldDraft !== '' && !isNaN(Number(fieldDraft)) ? Number(fieldDraft) : null)
            : (fieldDraft || null);

        if (valToSend === (lead[field] ?? null)) {
            setEditingField(null);
            return;
        }
        setSavingField(true);
        try {
            const res = await fetch(`/api/crm/leads/${lead.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: valToSend }),
            });
            if (res.ok) {
                const data = await res.json().catch(() => null);
                const updated = data?.lead ? data.lead : ({ ...lead, [field]: valToSend } as CRMLead);
                setLead(updated);
                onLeadUpdate?.(updated);

                const fieldNames: Record<string, string> = {
                    deal_value: 'Deal Value',
                    priority: 'Priority',
                    property_interest: 'Property Interest',
                    move_in_timeline: 'Move-in Timeline',
                    lead_source: 'Lead Source',
                    company_name: 'Company Name',
                    contact_person: 'Contact Person',
                    contact_number: 'Primary Contact Number',
                    secondary_contact_number: 'Secondary Contact Number',
                    email: 'Email',
                    location: 'City/Location',
                    seats: 'Seat Requirement'
                };
                const labelName = fieldNames[field as string] || String(field).replace(/_/g, ' ');
                showToast(`${labelName} updated successfully!`);
            } else {
                showToast('Failed to update field', 'error');
            }
        } catch {
            showToast('Error saving changes', 'error');
        }
        setSavingField(false);
        setEditingField(null);
    };

    const renderEditable = (label: string, field: keyof CRMLead, val: any, icon: React.ReactNode) => {
        const isEditing = editingField === field;
        return (
            <div className="flex items-start gap-3 group">
                <div className="mt-0.5 text-text-tertiary">{icon}</div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-tertiary">{label}</p>
                    {isEditing ? (
                        <div className="flex items-center gap-1.5 mt-1">
                            <input
                                autoFocus
                                type="text"
                                value={fieldDraft}
                                onChange={(e) => setFieldDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveField(field);
                                    if (e.key === 'Escape') setEditingField(null);
                                }}
                                disabled={savingField}
                                className="w-full min-w-0 px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                            />
                            <button onClick={() => saveField(field)} disabled={savingField} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded shrink-0">
                                <CheckCircle className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditingField(null)} disabled={savingField} className="p-1 text-red-600 hover:bg-red-50 rounded shrink-0">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-sm font-medium text-text-primary break-words">{val || '–'}</p>
                            <button
                                onClick={() => { setFieldDraft(val || ''); setEditingField(field); }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-opacity"
                            >
                                <Pencil className="w-3.5 h-3.5 text-text-tertiary" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };
    // Reassignment (admins + reps)
    const [formResponses, setFormResponses] = useState<{ question: string; answer: string }[]>([]);
    const [reps, setReps] = useState<{ id: string; full_name?: string; email?: string }[]>([]);
    const [showReassign, setShowReassign] = useState(false);
    const [reassigning, setReassigning] = useState(false);
    // Note editing state
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [savingNote, setSavingNote] = useState(false);
    const [availableSources, setAvailableSources] = useState<LeadSource[]>([]);
    const [availableProperties, setAvailableProperties] = useState<{ id: string; name: string }[]>([]);

    useEffect(() => {
        if (!isOpen) return;
        fetch('/api/crm/settings?type=all&scope=bd')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.sources) setAvailableSources(data.sources);
                if (data?.properties) setAvailableProperties(data.properties);
            })
            .catch(() => {});
    }, [isOpen]);

    const handleSaveNoteEdit = async (noteId: string) => {
        if (!noteDraft.trim()) return;
        setSavingNote(true);
        try {
            const res = await fetch('/api/crm/notes', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: noteId, note: noteDraft.trim() })
            });
            if (res.ok) {
                const data = await res.json();
                setNotes(prev => prev.map(n => n.id === noteId ? { ...n, note: data.note.note } : n));
                setEditingNoteId(null);
                showToast('Note updated successfully!');
            }
        } catch (err) {
            console.error('Failed to update note:', err);
            showToast('Failed to update note', 'error');
        } finally {
            setSavingNote(false);
        }
    };

    const handleDeleteNote = async (noteId: string) => {
        if (!confirm('Are you sure you want to delete this note?')) return;
        try {
            const res = await fetch(`/api/crm/notes?id=${noteId}`, { method: 'DELETE' });
            if (res.ok) {
                setNotes(prev => prev.filter(n => n.id !== noteId));
                showToast('Note deleted successfully!');
            }
        } catch (err) {
            console.error('Failed to delete note:', err);
            showToast('Failed to delete note', 'error');
        }
    };

    useEffect(() => {
        if (leadId && isOpen) {
            fetchLeadDetails();
        }
    }, [leadId, isOpen]);

    // Load the org's lifecycle stages once for the pipeline.
    useEffect(() => {
        if (!isOpen) return;
        fetch('/api/crm/statuses?scope=org')
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?.statuses) setStatuses(data.statuses); })
            .catch(() => {});
    }, [isOpen]);

    // Auto-dismiss the "status updated" icon popup.
    useEffect(() => {
        if (!popupStage) return;
        const t = setTimeout(() => setPopupStage(null), 1800);
        return () => clearTimeout(t);
    }, [popupStage]);

    const fetchLeadDetails = async () => {
        if (!leadId) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/crm/leads/${leadId}`);
            if (res.ok) {
                const data = await res.json();
                setLead(data.lead);
                setActivities(data.activities || []);
                setNotes(data.notes || []);
                setEvents(data.events || []);
                setFormResponses(data.form_responses || []);
            }
        } catch (error) {
            console.error('Failed to fetch lead details:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddNote = async () => {
        if (!leadId || !newNote.trim()) return;
        setIsAddingNote(true);
        try {
            const res = await fetch('/api/crm/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lead_id: leadId, note: newNote })
            });
            if (res.ok) {
                const data = await res.json();
                setNotes(prev => [data.note, ...prev]);
                setActivities(prev => [{
                    id: `temp-${Date.now()}`,
                    lead_id: leadId,
                    user_id: '',
                    activity_type: 'note_added',
                    description: 'Note added',
                    metadata: {},
                    created_at: new Date().toISOString(),
                    user_info: { id: '', full_name: 'You', email: '' }
                } as CRMActivity, ...prev]);
                setNewNote('');
                showToast('Note added successfully!');
            }
        } catch (error) {
            console.error('Failed to add note:', error);
            showToast('Failed to add note', 'error');
        } finally {
            setIsAddingNote(false);
        }
    };

    const handleStageChange = async (statusId: string) => {
        if (!leadId || !lead || statusId === lead.status || isChangingStatus) return;
        const target = statuses.find(s => s.id === statusId);
        if (!target) return;

        if (COMMENT_REQUIRED_STAGES.includes(target.name.toLowerCase().trim())) {
            setStageComment({ open: true, statusId, statusName: target.name, comment: '' });
            return;
        }

        await executeStageChange(statusId, target);
    };

    // Load BD reps for the reassign picker (once, when drawer opens).
    useEffect(() => {
        if (!isOpen) return;
        (async () => {
            try {
                const res = await fetch('/api/crm/settings?type=all&scope=bd');
                if (res.ok) setReps((await res.json()).users || []);
            } catch { /* non-fatal */ }
        })();
    }, [isOpen]);

    const handleReassign = async (userId: string | null) => {
        if (!leadId || !lead) return;
        setReassigning(true);
        try {
            const res = await fetch(`/api/crm/leads/${leadId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assigned_to: userId }),
            });
            if (!res.ok) return;
            const rep = reps.find(r => r.id === userId) || null;
            const updated: any = { ...lead, assigned_to: userId, assigned_user: rep ? { id: rep.id, full_name: rep.full_name, email: rep.email } : null };
            setLead(updated);
            onLeadUpdate?.(updated);
            setShowReassign(false);
            showToast(rep ? `Lead reassigned to ${rep.full_name || rep.email}` : 'Lead unassigned');
            setActivities(prev => [{
                id: `temp-${Date.now()}`, lead_id: leadId, user_id: '',
                activity_type: 'updated', description: rep ? `Reassigned to ${rep.full_name}` : 'Unassigned',
                metadata: {}, created_at: new Date().toISOString(),
                user_info: { id: '', full_name: 'You', email: '' },
            } as CRMActivity, ...prev]);
        } finally {
            setReassigning(false);
        }
    };

    const executeStageChange = async (statusId: string, target: LeadStatusConfig, comment?: string) => {
        if (!leadId || !lead) return;
        setIsChangingStatus(true);
        try {
            const res = await fetch(`/api/crm/leads/${leadId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: statusId }),
            });
            if (!res.ok) return;
            const updated: CRMLead = { ...lead, status: statusId, status_info: { ...(lead.status_info as any), ...target } };
            setLead(updated);
            onLeadUpdate?.(updated);
            showToast(`Stage updated to "${target.name}"`);
            const desc = comment
                ? `Status changed to ${target.name} — ${comment}`
                : `Status changed to ${target.name}`;
            setActivities(prev => [{
                id: `temp-${Date.now()}`, lead_id: leadId, user_id: '',
                activity_type: 'status_changed', description: desc,
                metadata: {}, created_at: new Date().toISOString(),
                user_info: { id: '', full_name: 'You', email: '' },
            } as CRMActivity, ...prev]);
            if (comment) {
                try {
                    await fetch('/api/crm/notes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ lead_id: leadId, note: `[${target.name}] ${comment}` }),
                    });
                } catch {}
            }
            setPopupStage(target.name);
            if (/future/i.test(target.name)) {
                setAddEvent({
                    open: true, type: 'followup', requireFuture: true,
                    title: `Future follow-up: ${lead.company_name || lead.contact_person || 'Lead'}`,
                });
            }
        } catch (e) {
            console.error('Failed to change stage:', e);
        } finally {
            setIsChangingStatus(false);
        }
    };

    const handleStageCommentSubmit = async () => {
        if (!stageComment.comment.trim()) return;
        const target = statuses.find(s => s.id === stageComment.statusId);
        if (!target) return;
        setSavingStageComment(true);
        await executeStageChange(stageComment.statusId, target, stageComment.comment.trim());
        setSavingStageComment(false);
        setStageComment({ open: false, statusId: '', statusName: '', comment: '' });
    };

    const handleLogTimelineAction = async (actionType: string, actionLabel: string) => {
        if (!leadId || !lead) return;
        try {
            await fetch('/api/crm/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lead_id: leadId, note: `[${actionLabel}] logged` }),
            });
            setActivities(prev => [{
                id: `temp-${Date.now()}`, lead_id: leadId, user_id: '',
                activity_type: actionType as any,
                description: `${actionLabel} logged`,
                metadata: {}, created_at: new Date().toISOString(),
                user_info: { id: '', full_name: 'You', email: '' },
            } as CRMActivity, ...prev]);
        } catch {}
    };

    // Timeline items carry a type prefix ("a-<id>"); the API needs the raw id.
    const rawActivityId = (timelineId: string) => timelineId.replace(/^a-/, '');

    const handleSaveActivityEdit = async () => {
        if (!editingActivity || !leadId) return;
        const id = rawActivityId(editingActivity.id);
        setSavingActivity(true);
        try {
            const res = await fetch(`/api/crm/activities/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: editingActivity.description }),
            });
            if (res.ok) {
                setActivities(prev => prev.map(a => a.id === id ? { ...a, description: editingActivity.description } : a));
                setEditingActivity(null);
            }
        } catch {}
        setSavingActivity(false);
    };

    const handleDeleteActivity = async (timelineId: string) => {
        const id = rawActivityId(timelineId);
        // Optimistic remove; restore on failure.
        const prev = activities;
        setActivities(prev.filter(a => a.id !== id));
        setEditingActivity(curr => (curr?.id === timelineId ? null : curr));
        try {
            const res = await fetch(`/api/crm/activities/${id}`, { method: 'DELETE' });
            if (!res.ok) setActivities(prev);
        } catch {
            setActivities(prev);
        }
    };

    const handleEventCreated = (event: CRMEvent) => {
        setEvents(prev => [event, ...prev]);
        const meta = EVENT_TYPE_META[event.event_type];
        setActivities(prev => [{
            id: `temp-evt-${Date.now()}`, lead_id: leadId || '', user_id: '',
            activity_type: (meta?.activityType || 'updated') as any,
            description: `${meta?.title || 'Event'} scheduled: ${event.title}`,
            metadata: {}, created_at: event.start_datetime,
            user_info: { id: '', full_name: 'You', email: '' },
        } as CRMActivity, ...prev]);
    };

    const formatDate = (date: string) => {
        return new Date(date).toLocaleString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0
        }).format(value);
    };

    // Merge activities + notes (comments) into one chronological waterfall —
    // mirrors how the tickets module shows a ticket's sequence of events.
    const buildTimeline = (): (TimelineItem & { activityType: string })[] => {
        const items: (TimelineItem & { activityType: string })[] = [];

        activities.forEach(activity => {
            const Icon = ACTIVITY_ICONS[activity.activity_type] || Edit;
            items.push({
                id: `a-${activity.id}`,
                type: 'activity',
                timestamp: activity.created_at,
                title: activity.activity_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                description: activity.description,
                icon: Icon.name,
                user: activity.user_info,
                activityType: activity.activity_type,
            });
        });

        notes.forEach(note => {
            items.push({
                id: `n-${note.id}`,
                type: 'note',
                timestamp: note.created_at,
                title: 'Comment',
                description: note.note,
                icon: 'MessageSquare',
                user: note.user_info,
                activityType: 'note_added',
            });
        });

        events.forEach(event => {
            const meta = EVENT_TYPE_META[event.event_type] || { title: 'Event', activityType: 'updated' };
            const Icon = ACTIVITY_ICONS[meta.activityType] || Calendar;
            items.push({
                id: `e-${event.id}`,
                type: 'event',
                timestamp: event.start_datetime,
                title: `${meta.title}${event.status && event.status !== 'scheduled' ? ` · ${event.status}` : ''}`,
                description: [event.title, event.description].filter(Boolean).join(' — '),
                icon: Icon.name,
                user: undefined,
                activityType: meta.activityType,
            });
        });

        // Oldest → newest, so the lead reads as a real interaction log top to bottom.
        return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    };

    if (!isOpen) return null;

    const currentLeadName = lead?.company_name || lead?.contact_person || 'Lead';

    return (
        <>
        <AnimatePresence>
            <motion.div
                key="lead-drawer-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 z-50"
                onClick={onClose}
            />
            <motion.div
                key="lead-drawer-panel"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-surface shadow-2xl z-50 flex flex-col"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div>
                        <h2 className="text-lg font-bold text-text-primary">
                            {lead?.company_name || lead?.contact_person || 'Lead Details'}
                        </h2>
                        {lead?.status_info && (() => {
                            const v = getStageVisual(lead.status_info.name);
                            const Icon = v.icon;
                            return (
                                <div
                                    className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-0.5 rounded-full"
                                    style={{ backgroundColor: `${v.color}1A`, color: v.color }}
                                >
                                    <Icon className="w-3.5 h-3.5" />
                                    <span className="text-xs font-bold">{lead.status_info.name}</span>
                                </div>
                            );
                        })()}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="p-2 hover:bg-muted rounded-xl transition-colors"
                    >
                        <X className="w-5 h-5 text-text-secondary" />
                    </button>
                </div>

                {/* Lifecycle pipeline (Amazon-style, click any stage to move the lead) */}
                {lead && statuses.length > 0 && (
                    <div className="px-5 py-3 border-b border-border bg-surface-elevated/60" data-tour="lead-pipeline">
                        <StagePipeline
                            statuses={statuses}
                            currentStatusId={lead.status}
                            onChange={handleStageChange}
                            isUpdating={isChangingStatus}
                        />
                    </div>
                )}

                {/* Tabs */}
                <div className="flex border-b border-border" data-tour="lead-tabs">
                    {(['overview', 'timeline', 'calls', 'notes'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                                activeTab === tab
                                    ? 'text-primary border-b-2 border-primary'
                                    : 'text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            {tab === 'calls' ? 'Calls & Coaching' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                            <TextShimmer duration={1.2} className="text-sm font-bold" baseColor="#64748b" gradientColor="#cbd5e1">
                                Loading lead details…
                            </TextShimmer>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'overview' && lead && (
                                <div className="space-y-6">
                                    {/* Lead Info */}
                                    <div className="bg-surface-elevated rounded-xl p-4 space-y-4" data-tour="lead-contact-info">
                                        <h3 className="font-bold text-text-primary">Contact Information</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            {lead.contact_person && (
                                                <div className="flex items-center gap-3">
                                                    <User className="w-4 h-4 text-text-tertiary" />
                                                    <div>
                                                        <p className="text-xs text-text-tertiary">Contact Person</p>
                                                        <p className="text-sm font-medium text-text-primary">{lead.contact_person}</p>
                                                    </div>
                                                </div>
                                            )}
                                            {renderEditable('Primary Contact', 'contact_number', lead.contact_number, <Phone className="w-4 h-4" />)}
                                            {renderEditable('Secondary Contact', 'secondary_contact_number', lead.secondary_contact_number, <Phone className="w-4 h-4" />)}
                                            {renderEditable('Email', 'email', lead.email, <Mail className="w-4 h-4" />)}
                                            {renderEditable('City/Location', 'location', lead.location, <MapPin className="w-4 h-4" />)}
                                            {renderEditable('Seat Requirement', 'seats', lead.seats, <Users className="w-4 h-4" />)}
                                        </div>
                                    </div>

                                    {/* Follow-up */}
                                    <div className="bg-surface-elevated rounded-xl p-4 space-y-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <h3 className="font-bold text-text-primary">Follow-up</h3>
                                            {(lead.next_followup_date || lead.followup_notes) && (
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        try {
                                                            const res = await fetch(`/api/crm/leads/${lead.id}`, {
                                                                method: 'PATCH',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({
                                                                    next_followup_date: null,
                                                                    last_contacted: new Date().toISOString(),
                                                                }),
                                                            });
                                                            if (res.ok) {
                                                                const updated: CRMLead = {
                                                                    ...lead,
                                                                    next_followup_date: undefined,
                                                                    last_contacted: new Date().toISOString(),
                                                                };
                                                                setLead(updated);
                                                                onLeadUpdate?.(updated);
                                                            }
                                                        } catch {}
                                                    }}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition-colors shrink-0"
                                                    title="Mark this follow-up done — records the contact and clears the date"
                                                >
                                                    <CheckCircle className="w-3.5 h-3.5" /> Mark done
                                                </button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-xs text-text-tertiary block mb-1">Next Follow-up Date</label>
                                                <input
                                                    type="date"
                                                    value={lead.next_followup_date?.slice(0, 10) || ''}
                                                    onChange={async (e) => {
                                                        const val = e.target.value || null;
                                                        try {
                                                            const res = await fetch(`/api/crm/leads/${lead.id}`, {
                                                                method: 'PATCH',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ next_followup_date: val }),
                                                            });
                                                            if (res.ok) {
                                                                const updated: CRMLead = { ...lead, next_followup_date: val || undefined };
                                                                setLead(updated);
                                                                onLeadUpdate?.(updated);
                                                            }
                                                        } catch {}
                                                    }}
                                                    className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-text-tertiary block mb-1">Follow-up Notes</label>
                                                <input
                                                    type="text"
                                                    placeholder="Add notes..."
                                                    defaultValue={lead.followup_notes || ''}
                                                    onBlur={async (e) => {
                                                        const val = e.target.value || null;
                                                        if (val === (lead.followup_notes || null)) return;
                                                        try {
                                                            const res = await fetch(`/api/crm/leads/${lead.id}`, {
                                                                method: 'PATCH',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({ followup_notes: val }),
                                                            });
                                                            if (res.ok) {
                                                                const updated: CRMLead = { ...lead, followup_notes: val || undefined };
                                                                setLead(updated);
                                                                onLeadUpdate?.(updated);
                                                            }
                                                        } catch {}
                                                    }}
                                                    className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Deal Info */}
                                    <div className="bg-surface-elevated rounded-xl p-4 space-y-4">
                                        <h3 className="font-bold text-text-primary">Deal Information</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            {renderEditable('Deal Value', 'deal_value', lead.deal_value ? formatCurrency(lead.deal_value) : '₹0', <DollarSign className="w-4 h-4" />)}
                                            <div>
                                                <p className="text-xs text-text-tertiary">Priority</p>
                                                {editingField === 'priority' ? (
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <select
                                                            autoFocus
                                                            value={fieldDraft}
                                                            onChange={(e) => setFieldDraft(e.target.value)}
                                                            className="px-2 py-1 text-sm border border-border rounded bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                                        >
                                                            <option value="Low">Low</option>
                                                            <option value="Medium">Medium</option>
                                                            <option value="High">High</option>
                                                            <option value="Urgent">Urgent</option>
                                                        </select>
                                                        <button onClick={() => saveField('priority')} disabled={savingField} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded shrink-0">
                                                            <CheckCircle className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => setEditingField(null)} disabled={savingField} className="p-1 text-red-600 hover:bg-red-50 rounded shrink-0">
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 mt-0.5 group">
                                                        <p className={`text-sm font-medium ${
                                                            lead.priority === 'Urgent' ? 'text-red-600' :
                                                            lead.priority === 'High' ? 'text-orange-600' :
                                                            'text-text-primary'
                                                        }`}>{lead.priority}</p>
                                                        <button
                                                            onClick={() => { setFieldDraft(lead.priority || 'Medium'); setEditingField('priority'); }}
                                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-opacity"
                                                            title="Edit Priority"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5 text-text-tertiary" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-xs text-text-tertiary">Property Interest</p>
                                                {editingField === 'property_interest' ? (
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <select
                                                            autoFocus
                                                            value={fieldDraft}
                                                            onChange={(e) => setFieldDraft(e.target.value)}
                                                            className="px-2 py-1 text-sm border border-border rounded bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-primary max-w-[150px]"
                                                        >
                                                            <option value="">Select property...</option>
                                                            {availableProperties.map(p => (
                                                                <option key={p.id} value={p.id}>{p.name}</option>
                                                            ))}
                                                        </select>
                                                        <button onClick={() => saveField('property_interest')} disabled={savingField} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded shrink-0" title="Save Property Interest">
                                                            <CheckCircle className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => setEditingField(null)} disabled={savingField} className="p-1 text-red-600 hover:bg-red-50 rounded shrink-0" title="Cancel">
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 mt-0.5 group">
                                                        <p className="text-sm font-medium text-text-primary">
                                                            {lead.property_info?.name || availableProperties.find(p => p.id === lead.property_interest)?.name || lead.property_interest || '–'}
                                                        </p>
                                                        <button
                                                            onClick={() => { setFieldDraft(lead.property_interest || lead.property_info?.id || ''); setEditingField('property_interest'); }}
                                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-opacity"
                                                            title="Edit Property Interest"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5 text-text-tertiary" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            {renderEditable('Move-in Timeline', 'move_in_timeline', lead.move_in_timeline, <Clock className="w-4 h-4" />)}
                                            <div>
                                                <p className="text-xs text-text-tertiary">Lead Source</p>
                                                {editingField === 'lead_source' ? (
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <select
                                                            autoFocus
                                                            value={fieldDraft}
                                                            onChange={(e) => setFieldDraft(e.target.value)}
                                                            className="px-2 py-1 text-sm border border-border rounded bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-primary max-w-[150px]"
                                                        >
                                                            <option value="">Select source...</option>
                                                            {availableSources.map(s => (
                                                                <option key={s.id} value={s.id}>{s.name}</option>
                                                            ))}
                                                        </select>
                                                        <button onClick={() => saveField('lead_source')} disabled={savingField} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded shrink-0">
                                                            <CheckCircle className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => setEditingField(null)} disabled={savingField} className="p-1 text-red-600 hover:bg-red-50 rounded shrink-0">
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 mt-0.5 group">
                                                        {(() => {
                                                            const sourceName = lead.source_info?.name || availableSources.find(s => s.id === lead.lead_source)?.name || 'Other';
                                                            const sv = getSourceVisual(sourceName);
                                                            const SourceIcon = sv.icon;
                                                            return (
                                                                <p className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                                                                    <SourceIcon className="w-4 h-4" style={{ color: sv.color }} />
                                                                    {sourceName}
                                                                </p>
                                                            );
                                                        })()}
                                                        <button
                                                            onClick={() => { setFieldDraft(lead.lead_source || ''); setEditingField('lead_source'); }}
                                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-opacity"
                                                            title="Edit Lead Source"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5 text-text-tertiary" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Meta Attribution */}
                                    {lead.meta_lead_id && (
                                        <div className="bg-surface-elevated rounded-xl p-4">
                                            <h3 className="font-bold text-text-primary mb-3">Meta Attribution</h3>
                                            <div className="grid grid-cols-2 gap-3">
                                                {lead.meta_form_name && (
                                                    <div>
                                                        <p className="text-xs text-text-tertiary">Form</p>
                                                        <p className="text-sm font-medium text-text-primary">{lead.meta_form_name}</p>
                                                    </div>
                                                )}
                                                {lead.campaign && (
                                                    <div>
                                                        <p className="text-xs text-text-tertiary">Campaign</p>
                                                        <p className="text-sm font-medium text-text-primary">{lead.campaign}</p>
                                                    </div>
                                                )}
                                                {lead.meta_campaign_id && (
                                                    <div>
                                                        <p className="text-xs text-text-tertiary">Campaign ID</p>
                                                        <p className="text-xs font-mono text-text-secondary">{lead.meta_campaign_id}</p>
                                                    </div>
                                                )}
                                                {lead.meta_ad_id && (
                                                    <div>
                                                        <p className="text-xs text-text-tertiary">Ad ID</p>
                                                        <p className="text-xs font-mono text-text-secondary">{lead.meta_ad_id}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Assignment */}
                                    <div className="bg-surface-elevated rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="font-bold text-text-primary">Assigned To</h3>
                                            <button
                                                onClick={() => setShowReassign(v => !v)}
                                                className="text-xs font-bold text-primary hover:underline"
                                            >{showReassign ? 'Cancel' : 'Change'}</button>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                                <User className="w-5 h-5 text-primary" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-text-primary">{lead.assigned_user?.full_name || 'Unassigned'}</p>
                                                {lead.assigned_user?.email && <p className="text-xs text-text-secondary">{lead.assigned_user.email}</p>}
                                            </div>
                                        </div>
                                        {showReassign && (
                                            <div className="mt-3 pt-3 border-t border-border">
                                                <select
                                                    value={(lead as any).assigned_to || ''}
                                                    disabled={reassigning}
                                                    onChange={(e) => handleReassign(e.target.value || null)}
                                                    className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
                                                >
                                                    <option value="">Unassigned</option>
                                                    {reps.map(r => (
                                                        <option key={r.id} value={r.id}>{r.full_name || r.email}</option>
                                                    ))}
                                                </select>
                                                {reassigning && <p className="text-[11px] text-text-tertiary mt-1">Reassigning…</p>}
                                            </div>
                                        )}
                                    </div>

                                    {/* Request Details — every field the prospect submitted on the ad form */}
                                    {formResponses.length > 0 && (
                                        <div className="bg-surface-elevated rounded-xl p-4">
                                            <h3 className="font-bold text-text-primary mb-3">Request Details</h3>
                                            <div className="space-y-2.5">
                                                {formResponses.map((f, i) => {
                                                    const isSeatReq = f.question.toLowerCase().includes('seat requirement') || f.question.toLowerCase() === 'seats';
                                                    if (isSeatReq) {
                                                        return (
                                                            <div key={i} className="py-1">
                                                                {renderEditable('Seat Requirement', 'seats', lead.seats != null ? lead.seats : f.answer, <Users className="w-4 h-4" />)}
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <div key={i} className="flex flex-col">
                                                            <span className="text-xs font-bold text-text-secondary">{f.question}</span>
                                                            <span className="text-sm text-text-primary break-words">{f.answer}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Requirement */}
                                    <div className="bg-surface-elevated rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="font-bold text-text-primary">Requirement</h3>
                                            {!editingRequirement && (
                                                <button
                                                    onClick={() => { setRequirementDraft(lead.requirement || ''); setEditingRequirement(true); }}
                                                    className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                                                    title="Edit requirement"
                                                >
                                                    <Pencil className="w-4 h-4 text-text-tertiary" />
                                                </button>
                                            )}
                                        </div>
                                        {editingRequirement ? (
                                            <div className="space-y-2">
                                                <textarea
                                                    value={requirementDraft}
                                                    onChange={(e) => setRequirementDraft(e.target.value)}
                                                    placeholder="Add requirement details..."
                                                    rows={3}
                                                    autoFocus
                                                    className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                                />
                                                <div className="flex items-center gap-2 justify-end">
                                                    <button
                                                        onClick={() => setEditingRequirement(false)}
                                                        className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-muted rounded-lg transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        disabled={savingRequirement}
                                                        onClick={async () => {
                                                            const val = requirementDraft || null;
                                                            if (val === (lead.requirement || null)) { setEditingRequirement(false); return; }
                                                            setSavingRequirement(true);
                                                            try {
                                                                const res = await fetch(`/api/crm/leads/${lead.id}`, {
                                                                    method: 'PATCH',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ requirement: val }),
                                                                });
                                                                if (res.ok) {
                                                                    const updated: CRMLead = { ...lead, requirement: val || undefined };
                                                                    setLead(updated);
                                                                    onLeadUpdate?.(updated);
                                                                }
                                                            } catch {}
                                                            setSavingRequirement(false);
                                                            setEditingRequirement(false);
                                                        }}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 disabled:opacity-50"
                                                    >
                                                        <Save className="w-3.5 h-3.5" />
                                                        {savingRequirement ? 'Saving...' : 'Save'}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-text-primary whitespace-pre-wrap">
                                                {lead.requirement || <span className="text-text-tertiary">No requirement added</span>}
                                            </p>
                                        )}
                                    </div>

                                    {/* Remarks */}
                                    <div className="bg-surface-elevated rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="font-bold text-text-primary">Remarks</h3>
                                            {!editingRemarks && (
                                                <button
                                                    onClick={() => { setRemarksDraft(lead.remarks || ''); setEditingRemarks(true); }}
                                                    className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                                                    title="Edit remarks"
                                                >
                                                    <Pencil className="w-4 h-4 text-text-tertiary" />
                                                </button>
                                            )}
                                        </div>
                                        {editingRemarks ? (
                                            <div className="space-y-2">
                                                <textarea
                                                    value={remarksDraft}
                                                    onChange={(e) => setRemarksDraft(e.target.value)}
                                                    placeholder="Add remarks..."
                                                    rows={2}
                                                    autoFocus
                                                    className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                                />
                                                <div className="flex items-center gap-2 justify-end">
                                                    <button
                                                        onClick={() => setEditingRemarks(false)}
                                                        className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-muted rounded-lg transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        disabled={savingRemarks}
                                                        onClick={async () => {
                                                            const val = remarksDraft || null;
                                                            if (val === (lead.remarks || null)) { setEditingRemarks(false); return; }
                                                            setSavingRemarks(true);
                                                            try {
                                                                const res = await fetch(`/api/crm/leads/${lead.id}`, {
                                                                    method: 'PATCH',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ remarks: val }),
                                                                });
                                                                if (res.ok) {
                                                                    const updated: CRMLead = { ...lead, remarks: val || undefined };
                                                                    setLead(updated);
                                                                    onLeadUpdate?.(updated);
                                                                }
                                                            } catch {}
                                                            setSavingRemarks(false);
                                                            setEditingRemarks(false);
                                                        }}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 disabled:opacity-50"
                                                    >
                                                        <Save className="w-3.5 h-3.5" />
                                                        {savingRemarks ? 'Saving...' : 'Save'}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-text-primary whitespace-pre-wrap">
                                                {lead.remarks || <span className="text-text-tertiary">No remarks added</span>}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'timeline' && (() => {
                                const timeline = buildTimeline();
                                // Tickets-style waterfall: one continuous vertical line, small
                                // semantic-colored dots, actor + timestamp per entry (chronological).
                                return (
                                  <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-bold text-text-primary">Activity Timeline</span>
                                        <button
                                            onClick={() => setAddEvent({ open: true, type: 'meeting' })}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90"
                                        >
                                            <CalendarPlus className="w-3.5 h-3.5" /> Add Event
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            onClick={() => handleLogTimelineAction('site_visit', 'Visit Pending')}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold hover:bg-amber-100 transition-colors dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800"
                                        >
                                            <MapPinIcon className="w-3.5 h-3.5" /> Visit Pending
                                        </button>
                                        <button
                                            onClick={() => handleLogTimelineAction('site_visit', 'Visit Done')}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-xs font-bold hover:bg-teal-100 transition-colors dark:bg-teal-900/20 dark:text-teal-400 dark:border-teal-800"
                                        >
                                            <MapPinIcon className="w-3.5 h-3.5" /> Visit Done
                                        </button>
                                        <button
                                            onClick={() => handleLogTimelineAction('updated', 'Layout Shared')}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-bold hover:bg-purple-100 transition-colors dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800"
                                        >
                                            <LayoutGrid className="w-3.5 h-3.5" /> Layout Shared
                                        </button>
                                        <button
                                            onClick={() => handleLogTimelineAction('proposal_sent', 'LOI')}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800"
                                        >
                                            <FileSignature className="w-3.5 h-3.5" /> LOI
                                        </button>
                                    </div>
                                    {timeline.length === 0 ? (
                                        <div className="text-center py-12 text-text-secondary">
                                            <Clock className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
                                            <p>No activity yet</p>
                                        </div>
                                    ) : (
                                    <div className="relative pl-5">
                                        <div className="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-border" />
                                        <div className="space-y-5">
                                            {timeline.map((item) => {
                                                const Icon = ACTIVITY_ICONS[item.icon] || Edit;
                                                const dot = ACTIVITY_DOT_COLORS[item.activityType] || '#64748B';
                                                const isEditing = editingActivity?.id === item.id;
                                                return (
                                                    <div key={item.id} className="relative flex gap-4 group">
                                                        <div
                                                            className="absolute -left-5 top-1 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm z-10"
                                                            style={{ backgroundColor: dot }}
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
                                                                    {Icon && <Icon className="w-3.5 h-3.5" style={{ color: dot }} />}
                                                                    {item.title}
                                                                </span>
                                                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                                                    <span className="text-xs text-text-tertiary whitespace-nowrap">
                                                                        {formatDate(item.timestamp)}
                                                                    </span>
                                                                    {!isEditing && (item.type === 'activity' || item.type === 'note') && (
                                                                        <>
                                                                            <button
                                                                                onClick={() => {
                                                                                    if (item.type === 'activity') {
                                                                                        setEditingActivity({ id: item.id, description: item.description || '' });
                                                                                    } else if (item.type === 'note') {
                                                                                        const rawNoteId = item.id.replace(/^n-/, '');
                                                                                        setEditingNoteId(rawNoteId);
                                                                                        setNoteDraft(item.description || '');
                                                                                    }
                                                                                }}
                                                                                className="p-1 rounded hover:bg-muted text-text-tertiary hover:text-primary transition-all"
                                                                                title="Edit Comment"
                                                                            >
                                                                                <Pencil className="w-3.5 h-3.5" />
                                                                            </button>
                                                                            <button
                                                                                onClick={() => {
                                                                                    if (item.type === 'activity') {
                                                                                        if (confirm('Remove this timeline entry?')) handleDeleteActivity(item.id);
                                                                                    } else if (item.type === 'note') {
                                                                                        const rawNoteId = item.id.replace(/^n-/, '');
                                                                                        handleDeleteNote(rawNoteId);
                                                                                    }
                                                                                }}
                                                                                className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 text-text-tertiary hover:text-rose-500 transition-all"
                                                                                title="Delete Comment"
                                                                            >
                                                                                <Trash2 className="w-3.5 h-3.5" />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {isEditing || (item.type === 'note' && editingNoteId === item.id.replace(/^n-/, '')) ? (
                                                                <div className="mt-2 space-y-1.5">
                                                                    <textarea
                                                                        value={item.type === 'note' ? noteDraft : editingActivity?.description || ''}
                                                                        onChange={e => {
                                                                            if (item.type === 'note') setNoteDraft(e.target.value);
                                                                            else if (editingActivity) setEditingActivity({ ...editingActivity, description: e.target.value });
                                                                        }}
                                                                        rows={2}
                                                                        className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                                                    />
                                                                    <div className="flex gap-2">
                                                                        <button onClick={() => {
                                                                            if (item.type === 'note') handleSaveNoteEdit(item.id.replace(/^n-/, ''));
                                                                            else handleSaveActivityEdit();
                                                                        }} disabled={savingActivity || savingNote} className="px-3 py-1 bg-primary text-white rounded-lg text-xs font-bold disabled:opacity-50">
                                                                            {(savingActivity || savingNote) ? 'Saving…' : 'Save'}
                                                                        </button>
                                                                        <button onClick={() => {
                                                                            setEditingActivity(null);
                                                                            setEditingNoteId(null);
                                                                        }} className="px-3 py-1 text-xs font-bold text-text-secondary hover:bg-surface-elevated rounded-lg">Cancel</button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    {item.description && (
                                                                        <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap break-words">{item.description}</p>
                                                                    )}
                                                                    {item.user && (
                                                                        <p className="text-xs text-text-tertiary mt-1">by {item.user.full_name}</p>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    )}
                                  </div>
                                );
                            })()}

                            {activeTab === 'calls' && lead && (
                                <CallCoachPanel leadId={lead.id} />
                            )}

                            {activeTab === 'notes' && (
                                <div className="space-y-4">
                                    {/* Add Note */}
                                    <div className="flex gap-3">
                                        <textarea
                                            value={newNote}
                                            onChange={(e) => setNewNote(e.target.value)}
                                            placeholder="Add a note..."
                                            className="flex-1 border border-border rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            rows={3}
                                        />
                                        <button
                                            onClick={handleAddNote}
                                            disabled={!newNote.trim() || isAddingNote}
                                            className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors self-end"
                                        >
                                            {isAddingNote ? 'Adding...' : 'Add'}
                                        </button>
                                    </div>

                                    {/* Notes List */}
                                    {notes.length === 0 ? (
                                        <div className="text-center py-12 text-text-secondary">
                                            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-text-tertiary" />
                                            <p>No notes yet</p>
                                        </div>
                                    ) : (
                                        notes.map(note => {
                                            const isEditing = editingNoteId === note.id;
                                            return (
                                                <div key={note.id} className="p-4 bg-surface-elevated rounded-xl group relative">
                                                    {isEditing ? (
                                                        <div className="space-y-2">
                                                            <textarea
                                                                value={noteDraft}
                                                                onChange={(e) => setNoteDraft(e.target.value)}
                                                                rows={3}
                                                                className="w-full border border-border rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-surface text-text-primary"
                                                            />
                                                            <div className="flex gap-2 justify-end">
                                                                <button
                                                                    onClick={() => setEditingNoteId(null)}
                                                                    className="px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-muted rounded-lg"
                                                                >
                                                                    Cancel
                                                                </button>
                                                                <button
                                                                    onClick={() => handleSaveNoteEdit(note.id)}
                                                                    disabled={savingNote}
                                                                    className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold disabled:opacity-50"
                                                                >
                                                                    {savingNote ? 'Saving...' : 'Save'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="flex items-start justify-between gap-3">
                                                                <p className="text-sm text-text-primary whitespace-pre-wrap break-words flex-1">{note.note}</p>
                                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <button
                                                                        onClick={() => {
                                                                            setEditingNoteId(note.id);
                                                                            setNoteDraft(note.note);
                                                                        }}
                                                                        className="p-1 rounded hover:bg-surface transition-all text-text-tertiary hover:text-text-primary"
                                                                        title="Edit Note"
                                                                    >
                                                                        <Pencil className="w-3.5 h-3.5" />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDeleteNote(note.id)}
                                                                        className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all text-text-tertiary hover:text-rose-500"
                                                                        title="Delete Note"
                                                                    >
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center justify-between mt-3">
                                                                <span className="text-xs text-text-tertiary">
                                                                    {note.user_info?.full_name || 'Unknown'}
                                                                </span>
                                                                <span className="text-xs text-text-tertiary">{formatDate(note.created_at)}</span>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>

        {/* Status-updated icon popup */}
        <AnimatePresence>
            {popupStage && (() => {
                const v = getStageVisual(popupStage);
                const Icon = v.icon;
                return (
                    <motion.div
                        key="stage-popup"
                        initial={{ opacity: 0, scale: 0.8, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="fixed left-1/2 -translate-x-1/2 bottom-10 z-[70] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl bg-surface border border-border"
                    >
                        <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${v.color}1A`, color: v.color }}>
                            <Icon className="w-5 h-5" />
                        </span>
                        <div>
                            <p className="text-xs text-text-tertiary">Status updated</p>
                            <p className="text-sm font-bold" style={{ color: v.color }}>{popupStage}</p>
                        </div>
                    </motion.div>
                );
            })()}
        </AnimatePresence>

        {leadId && (
            <AddEventModal
                isOpen={addEvent.open}
                leadId={leadId}
                organizationId={lead?.organization_id}
                leadName={currentLeadName}
                defaultType={addEvent.type}
                defaultTitle={addEvent.title}
                requireFuture={addEvent.requireFuture}
                onClose={() => setAddEvent(s => ({ ...s, open: false }))}
                onCreated={handleEventCreated}
                onQuickLog={handleLogTimelineAction}
            />
        )}

        {/* Comment required modal for Lost / Disqualified */}
        <AnimatePresence>
            {stageComment.open && (
                <motion.div
                    key="stage-comment-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4"
                    onClick={() => setStageComment(s => ({ ...s, open: false }))}
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                    >
                        <div className="px-6 py-4 border-b border-border">
                            <h3 className="text-base font-bold text-text-primary">
                                Mark as {stageComment.statusName}
                            </h3>
                            <p className="text-xs text-text-secondary mt-1">
                                {stageComment.statusName.toLowerCase() === 'lost'
                                    ? 'Please provide a reason for marking this lead as lost.'
                                    : 'Please provide a reason for disqualifying this lead.'}
                            </p>
                        </div>
                        <div className="px-6 py-4">
                            <textarea
                                value={stageComment.comment}
                                onChange={(e) => setStageComment(s => ({ ...s, comment: e.target.value }))}
                                placeholder={stageComment.statusName.toLowerCase() === 'lost'
                                    ? 'e.g. Signed with competitor, budget pulled...'
                                    : 'e.g. Wrong number, spam enquiry, not relevant...'}
                                rows={3}
                                autoFocus
                                className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                        </div>
                        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-surface-elevated">
                            <button
                                onClick={() => setStageComment(s => ({ ...s, open: false }))}
                                className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-muted rounded-xl transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleStageCommentSubmit}
                                disabled={!stageComment.comment.trim() || savingStageComment}
                                className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                                {savingStageComment ? 'Saving...' : `Mark as ${stageComment.statusName}`}
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