import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { resolveAccountsAccess, isAccountsAccessError, readOrgId } from '@/backend/lib/accounts/access';

function cleanNum(val: any): number {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const str = String(val).replace(/,/g, '').trim();
    const parsed = parseFloat(str);
    return isNaN(parsed) ? 0 : parsed;
}

export async function POST(request: NextRequest) {
    const access = await resolveAccountsAccess(request, readOrgId(request));
    if (isAccountsAccessError(access)) return access;

    const orgId = access.organizationId;
    let rawRows: any[] = [];

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = (file.name || '').toLowerCase();

        if (filename.endsWith('.csv')) {
            const text = buffer.toString('utf-8');
            const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
            rawRows = parsed.data;
        } else {
            // Excel workbook
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        }
    } else {
        const json = await request.json().catch(() => null);
        if (json?.rows && Array.isArray(json.rows)) {
            rawRows = json.rows;
        } else {
            return NextResponse.json({ error: 'Expected multipart file or JSON with rows array' }, { status: 400 });
        }
    }

    if (!rawRows || rawRows.length === 0) {
        return NextResponse.json({ error: 'The uploaded file contains no data rows' }, { status: 400 });
    }

    // Standardize column key matching (handle case variations and trimmed headers)
    const normalizedItems = rawRows.map((row) => {
        const keys = Object.keys(row);
        const findVal = (...aliases: string[]) => {
            for (const alias of aliases) {
                const matchedKey = keys.find(k => k.trim().toLowerCase() === alias.toLowerCase());
                if (matchedKey && row[matchedKey] !== undefined) return row[matchedKey];
            }
            return '';
        };

        const department = String(findVal('department', 'dept') || 'Capex').trim();
        const vendorName = String(findVal('vendor name', 'vendor', 'supplier') || '').trim();
        const category = String(findVal('category', 'item category', 'type') || 'General').trim();
        const siteName = String(findVal('site', 'site name', 'location', 'property') || '').trim();
        const poNumber = String(findVal('po no', 'po number', 'po_no', 'ponumber') || '').trim();
        const totalPoAmount = cleanNum(findVal('total po amount', 'po amount', 'po value', 'total amount'));
        const requestAmount = cleanNum(findVal('request amount', 'requested amount', 'req amount', 'advance'));
        const gstHold = cleanNum(findVal('gst hold', 'gst_hold', 'hold'));
        const tds = cleanNum(findVal('tds', 'tds amount'));
        const paymentDate = String(findVal('payment date', 'pay date', 'date') || '').trim();
        const utrNo = String(findVal('utr no', 'utr', 'reference', 'bank ref') || '').trim();
        const remarks = String(findVal('remarks', 'remark', 'notes', 'narration') || '').trim();

        const netPayable = requestAmount - gstHold - tds;

        return {
            department,
            vendor_name: vendorName,
            category,
            site_name: siteName,
            po_number: poNumber,
            total_po_amount: totalPoAmount,
            request_amount: requestAmount,
            gst_hold: gstHold,
            tds: tds,
            net_payable_amount: netPayable > 0 ? netPayable : 0,
            payment_date: paymentDate,
            utr_no: utrNo,
            remarks: remarks,
        };
    }).filter(i => Boolean(i.po_number || i.vendor_name));

    // Lookup matching POs in database to auto-enrich and check validity
    const poNumbers = [...new Set(normalizedItems.map(i => i.po_number).filter(Boolean))];
    const { data: dbPos } = await supabaseAdmin
        .from('zoho_purchase_orders')
        .select('id, po_number, vendor_name, po_amount, department, category, property_id')
        .eq('organization_id', orgId)
        .in('po_number', poNumbers);

    const poMap = new Map((dbPos || []).map((p: any) => [p.po_number, p]));

    const enrichedItems = normalizedItems.map(item => {
        const matched = poMap.get(item.po_number);
        return {
            ...item,
            po_id: matched?.id || null,
            property_id: matched?.property_id || null,
            is_matched_in_zoho: Boolean(matched),
            total_po_amount: item.total_po_amount || Number(matched?.po_amount || 0),
            department: item.department || matched?.department || 'Capex',
            category: item.category !== 'General' ? item.category : (matched?.category || 'General'),
        };
    });

    const totalRequest = enrichedItems.reduce((acc, i) => acc + i.request_amount, 0);
    const totalGst = enrichedItems.reduce((acc, i) => acc + i.gst_hold, 0);
    const totalTds = enrichedItems.reduce((acc, i) => acc + i.tds, 0);
    const totalNet = enrichedItems.reduce((acc, i) => acc + i.net_payable_amount, 0);

    return NextResponse.json({
        success: true,
        items: enrichedItems,
        summary: {
            total_rows: enrichedItems.length,
            matched_zoho_pos: enrichedItems.filter(i => i.is_matched_in_zoho).length,
            unmatched_pos: enrichedItems.filter(i => !i.is_matched_in_zoho).length,
            total_request_amount: totalRequest,
            total_gst_hold: totalGst,
            total_tds: totalTds,
            total_net_payable: totalNet,
        },
    });
}
