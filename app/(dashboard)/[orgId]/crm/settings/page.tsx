'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Settings, Palette, MapPin, Building2, Bell, Link2, Plus, Edit, Trash2, Loader2, Check, Send, ChevronDown, Search, X, Filter, Calendar, GraduationCap, RotateCcw, Shuffle, ToggleLeft, ToggleRight, Info, PhoneCall, Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { LeadStatusConfig, LeadSource } from '@/frontend/types/crm';
import { MetaIntegrationGuide, LinkedInIntegrationGuide } from '@/frontend/components/crm';
import LeadDistributionManager from '@/frontend/components/crm/LeadDistributionManager';
import WallpaperSettings from '@/frontend/components/dashboard/WallpaperSettings';
import { useAuth } from '@/frontend/context/AuthContext';
import { isBdSuperAdmin } from '@/frontend/constants/bdSuperAdmins';

// ── Property Mapping types ────────────────────────────────────────────────────
interface PropertyMapping {
    id: string;
    property_id: string;
    property_name: string;
    city: string;
    campaign: string;
    added_at: string;
}

// Static data — cities and campaigns from the brief
const CITIES = ['Mumbai', 'Bangalore', 'Noida'];
const CAMPAIGNS = ['Lower Parel', 'Andheri', 'Bangalore'];

const CITY_CAMPAIGN_MAP: Record<string, string[]> = {
    'Mumbai': ['Lower Parel', 'Andheri'],
    'Bangalore': ['Bangalore'],
    'Noida': [],
};

const LEAD_QUALIFICATION_INFO: Record<string, { label: string; color: string; criteria: string[] }> = {
    hot: {
        label: 'HOT',
        color: '#EF4444',
        criteria: [
            'Defined requirement (use, size, location, specs)',
            'Decision-maker engaged and responsive',
            'Budget / financing confirmed',
            'Timeline to decision within ~90 days',
            'Active deal action: tour done, proposal exchanged, or LOI in play',
        ],
    },
    warm: {
        label: 'WARM',
        color: '#F59E0B',
        criteria: [
            'Defined requirement',
            'Identified, responsive decision-maker',
            'At least one meeting or tour held',
            'Falls short of HOT on one axis (timeline 3–12mo or budget not proofed)',
            'No LOI yet',
        ],
    },
    cold: {
        label: 'COLD',
        color: '#38BDF8',
        criteria: [
            'Requirement vague or exploratory',
            'Timeline undefined or beyond 12 months',
            'Budget unknown',
            'Inquiry-only or low responsiveness; no meeting held',
        ],
    },
    ring: {
        label: 'RING',
        color: '#FB923C',
        criteria: [
            'Call attempt tracking (Ring 1-10)',
            'Each ring represents a successive call attempt to reach the prospect',
            'Higher ring numbers indicate more follow-up attempts',
            'If still unresponsive after several rings, consider marking Cold or Nurture',
        ],
    },
    future: {
        label: 'NURTURE / FUTURE',
        color: '#8B5CF6',
        criteria: [
            'Lead is real and reasonably qualified',
            'Trigger event is known and dated but distant (e.g., lease expires in 18 months)',
            'No current activity expected yet',
        ],
    },
    loss: {
        label: 'LOST',
        color: '#64748B',
        criteria: [
            'Reached real qualification but did not close',
            'Signed elsewhere, requirement cancelled, or went dark',
            'Must carry a reason code: competitor, price, timing, no-decision, unresponsive',
        ],
    },
};

type SettingsTab = 'statuses' | 'sources' | 'properties' | 'territories' | 'distribution' | 'integrations' | 'appearance';

export default function CRMSettingsPage() {
    const params = useParams();
    const orgId = params?.orgId as string;
    const { user, membership } = useAuth();
    // LinkedIn integration is restricted to BD super admins.
    const canSeeLinkedIn = isBdSuperAdmin(user?.email, membership?.org_role);
    const [activeTab, setActiveTab] = useState<SettingsTab>('statuses');
    const [statuses, setStatuses] = useState<LeadStatusConfig[]>([]);
    const [sources, setSources] = useState<LeadSource[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [editingStatus, setEditingStatus] = useState<LeadStatusConfig | null>(null);
    const [newStatus, setNewStatus] = useState({ name: '', color: '#3B82F6' });
    const [newSource, setNewSource] = useState('');
    const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);

    // Property Mapping state
    const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
    const [mappings, setMappings] = useState<PropertyMapping[]>([]);
    const [showAddProperty, setShowAddProperty] = useState(false);
    const [addPropSearch, setAddPropSearch] = useState('');
    const [selectedProp, setSelectedProp] = useState<{ id: string; name: string } | null>(null);
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedCampaign, setSelectedCampaign] = useState('');
    const [filterCity, setFilterCity] = useState('');
    const [filterCampaign, setFilterCampaign] = useState('');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const addPropRef = useRef<HTMLDivElement>(null);

    // City toggle state (which cities are active for this org)
    const [activeCities, setActiveCities] = useState<Record<string, boolean>>(() => {
        if (typeof window !== 'undefined') {
            try {
                const stored = localStorage.getItem(`crm_active_cities_${orgId}`);
                if (stored) return JSON.parse(stored);
            } catch {}
        }
        return Object.fromEntries(CITIES.map(c => [c, true]));
    });

    // City assignment per rep (simplified — localStorage-backed)
    const [cityAssignments, setCityAssignments] = useState<Record<string, string[]>>(() => {
        if (typeof window !== 'undefined') {
            try {
                const stored = localStorage.getItem(`crm_city_assignments_${orgId}`);
                if (stored) return JSON.parse(stored);
            } catch {}
        }
        return {};
    });

    // Info tooltip toggle in settings
    const [showInfoTooltips, setShowInfoTooltips] = useState(() => {
        if (typeof window !== 'undefined') {
            try {
                return localStorage.getItem(`crm_show_info_tooltips_${orgId}`) !== 'false';
            } catch {}
        }
        return true;
    });

    useEffect(() => {
        fetchSettings();
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'properties') fetchProperties();
        if (activeTab === 'territories') {
            fetch(`/api/crm/settings?type=all&org_id=${orgId}&scope=bd`)
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data?.users) setUsers(data.users); })
                .catch(() => {});
        }
    }, [activeTab]);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (addPropRef.current && !addPropRef.current.contains(e.target as Node)) {
                setShowAddProperty(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const fetchProperties = async () => {
        try {
            const res = await fetch(`/api/organizations/${orgId}/properties`);
            if (res.ok) {
                const data = await res.json();
                setProperties((data.properties || data || []).map((p: any) => ({ id: p.id, name: p.name })));
            }
        } catch {}
        // Seed localStorage mappings
        const stored = localStorage.getItem(`crm_prop_mappings_${orgId}`);
        if (stored) setMappings(JSON.parse(stored));
    };

    const saveMappings = (next: PropertyMapping[]) => {
        setMappings(next);
        localStorage.setItem(`crm_prop_mappings_${orgId}`, JSON.stringify(next));
    };

    const handleAddMapping = () => {
        if (!selectedProp || !selectedCity || !selectedCampaign) return;
        const exists = mappings.find(m => m.property_id === selectedProp.id && m.campaign === selectedCampaign);
        if (exists) return;
        const next = [...mappings, {
            id: crypto.randomUUID(),
            property_id: selectedProp.id,
            property_name: selectedProp.name,
            city: selectedCity,
            campaign: selectedCampaign,
            added_at: new Date().toISOString(),
        }];
        saveMappings(next);
        setSelectedProp(null); setSelectedCity(''); setSelectedCampaign(''); setAddPropSearch(''); setShowAddProperty(false);
    };

    const handleRemoveMapping = (id: string) => {
        saveMappings(mappings.filter(m => m.id !== id));
    };

    const fetchSettings = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/crm/settings?type=all&org_id=${orgId}`);
            if (res.ok) {
                const data = await res.json();
                setStatuses(data.statuses || []);
                setSources(data.sources || []);
            }
        } catch (error) {
            console.error('Failed to fetch settings:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateStatus = async (status: LeadStatusConfig) => {
        setIsSaving(true);
        try {
            const res = await fetch('/api/crm/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_status',
                    organization_id: orgId,
                    data: status
                })
            });
            if (res.ok) {
                setStatuses(prev => prev.map(s => s.id === status.id ? status : s));
                setEditingStatus(null);
            }
        } catch (error) {
            console.error('Failed to update status:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateStatus = async () => {
        if (!newStatus.name.trim()) return;
        setIsSaving(true);
        try {
            const res = await fetch('/api/crm/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_status',
                    organization_id: orgId,
                    data: newStatus
                })
            });
            if (res.ok) {
                const data = await res.json();
                setStatuses(prev => [...prev, data.status]);
                setNewStatus({ name: '', color: '#3B82F6' });
            }
        } catch (error) {
            console.error('Failed to create status:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteStatus = async (id: string) => {
        if (!confirm('Are you sure you want to delete this status?')) return;
        setIsSaving(true);
        try {
            const res = await fetch('/api/crm/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_status',
                    organization_id: orgId,
                    data: { id }
                })
            });
            if (res.ok) {
                setStatuses(prev => prev.filter(s => s.id !== id));
            }
        } catch (error) {
            console.error('Failed to delete status:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateSource = async () => {
        if (!newSource.trim()) return;
        setIsSaving(true);
        try {
            const res = await fetch('/api/crm/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_source',
                    organization_id: orgId,
                    data: { name: newSource }
                })
            });
            if (res.ok) {
                const data = await res.json();
                setSources(prev => [...prev, data.source]);
                setNewSource('');
            }
        } catch (error) {
            console.error('Failed to create source:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteSource = async (id: string) => {
        if (!confirm('Are you sure you want to delete this source?')) return;
        setIsSaving(true);
        try {
            const res = await fetch('/api/crm/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_source',
                    organization_id: orgId,
                    data: { id }
                })
            });
            if (res.ok) {
                setSources(prev => prev.filter(s => s.id !== id));
            }
        } catch (error) {
            console.error('Failed to delete source:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const tabs = [
        { id: 'statuses' as SettingsTab, label: 'Lead Statuses', icon: Palette },
        { id: 'sources' as SettingsTab, label: 'Lead Sources', icon: Link2 },
        { id: 'properties' as SettingsTab, label: 'Property Mapping', icon: Building2 },
        { id: 'territories' as SettingsTab, label: 'Territories', icon: MapPin },
        { id: 'distribution' as SettingsTab, label: 'Lead Distribution', icon: Shuffle },
        { id: 'integrations' as SettingsTab, label: 'Integrations', icon: Bell },
        { id: 'appearance' as SettingsTab, label: 'Appearance', icon: ImageIcon },
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">CRM Settings</h1>
                    <p className="text-sm text-text-secondary mt-1">
                        Configure lead statuses, sources, and integrations
                    </p>
                </div>
                <button
                    onClick={async () => {
                        await fetch('/api/crm/tours', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                        window.location.href = `/${orgId}/crm`;
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-text-secondary rounded-xl text-sm font-bold transition-colors"
                >
                    <GraduationCap className="w-4 h-4" />
                    Replay Tours
                </button>
            </div>

            {/* Tabs */}
            <div className="flex overflow-x-auto no-scrollbar gap-2 pb-2">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                            activeTab === tab.id
                                ? 'bg-primary text-white'
                                : 'bg-slate-100 text-text-secondary hover:bg-slate-200'
                        }`}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="bg-surface rounded-2xl border border-border p-6">
                {isLoading ? (
                    <div className="space-y-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <>
                        {activeTab === 'statuses' && (
                            <div className="space-y-6">
                                {/* Info Tooltip Toggle */}
                                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-surface-elevated rounded-xl">
                                    <div className="flex items-center gap-3">
                                        <Info className="w-5 h-5 text-primary" />
                                        <div>
                                            <p className="text-sm font-semibold text-text-primary">Lead Qualification Info Tooltips</p>
                                            <p className="text-xs text-text-secondary">Show qualification criteria on hover in lead status badges</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const next = !showInfoTooltips;
                                            setShowInfoTooltips(next);
                                            localStorage.setItem(`crm_show_info_tooltips_${orgId}`, String(next));
                                        }}
                                    >
                                        {showInfoTooltips ? (
                                            <ToggleRight className="w-8 h-8 text-primary" />
                                        ) : (
                                            <ToggleLeft className="w-8 h-8 text-text-tertiary" />
                                        )}
                                    </button>
                                </div>

                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-text-primary">Lead Statuses</h2>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={newStatus.name}
                                            onChange={(e) => setNewStatus({ ...newStatus, name: e.target.value })}
                                            placeholder="New status name"
                                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                        />
                                        <input
                                            type="color"
                                            value={newStatus.color}
                                            onChange={(e) => setNewStatus({ ...newStatus, color: e.target.value })}
                                            className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                                        />
                                        <button
                                            onClick={handleCreateStatus}
                                            disabled={!newStatus.name.trim() || isSaving}
                                            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center gap-2"
                                        >
                                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                            Add Status
                                        </button>
                                    </div>
                                </div>

                                {/* Quick-add Ring statuses */}
                                {!statuses.some(s => /ring\s*1/i.test(s.name)) && (
                                    <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl">
                                        <PhoneCall className="w-4 h-4 text-amber-600 flex-shrink-0" />
                                        <div className="flex-1">
                                            <span className="text-sm text-text-secondary">Add call-attempt ring statuses (Ring 1 through Ring 10)?</span>
                                            <p className="text-xs text-text-tertiary mt-0.5">Rings are managed as a dropdown in the lead detail view.</p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const rings = Array.from({ length: 10 }, (_, i) => ({
                                                    name: `Ring ${i + 1}`,
                                                    color: '#FB923C',
                                                }));
                                                for (const ring of rings) {
                                                    const res = await fetch('/api/crm/settings', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ action: 'create_status', organization_id: orgId, data: ring })
                                                    });
                                                    if (res.ok) {
                                                        const d = await res.json();
                                                        setStatuses(prev => [...prev, d.status]);
                                                    }
                                                }
                                            }}
                                            className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition-colors whitespace-nowrap"
                                        >
                                            Add Ring Statuses (1-10)
                                        </button>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    {statuses.map(status => (
                                        <div
                                            key={status.id}
                                            className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                                        >
                                            {editingStatus?.id === status.id ? (
                                                <div className="flex items-center gap-3 flex-1">
                                                    <input
                                                        type="color"
                                                        value={editingStatus.color}
                                                        onChange={(e) => setEditingStatus({ ...editingStatus, color: e.target.value })}
                                                        className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={editingStatus.name}
                                                        onChange={(e) => setEditingStatus({ ...editingStatus, name: e.target.value })}
                                                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                                    />
                                                    <button
                                                        onClick={() => handleUpdateStatus(editingStatus)}
                                                        disabled={isSaving}
                                                        className="p-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingStatus(null)}
                                                        className="p-2 bg-slate-200 text-text-secondary rounded-lg hover:bg-slate-300"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className="w-4 h-4 rounded-full"
                                                            style={{ backgroundColor: status.color }}
                                                        />
                                                        <span className="font-medium text-text-primary">{status.name}</span>
                                                        {(() => {
                                                            const sKey = status.name.toLowerCase();
                                                            const qInfo = LEAD_QUALIFICATION_INFO[sKey] || (sKey.startsWith('ring') ? LEAD_QUALIFICATION_INFO['ring'] : undefined);
                                                            if (!showInfoTooltips || !qInfo) return null;
                                                            return (
                                                                <div className="relative group">
                                                                    <Info className="w-3.5 h-3.5 text-text-tertiary cursor-help" />
                                                                    <div className="absolute left-6 top-0 z-50 hidden group-hover:block w-72 p-3 bg-white dark:bg-surface-elevated border border-border rounded-xl shadow-xl">
                                                                        <p className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: qInfo.color }}>
                                                                            {qInfo.label}
                                                                        </p>
                                                                        <ul className="space-y-1">
                                                                            {qInfo.criteria.map((c, i) => (
                                                                                <li key={i} className="text-[11px] text-text-secondary flex items-start gap-1.5">
                                                                                    <span className="text-text-tertiary mt-0.5">·</span>
                                                                                    {c}
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => setEditingStatus(status)}
                                                            className="p-2 hover:bg-surface-elevated rounded-lg transition-colors"
                                                        >
                                                            <Edit className="w-4 h-4 text-text-secondary" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteStatus(status.id)}
                                                            className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 className="w-4 h-4 text-red-500" />
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'sources' && (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-text-primary">Lead Sources</h2>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={newSource}
                                            onChange={(e) => setNewSource(e.target.value)}
                                            placeholder="New source name"
                                            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                        />
                                        <button
                                            onClick={handleCreateSource}
                                            disabled={!newSource.trim() || isSaving}
                                            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center gap-2"
                                        >
                                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                            Add Source
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {sources.map(source => (
                                        <div
                                            key={source.id}
                                            className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
                                        >
                                            <span className="font-medium text-text-primary text-sm">{source.name}</span>
                                            <button
                                                onClick={() => handleDeleteSource(source.id)}
                                                className="p-1 hover:bg-red-100 rounded transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4 text-red-500" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'properties' && (
                            <div className="space-y-6">
                                {/* Header + Add Property */}
                                <div className="flex items-center justify-between flex-wrap gap-3">
                                    <div>
                                        <h2 className="text-lg font-semibold text-text-primary">Property Mapping</h2>
                                        <p className="text-sm text-text-secondary mt-0.5">Link your properties to cities and campaigns for CRM filtering</p>
                                    </div>
                                    <div className="relative" ref={addPropRef}>
                                        <button
                                            onClick={() => setShowAddProperty(v => !v)}
                                            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
                                        >
                                            <Plus className="w-4 h-4" />
                                            Add Property
                                            <ChevronDown className={`w-4 h-4 transition-transform ${showAddProperty ? 'rotate-180' : ''}`} />
                                        </button>

                                        {showAddProperty && (
                                            <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-3">
                                                <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Select Property</p>
                                                {/* Property search */}
                                                <div className="relative">
                                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                                    <input
                                                        type="text"
                                                        value={addPropSearch}
                                                        onChange={e => setAddPropSearch(e.target.value)}
                                                        placeholder="Search properties..."
                                                        className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                                                    />
                                                </div>
                                                <div className="max-h-36 overflow-y-auto space-y-1">
                                                    {(properties.length
                                                        ? properties.filter(p => p.name.toLowerCase().includes(addPropSearch.toLowerCase()))
                                                        : CITIES.map(c => ({ id: c, name: c }))
                                                    ).map(p => (
                                                        <button
                                                            key={p.id}
                                                            onClick={() => setSelectedProp(p)}
                                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedProp?.id === p.id ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-slate-50 text-text-primary'}`}
                                                        >
                                                            {p.name}
                                                        </button>
                                                    ))}
                                                </div>

                                                {selectedProp && (
                                                    <>
                                                        <div>
                                                            <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">City</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {CITIES.map(c => (
                                                                    <button
                                                                        key={c}
                                                                        onClick={() => { setSelectedCity(c); setSelectedCampaign(''); }}
                                                                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${selectedCity === c ? 'bg-primary text-white' : 'bg-slate-100 text-text-secondary hover:bg-slate-200'}`}
                                                                    >
                                                                        {c}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {selectedCity && (
                                                            <div>
                                                                <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Campaign</p>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {(CITY_CAMPAIGN_MAP[selectedCity]?.length ? CITY_CAMPAIGN_MAP[selectedCity] : CAMPAIGNS).map(c => (
                                                                        <button
                                                                            key={c}
                                                                            onClick={() => setSelectedCampaign(c)}
                                                                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${selectedCampaign === c ? 'bg-primary text-white' : 'bg-slate-100 text-text-secondary hover:bg-slate-200'}`}
                                                                        >
                                                                            {c}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        <button
                                                            onClick={handleAddMapping}
                                                            disabled={!selectedCity || !selectedCampaign}
                                                            className="w-full py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
                                                        >
                                                            Confirm Mapping
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Filters */}
                                <div className="flex flex-wrap gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
                                        <Filter className="w-3.5 h-3.5" />
                                        Filters:
                                    </div>
                                    {/* Date from */}
                                    <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                        <input
                                            type="date"
                                            value={filterDateFrom}
                                            onChange={e => setFilterDateFrom(e.target.value)}
                                            className="text-xs text-text-primary bg-transparent focus:outline-none"
                                            placeholder="From"
                                        />
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                        <input
                                            type="date"
                                            value={filterDateTo}
                                            onChange={e => setFilterDateTo(e.target.value)}
                                            className="text-xs text-text-primary bg-transparent focus:outline-none"
                                            placeholder="To"
                                        />
                                    </div>
                                    {/* City filter */}
                                    <select
                                        value={filterCity}
                                        onChange={e => { setFilterCity(e.target.value); setFilterCampaign(''); }}
                                        className="text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="">All Cities</option>
                                        {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    {/* Campaign filter */}
                                    <select
                                        value={filterCampaign}
                                        onChange={e => setFilterCampaign(e.target.value)}
                                        className="text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="">All Campaigns</option>
                                        {(filterCity && CITY_CAMPAIGN_MAP[filterCity]?.length ? CITY_CAMPAIGN_MAP[filterCity] : CAMPAIGNS).map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                    {(filterCity || filterCampaign || filterDateFrom || filterDateTo) && (
                                        <button
                                            onClick={() => { setFilterCity(''); setFilterCampaign(''); setFilterDateFrom(''); setFilterDateTo(''); }}
                                            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 font-medium"
                                        >
                                            <X className="w-3 h-3" /> Clear
                                        </button>
                                    )}
                                </div>

                                {/* Mappings table */}
                                {mappings.length === 0 ? (
                                    <div className="text-center py-12 text-text-secondary">
                                        <Building2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                                        <p className="font-medium">No properties mapped yet</p>
                                        <p className="text-sm mt-1">Click "Add Property" to link a property to a city and campaign</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-slate-200">
                                                    <th className="text-left pb-3 px-2 text-xs font-bold text-text-secondary uppercase tracking-wider">Property</th>
                                                    <th className="text-left pb-3 px-2 text-xs font-bold text-text-secondary uppercase tracking-wider">City</th>
                                                    <th className="text-left pb-3 px-2 text-xs font-bold text-text-secondary uppercase tracking-wider">Campaign</th>
                                                    <th className="text-left pb-3 px-2 text-xs font-bold text-text-secondary uppercase tracking-wider">Added</th>
                                                    <th className="pb-3 px-2" />
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {mappings
                                                    .filter(m => {
                                                        if (filterCity && m.city !== filterCity) return false;
                                                        if (filterCampaign && m.campaign !== filterCampaign) return false;
                                                        if (filterDateFrom && m.added_at < filterDateFrom) return false;
                                                        if (filterDateTo && m.added_at > filterDateTo + 'T23:59:59') return false;
                                                        return true;
                                                    })
                                                    .map(m => (
                                                        <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                                                            <td className="py-3 px-2 font-medium text-text-primary">{m.property_name}</td>
                                                            <td className="py-3 px-2">
                                                                <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold">{m.city}</span>
                                                            </td>
                                                            <td className="py-3 px-2">
                                                                <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded-lg text-xs font-semibold">{m.campaign}</span>
                                                            </td>
                                                            <td className="py-3 px-2 text-text-secondary text-xs">
                                                                {new Date(m.added_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                            </td>
                                                            <td className="py-3 px-2 text-right">
                                                                <button
                                                                    onClick={() => handleRemoveMapping(m.id)}
                                                                    className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                                                                >
                                                                    <Trash2 className="w-4 h-4 text-red-400" />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'territories' && (
                            <div className="space-y-8">
                                {/* City Toggles */}
                                <div>
                                    <h2 className="text-lg font-semibold text-text-primary mb-1">City Management</h2>
                                    <p className="text-sm text-text-secondary mb-4">Enable or disable cities for lead routing</p>
                                    <div className="space-y-3">
                                        {CITIES.map(city => (
                                            <div key={city} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-surface-elevated rounded-xl">
                                                <div className="flex items-center gap-3">
                                                    <MapPin className="w-4 h-4 text-primary" />
                                                    <span className="font-medium text-text-primary">{city}</span>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const next = { ...activeCities, [city]: !activeCities[city] };
                                                        setActiveCities(next);
                                                        localStorage.setItem(`crm_active_cities_${orgId}`, JSON.stringify(next));
                                                    }}
                                                    className="flex items-center gap-2"
                                                >
                                                    {activeCities[city] ? (
                                                        <ToggleRight className="w-8 h-8 text-primary" />
                                                    ) : (
                                                        <ToggleLeft className="w-8 h-8 text-text-tertiary" />
                                                    )}
                                                    <span className={`text-xs font-bold ${activeCities[city] ? 'text-primary' : 'text-text-tertiary'}`}>
                                                        {activeCities[city] ? 'Active' : 'Inactive'}
                                                    </span>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* City Assignment */}
                                <div>
                                    <h2 className="text-lg font-semibold text-text-primary mb-1">City Assignment</h2>
                                    <p className="text-sm text-text-secondary mb-4">Assign reps to specific cities for territory-based routing</p>
                                    {users.length === 0 ? (
                                        <p className="text-sm text-text-tertiary text-center py-6">No team members found. Add users to assign cities.</p>
                                    ) : (
                                        <div className="space-y-3">
                                            {users.map((u: any) => (
                                                <div key={u.id} className="p-4 bg-slate-50 dark:bg-surface-elevated rounded-xl">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="font-medium text-text-primary text-sm">{u.full_name}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {CITIES.filter(c => activeCities[c]).map(city => {
                                                            const assigned = (cityAssignments[u.id] || []).includes(city);
                                                            return (
                                                                <button
                                                                    key={city}
                                                                    onClick={() => {
                                                                        const current = cityAssignments[u.id] || [];
                                                                        const next = assigned
                                                                            ? current.filter(c => c !== city)
                                                                            : [...current, city];
                                                                        const updated = { ...cityAssignments, [u.id]: next };
                                                                        setCityAssignments(updated);
                                                                        localStorage.setItem(`crm_city_assignments_${orgId}`, JSON.stringify(updated));
                                                                    }}
                                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                                                        assigned
                                                                            ? 'bg-primary text-white'
                                                                            : 'bg-white dark:bg-surface border border-border text-text-secondary hover:border-primary'
                                                                    }`}
                                                                >
                                                                    {city}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'distribution' && (
                            <LeadDistributionManager orgId={orgId} />
                        )}

                        {activeTab === 'integrations' && (
                            <div className="space-y-8">
                                <div>
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                                            <span className="text-xl font-bold text-blue-600">M</span>
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-text-primary">Meta Lead Ads</h3>
                                            <p className="text-sm text-text-secondary">Capture Facebook/Instagram leads directly into your CRM</p>
                                        </div>
                                    </div>
                                    <MetaIntegrationGuide orgId={orgId} />
                                </div>

                                {canSeeLinkedIn && (
                                    <div className="border-t border-slate-200 pt-6">
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="w-12 h-12 bg-[#0A66C2]/10 rounded-xl flex items-center justify-center">
                                                <span className="text-xl font-bold text-[#0A66C2]">in</span>
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-text-primary">LinkedIn Lead Gen + Ads</h3>
                                                <p className="text-sm text-text-secondary">Pull LinkedIn Lead Gen Form responses + ad spend into your CRM</p>
                                            </div>
                                            <span className="ml-auto text-[10px] font-bold px-2 py-1 rounded-full bg-[#0A66C2]/10 text-[#0A66C2]">BD Super Admin</span>
                                        </div>
                                        <LinkedInIntegrationGuide orgId={orgId} />
                                    </div>
                                )}

                                <div className="border-t border-slate-200 pt-6">
                                    <div className="flex items-center justify-between flex-wrap gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                                                <Send className="w-6 h-6 text-green-600" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-text-primary">WhatsApp Campaigns</h3>
                                                <p className="text-sm text-text-secondary">Send broadcasts & drip sequences to leads via WhatsApp Business</p>
                                            </div>
                                        </div>
                                        <Link href={`/${orgId}/crm/campaigns`}
                                            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                                            Open Campaigns
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'appearance' && (
                            <WallpaperSettings />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}