'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    MessageSquare, Mail, Bell, Check, Save, Loader2,
    CheckCircle2, AlertCircle, ShoppingCart, Calendar,
    UserCheck, X, Building, Search, UserPlus, ChevronDown,
    User, Ticket, Wrench, Clock, FileText, Truck, Layers,
    ClipboardCheck, BarChart3, ShoppingBag, Eye, Copy,
    Phone, PhoneCall, Volume2, Sparkles, Play
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

export interface ChannelConfig {
    email: boolean;
    whatsapp: boolean;
    push: boolean;
    voice?: boolean;
}

export interface EventNotificationRule {
    enabled?: boolean;
    channels: ChannelConfig;
    roles?: string[];
    user_ids?: string[];
    notify_assignee?: boolean;
    notify_requester?: boolean;
    notify_approver?: boolean;
    reminder_minutes?: number | null;
    voice_template?: string;
    voice_id?: string;
    speech_speed?: string;
    schedule_time?: string;
    frequency?: 'daily' | 'weekly';
    property_overrides?: Record<string, EventNotificationRule>;
}

export const AVAILABLE_VOICES = [
    { id: 'Polly.Kajal-Neural', name: 'Kajal (Neural Indian Female)', accent: 'Indian English', badge: 'Ultra-Realistic (Recommended)', gender: 'female' },
    { id: 'Polly.Aditi', name: 'Aditi (Bilingual Indian Female)', accent: 'Indian English', badge: 'Crisp & Clear', gender: 'female' },
    { id: 'Polly.Raveena', name: 'Raveena (Indian Female)', accent: 'Indian English', badge: 'Standard', gender: 'female' },
    { id: 'Polly.Joanna-Neural', name: 'Joanna (Neural Female)', accent: 'US English', badge: 'Smooth & Conversational', gender: 'female' },
    { id: 'Polly.Matthew-Neural', name: 'Matthew (Neural Male)', accent: 'US English', badge: 'Executive Corporate', gender: 'male' },
];

export const AVAILABLE_SPEEDS = [
    { value: '0.85', label: '0.85x (Slow)' },
    { value: '0.95', label: '0.95x (Relaxed)' },
    { value: '1.0', label: '1.0x (Normal)' },
    { value: '1.10', label: '1.1x (Crisp / Fast)' },
    { value: '1.20', label: '1.2x (Quick Alert)' },
];

export interface ModuleConfig {
    [eventKey: string]: EventNotificationRule;
}

export interface NotificationMatrix {
    tickets?: ModuleConfig;
    checklists?: ModuleConfig;
    scheduled_reports?: ModuleConfig;
    procurement?: ModuleConfig;
    meeting_rooms?: ModuleConfig;
    ppm?: ModuleConfig;
    crm_leads?: ModuleConfig;
    [moduleKey: string]: ModuleConfig | undefined;
}

interface UserItem {
    id: string;
    full_name: string;
    email: string;
    role?: string;
}

const getRoleStyle = (roleId: string) => {
    switch (roleId.toLowerCase()) {
        case 'org_super_admin':
        case 'master_admin':
            return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'procurement':
        case 'procurement_user':
            return 'bg-blue-50 text-blue-700 border-blue-200';
        case 'property_admin':
        case 'org_admin':
            return 'bg-purple-50 text-purple-700 border-purple-200';
        case 'staff':
        case 'mst':
        case 'security':
            return 'bg-amber-50 text-amber-700 border-amber-200';
        case 'sales':
            return 'bg-indigo-50 text-indigo-700 border-indigo-200';
        default:
            return 'bg-slate-100 text-slate-700 border-slate-200';
    }
};

const formatRoleLabel = (roleId: string) => {
    const r = roleId.toLowerCase();
    if (r === 'org_super_admin') return 'Org Super Admin';
    if (r === 'procurement' || r === 'procurement_user') return 'Procurement';
    if (r === 'property_admin') return 'Property Admin';
    if (r === 'org_admin') return 'Org Admin';
    if (r === 'master_admin') return 'Master Admin';
    if (r === 'staff') return 'Staff';
    if (r === 'mst') return 'MST';
    if (r === 'sales') return 'Sales Executive';
    return roleId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

function SearchableUserPicker({
    availableUsers,
    allUsers,
    selectedUserIds,
    onSelectUser,
    scopeName
}: {
    availableUsers: UserItem[];
    allUsers?: UserItem[];
    selectedUserIds: string[];
    onSelectUser: (userId: string) => void;
    scopeName: string;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');

    // Combine available users with all users fallback to ensure everyone is searchable
    const userPool = availableUsers.length > 0 ? availableUsers : (allUsers || []);
    const unselectedUsers = userPool.filter(u => !selectedUserIds.includes(u.id));
    const filteredUsers = unselectedUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(query.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(query.toLowerCase()) ||
        (u.role || '').toLowerCase().includes(query.toLowerCase())
    );

    return (
        <div className="relative inline-block text-left">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-all cursor-pointer"
            >
                <UserPlus className="w-3.5 h-3.5 text-primary" />
                <span>+ Add user...</span>
                <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-50" onClick={() => setIsOpen(false)} />
                    <div className="absolute left-0 mt-1 w-80 md:w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                autoFocus
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search by name, email, or role..."
                                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                        </div>

                        <div className="max-h-60 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                            {filteredUsers.length > 0 ? (
                                filteredUsers.map(u => (
                                    <button
                                        key={u.id}
                                        type="button"
                                        onClick={() => {
                                            onSelectUser(u.id);
                                            setIsOpen(false);
                                            setQuery('');
                                        }}
                                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 text-left transition-colors group cursor-pointer border border-transparent hover:border-slate-100"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                                            {(u.full_name || u.email || 'U').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-slate-900 truncate group-hover:text-primary">
                                                {u.full_name || 'Unnamed Member'}
                                            </p>
                                            <p className="text-[11px] text-slate-500 truncate">
                                                {u.email}
                                            </p>
                                        </div>
                                        {u.role && (
                                            <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                                                {formatRoleLabel(u.role)}
                                            </span>
                                        )}
                                    </button>
                                ))
                            ) : (
                                <div className="py-6 text-center text-xs text-slate-400 font-medium">
                                    No members found matching "{query}"
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export interface EventMeta {
    key: string;
    name: string;
    description: string;
    isReminder?: boolean;
    reminderLabel?: string;
    isScheduledReport?: boolean;
    hasContextual?: {
        assignee?: boolean;
        requester?: boolean;
        approver?: boolean;
    };
}

export interface ModuleMeta {
    id: string;
    name: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    events: EventMeta[];
}

const MODULES_META: ModuleMeta[] = [
    {
        id: 'tickets',
        name: 'Tickets & Service Requests',
        description: 'Configure notifications for ticket creation, technician assignment, resolution, and SLA deadlines.',
        icon: Ticket,
        color: 'text-blue-600 bg-blue-50 border-blue-100',
        events: [
            {
                key: 'ticket_created',
                name: 'Ticket Created',
                description: 'Sent when a new service ticket is submitted (includes requester and assigned technician phone).',
                hasContextual: { assignee: true, requester: true }
            },
            {
                key: 'ticket_assigned',
                name: 'Ticket Assigned to Technician',
                description: 'Sent to assigned technician with issue details, requester phone, and target SLA.',
                hasContextual: { assignee: true }
            },
            {
                key: 'ticket_completed',
                name: 'Ticket Completed & Verification',
                description: 'Sent upon ticket completion to verify and rate service quality.',
                hasContextual: { requester: true }
            },
            {
                key: 'reminder_ticket_sla',
                name: 'SLA Breach Warning (Reminder)',
                description: 'Sent before resolution deadline breaches.',
                isReminder: true,
                reminderLabel: 'Remind before SLA deadline',
                hasContextual: { assignee: true }
            }
        ]
    },
    {
        id: 'checklists',
        name: 'SOP Checklists & Compliance',
        description: 'Scheduled site inspection reminders, shift start alerts, completion submissions, ratings, and escalation alerts.',
        icon: ClipboardCheck,
        color: 'text-purple-600 bg-purple-50 border-purple-100',
        events: [
            {
                key: 'checklist_slot_reminder',
                name: 'Checklist Slot Due Reminder',
                description: 'Sent to selected staff/roles before the checklist shift window closes.',
                isReminder: true,
                reminderLabel: 'Remind before slot ends',
                hasContextual: { assignee: true }
            },
            {
                key: 'checklist_started',
                name: 'Checklist Started Alert',
                description: 'Sent when a checklist slot becomes active or staff begins an inspection.',
                hasContextual: { assignee: true }
            },
            {
                key: 'checklist_completed',
                name: 'Checklist Completed & Submitted',
                description: 'Sent to designated supervisors/property admins when checklist photos and items are submitted.',
                hasContextual: { requester: true }
            },
            {
                key: 'checklist_overdue_alert',
                name: 'Overdue / Missed Checklist Alert',
                description: 'Escalated alert sent to staff and managers when a required checklist is missed or overdue.',
                hasContextual: { assignee: true }
            },
            {
                key: 'checklist_rated',
                name: 'Checklist Supervisor Rating & Feedback',
                description: 'Sent to the technician/completer with supervisor audit rating and feedback score.',
                hasContextual: { requester: true }
            }
        ]
    },
    {
        id: 'scheduled_reports',
        name: 'AI Multi-Property Daily Report',
        description: 'AI-analyzed executive operational report covering open/resolved tickets, electricity/DG consumption, PPM status, and SOP compliance.',
        icon: BarChart3,
        color: 'text-emerald-600 bg-emerald-50 border-emerald-100',
        events: [
            {
                key: 'daily_property_report',
                name: 'AI Multi-Property Daily Operations Report',
                description: 'Consolidated report generated and sent at your organization-selected time.',
                isScheduledReport: true
            }
        ]
    },
    {
        id: 'procurement',
        name: 'Procurement & Material Management',
        description: 'Material requests, comparative quotations, delivery receipts, and vendor coordination.',
        icon: ShoppingCart,
        color: 'text-amber-600 bg-amber-50 border-amber-100',
        events: [
            {
                key: 'material_request_created',
                name: 'Material Request Created at Property',
                description: 'Sent when technicians submit a new material request at a property.',
                hasContextual: { requester: true }
            },
            {
                key: 'comparative_uploaded',
                name: 'Comparative Quote Uploaded',
                description: 'Sent to designated approvers with total cost and download link.',
                hasContextual: { approver: true }
            },
            {
                key: 'comparative_approved',
                name: 'Comparative Quote Approved',
                description: 'Sent to procurement when quote is approved to proceed with ordering.',
                hasContextual: { requester: true }
            },
            {
                key: 'comparative_rejected',
                name: 'Comparative Negotiation Requested',
                description: 'Sent when approver requests price negotiation or revised quotes.'
            },
            {
                key: 'material_delivered',
                name: 'Material Delivery Receipt',
                description: 'Sent when materials arrive on site with verification photo.',
                hasContextual: { requester: true }
            },
            {
                key: 'monthly_requisition_uploaded',
                name: 'Monthly Material Requisition Submitted',
                description: 'Sent when site staff / property admin submits a monthly material requisition.',
                hasContextual: { requester: true }
            },
            {
                key: 'requisition_approval_requested',
                name: 'Requisition Approval Requested (Quotes Attached)',
                description: 'Sent to designated approver (Director / Super Admin) when procurement attaches vendor quotation.',
                hasContextual: { approver: true }
            },
            {
                key: 'requisition_status_updated',
                name: 'Requisition Approved / Rejected Status Update',
                description: 'Sent to procurement & site requester when an approver approves or requests revisions.',
                hasContextual: { requester: true }
            },
            {
                key: 'requisition_po_issued',
                name: 'Requisition Purchase Order Issued',
                description: 'Sent to site admin & requester when PO is generated and sent to vendor.',
                hasContextual: { requester: true }
            },
            {
                key: 'procurement_vendor_tag',
                name: 'Vendor Procurement Tagged',
                description: 'Sent when site staff tag procurement to arrange external vendors.',
                hasContextual: { assignee: true }
            },
            {
                key: 'procurement_vendor_aligned',
                name: 'Vendor Aligned / Arranged',
                description: 'Sent when procurement schedules an external vendor for a ticket.',
                hasContextual: { requester: true, assignee: true }
            }
        ]
    },
    {
        id: 'meeting_rooms',
        name: 'Meeting Room Reservations',
        description: 'Notifications sent to selected front-desk/admin staff when meeting rooms are booked or cancelled.',
        icon: Calendar,
        color: 'text-rose-600 bg-rose-50 border-rose-100',
        events: [
            {
                key: 'meeting_room_booked',
                name: 'Meeting Room Booked',
                description: 'Sent to selected staff/admins and the booking requester when a room is booked.',
                hasContextual: { requester: true }
            },
            {
                key: 'meeting_room_cancelled',
                name: 'Meeting Room Cancelled',
                description: 'Sent to selected staff/admins and the booking requester when a reservation is cancelled.',
                hasContextual: { requester: true }
            }
        ]
    },
    {
        id: 'ppm',
        name: 'Preventive Maintenance (PPM)',
        description: 'Advance reminders for planned equipment maintenance schedules.',
        icon: Wrench,
        color: 'text-teal-600 bg-teal-50 border-teal-100',
        events: [
            {
                key: 'reminder_ppm',
                name: 'PPM Due Date Reminder',
                description: 'Sent in advance before an asset servicing date falls due.',
                isReminder: true,
                reminderLabel: 'Remind before due date'
            }
        ]
    },
    {
        id: 'crm_leads',
        name: 'CRM Sales Leads',
        description: 'Notifications for new sales enquiries and sales agent assignment.',
        icon: UserCheck,
        color: 'text-indigo-600 bg-indigo-50 border-indigo-100',
        events: [
            {
                key: 'lead_created',
                name: 'New Lead Created',
                description: 'Sent when a new lead is captured via website or form.'
            },
            {
                key: 'lead_assigned',
                name: 'Lead Assigned to Agent',
                description: 'Sent to sales executive when a lead is assigned.',
                hasContextual: { assignee: true }
            }
        ]
    }
];

const DEFAULT_NOTIFICATION_MATRIX: NotificationMatrix = {
    tickets: {
        ticket_created: { channels: { email: true, whatsapp: true, push: true }, roles: ['property_admin', 'staff'], user_ids: [], notify_assignee: true, notify_requester: true },
        ticket_assigned: { channels: { email: true, whatsapp: true, push: true }, roles: [], user_ids: [], notify_assignee: true },
        ticket_completed: { channels: { email: true, whatsapp: true, push: true }, roles: [], user_ids: [], notify_requester: true },
        reminder_ticket_sla: { channels: { email: false, whatsapp: true, push: true }, roles: ['property_admin', 'org_super_admin'], user_ids: [], notify_assignee: true, reminder_minutes: 30 }
    },
    checklists: {
        checklist_slot_reminder: { channels: { email: false, whatsapp: true, push: true }, roles: ['mst', 'staff'], user_ids: [], notify_assignee: true, reminder_minutes: 30 },
        checklist_started: { channels: { email: false, whatsapp: true, push: true }, roles: ['mst', 'staff'], user_ids: [], notify_assignee: true },
        checklist_completed: { channels: { email: true, whatsapp: true, push: true }, roles: ['property_admin', 'soft_service_manager', 'soft_service_supervisor'], user_ids: [], notify_requester: true },
        checklist_overdue_alert: { channels: { email: true, whatsapp: true, push: true }, roles: ['property_admin', 'org_super_admin'], user_ids: [], notify_assignee: true },
        checklist_rated: { channels: { email: false, whatsapp: true, push: true }, roles: [], user_ids: [], notify_requester: true }
    },
    scheduled_reports: {
        daily_property_report: { channels: { email: true, whatsapp: true, push: false }, roles: ['org_super_admin', 'owner', 'admin'], user_ids: [], schedule_time: '20:00', frequency: 'daily' }
    },
    procurement: {
        material_request_created: { channels: { email: true, whatsapp: true, push: false }, roles: ['procurement', 'org_super_admin'], user_ids: [] },
        comparative_uploaded: { channels: { email: true, whatsapp: true, push: true }, roles: ['org_super_admin', 'procurement'], user_ids: [], notify_approver: true },
        comparative_approved: { channels: { email: true, whatsapp: true, push: true }, roles: ['procurement'], user_ids: [], notify_requester: true },
        comparative_rejected: { channels: { email: true, whatsapp: true, push: true }, roles: ['procurement'], user_ids: [] },
        material_delivered: { channels: { email: true, whatsapp: true, push: true }, roles: ['property_admin', 'procurement'], user_ids: [], notify_requester: true },
        monthly_requisition_uploaded: { channels: { email: true, whatsapp: true, push: true }, roles: ['procurement', 'org_super_admin'], user_ids: [], notify_requester: true },
        requisition_approval_requested: { channels: { email: true, whatsapp: true, push: true }, roles: ['org_super_admin'], user_ids: [], notify_approver: true },
        requisition_status_updated: { channels: { email: true, whatsapp: true, push: true }, roles: ['procurement'], user_ids: [], notify_requester: true },
        requisition_po_issued: { channels: { email: true, whatsapp: true, push: true }, roles: ['property_admin'], user_ids: [], notify_requester: true },
        procurement_vendor_tag: { channels: { email: true, whatsapp: true, push: true }, roles: ['procurement'], user_ids: [] },
        procurement_vendor_aligned: { channels: { email: true, whatsapp: true, push: true }, roles: [], user_ids: [], notify_requester: true }
    },
    meeting_rooms: {
        meeting_room_booked: { channels: { email: true, whatsapp: true, push: true }, roles: ['property_admin'], user_ids: [], notify_requester: true },
        meeting_room_cancelled: { channels: { email: true, whatsapp: true, push: true }, roles: ['property_admin'], user_ids: [], notify_requester: true }
    },
    ppm: {
        reminder_ppm: { channels: { email: true, whatsapp: true, push: true }, roles: ['property_admin', 'org_super_admin'], user_ids: [], reminder_minutes: 1440 }
    },
    crm_leads: {
        lead_created: { channels: { email: true, whatsapp: true, push: true }, roles: ['sales', 'org_super_admin'], user_ids: [] },
        lead_assigned: { channels: { email: true, whatsapp: true, push: true }, roles: [], user_ids: [], notify_assignee: true }
    }
};


type ReminderUnit = 'minutes' | 'hours' | 'days';
const REMINDER_UNIT_FACTORS: Record<ReminderUnit, number> = { minutes: 1, hours: 60, days: 1440 };

const minutesToReminderParts = (minutes: number | null | undefined): { value: string; unit: ReminderUnit } => {
    if (minutes === null || minutes === undefined || minutes <= 0) return { value: '', unit: 'minutes' };
    if (minutes % 1440 === 0) return { value: String(minutes / 1440), unit: 'days' };
    if (minutes % 60 === 0) return { value: String(minutes / 60), unit: 'hours' };
    return { value: String(minutes), unit: 'minutes' };
};

const DEFAULT_VOICE_TEMPLATES: Record<string, string> = {
    checklist_slot_reminder: "Hi {{user_name}}, this is Pratiksha from the Operations team. A quick reminder that your checklist '{{checklist_title}}' at {{property_name}} is due soon. Please ensure all items are completed on time.",
    checklist_started: "Hi {{user_name}}, this is Pratiksha from the Operations team. Your scheduled checklist '{{checklist_title}}' at {{property_name}} has started. Please begin your inspection rounds and upload verification photos in the app.",
    checklist_overdue_alert: "Hi {{user_name}}, this is Pratiksha from the Operations team with an urgent update. The checklist '{{checklist_title}}' at {{property_name}} was not completed during its scheduled shift. Please review and complete it right away.",
    reminder_ppm: "Hi {{user_name}}, this is Pratiksha from the Operations team. Preventive maintenance for {{system_name}} at {{property_name}} is scheduled for {{due_date}}. Please coordinate with the vendor and arrange site clearance.",
    reminder_ticket_sla: "Hi {{user_name}}, this is Pratiksha from Operations. Service ticket #{{ticket_number}} at {{property_name}} is approaching its resolution SLA deadline. Please take immediate action.",
    test_call: "Hi {{user_name}}, this is Pratiksha from the Operations team. This is a quick test call to confirm that your phone notifications and voice alerts are working properly."
};

interface OmnichannelNotificationSettingsProps {
    organizationId: string;
}

export default function OmnichannelNotificationSettings({ organizationId }: OmnichannelNotificationSettingsProps) {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [matrix, setMatrix] = useState<NotificationMatrix>(DEFAULT_NOTIFICATION_MATRIX);
    const [orgMembers, setOrgMembers] = useState<UserItem[]>([]);
    const [allUsersMap, setAllUsersMap] = useState<Record<string, UserItem>>({});
    const [allUsersList, setAllUsersList] = useState<UserItem[]>([]);
    const [propertyMembersMap, setPropertyMembersMap] = useState<Record<string, UserItem[]>>({});
    const [availableRoles, setAvailableRoles] = useState<{ id: string; label: string; bg: string }[]>([]);
    const [propertiesList, setPropertiesList] = useState<{ id: string; name: string }[]>([]);
    const [selectedPropertyScope, setSelectedPropertyScope] = useState<string>('global');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [activeModuleTab, setActiveModuleTab] = useState<string>('tickets');

    // Broadcast Welcome Modal State
    const [showBroadcastModal, setShowBroadcastModal] = useState(false);
    const [broadcastScope, setBroadcastScope] = useState<string>('global');
    const [broadcastAudienceType, setBroadcastAudienceType] = useState<'all' | 'property' | 'users'>('all');
    const [broadcastUserIds, setBroadcastUserIds] = useState<string[]>([]);
    const [broadcastUserSearch, setBroadcastUserSearch] = useState<string>('');
    const [broadcastRoles, setBroadcastRoles] = useState<string[]>([]);
    const [helpdeskContact, setHelpdeskContact] = useState<string>('contact.autopilotoffices@gmail.com');
    const [isBroadcasting, setIsBroadcasting] = useState(false);

    // AI Voice Calling & Test Call Modal State
    const [showTestCallModal, setShowTestCallModal] = useState(false);
    const [testPhone, setTestPhone] = useState('');
    const [testUserName, setTestUserName] = useState('Harsh Patil');
    const [testScript, setTestScript] = useState(DEFAULT_VOICE_TEMPLATES.test_call);
    const [testVoiceId, setTestVoiceId] = useState('Polly.Kajal-Neural');
    const [testSpeed, setTestSpeed] = useState('1.0');
    const [playingPreviewKey, setPlayingPreviewKey] = useState<string | null>(null);
    const [isTestingCall, setIsTestingCall] = useState(false);
    const [recentCallLogs, setRecentCallLogs] = useState<any[]>([]);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);
    const [showCallLogs, setShowCallLogs] = useState(false);

    const supabase = createClient();

    useEffect(() => {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.getVoices();
            const handleVoicesChanged = () => {
                window.speechSynthesis.getVoices();
            };
            window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
            return () => {
                window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
            };
        }
    }, []);

    useEffect(() => {
        if (organizationId) {
            fetchData();
            fetchCallLogs();
        }
    }, [organizationId]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/admin/organizations/${organizationId}`);
            if (res.ok) {
                const data = await res.json();
                if (data?.notification_matrix) {
                    setMatrix(prev => ({
                        ...DEFAULT_NOTIFICATION_MATRIX,
                        ...data.notification_matrix
                    }));
                }
            }

            // 1. Fetch all system users via service-role API (bypasses RLS so property-level users resolve properly)
            const fullUserMap: Record<string, UserItem> = {};
            const fullList: UserItem[] = [];

            try {
                const usersRes = await fetch(`/api/users/list?orgId=${organizationId}`);
                if (usersRes.ok) {
                    const uData = await usersRes.json();
                    const usersArray = uData?.users || [];
                    usersArray.forEach((u: any) => {
                        if (u.id) {
                            const item: UserItem = {
                                id: u.id,
                                full_name: u.full_name || u.email || 'User',
                                email: u.email || '',
                                role: u.orgRole || u.propertyRole || 'Member'
                            };
                            fullUserMap[u.id] = item;
                            fullList.push(item);
                        }
                    });
                }
            } catch (uErr) {
                console.error('Error fetching users from /api/users/list:', uErr);
            }

            // Direct fallback in case API was unreachable
            const { data: dbUsers } = await supabase
                .from('users')
                .select('id, full_name, email, role');

            if (dbUsers) {
                dbUsers.forEach((u: any) => {
                    if (u.id && !fullUserMap[u.id]) {
                        const item: UserItem = {
                            id: u.id,
                            full_name: u.full_name || u.email || 'User',
                            email: u.email || '',
                            role: u.role || 'Member'
                        };
                        fullUserMap[u.id] = item;
                        fullList.push(item);
                    }
                });
            }

            const { data: orgMems } = await supabase
                .from('organization_memberships')
                .select('role, user_id, users:user_id(id, full_name, email)')
                .eq('organization_id', organizationId)
                .eq('is_active', true);

            const rolesSet = new Set<string>();

            if (orgMems) {
                const userList: UserItem[] = orgMems
                    .map((m: any) => {
                        const u = m.users || (Array.isArray(m.users) ? m.users[0] : null);
                        if (u && u.id) {
                            if (!fullUserMap[u.id]) {
                                fullUserMap[u.id] = { id: u.id, full_name: u.full_name || u.email, email: u.email, role: m.role };
                            } else if (m.role) {
                                fullUserMap[u.id].role = m.role;
                            }
                            return fullUserMap[u.id];
                        }
                        return null;
                    })
                    .filter((u: any): u is UserItem => Boolean(u && u.id));
                setOrgMembers(userList);

                orgMems.forEach((m: any) => {
                    if (m.role) rolesSet.add(m.role.toLowerCase());
                });
            }

            setAllUsersMap(fullUserMap);
            setAllUsersList(fullList);

            const { data: orgProps } = await supabase
                .from('properties')
                .select('id, name')
                .eq('organization_id', organizationId);

            if (orgProps && orgProps.length > 0) {
                setPropertiesList(orgProps);
                const propIds = orgProps.map((p: any) => p.id);
                const { data: propMems } = await supabase
                    .from('property_memberships')
                    .select('property_id, role, user_id, users:user_id(id, full_name, email)')
                    .in('property_id', propIds)
                    .eq('is_active', true);

                if (propMems) {
                    const pMap: Record<string, UserItem[]> = {};
                    propMems.forEach((m: any) => {
                        const u = m.users || (Array.isArray(m.users) ? m.users[0] : null);
                        if (u && u.id && m.property_id) {
                            if (!pMap[m.property_id]) pMap[m.property_id] = [];
                            if (!pMap[m.property_id].some(item => item.id === u.id)) {
                                pMap[m.property_id].push({
                                    id: u.id,
                                    full_name: u.full_name || u.email,
                                    email: u.email,
                                    role: m.role
                                });
                            }
                        }
                        if (m.role) rolesSet.add(m.role.toLowerCase());
                    });
                    setPropertyMembersMap(pMap);
                }
            }

            const baseRoles = ['org_super_admin', 'procurement', 'property_admin', 'staff', 'mst', 'sales'];
            baseRoles.forEach(r => rolesSet.add(r));

            setAvailableRoles(
                Array.from(rolesSet).map(r => ({
                    id: r,
                    label: formatRoleLabel(r),
                    bg: getRoleStyle(r)
                }))
            );
        } catch (err) {
            console.error('Error fetching notification matrix settings:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const getScopedUsers = (): UserItem[] => {
        if (selectedPropertyScope === 'global') return orgMembers;
        return propertyMembersMap[selectedPropertyScope] || [];
    };

    const getScopeName = (): string => {
        if (selectedPropertyScope === 'global') return 'Organization';
        const p = propertiesList.find(item => item.id === selectedPropertyScope);
        return p ? p.name : 'Property';
    };

    const getRule = (moduleId: string, eventKey: string): EventNotificationRule => {
        const mod = matrix[moduleId] || DEFAULT_NOTIFICATION_MATRIX[moduleId] || {};
        const globalRule = mod[eventKey] || { channels: { email: true, whatsapp: true, push: true }, roles: [], user_ids: [] };

        if (selectedPropertyScope === 'global') {
            return globalRule;
        }

        const overrides = globalRule.property_overrides || {};
        return overrides[selectedPropertyScope] || {
            channels: { ...globalRule.channels },
            roles: [...(globalRule.roles || [])],
            user_ids: [...(globalRule.user_ids || [])],
            notify_assignee: globalRule.notify_assignee,
            notify_requester: globalRule.notify_requester,
            notify_approver: globalRule.notify_approver,
            reminder_minutes: globalRule.reminder_minutes,
            schedule_time: globalRule.schedule_time,
            frequency: globalRule.frequency
        };
    };

    const updateRule = (moduleId: string, eventKey: string, updateFn: (current: EventNotificationRule) => EventNotificationRule) => {
        setMatrix(prev => {
            const currentMod = prev[moduleId] || DEFAULT_NOTIFICATION_MATRIX[moduleId] || {};
            const globalRule = currentMod[eventKey] || { channels: { email: true, whatsapp: true, push: true }, roles: [], user_ids: [] };

            if (selectedPropertyScope === 'global') {
                const updatedGlobal = updateFn(globalRule);
                return {
                    ...prev,
                    [moduleId]: {
                        ...currentMod,
                        [eventKey]: {
                            ...updatedGlobal,
                            property_overrides: globalRule.property_overrides || {}
                        }
                    }
                };
            } else {
                const overrides = globalRule.property_overrides || {};
                const currentPropRule = overrides[selectedPropertyScope] || {
                    channels: { ...globalRule.channels },
                    roles: [...(globalRule.roles || [])],
                    user_ids: [...(globalRule.user_ids || [])],
                    notify_assignee: globalRule.notify_assignee,
                    notify_requester: globalRule.notify_requester,
                    notify_approver: globalRule.notify_approver,
                    reminder_minutes: globalRule.reminder_minutes,
                    schedule_time: globalRule.schedule_time,
                    frequency: globalRule.frequency
                };
                const updatedProp = updateFn(currentPropRule);

                return {
                    ...prev,
                    [moduleId]: {
                        ...currentMod,
                        [eventKey]: {
                            ...globalRule,
                            property_overrides: {
                                ...overrides,
                                [selectedPropertyScope]: updatedProp
                            }
                        }
                    }
                };
            }
        });
    };

    const toggleChannel = (moduleId: string, eventKey: string, channel: 'email' | 'whatsapp' | 'push' | 'voice') => {
        updateRule(moduleId, eventKey, current => ({
            ...current,
            channels: {
                ...current.channels,
                [channel]: !current.channels[channel]
            }
        }));
    };

    const playAudioPreview = (text: string, voiceId?: string, speed?: string, previewKey?: string) => {
        if (typeof window === 'undefined') return;
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const pk = previewKey || 'test_modal';
            setPlayingPreviewKey(pk);

            const cleanText = text
                .replace(/\{\{\s*user_name\s*\}\}/gi, 'Harsh')
                .replace(/\{\{\s*checklist_title\s*\}\}/gi, 'LT Panel Inspection')
                .replace(/\{\{\s*property_name\s*\}\}/gi, 'Mafatlal Chambers')
                .replace(/\{\{\s*shift_time\s*\}\}/gi, '05:30 PM')
                .replace(/\{\{\s*due_date\s*\}\}/gi, 'tomorrow')
                .replace(/\{\{\s*system_name\s*\}\}/gi, 'Chiller Unit');

            const utterance = new SpeechSynthesisUtterance(cleanText);
            const sp = parseFloat(speed || '1.0');
            utterance.rate = !isNaN(sp) ? sp : 1.0;

            const selectedVoiceConfig = AVAILABLE_VOICES.find(v => v.id === voiceId);
            const isFemale = selectedVoiceConfig ? selectedVoiceConfig.gender !== 'male' : !(voiceId || '').toLowerCase().includes('matthew');

            // Apply feminine pitch (1.15) for female personas to guarantee a natural, clear female voice
            utterance.pitch = isFemale ? 1.15 : 0.95;

            const voices = window.speechSynthesis.getVoices();
            if (voices && voices.length > 0) {
                const maleKeywords = ['ravi', 'david', 'mark', 'george', 'guy', 'prabhat', 'richard', 'oliver', 'daniel', 'arthur', 'fred', 'albert', 'male', 'alex'];
                const femaleKeywords = ['heera', 'neerja', 'swara', 'veena', 'sangeeta', 'aditi', 'kajal', 'raveena', 'zira', 'jenny', 'aria', 'samantha', 'victoria', 'karen', 'moira', 'tessa', 'joanna', 'salli', 'kimberly', 'ivy', 'kendra', 'amy', 'emma', 'female', 'girl', 'woman'];

                let matchedVoice: SpeechSynthesisVoice | undefined;

                if (isFemale) {
                    // 1. Try Indian English Female Voice (e.g. Heera, Neerja, Swara, Aditi, Kajal, Veena)
                    matchedVoice = voices.find(v =>
                        (v.lang === 'en-IN' || v.lang.startsWith('en_IN') || v.name.toLowerCase().includes('india')) &&
                        femaleKeywords.some(kw => v.name.toLowerCase().includes(kw)) &&
                        !maleKeywords.some(kw => v.name.toLowerCase().includes(kw))
                    );

                    // 2. Try any English Female Voice (e.g. Zira, Jenny, Aria, Samantha, Google UK English Female, Google US English)
                    if (!matchedVoice) {
                        matchedVoice = voices.find(v =>
                            v.lang.startsWith('en') &&
                            femaleKeywords.some(kw => v.name.toLowerCase().includes(kw)) &&
                            !maleKeywords.some(kw => v.name.toLowerCase().includes(kw))
                        );
                    }

                    // 3. Try any English voice that is NOT a known male voice
                    if (!matchedVoice) {
                        matchedVoice = voices.find(v =>
                            v.lang.startsWith('en') &&
                            !maleKeywords.some(kw => v.name.toLowerCase().includes(kw))
                        );
                    }

                    // 4. Fallback: Any voice not in male keywords
                    if (!matchedVoice) {
                        matchedVoice = voices.find(v => !maleKeywords.some(kw => v.name.toLowerCase().includes(kw)));
                    }
                } else {
                    // Male Voice (e.g. Matthew)
                    matchedVoice = voices.find(v =>
                        v.lang.startsWith('en') &&
                        maleKeywords.some(kw => v.name.toLowerCase().includes(kw))
                    );
                }

                if (matchedVoice) {
                    utterance.voice = matchedVoice;
                }
            }

            utterance.onend = () => setPlayingPreviewKey(null);
            utterance.onerror = () => setPlayingPreviewKey(null);
            window.speechSynthesis.speak(utterance);
        }
    };

    const setVoiceTemplate = (moduleId: string, eventKey: string, script: string) => {
        updateRule(moduleId, eventKey, current => ({
            ...current,
            voice_template: script
        }));
    };

    const setVoiceId = (moduleId: string, eventKey: string, voiceId: string) => {
        updateRule(moduleId, eventKey, current => ({
            ...current,
            voice_id: voiceId
        }));
    };

    const setSpeechSpeed = (moduleId: string, eventKey: string, speed: string) => {
        updateRule(moduleId, eventKey, current => ({
            ...current,
            speech_speed: speed
        }));
    };

    const handleTriggerTestCall = async () => {
        if (!testPhone.trim()) {
            showToast('Please enter a valid phone number', 'error');
            return;
        }

        setIsTestingCall(true);
        try {
            const res = await fetch('/api/voice/test-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: testPhone.trim(),
                    organizationId,
                    userName: testUserName.trim() || 'Admin',
                    customScript: testScript.trim(),
                    voiceId: testVoiceId,
                    speechSpeed: testSpeed
                })
            });

            const data = await res.json();
            if (res.ok) {
                showToast(`📞 Test call placed to ${testPhone}! Spoken: "${data.spokenScript?.slice(0, 40)}..."`);
                setShowTestCallModal(false);
                fetchCallLogs();
            } else {
                showToast(data.error || 'Failed to place test call', 'error');
            }
        } catch (err: any) {
            console.error('Test call error:', err);
            showToast('Failed to trigger test call', 'error');
        } finally {
            setIsTestingCall(false);
        }
    };

    const fetchCallLogs = async () => {
        setIsLoadingLogs(true);
        try {
            const res = await fetch(`/api/voice/logs?organizationId=${organizationId}`);
            if (res.ok) {
                const data = await res.json();
                setRecentCallLogs(data.logs || []);
            }
        } catch (err) {
            console.error('Error fetching call logs:', err);
        } finally {
            setIsLoadingLogs(false);
        }
    };

    const toggleRole = (moduleId: string, eventKey: string, roleId: string) => {
        updateRule(moduleId, eventKey, current => {
            const roles = current.roles || [];
            const newRoles = roles.includes(roleId) ? roles.filter(r => r !== roleId) : [...roles, roleId];
            return { ...current, roles: newRoles };
        });
    };

    const addUser = (moduleId: string, eventKey: string, userId: string) => {
        updateRule(moduleId, eventKey, current => {
            const users = current.user_ids || [];
            if (users.includes(userId)) return current;
            return { ...current, user_ids: [...users, userId] };
        });
    };

    const removeUser = (moduleId: string, eventKey: string, userId: string) => {
        updateRule(moduleId, eventKey, current => ({
            ...current,
            user_ids: (current.user_ids || []).filter(id => id !== userId)
        }));
    };

    const setReminderMinutes = (moduleId: string, eventKey: string, minutes: number) => {
        updateRule(moduleId, eventKey, current => ({
            ...current,
            reminder_minutes: Math.max(1, isNaN(minutes) ? 10 : minutes)
        }));
    };

    const toggleContextual = (moduleId: string, eventKey: string, key: 'notify_assignee' | 'notify_requester' | 'notify_approver') => {
        updateRule(moduleId, eventKey, current => ({
            ...current,
            [key]: !(current[key] !== false)
        }));
    };

    const handleReminderChange = (moduleId: string, eventKey: string, rawValue: string, unit: ReminderUnit) => {
        updateRule(moduleId, eventKey, current => {
            const parsed = parseInt(rawValue.trim(), 10);
            if (isNaN(parsed) || parsed <= 0) return { ...current, reminder_minutes: null };
            return { ...current, reminder_minutes: parsed * REMINDER_UNIT_FACTORS[unit] };
        });
    };

    const handleScheduleTimeChange = (moduleId: string, eventKey: string, time: string) => {
        updateRule(moduleId, eventKey, current => ({
            ...current,
            schedule_time: time
        }));
    };

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Build synchronized whatsapp_service_config & email_service_config for full backward compatibility
            const syncWhatsAppConfig: Record<string, any> = {};
            const syncEmailConfig: Record<string, any> = {};

            Object.entries(matrix).forEach(([modKey, modEvents]) => {
                if (!modEvents) return;
                Object.entries(modEvents).forEach(([evKey, rule]) => {
                    const waEnabled = rule.channels?.whatsapp === true;
                    const emEnabled = rule.channels?.email === true;

                    const baseConfig = {
                        roles: rule.roles || [],
                        user_ids: rule.user_ids || [],
                        notify_assignee: rule.notify_assignee !== false,
                        notify_requester: rule.notify_requester !== false,
                        notify_approver: rule.notify_approver !== false,
                        reminder_minutes: rule.reminder_minutes ?? null
                    };

                    // Sync by both evKey and modKey for maximum compatibility
                    syncWhatsAppConfig[evKey] = { ...baseConfig, enabled: waEnabled };
                    syncEmailConfig[evKey] = { ...baseConfig, enabled: emEnabled };
                    if (!syncWhatsAppConfig[modKey]) {
                        syncWhatsAppConfig[modKey] = { ...baseConfig, enabled: waEnabled };
                    }
                    if (!syncEmailConfig[modKey]) {
                        syncEmailConfig[modKey] = { ...baseConfig, enabled: emEnabled };
                    }
                });
            });

            const res = await fetch(`/api/admin/organizations/${organizationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notification_matrix: matrix,
                    whatsapp_service_config: syncWhatsAppConfig,
                    email_service_config: syncEmailConfig
                })
            });

            if (res.ok) {
                showToast('Notification matrix and communication channels saved successfully!');
            } else {
                showToast('Failed to save notification matrix settings.', 'error');
            }
        } catch (err) {
            console.error('Error saving matrix:', err);
            showToast('An error occurred while saving.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSendBroadcast = async () => {
        if (broadcastAudienceType === 'users' && broadcastUserIds.length === 0) {
            showToast('Please select at least one recipient user.', 'error');
            return;
        }

        setIsBroadcasting(true);
        try {
            const res = await fetch('/api/admin/whatsapp/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organizationId,
                    propertyId: broadcastAudienceType === 'property' ? broadcastScope : undefined,
                    targetUserIds: broadcastAudienceType === 'users' ? broadcastUserIds : undefined,
                    targetRoles: broadcastRoles.length > 0 ? broadcastRoles : undefined,
                    helpdeskContact: helpdeskContact.trim() || 'contact.autopilotoffices@gmail.com',
                    templateName: 'fms_welcome_onboarding_v1'
                })
            });

            const data = await res.json();
            if (res.ok) {
                showToast(data.message || 'FMS Welcome & Onboarding broadcast queued successfully!');
                setShowBroadcastModal(false);
            } else {
                showToast(data.error || 'Failed to send broadcast.', 'error');
            }
        } catch (err: any) {
            console.error('Error broadcasting welcome message:', err);
            showToast('Failed to send broadcast.', 'error');
        } finally {
            setIsBroadcasting(false);
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
                        <Bell className="w-5 h-5 text-primary" />
                        Omnichannel Notification & Communication Center
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Configure WhatsApp (AiSensy), Email, and Push notification rules or broadcast FMS onboarding messages to all users.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                    <button
                        type="button"
                        onClick={() => setShowTestCallModal(true)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 text-xs font-bold rounded-xl transition-all shadow-2xs cursor-pointer whitespace-nowrap"
                    >
                        <PhoneCall className="w-3.5 h-3.5" />
                        <span>Test Voice Call</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowBroadcastModal(true)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 text-xs font-bold rounded-xl transition-all shadow-2xs cursor-pointer whitespace-nowrap"
                    >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Welcome Broadcast</span>
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer whitespace-nowrap"
                    >
                        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        <span>Save Settings</span>
                    </button>
                </div>
            </div>

            {/* Scope Selection Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
                        <Building className="w-5 h-5" />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-900 text-sm">Configuration Scope</h4>
                        <p className="text-xs text-slate-500">Configure global organization defaults or building-specific override rules.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500">Scope:</span>
                    <select
                        value={selectedPropertyScope}
                        onChange={(e) => setSelectedPropertyScope(e.target.value)}
                        className="bg-white border border-slate-300 font-bold text-xs text-slate-900 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
                    >
                        <option value="global">🌐 Global (All Properties Default)</option>
                        {propertiesList.map(p => (
                            <option key={p.id} value={p.id}>
                                🏢 {p.name} (Property Override)
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Modules Accordion Cards */}
            <div className="space-y-6">
                {MODULES_META.map(module => {
                    const Icon = module.icon;

                    return (
                        <div
                            key={module.id}
                            className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
                        >
                            {/* Module Header */}
                            <div className="p-4 md:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2.5 rounded-xl border ${module.color}`}>
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900 text-sm md:text-base">{module.name}</h3>
                                        <p className="text-xs text-slate-500">{module.description}</p>
                                    </div>
                                </div>
                                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full uppercase">
                                    {module.events.length} Event{module.events.length > 1 ? 's' : ''}
                                </span>
                            </div>

                            {/* Module Events Table / Cards */}
                            <div className="divide-y divide-slate-100 p-2 md:p-4 space-y-4">
                                {module.events.map(ev => {
                                    const rule = getRule(module.id, ev.key);
                                    const reminderParts = minutesToReminderParts(rule.reminder_minutes);
                                    const isAnyChannelOn = rule.channels.email || rule.channels.whatsapp || rule.channels.push || rule.channels.voice;

                                    return (
                                        <div key={ev.key} className="p-4 rounded-xl hover:bg-slate-50/50 transition-colors space-y-3">
                                            {/* Event Top Bar */}
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <h4 className="font-bold text-slate-900 text-xs md:text-sm">{ev.name}</h4>
                                                        {ev.isReminder && (
                                                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                                                                <Clock className="w-3 h-3" /> Reminder
                                                            </span>
                                                        )}
                                                        {ev.isScheduledReport && (
                                                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                                                                <BarChart3 className="w-3 h-3" /> Scheduled Report
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-slate-500 mt-0.5">{ev.description}</p>
                                                </div>

                                                {/* Delivery Channel Toggles */}
                                                <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200 shrink-0">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider px-1">Channels:</span>
                                                    
                                                    {/* Email Toggle */}
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleChannel(module.id, ev.key, 'email')}
                                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                                            rule.channels.email
                                                                ? 'bg-blue-600 text-white shadow-xs'
                                                                : 'bg-white text-slate-400 hover:text-slate-600'
                                                        }`}
                                                    >
                                                        <Mail className="w-3 h-3" />
                                                        <span>Email</span>
                                                    </button>

                                                    {/* WhatsApp Toggle */}
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleChannel(module.id, ev.key, 'whatsapp')}
                                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                                            rule.channels.whatsapp
                                                                ? 'bg-emerald-600 text-white shadow-xs'
                                                                : 'bg-white text-slate-400 hover:text-slate-600'
                                                        }`}
                                                    >
                                                        <MessageSquare className="w-3 h-3" />
                                                        <span>WhatsApp</span>
                                                    </button>

                                                    {/* Push Toggle */}
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleChannel(module.id, ev.key, 'push')}
                                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                                            rule.channels.push
                                                                ? 'bg-indigo-600 text-white shadow-xs'
                                                                : 'bg-white text-slate-400 hover:text-slate-600'
                                                        }`}
                                                    >
                                                        <Bell className="w-3 h-3" />
                                                        <span>Push</span>
                                                    </button>
                                                    
                                                    {/* Voice Toggle */}
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleChannel(module.id, ev.key, 'voice')}
                                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                                            rule.channels.voice
                                                                ? 'bg-purple-600 text-white shadow-xs'
                                                                : 'bg-white text-slate-400 hover:text-slate-600'
                                                        }`}
                                                    >
                                                        <PhoneCall className="w-3 h-3" />
                                                        <span>Voice</span>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Controls (visible when at least 1 channel is active) */}
                                            {isAnyChannelOn && (
                                                <div className="pt-3 border-t border-slate-100 space-y-3 bg-slate-50/70 p-3 rounded-xl">
                                                    {/* Scheduled Report Timing */}
                                                    {ev.isScheduledReport && (
                                                        <div className="flex flex-wrap items-center gap-3">
                                                            <div className="flex items-center gap-2">
                                                                <Clock className="w-4 h-4 text-emerald-600" />
                                                                <span className="text-xs font-bold text-slate-700">Dispatch Time (IST):</span>
                                                                <input
                                                                    type="time"
                                                                    value={rule.schedule_time || '20:00'}
                                                                    onChange={(e) => handleScheduleTimeChange(module.id, ev.key, e.target.value)}
                                                                    className="bg-white border border-slate-300 font-bold text-xs text-slate-900 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
                                                                />
                                                            </div>
                                                            <span className="text-[10px] text-slate-500 font-medium">
                                                                Automated multi-property report will be generated and dispatched at this exact time daily.
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Reminder Lead Time */}
                                                    {ev.isReminder && (
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="text-xs font-bold text-slate-700">{ev.reminderLabel}:</span>
                                                            <div className="flex items-center gap-1.5">
                                                                <input
                                                                    type="number"
                                                                    min={1}
                                                                    value={reminderParts.value}
                                                                    onChange={(e) => handleReminderChange(module.id, ev.key, e.target.value, reminderParts.unit)}
                                                                    placeholder="e.g. 30"
                                                                    className="w-20 px-2.5 py-1 text-xs font-medium border border-slate-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-primary/20"
                                                                />
                                                                <select
                                                                    value={reminderParts.unit}
                                                                    onChange={(e) => handleReminderChange(module.id, ev.key, reminderParts.value, e.target.value as ReminderUnit)}
                                                                    className="px-2 py-1 text-xs font-bold border border-slate-300 rounded-lg bg-white outline-none shadow-2xs"
                                                                >
                                                                    <option value="minutes">Minutes</option>
                                                                    <option value="hours">Hours</option>
                                                                    <option value="days">Days</option>
                                                                </select>
                                                            </div>
                                                            <span className="text-[10px] text-slate-400">Leave blank to turn off reminder.</span>
                                                        </div>
                                                    )}

                                                    {/* Target Roles */}
                                                    <div>
                                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                                                            Target Roles (Who gets notified)
                                                        </label>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {availableRoles.map(role => {
                                                                const isSelected = (rule.roles || []).includes(role.id);
                                                                return (
                                                                    <button
                                                                        key={role.id}
                                                                        type="button"
                                                                        onClick={() => toggleRole(module.id, ev.key, role.id)}
                                                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition-all ${
                                                                            isSelected
                                                                                ? `${role.bg} shadow-xs ring-2 ring-primary/20`
                                                                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                                                        }`}
                                                                    >
                                                                        {isSelected && <Check className="w-3 h-3 text-current" />}
                                                                        {role.label}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {/* Specific Individual Users */}
                                                    <div>
                                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                                                            Specific Individual Users
                                                        </label>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            {(rule.user_ids || []).map(uid => {
                                                                const u = allUsersMap[uid] || getScopedUsers().find(m => m.id === uid) || orgMembers.find(m => m.id === uid);
                                                                const displayName = u?.full_name || u?.email || `${uid.slice(0, 8)}...`;
                                                                const initial = (u?.full_name || u?.email || 'U').charAt(0).toUpperCase();

                                                                return (
                                                                    <span
                                                                        key={uid}
                                                                        className="inline-flex items-center gap-2 pl-2 pr-2 py-1 rounded-xl bg-indigo-50/80 hover:bg-indigo-50 border border-indigo-200/80 text-xs font-semibold text-indigo-950 shadow-2xs transition-all group"
                                                                    >
                                                                        <div className="w-5 h-5 rounded-full bg-indigo-200 text-indigo-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                                                                            {initial}
                                                                        </div>
                                                                        <div className="flex flex-col leading-tight max-w-[170px]">
                                                                            <span className="font-bold text-slate-900 text-xs truncate">{displayName}</span>
                                                                            {u?.email && u.full_name && (
                                                                                <span className="text-[10px] text-slate-400 font-normal truncate">{u.email}</span>
                                                                            )}
                                                                        </div>
                                                                        {u?.role && (
                                                                            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-white text-slate-600 border border-slate-200 shrink-0">
                                                                                {formatRoleLabel(u.role)}
                                                                            </span>
                                                                        )}
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => removeUser(module.id, ev.key, uid)}
                                                                            className="w-4 h-4 rounded-full flex items-center justify-center text-slate-400 hover:bg-rose-100 hover:text-rose-600 transition-colors ml-0.5 cursor-pointer"
                                                                            title="Remove user"
                                                                        >
                                                                            <X className="w-3 h-3" />
                                                                        </button>
                                                                    </span>
                                                                );
                                                            })}

                                                            <SearchableUserPicker
                                                                availableUsers={getScopedUsers()}
                                                                allUsers={allUsersList}
                                                                selectedUserIds={rule.user_ids || []}
                                                                onSelectUser={(userId) => addUser(module.id, ev.key, userId)}
                                                                scopeName={getScopeName()}
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Contextual Direct Recipient Toggles */}
                                                    {ev.hasContextual && (
                                                        <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-4">
                                                            {ev.hasContextual.assignee && (
                                                                <label className="flex items-center gap-2 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={rule.notify_assignee !== false}
                                                                        onChange={() => toggleContextual(module.id, ev.key, 'notify_assignee')}
                                                                        className="w-3.5 h-3.5 text-primary rounded border-slate-300"
                                                                    />
                                                                    <span className="text-xs font-semibold text-slate-700">Notify Assignee / Agent</span>
                                                                </label>
                                                            )}
                                                            {ev.hasContextual.requester && (
                                                                <label className="flex items-center gap-2 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={rule.notify_requester !== false}
                                                                        onChange={() => toggleContextual(module.id, ev.key, 'notify_requester')}
                                                                        className="w-3.5 h-3.5 text-primary rounded border-slate-300"
                                                                    />
                                                                    <span className="text-xs font-semibold text-slate-700">Notify Requester / Creator</span>
                                                                </label>
                                                            )}
                                                            {ev.hasContextual.approver && (
                                                                <label className="flex items-center gap-2 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={rule.notify_approver !== false}
                                                                        onChange={() => toggleContextual(module.id, ev.key, 'notify_approver')}
                                                                        className="w-3.5 h-3.5 text-primary rounded border-slate-300"
                                                                    />
                                                                    <span className="text-xs font-semibold text-slate-700">Notify Assigned Approver</span>
                                                                </label>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Reminder Lead Time Configuration Input */}
                                                    {ev.isReminder && (
                                                        <div className="pt-2 border-t border-slate-200 flex items-center gap-3">
                                                            <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
                                                            <span className="text-xs font-semibold text-slate-700">
                                                                {ev.reminderLabel || 'Reminder Lead Time'}:
                                                            </span>
                                                            <div className="flex items-center gap-1.5">
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    max="1440"
                                                                    value={rule.reminder_minutes ?? 10}
                                                                    onChange={(e) => setReminderMinutes(module.id, ev.key, parseInt(e.target.value, 10))}
                                                                    className="w-16 px-2 py-1 text-xs font-black bg-slate-50 border border-slate-300 rounded-lg text-center text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                                                                />
                                                                <span className="text-xs text-slate-500 font-bold">minutes before</span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Voice Script & Voice Persona Customization (when Voice Channel is ON) */}
                                                    {rule.channels.voice && (
                                                        <div className="pt-3 border-t border-purple-100/80 bg-purple-50/50 p-3.5 rounded-2xl space-y-3">
                                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                                <div className="flex items-center gap-1.5 text-xs font-bold text-purple-950">
                                                                    <Volume2 className="w-3.5 h-3.5 text-purple-600" />
                                                                    <span>Voice Persona & Speech Settings</span>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => playAudioPreview(
                                                                        rule.voice_template || DEFAULT_VOICE_TEMPLATES[ev.key] || `Hello Harsh, this is an alert regarding ${ev.name} at Mafatlal Chambers.`,
                                                                        rule.voice_id || 'Polly.Kajal-Neural',
                                                                        rule.speech_speed || '1.0',
                                                                        `${module.id}_${ev.key}`
                                                                    )}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-purple-700 hover:bg-purple-100 border border-purple-200 text-[11px] font-bold rounded-lg transition-colors shadow-2xs cursor-pointer"
                                                                >
                                                                    <Play className={`w-3 h-3 ${playingPreviewKey === `${module.id}_${ev.key}` ? 'animate-spin text-purple-600' : 'fill-purple-600'}`} />
                                                                    <span>{playingPreviewKey === `${module.id}_${ev.key}` ? 'Playing...' : '🔊 Preview Voice'}</span>
                                                                </button>
                                                            </div>

                                                            {/* Voice & Speed Pickers */}
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/80 p-2.5 rounded-xl border border-purple-200/60">
                                                                <div>
                                                                    <label className="block text-[10px] font-bold text-slate-600 mb-1">Speaker Voice / Accent:</label>
                                                                    <select
                                                                        value={rule.voice_id || 'Polly.Kajal-Neural'}
                                                                        onChange={(e) => setVoiceId(module.id, ev.key, e.target.value)}
                                                                        className="w-full text-xs font-semibold bg-white border border-purple-200 rounded-lg p-1.5 text-slate-800 outline-hidden focus:ring-2 focus:ring-purple-400"
                                                                    >
                                                                        {AVAILABLE_VOICES.map(v => (
                                                                            <option key={v.id} value={v.id}>
                                                                                {v.name} ({v.badge})
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[10px] font-bold text-slate-600 mb-1">Speech Speed (Rate):</label>
                                                                    <select
                                                                        value={rule.speech_speed || '1.0'}
                                                                        onChange={(e) => setSpeechSpeed(module.id, ev.key, e.target.value)}
                                                                        className="w-full text-xs font-semibold bg-white border border-purple-200 rounded-lg p-1.5 text-slate-800 outline-hidden focus:ring-2 focus:ring-purple-400"
                                                                    >
                                                                        {AVAILABLE_SPEEDS.map(s => (
                                                                            <option key={s.value} value={s.value}>
                                                                                {s.label}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            </div>

                                                            <div className="space-y-1.5">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-[11px] font-bold text-slate-700">Spoken Voice Script / Prompt:</span>
                                                                    <span className="text-[10px] text-purple-600 font-semibold bg-purple-100/70 px-2 py-0.5 rounded-md">
                                                                        Neural Speech Engine
                                                                    </span>
                                                                </div>
                                                                <textarea
                                                                    rows={2}
                                                                    value={rule.voice_template || DEFAULT_VOICE_TEMPLATES[ev.key] || `Hello {{user_name}}, this is an alert regarding ${ev.name} at {{property_name}}`}
                                                                    onChange={(e) => setVoiceTemplate(module.id, ev.key, e.target.value)}
                                                                    className="w-full text-xs font-medium bg-white border border-purple-200 rounded-xl p-2.5 outline-hidden focus:ring-2 focus:ring-purple-400 shadow-2xs resize-none"
                                                                    placeholder="Type custom voice message..."
                                                                />
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                <span className="text-[10px] text-slate-500 font-semibold">Dynamic Variables:</span>
                                                                {['{{user_name}}', '{{checklist_title}}', '{{property_name}}', '{{shift_time}}', '{{due_date}}'].map(v => (
                                                                    <button
                                                                        key={v}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            const current = rule.voice_template || DEFAULT_VOICE_TEMPLATES[ev.key] || '';
                                                                            setVoiceTemplate(module.id, ev.key, current + ' ' + v);
                                                                        }}
                                                                        className="px-1.5 py-0.5 text-[10px] font-mono bg-white text-purple-700 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors shadow-2xs cursor-pointer"
                                                                    >
                                                                        {v}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* AI Voice Calling & Telephony Overview Section */}
            <div className="p-5 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl border border-indigo-800/40 shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300">
                            <PhoneCall className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                Operations Voice Telephony Engine (Plivo)
                                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold rounded-full border border-emerald-500/30">
                                    LIVE 🟢
                                </span>
                            </h3>
                            <p className="text-xs text-slate-300 mt-0.5">
                                Automated outbound phone calls for shift start reminders, SLA escalations, and overdue checklist alerts.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setShowCallLogs(!showCallLogs);
                                if (!showCallLogs) fetchCallLogs();
                            }}
                            className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl transition-colors border border-white/10"
                        >
                            {showCallLogs ? 'Hide Call Logs' : 'View Call Logs'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowTestCallModal(true)}
                            className="px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5"
                        >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Test Live Call</span>
                        </button>
                    </div>
                </div>

                {/* Recent Call Logs Table (Expandable) */}
                {showCallLogs && (
                    <div className="pt-3 border-t border-white/10 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-purple-200">Recent AI Voice Dispatches</span>
                            <button
                                type="button"
                                onClick={fetchCallLogs}
                                className="text-[11px] text-slate-400 hover:text-white underline"
                            >
                                Refresh
                            </button>
                        </div>
                        {isLoadingLogs ? (
                            <div className="py-4 text-center text-xs text-slate-400">Loading call records...</div>
                        ) : recentCallLogs.length === 0 ? (
                            <div className="py-4 text-center text-xs text-slate-400 bg-white/5 rounded-xl border border-white/5">
                                No voice calls placed yet. Click "Test Live Call" to place your first test call!
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs text-slate-300">
                                    <thead>
                                        <tr className="border-b border-white/10 text-[10px] uppercase font-bold text-slate-400">
                                            <th className="pb-2">Time</th>
                                            <th className="pb-2">Recipient</th>
                                            <th className="pb-2">Event</th>
                                            <th className="pb-2">Status</th>
                                            <th className="pb-2">Spoken Script</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {recentCallLogs.map((log: any) => (
                                            <tr key={log.id} className="hover:bg-white/5">
                                                <td className="py-2 text-[11px] text-slate-400 font-mono">
                                                    {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className="py-2 font-bold text-white font-mono">{log.recipient_phone}</td>
                                                <td className="py-2">
                                                    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-[10px] font-bold">
                                                        {log.event_type}
                                                    </span>
                                                </td>
                                                <td className="py-2">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                        log.call_status === 'completed' || log.call_status === 'in_progress'
                                                            ? 'bg-emerald-500/20 text-emerald-300'
                                                            : 'bg-rose-500/20 text-rose-300'
                                                    }`}>
                                                        {log.call_status}
                                                    </span>
                                                </td>
                                                <td className="py-2 text-[11px] text-slate-300 max-w-xs truncate" title={log.spoken_script}>
                                                    {log.spoken_script}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Bottom Save Button */}
            <div className="flex justify-end pt-4">
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 shadow-md text-sm"
                >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Notification Matrix
                </button>
            </div>

            {/* Toast feedback */}
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

            {/* Broadcast Greeting & Announcement Modal */}
            <AnimatePresence>
                {showBroadcastModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowBroadcastModal(false)}
                            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs"
                        />

                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-10 animate-in fade-in"
                        >
                            {/* Modal Header */}
                            <div className="p-6 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-white/20 rounded-2xl backdrop-blur-xs">
                                        <span className="text-xl">🏢</span>
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-extrabold">Broadcast FMS Welcome & Onboarding</h3>
                                        <p className="text-xs text-blue-100">Send an onboarding introduction message explaining all FMS features to your users.</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowBroadcastModal(false)}
                                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                                {/* Scope & Audience Selector */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-2">Target Audience</label>
                                    <div className="grid grid-cols-3 gap-2 mb-3">
                                        <button
                                            type="button"
                                            onClick={() => setBroadcastAudienceType('all')}
                                            className={`p-2.5 rounded-xl border text-xs font-bold transition-all text-center ${
                                                broadcastAudienceType === 'all'
                                                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            🌐 Entire Org
                                            <span className="block text-[10px] font-normal text-slate-500 mt-0.5">({orgMembers.length} users)</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setBroadcastAudienceType('property')}
                                            className={`p-2.5 rounded-xl border text-xs font-bold transition-all text-center ${
                                                broadcastAudienceType === 'property'
                                                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            🏢 By Property
                                            <span className="block text-[10px] font-normal text-slate-500 mt-0.5">({propertiesList.length} sites)</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setBroadcastAudienceType('users')}
                                            className={`p-2.5 rounded-xl border text-xs font-bold transition-all text-center ${
                                                broadcastAudienceType === 'users'
                                                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-2xs'
                                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            👤 Select Users
                                            <span className="block text-[10px] font-normal text-slate-500 mt-0.5">({broadcastUserIds.length} selected)</span>
                                        </button>
                                    </div>

                                    {/* Property Scope Dropdown */}
                                    {broadcastAudienceType === 'property' && (
                                        <div className="mb-3">
                                            <label className="block text-[11px] font-bold text-slate-600 mb-1">Select Property Site</label>
                                            <select
                                                value={broadcastScope}
                                                onChange={(e) => setBroadcastScope(e.target.value)}
                                                className="w-full bg-slate-50 border border-slate-200 font-bold text-xs text-slate-900 rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-400"
                                            >
                                                {propertiesList.map(p => (
                                                    <option key={p.id} value={p.id}>
                                                        🏢 {p.name} ({propertyMembersMap[p.id]?.length || 0} members)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {/* Individual User Selector */}
                                    {broadcastAudienceType === 'users' && (
                                        <div className="mb-3 p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="relative flex-1">
                                                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                                    <input
                                                        type="text"
                                                        value={broadcastUserSearch}
                                                        onChange={(e) => setBroadcastUserSearch(e.target.value)}
                                                        placeholder="Search users by name, email, or role..."
                                                        className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-blue-400"
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const filtered = orgMembers.filter(u =>
                                                            u.full_name?.toLowerCase().includes(broadcastUserSearch.toLowerCase()) ||
                                                            u.email?.toLowerCase().includes(broadcastUserSearch.toLowerCase())
                                                        );
                                                        if (broadcastUserIds.length === filtered.length) {
                                                            setBroadcastUserIds([]);
                                                        } else {
                                                            setBroadcastUserIds(filtered.map(u => u.id));
                                                        }
                                                    }}
                                                    className="px-2.5 py-2 text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors whitespace-nowrap"
                                                >
                                                    {broadcastUserIds.length > 0 ? 'Clear All' : 'Select All'}
                                                </button>
                                            </div>

                                            <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                                                {orgMembers
                                                    .filter(u =>
                                                        u.full_name?.toLowerCase().includes(broadcastUserSearch.toLowerCase()) ||
                                                        u.email?.toLowerCase().includes(broadcastUserSearch.toLowerCase()) ||
                                                        (u.role && u.role.toLowerCase().includes(broadcastUserSearch.toLowerCase()))
                                                    )
                                                    .map(u => {
                                                        const isSelected = broadcastUserIds.includes(u.id);
                                                        return (
                                                            <div
                                                                key={u.id}
                                                                onClick={() => {
                                                                    setBroadcastUserIds(prev =>
                                                                        isSelected ? prev.filter(id => id !== u.id) : [...prev, u.id]
                                                                    );
                                                                }}
                                                                className={`flex items-center justify-between p-2 rounded-xl cursor-pointer text-xs transition-colors border ${
                                                                    isSelected
                                                                        ? 'bg-blue-50/80 border-blue-200 text-blue-900 font-semibold'
                                                                        : 'bg-white border-slate-100 hover:bg-slate-50 text-slate-700'
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isSelected}
                                                                        onChange={() => {}} // handled by parent div click
                                                                        className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-400"
                                                                    />
                                                                    <div className="truncate">
                                                                        <span className="font-bold text-slate-900 block truncate">{u.full_name || 'Unnamed User'}</span>
                                                                        <span className="text-[10px] text-slate-500 block truncate">{u.email}</span>
                                                                    </div>
                                                                </div>
                                                                {u.role && (
                                                                    <span className="text-[10px] px-2 py-0.5 rounded-md font-bold uppercase bg-slate-100 text-slate-600 shrink-0 ml-2">
                                                                        {u.role.replace(/_/g, ' ')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                            <p className="text-[11px] font-bold text-slate-500 text-right">
                                                {broadcastUserIds.length} user{broadcastUserIds.length === 1 ? '' : 's'} selected
                                            </p>
                                        </div>
                                    )}
                                </div>


                                {/* Helpdesk Contact Info */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Support Desk Contact / Email / Phone</label>
                                    <input
                                        type="text"
                                        value={helpdeskContact}
                                        onChange={(e) => setHelpdeskContact(e.target.value)}
                                        placeholder="e.g. +91 98765 43210 / desk@worksquare.in"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-blue-400"
                                    />
                                    <p className="text-[11px] text-slate-500 mt-1">This contact will be displayed at the bottom of the welcome message for user support inquiries.</p>
                                </div>

                                {/* Feature Highlights Badge List */}
                                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">FMS Capabilities Included in this Welcome Message</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
                                        <div className="flex items-center gap-2">
                                            <span className="p-1 bg-blue-100 text-blue-700 rounded-md font-bold text-[10px]">🎫</span>
                                            <span className="font-semibold text-slate-800">24/7 Service Tickets & Maintenance</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="p-1 bg-rose-100 text-rose-700 rounded-md font-bold text-[10px]">📅</span>
                                            <span className="font-semibold text-slate-800">Meeting Rooms & Reservations</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="p-1 bg-purple-100 text-purple-700 rounded-md font-bold text-[10px]">📋</span>
                                            <span className="font-semibold text-slate-800">Daily SOP Inspection Checklists</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="p-1 bg-amber-100 text-amber-700 rounded-md font-bold text-[10px]">⚡</span>
                                            <span className="font-semibold text-slate-800">Electricity & Utility Meter Logs</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="p-1 bg-emerald-100 text-emerald-700 rounded-md font-bold text-[10px]">📦</span>
                                            <span className="font-semibold text-slate-800">Material & Requisition Requests</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="p-1 bg-indigo-100 text-indigo-700 rounded-md font-bold text-[10px]">🔔</span>
                                            <span className="font-semibold text-slate-800">Instant WhatsApp & Push Updates</span>
                                        </div>
                                    </div>
                                </div>

                                {/* WhatsApp Preview Box */}
                                <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl space-y-1.5 text-xs text-slate-700">
                                    <div className="flex items-center gap-1.5 font-bold text-emerald-800 text-[11px] uppercase">
                                        <MessageSquare className="w-3.5 h-3.5" /> Meta WhatsApp Approved Preview
                                    </div>
                                    <div className="p-4 bg-white rounded-xl border border-emerald-100 shadow-2xs font-sans text-xs space-y-2.5">
                                        <p className="font-bold text-slate-900">Welcome to AutoPilot FMS 🏢</p>
                                        <p className="text-slate-800">Hello <strong>[User Full Name]</strong>,</p>
                                        <p className="text-slate-700">Welcome to AutoPilot FMS powered by AutoPilot Offices!</p>
                                        <p className="text-slate-700">Your complete Facility Management System (FMS) is now active. Here is what you can do:</p>
                                        <div className="space-y-1 text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                            <p>🎫 <strong>Service Tickets:</strong> Raise maintenance requests & track resolution live with instant SLA updates</p>
                                            <p>📅 <strong>Meeting Rooms:</strong> Check live slot availability and reserve conference spaces instantly</p>
                                            <p>📋 <strong>SOP Checklists:</strong> Complete daily site inspection checklists & quality audits</p>
                                            <p>⚡ <strong>Utility Logs:</strong> Track and monitor electricity and energy meter consumption</p>
                                            <p>📦 <strong>Material Requests:</strong> Request procurement and track delivery receipts seamlessly</p>
                                        </div>
                                        <p className="text-slate-700">Our on-site facility team is dedicated to providing you a hassle-free, world-class workplace experience.</p>
                                        <p className="text-slate-700 font-semibold">Need support? Contact our site helpdesk at <span className="text-blue-600">{helpdeskContact || 'contact.autopilotoffices@gmail.com'}</span> for prompt assistance.</p>
                                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                            <span className="text-[10px] text-slate-400">AutoPilot Facility Management</span>
                                            <span className="px-3 py-1 bg-blue-600 text-white rounded-md font-bold text-[10px]">Open FMS Portal</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                                <button
                                    type="button"
                                    onClick={() => setShowBroadcastModal(false)}
                                    className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSendBroadcast}
                                    disabled={isBroadcasting}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white font-bold rounded-xl hover:opacity-95 transition-opacity disabled:opacity-50 shadow-md text-xs"
                                >
                                    {isBroadcasting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>Broadcasting...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>🚀</span>
                                            <span>Broadcast FMS Welcome Now</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Test Voice Call Modal */}
            <AnimatePresence>
                {showTestCallModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowTestCallModal(false)}
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-10"
                        >
                            {/* Modal Header */}
                            <div className="p-6 bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300">
                                        <PhoneCall className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-bold text-white">Test Live Voice Call</h3>
                                        <p className="text-xs text-purple-200 mt-0.5">Plivo Telephony System</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowTestCallModal(false)}
                                    className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Recipient Mobile Number (with Country Code)</label>
                                    <input
                                        type="tel"
                                        value={testPhone}
                                        onChange={(e) => setTestPhone(e.target.value)}
                                        placeholder="e.g. +91 98765 43210"
                                        className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-bold text-slate-900 outline-hidden focus:ring-2 focus:ring-purple-400"
                                    />
                                    <p className="text-[11px] text-slate-500 mt-1">Enter the mobile phone that should receive the incoming phone call.</p>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Recipient Name</label>
                                    <input
                                        type="text"
                                        value={testUserName}
                                        onChange={(e) => setTestUserName(e.target.value)}
                                        placeholder="e.g. Harsh Patil"
                                        className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-semibold text-slate-900 outline-hidden focus:ring-2 focus:ring-purple-400"
                                    />
                                </div>

                                {/* Voice Persona & Speed Controls */}
                                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="block text-xs font-bold text-slate-800">Voice Speaker & Accent</label>
                                        <button
                                            type="button"
                                            onClick={() => playAudioPreview(testScript, testVoiceId, testSpeed, 'test_modal')}
                                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-100/80 hover:bg-purple-200 text-purple-800 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                                        >
                                            <Play className={`w-3 h-3 ${playingPreviewKey === 'test_modal' ? 'animate-spin text-purple-700' : 'fill-purple-700'}`} />
                                            <span>{playingPreviewKey === 'test_modal' ? 'Playing...' : '🔊 Listen Audio Preview'}</span>
                                        </button>
                                    </div>

                                    <select
                                        value={testVoiceId}
                                        onChange={(e) => setTestVoiceId(e.target.value)}
                                        className="w-full text-xs font-semibold bg-white border border-slate-300 rounded-xl p-2.5 text-slate-900 outline-hidden focus:ring-2 focus:ring-purple-400"
                                    >
                                        {AVAILABLE_VOICES.map(v => (
                                            <option key={v.id} value={v.id}>
                                                {v.name} — {v.badge}
                                            </option>
                                        ))}
                                    </select>

                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Speech Speed (Rate):</label>
                                        <div className="grid grid-cols-5 gap-1.5">
                                            {AVAILABLE_SPEEDS.map(s => (
                                                <button
                                                    key={s.value}
                                                    type="button"
                                                    onClick={() => setTestSpeed(s.value)}
                                                    className={`py-1.5 text-[11px] font-bold rounded-lg border transition-all text-center cursor-pointer ${
                                                        testSpeed === s.value
                                                            ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                                                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                                                    }`}
                                                >
                                                    {s.value}x
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="block text-xs font-bold text-slate-700">Spoken Voice Prompt / Script</label>
                                        <span className="text-[10px] font-semibold text-purple-600">Neural Voice Synthesis</span>
                                    </div>
                                    <textarea
                                        rows={3}
                                        value={testScript}
                                        onChange={(e) => setTestScript(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-medium text-slate-900 outline-hidden focus:ring-2 focus:ring-purple-400 resize-none shadow-2xs"
                                        placeholder="Type text for voice call to speak..."
                                    />
                                </div>

                                <div className="p-3.5 bg-purple-50 rounded-2xl border border-purple-200 text-xs text-purple-900 space-y-1">
                                    <div className="flex items-center gap-1.5 font-bold text-purple-800">
                                        <Sparkles className="w-3.5 h-3.5" /> Plivo Virtual Number Connected
                                    </div>
                                    <p className="text-[11px] text-purple-700">
                                        When you click "Place Call Now", Plivo will dial your mobile number from your configured virtual caller ID and speak the exact script using your selected voice persona and speed.
                                    </p>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                                <button
                                    type="button"
                                    onClick={() => setShowTestCallModal(false)}
                                    className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleTriggerTestCall}
                                    disabled={isTestingCall || !testPhone.trim()}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-slate-900 text-white font-bold rounded-xl hover:opacity-95 transition-opacity disabled:opacity-50 shadow-md text-xs"
                                >
                                    {isTestingCall ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>Calling Your Phone...</span>
                                        </>
                                    ) : (
                                        <>
                                            <PhoneCall className="w-4 h-4" />
                                            <span>Place Test Call Now</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}


