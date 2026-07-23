'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/frontend/context/AuthContext';
import { createClient } from '@/frontend/utils/supabase/client';
import Link from 'next/link';
import HeroSection from '@/frontend/components/landing/HeroSection';
import BuildingStory from '@/frontend/components/landing/BuildingStory';
import Loader from '@/frontend/components/ui/Loader';

export default function Home() {
    const { user, isLoading, membership, isMembershipLoading, signOut } = useAuth();
    const router = useRouter();
    const [isRedirecting, setIsRedirecting] = useState(false);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (isRedirecting) {
                console.warn('Redirect taking too long, falling back...');
                setIsRedirecting(false);
            }
        }, 5000); // 5 second safety timeout

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
                    router.replace('/login?error=auth_failed');
                    return;
                }

                // 1. Check if user is master admin (now provided by context for speed)
                if (membership?.is_master_admin) {
                    router.replace('/master');
                    return;
                }

                // 2. CRM guard — single source of truth (mirrors the login handler).
                // Business-development (CRM) users must ALWAYS land on the CRM view and
                // NEVER fall through to an FMS dashboard. If the user has a CRM role and
                // NO genuine FMS role, short-circuit to /{org}/crm.
                const CRM_ONLY_ROLES = ['bd_rep', 'bd_admin', 'bd_super_admin'];
                const FMS_ROLES = ['property_admin', 'tenant', 'security', 'staff', 'mst', 'vendor', 'org_admin', 'owner', 'admin', 'procurement', 'org_super_admin', 'super_tenant', 'maintenance_vendor'];

                const crmOrgMemberships = (membership?.all_org_memberships || [])
                    .filter((m) => CRM_ONLY_ROLES.includes(m.role));
                const crmPropMemberships = (membership?.properties || [])
                    .filter((p) => CRM_ONLY_ROLES.includes(p.role));
                const allMembershipRoles = [
                    ...(membership?.org_role ? [membership.org_role] : []),
                    ...(membership?.all_org_memberships || []).map((m) => m.role),
                    ...(membership?.properties || []).map((p) => p.role),
                ];
                const hasCrmRole = allMembershipRoles.some((r) => CRM_ONLY_ROLES.includes(r));
                const hasFmsRole = allMembershipRoles.some((r) => FMS_ROLES.includes(r));

                if (hasCrmRole && !hasFmsRole) {
                    const crmOrgId =
                        crmOrgMemberships[0]?.org_id ||
                        crmPropMemberships[0]?.organization_id ||
                        membership?.org_id;
                    if (crmOrgId) {
                        router.replace(`/${crmOrgId}/crm`);
                        return;
                    }
                }

                // 3. Check Org Membership from context
                const ORG_ROUTED_ROLES = ['org_super_admin', 'super_tenant', 'owner', 'admin', 'org_admin', 'maintenance_vendor', 'procurement'];
                if (membership?.org_id && membership?.org_role && ORG_ROUTED_ROLES.includes(membership.org_role)) {
                    router.replace(`/org/${membership.org_id}/dashboard`);
                    return;
                }

                // 4. Check Property Memberships from context
                if (membership?.properties && membership.properties.length > 0) {
                    // Determine the best property/role to redirect to
                    // For now, take the first one
                    const prop = membership.properties[0];
                    const { id: property_id, role } = prop;

                    if (role === 'property_admin') {
                        router.replace(`/property/${property_id}/dashboard`);
                    } else if (role === 'tenant') {
                        router.replace(`/property/${property_id}/tenant`);
                    } else if (role === 'security') {
                        router.replace(`/property/${property_id}/security`);
                    } else if (role === 'staff') {
                        router.replace(`/property/${property_id}/staff`);
                    } else if (role === 'soft_service_manager') {
                        router.replace(`/property/${property_id}/soft-service-manager`);
                    } else if (role === 'mst') {
                        router.replace(`/property/${property_id}/mst`);
                    } else if (role === 'vendor') {
                        router.replace(`/property/${property_id}/vendor`);
                    } else if (role === 'procurement') {
                        router.replace('/procurement');
                    } else {
                        router.replace(`/property/${property_id}/dashboard`);
                    }
                    return;
                }

                // 5. NO MEMBERSHIP FOUND
                // If the user already completed onboarding but has no active memberships, 
                // send them to no access rather than forcing them to onboard again.
                if (membership?.onboarding_completed) {
                    console.log('User has no memberships but already onboarded. Redirecting to no access.');
                    router.replace('/login?error=no_access');
                } else {
                    console.log('User logged in but no memberships found and not onboarded. Redirecting to onboarding.');
                    router.replace('/onboarding');
                }
            } catch (err) {
                console.error('Redirect error:', err);
                setIsRedirecting(false); // Fallback to landing if DB call fails
            }
        };

        handleAuthRedirect();
        return () => clearTimeout(timeoutId);
    }, [user, isLoading, isMembershipLoading, membership, router, isRedirecting]);

    // Show loader while checking auth or redirecting
    if (isLoading || isRedirecting) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950">
                <Loader size="lg" text="Loading..." />
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

