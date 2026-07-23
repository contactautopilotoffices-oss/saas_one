import { createClient } from '@/frontend/utils/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    const propertyCode = requestUrl.searchParams.get('state'); // Optional: for property-scoped signup
    const next = requestUrl.searchParams.get('next'); // For password reset redirect
    const decodedNext = next ? decodeURIComponent(next) : null;
    const redirect = requestUrl.searchParams.get('redirect');

    // Handle Supabase error responses (e.g., expired OTP, invalid link)
    const errorParam = requestUrl.searchParams.get('error');
    const errorCode = requestUrl.searchParams.get('error_code');
    const errorDescription = requestUrl.searchParams.get('error_description');

    if (errorParam) {
        console.error('Auth callback error:', errorParam, errorCode, errorDescription);

        // If this was a password reset flow, redirect back to forgot-password with error
        if (decodedNext === '/reset-password' || errorCode === 'otp_expired') {
            return NextResponse.redirect(
                `${requestUrl.origin}/forgot-password?error=link_expired`
            );
        }

        // Generic auth error
        return NextResponse.redirect(`${requestUrl.origin}/login?error=auth_failed`);
    }

    if (code) {
        const supabase = await createClient();

        // 1. Exchange code for session
        const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
            console.error('Auth Error:', error.message);
            
            // Check if session already exists (e.g., if code was consumed by a browser prefetch)
            const { data: { user: existingUser } } = await supabase.auth.getUser();
            
            if (existingUser) {
                console.log('Session already exists (likely from prefetch). Proceeding.');
                if (decodedNext) {
                    return NextResponse.redirect(`${requestUrl.origin}${decodedNext}`);
                }
                // If not a password reset, we can redirect to the main app, but we don't have the user object from the exchange.
                // We can just redirect to dashboard/home and let the client handle it.
                return NextResponse.redirect(`${requestUrl.origin}/`);
            }

            // If this was a password reset, redirect to forgot-password
            if (decodedNext === '/reset-password') {
                return NextResponse.redirect(
                    `${requestUrl.origin}/forgot-password?error=link_expired`
                );
            }
            return NextResponse.redirect(`${requestUrl.origin}/login?error=auth_failed`);
        }

        // 2. If 'next' parameter exists (e.g., password reset), redirect there immediately
        if (decodedNext) {
            console.log('Password reset flow detected, redirecting to:', decodedNext);
            return NextResponse.redirect(`${requestUrl.origin}${decodedNext}`);
        }

        if (user) {
            // 3. Parallelize profile storage and membership checks
            const [profileResult, orgResult, propResult] = await Promise.all([
                // A. COMPULSORY profile storage
                supabase.from('users').upsert({
                    id: user.id,
                    full_name: user.user_metadata.full_name || user.email?.split('@')[0],
                    email: user.email!,
                    phone: user.phone || user.user_metadata.phone || null,
                    metadata: user.user_metadata
                }).select('is_master_admin, onboarding_completed').single(),

                // B. Check Organization Membership (Org Super Admin)
                supabase
                    .from('organization_memberships')
                    .select('organization_id, role')
                    .eq('user_id', user.id)
                    .eq('role', 'org_super_admin')
                    .eq('is_active', true)
                    .maybeSingle(),

                // C. Check Property Membership
                // Fetch all and take first to avoid errors when a user belongs to multiple properties
                supabase
                    .from('property_memberships')
                    .select('property_id, organization_id, role')
                    .eq('user_id', user.id)
                    .eq('is_active', true)
                    .order('created_at', { ascending: false })
            ]);

            const { data: dbUser, error: profileError } = profileResult;
            const { data: orgMembership } = orgResult;
            const propMembership = propResult.data?.[0]; // Get the first active property membership

            if (profileError) console.error('Profile Error:', profileError.message);

            // --- ROLE-BASED ROUTING ---

            // STEP 1: Check if Master Admin
            if (dbUser?.is_master_admin || user.user_metadata?.is_master_admin) {
                if (redirect && redirect !== '/') {
                    return NextResponse.redirect(`${requestUrl.origin}${redirect}`);
                }
                return NextResponse.redirect(`${requestUrl.origin}/master`);
            }

            // STEP 2: Check Organization Membership
            if (orgMembership) {
                if (redirect && redirect !== '/') {
                    return NextResponse.redirect(`${requestUrl.origin}${redirect}`);
                }
                return NextResponse.redirect(`${requestUrl.origin}/org/${orgMembership.organization_id}/dashboard`);
            }

            // SPECIAL CASE: Property-scoped signup (Join flow) - We still handle this sequentially if needed, 
            // but for now we focus on the common path.
            if (propertyCode) {
                const { data: property } = await supabase
                    .from('properties')
                    .select('id, organization_id')
                    .eq('code', propertyCode)
                    .maybeSingle();

                if (property) {
                    await supabase.from('property_memberships').insert({
                        user_id: user.id,
                        organization_id: property.organization_id,
                        property_id: property.id,
                        role: 'tenant'
                    });

                    return NextResponse.redirect(`${requestUrl.origin}/onboarding`);
                }
            }

            // STEP 3: Route based on Property Membership
            if (propMembership) {
                if (redirect && redirect !== '/') {
                    return NextResponse.redirect(`${requestUrl.origin}${redirect}`);
                }

                const role = propMembership.role;
                const pId = propMembership.property_id;

                // Role-based routing
                const routes: Record<string, string> = {
                    property_admin: `/property/${pId}/dashboard`,
                    tenant: `/property/${pId}/tenant`,
                    security: `/property/${pId}/security`,
                    soft_service_manager: `/property/${pId}/dashboard`,
                    staff: `/property/${pId}/staff`,
                    mst: `/property/${pId}/mst`,
                    vendor: `/property/${pId}/vendor`
                };

                return NextResponse.redirect(`${requestUrl.origin}${routes[role] || `/property/${pId}/dashboard`}`);
            }

            // STEP 4: No Membership Found
            // If onboarding not completed → new user or re-registered after deletion → go to onboarding
            // Otherwise → existing user who was removed from property → show error
            if (!dbUser?.onboarding_completed) {
                return NextResponse.redirect(`${requestUrl.origin}/onboarding`);
            }
            return NextResponse.redirect(`${requestUrl.origin}/login?error=no_access`);
        }
    }

    // Fallback — no code param or user was null after exchange
    return NextResponse.redirect(`${requestUrl.origin}/login?error=auth_failed`);
}

