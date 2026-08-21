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
    siteNotes?: string;
    items: RequisitionItemData[];
    vendorName?: string;
    vendorQuotedAmount?: number;
    status?: string;
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
};

export async function generateRequisitionExcelWorkbook(data: RequisitionExportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Autopilot FMS Procurement System';
    workbook.lastModifiedBy = data.requesterName || 'Autopilot';
    workbook.created = new Date();

    const sheetName = (data.propertyName || 'Requisition').replace(/[/\\?*:[\]]/g, ' ').substring(0, 30);
    const worksheet = workbook.addWorksheet(sheetName, {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    // Setup column widths
    worksheet.columns = [
        { key: 'colA', width: 6 },   // #
        { key: 'colB', width: 26 },  // Product Name/Type
        { key: 'colC', width: 22 },  // Specific Brand if any
        { key: 'colD', width: 22 },  // Color, Size
        { key: 'colE', width: 10 },  // Qty
        { key: 'colF', width: 10 },  // UOM
        { key: 'colG', width: 4 },   // Spacer
        { key: 'colH', width: 6 },   // #
        { key: 'colI', width: 26 },  // Product Name/Type
        { key: 'colJ', width: 22 },  // Specific Brand if any
        { key: 'colK', width: 22 },  // Color, Size
        { key: 'colL', width: 10 },  // Qty
        { key: 'colM', width: 10 },  // UOM
    ];

    let currentRow = 1;

    // 1. Top Meta Info (Left Block)
    worksheet.getCell(`A${currentRow}`).value = `Place: ${data.propertyLocation || data.propertyName}`;
    worksheet.getCell(`A${currentRow}`).font = { name: 'Calibri', size: 10, bold: true };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Date: ${data.dateFormatted}`;
    worksheet.getCell(`A${currentRow}`).font = { name: 'Calibri', size: 10 };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Signed: ${data.requesterName}`;
    worksheet.getCell(`A${currentRow}`).font = { name: 'Calibri', size: 10 };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Mobile#: ${data.requesterPhone || 'N/A'}`;
    worksheet.getCell(`A${currentRow}`).font = { name: 'Calibri', size: 10 };
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
    worksheet.getCell(`A${currentRow}`).value = `Name: ${data.requesterName}`;
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 10 };
    worksheet.getCell(`D${currentRow}`).value = `Date: ${data.dateFormatted}`;
    worksheet.getCell(`D${currentRow}`).font = { bold: true, size: 10 };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Center: ${data.propertyName}`;
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 10 };
    currentRow++;

    worksheet.getCell(`A${currentRow}`).value = `Sub: Requisition of Material for above specified center`;
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 10 };
    currentRow += 2;

    worksheet.getCell(`A${currentRow}`).value = `We require the below material for the month of 1/${data.monthIndex}/${data.year}`;
    worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 11, italic: true };
    currentRow += 2;

    // 4. Split Items by Category
    const hkItems = data.items.filter(i => (i.category || '').toLowerCase() === 'hk' || (i.category || '').toLowerCase().includes('stationery') || (i.category || '').toLowerCase().includes('paper'));
    const beverageItems = data.items.filter(i => (i.category || '').toLowerCase() === 'beverages' || (i.category || '').toLowerCase().includes('tea') || (i.category || '').toLowerCase().includes('coffee') || (i.category || '').toLowerCase().includes('pantry'));
    const otherItems = data.items.filter(i => !hkItems.includes(i) && !beverageItems.includes(i));

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
    if (data.items.length === 0) {
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

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
