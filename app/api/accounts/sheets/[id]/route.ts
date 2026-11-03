import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

// GET /api/accounts/sheets/[id] — get details and all line items of a sheet
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id: sheetId } = await context.params;
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const orgId = access.organizationId;

    const { data: sheet, error: sheetError } = await supabaseAdmin
        .from('payment_sheets')
        .select(`
            *,
            creator:users!payment_sheets_created_by_fkey(id, full_name, email),
            approver:users!payment_sheets_approved_by_fkey(id, full_name, email)
        `)
        .eq('id', sheetId)
        .eq('organization_id', orgId)
        .single();

    if (sheetError) {
        return NextResponse.json({ error: sheetError.message }, { status: 404 });
    }

    const { data: items, error: itemsError } = await supabaseAdmin
        .from('payment_sheet_items')
        .select(`
            *,
            reviewer:users!payment_sheet_items_reviewed_by_fkey(id, full_name, email),
            payment:po_payments!payment_sheet_items_po_payment_id_fkey(id, status, utr_no, payment_date, paid_amount)
        `)
        .eq('sheet_id', sheetId)
        .order('po_number', { ascending: true });

    if (itemsError) {
        return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    return NextResponse.json({
        sheet,
        items: items || [],
    });
}

// PATCH /api/accounts/sheets/[id] — Approver actions (approve_all, approve_items, reject_items)
export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id: sheetId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;

    const orgId = access.organizationId;
    const { action, item_ids, reason } = body;

    // Verify approval authorization
    const { data: settings } = await supabaseAdmin
        .from('payment_tracker_settings')
        .select('approver_user_ids')
        .eq('organization_id', orgId)
        .maybeSingle();

    const isDesignatedApprover = (settings?.approver_user_ids || []).includes(access.user.id);
    const canApprove = access.isAdmin || access.isMasterAdmin || isDesignatedApprover;

    if (!canApprove) {
        return NextResponse.json({ error: 'Forbidden: you are not authorized to approve payment sheets for this organization' }, { status: 403 });
    }

    const now = new Date().toISOString();

    // 1. Fetch current items of this sheet
    const { data: currentItems, error: itemsFetchError } = await supabaseAdmin
        .from('payment_sheet_items')
        .select('id, po_payment_id, approval_status, net_payable_amount')
        .eq('sheet_id', sheetId)
        .eq('organization_id', orgId);

    if (itemsFetchError || !currentItems) {
        return NextResponse.json({ error: 'Failed to load sheet items' }, { status: 500 });
    }

    if (action === 'approve_all') {
        // Approve all pending items
        await supabaseAdmin
            .from('payment_sheet_items')
            .update({
                approval_status: 'approved',
                alignment_status: 'aligned',
                reviewed_by: access.user.id,
                reviewed_at: now,
            })
            .eq('sheet_id', sheetId)
            .eq('approval_status', 'pending');

        // Promote corresponding po_payments to aligned
        const paymentIds = currentItems.map(i => i.po_payment_id).filter(Boolean);
        if (paymentIds.length > 0) {
            await supabaseAdmin
                .from('po_payments')
                .update({
                    status: 'aligned',
                    approval_status: 'approved',
                    approved_by: access.user.id,
                    approved_at: now,
                    aligned_by: access.user.id,
                    aligned_at: now,
                })
                .in('id', paymentIds)
                .eq('status', 'pre_aligned');
        }

        // Update sheet header
        await supabaseAdmin
            .from('payment_sheets')
            .update({
                status: 'approved',
                approved_by: access.user.id,
                approved_at: now,
                updated_at: now,
            })
            .eq('id', sheetId);

    } else if (action === 'approve_items') {
        const targetIds: string[] = Array.isArray(item_ids) ? item_ids : [];
        if (targetIds.length === 0) {
            return NextResponse.json({ error: 'item_ids array is required' }, { status: 400 });
        }

        await supabaseAdmin
            .from('payment_sheet_items')
            .update({
                approval_status: 'approved',
                alignment_status: 'aligned',
                reviewed_by: access.user.id,
                reviewed_at: now,
            })
            .in('id', targetIds)
            .eq('sheet_id', sheetId);

        const paymentIds = currentItems
            .filter(i => targetIds.includes(i.id))
            .map(i => i.po_payment_id)
            .filter(Boolean);

        if (paymentIds.length > 0) {
            await supabaseAdmin
                .from('po_payments')
                .update({
                    status: 'aligned',
                    approval_status: 'approved',
                    approved_by: access.user.id,
                    approved_at: now,
                    aligned_by: access.user.id,
                    aligned_at: now,
                })
                .in('id', paymentIds);
        }

    } else if (action === 'reject_items') {
        const targetIds: string[] = Array.isArray(item_ids) ? item_ids : [];
        if (targetIds.length === 0) {
            return NextResponse.json({ error: 'item_ids array is required' }, { status: 400 });
        }

        // Reject item and drop from alignment
        await supabaseAdmin
            .from('payment_sheet_items')
            .update({
                approval_status: 'rejected',
                alignment_status: 'cancelled',
                rejection_reason: reason || 'Removed by approver',
                reviewed_by: access.user.id,
                reviewed_at: now,
            })
            .in('id', targetIds)
            .eq('sheet_id', sheetId);

        // Auto-cancel in po_payments
        const paymentIds = currentItems
            .filter(i => targetIds.includes(i.id))
            .map(i => i.po_payment_id)
            .filter(Boolean);

        if (paymentIds.length > 0) {
            await supabaseAdmin
                .from('po_payments')
                .update({
                    status: 'cancelled',
                    approval_status: 'rejected',
                    rejection_reason: reason || 'Removed by approver',
                    updated_at: now,
                })
                .in('id', paymentIds);
        }
    }

    // 2. Re-compute overall sheet status
    const { data: updatedItems } = await supabaseAdmin
        .from('payment_sheet_items')
        .select('approval_status')
        .eq('sheet_id', sheetId);

    if (updatedItems && updatedItems.length > 0) {
        const approvedCount = updatedItems.filter(i => i.approval_status === 'approved').length;
        const rejectedCount = updatedItems.filter(i => i.approval_status === 'rejected').length;
        const totalCount = updatedItems.length;

        let newStatus = 'submitted';
        if (approvedCount === totalCount) {
            newStatus = 'approved';
        } else if (rejectedCount === totalCount) {
            newStatus = 'rejected';
        } else if (approvedCount > 0 || rejectedCount > 0) {
            newStatus = 'partially_approved';
        }

        await supabaseAdmin
            .from('payment_sheets')
            .update({
                status: newStatus,
                approved_by: access.user.id,
                approved_at: now,
                updated_at: now,
            })
            .eq('id', sheetId);
    }

    return NextResponse.json({ success: true });
}
