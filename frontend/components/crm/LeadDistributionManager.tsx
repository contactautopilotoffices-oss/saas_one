'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Trash2, Users, Shuffle, UserCheck, ChevronDown, X } from 'lucide-react';

interface OrgMember {
    user_id: string;
    full_name: string;
    email: string;
    role: string;
}

interface DistributionMember {
    id: string;
    user_id: string;
    is_active: boolean;
    assigned_count: number;
    last_assigned_at: string | null;
    user_info: { id: string; full_name: string; email: string } | null;
}

interface DistributionRule {
    id: string;
    campaign: string;
    mode: 'exclusive' | 'round_robin';
    is_active: boolean;
    members: DistributionMember[];
}

interface LeadDistributionManagerProps {
    orgId: string;
}

export default function LeadDistributionManager({ orgId }: LeadDistributionManagerProps) {
    const [rules, setRules] = useState<DistributionRule[]>([]);
    const [members, setMembers] = useState<OrgMember[]>([]);
    const [campaigns, setCampaigns] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);

    // Add form state
    const [newCampaign, setNewCampaign] = useState('');
    const [customCampaign, setCustomCampaign] = useState('');
    const [newMode, setNewMode] = useState<'exclusive' | 'round_robin'>('round_robin');
    const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
    const [showUserDropdown, setShowUserDropdown] = useState(false);

    // Bulk reassign (territory cleanup)
    const [reassign, setReassign] = useState<any | null>(null);
    const [reassignLoading, setReassignLoading] = useState(false);
    const [reassignApplying, setReassignApplying] = useState(false);
    const [reassignDone, setReassignDone] = useState<string | null>(null);

    const callReassign = async (apply: boolean) => {
        const res = await fetch('/api/crm/distribution/reassign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organization_id: orgId, apply }),
        });
        return res.ok ? res.json() : null;
    };

    const previewReassign = async () => {
        setReassignLoading(true);
        setReassignDone(null);
        try {
            const data = await callReassign(false);
            if (data) setReassign(data);
        } catch (e) {
            console.error('reassign preview failed', e);
        } finally {
            setReassignLoading(false);
        }
    };

    const applyReassign = async () => {
        setReassignApplying(true);
        try {
            const data = await callReassign(true);
            if (data) {
                setReassignDone(
                    `Moved ${data.moved} lead${data.moved !== 1 ? 's' : ''}` +
                    (data.unassigned ? `, unassigned ${data.unassigned} (no in-territory rep).` : '.')
                );
                setReassign(null);
                fetchData();
            }
        } catch (e) {
            console.error('reassign apply failed', e);
        } finally {
            setReassignApplying(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/crm/distribution?organization_id=${orgId}`);
            if (res.ok) {
                const data = await res.json();
                setRules(data.rules || []);
                setMembers(data.members || []);
                setCampaigns(data.campaigns || []);
            }
        } catch (err) {
            console.error('Failed to fetch distribution rules:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        const campaign = newCampaign === '__custom__' ? customCampaign.trim() : newCampaign;
        if (!campaign || !selectedUsers.length) return;

        setSaving(true);
        try {
            const res = await fetch('/api/crm/distribution', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    organization_id: orgId,
                    campaign,
                    mode: newMode,
                    user_ids: selectedUsers,
                }),
            });
            if (res.ok) {
                await fetchData();
                resetForm();
            }
        } catch (err) {
            console.error('Failed to create rule:', err);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (ruleId: string) => {
        if (!confirm('Remove this distribution rule?')) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/crm/distribution?id=${ruleId}&organization_id=${orgId}`, { method: 'DELETE' });
            if (res.ok) await fetchData();
        } catch (err) {
            console.error('Failed to delete rule:', err);
        } finally {
            setSaving(false);
        }
    };

    const resetForm = () => {
        setShowAddForm(false);
        setNewCampaign('');
        setCustomCampaign('');
        setNewMode('round_robin');
        setSelectedUsers([]);
    };

    const toggleUser = (userId: string) => {
        if (newMode === 'exclusive') {
            setSelectedUsers([userId]);
        } else {
            setSelectedUsers(prev =>
                prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
            );
        }
    };

    const existingCampaigns = new Set(rules.map(r => r.campaign));
    const availableCampaigns = campaigns.filter(c => !existingCampaigns.has(c));

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-text-primary">Lead Distribution</h2>
                    <p className="text-sm text-text-secondary mt-0.5">
                        Assign campaigns to reps exclusively or distribute leads round-robin
                    </p>
                </div>
                <button
                    onClick={() => setShowAddForm(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Add Rule
                </button>
            </div>

            {/* Territory cleanup: bulk-reassign mis-routed leads */}
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 p-4 md:p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                            <UserCheck className="w-4 h-4" /> Fix mis-routed leads
                        </h3>
                        <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5 max-w-2xl">
                            Move open leads assigned to a rep outside their territory (e.g. a Mumbai lead on a Bangalore rep)
                            to a rep whose territory matches. Reps with no territory set are left untouched. Always shows a
                            preview before any change.
                        </p>
                    </div>
                    <button
                        onClick={previewReassign}
                        disabled={reassignLoading}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 disabled:opacity-50 transition-colors shrink-0"
                    >
                        {reassignLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shuffle className="w-3.5 h-3.5" />}
                        Check now
                    </button>
                </div>

                {reassignDone && (
                    <p className="mt-3 text-xs font-bold text-emerald-700 dark:text-emerald-400">✓ {reassignDone}</p>
                )}

                {reassign && (
                    <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-white dark:bg-surface overflow-hidden">
                        {reassign.misassigned === 0 ? (
                            <p className="px-4 py-3 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                ✓ All {reassign.checked} open leads are correctly assigned — nothing to fix.
                            </p>
                        ) : (
                            <>
                                <div className="px-4 py-2.5 border-b border-amber-100 dark:border-amber-900/40 flex items-center justify-between gap-3 flex-wrap">
                                    <p className="text-xs font-bold text-text-primary">
                                        {reassign.misassigned} mis-routed lead{reassign.misassigned !== 1 ? 's' : ''}
                                        {reassign.unassigned ? ` · ${reassign.unassigned} have no in-territory rep (→ pool)` : ''}
                                    </p>
                                    <button
                                        onClick={applyReassign}
                                        disabled={reassignApplying}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-white text-[11px] font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                    >
                                        {reassignApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
                                        Apply {reassign.misassigned} change{reassign.misassigned !== 1 ? 's' : ''}
                                    </button>
                                </div>
                                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                                    {reassign.reassignments.slice(0, 100).map((r: any) => (
                                        <div key={r.lead_id} className="px-4 py-2 flex items-center gap-2 text-[11px]">
                                            <span className="font-bold text-text-primary truncate max-w-[160px]">{r.name}</span>
                                            {r.city && <span className="text-text-tertiary whitespace-nowrap">· {r.city}</span>}
                                            <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
                                                <span className="text-rose-600 dark:text-rose-400 line-through">{r.from_name}</span>
                                                <span className="text-text-tertiary">→</span>
                                                <span className={`font-bold ${r.to_name ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600'}`}>
                                                    {r.to_name || 'Unassigned (pool)'}
                                                </span>
                                            </span>
                                        </div>
                                    ))}
                                    {reassign.reassignments.length > 100 && (
                                        <p className="px-4 py-2 text-[10px] text-text-tertiary">+ {reassign.reassignments.length - 100} more…</p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Add Rule Form */}
            {showAddForm && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-slate-700">New Distribution Rule</p>
                        <button onClick={resetForm} className="p-1 hover:bg-slate-200 rounded-lg">
                            <X className="w-4 h-4 text-slate-500" />
                        </button>
                    </div>

                    {/* Campaign selection */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Campaign</label>
                        <select
                            value={newCampaign}
                            onChange={e => setNewCampaign(e.target.value)}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                            <option value="">Select campaign...</option>
                            {availableCampaigns.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                            <option value="__custom__">+ Custom campaign name</option>
                        </select>
                        {newCampaign === '__custom__' && (
                            <input
                                type="text"
                                value={customCampaign}
                                onChange={e => setCustomCampaign(e.target.value)}
                                placeholder="Enter campaign name..."
                                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                        )}
                    </div>

                    {/* Mode selection */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Distribution Mode</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => { setNewMode('round_robin'); setSelectedUsers(prev => prev.length > 1 ? prev : prev); }}
                                className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-colors text-left ${
                                    newMode === 'round_robin'
                                        ? 'border-primary bg-primary/5'
                                        : 'border-slate-200 hover:border-slate-300'
                                }`}
                            >
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                    newMode === 'round_robin' ? 'bg-primary/10' : 'bg-slate-100'
                                }`}>
                                    <Shuffle className={`w-5 h-5 ${newMode === 'round_robin' ? 'text-primary' : 'text-slate-400'}`} />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-slate-900">Round Robin</p>
                                    <p className="text-[11px] text-slate-500 mt-0.5">Distribute equally among reps</p>
                                </div>
                            </button>
                            <button
                                onClick={() => { setNewMode('exclusive'); setSelectedUsers(prev => prev.slice(0, 1)); }}
                                className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-colors text-left ${
                                    newMode === 'exclusive'
                                        ? 'border-primary bg-primary/5'
                                        : 'border-slate-200 hover:border-slate-300'
                                }`}
                            >
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                    newMode === 'exclusive' ? 'bg-primary/10' : 'bg-slate-100'
                                }`}>
                                    <UserCheck className={`w-5 h-5 ${newMode === 'exclusive' ? 'text-primary' : 'text-slate-400'}`} />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-slate-900">Exclusive</p>
                                    <p className="text-[11px] text-slate-500 mt-0.5">All leads to one rep</p>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* Rep selection */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                            {newMode === 'exclusive' ? 'Assign To' : 'Reps in Rotation'}
                        </label>
                        <div className="relative">
                            <button
                                onClick={() => setShowUserDropdown(v => !v)}
                                className="w-full flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white hover:bg-slate-50"
                            >
                                <span className={selectedUsers.length ? 'text-slate-900' : 'text-slate-400'}>
                                    {selectedUsers.length
                                        ? `${selectedUsers.length} rep${selectedUsers.length > 1 ? 's' : ''} selected`
                                        : 'Select reps...'}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`} />
                            </button>

                            {showUserDropdown && (
                                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                                    {members.map(m => {
                                        const isSelected = selectedUsers.includes(m.user_id);
                                        return (
                                            <button
                                                key={m.user_id}
                                                onClick={() => toggleUser(m.user_id)}
                                                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors ${
                                                    isSelected ? 'bg-primary/5' : ''
                                                }`}
                                            >
                                                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                                                    isSelected ? 'border-primary bg-primary' : 'border-slate-300'
                                                }`}>
                                                    {isSelected && (
                                                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-slate-900 truncate">{m.full_name}</p>
                                                    <p className="text-[11px] text-slate-400 truncate">{m.email}</p>
                                                </div>
                                                <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-slate-400">{m.role}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {selectedUsers.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                                {selectedUsers.map(uid => {
                                    const m = members.find(x => x.user_id === uid);
                                    return (
                                        <span
                                            key={uid}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-lg text-xs font-semibold"
                                        >
                                            {m?.full_name || 'Unknown'}
                                            <button onClick={() => setSelectedUsers(prev => prev.filter(id => id !== uid))} className="hover:text-primary/70">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                        <button
                            onClick={handleCreate}
                            disabled={saving || !(newCampaign === '__custom__' ? customCampaign.trim() : newCampaign) || !selectedUsers.length}
                            className="px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-bold disabled:opacity-40 hover:bg-primary/90 transition-colors flex items-center gap-2"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Create Rule
                        </button>
                        <button
                            onClick={resetForm}
                            className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Existing Rules */}
            {rules.length === 0 && !showAddForm ? (
                <div className="text-center py-16 text-text-secondary">
                    <Shuffle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-semibold">No distribution rules yet</p>
                    <p className="text-sm mt-1">Create rules to auto-assign incoming campaign leads to reps</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {rules.map(rule => {
                        const activeMembers = (rule.members || []).filter(m => m.is_active !== false);
                        const totalAssigned = activeMembers.reduce((sum, m) => sum + (m.assigned_count || 0), 0);

                        return (
                            <div key={rule.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                                {/* Rule header */}
                                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                                            rule.mode === 'round_robin' ? 'bg-blue-50' : 'bg-purple-50'
                                        }`}>
                                            {rule.mode === 'round_robin'
                                                ? <Shuffle className="w-4.5 h-4.5 text-blue-600" />
                                                : <UserCheck className="w-4.5 h-4.5 text-purple-600" />}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-900">{rule.campaign}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className={`text-[10px] font-black uppercase tracking-wider ${
                                                    rule.mode === 'round_robin' ? 'text-blue-600' : 'text-purple-600'
                                                }`}>
                                                    {rule.mode === 'round_robin' ? 'Round Robin' : 'Exclusive'}
                                                </span>
                                                <span className="text-[10px] text-slate-400">·</span>
                                                <span className="text-[10px] text-slate-500 font-medium">
                                                    {totalAssigned} leads assigned
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(rule.id)}
                                        disabled={saving}
                                        className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4 text-red-400" />
                                    </button>
                                </div>

                                {/* Members */}
                                <div className="px-5 py-3">
                                    <div className="space-y-2">
                                        {activeMembers.map(m => {
                                            const pct = totalAssigned > 0 ? Math.round((m.assigned_count / totalAssigned) * 100) : 0;
                                            return (
                                                <div key={m.id} className="flex items-center gap-3">
                                                    <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                                        <Users className="w-3.5 h-3.5 text-slate-500" />
                                                    </div>
                                                    <span className="text-sm font-semibold text-slate-800 min-w-[140px]">
                                                        {m.user_info?.full_name || m.user_info?.email || 'Unknown'}
                                                    </span>
                                                    {rule.mode === 'round_robin' && (
                                                        <>
                                                            <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full bg-blue-500 transition-all"
                                                                    style={{ width: `${pct}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-xs font-bold text-slate-600 w-8 text-right">{m.assigned_count}</span>
                                                        </>
                                                    )}
                                                    {rule.mode === 'exclusive' && (
                                                        <span className="text-xs font-bold text-purple-600">{m.assigned_count} leads</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
