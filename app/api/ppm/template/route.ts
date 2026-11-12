import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createClient } from '@/frontend/utils/supabase/server';
import { addGuideSheet, xlsxResponse } from '@/backend/lib/excel/templateHelpers';

const PPM_MONTH_LABELS = [
    'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar',
    'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
];

const BASE_HEADERS = [
    'SI No',
    'System Name',
    'Details',
    'Scope of Work',
    'Frequency',
    'Vendor Name',
    'Location',
    'Scope',
    'Maker',
    'Checker',
];

/**
 * GET /api/ppm/template
 * Downloads a styled .xlsx template matching POST /api/ppm/upload.
 * Row 1: Title banner, Row 2: Month triplet banners, Row 3: Column headers, Row 4+: Data.
 */
export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('PPM Schedule');

        const totalCols = BASE_HEADERS.length + PPM_MONTH_LABELS.length * 3; // 10 + 36 = 46 (Col A..AT)

        // Row 1: Title banner (parser skips rows 1-3 and reads from Row 4)
        const titleRow = sheet.addRow(['52-Week Planned Preventive Maintenance (PPM) Schedule Template — Enter tasks starting from Row 4']);
        sheet.mergeCells(1, 1, 1, totalCols);
        titleRow.height = 26;
        const titleCell = titleRow.getCell(1);
        titleCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

        // Row 2: Section / Month group headers
        const groupValues: string[] = new Array(totalCols).fill('');
        groupValues[0] = 'Task & Asset Details';
        PPM_MONTH_LABELS.forEach((m, idx) => {
            groupValues[BASE_HEADERS.length + idx * 3] = `${m} (Planned / Done / Remark)`;
        });
        const groupRow = sheet.addRow(groupValues);
        groupRow.height = 22;
        sheet.mergeCells(2, 1, 2, BASE_HEADERS.length);
        groupRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        groupRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        groupRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

        PPM_MONTH_LABELS.forEach((_, idx) => {
            const startCol = BASE_HEADERS.length + idx * 3 + 1; // 1-based
            sheet.mergeCells(2, startCol, 2, startCol + 2);
            const cell = groupRow.getCell(startCol);
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: idx % 2 === 0 ? 'FF1D4ED8' : 'FF0369A1' },
            };
            cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });

        // Row 3: Exact column headers
        const colHeaders = [...BASE_HEADERS];
        PPM_MONTH_LABELS.forEach(() => {
            colHeaders.push('Planned Date', 'Done Date', 'Remark');
        });
        const headerRow = sheet.addRow(colHeaders);
        headerRow.height = 24;
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
                left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            };
        });

        // Sample rows starting at Row 4 (using UTC dates so Excel serials parse without TZ shift)
        const year = new Date().getUTCFullYear();
        const sampleRows: any[][] = [
            [
                1,
                'HVAC / Chiller',
                'AHU Filter Cleaning & Coil Check',
                'Clean pre-filters, check belt tension and drain pan',
                'Monthly',
                'CoolAir Services',
                'Basement / Floor 1',
                'AHU Preventive',
                'Vendor',
                'Facility Manager',
                new Date(Date.UTC(year, 9, 10)),
                new Date(Date.UTC(year, 9, 10)),
                'Completed on schedule',
                new Date(Date.UTC(year, 10, 10)),
                null,
                '',
            ],
            [
                2,
                'DG Set',
                '500 kVA Generator B-Check',
                'Oil & filter inspection, battery voltage & coolant check',
                'Quarterly',
                'PowerGen AMC',
                'DG Yard',
                'DG Servicing',
                'Vendor',
                'Chief Engineer',
                new Date(Date.UTC(year, 9, 15)),
                null,
                '',
            ],
            [
                3,
                'Fire Fighting System',
                'Hydrant & Sprinkler Pump Test',
                'Test jockey pump auto-start, pressure gauge & valve check',
                'Weekly',
                '',
                'Pump Room',
                'Fire Pump Test',
                'Internal',
                'Safety Officer',
                new Date(Date.UTC(year, 9, 5)),
                null,
                'Postponed due to shutdown',
            ],
        ];

        sampleRows.forEach((values) => {
            const padded = [...values];
            while (padded.length < totalCols) padded.push(null);
            const row = sheet.addRow(padded);
            for (let m = 0; m < PPM_MONTH_LABELS.length; m++) {
                const plannedCol = BASE_HEADERS.length + m * 3 + 1;
                const doneCol = plannedCol + 1;
                row.getCell(plannedCol).numFmt = 'dd-mm-yyyy';
                row.getCell(doneCol).numFmt = 'dd-mm-yyyy';
            }
        });

        // Set readable column widths
        const baseWidths = [8, 22, 28, 36, 13, 22, 18, 18, 12, 18];
        baseWidths.forEach((w, idx) => {
            sheet.getColumn(idx + 1).width = w;
        });
        for (let c = BASE_HEADERS.length + 1; c <= totalCols; c++) {
            sheet.getColumn(c).width = (c - BASE_HEADERS.length) % 3 === 0 ? 22 : 14;
        }
        sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 3 }];

        addGuideSheet(workbook, 'PPM Schedule Import — How to Fill', [
            ['Row 1–3', 'Reserved', 'Header & banner rows. Parser starts reading tasks from Row 4 onwards.'],
            ['Col A: SI No', 'Optional', 'Serial number (e.g. 1, 2, 3).'],
            ['Col B: System Name', 'Required', 'Equipment/system name (if blank, Col C Details is used). Rows with both B & C blank are skipped.'],
            ['Col C: Details', 'Optional', 'Specific asset/task detail.'],
            ['Col D: Scope of Work', 'Optional', 'Checklist / maintenance scope description.'],
            ['Col E: Frequency', 'Optional (default: Quarterly)', 'Accepted labels: Yearly, Quarterly, Monthly, Weekly.'],
            ['Col F: Vendor Name', 'Optional', 'Must match vendor company name in Vendors tab to auto-link.'],
            ['Col G: Location', 'Optional', 'Floor, area, or room name.'],
            ['Col H: Scope', 'Optional', 'Reserved/short scope column (kept for 52-week sheet layout).'],
            ['Col I: Maker', 'Optional', 'Use "Vendor" or "Internal".'],
            ['Col J: Checker', 'Optional', 'Name of internal person verifying the task.'],
            ['Col K–AT (12 Month Triplets)', 'At least 1 Planned Date required', 'Every month has 3 columns: Planned Date | Done Date | Remark. Use Excel Date cells, DD-MM-YYYY, or YYYY-MM-DD.'],
            ['Status Rules', 'Automatic', 'Done Date filled -> "done"; Remark contains "postponed" -> "postponed"; otherwise -> "pending".'],
            ['Re-upload Behaviour', 'Warning', 'Uploading replaces all existing PPM schedules for the selected property/organization.'],
        ]);

        const buffer = await workbook.xlsx.writeBuffer();
        return xlsxResponse(buffer, 'PPM_Schedule_Template.xlsx');
    } catch (error) {
        console.error('[GET /api/ppm/template] Error:', error);
        return NextResponse.json({ error: 'Failed to generate PPM template' }, { status: 500 });
    }
}

