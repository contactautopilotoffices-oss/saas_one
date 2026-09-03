import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/frontend/utils/supabase/server'
import { createAdminClient } from '@/frontend/utils/supabase/admin'

/**
 * GET /api/users/list?orgId=xxx&propertyId=yyy
 *
 * Fetch all users for an organization or property.
 * Uses admin client to bypass RLS so org_super_admins can see all users.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const orgId = searchParams.get('orgId')
        const propertyId = searchParams.get('propertyId')

        if (!orgId && !propertyId) {
            return NextResponse.json(
                { error: 'Missing required parameter: orgId or propertyId' },
                { status: 400 }
            )
        }

        // Verify the caller is authenticated
        const supabase = await createClient()
        const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser()

        if (authError || !currentUser) {
            return NextResponse.json(
                { error: 'Unauthorized. Please log in.' },
                { status: 401 }
            )
        }

        // Verify caller has permission (must be org_super_admin, property_admin, or master_admin)
        const adminClient = createAdminClient()

        const { data: callerUser } = await adminClient
            .from('users')
            .select('is_master_admin')
            .eq('id', currentUser.id)
            .single()

        const isMasterAdmin = !!callerUser?.is_master_admin

        if (!isMasterAdmin && orgId) {
            const { data: callerOrgMembership } = await adminClient
                .from('organization_memberships')
                .select('role')
                .eq('user_id', currentUser.id)
                .eq('organization_id', orgId)
                .eq('is_active', true)
                .maybeSingle()

            const { data: callerPropMembership } = await adminClient
                .from('property_memberships')
                .select('role')
                .eq('user_id', currentUser.id)
                .eq('is_active', true)

            const isOrgAdmin = callerOrgMembership && ['org_super_admin', 'admin', 'owner'].includes(callerOrgMembership.role)
            const isPropAdmin = callerPropMembership?.some((m: any) => m.role === 'property_admin')

            if (!isOrgAdmin && !isPropAdmin) {
                return NextResponse.json(
                    { error: 'Forbidden. You must be an org admin or property admin.' },
                    { status: 403 }
                )
            }
        }

        // Fetch users using admin client (bypasses RLS)
        if (propertyId) {
            // First get the orgId for this property
            const { data: propertyData } = await adminClient
                .from('properties')
                .select('organization_id')
                .eq('id', propertyId)
                .single();

            const { data, error } = await adminClient
                .from('property_memberships')
                .select(`
                    role,
                    is_active,
                    created_at,
                    property:properties (id, name, organization_id),
                    user:users (*)
                `)
                .eq('property_id', propertyId);

            if (error) throw error;

            // Filter out soft-deleted users:
            // An item is visible if:
            // 1. User has not been soft-deleted (deleted_at is null)
            // 2. AND (is_active is true OR user is a new signup genuinely awaiting onboarding approval)
            const isVisibleMembership = (item: any) => {
                if (!item?.user) return false;
                if (item.user.deleted_at) return false;
                if (item.is_active === true) return true;
                const isPendingApproval = (item.user.is_approved === false || item.user.approval_status === 'pending') && item.user.approval_status !== 'rejected';
                return isPendingApproval;
            };

            const users = (data || [])
                .filter(isVisibleMembership)
                .map((item: any) => ({
                    id: item.user?.id,
                    full_name: item.user?.full_name || '',
                    email: item.user?.email || '',
                    user_photo_url: item.user?.user_photo_url,
                    phone: item.user?.phone,
                    propertyRole: item.role,
                    propertyName: item.property?.name,
                    propertyId: item.property?.id,
                    organizationId: item.property?.organization_id,
                    is_active: item.is_active,
                    joined_at: item.created_at,
                    is_approved: item.user?.is_approved ?? true,
                    approval_status: item.user?.approval_status || (item.user?.is_approved === false ? 'pending' : 'approved'),
                    approved_by: item.user?.approved_by || null,
                    approved_at: item.user?.approved_at || null,
                    rejection_reason: item.user?.rejection_reason || null,
                    approverName: null as string | null
                })).sort((a: any, b: any) => a.full_name.localeCompare(b.full_name));

            // Resolve approver names if any approved_by IDs exist
            const approverIds = Array.from(new Set(users.map((u: any) => u.approved_by).filter(Boolean)));
            if (approverIds.length > 0) {
                const { data: approvers } = await adminClient
                    .from('users')
                    .select('id, full_name')
                    .in('id', approverIds);
                const approverMap = new Map((approvers || []).map((a: any) => [a.id, a.full_name]));
                users.forEach((u: any) => {
                    if (u.approved_by) {
                        u.approverName = approverMap.get(u.approved_by) || 'Admin';
                    }
                });
            }

            return NextResponse.json({ users, organizationId: propertyData?.organization_id });
        }

        // Org-level: fetch both org memberships and property memberships
        const { data: orgUsers, error: orgError } = await adminClient
            .from('organization_memberships')
            .select(`
                role,
                is_active,
                created_at,
                user:users (*)
            `)
            .eq('organization_id', orgId!);

        if (orgError) throw orgError;

        const { data: propUsers, error: propError } = await adminClient
            .from('property_memberships')
            .select(`
                role,
                is_active,
                created_at,
                property:properties!inner (id, name, organization_id),
                user:users (*)
            `)
            .eq('properties.organization_id', orgId!);

        if (propError) throw propError;

        const userMap = new Map<string, any>();

        const isVisibleMembership = (item: any) => {
            if (!item?.user) return false;
            if (item.user.deleted_at) return false;
            if (item.is_active === true) return true;
            const isPendingApproval = (item.user.is_approved === false || item.user.approval_status === 'pending') && item.user.approval_status !== 'rejected';
            return isPendingApproval;
        };

        orgUsers?.filter(isVisibleMembership).forEach((item: any) => {
            if (!item.user) return;
            userMap.set(item.user.id, {
                id: item.user.id,
                full_name: item.user.full_name || '',
                email: item.user.email || '',
                user_photo_url: item.user.user_photo_url,
                phone: item.user.phone,
                orgRole: item.role,
                organizationId: orgId,
                is_active: item.is_active,
                joined_at: item.created_at,
                is_approved: item.user.is_approved ?? true,
                approval_status: item.user.approval_status || (item.user.is_approved === false ? 'pending' : 'approved'),
                approved_by: item.user.approved_by || null,
                approved_at: item.user.approved_at || null,
                rejection_reason: item.user.rejection_reason || null,
                approverName: null as string | null
            });
        });

        propUsers?.filter(isVisibleMembership).forEach((item: any) => {
            if (!item.user) return;
            const existing = userMap.get(item.user.id);
            if (existing) {
                existing.propertyRole = item.role;
                existing.propertyName = item.property?.name;
                existing.propertyId = item.property?.id;
            } else {
                userMap.set(item.user.id, {
                    id: item.user.id,
                    full_name: item.user.full_name || '',
                    email: item.user.email || '',
                    user_photo_url: item.user.user_photo_url,
                    phone: item.user.phone,
                    propertyRole: item.role,
                    propertyName: item.property?.name,
                    propertyId: item.property?.id,
                    organizationId: orgId,
                    is_active: item.is_active,
                    joined_at: item.created_at,
                    is_approved: item.user.is_approved ?? true,
                    approval_status: item.user.approval_status || (item.user.is_approved === false ? 'pending' : 'approved'),
                    approved_by: item.user.approved_by || null,
                    approved_at: item.user.approved_at || null,
                    rejection_reason: item.user.rejection_reason || null,
                    approverName: null as string | null
                });
            }
        });

        const users = Array.from(userMap.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));

        // Resolve approver names
        const approverIds = Array.from(new Set(users.map((u: any) => u.approved_by).filter(Boolean)));
        if (approverIds.length > 0) {
            const { data: approvers } = await adminClient
                .from('users')
                .select('id, full_name')
                .in('id', approverIds);
            const approverMap = new Map((approvers || []).map((a: any) => [a.id, a.full_name]));
            users.forEach((u: any) => {
                if (u.approved_by) {
                    u.approverName = approverMap.get(u.approved_by) || 'Admin';
                }
            });
        }

        return NextResponse.json({ users });
    } catch (error: any) {
        console.error('Users list API error:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
