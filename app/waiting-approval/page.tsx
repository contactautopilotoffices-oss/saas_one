'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Clock, ShieldCheck, CheckCircle2, RefreshCw,
    LogOut, Building2, User, Mail, Phone,
    Sparkles, ArrowRight, ShieldAlert, PartyPopper, Loader2
} from 'lucide-react';
import { useAuth } from '@/frontend/context/AuthContext';
import { useRouter } from 'next/navigation';
import { createClient } from '@/frontend/utils/supabase/client';
import Loader from '@/frontend/components/ui/Loader';

export default function WaitingApprovalPage() {
    const { user, isLoading: authLoading, signOut, refreshMembership } = useAuth();
    const router = useRouter();
    const supabase = React.useMemo(() => createClient(), []);

    const [isApproved, setIsApproved] = useState<boolean | null>(null);
    const [approvalStatus, setApprovalStatus] = useState<string>('pending');
    const [propertyName, setPropertyName] = useState<string>('');
    const [userRole, setUserRole] = useState<string>('');
    const [registeredAt, setRegisteredAt] = useState<string>('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isCelebrating, setIsCelebrating] = useState(false);

    const checkApprovalStatus = useCallback(async (isManual = false) => {
        if (!user?.id) return;
        if (isManual) setIsRefreshing(true);

        try {
            // 1. Fetch user approval status from users table
            const { data: userProfile, error: userError } = await supabase
                .from('users')
                .select('is_approved, approval_status, created_at, is_master_admin')
                .eq('id', user.id)
                .single();

            if (userError) {
                console.error('[Waiting Approval] Error fetching user profile:', userError);
                return;
            }

            // Master admin bypass
            if (userProfile?.is_master_admin) {
                router.replace('/master');
                return;
            }

            // 2. Fetch user's assigned property / membership
            const { data: propMemb } = await supabase
                .from('property_memberships')
                .select('role, properties(name)')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (propMemb) {
                setUserRole(propMemb.role || '');
                setPropertyName((propMemb.properties as any)?.name || '');
            } else {
                const { data: orgMemb } = await supabase
                    .from('organization_memberships')
                    .select('role, organizations(name)')
                    .eq('user_id', user.id)
                    .maybeSingle();
                if (orgMemb) {
                    setUserRole(orgMemb.role || '');
                    setPropertyName((orgMemb.organizations as any)?.name || '');
                }
            }

            setRegisteredAt(userProfile?.created_at || '');
            const approved = userProfile?.is_approved === true || userProfile?.approval_status === 'approved';
            setIsApproved(approved);
            setApprovalStatus(userProfile?.approval_status || (approved ? 'approved' : 'pending'));

            // If approved, trigger celebration and redirect!
            if (approved) {
                setIsCelebrating(true);
                await refreshMembership();
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            }

        } catch (err) {
            console.error('[Waiting Approval] Status check error:', err);
        } finally {
            if (isManual) {
                setTimeout(() => setIsRefreshing(false), 500);
            }
        }
    }, [user?.id, router, supabase, refreshMembership]);

    // Initial check on mount
    useEffect(() => {
        if (!authLoading && !user) {
            router.replace('/login');
            return;
        }

        if (user?.id) {
            checkApprovalStatus();
        }
    }, [authLoading, user, checkApprovalStatus, router]);

    // Realtime listener on public.users table for this user
    useEffect(() => {
        if (!user?.id) return;

        const channel = supabase
            .channel(`user-approval-${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'users',
                    filter: `id=eq.${user.id}`
                },
                (payload: any) => {
                    const newRow = payload.new;
                    if (newRow && (newRow.is_approved === true || newRow.approval_status === 'approved')) {
                        setIsApproved(true);
                        setApprovalStatus('approved');
                        setIsCelebrating(true);
                        refreshMembership().catch(() => {});
                        setTimeout(() => {
                            window.location.href = '/';
                        }, 2200);
                    } else if (newRow && newRow.approval_status === 'rejected') {
                        setIsApproved(false);
                        setApprovalStatus('rejected');
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.id, supabase, refreshMembership]);

    const formatRoleLabel = (role: string) => {
        if (!role) return 'Team Member';
        if (role === 'property_admin') return 'Property Admin';
        if (role === 'tenant') return 'Client / Tenant';
        if (role === 'staff') return 'Soft Services Staff';
        if (role === 'mst') return 'Maintenance Staff (MST)';
        if (role === 'procurement') return 'Procurement Specialist';
        if (role === 'vendor') return 'Vendor / Contractor';
        return role.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950">
                <Loader size="lg" text="Verifying credentials..." />
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 p-4 font-sans relative overflow-hidden">
            {/* Ambient Background Glow Orbs */}
            <div className="absolute -top-40 -left-40 w-96 h-96 bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

            {/* Approved Celebration Overlay */}
            <AnimatePresence>
                {isCelebrating && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md"
                    >
                        <div className="text-center max-w-md p-8 bg-slate-900 border border-emerald-500/30 rounded-3xl shadow-2xl shadow-emerald-500/20">
                            <motion.div
                                animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                                className="w-20 h-20 mx-auto mb-6 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center border border-emerald-500/30"
                            >
                                <PartyPopper className="w-10 h-10" />
                            </motion.div>
                            <h2 className="text-3xl font-black text-white mb-2">Access Approved! 🎉</h2>
                            <p className="text-slate-400 text-sm font-medium mb-6">
                                Your account has been verified by your administrator. Redirecting you to your dashboard...
                            </p>
                            <div className="flex items-center justify-center gap-2 text-emerald-400 font-bold text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Launching workspace...</span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Content Card */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="w-full max-w-lg bg-slate-900/80 border border-white/10 backdrop-blur-2xl rounded-[32px] p-8 md:p-10 shadow-2xl relative z-10"
            >
                {/* Header Badge & Icon */}
                <div className="flex flex-col items-center text-center mb-8">
                    <div className="relative mb-6">
                        <div className="w-20 h-20 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-lg shadow-amber-500/5">
                            {approvalStatus === 'rejected' ? (
                                <ShieldAlert className="w-10 h-10 text-rose-400 animate-bounce" />
                            ) : (
                                <Clock className="w-10 h-10 animate-pulse" />
                            )}
                        </div>
                        <span className="absolute -top-1 -right-1 flex h-4 w-4">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500"></span>
                        </span>
                    </div>

                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-black uppercase tracking-widest mb-3">
                        {approvalStatus === 'rejected' ? 'Application Rejected' : 'Waiting for Approval'}
                    </div>

                    <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight mb-2">
                        {approvalStatus === 'rejected' ? 'Registration Not Approved' : 'Account Under Review'}
                    </h1>
                    <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-sm">
                        {approvalStatus === 'rejected'
                            ? 'Your account request could not be approved at this time. Please contact your administrator.'
                            : 'Thank you for completing your registration! An administrator must verify and approve your account before you can access the dashboard.'}
                    </p>
                </div>

                {/* Progress Stepper */}
                {approvalStatus !== 'rejected' && (
                    <div className="mb-8 p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
                                <CheckCircle2 className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-white">Registration Completed</p>
                                <p className="text-[11px] text-slate-400">Profile details and property selection submitted</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0">
                                <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-amber-400">Administrator Review</p>
                                <p className="text-[11px] text-slate-400">Property and Org Super Admins have been notified</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 opacity-40">
                            <div className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center flex-shrink-0">
                                <ShieldCheck className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-slate-400">Dashboard Access</p>
                                <p className="text-[11px] text-slate-500">Unlocks automatically once approved</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Applicant Info Box */}
                <div className="p-5 rounded-2xl bg-white/[0.04] border border-white/10 mb-8 space-y-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Application Details</h3>
                    
                    <div className="flex items-center justify-between text-sm py-1 border-b border-white/5">
                        <span className="text-slate-400 flex items-center gap-2">
                            <User className="w-4 h-4 text-slate-500" />
                            Applicant Name
                        </span>
                        <span className="font-semibold text-white truncate max-w-[200px]">{user?.user_metadata?.full_name || user?.email?.split('@')[0]}</span>
                    </div>

                    <div className="flex items-center justify-between text-sm py-1 border-b border-white/5">
                        <span className="text-slate-400 flex items-center gap-2">
                            <Mail className="w-4 h-4 text-slate-500" />
                            Email
                        </span>
                        <span className="font-semibold text-white truncate max-w-[200px]">{user?.email}</span>
                    </div>

                    {propertyName && (
                        <div className="flex items-center justify-between text-sm py-1 border-b border-white/5">
                            <span className="text-slate-400 flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-slate-500" />
                                Workspace / Property
                            </span>
                            <span className="font-semibold text-amber-300 truncate max-w-[200px]">{propertyName}</span>
                        </div>
                    )}

                    {userRole && (
                        <div className="flex items-center justify-between text-sm py-1">
                            <span className="text-slate-400 flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-slate-500" />
                                Requested Role
                            </span>
                            <span className="font-bold text-white bg-white/10 px-2.5 py-0.5 rounded-lg text-xs">
                                {formatRoleLabel(userRole)}
                            </span>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-3">
                    <button
                        onClick={() => checkApprovalStatus(true)}
                        disabled={isRefreshing}
                        className="w-full py-4 px-6 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold rounded-2xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2.5 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        <span>{isRefreshing ? 'Checking approval...' : 'Check Status Now'}</span>
                    </button>

                    <button
                        onClick={async () => {
                            await signOut();
                            window.location.href = '/login';
                        }}
                        className="w-full py-3.5 px-4 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white font-semibold rounded-2xl border border-white/5 transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
                    >
                        <LogOut className="w-4 h-4 text-slate-400" />
                        <span>Sign Out / Switch Account</span>
                    </button>
                </div>

                {/* Footer Note */}
                <p className="text-center text-xs text-slate-500 mt-6 font-medium">
                    This page automatically unlocks once an administrator approves your request.
                </p>
            </motion.div>
        </div>
    );
}
