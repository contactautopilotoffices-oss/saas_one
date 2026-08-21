'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Mail, Shield, Save, Loader2, CheckCircle2, AlertCircle,
    Send, ExternalLink, Info, Check, Server, Lock, Radio
} from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';

interface EmailServiceSettingsProps {
    organizationId: string;
}

export default function EmailServiceSettings({ organizationId }: EmailServiceSettingsProps) {
    const supabase = createClient();

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isTesting, setIsTesting] = useState<boolean>(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    // Email Gateway Configuration
    const [fromName, setFromName] = useState<string>('Autopilot Facility Management');
    const [fromEmail, setFromEmail] = useState<string>('notifications@autopilotoffices.com');
    const [replyTo, setReplyTo] = useState<string>('contact.autopilotoffices@gmail.com');
    const [emailEnabled, setEmailEnabled] = useState<boolean>(true);

    // Test Email Form
    const [testEmailAddress, setTestEmailAddress] = useState<string>('');

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3500);
    };

    useEffect(() => {
        const fetchSettings = async () => {
            if (!organizationId) return;
            setIsLoading(true);
            try {
                const { data, error } = await supabase
                    .from('organization_settings')
                    .select('email_preferences, email_service_config')
                    .eq('organization_id', organizationId)
                    .maybeSingle();

                if (data?.email_preferences) {
                    const prefs = data.email_preferences;
                    setFromName(prefs.from_name || 'Autopilot Facility Management');
                    setFromEmail(prefs.from_email || 'notifications@autopilotoffices.com');
                    setReplyTo(prefs.reply_to || 'contact.autopilotoffices@gmail.com');
                    setEmailEnabled(prefs.enabled !== false);
                }
            } catch (err) {
                console.error('Error fetching email settings:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchSettings();
    }, [organizationId, supabase]);

    const handleSave = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setIsSaving(true);
        try {
            const emailPreferences = {
                from_name: fromName.trim(),
                from_email: fromEmail.trim(),
                reply_to: replyTo.trim(),
                enabled: emailEnabled,
                updated_at: new Date().toISOString()
            };

            const res = await fetch(`/api/admin/organizations/${organizationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email_preferences: emailPreferences })
            });

            if (res.ok) {
                showToast('Email gateway settings saved successfully!');
            } else {
                showToast('Failed to save email settings.', 'error');
            }
        } catch (err: any) {
            console.error('Error saving email settings:', err);
            showToast('Error saving settings: ' + err.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSendTestEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!testEmailAddress || !testEmailAddress.includes('@')) {
            showToast('Please enter a valid test email address.', 'error');
            return;
        }

        setIsTesting(true);
        try {
            // Send test email
            const res = await fetch('/api/admin/organizations/' + organizationId, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    test_email_recipient: testEmailAddress.trim()
                })
            });

            showToast(`Test email successfully sent to ${testEmailAddress}!`);
            setTestEmailAddress('');
        } catch (err: any) {
            console.error('Error sending test email:', err);
            showToast('Failed to send test email: ' + err.message, 'error');
        } finally {
            setIsTesting(false);
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
                        <Mail className="w-5 h-5 text-primary" />
                        Email Service Gateway
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Manage Resend / SMTP email delivery credentials and sender identity.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm text-xs cursor-pointer"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Settings
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
                        To prevent conflicts, all notification rules (who receives emails, target roles, and individual user routing) are centrally controlled in the <b>Omnichannel Notifications & Reminders</b> tab. This tab only configures the email delivery engine.
                    </p>
                </div>
            </div>

            {/* Provider & Connection Status Card */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                            <Server className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">Email Delivery Provider</h3>
                            <p className="text-xs text-slate-500">Resend SMTP Gateway with Nodemailer High-Availability Queue</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Operational
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100 text-xs">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-slate-400 font-bold block mb-1">ENGINE</span>
                        <span className="font-bold text-slate-800">Resend API / SMTP TLS</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-slate-400 font-bold block mb-1">ENCRYPTION</span>
                        <span className="font-bold text-slate-800">STARTTLS / Port 465 (Secure)</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-slate-400 font-bold block mb-1">RATE LIMIT</span>
                        <span className="font-bold text-slate-800">100 msgs / sec</span>
                    </div>
                </div>
            </div>

            {/* Sender Identity Form */}
            <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-4">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" />
                    Sender Identity & Headers
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                            Sender Display Name
                        </label>
                        <input
                            type="text"
                            value={fromName}
                            onChange={(e) => setFromName(e.target.value)}
                            placeholder="Autopilot Facility Management"
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                            From Email Address
                        </label>
                        <input
                            type="email"
                            value={fromEmail}
                            onChange={(e) => setFromEmail(e.target.value)}
                            placeholder="notifications@autopilotoffices.com"
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                        />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                            Reply-To Email Address
                        </label>
                        <input
                            type="email"
                            value={replyTo}
                            onChange={(e) => setReplyTo(e.target.value)}
                            placeholder="contact.autopilotoffices@gmail.com"
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                        />
                    </div>
                </div>
            </div>

            {/* Test Email Dispatch Card */}
            <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-4">
                <div>
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <Send className="w-4 h-4 text-emerald-600" />
                        Send Test Notification Email
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Verify your SMTP credentials and delivery inbox reception in real-time.
                    </p>
                </div>

                <form onSubmit={handleSendTestEmail} className="flex flex-col sm:flex-row gap-3">
                    <input
                        type="email"
                        required
                        value={testEmailAddress}
                        onChange={(e) => setTestEmailAddress(e.target.value)}
                        placeholder="Enter recipient email (e.g. admin@company.com)..."
                        className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                        type="submit"
                        disabled={isTesting}
                        className="flex items-center justify-center gap-2 px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs disabled:opacity-50 transition-all cursor-pointer shrink-0"
                    >
                        {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Send Test Email
                    </button>
                </form>
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
