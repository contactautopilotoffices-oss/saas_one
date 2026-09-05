import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';

const AUTOPILOT_ORG_ID = process.env.NEXT_PUBLIC_AUTOPILOT_ORG_ID;

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

        if (authError || !authUser) {
            return NextResponse.json({ error: 'Unauthorized. Please sign in again.' }, { status: 401 });
        }

        const body = await request.json();
        const {
            selectedPropertyId,
            selectedRole,
            selectedSkills = [],
            phoneNumber,
            userName
        } = body;

        if (!selectedRole) {
            return NextResponse.json({ error: 'Role is required' }, { status: 400 });
        }

        // Restrict high-privilege roles from self-signup
        if (selectedRole === 'org_super_admin' || selectedRole === 'master_admin') {
            return NextResponse.json({
                error: 'Unauthorized role. Org Super Admins and Master Admins cannot self-register.'
            }, { status: 403 });
        }

        const adminClient = createAdminClient();

        // 1. Resolve Property and Organization IDs
        let finalPropId = selectedPropertyId;
        let targetOrgId = AUTOPILOT_ORG_ID;

        if (!finalPropId || finalPropId === 'default') {
            const { data: realProp } = await adminClient
                .from('properties')
                .select('id, organization_id')
                .limit(1)
                .maybeSingle();

            if (realProp) {
                finalPropId = realProp.id;
                targetOrgId = realProp.organization_id || targetOrgId;
            } else {
                return NextResponse.json({ error: 'No properties found in workspace.' }, { status: 400 });
            }
        } else {
            const { data: propData } = await adminClient
                .from('properties')
                .select('organization_id')
                .eq('id', finalPropId)
                .maybeSingle();

            if (propData?.organization_id) {
                targetOrgId = propData.organization_id;
            }
        }

        if (!targetOrgId || targetOrgId === 'undefined') {
            const { data: org } = await adminClient
                .from('organizations')
                .select('id')
                .or('code.eq.autopilot,name.ilike.%autopilot%')
                .limit(1)
                .maybeSingle();
            if (org) targetOrgId = org.id;
        }

        // 2. Determine final role
        const finalRole = (selectedRole === 'staff' && selectedSkills.includes('soft_service_manager'))
            ? 'soft_service_manager'
            : selectedRole;

        // 3. Upsert Property Membership (pending approval, is_active: false)
        const { error: propMembErr } = await adminClient
            .from('property_memberships')
            .upsert({
                user_id: authUser.id,
                organization_id: targetOrgId,
                property_id: finalPropId,
                role: finalRole as any,
                is_active: false // Held until administrator approves
            }, { onConflict: 'user_id,property_id' });

        if (propMembErr && !propMembErr.message.toLowerCase().includes('duplicate key')) {
            console.error('[Onboarding Complete] property_memberships insert failed:', propMembErr);
            return NextResponse.json({ error: propMembErr.message }, { status: 500 });
        }

        // 4. Role-specific organization memberships
        if (selectedRole === 'procurement') {
            await adminClient
                .from('organization_memberships')
                .upsert({
                    user_id: authUser.id,
                    organization_id: targetOrgId,
                    role: 'procurement',
                    is_active: false
                }, { onConflict: 'user_id,organization_id' });
        }

        if (selectedRole === 'bd_rep' || selectedRole === 'bd_admin') {
            await adminClient
                .from('organization_memberships')
                .upsert({
                    user_id: authUser.id,
                    organization_id: targetOrgId,
                    role: selectedRole,
                    is_active: false
                }, { onConflict: 'user_id,organization_id' });
        }

        // 5. Vendor creation
        if (selectedRole === 'vendor') {
            const { data: dbUser } = await adminClient
                .from('users')
                .select('full_name')
                .eq('id', authUser.id)
                .maybeSingle();

            await adminClient
                .from('vendors')
                .upsert({
                    user_id: authUser.id,
                    property_id: finalPropId,
                    shop_name: `${userName || 'Vendor'}'s Shop`,
                    vendor_name: dbUser?.full_name || userName || 'Vendor',
                    commission_rate: 10,
                    status: 'pending'
                }, { onConflict: 'user_id,property_id' });
        }

        // 6. MST Skills & Resolver Stats
        if (Array.isArray(selectedSkills) && selectedSkills.length > 0) {
            const skillsToInsert = selectedSkills.map((code: string) => ({
                user_id: authUser.id,
                skill_code: code
            }));

            await adminClient
                .from('mst_skills')
                .upsert(skillsToInsert, { onConflict: 'user_id,skill_code' });

            const VALID_MST_SKILLS = ['technical', 'plumbing', 'vendor'];
            const VALID_STAFF_SKILLS = ['soft_services'];
            const skillsForResolver = selectedRole === 'mst'
                ? selectedSkills.filter((s: string) => VALID_MST_SKILLS.includes(s))
                : (selectedRole === 'staff' ? selectedSkills.filter((s: string) => VALID_STAFF_SKILLS.includes(s)) : []);

            if (skillsForResolver.length > 0) {
                const { data: skillGroups } = await adminClient
                    .from('skill_groups')
                    .select('id, code')
                    .eq('is_active', true)
                    .in('code', skillsForResolver);

                if (skillGroups && skillGroups.length > 0) {
                    const statsToInsert = skillGroups.map(sg => ({
                        user_id: authUser.id,
                        property_id: finalPropId,
                        skill_group_id: sg.id,
                        current_floor: 1,
                        avg_resolution_minutes: 60,
                        total_resolved: 0,
                        is_available: true
                    }));

                    await adminClient
                        .from('resolver_stats')
                        .upsert(statsToInsert, { onConflict: 'user_id,property_id,skill_group_id' });
                }
            }
        }

        // 7. Update User profile with pending approval and phone
        const nameFromMeta = authUser.user_metadata?.full_name || authUser.user_metadata?.name;
        const profileUpdate: any = {
            onboarding_completed: true,
            is_approved: false,
            approval_status: 'pending',
            ...(nameFromMeta || userName ? { full_name: userName || nameFromMeta } : {})
        };

        if (phoneNumber && typeof phoneNumber === 'string' && phoneNumber.trim().length >= 10) {
            profileUpdate.phone = phoneNumber.trim();
        }

        await adminClient
            .from('users')
            .update(profileUpdate)
            .eq('id', authUser.id);

        // Sync metadata
        await supabase.auth.updateUser({
            data: { onboarding_completed: true }
        });

        // 8. Trigger Omnichannel Notifications (WhatsApp, Email, Push) to Admins
        try {
            await NotificationService.afterUserRegisteredPendingApproval({
                userId: authUser.id,
                propertyId: finalPropId,
                organizationId: targetOrgId,
                requestedRole: finalRole
            });
        } catch (notifErr) {
            console.error('[Onboarding Complete] Notification trigger failed:', notifErr);
        }

        return NextResponse.json({
            success: true,
            redirectUrl: '/waiting-approval',
            message: 'Onboarding completed. Awaiting administrator approval.'
        });

    } catch (error: any) {
        console.error('[Onboarding Complete API Error]:', error);
        return NextResponse.json({
            error: error.message || 'Failed to complete onboarding'
        }, { status: 500 });
    }
}
