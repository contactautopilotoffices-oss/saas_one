import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { NotificationService } from '@/backend/services/NotificationService';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, action = 'approve', reason, propertyId, role } = body;

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

        const adminClient = createAdminClient();

        // 2. Check caller permissions
        const { data: callerProfile } = await adminClient
            .from('users')
            .select('is_master_admin, full_name')
            .eq('id', currentUser.id)
            .single();

        const isMasterAdmin = !!callerProfile?.is_master_admin;

        // Fetch target user memberships to know target org and property
        const { data: targetPropMemb } = await adminClient
            .from('property_memberships')
            .select('property_id, organization_id, role')
            .eq('user_id', userId)
            .maybeSingle();

        const { data: targetOrgMemb } = await adminClient
            .from('organization_memberships')
            .select('organization_id, role')
            .eq('user_id', userId)
            .maybeSingle();

        let targetOrgId = targetPropMemb?.organization_id || targetOrgMemb?.organization_id || null;
        const targetPropId = propertyId || targetPropMemb?.property_id || null;

        // If organization_id is not directly on property_membership, resolve it from properties table
        if (!targetOrgId && targetPropId) {
            const { data: propRow } = await adminClient
                .from('properties')
                .select('organization_id')
                .eq('id', targetPropId)
                .maybeSingle();
            if (propRow?.organization_id) {
                targetOrgId = propRow.organization_id;
            }
        }

        if (!isMasterAdmin) {
            let isAuthorized = false;

            // Fetch caller's organization memberships
            const { data: callerOrgMembs } = await adminClient
                .from('organization_memberships')
                .select('organization_id, role')
                .eq('user_id', currentUser.id)
                .eq('is_active', true);

            const callerSuperOrgIds = (callerOrgMembs || [])
                .filter(m => ['org_super_admin', 'admin', 'owner', 'bd_super_admin'].includes(m.role))
                .map(m => m.organization_id);

            // Check if caller is Org Super Admin for the target org or if target belongs to caller's org
            if (callerSuperOrgIds.length > 0) {
                if (!targetOrgId || callerSuperOrgIds.includes(targetOrgId)) {
                    isAuthorized = true;
                }
            }

            // Check if Property Admin for the user's property
            if (!isAuthorized && targetPropId) {
                const { data: propMemb } = await adminClient
                    .from('property_memberships')
                    .select('role')
                    .eq('user_id', currentUser.id)
                    .eq('property_id', targetPropId)
                    .eq('is_active', true)
                    .maybeSingle();

                if (propMemb && propMemb.role === 'property_admin') {
                    isAuthorized = true;
                }
            }

            if (!isAuthorized) {
                return NextResponse.json({
                    error: 'Forbidden. You do not have administrative permission to approve users for this workspace.'
                }, { status: 403 });
            }
        }

        // 3. Perform approval / rejection update
        const now = new Date().toISOString();

        if (action === 'approve') {
            // Update users table
            const { error: userUpdateErr } = await adminClient
                .from('users')
                .update({
                    is_approved: true,
                    approval_status: 'approved',
                    approved_by: currentUser.id,
                    approved_at: now,
                    rejection_reason: null
                })
                .eq('id', userId);

            if (userUpdateErr) {
                console.error('[Approve API] Failed to update user:', userUpdateErr);
                throw userUpdateErr;
            }

            // Activate all property memberships for this user
            const propUpdate: any = { is_active: true };
            if (role && targetPropId) propUpdate.role = role;

            await adminClient
                .from('property_memberships')
                .update(propUpdate)
                .eq('user_id', userId);

            // Activate org membership if exists
            await adminClient
                .from('organization_memberships')
                .update({ is_active: true })
                .eq('user_id', userId);

            // 4. Send Omnichannel notification to the approved user (non-blocking)
            NotificationService.afterUserApproved({
                userId,
                approverId: currentUser.id,
                propertyId: targetPropId || undefined,
                organizationId: targetOrgId || undefined,
            }).catch(err => console.error('[Approve API] Notification error:', err));

            return NextResponse.json({
                success: true,
                message: 'User approved successfully',
                approvedBy: callerProfile?.full_name || 'Admin',
                approvedAt: now
            });

        } else {
            // Rejection flow
            const { error: userUpdateErr } = await adminClient
                .from('users')
                .update({
                    is_approved: false,
                    approval_status: 'rejected',
                    approved_by: currentUser.id,
                    approved_at: now,
                    rejection_reason: reason || 'Application rejected by administrator'
                })
                .eq('id', userId);

            if (userUpdateErr) {
                console.error('[Reject API] Failed to update user:', userUpdateErr);
                throw userUpdateErr;
            }

            // Deactivate memberships
            if (targetPropId) {
                await adminClient
                    .from('property_memberships')
                    .update({ is_active: false })
                    .eq('user_id', userId)
                    .eq('property_id', targetPropId);
            }

            if (targetOrgId) {
                await adminClient
                    .from('organization_memberships')
                    .update({ is_active: false })
                    .eq('user_id', userId)
                    .eq('organization_id', targetOrgId);
            }

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
