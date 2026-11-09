import ExcelJS from 'exceljs';

/**
 * Builds the .xlsx upload template for PPM schedules.
 *
 * The layout here is the layout app/api/ppm/upload/route.ts parses, and the two
 * must stay in step:
 *   · headers on row 3, data from row 4   (the parser starts at row index 3)
 *   · columns A-J describe the task        (parser reads row[0]..row[9])
 *   · 12 month triplets from column K      (parser MONTH_START_COL = 10)
 *
 * No sample rows on the first sheet — the importer reads that sheet and would turn
 * them into real tasks. The worked example lives on the "How to fill" sheet.
 */

export const TASK_COLUMNS = [
    { header: 'SI No', width: 8, required: false, hint: 'Serial number from your own register. Optional.' },
    { header: 'System Name', width: 24, required: true, hint: 'The system or asset group, e.g. "Electrical DB", "CCTV System". Fill it on the first row of a group; rows under it may leave it blank.' },
    { header: 'Details', width: 26, required: true, hint: 'The specific unit, e.g. "ACVTPN A wing", "NVR 1". Either this or System Name must be filled, or the row is skipped.' },
    { header: 'Scope of Work', width: 34, required: false, hint: 'What the task involves, e.g. "Cleaning, Tightening, Visual Inspection".' },
    { header: 'Frequency', width: 14, required: false, hint: 'Monthly, Quarterly, Half-Yearly or Annual. Defaults to Quarterly if left blank. This is a frequency, not a floor.' },
    { header: 'Vendor Name', width: 22, required: false, hint: 'The company that performs the task. Leave blank for in-house work.' },
    { header: 'Location', width: 18, required: false, hint: 'Where the asset is, e.g. "1st Floor", "Terrace". Keep one spelling per floor.' },
    { header: 'Scope (repeat)', width: 14, required: false, hint: 'Not read by the importer. Kept so older sheets still line up.' },
    { header: 'Maker', width: 18, required: false, hint: 'Who carries the task out — "Vendor" or "Internal", or the team name. "Vendor" marks the task as vendor-performed.' },
    { header: 'Checker', width: 20, required: false, hint: 'The person who verifies it, e.g. the site engineer.' },
];

export const TEMPLATE_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
export const TEMPLATE_TRIPLET = ['Planned Date', 'Done Date', 'Remark/ Closure'];
export const TEMPLATE_HEADER_ROW = 3;

export async function buildPpmTemplateWorkbook(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('PPM Schedule');

    ws.getCell('A1').value = 'PLANNED PREVENTIVE MAINTENANCE — UPLOAD TEMPLATE';
    ws.getCell('A1').font = { bold: true, size: 13 };

    // Row 2 — a month label over each triplet, so the sheet reads like the site's own.
    TEMPLATE_MONTHS.forEach((m, i) => {
        const cell = ws.getRow(2).getCell(TASK_COLUMNS.length + i * 3 + 1);
        cell.value = m;
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center' };
    });

    const header = ws.getRow(TEMPLATE_HEADER_ROW);
    TASK_COLUMNS.forEach((c, i) => { header.getCell(i + 1).value = c.header; });
    TEMPLATE_MONTHS.forEach((_m, m) => {
        TEMPLATE_TRIPLET.forEach((t, j) => {
            header.getCell(TASK_COLUMNS.length + m * 3 + j + 1).value = t;
        });
    });
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', wrapText: true };

    TASK_COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
    TEMPLATE_MONTHS.forEach((_m, m) => {
        TEMPLATE_TRIPLET.forEach((_t, j) => {
            ws.getColumn(TASK_COLUMNS.length + m * 3 + j + 1).width = 14;
        });
    });
    ws.views = [{ state: 'frozen', xSplit: TASK_COLUMNS.length, ySplit: TEMPLATE_HEADER_ROW }];

    // ---- How to fill -------------------------------------------------------
    const guide = wb.addWorksheet('How to fill');
    guide.columns = [{ width: 20 }, { width: 10 }, { width: 86 }];
    guide.addRow(['Column', 'Required', 'Notes']).font = { bold: true };
    TASK_COLUMNS.forEach(c => guide.addRow([c.header, c.required ? 'Yes' : '', c.hint]));
    guide.addRow([]);
    guide.addRow(['Planned Date', 'Yes', 'The date the task is due that month. A triplet with no Planned Date is skipped, so a task with no Planned Date is never imported.']);
    guide.addRow(['Done Date', '', 'Fill it only once the work has actually happened. A date here marks the task done. Leave it empty for future months — do not pre-fill it.']);
    guide.addRow(['Remark/ Closure', '', 'Free text. A remark containing "postponed" marks the task postponed.']);
    guide.addRow([]);
    ([
        ['Dates', 'Use real Excel date cells, or type them as DD-MM-YYYY. Any other text in a date cell is ignored and that month is skipped.'],
        ['Layout', `Headers stay on row ${TEMPLATE_HEADER_ROW} and data starts on row ${TEMPLATE_HEADER_ROW + 1}. Columns A-J describe the task; every set of three columns after that is one month. Do not insert or remove columns.`],
        ['Re-uploading', 'An upload REPLACES every existing PPM row for the selected property. Always upload the full sheet including past months and their Done Dates, never a part of it.'],
    ] as const).forEach(([label, note]) => {
        const row = guide.addRow([label, '', note]);
        row.getCell(3).font = { bold: true };
    });
    guide.addRow([]);

    guide.addRow(['Worked example', '', 'One task, two months. Copy the shape, not the values.']).font = { bold: true };
    guide.addRow(['SI No', 'System Name', 'Details']).font = { bold: true };
    guide.addRow(['1', 'Electrical DB', 'ACVTPN A wing']);
    guide.addRow(['Scope of Work', 'Cleaning, Tightening, Visual Inspection', '']);
    guide.addRow(['Frequency', 'Monthly', '']);
    guide.addRow(['Location', '1st Floor', '']);
    guide.addRow(['Maker / Checker', 'Internal', 'Altamash Chaugule']);
    guide.addRow(['Oct triplet', '04-10-2026', '04-10-2026   Done']);
    guide.addRow(['Nov triplet', '04-11-2026', '(leave Done Date empty until it is done)']);

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
}
