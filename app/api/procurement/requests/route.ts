import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { canUserSeePrices } from '@/backend/lib/procurement';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            console.error('Procurement API POST Auth Error:', authError);
            return NextResponse.json({ 
                error: 'Unauthorized', 
                message: authError?.message || 'No user found' 
            }, { status: 401 });
        }

        const body = await request.json();
        const { 
            ticket_id, 
            property_id, 
            organization_id, 
            budget_type, 
            assignee_uid,
            has_custom_items,
            items // Array of { catalog_item_id, name, quantity, unit_price, photo_url }
        } = body;

        if (!ticket_id || !property_id || !items || items.length === 0) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Calculate total amount
        const total_amount = items.reduce((acc: number, item: any) => acc + ((item.unit_price || 0) * item.quantity), 0);

        const adminSupabase = createAdminClient();

        // 1. Create the Material Request
        // Request goes directly to procurement user (assignee_uid), no approval step
        const { data: mRequest, error: mrError } = await adminSupabase
            .from('material_requests')
            .insert({
                ticket_id,
                property_id,
                organization_id,
                requested_by: user.id,
                assignee_uid,
                budget_type,
                has_custom_items,
                total_amount,
                status: 'pending_quotation'
            })
            .select()
            .single();

        if (mrError) {
            console.error('Error creating request:', mrError);
            return NextResponse.json({ error: 'Failed to create request' }, { status: 500 });
        }

        // 2. Create the line items
        const lineItems = items.map((item: any) => {
            const unitPrice = item.unit_price || 0;
            return {
                request_id: mRequest.id,
                organization_id,
                catalog_item_id: item.catalog_item_id,
                name: item.name,
                quantity: item.quantity,
                unit_price: unitPrice,
                total_price: unitPrice * item.quantity,
                photo_url: item.photo_url,
                description: item.description,
                links: item.links
            };
        });

        const { error: liError } = await adminSupabase
            .from('material_request_items')
            .insert(lineItems);

        if (liError) {
            console.error('Error creating line items:', liError);
            return NextResponse.json({ error: 'Failed to create request items' }, { status: 500 });
        }

        // 3. Post a message to the ticket chat and log activity (Non-blocking)
        adminSupabase
            .from('ticket_comments')
            .insert({
                ticket_id,
                user_id: user.id,
                comment: `Material requested: ${items.length} items (Total: ₹${total_amount.toLocaleString()}). Sent to procurement for quotation.`,
                is_internal: false
            })
            .then(({ error }) => {
                if (error) console.error('[Procurement API] Comment failed:', error.message);
            });

        adminSupabase
            .from('ticket_activity_log')
            .insert({
                ticket_id,
                user_id: user.id,
                action: 'procurement_requested',
                new_value: `Requested ${items.length} materials (Total: ₹${total_amount.toLocaleString()})`
            })
            .then(({ error }) => {
                if (error) console.error('[Procurement API] Activity log failed:', error.message);
            });

        // 4. Trigger Notifications (Non-blocking for instant response)
        const { NotificationService } = await import('@/backend/services/NotificationService');
        NotificationService.afterMaterialRequestCreated(mRequest.id).catch(err => {
            console.error('[Procurement API] Notification failed:', err);
        });

        // Note: Email to Assignee is now handled asynchronously via the Event Outbox 
        // (Supabase Database Trigger -> webhook -> EventProcessor)

        return NextResponse.json(mRequest);
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            console.error('Procurement API GET Auth Error:', authError);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const organizationId = searchParams.get('organizationId');
        const propertyId = searchParams.get('propertyId');
        const ticketId = searchParams.get('ticketId');
        const floorNumber = searchParams.get('floorNumber') || searchParams.get('floor_number') || searchParams.get('floor');

        // Simple UUID validation regex
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (organizationId && !uuidRegex.test(organizationId)) {
            return NextResponse.json([]);
        }
        if (propertyId && !uuidRegex.test(propertyId)) {
            return NextResponse.json([]);
        }
        if (ticketId && !uuidRegex.test(ticketId)) {
            return NextResponse.json([]);
        }

        const adminSupabase = createAdminClient();
        let query = adminSupabase
            .from('material_requests')
            .select(`
                *,
                ticket:tickets!inner(ticket_number, title, floor_number),
                line_items:material_request_items(*),
                comparatives:material_request_comparatives(*, created_by_user:users!material_request_comparatives_created_by_fkey(full_name), action_by_user:users!material_request_comparatives_action_by_fkey(full_name)),
                requester:users!material_requests_requested_by_fkey(full_name),
                assignee:users!material_requests_assignee_uid_fkey(full_name)
            `)
            .order('created_at', { ascending: false });

        if (organizationId) query = query.eq('organization_id', organizationId);
        if (ticketId) query = query.eq('ticket_id', ticketId);
        if (floorNumber && floorNumber !== 'all') {
            if (floorNumber === 'unspecified') {
                query = query.or('floor_number.is.null,floor_number.eq.""', { foreignTable: 'tickets' });
            } else {
                query = query.eq('tickets.floor_number', floorNumber);
            }
        }

        // 1. Check organization-level access first (for HO users)
        const { data: orgMemberships } = await adminSupabase
            .from('organization_memberships')
            .select('organization_id, role')
            .eq('user_id', user.id);
            
        const isHO = orgMemberships?.some(m => ['org_super_admin', 'master_admin', 'procurement'].includes(m.role));

        if (isHO) {
            const orgIds = orgMemberships?.map(m => m.organization_id) || [];
            if (propertyId) {
                // HO can see any property in their org
                query = query.eq('property_id', propertyId).in('organization_id', orgIds);
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
                if (propertyId) {
                    if (propertyIds.includes(propertyId)) {
                        query = query.eq('property_id', propertyId);
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

        const { data, error } = await query;

        if (error) {
            console.error('Supabase fetch error:', error);
            return NextResponse.json({ 
                error: error.message || 'Unknown database error', 
                code: error.code,
                details: error.details
            }, { status: 500 });
        }

        // Hydrate approver_user for comparatives if approver_uid is set
        const allComps = (data || []).flatMap((r: any) => r.comparatives || []);
        const compApproverUids = Array.from(new Set(allComps.map((c: any) => c.approver_uid).filter(Boolean)));
        if (compApproverUids.length > 0) {
            const { data: compApprovers } = await adminSupabase
                .from('users')
                .select('id, full_name, email')
                .in('id', compApproverUids);
            
            const userMap = new Map(compApprovers?.map((u: any) => [u.id, u]) || []);
            allComps.forEach((c: any) => {
                if (c.approver_uid) {
                    c.approver_user = userMap.get(c.approver_uid) || null;
                }
            });
        }

        // Hydrate delivered_by_user manually
        const deliveredUids = Array.from(new Set((data || []).map((r: any) => r.delivered_by).filter(Boolean)));
        if (deliveredUids.length > 0) {
            const { data: deliveredUsers } = await adminSupabase
                .from('users')
                .select('id, full_name')
                .in('id', deliveredUids);
            
            const deliveredMap = new Map(deliveredUsers?.map((u: any) => [u.id, u]) || []);
            (data || []).forEach((r: any) => {
                if (r.delivered_by) {
                    r.delivered_by_user = deliveredMap.get(r.delivered_by) || null;
                }
            });
        }

        const formatted = await Promise.all((data || []).map(async req => {
            const showPrices = await canUserSeePrices(user.id, req.organization_id || organizationId || '', req.property_id);
            
            const items = [
                ...(Array.isArray(req.items) ? req.items : []),
                ...(req.line_items || [])
            ].map(item => ({
                ...item,
                unit_price: showPrices ? item.unit_price : null,
                total_price: showPrices ? item.total_price : null,
            }));

            const { line_items, ...rest } = req;
            return { 
                ...rest, 
                items,
                total_amount: showPrices ? req.total_amount : null
            };
        }));

        return NextResponse.json(formatted);
    } catch (error) {
        console.error('[Procurement Requests GET] Server Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { requestId, assignee_uid } = body;

        if (!requestId || !assignee_uid) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();
        const { error } = await adminSupabase
            .from('material_requests')
            .update({ assignee_uid })
            .eq('id', requestId);

        if (error) {
            console.error('Error reassigning request:', error);
            return NextResponse.json({ error: 'Failed to reassign request' }, { status: 500 });
        }

        // Trigger Notifications
        const { NotificationService } = await import('@/backend/services/NotificationService');
        await NotificationService.afterMaterialRequestAssigned(requestId);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
