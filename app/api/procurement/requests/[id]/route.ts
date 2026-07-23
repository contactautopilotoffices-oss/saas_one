import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { 
            status,
            quoted_price,
            quotation_file_url,
            notes,
            vendor_name,
            vendor_contact,
            vendor_email,
            vendor_address,
            items // Array of { name, quantity, unit_price, photo_url, description, links }
        } = body;

        // 1. Get current request details
        const adminSupabase = createAdminClient();
        const { data: mRequest, error: fetchError } = await adminSupabase
            .from('material_requests')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !mRequest) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

        // Only allow transition from 'requested' to 'ordered'
        // Skipping strict status transition validation to allow any status change


        // 2. Build update data
        const updateData: any = {
            status,
            updated_at: new Date().toISOString()
        };
        // optional fields
        if (quoted_price !== undefined) updateData.quoted_price = quoted_price;
        if (quotation_file_url !== undefined) updateData.quotation_file_url = quotation_file_url;
        if (notes !== undefined) updateData.notes = notes;
        if (vendor_name !== undefined) updateData.vendor_name = vendor_name;
        if (vendor_contact !== undefined) updateData.vendor_contact = vendor_contact;
        if (vendor_email !== undefined) updateData.vendor_email = vendor_email;
        if (vendor_address !== undefined) updateData.vendor_address = vendor_address;

        // Set timestamps for ordered status
        if (status === 'ordered') {
            updateData.ordered_at = new Date().toISOString();
        }

        // 3. If items provided, upsert them and recalculate total
        let total_amount = mRequest.total_amount || 0;
        if (items && Array.isArray(items)) {
            // Delete existing items and insert new ones
            await adminSupabase
                .from('material_request_items')
                .delete()
                .eq('request_id', id);

            const lineItems = items.map((item: any) => {
                const unitPrice = parseFloat(item.unit_price) || 0;
                const qty = parseFloat(item.quantity) || 1;
                return {
                    request_id: id,
                    organization_id: mRequest.organization_id,
                    catalog_item_id: item.catalog_item_id || null,
                    name: item.name,
                    quantity: qty,
                    unit_price: unitPrice,
                    total_price: unitPrice * qty,
                    photo_url: item.photo_url || null,
                    description: item.description || null,
                    links: item.links || null
                };
            });

            if (lineItems.length > 0) {
                const { error: insertError } = await adminSupabase
                    .from('material_request_items')
                    .insert(lineItems);
                
                if (insertError) {
                    console.error('Error inserting line items:', insertError);
                    return NextResponse.json({ error: 'Failed to save quotation items' }, { status: 500 });
                }
            }

            total_amount = lineItems.reduce((acc: number, item: any) => acc + item.total_price, 0);
            updateData.total_amount = total_amount;
        }

        const { data, error } = await adminSupabase
            .from('material_requests')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // 4. Log activity to the ticket's trace log
        const actionMap: Record<string, string> = {
            ordered: 'procurement_ordered'
        };
        
        await adminSupabase
            .from('ticket_activity_log')
            .insert({
                ticket_id: mRequest.ticket_id,
                user_id: user.id,
                action: actionMap[status] || `procurement_${status}`,
                new_value: notes || `${status} the procurement request.${vendor_name ? ` Vendor: ${vendor_name}` : ''}`
            });

        // 5. Budget deduction on 'ordered' status
        if (status === 'ordered' && quoted_price) {
            const { error: budgetError } = await adminSupabase.rpc('decrement_procurement_budget', {
                p_property_id: mRequest.property_id,
                p_budget_type: mRequest.budget_type,
                p_amount: quoted_price
            });
            if (budgetError) console.error('Error updating budget:', budgetError);
        }

        // 6. Trigger Notifications
        try {
            const { NotificationService } = await import('@/backend/services/NotificationService');
            
            if (status === 'quoted') {
                await NotificationService.afterMaterialRequestQuoted(id);
            } else if (status === 'escalated') {
                await NotificationService.afterMaterialRequestEscalated(id);
            } else {
                await NotificationService.afterMaterialRequestStatusChanged(id, status);
            }
        } catch (notifErr) {
            console.error('Notification Error:', notifErr);
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const adminSupabase = createAdminClient();

        // 1. Get current request details to check status and ownership
        const { data: mRequest, error: fetchError } = await adminSupabase
            .from('material_requests')
            .select('status, ticket_id, requested_by, ticket:tickets(ticket_number, organization_id)')
            .eq('id', id)
            .single();
 
        if (fetchError || !mRequest) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }
 
        // 2. Security: Only requester can delete (or admin)
        const orgId = Array.isArray(mRequest.ticket) 
            ? mRequest.ticket[0]?.organization_id 
            : (mRequest.ticket as any)?.organization_id;

        const { data: membership } = await adminSupabase
            .from('organization_memberships')
            .select('role')
            .eq('user_id', user.id)
            .eq('organization_id', orgId || '')
            .maybeSingle();

        const isAdmin = ['org_super_admin', 'master_admin', 'procurement'].includes(membership?.role || '');
        
        if (mRequest.requested_by !== user.id && !isAdmin) {
            return NextResponse.json({ error: 'You can only delete your own requests' }, { status: 403 });
        }

        // 3. Condition: Only allow deletion if NOT quoted/ordered/delivered
        const nonDeletableStatuses = ['quoted', 'ordered', 'delivered'];
        if (nonDeletableStatuses.includes(mRequest.status)) {
            return NextResponse.json({ 
                error: 'Cannot delete request', 
                message: `Requests in ${mRequest.status} status cannot be deleted.` 
            }, { status: 400 });
        }

        // 4. Perform deletion
        const { error: itemsError } = await adminSupabase
            .from('material_request_items')
            .delete()
            .eq('request_id', id);

        if (itemsError) {
            console.error('Error deleting items:', itemsError);
            return NextResponse.json({ error: 'Failed to delete request items' }, { status: 500 });
        }

        const { error: deleteError } = await adminSupabase
            .from('material_requests')
            .delete()
            .eq('id', id);

        if (deleteError) {
            console.error('Error deleting request:', deleteError);
            return NextResponse.json({ error: 'Failed to delete request' }, { status: 500 });
        }

        // 5. Log activity
        await adminSupabase
            .from('ticket_activity_log')
            .insert({
                ticket_id: mRequest.ticket_id,
                user_id: user.id,
                action: 'procurement_deleted',
                new_value: 'Deleted the procurement request.'
            });

        await adminSupabase
            .from('procurement_activity_log')
            .insert({
                user_id: user.id,
                action: 'deleted',
                metadata: {
                    ticket_number: Array.isArray(mRequest.ticket) ? mRequest.ticket[0]?.ticket_number : (mRequest.ticket as any)?.ticket_number,
                    ticket_id: mRequest.ticket_id
                }
            });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
