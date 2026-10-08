import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { isOrganizationUserApprover, isOrganizationWideUserRole } from '@/backend/lib/users/managementRoles';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, action = 'approve', reason, propertyId, organizationId, role } = body;

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
        }

        if (action !== 'approve' && action !== 'reject') {
            return NextResponse.json({ error: 'Action must be "approve" or "reject"' }, { status: 400 });
        }

        // 1. Verify caller authentication
        const supabase = await createClient();
        const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser();

        if (authError || !currentUser) {
            return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
        }

        const actorId = currentUser.id;
        const adminClient = createAdminClient();

        // 2. Check caller permissions
        const { data: callerProfile } = await adminClient
            .from('users')
            .select('is_master_admin, full_name')
            .eq('id', actorId)
            .single();

        const isMasterAdmin = !!callerProfile?.is_master_admin;

        // Resolve arrays: one profile may have memberships in several workspaces.
        const { data: targetPropMembs, error: targetPropError } = await adminClient
            .from('property_memberships')
            .select('property_id, organization_id, role, is_active, approval_status, property:properties!inner(id, organization_id)')
            .eq('user_id', userId);
        const { data: targetOrgMembs, error: targetOrgError } = await adminClient
            .from('organization_memberships').select('organization_id, role, is_active, approval_status').eq('user_id', userId);
        if (targetPropError) throw targetPropError;
        if (targetOrgError) throw targetOrgError;

        const propertyMemberships = (targetPropMembs || []).map(m => ({
            ...m, organization_id: (Array.isArray(m.property) ? m.property[0] : m.property)?.organization_id || m.organization_id
        }));
        const targetPropertyMembership = propertyId
            ? propertyMemberships.find(m => m.property_id === propertyId) : null;
        if (propertyId && !targetPropertyMembership) {
            return NextResponse.json({ error: 'Target user does not belong to the supplied property' }, { status: 400 });
        }
        const targetOrganizationIds = Array.from(new Set([
            ...propertyMemberships.map(m => m.organization_id),
            ...(targetOrgMembs || []).map(m => m.organization_id)
        ].filter(Boolean)));
        const accountsOrgMemberships = (targetOrgMembs || []).filter(m => m.role === 'accounts');
        const implicitAccountsOrg = !organizationId && !propertyId && accountsOrgMemberships.length === 1 ? accountsOrgMemberships[0].organization_id : null;
        if (!organizationId && !propertyId && !implicitAccountsOrg && targetOrganizationIds.length > 1) {
            return NextResponse.json({ error: 'organizationId is required for a user with multiple organizations' }, { status: 400 });
        }
        const targetOrgId = organizationId || implicitAccountsOrg || targetPropertyMembership?.organization_id || targetOrganizationIds[0];
        if (!targetOrgId || !targetOrganizationIds.includes(targetOrgId) ||
            (targetPropertyMembership && targetPropertyMembership.organization_id !== targetOrgId)) {
            return NextResponse.json({ error: 'Target membership does not match the supplied organization' }, { status: 400 });
        }
        const targetPropId = propertyId || null;
        const scopedPropertyMemberships = propertyMemberships.filter(m =>
            m.organization_id === targetOrgId && (!targetPropId || m.property_id === targetPropId));
        const targetOrgMemb = (targetOrgMembs || []).find(m => m.organization_id === targetOrgId);

        const hasLegacyAccountsRole = scopedPropertyMemberships.some(m => m.role === 'accounts') && (!targetOrgMemb || targetOrgMemb.role === 'staff');
        const targetRole = role || (hasLegacyAccountsRole ? 'accounts' : targetPropertyMembership?.role) || targetOrgMemb?.role || scopedPropertyMemberships[0]?.role;
        const isAccountsApproval = targetRole === 'accounts';
        const isAccountsApplication = targetOrgMemb?.role === 'accounts' || scopedPropertyMemberships.some(m => m.role === 'accounts');

        if (!isMasterAdmin) {
            const { data: callerOrgMemb, error: callerOrgError } = await adminClient
                .from('organization_memberships').select('role')
                .eq('user_id', actorId).eq('organization_id', targetOrgId)
                .eq('is_active', true).maybeSingle();
            if (callerOrgError) throw callerOrgError;
            let isPropertyAdmin = false;
            const propertyRole = role || targetPropertyMembership?.role || '';
            const grantsOrganizationAuthority = isOrganizationWideUserRole(propertyRole) ||
                isOrganizationUserApprover(propertyRole) || ['master_admin', 'org_admin', 'bd_admin'].includes(propertyRole);
            if (targetPropId && !grantsOrganizationAuthority && !isAccountsApproval && !isAccountsApplication) {
                const { data: propMemb, error: callerPropError } = await adminClient
                    .from('property_memberships').select('role')
                    .eq('user_id', actorId).eq('property_id', targetPropId)
                    .eq('is_active', true).maybeSingle();
                if (callerPropError) throw callerPropError;
                isPropertyAdmin = propMemb?.role === 'property_admin';
            }
            if (role === 'master_admin' || (!isOrganizationUserApprover(callerOrgMemb?.role) && !isPropertyAdmin)) {
                return NextResponse.json({ error: 'Forbidden. You do not have administrative permission for this workspace.' }, { status: 403 });
            }
        }

        // Membership writes are limited to existing rows in the resolved scope.
        async function updateMemberships(isActive: boolean) {
            const propertyIds = scopedPropertyMemberships.map(m => m.property_id);
            if (propertyIds.length > 0) {
                const update = {
                    is_active: isActive, approval_status: isActive ? 'approved' : 'rejected',
                    updated_by: actorId, updated_at: new Date().toISOString(),
                    ...(isActive && role && targetPropId ? { role } : {})
                };
                const { error } = await adminClient.from('property_memberships')
                    .update(update).eq('user_id', userId).in('property_id', propertyIds);
                if (error) throw error;
            }
            // A property approval cannot create or activate an organization-wide grant.
            if (!targetPropId && targetOrgMemb) {
                const { error } = await adminClient.from('organization_memberships')
                    .update({
                        is_active: isActive, approval_status: isActive ? 'approved' : 'rejected',
                        updated_by: actorId, updated_at: new Date().toISOString(),
                        ...(isActive && role ? { role } : {})
                    })
                    .eq('user_id', userId).eq('organization_id', targetOrgId);
                if (error) throw error;
            }
        }

        // 3. Perform approval / rejection update
        const now = new Date().toISOString();

        if (action === 'approve') {
            if (isAccountsApproval) {
                // Save organization finance access before marking the applicant approved.
                const { error: orgError } = await adminClient.from('organization_memberships').upsert({
                    organization_id: targetOrgId, user_id: userId, role: 'accounts',
                    is_active: true, approval_status: 'approved', updated_by: actorId, updated_at: now
                }, { onConflict: 'organization_id,user_id' });
                if (orgError) throw orgError;
                const { error: legacyError } = await adminClient.from('property_memberships').delete()
                    .eq('user_id', userId).eq('organization_id', targetOrgId).eq('role', 'accounts');
                if (legacyError) throw legacyError;
            }
            // Update users table
            const { error: userUpdateErr } = await adminClient
                .from('users')
                .update({
                    is_approved: true,
                    approval_status: 'approved',
                    approved_by: actorId,
                    approved_at: now,
                    rejection_reason: null
                })
                .eq('id', userId);

            if (userUpdateErr) {
                console.error('[Approve API] Failed to update user:', userUpdateErr);
                throw userUpdateErr;
            }

            if (!isAccountsApproval) await updateMemberships(true);

            try {
                await adminClient.auth.admin.updateUserById(userId, {
                    user_metadata: {
                        organization_id: targetOrgId,
                        role: targetRole,
                        ...(isAccountsApproval ? { property_id: null, property_role: null } : targetPropId ? { property_id: targetPropId, property_role: targetRole } : {})
                    }
                });
            } catch (metaErr) {
                console.warn('[Approve API] Failed to sync auth user_metadata:', metaErr);
            }

            // Ensure employee_profiles record is linked upon approval for internal roles
            const { data: approvedUserData } = await adminClient
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();

            if (approvedUserData) {
                const appRole = targetRole || 'staff';
                if (['hr', 'hr_head', 'staff', 'property_admin', 'org_super_admin', 'ops_super_admin'].includes(appRole)) {
                    const fullName = approvedUserData.full_name || approvedUserData.raw_user_meta_data?.full_name || approvedUserData.email.split('@')[0];
                    const nameParts = fullName.split(' ');
                    const firstName = nameParts[0] || 'Employee';
                    const lastName = nameParts.slice(1).join(' ') || '';
                    const ecode = `E${Math.floor(100 + Math.random() * 900)}`;

                    try {
                        await adminClient
                            .from('employee_profiles')
                            .upsert({
                                organization_id: targetOrgId,
                                user_id: userId,
                                employee_code: ecode,
                                first_name: firstName,
                                last_name: lastName,
                                full_name: fullName,
                                email: approvedUserData.email,
                                contact_number: approvedUserData.phone || null,
                                department: appRole.includes('hr') ? 'Human Resources' : 'Operations',
                                designation: appRole === 'hr_head' ? 'HR Head' : (appRole === 'hr' ? 'HR Executive' : 'Executive'),
                                is_hr_authority: appRole === 'hr' || appRole === 'hr_head',
                                reconciliation_status: 'linked',
                                is_active: true
                            }, { onConflict: 'organization_id,employee_code' });
                    } catch {
                        /* ignore duplicate */
                    }
                }
            }

            return NextResponse.json({
                success: true,
                message: 'User approved successfully',
                approvedBy: callerProfile?.full_name || 'Admin',
                approvedAt: now
            });

        } else {
            // Shared profile approval must not revoke access granted by another workspace.
            const scopedPropertyIds = new Set(scopedPropertyMemberships.map(m => m.property_id));
            const hasOtherActiveMembership = propertyMemberships.some(m =>
                m.is_active === true && m.organization_id && !scopedPropertyIds.has(m.property_id)) ||
                (targetOrgMembs || []).some(m => m.is_active === true && m.organization_id &&
                    (targetPropId || m.organization_id !== targetOrgId));
            if (!hasOtherActiveMembership) {
                const { error: userUpdateErr } = await adminClient.from('users').update({
                    is_approved: false,
                    approval_status: 'rejected',
                    approved_by: actorId,
                    approved_at: now,
                    rejection_reason: reason || 'Application rejected by administrator'
                }).eq('id', userId);
                if (userUpdateErr) throw userUpdateErr;
            }

            await updateMemberships(false);

            return NextResponse.json({
                success: true,
                message: 'User registration rejected',
                rejectionReason: reason || 'Application rejected by administrator'
            });
        }

    } catch (error: any) {
        console.error('[Approve API] Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to process approval action' }, { status: 500 });
    }
}
