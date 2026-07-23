import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';

export async function POST(request: NextRequest) {
    try {
        // role/organizationId are optional. The normal flow leaves them unset
        // here and lets the onboarding flow assign role + property/org membership.
        const { email, password, fullName, role, organizationId } = await request.json();

        if (!email || !password) {
            return NextResponse.json(
                { error: 'Email and password are required' },
                { status: 400 }
            );
        }

        const supabase = await createClient();
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    ...(role ? { role } : {}),
                },
            },
        });

        if (error) {
            return NextResponse.json(
                { error: error.message },
                { status: 400 }
            );
        }

        // Back-compat: if an explicit role + org are supplied, create the
        // org-level membership immediately (used by any direct API callers).
        if (data.user && role && organizationId) {
            await supabase
                .from('organization_memberships')
                .insert({
                    user_id: data.user.id,
                    organization_id: organizationId,
                    role: role,
                    is_active: true
                });
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error('Signup API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
