import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

// Create admin client to bypass RLS and perform atomic user/membership creation
const getAdminClient = () => createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { name, email, mobile, password, propertyId } = body;

        if (!email || !password || !propertyId || !name) {
            return NextResponse.json({ error: 'Name, email, password, and property ID are required.' }, { status: 400 });
        }

        const supabaseAdmin = getAdminClient();

        // 1. Verify Property Existence & Get Organization ID
        const { data: property, error: propError } = await supabaseAdmin
            .from('properties')
            .select('id, name, organization_id')
            .eq('id', propertyId)
            .maybeSingle();

        if (propError || !property) {
            return NextResponse.json({ error: 'Invalid or inactive property.' }, { status: 404 });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanPhone = (mobile || '').trim();

        // 2. Check if Auth User already exists
        let userId: string | null = null;
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingAuthUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === cleanEmail);

        if (existingAuthUser) {
            userId = existingAuthUser.id;
            // Update auth metadata
            await supabaseAdmin.auth.admin.updateUserById(userId, {
                password: password, // Update password if re-registering via QR
                user_metadata: {
                    full_name: name,
                    role: 'tenant',
                    onboarding_completed: true
                }
            });
        } else {
            // Create new auth user with auto-confirmed email
            const { data: newAuth, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
                email: cleanEmail,
                password: password,
                email_confirm: true,
                user_metadata: {
                    full_name: name,
                    role: 'tenant',
                    onboarding_completed: true
                }
            });

            if (createAuthErr || !newAuth.user) {
                console.error('[Tenant Signup] Failed to create auth user:', createAuthErr);
                return NextResponse.json({ error: createAuthErr?.message || 'Failed to create account.' }, { status: 400 });
            }

            userId = newAuth.user.id;
        }

        // 3. Upsert user in `users` table
        const { error: userUpsertErr } = await supabaseAdmin
            .from('users')
            .upsert({
                id: userId,
                email: cleanEmail,
                full_name: name,
                phone: cleanPhone || null,
                onboarding_completed: true
            }, { onConflict: 'id' });

        if (userUpsertErr) {
            console.error('[Tenant Signup] User table upsert error:', userUpsertErr);
        }

        // 4. Create property membership (tenant is strictly a property-level role)
        const { error: propMemErr } = await supabaseAdmin
            .from('property_memberships')
            .upsert({
                user_id: userId,
                property_id: propertyId,
                organization_id: property.organization_id,
                role: 'tenant',
                is_active: true
            }, { onConflict: 'user_id,property_id' });

        if (propMemErr && !propMemErr.message?.toLowerCase().includes('duplicate')) {
            console.error('[Tenant Signup] Property membership error:', propMemErr);
        }

        const redirectUrl = `/property/${propertyId}/tenant`;

        return NextResponse.json({
            success: true,
            message: `Account set up successfully for ${property.name}!`,
            email: cleanEmail,
            redirectUrl
        }, { status: 200 });

    } catch (err: any) {
        console.error('[Tenant Signup] Error:', err);
        return NextResponse.json({ error: err.message || 'Tenant registration failed.' }, { status: 500 });
    }
}
