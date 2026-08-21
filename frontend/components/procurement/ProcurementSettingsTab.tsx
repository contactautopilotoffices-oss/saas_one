'use client';

import React, { useState, useEffect } from 'react';
import { 
    User, Phone, Mail, Shield, Key, Save, CheckCircle2, 
    AlertCircle, Loader2, MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/frontend/utils/supabase/client';

interface ProcurementSettingsTabProps {
    user: any;
    onUserUpdated?: (updatedUser: any) => void;
}

export function ProcurementSettingsTab({ user, onUserUpdated }: ProcurementSettingsTabProps) {
    const supabase = createClient();

    // Form state
    const [fullName, setFullName] = useState<string>('');
    const [phone, setPhone] = useState<string>('');
    const [email, setEmail] = useState<string>('');
    const [role, setRole] = useState<string>('Procurement User');
    
    // Password state
    const [newPassword, setNewPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [isUpdatingPassword, setIsUpdatingPassword] = useState<boolean>(false);
    const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // UI Feedback state
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Load user data from /api/users/profile
    useEffect(() => {
        const loadUserProfile = async () => {
            if (!user?.id) return;
            setIsLoading(true);
            try {
                const res = await fetch('/api/users/profile');
                if (res.ok) {
                    const data = await res.json();
                    setFullName(data.full_name || user?.user_metadata?.full_name || '');
                    setPhone(data.phone || user?.user_metadata?.phone || '');
                    setEmail(data.email || user?.email || '');
                    setRole(data.role || user?.user_metadata?.role || 'procurement_user');
                } else {
                    setFullName(user?.user_metadata?.full_name || '');
                    setPhone(user?.user_metadata?.phone || '');
                    setEmail(user?.email || '');
                    setRole(user?.user_metadata?.role || 'procurement_user');
                }
            } catch (err) {
                console.error('Failed to load user profile:', err);
                setFullName(user?.user_metadata?.full_name || '');
                setPhone(user?.user_metadata?.phone || '');
                setEmail(user?.email || '');
                setRole(user?.user_metadata?.role || 'procurement_user');
            } finally {
                setIsLoading(false);
            }
        };

        loadUserProfile();
    }, [user]);

    const showToast = (text: string, type: 'success' | 'error' = 'success') => {
        setToast({ text, type });
        setTimeout(() => setToast(null), 4000);
    };

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?.id) return;

        setIsSaving(true);
        try {
            const cleanName = fullName.trim();
            const cleanPhone = phone.trim().replace(/\s+/g, '');

            const res = await fetch('/api/users/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    full_name: cleanName,
                    phone: cleanPhone
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to update profile in database');
            }

            showToast('Profile & WhatsApp phone number saved to database successfully!');

            if (onUserUpdated) {
                onUserUpdated({
                    ...user,
                    phone: cleanPhone,
                    full_name: cleanName,
                    user_metadata: {
                        ...user.user_metadata,
                        full_name: cleanName,
                        phone: cleanPhone
                    }
                });
            }
        } catch (err: any) {
            console.error('Failed to update profile:', err);
            showToast(err.message || 'Failed to save changes', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordMessage(null);

        if (!newPassword || newPassword.length < 6) {
            setPasswordMessage({ type: 'error', text: 'Password must be at least 6 characters long.' });
            return;
        }

        if (newPassword !== confirmPassword) {
            setPasswordMessage({ type: 'error', text: 'New passwords do not match.' });
            return;
        }

        setIsUpdatingPassword(true);
        try {
            const { error } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (error) throw error;

            setPasswordMessage({ type: 'success', text: 'Password changed successfully!' });
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            setPasswordMessage({ type: 'error', text: err.message || 'Failed to update password' });
        } finally {
            setIsUpdatingPassword(false);
        }
    };

    const formatRoleDisplay = (r: string) => {
        return r
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    };

    if (isLoading) {
        return (
            <div className="py-24 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-3" />
                <p className="text-sm font-semibold">Loading account settings...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto py-6 space-y-8">
            {/* Toast Notification */}
            <AnimatePresence>
                {toast && (
                    <motion.div 
                        initial={{ opacity: 0, y: -20 }} 
                        animate={{ opacity: 1, y: 0 }} 
                        exit={{ opacity: 0, y: -20 }} 
                        className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3 border text-sm font-bold text-white ${
                            toast.type === 'success' ? 'bg-emerald-600 border-emerald-500 shadow-emerald-600/20' : 'bg-rose-600 border-rose-500 shadow-rose-600/20'
                        }`}
                    >
                        {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                        <span>{toast.text}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* 1. Header Profile Banner */}
            <div className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="flex items-center gap-5">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-emerald-600/20">
                        {fullName ? fullName.charAt(0).toUpperCase() : email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl md:text-2xl font-black text-slate-900">{fullName || 'Procurement Account'}</h1>
                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-black uppercase tracking-wider">
                                Active
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5 flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                            {email}
                        </p>
                    </div>
                </div>

                <div className="px-4 py-2 bg-slate-50 rounded-2xl border border-slate-200 text-right">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Access Level</span>
                    <span className="text-xs font-black text-slate-800 flex items-center gap-1.5 justify-end">
                        <Shield className="w-3.5 h-3.5 text-emerald-600" />
                        {formatRoleDisplay(role)}
                    </span>
                </div>
            </div>

            {/* 2. Personal Information & WhatsApp Settings */}
            <div className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8 shadow-xs space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                        <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                            <User className="w-4 h-4 text-emerald-600" />
                            Personal & Contact Details
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">Update your display name and WhatsApp notification number.</p>
                    </div>
                </div>

                <form onSubmit={handleSaveProfile} className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* Name Input */}
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                Full Name / Username <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    required
                                    value={fullName}
                                    onChange={e => setFullName(e.target.value)}
                                    placeholder="e.g. Alok Sharma"
                                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                                />
                            </div>
                        </div>

                        {/* Phone Number Input */}
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                Phone Number (WhatsApp) <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                                <Phone className="w-4 h-4 text-emerald-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="tel"
                                    required
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                    placeholder="e.g. 9820645092 or +919820645092"
                                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                                />
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5 font-medium">
                                <MessageSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>Used by <strong>AiSensy WhatsApp</strong> for instant Requisition & Approval alerts.</span>
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
                        {/* Email (Read Only) */}
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                Official Login Email
                            </label>
                            <div className="relative">
                                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="email"
                                    disabled
                                    value={email}
                                    className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-semibold text-slate-500 cursor-not-allowed"
                                />
                            </div>
                        </div>

                        {/* Role (Read Only) */}
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                Assigned System Role
                            </label>
                            <div className="relative">
                                <Shield className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    disabled
                                    value={formatRoleDisplay(role)}
                                    className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-semibold text-slate-500 cursor-not-allowed"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end pt-4">
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer"
                        >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>

            {/* 3. Security & Password Update Card */}
            <div className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8 shadow-xs space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                        <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                            <Key className="w-4 h-4 text-slate-700" />
                            Security & Password
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">Change your account login password.</p>
                    </div>
                </div>

                <form onSubmit={handleChangePassword} className="space-y-4">
                    {passwordMessage && (
                        <div className={`p-3.5 rounded-xl text-xs font-bold flex items-center gap-2 ${
                            passwordMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
                        }`}>
                            {passwordMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                            <span>{passwordMessage.text}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                New Password
                            </label>
                            <input
                                type="password"
                                required
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-slate-800 focus:bg-white transition-all"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                Confirm New Password
                            </label>
                            <input
                                type="password"
                                required
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-slate-800 focus:bg-white transition-all"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            type="submit"
                            disabled={isUpdatingPassword}
                            className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                        >
                            {isUpdatingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                            Update Password
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
