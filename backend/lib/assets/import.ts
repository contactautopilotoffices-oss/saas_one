import * as ExcelJS from 'exceljs';
import Papa from 'papaparse';

/**
 * Bulk asset import — parse an .xlsx / .csv into validated rows.
 *
 * Column names are matched loosely (case, spaces, punctuation ignored) so a
 * sheet exported from another system usually maps without editing headers.
 */

export interface ImportRowInput {
    row: number;              // 1-based row number in the sheet (header = 1)
    asset_code?: string;
    name?: string;
    category?: string;
    asset_type?: string;
    make?: string;
    model?: string;
    serial_number?: string;
    floor?: string;
    location?: string;
    installation_date?: string;
    purchase_cost?: number;
    vendor_name?: string;
    lifecycle_years?: number;
    warranty_start?: string;
    warranty_end?: string;
    amc_required?: boolean;
    notes?: string;
}

export interface ImportError { row: number; field: string; message: string }

export const TEMPLATE_COLUMNS: { header: string; key: keyof ImportRowInput; required?: boolean; hint: string; example: string }[] = [
    { header: 'Asset Name', key: 'name', required: true, hint: 'What the asset is called on site', example: 'Split AC — Cabin 3' },
    { header: 'Category', key: 'category', required: true, hint: 'Category name or code (configurable in the Categories tab)', example: 'HVAC' },
    { header: 'Asset Code', key: 'asset_code', hint: 'Leave blank to auto-generate <PROP>-<CAT>-00001', example: '' },
    { header: 'Type', key: 'asset_type', hint: 'Sub-type / capacity', example: 'Split AC 1.5 TR' },
    { header: 'Make', key: 'make', hint: 'Brand', example: 'Daikin' },
    { header: 'Model', key: 'model', hint: '', example: 'FTKM50' },
    { header: 'Serial Number', key: 'serial_number', hint: '', example: 'DK2023-88471' },
    { header: 'Floor', key: 'floor', hint: 'Free text, used for floor-wise filters', example: '3rd Floor' },
    { header: 'Location', key: 'location', hint: 'Room / area', example: 'Cabin 3, East wing' },
    { header: 'Installation Date', key: 'installation_date', hint: 'YYYY-MM-DD or DD/MM/YYYY', example: '2023-04-12' },
    { header: 'Purchase Cost', key: 'purchase_cost', hint: 'INR', example: '42000' },
    { header: 'Vendor', key: 'vendor_name', hint: 'Supplier / installer', example: 'Cool Air Systems' },
    { header: 'Lifecycle Years', key: 'lifecycle_years', hint: 'Blank = category default', example: '10' },
    { header: 'Warranty Start', key: 'warranty_start', hint: '', example: '2023-04-12' },
    { header: 'Warranty End', key: 'warranty_end', hint: '', example: '2025-04-11' },
    { header: 'AMC Required', key: 'amc_required', hint: 'Yes / No', example: 'Yes' },
    { header: 'Notes', key: 'notes', hint: '', example: '' },
];

const HEADER_ALIASES: Record<string, keyof ImportRowInput> = {
    assetname: 'name', name: 'name', asset: 'name', equipment: 'name', equipmentname: 'name', description: 'name',
    category: 'category', assetcategory: 'category', system: 'category', systemname: 'category',
    assetcode: 'asset_code', code: 'asset_code', tag: 'asset_code', tagno: 'asset_code', assettag: 'asset_code', assetid: 'asset_code',
    type: 'asset_type', assettype: 'asset_type', subtype: 'asset_type', capacity: 'asset_type',
    make: 'make', brand: 'make', manufacturer: 'make',
    model: 'model', modelno: 'model',
    serialnumber: 'serial_number', serial: 'serial_number', serialno: 'serial_number', sno: 'serial_number',
    floor: 'floor', level: 'floor', floorno: 'floor',
    location: 'location', area: 'location', room: 'location', zone: 'location',
    installationdate: 'installation_date', installed: 'installation_date', installdate: 'installation_date', dateofinstallation: 'installation_date', commissioningdate: 'installation_date',
    purchasecost: 'purchase_cost', cost: 'purchase_cost', price: 'purchase_cost', value: 'purchase_cost', amount: 'purchase_cost',
    vendor: 'vendor_name', vendorname: 'vendor_name', supplier: 'vendor_name',
    lifecycleyears: 'lifecycle_years', lifecycle: 'lifecycle_years', life: 'lifecycle_years', lifeyears: 'lifecycle_years', expectedlife: 'lifecycle_years',
    warrantystart: 'warranty_start', warrantyfrom: 'warranty_start',
    warrantyend: 'warranty_end', warrantyto: 'warranty_end', warrantyexpiry: 'warranty_end', warranty: 'warranty_end', warrantyupto: 'warranty_end',
    amcrequired: 'amc_required', amc: 'amc_required', underamc: 'amc_required',
    notes: 'notes', remarks: 'notes', remark: 'notes', comments: 'notes',
};

function normHeader(h: unknown): string {
    return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cellText(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
        const o = v as any;
        if (o.text !== undefined) return String(o.text).trim();          // rich text
        if (o.result !== undefined) return cellText(o.result);           // formula
        if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join('').trim();
        return String(o).trim();
    }
    return String(v).trim();
}

export function parseDateCell(raw: string): string | null {
    const s = raw.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const dmy = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (dmy) {
        const yyyy = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
        return `${yyyy}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
    // Excel serial number
    if (/^\d{4,6}$/.test(s)) {
        const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseBool(raw: string): boolean | undefined {
    const s = raw.trim().toLowerCase();
    if (!s) return undefined;
    if (['yes', 'y', 'true', '1', 'required', 'under amc'].includes(s)) return true;
    if (['no', 'n', 'false', '0', 'not required', 'na', 'n/a'].includes(s)) return false;
    return undefined;
}

function parseNumber(raw: string): number | undefined {
    const s = raw.replace(/[₹,\s]/g, '');
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
}

/** Turn a grid (first row = headers) into typed rows + structural errors. */
function gridToRows(grid: unknown[][]): { rows: ImportRowInput[]; errors: ImportError[]; headers: string[]; unmapped: string[] } {
    const errors: ImportError[] = [];
    if (grid.length === 0) return { rows: [], errors: [{ row: 1, field: 'file', message: 'The file is empty' }], headers: [], unmapped: [] };

    // Header row = first row with at least two non-empty cells that map to known fields.
    let headerIdx = 0;
    for (let i = 0; i < Math.min(grid.length, 5); i++) {
        const mapped = (grid[i] || []).filter((c) => HEADER_ALIASES[normHeader(c)]).length;
        if (mapped >= 2) { headerIdx = i; break; }
    }
    const headers = (grid[headerIdx] || []).map((c) => cellText(c));
    const colMap: (keyof ImportRowInput | null)[] = headers.map((h) => HEADER_ALIASES[normHeader(h)] || null);
    const unmapped = headers.filter((h, i) => h && !colMap[i]);

    if (!colMap.includes('name')) {
        errors.push({ row: headerIdx + 1, field: 'Asset Name', message: 'No "Asset Name" column found. Download the template to see the expected headers.' });
        return { rows: [], errors, headers, unmapped };
    }

    const rows: ImportRowInput[] = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
        const cells = grid[i] || [];
        if (cells.every((c) => cellText(c) === '')) continue;
        const row: ImportRowInput = { row: i + 1 };
        colMap.forEach((key, ci) => {
            if (!key) return;
            const raw = cellText(cells[ci]);
            if (raw === '') return;
            switch (key) {
                case 'purchase_cost': {
                    const n = parseNumber(raw);
                    if (n === undefined) errors.push({ row: i + 1, field: 'Purchase Cost', message: `"${raw}" is not a number` });
                    else row.purchase_cost = n;
                    break;
                }
                case 'lifecycle_years': {
                    const n = parseNumber(raw);
                    if (n === undefined || n <= 0) errors.push({ row: i + 1, field: 'Lifecycle Years', message: `"${raw}" is not a positive number` });
                    else row.lifecycle_years = Math.round(n);
                    break;
                }
                case 'installation_date':
                case 'warranty_start':
                case 'warranty_end': {
                    const d = parseDateCell(raw);
                    if (!d) errors.push({ row: i + 1, field: key, message: `"${raw}" is not a date (use YYYY-MM-DD)` });
                    else row[key] = d;
                    break;
                }
                case 'amc_required': {
                    const b = parseBool(raw);
                    if (b === undefined) errors.push({ row: i + 1, field: 'AMC Required', message: `"${raw}" should be Yes or No` });
                    else row.amc_required = b;
                    break;
                }
                default:
                    (row as any)[key] = raw;
            }
        });
        if (!row.name) errors.push({ row: i + 1, field: 'Asset Name', message: 'Asset Name is required' });
        if (!row.category) errors.push({ row: i + 1, field: 'Category', message: 'Category is required' });
        rows.push(row);
    }
    return { rows, errors, headers, unmapped };
}

export async function parseAssetFile(file: File): Promise<{ rows: ImportRowInput[]; errors: ImportError[]; headers: string[]; unmapped: string[] }> {
    const name = (file.name || '').toLowerCase();
    const buffer = await file.arrayBuffer();

    if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
        const text = new TextDecoder('utf-8').decode(buffer);
        const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
        return gridToRows(parsed.data as unknown[][]);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets.find((w) => w.rowCount > 0) || workbook.worksheets[0];
    if (!sheet) return { rows: [], errors: [{ row: 1, field: 'file', message: 'No worksheet found in the workbook' }], headers: [], unmapped: [] };

    const grid: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const values = row.values as unknown[]; // 1-based: index 0 is empty
        grid[rowNumber - 1] = values.slice(1);
    });
    // eachRow skips empty rows leaving holes; compact while keeping row numbers via padding.
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    return gridToRows(grid);
}

/** Build the downloadable .xlsx template with a header row and one example row. */
export async function buildTemplateWorkbook(categories: { name: string; code: string }[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Assets');
    ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
    ws.getRow(1).font = { bold: true };
    ws.addRow(Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c.key, c.example])));

    const guide = wb.addWorksheet('How to fill');
    guide.columns = [{ header: 'Column', width: 22 }, { header: 'Required', width: 10 }, { header: 'Notes', width: 70 }];
    guide.getRow(1).font = { bold: true };
    TEMPLATE_COLUMNS.forEach((c) => guide.addRow([c.header, c.required ? 'Yes' : '', c.hint]));
    guide.addRow([]);
    guide.addRow(['Categories available', '', categories.map((c) => `${c.name} (${c.code})`).join(', ')]);

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
}
