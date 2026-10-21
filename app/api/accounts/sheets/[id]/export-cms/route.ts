import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

// GET /api/accounts/sheets/[id]/export-cms — download corporate bank CMS payout file
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
        .order('vendor_name', { ascending: true });

    // Fetch vendor bank details from vendor_profiles if available
    const vendorNames = [...new Set((items || []).map(i => i.vendor_name).filter(Boolean))];
    const { data: profiles } = await supabaseAdmin
        .from('vendor_profiles')
        .select('name, bank_account_no, bank_ifsc, bank_name')
        .eq('organization_id', orgId)
        .in('name', vendorNames);

    const vendorMap = new Map((profiles || []).map((p: any) => [p.name.toLowerCase().trim(), p]));

    const cmsRows = (items || []).map(item => {
        const vProf = vendorMap.get(item.vendor_name.toLowerCase().trim());
        return {
            'Batch Number': sheet.batch_number,
            'PO Number': item.po_number,
            'Vendor Name': item.vendor_name,
            'Beneficiary Account No': vProf?.bank_account_no || '',
            'IFSC Code': vProf?.bank_ifsc || '',
            'Bank Name': vProf?.bank_name || '',
            'Net Payable Amount': Number(item.net_payable_amount || 0),
            'Department': item.department || '',
            'Category': item.category || '',
            'Site': item.site_name || '',
            'Approval Status': item.approval_status,
            'Narration / Remarks': `${item.po_number} ${item.remarks || ''}`.trim(),
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(cmsRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'CMS Payout');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new Response(buffer, {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${sheet.batch_number}_CMS_Payout.xlsx"`,
        },
    });
}
