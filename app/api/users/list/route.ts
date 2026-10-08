import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/frontend/utils/supabase/server'
import { createAdminClient } from '@/frontend/utils/supabase/admin'
import { isOrganizationUserManager } from '@/backend/lib/users/managementRoles'

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

        // Resolve property scope before any privileged directory reads.
        let resolvedOrgId = orgId;
        if (propertyId) {
            const { data: property, error } = await adminClient
                .from('properties').select('organization_id').eq('id', propertyId).maybeSingle();
            if (error) throw error;
            if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
            if (orgId && orgId !== property.organization_id) {
                return NextResponse.json({ error: 'Property does not belong to the supplied organization' }, { status: 400 });
            }
            resolvedOrgId = property.organization_id;
        }

        if (!isMasterAdmin) {
            const { data: callerOrgMembership, error: orgPermissionError } = await adminClient
                .from('organization_memberships').select('role')
                .eq('user_id', currentUser.id).eq('organization_id', resolvedOrgId!)
                .eq('is_active', true).maybeSingle();
            if (orgPermissionError) throw orgPermissionError;
            let isPropertyAdmin = false;
            if (propertyId) {
                const { data: callerPropMembership, error: propertyPermissionError } = await adminClient
                    .from('property_memberships').select('role')
                    .eq('user_id', currentUser.id).eq('property_id', propertyId)
                    .eq('is_active', true).maybeSingle();
                if (propertyPermissionError) throw propertyPermissionError;
                isPropertyAdmin = callerPropMembership?.role === 'property_admin';
            }
            if (!isOrganizationUserManager(callerOrgMembership?.role) && !isPropertyAdmin) {
                return NextResponse.json({ error: 'Forbidden. You must administer this organization or property.' }, { status: 403 });
            }
        }

        function approvalState(item: { is_active?: boolean; approval_status?: string | null; user?: { is_approved?: boolean; approval_status?: string | null } }) {
            if (item.is_active === true) return { is_approved: true, approval_status: 'approved' };
            const status = item.approval_status || item.user?.approval_status ||
                (item.user?.is_approved === false ? 'pending' : 'approved');
            return { is_approved: status === 'approved', approval_status: status };
        }

        // Helper function to attach employee profiles to user records
        async function attachEmployeeProfiles(usersList: any[]) {
            if (!usersList || usersList.length === 0) return;
            const { data: empProfiles } = await adminClient
                .from('employee_profiles')
                .select('user_id, email, designation, employee_code, department, phone')
                .eq('organization_id', resolvedOrgId!);

            if (empProfiles && empProfiles.length > 0) {
                const empByUserId = new Map(empProfiles.filter((ep: any) => ep.user_id).map((ep: any) => [ep.user_id, ep]));
                const empByEmail = new Map(empProfiles.filter((ep: any) => ep.email).map((ep: any) => [ep.email.toLowerCase(), ep]));

                usersList.forEach((u: any) => {
                    const ep = empByUserId.get(u.id) || (u.email ? empByEmail.get(u.email.toLowerCase()) : null);
                    if (ep) {
                        u.designation = u.designation || ep.designation || null;
                        u.employee_code = u.employee_code || ep.employee_code || null;
                        u.department = u.department || ep.department || null;
                        if (!u.phone && ep.phone) {
                            u.phone = ep.phone;
                        }
                    }
                });
            }
        }

        // Explicit user_id embeds select the member, not audit fields such as updated_by.
        // Fetch users using admin client (bypasses RLS)
        if (propertyId) {
            const { data, error } = await adminClient
                .from('property_memberships')
                .select(`
                    role,
                    custom_designation,
                    is_active,
                    approval_status,
                    created_at,
                    property:properties (id, name, organization_id),
                    user:users!user_id (*)
                `)
                .eq('property_id', propertyId);

            if (error) throw error;

            // Filter out soft-deleted users:
            const isVisibleMembership = (item: any) => {
                if (!item?.user) return false;
                if (item.user.deleted_at) return false;
                if (item.is_active === true) return true;
                const isPendingApproval = ['pending', 'pending_approval'].includes(approvalState(item).approval_status);
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
                    designation: item.custom_designation || null,
                    propertyName: item.property?.name,
                    propertyId: item.property?.id,
                    organizationId: item.property?.organization_id,
                    is_active: item.is_active,
                    joined_at: item.created_at,
                    ...approvalState(item),
                    approved_by: item.user?.approved_by || null,
                    approved_at: item.user?.approved_at || null,
                    rejection_reason: item.user?.rejection_reason || null,
                    approverName: null as string | null
                })).sort((a: any, b: any) => a.full_name.localeCompare(b.full_name));

            // Attach org roles if available
            const userIds = users.map((u: any) => u.id).filter(Boolean);
            if (userIds.length > 0) {
                const { data: orgM } = await adminClient
                    .from('organization_memberships')
                    .select('user_id, role')
                    .in('user_id', userIds)
                    .eq('organization_id', resolvedOrgId!)
                    .eq('is_active', true);
                if (orgM && orgM.length > 0) {
                    const orgMap = new Map(orgM.map((m: any) => [m.user_id, m.role]));
                    users.forEach((u: any) => {
                        if (orgMap.has(u.id)) {
                            u.orgRole = orgMap.get(u.id);
                        }
                    });
                }
            }

            // Attach employee profile details (designation, employee_code, department, phone)
            await attachEmployeeProfiles(users);

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

            return NextResponse.json({ users, organizationId: resolvedOrgId });
        }

        // Org-level: fetch both org memberships and property memberships
        const { data: orgUsers, error: orgError } = await adminClient
            .from('organization_memberships')
            .select(`
                role,
                is_active,
                approval_status,
                created_at,
                user:users!user_id (*)
            `)
            .eq('organization_id', orgId!);

        if (orgError) throw orgError;

        const { data: propUsers, error: propError } = await adminClient
            .from('property_memberships')
            .select(`
                role,
                custom_designation,
                is_active,
                approval_status,
                created_at,
                property:properties!inner (id, name, organization_id),
                user:users!user_id (*)
            `)
            .eq('property.organization_id', orgId!);

        if (propError) throw propError;

        const userMap = new Map<string, any>();

        const isVisibleMembership = (item: any) => {
            if (!item?.user) return false;
            if (item.user.deleted_at) return false;
            if (item.is_active === true) return true;
            const isPendingApproval = ['pending', 'pending_approval'].includes(approvalState(item).approval_status);
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
                ...approvalState(item),
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
                const memberApproval = approvalState(item);
                if (['pending', 'pending_approval'].includes(memberApproval.approval_status)) {
                    Object.assign(existing, memberApproval);
                }
                existing.propertyRole = item.role;
                existing.propertyName = item.property?.name;
                existing.propertyId = item.property?.id;
                if (item.custom_designation) existing.designation = item.custom_designation;
            } else {
                userMap.set(item.user.id, {
                    id: item.user.id,
                    full_name: item.user.full_name || '',
                    email: item.user.email || '',
                    user_photo_url: item.user.user_photo_url,
                    phone: item.user.phone,
                    propertyRole: item.role,
                    designation: item.custom_designation || null,
                    propertyName: item.property?.name,
                    propertyId: item.property?.id,
                    organizationId: orgId,
                    is_active: item.is_active,
                    joined_at: item.created_at,
                    ...approvalState(item),
                    approved_by: item.user.approved_by || null,
                    approved_at: item.user.approved_at || null,
                    rejection_reason: item.user.rejection_reason || null,
                    approverName: null as string | null
                });
            }
        });

        const users = Array.from(userMap.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));

        // Attach designation, employee_code, department, and phone from employee_profiles
        await attachEmployeeProfiles(users);

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
