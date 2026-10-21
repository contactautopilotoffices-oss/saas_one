import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

// GET /api/accounts/sheets/[id]/export-csv — download complete 13-column payment sheet CSV
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id: sheetId } = await context.params;
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const orgId = access.organizationId;

    const { data: sheet } = await supabaseAdmin
        .from('payment_sheets')
        .select('*')
        .eq('id', sheetId)
        .eq('organization_id', orgId)
        .single();

    if (!sheet) {
        return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
    }

    const { data: items } = await supabaseAdmin
        .from('payment_sheet_items')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('created_at', { ascending: true });

    const sheetRows = (items || []).map((item, idx) => ({
        '#': idx + 1,
        'Department': item.department || '',
        'Vendor Name': item.vendor_name || '',
        'Category': item.category || '',
        'Site': item.site_name || '',
        'PO Number': item.po_number || '',
        'Total PO Amount': Number(item.total_po_amount || 0),
        'Request Amount': Number(item.request_amount || 0),
        'GST Hold': Number(item.gst_hold || 0),
        'TDS': Number(item.tds || 0),
        'Net Payable Amount': Number(item.net_payable_amount || 0),
        'Payment Date': item.payment_date || '',
        'UTR Number': item.utr_no || '',
        'Approval Status': item.approval_status || 'submitted',
        'Remarks': item.remarks || '',
    }));

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const csvContent = XLSX.utils.sheet_to_csv(ws);

    const filename = `${sheet.batch_number}_Payment_Sheet.csv`;

    return new NextResponse(csvContent, {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    });
}
