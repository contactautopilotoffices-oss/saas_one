'use client';

import { useAuth } from "@/frontend/context/AuthContext";
import { useRouter, useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/frontend/utils/supabase/client";
import Loader from "@/frontend/components/ui/Loader";


export default function PropertyLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, isLoading: authLoading, membership, isMembershipLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const pathname = usePathname();
    const propertyId = params.propertyId as string;

    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [isCheckingAccess, setIsCheckingAccess] = useState(true);

    useEffect(() => {
        const checkPropertyAccess = async () => {
            // Wait for both session and membership metadata to load
            if (authLoading || isMembershipLoading) return;

            if (!user) {
                router.replace('/login');
                return;
            }

            // UUID Validation helper
            const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

            if (!propertyId || (!isUuid(propertyId) && propertyId !== 'all')) {
                setIsAuthorized(false);
                setIsCheckingAccess(false);
                return;
            }

            try {
                // 1. MASTER ADMIN BYPASS
                if (membership?.is_master_admin) {
                    setIsAuthorized(true);
                    setUserRole('master_admin');
                    setIsCheckingAccess(false);
                    return;
                }

                // 2. DIRECT PROPERTY MEMBERSHIP (Pre-fetched)
                const directMatch = membership?.properties.find(p => p.id === propertyId);
                if (directMatch) {
                    setIsAuthorized(true);
                    setUserRole(directMatch.role);
                    validatePath(directMatch.role);
                    setIsCheckingAccess(false);
                    return;
                }

                // 3. ORG-LEVEL ACCESS OR FALLBACK
                // If not a direct member, we need to know which org this property belongs to.
                // We use a simple client-side fetch (which should be fast and cached by Supabase client).
                const supabase = createClient();
                const { data: property, error } = await supabase
                    .from('properties')
                    .select('organization_id')
                    .eq('id', propertyId)
                    .maybeSingle();

                if (error) throw error;

                if (property?.organization_id) {
                    // Check if user is an admin of this organization (Pre-fetched)
                    const orgMatch = membership?.all_org_memberships.find(m => 
                        m.org_id === property.organization_id && 
                        ['org_admin', 'org_super_admin', 'owner'].includes(m.role)
                    );

                    if (orgMatch) {
                        setIsAuthorized(true);
                        setUserRole(orgMatch.role);
                        validatePath(orgMatch.role);
                        setIsCheckingAccess(false);
                        return;
                    }
                }

                // If we reach here, no access was found
                setIsAuthorized(false);
            } catch (err) {
                console.error('Access verification failed:', err);
                // On error, we fallback to restricted access rather than staying stuck
                setIsAuthorized(false);
            } finally {
                setIsCheckingAccess(false);
            }
        };

        const validatePath = (role: string) => {
            const allowedPaths = getRoleAllowedPaths(role, propertyId);
            const currentPath = pathname || '';
            const isPathAllowed = allowedPaths.some(allowed =>
                currentPath.startsWith(allowed) || currentPath === allowed
            );

            if (!isPathAllowed) {
                router.replace(getRoleDefaultPath(role, propertyId));
            }
        };

        checkPropertyAccess();
    }, [user, authLoading, isMembershipLoading, membership, propertyId, pathname, router]);

    // ── FAIL-SAFE: Loader Timeout ──────────────────────────────────────────
    // If access verification takes more than 5 seconds, we clear the loading 
    // state to prevent the user from being stuck indefinitely.
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isCheckingAccess) {
                console.warn('[Access Fail-Safe] Verification timed out — clearing loader');
                setIsCheckingAccess(false);
            }
        }, 5000);
        return () => clearTimeout(timer);
    }, [isCheckingAccess]);

    // Loading state
    if (authLoading || isMembershipLoading || isCheckingAccess) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader size="lg" text="Verifying access..." />
            </div>
        );
    }

    // Not authenticated - will redirect
    if (!user) {
        return null;
    }

    // Not authorized for this property
    if (isAuthorized === false) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg className="w-8 h-8 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-text-primary mb-2">Access Denied</h1>
                    <p className="text-text-secondary mb-6">
                        You don't have permission to access this property. Please contact your administrator if you believe this is an error.
                    </p>
                    <button
                        onClick={() => router.push('/login')}
                        className="px-6 py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary-dark transition-colors"
                    >
                        Return to Login
                    </button>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

/**
 * Get allowed paths based on user role
 */
function getRoleAllowedPaths(role: string, propertyId: string): string[] {
    const basePath = `/property/${propertyId}`;

    switch (role) {
        case 'property_admin':
        case 'org_admin':
        case 'org_super_admin':
        case 'master_admin':
        case 'owner':
            // Full access
            return [basePath];
        case 'tenant':
            return [
                `${basePath}/tenant`,
                `${basePath}/dashboard`, // Some dashboards may be shared
            ];
        case 'security':
            return [
                `${basePath}/security`,
                `${basePath}/dashboard`,
            ];
        case 'staff':
            return [
                `${basePath}/staff`,
                `${basePath}/dashboard`,
            ];
        case 'mst':
            return [
                `${basePath}/mst`,
                `${basePath}/dashboard`,
            ];
        case 'vendor':
            return [
                `${basePath}/vendor`,
                `${basePath}/dashboard`,
            ];
        default:
            return [`${basePath}/dashboard`];
    }
}

/**
 * Get default redirect path based on user role
 */
function getRoleDefaultPath(role: string, propertyId: string): string {
    const basePath = `/property/${propertyId}`;

    switch (role) {
        case 'property_admin':
        case 'org_admin':
        case 'org_super_admin':
        case 'master_admin':
        case 'owner':
            return `${basePath}/dashboard`;
        case 'tenant':
            return `${basePath}/tenant`;
        case 'security':
            return `${basePath}/security`;
        case 'staff':
            return `${basePath}/staff`;
        case 'mst':
            return `${basePath}/mst`;
        case 'vendor':
            return `${basePath}/vendor`;
        default:
            return `${basePath}/dashboard`;
    }
}
