import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/frontend/utils/supabase/server'
import { createAdminClient } from '@/frontend/utils/supabase/admin'

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

        if (propertyId) {
            // Check if caller has permission (using regular client)
            // Wait, we can just use the admin client but verify caller has org_admin or prop_admin
            // Actually, an easier way is to just use the regular client to perform the update.
            // If RLS allows it, it succeeds.
            const { error: updateError } = await supabase
                .from('property_memberships')
                .update({ is_active: false })
                .eq('user_id', userId)
                .eq('property_id', propertyId)

            if (updateError) {
                console.error('Failed to remove property membership:', updateError)
                return NextResponse.json({ error: 'Permission denied or update failed' }, { status: 403 })
            }

            // Log action
            await adminClient.from('user_management_audit_logs').insert({
                action: 'remove_property_membership',
                target_user_id: userId,
                admin_user_id: currentUser.id,
                details: { propertyId, reason: 'Removed from User Management dashboard' }
            })

        } else if (orgId) {
            // Remove from org memberships
            const { error: orgUpdateError } = await supabase
                .from('organization_memberships')
                .update({ is_active: false })
                .eq('user_id', userId)
                .eq('organization_id', orgId)

            if (orgUpdateError) {
                console.error('Failed to remove org membership:', orgUpdateError)
                return NextResponse.json({ error: 'Permission denied or update failed' }, { status: 403 })
            }

            // Also deactivate from all properties in this org using admin client
            // because a user might be in properties the caller doesn't have direct access to?
            // Actually, an org admin can manage all properties. Let's just use adminClient for simplicity and safety, 
            // since we already passed the org level RLS check above.
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
