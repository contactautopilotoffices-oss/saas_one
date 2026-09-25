import ExcelJS from 'exceljs';

/**
 * Standard Monthly Requisition Item Template.
 *
 * One fixed template, owned by Procurement, uploaded once and reused by every
 * property when filling its monthly requisition. This module is the single
 * source of truth for the template's columns — the download endpoint, the
 * import parser and the UI hints all read from CATALOG_TEMPLATE_COLUMNS.
 *
 * Column mapping is deterministic (canonical header, then a fixed synonym
 * table). There is no AI guessing step: the template is fixed, so a wrong
 * silent mapping is a defect rather than a fallback.
 */

export const TEMPLATE_VERSION = 'v1';
export const TEMPLATE_SHEET_NAME = 'Items';
export const MAX_TEMPLATE_ROWS = 5000;

/** Maximum accepted size of a single embedded item photo (bytes). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Categories the monthly requisition sheet groups by. */
export const CATALOG_CATEGORIES = ['HK', 'Beverages', 'Technical', 'General'] as const;
export type CatalogCategory = typeof CATALOG_CATEGORIES[number];

export interface TemplateColumnSpec {
    key: string;
    header: string;
    width: number;
    required?: boolean;
    /** Normalised alternates accepted on upload, for files not built from the template. */
    synonyms: string[];
    help: string;
    example: string;
}

/**
 * The template, exactly as procurement's existing requisition sheet is laid out.
 * Same seven columns, same header wording — Qty dropped (a master list has no
 * quantity) and Category added in its place. Nothing else is added: a column the
 * sheet does not have is a column somebody has to fill in.
 */
export const CATALOG_TEMPLATE_COLUMNS: TemplateColumnSpec[] = [
    {
        key: 'sort_order',
        header: 'Sr. No.',
        width: 9,
        synonyms: ['sr no', 'sr', 'serial', 'sno', 's no', 'no', 'order', 'display order'],
        help: 'Row number. Controls the order items appear on every property requisition sheet. Leave blank to keep file order.',
        example: '1',
    },
    {
        key: 'name',
        header: 'Item Description',
        width: 38,
        required: true,
        synonyms: ['item description', 'description', 'item', 'item name', 'name', 'product', 'material', 'particulars'],
        help: 'Required. The standard item name every property will see. Include the pack size here the way you already do ("Bleach Chemical 5 Ltr").',
        example: 'Bleach Chemical 5 Ltr',
    },
    {
        key: 'category',
        header: 'Category',
        width: 14,
        synonyms: ['category', 'group', 'type', 'section', 'class'],
        help: `One of: ${CATALOG_CATEGORIES.join(', ')}. Common words are mapped automatically (Housekeeping to HK, Pantry to Beverages, Electrical to Technical). Anything unrecognised becomes General.`,
        example: 'HK',
    },
    {
        key: 'unit',
        header: 'Unit',
        width: 12,
        synonyms: ['unit', 'uom', 'unit of measure', 'pack', 'measurement'],
        help: 'Unit of issue, exactly as you buy it ("5 L Can", "pcs", "KG"). This is what stock will be counted in, so keep it consistent for the same item.',
        example: '5 L Can',
    },
    {
        key: 'brand',
        header: 'brands',
        width: 16,
        synonyms: ['brand', 'brands', 'make', 'company', 'manufacturer'],
        help: 'Approved brand. Use NA where no brand is specified.',
        example: 'FOLEX',
    },
    {
        key: 'unit_price',
        header: 'final rate',
        width: 13,
        synonyms: ['final rate', 'rate', 'price', 'cost', 'unit price', 'amount', 'basic rate', 'standard rate'],
        help: 'Standard rate per unit. Currency symbols and commas are fine.',
        example: '325',
    },
    {
        key: 'photo',
        header: 'IMAGE',
        width: 22,
        synonyms: ['image', 'photo', 'picture', 'item image', 'item photo', 'image url', 'photo url'],
        help: 'Paste the product picture straight into this cell (Insert > Picture > Place in Cell), or type a public image URL. One picture per row, max 5 MB.',
        example: '(paste picture here)',
    },
];

const REQUIRED_KEYS = CATALOG_TEMPLATE_COLUMNS.filter(c => c.required).map(c => c.key);

/** Header text for a field, so messages always name the column as the sheet labels it. */
function headerFor(key: string): string {
    return CATALOG_TEMPLATE_COLUMNS.find(c => c.key === key)?.header || key;
}

/** Columns that do not count as user-entered content when deciding if a row is blank. */
const EMPTINESS_EXEMPT_KEYS = new Set(['photo', 'sort_order']);

// ─── Normalisation helpers ────────────────────────────────────────────────────

/** Lowercase, punctuation to spaces, collapse whitespace. Shared with the alias service's conventions. */
export function normalizeHeader(value: unknown): string {
    return String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Normalised item name, used to detect duplicates within a file and against existing rows. */
export function normalizeItemName(value: unknown): string {
    return String(value ?? '')
        .toLowerCase()
        .replace(/[\-_,\.\(\)\[\]\/\|"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const CATEGORY_HINTS: Array<{ match: RegExp; category: CatalogCategory }> = [
    { match: /\b(hk|housekeep\w*|cleaning|janitor\w*|hygiene|washroom|tissue|paper)\b/, category: 'HK' },
    { match: /\b(bev\w*|pantry|tea|coffee|ccd|cafeteria|drink\w*|milk|snack\w*)\b/, category: 'Beverages' },
    { match: /\b(tech\w*|electric\w*|maint\w*|engineer\w*|plumb\w*|hardware|tool\w*|it)\b/, category: 'Technical' },
    { match: /\b(gen\w*|misc\w*|other|stationery|admin)\b/, category: 'General' },
];

/** Map free-text category to one of the four buckets the requisition sheet groups by. */
export function normalizeCategory(value: unknown): CatalogCategory {
    const raw = normalizeHeader(value);
    if (!raw) return 'General';

    const exact = CATALOG_CATEGORIES.find(c => normalizeHeader(c) === raw);
    if (exact) return exact;

    for (const hint of CATEGORY_HINTS) {
        if (hint.match.test(raw)) return hint.category;
    }
    return 'General';
}

/** Strip currency symbols and separators. Returns null when the cell is not a number. */
export function parseRate(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    const cleaned = String(value).replace(/[^0-9.\-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Generate a deterministic-looking item code for a row that arrived without one. */
export function generateItemCode(category: CatalogCategory, sequence: number): string {
    const prefix = category === 'Beverages' ? 'BEV'
        : category === 'Technical' ? 'TEC'
            : category === 'General' ? 'GEN'
                : 'HK';
    return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

// ─── Cell readers ─────────────────────────────────────────────────────────────

/**
 * ExcelJS cell values are polymorphic — plain scalars, rich text runs, formula
 * results and hyperlink objects all appear. Flatten them to a trimmed string.
 */
function readCellText(cell: ExcelJS.Cell | undefined): string {
    if (!cell) return '';
    const value = cell.value;
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();

    if (typeof value === 'object') {
        const obj = value as unknown as Record<string, unknown>;
        if (typeof obj.text === 'string') return obj.text.trim();
        if (Array.isArray(obj.richText)) {
            return (obj.richText as Array<{ text?: string }>).map(run => run.text ?? '').join('').trim();
        }
        if ('result' in obj) return String(obj.result ?? '').trim();
        if ('hyperlink' in obj) return String(obj.hyperlink ?? '').trim();
    }
    return String(value).trim();
}

/** A Photo cell may hold a typed URL, or a hyperlink whose target is the URL. */
function readPhotoUrl(cell: ExcelJS.Cell | undefined): string | null {
    if (!cell) return null;

    const value = cell.value;
    const hyperlink = value && typeof value === 'object' && 'hyperlink' in value
        ? String((value as { hyperlink?: unknown }).hyperlink ?? '')
        : '';

    const candidate = (hyperlink || readCellText(cell)).trim();
    return /^https?:\/\//i.test(candidate) ? candidate : null;
}

// ─── Template generation ──────────────────────────────────────────────────────

const HEADER_FILL = 'FF0F172A';   // slate-900
const REQUIRED_FILL = 'FF0891B2'; // cyan-600, marks the one required column
const BANNER_FILL = 'FFF1F5F9';   // slate-100
const GRID_LINE = 'FF94A3B8';     // slate-400, matches the bordered sheet procurement already uses

export interface TemplateSeedItem {
    item_code?: string | null;
    name?: string | null;
    category?: string | null;
    brand?: string | null;
    color_size_details?: string | null;
    unit?: string | null;
    unit_price?: number | null;
    estimated_price?: number | null;
    photo_url?: string | null;
    sort_order?: number | null;
    description?: string | null;
}

export interface GenerateTemplateOptions {
    organizationName?: string;
    /** Existing catalog items to pre-fill, so procurement can edit and re-upload. */
    items?: TemplateSeedItem[];
    /** Blank rows to append for new entries. */
    blankRows?: number;
}

export async function generateCatalogTemplateWorkbook(options: GenerateTemplateOptions = {}): Promise<Buffer> {
    const { organizationName, items = [], blankRows = items.length > 0 ? 25 : 40 } = options;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SaaS One Procurement';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(TEMPLATE_SHEET_NAME, {
        views: [{ state: 'frozen', ySplit: 2 }],
    });

    sheet.columns = CATALOG_TEMPLATE_COLUMNS.map(col => ({ key: col.key, width: col.width }));

    // ── Banner row: template identity, so we can tell a template apart from a random sheet
    const banner = sheet.getRow(1);
    banner.getCell(1).value = `Standard Requisition Items — Template ${TEMPLATE_VERSION}${organizationName ? ` · ${organizationName}` : ''}`;
    sheet.mergeCells(1, 1, 1, CATALOG_TEMPLATE_COLUMNS.length);
    banner.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
    banner.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BANNER_FILL } };
    banner.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    banner.height = 22;

    // ── Header row
    const header = sheet.getRow(2);
    CATALOG_TEMPLATE_COLUMNS.forEach((col, idx) => {
        const cell = header.getCell(idx + 1);
        cell.value = col.header;
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: col.required ? REQUIRED_FILL : HEADER_FILL },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
        cell.note = col.help;
    });
    header.height = 28;

    const categoryColIndex = CATALOG_TEMPLATE_COLUMNS.findIndex(c => c.key === 'category') + 1;
    const photoColIndex = CATALOG_TEMPLATE_COLUMNS.findIndex(c => c.key === 'photo') + 1;

    // ── Seeded rows (current catalog), then blank rows for new entries.
    // Laid out like the sheet procurement already uses: every cell bordered and
    // centred, item description left-aligned and bold.
    const writeRow = (rowNumber: number, serial: number, item?: TemplateSeedItem) => {
        const row = sheet.getRow(rowNumber);
        row.height = 54; // tall enough that a pasted picture is visible

        CATALOG_TEMPLATE_COLUMNS.forEach((col, idx) => {
            const cell = row.getCell(idx + 1);

            cell.border = {
                top: { style: 'thin', color: { argb: GRID_LINE } },
                left: { style: 'thin', color: { argb: GRID_LINE } },
                bottom: { style: 'thin', color: { argb: GRID_LINE } },
                right: { style: 'thin', color: { argb: GRID_LINE } },
            };
            cell.alignment = col.key === 'name'
                ? { vertical: 'middle', horizontal: 'left', wrapText: true }
                : { vertical: 'middle', horizontal: 'center', wrapText: true };
            if (col.key === 'name') cell.font = { bold: true, size: 10 };

            switch (col.key) {
                case 'sort_order':
                    // Sr. No. is always filled in, seeded or blank, so the sheet reads
                    // like the one they already use.
                    cell.value = item?.sort_order ?? serial;
                    break;
                case 'unit_price':
                    if (item) {
                        cell.value = item.unit_price ?? item.estimated_price ?? null;
                        cell.numFmt = '0.00';
                    }
                    break;
                case 'photo':
                    if (item?.photo_url) {
                        cell.value = { text: 'View photo', hyperlink: item.photo_url };
                        cell.font = { color: { argb: 'FF0891B2' }, underline: true, size: 9 };
                    }
                    break;
                default:
                    if (item) {
                        cell.value = (item as Record<string, string | number | null | undefined>)[col.key] ?? null;
                    }
            }
        });

        // Lock the category cell to the four buckets so typos never reach the sheet
        row.getCell(categoryColIndex).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [`"${CATALOG_CATEGORIES.join(',')}"`],
            showErrorMessage: true,
            errorTitle: 'Unknown category',
            error: `Choose one of: ${CATALOG_CATEGORIES.join(', ')}`,
        };
    };

    let rowNumber = 3;
    let serial = 1;
    for (const item of items) writeRow(rowNumber++, serial++, item);
    for (let i = 0; i < blankRows; i++) writeRow(rowNumber++, serial++, undefined);

    sheet.getColumn(photoColIndex).alignment = { vertical: 'middle', horizontal: 'center' };

    // ── Instructions sheet
    const guide = workbook.addWorksheet('Instructions');
    guide.columns = [
        { key: 'column', width: 20 },
        { key: 'required', width: 12 },
        { key: 'help', width: 92 },
    ];

    const guideTitle = guide.getRow(1);
    guideTitle.getCell(1).value = 'How to fill this template';
    guide.mergeCells(1, 1, 1, 3);
    guideTitle.getCell(1).font = { bold: true, size: 13 };
    guideTitle.height = 24;

    const guideHeader = guide.getRow(2);
    ['Column', 'Required', 'What to put in it'].forEach((label, idx) => {
        const cell = guideHeader.getCell(idx + 1);
        cell.value = label;
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    });

    CATALOG_TEMPLATE_COLUMNS.forEach((col, idx) => {
        const row = guide.getRow(idx + 3);
        row.getCell(1).value = col.header;
        row.getCell(1).font = { bold: true, size: 10 };
        row.getCell(2).value = col.required ? 'Yes' : 'Optional';
        row.getCell(3).value = col.help;
        row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
        row.height = 34;
    });

    const notesStart = CATALOG_TEMPLATE_COLUMNS.length + 4;
    [
        'Do not rename, reorder or delete the header row — the upload reads it by name.',
        'Adding photos: select the IMAGE cell, then Insert > Picture > Place in Cell. One picture per row.',
        'A photo URL typed into the IMAGE cell works too, as long as the link is publicly reachable.',
        'Items are matched on Item Description. Editing a description is treated as a NEW item, so if you are renaming something, link it in the preview instead of letting it create a duplicate.',
        'Re-uploading the same file changes nothing. Upload is always previewed before anything is saved.',
        'A blank optional cell means "leave as it is" — it never wipes a value the item already has.',
        'Items you remove from the file are never deleted automatically — you choose Keep, Legacy or Retire for each one in the preview.',
    ].forEach((note, idx) => {
        const row = guide.getRow(notesStart + idx);
        row.getCell(1).value = idx === 0 ? 'Notes' : '';
        row.getCell(1).font = { bold: true, size: 10 };
        row.getCell(3).value = `• ${note}`;
        row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    });

    const out = await workbook.xlsx.writeBuffer();
    return Buffer.from(out);
}

// ─── Template parsing ─────────────────────────────────────────────────────────

export interface ParsedPhoto {
    kind: 'embedded' | 'url';
    /** Present for embedded images. */
    buffer?: Buffer;
    extension?: string;
    /** Present for URL photos. */
    url?: string;
}

export interface ParsedTemplateRow {
    /** 1-based worksheet row number, for error messages the uploader can act on. */
    rowNumber: number;
    item_code: string;
    name: string;
    category: CatalogCategory;
    rawCategory: string;
    brand: string;
    color_size_details: string;
    unit: string;
    unit_price: number | null;
    sort_order: number | null;
    description: string;
    photo: ParsedPhoto | null;
    errors: string[];
}

export interface ParsedTemplate {
    rows: ParsedTemplateRow[];
    /** Canonical field key -> the header text it was matched from. */
    headerMap: Record<string, string>;
    unmatchedHeaders: string[];
    missingRequired: string[];
    fatalError?: string;
}

/** Locate the header row: the first row within the top 10 that matches at least two known headers. */
function findHeaderRow(sheet: ExcelJS.Worksheet): { rowNumber: number; headers: Map<number, string> } | null {
    const limit = Math.min(sheet.rowCount, 10);

    for (let r = 1; r <= limit; r++) {
        const row = sheet.getRow(r);
        const headers = new Map<number, string>();
        let known = 0;

        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            const text = normalizeHeader(readCellText(cell));
            if (!text) return;
            headers.set(colNumber, text);
            if (CATALOG_TEMPLATE_COLUMNS.some(c => normalizeHeader(c.header) === text || c.synonyms.includes(text))) {
                known++;
            }
        });

        if (known >= 2) return { rowNumber: r, headers };
    }
    return null;
}

/**
 * Resolve worksheet columns to template fields.
 * Exact canonical headers are matched first so a synonym can never steal a column
 * that the template itself names (e.g. "Description" vs the name column).
 */
function buildColumnIndex(headers: Map<number, string>): {
    index: Record<string, number>;
    headerMap: Record<string, string>;
    unmatched: string[];
} {
    const index: Record<string, number> = {};
    const headerMap: Record<string, string> = {};
    const claimed = new Set<number>();

    for (const col of CATALOG_TEMPLATE_COLUMNS) {
        const canonical = normalizeHeader(col.header);
        for (const [colNumber, text] of headers) {
            if (claimed.has(colNumber)) continue;
            if (text === canonical) {
                index[col.key] = colNumber;
                headerMap[col.key] = col.header;
                claimed.add(colNumber);
                break;
            }
        }
    }

    for (const col of CATALOG_TEMPLATE_COLUMNS) {
        if (index[col.key] !== undefined) continue;
        for (const [colNumber, text] of headers) {
            if (claimed.has(colNumber)) continue;
            if (col.synonyms.includes(text)) {
                index[col.key] = colNumber;
                headerMap[col.key] = text;
                claimed.add(colNumber);
                break;
            }
        }
    }

    const unmatched: string[] = [];
    for (const [colNumber, text] of headers) {
        if (!claimed.has(colNumber) && text) unmatched.push(text);
    }

    return { index, headerMap, unmatched };
}

/**
 * Map embedded pictures to worksheet rows.
 * ExcelJS anchors are 0-based, so a picture anchored at nativeRow N sits on
 * worksheet row N + 1. Where several pictures land on one row the first wins.
 */
interface ImageAnchor {
    imageId: string | number;
    range?: { tl?: { nativeRow?: number } };
}

interface WorkbookMedia {
    buffer?: Buffer | ArrayBuffer;
    extension?: string;
}

function extractEmbeddedImages(
    workbook: ExcelJS.Workbook,
    sheet: ExcelJS.Worksheet,
): Map<number, { buffer: Buffer; extension: string }> {
    const byRow = new Map<number, { buffer: Buffer; extension: string }>();

    let anchors: ImageAnchor[] = [];
    try {
        anchors = (sheet.getImages() || []) as unknown as ImageAnchor[];
    } catch {
        return byRow;
    }

    for (const anchor of anchors) {
        const rowNumber = Math.round(Number(anchor?.range?.tl?.nativeRow ?? NaN)) + 1;
        if (!Number.isFinite(rowNumber) || rowNumber < 1) continue;
        if (byRow.has(rowNumber)) continue;

        try {
            const media = workbook.getImage(Number(anchor.imageId)) as WorkbookMedia | undefined;
            if (!media?.buffer) continue;

            const buffer = Buffer.isBuffer(media.buffer) ? media.buffer : Buffer.from(media.buffer);
            if (buffer.length === 0) continue;

            byRow.set(rowNumber, { buffer, extension: String(media.extension || 'png').toLowerCase() });
        } catch {
            // A single unreadable picture must not fail the whole import.
        }
    }

    return byRow;
}

export async function parseCatalogTemplateWorkbook(fileBuffer: Buffer): Promise<ParsedTemplate> {
    const workbook = new ExcelJS.Workbook();

    try {
        // ExcelJS types its loader against its own Buffer alias; a Node Buffer is what it actually reads.
        await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
    } catch {
        return {
            rows: [],
            headerMap: {},
            unmatchedHeaders: [],
            missingRequired: REQUIRED_KEYS,
            fatalError: 'Could not read this file as an Excel workbook. Please upload the .xlsx template.',
        };
    }

    const sheet = workbook.getWorksheet(TEMPLATE_SHEET_NAME) || workbook.worksheets[0];
    if (!sheet) {
        return {
            rows: [],
            headerMap: {},
            unmatchedHeaders: [],
            missingRequired: REQUIRED_KEYS,
            fatalError: 'The workbook has no sheets.',
        };
    }

    const headerRow = findHeaderRow(sheet);
    if (!headerRow) {
        return {
            rows: [],
            headerMap: {},
            unmatchedHeaders: [],
            missingRequired: REQUIRED_KEYS,
            fatalError: 'Could not find the template header row. Download the template and keep its header row intact.',
        };
    }

    const { index, headerMap, unmatched } = buildColumnIndex(headerRow.headers);
    const missingRequired = REQUIRED_KEYS.filter(key => index[key] === undefined)
        .map(key => CATALOG_TEMPLATE_COLUMNS.find(c => c.key === key)!.header);

    if (missingRequired.length > 0) {
        return { rows: [], headerMap, unmatchedHeaders: unmatched, missingRequired };
    }

    const images = extractEmbeddedImages(workbook, sheet);
    const rows: ParsedTemplateRow[] = [];
    const get = (row: ExcelJS.Row, key: string) =>
        index[key] !== undefined ? readCellText(row.getCell(index[key])) : '';

    for (let r = headerRow.rowNumber + 1; r <= sheet.rowCount; r++) {
        if (rows.length >= MAX_TEMPLATE_ROWS) break;

        const row = sheet.getRow(r);
        const name = get(row, 'name');
        const embedded = images.get(r) || null;

        // A row with no name and no other content is just template padding.
        // Sr. No. is pre-filled on every blank row of the downloaded template, so it
        // is never evidence that somebody entered something.
        const hasAnyValue = CATALOG_TEMPLATE_COLUMNS
            .some(c => !EMPTINESS_EXEMPT_KEYS.has(c.key) && get(row, c.key) !== '');
        if (!name && !hasAnyValue && !embedded) continue;

        const errors: string[] = [];
        if (!name) errors.push(`${headerFor('name')} is blank`);

        const rawCategory = get(row, 'category');
        const rawRate = index['unit_price'] !== undefined ? row.getCell(index['unit_price']).value : null;
        const unitPrice = parseRate(rawRate);
        if (rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== '' && unitPrice === null) {
            errors.push(`${headerFor('unit_price')} "${readCellText(row.getCell(index['unit_price']))}" is not a number`);
        }
        if (unitPrice !== null && unitPrice < 0) errors.push(`${headerFor('unit_price')} cannot be negative`);

        const rawSort = get(row, 'sort_order');
        const sortOrder = rawSort === '' ? null : parseInt(rawSort.replace(/[^0-9\-]/g, ''), 10);

        let photo: ParsedPhoto | null = null;
        if (embedded) {
            if (embedded.buffer.length > MAX_PHOTO_BYTES) {
                errors.push(`${headerFor('photo')} is ${(embedded.buffer.length / 1024 / 1024).toFixed(1)} MB — max is ${MAX_PHOTO_BYTES / 1024 / 1024} MB`);
            } else {
                photo = { kind: 'embedded', buffer: embedded.buffer, extension: embedded.extension };
            }
        } else if (index['photo'] !== undefined) {
            const url = readPhotoUrl(row.getCell(index['photo']));
            if (url) photo = { kind: 'url', url };
        }

        rows.push({
            rowNumber: r,
            // The sheet carries no code column — codes are assigned server-side
            // and items are matched on their description.
            item_code: '',
            name,
            category: normalizeCategory(rawCategory),
            rawCategory,
            brand: get(row, 'brand'),
            color_size_details: get(row, 'color_size_details'),
            unit: get(row, 'unit') || 'pcs',
            unit_price: unitPrice,
            sort_order: Number.isFinite(sortOrder as number) ? (sortOrder as number) : null,
            description: get(row, 'description'),
            photo,
            errors,
        });
    }

    return { rows, headerMap, unmatchedHeaders: unmatched, missingRequired: [] };
}
