import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { canUserSeePrices } from '@/backend/lib/procurement';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const adminSupabase = createAdminClient();

        // 2. Fetch requests filtered by these properties
        let query = adminSupabase
            .from('material_requests')
            .select(`
                *,
                line_items:material_request_items(*),
                ticket:tickets (
                    id,
                    ticket_number,
                    title,
                    status,
                    priority,
                    created_at,
                    assigned_to,
                    floor_number,
                    assignee:users!tickets_assigned_to_fkey ( full_name )
                ),
                property:properties(id, name),
                requester:users!material_requests_requested_by_fkey(full_name, email),
                assignee:users!material_requests_assignee_uid_fkey(full_name)
            `)
            .order('created_at', { ascending: false });

        const { searchParams } = new URL(request.url);
        const requestedPropertyId = searchParams.get('propertyId');

        // 1. Check organization-level access first (for HO users)
        const { data: orgMemberships } = await adminSupabase
            .from('organization_memberships')
            .select('organization_id, role')
            .eq('user_id', user.id);
            
        const isHO = orgMemberships?.some(m => ['org_super_admin', 'master_admin', 'procurement'].includes(m.role));

        if (isHO) {
            const orgIds = orgMemberships?.map(m => m.organization_id) || [];
            if (requestedPropertyId) {
                // HO can see any property in their org
                query = query.eq('property_id', requestedPropertyId).in('organization_id', orgIds);
            } else {
                query = query.in('organization_id', orgIds);
            }
        } else {
            // 2. Not an HO user, check property assignments
            const { data: memberships } = await adminSupabase
                .from('property_memberships')
                .select('property_id')
                .eq('user_id', user.id)
                .eq('is_active', true);

            const propertyIds = memberships?.map(m => m.property_id) || [];

            if (propertyIds.length > 0) {
                // User is tied to specific properties. 
                // If they requested a specific one, check if they have access to it.
                if (requestedPropertyId) {
                    if (propertyIds.includes(requestedPropertyId)) {
                        query = query.eq('property_id', requestedPropertyId);
                    } else {
                        // No access to requested property
                        return NextResponse.json([]);
                    }
                } else {
                    query = query.in('property_id', propertyIds);
                }
            } else {
                return NextResponse.json([]);
            }
        }

        const { data: requests, error } = await query;

        if (error) {
            console.error('Error fetching procurement tickets:', error);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        // 3. Resolve approver names manually since FKs might not exist
        const allUserIdsToResolve = new Set<string>();
        requests?.forEach(req => {
            if (req.target_approver_ids) {
                req.target_approver_ids.forEach((id: string) => allUserIdsToResolve.add(id));
            }
            if (req.target_approver_id) allUserIdsToResolve.add(req.target_approver_id);
            if (req.approved_by) allUserIdsToResolve.add(req.approved_by);
            if (req.rejected_by) allUserIdsToResolve.add(req.rejected_by);
        });

        let userMap: Record<string, string> = {};
        if (allUserIdsToResolve.size > 0) {
            const { data: usersData } = await adminSupabase
                .from('users')
                .select('id, full_name')
                .in('id', Array.from(allUserIdsToResolve));
            
            usersData?.forEach(u => {
                userMap[u.id] = u.full_name;
            });
        }

        // 4. Process requests and mask prices based on property-specific visibility
        const { data: orgMembership } = await adminSupabase
            .from('organization_memberships')
            .select('organization_id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle();

        const formattedRequests = await Promise.all((requests || []).map(async req => {
            const items = [
                ...(Array.isArray(req.items) ? req.items : []),
                ...(req.line_items || [])
            ];

            const showPrices = orgMembership 
                ? await canUserSeePrices(user.id, orgMembership.organization_id, req.property_id)
                : false;

            const maskedItems = items.map(item => {
                if (!showPrices) {
                    return {
                        ...item,
                        unit_price: null,
                        total_price: null,
                        estimated_cost: null
                    };
                }
                return item;
            });

            const target_approver_names = (req.target_approver_ids || [])
                .map((id: string) => userMap[id])
                .filter(Boolean);

            const { line_items, ...rest } = req;
            
            return { 
                ...rest, 
                items: maskedItems,
                target_approver_names,
                target_approver: req.target_approver_id ? { full_name: userMap[req.target_approver_id] } : null,
                approver: req.approved_by ? { full_name: userMap[req.approved_by] } : null,
                rejecter: req.rejected_by ? { full_name: userMap[req.rejected_by] } : null,
                total_amount: showPrices ? req.total_amount : null,
                total_estimated_cost: showPrices ? req.total_estimated_cost : null
            };
        }));

        return NextResponse.json(formattedRequests);
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
