'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@/frontend/utils/supabase/client';
import { User, Session } from '@supabase/supabase-js';

// Cached membership data structure
interface UserMembership {
    org_id: string | null;
    org_name: string | null;
    org_role: string | null;
    is_master_admin: boolean;
    onboarding_completed: boolean;
    error?: boolean;
    all_org_memberships: {
        org_id: string;
        role: string;
    }[];
    properties: {
        id: string;
        name: string;
        code: string;
        role: string;
        organization_id: string | null;
    }[];
}

interface AuthContextType {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
    membership: UserMembership | null;
    isMembershipLoading: boolean;
    // Auth actions
    signIn: (email: string, password: string) => Promise<any>;
    signUp: (email: string, password: string, fullName: string) => Promise<any>;
    signInWithGoogle: (propertyCode?: string, redirectPath?: string) => Promise<void>;
    signInWithApple: (propertyCode?: string, redirectPath?: string) => Promise<void>;
    signInWithZoho: (propertyCode?: string, redirectPath?: string) => void;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
    // Cache helpers
    refreshMembership: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// In-memory cache to prevent duplicate fetches across components
const membershipCache = new Map<string, { data: UserMembership; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [membership, setMembership] = useState<UserMembership | null>(null);
    const [isMembershipLoading, setIsMembershipLoading] = useState(false);
    const fetchingRef = useRef(false); // Prevent duplicate fetches

    // Memoize supabase client to prevent recreation
    const supabase = useMemo(() => createClient(), []);

    // Fetch membership data ONCE after login with caching
    const fetchMembership = useCallback(async (userId: string) => {
        // Prevent duplicate parallel fetches
        if (fetchingRef.current) return;

        // Check cache first
        const cached = membershipCache.get(userId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            setMembership(cached.data);
            return;
        }

        fetchingRef.current = true;
        setIsMembershipLoading(true);

        try {
            // Parallelize membership and profile fetches with a hard 15-second timeout
            // to prevent the "Verifying access..." hang if Supabase is slow or unresponsive.
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Membership fetch timeout')), 15000)
            );

            const fetchPromise = Promise.all([
                supabase
                    .from('organization_memberships')
                    .select(`
                        role,
                        organization:organizations (
                            id,
                            name
                        )
                    `)
                    .eq('user_id', userId)
                    .eq('is_active', true)
                    .then(res => { if (res.error) throw res.error; return res.data; }),
                supabase
                    .from('property_memberships')
                    .select(`
                        role,
                        property:properties (
                            id,
                            name,
                            code,
                            organization_id
                        )
                    `)
                    .eq('user_id', userId)
                    .eq('is_active', true)
                    .then(res => { if (res.error) throw res.error; return res.data; }),
                supabase
                    .from('users')
                    .select('is_master_admin, onboarding_completed')
                    .eq('id', userId)
                    .maybeSingle()
                    .then(res => { if (res.error) throw res.error; return res.data; })
            ]);

            const [orgData, propData, profileData] = await Promise.race([fetchPromise, timeoutPromise]) as any;

            // Sort orgs to pick the "best" one for the primary context (admin roles first)
            const sortedOrgs = [...(orgData || [])].sort((a, b) => {
                const priority = { 'owner': 0, 'org_super_admin': 1, 'org_admin': 2 };
                const aP = priority[a.role as keyof typeof priority] ?? 10;
                const bP = priority[b.role as keyof typeof priority] ?? 10;
                return aP - bP;
            });

            const primaryOrg = sortedOrgs[0];

            const membershipData: UserMembership = {
                org_id: (primaryOrg?.organization as any)?.id || null,
                org_name: (primaryOrg?.organization as any)?.name || null,
                org_role: primaryOrg?.role || null,
                is_master_admin: !!profileData?.is_master_admin,
                onboarding_completed: !!profileData?.onboarding_completed,
                // Include all org memberships for access checks in layouts
                all_org_memberships: (orgData as any[])?.map((m: any) => ({
                    org_id: (m.organization as any)?.id,
                    role: m.role
                })) || [],
                properties: propData?.map((p: any) => ({
                    id: p.property?.id,
                    name: p.property?.name,
                    code: p.property?.code,
                    role: p.role,
                    organization_id: p.property?.organization_id
                })).filter((p: any) => p.id) || []
            };

            // Cache the result
            membershipCache.set(userId, { data: membershipData, timestamp: Date.now() });
            setMembership(membershipData);
        } catch (err) {
            console.error('Membership fetch error:', err);
            // On error, set membership with error flag so consumers know it failed
            setMembership({
                org_id: null,
                org_name: null,
                org_role: null,
                is_master_admin: false,
                onboarding_completed: false,
                all_org_memberships: [],
                properties: [],
                error: true
            });
        } finally {
            fetchingRef.current = false;
            setIsMembershipLoading(false);
        }
    }, [supabase]);

    const refreshMembership = useCallback(async () => {
        if (user?.id) {
            membershipCache.delete(user.id); // Clear cache
            await fetchMembership(user.id);
        }
    }, [user?.id, fetchMembership]);

    useEffect(() => {
        // Get initial session ONCE
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            setIsLoading(false); // ✅ Non-blocking: Show UI while data fetches in background
            // Signal to the hydration watchdog that React mounted successfully.
            // This prevents the watchdog in layout.tsx from force-reloading on slow connections.
            if (typeof window !== 'undefined') {
                (window as any).HYDRATED = true;
            }
            if (session?.user) {
                fetchMembership(session.user.id);
            }
        });

        // Subscribe to auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            setSession(session);
            setUser(session?.user ?? null);

            if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
                // Do not await here if we just want to kick it off, async is fine
                fetchMembership(session.user.id);
            } else if (event === 'SIGNED_OUT') {
                setMembership(null);
                if (user?.id) membershipCache.delete(user.id);
            }

            setIsLoading(false);
        });

        return () => subscription.unsubscribe();
    }, [supabase, fetchMembership]);

    const signIn = useCallback(async (email: string, password: string) => {
        let sessionData;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            let result: any = {};
            if (response.ok || response.status === 503) {
                result = await response.json().catch(() => ({ error: '' }));
            }

            // If server route is unreachable (503 / fetch failed), fall back to client-side login
            if (response.status === 503 || (result.error && result.error.toLowerCase().includes('unable to reach'))) {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw new Error(error.message);
                sessionData = data.session;
            } else if (!response.ok) {
                throw new Error(result.error || 'Login failed');
            }
        } catch (fetchError: any) {
            // Network error hitting the API route itself — fall back to direct client login
            if (fetchError.message === 'Failed to fetch' || fetchError.message?.includes('fetch')) {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw new Error(error.message);
                sessionData = data.session;
            } else {
                throw fetchError;
            }
        }

        // Sync session to browser client
        if (!sessionData) {
            const { data, error } = await supabase.auth.getSession();
            if (error) throw error;
            sessionData = data.session;
        }

        // Manually update local state to trigger immediate UI response
        if (sessionData) {
            setSession(sessionData);
            setUser(sessionData.user);
            membershipCache.delete(sessionData.user.id); // Always fetch fresh membership on sign-in
            await fetchMembership(sessionData.user.id);
        }

        return {
            data: {
                user: sessionData?.user || null,
                session: sessionData
            },
            error: null
        };
    }, [supabase, fetchMembership]);

    const signInWithGoogle = useCallback(async (propertyCode?: string, redirectPath?: string) => {
        const url = new URL(`${window.location.origin}/api/auth/callback`);
        if (redirectPath) {
            url.searchParams.set('redirect', redirectPath);
        }

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: url.toString(),
                queryParams: propertyCode ? { state: propertyCode } : {}
            }
        });
        if (error) throw error;
    }, [supabase]);

    const signInWithApple = useCallback(async (propertyCode?: string, redirectPath?: string) => {
        const url = new URL(`${window.location.origin}/api/auth/callback`);
        if (redirectPath) {
            url.searchParams.set('redirect', redirectPath);
        }

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'apple',
            options: {
                redirectTo: url.toString(),
                queryParams: propertyCode ? { state: propertyCode } : {}
            }
        });
        if (error) throw error;
    }, [supabase]);

    const signUp = useCallback(async (email: string, password: string, fullName: string) => {
        const response = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, fullName }),
        });

        if (!response.ok) {
            const errResult = await response.json().catch(() => ({ error: 'Signup failed' }));
            throw new Error(errResult.error || 'Signup failed');
        }
        const result = await response.json();

        // Sync session to browser client
        const { data: sessionData, error } = await supabase.auth.getSession();
        if (error) throw error;

        // Manually update local state if session exists
        if (sessionData.session) {
            setSession(sessionData.session);
            setUser(sessionData.session.user);
            await fetchMembership(sessionData.session.user.id);
        }

        return {
            user: sessionData.session?.user || result.data?.user || null,
            session: sessionData.session || result.data?.session || null
        };
    }, [supabase, fetchMembership]);

    const signOut = useCallback(async () => {
        if (user?.id) membershipCache.delete(user.id);
        
        // 🚀 Optimistic Update: Clear local state immediately for instant UI response
        setMembership(null);
        setSession(null);
        setUser(null);

        // Clear auto-sign in credentials on explicit logout as requested.
        try { localStorage.removeItem('rememberedEmail'); } catch {}
        try { localStorage.removeItem('rememberedPassword'); } catch {}
        try { sessionStorage.setItem('justLoggedOut', 'true'); } catch {}

        // Clear all data cache for security
        try {
            Object.keys(localStorage)
                .filter(k => k.startsWith('cache:'))
                .forEach(k => {
                    try { localStorage.removeItem(k); } catch {}
                });
        } catch {}

        await supabase.auth.signOut();
    }, [supabase, user?.id]);

    const resetPassword = useCallback(async (email: string) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent('/reset-password')}`,
        });
        if (error) throw error;
    }, [supabase]);

    const signInWithZoho = useCallback((propertyCode?: string, redirectPath?: string) => {
        const url = new URL('/api/auth/zoho', window.location.origin);
        if (redirectPath) url.searchParams.set('redirect', redirectPath);
        if (propertyCode) url.searchParams.set('propertyCode', propertyCode);
        window.location.href = url.toString();
    }, []);

    // Memoize the context value to prevent unnecessary re-renders
    const value = useMemo(() => ({
        user,
        session,
        isLoading,
        membership,
        isMembershipLoading,
        signIn,
        signUp,
        signInWithGoogle,
        signInWithApple,
        signInWithZoho,
        signOut,
        resetPassword,
        refreshMembership
    }), [user, session, isLoading, membership, isMembershipLoading, signIn, signUp, signInWithGoogle, signInWithApple, signInWithZoho, signOut, resetPassword, refreshMembership]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
