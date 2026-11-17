'use client';

import React, { useState, useEffect } from 'react';
import { X, Settings2, Users, Bell, ShieldCheck, Check, Loader2, Info } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    orgId?: string;
}

interface UserOption {
    id: string;
    full_name: string;
    email: string;
    phone: string;
    role: string;
}

export default function PaymentTrackerSettingsModal({ isOpen, onClose, orgId }: Props) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [eligibleUsers, setEligibleUsers] = useState<UserOption[]>([]);
    const [selectedApproverIds, setSelectedApproverIds] = useState<string[]>([]);
    const [autoPreAlign, setAutoPreAlign] = useState(true);
    const [notifyWhatsapp, setNotifyWhatsapp] = useState(true);
    const [notifyEmail, setNotifyEmail] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

    useEffect(() => {
        if (!isOpen || !orgId) return;
        setLoading(true);
        setMsg(null);

        fetch(`/api/accounts/settings?org_id=${orgId}`)
            .then(res => res.json())
            .then(data => {
                if (data.eligible_approvers) {
                    setEligibleUsers(data.eligible_approvers);
                }
                if (data.settings) {
                    setSelectedApproverIds(data.settings.approver_user_ids || []);
                    setAutoPreAlign(data.settings.auto_pre_align !== false);
                    setNotifyWhatsapp(data.settings.notify_via_whatsapp !== false);
                    setNotifyEmail(data.settings.notify_via_email !== false);
                }
            })
            .catch(err => {
                setMsg({ text: 'Failed to load settings', error: true });
            })
            .finally(() => setLoading(false));
    }, [isOpen, orgId]);

    const handleToggleApprover = (userId: string) => {
        setSelectedApproverIds(prev =>
            prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
        );
    };

    const handleSave = async () => {
        if (!orgId) return;
        setSaving(true);
        setMsg(null);

        try {
            const res = await fetch('/api/accounts/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    org_id: orgId,
                    approver_user_ids: selectedApproverIds,
                    auto_pre_align: autoPreAlign,
                    notify_via_whatsapp: notifyWhatsapp,
                    notify_via_email: notifyEmail,
                }),
            });

            const data = await res.json();
            if (res.ok) {
                setMsg({ text: 'Payment tracker settings saved successfully!' });
                setTimeout(() => {
                    onClose();
                }, 1200);
            } else {
                setMsg({ text: data.error || 'Failed to save settings', error: true });
            }
        } catch {
            setMsg({ text: 'Error saving settings', error: true });
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const filteredUsers = eligibleUsers.filter(u =>
        u.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.role.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#587e85]/10 text-[#587e85] rounded-xl">
                            <Settings2 className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">Payment Tracker Configuration</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Configure approvers and parallel alignment preferences</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                    {loading ? (
                        <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-400">
                            <Loader2 className="w-7 h-7 animate-spin text-[#587e85]" />
                            <p className="text-sm">Loading organization settings...</p>
                        </div>
                    ) : (
                        <>
                            {/* Section 1: Designated Approver Selection */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                            <Users className="w-4 h-4 text-[#587e85]" />
                                            Designated Payment Approvers
                                        </label>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Select who receives payment sheets for approval (Director, Finance Head, etc.)
                                        </p>
                                    </div>
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#587e85]/10 text-[#587e85]">
                                        {selectedApproverIds.length} Selected
                                    </span>
                                </div>

                                <input
                                    type="text"
                                    placeholder="Search users by name, email or role..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#587e85]/30 focus:border-[#587e85]"
                                />

                                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {filteredUsers.length === 0 ? (
                                        <p className="p-4 text-xs text-center text-slate-400">No users found</p>
                                    ) : (
                                        filteredUsers.map((user) => {
                                            const isSelected = selectedApproverIds.includes(user.id);
                                            return (
                                                <div
                                                    key={user.id}
                                                    onClick={() => handleToggleApprover(user.id)}
                                                    className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer transition ${
                                                        isSelected
                                                            ? 'bg-[#587e85]/5 dark:bg-[#587e85]/10'
                                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className={`w-4 h-4 rounded-md border flex items-center justify-center transition ${
                                                                isSelected
                                                                    ? 'bg-[#587e85] border-[#587e85] text-white'
                                                                    : 'border-slate-300 dark:border-slate-700'
                                                            }`}
                                                        >
                                                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                                                {user.full_name}
                                                            </p>
                                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                                {user.email || 'No email'} · <span className="capitalize">{user.role?.replace(/_/g, ' ')}</span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Section 2: Parallel Pre-Alignment Toggle */}
                            <div className="p-4 rounded-xl border border-emerald-100 dark:border-emerald-950/40 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                                            Parallel Pre-Alignment to Accounts
                                        </span>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={autoPreAlign}
                                            onChange={(e) => setAutoPreAlign(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                                    </label>
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                                    When enabled, submitted payment sheets immediately appear in the Accounts queue as <strong>Pre-Aligned</strong>. Accounts can prepare bank batches in parallel. If an approver rejects a line item, it is auto-cancelled in the Accounts queue.
                                </p>
                            </div>

                            {/* Section 3: Notification Channels */}
                            <div className="space-y-3 pt-1">
                                <label className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                    <Bell className="w-4 h-4 text-[#587e85]" />
                                    Approver Notification Channels
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={notifyWhatsapp}
                                            onChange={(e) => setNotifyWhatsapp(e.target.checked)}
                                            className="w-4 h-4 text-[#587e85] rounded focus:ring-[#587e85]"
                                        />
                                        <div className="text-xs">
                                            <span className="font-semibold text-slate-900 dark:text-white block">WhatsApp Alerts</span>
                                            <span className="text-slate-500 text-[11px]">Direct link to approval workspace</span>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={notifyEmail}
                                            onChange={(e) => setNotifyEmail(e.target.checked)}
                                            className="w-4 h-4 text-[#587e85] rounded focus:ring-[#587e85]"
                                        />
                                        <div className="text-xs">
                                            <span className="font-semibold text-slate-900 dark:text-white block">Email Summary</span>
                                            <span className="text-slate-500 text-[11px]">Detailed batch breakdown email</span>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </>
                    )}

                    {msg && (
                        <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                            msg.error ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                            <Info className="w-4 h-4 shrink-0" />
                            <span>{msg.text}</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-[#587e85] hover:bg-[#48686e] rounded-xl shadow-xs transition active:scale-95 disabled:opacity-50"
                    >
                        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>Save Preferences</span>
                    </button>
                </div>

            </div>
        </div>
    );
}
