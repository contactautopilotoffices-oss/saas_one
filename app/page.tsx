'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import { resolveSilo } from '@/frontend/lib/auth/silos';
import { createClient } from '@/frontend/utils/supabase/client';
import Link from 'next/link';
import HeroSection from '@/frontend/components/landing/HeroSection';
import BuildingStory from '@/frontend/components/landing/BuildingStory';
import Loader from '@/frontend/components/ui/Loader';

export default function Home() {
    const { user, isLoading, membership, isMembershipLoading, signOut } = useAuth();
    const router = useRouter();
    const [isRedirecting, setIsRedirecting] = useState(false);
    // Set while an account with no access is signed out and sent to the login page, so the landing page
    // does not flash up when the sign-out clears the user.
    const [isLeaving, setIsLeaving] = useState(false);
    // Where the redirect below is heading, so the safety timer can finish the job.
    const redirectTargetRef = useRef<string | null>(null);

    // Safety net for a redirect that never completes (slow network, cold server, or the
    // client-side navigation failing to load its files). Previously this timer lived in the
    // effect below, which also depended on isRedirecting: each time the timer fired, the effect
    // re-ran, started the same redirect again and re-armed the timer, so the page could sit on
    // "Loading..." for ever. Now it fires once and does a full page load to the target, which
    // fetches fresh files and lets the server route the user (e.g. to /login if the session
    // turned out to be invalid).
    useEffect(() => {
        if (!isRedirecting) return;
        const timeoutId = setTimeout(() => {
            const target = redirectTargetRef.current;
            if (target) {
                console.warn('Redirect taking too long, doing a full page load to', target);
                window.location.assign(target);
            } else {
                setIsRedirecting(false);
            }
        }, 8000);
        return () => clearTimeout(timeoutId);
    }, [isRedirecting]);

    useEffect(() => {
        const go = (path: string) => {
            redirectTargetRef.current = path;
            router.replace(path);
        };

        const handleAuthRedirect = async () => {
            // Only proceed if auth and membership are fully loaded
            if (isLoading || isMembershipLoading) return;
            if (!user) {
                setIsRedirecting(false);
                return;
            }

            // At this point, user is logged in. 
            // We check for membership data provided by context.
            setIsRedirecting(true);

            try {
                if (membership?.error) {
                    console.error('Membership data had an error, redirecting to login with error.');
                    go('/login?error=auth_failed');
                    return;
                }

                // 1. Check if user is master admin (now provided by context for speed)
                if (membership?.is_master_admin) {
                    go('/master');
                    return;
                }

                // 1.6 Approval gate (from origin/main). Runs BEFORE any silo
                // routing: an unapproved user must not be routed into a workspace.
                if (!membership?.is_master_admin && membership?.is_approved === false) {
                    go('/waiting-approval');
                    return;
                }

                // 2. Silo guard — CRM and Accounts users must ALWAYS land in their own
                // workspace and NEVER fall through to an FMS dashboard. See
                // frontend/lib/auth/silos.ts (mirrored by the login handler).
                const silo = resolveSilo(
                    [
                        { role: membership?.org_role, orgId: membership?.org_id },
                        ...(membership?.all_org_memberships || []).map((m) => ({ role: m.role, orgId: m.org_id })),
                        ...(membership?.properties || []).map((p) => ({ role: p.role, orgId: p.organization_id })),
                    ],
                    membership?.org_id,
                );
                if (silo) {
                    go(silo.path);
                    return;
                }

                // 3. Check Org Membership from context
                const ORG_ROUTED_ROLES = ['org_super_admin', 'ops_super_admin', 'tech', 'it', 'design', 'super_tenant', 'owner', 'admin', 'org_admin', 'maintenance_vendor', 'procurement'];
                if (membership?.org_id && membership?.org_role && ORG_ROUTED_ROLES.includes(membership.org_role)) {
                    go('/dashboard');
                    return;
                }

                // 4. Check Property Memberships from context
                if (membership?.properties && membership.properties.length > 0) {
                    // Determine the best property/role to redirect to
                    // For now, take the first one
                    const prop = membership.properties[0];
                    const { id: property_id, role } = prop;

                    if (role === 'property_admin') {
                        go(`/property/${property_id}/dashboard`);
                    } else if (role === 'tenant') {
                        go(`/property/${property_id}/tenant`);
                    } else if (role === 'security') {
                        go(`/property/${property_id}/security`);
                    } else if (role === 'staff') {
                        go(`/property/${property_id}/staff`);
                    } else if (role === 'soft_service_manager') {
                        go(`/property/${property_id}/soft-service-manager`);
                    } else if (role === 'mst') {
                        go(`/property/${property_id}/mst`);
                    } else if (role === 'vendor') {
                        go(`/property/${property_id}/vendor`);
                    } else if (role === 'procurement') {
                        go('/procurement');
                    } else {
                        go(`/property/${property_id}/dashboard`);
                    }
                    return;
                }

                // 5. NO MEMBERSHIP FOUND
                // If the user already completed onboarding but has no active memberships, 
                // send them to no access rather than forcing them to onboard again.
                if (membership?.onboarding_completed) {
                    // Sign out on this device first, then a full page load to the login page, which shows
                    // "not assigned to any organization or property". Sending a still-signed-in user to /login
                    // looped for ever: the proxy sends a signed-in user on /login back to /, and / sent them to
                    // /login again (stuck reloading, with no way out in an iPhone home-screen app). The local
                    // sign-out needs no network, so it cannot fail and restart the loop; other devices sign
                    // out the same way when the account next opens the app there.
                    console.log('User has no memberships but already onboarded. Signing out on this device and opening the login page.');
                    setIsLeaving(true);
                    // The context's sign-out clears the saved login details and caches straight away; its
                    // server call may still be running when the page changes, which does not matter.
                    signOut().catch(() => {});
                    try { await createClient().auth.signOut({ scope: 'local' }); } catch { /* the full load below still runs */ }
                    window.location.replace('/login?error=no_access');
                } else {
                    console.log('User logged in but no memberships found and not onboarded. Redirecting to onboarding.');
                    go('/onboarding');
                }
            } catch (err) {
                console.error('Redirect error:', err);
                setIsRedirecting(false); // Fallback to landing if DB call fails
            }
        };

        handleAuthRedirect();
    }, [user, isLoading, isMembershipLoading, membership, router, signOut]);

    // Show loader while checking auth or redirecting
    if (isLoading || isRedirecting || isLeaving) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-slate-950">
                <Loader size="lg" text="Loading..." />
                {/* Plain link, revealed by CSS after 10 s: it works even if the app's JavaScript
                    never started, which is the only way out for an iPhone home-screen app
                    (no address bar, no pull-to-refresh). A full page load is the point, so
                    next/link (client-side navigation) would defeat it. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/" className="loader-reload-hint text-xs text-slate-400 underline underline-offset-4 px-4 py-2">
                    Taking too long? Tap to reload
                </a>
            </div>
        );
    }

    // Show landing page for unauthenticated users
    return (
        <main className="flex flex-col min-h-screen bg-black overflow-x-hidden">
            <HeroSection />
            <BuildingStory />
            <footer className="bg-slate-950 border-t border-white/5 py-6 px-8">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
                    <p className="text-white/30 text-xs">© {new Date().getFullYear()} Autopilot. All rights reserved.</p>
                    <div className="flex items-center gap-6">
                        <Link href="/privacy" className="text-white/30 hover:text-white/60 text-xs transition-colors">
                            Privacy Policy
                        </Link>
                        <Link href="/terms" className="text-white/30 hover:text-white/60 text-xs transition-colors">
                            Terms of Service
                        </Link>
                    </div>
                </div>
            </footer>
        </main>
    );
}

