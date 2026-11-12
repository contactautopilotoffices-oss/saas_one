import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/frontend/utils/supabase/server';
import { addGuideSheet, csvResponse, xlsxResponse } from '@/backend/lib/excel/templateHelpers';

const SAMPLE_SNAGS = [
    ['AC not cooling properly in 3rd floor conference room', '15-01-2026'],
    ['Water leakage near ground floor washroom sink', '16-01-2026'],
];

/**
 * GET /api/tickets/bulk-import/template?format=xlsx|csv
 * Downloads a template accepted by POST /api/tickets/bulk-import.
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const format = request.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';

        if (format === 'csv') {
            const lines = [
                'issue_description,issue_date',
                ...SAMPLE_SNAGS.map(([desc, date]) => `"${desc.replace(/"/g, '""')}",${date}`),
            ];
            return csvResponse(lines.join('\n'), 'snag_import_template.csv');
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Snags');
        sheet.columns = [
            { header: 'issue_description', key: 'issue_description', width: 58 },
            { header: 'issue_date', key: 'issue_date', width: 18 },
        ];

        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        });

        // Store issue_date explicitly as text ('@') so XLSX.utils.sheet_to_csv preserves DD-MM-YYYY verbatim.
        SAMPLE_SNAGS.forEach(([issue_description, issue_date]) => {
            const row = sheet.addRow({ issue_description, issue_date });
            row.getCell(2).numFmt = '@';
        });

        addGuideSheet(workbook, 'Snag Bulk Import — How to Fill', [
            ['issue_description', 'Required', 'Clear description of the issue. Floor (e.g. "3rd floor", "ground floor", "B1") and location (e.g. "washroom", "cafeteria") are auto-extracted.'],
            ['issue_date', 'Required (DD-MM-YYYY)', 'Must be formatted as DD-MM-YYYY (e.g. 15-01-2026). Keep column formatted as text in Excel.'],
        ]);

        const buffer = await workbook.xlsx.writeBuffer();
        return xlsxResponse(buffer, 'snag_import_template.xlsx');
    } catch (error) {
        console.error('[GET /api/tickets/bulk-import/template] Error:', error);
        return NextResponse.json({ error: 'Failed to generate snag template' }, { status: 500 });
    }
}

