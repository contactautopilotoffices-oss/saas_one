'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, User, Mail, Phone, Lock, ArrowRight, CheckCircle2, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { createClient } from '@/frontend/utils/supabase/client';
import { useAuth } from '@/frontend/context/AuthContext';

function TenantOnboardContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const propertyId = searchParams.get('propertyId');
    const roleParam = searchParams.get('role') || 'tenant';

    const { user, isLoading: authLoading, refreshMembership } = useAuth();
    const supabase = createClient();

    const [propertyName, setPropertyName] = useState<string>('');
    const [orgId, setOrgId] = useState<string>('');
    const [isFetchingProp, setIsFetchingProp] = useState(true);

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [mobile, setMobile] = useState('');
    const [password, setPassword] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [isSuccess, setIsSuccess] = useState(false);
    const [copiedAppUrl, setCopiedAppUrl] = useState(false);

    // 1. Fetch Property Info & Smart Check if User is already Logged in
    useEffect(() => {
        if (!propertyId) {
            setIsFetchingProp(false);
            return;
        }

        const loadPropertyAndCheckSession = async () => {
            try {
                // Fetch property name
                const { data: prop } = await supabase
                    .from('properties')
                    .select('name, organization_id')
                    .eq('id', propertyId)
                    .maybeSingle();

                if (prop) {
                    setPropertyName(prop.name);
                    setOrgId(prop.organization_id);
                }

                // Smart Re-scan routing: If user is logged in, check approval and active membership
                if (user) {
                    const { data: userProfile } = await supabase
                        .from('users')
                        .select('is_approved, approval_status, is_master_admin')
                        .eq('id', user.id)
                        .maybeSingle();

                    const isUserApproved = userProfile?.is_master_admin || userProfile?.is_approved === true || userProfile?.approval_status === 'approved';

                    const { data: membership } = await supabase
                        .from('property_memberships')
                        .select('role, is_active')
                        .eq('user_id', user.id)
                        .eq('property_id', propertyId)
                        .maybeSingle();

                    if (membership && membership.is_active && isUserApproved) {
                        // User already onboarded and approved! Directly route to tenant dashboard
                        router.replace(`/property/${propertyId}/tenant`);
                        return;
                    } else if (membership && (!membership.is_active || !isUserApproved)) {
                        // User registered but awaiting approval
                        router.replace('/waiting-approval');
                        return;
                    } else if (prop) {
                        // User is logged in via OAuth but not yet a member: register pending approval
                        await supabase.from('users').upsert({
                            id: user.id,
                            email: user.email,
                            full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Client',
                            role: 'tenant',
                            onboarding_completed: true,
                            is_approved: false,
                            approval_status: 'pending',
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'id' });

                        await supabase.from('property_memberships').upsert({
                            user_id: user.id,
                            property_id: propertyId,
                            organization_id: prop.organization_id,
                            role: 'tenant',
                            is_active: false
                        }, { onConflict: 'user_id,property_id' });

                        // Notify admins
                        fetch('/api/users/notify-pending', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                userId: user.id,
                                propertyId,
                                organizationId: prop.organization_id,
                                requestedRole: 'tenant'
                            })
                        }).catch(() => {});

                        await refreshMembership();
                        router.replace('/waiting-approval');
                        return;
                    }
                }
            } catch (err) {
                console.error('[Onboard] Load error:', err);
            } finally {
                setIsFetchingProp(false);
            }
        };

        if (!authLoading) {
            loadPropertyAndCheckSession();
        }
    }, [propertyId, user, authLoading, supabase, router, refreshMembership]);

    const handleGoogleSignIn = async () => {
        try {
            setErrorMsg('');
            const callbackUrl = new URL(`${window.location.origin}/api/auth/callback`);
            callbackUrl.searchParams.set('redirect', `/onboard?propertyId=${propertyId}&role=tenant`);

            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: callbackUrl.toString()
                }
            });

            if (error) throw error;
        } catch (err: any) {
            console.error('[Onboard] Google sign in error:', err);
            setErrorMsg(err.message || 'Google sign in failed.');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg('');

        if (!name.trim() || !email.trim() || !password) {
            setErrorMsg('Please fill in all required fields.');
            return;
        }

        if (password.length < 6) {
            setErrorMsg('Password must be at least 6 characters long.');
            return;
        }

        setIsSubmitting(true);

        try {
            // 1. Call Tenant Auto-Provisioning API
            const response = await fetch('/api/auth/tenant-signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    email: email.trim(),
                    mobile: mobile.trim(),
                    password,
                    propertyId,
                    role: roleParam
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to complete registration.');
            }

            // 2. Sign in user to establish browser session
            const { error: signInErr } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password
            });

            if (signInErr) {
                console.warn('[Onboard] Automatic sign-in error:', signInErr);
            }

            setIsSuccess(true);
            await refreshMembership();

            setTimeout(() => {
                router.replace(result.redirectUrl || `/property/${propertyId}/tenant`);
            }, 1200);

        } catch (err: any) {
            console.error('[Onboard] Submit error:', err);
            setErrorMsg(err.message || 'Registration failed. Please try again.');
            setIsSubmitting(false);
        }
    };

    if (isFetchingProp) {
        return (
            <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-slate-900">
                <Loader2 className="w-9 h-9 text-slate-900 animate-spin mb-4" />
                <p className="text-slate-500 text-sm font-semibold">Loading property workspace...</p>
            </div>
        );
    }

    if (!propertyId) {
        return (
            <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-slate-900 text-center">
                <div className="w-16 h-16 bg-rose-50 border border-rose-100 rounded-3xl flex items-center justify-center text-rose-600 mb-4 shadow-sm">
                    <Building2 className="w-8 h-8" />
                </div>
                <h1 className="text-2xl font-black mb-2 text-slate-900">Invalid QR Code</h1>
                <p className="text-slate-500 text-sm max-w-md font-medium">Missing property identification in QR code link. Please request a valid onboarding QR from your property administrator.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center items-center p-0 sm:p-6 font-sans">
            <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md bg-white sm:rounded-3xl sm:border border-slate-200/80 shadow-2xl overflow-hidden relative z-10 min-h-screen sm:min-h-0 flex flex-col justify-between"
            >
                <div>
                    {/* Autopilot Brand Header */}
                    <div className="pt-8 pb-4 px-6 flex flex-col items-center bg-white border-b border-slate-100">
                        <img
                            src="/autopilot-logo-new.png"
                            alt="Autopilot"
                            className="h-9 w-auto object-contain mb-1"
                        />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            Facility Management Systems
                        </p>
                    </div>

                    {/* Property Workspace Banner */}
                    <div className="bg-slate-900 text-white p-6 sm:p-7 text-center relative overflow-hidden">
                        <div className="relative z-10">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/10 rounded-full text-slate-200 text-[11px] font-bold tracking-wider uppercase mb-2.5">
                                <Sparkles className="w-3.5 h-3.5 text-teal-400" /> Client Onboarding
                            </div>
                            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-tight mb-1">
                                {propertyName || 'Property Workspace'}
                            </h1>
                            <p className="text-slate-400 text-xs font-medium max-w-xs mx-auto">
                                Set up your account to raise requests and track property services.
                            </p>
                        </div>
                    </div>

                    {/* Content Body */}
                    <div className="p-6 sm:p-8 bg-white">
                        {isSuccess ? (
                            <div className="py-10 text-center space-y-4">
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm"
                                >
                                    <CheckCircle2 className="w-10 h-10" />
                                </motion.div>
                                <h2 className="text-xl font-bold text-slate-900">Registration Complete!</h2>
                                <p className="text-slate-500 text-xs font-medium">Entering your tenant dashboard...</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Google Sign In Option */}
                                <button
                                    type="button"
                                    onClick={handleGoogleSignIn}
                                    disabled={isSubmitting}
                                    className="w-full py-3.5 bg-white hover:bg-slate-50 text-slate-800 font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-3 border border-slate-300 shadow-sm active:scale-[0.99] disabled:opacity-50"
                                >
                                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                                    </svg>
                                    Continue with Google
                                </button>

                                <div className="relative flex items-center justify-center my-4">
                                    <div className="border-t border-slate-200 w-full" />
                                    <span className="bg-white px-3 text-[10px] font-black text-slate-400 uppercase tracking-widest relative z-10">
                                        or enter details manually
                                    </span>
                                </div>

                                <form onSubmit={handleSubmit} className="space-y-4">
                                    {errorMsg && (
                                        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-semibold text-center">
                                            {errorMsg}
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                            Full Name *
                                        </label>
                                        <div className="relative">
                                            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                type="text"
                                                required
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                placeholder="e.g. Rahul Sharma"
                                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-slate-800 focus:ring-2 focus:ring-slate-900/10 outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                            Work Email *
                                        </label>
                                        <div className="relative">
                                            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                type="email"
                                                required
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                placeholder="name@company.com"
                                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-slate-800 focus:ring-2 focus:ring-slate-900/10 outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                            Mobile Number
                                        </label>
                                        <div className="relative">
                                            <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                type="tel"
                                                value={mobile}
                                                onChange={(e) => setMobile(e.target.value)}
                                                placeholder="+91 98765 43210"
                                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-slate-800 focus:ring-2 focus:ring-slate-900/10 outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                                            Create Password *
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                type="password"
                                                required
                                                minLength={6}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="At least 6 characters"
                                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-slate-800 focus:ring-2 focus:ring-slate-900/10 outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full mt-2 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 active:scale-[0.99] disabled:opacity-50"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Setting up your account...
                                            </>
                                        ) : (
                                            <>
                                                Complete Setup & Enter App <ArrowRight className="w-4 h-4" />
                                            </>
                                        )}
                                    </button>
                                </form>

                                {/* Direct Web App Link section */}
                                <div className="mt-6 pt-4 border-t border-slate-100 text-center">
                                    <p className="text-[11px] font-semibold text-slate-500 mb-2">
                                        Need to save or share the Web App link?
                                    </p>
                                    <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                                        <input
                                            type="text"
                                            readOnly
                                            value={typeof window !== 'undefined' ? window.location.href : ''}
                                            className="flex-1 px-2 text-xs font-mono text-slate-600 bg-transparent outline-none truncate"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (navigator.clipboard) {
                                                    navigator.clipboard.writeText(window.location.href);
                                                    setCopiedAppUrl(true);
                                                    setTimeout(() => setCopiedAppUrl(false), 2000);
                                                }
                                            }}
                                            className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1"
                                        >
                                            {copiedAppUrl ? 'Copied!' : 'Copy Link'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Security Badge */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-center gap-2 text-slate-400 text-xs font-semibold">
                    <ShieldCheck className="w-4 h-4 text-teal-600" /> Powered by Autopilot Workspace Access
                </div>
            </motion.div>
        </div>
    );
}

export default function TenantOnboardPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-slate-900">
                <Loader2 className="w-9 h-9 text-slate-900 animate-spin mb-4" />
                <p className="text-slate-500 text-sm font-semibold">Loading onboarding workspace...</p>
            </div>
        }>
            <TenantOnboardContent />
        </Suspense>
    );
}
