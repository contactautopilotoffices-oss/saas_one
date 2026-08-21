'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MessageSquare, Check, Save, Loader2, CheckCircle2, AlertCircle,
    Send, Info, Server, MessageCircle, ExternalLink, Ticket,
    ShoppingCart, Calendar, UserCheck, Wrench, FileSpreadsheet, ShieldCheck
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

interface WhatsAppTemplate {
    campaign_name: string;
    params: string[];
    is_media?: boolean;
}

const DEFAULT_WHATSAPP_TEMPLATES: Record<string, WhatsAppTemplate> = {
    // Requisitions & Procurement
    monthly_requisition_uploaded: { campaign_name: 'requisition_submitted_v1', params: ['user_name', 'property', 'month', 'year', 'items_count', 'total_amount', 'requested_by'] },
    requisition_approval_requested: { campaign_name: 'requisition_approval_requested_v1', params: ['approver_name', 'property', 'month', 'year', 'vendor_name', 'total_amount', 'notes'] },
    requisition_status_updated: { campaign_name: 'requisition_status_updated_v1', params: ['user_name', 'property', 'month', 'year', 'status', 'approver_name', 'total_amount', 'remarks'] },
    requisition_po_issued: { campaign_name: 'requisition_po_issued_v1', params: ['user_name', 'month', 'year', 'property', 'vendor_name', 'po_number', 'total_amount'] },
    material_request_created: { campaign_name: 'material_request_created_v3', params: ['user_name', 'ticket_number', 'property', 'requested_by', 'requester_phone', 'items_summary'] },
    comparative_approval_requested: { campaign_name: 'comparative_approval_requested_v1', params: ['user_name', 'total_cost', 'uploaded_by', 'ticket_number', 'title', 'property', 'notes'] },
    comparative_uploaded_info: { campaign_name: 'comparative_uploaded_info_v1', params: ['user_name', 'total_cost', 'uploaded_by', 'ticket_number', 'title', 'property', 'approver_name', 'notes'] },
    comparative_approved: { campaign_name: 'comparative_approved_v1', params: ['user_name', 'total_cost', 'ticket_number', 'title', 'property', 'approved_by', 'approver_comment'] },
    comparative_rejected: { campaign_name: 'comparative_rejected_v1', params: ['user_name', 'total_cost', 'ticket_number', 'title', 'property', 'action_by', 'rejection_reason'] },
    material_delivered: { campaign_name: 'material_delivered_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'delivered_items', 'verified_by'] },

    // Tickets & SLA
    ticket_created: { campaign_name: 'ticket_created_v3', params: ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone'] },
    ticket_created_media: { campaign_name: 'ticket_created_v3_media', params: ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone', 'assigned_to', 'assigned_to_phone'], is_media: true },
    ticket_assigned: { campaign_name: 'ticket_assigned_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'priority', 'raised_by', 'raised_by_phone'] },
    ticket_completed: { campaign_name: 'ticket_completed_v1', params: ['user_name', 'ticket_number', 'title', 'property', 'resolved_by'] },
    ticket_completed_media: { campaign_name: 'ticket_completed_v1_media', params: ['user_name', 'ticket_number', 'title', 'property', 'resolved_by'], is_media: true },
    ticket_updated: { campaign_name: 'ticket_updated', params: ['ticket_number', 'title', 'status'] },
    reminder_ticket_sla: { campaign_name: 'reminder_ticket_sla', params: ['ticket_number', 'title', 'sla_deadline'] },

    // Meeting Rooms
    meeting_room_booked: { campaign_name: 'meeting_room_booked_v3', params: ['user_name', 'room_name', 'property', 'date', 'start_time', 'end_time', 'booker', 'booker_phone'] },
    meeting_room_cancelled: { campaign_name: 'meeting_room_cancelled_v2', params: ['user_name', 'room_name', 'property', 'date', 'start_time', 'end_time', 'booker'] },
    reminder_meeting_room: { campaign_name: 'reminder_meeting_room', params: ['room_name', 'date', 'start_time'] },

    // PPM & Maintenance
    reminder_ppm: { campaign_name: 'reminder_ppm', params: ['schedule_name', 'property', 'due_date'] },

    // CRM Leads
    lead_created: { campaign_name: 'crm_lead_created_v1', params: ['user_name', 'company_name', 'contact_person', 'phone', 'source', 'property_interest'] },
    lead_assigned: { campaign_name: 'crm_lead_assigned_v1', params: ['user_name', 'company_name', 'contact_person', 'phone', 'property_interest', 'next_followup'] },
    reminder_lead_followup: { campaign_name: 'reminder_lead_followup', params: ['company_name', 'contact_person', 'followup_date'] }
};

const TEMPLATE_CATEGORIES = [
    {
        title: 'Monthly Requisitions & Procurement',
        icon: FileSpreadsheet,
        color: 'text-emerald-600 bg-emerald-50',
        events: [
            { key: 'monthly_requisition_uploaded', label: '1. Requisition Submitted by Site' },
            { key: 'requisition_approval_requested', label: '2. Approval Requested from Director' },
            { key: 'requisition_status_updated', label: '3. Requisition Approved / Rejected' },
            { key: 'requisition_po_issued', label: '4. Purchase Order (PO) Issued to Vendor' },
            { key: 'material_request_created', label: '5. Material Request Ticket Created' }
        ]
    },
    {
        title: 'Tickets & SLA Reminders',
        icon: Ticket,
        color: 'text-blue-600 bg-blue-50',
        events: [
            { key: 'ticket_created', label: 'Ticket Created (Text Only)' },
            { key: 'ticket_created_media', label: 'Ticket Created (With Photo Media)' },
            { key: 'ticket_assigned', label: 'Ticket Assigned to Technician' },
            { key: 'ticket_updated', label: 'Ticket Status Updated' },
            { key: 'reminder_ticket_sla', label: 'Ticket SLA Deadline Reminder' }
        ]
    },
    {
        title: 'PPM / Preventive Maintenance',
        icon: Wrench,
        color: 'text-amber-600 bg-amber-50',
        events: [
            { key: 'reminder_ppm', label: 'PPM Schedule Due Reminder' }
        ]
    },
    {
        title: 'Meeting Rooms & CRM',
        icon: Calendar,
        color: 'text-violet-600 bg-violet-50',
        events: [
            { key: 'meeting_room_booked', label: 'Meeting Room Reservation' },
            { key: 'meeting_room_cancelled', label: 'Meeting Room Cancellation' },
            { key: 'reminder_meeting_room', label: 'Meeting Room Starting Reminder' },
            { key: 'lead_created', label: 'New CRM Lead' },
            { key: 'lead_assigned', label: 'Lead Assigned to Agent' },
            { key: 'reminder_lead_followup', label: 'Lead Follow-up Reminder' }
        ]
    }
];

interface WhatsAppServiceSettingsProps {
    organizationId: string;
}

export default function WhatsAppServiceSettings({ organizationId }: WhatsAppServiceSettingsProps) {
    const supabase = createClient();

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [templatesMap, setTemplatesMap] = useState<Record<string, WhatsAppTemplate>>(DEFAULT_WHATSAPP_TEMPLATES);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3500);
    };

    useEffect(() => {
        const fetchSettings = async () => {
            if (!organizationId) return;
            setIsLoading(true);
            try {
                const { data } = await supabase
                    .from('organization_settings')
                    .select('whatsapp_templates')
                    .eq('organization_id', organizationId)
                    .maybeSingle();

                if (data?.whatsapp_templates) {
                    setTemplatesMap({
                        ...DEFAULT_WHATSAPP_TEMPLATES,
                        ...data.whatsapp_templates
                    });
                }
            } catch (err) {
                console.error('Error fetching WhatsApp templates:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchSettings();
    }, [organizationId, supabase]);

    const handleTemplateChange = (eventKey: string, campaignName: string) => {
        setTemplatesMap(prev => ({
            ...prev,
            [eventKey]: {
                campaign_name: campaignName.trim(),
                params: prev[eventKey]?.params || DEFAULT_WHATSAPP_TEMPLATES[eventKey]?.params || []
            }
        }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await fetch(`/api/admin/organizations/${organizationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ whatsapp_templates: templatesMap })
            });

            if (res.ok) {
                showToast('WhatsApp template campaign names saved successfully!');
            } else {
                showToast('Failed to save templates.', 'error');
            }
        } catch (err: any) {
            console.error('Error saving templates:', err);
            showToast('Error saving: ' + err.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-48 items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                    <h2 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-emerald-600" />
                        WhatsApp (AiSensy) Service Gateway
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Manage AiSensy Meta WhatsApp Business API integration and approved campaign templates.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 shadow-sm text-xs cursor-pointer"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Campaign Templates
                    </button>
                </div>
            </div>

            {/* Omnichannel Single Source of Truth Banner */}
            <div className="p-4 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 rounded-2xl flex items-start gap-3">
                <div className="p-2 bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 rounded-xl shrink-0 mt-0.5">
                    <Info className="w-4 h-4" />
                </div>
                <div className="text-xs space-y-1">
                    <p className="font-bold text-sky-900 dark:text-sky-200 text-sm">
                        Unified Recipient Management in Omnichannel Center
                    </p>
                    <p className="text-sky-700 dark:text-sky-400 leading-relaxed">
                        To prevent conflicts, all notification rules (who receives WhatsApp messages, target roles, and individual user routing) are centrally controlled in the <b>Omnichannel Notifications & Reminders</b> tab. This tab configures the AiSensy Meta campaign names and parameter mapping.
                    </p>
                </div>
            </div>

            {/* AiSensy Provider Status Card */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                            <MessageCircle className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">AiSensy WhatsApp Gateway</h3>
                            <p className="text-xs text-slate-500">Official Meta WhatsApp Cloud API v20.0 (High Throughput)</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Connected & Active
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100 text-xs">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-slate-400 font-bold block mb-1">ENGINE</span>
                        <span className="font-bold text-slate-800">AiSensy Campaign API v2</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-slate-400 font-bold block mb-1">TEMPLATE APPROVAL</span>
                        <span className="font-bold text-emerald-700">Meta Verified Templates</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-slate-400 font-bold block mb-1">DELIVERY SPEED</span>
                        <span className="font-bold text-slate-800">&lt; 1 Second (Instant)</span>
                    </div>
                </div>
            </div>

            {/* Meta Templates Manager by Category */}
            <div className="space-y-5">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        Meta Approved Campaign Templates
                    </h3>
                    <span className="text-xs text-slate-500">
                        Each campaign name must match the approved template in your AiSensy dashboard.
                    </span>
                </div>

                {TEMPLATE_CATEGORIES.map((cat, idx) => {
                    const CatIcon = cat.icon;
                    return (
                        <div key={idx} className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-4">
                            <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                                <div className={`p-1.5 rounded-lg ${cat.color}`}>
                                    <CatIcon className="w-4 h-4" />
                                </div>
                                <h4 className="font-bold text-slate-800 text-sm">{cat.title}</h4>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {cat.events.map(ev => {
                                    const template = templatesMap[ev.key] || DEFAULT_WHATSAPP_TEMPLATES[ev.key] || { campaign_name: '', params: [] };
                                    const placeholders = template.params.map((_, i) => `{{${i + 1}}}`).join(', ');

                                    return (
                                        <div key={ev.key} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                                            <div className="flex items-center justify-between">
                                                <label className="block text-xs font-bold text-slate-800">
                                                    {ev.label}
                                                </label>
                                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                                    {template.params.length} Params
                                                </span>
                                            </div>

                                            <div>
                                                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                                    AiSensy Campaign Name
                                                </span>
                                                <input
                                                    type="text"
                                                    value={template.campaign_name}
                                                    onChange={(e) => handleTemplateChange(ev.key, e.target.value)}
                                                    placeholder="e.g. requisition_submitted_v1"
                                                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                                />
                                            </div>

                                            <p className="text-[10px] text-slate-500 font-medium">
                                                Order: <span className="font-semibold text-slate-700">{template.params.join(' → ')}</span> ({placeholders})
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Toast Notification */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100]"
                    >
                        <div className={`px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border ${
                            toast.type === 'success' ? 'bg-slate-900 text-white border-slate-800' : 'bg-rose-900 text-white border-rose-800'
                        }`}>
                            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-rose-400" />}
                            <span className="font-bold text-xs">{toast.message}</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
