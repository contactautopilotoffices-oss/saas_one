import ExcelJS from 'exceljs';

export interface RequisitionItemData {
    id?: string;
    category: string; // 'HK' | 'Beverages' | 'Technical' | 'General'
    name: string;
    brand?: string;
    details?: string; // color, size
    requested_qty: number;
    available_stock_qty: number;
    unit: string;
    unit_price?: number;
    total_price?: number;
    remarks?: string;
}

export interface RequisitionExportData {
    propertyName: string;
    propertyLocation?: string;
    requesterName: string;
    requesterPhone?: string;
    dateFormatted: string; // DD/MM/YYYY
    monthName: string;
    monthIndex: number;
    year: number;
    floorTag?: string;
    siteNotes?: string;
    items: RequisitionItemData[];
    vendorName?: string;
    vendorQuotedAmount?: number;
    status?: string;
    totalEstimatedAmount?: number;
    budgetLimit?: number;
    isOverBudget?: boolean;
    overBudgetAmount?: number;
    hkBudget?: number;
    beverageBudget?: number;
    totalBudget?: number;
}

export interface MultiPropertyExportData {
    organizationName?: string;
    monthName: string;
    monthIndex: number;
    year: number;
    exportedBy?: string;
    propertiesData: RequisitionExportData[];
}

// Exact Color Scheme from the provided template photos
const COLORS = {
    PRODUCT_HEADER: '00A2ED', // Cyan / Sky Blue
    PRODUCT_CELL: '00A2ED',
    BRAND_HEADER: '48C774',   // Light Green
    BRAND_CELL: '48C774',
    DETAILS_HEADER: 'FFFF00', // Yellow
    DETAILS_CELL: 'FFFF00',
    UOM_HEADER: 'FFCCBC',     // Peach / Light Orange
    UOM_CELL: 'FFCCBC',
    GRAY_HEADER: 'E2E8F0',    // Light Gray for numbering
    SECTION_HEADER: 'D1D5DB', // Section divider
    DARK_HEADER: '1E293B',
    BORDER: 'D1D5DB',
    EMERALD_HEADER: '059669',
    LIGHT_EMERALD: 'ECFDF5',
    LIGHT_ROSE: 'FFE4E6',
    ROSE_TEXT: 'BE123C',
};

/**
 * Sanitizes and generates a unique, valid Excel sheet name (max 31 chars, no forbidden chars).
 */
export function sanitizeExcelSheetName(name: string, index: number, usedNames: Set<string>): string {
    let clean = (name || `Site ${index + 1}`)
        .replace(/[/\\?*:[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (clean.length > 28) {
        clean = clean.substring(0, 28).trim();
    }
    if (!clean) clean = `Site ${index + 1}`;

    let uniqueName = clean;
    let counter = 2;
    while (usedNames.has(uniqueName.toLowerCase())) {
        const suffix = ` (${counter})`;
        const maxBaseLen = 31 - suffix.length;
        uniqueName = `${clean.substring(0, maxBaseLen)}${suffix}`;
        counter++;
    }
    usedNames.add(uniqueName.toLowerCase());
    return uniqueName;
}

/**
 * Populates a single worksheet with the complete dual-table requisition format for a property.
 */
export function populateRequisitionWorksheet(worksheet: ExcelJS.Worksheet, data: RequisitionExportData) {
    // Setup column widths
    worksheet.columns = [
        { key: 'colA', width: 6 },   // #
        { key: 'colB', width: 28 },  // Product Name/Type
        { key: 'colC', width: 22 },  // Specific Brand if any
        { key: 'colD', width: 22 },  // Color, Size
        { key: 'colE', width: 10 },  // Qty
        { key: 'colF', width: 10 },  // UOM
        { key: 'colG', width: 4 },   // Spacer
        { key: 'colH', width: 6 },   // #
        { key: 'colI', width: 28 },  // Product Name/Type
        { key: 'colJ', width: 22 },  // Specific Brand if any
        { key: 'colK', width: 22 },  // Color, Size
        { key: 'colL', width: 10 },  // Qty
        { key: 'colM', width: 10 },  // UOM
    ];

    let currentRow = 1;

    // 1. Top Meta Info (Left Block)
    const placeTitle = data.floorTag && data.floorTag !== 'All Floors'
        ? `${data.propertyName} (${data.floorTag})`
        : (data.propertyLocation || data.propertyName);

    worksheet.getCell(`A${currentRow}`).value = `Place: ${placeTitle}`;
    worksheet.getCell(`A${currentRow}`).font = { name: 'Calibri', size: 11, bold: true };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Date: ${data.dateFormatted}`;
    worksheet.getCell(`A${currentRow}`).font = { name: 'Calibri', size: 10 };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Signed: ${data.requesterName || 'Site Property Admin'}`;
    worksheet.getCell(`A${currentRow}`).font = { name: 'Calibri', size: 10 };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Mobile#: ${data.requesterPhone || 'N/A'}`;
    worksheet.getCell(`A${currentRow}`).font = { name: 'Calibri', size: 10 };

    if (data.status) {
        worksheet.getCell(`D${currentRow - 2}`).value = `Status: ${(data.status || '').toUpperCase()}`;
        worksheet.getCell(`D${currentRow - 2}`).font = { name: 'Calibri', size: 10, bold: true };
    }

    if (data.budgetLimit && data.budgetLimit > 0) {
        worksheet.getCell(`D${currentRow - 1}`).value = `Monthly Budget: ₹${data.budgetLimit.toLocaleString('en-IN')}`;
        worksheet.getCell(`D${currentRow - 1}`).font = { name: 'Calibri', size: 10, bold: true };
        if (data.isOverBudget && data.overBudgetAmount && data.overBudgetAmount > 0) {
            worksheet.getCell(`D${currentRow}`).value = `⚠️ OVER BUDGET BY: ₹${data.overBudgetAmount.toLocaleString('en-IN')}`;
            worksheet.getCell(`D${currentRow}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFBE123C' } };
        }
    }

    currentRow += 2;

    // 2. Color Legend Guide (Matching Photo 1)
    const legendRow = currentRow;
    worksheet.mergeCells(`A${legendRow}:A${legendRow}`);
    worksheet.getCell(`A${legendRow}`).value = 'Headings';
    worksheet.getCell(`A${legendRow}`).font = { bold: true, size: 10 };
    worksheet.getCell(`B${legendRow}`).value = 'Description';
    worksheet.getCell(`B${legendRow}`).font = { bold: true, size: 10 };
    worksheet.mergeCells(`C${legendRow}:D${legendRow}`);
    worksheet.getCell(`C${legendRow}`).value = 'Example';
    worksheet.getCell(`C${legendRow}`).font = { bold: true, size: 10 };

    const legendItems = [
        { heading: 'Product', desc: 'Item name', example: '', color: COLORS.PRODUCT_CELL },
        { heading: 'Brand', desc: 'Company Name', example: '(JK, Kangaroo, Flair, Doms, Camlin, Kores, etc.)', color: COLORS.BRAND_CELL },
        { heading: 'Details', desc: 'Color, Size, Unit', example: '(Yellow, 25mm, White, etc.)', color: COLORS.DETAILS_CELL },
        { heading: 'UOM', desc: 'Unit of Measurement', example: '(box, pkt, pcs, nos, ltr, can, bottle, jar)', color: COLORS.UOM_CELL },
    ];

    legendItems.forEach((item, idx) => {
        const row = legendRow + 1 + idx;
        worksheet.getCell(`A${row}`).value = item.heading;
        worksheet.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${item.color}` } };
        worksheet.getCell(`A${row}`).font = { bold: true, size: 9 };
        worksheet.getCell(`B${row}`).value = item.desc;
        worksheet.getCell(`B${row}`).font = { size: 9 };
        worksheet.mergeCells(`C${row}:D${row}`);
        worksheet.getCell(`C${row}`).value = item.example;
        worksheet.getCell(`C${row}`).font = { size: 9, italic: true };
    });

    currentRow = legendRow + 1 + legendItems.length + 2;

    // 3. Requisition Header Statement (Matching Photo)
    worksheet.getCell(`A${currentRow}`).value = `Name: ${data.requesterName || 'Property Admin'}`;
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 10 };
    worksheet.getCell(`D${currentRow}`).value = `Date: ${data.dateFormatted}`;
    worksheet.getCell(`D${currentRow}`).font = { bold: true, size: 10 };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Center: ${data.propertyName}${data.floorTag && data.floorTag !== 'All Floors' ? ` - ${data.floorTag}` : ''}`;
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 10 };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Sub: Requisition of Material for above specified center`;
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 10 };
    currentRow += 2;

    worksheet.getCell(`A${currentRow}`).value = `We require the below material for the month of 1/${data.monthIndex}/${data.year}`;
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 11, italic: true };
    currentRow += 2;

    // 4. Split Items by Category
    const items = data.items || [];
    const hkItems = items.filter(i => (i.category || '').toLowerCase() === 'hk' || (i.category || '').toLowerCase().includes('stationery') || (i.category || '').toLowerCase().includes('paper'));
    const beverageItems = items.filter(i => (i.category || '').toLowerCase() === 'beverages' || (i.category || '').toLowerCase().includes('tea') || (i.category || '').toLowerCase().includes('coffee') || (i.category || '').toLowerCase().includes('pantry'));
    const otherItems = items.filter(i => !hkItems.includes(i) && !beverageItems.includes(i));

    const renderCategorySection = (title: string, itemsList: RequisitionItemData[]) => {
        if (itemsList.length === 0) return;

        // Category Banner
        const catRow = currentRow;
        worksheet.mergeCells(`A${catRow}:F${catRow}`);
        worksheet.getCell(`A${catRow}`).value = `Requisition Format - ${title}`;
        worksheet.getCell(`A${catRow}`).font = { bold: true, size: 11 };
        worksheet.getCell(`A${catRow}`).alignment = { horizontal: 'center' };
        worksheet.getCell(`A${catRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

        worksheet.mergeCells(`H${catRow}:M${catRow}`);
        worksheet.getCell(`H${catRow}`).value = `List of available Stock at the center`;
        worksheet.getCell(`H${catRow}`).font = { bold: true, size: 11 };
        worksheet.getCell(`H${catRow}`).alignment = { horizontal: 'center' };
        worksheet.getCell(`H${catRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

        currentRow++;

        // Table Column Headers
        const headerRow = currentRow;
        
        // Left Table Headers (Requisition)
        worksheet.getCell(`A${headerRow}`).value = '#';
        worksheet.getCell(`B${headerRow}`).value = 'Product Name/Type';
        worksheet.getCell(`C${headerRow}`).value = 'Specific Brand if any';
        worksheet.getCell(`D${headerRow}`).value = 'Color, Size';
        worksheet.getCell(`E${headerRow}`).value = 'Qty';
        worksheet.getCell(`F${headerRow}`).value = 'UOM';

        // Right Table Headers (Available Stock)
        worksheet.getCell(`H${headerRow}`).value = '#';
        worksheet.getCell(`I${headerRow}`).value = 'Product Name/Type';
        worksheet.getCell(`J${headerRow}`).value = 'Specific Brand if any';
        worksheet.getCell(`K${headerRow}`).value = 'Color, Size';
        worksheet.getCell(`L${headerRow}`).value = 'Qty';
        worksheet.getCell(`M${headerRow}`).value = 'UOM';

        // Apply Colors to Headers
        const applyHeaderStyle = (cellRef: string, colorHex: string) => {
            const cell = worksheet.getCell(cellRef);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${colorHex}` } };
            cell.font = { bold: true, size: 9 };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        };

        // Left headers
        applyHeaderStyle(`A${headerRow}`, COLORS.GRAY_HEADER);
        applyHeaderStyle(`B${headerRow}`, COLORS.PRODUCT_HEADER);
        applyHeaderStyle(`C${headerRow}`, COLORS.BRAND_HEADER);
        applyHeaderStyle(`D${headerRow}`, COLORS.DETAILS_HEADER);
        applyHeaderStyle(`E${headerRow}`, COLORS.GRAY_HEADER);
        applyHeaderStyle(`F${headerRow}`, COLORS.UOM_HEADER);

        // Right headers
        applyHeaderStyle(`H${headerRow}`, COLORS.GRAY_HEADER);
        applyHeaderStyle(`I${headerRow}`, COLORS.PRODUCT_HEADER);
        applyHeaderStyle(`J${headerRow}`, COLORS.BRAND_HEADER);
        applyHeaderStyle(`K${headerRow}`, COLORS.DETAILS_HEADER);
        applyHeaderStyle(`L${headerRow}`, COLORS.GRAY_HEADER);
        applyHeaderStyle(`M${headerRow}`, COLORS.UOM_HEADER);

        currentRow++;

        // Render Data Rows
        itemsList.forEach((item, index) => {
            const rowIdx = currentRow;
            
            // Left Table (Requested)
            worksheet.getCell(`A${rowIdx}`).value = index + 1;
            worksheet.getCell(`B${rowIdx}`).value = item.name;
            worksheet.getCell(`C${rowIdx}`).value = item.brand || 'NA';
            worksheet.getCell(`D${rowIdx}`).value = item.details || '';
            worksheet.getCell(`E${rowIdx}`).value = item.requested_qty || 0;
            worksheet.getCell(`F${rowIdx}`).value = item.unit || 'pcs';

            // Right Table (Stock)
            worksheet.getCell(`H${rowIdx}`).value = index + 1;
            worksheet.getCell(`I${rowIdx}`).value = item.name;
            worksheet.getCell(`J${rowIdx}`).value = item.brand || 'NA';
            worksheet.getCell(`K${rowIdx}`).value = item.details || '';
            worksheet.getCell(`L${rowIdx}`).value = item.available_stock_qty || 0;
            worksheet.getCell(`M${rowIdx}`).value = item.unit || 'pcs';

            // Cell styling
            const cells = [`A${rowIdx}`, `B${rowIdx}`, `C${rowIdx}`, `D${rowIdx}`, `E${rowIdx}`, `F${rowIdx}`,
                           `H${rowIdx}`, `I${rowIdx}`, `J${rowIdx}`, `K${rowIdx}`, `L${rowIdx}`, `M${rowIdx}`];

            cells.forEach(c => {
                const cell = worksheet.getCell(c);
                cell.font = { size: 9 };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                };
            });

            // Column Color fills for cells (Matching Photo visual look)
            worksheet.getCell(`B${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.PRODUCT_CELL}` } };
            worksheet.getCell(`C${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.BRAND_CELL}` } };
            worksheet.getCell(`D${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.DETAILS_CELL}` } };
            worksheet.getCell(`F${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.UOM_CELL}` } };

            worksheet.getCell(`I${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.PRODUCT_CELL}` } };
            worksheet.getCell(`J${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.BRAND_CELL}` } };
            worksheet.getCell(`K${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.DETAILS_CELL}` } };
            worksheet.getCell(`M${rowIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLORS.UOM_CELL}` } };

            worksheet.getCell(`A${rowIdx}`).alignment = { horizontal: 'center' };
            worksheet.getCell(`E${rowIdx}`).alignment = { horizontal: 'right' };
            worksheet.getCell(`F${rowIdx}`).alignment = { horizontal: 'center' };
            worksheet.getCell(`H${rowIdx}`).alignment = { horizontal: 'center' };
            worksheet.getCell(`L${rowIdx}`).alignment = { horizontal: 'right' };
            worksheet.getCell(`M${rowIdx}`).alignment = { horizontal: 'center' };

            currentRow++;
        });

        currentRow += 2; // Gap between sections
    };

    // Render HK Section
    if (hkItems.length > 0) {
        renderCategorySection('HK / Stationery / Paper Products', hkItems);
    }

    // Render Beverages Section
    if (beverageItems.length > 0) {
        renderCategorySection('CCD (Tea/Coffee) / Beverages', beverageItems);
    }

    // Render Other Section if any
    if (otherItems.length > 0) {
        renderCategorySection('General & Technical Spares', otherItems);
    }

    // If total items is empty, render default template rows
    if (items.length === 0) {
        renderCategorySection('HK / Stationery / Paper Products', [
            { category: 'HK', name: 'Toilet Roll', brand: 'NA', details: 'White', requested_qty: 60, available_stock_qty: 60, unit: 'pcs' },
            { category: 'HK', name: 'M fold', brand: 'NA', details: 'White', requested_qty: 120, available_stock_qty: 80, unit: 'pcs' },
            { category: 'HK', name: 'Tissue paper', brand: 'NA', details: 'White', requested_qty: 55, available_stock_qty: 20, unit: 'pcs' },
        ]);
        renderCategorySection('CCD (Tea/Coffee) / Beverages', [
            { category: 'Beverages', name: 'CCD Coffee Beans', brand: 'CCD', details: 'Beans', requested_qty: 5, available_stock_qty: 3, unit: 'KG' },
            { category: 'Beverages', name: 'CCD Tetra Milk', brand: 'CCD', details: 'Milk', requested_qty: 24, available_stock_qty: 84, unit: 'Ltr' },
            { category: 'Beverages', name: 'Sugar', brand: 'NA', details: 'White', requested_qty: 5, available_stock_qty: 5, unit: 'KG' },
        ]);
    }
}

/**
 * Populates the Consolidated Summary Worksheet displaying all properties at a glance.
 */
export function populateSummaryWorksheet(
    worksheet: ExcelJS.Worksheet,
    data: MultiPropertyExportData,
    sheetNameMap: Map<number, string>
) {
    worksheet.columns = [
        { key: 'colA', width: 6 },   // #
        { key: 'colB', width: 28 },  // Property / Site Name
        { key: 'colC', width: 16 },  // Floor / Tag
        { key: 'colD', width: 16 },  // Status
        { key: 'colE', width: 12 },  // HK Items
        { key: 'colF', width: 14 },  // Beverages
        { key: 'colG', width: 12 },  // Total Items
        { key: 'colH', width: 20 },  // Est. Material Cost (₹)
        { key: 'colI', width: 20 },  // Monthly Budget (₹)
        { key: 'colJ', width: 18 },  // Budget Variance (₹)
        { key: 'colK', width: 22 },  // Requested By
        { key: 'colL', width: 16 },  // Contact Phone
        { key: 'colM', width: 24 },  // Worksheet Page Link
    ];

    let currentRow = 1;

    // 1. Report Title Banner
    worksheet.mergeCells(`A${currentRow}:M${currentRow}`);
    const titleCell = worksheet.getCell(`A${currentRow}`);
    titleCell.value = `AUTOPILOT FMS — CONSOLIDATED MONTHLY REQUISITIONS REPORT`;
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(currentRow).height = 32;
    currentRow++;

    // 2. Subtitle / Metadata
    worksheet.mergeCells(`A${currentRow}:M${currentRow}`);
    const subCell = worksheet.getCell(`A${currentRow}`);
    subCell.value = `Period: ${data.monthName} ${data.year}  |  Organization: ${data.organizationName || 'Autopilot'}  |  Total Properties: ${data.propertiesData.length}  |  Exported: ${new Date().toLocaleDateString('en-GB')}`;
    subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF334155' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(currentRow).height = 22;
    currentRow += 2;

    // 3. Table Column Headers
    const headerRow = currentRow;
    const headers = [
        { col: 'A', text: '#' },
        { col: 'B', text: 'Property / Site Name' },
        { col: 'C', text: 'Floor / Location' },
        { col: 'D', text: 'Status' },
        { col: 'E', text: 'HK Items' },
        { col: 'F', text: 'Beverage Items' },
        { col: 'G', text: 'Total Items' },
        { col: 'H', text: 'Est. Total Cost (₹)' },
        { col: 'I', text: 'Monthly Budget (₹)' },
        { col: 'J', text: 'Budget Status' },
        { col: 'K', text: 'Requested By' },
        { col: 'L', text: 'Contact Phone' },
        { col: 'M', text: 'Go to Site Page ➔' },
    ];

    headers.forEach(h => {
        const cell = worksheet.getCell(`${h.col}${headerRow}`);
        cell.value = h.text;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }; // Dark Emerald
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            bottom: { style: 'medium', color: { argb: 'FF0F766E' } },
            right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        };
    });
    worksheet.getRow(headerRow).height = 26;
    currentRow++;

    // 4. Populate Table Rows
    const startDataRow = currentRow;

    data.propertiesData.forEach((prop, idx) => {
        const rowIdx = currentRow;
        const targetSheetName = sheetNameMap.get(idx) || `Site ${idx + 1}`;
        const items = prop.items || [];
        const hkCount = items.filter(i => (i.category || '').toLowerCase() === 'hk' || (i.category || '').toLowerCase().includes('stationery')).length;
        const bevCount = items.filter(i => (i.category || '').toLowerCase() === 'beverages' || (i.category || '').toLowerCase().includes('tea') || (i.category || '').toLowerCase().includes('coffee')).length;
        const totalCount = items.length;

        const estCost = prop.totalEstimatedAmount || 0;
        const budget = prop.budgetLimit || prop.totalBudget || 0;
        const isOver = prop.isOverBudget || (budget > 0 && estCost > budget);
        const overAmt = isOver ? (estCost - budget) : 0;

        worksheet.getCell(`A${rowIdx}`).value = idx + 1;
        worksheet.getCell(`B${rowIdx}`).value = prop.propertyName;
        worksheet.getCell(`C${rowIdx}`).value = prop.floorTag || 'All Floors';
        worksheet.getCell(`D${rowIdx}`).value = (prop.status || 'Draft').toUpperCase();
        worksheet.getCell(`E${rowIdx}`).value = hkCount;
        worksheet.getCell(`F${rowIdx}`).value = bevCount;
        worksheet.getCell(`G${rowIdx}`).value = totalCount;
        worksheet.getCell(`H${rowIdx}`).value = estCost;
        worksheet.getCell(`I${rowIdx}`).value = budget;
        worksheet.getCell(`J${rowIdx}`).value = isOver && overAmt > 0
            ? `⚠️ Over ₹${overAmt.toLocaleString('en-IN')}`
            : (budget > 0 ? '✓ Within Budget' : 'No Budget Set');
        worksheet.getCell(`K${rowIdx}`).value = prop.requesterName || 'Property Admin';
        worksheet.getCell(`L${rowIdx}`).value = prop.requesterPhone || 'N/A';

        // Hyperlink to Property Sheet
        worksheet.getCell(`M${rowIdx}`).value = {
            text: `📄 View ${targetSheetName}`,
            hyperlink: `#'${targetSheetName}'!A1`
        };

        // Alignments & Number formats
        worksheet.getCell(`A${rowIdx}`).alignment = { horizontal: 'center' };
        worksheet.getCell(`C${rowIdx}`).alignment = { horizontal: 'center' };
        worksheet.getCell(`D${rowIdx}`).alignment = { horizontal: 'center' };
        worksheet.getCell(`E${rowIdx}`).alignment = { horizontal: 'right' };
        worksheet.getCell(`F${rowIdx}`).alignment = { horizontal: 'right' };
        worksheet.getCell(`G${rowIdx}`).alignment = { horizontal: 'right' };
        worksheet.getCell(`H${rowIdx}`).alignment = { horizontal: 'right' };
        worksheet.getCell(`I${rowIdx}`).alignment = { horizontal: 'right' };
        worksheet.getCell(`J${rowIdx}`).alignment = { horizontal: 'center' };
        worksheet.getCell(`M${rowIdx}`).alignment = { horizontal: 'center' };

        worksheet.getCell(`H${rowIdx}`).numFmt = '₹#,##0.00';
        worksheet.getCell(`I${rowIdx}`).numFmt = '₹#,##0.00';

        // Row background & styling
        const isZebra = idx % 2 === 1;
        const rowBg = isOver
            ? 'FFFFF1F2' // Light Rose
            : (isZebra ? 'FFF8FAFC' : 'FFFFFFFF');

        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].forEach(c => {
            const cell = worksheet.getCell(`${c}${rowIdx}`);
            cell.font = { name: 'Calibri', size: 9.5 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
        });

        if (isOver) {
            worksheet.getCell(`J${rowIdx}`).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FFBE123C' } };
        }
        worksheet.getCell(`M${rowIdx}`).font = { name: 'Calibri', size: 9.5, color: { argb: 'FF0284C7' }, underline: true };

        currentRow++;
    });

    const endDataRow = currentRow - 1;

    // 5. Total Row
    if (data.propertiesData.length > 0) {
        const totalRowIdx = currentRow;
        worksheet.mergeCells(`A${totalRowIdx}:D${totalRowIdx}`);
        worksheet.getCell(`A${totalRowIdx}`).value = 'CONSOLIDATED TOTALS';
        worksheet.getCell(`A${totalRowIdx}`).font = { name: 'Calibri', size: 10, bold: true };
        worksheet.getCell(`A${totalRowIdx}`).alignment = { horizontal: 'right', vertical: 'middle' };

        worksheet.getCell(`E${totalRowIdx}`).value = { formula: `SUM(E${startDataRow}:E${endDataRow})` };
        worksheet.getCell(`F${totalRowIdx}`).value = { formula: `SUM(F${startDataRow}:F${endDataRow})` };
        worksheet.getCell(`G${totalRowIdx}`).value = { formula: `SUM(G${startDataRow}:G${endDataRow})` };
        worksheet.getCell(`H${totalRowIdx}`).value = { formula: `SUM(H${startDataRow}:H${endDataRow})` };
        worksheet.getCell(`I${totalRowIdx}`).value = { formula: `SUM(I${startDataRow}:I${endDataRow})` };

        worksheet.getCell(`H${totalRowIdx}`).numFmt = '₹#,##0.00';
        worksheet.getCell(`I${totalRowIdx}`).numFmt = '₹#,##0.00';

        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].forEach(c => {
            const cell = worksheet.getCell(`${c}${totalRowIdx}`);
            cell.font = { name: 'Calibri', size: 10, bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            cell.border = {
                top: { style: 'medium', color: { argb: 'FF64748B' } },
                bottom: { style: 'double', color: { argb: 'FF64748B' } },
                left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            };
        });
        worksheet.getRow(totalRowIdx).height = 24;
    }
}

/**
 * Generates a multi-sheet Excel workbook containing:
 * 1. "All Sites Summary" sheet (Consolidated overview matrix)
 * 2. One individual worksheet per property/floor requisition
 */
export async function generateAllPropertiesRequisitionExcelWorkbook(data: MultiPropertyExportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Autopilot FMS Procurement System';
    workbook.lastModifiedBy = data.exportedBy || 'Autopilot Procurement';
    workbook.created = new Date();

    // 1. Create Summary Sheet
    const summarySheet = workbook.addWorksheet('All Sites Summary', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ state: 'frozen', ySplit: 6 }]
    });

    // 2. Pre-calculate unique sheet names for each property
    const usedNames = new Set<string>(['all sites summary']);
    const sheetNameMap = new Map<number, string>();

    data.propertiesData.forEach((prop, idx) => {
        const rawName = prop.floorTag && prop.floorTag !== 'All Floors'
            ? `${prop.propertyName} - ${prop.floorTag}`
            : prop.propertyName;
        const sheetName = sanitizeExcelSheetName(rawName, idx, usedNames);
        sheetNameMap.set(idx, sheetName);
    });

    // 3. Populate each individual Property Worksheet
    data.propertiesData.forEach((prop, idx) => {
        const sheetName = sheetNameMap.get(idx) || `Site ${idx + 1}`;
        const propSheet = workbook.addWorksheet(sheetName, {
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });
        populateRequisitionWorksheet(propSheet, prop);
    });

    // 4. Populate Summary Worksheet
    populateSummaryWorksheet(summarySheet, data, sheetNameMap);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

/**
 * Generates a single-property Excel workbook (backward-compatible).
 */
export async function generateRequisitionExcelWorkbook(data: RequisitionExportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Autopilot FMS Procurement System';
    workbook.lastModifiedBy = data.requesterName || 'Autopilot';
    workbook.created = new Date();

    const usedNames = new Set<string>();
    const sheetName = sanitizeExcelSheetName(data.propertyName || 'Requisition', 0, usedNames);
    const worksheet = workbook.addWorksheet(sheetName, {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    populateRequisitionWorksheet(worksheet, data);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
