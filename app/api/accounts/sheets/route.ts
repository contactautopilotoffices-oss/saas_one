import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';
import { notifyApproversOnSheetSubmission } from '@/backend/lib/accounts/sheetNotify';

// GET /api/accounts/sheets — list payment batches / sheets
export async function GET(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const orgId = access.organizationId;
    const sp = new URL(request.url).searchParams;
    const status = sp.get('status');
    const search = (sp.get('search') || '').trim();
    const page = Math.max(1, parseInt(sp.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || '20')));

    let q = supabaseAdmin
        .from('payment_sheets')
        .select(`
            *,
            creator:users!payment_sheets_created_by_fkey(id, full_name, email),
            approver:users!payment_sheets_approved_by_fkey(id, full_name, email)
        `, { count: 'exact' })
        .eq('organization_id', orgId);

    if (status && status !== 'all') {
        q = q.eq('status', status);
    }
    if (search) {
        q = q.or(`batch_number.ilike.%${search}%,title.ilike.%${search}%`);
    }

    q = q.order('created_at', { ascending: false });
    const from = (page - 1) * pageSize;
    q = q.range(from, from + pageSize - 1);

    const { data: sheets, error, count } = await q;
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Also get overview stats across all sheets
    const { data: allSheets } = await supabaseAdmin
        .from('payment_sheets')
        .select('status, total_payable_amount, total_pos')
        .eq('organization_id', orgId);

    const stats = {
        total_sheets: allSheets?.length || 0,
        pending_sheets: allSheets?.filter(s => s.status === 'submitted' || s.status === 'partially_approved').length || 0,
        pending_amount: allSheets?.filter(s => s.status === 'submitted' || s.status === 'partially_approved').reduce((acc, s) => acc + Number(s.total_payable_amount || 0), 0) || 0,
        approved_sheets: allSheets?.filter(s => s.status === 'approved').length || 0,
        approved_amount: allSheets?.filter(s => s.status === 'approved').reduce((acc, s) => acc + Number(s.total_payable_amount || 0), 0) || 0,
        completed_sheets: allSheets?.filter(s => s.status === 'completed').length || 0,
    };

    return NextResponse.json({
        sheets: sheets || [],
        stats,
        pagination: {
            page,
            page_size: pageSize,
            total: count || 0,
            total_pages: Math.ceil((count || 0) / pageSize),
        },
    });
}

// POST /api/accounts/sheets — create a new payment sheet + items + pre-aligned payments
export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const access = await resolveAccountsAccess(request, readOrgId(request, body));
    if (isAccountsAccessError(access)) return access;

    const orgId = access.organizationId;
    const { title, department, notes, items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'At least one payment line item is required' }, { status: 400 });
    }

    // 1. Generate unique batch number
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date()).replace(/-/g, '');
    
    // Check count for today to sequence suffix
    const { count } = await supabaseAdmin
        .from('payment_sheets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .ilike('batch_number', `BATCH-${dateStr}%`);

    const seq = String((count || 0) + 1).padStart(3, '0');
    const batchNumber = `BATCH-${dateStr}-${seq}`;

    // 2. Compute aggregate totals
    let totalPoAmount = 0;
    let totalRequestAmount = 0;
    let totalGstHold = 0;
    let totalTds = 0;
    let totalPayableAmount = 0;

    for (const item of items) {
        const poAmt = Number(item.total_po_amount || 0);
        const reqAmt = Number(item.request_amount || 0);
        const gst = Number(item.gst_hold || 0);
        const tds = Number(item.tds || 0);
        const net = reqAmt - gst - tds;

        totalPoAmount += poAmt;
        totalRequestAmount += reqAmt;
        totalGstHold += gst;
        totalTds += tds;
        totalPayableAmount += net;
    }

    // 3. Create payment_sheets header row
    const { data: sheet, error: sheetError } = await supabaseAdmin
        .from('payment_sheets')
        .insert({
            organization_id: orgId,
            batch_number: batchNumber,
            title: title || `${department || 'Mixed'} Payment Batch - ${new Date().toLocaleDateString('en-IN')}`,
            department: department || 'Mixed',
            status: 'submitted',
            total_pos: items.length,
            total_po_amount: totalPoAmount,
            total_request_amount: totalRequestAmount,
            total_gst_hold: totalGstHold,
            total_tds: totalTds,
            total_payable_amount: totalPayableAmount,
            created_by: access.user.id,
            submitted_at: new Date().toISOString(),
            notes: notes || null,
        })
        .select()
        .single();

    if (sheetError) {
        return NextResponse.json({ error: sheetError.message }, { status: 500 });
    }

    // 4. Check organization settings for auto pre-alignment
    const { data: settings } = await supabaseAdmin
        .from('payment_tracker_settings')
        .select('auto_pre_align')
        .eq('organization_id', orgId)
        .maybeSingle();

    const autoPreAlign = settings?.auto_pre_align !== false;

    // 5. Gather PO IDs by PO number lookup in zoho_purchase_orders
    const poNumbers = items.map((i: any) => i.po_number).filter(Boolean);
    const { data: existingPos } = await supabaseAdmin
        .from('zoho_purchase_orders')
        .select('id, po_number, property_id')
        .eq('organization_id', orgId)
        .in('po_number', poNumbers);

    const poMap = new Map((existingPos || []).map((p: any) => [p.po_number, p]));

    // 6. Insert sheet items and optionally pre-aligned po_payments
    const sheetItemsToInsert = [];
    const paymentsToInsert = [];

    for (const item of items) {
        const reqAmt = Number(item.request_amount || 0);
        const gst = Number(item.gst_hold || 0);
        const tds = Number(item.tds || 0);
        const net = reqAmt - gst - tds;
        const matchedPo = poMap.get(item.po_number);
        const poId = item.po_id || matchedPo?.id || null;
        const propertyId = item.property_id || matchedPo?.property_id || null;

        const itemId = crypto.randomUUID();

        sheetItemsToInsert.push({
            id: itemId,
            sheet_id: sheet.id,
            organization_id: orgId,
            po_id: poId,
            department: item.department || department || 'Capex',
            vendor_name: item.vendor_name,
            category: item.category || 'General',
            site_name: item.site_name || item.site || '',
            property_id: propertyId,
            po_number: item.po_number,
            total_po_amount: Number(item.total_po_amount || 0),
            request_amount: reqAmt,
            gst_hold: gst,
            tds: tds,
            net_payable_amount: net,
            payment_date: item.payment_date || null,
            payment_amount: net,
            utr_no: item.utr_no || null,
            remarks: item.remarks || null,
            approval_status: 'pending',
            alignment_status: autoPreAlign ? 'pre_aligned' : 'pending',
        });

        if (autoPreAlign && poId) {
            paymentsToInsert.push({
                organization_id: orgId,
                po_id: poId,
                po_number: item.po_number,
                vendor_name: item.vendor_name,
                requested_amount: reqAmt,
                gst_hold: gst,
                tds: tds,
                net_payable_amount: net,
                status: 'pre_aligned',
                approval_status: 'pending',
                sheet_id: sheet.id,
                sheet_item_id: itemId,
                department: item.department || department,
                category: item.category,
                site_name: item.site_name || item.site,
                payment_date: item.payment_date || null,
                remarks: item.remarks || null,
                created_by: access.user.id,
            });
        }
    }

    const { error: itemsError } = await supabaseAdmin
        .from('payment_sheet_items')
        .insert(sheetItemsToInsert);

    if (itemsError) {
        console.error('[POST /api/accounts/sheets] items insert error:', itemsError);
    }

    if (paymentsToInsert.length > 0) {
        const { data: createdPayments, error: payError } = await supabaseAdmin
            .from('po_payments')
            .insert(paymentsToInsert)
            .select('id, sheet_item_id');

        if (payError) {
            console.error('[POST /api/accounts/sheets] po_payments insert error:', payError);
        } else if (createdPayments) {
            // Update items with po_payment_id
            for (const cp of createdPayments) {
                if (cp.sheet_item_id) {
                    await supabaseAdmin
                        .from('payment_sheet_items')
                        .update({ po_payment_id: cp.id })
                        .eq('id', cp.sheet_item_id);
                }
            }
        }
    }

    // 7. Fire notification to designated approvers (asynchronous, non-blocking)
    const { data: creatorProfile } = await supabaseAdmin
        .from('users')
        .select('full_name')
        .eq('id', access.user.id)
        .maybeSingle();

    notifyApproversOnSheetSubmission({
        sheetId: sheet.id,
        organizationId: orgId,
        batchNumber: sheet.batch_number,
        title: sheet.title,
        totalPos: sheet.total_pos,
        totalAmount: totalPayableAmount,
        submittedByName: creatorProfile?.full_name || access.user.email || 'Procurement',
    }).catch(e => console.error('[POST /api/accounts/sheets] notify error:', e));

    return NextResponse.json({
        success: true,
        sheet,
        items_count: sheetItemsToInsert.length,
        pre_aligned_count: paymentsToInsert.length,
    });
}
