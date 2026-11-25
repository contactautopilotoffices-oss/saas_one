import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/frontend/utils/supabase/server'
import { createAdminClient } from '@/frontend/utils/supabase/admin'
import { isOrganizationUserManager } from '@/backend/lib/users/managementRoles'

export async function POST(request: NextRequest) {
    try {
        const { userId, orgId, propertyId } = await request.json()

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
        }
        if (!orgId && !propertyId) {
            return NextResponse.json({ error: 'Must provide orgId or propertyId' }, { status: 400 })
        }

        const supabase = await createClient()
        const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()

        if (authError || !currentUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const adminClient = createAdminClient()

        // Verify caller permissions
        const { data: callerUser } = await adminClient
            .from('users')
            .select('is_master_admin')
            .eq('id', currentUser.id)
            .single()

        const isMasterAdmin = !!callerUser?.is_master_admin

        if (propertyId) {
            // Verify permission: master admin, org manager, or property admin
            if (!isMasterAdmin) {
                const { data: propData } = await adminClient
                    .from('properties')
                    .select('organization_id')
                    .eq('id', propertyId)
                    .maybeSingle()

                const { data: callerPropMembership } = await adminClient
                    .from('property_memberships')
                    .select('role')
                    .eq('user_id', currentUser.id)
                    .eq('property_id', propertyId)
                    .eq('is_active', true)
                    .maybeSingle()

                const { data: callerOrgMembership } = propData?.organization_id
                    ? await adminClient
                        .from('organization_memberships')
                        .select('role')
                        .eq('user_id', currentUser.id)
                        .eq('organization_id', propData.organization_id)
                        .eq('is_active', true)
                        .maybeSingle()
                    : { data: null }

                const isPropAdmin = callerPropMembership?.role === 'property_admin'
                const isOrgAdmin = isOrganizationUserManager(callerOrgMembership?.role)

                if (!isPropAdmin && !isOrgAdmin) {
                    return NextResponse.json({ error: 'Forbidden. You do not have permission to manage this property.' }, { status: 403 })
                }
            }

            const { error: updateError } = await adminClient
                .from('property_memberships')
                .update({ is_active: false })
                .eq('user_id', userId)
                .eq('property_id', propertyId)

            if (updateError) {
                console.error('Failed to remove property membership:', updateError)
                return NextResponse.json({ error: 'Update failed' }, { status: 500 })
            }

            // Log action
            await adminClient.from('user_management_audit_logs').insert({
                action: 'remove_property_membership',
                target_user_id: userId,
                admin_user_id: currentUser.id,
                details: { propertyId, reason: 'Removed from User Management dashboard' }
            })

        } else if (orgId) {
            // Verify permission: master admin or org manager
            if (!isMasterAdmin) {
                const { data: callerOrgMembership } = await adminClient
                    .from('organization_memberships')
                    .select('role')
                    .eq('user_id', currentUser.id)
                    .eq('organization_id', orgId)
                    .eq('is_active', true)
                    .maybeSingle()

                if (!isOrganizationUserManager(callerOrgMembership?.role)) {
                    return NextResponse.json({ error: 'Forbidden. You do not have permission to manage this organization.' }, { status: 403 })
                }
            }

            // Remove from org memberships using adminClient
            const { error: orgUpdateError } = await adminClient
                .from('organization_memberships')
                .update({ is_active: false })
                .eq('user_id', userId)
                .eq('organization_id', orgId)

            if (orgUpdateError) {
                console.error('Failed to remove org membership:', orgUpdateError)
                return NextResponse.json({ error: 'Update failed' }, { status: 500 })
            }

            // Also deactivate from all properties in this org using admin client
            const { data: props } = await adminClient
                .from('properties')
                .select('id')
                .eq('organization_id', orgId)

            if (props && props.length > 0) {
                const propIds = props.map(p => p.id)
                await adminClient
                    .from('property_memberships')
                    .update({ is_active: false })
                    .eq('user_id', userId)
                    .in('property_id', propIds)
            }

            // Log action
            await adminClient.from('user_management_audit_logs').insert({
                action: 'remove_org_membership',
                target_user_id: userId,
                admin_user_id: currentUser.id,
                details: { orgId, reason: 'Removed from User Management dashboard' }
            })
        }

        return NextResponse.json({ success: true, message: 'Membership removed successfully' })
    } catch (error: any) {
        console.error('Remove membership API error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
