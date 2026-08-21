import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/frontend/utils/supabase/admin';
import { generateRequisitionExcelWorkbook, RequisitionItemData } from '@/backend/lib/excel/requisitionExcelGenerator';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: 'Requisition ID is required' }, { status: 400 });
        }

        const adminSupabase = createAdminClient();

        // 1. Fetch Requisition details
        const { data: req, error: fetchError } = await adminSupabase
            .from('property_monthly_requisitions')
            .select(`
                *,
                property:properties!property_id(id, name, address, city),
                uploader:users!uploaded_by(id, full_name, email, phone),
                acknowledger:users!acknowledged_by(id, full_name, email)
            `)
            .eq('id', id)
            .single();

        if (fetchError || !req) {
            return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
        }

        // 2. Parse Items from notes JSON or structured fields
        let parsedItems: RequisitionItemData[] = [];
        let siteNotes = req.notes || '';
        let requesterPhone = req.uploader?.phone || '';

        try {
            if (req.notes && typeof req.notes === 'string' && req.notes.trim().startsWith('{')) {
                const parsed = JSON.parse(req.notes);
                if (Array.isArray(parsed.items)) {
                    parsedItems = parsed.items;
                }
                siteNotes = parsed.site_notes || siteNotes;
                requesterPhone = parsed.requester_phone || requesterPhone;
            } else if (req.notes && typeof req.notes === 'object' && Array.isArray(req.notes.items)) {
                parsedItems = req.notes.items;
            }
        } catch {
            // Notes was plain text
        }

        const MONTH_NAMES = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        const monthName = MONTH_NAMES[(req.requisition_month || 1) - 1] || 'Month';
        const createdAt = new Date(req.created_at || Date.now());
        const dateFormatted = `${createdAt.getDate()}/${createdAt.getMonth() + 1}/${createdAt.getFullYear()}`;

        // 3. Generate Excel buffer
        const excelBuffer = await generateRequisitionExcelWorkbook({
            propertyName: req.property?.name || 'Site Property',
            propertyLocation: req.property?.location || req.property?.address || req.property?.name,
            requesterName: req.uploader?.full_name || req.uploader?.email || 'Site Admin',
            requesterPhone,
            dateFormatted,
            monthName,
            monthIndex: req.requisition_month || 1,
            year: req.requisition_year || createdAt.getFullYear(),
            siteNotes,
            items: parsedItems,
            status: req.status
        });

        const safeFileName = `${(req.property?.name || 'Requisition').replace(/\s+/g, '_')}_${monthName}_${req.requisition_year}.xlsx`;

        // 4. Return as binary file download response
        return new NextResponse(new Uint8Array(excelBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${safeFileName}"`,
                'Content-Length': excelBuffer.length.toString(),
            }
        });
    } catch (err: any) {
        console.error('[Requisition Export Error]:', err);
        return NextResponse.json({ error: 'Failed to generate Excel export', details: err.message }, { status: 500 });
    }
}
