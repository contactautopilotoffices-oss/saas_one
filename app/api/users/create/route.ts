import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/frontend/utils/supabase/server'
import { createAdminClient } from '@/frontend/utils/supabase/admin'
import { WhatsAppService } from '@/backend/services/WhatsAppService'
import { buildWelcomeMessage } from '@/backend/lib/whatsapp/welcomeMessage'

interface CreateUserRequest {
    email: string
    password?: string
    full_name: string
    phone?: string
    organization_id: string
    role?: string // matches app_role enum: 'master_admin' | 'org_super_admin' | 'property_admin' | 'staff' | 'tenant'
    username?: string
    create_master_admin?: boolean
    property_id?: string
    specialization?: string
    skills?: string[]
}

/**
 * POST /api/users/create
 * 
 * Directly create a user account and add them to an organization.
 * Use this for admin-initiated user creation (no email verification required).
 * 
 * Required: Caller must be an admin/owner of the organization.
 */
export async function POST(request: NextRequest) {
    try {
        const body: CreateUserRequest = await request.json()
        const {
            email,
            password,
            full_name,
            organization_id,
            role = 'staff', // Default to a valid enum value if not provided
            username
        } = body

        // Validation: email and full_name are always required.
        // organization_id is required UNLESS we are creating a master admin.
        const createMasterAdmin = body.create_master_admin === true;

        if (!email || !full_name || (!organization_id && !createMasterAdmin)) {
            return NextResponse.json(
                { error: 'Missing required fields: email, full_name, and organization_id (unless creating master admin)' },
                { status: 400 }
            )
        }

        if (!email.includes('@')) {
            return NextResponse.json(
                { error: 'Invalid email format' },
                { status: 400 }
            )
        }

        // Role enum guard — reject any value not in the allowed set to prevent privilege escalation
        const ALLOWED_ROLES = [
            'master_admin', 'org_super_admin', 'ops_super_admin', 'property_admin',
            'staff', 'mst', 'tenant', 'procurement', 'vendor', 'super_tenant',
            'hr', 'hr_head', 'security', 'soft_service_staff', 'soft_service_supervisor', 'soft_service_manager'
        ] as const;
        if (!ALLOWED_ROLES.includes(role as any)) {
            return NextResponse.json(
                { error: `Invalid role "${role}". Allowed: ${ALLOWED_ROLES.join(', ')}` },
                { status: 400 }
            )
        }

        // Get the current user's session to verify permissions
        const supabase = await createClient()
        const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()

        if (authError || !currentUser) {
            return NextResponse.json(
                { error: 'Unauthorized. Please log in.' },
                { status: 401 }
            )
        }

        // Check if current user is a master admin
        const { data: masterAdminData } = await supabase
            .from('users')
            .select('is_master_admin')
            .eq('id', currentUser.id)
            .single()

        const isCurrentMasterAdmin = !!masterAdminData?.is_master_admin

        // Permission Check
        if (createMasterAdmin) {
            if (!isCurrentMasterAdmin) {
                return NextResponse.json(
                    { error: 'Forbidden. Only Master Admins can create other Master Admins.' },
                    { status: 403 }
                )
            }
        } else {
            // If not creating master admin, check if org admin (or master admin)
            if (!isCurrentMasterAdmin) {
                // 1. Check Org Admin roles
                const { data: orgMembership } = await supabase
                    .from('organization_memberships')
                    .select('role')
                    .eq('organization_id', organization_id)
                    .eq('user_id', currentUser.id)
                    .maybeSingle();

                const isOrgAdmin = orgMembership && ['org_super_admin', 'admin', 'owner'].includes(orgMembership.role);

                // 2. Check Property Admin role (if property_id is provided)
                let isPropertyAdmin = false;
                const { property_id } = body;
                if (property_id) {
                    const { data: propMembership } = await supabase
                        .from('property_memberships')
                        .select('role')
                        .eq('property_id', property_id)
                        .eq('user_id', currentUser.id)
                        .maybeSingle();

                    isPropertyAdmin = !!(propMembership && propMembership.role === 'property_admin');
                }

                if (!isOrgAdmin && !isPropertyAdmin) {
                    return NextResponse.json(
                        { error: 'Forbidden. You must be an organization admin, property admin, or master admin to create users.' },
                        { status: 403 }
                    )
                }
            }
        }

        // Use admin client for user creation (bypasses RLS)
        const adminClient = createAdminClient()

        // Generate a secure temporary password if not provided
        const userPassword = password || generateTempPassword()

        // Create the auth user
        const { data: userData, error: createError } = await adminClient.auth.admin.createUser({
            email,
            password: userPassword,
            email_confirm: true, // Auto-confirm email for admin-created users
            user_metadata: {
                full_name,
                username: username || email.split('@')[0],
                created_by: currentUser.id,
                organization_id: organization_id || null,
            }
        })

        if (createError) {
            console.error('User creation error:', createError)

            // Handle duplicate user
            const isDuplicate = (createError as any).code === 'email_exists' ||
                createError.message.toLowerCase().includes('already registered') ||
                createError.message.toLowerCase().includes('already been registered');

            if (isDuplicate) {
                return NextResponse.json(
                    { error: `A user with email "${email}" is already registered in the app. If this is an existing employee, map their ECode in the Employee Directory or App Reconciliation tab.` },
                    { status: 409 }
                )
            }

            return NextResponse.json(
                { error: createError.message },
                { status: 400 }
            )
        }

        if (!userData.user) {
            return NextResponse.json(
                { error: 'User creation failed - no user returned' },
                { status: 500 }
            )
        }

        // If creating a master admin, update the user record
        if (createMasterAdmin) {
            const { error: updateError } = await adminClient
                .from('users')
                .update({ is_master_admin: true })
                .eq('id', userData.user.id)

            if (updateError) {
                console.error('Failed to set master admin flag:', updateError)
                // Just log it, user is created but not master admin yet. Manual fix might be needed.
            }
        }

        const { property_id } = body

        // Membership logic:
        // org_super_admin, ops_super_admin, procurement, hr, hr_head & super_tenant → organization_memberships
        // all other roles               → property_memberships
        // On failure: delete the auth user to avoid stranded accounts (partial state cleanup)
        const IS_ORG_WIDE_ROLE = ['org_super_admin', 'ops_super_admin', 'procurement', 'hr', 'hr_head', 'super_tenant'].includes(role);

        if (IS_ORG_WIDE_ROLE) {
            if (organization_id) {
                let { error: memberError } = await adminClient
                    .from('organization_memberships')
                    .insert({ organization_id, user_id: userData.user.id, role });

                // If DB enum public.app_role doesn't contain 'hr' or 'hr_head' yet, fallback to 'staff' membership so creation succeeds!
                if (memberError && memberError.message.includes('enum app_role')) {
                    console.warn(`Role "${role}" not found in app_role enum, falling back to "staff" in organization_memberships`);
                    const fallback = await adminClient
                        .from('organization_memberships')
                        .insert({ organization_id, user_id: userData.user.id, role: 'staff' });
                    memberError = fallback.error;
                }

                if (memberError) {
                    await adminClient.auth.admin.deleteUser(userData.user.id)
                    return NextResponse.json(
                        { error: `User created but membership failed — rolled back. Reason: ${memberError.message}` },
                        { status: 500 }
                    )
                }
            }
        }


        // For ops_super_admin, automatically assign ALL properties in the organization
        if (role === 'ops_super_admin' && organization_id) {
            const { data: orgProps } = await adminClient
                .from('properties')
                .select('id')
                .eq('organization_id', organization_id);

            if (orgProps && orgProps.length > 0) {
                const propMembershipsToInsert = orgProps.map(p => ({
                    property_id: p.id,
                    organization_id,
                    user_id: userData.user.id,
                    role: 'ops_super_admin',
                    is_active: true,
                }));
                const { error: opsPropErr } = await adminClient
                    .from('property_memberships')
                    .upsert(propMembershipsToInsert, { onConflict: 'user_id,property_id' });

                if (opsPropErr) {
                    console.error('Failed to assign all properties to ops_super_admin:', opsPropErr);
                }
            }
        }
        
        // Always assign property membership if provided (even for procurement/org admins, unless ops_super_admin already assigned all)
        if (property_id && role !== 'ops_super_admin') {
            const { error: propMemberError } = await adminClient
                .from('property_memberships')
                .insert({
                    property_id,
                    organization_id: organization_id || null,
                    user_id: userData.user.id,
                    role,
                    is_active: true,
                })
            if (propMemberError) {
                // If it's not a procurement user (who already has org membership), delete the user on error
                if (!IS_ORG_WIDE_ROLE) {
                    await adminClient.auth.admin.deleteUser(userData.user.id)
                }
                return NextResponse.json(
                    { error: `User created but property membership failed. Reason: ${propMemberError.message}` },
                    { status: 500 }
                )
            }
        }

        // Assign Specialization/Skill if provided (for Staff/MST)
        const { specialization, skills = [] } = body;

        // If 'skills' is provided (new multiple checkbox way), use it.
        // If only 'specialization' is provided (old way), wrap it in skills.
        const effectiveSkills = skills.length > 0 ? skills : (specialization ? [specialization] : []);

        if ((role === 'staff' || role === 'mst') && effectiveSkills.length > 0) {
            // 1. Insert into mst_skills (simple mapping)
            for (const skillCode of effectiveSkills) {
                const { error: skillError } = await adminClient
                    .from('mst_skills')
                    .insert({
                        user_id: userData.user.id,
                        skill_code: skillCode
                    });

                if (skillError && !skillError.message.toLowerCase().includes('duplicate key')) {
                    console.error('Skill assignment error:', skillError);
                }
            }

            // 2. Insert into resolver_stats if we have a property_id
            if (property_id) {
                // Strict Filter based on User Request:
                // MST -> technical, plumbing, vendor
                // Staff -> soft_services
                const VALID_MST_SKILLS = ['technical', 'plumbing', 'vendor'];
                const VALID_STAFF_SKILLS = ['soft_services', 'technical'];

                const skillsForResolver = role === 'mst'
                    ? effectiveSkills.filter((s: string) => VALID_MST_SKILLS.includes(s))
                    : (role === 'staff' ? effectiveSkills.filter((s: string) => VALID_STAFF_SKILLS.includes(s)) : []);

                if (skillsForResolver.length > 0) {
                    const { data: skillGroups } = await adminClient
                        .from('skill_groups')
                        .select('id, code')
                        .eq('is_active', true)
                        .in('code', skillsForResolver);

                    if (skillGroups && skillGroups.length > 0) {
                        const statsToInsert = skillGroups.map(sg => ({
                            user_id: userData.user.id,
                            property_id,
                            skill_group_id: sg.id,
                            current_floor: 1,
                            avg_resolution_minutes: 60,
                            total_resolved: 0,
                            is_available: true
                        }));

                        const { error: statsError } = await adminClient
                            .from('resolver_stats')
                            .insert(statsToInsert);

                        if (statsError && !statsError.message.toLowerCase().includes('duplicate key')) {
                            console.error('Failed to insert resolver stats:', statsError);
                        }
                    }
                }
            }
        }

        // Update user record: set phone, mark onboarding_completed, and auto-approve since created by an authorized admin
        const { phone } = body;
        const userProfileUpdates: any = {
            onboarding_completed: true,
            is_approved: true,
            approval_status: 'approved',
            approved_by: currentUser.id,
            approved_at: new Date().toISOString()
        };
        if (phone) userProfileUpdates.phone = phone;

        await adminClient
            .from('users')
            .update(userProfileUpdates)
            .eq('id', userData.user.id);

        // For internal employee/HR roles, ensure employee_profiles record exists
        if (['hr', 'hr_head', 'staff', 'property_admin', 'org_super_admin'].includes(role)) {
            const nameParts = full_name.split(' ');
            const firstName = nameParts[0] || 'Employee';
            const lastName = nameParts.slice(1).join(' ') || '';
            const ecode = `E${Math.floor(100 + Math.random() * 900)}`;

            try {
                await adminClient
                    .from('employee_profiles')
                    .upsert({
                        organization_id: organization_id || null,
                        property_id: property_id || null,
                        user_id: userData.user.id,
                        employee_code: ecode,
                        first_name: firstName,
                        last_name: lastName,
                        full_name,
                        email,
                        contact_number: phone || null,
                        department: role.includes('hr') ? 'Human Resources' : 'Operations',
                        designation: role === 'hr_head' ? 'HR Head' : (role === 'hr' ? 'HR Executive' : 'Executive'),
                        is_hr_authority: role === 'hr' || role === 'hr_head',
                        reconciliation_status: 'linked',
                        is_active: true
                    }, { onConflict: 'organization_id,employee_code' });
            } catch {
                /* ignore duplicate */
            }
        }

        // Send welcome WhatsApp message to new user (best-effort, non-blocking)
        const welcomePhone = phone || null;
        if (welcomePhone) {
            try {
                WhatsAppService.send(welcomePhone, {
                    message: buildWelcomeMessage(full_name),
                });
            } catch {
                // Never block user creation if WhatsApp fails
            }
        }

        return NextResponse.json({
            success: true,
            message: `User ${email} created successfully. ${!password ? 'A password reset email should be sent to the user.' : ''}`,
            user: {
                id: userData.user.id,
                email: userData.user.email,
                full_name,
                role: createMasterAdmin ? 'master_admin' : role,
            },
            // Security: Never return passwords in API responses
            // If no password was provided, user should reset via email
            requiresPasswordReset: !password,
        })
    } catch (error) {
        console.error('Create user API error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

/**
 * Generate a secure temporary password
 */
function generateTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
    let password = ''
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return password
}
