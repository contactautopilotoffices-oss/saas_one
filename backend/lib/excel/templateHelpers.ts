import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Return a NextResponse serving an Excel (.xlsx) workbook buffer as an attachment. */
export function xlsxResponse(buffer: ArrayBuffer | Uint8Array | Buffer, filename: string): NextResponse {
    const body = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return new NextResponse(body as unknown as BodyInit, {
        headers: {
            'Content-Type': XLSX_MIME,
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}

/** Return a NextResponse serving a CSV string as an attachment. */
export function csvResponse(csv: string, filename: string): NextResponse {
    return new NextResponse(csv, {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}

/** Append a standardized "How to Fill" documentation worksheet to an ExcelJS workbook. */
export function addGuideSheet(
    workbook: ExcelJS.Workbook,
    title: string,
    rows: Array<[string, string, string]>,
): ExcelJS.Worksheet {
    const guide = workbook.addWorksheet('How to Fill');
    guide.columns = [
        { width: 26 },
        { width: 22 },
        { width: 72 },
    ];

    const titleRow = guide.addRow([title]);
    titleRow.font = { bold: true, size: 12, color: { argb: 'FF0F172A' } };
    guide.mergeCells('A1:C1');
    guide.addRow([]);

    const headerRow = guide.addRow(['Column / Field', 'Required / Format', 'Notes']);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });

    for (const [col, req, notes] of rows) {
        const row = guide.addRow([col, req, notes]);
        row.alignment = { vertical: 'top', wrapText: true };
    }

    return guide;
}

