'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Mail, Shield, Users, Check, Plus, Trash2, Save, Loader2,
    CheckCircle2, AlertCircle, ShoppingCart, FileText, Truck,
    Calendar, UserCheck, Layers, HelpCircle, X, Building, Search, UserPlus, ChevronDown, User, ShoppingBag
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

interface FeatureEmailConfig {
    enabled?: boolean;
    roles?: string[];
    user_ids?: string[];
    custom_emails?: string[];
    property_overrides?: Record<string, {
        enabled?: boolean;
        roles?: string[];
        user_ids?: string[];
        custom_emails?: string[];
    }>;
    notify_assignee?: boolean;
    notify_requester?: boolean;
    notify_approver?: boolean;
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
    selectedUserIds,
    onSelectUser,
    scopeName
}: {
    availableUsers: UserItem[];
    selectedUserIds: string[];
    onSelectUser: (userId: string) => void;
    scopeName: string;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');

    const unselectedUsers = availableUsers.filter(u => !selectedUserIds.includes(u.id));
    const filteredUsers = unselectedUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(query.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(query.toLowerCase())
    );

    return (
        <div className="relative inline-block text-left">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-all"
            >
                <UserPlus className="w-3.5 h-3.5 text-primary" />
                <span>+ Add user...</span>
                <ChevronDown className="w-3 h-3 text-slate-400 ml-1" />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute left-0 mt-1 w-72 md:w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-2 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                        {/* Search Input */}
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                autoFocus
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={`Search ${scopeName} members...`}
                                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                        </div>

                        {/* Options List */}
                        <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
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
                                        className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-100 text-left transition-colors group"
                                    >
                                        <div className="w-7 h-7 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs shrink-0">
                                            {(u.full_name || u.email || 'U').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-slate-900 truncate group-hover:text-primary">
                                                {u.full_name}
                                            </p>
                                            <p className="text-[10px] text-slate-500 truncate">
                                                {u.email}
                                            </p>
                                        </div>
                                        {u.role && (
                                            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                                                {formatRoleLabel(u.role)}
                                            </span>
                                        )}
                                    </button>
                                ))
                            ) : (
                                <div className="py-4 text-center text-xs text-slate-400 font-medium">
                                    No members found matching "{query}" in {scopeName}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

interface FeatureEmailConfig {
    enabled?: boolean;
    roles?: string[];
    user_ids?: string[];
    custom_emails?: string[];
    property_overrides?: Record<string, {
        enabled?: boolean;
        roles?: string[];
        user_ids?: string[];
        custom_emails?: string[];
    }>;
    notify_assignee?: boolean;
    notify_requester?: boolean;
    notify_approver?: boolean;
}

const FEATURES_META = [
    {
        id: 'material_requests',
        name: 'Material Requests',
        description: 'Emails sent when site staff or technicians submit a new material request.',
        icon: ShoppingCart,
        color: 'text-blue-500 bg-blue-50'
    },
    {
        id: 'comparative_quotes',
        name: 'Comparative Quotes & Approvals',
        description: 'Emails sent when comparative statements are uploaded, approved, or rejected.',
        icon: FileText,
        color: 'text-amber-500 bg-amber-50'
    },
    {
        id: 'material_delivery',
        name: 'Material Delivery Receipts',
        description: 'Emails sent when materials are marked as delivered on site with photo proof.',
        icon: Truck,
        color: 'text-emerald-500 bg-emerald-50'
    },
    {
        id: 'monthly_requisitions',
        name: 'Monthly Requisitions',
        description: 'Alerts sent when property admins upload monthly stock requisition sheets.',
        icon: Layers,
        color: 'text-indigo-500 bg-indigo-50'
    },
    {
        id: 'meeting_rooms',
        name: 'Meeting Room Bookings',
        description: 'Notifications sent on meeting room reservations or cancellations.',
        icon: Calendar,
        color: 'text-rose-500 bg-rose-50'
    },
    {
        id: 'crm_leads',
        name: 'CRM Sales Leads',
        description: 'Alerts sent when new sales leads are created or assigned to sales members.',
        icon: UserCheck,
        color: 'text-violet-500 bg-violet-50'
    },
    {
        id: 'procurement_vendor_tag',
        name: 'Vendor Procurement Tagging',
        description: 'Emails sent when site staff tag procurement team to arrange external vendors or services.',
        icon: ShoppingBag,
        color: 'text-amber-500 bg-amber-50'
    },
    {
        id: 'procurement_vendor_aligned',
        name: 'Vendor Aligned / Arranged Updates',
        description: 'Emails sent when procurement arranges an external vendor or updates vendor details on a ticket.',
        icon: CheckCircle2,
        color: 'text-emerald-500 bg-emerald-50'
    }
];

const DEFAULT_CONFIGS: Record<string, FeatureEmailConfig> = {
    material_requests: {
        enabled: true,
        roles: ['procurement', 'org_super_admin'],
        user_ids: [],
        custom_emails: [],
        notify_assignee: true
    },
    comparative_quotes: {
        enabled: true,
        roles: ['org_super_admin', 'procurement'],
        user_ids: [],
        custom_emails: [],
        notify_approver: true
    },
    material_delivery: {
        enabled: true,
        roles: ['property_admin', 'procurement', 'org_super_admin'],
        user_ids: [],
        custom_emails: [],
        notify_requester: true
    },
    monthly_requisitions: {
        enabled: true,
        roles: ['procurement', 'org_super_admin'],
        user_ids: [],
        custom_emails: []
    },
    meeting_rooms: {
        enabled: true,
        roles: ['property_admin', 'org_super_admin'],
        user_ids: [],
        custom_emails: [],
        notify_requester: true
    },
    crm_leads: {
        enabled: true,
        roles: ['org_super_admin'],
        user_ids: [],
        custom_emails: ['saniel@worksquare.in', 'rushab@worksquare.in', 'nirupam.lahiri@worksquare.in', 'lohitexplores@gmail.com'],
        notify_assignee: true
    },
    procurement_vendor_tag: {
        enabled: true,
        roles: ['procurement'],
        user_ids: [],
        custom_emails: []
    },
    procurement_vendor_aligned: {
        enabled: true,
        roles: [],
        user_ids: [],
        custom_emails: [],
        notify_requester: true
    }
};

interface EmailServiceSettingsProps {
    organizationId: string;
}

export default function EmailServiceSettings({ organizationId }: EmailServiceSettingsProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [orgMembers, setOrgMembers] = useState<{ id: string; full_name: string; email: string }[]>([]);
    const [propertyMembersMap, setPropertyMembersMap] = useState<Record<string, UserItem[]>>({});
    const [availableRoles, setAvailableRoles] = useState<{ id: string; label: string; bg: string }[]>([]);
    const [propertiesList, setPropertiesList] = useState<{ id: string; name: string }[]>([]);
    const [selectedPropertyScope, setSelectedPropertyScope] = useState<string>('global');
    const [configMap, setConfigMap] = useState<Record<string, FeatureEmailConfig>>(DEFAULT_CONFIGS);
    const [newEmailMap, setNewEmailMap] = useState<Record<string, string>>({});
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const supabase = createClient();

    const getScopedUsers = (): UserItem[] => {
        if (selectedPropertyScope === 'global') {
            return orgMembers;
        }
        return propertyMembersMap[selectedPropertyScope] || [];
    };

    const getScopeName = (): string => {
        if (selectedPropertyScope === 'global') return 'Organization';
        const p = propertiesList.find(item => item.id === selectedPropertyScope);
        return p ? p.name : 'Property';
    };

    useEffect(() => {
        if (organizationId) {
            fetchData();
        }
    }, [organizationId]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            // 1. Fetch organization settings
            const res = await fetch(`/api/admin/organizations/${organizationId}`);
            if (res.ok) {
                const data = await res.json();
                if (data?.email_service_config) {
                    const loadedConfig = data.email_service_config;

                    // Ensure CRM Sales Leads has the hardcoded team emails if custom_emails is not explicitly set
                    if (loadedConfig.crm_leads && (!loadedConfig.crm_leads.custom_emails || loadedConfig.crm_leads.custom_emails.length === 0)) {
                        loadedConfig.crm_leads.custom_emails = ['saniel@worksquare.in', 'rushab@worksquare.in', 'nirupam.lahiri@worksquare.in', 'lohitexplores@gmail.com'];
                    }

                    setConfigMap(prev => ({
                        ...DEFAULT_CONFIGS,
                        ...loadedConfig
                    }));
                }
            }

            // 2. Fetch Organization Members & Roles from DB
            const { data: orgMems } = await supabase
                .from('organization_memberships')
                .select('role, user_id, users:user_id(id, full_name, email)')
                .eq('organization_id', organizationId)
                .eq('is_active', true);

            const rolesSet = new Set<string>();

            if (orgMems) {
                const userList = orgMems
                    .map((m: any) => m.users || (Array.isArray(m.users) ? m.users[0] : null))
                    .filter((u: any) => u && u.id);
                setOrgMembers(userList);

                orgMems.forEach((m: any) => {
                    if (m.role) rolesSet.add(m.role.toLowerCase());
                });
            }

            // 3. Fetch Properties and Property Memberships for this Organization
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

            // Add core standard roles if present or configured
            const baseRoles = ['org_super_admin', 'procurement', 'property_admin', 'staff', 'mst'];
            baseRoles.forEach(r => rolesSet.add(r));

            const dbRolesList = Array.from(rolesSet).map(r => ({
                id: r,
                label: formatRoleLabel(r),
                bg: getRoleStyle(r)
            }));

            setAvailableRoles(dbRolesList);
        } catch (err) {
            console.error('Error fetching email service settings:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const getEffectiveConfig = (featureId: string): FeatureEmailConfig => {
        const globalConfig = configMap[featureId] || DEFAULT_CONFIGS[featureId] || { enabled: true, roles: [], user_ids: [], custom_emails: [] };
        if (selectedPropertyScope === 'global') {
            return globalConfig;
        }
        const override = globalConfig.property_overrides?.[selectedPropertyScope];
        if (override) {
            return {
                ...globalConfig,
                ...override,
                enabled: override.enabled !== undefined ? override.enabled : globalConfig.enabled
            };
        }
        return globalConfig;
    };

    const updateFeatureConfig = (featureId: string, updateFn: (current: FeatureEmailConfig) => FeatureEmailConfig) => {
        setConfigMap(prev => {
            const globalConfig = prev[featureId] || DEFAULT_CONFIGS[featureId] || { enabled: true, roles: [], user_ids: [], custom_emails: [] };

            if (selectedPropertyScope === 'global') {
                return {
                    ...prev,
                    [featureId]: updateFn(globalConfig)
                };
            }

            // Property-specific override
            const currentOverrides = globalConfig.property_overrides || {};
            const currentPropertyOverride = currentOverrides[selectedPropertyScope] || {
                enabled: globalConfig.enabled,
                roles: [...(globalConfig.roles || [])],
                user_ids: [...(globalConfig.user_ids || [])],
                custom_emails: [...(globalConfig.custom_emails || [])]
            };

            const updatedPropertyOverride = updateFn(currentPropertyOverride);

            return {
                ...prev,
                [featureId]: {
                    ...globalConfig,
                    property_overrides: {
                        ...currentOverrides,
                        [selectedPropertyScope]: updatedPropertyOverride
                    }
                }
            };
        });
    };

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await fetch(`/api/admin/organizations/${organizationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email_service_config: configMap })
            });

            if (res.ok) {
                showToast('Email service configuration saved successfully!');
            } else {
                showToast('Failed to save email service configuration.', 'error');
            }
        } catch (err) {
            console.error('Error saving email service config:', err);
            showToast('An error occurred while saving.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleFeature = (featureId: string) => {
        updateFeatureConfig(featureId, current => ({
            ...current,
            enabled: current.enabled === undefined ? false : !current.enabled
        }));
    };

    const handleToggleRole = (featureId: string, roleId: string) => {
        updateFeatureConfig(featureId, current => {
            const currentRoles = current.roles || [];
            const newRoles = currentRoles.includes(roleId)
                ? currentRoles.filter(r => r !== roleId)
                : [...currentRoles, roleId];
            return { ...current, roles: newRoles };
        });
    };

    const handleAddUser = (featureId: string, userId: string) => {
        if (!userId) return;
        updateFeatureConfig(featureId, current => {
            const currentUsers = current.user_ids || [];
            if (currentUsers.includes(userId)) return current;
            return { ...current, user_ids: [...currentUsers, userId] };
        });
    };

    const handleRemoveUser = (featureId: string, userId: string) => {
        updateFeatureConfig(featureId, current => ({
            ...current,
            user_ids: (current.user_ids || []).filter(id => id !== userId)
        }));
    };

    const handleAddCustomEmail = (featureId: string) => {
        const rawEmail = (newEmailMap[featureId] || '').trim().toLowerCase();
        if (!rawEmail || !rawEmail.includes('@')) return;

        updateFeatureConfig(featureId, current => {
            const existingEmails = current.custom_emails || [];
            if (existingEmails.includes(rawEmail)) return current;
            return { ...current, custom_emails: [...existingEmails, rawEmail] };
        });

        setNewEmailMap(prev => ({ ...prev, [featureId]: '' }));
    };

    const handleRemoveCustomEmail = (featureId: string, emailToRemove: string) => {
        updateFeatureConfig(featureId, current => ({
            ...current,
            custom_emails: (current.custom_emails || []).filter(e => e !== emailToRemove)
        }));
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
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                    <h2 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Mail className="w-5 h-5 text-primary" />
                        Email Service Management
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Configure target roles and specific users who receive email notifications for each feature module.
                    </p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm text-xs"
                >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Email Service
                </button>
            </div>

            {/* Scope Selection Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
                        <Building className="w-5 h-5" />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-900 text-sm">Configuration Scope</h4>
                        <p className="text-xs text-slate-500">Configure global org defaults or property-specific recipient rules.</p>
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

            <div className="grid grid-cols-1 gap-5">
                {FEATURES_META.map(feat => {
                    const featureConfig = getEffectiveConfig(feat.id);
                    const isEnabled = featureConfig.enabled !== false;
                    const Icon = feat.icon;

                    return (
                        <div
                            key={feat.id}
                            className={`rounded-2xl border transition-all ${
                                isEnabled 
                                    ? 'bg-white border-slate-200 shadow-sm' 
                                    : 'bg-slate-50/70 border-slate-200 opacity-75'
                            } p-5 space-y-4`}
                        >
                            {/* Feature Header */}
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2.5 rounded-xl ${feat.color}`}>
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-bold text-slate-900 text-sm">{feat.name}</h3>
                                            <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                                isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                                            }`}>
                                                {isEnabled ? 'Active' : 'Disabled'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5">{feat.description}</p>
                                    </div>
                                </div>

                                {/* Enable / Disable Switch */}
                                <button
                                    type="button"
                                    onClick={() => handleToggleFeature(feat.id)}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        isEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                            isEnabled ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                            </div>

                            {isEnabled && (
                                <div className="pt-3 border-t border-slate-100 space-y-4">
                                    {/* Role Selectors */}
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                            Target Roles (Who gets notified)
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {availableRoles.map(role => {
                                                const isSelected = (featureConfig.roles || []).includes(role.id);
                                                return (
                                                    <button
                                                        key={role.id}
                                                        type="button"
                                                        onClick={() => handleToggleRole(feat.id, role.id)}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                                                            isSelected
                                                                ? `${role.bg} shadow-xs ring-2 ring-primary/20`
                                                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        {isSelected && <Check className="w-3.5 h-3.5 text-current" />}
                                                        {role.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Specific Individual Users Picker */}
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                            Specific Individual Users
                                        </label>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {(featureConfig.user_ids || []).map(uid => {
                                                const scopedUsers = getScopedUsers();
                                                const u = scopedUsers.find(m => m.id === uid) || orgMembers.find(m => m.id === uid);
                                                return (
                                                    <span
                                                        key={uid}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-indigo-50 border border-indigo-200 text-xs font-semibold text-indigo-900 shadow-2xs"
                                                    >
                                                        <User className="w-3.5 h-3.5 text-indigo-500" />
                                                        <span>{u ? `${u.full_name} (${u.email})` : uid}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveUser(feat.id, uid)}
                                                            className="text-indigo-400 hover:text-rose-600 transition-colors ml-0.5"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </span>
                                                );
                                            })}

                                            <SearchableUserPicker
                                                availableUsers={getScopedUsers()}
                                                selectedUserIds={featureConfig.user_ids || []}
                                                onSelectUser={(userId) => handleAddUser(feat.id, userId)}
                                                scopeName={getScopeName()}
                                            />
                                        </div>
                                    </div>

                                    {/* Explicit / System Hardcoded Email Recipients */}
                                    <div className="pt-2 border-t border-slate-100">
                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                            Explicit / Hardcoded Email Addresses
                                        </label>

                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                            {(featureConfig.custom_emails || []).map(email => (
                                                <span
                                                    key={email}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold rounded-full shadow-xs"
                                                >
                                                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                                                    <span>{email}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveCustomEmail(feat.id, email)}
                                                        className="text-slate-400 hover:text-rose-600 transition-colors ml-0.5"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>

                                        <div className="flex items-center gap-2 max-w-md">
                                            <input
                                                type="email"
                                                value={newEmailMap[feat.id] || ''}
                                                onChange={(e) => setNewEmailMap({ ...newEmailMap, [feat.id]: e.target.value })}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleAddCustomEmail(feat.id);
                                                    }
                                                }}
                                                placeholder="Add hardcoded email (e.g. admin@company.com)..."
                                                className="flex-1 px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handleAddCustomEmail(feat.id)}
                                                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors flex items-center gap-1"
                                            >
                                                <Plus className="w-3.5 h-3.5" /> Add
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="flex justify-end pt-4">
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 shadow-md text-sm"
                >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                </button>
            </div>

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
