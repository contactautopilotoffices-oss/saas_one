'use client';

import { useAuth } from "@/frontend/context/AuthContext";
import { useRouter, useParams } from "next/navigation";
import { useEffect } from "react";
import Loader from "@/frontend/components/ui/Loader";

export default function OrgLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, membership, isLoading: authLoading, isMembershipLoading, refreshMembership, signOut } = useAuth();
    const router = useRouter();
    const params = useParams();
    const orgId = params.orgId as string;

    const verified = !!user && membership?.user_id === user.id;
    const isCheckingAccess = authLoading || (!!user && (isMembershipLoading || !verified));
    const approved = !!membership?.is_approved && !membership.error;
    const isAuthorized = verified && approved && membership!.all_org_memberships.some(member => member.org_id === orgId);
    const property = verified && approved ? membership!.properties.find(item => item.organization_id === orgId) : null;

    useEffect(() => {
        if (isCheckingAccess) return;
        if (!user) router.replace('/login');
        else if (verified && !membership?.error && !approved) router.replace('/waiting-approval');
        else if (!isAuthorized && property) router.replace('/property/' + property.id + '/dashboard');
    }, [isCheckingAccess, user?.id, verified, membership?.error, approved, isAuthorized, property?.id, router]);

    // Loading state
    if (authLoading || isCheckingAccess) {
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

    if (membership?.error) {
        return <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4" role="alert">
            <p>Could not verify your organization access.</p>
            <button className="px-6 py-3 bg-primary text-white rounded-lg" onClick={() => refreshMembership()}>Retry</button>
        </div>;
    }
    if (!approved || property && !isAuthorized) return null;
    // Never mount protected screens before verified organization membership.
    if (!isAuthorized) {
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
                        You don't have permission to access this organization. Please contact your administrator if you believe this is an error.
                    </p>
                    <button
                        onClick={async () => {
                            await signOut();
                            router.push('/login');
                        }}
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
