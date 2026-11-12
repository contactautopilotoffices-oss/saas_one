import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/frontend/utils/supabase/server';
import { addGuideSheet, xlsxResponse } from '@/backend/lib/excel/templateHelpers';

const SAMPLE_AUDIT_ROWS = [
    [1, 'Fire Safety & HSE', 'Fire safety & Emergency response procedures and HSE Policy', 'Kiran', 'as on date'],
    [2, 'Fire Safety', 'Fire safety Certificates and NOCs', 'Kiran', 'as on date'],
    [3, 'Utilities', 'Preventive maintenance of utility systems', 'Kiran', "Apr'25 to Mar'26"],
];

/**
 * GET /api/audit/template
 * Downloads a .xlsx template matching InternalAuditView's Excel parser + POST /api/audit/master.
 */
export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Audit Checklist');
        sheet.columns = [
            { header: 'Sl. No.', key: 'si_no', width: 10 },
            { header: 'Category', key: 'category', width: 22 },
            { header: 'Data Required', key: 'requirement', width: 56 },
            { header: 'SPOC', key: 'spoc_name', width: 18 },
            { header: 'Period', key: 'period', width: 20 },
        ];

        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        });

        SAMPLE_AUDIT_ROWS.forEach((r) => sheet.addRow(r));

        addGuideSheet(workbook, 'Internal Audit Checklist — How to Fill', [
            ['Sl. No.', 'Optional (Number)', 'Serial number of the audit point (e.g. 1, 2, 3).'],
            ['Category', 'Optional (defaults to General)', 'Audit category (e.g. Fire Safety, Utilities, Compliance).'],
            ['Data Required', 'Required', 'Audit requirement / verification point description. Rows without this are skipped.'],
            ['SPOC', 'Optional', 'Single Point of Contact name.'],
            ['Period', 'Optional', 'Review period (e.g. "as on date" or "Apr\'25 to Mar\'26").'],
        ]);

        const buffer = await workbook.xlsx.writeBuffer();
        return xlsxResponse(buffer, 'Internal_Audit_Template.xlsx');
    } catch (error) {
        console.error('[GET /api/audit/template] Error:', error);
        return NextResponse.json({ error: 'Failed to generate audit template' }, { status: 500 });
    }
}

